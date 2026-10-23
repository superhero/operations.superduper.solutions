// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';

// BS's local patch, applied to the pinned package at build time. Never mutate
// node_modules. Also serialize CPU initialization, and report both stages.
export function parakeetSerialInitialization() {
  return {
    name: 'operations-parakeet-serial-init', enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/parakeet.js/src/parakeet.js')) return;
      const hash = createHash('sha256').update(source).digest('hex');
      if (hash !== '74e175f9e4d6adbcd77572cb84aba79570f1f80cc76e4deb6c34c12286b9b636')
        throw new Error('Parakeet source changed. Review the serial initialization patch before upgrading.');
      const old = `if (backend === 'webgpu-hybrid') {\n      // avoid parallel create to prevent double initWasm race\n      encoderSession = await createSession(encoderUrl, encoderSessionOptions);\n      joinerSession = await createSession(decoderUrl, decoderSessionOptions);`;
      const patched = `if (['webgpu-hybrid', 'webgpu-strict', 'wasm'].includes(backend)) {\n      cfg.onSessionStage?.('encoder_session_start');\n      encoderSession = await createSession(encoderUrl, encoderSessionOptions);\n      cfg.onSessionStage?.('encoder_session_ready');\n      cfg.onSessionStage?.('decoder_session_start');\n      joinerSession = await createSession(decoderUrl, decoderSessionOptions);\n      cfg.onSessionStage?.('decoder_session_ready');`;
      const normalized = source.replaceAll('\r\n', '\n');
      if (normalized.split(old).length !== 2) throw new Error('Parakeet initialization patch no longer matches.');
      return { code: normalized.replace(old, patched), map: null };
    },
  };
}
