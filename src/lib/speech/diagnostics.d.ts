export function wav(chunks: Float32Array[]): Blob;
export function compare(reference: string, hypothesis: string): { substitutions: number; deletions: number; insertions: number; referenceWords: number; wer: number | null; alignment: unknown[] };
export function signalStats(chunks: Float32Array[]): { samples: number; rms: number; peak: number; clippedSamples: number };
