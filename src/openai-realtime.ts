import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import type { Participant } from '@3cx/call-control-sdk';
import { load as loadYaml } from 'js-yaml';
import Mustache from 'mustache';
import { z } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';
import { downsample24kTo8k, upsample8kTo24k } from './audio-utils.js';
import { isDialablePhoneNumber, normalizePhoneNumber } from './phone-number.js';
import pino from 'pino';
import { recordAiEvent } from './ai-diagnostics.js';

const logger = pino({ level: config.LOG_LEVEL, redact: ['*.apiKey'] });
const requestSchema = z.object({
  callerName: z.string().trim().min(1).max(160),
  callbackNumber: z.string().trim().min(3).max(40)
    .transform(normalizePhoneNumber)
    .refine(isDialablePhoneNumber, 'Telefonní číslo musí obsahovat alespoň tři číslice.'),
  issueSummary: z.string().trim().min(8).max(4000),
  urgency: z.enum(['low', 'normal', 'high', 'critical']),
  confirmed: z.literal(true)
});

const profileSchema = z.object({
  role: z.string().min(1),
  prompt: z.string().min(1),
  greeting: z.string().min(1),
  voice: z.string().optional(),
  speed: z.number().min(0.25).max(1.5).optional()
});

const profile = profileSchema.parse(loadYaml(readFileSync(new URL(`../agents/${config.AGENT_PROFILE}.yaml`, import.meta.url), 'utf8')));

function speakTicketDigits(ticketNumber: number): string {
  const digitWords = ['nula', 'jedna', 'dva', 'tři', 'čtyři', 'pět', 'šest', 'sedm', 'osm', 'devět'];
  return String(ticketNumber).split('').map(digit => digitWords[Number(digit)]).join(', ');
}

const tool = {
  type: 'function',
  name: 'save_service_request',
  description: 'Uloží servisní požadavek až poté, co volající výslovně potvrdí přečtené shrnutí. Callback číslo musí volající uvést nebo výslovně potvrdit; caller ID z ústředny není automaticky callback číslo.',
  parameters: {
    type: 'object',
    properties: {
      callerName: { type: 'string', description: 'Potvrzené jméno volajícího.' },
      callbackNumber: { type: 'string', description: 'Číslo, na kterém volající výslovně potvrdil, že ho může technik zastihnout. Nepřebírej automaticky caller ID.' },
      issueSummary: { type: 'string', description: 'Konkrétní popis problému vlastními slovy volajícího.' },
      urgency: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
      confirmed: { type: 'boolean', description: 'true pouze po výslovném potvrzení shrnutí volajícím.' }
    },
    required: ['callerName', 'callbackNumber', 'issueSummary', 'urgency', 'confirmed'],
    additionalProperties: false
  }
};

type RealtimeEvent = Record<string, any>;

