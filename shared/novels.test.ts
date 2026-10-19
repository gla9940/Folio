import { describe, expect, it } from 'vitest';
import { createNovel, makeBatches, translationKey, validateTranslation } from './novels';
const input = { url: 'https://witchculttranslation.com/2021/01/29/arc-7-chapter-2-animal-tracking/', title: 'Animal Tracking', arc: 7, chapter: 2, kind: 'manual' as const };
describe('novel identity and contextual batches', () => {
  it('keeps paragraph IDs stable across reload and an inserted preceding paragraph', async () => {
    const a = await createNovel({ ...input, texts: ['First.', 'Second.', 'First.'] });
    const b = await createNovel({ ...input, texts: ['Inserted.', 'First.', 'Second.', 'First.'] });
    expect(b.paragraphs.slice(1).map((p) => p.id)).toEqual(a.paragraphs.map((p) => p.id));
    expect(new Set(a.paragraphs.map((p) => p.id)).size).toBe(3);
    expect(a.source.hash).not.toBe(b.source.hash);
    expect(translationKey(a)).not.toBe(translationKey(b));
  });
  it('preserves every paragraph and its line breaks across context windows', async () => {
    const novel = await createNovel({ ...input, texts: Array.from({ length: 40 }, (_, i) => `Paragraph ${i}.\n` + 'A long passage. '.repeat(20)) });
    const batches = makeBatches(novel.paragraphs);
    expect(batches.flatMap((batch) => batch.paragraphs)).toEqual(novel.paragraphs);
    expect(batches[1].before).toEqual(batches[0].paragraphs.slice(-2));
    expect(batches[0].after).toEqual(batches[1].paragraphs.slice(0, 2));
  });
  it('rejects empty, oversized or invalid input before importing', async () => {
    await expect(createNovel({ ...input, texts: [] })).rejects.toMatchObject({ code: 'SOURCE_SIZE' });
    await expect(createNovel({ ...input, texts: ['x'.repeat(6001)] })).rejects.toMatchObject({ code: 'SOURCE_SIZE' });
    await expect(createNovel({ ...input, arc: 0, texts: ['Text'] })).rejects.toMatchObject({ code: 'SOURCE_METADATA' });
  });
  it('rejects missing, reordered, empty or line-breaking translation results', () => {
    const original = [{ id: 'one', text: 'First line.\nSecond line.' }, { id: 'two', text: 'Next.' }];
    const translated = [{ id: 'one', text: '첫 번째 줄.\n두 번째 줄.' }, { id: 'two', text: '다음.' }];
    expect(validateTranslation(original, translated)).toEqual(translated);
    for (const output of [translated.slice(1), [...translated].reverse(), [{ id: 'one', text: '한 줄로 합침.' }, translated[1]], [translated[0], { id: 'two', text: '' }]]) expect(() => validateTranslation(original, output)).toThrow();
  });
});
