import { unzipSync, strFromU8 } from 'fflate';
import { createNovel, normalizeText, sha256 } from '../../shared/novels';
import type { ImportedNovel } from '../../shared/novels';

export interface FileChapter { key: string; title: string; texts: string[] }
export interface FilePreview { title: string; author: string; kind: 'epub' | 'txt'; hash: string; chapters: FileChapter[] }
const MAX_FILE = 20 * 1024 * 1024;
const MAX_TEXT = 10_000_000;
function xml(value: string): Document {
  if (/<!ENTITY/i.test(value)) throw Error('사용자 정의 XML 엔티티가 있는 EPUB은 지원하지 않습니다.');
  const doc = new DOMParser().parseFromString(value.replace(/&nbsp;/g, '&#160;'), 'application/xml');
  if (doc.querySelector('parsererror')) throw Error('EPUB의 XML/XHTML 구조가 올바르지 않습니다.');
  return doc;
}
const elements = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS('*', name));
const text = (node: Node | null | undefined) => normalizeText(node?.textContent ?? '');
// Resolve only archive paths. Never fetch resources referenced by an uploaded file.
function resolvePath(base: string, href: string): { path: string; fragment: string } {
  if (!href || /^[a-z][a-z\d+.-]*:|^\/|\\|\?/i.test(href)) throw Error('EPUB 내부에 외부 또는 허용되지 않은 경로가 있습니다.');
  const [raw, ...hash] = href.split('#');
  const parts = (raw ? `${base.slice(0, base.lastIndexOf('/') + 1)}${raw}` : base).split('/');
  const output: string[] = [];
  for (const part of parts) {
    let decoded: string;
    try { decoded = decodeURIComponent(part); } catch { throw Error('EPUB 경로의 문자 인코딩이 올바르지 않습니다.'); }
    if (/[\\/\u0000-\u001f]/.test(decoded)) throw Error('EPUB 내부 경로를 확인할 수 없습니다.');
    if (decoded === '..') { if (!output.length) throw Error('EPUB 경로가 파일 밖을 가리킵니다.'); output.pop(); }
    else if (decoded && decoded !== '.') output.push(decoded);
  }
  return { path: output.join('/'), fragment: decodeURIComponent(hash.join('#')) };
}
interface TocEntry { path: string; fragment: string; title: string }
const OMIT = new Set(['script', 'style', 'nav', 'aside', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'button', 'audio', 'video', 'head']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'tr']);
function extractSections(doc: Document, path: string, toc: TocEntry[], fallback: string): FileChapter[] {
  const body = elements(doc, 'body')[0];
  if (!body) throw Error('EPUB 본문 body를 찾지 못했습니다.');
  const targets = toc.filter((entry) => entry.path === path);
  const markers = new Map(targets.filter((entry) => entry.fragment).map((entry) => [entry.fragment, entry.title]));
  let section: FileChapter = { key: path, title: targets.find((e) => !e.fragment)?.title || text(elements(body, 'h1')[0]) || fallback, texts: [] };
  const result: FileChapter[] = [];
  let buffer = '';
  const flush = () => { const value = normalizeText(buffer); if (value) section.texts.push(value); buffer = ''; };
  const finish = () => { flush(); if (section.texts.length) result.push(section); };
  const visit = (node: Node, preserveSpace = false) => {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) { const value = node.textContent ?? ''; buffer += preserveSpace ? value.replace(/\r\n?/g, '\n') : value.replace(/[\t\r\n ]+/g, ' '); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    const name = element.localName.toLowerCase();
    if (OMIT.has(name) || element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true' || /(?:^|[;\s])(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(element.getAttribute('style') ?? '')) return;
    const id = element.getAttribute('id') ?? element.getAttribute('name');
    if (id && markers.has(id)) { finish(); section = { key: `${path}#${id}`, title: markers.get(id)!, texts: [] }; }
    if (name === 'br') { buffer += '\n'; return; }
    if (name === 'hr') { flush(); section.texts.push('✧'); return; }
    if (BLOCK.has(name)) flush();
    for (const child of element.childNodes) visit(child, preserveSpace || name === 'pre' || element.getAttribute('xml:space') === 'preserve');
    if (BLOCK.has(name)) flush();
  };
  visit(body); finish();
  return result.map((entry) => {
    if (entry.texts.length > 1 && entry.texts[0] === entry.title) entry.texts.shift();
    return entry;
  });
}
function parseEpub(bytes: Uint8Array, filename: string): Omit<FilePreview, 'hash' | 'kind'> {
  let size = 0; let count = 0;
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes, { filter: (entry) => {
      if (++count > 3000 || (size += entry.originalSize) > 80 * 1024 * 1024) throw Error('EPUB 압축 해제 크기 또는 파일 수 제한을 넘었습니다.');
      if (/(?:^|\/)\.\.(?:\/|$)|^\/|\\|\u0000/.test(entry.name)) throw Error('안전하지 않은 EPUB 내부 경로입니다.');
      const needed = /\.(?:xml|xhtml|html|htm|opf|ncx)$/i.test(entry.name) || entry.name === 'mimetype';
      if (needed && entry.originalSize > 4 * 1024 * 1024) throw Error('EPUB 내부 문서가 너무 큽니다.');
      return needed;
    } });
  } catch (error) { throw Error(`EPUB을 열 수 없습니다. ${error instanceof Error ? error.message : '손상되었거나 암호화된 파일입니다.'}`); }
  if (archive['META-INF/encryption.xml']) throw Error('암호화/DRM EPUB은 지원하지 않습니다. 암호화를 우회하지 않습니다.');
  const read = (path: string) => { const data = archive[path]; if (!data) throw Error(`EPUB 내부 문서를 찾지 못했습니다: ${path.slice(0, 100)}`); return xml(strFromU8(data)); };
  if (strFromU8(archive.mimetype ?? new Uint8Array()).trim() !== 'application/epub+zip') throw Error('EPUB 형식 식별자가 없습니다.');
  const root = elements(read('META-INF/container.xml'), 'rootfile')[0]?.getAttribute('full-path');
  if (!root) throw Error('EPUB 패키지 경로를 찾지 못했습니다.');
  const packagePath = resolvePath('', root).path;
  const opf = read(packagePath);
  const manifest = new Map(elements(opf, 'item').map((item) => [item.getAttribute('id'), item]));
  const metadata = elements(opf, 'metadata')[0];
  const title = text(metadata && elements(metadata, 'title')[0]) || filename.replace(/\.epub$/i, '');
  const author = text(metadata && elements(metadata, 'creator')[0]).slice(0, 200) || '저자 미상';
  const toc: TocEntry[] = [];
  const nav = [...manifest.values()].find((item) => item.getAttribute('properties')?.split(/\s+/).includes('nav'));
  if (nav) {
    const navPath = resolvePath(packagePath, nav.getAttribute('href') ?? '').path;
    const navDoc = read(navPath);
    const rootNav = elements(navDoc, 'nav').find((element) => /(?:^|\s)toc(?:\s|$)/.test(element.getAttribute('epub:type') ?? element.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? '') || element.getAttribute('role') === 'doc-toc');
    if (rootNav) for (const anchor of elements(rootNav, 'a')) { try { toc.push({ ...resolvePath(navPath, anchor.getAttribute('href') ?? ''), title: text(anchor) }); } catch { /* External navigation is not book content. */ } }
  }
  if (!toc.length) {
    const spineToc = elements(opf, 'spine')[0]?.getAttribute('toc');
    const ncx = manifest.get(spineToc) ?? [...manifest.values()].find((item) => item.getAttribute('media-type') === 'application/x-dtbncx+xml');
    if (ncx) {
      const ncxPath = resolvePath(packagePath, ncx.getAttribute('href') ?? '').path;
      for (const point of elements(read(ncxPath), 'navPoint')) {
        const content = elements(point, 'content')[0];
        try { toc.push({ ...resolvePath(ncxPath, content?.getAttribute('src') ?? ''), title: text(elements(point, 'navLabel')[0]) }); } catch { /* Ignore external navigation. */ }
      }
    }
  }
  const chapters: FileChapter[] = [];
  const visited = new Set<string>();
  for (const ref of elements(opf, 'itemref')) {
    if (ref.getAttribute('linear') === 'no') continue;
    const item = manifest.get(ref.getAttribute('idref'));
    if (!item) throw Error('EPUB 읽기 순서에 누락된 문서가 있습니다.');
    if (item === nav) continue;
    if (!['application/xhtml+xml', 'text/html'].includes(item.getAttribute('media-type') ?? '')) throw Error('텍스트 XHTML이 아닌 EPUB 본문은 지원하지 않습니다.');
    const path = resolvePath(packagePath, item.getAttribute('href') ?? '').path;
    if (visited.has(path)) continue;
    visited.add(path);
    chapters.push(...extractSections(read(path), path, toc, `Chapter ${chapters.length + 1}`));
  }
  return { title, author, chapters };
}
function parseTxt(bytes: Uint8Array, filename: string, encoding: string): Omit<FilePreview, 'hash' | 'kind'> {
  let content: string;
  try { content = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw Error('텍스트 인코딩이 맞지 않습니다. UTF-8 / UTF-16 / EUC-KR 설정을 바꿔 다시 선택해 주세요.'); }
  content = normalizeText(content).replace(/^\uFEFF/, '');
  if (content.includes('\0')) throw Error('텍스트 파일이 아닙니다. 인코딩 또는 파일 형식을 확인해 주세요.');
  const title = filename.replace(/\.txt$/i, '');
  const chapters: FileChapter[] = [];
  let section: FileChapter = { key: 'start', title, texts: [] };
  let lines: string[] = [];
  const flush = () => { const paragraph = normalizeText(lines.join('\n')); if (paragraph) section.texts.push(paragraph); lines = []; };
  for (const line of content.split('\n')) {
    if (line.length <= 200 && /^\s*(?:(?:arc\s+\d+[,\s]+)?chapter\s+\d+\b|제?\s*\d+\s*[화장](?:\s|[.:：·—–-]|$))/i.test(line)) {
      flush(); if (section.texts.length) chapters.push(section);
      section = { key: `section-${chapters.length}`, title: line.trim(), texts: [] };
    } else if (!line.trim()) flush(); else lines.push(line);
  }
  flush(); if (section.texts.length) chapters.push(section);
  return { title, author: '저자 미상', chapters };
}
export async function previewFile(file: File, encoding = 'utf-8'): Promise<FilePreview> {
  const kind = file.name.toLowerCase().endsWith('.epub') ? 'epub' : file.name.toLowerCase().endsWith('.txt') ? 'txt' : null;
  if (!kind) throw Error('EPUB 또는 TXT 파일을 선택해 주세요.');
  if (!file.size || file.size > MAX_FILE) throw Error('파일은 0바이트보다 크고 20MB 이하여야 합니다.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const data = kind === 'epub' ? parseEpub(bytes, file.name) : parseTxt(bytes, file.name, encoding);
  if (!data.chapters.length || data.chapters.length > 500) throw Error('읽을 수 있는 본문이 없거나 500개 장을 초과했습니다.');
  if (data.chapters.reduce((sum, chapter) => sum + chapter.texts.join('').length, 0) > MAX_TEXT) throw Error('전체 본문은 1,000만 자 이하여야 합니다.');
  // Validate everything before any IndexedDB write; never silently truncate prose.
  for (const chapter of data.chapters) if (chapter.texts.length > 2500 || chapter.texts.join('').length > 150_000 || chapter.texts.some((p) => p.length > 6000)) throw Error(`${chapter.title.slice(0, 60)}: 화별 15만 자·2,500문단·문단별 6,000자 제한을 넘었습니다. 파일을 나누어 주세요.`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  return { ...data, kind, hash };
}
export async function fileNovels(preview: FilePreview, title: string): Promise<ImportedNovel[]> {
  if (!title.trim() || title.length > 200) throw Error('책 제목은 1~200자로 입력해 주세요.');
  const collection = { id: `file-${preview.hash}`, title: title.trim(), author: preview.author };
  const result: ImportedNovel[] = [];
  for (const [order, chapter] of preview.chapters.entries()) {
    const novel = await createNovel({ url: `folio-file:${preview.hash}#${await sha256(chapter.key)}`, title: chapter.title.slice(0, 200), texts: chapter.texts, arc: 1, chapter: order + 1, kind: preview.kind, attribution: `${preview.author} · 사용자가 등록한 ${preview.kind.toUpperCase()} 파일` });
    result.push({ ...novel, collection: { ...collection, order } });
  }
  return result;
}
