import { useEffect, useRef, useState } from 'react';
import { sampleBook, SAMPLE_BOOK_ID } from '../data/sampleBook';
import type { Book } from '../domain/models';
import { novelCache } from '../services/novelCache';
import { geminiTranslationProvider, serverApi } from '../services/folioApi';
import type { ServerSession } from '../services/folioApi';
import { FolioError, GLOSSARY_VERSION, TRANSLATION_MODEL, TRANSLATION_VERSION, makeBatches, translationKey, validateTranslation } from '../../shared/novels';
import type { ImportedNovel, TranslationCache } from '../../shared/novels';

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(new DOMException('중단됨', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  });
}
export function novelBook(novel: ImportedNovel, cache: TranslationCache | undefined, language: 'en' | 'ko'): Book {
  const translated = new Map(cache?.chunks.filter((c) => c.status === 'complete').flatMap((c) => c.paragraphs).map((p) => [p.id, p.text]));
  return {
    id: novel.id, title: novel.title, subtitle: novel.source.attribution, author: 'Tappei Nagatsuki',
    arcs: [{ id: `arc-${novel.source.arc}`, title: `제${novel.source.arc}장`, subtitle: 'Witch Cult Translations' }],
    chapters: [{ id: novel.chapterId, arcId: `arc-${novel.source.arc}`, number: novel.source.chapter, title: novel.title, paragraphs: novel.paragraphs.map((p) => ({ id: p.id, text: language === 'ko' ? translated.get(p.id) ?? p.text : p.text })) }],
  };
}
export function useNovelLibrary() {
  const [entries, setEntries] = useState<ImportedNovel[]>([]);
  const [selectedId, setSelectedId] = useState(SAMPLE_BOOK_ID);
  const [languages, setLanguages] = useState<Record<string, 'en' | 'ko'>>({});
  const [caches, setCaches] = useState<Record<string, TranslationCache>>({});
  const [session, setSession] = useState<ServerSession>({ configured: false, authenticated: false });
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [ready, setReady] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const selected = entries.find((entry) => entry.id === selectedId);
  const cache = selected ? caches[translationKey(selected)] : undefined;
  const complete = !!cache && cache.chunks.length > 0 && cache.chunks.every((chunk) => chunk.status === 'complete');
  const language = selected && complete ? languages[selectedId] ?? 'en' : 'en';
  const book = selected ? novelBook(selected, cache, language) : sampleBook;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const novels = await novelCache.list();
        const translations: Record<string, TranslationCache> = {};
        for (const novel of novels) {
          const key = translationKey(novel);
          const saved = await novelCache.translation(key);
          if (saved && saved.model === TRANSLATION_MODEL && saved.sourceHash === novel.source.hash) {
            const batches = makeBatches(novel.paragraphs);
            if (saved.chunks.length === batches.length) {
              saved.chunks = saved.chunks.map((chunk, i) => {
                try { if (chunk.id !== batches[i].id || chunk.status !== 'complete') throw Error(); return { ...chunk, paragraphs: validateTranslation(batches[i].paragraphs, chunk.paragraphs) }; }
                catch { return { id: batches[i].id, status: 'pending', paragraphs: [] }; }
              });
              translations[key] = saved;
            }
          }
        }
        const savedId = await novelCache.preference<string>('selected');
        const savedLanguages = await novelCache.preference<Record<string, 'en' | 'ko'>>('languages');
        if (!active) return;
        setEntries(novels); setCaches(translations);
        if (savedId && novels.some((novel) => novel.id === savedId)) setSelectedId(savedId);
        if (savedLanguages && typeof savedLanguages === 'object') setLanguages(savedLanguages);
      } catch (problem) { if (active) setError((problem as Error).message); }
      finally { if (active) setReady(true); }
    })();
    void serverApi.session().then((value) => { if (active) setSession(value); }).catch(() => {});
    return () => { active = false; controller.current?.abort(); };
  }, []);

  function stop() { controller.current?.abort(); }
  function select(id: string) {
    stop(); setSelectedId(id); setError('');
    void novelCache.savePreference('selected', id).catch((problem) => setError(problem.message));
  }
  async function add(novel: ImportedNovel) {
    stop();
    await novelCache.save(novel);
    setEntries((current) => [...current.filter((entry) => entry.id !== novel.id), novel]);
    select(novel.id);
  }
  function setLanguage(value: 'en' | 'ko') {
    if (!selected || (value === 'ko' && !complete)) return;
    const next = { ...languages, [selected.id]: value };
    setLanguages(next);
    void novelCache.savePreference('languages', next).catch((problem) => setError(problem.message));
  }
  async function refreshSession() { const state = await serverApi.session(); setSession(state); return state; }
  async function translate() {
    if (!selected || controller.current || complete) return;
    const signalController = new AbortController();
    controller.current = signalController;
    setRunning(true); setError(''); setWaiting(false);
    const source = selected;
    const key = translationKey(source);
    const batches = makeBatches(source.paragraphs);
    let document: TranslationCache = cache ? structuredClone(cache) : {
      key, novelId: source.id, sourceUrl: source.source.url, chapterId: source.chapterId,
      sourceHash: source.source.hash, model: TRANSLATION_MODEL, version: TRANSLATION_VERSION, glossaryVersion: GLOSSARY_VERSION,
      chunks: batches.map((batch) => ({ id: batch.id, status: 'pending', paragraphs: [] })), updatedAt: new Date().toISOString(),
    };
    let currentIndex = -1;
    const commit = async () => {
      document.updatedAt = new Date().toISOString();
      const snapshot = structuredClone(document);
      const saved = await novelCache.saveTranslation(snapshot);
      document = structuredClone(saved);
      setCaches((current) => ({ ...current, [key]: saved }));
    };
    try {
      await commit();
      for (let index = 0; index < batches.length; index++) {
        if (signalController.signal.aborted) break;
        if (document.chunks[index].status === 'complete') continue;
        currentIndex = index;
        const result = await geminiTranslationProvider.translateBatch({ ...batches[index], sourceHash: source.source.hash, previousTranslation: index ? document.chunks[index - 1].paragraphs.slice(-2) : [] }, signalController.signal);
        if (result.model !== TRANSLATION_MODEL) throw Error('예상한 번역 모델과 일치하지 않습니다.');
        document.chunks[index] = { id: batches[index].id, status: 'complete', paragraphs: result.paragraphs };
        await commit(); // Never request another chunk until the completed chunk is durable.
        currentIndex = -1;
        if (index < batches.length - 1 && result.nextRequestAfterMs > 0) { setWaiting(true); await wait(Math.min(result.nextRequestAfterMs, 60_000), signalController.signal); setWaiting(false); }
      }
    } catch (problem) {
      if (!(problem instanceof DOMException && problem.name === 'AbortError')) {
        const message = problem instanceof Error ? problem.message : '번역을 처리하지 못했습니다.';
        if (currentIndex >= 0 && document.chunks[currentIndex].status !== 'complete') {
          document.chunks[currentIndex] = { id: batches[currentIndex].id, status: 'error', paragraphs: [], error: message };
          try { await commit(); } catch { /* surface the storage error and stop further API calls */ }
        }
        setError(message);
        if (problem instanceof FolioError && problem.status === 429) setRetryAt(Date.now() + Math.max(60, problem.retryAfter) * 1000);
        if (problem instanceof FolioError && problem.status === 401) setSession((current) => ({ ...current, authenticated: false }));
      }
    } finally { if (controller.current === signalController) controller.current = null; setRunning(false); setWaiting(false); }
  }
  return { ready, book, selected, selectedId, entries, language, cache, complete, session, running, waiting, error, retryAt, add, select, setLanguage, translate, stop, refreshSession };
}
