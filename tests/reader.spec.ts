import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('낯선 세계의 아침');
  await page.evaluate(() => document.fonts.ready);
});

test('desktop layout, reading settings and theme persist after reload', async ({ page }) => {
  await expect(page.getByRole('complementary', { name: '내 서재' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '읽기 설정' })).toBeVisible();
  await page.getByRole('button', { name: '다크', exact: true }).click();
  await page.getByRole('button', { name: '글자 크기 늘리기' }).click();
  await page.getByLabel('줄 간격', { exact: true }).fill('2.2');
  await page.getByLabel('본문 너비', { exact: true }).fill('760');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.reader-text')).toHaveCSS('font-size', '19px');
  await expect(page.locator('.reader-text')).toHaveCSS('line-height', '41.8px');
  await expect(page.getByLabel('본문 너비', { exact: true })).toHaveValue('760');
  await page.getByRole('button', { name: '기본 설정으로' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia');
  await page.getByRole('button', { name: '라이트', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('chapter and reading position restore after reload', async ({ page }) => {
  await page.getByRole('button', { name: '02 아침의 광장' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('아침의 광장');
  await page.evaluate(() => window.scrollTo(0, 730));
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('folio:v1:progress:rezero-demo')!).scrollY)).toBe(730);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('아침의 광장');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(710);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(750);
  await page.getByRole('button', { name: '다음 화', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('이름을 묻는 일');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('bookmarks persist, jump across chapters, and delete without navigation', async ({ page }) => {
  await page.getByRole('button', { name: '문단 4 북마크 저장', exact: true }).click();
  await page.getByRole('button', { name: '다음 화', exact: true }).click();
  await page.getByRole('button', { name: '문단 2 북마크 저장', exact: true }).click();
  await page.reload();
  await page.getByRole('tab', { name: '북마크 2' }).click();
  await expect(page.locator('.bookmark-entry')).toHaveCount(2);
  await page.locator('.bookmark-jump').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('낯선 세계의 아침');
  await expect(page.getByRole('button', { name: '문단 4 북마크 해제', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('#c1-p4').evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBe(120);
  await page.getByRole('button', { name: '2화 북마크 삭제', exact: true }).click();
  await expect(page.locator('.bookmark-entry')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('낯선 세계의 아침');
  await page.getByRole('button', { name: '문단 4 북마크 해제', exact: true }).click();
  await expect(page.getByRole('tab', { name: '북마크 0' })).toBeVisible();
});

test('first and last chapter boundaries and grouped contents', async ({ page }) => {
  await expect(page.getByRole('button', { name: '이전 화', exact: true })).toBeDisabled();
  const arc = page.getByRole('button', { name: '제2장 다시 이어지는 이야기' });
  await arc.click();
  await expect(page.getByRole('button', { name: '06 다시, 첫 페이지' })).toBeHidden();
  await arc.click();
  await page.getByRole('button', { name: '06 다시, 첫 페이지' }).click();
  await expect(page.getByRole('button', { name: '다음 화', exact: true })).toBeDisabled();
});

test('corrupt browser data falls back safely', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('folio:v1:settings', '{broken');
    localStorage.setItem('folio:v1:progress:rezero-demo', JSON.stringify({ bookId: 'rezero-demo', chapterId: 'missing', scrollY: 999, updatedAt: 'today' }));
    localStorage.setItem('folio:v1:bookmarks:rezero-demo', '[null, {"id": 5}]');
  });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('낯선 세계의 아침');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia');
  await expect(page.getByRole('tab', { name: '북마크 0' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('blocked storage keeps reading functional and reports the problem', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('blocked', 'QuotaExceededError'); }; });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('기기 저장 공간');
  await page.getByRole('button', { name: '다음 화', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('아침의 광장');
});

test('desktop screenshot', async ({ page }) => {
  await page.screenshot({ path: 'test-results/folio-desktop.png' });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('touch menus, accessible drawers and bookmark interactions', async ({ page }) => {
    const topbar = page.locator('.topbar');
    await page.locator('#c1-p1 p').tap();
    await expect(topbar).toBeHidden();
    await page.locator('#c1-p1 p').tap();
    await expect(topbar).toBeVisible();
    await page.getByRole('button', { name: '문단 1 북마크 저장', exact: true }).tap();
    await expect(topbar).toBeVisible();
    await page.getByRole('button', { name: '목차 열기' }).tap();
    const contents = page.getByRole('dialog', { name: '내 서재' });
    await expect(contents).toBeVisible();
    await contents.getByRole('button', { name: '02 아침의 광장' }).tap();
    await expect(contents).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('아침의 광장');
    await page.getByRole('button', { name: '읽기 설정', exact: true }).tap();
    const settings = page.getByRole('dialog', { name: '읽기 설정' });
    await expect(settings).toBeVisible();
    await settings.getByRole('button', { name: '다크', exact: true }).tap();
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await expect(page.getByRole('button', { name: '읽기 설정', exact: true })).toBeFocused();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('responsive widths and large type never create horizontal scrolling', async ({ page }) => {
    for (const width of [320, 360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 320, height: 844 });
    await page.getByRole('button', { name: '읽기 설정', exact: true }).tap();
    for (let index = 0; index < 10; index++) await page.getByRole('button', { name: '글자 크기 늘리기' }).tap();
    await page.getByRole('button', { name: '읽기 설정 닫기' }).tap();
    await expect(page.locator('.reader-text')).toHaveCSS('font-size', '28px');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('mobile screenshot', async ({ page }) => { await page.screenshot({ path: 'test-results/folio-mobile.png' }); });
});
