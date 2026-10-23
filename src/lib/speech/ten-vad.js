// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from llm-sds-01 AO browser Parakeet streaming; see NOTICES.md.
import createVADModule from './vendor/ten-vad/ten_vad.js';

// Official TEN-VAD WASM, 16 kHz mono, 256-sample hops, threshold 0.5.
export class TenVad {
  static async create(wasmBinary) {
    wasmBinary ||= new Uint8Array(await (await fetch(new URL('./vendor/ten-vad/ten_vad.wasm', import.meta.url))).arrayBuffer());
    return new TenVad(await createVADModule({ wasmBinary }));
  }
  constructor(module) {
    this.module = module;
    this.handlePtr = module._malloc(4); this.audioPtr = module._malloc(512);
    this.probPtr = module._malloc(4); this.flagPtr = module._malloc(4);
    try { this.reset(); } catch (error) { this.close(); throw error; }
  }
  reset() {
    const m = this.module;
    if (this.handle) m._ten_vad_destroy(this.handlePtr);
    if (m._ten_vad_create(this.handlePtr, 256, .5) !== 0) throw new Error('TEN-VAD initialization failed.');
    this.handle = m.HEAP32[this.handlePtr >> 2];
    this.pending = new Float32Array(256); this.used = 0; this.count = 0;
  }
  process(pcm) {
    const frames = [], m = this.module;
    for (const sample of pcm) {
      this.pending[this.used++] = sample; this.count++;
      if (this.used !== 256) continue;
      for (let i = 0; i < 256; i++) m.HEAP16[(this.audioPtr >> 1) + i] = Math.round(Math.max(-1, Math.min(1, this.pending[i])) * 32767);
      if (m._ten_vad_process(this.handle, this.audioPtr, 256, this.probPtr, this.flagPtr) !== 0) throw new Error('TEN-VAD processing failed.');
      frames.push({ start: (this.count - 256) / 16000, end: this.count / 16000,
        speech: !!m.HEAP32[this.flagPtr >> 2], probability: m.HEAPF32[this.probPtr >> 2] });
      this.used = 0;
    }
    return frames;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    const m = this.module;
    if (this.handle) m._ten_vad_destroy(this.handlePtr);
    for (const ptr of [this.handlePtr,this.audioPtr,this.probPtr,this.flagPtr]) m._free(ptr);
    this.handle = 0;
  }
}
