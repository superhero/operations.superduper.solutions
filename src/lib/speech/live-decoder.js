// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from llm-sds-01 AO browser Parakeet streaming; see NOTICES.md.
import { SentenceMerger } from './sentence-merger.js';
import { SpeechActivity } from './speech-activity.js';
const RATE = 16000, HOP = 160;

// Recognition jobs are coalesced, never the PCM. VAD and feature production see
// every sample; inference skips silence and serially drains speech intervals.
export class LiveDecoder {
  constructor({ infer, detect, pushFeatures = () => {}, maxContextSeconds = 30, update, finish, error }) {
    Object.assign(this, { infer, detect, pushFeatures, maxContextSeconds, update, finish, error });
    this.audio = new Float32Array(60 * RATE); this.count = 0; this.lastCount = 0;
    this.elapsed = 0; this.calls = 0; this.segmentIndex = 0;
    this.activity = new SpeechActivity(); this.merger = new SentenceMerger();
  }
  push(pcm) {
    if (this.ended || this.ending) return;
    try {
      if (this.count + pcm.length > this.audio.length) throw new Error('Recording exceeds 60 seconds.');
      this.audio.set(pcm, this.count); this.count += pcm.length;
      this.pushFeatures(pcm); this.activity.observe(this.detect(pcm)); this.schedule();
    } catch (e) { this.ended = true; this.error(e); }
  }
  end(pcm) {
    if (this.ended) return;
    // Capture flush normally sends everything first. Retain any final remainder.
    if (pcm.length > this.count) this.push(pcm.slice(this.count));
    this.ending = true; this.activity.finish(this.count / RATE); this.schedule();
  }
  job() {
    const segment = this.activity.segments[this.segmentIndex];
    if (!segment) return this.ending ? { kind: 'finish' } : null;
    const lower = Math.floor(segment.start * RATE / HOP) * HOP;
    const target = Math.min(this.count, Math.round((segment.closed ? segment.end : Math.min(this.activity.processed, segment.speechEnd + .5)) * RATE));
    const previous = Math.max(lower, this.lastCount);
    if (segment.closed && previous >= target) return { kind: 'flush', end: target };
    if (!segment.closed && (target - lower < .75 * RATE || target - previous < .48 * RATE)) return null;
    const end = Math.min(target, previous + 4 * RATE);
    // previous >= lower; the early flush/readiness checks ensure end > lower.
    const contextStart = (this.merger.contextStart - .5) * RATE;
    const start = Math.floor(Math.max(0, end - this.maxContextSeconds * RATE, Math.min(lower, contextStart)) / HOP) * HOP;
    return { kind: 'decode', start, end, pause: segment.closed && end === target };
  }
  schedule() {
    if (this.running || this.scheduled || this.ended || !this.job()) return;
    this.scheduled = true;
    setTimeout(() => { this.scheduled = false; this.pump(); }, 0);
  }
  message(state, end, extra = {}) {
    return { text: state.text, stableText: state.stableText, draftText: state.draftText,
      seconds: this.count / RATE, decodedThroughSeconds: end / RATE,
      receivedSeconds: this.count / RATE, lagSeconds: Math.max(0, (this.count - end) / RATE),
      elapsed: this.elapsed, decodeMs: 0, algorithm: 'speech-sentences-v2',
      speech: { state: extra.paused ? 'pause' : 'speech', intervals: this.activity.segments.length,
        completedIntervals: this.segmentIndex, inferenceCalls: this.calls }, ...extra };
  }
  async pump() {
    if (this.running || this.ended) return;
    const job = this.job(); if (!job) return;
    this.running = true;
    try {
      if (job.kind === 'finish') {
        const state = this.merger.update([], { final: true }); this.ended = true;
        await this.finish({ ...this.message(state, this.count), words: state.stable });
      } else if (job.kind === 'flush') {
        const state = this.merger.update([], { pause: true }); this.segmentIndex++;
        this.update(this.message(state, job.end, { paused: true }));
      } else {
        const began = performance.now();
        const result = await this.infer(this.audio.slice(job.start, job.end), job.start / RATE);
        const decodeMs = performance.now() - began; this.elapsed += decodeMs / 1000; this.calls++;
        const state = this.merger.update(result.words || [], { pause: job.pause, windowStart: job.start / RATE });
        this.lastCount = job.end;
        if (job.pause) this.segmentIndex++;
        this.update(this.message(state, job.end, { decodeMs, windowStart: job.start / RATE,
          paused: job.pause, preprocessing: result.preprocessing }));
      }
    } catch (e) { this.ended = true; this.error(e); }
    finally { this.running = false; this.schedule(); }
  }
}
