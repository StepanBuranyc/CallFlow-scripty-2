import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { pool } from './db.js';

export type DashboardRole = 'admin' | 'viewer';
export type DashboardUser = { id: string; username: string; role: DashboardRole };

const COOKIE_NAME = 'service_intake_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const PASSWORD_KEY_LENGTH = 64;
const DUMMY_SALT = Buffer.alloc(16, 0x5c);
const authenticatedUsers = new WeakMap<object, DashboardUser>();
const loginFailures = new Map<string, { count: number; blockedUntil: number }>();

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_KEY_LENGTH, { N: 16_384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt);
  return `scrypt-v1$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [version, saltHex, keyHex] = encoded.split('$');
  if (version !== 'scrypt-v1' || !saltHex || !keyHex || !/^[0-9a-f]{32}$/i.test(saltHex) || !/^[0-9a-f]{128}$/i.test(keyHex)) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await deriveKey(password, Buffer.from(saltHex, 'hex'));
  return timingSafeEqual(actual, expected);
}

export async function ensureBootstrapUsers(): Promise<void> {
  const bootstrap = [
    { username: config.DASHBOARD_USERNAME, password: config.DASHBOARD_PASSWORD, role: 'viewer' as const },
    { username: config.ADMIN_USERNAME, password: config.ADMIN_PASSWORD, role: 'admin' as const }
  ];
  for (const entry of bootstrap) {
    const username = entry.username.trim().toLowerCase();
    if (!entry.password) continue;
    const passwordHash = await hashPassword(entry.password);
    await pool.query(
      `INSERT INTO dashboard_users (username, password_hash, role)
       VALUES ($1,$2,$3) ON CONFLICT (username) DO NOTHING`,
      [username, passwordHash, entry.role]
    );
  }
  await pool.query('DELETE FROM dashboard_sessions WHERE expires_at <= now()');
}

function readSessionToken(request: any): string | undefined {
  const cookies = request.headers.cookie?.split(';') ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== COOKIE_NAME) continue;
    const value = cookie.slice(separator + 1).trim();
    if (/^[A-Za-z0-9_-]{40,60}$/.test(value)) return value;
  }
  return undefined;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cookieOptions(request: any, maxAge: number): string {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const isHttps = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(',')[0]?.trim() === 'https';
  const cookiePath = config.APP_BASE_PATH ? `${config.APP_BASE_PATH}/` : '/';
  return `Path=${cookiePath}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps ? '; Secure' : ''}`;
}

function setSessionCookie(reply: any, request: any, token: string): void {
  reply.header('Set-Cookie', `${COOKIE_NAME}=${token}; ${cookieOptions(request, SESSION_TTL_SECONDS)}`);
}

function clearSessionCookie(reply: any, request: any): void {
  reply.header('Set-Cookie', `${COOKIE_NAME}=; ${cookieOptions(request, 0)}`);
}

export async function requireDashboardUser(request: any, reply: any): Promise<void> {
  const token = readSessionToken(request);
  if (!token) {
    reply.code(401).send({ error: 'Přihlášení vypršelo nebo chybí.' });
    return;
  }
  const result = await pool.query<DashboardUser>(
    `SELECT users.id, users.username, users.role
     FROM dashboard_sessions AS sessions
     JOIN dashboard_users AS users ON users.id = sessions.user_id
     WHERE sessions.token_hash=$1 AND sessions.expires_at > now() AND users.is_active=true`,
    [tokenHash(token)]
  );
  const user = result.rows[0];
  if (!user) {
    clearSessionCookie(reply, request);
    reply.code(401).send({ error: 'Přihlášení vypršelo nebo bylo zrušeno.' });
    return;
  }
  authenticatedUsers.set(request, user);
}

export async function requireDashboardAdmin(request: any, reply: any): Promise<void> {
  await requireDashboardUser(request, reply);
  if (reply.sent) return;
  if (authenticatedUsers.get(request)?.role !== 'admin') {
    reply.code(403).send({ error: 'Tato operace vyžaduje roli správce.' });
  }
}

export function currentDashboardUser(request: object): DashboardUser {
  const user = authenticatedUsers.get(request);
  if (!user) throw new Error('Authenticated dashboard user is not available');
  return user;
}

export function verifySameOrigin(request: any, reply: any): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) {
    reply.code(403).send({ error: 'Požadavek nemá platný původ.' });
    return false;
  }
  try {
    if (new URL(origin).host.toLowerCase() === host.toLowerCase()) return true;
  } catch { /* fall through to rejection */ }
  reply.code(403).send({ error: 'Požadavek z jiné webové stránky byl odmítnut.' });
  return false;
}

export async function dashboardLogin(request: any, reply: any): Promise<void> {
  if (!verifySameOrigin(request, reply)) return;
  const ip = request.ip;
  const failures = loginFailures.get(ip);
  const now = Date.now();
  if (failures && failures.blockedUntil > now) {
    reply.header('Retry-After', Math.ceil((failures.blockedUntil - now) / 1000)).code(429).send({ error: 'Příliš mnoho pokusů. Zkuste to za chvíli znovu.' });
    return;
  }
  const username = typeof request.body?.username === 'string' ? request.body.username.trim().toLowerCase() : '';
  const password = typeof request.body?.password === 'string' ? request.body.password : '';
  const result = await pool.query<{ id: string; username: string; role: DashboardRole; password_hash: string; is_active: boolean }>(
    'SELECT id, username, role, password_hash, is_active FROM dashboard_users WHERE username=$1', [username]
  );
  const user = result.rows[0];
  const passwordMatches = user
    ? await verifyPassword(password, user.password_hash)
    : (await deriveKey(password, DUMMY_SALT), false);
  const valid = Boolean(user?.is_active && passwordMatches);
  if (!user || !valid) {
    const count = (failures?.count ?? 0) + 1;
    loginFailures.set(ip, { count, blockedUntil: count >= 5 ? now + 15 * 60 * 1000 : 0 });
    reply.code(401).send({ error: 'Nesprávné jméno nebo heslo.' });
    return;
  }
  loginFailures.delete(ip);
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO dashboard_sessions (token_hash, user_id, expires_at)
     VALUES ($1,$2,now() + ($3 * interval '1 second'))`,
    [tokenHash(token), user.id, SESSION_TTL_SECONDS]
  );
  setSessionCookie(reply, request, token);
  reply.header('Cache-Control', 'no-store').send({ id: user.id, username: user.username, role: user.role });
}

export async function dashboardLogout(request: any, reply: any): Promise<void> {
  if (!verifySameOrigin(request, reply)) return;
  const token = readSessionToken(request);
  if (token) await pool.query('DELETE FROM dashboard_sessions WHERE token_hash=$1', [tokenHash(token)]);
  clearSessionCookie(reply, request);
  reply.header('Cache-Control', 'no-store').send({ ok: true });
}
