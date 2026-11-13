import Fastify from 'fastify';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { CallControlClient } from '@3cx/call-control-sdk';
import type { Participant } from '@3cx/call-control-sdk';
import type { FastifyRequest } from 'fastify';
import pino from 'pino';
import { config } from './config.js';
import { makeTestTone } from './audio.js';
import { migrate, pool, ready } from './db.js';
import { agentSettingsSchema, agentVoices, getAgentProfile, loadAgentSettings, saveAgentSettings } from './agent-settings.js';
import { getVoiceProvider, getVoiceProviderStatus, loadVoiceProvider, saveVoiceProvider, voiceProviderSchema } from './voice-provider.js';
import { dispatchSettingsSchema, getDispatchSettings, loadDispatchSettings, saveDispatchSettings } from './dispatch-settings.js';
import { recentAiEvents } from './ai-diagnostics.js';
import { startOpenAiInterview } from './openai-realtime.js';
import { startTechnicianBriefing, type TechnicianBriefing } from './technician-briefing.js';
import { normalizePhoneNumber } from './phone-number.js';
import { dashboardHtml } from './dashboard.js';
import {
  currentDashboardUser, dashboardLogin, dashboardLogout, ensureBootstrapUsers, hashPassword,
  requireDashboardAdmin, requireDashboardUser, verifySameOrigin, type DashboardRole
} from './dashboard-auth.js';

const logger = pino({ level: config.LOG_LEVEL, redact: ['*.appSecret', '*.password'] });
const client = new CallControlClient({ pbxBase: config.PBX_BASE, appId: config.PBX_APP_ID, appSecret: config.PBX_APP_SECRET });
const app = Fastify({ logger: false, trustProxy: true });
app.addHook('onSend', async (request, reply, payload) => {
  if (request.url !== '/health') reply.header('Cache-Control', 'no-store');
  reply.header('X-Content-Type-Options', 'nosniff');
  return payload;
});
type RequestSummary = {
  id: string;
  ticket_number: number;
  caller_name: string;
  callback_number: string;
  issue_summary: string;
  urgency: string;
};
type OutboundCall = {
  kind: 'test' | 'dispatch';
  id: string;
  destinationDn: string;
  participantId?: number;
  connected?: boolean;
  request?: RequestSummary;
  attemptId?: string;
  attemptNo?: number;
  deadline?: ReturnType<typeof setTimeout>;
  transferDeadline?: ReturnType<typeof setTimeout>;
  briefing?: TechnicianBriefing;
  transferAttempts?: number;
  transferRecordPromise?: Promise<void>;
  finishing?: boolean;
};

const inFlight = new Map<number, OutboundCall>();
const interviews = new Map<number, () => void>();
const savedRequestsByParticipant = new Map<number, string>();
let activeOutbound: OutboundCall | undefined;
let outboundPending: OutboundCall | undefined;
let dispatchWorkerRunning = false;
const MAX_DISPATCH_ATTEMPTS = 3;
const DISPATCH_RETRY_DELAY_SECONDS = 60;

function correlatePendingOutbound(participant: Participant): void {
  if (!outboundPending || participant.info.party_dn !== outboundPending.destinationDn) return;
  outboundPending.participantId = participant.id;
  inFlight.set(participant.id, outboundPending);
}

function releaseOutbound(call: OutboundCall): void {
  if (call.deadline) clearTimeout(call.deadline);
  if (call.transferDeadline) clearTimeout(call.transferDeadline);
  if (outboundPending?.id === call.id) outboundPending = undefined;
  for (const [participantId, activeCall] of inFlight) {
    if (activeCall.id === call.id) inFlight.delete(participantId);
  }
  if (activeOutbound?.id === call.id) activeOutbound = undefined;
  if (call.kind === 'dispatch') setTimeout(() => void dispatchNext(), 1_000).unref?.();
}

async function finishDispatchFailure(call: OutboundCall, reason: string, detail: string): Promise<void> {
  if (!call.request || !call.attemptId || !call.attemptNo) return;
  if (call.finishing) return;
  call.finishing = true;
  const allowedStatuses = new Set(['no_answer', 'failed', 'ended']);
  const attemptStatus = allowedStatuses.has(reason) ? reason : 'failed';
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query(
      `UPDATE service_request_dispatch_attempts
       SET status=$2, result_detail=$3, finished_at=now()
       WHERE id=$1 AND status IN ('calling','connected')`,
      [call.attemptId, attemptStatus, detail]
    );
    const terminal = call.attemptNo >= MAX_DISPATCH_ATTEMPTS;
    await connection.query(
      `UPDATE service_requests
       SET status=$2, dispatch_due_at=$3
       WHERE id=$1 AND status='dispatching'`,
      [call.request.id, terminal ? 'unassigned' : 'received', terminal ? null : new Date(Date.now() + DISPATCH_RETRY_DELAY_SECONDS * 1_000)]
    );
    await connection.query('COMMIT');
    const fields = { requestId: call.request.id, ticketNumber: call.request.ticket_number, attemptNo: call.attemptNo, reason, terminal };
    if (terminal) logger.error(fields, 'service request is unassigned after the final dispatch attempt');
    else logger.warn(fields, 'technician dispatch attempt failed; next attempt scheduled');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
    releaseOutbound(call);
  }
}

async function acceptDispatch(call: OutboundCall): Promise<void> {
  if (!call.request || !call.attemptId) throw new Error('dispatch call is missing its ticket or attempt');
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    const accepted = await connection.query(
      `UPDATE service_requests SET status='accepted', dispatch_due_at=NULL
       WHERE id=$1 AND status='dispatching' RETURNING id`,
      [call.request.id]
    );
    if (!accepted.rowCount) throw new Error('ticket is no longer dispatching');
    await connection.query(
      `UPDATE service_request_dispatch_attempts
       SET status='accepted', dtmf_digit='1', finished_at=now()
       WHERE id=$1 AND status='connected'`,
      [call.attemptId]
    );
    await connection.query('COMMIT');
    logger.info({ requestId: call.request.id, ticketNumber: call.request.ticket_number, participantId: call.participantId }, 'technician accepted service request');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}

