import { chromium, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';

async function ready(page: Page) {
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active || !navigator.serviceWorker.controller) return false;
    return new Promise<boolean>(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = event => {channel.port1.close(); resolve(event.data.complete === true);};
      registration.active!.postMessage({type: 'FOLIO_STATUS'}, [channel.port2]);
    });
  })).toBe(true);
}
const paragraphs = Array.from({length: 35}, (_, i) => `<p>Paragraph ${i}. A quiet morning by the river. 바람을 따라 책장을 넘기며 이야기를 읽었다. ${'The long road continued beyond the bridge. '.repeat(5)}</p>`).join('');
function epub() {
  return Buffer.from(zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'),
    'OPS/book.opf': strToU8('<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Offline EPUB</dc:title><dc:creator>Folio Test</dc:creator></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>'),
    'OPS/one.xhtml': strToU8(`<html><body><h1>Chapter 1: River</h1>${paragraphs}</body></html>`),
    'OPS/two.xhtml': strToU8(`<html><body><h1>Chapter 2: Bridge</h1>${paragraphs}</body></html>`),
  }));
}
async function openSettings(page: Page, mobile: boolean) { if (mobile) await page.getByRole('button', {name: '읽기 설정', exact: true}).click(); }
async function closeSettings(page: Page, mobile: boolean) { if (mobile) await page.getByRole('button', {name: '읽기 설정 닫기'}).click(); }
async function openContents(page: Page, mobile: boolean) { if (mobile) await page.getByRole('button', {name: '목차 열기', exact: true}).click(); }
async function novels(page: Page) {
  return page.evaluate(async () => new Promise<unknown[]>(resolve => {
    const request = indexedDB.open('folio-library-v1'); request.onsuccess = () => {
      const db = request.result, tx = db.transaction('novels', 'readonly'), all = tx.objectStore('novels').getAll();
      tx.oncomplete = () => {resolve(all.result); db.close();};
    };
  }));
}

