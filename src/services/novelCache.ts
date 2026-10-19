import type { ImportedNovel, TranslationCache } from '../../shared/novels';
const DB_NAME = 'folio-library-v1';
let pending: Promise<IDBDatabase> | null = null;
function database() {
  if (!pending) pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('novels', { keyPath: 'id' });
      db.createObjectStore('translations', { keyPath: 'key' });
      db.createObjectStore('preferences', { keyPath: 'id' });
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); pending = null; }; resolve(request.result); };
    request.onerror = () => { pending = null; reject(Error('이 기기의 서재 저장소를 열 수 없습니다.')); };
    request.onblocked = () => { pending = null; reject(Error('다른 Folio 탭을 닫은 뒤 다시 시도해 주세요.')); };
  });
  return pending;
}
async function run<T>(store: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = operation(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(Error('서재 저장에 실패했습니다. 공간·개인정보 보호 설정을 확인해 주세요.'));
  });
}
function validNovel(value: unknown): value is ImportedNovel {
  const novel = value as ImportedNovel | null;
  return !!novel && typeof novel.id === 'string' && typeof novel.title === 'string' && typeof novel.chapterId === 'string' &&
    !!novel.source && (/^https:\/\/(?:www\.)?witchculttranslation\.com\//.test(novel.source.url) ||
      (['epub', 'txt'].includes(novel.source.kind) && /^folio-file:[a-f0-9]{64}#[^\s]+$/.test(novel.source.url))) && /^[a-f0-9]{64}$/.test(novel.source.hash) &&
    Number.isInteger(novel.source.arc) && Number.isInteger(novel.source.chapter) &&
    Array.isArray(novel.paragraphs) && novel.paragraphs.length > 0 && novel.paragraphs.every((p) => p && typeof p.id === 'string' && typeof p.text === 'string');
}
export const novelCache = {
  async list(): Promise<ImportedNovel[]> { return (await run<unknown[]>('novels', 'readonly', (store) => store.getAll())).filter(validNovel); },
  async save(novel: ImportedNovel) { await this.saveAll([novel]); },
  async saveAll(novels: ImportedNovel[]) {
    if (!novels.length || !novels.every(validNovel)) throw Error('원문 데이터 형식이 올바르지 않습니다.');
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('novels', 'readwrite');
      const store = tx.objectStore('novels');
      for (const novel of novels) store.put(novel);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(Error('파일을 저장하지 못했습니다. 저장 공간을 확인해 주세요.'));
    });
  },
  async translation(key: string): Promise<TranslationCache | null> {
    const value = await run<TranslationCache | undefined>('translations', 'readonly', (store) => store.get(key));
    return value?.key === key && Array.isArray(value.chunks) ? value : null;
  },
  async saveTranslation(value: TranslationCache): Promise<TranslationCache> {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('translations', 'readwrite');
      const store = tx.objectStore('translations');
      const read = store.get(value.key);
      let merged = structuredClone(value);
      read.onsuccess = () => {
        const previous = read.result as TranslationCache | undefined;
        if (previous?.sourceHash === value.sourceHash && Array.isArray(previous.chunks)) {
          merged.chunks = merged.chunks.map((chunk) => {
            const saved = previous.chunks.find((item) => item.id === chunk.id);
            return chunk.status !== 'complete' && saved?.status === 'complete' && Array.isArray(saved.paragraphs) ? saved : chunk;
          });
        }
        store.put(merged);
      };
      tx.oncomplete = () => resolve(merged);
      tx.onerror = tx.onabort = () => reject(Error('번역 구간을 기기에 저장하지 못해 추가 API 호출을 중단했습니다.'));
    });
  },
  async preference<T>(id: string): Promise<T | undefined> { return (await run<{ id: string; value: T } | undefined>('preferences', 'readonly', (store) => store.get(id)))?.value; },
  async savePreference(id: string, value: unknown) { await run('preferences', 'readwrite', (store) => store.put({ id, value })); },
};
