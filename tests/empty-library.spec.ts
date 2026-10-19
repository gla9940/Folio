import { expect, test } from '@playwright/test';

for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} empty library preserves legacy records, supports management, upload and last-book deletion`, async ({page}) => {
  if (mobile) await page.setViewportSize({width: 390, height: 844});
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/empty-fixture.html', route => route.fulfill({contentType: 'text/html', body: '<!doctype html>'}));
  await page.goto('/empty-fixture.html');
  await page.evaluate(async () => {
    localStorage.setItem('folio:v1:settings', JSON.stringify({theme: 'dark', fontSize: 22, lineHeight: 2.2, contentWidth: 760, readingMode: 'paged'}));
    localStorage.setItem('folio:v1:progress:rezero-demo', '{"legacy":"keep"}');
    localStorage.setItem('folio:v1:bookmarks:rezero-demo', '[{"legacy":"keep"}]');
    await new Promise<void>(resolve => {
      const request = indexedDB.open('folio-library-v1', 1);
      request.onupgradeneeded = () => {for (const name of ['novels', 'preferences', 'translations']) request.result.createObjectStore(name, {keyPath: name === 'translations' ? 'key' : 'id'});};
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(['preferences', 'translations'], 'readwrite');
        tx.objectStore('preferences').put({id: 'selected', value: 'rezero-demo'});
        tx.objectStore('preferences').put({id: 'unrelated', value: {keep: true}});
        tx.objectStore('translations').put({key: 'unrelated', value: 'keep'});
        tx.oncomplete = () => {db.close(); resolve();};
      };
    });
  });
  const before = await page.evaluate(() => ({...localStorage}));
  await page.goto('/');
  await expect(page.getByRole('heading', {name: '등록된 책이 없습니다.', exact: true})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => ({...localStorage}))).toEqual(before);
  await expect(page.locator('.chapter-list, #library-selection, .reader-toolbar')).toHaveCount(0);
  await expect(page.getByText('샘플', {exact: false})).toHaveCount(0);
  await page.getByRole('button', {name: '서재 관리', exact: true}).click();
  await expect(page.getByRole('tab', {name: '내 서재', exact: true})).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.library-book-list > li')).toHaveCount(0);
  await page.getByRole('button', {name: '서재 관리 닫기'}).click();
  await page.screenshot({path: `test-results/empty-library-${mobile ? 'mobile' : 'desktop'}.png`});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const title of ['First upload', 'Second upload']) {
    await page.getByRole('button', {name: 'EPUB / TXT 파일 등록', exact: true}).click();
    await page.getByLabel('EPUB / TXT 파일').setInputFiles({name: `${title}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`Chapter 1: ${title}\n\n` + 'An isolated paragraph for the empty library test. '.repeat(30))});
    await page.getByRole('button', {name: '1개 화 서재에 등록'}).click();
    await expect(page.locator('.chapter-heading h1')).toHaveText(`Chapter 1: ${title}`);
    await expect(page.locator('.page-viewport')).toBeVisible();
    if (mobile) await page.getByRole('button', {name: '목차 열기', exact: true}).click();
    await page.getByRole('button', {name: '서재 관리', exact: true}).click();
    await page.locator('.library-book-row .icon-button').click();
    await page.getByRole('menuitem', {name: '책 삭제'}).click();
    await page.getByRole('button', {name: '삭제 확인'}).click();
    await expect(page.locator('.library-book-list > li')).toHaveCount(0);
    await page.getByRole('button', {name: '서재 관리 닫기'}).click();
    await expect(page.getByRole('heading', {name: '등록된 책이 없습니다.', exact: true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', {name: '등록된 책이 없습니다.', exact: true})).toBeVisible();
  }
  expect(await page.evaluate(() => ({...localStorage}))).toEqual(before);
  const stored = await page.evaluate(async () => new Promise<{version: number; novels: unknown[]; cache: unknown; pref: unknown}>(resolve => {
    const request = indexedDB.open('folio-library-v1'); request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['novels', 'preferences', 'translations']);
      const novels = tx.objectStore('novels').getAll(), cache = tx.objectStore('translations').get('unrelated'), pref = tx.objectStore('preferences').get('unrelated');
      tx.oncomplete = () => {resolve({version: db.version, novels: novels.result, cache: cache.result, pref: pref.result}); db.close();};
    };
  }));
  expect(stored).toEqual({version: 1, novels: [], cache: {key: 'unrelated', value: 'keep'}, pref: {id: 'unrelated', value: {keep: true}}});
  expect(errors).toEqual([]);
});
