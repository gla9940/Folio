import { describe, expect, it } from 'vitest';
import { createNovel } from './novels';
const input = { url: 'https://witchculttranslation.com/2021/01/29/arc-7-chapter-2-animal-tracking/', title: 'Animal Tracking', arc: 7, chapter: 2, kind: 'manual' as const };
describe('novel source identity', () => {
  it('keeps paragraph IDs stable across reload and an inserted preceding paragraph', async () => {
    const a = await createNovel({ ...input, texts: ['First.', 'Second.', 'First.'] });
    const b = await createNovel({ ...input, texts: ['Inserted.', 'First.', 'Second.', 'First.'] });
    expect(b.paragraphs.slice(1).map((p) => p.id)).toEqual(a.paragraphs.map((p) => p.id));
    expect(new Set(a.paragraphs.map((p) => p.id)).size).toBe(3);
    expect(a.source.hash).not.toBe(b.source.hash);
  });
  it('preserves source paragraph line breaks', async () => {
    const novel = await createNovel({ ...input, texts: Array.from({ length: 40 }, (_, i) => `Paragraph ${i}.\n` + 'A long passage. '.repeat(20)) });
    expect(novel.paragraphs).toHaveLength(40);
    expect(novel.paragraphs.every((p) => p.text.includes('\n'))).toBe(true);
  });
  it('rejects empty, oversized or invalid input before importing', async () => {
    await expect(createNovel({ ...input, texts: [] })).rejects.toMatchObject({ code: 'SOURCE_SIZE' });
    await expect(createNovel({ ...input, texts: ['x'.repeat(6001)] })).rejects.toMatchObject({ code: 'SOURCE_SIZE' });
    await expect(createNovel({ ...input, arc: 0, texts: ['Text'] })).rejects.toMatchObject({ code: 'SOURCE_METADATA' });
  });
});
