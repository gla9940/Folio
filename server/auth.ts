import { createHmac, createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { FolioError } from './errors.ts';
const COOKIE = 'folio_session';
const TTL = 12 * 60 * 60;
function equal(a: string, b: string) { return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest()); }
export function authConfigured(env: NodeJS.ProcessEnv): boolean { return (env.FOLIO_PASSWORD?.length ?? 0) >= 16 && (env.FOLIO_SESSION_SECRET?.length ?? 0) >= 32 && !!env.FOLIO_ORIGIN; }
export function checkOrigin(req: IncomingMessage, env: NodeJS.ProcessEnv) {
  if (!authConfigured(env)) throw new FolioError('AUTH_UNCONFIGURED', '개인용 인증 환경변수가 설정되지 않았습니다. README의 Vercel 설정을 확인해 주세요.', 503);
  const origin = new URL(env.FOLIO_ORIGIN!).origin;
  if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) throw new FolioError('AUTH_UNCONFIGURED', '배포 환경에는 HTTPS 접속 주소가 필요합니다.', 503);
  if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') throw new FolioError('ORIGIN_DENIED', '허용되지 않은 요청 출처입니다.', 403);
}
function signature(payload: string, env: NodeJS.ProcessEnv) { return createHmac('sha256', env.FOLIO_SESSION_SECRET!).update(payload).digest('base64url'); }
function passwordVersion(env: NodeJS.ProcessEnv) { return createHmac('sha256', env.FOLIO_SESSION_SECRET!).update(env.FOLIO_PASSWORD!).digest('hex'); }
export function authenticated(req: IncomingMessage, env: NodeJS.ProcessEnv): boolean {
  if (!authConfigured(env)) return false;
  const cookie = req.headers.cookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!cookie || cookie.length > 500) return false;
  const [payload, sig] = cookie.split('.');
  if (!payload || !sig || !equal(signature(payload, env), sig)) return false;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString()); return typeof data.exp === 'number' && data.exp > Date.now() && data.exp <= Date.now() + TTL * 1000 && data.auth === passwordVersion(env); }
  catch { return false; }
}
export function requireAuth(req: IncomingMessage, env: NodeJS.ProcessEnv) { if (!authenticated(req, env)) throw new FolioError('UNAUTHORIZED', '개인 서재에 로그인해 주세요.', 401); }
export function login(password: unknown, res: ServerResponse, env: NodeJS.ProcessEnv) {
  if (typeof password !== 'string' || password.length > 256 || !equal(password, env.FOLIO_PASSWORD!)) throw new FolioError('INVALID_PASSWORD', '서재 비밀번호가 올바르지 않습니다.', 401);
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TTL * 1000, nonce: randomBytes(16).toString('hex'), auth: passwordVersion(env) })).toString('base64url');
  res.setHeader('Set-Cookie', `${COOKIE}=${payload}.${signature(payload, env)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${TTL}${env.FOLIO_ORIGIN!.startsWith('https:') ? '; Secure' : ''}`);
}
export function logout(res: ServerResponse, env: NodeJS.ProcessEnv) { res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${env.FOLIO_ORIGIN?.startsWith('https:') ? '; Secure' : ''}`); }
