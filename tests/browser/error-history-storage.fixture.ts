// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Test-server-only access to real IndexedDB; never shipped with the application.
import { closeErrorHistory, readErrors, recordErrors } from "../../src/lib/error-history-storage.ts";
import { errorHistoryDatabaseName } from "../../src/lib/storage-names.ts";
import type { ErrorOccurrence } from "../../src/lib/error-history-types.ts";
export { closeErrorHistory, readErrors, recordErrors };
export { startErrorHistory, subscribeErrorHistory, showErrorHistoryPage, retryErrorHistory, stopErrorHistory } from "../../src/lib/error-history.ts";
export { reportApplicationError } from "../../src/lib/error-diagnostics.ts";

export function occurrence(identity: string, time = 1_000, count = 1): ErrorOccurrence {
  return { identity, origin: { source: "application", scope: "Browser fixture" },
    error: { name: "StorageError", message: `Failure ${identity}`, code: "EXAMPLE", stack: `StorageError: Failure ${identity}\n    at example.ts:4:2`,
      cause: { name: "TypeError", message: "Underlying failure", stack: "TypeError: Underlying failure\n    at source.ts:2:1" } },
    firstSeen: time, lastSeen: time, occurrences: count };
}

export async function clearHistory() {
  closeErrorHistory();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(errorHistoryDatabaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("The fixture's error-history database is still open."));
  });
}

export async function seedHistory(count: number, start = 0) {
  for (let position = start; position < start + count; position += 128)
    await recordErrors(Array.from({ length: Math.min(128, start + count - position) }, (_, index) =>
      occurrence(`unique-${position + index}`, 1_000 + position + index)));
}

export async function notifyHistoryChanged() {
  const channel = new BroadcastChannel("operations-error-history");
  channel.postMessage("updated");
  channel.close();
}

export async function abortWriteBatch() {
  const add = IDBObjectStore.prototype.add;
  let additions = 0;
  IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore["add"]>) {
    if (this.transaction.db.name === errorHistoryDatabaseName && ++additions === 2) {
      this.transaction.abort();
      throw new DOMException("Fixture aborted after the first insertion.", "AbortError");
    }
    return Reflect.apply(add, this, args);
  };
  try {
    await recordErrors([occurrence("rolled-back-first"), occurrence("rolled-back-second")]);
    throw new Error("The fixture failed to abort the transaction.");
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "AbortError") throw error;
    return error.name;
  } finally { IDBObjectStore.prototype.add = add; }
}

export async function abortEviction() {
  const remove = IDBCursor.prototype.delete;
  let deletions = 0;
  IDBCursor.prototype.delete = function () {
    if (this.source instanceof IDBObjectStore && this.source.transaction.db.name === errorHistoryDatabaseName && ++deletions === 2) {
      this.source.transaction.abort();
      throw new DOMException("Fixture aborted after the first eviction.", "AbortError");
    }
    return Reflect.apply(remove, this, []);
  };
  try {
    await recordErrors([occurrence("evicted-new-first"), occurrence("evicted-new-second")]);
    throw new Error("The fixture failed to abort eviction.");
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "AbortError") throw error;
    return error.name;
  } finally { IDBCursor.prototype.delete = remove; }
}

export async function unavailableHistory() {
  closeErrorHistory();
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (name, ...options) {
    if (name === errorHistoryDatabaseName) throw new DOMException("Storage access denied by the browser.", "SecurityError");
    return Reflect.apply(open, this, [name, ...options]);
  };
  try {
    await recordErrors([occurrence("unavailable")]);
    throw new Error("The fixture failed to deny storage access.");
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "SecurityError") throw error;
    return error.name;
  } finally { IDBFactory.prototype.open = open; }
}

export async function blockedHistory() {
  await readErrors();
  closeErrorHistory();
  const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(errorHistoryDatabaseName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  let releaseBlocked: () => void;
  const blocked = new Promise<void>(resolve => { releaseBlocked = resolve; });
  const deletion = new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(errorHistoryDatabaseName);
    request.onblocked = () => releaseBlocked();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  await blocked;
  const started = performance.now();
  let name: string | undefined;
  try { await readErrors(); }
  catch (error) { name = (error as Error).name; }
  const elapsed = performance.now() - started;
  // A second call reuses the failed pending open; it must not queue another request.
  const repeated = await readErrors().then(() => "unexpected success", error => error.name);
  blocker.close();
  await deletion;
  await new Promise(resolve => setTimeout(resolve, 50));
  const leftBehind = (await indexedDB.databases()).some(item => item.name === errorHistoryDatabaseName);
  return { name, elapsed, repeated, leftBehind, recovered: await readErrors() };
}

export async function blockedTransaction() {
  await readErrors();
  const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(errorHistoryDatabaseName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = blocker.transaction("errors", "readwrite");
  let hold = true;
  let acquired: () => void;
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  const completed = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
  const keepAlive = () => {
    const request = transaction.objectStore("errors").get(-1);
    request.onsuccess = () => { acquired(); if (hold) keepAlive(); };
  };
  keepAlive();
  await ready;
  const started = performance.now();
  let name: string | undefined;
  try { await readErrors(); }
  catch (error) { name = (error as Error).name; }
  finally { hold = false; await completed; blocker.close(); }
  return { name, elapsed: performance.now() - started, recovered: await readErrors() };
}
