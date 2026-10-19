import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createHandler } from './handler';
import { createRedis } from './redis';
import type { Redis } from './redis';
import { FolioError } from '../shared/novels';
const env = { FOLIO_ORIGIN: 'https://folio.example', FOLIO_PASSWORD: 'a-test-password-with-32-characters', FOLIO_SESSION_SECRET: 'a-test-secret-with-at-least-32-characters', GEMINI_API_KEY: 'test-not-real', GEMINI_FREE_TIER_CONFIRMED: 'true' };
function memoryRedis(): Redis {
  const values = new Map<string, unknown>();
  return { async command<T>(args: (string | number)[]) {
    const [operation, key, value] = args;
    if (operation === 'GET') return (values.get(String(key)) ?? null) as T;
    if (operation === 'SET') {
      if (args.includes('NX') && values.has(String(key))) return null as T;
      values.set(String(key), value); return 'OK' as T;
    }
    if (operation === 'EVAL') {
      const redisKey = String(args[3]);
      if (String(key).includes('INCR')) { const n = Number(values.get(redisKey) ?? 0) + 1; values.set(redisKey, n); return n as T; }
      if (values.get(redisKey) === args[4]) values.delete(redisKey);
      return 1 as T;
    }
    throw Error('Unexpected Redis command');
  } };
}
async function call(handler: ReturnType<typeof createHandler>, data?: unknown, cookie?: string, origin = env.FOLIO_ORIGIN) {
  const req = Readable.from(data ? [Buffer.from(JSON.stringify(data))] : []) as IncomingMessage;
  req.method = data ? 'POST' : 'GET';
  req.headers = { origin, 'content-type': 'application/json', cookie };
  const headers: Record<string, string> = {};
  let result = '';
  const res = { statusCode: 200, writableEnded: false, setHeader(key: string, value: string) { headers[key] = value; }, end(text: string) { result = text; this.writableEnded = true; } };
  await handler(req, res as unknown as ServerResponse);
  return { status: res.statusCode, data: JSON.parse(result), headers };
}
describe('private server API', () => {
  it('requires authentication and same origin before any translation call', async () => {
    const translate = vi.fn();
    const handler = createHandler({ env, redis: memoryRedis(), translate });
    expect((await call(handler, { action: 'translate' })).status).toBe(401);
    expect((await call(handler, { action: 'login', password: env.FOLIO_PASSWORD }, undefined, 'https://evil.example')).status).toBe(403);
    expect(translate).not.toHaveBeenCalled();
    const auth = await call(handler, { action: 'login', password: env.FOLIO_PASSWORD });
    expect(auth.headers['Set-Cookie']).toContain('HttpOnly; SameSite=Strict; Path=/api');
    expect(auth.headers['Set-Cookie']).toContain('Secure');
    const cookie = auth.headers['Set-Cookie'].split(';')[0];
    expect((await call(handler, undefined, cookie)).data.authenticated).toBe(true);
    expect((await call(handler, undefined, cookie + 'x')).data.authenticated).toBe(false);
    expect(JSON.stringify((await call(handler)).data)).not.toContain(env.GEMINI_API_KEY);
  });
  it('reuses server-cached results without invoking Gemini again', async () => {
    const translate = vi.fn().mockResolvedValue([{ id: 'p1', text: '새벽이었다.' }]);
    const handler = createHandler({ env, redis: memoryRedis(), translate });
    const login = await call(handler, { action: 'login', password: env.FOLIO_PASSWORD });
    const cookie = login.headers['Set-Cookie'].split(';')[0];
    const data = { action: 'translate', batch: { id: 'chunk-0-1', sourceHash: 'a'.repeat(64), paragraphs: [{ id: 'p1', text: 'Dawn came.' }], before: [], after: [] } };
    expect((await call(handler, data, cookie)).data.cached).toBe(false);
    expect((await call(handler, data, cookie)).data.cached).toBe(true);
    expect(translate).toHaveBeenCalledTimes(1);
  });
  it('fails closed when distributed limits are missing or quota is exceeded', async () => {
    const handler = createHandler({ env, redis: createRedis({}) });
    expect((await call(handler, { action: 'login', password: env.FOLIO_PASSWORD })).status).toBe(503);
    const limited = createHandler({ env, redis: memoryRedis() });
    for (let i = 0; i < 12; i++) await call(limited, { action: 'login', password: 'wrong' });
    expect((await call(limited, { action: 'login', password: env.FOLIO_PASSWORD })).status).toBe(429);
  });
  it('does not expose a public endpoint when authentication is unconfigured', async () => {
    const handler = createHandler({ env: {}, redis: memoryRedis() });
    expect((await call(handler)).data).toEqual({ configured: false, authenticated: false });
    expect((await call(handler, { action: 'translate' })).status).toBe(503);
  });
  it('sets a shared cooldown after Gemini 429 and stops further generation', async () => {
    const translate = vi.fn().mockRejectedValue(new FolioError('GEMINI_QUOTA', 'Quota', 429, 60));
    const handler = createHandler({ env, redis: memoryRedis(), translate });
    const auth = await call(handler, { action: 'login', password: env.FOLIO_PASSWORD });
    const cookie = auth.headers['Set-Cookie'].split(';')[0];
    const batch = { id: 'chunk-0-1', sourceHash: 'a'.repeat(64), paragraphs: [{ id: 'p1', text: 'The traveler waited.' }], before: [], after: [] };
    expect((await call(handler, { action: 'translate', batch }, cookie)).status).toBe(429);
    expect((await call(handler, { action: 'translate', batch }, cookie)).status).toBe(429);
    expect(translate).toHaveBeenCalledTimes(1);
  });
});
