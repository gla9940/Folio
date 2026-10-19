import type { ImportedNovel } from '../../shared/novels';
import { libraryId } from '../domain/library';
const DB_NAME = 'folio-library-v1';
let pending: Promise<IDBDatabase> | null = null;
function database() {
  if (!pending) pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('novels', { keyPath: 'id' });
      // Preserve the version-1 schema, including the unused legacy store. No migration/deletion.
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
  async preference<T>(id: string): Promise<T | undefined> { return (await run<{ id: string; value: T } | undefined>('preferences', 'readonly', (store) => store.get(id)))?.value; },
  async savePreference(id: string, value: unknown) { await run('preferences', 'readwrite', (store) => store.put({ id, value })); },
  async renameBook(id: string, title: string) {
    const db = await database();
    return new Promise<Record<string, string>>((resolve, reject) => {
      const tx = db.transaction('preferences', 'readwrite'), store = tx.objectStore('preferences');
      const request = store.get('book-titles');
      let titles: Record<string, string>;
      request.onsuccess = () => { titles = { ...request.result?.value, [id]: title }; store.put({ id: 'book-titles', value: titles }); };
      tx.oncomplete = () => resolve(titles);
      tx.onerror = tx.onabort = () => reject(Error('제목을 저장하지 못했습니다. 다시 시도해 주세요.'));
    });
  },
  async removeBook(id: string, fallback: string) {
    const db = await database();
    return new Promise<{ removed: ImportedNovel[]; read: Record<string, boolean>; titles: Record<string, string> }>((resolve, reject) => {
      const tx = db.transaction(['novels', 'preferences', 'translations'], 'readwrite');
      const novels = tx.objectStore('novels'), preferences = tx.objectStore('preferences');
      let removed: ImportedNovel[] = [], read = {}, titles = {};
      const request = novels.getAll();
      request.onsuccess = () => {
        removed = (request.result as ImportedNovel[]).filter((entry) => libraryId(entry) === id);
        if (!removed.length) { tx.abort(); return; }
        const ids = new Set(removed.map((entry) => entry.id));
        removed.forEach((entry) => novels.delete(entry.id));
        for (const name of ['read-chapters', 'languages', 'book-titles', 'selected']) {
          const pref = preferences.get(name);
          pref.onsuccess = () => {
            if (!pref.result) return;
            const value = pref.result.value;
            if (name === 'selected') {
              if (value === id || ids.has(value)) preferences.put({ id: name, value: fallback });
              return;
            }
            const next = Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => name === 'read-chapters'
              ? !removed.some((entry) => key.startsWith(`${entry.id}:`)) : key !== id && !ids.has(key)));
            if (name === 'read-chapters') read = next;
            if (name === 'book-titles') titles = next;
            preferences.put({ id: name, value: next });
          };
        }
        const cursor = tx.objectStore('translations').openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) return;
          // Legacy cache records are removed only with an explicit matching owner.
          if (ids.has(item.value.novelId) || (!item.value.novelId && removed.some((entry) => item.value.chapterId === entry.chapterId))) item.delete();
          item.continue();
        };
      };
      tx.oncomplete = () => resolve({ removed, read, titles });
      tx.onerror = tx.onabort = () => reject(Error('책을 삭제하지 못했습니다. 서재 저장소를 확인해 주세요.'));
    });
  },
};
