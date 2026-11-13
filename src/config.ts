import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_BASE_PATH: z.string().regex(/^(?:\/[a-z0-9](?:[a-z0-9/-]*[a-z0-9])?)?$/).default(''),
  DATABASE_URL: z.string().min(1),
  PBX_BASE: z.string().url(),
  PBX_APP_ID: z.string().min(1),
  PBX_APP_SECRET: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default('gpt-realtime-2'),
  OPENAI_VOICE: z.string().default('alloy'),
  COMPANY_NAME: z.string().default('servisní podpory'),
  AGENT_PROFILE: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/).default('service-intake'),
  AGENT_NAME: z.string().default('Asistentka'),
  SERVICE_QUEUE_EXTENSION: z.string().trim().default(''),
  SERVICE_DISPATCH_ENABLED: z.enum(['true', 'false']).default('false'),
  TEST_OUTBOUND_ENABLED: z.enum(['true', 'false']).default('false'),
  TEST_AUDIO_TONE_HZ: z.coerce.number().int().min(200).max(2000).default(700),
  TEST_AUDIO_TONE_MS: z.coerce.number().int().min(100).max(3000).default(500),
  DASHBOARD_USERNAME: z.string().min(1).default('client'),
  DASHBOARD_PASSWORD: z.string().default('').refine(value => value === '' || value.length >= 24, 'DASHBOARD_PASSWORD must have at least 24 characters.'),
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().default('').refine(value => value === '' || value.length >= 24, 'ADMIN_PASSWORD must have at least 24 characters.'),
  THREEX_REPORT_CALL_TOKEN: z.string().default('').refine(value => value === '' || value.length >= 32, 'THREEX_REPORT_CALL_TOKEN must have at least 32 characters.'),
  LOG_LEVEL: z.string().default('info')
}).refine(
  value => !value.ADMIN_PASSWORD || value.ADMIN_USERNAME.trim().toLowerCase() !== value.DASHBOARD_USERNAME.trim().toLowerCase(),
  { message: 'ADMIN_USERNAME must differ from DASHBOARD_USERNAME.', path: ['ADMIN_USERNAME'] }
);

const parsed = schema.parse(process.env);
export const config = {
  ...parsed,
  serviceQueueExtension: parsed.SERVICE_QUEUE_EXTENSION,
  serviceDispatchEnabled: parsed.SERVICE_DISPATCH_ENABLED === 'true',
  testOutboundEnabled: parsed.TEST_OUTBOUND_ENABLED === 'true'
};
