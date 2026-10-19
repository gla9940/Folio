import { randomUUID } from 'node:crypto';
import { TRANSLATION_MODEL, TRANSLATION_REQUEST_VERSION } from '../shared/novels.ts';

export interface RequestMetrics { paragraphCount: number; targetCharacters: number; contextCharacters: number; schemaBytes: number; requestBytes: number }
type FailureReason = 'schema_complexity' | 'unsupported_parameter' | 'input_size' | 'credentials' | 'billing_or_region' | 'invalid_argument' | 'quota' | 'model_unavailable' | 'upstream_error';
export const reasonMessages: Record<FailureReason, string> = {
  schema_complexity: 'Gemini가 응답 스키마의 복잡성 제한을 보고했습니다.',
  unsupported_parameter: 'Gemini가 지원하지 않는 요청 필드 또는 설정을 보고했습니다.',
  input_size: 'Gemini가 입력 크기 또는 토큰 제한을 보고했습니다.',
  credentials: 'Gemini 서버 키의 유효성 또는 모델 접근 권한을 확인해 주세요.',
  billing_or_region: 'Gemini 프로젝트의 무료 등급 사용 가능 지역·설정을 확인해 주세요. 유료 API로 전환하지 않습니다.',
  invalid_argument: 'Gemini가 요청 형식을 거절했습니다. 상세 분류는 서버 진단을 확인해 주세요.',
  quota: 'Gemini 요청/할당량 제한에 도달했습니다.',
  model_unavailable: '설정된 Gemini 모델을 사용할 수 없습니다.',
  upstream_error: 'Gemini 서버에서 요청을 처리하지 못했습니다.',
};
const STATUSES = new Set(['INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'NOT_FOUND', 'RESOURCE_EXHAUSTED', 'INTERNAL', 'UNAVAILABLE', 'DEADLINE_EXCEEDED']);
async function boundedError(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 16_384) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
  finally { reader.releaseLock(); }
}
export async function diagnoseGeminiFailure(response: Response, metrics: RequestMetrics, durationMs: number) {
  const payload = await boundedError(response) as { error?: { status?: unknown; message?: unknown; details?: unknown } } | null;
  const error = payload?.error;
  const status = typeof error?.status === 'string' && STATUSES.has(error.status) ? error.status : 'UNKNOWN';
  const details = Array.isArray(error?.details) ? error.details.slice(0, 10) : [];
  const violations = details.flatMap((entry) => Array.isArray(entry?.fieldViolations) ? entry.fieldViolations.slice(0, 10) : []);
  // Provider messages may echo keys or source text. Use them only to select fixed labels.
  // Never log/return raw messages, details, field paths, URLs, headers, IDs or prompt text.
  const description = [typeof error?.message === 'string' ? error.message : '', ...violations.map((entry) => typeof entry?.description === 'string' ? entry.description : '')].join(' ').toLowerCase();
  let reason: FailureReason = response.status === 400 ? 'invalid_argument' : response.status === 429 ? 'quota' : response.status === 404 ? 'model_unavailable' : [401, 403].includes(response.status) ? 'credentials' : 'upstream_error';
  if (response.status === 400) {
    if (/(?:schema|enum)/.test(description) && /complex|too many|too large|states|nesting depth|constraint/.test(description)) reason = 'schema_complexity';
    else if (/api.?key.*(?:invalid|expired|not valid)|invalid.*api.?key/.test(description)) reason = 'credentials';
    else if (/billing|not available.*(?:country|region)|free tier.*not/.test(description)) reason = 'billing_or_region';
    else if (/unknown name|unsupported|not supported|unrecognized field/.test(description)) reason = 'unsupported_parameter';
    else if (/token.*(?:limit|exceed)|(?:input|request|payload).*too (?:large|long)/.test(description)) reason = 'input_size';
  }
  const rawFields = violations.map((entry) => typeof entry?.field === 'string' ? entry.field.toLowerCase().replace(/_/g, '') : '');
  const fields = ['responseJsonSchema', 'responseSchema', 'thinkingConfig', 'maxOutputTokens', 'temperature', 'contents', 'systemInstruction'].filter((field) => rawFields.some((value) => value.includes(field.toLowerCase())));
  const diagnosticId = randomUUID();
  console.error(JSON.stringify({ event: 'folio.gemini.failure', diagnosticId, model: TRANSLATION_MODEL, requestVersion: TRANSLATION_REQUEST_VERSION, upstreamStatus: response.status, apiStatus: status, reason, fields, ...metrics, durationMs }));
  return { diagnosticId, reason, message: reasonMessages[reason] };
}
