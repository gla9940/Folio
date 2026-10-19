import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServiceWorker, readBuild } from '../scripts/build-pwa.mjs';

async function server() {
  const original = await readBuild('dist');
  function build(name: string) {
    const files = new Map<string, Buffer>(original);
    files.set('/index.html', Buffer.from(files.get('/index.html')!.toString().replace('</head>', `<meta name="pwa-test-version" content="${name}"></head>`)));
    const worker = createServiceWorker(files); files.set('/sw.js', Buffer.from(worker.source));
    return {files, version: worker.version};
  }
  const versions = {one: build('one'), two: build('two'), three: build('three')};
  let current = versions.one, broken = false;
  const http = createServer((request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/another-tab.html' || path === '/source-chapter') {response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Not an app asset</title><p>Never cache this source</p>'); return;}
    const data = current.files.get(path === '/' ? '/index.html' : path);
    if (!data || (broken && path.endsWith('.css'))) {response.statusCode = 503; response.end('Unavailable'); return;}
    const extension = path.split('.').at(-1);
    response.setHeader('Content-Type', path === '/' || extension === 'html' ? 'text/html' : extension === 'js' ? 'text/javascript' : extension === 'css' ? 'text/css' : extension === 'woff2' ? 'font/woff2' : extension === 'webmanifest' ? 'application/manifest+json' : extension === 'png' ? 'image/png' : 'image/svg+xml');
    response.end(data);
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${(http.address() as AddressInfo).port}`, versions,
    deploy(name: keyof typeof versions, fail = false) {current = versions[name]; broken = fail;},
    close: () => new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve())),
  };
}
async function prepare(page: Page, url: string) {
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.getByRole('button', {name: 'EPUB / TXT 파일 등록', exact: true}).click();
  const prose = Array.from({length: 40}, (_, i) => `Paragraph ${i}. ` + 'The traveler read beside the river. '.repeat(5)).join('\n\n');
  await page.getByLabel('EPUB / TXT 파일').setInputFiles({name: 'preserved.txt', mimeType: 'text/plain', buffer: Buffer.from(`Chapter 1: Preserved\n\n${prose}\n\nChapter 2: Return\n\n${prose}`)});
  await page.getByRole('button', {name: '2개 화 서재에 등록'}).click();
  await page.getByRole('button', {name: '다크', exact: true}).click();
  await page.getByRole('button', {name: '가로 페이지', exact: true}).click();
  await page.getByRole('button', {name: '다음 화', exact: true}).click();
  await page.getByRole('button', {name: '다음 페이지', exact: true}).click();
  await page.locator('.paged-paragraph:not([aria-hidden="true"]) .paragraph-bookmark[tabindex="0"]').first().click();
  await page.evaluate(async () => {
    await (await caches.open('unrelated-reader-cache')).put('/unrelated', new Response('keep'));
    await (await caches.open('folio-app-v1-00000000000000000000')).put('/obsolete', new Response('old app resource'));
    await new Promise<void>(resolve => {
      const req = indexedDB.open('folio-library-v1'); req.onsuccess = () => {const db = req.result, tx = db.transaction('translations', 'readwrite'); tx.objectStore('translations').put({key: 'legacy-cache', text: 'keep'}); tx.oncomplete = () => {db.close(); resolve();};};
    });
  });
}
async function data(page: Page) {
  return page.evaluate(async () => {
    const dbData = await new Promise<Record<string, unknown[]>>(resolve => {
      const req = indexedDB.open('folio-library-v1'); req.onsuccess = () => {
        const db = req.result, tx = db.transaction(['novels', 'translations', 'preferences'], 'readonly'), result: Record<string, unknown[]> = {};
        for (const name of ['novels', 'translations', 'preferences']) {const all = tx.objectStore(name).getAll(); all.onsuccess = () => {result[name] = all.result;};}
        tx.oncomplete = () => {db.close(); resolve(result);};
      };
    });
    const book = (document.querySelector('#library-selection') as HTMLSelectElement).value;
    return {db: dbData, settings: localStorage.getItem('folio:v1:settings'), bookmarks: localStorage.getItem(`folio:v1:bookmarks:${book}`), progress: JSON.parse(localStorage.getItem(`folio:v1:progress:${book}`)!)};
  });
}
async function waitForUpdate(page: Page) {
  await page.evaluate(async () => {await (await navigator.serviceWorker.getRegistration())!.update();});
  await expect(page.getByRole('complementary', {name: '앱 업데이트'})).toBeVisible();
}

test('new builds wait for consent; update saves position, protects other tabs and only removes old app caches', async ({page, context}) => {
  const host = await server();
  try {
    await prepare(page, host.url); const before = await data(page);
    host.deploy('two'); await waitForUpdate(page);
    await expect(page.locator('meta[name=pwa-test-version]')).toHaveAttribute('content', 'one');
    expect((await data(page)).progress).toEqual(before.progress);
    await page.getByRole('button', {name: '나중에', exact: true}).click();
    await expect(page.getByRole('complementary', {name: '앱 업데이트'})).toHaveCount(0);
    await page.getByText('앱 설치 · 오프라인', {exact: true}).click();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      (window as unknown as {restoreStorage: () => void}).restoreStorage = () => {Storage.prototype.setItem = original;};
      Storage.prototype.setItem = () => {throw new DOMException('Quota exceeded', 'QuotaExceededError');};
    });
    await page.getByRole('button', {name: '읽던 위치 저장 후 업데이트'}).click();
    await expect(page.getByText('읽던 위치를 저장하지 못해 업데이트를 보류했습니다.', {exact: true})).toBeVisible();
    await expect(page.locator('meta[name=pwa-test-version]')).toHaveAttribute('content', 'one');
    await page.evaluate(() => (window as unknown as {restoreStorage: () => void}).restoreStorage());
    const other = await context.newPage(); await other.goto(host.url + '/another-tab.html');
    await page.getByRole('button', {name: '읽던 위치 저장 후 업데이트'}).click();
    await expect(page.getByText('다른 Folio 창을 닫은 뒤', {exact: false})).toBeVisible();
    await expect(page.locator('meta[name=pwa-test-version]')).toHaveAttribute('content', 'one');
    await other.close();
    await page.getByRole('button', {name: '읽던 위치 저장 후 업데이트'}).click();
    await expect(page.locator('meta[name=pwa-test-version]')).toHaveAttribute('content', 'two');
    await expect(page.locator('.chapter-heading h1')).toHaveText('Chapter 2: Return');
    const after = await data(page);
    expect(after.db).toEqual(before.db); expect(after.settings).toBe(before.settings); expect(after.bookmarks).toBe(before.bookmarks);
    expect(after.progress.paragraphId).toBe(before.progress.paragraphId); expect(after.progress.characterOffset).toBe(before.progress.characterOffset);
    let keys = await page.evaluate(() => caches.keys());
    expect(keys).toEqual(expect.arrayContaining(['unrelated-reader-cache', `folio-app-v1-${host.versions.two.version}`, `folio-app-v1-${host.versions.one.version}`]));
    expect(keys).not.toContain('folio-app-v1-00000000000000000000');
    await page.evaluate(() => fetch('/source-chapter'));
    expect(await page.evaluate(() => caches.match('/source-chapter').then(Boolean))).toBe(false);
    host.deploy('three'); await waitForUpdate(page);
    await page.getByRole('button', {name: '업데이트 · 새로고침'}).click();
    await expect(page.locator('meta[name=pwa-test-version]')).toHaveAttribute('content', 'three');
    await expect(page.locator('.chapter-heading h1')).toHaveText('Chapter 2: Return');
    keys = await page.evaluate(() => caches.keys());
    expect(keys).toContain('unrelated-reader-cache'); expect(keys).not.toContain(`folio-app-v1-${host.versions.one.version}`);
    expect((await data(page)).db).toEqual(before.db);
    await context.setOffline(true); await page.reload();
    await expect(page.locator('meta[name=pwa-test-version]')).toHaveAttribute('content', 'three');
    await expect(page.locator('.chapter-heading h1')).toHaveText('Chapter 2: Return');
  } finally {await context.setOffline(false); await page.goto('about:blank'); await host.close();}
});

test('a failed new build preserves the active offline shell and user data', async ({page, context}) => {
  const host = await server();
  try {
    await prepare(page, host.url); const before = await data(page);
    host.deploy('two', true);
    const state = await page.evaluate(async () => {
      const registration = (await navigator.serviceWorker.getRegistration())!;
      const changed = new Promise<string>(resolve => registration.addEventListener('updatefound', () => {
        const worker = registration.installing!; worker.addEventListener('statechange', () => {if (worker.state === 'redundant' || worker.state === 'installed') resolve(worker.state);});
      }, {once: true}));
      await registration.update(); return changed;
    });
    expect(state).toBe('redundant');
    await expect(page.getByRole('complementary', {name: '앱 업데이트'})).toHaveCount(0);
    const keys = await page.evaluate(() => caches.keys()); expect(keys).not.toContain(`folio-app-v1-${host.versions.two.version}`);
    await context.setOffline(true); await page.reload();
    await expect(page.locator('meta[name=pwa-test-version]')).toHaveAttribute('content', 'one');
    await expect(page.locator('.chapter-heading h1')).toHaveText('Chapter 2: Return');
    const after = await data(page); expect(after.db).toEqual(before.db); expect(after.bookmarks).toBe(before.bookmarks);
    expect(after.progress.paragraphId).toBe(before.progress.paragraphId);
  } finally {await context.setOffline(false); await page.goto('about:blank'); await host.close();}
});
