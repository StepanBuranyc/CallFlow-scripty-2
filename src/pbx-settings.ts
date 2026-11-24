import { config } from './config.js';
import { pool } from './db.js';
import { settingsKey } from './operations.js';
import { decryptSettingsSecret, encryptSettingsSecret, SettingsError } from './runtime-settings.js';

export type PbxSettings = { baseUrl: string; clientId: string; clientSecret: string; queueExtension: string };
type PbxRow = { base_url: string; client_id: string; client_secret_ciphertext: string; queue_extension: string };
const configured = {
  baseUrl: config.PBX_BASE.replace(/\/+$/, ''),
  clientId: config.PBX_APP_ID,
  clientSecret: config.PBX_APP_SECRET,
  queueExtension: config.SERVICE_QUEUE_EXTENSION
};

export function parsePbxSettings(body: Record<string, unknown>): PbxSettings {
  const take = (key: string) => typeof body[key] === 'string' ? body[key].trim() : '';
  const address = take('baseUrl');
  const clientId = take('clientId');
  const clientSecret = take('clientSecret');
  const queueExtension = take('queueExtension');
  if (!URL.canParse(address) || address.length > 2048) throw new SettingsError('Zadejte platnou HTTPS adresu 3CX.');
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new SettingsError('Zadejte základní HTTPS adresu ústředny 3CX bez cesty a přihlašovacích údajů.');
  }
  if (!/^[a-z0-9_.-]{1,80}$/i.test(clientId)) throw new SettingsError('Zadejte Client ID programovatelné klapky.');
  if (clientSecret.length > 2048 || /[\r\n]/.test(clientSecret)) throw new SettingsError('3CX API klíč má neplatný formát.');
  if (!/^[a-z0-9_.-]{0,40}$/i.test(queueExtension)) throw new SettingsError('Klapka fronty má neplatný formát.');
  return { baseUrl: url.origin, clientId, clientSecret, queueExtension };
}

function readSettings(row?: PbxRow): PbxSettings & { secretUnreadable: boolean } {
  if (!row) return { ...configured, secretUnreadable: false };
  let clientSecret = '';
  let secretUnreadable = false;
  try { clientSecret = decryptSettingsSecret(row.client_secret_ciphertext); }
  catch { secretUnreadable = true; }
  return { baseUrl: row.base_url, clientId: row.client_id, queueExtension: row.queue_extension, clientSecret, secretUnreadable };
}

export async function getPbxSettings() {
  const result = await pool.query<PbxRow>('SELECT * FROM pbx_portal_settings WHERE id=1');
  return readSettings(result.rows[0]);
}

export function withStoredPbxSecret(draft: PbxSettings, existing: PbxSettings): PbxSettings {
  if (draft.clientSecret) return draft;
  const sameAddress = URL.canParse(existing.baseUrl) && new URL(existing.baseUrl).origin === draft.baseUrl;
  if (!sameAddress || draft.clientId !== existing.clientId || !existing.clientSecret) {
    throw new SettingsError('Zadejte API klíč pro uvedenou ústřednu a Client ID.');
  }
  return { ...draft, clientSecret: existing.clientSecret };
}

export const pbxProbeKey = (s: PbxSettings): string => settingsKey(s.baseUrl, s.clientId, s.clientSecret);

export async function storePbxSettings(draft: PbxSettings): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('LOCK TABLE pbx_portal_settings IN SHARE ROW EXCLUSIVE MODE');
    const current = (await db.query<PbxRow>('SELECT * FROM pbx_portal_settings WHERE id=1')).rows[0];
    const next = withStoredPbxSecret(draft, readSettings(current));
    const encrypted = draft.clientSecret || !current ? encryptSettingsSecret(next.clientSecret) : current.client_secret_ciphertext;
    await db.query(
      `INSERT INTO pbx_portal_settings (id,base_url,client_id,client_secret_ciphertext,queue_extension) VALUES (1,$1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET base_url=EXCLUDED.base_url,client_id=EXCLUDED.client_id,
         client_secret_ciphertext=EXCLUDED.client_secret_ciphertext,queue_extension=EXCLUDED.queue_extension`,
      [next.baseUrl, next.clientId, encrypted, next.queueExtension]
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); }
}

export async function checkPbxApi(settings: PbxSettings): Promise<void> {
  const { baseUrl, clientId, clientSecret } = parsePbxSettings(settings);
  if (!clientSecret) throw new SettingsError('Zadejte 3CX API klíč.');
  const send = (path: string, request: RequestInit) => fetch(baseUrl + path, {
    ...request, signal: AbortSignal.timeout(5_000), redirect: 'manual'
  }).catch(() => { throw new SettingsError('3CX API není dostupné. Ověřte adresu, certifikát a síť.'); });
  const form = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' });
  const response = await send('/connect/token', { method: 'POST', body: form });
  if (!response.ok) {
    await response.body?.cancel();
    throw new SettingsError(`3CX nepřijalo přihlašovací údaje (HTTP ${response.status}).`);
  }
  const token: unknown = (await response.json().catch(() => null))?.access_token;
  if (typeof token !== 'string' || !token) throw new SettingsError('3CX neposlalo platný přístupový token.');
  const callControl = await send('/callcontrol/' + encodeURIComponent(clientId), { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
  await callControl.body?.cancel();
  if (!callControl.ok || !callControl.headers.get('content-type')?.includes('json')) {
    throw new SettingsError(`3CX nepovolilo čtení klapky přes Call Control API (HTTP ${callControl.status}).`);
  }
}