async function recordCallerTransfer(call: OutboundCall): Promise<void> {
  if (call.transferRecordPromise) return call.transferRecordPromise;
  const record = (async () => {
    if (!call.request || !call.attemptId) throw new Error('dispatch call is missing its ticket or attempt');
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      const accepted = await connection.query(
        `UPDATE service_requests SET status='accepted', dispatch_due_at=NULL
         WHERE id=$1 AND status='dispatching' RETURNING id`,
        [call.request.id]
      );
      if (!accepted.rowCount) throw new Error('ticket is no longer dispatching');
      await connection.query(
        `UPDATE service_request_dispatch_attempts
         SET status='accepted', dtmf_digit='3', result_detail='caller_transfer_succeeded', transfer_result='succeeded', finished_at=now()
         WHERE id=$1 AND status='connected'`,
        [call.attemptId]
      );
      await connection.query('COMMIT');
      logger.info({ requestId: call.request.id, ticketNumber: call.request.ticket_number, participantId: call.participantId }, 'technician connected to caller; service request accepted');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  })();
  call.transferRecordPromise = record;
  try {
    await record;
  } catch (error) {
    if (call.transferRecordPromise === record) call.transferRecordPromise = undefined;
    throw error;
  }
}

async function connectTechnicianToCaller(call: OutboundCall): Promise<'transferred' | 'failed' | 'pending'> {
  if (!call.request || !call.attemptId || call.participantId === undefined) throw new Error('dispatch call is missing its participant or ticket');
  call.transferAttempts = (call.transferAttempts ?? 0) + 1;
  await pool.query(
    `UPDATE service_request_dispatch_attempts
     SET transfer_attempts=transfer_attempts+1, transfer_result='pending'
     WHERE id=$1 AND status='connected'`,
    [call.attemptId]
  );
  logger.info({ requestId: call.request.id, ticketNumber: call.request.ticket_number, participantId: call.participantId, transferAttempt: call.transferAttempts, destination: call.request.callback_number }, 'transferring technician to caller');
  let response: { status: number; data: { finalstatus?: string; reason?: string; reasontext?: string } };
  try {
    response = await client.http.post<{ finalstatus?: string; reason?: string; reasontext?: string }>(
      `/callcontrol/${config.PBX_APP_ID}/participants/${call.participantId}/transferto`,
      { destination: normalizePhoneNumber(call.request.callback_number), reason: 'CallbackRequested', timeout: 25 },
      { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  } catch (error) {
    await pool.query(`UPDATE service_request_dispatch_attempts SET transfer_result='failed' WHERE id=$1 AND status='connected'`, [call.attemptId]);
    logger.warn({ err: error, requestId: call.request.id, transferAttempt: call.transferAttempts }, 'caller transfer request failed; technician remains on the call');
    return 'failed';
  }

  const finalstatus = response.data?.finalstatus?.toLowerCase();
  if (finalstatus === 'success' && response.status !== 202) {
    await recordCallerTransfer(call);
    return 'transferred';
  }
  if (finalstatus === 'failed' || finalstatus === 'rejected') {
    const detail = response.data.reasontext || response.data.reason || `transfer_${finalstatus}`;
    await pool.query(`UPDATE service_request_dispatch_attempts SET transfer_result=$2 WHERE id=$1 AND status='connected'`, [call.attemptId, detail]);
    logger.warn({ requestId: call.request.id, transferAttempt: call.transferAttempts, finalstatus, detail }, '3CX could not connect technician to caller');
    return 'failed';
  }

  // HTTP 202 means 3CX accepted the transfer but has not completed it yet.
  // The participant disconnect event confirms success; a bounded timer restores the menu.
  if (call.transferDeadline) clearTimeout(call.transferDeadline);
  call.transferDeadline = setTimeout(() => {
    void pool.query(`UPDATE service_request_dispatch_attempts SET transfer_result='timeout' WHERE id=$1 AND status='connected'`, [call.attemptId])
      .then(() => {
        logger.warn({ requestId: call.request!.id, transferAttempt: call.transferAttempts }, 'caller transfer timed out; technician can still take the ticket');
        call.briefing?.transferFailed();
      })
      .catch(error => logger.error({ err: error, requestId: call.request!.id }, 'could not record caller transfer timeout'));
  }, 35_000);
  call.transferDeadline.unref?.();
  return 'pending';
}

async function onAudioParticipant(participant: Participant): Promise<void> {
  if (participant.info.status !== 'Connected') return;
  let call = inFlight.get(participant.id);
  if (!call && outboundPending && participant.info.party_dn === outboundPending.destinationDn) {
    call = outboundPending;
    call.participantId = participant.id;
    inFlight.set(participant.id, call);
  }
  if (call) {
    // A RoutePoint participant can emit several Connected updates, and party_dn
    // may change as 3CX enriches the call state. Handle the outbound leg once and
    // never start a caller interview on a participant already correlated to it.
    if (call.connected || call.finishing) return;
    call.connected = true;
    if (call.kind === 'test') {
      await pool.query(
        `UPDATE prototype_outbound_calls SET status='connected', participant_id=$2, connected_at=now() WHERE id=$1 AND status='calling'`,
        [call.id, participant.id]
      );
      participant.getAudioWriter().write(makeTestTone(config.TEST_AUDIO_TONE_HZ, config.TEST_AUDIO_TONE_MS));
      outboundPending = undefined;
      logger.info({ callId: call.id, participantId: participant.id }, 'test tone played; press 1 to acknowledge');
      return;
    }

    if (!call.request || !call.attemptId) return;
    outboundPending = undefined;
    if (call.deadline) clearTimeout(call.deadline);
    await pool.query(
      `UPDATE service_request_dispatch_attempts
       SET status='connected', participant_id=$2, connected_at=now()
       WHERE id=$1 AND status='calling'`,
      [call.attemptId, participant.id]
    );
    call.briefing = startTechnicianBriefing(participant, {
      ticketNumber: call.request.ticket_number,
      callerName: call.request.caller_name,
      callbackNumber: call.request.callback_number,
      issueSummary: call.request.issue_summary,
      urgency: call.request.urgency
    }, {
      onAccepted: () => acceptDispatch(call!),
      onConnectToCaller: () => connectTechnicianToCaller(call!),
      onTransferCompleted: () => recordCallerTransfer(call!),
      onFailure: reason => finishDispatchFailure(call!, reason, reason),
      onFinished: () => releaseOutbound(call!)
    });
    logger.info({ callId: call.id, requestId: call.request.id, participantId: participant.id }, 'technician answered service dispatch call');
    return;
  }

  if (!interviews.has(participant.id)) {
    const stop = startOpenAiInterview(participant, requestId => savedRequestsByParticipant.set(participant.id, requestId));
    interviews.set(participant.id, stop);
    logger.info({ participantId: participant.id }, 'OpenAI service-intake interview started');
  }
}

client.on('participantConnected', participant => {
  correlatePendingOutbound(participant);
  void onAudioParticipant(participant).catch(error => logger.error({ err: error }, 'participant handling failed'));
});
client.on('participantUpdated', participant => {
  correlatePendingOutbound(participant);
  void onAudioParticipant(participant).catch(error => logger.error({ err: error }, 'participant update failed'));
});
client.on('participantDisconnected', participantId => {
  const call = inFlight.get(participantId);
  inFlight.delete(participantId);
  interviews.get(participantId)?.();
  interviews.delete(participantId);
  const requestId = savedRequestsByParticipant.get(participantId);
  savedRequestsByParticipant.delete(participantId);
  const { enabled, queueExtension } = getDispatchSettings();
  if (requestId && enabled && queueExtension) {
    void pool.query(
      `UPDATE service_requests SET dispatch_due_at=now() WHERE id=$1 AND status='received' AND dispatch_due_at IS NULL`,
      [requestId]
    ).then(() => void dispatchNext())
      .catch(error => logger.error({ err: error, requestId }, 'could not queue saved service request for dispatch'));
  }
  if (call?.kind === 'test') {
    void pool.query(
      `UPDATE prototype_outbound_calls SET status='ended' WHERE id=$1 AND status IN ('calling','connected')`,
      [call.id]
    ).catch(error => logger.error({ err: error, callId: call.id }, 'failed to persist test call end'))
      .finally(() => releaseOutbound(call));
  } else if (call?.kind === 'dispatch') {
    if (call.transferDeadline) clearTimeout(call.transferDeadline);
    if (call.briefing) call.briefing.stop('technician_call_disconnected');
    else void finishDispatchFailure(call, call.connected ? 'ended' : 'no_answer', 'technician_call_disconnected')
      .catch(error => logger.error({ err: error, callId: call.id }, 'failed to persist disconnected dispatch'));
  }
});

client.on('dtmf', (digits, participantId) => {
  const call = inFlight.get(participantId);
  if (!call) return;
  if (call.kind === 'dispatch') {
    call.briefing?.handleKeypad(digits);
    return;
  }
  if (!digits.includes('1')) return;
  void pool.query(
    `UPDATE prototype_outbound_calls SET status='acknowledged', acknowledged_at=COALESCE(acknowledged_at,now()), dtmf_digit='1' WHERE id=$1 AND status IN ('calling','connected')`,
    [call.id]
  ).then(async () => {
    logger.info({ callId: call.id, participantId }, 'test call acknowledged by DTMF 1');
    try { await client.drop(participantId); } catch (error) { logger.warn({ err: error, participantId }, 'could not end acknowledged test call'); }
    releaseOutbound(call);
  })
    .catch(error => logger.error({ err: error, callId: call.id }, 'failed to persist DTMF acknowledgement'));
});

client.on('connected', () => logger.info('connected to 3CX Call Control WebSocket'));
client.on('disconnected', () => logger.warn('disconnected from 3CX Call Control WebSocket'));
client.on('error', error => logger.error({ err: error }, '3CX Call Control error'));

async function dispatchNext(): Promise<void> {
  const { enabled, queueExtension } = getDispatchSettings();
  if (!enabled || !queueExtension || dispatchWorkerRunning || activeOutbound) return;
  dispatchWorkerRunning = true;
  let connection;
  try {
    connection = await pool.connect();
    await connection.query('BEGIN');
    const selected = await connection.query<RequestSummary & { dispatch_attempts: number }>(
      `SELECT id, ticket_number, caller_name, callback_number, issue_summary, urgency, dispatch_attempts
       FROM service_requests
        WHERE status='received' AND dispatch_due_at <= now() AND dispatch_attempts < $1
       ORDER BY dispatch_due_at, created_at
       FOR UPDATE SKIP LOCKED LIMIT 1`,
      [MAX_DISPATCH_ATTEMPTS]
    );
    const request = selected.rows[0];
    if (!request) {
      await connection.query('COMMIT');
      return;
    }
    const attemptNo = request.dispatch_attempts + 1;
    const attempt = await connection.query<{ id: string }>(
      `INSERT INTO service_request_dispatch_attempts (request_id, attempt_no, destination_dn, status)
       VALUES ($1,$2,$3,'calling') RETURNING id`,
      [request.id, attemptNo, queueExtension]
    );
    await connection.query(
      `UPDATE service_requests SET status='dispatching', dispatch_attempts=$2, dispatch_due_at=NULL WHERE id=$1`,
      [request.id, attemptNo]
    );
    await connection.query('COMMIT');

    const call: OutboundCall = {
      kind: 'dispatch', id: randomUUID(), destinationDn: queueExtension,
      request, attemptId: attempt.rows[0]!.id, attemptNo
    };
    activeOutbound = call;
    outboundPending = call;
    logger.info({ requestId: request.id, ticketNumber: request.ticket_number, attemptNo, destinationDn: call.destinationDn }, 'calling service queue for ticket dispatch');
    try {
      const participantId = await client.makeCall(call.destinationDn);
      if (participantId !== undefined) {
        call.participantId = participantId;
        inFlight.set(participantId, call);
        await pool.query(`UPDATE service_request_dispatch_attempts SET participant_id=$2 WHERE id=$1`, [call.attemptId, participantId]);
      }
      call.deadline = setTimeout(() => {
        if (call.briefing || activeOutbound?.id !== call.id) return;
        const failure = finishDispatchFailure(call, 'no_answer', 'queue_answer_timeout');
        if (call.participantId !== undefined) void client.drop(call.participantId).catch(() => undefined);
        void failure
          .catch(error => logger.error({ err: error, requestId: request.id }, 'could not persist dispatch timeout'));
      }, 90_000);
      call.deadline.unref?.();
    } catch (error) {
      logger.error({ err: error, requestId: request.id, attemptNo }, '3CX service queue call failed');
      await finishDispatchFailure(call, 'failed', 'make_call_failed');
    }
  } catch (error) {
    if (connection) {
      try { await connection.query('ROLLBACK'); } catch { /* transaction may already be closed */ }
    }
    logger.error({ err: error }, 'service dispatch worker failed');
  } finally {
    connection?.release();
    dispatchWorkerRunning = false;
  }
}

app.get('/health', async (_request, reply) => {
  const dbReady = await ready();
  const status = dbReady ? 200 : 503;
  return reply.code(status).send({ ok: dbReady, db: dbReady ? 'up' : 'down' });
});

app.get('/', async (_request, reply) => reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(dashboardHtml.replace('__APP_BASE_PATH__', config.APP_BASE_PATH)));

app.post<{ Body: { username?: string; password?: string } }>('/auth/login', dashboardLogin);
app.post('/auth/logout', dashboardLogout);
app.get('/auth/me', { preHandler: requireDashboardUser }, async request => currentDashboardUser(request));

app.post('/test-call', { preHandler: requireDashboardAdmin }, async (_request, reply) => {
  if (!config.testOutboundEnabled) return reply.code(403).send({ error: 'TEST_OUTBOUND_ENABLED is false' });
  const destinationDn = getDispatchSettings().queueExtension;
  if (!destinationDn) return reply.code(503).send({ error: 'SERVICE_QUEUE_EXTENSION is not configured' });
  if (activeOutbound || inFlight.size > 0) return reply.code(409).send({ error: 'one outbound call is already active' });
  const id = randomUUID();
  await pool.query(`INSERT INTO prototype_outbound_calls (id, destination_dn, status) VALUES ($1,$2,'calling')`, [id, destinationDn]);
  const call: OutboundCall = { kind: 'test', id, destinationDn };
  activeOutbound = call;
  outboundPending = call;
  try {
    const participantId = await client.makeCall(destinationDn);
    if (participantId !== undefined) {
      call.participantId = participantId;
      inFlight.set(participantId, call);
    }
    call.deadline = setTimeout(() => {
      if (activeOutbound?.id !== id) return;
      if (call.participantId !== undefined) void client.drop(call.participantId).catch(() => undefined);
      outboundPending = undefined;
      void pool.query(`UPDATE prototype_outbound_calls SET status='failed', result_detail='test call timed out' WHERE id=$1 AND status IN ('calling','connected')`, [id])
        .finally(() => releaseOutbound(call))
        .catch(error => logger.error({ err: error, callId: id }, 'failed to persist test call timeout'));
    }, 120_000);
    call.deadline.unref?.();
    return reply.code(202).send({ id, participantId: participantId ?? null, status: 'calling' });
  } catch (error) {
    outboundPending = undefined;
    await pool.query(`UPDATE prototype_outbound_calls SET status='failed', result_detail='makeCall failed' WHERE id=$1`, [id]);
    releaseOutbound(call);
    logger.error({ err: error, callId: id }, '3CX makeCall failed');
    return reply.code(502).send({ id, error: '3CX makeCall failed; check application logs' });
  }
});

app.get('/test-calls', { preHandler: requireDashboardUser }, async () => {
  const result = await pool.query(
    `SELECT id, destination_dn, started_at, participant_id, status, connected_at, acknowledged_at FROM prototype_outbound_calls ORDER BY started_at DESC LIMIT 50`
  );
  return result.rows;
});

app.get('/service-requests', { preHandler: requireDashboardUser }, async () => {
  const result = await pool.query(
    `SELECT request.id, request.ticket_number, request.caller_name, request.callback_number,
            request.issue_summary, request.urgency, request.status,
            request.dispatch_attempts, request.created_at,
            attempt.attempt_no AS latest_attempt_no,
            attempt.status AS latest_attempt_status,
            attempt.dtmf_digit AS latest_dtmf_digit,
            attempt.connected_at AS latest_connected_at,
            attempt.finished_at AS latest_finished_at,
            attempt.transfer_attempts, attempt.transfer_result,
            attempt.result_detail AS latest_result_detail,
            $1::int AS dispatch_attempt_limit,
            COALESCE((
              SELECT json_agg(json_build_object(
                'number', history.attempt_no, 'status', history.status,
                'queue', history.destination_dn, 'connected_at', history.connected_at,
                'finished_at', history.finished_at, 'detail', history.result_detail
              ) ORDER BY history.attempt_no)
              FROM service_request_dispatch_attempts AS history WHERE history.request_id=request.id
            ), '[]'::json) AS dispatch_history,
            COALESCE((
              SELECT json_agg(json_build_object(
                'id', call_record.id, 'call_type', call_record.call_type,
                'call_direction', call_record.call_direction, 'external_number', call_record.external_number,
                'contact_name', call_record.contact_name, 'queue_extension', call_record.queue_extension,
                'agent_extension', call_record.agent_extension, 'agent_name', call_record.agent_name,
                'duration_seconds', call_record.duration_seconds, 'started_at', call_record.started_at,
                'ended_at', call_record.ended_at, 'recording_url', call_record.recording_url
              ) ORDER BY call_record.started_at NULLS LAST)
              FROM service_request_calls AS call_record WHERE call_record.request_id=request.id
            ), '[]'::json) AS related_calls
     FROM service_requests AS request
     LEFT JOIN LATERAL (
       SELECT attempt_no, status, dtmf_digit, connected_at, finished_at,
              transfer_attempts, transfer_result, result_detail
       FROM service_request_dispatch_attempts
       WHERE request_id = request.id
       ORDER BY attempt_no DESC
       LIMIT 1
     ) AS attempt ON true
     ORDER BY request.created_at DESC LIMIT 200`,
    [MAX_DISPATCH_ATTEMPTS]
  );
  return result.rows;
});

function reportCallDate(value: unknown, millis: unknown): Date | null {
  if (typeof millis === 'string' && /^\d{10,16}$/.test(millis)) {
    const parsed = new Date(Number(millis));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof millis === 'number' && Number.isFinite(millis)) {
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'string' && value.length <= 80) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function reportCallDuration(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,3}):(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

function phoneMatchKeys(value: string): string[] {
  const digits = value.replace(/\D/g, '');
  const canonical = digits.startsWith('00') ? digits.slice(2) : digits;
  return [...new Set([canonical, digits, `00${canonical}`].filter(Boolean))];
}

app.post('/integrations/3cx/report-call', async (request, reply) => {
  logger.info({ remoteAddress: request.ip }, '3CX ReportCall webhook request received');
  const expected = config.THREEX_REPORT_CALL_TOKEN;
  if (!expected) {
    logger.error('3CX ReportCall webhook is disabled because its token is not configured');
    return reply.code(503).send({ error: '3CX ReportCall integration is not configured.' });
  }
  const presented = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? '';
  const expectedBytes = Buffer.from(expected);
  const presentedBytes = Buffer.from(presented);
  if (presentedBytes.length !== expectedBytes.length || !timingSafeEqual(presentedBytes, expectedBytes)) {
    logger.warn({ remoteAddress: request.ip }, '3CX ReportCall webhook rejected an invalid token');
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {};
  const externalNumber = typeof body.number === 'string' ? body.number.trim().slice(0, 80) : '';
  const callType = typeof body.callType === 'string' ? body.callType.trim().slice(0, 40) : 'Unknown';
  const callDirection = typeof body.callDirection === 'string' ? body.callDirection.trim().slice(0, 20) : 'Unknown';
  const contactName = typeof body.name === 'string' ? body.name.trim().slice(0, 160) : null;
  const queueExtension = typeof body.queueExtension === 'string' ? body.queueExtension.trim().slice(0, 32) : null;
  const agentExtension = typeof body.agent === 'string' ? body.agent.trim().slice(0, 32) : null;
  const agentName = [body.agentFirstName, body.agentLastName].filter(value => typeof value === 'string' && value.trim()).join(' ').slice(0, 160) || null;
  const durationSeconds = reportCallDuration(body.duration);
  const startedAt = reportCallDate(body.callStartTimeUTC, body.callStartTimeUTCMillis);
  const endedAt = reportCallDate(body.callEndTimeUTC, body.callEndTimeUTCMillis);
  let recordingUrl: string | null = null;
  if (typeof body.recordingUrl === 'string' && body.recordingUrl.length <= 4096) {
    try {
      const parsed = new URL(body.recordingUrl);
      if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password) recordingUrl = parsed.toString();
    } catch { /* Ignore invalid recording links but keep the call record. */ }
  }

  const fingerprint = createHash('sha256').update([
    externalNumber, callDirection, callType, startedAt?.toISOString() ?? '', endedAt?.toISOString() ?? '',
    queueExtension ?? '', agentExtension ?? ''
  ].join('|')).digest('hex');
  const phoneKeys = phoneMatchKeys(externalNumber);
  let requestId: string | null = null;
  let matchStatus: 'linked' | 'unmatched' | 'ambiguous' = 'unmatched';
  let matchMethod = 'no_ticket_match';
  if (phoneKeys.length && startedAt) {
    const exact = await pool.query<{ id: string }>(
      `SELECT id FROM service_requests
       WHERE (
         regexp_replace(COALESCE(caller_number,''), '[^0-9]', '', 'g') = ANY($1::text[])
         OR regexp_replace(COALESCE(callback_number,''), '[^0-9]', '', 'g') = ANY($1::text[])
       ) AND created_at BETWEEN $2::timestamptz - interval '2 minutes'
                            AND COALESCE($3::timestamptz, $2::timestamptz + interval '2 minutes') + interval '2 minutes'
       ORDER BY abs(extract(epoch FROM (created_at - COALESCE($3::timestamptz,$2::timestamptz))))
       LIMIT 2`,
      [phoneKeys, startedAt, endedAt]
    );
    if (exact.rowCount === 1) {
      requestId = exact.rows[0]!.id;
      matchStatus = 'linked';
      matchMethod = 'caller_and_time';
    } else if ((exact.rowCount ?? 0) > 1) {
      matchStatus = 'ambiguous';
      matchMethod = 'multiple_tickets_near_call';
    }
  }
  if (!requestId && matchStatus !== 'ambiguous' && phoneKeys.length) {
    const openTickets = await pool.query<{ id: string }>(
      `SELECT id FROM service_requests
       WHERE status IN ('received','dispatching','accepted','unassigned') AND (
         regexp_replace(COALESCE(caller_number,''), '[^0-9]', '', 'g') = ANY($1::text[])
         OR regexp_replace(COALESCE(callback_number,''), '[^0-9]', '', 'g') = ANY($1::text[])
       ) ORDER BY created_at DESC LIMIT 2`, [phoneKeys]
    );
    if (openTickets.rowCount === 1) {
      requestId = openTickets.rows[0]!.id;
      matchStatus = 'linked';
      matchMethod = 'single_open_ticket_for_number';
    } else if ((openTickets.rowCount ?? 0) > 1) {
      matchStatus = 'ambiguous';
      matchMethod = 'multiple_open_tickets_for_number';
    }
  }

  const inserted = await pool.query<{ id: string; request_id: string | null; match_status: string }>(
    `INSERT INTO service_request_calls (
       request_id, call_fingerprint, call_type, call_direction, external_number, contact_name,
       queue_extension, agent_extension, agent_name, duration_seconds, started_at, ended_at,
       recording_url, match_status, match_method
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (call_fingerprint) DO UPDATE SET
       recording_url=COALESCE(EXCLUDED.recording_url,service_request_calls.recording_url),
       request_id=COALESCE(service_request_calls.request_id,EXCLUDED.request_id),
       match_status=CASE WHEN service_request_calls.request_id IS NOT NULL THEN 'linked' ELSE EXCLUDED.match_status END,
       match_method=CASE WHEN service_request_calls.request_id IS NOT NULL THEN service_request_calls.match_method ELSE EXCLUDED.match_method END
     RETURNING id, request_id, match_status`,
    [requestId, fingerprint, callType, callDirection, externalNumber, contactName, queueExtension, agentExtension, agentName, durationSeconds, startedAt, endedAt, recordingUrl, matchStatus, matchMethod]
  );
  logger.info({ callRecordId: inserted.rows[0]!.id, linked: Boolean(inserted.rows[0]!.request_id), matchStatus: inserted.rows[0]!.match_status }, '3CX ReportCall recorded');
  return { ok: true, id: inserted.rows[0]!.id, linked: Boolean(inserted.rows[0]!.request_id), matchStatus: inserted.rows[0]!.match_status };
});

app.get('/admin/unlinked-calls', { preHandler: requireDashboardAdmin }, async () => {
  const result = await pool.query(
    `SELECT id, call_type, call_direction, external_number, contact_name, queue_extension,
            agent_extension, agent_name, duration_seconds, started_at, ended_at,
            recording_url, match_status, match_method
     FROM service_request_calls WHERE request_id IS NULL ORDER BY started_at DESC NULLS LAST LIMIT 200`
  );
  return result.rows;
});

app.patch<{ Params: { callId: string }; Body: { ticket_number?: unknown } }>(
  '/admin/calls/:callId', { preHandler: requireDashboardAdmin }, async (request, reply) => {
    if (!verifySameOrigin(request, reply)) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.callId)) return reply.code(400).send({ error: 'Neplatné ID hovoru.' });
    const ticketNumber = request.body?.ticket_number;
    if (typeof ticketNumber !== 'number' || !Number.isSafeInteger(ticketNumber) || ticketNumber < 1) return reply.code(400).send({ error: 'Vyberte platné číslo tiketu.' });
    const linked = await pool.query(
      `UPDATE service_request_calls AS call_record SET request_id=request.id, match_status='linked', match_method='manual'
       FROM service_requests AS request
       WHERE call_record.id=$1 AND request.ticket_number=$2 RETURNING call_record.id`,
      [request.params.callId, ticketNumber]
    );
    if (!linked.rowCount) return reply.code(404).send({ error: 'Hovor nebo tiket nebyl nalezen.' });
    logger.info({ callId: request.params.callId, ticketNumber, by: currentDashboardUser(request).username }, 'admin linked 3CX call to service request');
    return { ok: true };
  }
);

app.patch<{ Params: { ticketNumber: string }; Body: { status?: unknown; urgency?: unknown } }>(
  '/admin/service-requests/:ticketNumber', { preHandler: requireDashboardAdmin }, async (request, reply) => {
    if (!verifySameOrigin(request, reply)) return;
    const ticketNumber = Number(request.params.ticketNumber);
    const body = request.body ?? {};
    const statuses = new Set(['received', 'accepted', 'unassigned', 'resolved']);
    const urgencies = new Set(['low', 'normal', 'high', 'critical']);
    const status = body.status;
    const urgency = body.urgency;
    if (!Number.isSafeInteger(ticketNumber) || ticketNumber < 1) return reply.code(400).send({ error: 'Neplatné číslo tiketu.' });
    if (status !== undefined && (typeof status !== 'string' || !statuses.has(status))) return reply.code(400).send({ error: 'Neplatný stav požadavku.' });
    if (urgency !== undefined && (typeof urgency !== 'string' || !urgencies.has(urgency))) return reply.code(400).send({ error: 'Neplatná naléhavost.' });
    if (status === undefined && urgency === undefined) return reply.code(400).send({ error: 'Není co změnit.' });

    const updated = await pool.query(
      `UPDATE service_requests
       SET status=COALESCE($2,status), urgency=COALESCE($3,urgency),
           dispatch_due_at=CASE WHEN $2::text IS NULL THEN dispatch_due_at ELSE NULL END
       WHERE ticket_number=$1 AND status <> 'dispatching'
       RETURNING ticket_number, status, urgency`,
      [ticketNumber, status ?? null, urgency ?? null]
    );
    if (!updated.rowCount) {
      const existing = await pool.query<{ status: string }>('SELECT status FROM service_requests WHERE ticket_number=$1', [ticketNumber]);
      if (!existing.rowCount) return reply.code(404).send({ error: 'Požadavek nebyl nalezen.' });
      return reply.code(409).send({ error: 'Požadavek právě předáváme technikovi a nyní jej nelze upravit.' });
    }
    logger.info({ ticketNumber, status, urgency, username: currentDashboardUser(request).username }, 'admin updated service request');
    return updated.rows[0];
  }
);

app.delete<{ Params: { ticketNumber: string } }>(
  '/admin/service-requests/:ticketNumber', { preHandler: requireDashboardAdmin }, async (request, reply) => {
    if (!verifySameOrigin(request, reply)) return;
    const ticketNumber = Number(request.params.ticketNumber);
    if (!Number.isSafeInteger(ticketNumber) || ticketNumber < 1) return reply.code(400).send({ error: 'Neplatné číslo tiketu.' });
    const deleted = await pool.query(
      `DELETE FROM service_requests WHERE ticket_number=$1 AND status <> 'dispatching' RETURNING ticket_number`,
      [ticketNumber]
    );
    if (!deleted.rowCount) {
      const existing = await pool.query<{ status: string }>('SELECT status FROM service_requests WHERE ticket_number=$1', [ticketNumber]);
      if (!existing.rowCount) return reply.code(404).send({ error: 'Požadavek nebyl nalezen.' });
      return reply.code(409).send({ error: 'Požadavek právě předáváme technikovi a nyní jej nelze smazat.' });
    }
    logger.info({ ticketNumber, username: currentDashboardUser(request).username }, 'admin deleted service request');
    return { ok: true };
  }
);

app.delete<{ Body: { confirm?: unknown } }>('/admin/service-requests', { preHandler: requireDashboardAdmin }, async (request, reply) => {
  if (!verifySameOrigin(request, reply)) return;
  if (request.body?.confirm !== 'SMAZAT') return reply.code(400).send({ error: 'Potvrďte mazání textem SMAZAT.' });
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query('LOCK TABLE service_requests IN EXCLUSIVE MODE');
    const active = await connection.query<{ id: string }>(`SELECT id FROM service_requests WHERE status='dispatching' LIMIT 1`);
    if (active.rowCount) {
      await connection.query('ROLLBACK');
      return reply.code(409).send({ error: 'Běží předání požadavku technikovi. Hromadné mazání zkuste až po jeho dokončení.' });
    }
    const deleted = await connection.query('DELETE FROM service_requests');
    await connection.query('COMMIT');
    logger.warn({ count: deleted.rowCount, username: currentDashboardUser(request).username }, 'admin cleared all service requests');
    return { deleted: deleted.rowCount ?? 0 };
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
});

app.get('/admin/dispatch-settings', { preHandler: requireDashboardAdmin }, async () => getDispatchSettings());
app.put('/admin/dispatch-settings', { preHandler: requireDashboardAdmin }, async (request, reply) => {
  if (!verifySameOrigin(request, reply)) return;
  const settings = dispatchSettingsSchema.safeParse(request.body);
  if (!settings.success) return reply.code(400).send({ error: 'Zkontrolujte číslo fronty, text hlášky a tři různé hlasové povely.' });
  await saveDispatchSettings(settings.data);
  return getDispatchSettings();
});

app.get('/admin/voice-provider', { preHandler: requireDashboardAdmin }, async () => getVoiceProviderStatus());
app.put('/admin/voice-provider', { preHandler: requireDashboardAdmin }, async (request, reply) => {
  if (!verifySameOrigin(request, reply)) return;
  const parsed = voiceProviderSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Zkontrolujte poskytovatele, hlas a formát klíčů.' });
  if (!await saveVoiceProvider(parsed.data)) return reply.code(400).send({ error: 'Pro aktivaci Groku zadejte klíč xAI.' });
  return getVoiceProviderStatus();
});

app.get('/admin/agent-settings', { preHandler: requireDashboardAdmin }, async () => ({
  ...getAgentProfile(), voices: agentVoices
}));

app.put('/admin/agent-settings', { preHandler: requireDashboardAdmin }, async (request, reply) => {
  if (!verifySameOrigin(request, reply)) return;
  const settings = agentSettingsSchema.safeParse(request.body);
  if (!settings.success) return reply.code(400).send({ error: 'Zkontrolujte pozdrav, prompt, hlas a tempo. Proměnné musí být platné šablony Mustache.' });
  await saveAgentSettings(settings.data);
  return { ok: true };
});

app.get('/admin/ai-diagnostics', { preHandler: requireDashboardAdmin }, async () => ({
  model: getVoiceProvider().model,
  events: recentAiEvents()
}));

app.get('/admin/users', { preHandler: requireDashboardAdmin }, async () => {
  const result = await pool.query(
    `SELECT id, username, role, is_active, created_at FROM dashboard_users ORDER BY username`
  );
  return result.rows;
});

app.post<{ Body: { username?: unknown; password?: unknown; role?: unknown } }>(
  '/admin/users', { preHandler: requireDashboardAdmin }, async (request, reply) => {
    if (!verifySameOrigin(request, reply)) return;
    const body = request.body ?? {};
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const role = body.role ?? 'viewer';
    if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(username)) return reply.code(400).send({ error: 'Jméno musí mít 3–50 znaků (a–z, 0–9, tečka, podtržítko nebo pomlčka).' });
    if (password.length < 12 || password.length > 256) return reply.code(400).send({ error: 'Heslo musí mít 12–256 znaků.' });
    if (role !== 'viewer' && role !== 'admin') return reply.code(400).send({ error: 'Neplatná role.' });
    const passwordHash = await hashPassword(password);
    try {
      const inserted = await pool.query(
        `INSERT INTO dashboard_users (username,password_hash,role) VALUES ($1,$2,$3)
         RETURNING id, username, role, is_active, created_at`,
        [username, passwordHash, role as DashboardRole]
      );
      logger.info({ createdUsername: username, role, by: currentDashboardUser(request).username }, 'admin created dashboard user');
      return reply.code(201).send(inserted.rows[0]);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return reply.code(409).send({ error: 'Uživatel s tímto jménem už existuje.' });
      throw error;
    }
  }
);

