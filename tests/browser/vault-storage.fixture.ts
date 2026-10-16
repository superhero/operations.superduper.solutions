// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Built only by the browser test server, never shipped with the application.
import { createVaultStorage } from "../../src/lib/secrets/storage.ts";
import { VaultSession } from "../../src/lib/secrets/session.ts";
import { approvedOperation } from "../../src/lib/secrets/policy.ts";
import { VaultError, vaultDatabaseName } from "../../src/lib/secrets/types.ts";
import type { ApprovedOperation, CredentialBinding, UnlockProof } from "../../src/lib/secrets/types.ts";
export { createVaultStorage, VaultSession };

export const synthetic = { password: "browser-VAULT-password-9182", bearer: "browser-BEARER-canary-9182",
  apiKey: "browser-APIKEY-canary-9182", label: "browser-PRIVATE-label-9182" };
let session = new VaultSession(createVaultStorage());
let proof: UnlockProof;
let descriptor: ApprovedOperation;
let binding: CredentialBinding;
let controller: AbortController | undefined;
let execution: Promise<unknown> | undefined;

export async function seed(origin: string, run: string, action = "ok", registered?: ApprovedOperation) {
  const recovery = await session.prepareCreate(synthetic.password);
  const status = await session.confirmCreate(recovery);
  proof = { methodId: status.methods.find(method => method.kind === "password")!.id, secret: synthetic.password };
  await session.put(proof, { label: synthetic.label, kind: "bearer", value: synthetic.bearer });
  const credentials = await session.put(proof, { label: "API key account", kind: "apiKey", value: synthetic.apiKey });
  descriptor = registered ?? await approvedOperation({ id: "vault-fixture:request", name: "Fixture request", description: "", group: "Fixture",
    method: "GET", path: `/vault-api/${run}/${action}`, fields: [], bodyRequired: false,
    responseMediaType: ["compressed", "chunked", "slow"].includes(action) ? "text/plain" : "application/json",
    security: [[{ name: "Bearer", kind: "bearer", header: "Authorization" }, { name: "Key", kind: "apiKey", header: "X-Api-Key" }]],
  }, origin);
  const bearer = credentials.find(item => item.kind === "bearer")!, apiKey = credentials.find(item => item.kind === "apiKey")!;
  await session.grant(proof, bearer.id, "Bearer", descriptor);
  await session.grant(proof, apiKey.id, "Key", descriptor);
  binding = { alternative: 0, fingerprint: descriptor.fingerprint, credentials: { Bearer: bearer.id, Key: apiKey.id } };
  return { recovery, status: await session.status(), backup: await session.backup(proof), summaries: await session.list() };
}
export function executionInput() { return { descriptor, binding }; }

export async function run(changed = false) {
  const destination = changed ? await approvedOperation({ ...descriptor.operation, path: "/unapproved" }, descriptor.origin) : descriptor;
  try { return { value: await session.execute(destination, {}, binding) }; }
  catch (error) { return failure(error); }
}
function failure(error: unknown) {
  return { error: error instanceof VaultError ? error.code : (error as Error).name,
    message: (error as Error).message, cause: Object.hasOwn(error as object, "cause") };
}
export function start() {
  controller = new AbortController();
  execution = session.execute(descriptor, {}, binding, controller.signal).then(value => ({ value }), failure);
}
export async function cancel() { controller?.abort(); return execution; }
export async function lockedRun() { session.lock(); return run(); }
export async function backup() { return session.backup(proof); }

export async function restore(input: string, kind: "password" | "recovery", secret: string) {
  session = new VaultSession(createVaultStorage());
  const saved = JSON.parse(input);
  const methodId = saved.envelopes.find((item: { kind: string }) => item.kind === kind).id;
  const status = await session.restore(input, { methodId, secret });
  return { status, summaries: await session.list() };
}

