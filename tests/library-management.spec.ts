import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createNovel, sha256 } from '../shared/novels';

async function seed(page: Page) {
  const entries = [];
  for (let book = 0; book < 3; book++) {
    const hash = await sha256(`management-${book}`);
    for (let chapter = 0; chapter < 2; chapter++) {
      const entry = await createNovel({ url: `folio-file:${hash}#chapter-${chapter}`, title: `Book ${book} Chapter ${chapter}`, arc: 1, chapter: chapter + 1, kind: 'epub', texts: Array.from({length: 40}, (_, i) => `Paragraph ${i}. ` + 'The traveler remembered a quiet morning beside the river. '.repeat(4)) });
      entry.source.importedAt = `2026-10-${10 + book}T00:00:00Z`;
      entries.push({ ...entry, collection: { id: `book-${book}`, title: ['Beta', 'Alpha', 'Gamma'][book], order: chapter, author: 'Test' } });
    }
  }
  await page.route('**/seed.html', route => route.fulfill({contentType: 'text/html', body: '<!doctype html>'}));
  await page.goto('/seed.html');
  await page.evaluate(async (entries) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('folio-library-v1', 1);
      request.onupgradeneeded = () => { for (const store of ['novels', 'translations', 'preferences']) request.result.createObjectStore(store, {keyPath: store === 'translations' ? 'key' : 'id'}); };
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(['novels', 'translations', 'preferences'], 'readwrite');
        for (const entry of entries) {
          tx.objectStore('novels').put(entry);
          tx.objectStore('translations').put({key: `legacy-${entry.id}`, novelId: entry.id, chapterId: entry.chapterId, data: 'keep'});
        }
        tx.objectStore('translations').put({ key: 'unrelated', data: 'preserve unknown owner' });
        tx.objectStore('preferences').put({id: 'selected', value: entries[0].id});
        tx.objectStore('preferences').put({id: 'read-chapters', value: Object.fromEntries(entries.map(entry => [`${entry.id}:${entry.source.hash}`, true]))});
        tx.objectStore('preferences').put({id: 'languages', value: Object.fromEntries(entries.map(entry => [entry.id, 'ko']))});
        tx.objectStore('preferences').put({id: 'unrelated', value: {keep: true}});
        tx.oncomplete = () => {db.close(); resolve();}; tx.onerror = () => reject(tx.error);
      };
    });
    localStorage.setItem('folio:v1:settings', JSON.stringify({theme: 'dark', fontSize: 18, lineHeight: 1.9, contentWidth: 680, readingMode: 'paged'}));
    for (let book = 0; book < 3; book++) {
      const entry = entries[book * 2 + 1], bookId = `book-${book}`;
      localStorage.setItem(`folio:v1:progress:${bookId}`, JSON.stringify({bookId, chapterId: entry.chapterId, paragraphId: entry.paragraphs[20].id, characterOffset: 0, paragraphOffset: 120, scrollY: 0, updatedAt: `2026-10-${15 + book}T00:00:00Z`, readingMode: 'paged', percent: 50}));
      localStorage.setItem(`folio:v1:bookmarks:${bookId}`, JSON.stringify([{bookId, id: 'bookmark', chapterId: entry.chapterId, paragraphId: entry.paragraphs[0].id, excerpt: 'keep', createdAt: '2026-10-19'}]));
    }
    localStorage.setItem('folio:v1:progress:book-0-extra', 'do not remove a similar key');
  }, entries);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.chapter-heading h1')).toHaveText(entries[1].title);
  await expect(page.locator('.page-count')).not.toHaveText('1 / 1');
  return {entries, errors};
}
async function open(page: Page, mobile = false) {
  if (mobile) await page.getByRole('button', {name: '목차 열기', exact: true}).click();
  await page.getByRole('button', {name: '서재 관리', exact: true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const local = {...localStorage};
    const data = await new Promise<Record<string, unknown[]>>(resolve => {
      const request = indexedDB.open('folio-library-v1');
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(['novels', 'translations', 'preferences']);
        const result: Record<string, unknown[]> = {};
        for (const name of ['novels', 'translations', 'preferences']) { const req = tx.objectStore(name).getAll(); req.onsuccess = () => {result[name] = req.result;}; }
        tx.oncomplete = () => {db.close(); resolve(result);};
      };
    });
    return {local, ...data};
  });
}

