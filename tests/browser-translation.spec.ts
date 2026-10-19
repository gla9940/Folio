import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createNovel, sha256 } from '../shared/novels';

// Browser translation is not callable by the app. These tests reproduce its DOM
// replacement/wrapping behavior in installed Chrome, without a translation service.
async function existingReader(page: Page, mode: 'scroll' | 'paged', second = false) {
  const hash = await sha256('legacy-file-identity');
  const bookId = `file-${hash}`;
  const novels = [];
  for (let index = 0; index < 2; index++) {
    const novel = await createNovel({ url: `folio-file:${hash}#chapter${index}`, title: `Chapter ${index + 1}: The River`, arc: 1, chapter: index + 1, kind: 'epub', texts: Array.from({ length: 32 }, (_, i) => `Paragraph ${i + 1}. The traveler followed the river and listened to the wind. He remembered a quiet morning and the promise to return home.`) });
    novels.push({ ...novel, collection: { id: bookId, title: 'Saved EPUB', author: 'Test author', order: index } });
  }
  const selected = novels[second ? 1 : 0];
  const legacyCache = { key: 'legacy-cache-keep-untouched', chunks: [{ status: 'complete', paragraphs: [{ id: novels[0].paragraphs[0].id, text: '기존 저장 데이터' }] }] };
  const errors: string[] = []; const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/\/api\//.test(request.url())) requests.push(request.url()); });
  await page.route('**/api/**', (route) => route.abort());
  await page.route('**/seed.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Storage fixture</title>' }));
  await page.goto('/seed.html');
  await page.evaluate(async ({ novels, selected, bookId, mode, legacyCache }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('folio-library-v1', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('novels', { keyPath: 'id' });
        request.result.createObjectStore('translations', { keyPath: 'key' });
        request.result.createObjectStore('preferences', { keyPath: 'id' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['novels', 'translations', 'preferences'], 'readwrite');
        novels.forEach((novel) => tx.objectStore('novels').put(novel));
        tx.objectStore('translations').put(legacyCache);
        tx.objectStore('preferences').put({ id: 'selected', value: selected.id });
        tx.objectStore('preferences').put({ id: 'languages', value: { [selected.id]: 'ko' } });
        tx.objectStore('preferences').put({ id: 'read-chapters', value: { [`${novels[0].id}:${novels[0].source.hash}`]: true } });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    localStorage.setItem('folio:v1:settings', JSON.stringify({ theme: 'dark', fontSize: 20, lineHeight: 2, contentWidth: 680, readingMode: mode }));
    localStorage.setItem(`folio:v1:progress:${bookId}`, JSON.stringify({ bookId, chapterId: selected.chapterId, paragraphId: selected.paragraphs[0].id, characterOffset: 0, paragraphOffset: 120, scrollY: 0, readingMode: mode, updatedAt: '2026-10-19T00:00:00Z' }));
    localStorage.setItem(`folio:v1:bookmarks:${bookId}`, JSON.stringify([{ id: 'existing-bookmark', bookId, chapterId: novels[0].chapterId, paragraphId: novels[0].paragraphs[1].id, excerpt: 'Existing bookmark', createdAt: '2026-10-19T00:00:00Z' }]));
  }, { novels, selected, bookId, mode, legacyCache });
  await page.goto('/');
  await expect(page.locator('.chapter-heading h1')).toHaveText(selected.title);
  await page.evaluate(() => document.fonts.ready);
  return { bookId, novels, legacyCache, requests, errors };
}
async function replaceWithTranslatedDom(page: Page) {
  await page.locator('[data-paragraph-text]').evaluateAll((elements) => {
    for (const [index, element] of elements.entries()) {
      const original = document.createElement('font');
      original.style.display = 'none'; original.textContent = element.textContent;
      const outer = document.createElement('font'); const inner = document.createElement('font');
      outer.style.verticalAlign = 'inherit'; inner.style.verticalAlign = 'inherit';
      inner.textContent = `${index + 1}. ` + '여행자는 바람 소리에 귀 기울이며 강을 따라 천천히 걸었다. 오래전의 약속을 떠올리며 저물어 가는 하늘을 바라보았다. '.repeat(5);
      outer.append(inner); element.replaceChildren(original, outer);
    }
  });
}
const progress = (page: Page, bookId: string) => page.evaluate((id) => JSON.parse(localStorage.getItem(`folio:v1:progress:${id}`)!), bookId);
const pageCount = (page: Page) => page.locator('.page-count').innerText().then((text) => text.split('/').map(Number));
async function noClippedText(page: Page) {
  return page.locator('.page-viewport').evaluate((viewport) => {
    const bounds = viewport.getBoundingClientRect();
    const track = viewport.querySelector('.page-track')!.getBoundingClientRect();
    const width = Math.floor(bounds.width), stride = width + 48;
    return Array.from(viewport.querySelectorAll('[data-paragraph-text]')).every((element) => {
      const range = document.createRange(); range.selectNodeContents(element);
      return Array.from(range.getClientRects()).filter((r) => r.width && r.height).every((r) => {
        const column = Math.floor((r.left - track.left + .5) / stride), left = track.left + column * stride;
        return r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1 && r.left >= left - 1 && r.right <= left + width + 1;
      });
    });
  });
}

test('opens the existing v1 library without migration or changes to EPUB, old cache and bookmarks', async ({ page }) => {
  const { novels, legacyCache, bookId, requests, errors } = await existingReader(page, 'scroll', true);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('tab', { name: '북마크 1' })).toBeVisible();
  await expect(page.locator('[data-paragraph-text]').first()).toContainText('The traveler');
  const stored = await page.evaluate(async () => new Promise<{ version: number; novels: unknown[]; cache: unknown; languages: unknown }>((resolve) => {
    const request = indexedDB.open('folio-library-v1');
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['novels', 'translations', 'preferences']);
      const novels = tx.objectStore('novels').getAll(), cache = tx.objectStore('translations').get('legacy-cache-keep-untouched'), languages = tx.objectStore('preferences').get('languages');
      tx.oncomplete = () => { resolve({ version: db.version, novels: novels.result, cache: cache.result, languages: languages.result }); db.close(); };
    };
  }));
  expect(stored.version).toBe(1);
  expect(stored.novels).toEqual(expect.arrayContaining(novels));
  expect(stored.cache).toEqual(legacyCache);
  expect(stored.languages).toEqual({ id: 'languages', value: { [novels[1].id]: 'ko' } });
  expect((await progress(page, bookId)).chapterId).toBe(novels[1].chapterId);
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

