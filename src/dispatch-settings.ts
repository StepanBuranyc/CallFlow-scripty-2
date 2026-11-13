import { z } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';

const defaultMenu = {
  briefing: 'Servisní požadavek. Tiket {{ticket_number}}. Volá {{caller_name}}. Zpětné číslo {{callback_number}}. Naléhavost {{urgency}}. Popis: {{issue_summary}}.',
  acceptPhrase: 'potvrzuji',
  repeatPhrase: 'opakovat',
  connectPhrase: 'spojit s klientem'
};

export function normalizeCommand(value: string): string {
  return value.toLocaleLowerCase('cs-CZ').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

const phrase = z.string().trim().max(50).refine(value => /^[\p{L} ]+$/u.test(value) && Boolean(normalizeCommand(value)));

export const dispatchSettingsSchema = z.object({
  briefing: z.string().trim().min(1).max(2000).default(defaultMenu.briefing),
  acceptPhrase: phrase.default(defaultMenu.acceptPhrase),
  repeatPhrase: phrase.default(defaultMenu.repeatPhrase),
  connectPhrase: phrase.default(defaultMenu.connectPhrase),
  enabled: z.boolean(),
  queueExtension: z.string().trim().regex(/^[0-9]{0,16}$/)
}).refine(settings => !settings.enabled || Boolean(settings.queueExtension)).refine(settings =>
  new Set([settings.acceptPhrase, settings.repeatPhrase, settings.connectPhrase].map(normalizeCommand)).size === 3
);
type DispatchSettings = z.infer<typeof dispatchSettingsSchema>;

let settings: DispatchSettings = {
  ...defaultMenu,
  enabled: config.serviceDispatchEnabled,
  queueExtension: config.serviceQueueExtension
};

export function getDispatchSettings(): DispatchSettings {
  return settings;
}

export async function loadDispatchSettings(): Promise<void> {
  const result = await pool.query<{ settings: DispatchSettings }>('SELECT settings FROM dispatch_settings WHERE id = true');
  if (result.rows[0]) settings = dispatchSettingsSchema.parse(result.rows[0].settings);
}

export async function saveDispatchSettings(next: DispatchSettings): Promise<void> {
  await pool.query(
    `INSERT INTO dispatch_settings (id, settings) VALUES (true, $1)
     ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings`,
    [next]
  );
  settings = next;
}
