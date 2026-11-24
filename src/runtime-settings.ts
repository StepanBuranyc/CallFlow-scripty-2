import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';
import { config } from './config.js';
import { pool } from './db.js';

const profile = loadYaml(readFileSync(new URL(`../agents/${config.AGENT_PROFILE}.yaml`, import.meta.url), 'utf8')) as {
  role: string; prompt: string; greeting: string; voice?: string; speed?: number;
};
const key = config.APP_SETTINGS_ENCRYPTION_KEY ? Buffer.from(config.APP_SETTINGS_ENCRYPTION_KEY, 'hex') : undefined;
export const OPENAI_REALTIME_MODELS = ['gpt-realtime-2.1', 'gpt-realtime-2.1-mini'] as const;

export type RuntimeSettings = {
  ispadminApiBaseUrl: string;
  ispadminApiToken: string;
  openAiModel: string;
  role: string;
  prompt: string;
  greeting: string;
  voice?: string;
  speed?: number;
};

function encrypt(value: string): string {
  if (!key) throw new Error('APP_SETTINGS_ENCRYPTION_KEY není nastaven; správce ji musí nejprve doplnit do .env a restartovat aplikaci.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

function decrypt(value: string): string {
  if (!value) return '';
  if (!key) throw new Error('APP_SETTINGS_ENCRYPTION_KEY chybí; nelze načíst uložený ISPadmin token.');
  const [ivText, tagText, encryptedText] = value.split('.');
  if (!ivText || !tagText || encryptedText === undefined) throw new Error('Uložený ISPadmin token má neplatný formát.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8');
}

export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const result = await pool.query<{
    ispadmin_api_base_url: string; ispadmin_api_token_ciphertext: string; openai_model: string;
    agent_role: string; agent_greeting: string; agent_prompt: string;
  }>('SELECT * FROM application_settings WHERE id=1');
  const row = result.rows[0];
  let ispadminApiToken = config.ISPADMIN_API_TOKEN;
  if (row) {
    try { ispadminApiToken = decrypt(row.ispadmin_api_token_ciphertext); }
    catch { ispadminApiToken = ''; }
  }
  return {
    ispadminApiBaseUrl: row?.ispadmin_api_base_url ?? config.ISPADMIN_API_BASE_URL,
    ispadminApiToken,
    openAiModel: row?.openai_model ?? config.OPENAI_MODEL,
    role: row?.agent_role || profile.role,
    greeting: row?.agent_greeting || profile.greeting,
    prompt: row?.agent_prompt || profile.prompt,
    voice: profile.voice,
    speed: profile.speed
  };
}

export async function saveRuntimeSettings(input: {
  ispadminApiBaseUrl: string; ispadminApiToken?: string; clearIspadminApiToken: boolean;
  openAiModel: string; role: string; greeting: string; prompt: string;
}): Promise<void> {
  const current = await pool.query<{ ispadmin_api_token_ciphertext: string }>(
    'SELECT ispadmin_api_token_ciphertext FROM application_settings WHERE id=1'
  );
  let tokenCiphertext = current.rows[0]?.ispadmin_api_token_ciphertext ?? (config.ISPADMIN_API_TOKEN ? encrypt(config.ISPADMIN_API_TOKEN) : '');
  if (input.clearIspadminApiToken) tokenCiphertext = '';
  else if (input.ispadminApiToken) tokenCiphertext = encrypt(input.ispadminApiToken);
  if (input.ispadminApiBaseUrl && !tokenCiphertext) throw new Error('Pro zapnutí ISPadminu zadejte API token.');
  await pool.query(
    `INSERT INTO application_settings (id, ispadmin_api_base_url, ispadmin_api_token_ciphertext, openai_model, agent_role, agent_greeting, agent_prompt)
     VALUES (1,$1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET ispadmin_api_base_url=EXCLUDED.ispadmin_api_base_url,
       ispadmin_api_token_ciphertext=EXCLUDED.ispadmin_api_token_ciphertext, openai_model=EXCLUDED.openai_model,
       agent_role=EXCLUDED.agent_role, agent_greeting=EXCLUDED.agent_greeting, agent_prompt=EXCLUDED.agent_prompt, updated_at=now()`,
    [input.ispadminApiBaseUrl, tokenCiphertext, input.openAiModel, input.role, input.greeting, input.prompt]
  );
}

export function runtimeSettingsStatus(tokenCiphertext: string): { hasIspadminToken: boolean; encryptionKeyConfigured: boolean } {
  return { hasIspadminToken: Boolean(tokenCiphertext || config.ISPADMIN_API_TOKEN), encryptionKeyConfigured: Boolean(key) };
}

export async function testIspadminConnection(baseUrl: string, token: string): Promise<void> {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/clients`);
  url.searchParams.set('phone', '000000000');
  const response = await fetch(url, { headers: { Token: token, Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`ISPadmin API vrátilo HTTP ${response.status}.`);
  await response.arrayBuffer();
}

