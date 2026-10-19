import { fetchSource, checkRobots, extractWctHtml, validateSourceUrl } from '../server/source.ts';

// An explicit one-chapter diagnostic. Prints metadata only; never commits the novel text.
const url = validateSourceUrl(process.argv[2] ?? 'https://witchculttranslation.com/2021/01/29/arc-7-chapter-2-animal-tracking/');
const robots = await fetchSource(new URL('/robots.txt', url), true);
if (robots.status !== 200 || !checkRobots(robots.body, url.href)) throw Error('robots 또는 접근 제한으로 중단했습니다.');
const response = await fetchSource(url);
if (response.status !== 200) throw Error(`원문 접근 실패: ${response.status}`);
const novel = await extractWctHtml(response.body, response.url);
console.log(JSON.stringify({ title: novel.title, arc: novel.source.arc, chapter: novel.source.chapter, paragraphs: novel.paragraphs.length, characters: novel.paragraphs.reduce((sum, p) => sum + p.text.length, 0), sourceHash: novel.source.hash, robotsAllowed: true, policyPermissionVerified: false, note: 'HTTP/robots/추출 진단입니다. 수집·재번역 허가나 Gemini 실제 번역 검증을 의미하지 않습니다.' }, null, 2));
