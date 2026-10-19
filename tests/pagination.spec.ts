import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { sampleBook } from '../src/data/sampleBook';

const progressKey = 'folio:v1:progress:rezero-demo';
async function position(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), progressKey);
}
async function count(page: Page) {
  return (await page.locator('.page-count').innerText()).split('/').map((value) => Number(value.trim()));
}
async function openPaged(page: Page, mobile = false) {
  if (mobile) await page.getByRole('button', { name: '읽기 설정', exact: true }).click();
  await page.getByRole('button', { name: '가로 페이지', exact: true }).click();
  if (mobile) await page.getByRole('button', { name: '읽기 설정 닫기' }).click();
  await expect(page.locator('.page-viewport')).toBeVisible();
  await expect.poll(async () => (await count(page))[1]).toBeGreaterThan(1);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
});

test('page controls, arrow keys, boundaries, progress and reload restoration', async ({ page }) => {
  await openPaged(page);
  await page.screenshot({ path: 'test-results/paged-desktop.png' });
  await expect(page.getByRole('button', { name: '이전 페이지', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
  await expect.poll(async () => (await count(page))[0]).toBe(2);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await count(page))[0]).toBe(3);
  const saved = await position(page);
  await expect(page.locator('.page-track')).toHaveCSS('transition-duration', '0.22s');
  await page.reload();
  await expect.poll(async () => (await count(page))[0]).toBe(3);
  expect((await position(page)).paragraphId).toBe(saved.paragraphId);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await count(page))[0]).toBe(2);
  const [, total] = await count(page);
  for (let i = 0; i < total + 2; i++) await page.keyboard.press('ArrowRight');
  expect((await count(page))[0]).toBe(total);
  await expect(page.getByRole('button', { name: '다음 페이지', exact: true })).toBeDisabled();
  await expect(page.getByLabel('현재 화 읽기 진행률')).toHaveText('100%');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: 'test-results/paged-desktop-end.png' });
});

test('reflow keeps semantic anchor through typography, width, viewport and mode changes', async ({ page }) => {
  await page.evaluate(() => window.scrollTo(0, 850));
  await expect.poll(async () => (await position(page)).scrollY).toBe(850);
  const vertical = await position(page);
  await openPaged(page);
  expect((await position(page)).paragraphId).toBe(vertical.paragraphId);
  const before = await position(page);
  const [, originalTotal] = await count(page);
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: '글자 크기 늘리기' }).click();
  await page.getByLabel('줄 간격', { exact: true }).fill('2.5');
  await page.getByLabel('본문 너비', { exact: true }).fill('480');
  await expect.poll(async () => (await count(page))[1]).toBeGreaterThan(originalTotal);
  expect((await position(page)).paragraphId).toBe(before.paragraphId);
  expect((await position(page)).characterOffset).toBe(before.characterOffset);
  await page.setViewportSize({ width: 390, height: 700 });
  await expect.poll(async () => (await count(page))[1]).toBeGreaterThan(originalTotal);
  expect((await position(page)).paragraphId).toBe(before.paragraphId);
  expect((await position(page)).characterOffset).toBe(before.characterOffset);
  await page.getByRole('button', { name: '읽기 설정', exact: true }).click();
  await page.getByRole('button', { name: '세로 스크롤', exact: true }).click();
  await page.getByRole('button', { name: '읽기 설정 닫기' }).click();
  await expect(page.locator('.chapter-body')).toBeVisible();
  await expect.poll(async () => (await position(page)).readingMode).toBe('scroll');
  expect((await position(page)).paragraphId).toBe(before.paragraphId);
  expect(Math.abs((await position(page)).characterOffset - before.characterOffset)).toBeLessThan(60);
});

