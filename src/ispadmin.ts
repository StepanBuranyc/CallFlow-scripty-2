import { createHmac } from 'node:crypto';
import { normalizePhoneNumber } from './phone-number.js';
import type { RuntimeSettings } from './runtime-settings.js';
import { pool } from './db.js';
import { config } from './config.js';
import pino from 'pino';

const logger = pino({ level: config.LOG_LEVEL, redact: ['*.token', '*.apiKey'] });
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type IspadminCaller = { status: 'disabled' | 'no_caller_id' | 'not_found' | 'ambiguous' | 'unavailable' } | { status: 'candidate' };
export type IspadminVerification =
  | { verified: false; attemptsRemaining: number }
  | { verified: true; clientName: string; balanceAttention: boolean; activeServices: string[] };

type JsonRecord = Record<string, unknown>;

export function ispadminBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Zadejte HTTPS adresu ISPadmin API bez přihlašovacích údajů a parametrů.');
  return url.toString().replace(/\/+$/, '');
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function recordsFromResponse(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.map(asRecord).filter((record): record is JsonRecord => Boolean(record));
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ['data', 'results', 'clients']) {
    const nested = record[key];
    if (Array.isArray(nested)) return recordsFromResponse(nested);
    const nestedRecord = asRecord(nested);
    if (nestedRecord) return recordsFromResponse(nestedRecord);
  }
  if (record.id !== undefined || record.phone !== undefined || record.mobile !== undefined) return [record];
  return Object.values(record).map(asRecord).filter((item): item is JsonRecord => Boolean(item));
}

function phoneKeys(value: unknown): string[] {
  if (typeof value !== 'string' && typeof value !== 'number') return [];
  const digits = normalizePhoneNumber(String(value)).replace(/\D/g, '');
  if (!digits) return [];
  const keys = new Set([digits]);
  const national = digits.startsWith('00420') ? digits.slice(5) : digits.startsWith('420') && digits.length === 12 ? digits.slice(3) : undefined;
  if (national) { keys.add(national); keys.add(`0${national}`); }
  else if (digits.startsWith('0') && digits.length === 10) { keys.add(digits.slice(1)); keys.add(`420${digits.slice(1)}`); }
  else if (digits.length === 9) { keys.add(`420${digits}`); keys.add(`0${digits}`); }
  return [...keys];
}

function contractKey(value: string): string { return value.trim().replace(/\s+/g, '').toLocaleUpperCase('cs-CZ'); }
function hash(value: string): string {
  if (!config.APP_SETTINGS_ENCRYPTION_KEY) throw new Error('cache_key_missing');
  return createHmac('sha256', Buffer.from(config.APP_SETTINGS_ENCRYPTION_KEY, 'hex')).update(value).digest('hex');
}
function phoneHashes(value: string): string[] { return [...new Set(phoneKeys(value).filter(key => key.length >= 7).map(hash))]; }

async function getJson(url: URL, token: string, timeoutMs = 20_000): Promise<unknown> {
  const response = await fetch(url, { headers: { Token: token, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) }).catch(() => { throw new Error('ISPadmin API je nedostupné.'); });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`ISPadmin API vrátilo HTTP ${response.status}.`); }
  return response.json().catch(() => { throw new Error('ISPadmin API nevrátilo JSON.'); }) as Promise<unknown>;
}

function clientListUrl(baseUrl: string, phone?: string): URL {
  const url = new URL(`${ispadminBaseUrl(baseUrl)}/clients`);
  if (phone) url.searchParams.set('phone', phone);
  return url;
}

export async function testIspadminConnection(baseUrl: string, token: string): Promise<void> {
  await getJson(clientListUrl(baseUrl, '000000000'), token, 5_000);
}

