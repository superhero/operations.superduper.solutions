// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { logger } from "./logger.ts";

let request: Promise<boolean | null> | undefined;
const listeners = new Set<() => void>();

/** Ask once per application load without delaying startup or storage access. */
export function requestPersistentStorage(): Promise<boolean | null>
{
  request ??= Promise.resolve().then(async () => {
    try
    {
      const storage = globalThis.navigator?.storage;
      if (!storage?.persist) return null;
      const granted = await storage.persist();
      logger.info(granted ? "Persistent storage granted." : "Persistent storage not granted; using best-effort storage.");
      return granted;
    }
    catch (error)
    {
      logger.info(`Could not request persistent storage: ${error instanceof Error ? error.message : String(error)}. Continuing with the current storage mode.`);
      return null;
    }
  }).finally(() => { for (const listener of listeners) listener(); });
  return request;
}

export function onStoragePersistenceSettled(listener: () => void): () => void
{
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
