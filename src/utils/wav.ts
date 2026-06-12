/**
 * Helper to write UTF bytes into a DataView at a specific offset
 */
function writeUTFBytes(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Encodes a mono Float32 audio buffer into a 16-bit Mono WAV ArrayBuffer
 */
export function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  /* RIFF identifier */
  writeUTFBytes(view, 0, 'RIFF');
  /* File length */
  view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */
  writeUTFBytes(view, 8, 'WAVE');
  
  /* Format chunk identifier */
  writeUTFBytes(view, 12, 'fmt ');
  /* Format chunk length */
  view.setUint32(16, 16, true);
  /* Sample format (1 = Uncompressed PCM) */
  view.setUint16(20, 1, true);
  /* Channel count (Mono = 1) */
  view.setUint16(22, 1, true);
  /* Sample rate */
  view.setUint32(24, sampleRate, true);
  /* Byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * 2, true);
  /* Block align (channels * bytes per sample = 1 * 2 = 2) */
  view.setUint16(32, 2, true);
  /* Bits per sample */
  view.setUint16(34, 16, true);
  
  /* Data chunk identifier */
  writeUTFBytes(view, 36, 'data');
  /* Data chunk length */
  view.setUint32(40, samples.length * 2, true);

  // Convert Float32 samples (-1.0 to 1.0) into 16-bit Signed Integer PCM
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return buffer;
}

/**
 * Creates a blob URL for a Wav file from raw pcm samples
 */
export function createWavBlobUrl(samples: Float32Array, sampleRate: number): string {
  const wavBuffer = encodeWAV(samples, sampleRate);
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}
