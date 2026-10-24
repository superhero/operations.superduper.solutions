// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Built only by the browser test server, never shipped with the application.
import { createVaultStorage } from "../../src/lib/secrets/storage.ts";
import { VaultSession } from "../../src/lib/secrets/session.ts";
import { approvedOperation } from "../../src/lib/secrets/policy.ts";
import { VaultError, vaultDatabaseName } from "../../src/lib/secrets/types.ts";
import { verifyS3Object } from "../../src/lib/secrets/s3-files.ts";
import { encodeWorkflowBinary } from "../../src/lib/workflow-binary.ts";
import { vaultCall, lockVault } from "../../src/lib/secrets/client.ts";
import { defaultProcessingData } from "../../src/lib/workflow-processing.ts";
import type { ApprovedOperation, CredentialBinding, UnlockProof } from "../../src/lib/secrets/types.ts";
export { createVaultStorage, VaultSession };

export async function checkProcessingAssertion() {
  const local = new VaultSession(createVaultStorage());
  const password = "processing-browser-password-synthetic";
  const recovery = await local.prepareCreate(password);
  const status = await local.confirmCreate(recovery);
  const proof = { methodId: status.methods.find(method => method.kind === "password")!.id, secret: password };
  const values = await local.put(proof, { label: "Synthetic processing credential", kind: "secret", value: "private-processing-browser-canary" });
  await vaultCall("unlock", [proof]);
  const expression = { kind: "process" as const, type: "transform" as const, data: defaultProcessingData("transform"), value: { kind: "credential" as const, id: values[0]!.id } };
  const predicate = defaultProcessingData("assert");
  predicate.parameters.operator = "starts_with";
  predicate.parameters.expected = "cHJp";
  const matched = await vaultCall("checkAssertion", [expression, predicate]);
  predicate.parameters.expected = "different";
  const unmatched = await vaultCall("checkAssertion", [expression, predicate]);
  const jwt = { kind: "process" as const, type: "transform" as const, data: defaultProcessingData("transform", "jwt_sign"),
    value: { kind: "literal" as const, value: { sub: "subject" } }, key: { kind: "literal" as const, value: "01234567890123456789012345678901" },
    parameters: { key_id: { kind: "credential" as const, id: values[0]!.id } } };
  jwt.data.parameters.key_id = "manual-id";
  predicate.parameters.expected = btoa(JSON.stringify({ alg: "HS256", typ: "JWT", kid: "private-processing-browser-canary" })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") + ".";
  const jwtKeyId = await vaultCall("checkAssertion", [jwt, predicate]);
  predicate.parameters.expected = btoa(JSON.stringify({ alg: "HS256", typ: "JWT", kid: "manual-id" })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") + ".";
  const manualKeyId = await vaultCall("checkAssertion", [jwt, predicate]);
  await lockVault();
  return { matched, unmatched, jwtKeyId, manualKeyId };
}

export const synthetic = { password: "browser-VAULT-password-9182", bearer: "browser-BEARER-canary-9182",
  apiKey: "browser-APIKEY-canary-9182", label: "browser-PRIVATE-label-9182", bot: "123456789:browser_TELEGRAM_canary_9182" };
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
export async function seedTelegram(origin: string, run: string) {
  await seed(origin, run);
  const entries = await session.put(null, { label: "Telegram bot fixture", kind: "secret", value: synthetic.bot });
  return entries.find(item => item.label === "Telegram bot fixture")!.id;
}

export async function seedOAuth1(origin: string, run: string) {
  await seed(origin, run);
  for (const part of ["consumerKey", "consumerSecret", "accessToken", "tokenSecret"]) {
    await session.put(null, { label: "X fixture " + part, kind: "secret", value: "browser_X_" + part + "_canary_5729" });
  }
}

export async function seedAWS(origin: string, run: string, values: Record<string, string>) {
  await seed(origin, run);
  for (const [part, value] of Object.entries(values))
    await session.put(null, { label: "AWS " + part, kind: "secret", value });
}

/** Native browser CORS only; production-worker authority has separate UI cases. */
export async function probeS3Cors(address: string, request: { method: string; headers: Record<string, string>; bytes?: number[] }) {
  try {
    const body = Uint8Array.from(request.bytes ?? []);
    const response = await fetch(address, { method: request.method, headers: request.headers, ...(request.method === "PUT" ? { body } : {}),
      credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    const bytes = new Uint8Array(await response.arrayBuffer());
    let error: string | undefined;
    try { await verifyS3Object(response.headers, encodeWorkflowBinary("cors.bin", request.method === "PUT" ? body : bytes)); }
    catch (cause) { error = cause instanceof VaultError ? cause.code : "UNEXPECTED"; }
    return { status: response.status, verified: error === undefined, error, etag: response.headers.get("ETag"),
      checksum: response.headers.get("x-amz-checksum-sha256"), bytes: Array.from(bytes) };
  } catch (cause) { return { error: (cause as Error).name }; }
}

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
