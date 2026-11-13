import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.DATABASE_URL, max: 5 });

export async function migrate(): Promise<void> {
  for (const file of ['001_prototype.sql', '002_service_requests.sql', '003_service_request_number.sql', '004_service_request_dispatch.sql', '005_dispatch_caller_transfer.sql', '006_normalize_callback_numbers.sql', '007_dashboard_users.sql', '008_service_request_calls.sql', '009_agent_settings.sql', '010_voice_provider_settings.sql', '011_dispatch_settings.sql']) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await pool.query(sql);
  }
}

export async function ready(): Promise<boolean> {
  try { await pool.query('SELECT 1'); return true; }
  catch { return false; }
}
