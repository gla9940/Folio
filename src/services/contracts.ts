import type { Book, Bookmark, ReaderSettings, ReadingProgress } from '../domain/models';
import type { SourceParagraph, TranslationRequest } from '../../shared/novels';

// UI는 이 경계에만 의존합니다. 이후 원격 저장소로 교체할 수 있습니다.
export interface BookRepository { getBook(bookId: string): Promise<Book> }
export interface ReaderStorage {
  getSettings(): ReaderSettings;
  saveSettings(settings: ReaderSettings): boolean;
  getProgress(bookId: string): ReadingProgress | null;
  saveProgress(progress: ReadingProgress): boolean;
  getBookmarks(bookId: string): Bookmark[];
  saveBookmarks(bookId: string, bookmarks: Bookmark[]): boolean;
}
export interface TranslationProvider {
  translateParagraph(text: string, sourceLanguage: string, targetLanguage: string): Promise<string>;
  translateBatch(batch: TranslationRequest, signal?: AbortSignal): Promise<{ paragraphs: SourceParagraph[]; model: string; nextRequestAfterMs: number }>;
}
