import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';
import Mustache from 'mustache';
import { config } from './config.js';
import { pool } from './db.js';

const profile = loadYaml(readFileSync(new URL(`../agents/${config.AGENT_PROFILE}.yaml`, import.meta.url), 'utf8')) as {
  role: string; prompt: string; greeting: string; voice?: string; speed?: number;
};
const key = config.APP_SETTINGS_ENCRYPTION_KEY ? Buffer.from(config.APP_SETTINGS_ENCRYPTION_KEY, 'hex') : undefined;
export const settingsEncryptionConfigured = Boolean(key);
export class SettingsError extends Error {}

export type RuntimeSettings = {
  ispadminApiBaseUrl: string;
  ispadminApiToken: string;
  ispadminTokenUnreadable: boolean;
  openAiModel: string;
  voiceProvider: 'openai' | 'xai';
  role: string;
  prompt: string;
  greeting: string;
  voice?: string;
  speed?: number;
};

export function encryptSettingsSecret(value: string): string {
  if (!key) throw new SettingsError('Pro uložení klíče nastavte APP_SETTINGS_ENCRYPTION_KEY v konfiguraci serveru.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

export function decryptSettingsSecret(value: string): string {
  if (!value) return '';
  if (!key) throw new Error('APP_SETTINGS_ENCRYPTION_KEY chybí.');
  const [ivText, tagText, encryptedText] = value.split('.');
  if (!ivText || !tagText || encryptedText === undefined) throw new Error('Uložená hodnota má neplatný formát.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8');
}

export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const result = await pool.query<{
    ispadmin_api_base_url: string; ispadmin_api_token_ciphertext: string; openai_model: string;
    voice_provider: RuntimeSettings['voiceProvider'] | null;
    agent_role: string; agent_greeting: string; agent_prompt: string;
  }>('SELECT * FROM application_settings WHERE id=1');
  const row = result.rows[0];
  let ispadminApiToken = config.ISPADMIN_API_TOKEN;
  let ispadminTokenUnreadable = false;
  if (row) {
    try { ispadminApiToken = decryptSettingsSecret(row.ispadmin_api_token_ciphertext); }
    catch { ispadminApiToken = ''; ispadminTokenUnreadable = true; }
  }
  return {
    ispadminApiBaseUrl: row?.ispadmin_api_base_url ?? config.ISPADMIN_API_BASE_URL,
    ispadminApiToken,
    ispadminTokenUnreadable,
    openAiModel: row?.openai_model ?? config.OPENAI_MODEL,
    voiceProvider: row?.voice_provider ?? config.VOICE_PROVIDER,
    role: row?.agent_role || profile.role,
    greeting: row?.agent_greeting || profile.greeting,
    prompt: row?.agent_prompt || profile.prompt,
    voice: profile.voice,
    speed: profile.speed
  };
}

export async function saveRuntimeSettings(input: {
  ispadminApiBaseUrl: string; ispadminApiToken?: string; clearIspadminApiToken: boolean;
  openAiModel: string; voiceProvider: RuntimeSettings['voiceProvider']; role: string; greeting: string; prompt: string;
}): Promise<void> {
  try { Mustache.parse(input.prompt); Mustache.parse(input.greeting); }
  catch { throw new SettingsError('Prompt nebo pozdrav obsahuje neplatnou šablonu {{…}}.'); }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('LOCK TABLE application_settings IN SHARE ROW EXCLUSIVE MODE');
    const current = await db.query<{ ispadmin_api_base_url: string; ispadmin_api_token_ciphertext: string }>(
      'SELECT ispadmin_api_base_url, ispadmin_api_token_ciphertext FROM application_settings WHERE id=1'
    );
    const originOf = (value: string) => URL.canParse(value) ? new URL(value).origin : '';
    const oldUrl = current.rows[0]?.ispadmin_api_base_url ?? config.ISPADMIN_API_BASE_URL;
    const oldToken = current.rows[0]?.ispadmin_api_token_ciphertext ?? config.ISPADMIN_API_TOKEN;
    if (input.ispadminApiBaseUrl && oldToken && !input.ispadminApiToken && !input.clearIspadminApiToken &&
        originOf(oldUrl) !== originOf(input.ispadminApiBaseUrl)) {
      throw new SettingsError('Pro novou doménu ISPadminu zadejte API token znovu.');
    }
    let tokenCiphertext = '';
    if (input.ispadminApiBaseUrl && !input.clearIspadminApiToken) {
      tokenCiphertext = input.ispadminApiToken ? encryptSettingsSecret(input.ispadminApiToken) :
        current.rows[0]?.ispadmin_api_token_ciphertext ?? (config.ISPADMIN_API_TOKEN ? encryptSettingsSecret(config.ISPADMIN_API_TOKEN) : '');
      if (!tokenCiphertext) throw new SettingsError('Pro zapnutí ISPadminu zadejte API token.');
    }
    await db.query(
      `INSERT INTO application_settings (id, ispadmin_api_base_url, ispadmin_api_token_ciphertext, openai_model, voice_provider, agent_role, agent_greeting, agent_prompt)
       VALUES (1,$1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET ispadmin_api_base_url=EXCLUDED.ispadmin_api_base_url,
         ispadmin_api_token_ciphertext=EXCLUDED.ispadmin_api_token_ciphertext, openai_model=EXCLUDED.openai_model,
         voice_provider=EXCLUDED.voice_provider, agent_role=EXCLUDED.agent_role, agent_greeting=EXCLUDED.agent_greeting,
         agent_prompt=EXCLUDED.agent_prompt, updated_at=now()`,
      [input.clearIspadminApiToken ? '' : input.ispadminApiBaseUrl, tokenCiphertext, input.openAiModel, input.voiceProvider, input.role, input.greeting, input.prompt]
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

export function runtimeSettingsStatus(settings: RuntimeSettings) {
  return { hasIspadminToken: Boolean(settings.ispadminApiToken), encryptionKeyConfigured: settingsEncryptionConfigured, ispadminTokenUnreadable: settings.ispadminTokenUnreadable };
}