app.patch<{ Params: { userId: string }; Body: { role?: unknown; is_active?: unknown; password?: unknown } }>(
  '/admin/users/:userId', { preHandler: requireDashboardAdmin }, async (request, reply) => {
    if (!verifySameOrigin(request, reply)) return;
    const userId = request.params.userId;
    const body = request.body ?? {};
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return reply.code(400).send({ error: 'Neplatné ID uživatele.' });
    if (body.role !== undefined && body.role !== 'admin' && body.role !== 'viewer') return reply.code(400).send({ error: 'Neplatná role.' });
    if (body.is_active !== undefined && typeof body.is_active !== 'boolean') return reply.code(400).send({ error: 'Neplatný příznak aktivního účtu.' });
    if (body.password !== undefined && (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 256)) return reply.code(400).send({ error: 'Heslo musí mít 12–256 znaků.' });
    if (body.role === undefined && body.is_active === undefined && body.password === undefined) return reply.code(400).send({ error: 'Není co změnit.' });

    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('LOCK TABLE dashboard_users IN EXCLUSIVE MODE');
      const found = await connection.query<{ role: DashboardRole; is_active: boolean }>(
        'SELECT role, is_active FROM dashboard_users WHERE id=$1 FOR UPDATE', [userId]
      );
      const existing = found.rows[0];
      if (!existing) {
        await connection.query('ROLLBACK');
        return reply.code(404).send({ error: 'Uživatel nebyl nalezen.' });
      }
      const nextRole = (body.role ?? existing.role) as DashboardRole;
      const nextActive = (body.is_active ?? existing.is_active) as boolean;
      if (existing.role === 'admin' && existing.is_active && (nextRole !== 'admin' || !nextActive)) {
        const count = await connection.query<{ count: string }>(`SELECT count(*) FROM dashboard_users WHERE role='admin' AND is_active=true`);
        if (Number(count.rows[0]?.count ?? 0) <= 1) {
          await connection.query('ROLLBACK');
          return reply.code(409).send({ error: 'Nelze odebrat nebo vypnout posledního aktivního správce.' });
        }
      }
      const passwordHash = typeof body.password === 'string' ? await hashPassword(body.password) : null;
      await connection.query(
        `UPDATE dashboard_users SET role=$2, is_active=$3, password_hash=COALESCE($4,password_hash), updated_at=now() WHERE id=$1`,
        [userId, nextRole, nextActive, passwordHash]
      );
      await connection.query('DELETE FROM dashboard_sessions WHERE user_id=$1', [userId]);
      await connection.query('COMMIT');
      logger.info({ userId, role: nextRole, isActive: nextActive, by: currentDashboardUser(request).username }, 'admin updated dashboard user');
      return { ok: true };
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }
);