/** Refresh a minimal allow-listed snapshot; raw phone and contract values are never persisted. */
export async function syncIspadminCache(settings: Pick<RuntimeSettings, 'ispadminApiBaseUrl' | 'ispadminApiToken'>): Promise<number> {
  if (!settings.ispadminApiBaseUrl || !settings.ispadminApiToken) throw new Error('ispadmin_not_configured');
  if (!config.APP_SETTINGS_ENCRYPTION_KEY) throw new Error('cache_key_missing');
  await pool.query("UPDATE ispadmin_cache_sync SET status='running', started_at=now(), error_code='' WHERE id=1");
  const connection = await pool.connect();
  try {
    const clients = recordsFromResponse(await getJson(clientListUrl(settings.ispadminApiBaseUrl), settings.ispadminApiToken));
    const rows: Array<[string, string, string, string, boolean]> = [];
    for (const client of clients) {
      const id = client.id;
      const number = typeof client.clientNumber === 'string' ? contractKey(client.clientNumber) : '';
      if ((typeof id !== 'string' && typeof id !== 'number') || !number) continue;
      const phones = [...new Set([...phoneKeys(client.phone), ...phoneKeys(client.mobile)])].filter(value => value.length >= 7);
      if (!phones.length) continue;
      const clientId = String(id).slice(0, 80);
      const clientName = typeof client.name === 'string' ? client.name.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 160) : '';
      const balance = typeof client.balance === 'number' && Number.isFinite(client.balance) ? client.balance : null;
      for (const phone of phones) rows.push([clientId, hash(phone), hash(number), clientName, balance !== null && balance < 0]);
    }
    await connection.query('BEGIN');
    await connection.query('DELETE FROM ispadmin_client_cache');
    for (let start = 0; start < rows.length; start += 500) {
      const batch = rows.slice(start, start + 500);
      const values: unknown[] = [];
      const tuples = batch.map((row, index) => { const base = index * 5; values.push(...row); return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},now())`; });
      if (tuples.length) await connection.query(`INSERT INTO ispadmin_client_cache (client_id,phone_hash,contract_hash,client_name,balance_attention,synced_at) VALUES ${tuples.join(',')} ON CONFLICT DO NOTHING`, values);
    }
    await connection.query("UPDATE ispadmin_cache_sync SET status='ready', completed_at=now(), client_count=$1, error_code='' WHERE id=1", [clients.length]);
    await connection.query('COMMIT');
    logger.info({ clients: clients.length, pairs: rows.length }, 'ISPadmin local cache synchronized');
    return clients.length;
  } catch (error) {
    await connection.query('ROLLBACK');
    const code = error instanceof Error && (/^ISPadmin API vrátilo HTTP \d+\.$/.test(error.message) || error.message === 'cache_key_missing' || error.message === 'ispadmin_not_configured') ? error.message.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) : 'sync_failed';
    await pool.query("UPDATE ispadmin_cache_sync SET status='error', error_code=$1 WHERE id=1", [code]);
    logger.warn({ code }, 'ISPadmin cache synchronization failed');
    throw error;
  } finally { connection.release(); }
}

export async function ispadminCacheStatus(): Promise<{ status: string; completedAt: string | null; clients: number; errorCode: string }> {
  const result = await pool.query<{ status: string; completed_at: Date | null; client_count: number; error_code: string }>('SELECT status,completed_at,client_count,error_code FROM ispadmin_cache_sync WHERE id=1');
  const row = result.rows[0];
  return { status: row?.status ?? 'never', completedAt: row?.completed_at?.toISOString() ?? null, clients: row?.client_count ?? 0, errorCode: row?.error_code ?? '' };
}

export async function lookupIspadminCaller(callerPhone: string, settings: Pick<RuntimeSettings, 'ispadminApiBaseUrl' | 'ispadminApiToken'>): Promise<IspadminCaller> {
  if (!settings.ispadminApiBaseUrl || !settings.ispadminApiToken) return { status: 'disabled' };
  const hashes = phoneHashes(callerPhone);
  if (!hashes.length) return { status: 'no_caller_id' };
  try {
    const result = await pool.query<{ client_count: string }>('SELECT count(DISTINCT client_id)::text AS client_count FROM ispadmin_client_cache WHERE phone_hash=ANY($1::text[])', [hashes]);
    const count = Number(result.rows[0]?.client_count ?? 0);
    return count === 0 ? { status: 'not_found' } : { status: 'candidate' };
  } catch {
    logger.warn({ code: 'cache_lookup_failed' }, 'ISPadmin local cache lookup failed');
    return { status: 'unavailable' };
  }
}

export async function verifyIspadminContract(callerPhone: string, spokenContract: string, settings: Pick<RuntimeSettings, 'ispadminApiBaseUrl' | 'ispadminApiToken'>, attemptsRemaining: number): Promise<IspadminVerification> {
  const normalized = contractKey(spokenContract);
  if (!normalized || normalized.length > 80 || !settings.ispadminApiBaseUrl || !settings.ispadminApiToken) return { verified: false, attemptsRemaining };
  const phones = phoneHashes(callerPhone);
  try {
    const result = await pool.query<{ client_id: string; client_name: string; balance_attention: boolean }>(
      `SELECT DISTINCT ON (client_id) client_id,client_name,balance_attention FROM ispadmin_client_cache
       WHERE phone_hash=ANY($1::text[]) AND contract_hash=$2 AND synced_at>now()-interval '24 hours'
       ORDER BY client_id,synced_at DESC LIMIT 2`, [phones, hash(normalized)]
    );
    if (result.rows.length !== 1) return { verified: false, attemptsRemaining };
    const client = result.rows[0]!;
    let activeServices: string[] = [];
    try {
      const response = await getJson(new URL(`${ispadminBaseUrl(settings.ispadminApiBaseUrl)}/clients/${encodeURIComponent(client.client_id)}/services`), settings.ispadminApiToken);
      activeServices = (Array.isArray(response) ? response : []).slice(0, 8).flatMap(item => {
        const service = asRecord(item);
        if (!service) return [];
        const name = typeof service.name === 'string' ? service.name.replace(/[\u0000-\u001f]/g, ' ').trim() : '';
        const type = typeof service.type === 'string' ? service.type.trim() : '';
        const label = name && type ? `${name} (${type})` : name || type;
        return label ? [label.slice(0, 100)] : [];
      });
    } catch { /* verified identity remains valid; services may be unavailable */ }
    return { verified: true, clientName: client.client_name || 'klient', balanceAttention: client.balance_attention, activeServices };
  } catch {
    logger.warn({ code: 'verification_failed' }, 'ISPadmin contract verification failed');
    return { verified: false, attemptsRemaining };
  }
}

export function startIspadminCacheSync(getSettings: () => Promise<RuntimeSettings>): ReturnType<typeof setInterval> {
  const run = async () => {
    try { const settings = await getSettings(); if (settings.ispadminApiBaseUrl && settings.ispadminApiToken) await syncIspadminCache(settings); }
    catch { /* status is recorded without logging client data */ }
  };
  const timer = setInterval(() => void run(), SYNC_INTERVAL_MS);
  timer.unref?.();
  void run();
  return timer;
}
