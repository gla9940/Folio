import { describe, expect, it, vi } from 'vitest';
import { buildTranslationRequest, generateTranslation, validateBatch, verifyModel } from './gemini';
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
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '90' } }));
    await expect(generateTranslation(batch, env, fetcher)).rejects.toMatchObject({ code: 'GEMINI_QUOTA', status: 429, retryAfter: 90 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    log.mockRestore();
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
  it('keeps the same small schema for a short sentence and an EPUB-size 31-paragraph request', () => {
    const epub = { ...batch, id: 'chunk-0-31', paragraphs: Array.from({ length: 31 }, (_, i) => ({ id: `wct-${'a'.repeat(20)}-p-${String(i).padStart(20, '0')}-1`, text: `Paragraph ${i}. ` + 'The traveler walked beside the quiet river. '.repeat(2) })) };
    const short = buildTranslationRequest(batch);
    const large = buildTranslationRequest(epub);
    expect(large.generationConfig.responseJsonSchema).toEqual(short.generationConfig.responseJsonSchema);
    const schema = JSON.stringify(large.generationConfig.responseJsonSchema);
    expect(schema.length).toBeLessThan(300);
    expect(schema).not.toMatch(/enum|minItems|maxItems/);
    expect(JSON.parse(large.contents[0].parts[0].text).target).toEqual(epub.paragraphs);
    expect(large.generationConfig).not.toHaveProperty('temperature');
  });
  it('reports 400 as a permanent request rejection, with one call and no sensitive diagnostic content', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const secret = 'private-source-key-credentials-never-log';
      const response = { error: { status: 'INVALID_ARGUMENT', message: `The response schema is too complex: maximum allowed states exceeded. ${secret}`, details: [{ fieldViolations: [{ field: `generation_config.response_json_schema.${secret}`, description: secret }] }] } };
      const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 400 }));
      let caught: unknown;
      try { await generateTranslation(batch, env, fetcher); } catch (error) { caught = error; }
      expect(caught).toMatchObject({ code: 'GEMINI_BAD_REQUEST', status: 400, retryable: false, retryAfter: 0, diagnosticId: expect.any(String) });
      expect(String(caught)).toContain('복잡성');
      expect(String(caught)).not.toContain(secret);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(log.mock.calls[0][0]);
      expect(logged).toMatchObject({ event: 'folio.gemini.failure', upstreamStatus: 400, apiStatus: 'INVALID_ARGUMENT', reason: 'schema_complexity', fields: ['responseJsonSchema'], paragraphCount: 1 });
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
      expect(JSON.stringify(log.mock.calls)).not.toContain(env.GEMINI_API_KEY);
      expect(JSON.stringify(log.mock.calls)).not.toContain(batch.paragraphs[0].text);
      expect(JSON.stringify(log.mock.calls)).not.toContain(batch.paragraphs[0].id);
    } finally { log.mockRestore(); }
  });
  it('keeps paragraph count, ID, order and newline checks after simplifying the schema', async () => {
    const paragraphs = [{ id: 'p1', text: 'First line.\nSecond line.' }, { id: 'p2', text: 'Another paragraph.' }];
    const valid = [{ id: 'p1', text: '첫 줄이다.\n둘째 줄이다.' }, { id: 'p2', text: '다른 문단이다.' }];
    for (const output of [[valid[0]], [...valid].reverse(), [{ ...valid[0], id: 'unknown' }, valid[1]], [{ ...valid[0], text: '줄이 합쳐졌다.' }, valid[1]]]) {
      const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ paragraphs: output }) }] } }] })));
      await expect(generateTranslation({ ...batch, id: 'chunk-0-2', paragraphs }, env, fetcher)).rejects.toMatchObject({ code: 'INVALID_TRANSLATION' });
    }
  });
});
