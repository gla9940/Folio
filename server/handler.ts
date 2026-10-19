import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { authConfigured, authenticated, checkOrigin, login, logout, requireAuth } from './auth.ts';
import { createRedis, limit, lock } from './redis.ts';
import type { Redis } from './redis.ts';
import { generateTranslation, requireGemini, validateBatch, verifyModel } from './gemini.ts';
import { importWctChapter } from './source.ts';
import { FolioError, GLOSSARY_VERSION, TRANSLATION_MODEL, TRANSLATION_VERSION } from '../shared/novels.ts';
import type { ImportedNovel, SourceParagraph, TranslationRequest } from '../shared/novels.ts';
interface Dependencies {
  env: NodeJS.ProcessEnv;
  redis: Redis;
  importChapter: (url: string, env: NodeJS.ProcessEnv) => Promise<ImportedNovel>;
  translate: (batch: TranslationRequest, env: NodeJS.ProcessEnv) => Promise<SourceParagraph[]>;
  verify: typeof verifyModel;
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:;|$)/i.test(String(req.headers['content-type'] ?? ''))) throw new FolioError('CONTENT_TYPE', 'JSON 요청만 허용합니다.', 415);
  if (Number(req.headers['content-length']) > 64_000) throw new FolioError('PAYLOAD_TOO_LARGE', '요청이 너무 큽니다.', 413);
  const parsed = (req as IncomingMessage & { body?: unknown }).body;
  let raw = '';
  if (parsed !== undefined) raw = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
  else for await (const chunk of req) { raw += chunk.toString('utf8'); if (Buffer.byteLength(raw) > 64_000) throw new FolioError('PAYLOAD_TOO_LARGE', '요청이 너무 큽니다.', 413); }
  if (Buffer.byteLength(raw) > 64_000) throw new FolioError('PAYLOAD_TOO_LARGE', '요청이 너무 큽니다.', 413);
  try { const value = JSON.parse(raw); if (value && typeof value === 'object' && !Array.isArray(value)) return value; } catch { /* fall through */ }
  throw new FolioError('INVALID_JSON', 'JSON 요청 형식이 올바르지 않습니다.');
}
export function createHandler(overrides: Partial<Dependencies> = {}) {
  const env = overrides.env ?? process.env;
  const redis = overrides.redis ?? createRedis(env);
  return async function handler(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (data: unknown) => { res.end(JSON.stringify(data)); };
    try {
      if (req.method === 'GET') {
        const loggedIn = authenticated(req, env);
        return send({ configured: authConfigured(env), authenticated: loggedIn, ...(loggedIn ? { model: TRANSLATION_MODEL, translationConfigured: !!env.GEMINI_API_KEY && env.GEMINI_FREE_TIER_CONFIRMED === 'true', importEnabled: env.WCT_IMPORT_ALLOWED === 'true', limiterConfigured: !!env.UPSTASH_REDIS_REST_URL && !!env.UPSTASH_REDIS_REST_TOKEN } : {}) });
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); throw new FolioError('METHOD_NOT_ALLOWED', '허용되지 않은 요청 방식입니다.', 405); }
      checkOrigin(req, env);
      const data = await body(req);
      if (data.action === 'login') {
        await limit(redis, 'login-global', 12, 60);
        login(data.password, res, env);
        return send({ authenticated: true });
      }
      requireAuth(req, env);
      await limit(redis, 'authenticated-api', 60, 60);
      if (data.action === 'logout') { logout(res, env); return send({ authenticated: false }); }
      if (data.action === 'verify') {
        await limit(redis, 'verify-model', 2, 60);
        return send(await (overrides.verify ?? verifyModel)(env));
      }
      if (data.action === 'import') {
        if (typeof data.url !== 'string' || data.url.length > 500) throw new FolioError('INVALID_URL', '화 URL을 확인해 주세요.');
        await limit(redis, 'import-minute', 2, 60);
        await limit(redis, `import-day:${new Date().toISOString().slice(0, 10)}`, 10, 86400);
        return send({ novel: await (overrides.importChapter ?? importWctChapter)(data.url, env) });
      }
      if (data.action === 'translate') {
        requireGemini(env);
        const batch = validateBatch(data.batch);
        const hash = createHash('sha256').update(JSON.stringify([TRANSLATION_MODEL, TRANSLATION_VERSION, GLOSSARY_VERSION, batch])).digest('hex');
        const cacheKey = `folio:v1:translated:${hash}`;
        const cached = await redis.command<string | null>(['GET', cacheKey]);
        if (cached) return send({ paragraphs: JSON.parse(cached), cached: true, model: TRANSLATION_MODEL, nextRequestAfterMs: 0 });
        const cooldown = await redis.command(['GET', 'folio:v1:gemini-cooldown']);
        if (cooldown) throw new FolioError('GEMINI_QUOTA', 'Gemini 무료 한도 보호로 번역이 일시 중단되었습니다. 완료 구간은 보존됩니다.', 429, 60);
        const release = await lock(redis);
        try {
          // Recheck after acquiring the shared lock to avoid duplicate charges across tabs/instances.
          const afterLock = await redis.command<string | null>(['GET', cacheKey]);
          if (afterLock) return send({ paragraphs: JSON.parse(afterLock), cached: true, model: TRANSLATION_MODEL, nextRequestAfterMs: 0 });
          await limit(redis, 'translation-minute', 3, 60);
          await limit(redis, `translation-day:${new Date().toISOString().slice(0, 10)}`, 15, 86400);
          const paragraphs = await (overrides.translate ?? generateTranslation)(batch, env);
          await redis.command(['SET', cacheKey, JSON.stringify(paragraphs), 'EX', 30 * 86400]);
          send({ paragraphs, model: TRANSLATION_MODEL, cached: false, nextRequestAfterMs: 21_000 });
        } catch (error) {
          if (error instanceof FolioError && error.code === 'GEMINI_QUOTA') await redis.command(['SET', 'folio:v1:gemini-cooldown', '1', 'EX', error.retryAfter || 60]);
          throw error;
        } finally { try { await release(); } catch { /* the bounded lock also expires after 55 seconds */ } }
        return;
      }
      throw new FolioError('UNKNOWN_ACTION', '알 수 없는 요청입니다.');
    } catch (error) {
      if (res.writableEnded) return;
      const problem = error instanceof FolioError ? error : new FolioError('SERVER_ERROR', '서버 요청을 처리하지 못했습니다. 완료된 구간은 보존됩니다.', 500);
      res.statusCode = problem.status;
      if (problem.retryAfter) res.setHeader('Retry-After', String(problem.retryAfter));
      send({ error: { code: problem.code, message: problem.message, retryAfter: problem.retryAfter } });
    }
  };
}
