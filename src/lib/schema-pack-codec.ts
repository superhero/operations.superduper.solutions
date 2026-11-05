// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
/** Inline-only transport; exclude quotes, escapes and HTML delimiters. */
const alphabet = "!#$%()*+,-.0123456789:;=@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_abcdefghijklmnopqrstuvwxyz{|}~";
export const compactSchemaPackPrefix = "operations-gzip85:";

export function encodeSchemaPack(bytes: Uint8Array): string {
  const groups: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 4) {
    let value = 0;
    for (let part = 0; part < 4; part++) value = value * 256 + (bytes[offset + part] ?? 0);
    let group = "";
    for (let digit = 0; digit < 5; digit++) {
      group = alphabet[value % 85]! + group;
      value = Math.floor(value / 85);
    }
    groups.push(group.slice(0, Math.min(4, bytes.length - offset) + 1));
  }
  return compactSchemaPackPrefix + groups.join("");
}

export function decodeCompactSchemaPack(encoded: string): Uint8Array<ArrayBuffer> {
  if (encoded.length % 5 === 1) throw new Error("Invalid compact schema pack length.");
  const bytes = new Uint8Array(Math.floor(encoded.length * 4 / 5));
  let target = 0;
  for (let offset = 0; offset < encoded.length; offset += 5) {
    let value = 0;
    for (let part = 0; part < 5; part++) {
      const digit = offset + part < encoded.length ? alphabet.indexOf(encoded[offset + part]!) : 84;
      if (digit < 0) throw new Error("Invalid compact schema pack character.");
      value = value * 85 + digit;
    }
    if (value > 0xffffffff) throw new Error("Invalid compact schema pack value.");
    for (let part = 3; part >= 0; part--) if (target < bytes.length) bytes[target++] = value >>> (part * 8);
  }
  return bytes;
}
