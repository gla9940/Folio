import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

// Original test prose only. EPUB resources never execute in the reader.
const paragraph = (i: number) => `<p>A traveler ${i} followed the quiet river and thought about tomorrow. The leaves moved softly in the wind, and the long road continued beyond the old bridge.</p>`;
const xhtml = (body: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Test</title></head><body>${body}</body></html>`;
function epub(options: { ncx?: boolean; sameFile?: boolean; drm?: boolean; external?: boolean; oversized?: boolean } = {}) {
  const nav = options.ncx ? '<item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : '<item id="toc" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>';
  const paths = options.sameFile ? ['Text/book.xhtml#first', 'Text/book.xhtml#second'] : ['Text/first.xhtml', 'Text/second.xhtml'];
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>'),
    'OPS/package.opf': strToU8(`<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>The Quiet River</dc:title><dc:creator>Folio Tester</dc:creator></metadata><manifest>${nav}<item id="one" href="${options.external ? 'https://evil.example/chapter' : paths[0].split('#')[0]}" media-type="application/xhtml+xml"/>${options.sameFile ? '' : '<item id="two" href="Text/second.xhtml" media-type="application/xhtml+xml"/>'}</manifest><spine toc="toc"><itemref idref="one"/>${options.sameFile ? '' : '<itemref idref="two"/>'}</spine></package>`),
  };
  if (options.ncx) files['OPS/toc.ncx'] = strToU8(`<ncx><navMap>${paths.map((path, i) => `<navPoint><navLabel><text>Chapter ${i + 1}: ${i ? 'The Bridge' : 'The River'}</text></navLabel><content src="${path}"/></navPoint>`).join('')}</navMap></ncx>`);
  else files['OPS/nav.xhtml'] = strToU8(xhtml(`<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol>${paths.map((path, i) => `<li><a href="${path}">Chapter ${i + 1}: ${i ? 'The Bridge' : 'The River'}</a></li>`).join('')}</ol></nav>`));
  const first = '<h1 id="first">Chapter 1: The River</h1><script>window.__epubExecuted=true</script><nav><p>Unwanted menu</p></nav><p aria-hidden="true">Hidden ad</p><img src="https://evil.example/tracker"/><p>Speaker: [Good morning.]<br/>He smiled.</p>' + Array.from({ length: 36 }, (_, i) => paragraph(i)).join('');
  const second = '<h1 id="second">Chapter 2: The Bridge</h1>' + Array.from({ length: 28 }, (_, i) => paragraph(i + 40)).join('');
  if (options.sameFile) files['OPS/Text/book.xhtml'] = strToU8(xhtml(first + second));
  else { files['OPS/Text/first.xhtml'] = strToU8(xhtml(first)); files['OPS/Text/second.xhtml'] = strToU8(xhtml(second)); }
  if (options.drm) files['META-INF/encryption.xml'] = strToU8('<encryption/>');
  if (options.oversized) files['OPS/bomb.xhtml'] = strToU8('x'.repeat(4 * 1024 * 1024 + 1));
  return Buffer.from(zipSync(files));
}
async function start(page: Page) {
  const external: string[] = [];
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://evil.example')) external.push(request.url());
    if (/\/api\//.test(request.url())) apiRequests.push(request.url());
  });
  await page.route('**/api/**', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return { external, apiRequests };
}
async function openFiles(page: Page, mobile = false) {
  if (mobile) await page.getByRole('button', { name: '목차 열기' }).click();
  await page.getByRole('button', { name: '파일 등록' }).click();
  await page.getByRole('tab', { name: 'EPUB / TXT', exact: true }).click();
}
async function upload(page: Page, name: string, buffer: Buffer) {
  await page.getByLabel('EPUB / TXT 파일').setInputFiles({ name, mimeType: name.endsWith('.epub') ? 'application/epub+zip' : 'text/plain', buffer });
}
async function parse(page: Page, name: string, buffer: Buffer, encoding = 'utf-8') {
  return page.evaluate(async ({ name, bytes, encoding }) => {
    const modulePath = '/src/services/fileImport.ts';
    const { previewFile, fileNovels } = await import(modulePath);
    try {
      const preview = await previewFile(new File([new Uint8Array(bytes)], name), encoding);
      return { preview, novels: await fileNovels(preview, preview.title), error: '' };
    } catch (problem) { return { error: (problem as Error).message, preview: null, novels: [] }; }
  }, { name, bytes: Array.from(buffer), encoding });
}

test('EPUB 2 NCX and EPUB 3 anchor TOCs preserve order, dialogue and stable IDs', async ({ page }) => {
  const { external } = await start(page);
  for (const options of [{ ncx: true }, { sameFile: true }]) {
    const bytes = epub(options);
    const first = await parse(page, 'book.epub', bytes);
    expect(first.error).toBe('');
    expect(first.preview?.chapters.map((c: { title: string }) => c.title)).toEqual(['Chapter 1: The River', 'Chapter 2: The Bridge']);
    expect(first.novels[0].paragraphs[0].text).toBe('Speaker: [Good morning.]\nHe smiled.');
    expect(JSON.stringify(first.novels)).not.toMatch(/Unwanted menu|Hidden ad|epubExecuted|tracker/);
    const again = await parse(page, 'renamed.epub', bytes);
    expect(again.novels.map((n: { id: string }) => n.id)).toEqual(first.novels.map((n: { id: string }) => n.id));
    expect(again.novels[0].paragraphs).toEqual(first.novels[0].paragraphs);
  }
  expect(external).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__epubExecuted)).toBeUndefined();
});

test('rejects DRM, external spine, oversized archive documents, corrupt files and oversized paragraphs', async ({ page }) => {
  await start(page);
  for (const [options, error] of [[{ drm: true }, 'DRM'], [{ external: true }, '외부'], [{ oversized: true }, '너무 큽니다']] as const) {
    const result = await parse(page, 'unsafe.epub', epub(options));
    expect(result.error).toContain(error);
  }
  expect((await parse(page, 'broken.epub', Buffer.from('not a zip'))).error).toContain('열 수 없습니다');
  expect((await parse(page, 'large.txt', Buffer.from('x'.repeat(6001)))).error).toContain('6,000자');
});

test('TXT supports heading detection, UTF-16, encoding errors and plain text fallback', async ({ page }) => {
  await start(page);
  const result = await parse(page, 'story.txt', Buffer.from('제1화 강가\r\nFirst paragraph.\r\n\r\nSpeaker: [Hello.]\r\nHe waved.\r\n\r\n제2화 다리\r\nAnother paragraph.', 'utf16le'), 'utf-16le');
  expect(result.error).toBe('');
  expect(result.preview?.chapters).toHaveLength(2);
  expect(result.novels[0].paragraphs.map((p: { text: string }) => p.text)).toEqual(['First paragraph.', 'Speaker: [Hello.]\nHe waved.']);
  expect((await parse(page, 'plain.txt', Buffer.from('One paragraph.\n\nAnother paragraph.'))).preview?.chapters).toHaveLength(1);
  expect((await parse(page, 'invalid.txt', Buffer.from([0xff, 0xff]))).error).toContain('인코딩');
});


test('desktop EPUB book, read status and bookmarks survive refresh and duplicate import without any API', async ({ page }) => {
  const { external, apiRequests } = await start(page);
  const bytes = epub();
  await openFiles(page);
  await upload(page, 'reader.epub', bytes);
  await expect(page.getByLabel('등록할 목차').locator('li')).toHaveCount(2);
  await page.getByRole('button', { name: '2개 화 서재에 등록' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chapter 1: The River');
  await expect(page.getByLabel('서재 책 선택').locator('option')).toHaveCount(2);
  await page.getByRole('button', { name: '문단 1 북마크 저장', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator('.chapter-status').first()).toHaveText('읽음');
  await page.getByRole('button', { name: '다음 화', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chapter 2: The Bridge');
  await page.evaluate(() => window.scrollTo(0, 780));
  await expect.poll(() => page.evaluate(() => { const key = Object.keys(localStorage).find((k) => k.startsWith('folio:v1:progress:file-')); return key && JSON.parse(localStorage.getItem(key)!).scrollY; })).toBe(780);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chapter 2: The Bridge');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(700);
  await expect(page.locator('.chapter-status').first()).toHaveText('읽음');
  await page.getByRole('tab', { name: '북마크 1' }).click();
  await page.locator('.bookmark-jump').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chapter 1: The River');
  await openFiles(page);
  await upload(page, 'renamed.epub', bytes);
  await page.getByRole('button', { name: '2개 화 서재에 등록' }).click();
  await expect(page.getByLabel('서재 책 선택').locator('option')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: '북마크 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: /번역하기|번역 재시도|한국어|로그인/ })).toHaveCount(0);
  expect(apiRequests).toEqual([]);
  expect(external).toEqual([]);
});

test('catalog keeps 116 original links and B chapter search without an import endpoint', async ({ page }) => {
  const { apiRequests } = await start(page);
  await page.getByRole('button', { name: '파일 등록' }).click();
  await page.getByRole('tab', { name: 'WCT 7장 목차' }).click();
  await expect(page.locator('.catalog-list > li')).toHaveCount(116);
  await page.getByLabel('화 번호 또는 제목 검색').fill('54B');
  await expect(page.locator('.catalog-list > li')).toHaveCount(1);
  await expect(page.getByRole('link', { name: '54B화 원본 페이지 열기' })).toHaveAttribute('href', 'https://witchculttranslation.com/2022/05/08/arc-7-chapter-54b-covering-the-blue-sky/');
  await expect(page.getByRole('button', { name: /등록 준비|한 화 가져오기/ })).toHaveCount(0);
  expect(apiRequests).toEqual([]);
});

test.describe('mobile file library', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('TXT registration, paged reading, chapter navigation and bookmarks work without a server', async ({ page }) => {
    const { apiRequests } = await start(page);
    await openFiles(page, true);
    const prose = Array.from({ length: 28 }, (_, i) => `Paragraph ${i + 1}. A traveler followed the river and thought about the long quiet road ahead. The leaves moved softly in the wind.`).join('\n\n');
    await upload(page, 'mobile.txt', Buffer.from(`Chapter 1: Morning\n\n${prose}\n\nChapter 2: Evening\n\n${prose}`));
    await page.getByRole('button', { name: '2개 화 서재에 등록' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByRole('button', { name: '읽기 설정', exact: true }).click();
    await page.getByRole('button', { name: '가로 페이지', exact: true }).click();
    await page.getByRole('button', { name: '읽기 설정 닫기' }).click();
    await expect.poll(() => page.locator('.page-count').innerText()).not.toBe('1 / 1');
    await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
    await page.locator('.paged-paragraph:not([aria-hidden="true"]) .paragraph-bookmark[tabindex="0"]').first().click();
    await page.getByRole('button', { name: '목차 열기' }).click();
    await page.getByRole('button', { name: /02 Chapter 2: Evening/ }).click();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chapter 2: Evening');
    await page.getByRole('button', { name: '목차 열기' }).click();
    await page.getByRole('tab', { name: '북마크 1' }).click();
    await page.locator('.bookmark-jump').click();
    await expect(page.locator('.chapter-heading h1')).toHaveText('Chapter 1: Morning');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: '목차 열기' }).click();
    await page.getByRole('button', { name: '파일 등록' }).click();
    await page.getByRole('tab', { name: 'WCT 7장 목차' }).click();
    await expect(page.locator('.catalog-list > li')).toHaveCount(116);
    expect(apiRequests).toEqual([]);
  });
});
