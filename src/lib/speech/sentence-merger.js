// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from llm-sds-01 AO browser Parakeet streaming; see NOTICES.md.
const key = word => word.text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
export const wordsText = words => words.map(w => w.text).join(' ').replace(/\s+([,.!?;:])/g, '$1');
const abbreviations = /^(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|a\.m|p\.m)\.$/i;

// Deliberately conservative: a partial ASR sentence remains editable until later
// speech confirms its boundary. Pause/Stop is explicit evidence of an utterance end.
export function endsSentence(word) {
  const token = word.text.replace(/["'”’\])}]+$/g, '');
  if (/[!?]$/.test(token)) return true;
  if (!token.endsWith('.') || abbreviations.test(token)) return false;
  if (/^(?:[A-Za-z]\.)+$/.test(token) || /^\d+\.$/.test(token)) return false;
  return true;
}

export class SentenceMerger {
  constructor() { this.stable = []; this.draft = []; }
  get cursor() { return this.stable.at(-1)?.end_time || 0; }
  get contextStart() {
    const starts = [0];
    for (let i = 0; i < this.stable.length - 1; i++) if (endsSentence(this.stable[i])) starts.push(i + 1);
    return this.stable[starts[Math.max(0, starts.length - 2)]]?.start_time || 0;
  }
  update(hypothesis = [], { final = false, pause = false, windowStart = 0 } = {}) {
    const cursor = this.cursor;
    let incoming = hypothesis.filter(w => w && typeof w.text === 'string' &&
      Number.isFinite(w.start_time) && Number.isFinite(w.end_time) && w.end_time > cursor + .04)
      .map(w => ({ ...w }));
    // Replayed context may shift across the mature cursor. Match both words and
    // absolute time so a genuine later repetition is never removed by text alone.
    if (incoming[0]?.start_time < cursor - .01) {
      for (let n = Math.min(12, incoming.length, this.stable.length); n > 0; n--) {
        const suffix = this.stable.slice(-n);
        if (suffix.every((w, i) => key(w) === key(incoming[i]) &&
          Math.abs(w.start_time - incoming[i].start_time) < .5)) {
          incoming = incoming.slice(n); break;
        }
      }
    }
    const previous = this.draft;
    // An empty result cannot erase recognized speech. A nonempty full-window
    // hypothesis can correct its provisional region, while older words survive.
    if (incoming.length) {
      const retained = previous.filter(w => w.end_time <= windowStart && w.end_time > cursor);
      // Avoid replaying an old provisional suffix at a moving window seam.
      for (let n = Math.min(12, retained.length, incoming.length); n > 0; n--) {
        if (retained.slice(-n).every((w, i) => key(w) === key(incoming[i]) &&
          Math.abs(w.start_time - incoming[i].start_time) < .5)) {
          incoming = incoming.slice(n); break;
        }
      }
      this.draft = [...retained, ...incoming];
    }
    let confirmed = 0;
    if (final || pause) confirmed = this.draft.length;
    else {
      // Require the sentence's lexical content to agree with the prior decode;
      // punctuation may improve while the words themselves remain unchanged.
      let common = 0;
      while (common < Math.min(previous.length, this.draft.length) &&
        key(previous[common]) === key(this.draft[common]) &&
        Math.abs(previous[common].start_time - this.draft[common].start_time) < .5) common++;
      for (let i = 0; i < Math.min(common, this.draft.length - 1); i++) {
        if (endsSentence(this.draft[i]) && this.draft.slice(i + 1).some(w => key(w))) confirmed = i + 1;
      }
    }
    this.stable.push(...this.draft.slice(0, confirmed));
    this.draft = this.draft.slice(confirmed);
    return this.snapshot();
  }
  snapshot() {
    return { stable: this.stable.slice(), draft: this.draft.slice(), cursor: this.cursor,
      stableText: wordsText(this.stable), draftText: wordsText(this.draft),
      text: wordsText([...this.stable, ...this.draft]) };
  }
}