test('bookmarks jump to the right page in either chapter and preserve chapter navigation', async ({ page }) => {
  await openPaged(page);
  const bookmark = page.locator('.paged-paragraph:not([aria-hidden="true"]) .paragraph-bookmark[tabindex="0"]').first();
  const label = await bookmark.getAttribute('aria-label');
  await bookmark.click();
  await page.getByRole('button', { name: '다음 화', exact: true }).last().click();
  await expect.poll(async () => (await count(page))[0]).toBe(1);
  await page.getByRole('tab', { name: '북마크 1' }).click();
  await page.locator('.bookmark-jump').click();
  await expect.poll(async () => (await position(page)).chapterId).toBe('chapter-1');
  await expect(page.getByRole('button', { name: label!.replace('저장', '해제'), exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '1화 북마크 삭제', exact: true }).click();
  await expect(page.getByRole('tab', { name: '북마크 0' })).toBeVisible();
});

test('direction keys leave settings sliders alone and reduced motion disables sliding', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPaged(page);
  const before = await position(page);
  await page.getByLabel('줄 간격', { exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('줄 간격', { exact: true })).toHaveValue('2');
  expect((await position(page)).paragraphId).toBe(before.paragraphId);
  await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
  await expect(page.locator('.page-track')).toHaveCSS('transition-duration', '0s');
});

test.describe('mobile pages', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('left and right taps, swipes, center menu and viewport height changes', async ({ page }) => {
    await openPaged(page, true);
    const box = (await page.locator('.page-viewport').boundingBox())!;
    await page.touchscreen.tap(387, box.y + box.height / 2);
    await expect.poll(async () => (await count(page))[0]).toBe(2);
    const cdp = await page.context().newCDPSession(page);
    const x = box.x + box.width * .75;
    const y = box.y + box.height * .6;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - i * 30, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await count(page))[0]).toBe(3);
    await cdp.detach();
    await page.getByRole('button', { name: '이전 페이지', exact: true }).click();
    await expect.poll(async () => (await count(page))[0]).toBe(2);
    await page.touchscreen.tap(box.x + 7, box.y + box.height * .5);
    await expect.poll(async () => (await count(page))[0]).toBe(1);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('.topbar')).toBeHidden();
    await expect(page.locator('.page-position-hint')).toBeVisible();
    await page.getByRole('button', { name: '독서 메뉴 표시' }).click();
    await expect(page.locator('.topbar')).toBeVisible();
    await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
    const anchor = await position(page);
    await page.setViewportSize({ width: 390, height: 640 });
    await expect.poll(() => page.locator('.page-viewport').evaluate((element) => element.getBoundingClientRect().bottom <= window.visualViewport!.height - 61)).toBe(true);
    expect((await position(page)).paragraphId).toBe(anchor.paragraphId);
    expect((await position(page)).characterOffset).toBe(anchor.characterOffset);
    await page.screenshot({ path: 'test-results/paged-mobile.png' });
  });

  test('large type, long paragraphs, narrow and landscape screens keep every line inside a page', async ({ page }) => {
    await page.getByRole('button', { name: '읽기 설정', exact: true }).click();
    for (let i = 0; i < 10; i++) await page.getByRole('button', { name: '글자 크기 늘리기' }).click();
    await page.getByLabel('줄 간격', { exact: true }).fill('2.6');
    await page.getByRole('button', { name: '가로 페이지', exact: true }).click();
    await page.getByRole('button', { name: '읽기 설정 닫기' }).click();
    for (const [width, height] of [[390, 844], [320, 568], [844, 390], [320, 360]]) {
      await page.setViewportSize({ width, height });
      await expect.poll(() => page.evaluate(() => {
        const viewport = document.querySelector('.page-viewport')!.getBoundingClientRect();
        const paragraphs = Array.from(document.querySelectorAll('[data-paragraph-text]'));
        const track = document.querySelector('.page-track')!.getBoundingClientRect();
        const width = Math.floor(viewport.width);
        const stride = width + 48;
        return paragraphs.every((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return Array.from(range.getClientRects()).every((rect) => {
            const column = Math.floor((rect.left - track.left + .5) / stride);
            const left = track.left + column * stride;
            return rect.top >= viewport.top - 1 && rect.bottom <= viewport.bottom + 1 && rect.left >= left - 1 && rect.right <= left + width + 1;
          });
        });
      })).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await page.locator('[data-paragraph-text]').count()).toBe(16);
      expect(await page.locator('[data-paragraph-text]').allTextContents()).toEqual(sampleBook.chapters[0].paragraphs.map((paragraph) => paragraph.text));
    }
  });

  test('a location inside an oversized paragraph survives reload and re-pagination', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 520 });
    await page.getByRole('button', { name: '읽기 설정', exact: true }).click();
    for (let i = 0; i < 10; i++) await page.getByRole('button', { name: '글자 크기 늘리기' }).click();
    await page.getByLabel('줄 간격', { exact: true }).fill('2.6');
    await page.getByRole('button', { name: '가로 페이지', exact: true }).click();
    await page.getByRole('button', { name: '읽기 설정 닫기' }).click();
    await expect.poll(async () => (await count(page))[1]).toBeGreaterThan(2);
    for (let i = 0; i < 6 && !(await position(page)).characterOffset; i++) await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
    const saved = await position(page);
    expect(saved.characterOffset).toBeGreaterThan(0);
    await page.reload();
    await expect.poll(async () => (await position(page)).readingMode).toBe('paged');
    await expect.poll(async () => (await count(page))[1]).toBeGreaterThan(2);
    expect((await position(page)).paragraphId).toBe(saved.paragraphId);
    expect((await position(page)).characterOffset).toBe(saved.characterOffset);
    await page.setViewportSize({ width: 360, height: 700 });
    await expect.poll(() => page.evaluate(({ id, offset }) => {
      const span = document.getElementById(id)!.querySelector('[data-paragraph-text]')!;
      const range = document.createRange();
      range.setStart(span.firstChild!, offset);
      range.setEnd(span.firstChild!, offset + 1);
      const rect = range.getBoundingClientRect();
      const viewport = document.querySelector('.page-viewport')!.getBoundingClientRect();
      return rect.left >= viewport.left - 1 && rect.right <= viewport.right + 1 && rect.top >= viewport.top - 1 && rect.bottom <= viewport.bottom + 1;
    }, { id: saved.paragraphId, offset: saved.characterOffset })).toBe(true);
  });
});
