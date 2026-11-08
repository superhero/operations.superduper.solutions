// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from '../native-runtime-contract.ts';
import { nativeReference, validateNativeReference, type NativeRuntimeReference } from './native-runtime-config.ts';
import { VaultError } from './types.ts';

export type NativeReferenceTransition = { before: NativeRuntimeReference; after: NativeRuntimeReference };
const key = (value: NativeRuntimeReference) => value.revision + ':' + value.fingerprint;

/** Client convenience for exact references observed in owned worker replies.
 * The worker still requires the current reference and never accepts aliases. */
export class NativeReferenceContinuations {
  private readonly connections = new Map<string, { current: NativeRuntimeReference; previous: Set<string> }>();
  clear(id?: string): void { if (id) this.connections.delete(id); else this.connections.clear(); }
  resolve(input: unknown): NativeRuntimeReference {
    const reference = validateNativeReference(input), known = this.connections.get(reference.id);
    return known && (key(known.current) === key(reference) || known.previous.has(key(reference))) ? nativeReference(known.current) : reference;
  }
  accept(submitted: NativeRuntimeReference, input: unknown): NativeReferenceTransition {
    const fields = nativeObject(input, ['before', 'after']), before = validateNativeReference(fields.before), after = validateNativeReference(fields.after);
    const known = this.connections.get(before.id);
    if (before.id !== submitted.id || key(before) !== key(submitted) || after.id !== before.id
      || !(after.revision === before.revision && after.fingerprint === before.fingerprint
        || after.revision === before.revision + 1 && after.fingerprint !== before.fingerprint)
      || known && key(known.current) !== key(before)) throw new VaultError('AUTHORIZATION');
    if (after.revision !== before.revision) {
      const state = known ?? { current: before, previous: new Set<string>() };
      state.previous.add(key(before)); state.current = after;
      // Retain the original workflow binding and the latest 127 predecessors.
      if (state.previous.size > 128) state.previous.delete([...state.previous][1]!);
      this.connections.set(before.id, state);
      if (this.connections.size > 32) this.connections.delete(this.connections.keys().next().value!);
    }
    return { before, after };
  }
}
