import { describe, expect, it } from 'vitest';
import { createNovel, sha256 } from '../../shared/novels';
import { inspectSavedNovels, readSavedNovel } from './savedNovel';

async function original() {
  const hash = await sha256('epub-bytes');
  return {...await createNovel({url: `folio-file:${hash}#first`, title: 'Saved EPUB', kind: 'epub', arc: 7, chapter: 1, texts: ['A saved paragraph.', 'Another paragraph.']}), collection: {id: `file-${hash}`, title: 'Volume 26', author: 'Test', order: 0}};
}
describe('read-only saved novel compatibility', () => {
  it('separates stored, strict valid, compatible and excluded counts without changing original data', async () => {
    const current = await original();
    const older = {...current, id: 'older', source: {...current.source, kind: undefined, hash: undefined, arc: '7', chapter: '1'}, collection: {...current.collection, order: '0'}};
    const broken = {...current, id: 'broken', paragraphs: [{text: 'An original without its ID'}]};
    const raw = [current, older, broken], before = structuredClone(raw);
    const {report, novels} = inspectSavedNovels(raw, 1);
    expect(report).toMatchObject({total: 3, valid: 1, compatible: 1, excluded: 1, database: 'present', version: 1});
    expect(report.reasons['문단 식별자·본문 구조']).toBe(1);
    expect(novels[1].paragraphs).toEqual(current.paragraphs);
    expect(novels[1].collection?.id).toBe(current.collection.id);
    expect(novels[1].source.arc).toBe(7);
    expect(raw).toEqual(before);
  });
  it('does not invent IDs, regroup incomplete books, or silently accept duplicate paragraphs', async () => {
    const current = await original();
    expect(readSavedNovel({...current, chapterId: undefined})).toBeNull();
    expect(readSavedNovel({...current, collection: {...current.collection, id: undefined}})).toBeNull();
    expect(readSavedNovel({...current, paragraphs: [current.paragraphs[0], current.paragraphs[0]]})).toBeNull();
    expect(inspectSavedNovels([], null).report).toMatchObject({database: 'absent', total: 0, valid: 0, excluded: 0});
  });
});
