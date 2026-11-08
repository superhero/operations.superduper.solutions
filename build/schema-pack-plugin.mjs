// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { encodeAdaptiveSchemaPack } from '../src/lib/schema-pack-codec.ts';

/** Keep the same gzip bytes offline while avoiding Base64's larger footprint. */
export function compactSchemaPacks() {
  const directory = fileURLToPath(new URL('../src/catalogs/services/', import.meta.url));
  return {
    name: 'operations-compact-schema-packs', enforce: 'pre', apply: 'build',
    async load(id) {
      const [file, query = ''] = id.split('?'), params = new URLSearchParams(query);
      if (!file.startsWith(directory) || !file.endsWith('.json.gz') || !params.has('url') || !params.has('inline')) return;
      return `export default ${JSON.stringify(encodeAdaptiveSchemaPack(await readFile(file)))};`;
    },
  };
}
