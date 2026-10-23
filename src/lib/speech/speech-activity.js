// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from llm-sds-01 AO browser Parakeet streaming; see NOTICES.md.
// Speech intervals keep onset context and close only after a sustained pause.
export class SpeechActivity {
  constructor({ preRoll = .3, tail = .5, pause = 1 } = {}) {
    Object.assign(this, { preRoll, tail, pause });
    this.segments = []; this.processed = 0;
  }
  observe(frames) {
    for (const { start, end, speech } of frames) {
      this.processed = end;
      let current = this.segments.at(-1);
      if (speech) {
        if (!current || current.closed) {
          current = { start: Math.max(0, start - this.preRoll), speechEnd: end, closed: false };
          this.segments.push(current);
        }
        current.speechEnd = end;
      } else if (current && !current.closed && end - current.speechEnd >= this.pause) {
        current.closed = true; current.end = current.speechEnd + this.tail;
      }
    }
  }
  finish(seconds) {
    const current = this.segments.at(-1);
    if (current && !current.closed) { current.closed = true; current.end = Math.min(seconds, current.speechEnd + this.tail); }
    this.processed = seconds;
  }
}