app.delete<{ Params: { userId: string } }>(
  '/admin/users/:userId', { preHandler: requireDashboardAdmin }, async (request, reply) => {
    if (!verifySameOrigin(request, reply)) return;
    const userId = request.params.userId;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return reply.code(400).send({ error: 'Neplatné ID uživatele.' });
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('LOCK TABLE dashboard_users IN EXCLUSIVE MODE');
      const found = await connection.query<{ username: string; role: DashboardRole; is_active: boolean }>(
        'SELECT username, role, is_active FROM dashboard_users WHERE id=$1 FOR UPDATE', [userId]
      );
      const target = found.rows[0];
      if (!target) {
        await connection.query('ROLLBACK');
        return reply.code(404).send({ error: 'Uživatel nebyl nalezen.' });
      }
      if (target.role === 'admin' && target.is_active) {
        const count = await connection.query<{ count: string }>(`SELECT count(*) FROM dashboard_users WHERE role='admin' AND is_active=true`);
        if (Number(count.rows[0]?.count ?? 0) <= 1) {
          await connection.query('ROLLBACK');
          return reply.code(409).send({ error: 'Nelze smazat posledního aktivního správce.' });
        }
      }
      await connection.query('DELETE FROM dashboard_users WHERE id=$1', [userId]);
      await connection.query('COMMIT');
      logger.info({ deletedUsername: target.username, by: currentDashboardUser(request).username }, 'admin deleted dashboard user');
      return { ok: true };
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }
);