test('desktop search, all sorts, rename persistence and resume preserve originals and other book records', async ({page}) => {
  const {entries, errors} = await seed(page); await open(page);
  const before = await snapshot(page);
  const rows = page.locator('.library-book-open strong');
  await expect(rows).toHaveText(['Beta', 'Gamma', 'Alpha']);
  await expect(page.getByRole('progressbar', {name: 'Alpha 읽기 진행률'})).toHaveAttribute('aria-valuenow', '75');
  await page.getByLabel('서재 정렬', {exact: true}).selectOption('title');
  await expect(rows).toHaveText(['Alpha', 'Beta', 'Gamma']);
  await page.getByLabel('서재 정렬', {exact: true}).selectOption('registered');
  await expect(rows).toHaveText(['Gamma', 'Alpha', 'Beta']);
  await page.getByRole('searchbox', {name: '서재 검색'}).fill('ALPHA');
  await expect(rows).toHaveText(['Alpha']);
  await page.getByRole('button', {name: 'Alpha 관리', exact: true}).click();
  await page.getByRole('menuitem', {name: '제목 수정'}).click();
  await page.getByRole('textbox', {name: '책 제목', exact: true}).fill('Renamed Book');
  await page.getByRole('button', {name: '제목 저장'}).click();
  await page.getByRole('searchbox').fill('');
  await expect(rows).toContainText(['Renamed Book']);
  const after = await snapshot(page);
  expect(after.novels).toEqual(before.novels); expect(after.translations).toEqual(before.translations); expect(after.local).toEqual(before.local);
  await page.getByRole('button', {name: '서재 관리 닫기'}).click();
  await page.reload(); await open(page);
  await expect(rows).toContainText(['Renamed Book']);
  await page.locator('[data-book-id="book-1"] .library-book-open').click();
  await expect(page.locator('.chapter-heading h1')).toHaveText(entries[3].title);
  await open(page);
  await expect(page.getByRole('region', {name: '이어서 읽기'})).toContainText('Renamed Book');
  await page.getByRole('region', {name: '이어서 읽기'}).getByRole('button').click();
  await expect(page.locator('.chapter-heading h1')).toHaveText(entries[3].title);
  expect(errors).toEqual([]);
});

