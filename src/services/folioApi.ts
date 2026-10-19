import { FolioError, validateTranslation } from '../../shared/novels';
import type { ImportedNovel, SourceParagraph, TranslationRequest } from '../../shared/novels';
import type { TranslationProvider } from './contracts';
export interface ServerSession { configured: boolean; authenticated: boolean; model?: string; translationConfigured?: boolean; importEnabled?: boolean; limiterConfigured?: boolean }
export async function api<T>(action?: string, data: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/folio', { method: action ? 'POST' : 'GET', credentials: 'same-origin', headers: action ? { 'Content-Type': 'application/json' } : {}, ...(action ? { body: JSON.stringify({ ...data, action }) } : {}), signal });
  let payload: { error?: { code?: string; message?: string; retryAfter?: number; retryable?: boolean; diagnosticId?: string } };
  try { payload = await response.json(); } catch { throw new FolioError('API_UNAVAILABLE', '서버 API를 확인할 수 없습니다. Vercel 설정을 확인해 주세요.', 503); }
  if (!response.ok) throw new FolioError(payload.error?.code ?? 'API_ERROR', payload.error?.message ?? '요청을 처리하지 못했습니다.', response.status, payload.error?.retryAfter ?? 0, { retryable: payload.error?.retryable, diagnosticId: payload.error?.diagnosticId });
  return payload as T;
}
export const serverApi = {
  session: () => api<ServerSession>(),
  login: (password: string) => api('login', { password }),
  logout: () => api('logout'),
  verify: () => api<{ model: string; modelAvailable: boolean; billingVerifiedByApi: boolean }>('verify'),
  import: async (url: string) => (await api<{ novel: ImportedNovel }>('import', { url })).novel,
};
export const geminiTranslationProvider: TranslationProvider = {
  async translateParagraph(text, sourceLanguage, targetLanguage) {
    if (sourceLanguage !== 'en' || targetLanguage !== 'ko') throw Error('영어 → 한국어 번역만 지원합니다.');
    const sourceHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (x) => x.toString(16).padStart(2, '0')).join('');
    const result = await this.translateBatch({ id: 'chunk-0-1', sourceHash, paragraphs: [{ id: 'paragraph', text }], before: [], after: [] });
    return result.paragraphs[0].text;
  },
  async translateBatch(batch: TranslationRequest, signal?: AbortSignal) {
    const result = await api<{ paragraphs: SourceParagraph[]; model: string; nextRequestAfterMs: number }>('translate', { batch }, signal);
    return { ...result, paragraphs: validateTranslation(batch.paragraphs, result.paragraphs) };
  },
};
