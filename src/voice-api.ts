import WebSocket from 'ws';
import { config } from './config.js';
import { settingsKey } from './operations.js';

export const OPENAI_REALTIME_MODELS = ['gpt-realtime-2.1', 'gpt-realtime-2.1-mini'] as const;
export const XAI_REALTIME_MODEL = 'grok-voice-latest';
export type VoiceProvider = 'openai' | 'xai';
type VoiceSettings = { voiceProvider: VoiceProvider; openAiModel: string; voice?: string; speed?: number };
const connectionTimeout = 10_000;

export function voiceConnection(settings: VoiceSettings) {
  const provider = settings.voiceProvider;
  const xai = provider === 'xai';
  const model = xai ? XAI_REALTIME_MODEL : settings.openAiModel;
  const secret = xai ? config.XAI_API_KEY : config.OPENAI_API_KEY;
  const voice = xai ? config.XAI_VOICE : settings.voice ?? config.OPENAI_VOICE;
  const speed = settings.speed ?? 1;
  const label = xai ? 'Grok Voice (xAI)' : 'OpenAI Realtime';
  return { provider, model, secret, voice, speed, label, key: settingsKey(model, secret, voice, String(speed)) };
}

type VoiceConnection = ReturnType<typeof voiceConnection>;

export function openVoiceSocket(voice: VoiceConnection): WebSocket {
  if (!voice.secret) throw new Error(`Pro ${voice.label} chybí API klíč.`);
  const endpoint = voice.provider === 'xai' ? 'wss://api.x.ai/v1/realtime' : 'wss://api.openai.com/v1/realtime';
  return new WebSocket(`${endpoint}?model=${encodeURIComponent(voice.model)}`, {
    headers: { Authorization: `Bearer ${voice.secret}` },
    handshakeTimeout: connectionTimeout
  });
}

export function voiceSession(voice: VoiceConnection, instructions: string, tools: object[] = []) {
  const format = { type: 'audio/pcm', rate: 24_000 };
  const turnDetection = { type: 'server_vad' };
  if (voice.provider === 'xai') return {
    instructions, tools, voice: voice.voice, turn_detection: turnDetection,
    audio: { input: { format }, output: { format } }
  };
  return {
    type: 'realtime',
    instructions,
    tools,
    tool_choice: 'auto',
    audio: {
      input: {
        format,
        noise_reduction: { type: 'near_field', strength: 0.8 },
        transcription: { model: 'gpt-4o-mini-transcribe', language: 'cs' },
        turn_detection: { ...turnDetection, threshold: 0.6, silence_duration_ms: 650 }
      },
      output: { format, voice: voice.voice, speed: voice.speed }
    }
  };
}

export function voiceUtterance(provider: VoiceProvider, text: string) {
  if (provider === 'xai') return {
    type: 'conversation.item.create',
    item: { type: 'force_message', role: 'assistant', interruptible: false, content: [{ type: 'output_text', text }] }
  };
  return {
    type: 'response.create',
    response: { tool_choice: 'none', instructions: `Řekni přesně: ${JSON.stringify(text)}`, input: [] }
  };
}

export function voiceErrorCode(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9_]{1,80}$/i.test(value) ? value : 'nezjištěný kód';
}

/** Verifies the same Realtime session configuration as a call, without audio or a generated reply. */
export async function checkVoiceConnection(voice: VoiceConnection, tools: object[]): Promise<void> {
  const socket = openVoiceSocket(voice);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Realtime relace neodpověděla v časovém limitu.')), 12_000);
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket.readyState === WebSocket.OPEN) socket.close();
      else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      if (error) reject(error);
      else resolve();
    }
    socket.once('open', () => socket.send(JSON.stringify({
      type: 'session.update', session: voiceSession(voice, 'Technický test připojení bez hovoru.', tools)
    })));
    socket.on('message', data => {
      try {
        const event = JSON.parse(data.toString()) as { type?: string; error?: { code?: unknown } };
        if (event.type === 'session.updated') finish();
        if (event.type === 'error') finish(new Error(`Realtime API odmítlo nastavení (${voiceErrorCode(event.error?.code)}).`));
      } catch { finish(new Error('Realtime API vrátilo neplatnou odpověď.')); }
    });
    socket.on('error', () => finish(new Error('Navázání spojení s Realtime API selhalo.')));
    socket.once('close', () => finish(new Error('Realtime API uzavřelo spojení před potvrzením.')));
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      finish(new Error(`Realtime API vrátilo HTTP ${response.statusCode ?? 0}.`));
    });
  });
}
