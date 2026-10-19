import type { ImportedNovel } from '../../shared/novels';
import { libraryId } from '../domain/library';
import { inspectSavedNovels, readSavedNovel, validNovel } from './savedNovel';
const DB_NAME = 'folio-library-v1';
let pending: Promise<IDBDatabase> | null = null;
class MissingLibrary extends Error {}
function database(create = false) {
  if (!pending) pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    let absent = false;
    request.onupgradeneeded = () => {
      if (!create) { absent = true; request.transaction!.abort(); return; }
      const db = request.result;
      db.createObjectStore('novels', { keyPath: 'id' });
      // Preserve the version-1 schema, including the unused legacy store. No migration/deletion.
      db.createObjectStore('translations', { keyPath: 'key' });
      db.createObjectStore('preferences', { keyPath: 'id' });
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); pending = null; }; resolve(request.result); };
    request.onerror = () => { pending = null; reject(absent ? new MissingLibrary() : Error('이 기기의 서재 저장소를 열 수 없습니다.')); };
    request.onblocked = () => { pending = null; reject(Error('다른 Folio 탭을 닫은 뒤 다시 시도해 주세요.')); };
  });
  return pending;
}
async function run<T>(store: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database(mode === 'readwrite');
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = operation(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(Error('서재 저장에 실패했습니다. 공간·개인정보 보호 설정을 확인해 주세요.'));
  });
}
export const novelCache = {
  async inspect() {
    let db: IDBDatabase;
    try { db = await database(); } catch (error) { if (error instanceof MissingLibrary) return inspectSavedNovels([], null); throw error; }
    if (!db.objectStoreNames.contains('novels')) throw Error('기존 저장소에 novels 스토어가 없습니다. 초기화하지 말고 원본 백업을 내려받아 주세요.');
    return new Promise<ReturnType<typeof inspectSavedNovels>>((resolve, reject) => {
      const tx = db.transaction('novels', 'readonly'), store = tx.objectStore('novels');
      const count = store.count(), records = store.getAll();
      tx.oncomplete = () => {
        const result = inspectSavedNovels(records.result, db.version);
        result.report.total = count.result;
        resolve(result);
      };
      tx.onerror = tx.onabort = () => reject(Error('저장된 책을 읽지 못했습니다. 브라우저 저장소 접근을 확인해 주세요.'));
    });
  },
  async list(): Promise<ImportedNovel[]> { return (await this.inspect()).novels; },
  async save(novel: ImportedNovel) { await this.saveAll([novel]); },
  async saveAll(novels: ImportedNovel[]) {
    if (!novels.length || !novels.every(validNovel)) throw Error('원문 데이터 형식이 올바르지 않습니다.');
    if (new Set(novels.map(novel => novel.id)).size !== novels.length) throw Error('중복된 화 식별자가 있습니다.');
    const db = await database(true);
    return new Promise<ImportedNovel[]>((resolve, reject) => {
      const tx = db.transaction('novels', 'readwrite'), store = tx.objectStore('novels');
      const saved: ImportedNovel[] = [];
      let problem = '파일을 저장하지 못했습니다. 저장 공간을 확인해 주세요.';
      novels.forEach((novel, index) => {
        const request = store.get(novel.id);
        request.onsuccess = () => {
          if (request.result !== undefined) {
            const existing = readSavedNovel(request.result);
            if (!existing || existing.chapterId !== novel.chapterId || libraryId(existing) !== libraryId(novel) || existing.paragraphs.length !== novel.paragraphs.length || existing.paragraphs.some((p, i) => p.id !== novel.paragraphs[i].id || p.text !== novel.paragraphs[i].text)) {
              problem = '같은 식별자의 기존 원문과 구조가 다릅니다. 기존 데이터를 덮어쓰지 않았습니다. 서재 원본 백업 후 확인해 주세요.';
              tx.abort(); return;
            }
            // Identical file: keep the original record, metadata and stable IDs.
            saved[index] = existing;
          } else { store.put(novel); saved[index] = novel; }
        };
      });
      tx.oncomplete = () => resolve(saved);
      tx.onerror = tx.onabort = () => reject(Error(problem));
    });
  },
  async backup() {
    let db: IDBDatabase;
    try { db = await database(); } catch (error) { if (error instanceof MissingLibrary) return {version: null, stores: {}}; throw error; }
    const names = Array.from(db.objectStoreNames);
    if (!names.length) return {version: db.version, stores: {}};
    return new Promise<{version: number | null; stores: Record<string, {keys: IDBValidKey[]; records: unknown[]}>}>((resolve, reject) => {
      const tx = db.transaction(names, 'readonly');
      const stores: Record<string, {keys: IDBValidKey[]; records: unknown[]}> = {};
      names.forEach(name => {
        const store = tx.objectStore(name), keys = store.getAllKeys(), records = store.getAll();
        records.onsuccess = () => { stores[name] = {keys: keys.result, records: records.result}; };
      });
      tx.oncomplete = () => resolve({version: db.version, stores});
      tx.onerror = tx.onabort = () => reject(Error('백업을 읽지 못했습니다. 기존 저장 데이터는 변경하지 않았습니다.'));
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
        removed = (request.result as ImportedNovel[]).filter((entry) => !!entry && libraryId(entry) === id);
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
