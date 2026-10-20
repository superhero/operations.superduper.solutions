// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { inspectCodexSchema } from '../src/lib/codex-schema.ts';

/** Keep the official JSON Schema intact; add only catalog annotations. */
export function annotateCodexSchema(document, source) {
  if (!/^\d+\.\d+\.\d+$/.test(source.version) || !source.provenance?.startsWith('https://'))
    throw new Error('Codex schema sources require a pinned version and official provenance.');
  const annotated = { ...document, info: {
    title: source.name, version: source.version,
    description: 'Codex App Server JSON-RPC protocol for authentication, threads, turns, approvals and streamed agent events. Requires a Codex connector; execution is not enabled yet.',
    license: { name: 'Apache-2.0', url: 'https://github.com/openai/codex/blob/rust-v' + source.version + '/LICENSE' },
  }, 'x-codex-app-server': { protocol: 'json-rpc', version: source.version, documentation: source.provenance } };
  inspectCodexSchema(annotated, source.id);
  return annotated;
}
