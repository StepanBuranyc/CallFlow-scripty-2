/** Convert linear PCM 16-bit mono between the 3CX 8 kHz and Realtime 24 kHz rates. */
export function upsample8kTo24k(input: Buffer): Buffer {
  const length = Math.floor(input.length / 2);
  const output = Buffer.alloc(length * 6);
  for (let index = 0; index < length; index += 1) {
    const sample = input.readInt16LE(index * 2);
    output.writeInt16LE(sample, index * 6);
    output.writeInt16LE(sample, index * 6 + 2);
    output.writeInt16LE(sample, index * 6 + 4);
  }
  return output;
}

export function downsample24kTo8k(input: Buffer): Buffer {
  const samples = Math.floor(input.length / 6);
  const output = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    output.writeInt16LE(input.readInt16LE(index * 6), index * 2);
  }
  return output;
}
