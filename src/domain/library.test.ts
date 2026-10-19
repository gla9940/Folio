import { describe, expect, it } from 'vitest';
import { bookProgress } from './library';
import type { ImportedNovel } from '../../shared/novels';
import type { ReadingProgress } from './models';
const members = [0, 1].map(index => ({ chapterId: `c${index}`, paragraphs: [{id: `p${index}a`, text: '12345'}, {id: `p${index}b`, text: '67890'}] } as ImportedNovel));
const progress = {bookId: 'book', chapterId: 'c1', paragraphId: 'p1b', characterOffset: 0} as ReadingProgress;
describe('whole book progress', () => {
  it('derives legacy progress from the stable paragraph without rewriting it', () => {
    const before = structuredClone(progress);
    expect(bookProgress(members, progress)).toBe(75);
    expect(progress).toEqual(before);
    expect(bookProgress(members, {...progress, characterOffset: 5})).toBe(100);
  });
  it('weights chapters by source length and honors page completion', () => {
    const unequal = [members[0], {...members[1], paragraphs: [{id: 'long', text: 'x'.repeat(30)}]}];
    expect(bookProgress(unequal, {...progress, percent: 50})).toBe(63);
    expect(bookProgress(unequal, {...progress, atChapterEnd: true})).toBe(100);
  });
  it('handles unread, missing chapters and out of range positions', () => {
    expect(bookProgress(members, null)).toBe(0);
    expect(bookProgress(members, {...progress, chapterId: 'missing'})).toBe(0);
    expect(bookProgress(members, {...progress, percent: 999})).toBe(100);
  });
});
