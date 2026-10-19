import { describe, expect, it, vi } from 'vitest';
import { generateTranslation, validateBatch, verifyModel } from './gemini';
const env = { GEMINI_API_KEY: 'test-only-not-a-real-key', GEMINI_FREE_TIER_CONFIRMED: 'true' };
const batch = { id: 'chunk-0-1', sourceHash: 'a'.repeat(64), paragraphs: [{ id: 'p1', text: 'The sun rose.' }], before: [], after: [] };
const success = () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ paragraphs: [{ id: 'p1', text: '해가 떠올랐다.' }] }) }] } }] }));
describe('Gemini provider', () => {
  it('uses only the requested model, server key header, glossary and structured output', async () => {
    const fetcher = vi.fn().mockResolvedValue(success());
    expect(await generateTranslation(batch, env, fetcher)).toEqual([{ id: 'p1', text: '해가 떠올랐다.' }]);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect(url).not.toContain(env.GEMINI_API_KEY);
    expect(options.headers['x-goog-api-key']).toBe(env.GEMINI_API_KEY);
    const body = JSON.parse(options.body);
    expect(body.systemInstruction.parts[0].text).toContain('나츠키 스바루');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe('low');
    expect(body.tools).toBeUndefined();
  });
  it('stops on quota errors without automatic retries or paid model fallback', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '90' } }));
    await expect(generateTranslation(batch, env, fetcher)).rejects.toMatchObject({ code: 'GEMINI_QUOTA', status: 429, retryAfter: 90 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects missing credentials, unchecked billing, bad IDs and oversized batches', async () => {
    const fetcher = vi.fn();
    await expect(generateTranslation(batch, {}, fetcher)).rejects.toMatchObject({ code: 'GEMINI_UNCONFIGURED' });
    await expect(generateTranslation(batch, { GEMINI_API_KEY: 'test' }, fetcher)).rejects.toMatchObject({ code: 'FREE_TIER_UNCONFIRMED' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => validateBatch({ ...batch, paragraphs: [batch.paragraphs[0], batch.paragraphs[0]] })).toThrow();
    expect(() => validateBatch({ ...batch, paragraphs: [{ id: 'p1', text: 'x'.repeat(6001) }] })).toThrow();
  });
  it('rejects incomplete, malformed or mismatched translation output', async () => {
    for (const body of [{ candidates: [{ finishReason: 'MAX_TOKENS' }] }, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not json' }] } }] }, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"paragraphs":[{"id":"wrong","text":"오류"}]}' }] } }] }]) {
      await expect(generateTranslation(batch, env, vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))).rejects.toBeInstanceOf(Error);
    }
  });
  it('verifies model availability without claiming account billing verification', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ supportedGenerationMethods: ['generateContent'] })));
    expect(await verifyModel(env, fetcher)).toMatchObject({ modelAvailable: true, billingVerifiedByApi: false });
  });
});
