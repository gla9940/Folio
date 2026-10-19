import { randomUUID } from 'node:crypto';
import { FolioError } from './errors.ts';
export interface Redis { command<T = unknown>(args: (string | number)[]): Promise<T> }
export function createRedis(env: NodeJS.ProcessEnv): Redis {
  return { async command<T>(args: (string | number)[]): Promise<T> {
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) throw new FolioError('LIMITER_UNCONFIGURED', '서버 요청 제한 저장소가 설정되지 않았습니다.', 503);
    const url = new URL(env.UPSTASH_REDIS_REST_URL);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.upstash.io') || url.port || url.username || url.password) throw new FolioError('LIMITER_UNCONFIGURED', '요청 제한 저장소 설정을 확인해 주세요.', 503);
    try {
      const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(3000) });
      const data = await response.json() as { result?: T; error?: string };
      if (!response.ok || data.error) throw Error('Redis unavailable');
      return data.result as T;
    } catch { throw new FolioError('LIMITER_UNAVAILABLE', '사용량 보호 저장소에 연결할 수 없어 요청을 중단했습니다.', 503); }
  } };
}
const LIMIT_SCRIPT = `local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n`;
export async function limit(redis: Redis, key: string, maximum: number, seconds: number) {
  const count = await redis.command<number>(['EVAL', LIMIT_SCRIPT, 1, `folio:v1:limit:${key}`, seconds]);
  if (count > maximum) throw new FolioError('RATE_LIMITED', 'Folio 자체 요청 제한에 도달했습니다. Gemini 할당량 오류와는 별개입니다. 표시된 재시도 시각 이후 이어서 번역해 주세요.', 429, seconds);
}
export async function lock(redis: Redis): Promise<() => Promise<void>> {
  const token = randomUUID();
  const key = 'folio:v1:translation-lock';
  if (await redis.command(['SET', key, token, 'NX', 'EX', 55]) !== 'OK') throw new FolioError('TRANSLATION_BUSY', '다른 번역 구간이 처리 중입니다. 완료 후 이어서 번역해 주세요.', 409, 20);
  return async () => { await redis.command(['EVAL', `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0`, 1, key, token]); };
}
