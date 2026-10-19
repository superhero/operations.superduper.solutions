// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

/** A source-byte budget bounds retention; it is not an estimate of JS heap size.
 * Pending readers share work. An oversized result is returned without retention. */
export function createSchemaCache<T>(budget: number)
{
  const entries = new Map<string, { bytes: number; value: T }>();
  const pending = new Map<string, Promise<T>>();
  let bytes = 0;
  const remove = (key: string) => {
    const entry = entries.get(key);
    if (entry) { bytes -= entry.bytes; entries.delete(key); }
  };
  return {
    async read(key: string, size: number, load: () => Promise<T>): Promise<T> {
      const existing = entries.get(key);
      if (existing) { entries.delete(key); entries.set(key, existing); return existing.value; }
      if (pending.has(key)) return pending.get(key)!;
      const work = Promise.resolve().then(load).then(value => {
        if (pending.get(key) === work && Number.isSafeInteger(size) && size > 0 && size <= budget) {
          while (bytes + size > budget) remove(entries.keys().next().value!);
          entries.set(key, { bytes: size, value }); bytes += size;
        }
        return value;
      }).finally(() => { if (pending.get(key) === work) pending.delete(key); });
      pending.set(key, work);
      return work;
    },
    invalidate(prefix: string): void {
      for (const key of new Set([...entries.keys(), ...pending.keys()])) if (key.startsWith(prefix)) {
        remove(key); pending.delete(key);
      }
    },
    get size() { return entries.size; },
    get bytes() { return bytes; },
  };
}
