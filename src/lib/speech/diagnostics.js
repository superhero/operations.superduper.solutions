// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// WAV and normalized WER preserve AO's local diagnostic format.
export function wav(chunks) {
  const count = chunks.reduce((sum, x) => sum + x.length, 0);
  const buffer = new ArrayBuffer(44 + count * 4), view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + count * 4, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 3, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 64000, true); view.setUint16(32, 4, true); view.setUint16(34, 32, true);
  text(36, 'data'); view.setUint32(40, count * 4, true);
  let offset = 44;
  for (const chunk of chunks) for (const sample of chunk) { view.setFloat32(offset, sample, true); offset += 4; }
  return new Blob([buffer], { type: 'audio/wav' });
}
export function compare(reference, hypothesis) {
  const words = text => text.toLowerCase().replace(/[’]/g, "'").replace(/[^\p{L}\p{N}'\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const a = words(reference), b = words(hypothesis);
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] !== b[j - 1]));
  let i = a.length, j = b.length, substitutions = 0, deletions = 0, insertions = 0;
  const alignment = [];
  while (i || j) {
    if (i && j && dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] !== b[j - 1])) {
      const same = a[i - 1] === b[j - 1]; if (!same) substitutions++;
      alignment.push({ expected: a[--i], actual: b[--j], operation: same ? 'match' : 'substitution' });
    } else if (i && dp[i][j] === dp[i - 1][j] + 1) { deletions++; alignment.push({ expected: a[--i], operation: 'omission' }); }
    else { insertions++; alignment.push({ actual: b[--j], operation: 'insertion' }); }
  }
  return { substitutions, deletions, insertions, referenceWords: a.length, wer: a.length ? (substitutions + deletions + insertions) / a.length : null, alignment: alignment.reverse() };
}
export function signalStats(chunks) {
  let samples = 0, sumSquares = 0, peak = 0, clippedSamples = 0;
  for (const pcm of chunks) for (const x of pcm) { samples++; sumSquares += x * x; peak = Math.max(peak, Math.abs(x)); if (Math.abs(x) >= .999) clippedSamples++; }
  return { samples, rms: Math.sqrt(sumSquares / Math.max(1, samples)), peak, clippedSamples };
}