for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} cancel and confirm active book deletion remove only the exact book`, async ({page}) => {
  if (mobile) await page.setViewportSize({width: 390, height: 844});
  const {entries, errors} = await seed(page); await open(page, mobile);
  const before = await snapshot(page);
  await page.getByRole('button', {name: 'Beta 관리', exact: true}).click();
  await page.getByRole('menuitem', {name: '책 삭제'}).click();
  await expect(page.getByRole('alertdialog')).toContainText('2개 화');
  await page.getByRole('button', {name: '취소', exact: true}).click();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', {name: 'Beta 관리', exact: true}).click();
  await page.getByRole('menuitem', {name: '책 삭제'}).click();
  await page.getByRole('button', {name: '삭제 확인'}).click();
  await expect(page.locator('.library-book-open strong')).toHaveText(['Gamma', 'Alpha']);
  const after = await snapshot(page);
  expect(after.novels).toEqual(expect.arrayContaining(entries.slice(2))); expect(after.novels).toHaveLength(4);
  expect(after.translations).toEqual((before.translations as {novelId?: string}[]).filter(item => !entries.slice(0,2).some(e => e.id === item.novelId)));
  for (const [key, value] of Object.entries(before.local)) if (!['folio:v1:progress:book-0', 'folio:v1:bookmarks:book-0'].includes(key)) expect(after.local[key]).toBe(value);
  expect(after.local['folio:v1:progress:book-0']).toBeUndefined(); expect(after.local['folio:v1:bookmarks:book-0']).toBeUndefined();
  const prefs = after.preferences as {id: string; value: unknown}[];
  for (const id of ['read-chapters', 'languages']) {
    const value = prefs.find(p => p.id === id)!.value as Record<string, unknown>;
    expect(Object.keys(value)).toHaveLength(4);
    expect(value).toEqual(Object.fromEntries(Object.entries((before.preferences as {id: string; value: Record<string, unknown>}[]).find(p => p.id === id)!.value).filter(([key]) => !entries.slice(0, 2).some(e => key === e.id || key.startsWith(`${e.id}:`)))));
    expect(Object.keys(value).some(key => entries.slice(0,2).some(e => key.startsWith(e.id)))).toBe(false);
  }
  expect(prefs.find(p => p.id === 'unrelated')).toEqual({id: 'unrelated', value: {keep: true}});
  await page.screenshot({path: `test-results/library-${mobile ? 'mobile' : 'desktop'}.png`});
  expect(await page.locator('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByRole('button', {name: '서재 관리 닫기'}).click();
  await page.reload(); await open(page, mobile);
  await expect(page.locator('.library-book-open strong')).toHaveCount(2);
  expect((await snapshot(page)).local['folio:v1:progress:book-0']).toBeUndefined();
  expect(errors).toEqual([]);
});

test('active title edit keeps reading anchor and bookmarks, and cancel never writes a title', async ({page}) => {
  await seed(page); await open(page);
  const before = await snapshot(page);
  await page.getByRole('button', {name: 'Beta 관리', exact: true}).click();
  await page.getByRole('menuitem', {name: '제목 수정'}).click();
  await page.getByRole('textbox', {name: '책 제목', exact: true}).fill('Cancelled');
  await page.getByRole('button', {name: '취소', exact: true}).click();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', {name: 'Beta 관리', exact: true}).click();
  await page.getByRole('menuitem', {name: '제목 수정'}).click();
  await page.getByRole('textbox', {name: '책 제목', exact: true}).fill('   ');
  await expect(page.getByRole('button', {name: '제목 저장'})).toBeDisabled();
  await page.getByRole('textbox', {name: '책 제목', exact: true}).fill('New Active Title');
  await page.getByRole('button', {name: '제목 저장'}).click();
  const after = await snapshot(page);
  expect(after.local).toEqual(before.local); expect(after.novels).toEqual(before.novels);
  await page.getByRole('button', {name: '서재 관리 닫기'}).click();
  await expect(page.locator('.topbar-book')).toContainText('New Active Title');
  await page.getByRole('button', {name: '다음 페이지', exact: true}).click();
  const anchor = (raw: string) => { const p = JSON.parse(raw); return `${p.paragraphId}:${p.characterOffset}`; };
  await expect.poll(async () => anchor((await snapshot(page)).local['folio:v1:progress:book-0'])).not.toBe(anchor(before.local['folio:v1:progress:book-0']));
});

test('deleting the final imported book returns to the preserved sample and supports new TXT import', async ({page}) => {
  await seed(page); await open(page);
  for (const title of ['Beta', 'Alpha', 'Gamma']) {
    await page.getByRole('button', {name: `${title} 관리`, exact: true}).click();
    await page.getByRole('menuitem', {name: '책 삭제'}).click();
    await page.getByRole('button', {name: '삭제 확인'}).click();
    await expect(page.getByRole('button', {name: `${title} 관리`, exact: true})).toHaveCount(0);
  }
  await expect(page.getByText('등록한 책이 없습니다.', {exact: false})).toBeVisible();
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  const data = await snapshot(page);
  expect(data.novels).toEqual([]); expect(data.translations).toEqual([{key: 'unrelated', data: 'preserve unknown owner'}]);
  await page.getByRole('button', {name: '서재 관리 닫기'}).click();
  await expect(page.locator('.demo-label')).toHaveText('DEMO');
  await page.reload(); await open(page);
  await expect(page.getByText('등록한 책이 없습니다.', {exact: false})).toBeVisible();
  await page.getByRole('tab', {name: 'EPUB / TXT'}).click();
  await expect(page.locator('input[type=file]')).toBeAttached();
});
