import type { Bookmark, ReaderSettings, ReadingProgress } from '../domain/models';
import type { ReaderStorage } from './contracts';

export const DEFAULT_SETTINGS: ReaderSettings = { theme: 'sepia', fontSize: 18, lineHeight: 1.9, contentWidth: 680, readingMode: 'scroll' };
const PREFIX = 'folio:v1:';
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const bounded = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function createLocalReaderStorage(getStorage: () => Storage = () => window.localStorage): ReaderStorage {
  function read(key: string): unknown {
    try { return JSON.parse(getStorage().getItem(PREFIX + key) ?? 'null'); } catch { return null; }
  }
  function write(key: string, value: unknown): boolean {
    try { getStorage().setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; }
  }
  return {
    getSettings() {
      const value = read('settings');
      if (!record(value)) return { ...DEFAULT_SETTINGS };
      return {
        theme: value.theme === 'light' || value.theme === 'dark' || value.theme === 'sepia' ? value.theme : 'sepia',
        fontSize: bounded(value.fontSize, 18, 14, 28),
        lineHeight: bounded(value.lineHeight, 1.9, 1.4, 2.6),
        contentWidth: bounded(value.contentWidth, 680, 480, 840),
        readingMode: value.readingMode === 'paged' ? 'paged' : 'scroll',
      };
    },
    saveSettings: (settings) => write('settings', settings),
    getProgress(bookId) {
      const value = read(`progress:${bookId}`);
      if (!record(value) || value.bookId !== bookId || typeof value.chapterId !== 'string' || typeof value.updatedAt !== 'string') return null;
      return {
        bookId, chapterId: value.chapterId,
        scrollY: bounded(value.scrollY, 0, 0, 10_000_000),
        paragraphId: typeof value.paragraphId === 'string' ? value.paragraphId : null,
        paragraphOffset: bounded(value.paragraphOffset, 0, -10_000, 10_000),
        characterOffset: Math.floor(bounded(value.characterOffset, 0, 0, 10_000_000)),
        readingMode: value.readingMode === 'paged' ? 'paged' : 'scroll',
        updatedAt: value.updatedAt,
        ...(typeof value.percent === 'number' ? { percent: bounded(value.percent, 0, 0, 100) } : {}),
        ...(value.atChapterEnd === true ? { atChapterEnd: true } : {}),
      } satisfies ReadingProgress;
    },
    saveProgress: (progress) => write(`progress:${progress.bookId}`, progress),
    getBookmarks(bookId) {
      const value = read(`bookmarks:${bookId}`);
      if (!Array.isArray(value)) return [];
      return value.filter((item): item is Bookmark => record(item) && item.bookId === bookId &&
        ['id', 'chapterId', 'paragraphId', 'excerpt', 'createdAt'].every((key) => typeof item[key] === 'string'));
    },
    saveBookmarks: (bookId, bookmarks) => write(`bookmarks:${bookId}`, bookmarks),
  };
}