async function recoverInterruptedDispatches(): Promise<void> {
  const result = await pool.query(
    `UPDATE service_request_dispatch_attempts
     SET status='failed', result_detail='application_restarted', finished_at=now()
     WHERE status IN ('calling','connected')
     RETURNING request_id, attempt_no`
  );
  for (const attempt of result.rows as Array<{ request_id: string; attempt_no: number }>) {
    await pool.query(
      `UPDATE service_requests SET status=$2, dispatch_due_at=$3
       WHERE id=$1 AND status='dispatching'`,
      [attempt.request_id, attempt.attempt_no >= MAX_DISPATCH_ATTEMPTS ? 'unassigned' : 'received', attempt.attempt_no >= MAX_DISPATCH_ATTEMPTS ? null : new Date(Date.now() + DISPATCH_RETRY_DELAY_SECONDS * 1_000)]
    );
  }
}

async function main(): Promise<void> {
  await migrate();
  await loadAgentSettings();
  await loadVoiceProvider();
  await loadDispatchSettings();
  await ensureBootstrapUsers();
  await recoverInterruptedDispatches();
  await client.connect();
  await app.listen({ host: config.HOST, port: config.PORT });
  setInterval(() => void dispatchNext(), 5_000).unref();
  logger.info({ port: config.PORT, dispatchEnabled: getDispatchSettings().enabled }, 'service intake prototype ready');
}

async function stop(): Promise<void> {
  await app.close();
  if (activeOutbound?.kind === 'dispatch') activeOutbound.briefing?.stop('application_stopping');
  await client.disconnect();
  await pool.end();
}

process.once('SIGINT', () => void stop().finally(() => process.exit(0)));
process.once('SIGTERM', () => void stop().finally(() => process.exit(0)));
main().catch(error => { logger.fatal({ err: error }, 'startup failed'); process.exit(1); });
