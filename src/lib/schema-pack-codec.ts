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

// Versioned inline transport: two radix-91 digits carry 13 bits. JSON strings
// preserve spaces, quotes other than double quote, and template punctuation.
// Excluding double quote, backslash, '<' and '&' prevents escapes or HTML starts.
const alphabet91 = Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)).filter(c => !['"', '\\', '<', '&'].includes(c)).join('');
export const compactSchemaPack91Prefix = 'operations-gzip91:';
export function encodeSchemaPack91(bytes: Uint8Array): string {
  const groups: string[] = []; let part = '', value = 0, bits = 0;
  for (const byte of bytes) {
    value |= byte << bits; bits += 8;
    if (bits >= 13) {
      const digit = value & 8191; part += alphabet91[digit % 91]! + alphabet91[Math.floor(digit / 91)]!;
      value >>>= 13; bits -= 13;
      if (part.length >= 8192) { groups.push(part); part = ''; }
    }
  }
  if (bits) { part += alphabet91[value % 91]!; if (bits > 6) part += alphabet91[Math.floor(value / 91)]!; }
  groups.push(part); return compactSchemaPack91Prefix + groups.join('');
}
export function decodeCompactSchemaPack91(encoded: string): Uint8Array<ArrayBuffer> {
  const length = Math.floor((Math.floor(encoded.length / 2) * 13 + encoded.length % 2 * 6) / 8);
  const remaining = length * 8 % 13, expected = Math.floor(length * 8 / 13) * 2 + (remaining ? remaining <= 6 ? 1 : 2 : 0);
  if (encoded.length !== expected) throw new Error('Invalid compact schema pack length.');
  const bytes = new Uint8Array(length); let value = 0, bits = 0, target = 0;
  for (let offset = 0; offset < encoded.length; offset += 2) {
    const low = alphabet91.indexOf(encoded[offset]!), paired = offset + 1 < encoded.length, high = paired ? alphabet91.indexOf(encoded[offset + 1]!) : 0;
    if (low < 0 || high < 0) throw new Error('Invalid compact schema pack character.');
    const digit = low + high * 91;
    if (digit > (paired ? 8191 : 63)) throw new Error('Invalid compact schema pack value.');
    value |= digit << bits; bits += paired ? 13 : 6;
    while (bits >= 8) { bytes[target++] = value & 255; value >>>= 8; bits -= 8; }
  }
  if (value !== 0 || target !== length) throw new Error('Invalid compact schema pack padding.');
  return bytes;
}

// Use the remaining radix-91 pairs for 14-bit groups instead of leaving them
// unused. Version the transport; existing fixed-width frames still decode.
export const adaptiveSchemaPackPrefix = 'operations-gzip91a:';
export function encodeAdaptiveSchemaPack(bytes: Uint8Array): string {
  const groups: string[] = []; let part = '', value = 0, bits = 0;
  for (const byte of bytes) {
    value |= byte << bits; bits += 8;
    if (bits > 13) {
      let digit = value & 8191;
      const width = digit > 88 ? 13 : 14;
      if (width === 14) digit = value & 16383;
      part += alphabet91[digit % 91]! + alphabet91[Math.floor(digit / 91)]!;
      value >>>= width; bits -= width;
      if (part.length >= 8192) { groups.push(part); part = ''; }
    }
  }
  if (bits) { part += alphabet91[value % 91]!; if (bits > 7 || value > 90) part += alphabet91[Math.floor(value / 91)]!; }
  groups.push(part); return adaptiveSchemaPackPrefix + groups.join('');
}
export function decodeAdaptiveSchemaPack(encoded: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Math.floor(encoded.length * 7 / 8) + 1);
  let value = 0, bits = 0, pending = -1, target = 0, consumed = 0, beforeLast = 0, last = 0;
  for (const character of encoded) {
    const digit = alphabet91.indexOf(character);
    if (digit < 0) throw new Error('Invalid compact schema pack character.');
    if (pending < 0) { pending = digit; continue; }
    last = pending + digit * 91; beforeLast = consumed;
    const width = (last & 8191) > 88 ? 13 : 14;
    consumed += width; value |= last << bits; bits += width; pending = -1;
    while (bits >= 8) { bytes[target++] = value & 255; value >>>= 8; bits -= 8; }
  }
  if (pending >= 0) {
    if (!bits || pending >= 2 ** (8 - bits)) throw new Error('Invalid compact schema pack padding.');
    bytes[target++] = (value | pending << bits) & 255;
  } else if (value || encoded.length && target * 8 - beforeLast <= 7 && last <= 90) throw new Error('Invalid compact schema pack padding.');
  return bytes.slice(0, target);
}
