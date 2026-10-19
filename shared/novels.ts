export const TRANSLATION_MODEL = 'gemini-3.8-flash';
export const TRANSLATION_VERSION = 'folio-literary-ko-v1';
export const GLOSSARY_VERSION = 'rezero-ko-v1';
export interface SourceParagraph { id: string; text: string }
export interface NovelSource {
  url: string;
  hash: string;
  kind: 'wct' | 'manual' | 'epub' | 'txt';
  importedAt: string;
  arc: number;
  chapter: number;
  attribution: string;
  policy?: { robotsCheckedAt: string; reviewUrl: string; reviewedAt: string };
}
export interface ImportedNovel {
  id: string;
  chapterId: string;
  title: string;
  source: NovelSource;
  paragraphs: SourceParagraph[];
  collection?: { id: string; title: string; author: string; order: number };
}
export interface TranslationBatch {
  id: string;
  paragraphs: SourceParagraph[];
  before: SourceParagraph[];
  after: SourceParagraph[];
}
export interface TranslationRequest extends TranslationBatch {
  sourceHash: string;
  previousTranslation?: SourceParagraph[];
}
export interface TranslationChunk {
  id: string;
  status: 'pending' | 'complete' | 'error';
  paragraphs: SourceParagraph[];
  error?: string;
}
export interface TranslationCache {
  key: string;
  novelId: string;
  sourceUrl: string;
  chapterId: string;
  sourceHash: string;
  model: string;
  version: string;
  glossaryVersion: string;
  chunks: TranslationChunk[];
  updatedAt: string;
}
export class FolioError extends Error {
  code: string;
  status: number;
  retryAfter: number;
  constructor(code: string, message: string, status = 400, retryAfter = 0) {
    super(message); this.code = code; this.status = status; this.retryAfter = retryAfter;
  }
}
export async function sha256(text: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}
export function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
}
export async function createNovel(input: { url: string; title: string; texts: string[]; arc: number; chapter: number; kind: NovelSource['kind']; attribution?: string; policy?: NovelSource['policy'] }): Promise<ImportedNovel> {
  const texts = input.texts.map(normalizeText).filter(Boolean);
  if (!texts.length || texts.length > 2500 || texts.join('').length > 150_000 || texts.some((text) => text.length > 6000)) {
    throw new FolioError('SOURCE_SIZE', '본문은 1~2,500문단, 총 15만 자, 문단별 6,000자 이내로 입력해 주세요.');
  }
  if (!input.title.trim() || input.title.length > 200 || !Number.isInteger(input.arc) || input.arc < 1 || input.arc > 99 || !Number.isInteger(input.chapter) || input.chapter < 1 || input.chapter > 9999) {
    throw new FolioError('SOURCE_METADATA', '제목과 장·화 번호를 확인해 주세요.');
  }
  const identity = (await sha256(input.url)).slice(0, 20);
  const occurrences = new Map<string, number>();
  const paragraphs: SourceParagraph[] = [];
  for (const text of texts) {
    const hash = (await sha256(text)).slice(0, 20);
    const occurrence = (occurrences.get(hash) ?? 0) + 1;
    occurrences.set(hash, occurrence);
    paragraphs.push({ id: `wct-${identity}-p-${hash}-${occurrence}`, text });
  }
  return {
    id: `novel-${identity}`, chapterId: `wct-${identity}`, title: input.title.trim(), paragraphs,
    source: {
      url: input.url, hash: await sha256(JSON.stringify(paragraphs)), kind: input.kind,
      importedAt: new Date().toISOString(), arc: input.arc, chapter: input.chapter,
      attribution: input.attribution || (input.kind === 'wct' ? 'Witch Cult Translations · Tappei Nagatsuki' : '사용자가 입력한 영어 원문'),
      ...(input.policy ? { policy: input.policy } : {}),
    },
  };
}
export function translationKey(novel: ImportedNovel): string {
  return JSON.stringify([novel.source.url, novel.chapterId, novel.source.hash, TRANSLATION_MODEL, TRANSLATION_VERSION, GLOSSARY_VERSION]);
}
export function makeBatches(paragraphs: SourceParagraph[]): TranslationBatch[] {
  const batches: TranslationBatch[] = [];
  let start = 0;
  while (start < paragraphs.length) {
    let end = start;
    let size = 0;
    while (end < paragraphs.length && end - start < 32 && (end === start || size + paragraphs[end].text.length <= 4000)) size += paragraphs[end++].text.length;
    batches.push({ id: `chunk-${start}-${end}`, paragraphs: paragraphs.slice(start, end), before: paragraphs.slice(Math.max(0, start - 2), start), after: paragraphs.slice(end, end + 2) });
    start = end;
  }
  return batches;
}
export function validateTranslation(expected: SourceParagraph[], output: unknown): SourceParagraph[] {
  if (!Array.isArray(output) || output.length !== expected.length) throw new FolioError('INVALID_TRANSLATION', '번역 문단 수가 일치하지 않습니다. 이 구간만 다시 시도해 주세요.', 502);
  return expected.map((paragraph, index) => {
    const value = output[index] as Partial<SourceParagraph> | null;
    if (!value || value.id !== paragraph.id || typeof value.text !== 'string' || !value.text.trim() ||
      value.text.length > paragraph.text.length * 6 + 200 || value.text.length < Math.max(1, paragraph.text.length * .04) ||
      value.text.split('\n').length !== paragraph.text.split('\n').length) {
      throw new FolioError('INVALID_TRANSLATION', '번역의 문단 ID·순서·줄바꿈 검증에 실패했습니다. 이 구간만 다시 시도해 주세요.', 502);
    }
    return { id: paragraph.id, text: value.text.trim() };
  });
}
