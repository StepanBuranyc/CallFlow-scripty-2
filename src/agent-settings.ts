import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';
import Mustache from 'mustache';
import { z } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';

export const agentVoices = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'] as const;
const templateText = (limit: number) => z.string().trim().min(1).max(limit).refine(value => {
  try { Mustache.parse(value); return true; }
  catch { return false; }
});
export const agentSettingsSchema = z.object({
  prompt: templateText(20000),
  greeting: templateText(2000),
  voice: z.enum(agentVoices),
  speed: z.number().min(0.25).max(1.5)
});
type AgentSettings = z.infer<typeof agentSettingsSchema>;

const profile = z.object({
  role: z.string().min(1),
  prompt: z.string().min(1),
  greeting: z.string().min(1),
  voice: z.string().optional(),
  speed: z.number().min(0.25).max(1.5).optional()
}).parse(loadYaml(readFileSync(new URL(`../agents/${config.AGENT_PROFILE}.yaml`, import.meta.url), 'utf8')));

let settings = {
  prompt: profile.prompt,
  greeting: profile.greeting,
  voice: profile.voice ?? config.OPENAI_VOICE,
  speed: profile.speed ?? 1
};

export function getAgentProfile() {
  return { role: profile.role, ...settings };
}

export async function loadAgentSettings(): Promise<void> {
  const result = await pool.query<{ settings: AgentSettings }>(
    'SELECT settings FROM agent_settings WHERE profile = $1', [config.AGENT_PROFILE]
  );
  if (result.rows[0]) settings = agentSettingsSchema.parse(result.rows[0].settings);
}

export async function saveAgentSettings(next: AgentSettings): Promise<void> {
  await pool.query(
    `INSERT INTO agent_settings (profile, settings) VALUES ($1, $2)
     ON CONFLICT (profile) DO UPDATE SET settings = EXCLUDED.settings`,
    [config.AGENT_PROFILE, next]
  );
  settings = next;
}
