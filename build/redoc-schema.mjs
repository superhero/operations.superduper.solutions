// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

/** Read an embedded JSON contract without evaluating documentation JavaScript. */
export function extractRedocSchema(html) {
  const marker = /\b(?:const|let|var)\s+__redoc_state\s*=\s*(?=\{)/.exec(html);
  if (!marker) throw new Error('Embedded ReDoc JSON state was not found.');
  const start = marker.index + marker[0].length;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < html.length; index++) {
    const character = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{') depth++;
    else if (character === '}' && --depth === 0) {
      const document = JSON.parse(html.slice(start, index + 1))?.spec?.data;
      if (!document || typeof document !== 'object' || Array.isArray(document)
        || !/^3\.(0|1)\./.test(document.openapi) || !document.info || !document.paths)
        throw new Error('Embedded ReDoc state does not contain an OpenAPI 3 document.');
      return document;
    }
  }
  throw new Error('Embedded ReDoc JSON state is incomplete.');
}