export async function storageFailure(mode: "quota" | "open" | "transaction" | "locks") {
  const storage = createVaultStorage(), before = await storage.read();
  const put = IDBObjectStore.prototype.put, open = IDBFactory.prototype.open, transaction = IDBDatabase.prototype.transaction;
  const locks = Object.getOwnPropertyDescriptor(navigator, "locks");
  if (mode === "quota") IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
    const request = Reflect.apply(put, this, args);
    if (this.transaction.db.name === vaultDatabaseName) {
      this.transaction.abort(); throw new DOMException("PRIVATE QUOTA FAILURE", "QuotaExceededError");
    }
    return request;
  };
  if (mode === "open") IDBFactory.prototype.open = function (name, ...args) {
    if (name === vaultDatabaseName) throw new DOMException("PRIVATE STORAGE FAILURE", "SecurityError");
    return Reflect.apply(open, this, [name, ...args]);
  };
  if (mode === "transaction") IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase["transaction"]>) {
    if (this.name === vaultDatabaseName) throw new DOMException("PRIVATE TRANSACTION FAILURE", "InvalidStateError");
    return Reflect.apply(transaction, this, args);
  };
  if (mode === "locks") Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  let result;
  try { await (mode === "open" || mode === "transaction" ? storage.read() : storage.replace(before, before.snapshot)); result = { error: "unexpected success" }; }
  catch (error) { result = failure(error); }
  finally {
    IDBObjectStore.prototype.put = put; IDBFactory.prototype.open = open; IDBDatabase.prototype.transaction = transaction;
    if (locks) Object.defineProperty(navigator, "locks", locks); else Reflect.deleteProperty(navigator, "locks");
  }
  return { result, unchanged: JSON.stringify(await storage.read()) === JSON.stringify(before) };
}

export async function blockedOpen() {
  const before = await createVaultStorage().read();
  const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(vaultDatabaseName);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  let blocked!: () => void;
  const waiting = new Promise<void>(resolve => { blocked = resolve; });
  const deletion = new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(vaultDatabaseName);
    request.onblocked = blocked; request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  await waiting;
  const started = performance.now();
  let result, unchanged;
  try {
    try { await createVaultStorage().read(); result = { error: "unexpected success" }; }
    catch (error) { result = failure(error); }
    unchanged = await new Promise<boolean>((resolve, reject) => {
      const request = blocker.transaction("vault").objectStore("vault").get("current");
      request.onsuccess = () => resolve(JSON.stringify(request.result) === JSON.stringify(before));
      request.onerror = () => reject(request.error);
    });
  } finally { blocker.close(); await deletion; }
  const elapsed = performance.now() - started;
  // Let the timed-out open receive its late upgrade callback and abort it.
  await new Promise(resolve => setTimeout(resolve, 100));
  return { result, unchanged, elapsed, recreated: (await indexedDB.databases()).some(item => item.name === vaultDatabaseName) };
}

export async function persistedCanaries(canaries: string[]) {
  const found: string[] = [];
  const check = (value: unknown, location: string): void => {
    if (typeof value === "string") { if (canaries.some(canary => value.includes(canary))) found.push(location); }
    else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      check(new TextDecoder().decode(bytes), location);
    } else if (Array.isArray(value)) value.forEach((entry, index) => check(entry, `${location}/${index}`));
    else if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) { check(key, location); check(entry, `${location}/${key}`); }
  };
  for (const [name, storage] of [["localStorage", localStorage], ["sessionStorage", sessionStorage]] as const)
    for (let index = 0; index < storage.length; index++) { const key = storage.key(index)!; check(key, name); check(storage.getItem(key), name); }
  for (const info of await indexedDB.databases()) {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(info.name!); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      for (const name of database.objectStoreNames) await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(name), store = transaction.objectStore(name);
        const values = store.getAll(), keys = store.getAllKeys();
        transaction.oncomplete = () => { check(values.result, `${info.name}/${name}`); check(keys.result, `${info.name}/${name}/keys`); resolve(); };
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { database.close(); }
  }
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) { check(request.url, `cache/${name}`); const response = await cache.match(request); if (response) check(await response.text(), `cache/${name}`); }
  }
  return found;
}
