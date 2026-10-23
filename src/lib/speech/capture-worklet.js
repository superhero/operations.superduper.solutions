// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from llm-sds-01 AO browser Parakeet streaming; see NOTICES.md.
// Capture packets are short; the decoder independently coalesces work.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4000);
    this.used = 0;
    this.port.onmessage = ({ data }) => {
      if (data === 'flush') {
        this.flush();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }
  flush() {
    if (!this.used) return;
    const pcm = this.buffer.slice(0, this.used);
    this.port.postMessage({ type: 'pcm', pcm }, [pcm.buffer]);
    this.used = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] / channels.length;
      this.buffer[this.used++] = sample;
      if (this.used === this.buffer.length) this.flush();
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
