import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createNovel, makeBatches, TRANSLATION_MODEL } from '../shared/novels';
const SOURCE_URL = 'https://witchculttranslation.com/2021/01/29/arc-7-chapter-2-animal-tracking/';
// Original test prose; no actual novel text is committed in fixtures.
const fixture = () => createNovel({ url: SOURCE_URL, title: 'Arc 7, Chapter 2 — Integration Test', arc: 7, chapter: 2, kind: 'wct', texts: Array.from({ length: 70 }, (_, i) => `Paragraph ${i + 1}. A traveler walked beside the river and listened to the quiet sounds of the forest. He stopped to remember the promise he had made that morning.`) });
type SetupOptions = { failSecond?: number; pauseAfterFirst?: boolean; restricted?: boolean; invalidIds?: boolean };
async function setup(page: Page, options: SetupOptions = {}) {
  const novel = await fixture();
  const requests: string[] = [];
  let failed = false;
  await page.route('**/api/folio', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { configured: true, authenticated: true, model: TRANSLATION_MODEL, translationConfigured: true, limiterConfigured: true, importEnabled: true } });
    const data = route.request().postDataJSON();
    if (data.action === 'import') {
      if (options.restricted) return route.fulfill({ status: 403, json: { error: { code: 'SOURCE_RESTRICTED', message: '접근 제한으로 수동 입력을 이용해 주세요.' } } });
      return route.fulfill({ json: { novel } });
    }
    if (data.action === 'translate') {
      requests.push(data.batch.id);
      if (requests.length === 2 && options.failSecond && !failed) {
        failed = true;
        return route.fulfill({ status: options.failSecond, json: { error: { code: options.failSecond === 429 ? 'GEMINI_QUOTA' : 'GEMINI_FAILED', message: '테스트 오류: 완료 구간은 보존됩니다.', retryAfter: options.failSecond === 429 ? 60 : 0 } } });
      }
      return route.fulfill({ json: { model: TRANSLATION_MODEL, nextRequestAfterMs: options.pauseAfterFirst && requests.length === 1 ? 21000 : 0, paragraphs: data.batch.paragraphs.map((p: { id: string; text: string }, i: number) => ({ id: options.invalidIds ? 'wrong-id' : p.id, text: `여행자는 강가를 따라 천천히 걸었다. 숲에서 들려오는 조용한 소리에 귀를 기울이다가, 아침에 했던 약속을 떠올리며 잠시 걸음을 멈췄다. ${i + 1}` })) } });
    }
    return route.fulfill({ json: { authenticated: true } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('낯선 세계의 아침');
  return { novel, requests };
}
async function importFixture(page: Page, mobile = false) {
  if (mobile) await page.getByRole('button', { name: '목차 열기' }).click();
  await page.getByRole('button', { name: '소설 URL 추가' }).click();
  await page.getByRole('button', { name: '한 화 가져오기', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Arc 7, Chapter 2 — Integration Test');
}
const progress = (page: Page, id: string) => page.evaluate((bookId) => JSON.parse(localStorage.getItem(`folio:v1:progress:${bookId}`) ?? 'null'), id);

test('imports one chapter, caches translation in IndexedDB and reloads without generating again', async ({ page }) => {
  const { novel, requests } = await setup(page);
  await importFixture(page);
  await expect(page.getByRole('button', { name: '한국어', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '번역하기', exact: true }).click();
  await expect(page.getByText('번역 저장됨', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(makeBatches(novel.paragraphs).length);
  await page.getByRole('button', { name: '한국어', exact: true }).click();
  await expect(page.locator('[data-paragraph]').first()).toContainText('여행자는');
  await page.reload();
  await expect(page.getByText('번역 저장됨', { exact: true })).toBeVisible();
  await expect(page.locator('[data-paragraph]').first()).toContainText('여행자는');
  expect(requests).toHaveLength(makeBatches(novel.paragraphs).length);
  await page.getByRole('button', { name: '원문 보기', exact: true }).click();
  await expect(page.locator('[data-paragraph]').first()).toContainText('Paragraph 1.');
  await page.getByLabel('서재 책 선택').selectOption('rezero-demo');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('낯선 세계의 아침');
  await page.getByLabel('서재 책 선택').selectOption(novel.id);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(novel.title);
  expect(requests).toHaveLength(makeBatches(novel.paragraphs).length);
});

for (const status of [429, 502]) test(`preserves completed chunks after ${status} and retries only unfinished chunks`, async ({ page }) => {
  const { novel, requests } = await setup(page, { failSecond: status });
  await importFixture(page);
  await page.getByRole('button', { name: '번역하기', exact: true }).click();
  await expect(page.locator('.translation-error')).toContainText('완료 구간은 보존');
  await expect(page.getByRole('progressbar', { name: '번역 진행률' })).toHaveAttribute('value', '1');
  expect(requests).toHaveLength(2);
  await page.getByRole('button', { name: '번역 재시도', exact: true }).click();
  await expect(page.getByText('번역 저장됨', { exact: true })).toBeVisible();
  expect(requests.filter((id) => id === makeBatches(novel.paragraphs)[0].id)).toHaveLength(1);
  expect(requests.filter((id) => id === makeBatches(novel.paragraphs)[1].id)).toHaveLength(2);
});

test('pause and reload resume from durable completed chunks', async ({ page }) => {
  const { novel, requests } = await setup(page, { pauseAfterFirst: true });
  await importFixture(page);
  await page.getByRole('button', { name: '번역하기', exact: true }).click();
  await expect(page.getByText(/무료 한도 보호 대기 중/)).toBeVisible();
  await page.getByRole('button', { name: '번역 중단', exact: true }).click();
  await expect(page.getByRole('button', { name: '이어서 번역', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('progressbar', { name: '번역 진행률' })).toHaveAttribute('value', '1');
  await page.getByRole('button', { name: '이어서 번역', exact: true }).click();
  await expect(page.getByText('번역 저장됨', { exact: true })).toBeVisible();
  expect(requests.filter((id) => id === makeBatches(novel.paragraphs)[0].id)).toHaveLength(1);
});

test('rejects invalid translation IDs without losing the source', async ({ page }) => {
  const { requests } = await setup(page, { invalidIds: true });
  await importFixture(page);
  await page.getByRole('button', { name: '번역하기', exact: true }).click();
  await expect(page.locator('.translation-error')).toContainText('문단 ID');
  await expect(page.getByRole('progressbar', { name: '번역 진행률' })).toHaveAttribute('value', '0');
  expect(requests).toHaveLength(1);
  await expect(page.locator('[data-paragraph]').first()).toContainText('Paragraph 1.');
});

test('restricted import offers manual input and keeps dialogue and paragraph breaks', async ({ page }) => {
  await setup(page, { restricted: true });
  await page.getByRole('button', { name: '소설 URL 추가' }).click();
  await page.getByRole('button', { name: '한 화 가져오기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('접근 제한');
  await page.getByLabel('영어 원문', { exact: true }).fill('A traveler stood at the gate.\n\nSpeaker: [Good morning.]\nHe smiled.');
  await page.getByRole('button', { name: '이 기기에 저장', exact: true }).click();
  await expect(page.locator('[data-paragraph]')).toHaveCount(2);
  await expect(page.locator('[data-paragraph]').last()).toContainText('Speaker: [Good morning.]\nHe smiled.');
  await page.reload();
  await expect(page.locator('[data-paragraph]')).toHaveCount(2);
});

test.describe('mobile imported chapters', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('source and Korean pages retain paragraph anchors and bookmarks', async ({ page }) => {
    const { novel } = await setup(page);
    await importFixture(page, true);
    await page.getByRole('button', { name: '번역하기', exact: true }).click();
    await expect(page.getByText('번역 저장됨', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '읽기 설정', exact: true }).click();
    await page.getByRole('button', { name: '가로 페이지', exact: true }).click();
    await page.getByRole('button', { name: '읽기 설정 닫기' }).click();
    await expect.poll(() => page.locator('.page-count').innerText()).not.toBe('1 / 1');
    await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
    const saved = await progress(page, novel.id);
    await page.getByRole('button', { name: '한국어', exact: true }).click();
    await expect.poll(async () => (await progress(page, novel.id))?.paragraphId).toBe(saved.paragraphId);
    await expect(page.locator(`#${saved.paragraphId}`)).toContainText('여행자는');
    const bookmark = page.locator('.paged-paragraph:not([aria-hidden="true"]) .paragraph-bookmark[tabindex="0"]').first();
    await bookmark.click();
    await page.getByRole('button', { name: '원문 보기', exact: true }).click();
    await expect(page.locator(`#${saved.paragraphId}`)).toContainText('Paragraph');
    await page.getByRole('button', { name: '목차 열기' }).click();
    await expect(page.getByRole('tab', { name: '북마크 1' })).toBeVisible();
    await page.getByRole('button', { name: '내 서재 닫기' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/imported-mobile.png' });
  });
});
