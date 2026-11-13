/** Generate 16-bit signed PCM, mono, 8 kHz: the format documented by the official 3CX TS SDK. */
export function makeTestTone(frequencyHz: number, durationMs: number): Buffer {
  const sampleRate = 8000;
  const samples = Math.floor(sampleRate * durationMs / 1000);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const envelope = Math.min(1, i / 80, (samples - i) / 80);
    const sample = Math.round(Math.sin(2 * Math.PI * frequencyHz * i / sampleRate) * 5000 * envelope);
    pcm.writeInt16LE(sample, i * 2);
  }
  return pcm;
}
