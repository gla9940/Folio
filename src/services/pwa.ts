import { useSyncExternalStore } from 'react';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>;
}
type Reply = {complete?: boolean; version?: string; accepted?: boolean; blocked?: boolean};
const standalone = () => matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & {standalone?: boolean}).standalone;
let state = {online: navigator.onLine, ready: false, preparing: false, update: false, installed: standalone(), runningStandalone: standalone(), installable: false, error: ''};
const listeners = new Set<() => void>();
let registration: ServiceWorkerRegistration | null = null, deferredInstall: InstallPrompt | null = null;
let started = false, applying = false, replacedController = false, lastCheck = 0;
const emit = (update: Partial<typeof state>) => { state = {...state, ...update}; listeners.forEach(listener => listener()); };
export const usePwa = () => useSyncExternalStore(listener => {listeners.add(listener); return () => {listeners.delete(listener);};}, () => state);

function message(worker: ServiceWorker, type: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {channel.port1.close(); reject(Error('응답을 받지 못했습니다. 온라인에서 다시 시도해 주세요.'));}, 8000);
    channel.port1.onmessage = event => {clearTimeout(timer); channel.port1.close(); resolve(event.data as Reply);};
    worker.postMessage({type}, [channel.port2]);
  });
}
async function refreshStatus() {
  emit({update: !!registration?.waiting || replacedController});
  if (!registration?.active) return;
  try {
    const status = await message(registration.active, 'FOLIO_STATUS');
    emit({ready: !!status.complete, preparing: false, ...(status.complete ? {error: ''} : {error: '앱 파일이 완전히 준비되지 않았습니다. 온라인에서 다시 열어 주세요.'})});
  } catch { emit({preparing: false}); }
}
async function registerWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  emit({preparing: true});
  try {
    registration = await navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'});
    const observe = (worker: ServiceWorker | null) => worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' || worker.state === 'activated') void refreshStatus();
      if (worker.state === 'redundant' && !state.ready) emit({preparing: false, error: '오프라인 준비를 마치지 못했습니다. 온라인에서 다시 시도해 주세요.'});
    });
    registration.addEventListener('updatefound', () => observe(registration!.installing));
    observe(registration.installing);
    await refreshStatus();
    if (navigator.onLine) {
      try { await registration.update(); lastCheck = Date.now(); }
      catch { if (!state.ready) emit({preparing: false, error: '오프라인 준비를 마치지 못했습니다. 온라인에서 다시 시도해 주세요.'}); }
    }
  } catch { emit({preparing: false, error: '오프라인 준비를 마치지 못했습니다. 온라인에서 다시 시도해 주세요.'}); }
}
export async function checkPwaUpdate() {
  if (!registration) { await registerWorker(); return; }
  if (!navigator.onLine) return;
  try { await registration.update(); lastCheck = Date.now(); await refreshStatus(); } catch { /* Reading stays available if the update server cannot be reached. */ }
}
export async function installPwa() {
  if (!deferredInstall) return;
  const prompt = deferredInstall; deferredInstall = null; emit({installable: false});
  try { await prompt.prompt(); await prompt.userChoice; } catch { /* Browser keeps ownership of installation. */ }
}
export async function applyPwaUpdate() {
  if (applying || (!registration?.waiting && !replacedController)) return;
  if (!window.dispatchEvent(new Event('folio:before-update', {cancelable: true}))) {
    emit({error: '읽던 위치를 저장하지 못해 업데이트를 보류했습니다.'}); return;
  }
  applying = true;
  if (!registration?.waiting) { location.reload(); return; }
  try {
    const result = await message(registration.waiting, 'FOLIO_ACTIVATE');
    if (!result.accepted) { applying = false; emit({error: result.blocked ? '다른 Folio 창을 닫은 뒤 다시 업데이트해 주세요.' : '업데이트를 적용하지 못했습니다.'}); }
    // Only this consenting tab reloads, after controllerchange.
  } catch (error) { applying = false; emit({error: (error as Error).message}); }
}
export function startPwa() {
  if (started) return; started = true;
  window.addEventListener('beforeinstallprompt', event => {event.preventDefault(); deferredInstall = event as InstallPrompt; emit({installable: true});});
  window.addEventListener('appinstalled', () => {deferredInstall = null; emit({installed: true, installable: false});});
  window.addEventListener('online', () => {emit({online: true}); void checkPwaUpdate();});
  window.addEventListener('offline', () => emit({online: false}));
  matchMedia('(display-mode: standalone)').addEventListener('change', () => emit({runningStandalone: standalone(), ...(standalone() ? {installed: true} : {})}));
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  let previous = navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) { location.reload(); return; }
    if (previous) replacedController = true;
    previous = navigator.serviceWorker.controller;
    void refreshStatus();
  });
  const maybeUpdate = () => {if (document.visibilityState === 'visible' && navigator.onLine && Date.now() - lastCheck > 60_000) void checkPwaUpdate();};
  document.addEventListener('visibilitychange', maybeUpdate);
  setInterval(maybeUpdate, 5 * 60_000);
  if (document.readyState === 'complete') void registerWorker();
  else window.addEventListener('load', () => void registerWorker(), {once: true});
}
