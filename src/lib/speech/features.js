// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from llm-sds-01 AO browser Parakeet streaming; see NOTICES.md.
import { JsPreprocessor, createMelFilterbank, createPaddedHannWindow, precomputeTwiddles, fft } from 'parakeet.js/mel';

const HOP = 160, FFT = 512, MAX = 60 * 16000;
// Continuous STFT on the recording's 10ms grid. The public parakeet.js math
// supplies its exact Hann/filterbank/FFT/normalization; no Keet code is copied.
export class ContinuousFeatures {
  constructor(nMels = 128) {
    this.nMels = nMels; this.count = 0; this.frames = 0; this.frameComputations = 0;
    this.audio = new Float32Array(MAX);
    this.stride = MAX / HOP;
    this.raw = new Float32Array(nMels * this.stride);
    this.window = createPaddedHannWindow(); this.fb = createMelFilterbank(nMels);
    this.tw = precomputeTwiddles(FFT);
    this.re = new Float64Array(FFT); this.im = new Float64Array(FFT);
    this.power = new Float32Array(257);
    this.normalizer = new JsPreprocessor({ nMels });
  }
  push(pcm) {
    if (!(pcm instanceof Float32Array) || this.count + pcm.length > MAX) throw new Error('PCM must be Float32 and recording at most 60 seconds.');
    // Store pre-emphasized PCM once, including the preceding chunk's last sample.
    let previous = this.previous ?? 0;
    for (let i = 0; i < pcm.length; i++) {
      this.audio[this.count++] = Math.fround(pcm[i] - .97 * previous);
      previous = pcm[i];
    }
    this.previous = previous;
    // Wait for the full right context; never freeze zero-padded provisional frames.
    while (this.frames * HOP + FFT / 2 <= this.count) {
      const values = this.frame(this.frames, this.count);
      for (let m = 0; m < this.nMels; m++) this.raw[m * this.stride + this.frames] = values[m];
      this.frames++;
    }
  }
  frame(t, end) {
    const start = t * HOP - FFT / 2;
    for (let k = 0; k < FFT; k++) {
      const sample = start + k;
      this.re[k] = (sample >= 0 && sample < end ? this.audio[sample] : 0) * this.window[k];
      this.im[k] = 0;
    }
    fft(this.re, this.im, FFT, this.tw);
    for (let k = 0; k < 257; k++) this.power[k] = this.re[k] ** 2 + this.im[k] ** 2;
    const values = new Float32Array(this.nMels);
    for (let m = 0; m < this.nMels; m++) {
      let sum = 0;
      for (let k = 0; k < 257; k++) sum += this.power[k] * this.fb[m * 257 + k];
      values[m] = Math.log(sum + 2 ** -24);
    }
    this.frameComputations++;
    return values;
  }
  compute(start, end) {
    if (!Number.isInteger(start) || start < 0 || start % HOP || !Number.isInteger(end) || end < start || end > this.count) throw new Error('Feature window requires an available integer sample range and 160-sample aligned start.');
    const first = start / HOP, T = Math.floor((end - start) / HOP);
    const raw = new Float32Array(this.nMels * T);
    let cachedFrames = 0;
    for (let t = 0; t < T; t++) {
      const global = first + t;
      const safe = global < this.frames && global * HOP + FFT / 2 <= end;
      const edge = safe ? null : this.frame(global, end);
      if (safe) cachedFrames++;
      for (let m = 0; m < this.nMels; m++) raw[m * T + t] = safe ? this.raw[m * this.stride + global] : edge[m];
    }
    return { features: this.normalizer.normalizeFeatures(raw, T, T), T, melBins: this.nMels,
      cachedFrames, newFrames: T - cachedFrames, totalComputedFrames: this.frameComputations };
  }
}


// A compute may arrive over an inference port before its PCM arrives over the
// owner's channel. Hold valid requests until that sample range is available.
export class FeaturesServer {
  constructor(endpoint) { this.endpoints = new Set(); this.waiting = []; this.attach(endpoint); }
  attach(endpoint) {
    this.endpoints.add(endpoint);
    endpoint.onmessage = ({ data }) => this.receive(endpoint, data);
    endpoint.start?.();
    if (this.failure) endpoint.postMessage({ fatal: true, error: this.failure });
  }
  fatal(error) {
    this.failure = error.message;
    for (const endpoint of this.endpoints) endpoint.postMessage({ fatal: true, error: this.failure });
    this.waiting = [];
  }
  reply(endpoint, data) {
    try {
      const result = this.features.compute(data.startSample, data.endSample);
      endpoint.postMessage({ id: data.id, result }, [result.features.buffer]);
    } catch(error) { endpoint.postMessage({ id: data.id, error: error.message }); }
  }
  receive(endpoint, data) {
    try {
      if (data.type === 'connect') { this.attach(data.port); return; }
      if (data.type === 'disconnect') {
        this.endpoints.delete(endpoint); this.waiting = this.waiting.filter(r => r.endpoint !== endpoint); endpoint.close?.(); return;
      }
      if (this.failure) { endpoint.postMessage({ fatal: true, error: this.failure }); return; }
      if (data.type === 'init') {
        if (this.features) throw new Error('Feature session already initialized.');
        this.features = new ContinuousFeatures(data.nMels);
      } else if (data.type === 'push') {
        this.features.push(data.pcm);
        const ready = this.waiting.filter(r => r.data.endSample <= this.features.count);
        this.waiting = this.waiting.filter(r => r.data.endSample > this.features.count);
        for (const request of ready) this.reply(request.endpoint, request.data);
      } else if (data.type === 'compute') {
        const { startSample: start, endSample: end } = data;
        if (!Number.isInteger(start) || start < 0 || start % HOP || !Number.isInteger(end) || end < start || end > MAX) {
          endpoint.postMessage({ id: data.id, error: 'Feature window requires integer samples, 160-sample aligned start and end at most 60 seconds.' });
        } else if (!this.features || end > this.features.count) this.waiting.push({ endpoint, data });
        else this.reply(endpoint, data);
      } else if (data.type === 'close') this.fatal(new Error('Feature session closed.'));
    } catch(error) { this.fatal(error); }
  }
}
