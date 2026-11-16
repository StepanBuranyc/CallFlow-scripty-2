import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../audio/recordings');
const writes = new Set<Promise<void>>();
const rate = 8_000;
const maxSamples = 30 * 60 * rate;
type Chunk = { start: number; pcm: Buffer };

export function recordingPath(id: string): string {
  return resolve(directory, id + '.wav');
}

export function startCallRecording(retentionDays: number) {
  const id = randomUUID();
  const startTime = new Date();
  const startClock = performance.now();
  const tracks: [Chunk[], Chunk[]] = [[], []];
  const end = [0, 0];
  let ticketId: string | undefined;
  let pending: Promise<void> | undefined;
  const position = () => Math.min(maxSamples, Math.floor((performance.now() - startClock) * rate / 1_000));

  function append(channel: 0 | 1, pcm: Buffer): void {
    if (pending || !pcm.length) return;
    const now = position();
    const clockStart = channel === 0 ? Math.max(0, now - Math.floor(pcm.length / 2)) : now;
    // Preserve arrival jitter in the continuous inbound stream without dropping real gaps.
    const start = channel === 0 && clockStart - end[0]! < rate / 4 ? end[0]! : Math.max(clockStart, end[channel]!);
    const count = Math.min(pcm.length >> 1, maxSamples - start);
    if (count <= 0) return;
    tracks[channel].push({ start, pcm: Buffer.from(pcm.subarray(0, count * 2)) });
    end[channel] = start + count;
  }

  function clearAssistant(): void {
    const cutoff = position();
    const track = tracks[1];
    while (track.length && track.at(-1)!.start >= cutoff) track.pop();
    const last = track.at(-1);
    if (last && last.start + last.pcm.length / 2 > cutoff) last.pcm = last.pcm.subarray(0, (cutoff - last.start) * 2);
    end[1] = last ? last.start + last.pcm.length / 2 : 0;
  }

  async function persist(): Promise<void> {
    const samples = Math.max(end[0]!, end[1]!);
    if (!samples) return;
    const wav = Buffer.alloc(44 + samples * 4);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28);
    wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(samples * 4, 40);
    for (const [channel, track] of tracks.entries()) {
      for (const { pcm, start } of track) {
        for (let sample = 0; sample < pcm.length / 2; sample++) {
          wav.writeInt16LE(pcm.readInt16LE(sample * 2), 44 + (start + sample) * 4 + channel * 2);
        }
      }
      track.length = 0;
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = recordingPath(id);
    try {
      await writeFile(path, wav, { flag: 'wx', mode: 0o600 });
      await pool.query(
        'INSERT INTO call_recordings (id, request_id, started_at, duration_seconds, expires_at) VALUES ($1, (SELECT id FROM service_requests WHERE id=$2), $3, $4, now() + $5::int * interval \'1 day\')',
        [id, ticketId ?? null, startTime, Math.ceil(samples / rate), retentionDays]
      );
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }
  }

  return {
    append,
    clearAssistant,
    async attach(requestId: string): Promise<void> {
      ticketId = requestId;
      if (pending) {
        await pending;
        await pool.query('UPDATE call_recordings SET request_id=(SELECT id FROM service_requests WHERE id=$2) WHERE id=$1', [id, requestId]);
      }
    },
    finish(): Promise<void> {
      if (!pending) {
        clearAssistant();
        pending = persist();
        writes.add(pending);
        const done = () => { writes.delete(pending!); };
        void pending.then(done, done);
      }
      return pending;
    }
  };
}

export async function finishRecordingWrites(): Promise<void> {
  await Promise.allSettled(writes);
}

export async function purgeExpiredRecordings(): Promise<void> {
  const expired = await pool.query<{ id: string }>('SELECT id FROM call_recordings WHERE expires_at <= now() LIMIT 500');
  for (const { id } of expired.rows) {
    try { await unlink(recordingPath(id)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await pool.query('DELETE FROM call_recordings WHERE id=$1', [id]);
  }
}
