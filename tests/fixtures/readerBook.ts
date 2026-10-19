import type { Page } from '@playwright/test';
import type { Book } from '../../src/domain/models';
import { createNovel, sha256 } from '../../shared/novels';

// Synthetic data is installed only into isolated test profiles, never shipped by Vite.
export const readerBook: Book = {
  id: 'test-reader', title: '테스트 독서 파일', author: 'Folio Tester', subtitle: '독서 기능 검증',
  arcs: [{id: 'arc-1', title: '전체 목차', subtitle: '테스트 독서 파일'}],
  chapters: Array.from({length: 6}, (_, index) => ({
    id: `chapter-${index + 1}`, arcId: 'arc-1', number: index + 1, title: `독서 검증 ${index + 1}`,
    paragraphs: Array.from({length: 16}, (_, paragraph) => ({id: `c${index + 1}-p${paragraph + 1}`, text: `${paragraph + 1}번째 문단. ` + '조용한 도서관에서 창문을 열고 책을 읽었다. 문장의 길이가 달라도 읽던 위치와 페이지 조판은 유지되어야 한다. '.repeat(paragraph === 0 ? 2 : 5)})),
  })),
};
export async function seedReader(page: Page) {
  const hash = await sha256('isolated-reader-fixture');
  const entries = await Promise.all(readerBook.chapters.map(async (chapter, order) => ({
    ...await createNovel({url: `folio-file:${hash}#chapter-${order}`, title: chapter.title, arc: 1, chapter: chapter.number, kind: 'txt', texts: chapter.paragraphs.map(p => p.text)}),
    chapterId: chapter.id, paragraphs: chapter.paragraphs,
    collection: {id: readerBook.id, title: readerBook.title, author: readerBook.author, order},
  })));
  await page.route('**/test-reader-fixture.html', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Isolated reader fixture</title>'}));
  await page.goto('/test-reader-fixture.html');
  await page.evaluate(async entries => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('folio-library-v1', 1);
    request.onupgradeneeded = () => {
      for (const name of ['novels', 'preferences', 'translations']) request.result.createObjectStore(name, {keyPath: name === 'translations' ? 'key' : 'id'});
    };
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['novels', 'preferences'], 'readwrite');
      entries.forEach(entry => tx.objectStore('novels').put(entry));
      tx.objectStore('preferences').put({id: 'selected', value: entries[0].id});
      tx.oncomplete = () => {db.close(); resolve();}; tx.onerror = () => reject(tx.error);
    };
  }), entries);
  await page.goto('/');
}
