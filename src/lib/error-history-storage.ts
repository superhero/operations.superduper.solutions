// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { errorHistoryDatabaseName } from "./storage-names.ts";
import { errorHistoryLimit, errorHistoryPageSize, type ErrorHistoryPage, type ErrorHistoryRecord,
  type ErrorOccurrence } from "./error-history-types.ts";

const deadline = 2_500;
let database: IDBDatabase | undefined;
let opening: Promise<IDBDatabase> | undefined;
let cancelOpening: (() => void) | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (database) return Promise.resolve(database);
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(errorHistoryDatabaseName, 1); }
    catch (error) { reject(error); return; }
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => fail(new DOMException("Opening error history timed out.", "TimeoutError")), deadline);
    cancelOpening = () => fail(new DOMException("Opening error history was cancelled.", "AbortError"));
    request.onblocked = () => fail(new DOMException("Another tab is blocking error history.", "InvalidStateError"));
    request.onupgradeneeded = () => {
      // An opening request cannot be cancelled. Do not create a database after
      // its caller has timed out or closed the recorder.
      if (settled) { request.transaction?.abort(); return; }
      const store = request.result.createObjectStore("errors", { keyPath: "id", autoIncrement: true });
      store.createIndex("identity", "identity", { unique: true });
    };
    request.onerror = () => {
      fail(request.error ?? new Error("Could not open error history."));
      opening = undefined;
      cancelOpening = undefined;
    };
    request.onsuccess = () => {
      const connection = request.result;
      clearTimeout(timer);
      opening = undefined;
      cancelOpening = undefined;
      if (settled) { connection.close(); return; }
      settled = true;
      database = connection;
      connection.onversionchange = () => {
        connection.close();
        if (database === connection) database = undefined;
      };
      connection.onclose = () => { if (database === connection) database = undefined; };
      resolve(connection);
    };
  });
  // Synchronous access failures have no native request left in flight.
  const pending = opening;
  void pending.catch(() => { if (!cancelOpening && opening === pending) opening = undefined; });
  return pending;
}

async function transact<T>(mode: IDBTransactionMode,
  run: (store: IDBObjectStore, result: (value: T) => void, guard: (callback: () => void) => () => void) => void): Promise<T> {
  const connection = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = connection.transaction("errors", mode);
    let value: T;
    let failure: unknown;
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const abort = (error: unknown) => {
      failure = error;
      try { transaction.abort(); } catch { /* The transaction already completed. */ }
      finish(error);
    };
    const timer = setTimeout(() => abort(new DOMException("Accessing error history timed out.", "TimeoutError")), deadline);
    transaction.oncomplete = () => finish();
    transaction.onabort = () => finish(failure ?? transaction.error ?? new DOMException("Error history transaction was aborted.", "AbortError"));
    const guard = (callback: () => void) => () => {
      if (settled) return;
      try { callback(); } catch (error) { abort(error); }
    };
    guard(() => run(transaction.objectStore("errors"), next => { value = next; }, guard))();
  });
}

/** One transaction serializes deduplication and FIFO eviction across all tabs. */
export async function recordErrors(batch: ErrorOccurrence[]): Promise<void> {
  if (!Array.isArray(batch) || batch.length > 128) throw new RangeError("Error batches must contain at most 128 entries.");
  for (const entry of batch) {
    if (!entry || typeof entry.identity !== "string" || entry.identity.length === 0 || entry.identity.length > 131_072
      || !Number.isFinite(entry.firstSeen) || !Number.isFinite(entry.lastSeen) || entry.firstSeen > entry.lastSeen
      || !Number.isSafeInteger(entry.occurrences) || entry.occurrences < 1)
      throw new TypeError("Invalid error-history occurrence.");
  }
  if (batch.length === 0) return;
  await transact<void>("readwrite", (store, result, guard) => {
    let position = 0;
    let size = 0;
    const evict = () => {
      if (size <= errorHistoryLimit) { next(); return; }
      const oldest = store.openCursor();
      oldest.onsuccess = guard(() => {
        const cursor = oldest.result;
        if (!cursor) { next(); return; }
        const deletion = cursor.delete();
        deletion.onsuccess = guard(() => {
          size--;
          if (size > errorHistoryLimit) cursor.continue();
          else next();
        });
      });
    };
    const next = () => {
      const entry = batch[position++];
      if (!entry) { result(); return; }
      const lookup = store.index("identity").get(entry.identity);
      lookup.onsuccess = guard(() => {
        const previous = lookup.result as ErrorHistoryRecord | undefined;
        const write = previous ? store.put({ ...previous,
          firstSeen: Math.min(previous.firstSeen, entry.firstSeen),
          lastSeen: Math.max(previous.lastSeen, entry.lastSeen),
          occurrences: Math.min(Number.MAX_SAFE_INTEGER, previous.occurrences + entry.occurrences),
        }) : store.add(entry);
        write.onsuccess = guard(() => {
          if (previous) next();
          else { size++; evict(); }
        });
      });
    };
    const count = store.count();
    count.onsuccess = guard(() => { size = count.result; next(); });
  });
}

/** Newest inserted errors first; repeat occurrences never change FIFO position. */
export async function readErrors(offset = 0, limit = errorHistoryPageSize): Promise<ErrorHistoryPage> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > errorHistoryLimit
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError("Invalid error-history page.");
  return transact<ErrorHistoryPage>("readonly", (store, result, guard) => {
    const page: ErrorHistoryPage = { entries: [], total: 0 };
    result(page);
    const count = store.count();
    count.onsuccess = guard(() => { page.total = count.result; });
    const request = store.openCursor(null, "prev");
    let skipped = offset === 0;
    request.onsuccess = guard(() => {
      const cursor = request.result;
      if (!cursor) return;
      if (!skipped) { skipped = true; cursor.advance(offset); return; }
      page.entries.push(cursor.value as ErrorHistoryRecord);
      if (page.entries.length < limit) cursor.continue();
    });
  });
}

export function closeErrorHistory(): void {
  database?.close();
  database = undefined;
  cancelOpening?.();
}
