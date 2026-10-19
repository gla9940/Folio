import { FolioError, TRANSLATION_MODEL, validateTranslation } from '../shared/novels.ts';
import type { SourceParagraph, TranslationRequest } from '../shared/novels.ts';
import { translationInstruction } from '../shared/glossary.ts';
import { diagnoseGeminiFailure } from './geminiDiagnostics.ts';
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
export function buildTranslationRequest(batch: TranslationRequest) {
  const context = (paragraphs: SourceParagraph[]) => paragraphs.map((p) => ({ id: p.id, text: p.text.slice(0, 700) }));
  return {
    systemInstruction: { parts: [{ text: translationInstruction }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify({ target: batch.paragraphs, before: context(batch.before), after: context(batch.after), previousTranslation: context(batch.previousTranslation ?? []) }) }] }],
    generationConfig: {
      maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'low' },
      responseMimeType: 'application/json',
      // Stable, small schema. IDs/count/order/newlines are verified by validateTranslation.
      responseJsonSchema: { type: 'object', properties: { paragraphs: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } } }, required: ['paragraphs'] },
    },
  };
}
export async function generateTranslation(batch: TranslationRequest, env: NodeJS.ProcessEnv, fetcher: Fetcher = fetch): Promise<SourceParagraph[]> {
  requireGemini(env);
  const request = buildTranslationRequest(batch);
  const body = JSON.stringify(request);
  const started = Date.now();
  let response: Response;
  try {
    response = await fetcher(`${ENDPOINT}:generateContent`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35_000),
      headers: { 'x-goog-api-key': env.GEMINI_API_KEY!, 'Content-Type': 'application/json' },
      body,
    });
  } catch { throw new FolioError('GEMINI_TIMEOUT', '번역 응답이 지연되거나 연결이 끊어졌습니다. 완료 구간은 보존되며 이 구간만 재시도할 수 있습니다.', 504); }
  if (!response.ok) {
    const context = JSON.parse(request.contents[0].parts[0].text) as { before: SourceParagraph[]; after: SourceParagraph[]; previousTranslation: SourceParagraph[] };
    const diagnostic = await diagnoseGeminiFailure(response, { paragraphCount: batch.paragraphs.length, targetCharacters: batch.paragraphs.reduce((sum, p) => sum + p.text.length, 0), contextCharacters: [...context.before, ...context.after, ...context.previousTranslation].reduce((sum, p) => sum + p.text.length, 0), schemaBytes: Buffer.byteLength(JSON.stringify(request.generationConfig.responseJsonSchema)), requestBytes: Buffer.byteLength(body) }, Date.now() - started);
    const details = { diagnosticId: diagnostic.diagnosticId, retryable: ![400, 401, 403, 404].includes(response.status) };
    if (response.status === 400) throw new FolioError('GEMINI_BAD_REQUEST', `${diagnostic.message} 요청 거절(400)은 무료 한도 초과가 아닙니다. 같은 요청을 반복하지 말고 서버 수정을 확인해 주세요. 진단 ID: ${diagnostic.diagnosticId}`, 400, 0, details);
    if ([401, 403].includes(response.status)) throw new FolioError('GEMINI_AUTH', `${diagnostic.message} 진단 ID: ${diagnostic.diagnosticId}`, 503, 0, details);
    if (response.status === 404) throw new FolioError('MODEL_UNAVAILABLE', `${diagnostic.message} 모델을 자동 변경하지 않습니다. 진단 ID: ${diagnostic.diagnosticId}`, 503, 0, details);
    if (response.status === 429) {
      const retry = Number(response.headers.get('retry-after'));
      throw new FolioError('GEMINI_QUOTA', `Gemini 요청/할당량 제한(429)으로 중단했습니다. 유료 API로 전환하지 않습니다. 한도 초기화 후 이어서 번역해 주세요. 진단 ID: ${diagnostic.diagnosticId}`, 429, Math.max(60, Math.min(86400, Number.isFinite(retry) ? retry : 60)), details);
    }
    throw new FolioError('GEMINI_FAILED', `Gemini 서버 요청에 실패했습니다(${response.status}). 완료 구간은 보존됩니다. 진단 ID: ${diagnostic.diagnosticId}`, 502, 0, details);
  }
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
