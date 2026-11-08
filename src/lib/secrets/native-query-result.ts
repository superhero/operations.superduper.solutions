// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject, nativeRuntimeLimits } from '../native-runtime-contract.ts';
import { VaultError } from './types.ts';

type Schema = Record<string, unknown>;
const object = (v: unknown): v is Schema => !!v && typeof v === 'object' && !Array.isArray(v);
const keywords = new Set(['$ref', '$schema', 'title', 'description', 'default', 'deprecated', 'examples', 'readOnly', 'writeOnly',
  'type', 'enum', 'const', 'format', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems',
  'minProperties', 'maxProperties', 'properties', 'required', 'additionalProperties', 'items', 'oneOf', 'anyOf', 'allOf']);
const invalid = (): never => { throw new VaultError('NATIVE_CONTRACT'); };
/** Validate the reviewed metadata vocabulary against its exact scoped source.
 * Objects are closed unless a typed dictionary explicitly classifies extra keys.
 * Nothing is stripped or coerced, and untyped JSON cannot publish private data. */
export function validateNativeQueryResult(value: unknown, schema: unknown, document: Schema, allowJsonValues = false): unknown {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > nativeRuntimeLimits.frame) throw new VaultError('LIMIT');
  let nodes = 0;
  function json(input: unknown, depth: number): void {
    if (++nodes > 16_384 || depth > 48) throw new VaultError('LIMIT');
    if (input === null || typeof input === 'boolean' || typeof input === 'number' && Number.isFinite(input)) return;
    if (typeof input === 'string' && input.isWellFormed()) return;
    if (Array.isArray(input)) { for (const item of input) json(item, depth + 1); return; }
    if (object(input)) { nativeObject(input, Object.keys(input)); for (const [key, item] of Object.entries(input)) {
      if (!key.isWellFormed()) return invalid(); json(item, depth + 1);
    } return; }
    return invalid();
  }
  function check(input: unknown, raw: unknown, inherited = new Set<string>(), depth = 0): Set<string> {
    if (++nodes > 16_384 || depth > 48) throw new VaultError('LIMIT');
    if (allowJsonValues && raw === true) { json(input, depth + 1); return new Set(); }
    if (!object(raw) || Object.keys(raw).some(k => !keywords.has(k)) || raw.writeOnly === true) return invalid();
    const properties = object(raw.properties) ? raw.properties : {};
    const known = new Set([...inherited, ...Object.keys(properties)]);
    let classified = raw.type !== undefined || raw.properties !== undefined || raw.enum !== undefined || Object.hasOwn(raw, 'const');
    if (raw.$ref !== undefined) {
      if (typeof raw.$ref !== 'string' || !raw.$ref.startsWith('#/definitions/') || /~(?:[^01]|$)/.test(raw.$ref)) return invalid();
      let target: unknown = document;
      for (const part of raw.$ref.slice(2).split('/')) target = object(target) && Object.hasOwn(target, part.replace(/~1/g, '/').replace(/~0/g, '~'))
        ? target[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined;
      for (const key of check(input, target, known, depth + 1)) known.add(key);
      classified = true;
    }
    for (const kind of ['allOf', 'anyOf', 'oneOf'] as const) if (raw[kind] !== undefined) {
      const branches = raw[kind];
      if (!Array.isArray(branches) || !branches.length || branches.length > 32) return invalid();
      const matches: Set<string>[] = [];
      for (const branch of branches) {
        try { matches.push(check(input, branch, known, depth + 1)); }
        catch (error) { if (!(error instanceof VaultError) || error.code !== 'NATIVE_CONTRACT' || kind === 'allOf') throw error; }
      }
      if (kind === 'oneOf' ? matches.length !== 1 : kind === 'anyOf' ? !matches.length : matches.length !== branches.length) return invalid();
      for (const match of matches) for (const key of match) known.add(key);
      classified = true;
    }
    if (!classified) { if (!allowJsonValues) return invalid(); json(input, depth + 1); return known; }
    if (raw.type !== undefined) {
      const types = Array.isArray(raw.type) ? raw.type : [raw.type];
      const matches = (type: unknown) => type === 'null' ? input === null : type === 'object' ? object(input)
        : type === 'array' ? Array.isArray(input) : type === 'integer' ? Number.isSafeInteger(input)
          : type === 'number' ? typeof input === 'number' && Number.isFinite(input) : ['string', 'boolean'].includes(String(type)) && typeof input === type;
      if (!types.some(matches)) return invalid();
    }
    if (raw.enum !== undefined && (!Array.isArray(raw.enum) || !raw.enum.some(v => v === input)) || Object.hasOwn(raw, 'const') && raw.const !== input) return invalid();
    if (typeof input === 'string' && (!input.isWellFormed() || typeof raw.minLength === 'number' && [...input].length < raw.minLength
      || typeof raw.maxLength === 'number' && [...input].length > raw.maxLength)) return invalid();
    if (typeof input === 'number' && (!Number.isFinite(input) || typeof raw.minimum === 'number' && input < raw.minimum
      || typeof raw.maximum === 'number' && input > raw.maximum || typeof raw.format === 'string' && /^u?int/.test(raw.format)
        && (!Number.isSafeInteger(input) || raw.format.startsWith('u') && input < 0 || raw.format === 'uint32' && input > 0xffffffff))) return invalid();
    if (Array.isArray(input)) {
      if (typeof raw.minItems === 'number' && input.length < raw.minItems || typeof raw.maxItems === 'number' && input.length > raw.maxItems) return invalid();
      if (raw.items !== undefined) for (const item of input) check(item, raw.items, undefined, depth + 1);
      else if (raw.type === 'array') return invalid();
    }
    if (object(input)) {
      nativeObject(input, Object.keys(input));
      const names = Object.keys(input);
      if (typeof raw.minProperties === 'number' && names.length < raw.minProperties || typeof raw.maxProperties === 'number' && names.length > raw.maxProperties) return invalid();
      if (raw.required !== undefined && (!Array.isArray(raw.required) || raw.required.some(k => typeof k !== 'string' || !Object.hasOwn(input, k)))) return invalid();
      for (const name of names) {
        if (Object.hasOwn(properties, name)) check(input[name], properties[name], undefined, depth + 1);
        else if (!known.has(name)) {
          if (!object(raw.additionalProperties)) return invalid();
          check(input[name], raw.additionalProperties, undefined, depth + 1);
        }
      }
    }
    return known;
  }
  try { check(value, schema); return structuredClone(value); }
  catch (error) { throw error instanceof VaultError ? error : new VaultError('NATIVE_CONTRACT'); }
}
