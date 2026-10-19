import { describe, expect, it } from 'vitest';
import { createLocalReaderStorage, DEFAULT_SETTINGS } from './localReaderStorage';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(), key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } satisfies Storage;
}

describe('local reader storage', () => {
  it('returns safe defaults for invalid JSON and clamps stored settings', () => {
    const memory = memoryStorage();
    const storage = createLocalReaderStorage(() => memory);
    memory.setItem('folio:v1:settings', '{broken');
    expect(storage.getSettings()).toEqual(DEFAULT_SETTINGS);
    memory.setItem('folio:v1:settings', JSON.stringify({ theme: 'unknown', fontSize: 1000, lineHeight: -4, contentWidth: 'wide' }));
    expect(storage.getSettings()).toEqual({ theme: 'sepia', fontSize: 28, lineHeight: 1.4, contentWidth: 680, readingMode: 'scroll' });
  });

  it('persists independent book positions and paragraph anchors', () => {
    const memory = memoryStorage();
    const storage = createLocalReaderStorage(() => memory);
    const progress = { bookId: 'book-1', chapterId: 'chapter-2', scrollY: 820, paragraphId: 'p8', paragraphOffset: -12, updatedAt: '2026-10-19T00:00:00Z' };
    expect(storage.saveProgress(progress)).toBe(true);
    expect(storage.getProgress('book-1')).toEqual({ ...progress, characterOffset: 0, readingMode: 'scroll' });
    expect(storage.getProgress('book-2')).toBeNull();
  });

  it('rejects malformed bookmarks and preserves valid bookmarks', () => {
    const memory = memoryStorage();
    const storage = createLocalReaderStorage(() => memory);
    const bookmark = { id: 'b1', bookId: 'book', chapterId: 'c1', paragraphId: 'p1', excerpt: '문장', createdAt: 'today' };
    memory.setItem('folio:v1:bookmarks:book', JSON.stringify([null, 'invalid', { id: 3 }, { ...bookmark, bookId: 'other' }, bookmark]));
    expect(storage.getBookmarks('book')).toEqual([bookmark]);
    expect(storage.saveBookmarks('book', [])).toBe(true);
    expect(storage.getBookmarks('book')).toEqual([]);
  });

  it('migrates previous settings and stores page anchors without page-number dependence', () => {
    const memory = memoryStorage();
    const storage = createLocalReaderStorage(() => memory);
    memory.setItem('folio:v1:settings', JSON.stringify({ theme: 'dark', fontSize: 20, lineHeight: 2, contentWidth: 600 }));
    expect(storage.getSettings()).toEqual({ theme: 'dark', fontSize: 20, lineHeight: 2, contentWidth: 600, readingMode: 'scroll' });
    const progress = { bookId: 'book', chapterId: 'c1', paragraphId: 'p8', characterOffset: 53, scrollY: 0, paragraphOffset: 120, readingMode: 'paged' as const, atChapterEnd: true, updatedAt: '2026-10-19' };
    storage.saveProgress(progress);
    expect(storage.getProgress('book')).toEqual(progress);
    storage.saveSettings({ ...DEFAULT_SETTINGS, readingMode: 'paged' });
    expect(storage.getSettings().readingMode).toBe('paged');
  });

  it('normalizes invalid reading modes and character offsets', () => {
    const memory = memoryStorage();
    const storage = createLocalReaderStorage(() => memory);
    memory.setItem('folio:v1:progress:book', JSON.stringify({ bookId: 'book', chapterId: 'c1', characterOffset: -100, readingMode: 'unknown', updatedAt: 'today' }));
    expect(storage.getProgress('book')).toMatchObject({ characterOffset: 0, readingMode: 'scroll' });
  });

  it('keeps the reader usable when browser storage is blocked or full', () => {
    const storage = createLocalReaderStorage(() => { throw new Error('SecurityError'); });
    expect(storage.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(storage.getProgress('book')).toBeNull();
    expect(storage.getBookmarks('book')).toEqual([]);
    expect(storage.saveSettings(DEFAULT_SETTINGS)).toBe(false);
    expect(storage.saveBookmarks('book', [])).toBe(false);
  });
});
