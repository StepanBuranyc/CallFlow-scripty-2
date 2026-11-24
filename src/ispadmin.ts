import { normalizePhoneNumber } from './phone-number.js';
import type { RuntimeSettings } from './runtime-settings.js';
import { config } from './config.js';
import pino from 'pino';

const logger = pino({ level: config.LOG_LEVEL, redact: ['*.token', '*.apiKey'] });

export type IspadminLookup =
  | { status: 'disabled' | 'no_caller_id' | 'not_found' | 'ambiguous' | 'unavailable' }
  | {
      status: 'matched';
      clientName: string;
      clientNumber?: string;
      balanceState: 'negative' | 'zero' | 'positive' | 'unknown';
      activeServices: string[];
    };

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
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
  if (national) {
    keys.add(national);
    keys.add(`0${national}`);
  } else if (digits.startsWith('0') && digits.length === 10) {
    keys.add(digits.slice(1));
    keys.add(`420${digits.slice(1)}`);
  } else if (digits.length === 9) {
    keys.add(`420${digits}`);
    keys.add(`0${digits}`);
  }
  return [...keys];
}

function phoneMatches(client: JsonRecord, callerPhone: string): boolean {
  const callerKeys = new Set(phoneKeys(callerPhone));
  return ['phone', 'mobile', 'telephone', 'mobilephone'].some(field => {
    const clientKeys = phoneKeys(client[field]);
    return clientKeys.some(key => callerKeys.has(key));
  });
}

function clientListUrl(baseUrl: string, phone: string): URL {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/clients`);
  url.searchParams.set('phone', phone);
  return url;
}

async function getJson(url: URL, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Token: token, Accept: 'application/json' },
    signal: AbortSignal.timeout(3500)
  });
  if (!response.ok) throw new Error(`ISPadmin returned HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

function balanceState(value: unknown): 'negative' | 'zero' | 'positive' | 'unknown' {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  if (value < 0) return 'negative';
  if (value > 0) return 'positive';
  return 'zero';
}

function activeServiceLabels(value: unknown): string[] {
  const rows = Array.isArray(value) ? value : [];
  return rows.slice(0, 8).flatMap(item => {
    const record = asRecord(item);
    if (!record) return [];
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const type = typeof record.type === 'string' ? record.type.trim() : '';
    const label = name && type ? `${name} (${type})` : name || type;
    return label ? [label.slice(0, 100)] : [];
  });
}

/** Reads only the caller's matching ISPadmin account and its active services. */
export async function lookupIspadminCaller(callerPhone: string, settings: Pick<RuntimeSettings, 'ispadminApiBaseUrl' | 'ispadminApiToken'>): Promise<IspadminLookup> {
  if (!settings.ispadminApiBaseUrl || !settings.ispadminApiToken) return { status: 'disabled' };
  if (phoneKeys(callerPhone).every(key => key.length < 7)) return { status: 'no_caller_id' };

  try {
    const clientsResponse = await getJson(clientListUrl(settings.ispadminApiBaseUrl, callerPhone), settings.ispadminApiToken);
    const matches = recordsFromResponse(clientsResponse).filter(client => phoneMatches(client, callerPhone));
    if (matches.length === 0) return { status: 'not_found' };
    if (matches.length !== 1) return { status: 'ambiguous' };

    const client = matches[0]!;
    const id = client.id;
    if (typeof id !== 'number' && typeof id !== 'string') throw new Error('ISPadmin client response did not include a client ID');
    const servicesUrl = new URL(`${settings.ispadminApiBaseUrl.replace(/\/+$/, '')}/clients/${encodeURIComponent(String(id))}/services`);
    const services = activeServiceLabels(await getJson(servicesUrl, settings.ispadminApiToken));
    const name = typeof client.name === 'string' && client.name.trim() ? client.name.trim().slice(0, 160) : 'klient';
    const clientNumber = typeof client.clientNumber === 'string' ? client.clientNumber.slice(0, 40) : undefined;
    return {
      status: 'matched',
      clientName: name,
      ...(clientNumber ? { clientNumber } : {}),
      balanceState: balanceState(client.balance),
      activeServices: services
    };
  } catch (error) {
    logger.warn({ err: error }, 'ISPadmin caller lookup failed');
    return { status: 'unavailable' };
  }
}