for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} production shell and EPUB reading remain available offline without changing originals`, async ({page, context}) => {
  if (mobile) await page.setViewportSize({width: 390, height: 844});
  // Feed notch dimensions through the same CSS inputs used by env(safe-area-inset-*).
  // This verifies layout under insets; it does not emulate a physical device notch.
  if (mobile) await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    for (const [edge, value] of Object.entries({top: 24, right: 0, bottom: 20, left: 0})) document.documentElement.style.setProperty('--safe-' + edge, value + 'px');
  }));
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {if (!request.url().startsWith('http://127.0.0.1:4173')) external.push(request.url());});
  await page.goto('/'); await ready(page);
  await page.getByRole('button', {name: 'EPUB / TXT 파일 등록', exact: true}).click();
  await page.getByLabel('EPUB / TXT 파일').setInputFiles({name: 'offline.epub', mimeType: 'application/epub+zip', buffer: epub()});
  await page.getByRole('button', {name: '2개 화 서재에 등록'}).click();
  await expect(page.locator('.chapter-heading h1')).toHaveText('Chapter 1: River');
  const original = await novels(page);
  await openSettings(page, mobile);
  await page.getByRole('button', {name: '다크', exact: true}).click();
  await page.getByRole('button', {name: '가로 페이지', exact: true}).click();
  await closeSettings(page, mobile);
  await page.getByRole('button', {name: '다음 페이지', exact: true}).click();
  await page.locator('.paged-paragraph:not([aria-hidden="true"]) .paragraph-bookmark[tabindex="0"]').first().click();
  const book = await page.evaluate(() => (document.querySelector('#library-selection') as HTMLSelectElement).value);
  const position = () => page.evaluate(id => JSON.parse(localStorage.getItem(`folio:v1:progress:${id}`)!), book);
  const saved = await position();
  await context.setOffline(true); await page.reload();
  await expect(page.locator('.chapter-heading h1')).toHaveText('Chapter 1: River');
  await expect.poll(async () => (await position()).paragraphId).toBe(saved.paragraphId);
  await expect(page.locator('.save-state')).toContainText('오프라인');
  await page.getByRole('button', {name: '다음 페이지', exact: true}).click();
  await openContents(page, mobile);
  await page.getByRole('button', {name: /02 Chapter 2: Bridge/}).click();
  await expect(page.locator('.chapter-heading h1')).toHaveText('Chapter 2: Bridge');
  await page.locator('.paged-paragraph:not([aria-hidden="true"]) .paragraph-bookmark[tabindex="0"]').first().click();
  await openSettings(page, mobile);
  await page.getByRole('button', {name: '글자 크기 늘리기'}).click();
  await page.getByText('앱 설치 · 오프라인', {exact: true}).click();
  await expect(page.getByText('오프라인 준비 완료', {exact: false})).toBeVisible();
  await expect(page.getByText('오프라인 준비를 마치지 못했습니다.', {exact: false})).toHaveCount(0);
  await closeSettings(page, mobile);
  if (mobile) {
    await page.evaluate(() => {for (const [edge, value] of Object.entries({top: 0, left: 44, right: 44, bottom: 20})) document.documentElement.style.setProperty('--safe-' + edge, value + 'px');});
    await page.setViewportSize({width: 844, height: 390});
    await expect.poll(() => page.locator('.page-viewport').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight - 55)).toBe(true);
    await expect.poll(() => page.locator('.brand').evaluate(el => el.getBoundingClientRect().left >= 44)).toBe(true);
    await page.evaluate(() => {for (const [edge, value] of Object.entries({top: 24, left: 0, right: 0, bottom: 20})) document.documentElement.style.setProperty('--safe-' + edge, value + 'px');});
    await page.setViewportSize({width: 320, height: 740});
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({width: 390, height: 740});
  }
  await page.reload(); await expect(page.locator('.chapter-heading h1')).toHaveText('Chapter 2: Bridge');
  await openContents(page, mobile); await expect(page.getByRole('tab', {name: '북마크 2'})).toBeVisible();
  await page.getByRole('button', {name: '서재 관리', exact: true}).click();
  await expect(page.locator('.library-book-open')).toHaveCount(1);
  await page.getByRole('tab', {name: 'EPUB / TXT', exact: true}).click();
  await page.getByLabel('EPUB / TXT 파일').setInputFiles({name: 'offline-note.txt', mimeType: 'text/plain', buffer: Buffer.from('Chapter 1: Offline note\n\nShort offline note.\n\n' + Array.from({length: 12}, () => '오프라인에서 등록한 문장도 읽고 북마크를 저장합니다. '.repeat(2)).join('\n\n'))});
  await page.getByRole('button', {name: '1개 화 서재에 등록'}).click();
  await expect(page.locator('.chapter-heading h1')).toHaveText('Chapter 1: Offline note');
  await page.locator('.paged-paragraph:not([aria-hidden="true"]) .paragraph-bookmark[tabindex="0"]').first().click();
  await page.reload(); await expect(page.locator('.chapter-heading h1')).toHaveText('Chapter 1: Offline note');
  await openContents(page, mobile);
  await expect(page.getByRole('tab', {name: '북마크 1'})).toBeVisible();
  await page.getByLabel('서재 책 선택').selectOption(book);
  await expect(page.locator('.chapter-heading h1')).toHaveText('Chapter 2: Bridge');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('18px "Gowun Batang"', '오프라인 독서'))).toBe(true);
  expect(await novels(page)).toEqual(expect.arrayContaining(original));
  expect(await novels(page)).toHaveLength(original.length + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: `test-results/pwa-offline-${mobile ? 'mobile' : 'desktop'}.png`});
  await context.setOffline(false);
  await expect(page.locator('.save-state')).not.toContainText('오프라인');
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('Chrome validates the manifest, icons and installability; UI responds to install events', async () => {
  const directory = await mkdtemp(resolve('test-results/pwa-install-profile-'));
  const context = await chromium.launchPersistentContext(directory, {channel: 'chrome', headless: true});
  try {
  const page = context.pages()[0];
  await page.goto('http://127.0.0.1:4173/'); await ready(page);
  const cdp = await page.context().newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest'); expect(manifest.errors).toEqual([]);
  const install = await cdp.send('Page.getInstallabilityErrors'); expect(install.installabilityErrors).toEqual([]);
  const data = JSON.parse(manifest.data!); expect(data.start_url).toBe('/'); expect(data.scope).toBe('/'); expect(data.display).toBe('standalone');
  expect(data.icons.map((icon: {sizes: string}) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', {cancelable: true}) as Event & {prompt: () => Promise<void>; userChoice: Promise<{outcome: string}>};
    event.prompt = async () => {document.documentElement.dataset.installPrompt = 'shown';}; event.userChoice = Promise.resolve({outcome: 'accepted'}); window.dispatchEvent(event);
  });
  await page.getByRole('button', {name: 'Folio 앱 설치', exact: true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-install-prompt', 'shown');
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.getByRole('button', {name: 'Folio 앱 설치', exact: true})).toHaveCount(0);
  } finally {await context.close();}
});

test('iOS gets manual home-screen and translation guidance', async ({browser}) => {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
  const page = await context.newPage(); await page.goto('http://127.0.0.1:4173/');
  await page.getByText('앱 설치 · 오프라인', {exact: true}).click();
  await expect(page.getByText('iOS Safari의 공유 버튼', {exact: false})).toBeVisible();
  await expect(page.getByText('설치형 화면에서는 브라우저 번역 메뉴가 제한될 수 있습니다.', {exact: false})).toBeVisible();
  await context.close();
});
