import type { ImportedNovel } from '../../shared/novels';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const sourceUrl = (value: unknown) => typeof value === 'string' && (/^https:\/\/(?:www\.)?witchculttranslation\.com\//.test(value) || /^folio-file:[a-f0-9]{64}#[^\s]+$/.test(value));

/** Diagnose fields only; never include titles, text, URLs or identifiers in a report. */
export function savedNovelIssues(value: unknown): string[] {
  if (!record(value)) return ['레코드 형식'];
  const issues: string[] = [];
  if (![value.id, value.chapterId, value.title].every(nonempty)) issues.push('도서·화 식별 정보');
  const source = record(value.source) ? value.source : {};
  if (!sourceUrl(source.url)) issues.push('원문 주소 메타데이터');
  if (typeof source.url === 'string' && source.url.startsWith('folio-file:') && !['epub', 'txt'].includes(source.kind as string)) issues.push('파일 형식 메타데이터');
  if (typeof source.hash !== 'string' || !/^[a-f0-9]{64}$/.test(source.hash)) issues.push('원문 해시 메타데이터');
  if (!Number.isInteger(source.arc) || !Number.isInteger(source.chapter)) issues.push('장·화 번호 메타데이터');
  if (!Array.isArray(value.paragraphs) || !value.paragraphs.length || value.paragraphs.some(p => !record(p) || !nonempty(p.id) || typeof p.text !== 'string')) issues.push('문단 식별자·본문 구조');
  else if (new Set(value.paragraphs.map(p => p.id)).size !== value.paragraphs.length) issues.push('중복 문단 식별자');
  if (value.collection !== undefined && (!record(value.collection) || !nonempty(value.collection.id) || !nonempty(value.collection.title) || !Number.isInteger(value.collection.order))) issues.push('책 묶음 메타데이터');
  return issues;
}
export function validNovel(value: unknown): value is ImportedNovel { return savedNovelIssues(value).length === 0; }

/** A view adapter, not a migration: IDs, paragraphs and stored records stay intact. */
export function readSavedNovel(value: unknown): ImportedNovel | null {
  if (!record(value) || ![value.id, value.chapterId, value.title].every(nonempty) || !record(value.source)) return null;
  if (!Array.isArray(value.paragraphs) || !value.paragraphs.length || value.paragraphs.some(p => !record(p) || !nonempty(p.id) || typeof p.text !== 'string') || new Set(value.paragraphs.map(p => p.id)).size !== value.paragraphs.length) return null;
  const integer = (n: unknown, fallback: number) => Number.isSafeInteger(n) ? n as number : typeof n === 'string' && /^\d+$/.test(n) && Number.isSafeInteger(Number(n)) ? Number(n) : fallback;
  const collection = value.collection;
  if (collection !== undefined && (!record(collection) || !nonempty(collection.id) || !nonempty(collection.title) || integer(collection.order, -1) < 0)) return null;
  const source = value.source;
  return {
    id: value.id as string, chapterId: value.chapterId as string, title: value.title as string,
    paragraphs: value.paragraphs as ImportedNovel['paragraphs'],
    ...(record(collection) ? {collection: {id: collection.id as string, title: collection.title as string, author: typeof collection.author === 'string' ? collection.author : '저자 미상', order: integer(collection.order, 0)}} : {}),
    source: {
      ...source, url: sourceUrl(source.url) ? source.url as string : '', hash: typeof source.hash === 'string' ? source.hash : '',
      kind: ['epub', 'txt', 'wct', 'manual'].includes(source.kind as string) ? source.kind as ImportedNovel['source']['kind'] : 'manual',
      arc: integer(source.arc, 1), chapter: integer(source.chapter, 1), importedAt: typeof source.importedAt === 'string' ? source.importedAt : '',
      attribution: typeof source.attribution === 'string' ? source.attribution : '이 기기에 저장된 원문',
    },
  };
}
export interface LibraryReport {
  database: 'present' | 'absent';
  version: number | null;
  total: number;
  valid: number;
  compatible: number;
  excluded: number;
  reasons: Record<string, number>;
}
export function inspectSavedNovels(values: unknown[], version: number | null) {
  const novels: ImportedNovel[] = [], reasons: Record<string, number> = {};
  let valid = 0, compatible = 0;
  for (const value of values) {
    const issues = savedNovelIssues(value), novel = readSavedNovel(value);
    issues.forEach(reason => { reasons[reason] = (reasons[reason] ?? 0) + 1; });
    if (novel) { novels.push(novel); if (!issues.length) valid++; else compatible++; }
  }
  return {novels, report: {database: version === null ? 'absent' : 'present', version, total: values.length, valid, compatible, excluded: values.length - novels.length, reasons} satisfies LibraryReport};
}
