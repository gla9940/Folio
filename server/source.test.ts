import { describe, expect, it, vi } from 'vitest';
import { checkRobots, extractWctHtml, importWctChapter, isPublicAddress, validateSourceUrl } from './source';
const url = 'https://witchculttranslation.com/2021/01/29/arc-7-chapter-2-animal-tracking/';
const html = `<html><h1 class="entry-title">Arc 7, Chapter 2 – Animal Tracking</h1><div class="entry-content"><p>Translated By :</p><ul><li>Test translator</li></ul><p>ALL RIGHTS BELONG TO THE AUTHOR</p><p>JAPANESE WEB NOVEL SOURCE</p><p>※ ※ ※</p><div class="advertisement"><p>Advertising content.</p></div><p>A traveler reached the quiet village.</p><p>Speaker: [Good evening.]<br>Another line.</p><p>Translation notes:</p><p>Unrelated notes.</p></div><div id="comments"><p>A reader comment.</p></div></html>`;
describe('single chapter source guard', () => {
  it('allows only exact HTTPS chapter hosts and rejects SSRF variations', () => {
    expect(validateSourceUrl(url).href).toBe(url);
    for (const invalid of ['http://witchculttranslation.com/2021/01/29/arc-7-chapter-2-animal-tracking/', 'https://witchculttranslation.com.evil.test/' , 'https://witchculttranslation.com@127.0.0.1/', 'https://127.0.0.1/', url + '?next=http://localhost', 'https://witchculttranslation.com/wp-admin/', 'https://witchculttranslation.com/arc-7/', url.replace('.com/', '.com:444/')]) expect(() => validateSourceUrl(invalid)).toThrow();
    for (const address of ['127.0.0.1', '10.2.3.4', '192.168.1.2', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '2001:db8::1']) expect(isPublicAddress(address)).toBe(false);
    expect(isPublicAddress('1.1.1.1')).toBe(true);
  });
  it('respects general and bot-specific robots rules', () => {
    expect(checkRobots('User-agent: *\nDisallow: /wp-admin/', url)).toBe(true);
    expect(checkRobots('User-agent: *\nDisallow: /2021/', url)).toBe(false);
    expect(checkRobots('User-agent: *\nAllow: /\nUser-agent: FolioReader\nDisallow: /', url)).toBe(false);
  });
  it('extracts only body paragraphs and preserves IDs and br structure', async () => {
    const first = await extractWctHtml(html, url);
    const second = await extractWctHtml(html, url);
    expect(first.paragraphs.map((p) => p.text)).toEqual(['A traveler reached the quiet village.', 'Speaker: [Good evening.]\nAnother line.']);
    expect(first.paragraphs).toEqual(second.paragraphs);
    expect(first.source).toMatchObject({ arc: 7, chapter: 2, url, kind: 'wct' });
    expect(first.source.attribution).toContain('Test translator');
  });
  it('fails closed on unknown structure or processing restrictions', async () => {
    await expect(extractWctHtml('<div>Access restricted</div>', url)).rejects.toMatchObject({ code: 'SOURCE_STRUCTURE' });
    await expect(extractWctHtml('<meta name="robots" content="noai">' + html, url)).rejects.toMatchObject({ code: 'SOURCE_RESTRICTED' });
  });
  it('does not request content without an operator policy review or robots permission', async () => {
    const fetcher = vi.fn();
    await expect(importWctChapter(url, {}, fetcher)).rejects.toMatchObject({ code: 'POLICY_REVIEW_REQUIRED' });
    expect(fetcher).not.toHaveBeenCalled();
    const env = { WCT_IMPORT_ALLOWED: 'true', WCT_POLICY_REVIEW_URL: 'https://witchculttranslation.com/', WCT_POLICY_REVIEWED_AT: '2026-10-19' };
    fetcher.mockResolvedValue({ status: 200, body: 'User-agent: *\nDisallow: /', url, headers: {} });
    await expect(importWctChapter(url, env, fetcher)).rejects.toMatchObject({ code: 'ROBOTS_DENIED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('imports one permitted chapter and records review provenance', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ status: 200, body: 'User-agent: *\nDisallow: /wp-admin/', headers: {}, url }).mockResolvedValueOnce({ status: 200, body: html, url, headers: { 'content-type': 'text/html' } });
    const result = await importWctChapter(url, { WCT_IMPORT_ALLOWED: 'true', WCT_POLICY_REVIEW_URL: 'https://witchculttranslation.com/', WCT_POLICY_REVIEWED_AT: '2026-10-19' }, fetcher);
    expect(result.source.policy?.reviewedAt).toBe('2026-10-19');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
