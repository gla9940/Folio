import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import ipaddr from 'ipaddr.js';
import robotsParser from 'robots-parser';
import { load } from 'cheerio';
import { createNovel, FolioError, normalizeText } from '../shared/novels.ts';
import type { ImportedNovel, NovelSource } from '../shared/novels.ts';

const HOSTS = new Set(['witchculttranslation.com', 'www.witchculttranslation.com']);
export const SOURCE_AGENT = 'FolioReader';
export function validateSourceUrl(value: string, robots = false): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new FolioError('INVALID_URL', '올바른 Witch Cult Translations 화 URL을 입력해 주세요.'); }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.username || url.password || url.port || url.search ||
    (robots ? url.pathname !== '/robots.txt' : !/^\/\d{4}\/\d{2}\/\d{2}\/arc-\d+-chapter-\d+(?:-\d+)?-[a-z0-9-]+\/$/i.test(url.pathname))) {
    throw new FolioError('URL_NOT_ALLOWED', 'HTTPS Witch Cult Translations의 개별 화 URL만 허용합니다. 검색·목차·외부 주소는 가져오지 않습니다.');
  }
  url.hash = '';
  return url;
}
export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export interface SourceResponse { status: number; body: string; url: string; headers: Record<string, string | undefined> }
export type SourceFetch = (url: URL, robots?: boolean) => Promise<SourceResponse>;
export const fetchSource: SourceFetch = async (initial, robots = false) => {
  let url = validateSourceUrl(initial.href, robots);
  for (let hop = 0; hop <= 2; hop++) {
    // Pin DNS to a checked public IP. The TLS hostname remains the original allowed host.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new FolioError('SOURCE_DNS', '원문 서버의 주소 확인이 지연되어 중단했습니다.', 502)), 2000); }),
    ]).finally(() => clearTimeout(timer));
    if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) throw new FolioError('UNSAFE_ADDRESS', '대상 서버의 네트워크 주소를 안전하게 확인할 수 없습니다.', 403);
    const pinned = addresses.find((item) => item.family === 4) ?? addresses[0];
    const result = await new Promise<SourceResponse>((resolve, reject) => {
      const req = request(url, {
        family: pinned.family,
        lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
        signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': `${SOURCE_AGENT}/0.1 (personal single-chapter reader)`, Accept: robots ? 'text/plain' : 'text/html', 'Accept-Encoding': 'identity' },
      }, (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > (robots ? 256_000 : 2_000_000)) req.destroy(new Error('SOURCE_TOO_LARGE'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode ?? 500, url: url.href, body: Buffer.concat(chunks).toString('utf8'), headers: { location: res.headers.location, 'content-type': res.headers['content-type'], 'x-robots-tag': String(res.headers['x-robots-tag'] ?? '') } }));
      });
      req.on('error', () => reject(new FolioError('SOURCE_UNAVAILABLE', '원문 서버에 접근하지 못했습니다. 제한을 우회하지 않고 수동 입력을 이용해 주세요.', 502)));
      req.end();
    });
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      if (!result.headers.location || hop === 2) throw new FolioError('SOURCE_REDIRECT', '원문 리다이렉트를 확인할 수 없습니다. 수동 입력을 이용해 주세요.', 403);
      try { url = validateSourceUrl(new URL(result.headers.location, url).href, robots); }
      catch { throw new FolioError('SOURCE_REDIRECT', '외부 또는 허용되지 않은 경로로 이동하는 원문입니다. 리다이렉트를 따라가지 않습니다.', 403); }
      continue;
    }
    return result;
  }
  throw new FolioError('SOURCE_REDIRECT', '리다이렉트가 너무 많습니다.', 403);
};

