import { FolioError, TRANSLATION_MODEL, validateTranslation } from '../shared/novels.ts';
import type { SourceParagraph, TranslationRequest } from '../shared/novels.ts';
import { translationInstruction } from '../shared/glossary.ts';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${TRANSLATION_MODEL}`;
type Fetcher = typeof fetch;
export function requireGemini(env: NodeJS.ProcessEnv) {
  if (!env.GEMINI_API_KEY) throw new FolioError('GEMINI_UNCONFIGURED', '서버의 GEMINI_API_KEY를 설정해 주세요.', 503);
  if (env.GEMINI_FREE_TIER_CONFIRMED !== 'true') throw new FolioError('FREE_TIER_UNCONFIRMED', '결제가 연결되지 않은 Gemini 무료 프로젝트인지 확인하고 서버 설정을 완료해 주세요.', 503);
}
export async function verifyModel(env: NodeJS.ProcessEnv, fetcher: Fetcher = fetch) {
  requireGemini(env);
  const response = await fetcher(ENDPOINT, { headers: { 'x-goog-api-key': env.GEMINI_API_KEY! }, redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new FolioError('MODEL_UNAVAILABLE', `설정된 키로 ${TRANSLATION_MODEL} 모델을 확인하지 못했습니다. 모델을 자동 변경하지 않습니다.`, response.status === 429 ? 429 : 503, response.status === 429 ? 60 : 0);
  const data = await response.json() as { supportedGenerationMethods?: string[] };
  if (!data.supportedGenerationMethods?.includes('generateContent')) throw new FolioError('MODEL_UNAVAILABLE', '설정된 모델의 텍스트 생성 기능을 확인하지 못했습니다.', 503);
  return { model: TRANSLATION_MODEL, modelAvailable: true, freeTierConfirmedByOperator: true, billingVerifiedByApi: false };
}
export function validateBatch(value: unknown): TranslationRequest {
  const data = value as Partial<TranslationRequest> | null;
  const valid = (paragraphs: unknown, maxCount: number, maxChars: number): paragraphs is SourceParagraph[] => Array.isArray(paragraphs) && paragraphs.length <= maxCount && paragraphs.every((p) => p && typeof p.id === 'string' && /^[a-zA-Z0-9_-]{1,150}$/.test(p.id) && typeof p.text === 'string' && p.text.length > 0 && p.text.length <= maxChars);
  if (!data || typeof data.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.sourceHash) || typeof data.id !== 'string' || !/^chunk-\d+-\d+$/.test(data.id) ||
    !valid(data.paragraphs, 32, 6000) || !data.paragraphs.length || !valid(data.before, 2, 6000) || !valid(data.after, 2, 6000) ||
    (data.previousTranslation !== undefined && !valid(data.previousTranslation, 2, 6000)) || new Set(data.paragraphs.map((p) => p.id)).size !== data.paragraphs.length ||
    data.paragraphs.reduce((n, p) => n + p.text.length, 0) > 6000) throw new FolioError('INVALID_BATCH', '번역 구간의 크기·문단 ID를 확인해 주세요.');
  return data as TranslationRequest;
}
export async function generateTranslation(batch: TranslationRequest, env: NodeJS.ProcessEnv, fetcher: Fetcher = fetch): Promise<SourceParagraph[]> {
  requireGemini(env);
  const context = (paragraphs: SourceParagraph[]) => paragraphs.map((p) => ({ id: p.id, text: p.text.slice(0, 700) }));
  let response: Response;
  try {
    response = await fetcher(`${ENDPOINT}:generateContent`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35_000),
      headers: { 'x-goog-api-key': env.GEMINI_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: translationInstruction }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify({ target: batch.paragraphs, before: context(batch.before), after: context(batch.after), previousTranslation: context(batch.previousTranslation ?? []) }) }] }],
        generationConfig: {
          temperature: .7, maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'low' },
          responseMimeType: 'application/json',
          responseJsonSchema: { type: 'object', properties: { paragraphs: { type: 'array', minItems: batch.paragraphs.length, maxItems: batch.paragraphs.length, items: { type: 'object', properties: { id: { type: 'string', enum: batch.paragraphs.map((p) => p.id) }, text: { type: 'string' } }, required: ['id', 'text'], additionalProperties: false } } }, required: ['paragraphs'], additionalProperties: false },
        },
      }),
    });
  } catch { throw new FolioError('GEMINI_TIMEOUT', '번역 응답이 지연되거나 연결이 끊어졌습니다. 완료 구간은 보존되며 이 구간만 재시도할 수 있습니다.', 504); }
  if (response.status === 429) {
    const retry = Number(response.headers.get('retry-after'));
    throw new FolioError('GEMINI_QUOTA', 'Gemini 무료 한도에 도달해 번역을 중단했습니다. 유료 API로 전환하지 않습니다. 한도 초기화 후 이어서 번역해 주세요.', 429, Math.max(60, Math.min(86400, Number.isFinite(retry) ? retry : 60)));
  }
  if (!response.ok) throw new FolioError(response.status === 404 ? 'MODEL_UNAVAILABLE' : 'GEMINI_FAILED', `Gemini 번역 요청에 실패했습니다(${response.status}). 완료 구간은 보존됩니다.`, 502);
  const payload = await response.json() as { candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  const candidate = payload.candidates?.[0];
  if (candidate?.finishReason !== 'STOP') throw new FolioError('INCOMPLETE_TRANSLATION', '안전 필터 또는 출력 길이 제한으로 번역이 끝나지 않았습니다. 이 구간만 재시도해 주세요.', 502);
  try {
    const raw = candidate.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? '').join('') ?? '';
    const result = JSON.parse(raw) as { paragraphs?: unknown };
    return validateTranslation(batch.paragraphs, result.paragraphs);
  } catch (error) {
    if (error instanceof FolioError) throw error;
    throw new FolioError('INVALID_TRANSLATION', '번역 JSON 형식 검증에 실패했습니다. 이 구간만 재시도해 주세요.', 502);
  }
}