for (const mobile of [false, true]) test.describe(mobile ? 'mobile Chrome DOM translation' : 'desktop Chrome DOM translation', () => {
  test.use(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
  test('reflows translated DOM and preserves anchors through pages, bookmarks, resizing and chapter changes', async ({ page }) => {
    const { bookId, requests, errors } = await existingReader(page, 'paged');
    await expect.poll(async () => (await pageCount(page))[1]).toBeGreaterThan(2);
    await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
    const before = await progress(page, bookId), total = (await pageCount(page))[1];
    await replaceWithTranslatedDom(page);
    await expect.poll(async () => (await pageCount(page))[1]).toBeGreaterThan(total);
    expect((await progress(page, bookId)).paragraphId).toBe(before.paragraphId);
    expect((await progress(page, bookId)).characterOffset).toBe(before.characterOffset);
    await expect.poll(() => noClippedText(page)).toBe(true);
    await page.locator('.paged-paragraph:not([aria-hidden="true"]) .paragraph-bookmark[tabindex="0"]').first().click();
    await expect(page.locator('[data-paragraph-text]').first()).toContainText('여행자는');
    await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
    await page.getByRole('button', { name: '이전 페이지', exact: true }).click();
    await page.setViewportSize(mobile ? { width: 320, height: 568 } : { width: 1280, height: 850 });
    await expect.poll(() => noClippedText(page)).toBe(true);
    if (mobile) await page.getByRole('button', { name: '읽기 설정', exact: true }).click();
    await page.getByRole('button', { name: '글자 크기 늘리기' }).click();
    if (mobile) await page.getByRole('button', { name: '읽기 설정 닫기' }).click();
    await expect.poll(() => noClippedText(page)).toBe(true);
    if (mobile) await page.getByRole('button', { name: '목차 열기' }).click();
    await page.locator('.chapter-link').filter({ hasText: 'Chapter 2: The River' }).click();
    await expect(page.locator('.chapter-heading h1')).toHaveText('Chapter 2: The River');
    await replaceWithTranslatedDom(page);
    await expect.poll(() => noClippedText(page)).toBe(true);
    await page.screenshot({ path: `test-results/browser-dom-${mobile ? 'mobile' : 'desktop'}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(requests).toEqual([]); expect(errors).toEqual([]);
  });
  test('scroll mode tolerates replacement nodes and mode changes without React errors', async ({ page }) => {
    const { bookId, requests, errors } = await existingReader(page, 'scroll');
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect.poll(async () => (await progress(page, bookId)).scrollY).toBe(900);
    const before = await progress(page, bookId);
    await replaceWithTranslatedDom(page);
    await expect.poll(async () => (await progress(page, bookId)).paragraphId).toBe(before.paragraphId);
    await page.locator(`#${before.paragraphId} .paragraph-bookmark`).click();
    if (mobile) {
      if (await page.getByRole('button', { name: '독서 메뉴 표시' }).isVisible()) await page.getByRole('button', { name: '독서 메뉴 표시' }).click();
      await page.getByRole('button', { name: '읽기 설정', exact: true }).click();
    }
    await page.getByRole('button', { name: '가로 페이지', exact: true }).click();
    if (mobile) await page.getByRole('button', { name: '읽기 설정 닫기' }).click();
    await expect(page.locator('.page-viewport')).toBeVisible();
    await replaceWithTranslatedDom(page);
    await expect.poll(() => noClippedText(page)).toBe(true);
    await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
    await page.reload();
    await expect(page.locator('.page-viewport')).toBeVisible();
    expect(requests).toEqual([]); expect(errors).toEqual([]);
  });
});