export function startOpenAiInterview(participant: Participant, onSaved?: (requestId: string) => void): () => void {
  const callerName = (participant.info.party_caller_name ?? '')
    .replace(/[^\p{L}\p{M}\d .,'’()-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const callerId = (participant.info.party_caller_id ?? '')
    .replace(/[^\d+().\-\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const callerLine = (participant.info.party_dn ?? '').replace(/[^\d]/g, '').slice(0, 16);
  const callerIdDigits = callerId.replace(/\D/g, '');
  const callbackCandidate = callerIdDigits.length >= 3 ? callerId : callerLine;
  const callbackCandidateLabel = callerIdDigits.length >= 3 ? 'číslo' : callbackCandidate ? 'linka' : '';
  const templateContext = {
    role: profile.role,
    company_name: config.COMPANY_NAME,
    agent_name: config.AGENT_NAME,
    caller_name: callerName,
    caller_line: callerLine,
    callback_candidate: callbackCandidate,
    callback_candidate_label: callbackCandidateLabel
  };
  const sessionInstructions = `${Mustache.render(profile.prompt, templateContext)}\n\nÚdaje 3CX: jméno „${callerName || 'nepředáno'}“, caller ID „${callerId || 'nepředáno'}“, příchozí linka „${callerLine || 'nepředána'}“. Kandidát callbacku z ústředny je ${callbackCandidate ? `${callbackCandidateLabel} ${callbackCandidate}` : 'nedostupný'}; nabídni ho volajícímu k potvrzení. Použij ho jako callback jen pokud ho volající výslovně potvrdí. Pokud ho odmítne, ponech původní caller ID jako zdrojový údaj a vyžádej nové callback číslo.`;
  const greetingBase = Mustache.render(profile.greeting, templateContext);
  const identityDetails = [
    callerName ? `jméno ${callerName}` : '',
    callerIdDigits.length >= 3 && callerIdDigits !== callerLine ? `číslo ${callerId}` : '',
    callerLine ? `linku ${callerLine}` : ''
  ].filter(Boolean).join(' a ');
  const identityQuestion = callerName
    ? `Ústředna mi ukazuje ${identityDetails}. Volá skutečně ${callerName}?`
    : identityDetails
      ? `Ústředna mi ukazuje ${identityDetails}. Kdo volá?`
      : 'S čím vám mohu pomoci?';
  const greeting = `${greetingBase} ${identityQuestion}`;
  const trace = (stage: string, detail?: string | number) => recordAiEvent(participant.id, stage, detail);
  trace('Připojování k OpenAI');
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.OPENAI_MODEL)}`, {
    handshakeTimeout: 10_000,
    headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}` }
  });
  const writer = participant.getAudioWriter();
  let stopped = false;
  let savedTicketId: string | undefined;
  let savedTicketNumber: number | undefined;
  let responseActive = false;
  let firstAudioChunkLogged = false;
  let responseAudioBytes = 0;
  let hangupAfterResponse = false;
  let awaitingFinalResponse = false;
  let finalResponseId: string | undefined;
  let hangupTimer: ReturnType<typeof setTimeout> | undefined;

  const send = (event: object) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (hangupTimer) clearTimeout(hangupTimer);
    writer.cancel();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  };

  ws.on('open', async () => {
    trace('WebSocket OpenAI připojen');
    logger.info({ participantId: participant.id }, 'OpenAI Realtime session connected');
    send({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: sessionInstructions,
        tools: [tool],
        tool_choice: 'auto',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            noise_reduction: { type: 'near_field' },
            transcription: { model: 'gpt-4o-mini-transcribe', language: 'cs' },
            turn_detection: { type: 'server_vad', threshold: 0.6, silence_duration_ms: 650 }
          },
          output: {
            format: { type: 'audio/pcm', rate: 24000 },
            voice: profile.voice ?? config.OPENAI_VOICE,
            speed: profile.speed ?? 1
          }
        }
      }
    });
    let stream: Awaited<ReturnType<Participant['getAudioStream']>>;
    try {
      stream = await participant.getAudioStream();
      trace('Zvukový vstup 3CX otevřen');
    } catch (error) {
      trace('Chyba při otevření zvuku z 3CX');
      logger.error({ err: error, participantId: participant.id }, '3CX audio input could not be opened');
      send({ type: 'response.create', response: { tool_choice: 'none', instructions: 'Omluv se česky, řekni, že se nepodařilo spustit příjem zvuku a že má volající zavolat znovu.' } });
      return;
    }
    stream.once('data', () => trace('První zvuk z 3CX'));
    stream.on('data', (chunk: Buffer) => {
      if (!stopped) send({ type: 'input_audio_buffer.append', audio: upsample8kTo24k(chunk).toString('base64') });
    });
    stream.on('error', error => {
      trace('Chyba zvukového vstupu 3CX');
      logger.warn({ err: error, participantId: participant.id }, '3CX audio stream ended');
    });
    stream.on('close', () => { trace('Zvukový vstup 3CX uzavřen'); stop(); });
    send({
      type: 'response.create',
      response: {
        tool_choice: 'none',
        instructions: `Řekni přesně tento pozdrav a zatím nic neukládej: ${JSON.stringify(greeting)}`,
        input: []
      }
    });
  });

  ws.on('message', (data: WebSocket.RawData) => {
    let event: RealtimeEvent;
    try { event = JSON.parse(data.toString()) as RealtimeEvent; }
    catch { logger.warn('Ignored invalid event from OpenAI Realtime'); return; }
    if (event.type === 'session.created' || event.type === 'session.updated') {
      trace('Relace OpenAI', event.type);
      logger.info({
        participantId: participant.id,
        eventType: event.type,
        voice: event.session?.audio?.output?.voice,
        speed: event.session?.audio?.output?.speed,
        noiseReduction: event.session?.audio?.input?.noise_reduction,
        vadThreshold: event.session?.audio?.input?.turn_detection?.threshold
      }, 'OpenAI Realtime session ready');
    } else if (event.type === 'response.created') {
      responseActive = true;
      firstAudioChunkLogged = false;
      responseAudioBytes = 0;
      if (awaitingFinalResponse) {
        finalResponseId = event.response?.id;
        awaitingFinalResponse = false;
      }
      logger.info({ participantId: participant.id, responseId: event.response?.id }, 'OpenAI response started');
    } else if (event.type === 'response.done') {
      responseActive = false;
      logger.info({ participantId: participant.id, responseId: event.response?.id, status: event.response?.status }, 'OpenAI response finished');
      if (hangupAfterResponse && finalResponseId && event.response?.id === finalResponseId) {
        // Audio is sent to 3CX as 8 kHz, 16-bit mono PCM. Let the queued final
        // sentence finish playing before dropping the call.
        const playbackMs = event.response?.status === 'completed'
          ? Math.ceil(responseAudioBytes / (8_000 * 2) * 1_000) + 600
          : 600;
        logger.info({ participantId: participant.id, playbackMs, responseStatus: event.response?.status }, 'Final confirmation finished; scheduling call hangup');
        hangupTimer = setTimeout(() => {
          void participant.drop().then(() => {
            logger.info({ participantId: participant.id, ticketNumber: savedTicketNumber }, 'Service-intake call ended after confirmation');
            stop();
          }).catch(error => {
            logger.error({ err: error, participantId: participant.id }, 'Could not end service-intake call');
          });
        }, playbackMs);
        hangupTimer.unref?.();
      }
    } else if (event.type === 'response.output_audio.delta' || event.type === 'response.audio.delta') {
      if (!firstAudioChunkLogged) {
        firstAudioChunkLogged = true;
        trace('Přijat první zvuk odpovědi z OpenAI');
        logger.info({ participantId: participant.id, responseId: event.response_id }, 'OpenAI response audio received');
      }
      const audio = downsample24kTo8k(Buffer.from(event.delta, 'base64'));
      responseAudioBytes += audio.length;
      writer.write(audio);
    } else if (event.type === 'input_audio_buffer.speech_started') {
      writer.clear();
      if (responseActive) {
        // With server VAD and interrupt_response=true, Realtime cancels an active
        // response itself. We only stop local playback here; a second cancel races
        // the server and returns response_cancel_not_active.
        logger.info({ participantId: participant.id }, 'Caller interrupted active assistant response; server VAD is cancelling it');
      } else {
        logger.debug({ participantId: participant.id }, 'Caller speech started');
      }
    } else if (event.type === 'response.function_call_arguments.done' && event.name === 'save_service_request') {
      void (async () => {
        try {
          if (savedTicketId && savedTicketNumber !== undefined) {
            onSaved?.(savedTicketId);
            send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: event.call_id, output: JSON.stringify({ ok: true, request_number: savedTicketNumber }) } });
            hangupAfterResponse = true;
            awaitingFinalResponse = true;
            send({ type: 'response.create', response: { tool_choice: 'none', instructions: `Řekni stručně přesně: Požadavek je zaznamenán pod číslem ${speakTicketDigits(savedTicketNumber)}. Na shledanou.` } });
            return;
          }
          const parsed = requestSchema.parse(JSON.parse(event.arguments));
          const result = await pool.query<{ id: string; ticket_number: number }>(
            `INSERT INTO service_requests (caller_name, caller_number, callback_number, issue_summary, urgency, status)
             VALUES ($1,$2,$3,$4,$5,'received') RETURNING id, ticket_number`,
            [parsed.callerName, callbackCandidate || participant.info.party_caller_id || null, parsed.callbackNumber, parsed.issueSummary, parsed.urgency]
          );
          savedTicketId = result.rows[0]!.id;
          savedTicketNumber = result.rows[0]!.ticket_number;
          onSaved?.(savedTicketId);
          send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: event.call_id, output: JSON.stringify({ ok: true, request_number: savedTicketNumber }) } });
          hangupAfterResponse = true;
          awaitingFinalResponse = true;
          send({ type: 'response.create', response: { tool_choice: 'none', instructions: `Řekni stručně přesně: Požadavek je zaznamenán pod číslem ${speakTicketDigits(savedTicketNumber)}. Na shledanou.` } });
          logger.info({ requestId: savedTicketId, ticketNumber: savedTicketNumber, participantId: participant.id }, 'service request saved after caller confirmation');
        } catch (error) {
          logger.error({ err: error, participantId: participant.id }, 'service request save failed');
          if (error instanceof z.ZodError && error.issues.some(issue => issue.path[0] === 'callbackNumber')) {
            send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: event.call_id, output: JSON.stringify({ ok: false, code: 'invalid_callback_number', message: 'Callback číslo nebylo rozpoznáno jako telefonní číslo; neukládej požadavek, vyžádej si číslo znovu po jednotlivých číslicích a přečtené číslo nech výslovně potvrdit.' }) } });
            send({ type: 'response.create', response: { tool_choice: 'none', instructions: 'Stručně se omluv, že se nepodařilo zachytit callback číslo. Požádej volajícího, aby nadiktoval číslo po jednotlivých číslicích. Pak číslo zopakuj po skupinách a zeptej se, zda je správně. Nepoužívej číslo z caller ID. Uložení zkus znovu až po potvrzení nového čísla i celého shrnutí.' } });
            return;
          }
          send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: event.call_id, output: JSON.stringify({ ok: false, message: 'Uložení se nepodařilo. Omluv se, zopakuj prosím údaje později.' }) } });
          send({ type: 'response.create' });
        }
      })();
    } else if (event.type === 'error') {
      const code = event.error?.code;
      trace('Chyba relace OpenAI', typeof code === 'string' && /^[a-z_]{1,60}$/.test(code) ? code : undefined);
      logger.error({ event, participantId: participant.id }, 'OpenAI Realtime error');
    }
  });
  ws.on('error', (error: Error & { code?: string }) => {
    if (stopped) return;
    const status = /^Unexpected server response: (\d{3})$/.exec(error.message)?.[1];
    const detail = status ? `HTTP ${status}` : error.message === 'Opening handshake has timed out' ? 'Časový limit' : error.code;
    trace('Chyba WebSocketu OpenAI', detail);
    logger.error({ err: error, participantId: participant.id }, 'OpenAI Realtime WebSocket error');
  });
  ws.on('close', (code, reason) => {
    trace('Relace OpenAI ukončena', code);
    logger.warn({ code, reason: reason.toString(), participantId: participant.id, savedTicketId, savedTicketNumber }, 'OpenAI Realtime session closed');
    stop();
  });
  return stop;
}
