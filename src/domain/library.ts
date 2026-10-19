import type { ImportedNovel } from '../../shared/novels';
import type { ReadingProgress } from './models';

export const libraryId = (entry: ImportedNovel) => entry.collection?.id ?? entry.id;
export const libraryTitle = (entry: ImportedNovel) => entry.collection?.title ?? entry.title;
export function bookProgress(members: ImportedNovel[], progress: ReadingProgress | null) {
  if (!progress) return 0;
  const lengths = members.map((entry) => entry.paragraphs.reduce((sum, p) => sum + p.text.length, 0));
  const index = members.findIndex((entry) => entry.chapterId === progress.chapterId);
  if (index < 0) return 0;
  const paragraphs = members[index].paragraphs;
  const paragraphIndex = paragraphs.findIndex((p) => p.id === progress.paragraphId);
  const offset = paragraphIndex < 0 ? 0 : paragraphs.slice(0, paragraphIndex).reduce((sum, p) => sum + p.text.length, 0) + Math.min(paragraphs[paragraphIndex].text.length, progress.characterOffset ?? 0);
  const fraction = progress.atChapterEnd ? 1 : typeof progress.percent === 'number' ? progress.percent / 100 : offset / Math.max(1, lengths[index]);
  return Math.max(0, Math.min(100, Math.round((lengths.slice(0, index).reduce((sum, n) => sum + n, 0) + lengths[index] * fraction) / Math.max(1, lengths.reduce((sum, n) => sum + n, 0)) * 100)));
}
