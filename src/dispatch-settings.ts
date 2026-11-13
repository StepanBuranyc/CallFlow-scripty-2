import { z } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';

export const dispatchSettingsSchema = z.object({
  enabled: z.boolean(),
  queueExtension: z.string().trim().regex(/^[0-9]{0,16}$/)
}).refine(settings => !settings.enabled || Boolean(settings.queueExtension));
type DispatchSettings = z.infer<typeof dispatchSettingsSchema>;

let settings: DispatchSettings = {
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
