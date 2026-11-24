import { createHash } from 'node:crypto';
import pino from 'pino';
import { config } from './config.js';
import { pool } from './db.js';

export type Component = 'container' | 'agent' | 'pbx' | 'ispadmin' | 'openai' | 'xai';
export type Health = { state: 'ok' | 'warning' | 'error'; message: string; checkedAt: string | null };

const logger = pino({ level: config.LOG_LEVEL });
const connections = new Map<string, Health>();
const staleAfter = 24 * 60 * 60 * 1_000;

export function logOperation(component: Component, level: 'info' | 'warn' | 'error', message: string, callId?: string): void {
  logger[level]({ component, callId }, message);
  void pool.query(
    'INSERT INTO operational_events (component, level, message, call_id) VALUES ($1,$2,$3,$4)',
    [component, level, message, callId ?? null]
  ).catch(() => logger.warn({ component }, 'Provozní událost se nepodařilo uložit do databáze.'));
}

export const settingsKey = (...parts: string[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

export function reportConnection(component: Component, key: string, state: Health['state'], message: string, callId?: string): Health {
  const status = { state, message, checkedAt: new Date().toISOString() };
  const connectionId = component + ':' + key;
  connections.delete(connectionId);
  connections.set(connectionId, status);
  if (connections.size > 32) {
    const oldest = connections.keys().next();
    if (!oldest.done) connections.delete(oldest.value);
  }
  logOperation(component, state === 'ok' ? 'info' : state === 'warning' ? 'warn' : 'error', message, callId);
  return status;
}

export function connectionStatus(component: Component, key: string, fallback: string): Health {
  const status = connections.get(component + ':' + key);
  if (!status) return { state: 'warning', message: fallback, checkedAt: null };
  if (component !== 'pbx' && status.state === 'ok' && Date.now() - Date.parse(status.checkedAt!) > staleAfter) {
    return { ...status, state: 'warning', message: 'Poslední úspěšná kontrola je starší než 24 hodin.' };
  }
  return status;
}

export async function operationsHistory() {
  const [events, calls] = await Promise.all([
    pool.query('SELECT id, created_at, component, level, message, call_id FROM operational_events ORDER BY id DESC LIMIT 200'),
    pool.query(`SELECT c.id, c.started_at, c.ended_at, c.caller_number, c.provider, c.outcome, r.ticket_number
                FROM agent_calls c LEFT JOIN service_requests r ON c.request_id=r.id
                ORDER BY c.started_at DESC LIMIT 50`)
  ]);
  return { events: events.rows, calls: calls.rows };
}
