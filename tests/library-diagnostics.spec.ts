import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createNovel, sha256 } from '../shared/novels';

async function seed(page: Page, mode: 'excluded' | 'compatible' | 'no-preferences' | 'no-novels') {
  const hash = await sha256('legacy-epub-file');
  const novel = {...await createNovel({url: `folio-file:${hash}#chapter1`, title: 'Existing Volume 26', arc: 7, chapter: 1, kind: 'epub', texts: Array.from({length: 24}, (_, i) => `Original paragraph ${i}. ` + 'The traveler followed the river. '.repeat(6))}), collection: {id: `file-${hash}`, title: 'Saved Volume 26', author: 'Test', order: 0}};
  const broken = {...novel, id: 'broken-original', chapterId: 'broken-chapter', paragraphs: [{text: 'Unidentified original text must remain intact.'}]};
  const compatible = {...novel, source: {...novel.source, kind: undefined, hash: undefined, arc: '7', chapter: '1'}, collection: {...novel.collection, order: '0'}};
  const records = mode === 'excluded' ? [broken] : mode === 'compatible' ? [compatible, broken] : [novel];
  await page.route('**/diagnostic-fixture.html', route => route.fulfill({contentType: 'text/html', body: '<!doctype html>'}));
  await page.goto('/diagnostic-fixture.html');
  await page.evaluate(async ({records, novel, mode}) => {
    await new Promise<void>(resolve => {
      const request = indexedDB.open('folio-library-v1', 1);
      request.onupgradeneeded = () => {
        const names = mode === 'no-preferences' ? ['novels', 'translations'] : mode === 'no-novels' ? ['preferences', 'translations'] : ['novels', 'preferences', 'translations'];
        names.forEach(name => request.result.createObjectStore(name, {keyPath: name === 'translations' ? 'key' : 'id'}));
      };
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(Array.from(db.objectStoreNames), 'readwrite');
        if (mode !== 'no-novels') records.forEach(record => tx.objectStore('novels').put(record));
        tx.objectStore('translations').put({key: 'untouched', text: 'Existing cache'});
        if (mode !== 'no-preferences') tx.objectStore('preferences').put({id: 'selected', value: novel.id});
        tx.oncomplete = () => {db.close(); resolve();};
      };
    });
    localStorage.setItem('folio:v1:settings', JSON.stringify({theme: 'dark', fontSize: 18, lineHeight: 1.9, contentWidth: 680, readingMode: 'scroll'}));
    localStorage.setItem(`folio:v1:bookmarks:${novel.collection.id}`, JSON.stringify([{id: 'existing', bookId: novel.collection.id, chapterId: novel.chapterId, paragraphId: novel.paragraphs[2].id, excerpt: 'Saved bookmark', createdAt: '2026-10-19'}]));
  }, {records, novel, mode});
  return {novel, records};
}
async function stored(page: Page) {
  return page.evaluate(async () => new Promise(resolve => {
    const request = indexedDB.open('folio-library-v1'); request.onsuccess = () => {
      const db = request.result, names = Array.from(db.objectStoreNames), tx = db.transaction(names, 'readonly');
      const stores: Record<string, unknown[]> = {};
      names.forEach(name => {const req = tx.objectStore(name).getAll(); req.onsuccess = () => {stores[name] = req.result;};});
      tx.oncomplete = () => {resolve({version: db.version, names, stores}); db.close();};
    };
  }));
}
const count = (page: Page, label: string) => page.locator('.library-diagnostic-counts > div').filter({has: page.getByText(label, {exact: true})}).locator('dd');

