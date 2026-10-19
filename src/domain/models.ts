export type Theme = 'sepia' | 'light' | 'dark';
export type ReadingMode = 'scroll' | 'paged';

export interface ReadingAnchor {
  paragraphId: string | null;
  characterOffset: number;
  atChapterEnd?: boolean;
}

export interface ReaderSettings {
  theme: Theme;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  readingMode: ReadingMode;
}

export interface Paragraph { id: string; text: string }
export interface Chapter {
  id: string;
  arcId: string;
  number: number;
  title: string;
  paragraphs: Paragraph[];
}
export interface Arc { id: string; title: string; subtitle: string }
export interface Book {
  id: string;
  title: string;
  subtitle: string;
  author: string;
  arcs: Arc[];
  chapters: Chapter[];
}
export interface ReadingProgress {
  bookId: string;
  chapterId: string;
  scrollY: number;
  paragraphId: string | null;
  paragraphOffset: number;
  characterOffset?: number;
  readingMode?: ReadingMode;
  atChapterEnd?: boolean;
  updatedAt: string;
}
export interface Bookmark {
  id: string;
  bookId: string;
  chapterId: string;
  paragraphId: string;
  excerpt: string;
  createdAt: string;
}
