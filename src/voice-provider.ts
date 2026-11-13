import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';

export const voiceProviderSchema = z.object({
  provider: z.enum(['openai', 'grok']),
  grokVoice: z.enum(['Ara', 'Eve', 'Rex', 'Sal', 'Leo']),
  openaiKey: z.string().trim().max(512).regex(/^[!-~]*$/).optional(),
  grokKey: z.string().trim().max(512).regex(/^[!-~]*$/).optional()
});
type ProviderSettings = z.infer<typeof voiceProviderSchema>;
type StoredSettings = Omit<ProviderSettings, 'openaiKey' | 'grokKey'> & {
  openaiKey?: string;
  grokKey?: string;
};
let stored: StoredSettings = { provider: 'openai', grokVoice: 'Eve' };

const encryptionKey = Buffer.from(hkdfSync('sha256', process.env.VOICE_SECRETS_KEY || config.PBX_APP_SECRET,
  'service-intake', 'voice-provider-credentials-v1', 32));

function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function decrypt(value: string): string {
  const data = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey, data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
}

export function getOpenAiKey(): string {
  return stored.openaiKey ? decrypt(stored.openaiKey) : config.OPENAI_API_KEY;
}

export function getVoiceProvider() {
  const grok = stored.provider === 'grok';
  return {
    grok,
    name: grok ? 'Grok' : 'OpenAI',
    model: grok ? 'grok-voice-latest' : config.OPENAI_MODEL,
    endpoint: grok ? 'wss://api.x.ai/v1/realtime' : 'wss://api.openai.com/v1/realtime',
    voice: stored.grokVoice,
    key: grok ? decrypt(stored.grokKey!) : getOpenAiKey()
  };
}

export function getVoiceProviderStatus() {
  return { provider: stored.provider, grokVoice: stored.grokVoice,
    hasOpenAiKey: Boolean(stored.openaiKey || config.OPENAI_API_KEY), hasGrokKey: Boolean(stored.grokKey) };
}

export async function loadVoiceProvider(): Promise<void> {
  const result = await pool.query<{ settings: StoredSettings }>('SELECT settings FROM voice_provider_settings WHERE id = true');
  if (result.rows[0]) stored = result.rows[0].settings;
}

export async function saveVoiceProvider(next: ProviderSettings): Promise<boolean> {
  const patch = {
    provider: next.provider, grokVoice: next.grokVoice,
    ...(next.openaiKey ? { openaiKey: encrypt(next.openaiKey) } : {}),
    ...(next.grokKey ? { grokKey: encrypt(next.grokKey) } : {})
  };
  const result = await pool.query<{ settings: StoredSettings }>(
    `INSERT INTO voice_provider_settings (id, settings)
     SELECT true, $1::jsonb WHERE $2 OR $1::jsonb ? 'grokKey' OR EXISTS (SELECT 1 FROM voice_provider_settings WHERE id = true AND settings ? 'grokKey')
     ON CONFLICT (id) DO UPDATE SET settings = voice_provider_settings.settings || EXCLUDED.settings
     RETURNING settings`, [patch, next.provider !== 'grok']
  );
  if (!result.rows[0]) return false;
  stored = result.rows[0].settings;
  return true;
}