for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} excluded records are not called empty, diagnosis and backup are read only`, async ({page}) => {
  if (mobile) await page.setViewportSize({width: 390, height: 844});
  await seed(page, 'excluded'); const before = await stored(page), local = await page.evaluate(() => ({...localStorage}));
  await page.addInitScript(() => {
    const modes: string[] = []; (window as unknown as {diagnosticModes: string[]}).diagnosticModes = modes;
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(...args: Parameters<IDBDatabase['transaction']>) {modes.push(args[1] ?? 'readonly'); return original.apply(this, args);};
  });
  await page.goto('/');
  await expect(page.getByRole('heading', {name: '저장된 서재를 확인해 주세요.'})).toBeVisible();
  await expect(page.getByRole('heading', {name: '등록된 책이 없습니다.', exact: true})).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('데이터가 없는 상태가 아닙니다');
  await page.getByText('서재 저장소 진단', {exact: true}).click();
  await expect(count(page, '원본 novels 저장 건수')).toHaveText('1건');
  await expect(count(page, '유효성 검사 통과')).toHaveText('0건');
  await expect(count(page, '표시 제외')).toHaveText('1건');
  await expect(page.locator('.diagnostic-reasons')).toContainText('문단 식별자·본문 구조');
  await expect(page.locator('.diagnostic-reasons')).not.toContainText('Unidentified original');
  await page.getByRole('button', {name: '다시 확인', exact: true}).click();
  await expect(page.getByRole('button', {name: '서재 원본 백업'})).toBeEnabled();
  const download = page.waitForEvent('download'); await page.getByRole('button', {name: '서재 원본 백업'}).click();
  const file = await download, path = await file.path(); const backup = JSON.parse(await readFile(path!, 'utf8'));
  expect(backup.database.stores.novels.records).toEqual((before as {stores: {novels: unknown[]}}).stores.novels);
  expect(backup.localStorage).toEqual(local);
  expect(await stored(page)).toEqual(before); expect(await page.evaluate(() => ({...localStorage}))).toEqual(local);
  expect(await page.evaluate(() => (window as unknown as {diagnosticModes: string[]}).diagnosticModes.every(mode => mode === 'readonly'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: `test-results/diagnostics-${mobile ? 'mobile' : 'desktop'}.png`});
});

test('compatible metadata is read without migrating EPUB records, changing IDs or losing bookmarks', async ({page}) => {
  const {novel} = await seed(page, 'compatible'); const before = await stored(page);
  await page.goto('/'); await expect(page.locator('.chapter-heading h1')).toHaveText(novel.title);
  await expect(page.getByRole('tab', {name: '북마크 1'})).toBeVisible();
  await expect(page.locator('[data-paragraph]').first()).toHaveAttribute('id', novel.paragraphs[0].id);
  await page.getByRole('button', {name: '서재 관리', exact: true}).click();
  await page.getByText('서재 저장소 진단', {exact: true}).click();
  await expect(count(page, '원본 novels 저장 건수')).toHaveText('2건');
  await expect(count(page, '유효성 검사 통과')).toHaveText('0건');
  await expect(count(page, '메모리 호환 표시')).toHaveText('1건');
  await expect(count(page, '표시 제외')).toHaveText('1건');
  expect(await stored(page)).toEqual(before);
});

test('a missing preferences store cannot hide readable EPUB records or recreate stores', async ({page}) => {
  const {novel} = await seed(page, 'no-preferences'); const before = await stored(page);
  await page.goto('/'); await expect(page.locator('.chapter-heading h1')).toHaveText(novel.title);
  await expect(page.getByRole('alert')).toContainText('일부 서재 설정');
  expect(await stored(page)).toEqual(before);
});

test('a missing novels store is a read error, not a zero count, and can be backed up without schema changes', async ({page}) => {
  await seed(page, 'no-novels'); const before = await stored(page);
  await page.goto('/'); await expect(page.getByRole('heading', {name: '저장된 서재를 확인해 주세요.'})).toBeVisible();
  await page.getByText('서재 저장소 진단', {exact: true}).click();
  await expect(page.getByText('접근 실패를 0건으로 판단하지 않습니다.', {exact: false})).toBeVisible();
  await expect(page.locator('.library-diagnostic-counts')).toHaveCount(0);
  expect(await stored(page)).toEqual(before);
});

test('a truly absent database reports zero with origin guidance and diagnosis does not create it', async ({page}) => {
  await page.goto('/'); await expect(page.getByRole('heading', {name: '등록된 책이 없습니다.', exact: true})).toBeVisible();
  await expect(page.locator('.library-diagnostics details')).not.toHaveAttribute('open', '');
  await page.getByText('서재 저장소 진단', {exact: true}).click();
  await expect(count(page, '원본 novels 저장 건수')).toHaveText('0건');
  await expect(page.getByText('다른 브라우저·프로필·기기·접속 주소의 데이터는 자동 복구할 수 없습니다.', {exact: false})).toBeVisible();
  await page.getByRole('button', {name: '다시 확인', exact: true}).click();
  await expect(page.getByRole('button', {name: '다시 확인', exact: true})).toBeEnabled();
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
});

test('failed diagnostic refresh does not present stale counts as a successful zero result', async ({page}) => {
  await seed(page, 'excluded'); await page.goto('/');
  await page.getByText('서재 저장소 진단', {exact: true}).click();
  await expect(count(page, '원본 novels 저장 건수')).toHaveText('1건');
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(...args: Parameters<IDBDatabase['transaction']>) {
      if (args[0] === 'novels' && args[1] === 'readonly') throw new DOMException('Temporarily unavailable', 'InvalidStateError');
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', {name: '다시 확인', exact: true}).click();
  await expect(page.locator('.library-diagnostic-counts')).toHaveCount(0);
  await expect(page.getByText('접근 실패를 0건으로 판단하지 않습니다.', {exact: false})).toBeVisible();
});