export function checkRobots(body: string, url: string): boolean {
  const robots = robotsParser(new URL('/robots.txt', url).href, body);
  return /^\s*user-agent:/im.test(body) && robots.isAllowed(url, SOURCE_AGENT) !== false && !((robots.getCrawlDelay(SOURCE_AGENT) ?? 0) > 0);
}
export async function extractWctHtml(html: string, url: string, policy?: NovelSource['policy']): Promise<ImportedNovel> {
  const validated = validateSourceUrl(url);
  const $ = load(html);
  if (/noai|notranslate|noarchive/i.test($('meta[name="robots"],meta[name="FolioReader"]').map((_, element) => $(element).attr('content')).get().join(' '))) throw new FolioError('SOURCE_RESTRICTED', '원문의 자동 처리 제한 표시를 확인했습니다. 수동 입력을 이용해 주세요.', 403);
  const title = normalizeText($('.entry-title').first().text());
  const numbers = title.match(/Arc\s+(\d+),?\s*Chapter\s+(\d+)/i);
  const pathNumbers = validated.pathname.match(/arc-(\d+)-chapter-(\d+)/i)!;
  const entry = $('.entry-content').first();
  if (!numbers || numbers[1] !== pathNumbers[1] || numbers[2] !== pathNumbers[2] || !entry.length) throw new FolioError('SOURCE_STRUCTURE', '예상한 영어 화 구조가 아닙니다. 수동 원문 입력을 이용해 주세요.', 422);
  entry.find('script,style,iframe,form,nav,aside,figure,button,svg,.sharedaddy,.adsbygoogle,.advertisement,.comments,.wp-block-buttons,[aria-hidden="true"]').remove();
  entry.find('br').replaceWith('\n');
  const paragraphs = entry.find('p').map((_, element) => normalizeText($(element).text())).get().filter(Boolean);
  const sourceMarker = paragraphs.findIndex((text) => /^JAPANESE WEB NOVEL SOURCE$/i.test(text));
  if (sourceMarker < 0) throw new FolioError('SOURCE_STRUCTURE', '본문 시작 경계를 확인할 수 없습니다. 메뉴나 광고를 본문으로 가져오지 않습니다.', 422);
  let texts = paragraphs.slice(sourceMarker + 1);
  while (texts.length && /^[※\s]+$/.test(texts[0])) texts.shift();
  const notes = texts.findIndex((text) => /^Translation notes\s*:/i.test(text));
  if (notes >= 0) texts = texts.slice(0, notes);
  texts = texts.filter((text) => !/^\s*(?:Previous Chapter|Next Chapter|Share this:|Like this:)\s*$/i.test(text));
  if (texts.join('').replace(/[^A-Za-z]/g, '').length < texts.join('').length * .35) throw new FolioError('SOURCE_LANGUAGE', '영어 본문을 확인하지 못했습니다.', 422);
  const credits = entry.find('ul').slice(0, 2).text().replace(/\s+/g, ' ').trim();
  return createNovel({ url: validated.href, title, texts, arc: Number(numbers[1]), chapter: Number(numbers[2]), kind: 'wct', attribution: `Witch Cult Translations · ${credits || '영어 번역팀'} · 원작 Tappei Nagatsuki`, policy });
}
export async function importWctChapter(value: string, env: NodeJS.ProcessEnv, fetcher: SourceFetch = fetchSource): Promise<ImportedNovel> {
  const url = validateSourceUrl(value);
  // robots permission is technical crawl permission, not a grant to reproduce or translate.
  if (env.WCT_IMPORT_ALLOWED !== 'true' || !env.WCT_POLICY_REVIEW_URL || !/^https:\/\//.test(env.WCT_POLICY_REVIEW_URL) || !env.WCT_POLICY_REVIEWED_AT || !Number.isFinite(Date.parse(env.WCT_POLICY_REVIEWED_AT))) {
    throw new FolioError('POLICY_REVIEW_REQUIRED', '원문 사이트의 수집·재번역 이용 조건 검토가 설정되지 않았습니다. 허용된 영어 원문을 수동으로 입력해 주세요.', 403);
  }
  const robots = await fetcher(new URL('/robots.txt', url), true);
  if ((robots.status !== 200 && robots.status !== 404) || (robots.status === 200 && !checkRobots(robots.body, url.href))) throw new FolioError('ROBOTS_DENIED', 'robots.txt 정책 또는 접근 상태가 자동 가져오기를 허용하지 않습니다. 수동 입력을 이용해 주세요.', 403);
  const response = await fetcher(url);
  if (response.status !== 200 || !/text\/html/i.test(response.headers['content-type'] ?? '') || /noai|notranslate|noarchive/i.test(response.headers['x-robots-tag'] ?? '')) throw new FolioError('SOURCE_RESTRICTED', `원문 서버 응답(${response.status}) 또는 자동 처리 제한으로 가져오기를 중단했습니다.`, 403);
  return extractWctHtml(response.body, response.url, { robotsCheckedAt: new Date().toISOString(), reviewUrl: env.WCT_POLICY_REVIEW_URL, reviewedAt: env.WCT_POLICY_REVIEWED_AT });
}
