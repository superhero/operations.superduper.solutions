// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Test-only adapter: exercise the production worker and authoritative schema DB.
import VaultWorker from "../../src/lib/secrets/vault.worker.ts?worker&inline";
import { deleteSchemaDocument, loadSchemaDocuments, putSchemaDocument, setSchemaDocumentEnabled } from "../../src/lib/schema-storage.ts";
import { validateSchemaDocument, type SchemaDocumentRecord } from "../../src/lib/schema-documents.ts";
import { assertCurrentSchema } from "../../src/lib/secrets/schema-policy-storage.ts";
import { approvedOperation } from "../../src/lib/secrets/policy.ts";
import { catalogsIndexDatabaseName } from "../../src/lib/storage-names.ts";
import { seed, synthetic, executionInput } from "./vault-storage.fixture.ts";
import type { ApprovedOperation } from "../../src/lib/secrets/types.ts";
import { vaultCall, lockVault, replyNativeCommand } from "../../src/lib/secrets/client.ts";
import { httpConnectionReference } from "../../src/lib/secrets/http-connections.ts";
import { createVaultStorage } from "../../src/lib/secrets/storage.ts";
import type { ResponseProgress } from "../../src/lib/workflow-response-stream.ts";
import { loadSchemaLibrary } from '../../src/lib/schema-library.ts';
import { nativeOperationSelection, nativeRuntimeSelection, nativeWorkflowSelection } from '../../src/lib/secrets/native-runtime-client.ts';
import { nativeReference } from '../../src/lib/secrets/native-runtime-config.ts';
import { nativeFilesystemWatchMethods, type NativeFilesystemWatchValue } from '../../src/lib/native-filesystem-watch.ts';
import { nativeCommandMethods, type NativeCommandValue, type NativeCommandProgress } from '../../src/lib/native-command.ts';
import type { VaultArguments } from '../../src/lib/secrets/protocol.ts';

type WatchArgs = VaultArguments<'executeNativeWatch'>;
let watchBase: [WatchArgs[0], WatchArgs[1], WatchArgs[2]];
const watchJobs = new Map<string, { controller: AbortController; values: NativeFilesystemWatchValue[]; completion: Promise<unknown>; settled: boolean; failure: string | null }>();
export async function privateNativeGatewayAuthentication() {
  await loadSchemaLibrary();
  const password = (await vaultCall('status', [])).methods.find(item => item.kind === 'password');
  if (!password) throw new Error('Missing owned browser password method.');
  await vaultCall('unlock', [{ methodId: password.id, secret: 'browser-VAULT-password-9182' }]);
  try {
    const connection = (await vaultCall('nativeConnections', [])).find(item => item.label === 'Codex');
    if (!connection) throw new Error('Missing paired gateway runtime.');
    const original = nativeReference(connection), selections = await nativeWorkflowSelection();
    const select = (method: string) => { const found = selections.find(item => item.operation.rpc?.method === method); if (!found) throw new Error('Missing gateway method.'); return found; };
    const failures = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      let accept!: () => void;
      const notice = new Promise<void>(resolve => { accept = resolve; });
      const pending = vaultCall('executeNativeRuntime', [original, selections, select('account/gatewayOAuth/login'), {}], undefined, undefined,
        progress => { if (progress.kind === 'gateway-login') accept(); });
      void pending.catch(() => {});
      await Promise.race([notice, pending.then(() => { throw new Error('Unexpected gateway completion.'); })]);
      await vaultCall('cancelNativeGatewayLogin', [original, selections, select('account/gatewayOAuth/cancel'), {}]);
      failures.push(await pending.then(() => 'unexpected-success', error => error.code));
    }
    const current = (await vaultCall('nativeConnections', [])).find(item => item.id === original.id);
    if (!current) throw new Error('Missing gateway runtime after cancellation.');
    return { original, current: nativeReference(current), failures };
  } finally { await lockVault(); }
}
export async function privateNativeAccountAuthentication() {
  await loadSchemaLibrary();
  const password = (await vaultCall('status', [])).methods.find(item => item.kind === 'password');
  if (!password) throw new Error('Missing owned browser password method.');
  await vaultCall('unlock', [{ methodId: password.id, secret: 'browser-VAULT-password-9182' }]);
  try {
    const connection = (await vaultCall('nativeConnections', [])).find(item => item.label === 'Codex');
    if (!connection) throw new Error('Missing paired authentication runtime.');
    const credential = (await vaultCall('keys', [])).entries.find(item => item.label === 'browser-PRIVATE-label-9182');
    if (!credential) throw new Error('Missing saved owned sign-in key.');
    const original = nativeReference(connection), selections = await nativeWorkflowSelection();
    const select = (method: string) => { const found = selections.find(item => item.operation.rpc?.method === method); if (!found) throw new Error('Missing account method.'); return found; };
    const signedIn = (await vaultCall('executeNativeRuntime', [original, selections, select('account/login/start'), { type: 'apiKey', credentialId: credential.id }])).response.result as { account: { type: string } };
    await vaultCall('executeNativeRuntime', [original, selections, select('account/logout'), {}]);
    let accept!: (notice: Extract<import('../../src/lib/native-agent-contract.ts').NativeAgentProgress, { kind: 'login' }>) => void;
    const notice = new Promise<Extract<import('../../src/lib/native-agent-contract.ts').NativeAgentProgress, { kind: 'login' }>>(resolve => { accept = resolve; });
    const pending = vaultCall('executeNativeRuntime', [original, selections, select('account/login/start'), { type: 'chatgpt' }], undefined, undefined,
      progress => { if (progress.kind === 'login') accept(progress); });
    void pending.catch(() => {});
    const login = await notice;
    const cancelled = (await vaultCall('cancelNativeAccountLogin', [original, selections, select('account/login/cancel'), { loginId: login.loginId }])).response.result as { status: string };
    const failure = await pending.then(() => 'unexpected-success', error => error.code);
    const current = (await vaultCall('nativeConnections', [])).find(item => item.id === original.id);
    if (!current) throw new Error('Missing confirmed runtime reference.');
    return { original, current: nativeReference(current), signedIn: signedIn.account.type, signedOut: current.accountType, cancelled: cancelled.status, failure };
  } finally { await lockVault(); }
}
export async function privateNativeMigrationContinuation() {
  await loadSchemaLibrary();
  const password = (await vaultCall('status', [])).methods.find(item => item.kind === 'password');
  if (!password) throw new Error('Missing owned browser password method.');
  await vaultCall('unlock', [{ methodId: password.id, secret: 'browser-VAULT-password-9182' }]);
  try {
    const connection = (await vaultCall('nativeConnections', [])).find(item => item.label === 'Codex');
    if (!connection) throw new Error('Missing paired migration runtime.');
    const original = nativeReference(connection), selections = await nativeWorkflowSelection();
    const execute = async (method: string, params: unknown) => {
      const selection = selections.find(item => item.operation.rpc?.method === method);
      if (!selection) throw new Error('Missing migration workflow model.');
      return vaultCall('executeNativeRuntime', [original, selections, selection, params]);
    };
    const detected = (await execute('externalAgentConfig/detect', { includeHome: true })).response.result as { items: { itemType: string }[] };
    const imported = (await execute('externalAgentConfig/import', { migrationItems: detected.items.filter(item => ['AGENTS_MD', 'CONFIG'].includes(item.itemType)) })).response.result as { importId: string };
    const history = (await execute('externalAgentConfig/import/readHistories', {})).response.result as { data: { importId: string }[] };
    const recorded = (await execute('externalAgentConfig/import/recordHistory', { providerId: 'owned-browser-history', itemTypeResults: [] })).response.result as { importId: string };
    const current = (await vaultCall('nativeConnections', [])).find(item => item.id === original.id);
    if (!current) throw new Error('The adopted migration pairing disappeared.');
    return { original, current: nativeReference(current), importId: imported.importId, recordedId: recorded.importId, historyIds: history.data.map(row => row.importId) };
  } finally { await lockVault(); }
}
export async function privateNativeConfigurationContinuation() {
  await loadSchemaLibrary();
  const status = await vaultCall('status', []), password = status.methods.find(item => item.kind === 'password');
  if (!password) throw new Error('Missing owned browser password method.');
  await vaultCall('unlock', [{ methodId: password.id, secret: 'browser-VAULT-password-9182' }]);
  try {
    const connection = (await vaultCall('nativeConnections', [])).find(item => item.label === 'Codex');
    if (!connection) throw new Error('Missing paired configuration runtime.');
    const original = nativeReference(connection), selections = await nativeWorkflowSelection();
    const execute = async (method: string, params: unknown) => {
      const selection = selections.find(item => item.operation.rpc?.method === method);
      if (!selection) throw new Error('Missing configuration workflow model.');
      // Keep passing the original reference: only verified worker sidebands may
      // advance the client reference sent by each later workflow node.
      return vaultCall('executeNativeRuntime', [original, selections, selection, params]);
    };
    await execute('config/value/write', { keyPath: 'model', value: 'browser-owned-config-model', mergeStrategy: 'replace' });
    await execute('config/batchWrite', { edits: [{ keyPath: 'model_verbosity', value: 'low', mergeStrategy: 'replace' }] });
    await execute('skills/config/write', { name: 'owned-configuration-skill', enabled: false });
    const control = await execute('config/mcpServer/reload', {}), read = await execute('config/read', {});
    const current = (await vaultCall('nativeConnections', [])).find(item => item.id === original.id);
    if (!current) throw new Error('The adopted pairing disappeared.');
    return { original, current: nativeReference(current), control: control.response.result, read: read.response.result };
  } finally { await lockVault(); }
}
export async function startPrivateNativeWatches() {
  await loadSchemaLibrary();
  const status = await vaultCall('status', []), method = status.methods.find(item => item.kind === 'password');
  if (!method) throw new Error('The owned browser vault is missing its password method.');
  await vaultCall('unlock', [{ methodId: method.id, secret: 'browser-VAULT-password-9182' }]);
  const connections = await vaultCall('nativeConnections', []), connection = connections.find(item => item.label === 'Codex');
  if (!connection) throw new Error('The browser runtime was not paired.');
  // Hydration publishes schema policy through the authoritative model worker.
  watchBase = [nativeReference(connection), await nativeRuntimeSelection(), await Promise.all(nativeFilesystemWatchMethods.map(nativeOperationSelection))];
  for (const id of ['browser-first', 'browser-second']) {
    const job = { controller: new AbortController(), values: [] as NativeFilesystemWatchValue[], completion: undefined! as Promise<unknown>, settled: false, failure: null as string | null };
    job.completion = vaultCall('executeNativeWatch', [...watchBase, { watchId: id, path: '.' }], job.controller.signal,
      undefined, undefined, undefined, value => job.values.push(value))
      .then(value => { job.settled = true; return value; }, error => { job.settled = true; job.failure = (error as { code?: string }).code ?? 'UNEXPECTED'; return { error: job.failure }; });
    watchJobs.set(id, job);
  }
  return true;
}
export const privateNativeWatchState = () => [...watchJobs].map(([id, job]) => ({ id, values: job.values, settled: job.settled, failure: job.failure }));
export async function cancelPrivateNativeWatch() {
  const job = watchJobs.get('browser-first')!; job.controller.abort(); return job.completion;
}
export async function privateNativeWatchMetadata() {
  return (await vaultCall('nativeConnections', [])).map(connection => connection.label);
}
export async function stopPrivateNativeWatch() {
  const response = await vaultCall('executeNativeUnwatch', [...watchBase, { watchId: 'browser-second' }]);
  const watch = await watchJobs.get('browser-second')!.completion; await lockVault(); return { response, watch };
}

type CommandArgs = VaultArguments<'executeNativeCommand'>;
let commandBase: [CommandArgs[0], CommandArgs[1], CommandArgs[2]];
const commandJobs = new Map<string, { controller: AbortController; notices: NativeCommandProgress[]; values: NativeCommandValue[]; completion: Promise<unknown>; settled: boolean; failure: string | null }>();
export async function startPrivateNativeCommands() {
  await loadSchemaLibrary();
  const status = await vaultCall('status', []), method = status.methods.find(item => item.kind === 'password');
  if (!method) throw new Error('Missing owned password method.');
  await vaultCall('unlock', [{ methodId: method.id, secret: 'browser-VAULT-password-9182' }]);
  const connection = (await vaultCall('nativeConnections', [])).find(item => item.label === 'Codex'); if (!connection) throw new Error('Missing paired command runtime.');
  commandBase = [nativeReference(connection), await nativeRuntimeSelection(), await Promise.all(nativeCommandMethods.map(nativeOperationSelection))];
  for (const id of ['browser-first', 'browser-second']) {
    const job = { controller: new AbortController(), notices: [] as NativeCommandProgress[], values: [] as NativeCommandValue[], completion: undefined! as Promise<unknown>, settled: false, failure: null as string | null };
    job.completion = vaultCall('executeNativeCommand', [...commandBase, { command: ['/bin/cat'], processId: id, streamStdin: true, streamStdoutStderr: true }], job.controller.signal,
      undefined, notice => { if (notice.kind === 'command-approval') job.notices.push(notice); }, undefined, undefined, value => job.values.push(value))
      .then(value => { job.settled = true; return value; }, error => { job.settled = true; job.failure = (error as { code?: string }).code ?? 'UNEXPECTED'; return { error: job.failure }; });
    commandJobs.set(id, job);
  }
  return true;
}
export const privateNativeCommandState = () => [...commandJobs].map(([id, job]) => ({ id, notices: job.notices, values: job.values, settled: job.settled, failure: job.failure }));
export function approvePrivateNativeCommands() {
  for (const job of commandJobs.values()) replyNativeCommand(commandBase[0].id, job.notices[0]!.token, 'accept'); return true;
}
export async function writePrivateNativeCommand() {
  return vaultCall('controlNativeCommand', [...commandBase, 'command/exec/write', { processId: 'browser-second', deltaBase64: btoa('Owned browser command bytes\n') }]);
}
export async function cancelPrivateNativeCommand() { const job = commandJobs.get('browser-first')!; job.controller.abort(); return job.completion; }
export async function stopPrivateNativeCommands() {
  const control = await vaultCall('controlNativeCommand', [...commandBase, 'command/exec/terminate', { processId: 'browser-second' }]);
  const terminal = await commandJobs.get('browser-second')!.completion; await lockVault(); return { control, terminal };
}

let record: SchemaDocumentRecord;
let descriptor: ApprovedOperation;
let worker: Worker;
let sequence = 0;
let lastReply: unknown;
const replies = new Map<number, { resolve: (result: unknown) => void; reject: (error: unknown) => void }>();
function call(method: string, args: unknown[]) {
  const id = ++sequence;
  return new Promise((resolve, reject) => { replies.set(id, { resolve, reject }); worker.postMessage({ id, method, args }); });
}
async function catalog(write: boolean, run: (transaction: IDBTransaction) => void) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(catalogsIndexDatabaseName);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try { await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(["state", "pending", "removed", "catalog", "policies"], write ? "readwrite" : "readonly");
    run(transaction); transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
  }); } finally { db.close(); }
}
export async function setup(origin: string, run: string, action = "ok") {
  const id = `vault-${crypto.randomUUID()}`;
  const path = `/vault-api/${run}/${action}`;
  const document = { openapi: "3.1.0", info: { title: "Vault browser fixture", version: "1.0.0" }, servers: [{ url: origin }],
    components: { securitySchemes: { Bearer: { type: "http", scheme: "bearer" }, Key: { type: "apiKey", in: "header", name: "X-Api-Key" } } },
    paths: { [path]: { get: { operationId: "secured", summary: "Secured fixture", security: [{ Bearer: [], Key: [] }],
      ...(action === "stream" ? { "x-operations-response-stream": "openai-responses" } : {}),
      ...(action === "field-limit" ? { parameters: [{ in: "query", name: "field-" + "f".repeat(20 * 1024), required: true, schema: { type: "string" } }] } : {}),
      responses: { "200": { description: "Result", content: { "application/json": { schema: { type: "object" } },
        ...(action === "stream" ? { "text/event-stream": { schema: { type: "object" } } } : {}) } } } } } } };
  record = { id, file: "vault.json", document, enabled: true, createdAt: Date.now(), updatedAt: Date.now() };
  await loadSchemaDocuments(); await putSchemaDocument(record);
  descriptor = await approvedOperation(validateSchemaDocument(document, id).operations[0]!, origin);
  await assertCurrentSchema(descriptor);
  const seeded = await seed(origin, run, "ok", descriptor);
  worker = new VaultWorker({ name: "vault-policy-browser-test" });
  worker.onmessage = ({ data }) => {
    lastReply = data;
    if ("event" in data) { for (const pending of replies.values()) pending.reject(new Error("Worker unexpectedly locked")); replies.clear(); return; }
    const pending = replies.get(data.id); if (!pending) return; replies.delete(data.id);
    if (data.ok) pending.resolve(data.value); else pending.reject(Object.assign(new Error("Safe worker refusal"), { code: data.error.code }));
  };
  worker.onerror = () => { for (const pending of replies.values()) pending.reject(new Error("Worker failed")); replies.clear(); };
  await call("unlock", [{ methodId: seeded.status.methods.find(method => method.kind === "password")!.id, secret: synthetic.password }]);
  return { descriptor, status: seeded.status };
}
export async function execute() {
  const { binding } = executionInput();
  try { return { value: await call("execute", [descriptor, {}, binding]) }; }
  catch (error) { return { error: (error as { code?: string }).code ?? "UNEXPECTED" }; }
}
export async function streamedClient(origin: string, run: string) {
  const configured = await setup(origin, run, "stream");
  worker.terminate();
  const method = configured.status.methods.find(method => method.kind === "password")!;
  const progress: ResponseProgress[] = [];
  try {
    await vaultCall("unlock", [{ methodId: method.id, secret: synthetic.password }]);
    const { binding } = executionInput();
    const value = await vaultCall("execute", [descriptor, {}, binding], undefined, item => progress.push(item));
    return { value, progress };
  } finally { await lockVault(); }
}
export async function connectionRoundtrip(origin: string, run: string) {
  const configured = await setup(origin, run);
  const { binding } = executionInput();
  const saved = await call("putConnection", [{ label: "Worker connection", account: "Network account", format: "schema" }, descriptor, binding]) as import("../../src/lib/secrets/types.ts").HttpConnection;
  const reference = httpConnectionReference(saved);
  const selected = await call("connectionBinding", [reference, descriptor]);
  const first = await call("execute", [descriptor, {}, selected]);
  worker.terminate();
  const method = configured.status.methods.find(method => method.kind === "password")!;
  const proof = { methodId: method.id, secret: synthetic.password };
  try {
    await vaultCall("unlock", [proof]);
    const profiles = await vaultCall("connections", []);
    const restored = await vaultCall("connectionBinding", [reference, descriptor]);
    const second = await vaultCall("execute", [descriptor, {}, restored]);
    const edited = await vaultCall("putConnection", [{ label: saved.label, account: "Changed network account", format: "schema", reference }, descriptor, binding]);
    let stale = "UNEXPECTED";
    try { await vaultCall("execute", [descriptor, {}, restored]); } catch (error) { stale = (error as { code: string }).code; }
    const current = await vaultCall("connectionBinding", [httpConnectionReference(edited), descriptor]);
    await setSchemaDocumentEnabled(record.id, false);
    await vaultCall("unlock", [proof]);
    let disabled = "UNEXPECTED";
    try { await vaultCall("execute", [descriptor, {}, current]); } catch (error) { disabled = (error as { code: string }).code; }
    const stored = JSON.stringify(await createVaultStorage().read());
    return { first, second, selected, restored, profiles, edited, stale, disabled, encryptedMetadata: !stored.includes(saved.label) && !stored.includes(saved.account) };
  } finally { await lockVault(); }
}
export async function diagnostic() { await execute(); return lastReply; }
export async function mutate(mode: string) {
  if (mode === "replacement") {
    const next = structuredClone(record);
    const paths = next.document.paths as Record<string, { get: { description?: string } }>;
    paths[descriptor.operation.path]!.get.description = "The operation changed while keeping its identity.";
    await putSchemaDocument(next);
  } else if (mode === "disabled") await setSchemaDocumentEnabled(record.id, false);
  else if (mode === "deleted") {
    await setSchemaDocumentEnabled(record.id, false);
    await deleteSchemaDocument(record.id);
  }
  else if (mode === "pending" || mode === "removed") await catalog(true, tx => { tx.objectStore(mode).put(true, record.id); });
  else if (mode === "legacy") await catalog(true, tx => { tx.objectStore("policies").delete(record.id); });
  else throw new Error("Unknown fixture transition");
}
export async function backfill() { await loadSchemaDocuments(); return execute(); }
export async function absentDatabase() {
  const before = (await indexedDB.databases()).map(item => item.name);
  const unknown = await approvedOperation({ id: "absent:secured", name: "Absent", description: "", group: "Fixture",
    method: "GET", path: "/secured", fields: [], bodyRequired: false,
    security: [[{ name: "Bearer", kind: "bearer", header: "Authorization" }]] }, "https://example.test");
  let error;
  try { await assertCurrentSchema(unknown); error = "unexpected success"; }
  catch (failure) { error = (failure as { code: string }).code; }
  return { error, before, after: (await indexedDB.databases()).map(item => item.name) };
}


/** Exercise variable transport through the real worker without authentication schemes. */
export async function publicVariable(backfillLegacy = false) {
  const next = structuredClone(record);
  const operation = (next.document.paths as Record<string, { get: { security: unknown[]; parameters?: unknown[] } }>)[descriptor.operation.path]!.get;
  operation.security = [];
  operation.parameters = [{ in: "header", name: "X-Vault-Variable", required: true, schema: { type: "string" } }];
  record = next;
  await putSchemaDocument(record);
  descriptor = await approvedOperation(validateSchemaDocument(record.document, record.id).operations[0]!, descriptor.origin);
  const { binding } = executionInput();
  const variables = [{ key: "header:X-Vault-Variable", path: [], credentialId: binding.credentials.Bearer }];
  const execute = () => call("execute", [descriptor, { "header:X-Vault-Variable": "[Vault variable]" },
    { alternative: 0, credentials: {}, fingerprint: descriptor.fingerprint }, undefined, variables]);
  let before;
  if (backfillLegacy) {
    await catalog(true, tx => {
      const request = tx.objectStore("policies").get(record.id);
      request.onsuccess = () => {
        const policy = request.result;
        delete policy.version;
        policy.fingerprints = [];
        tx.objectStore("policies").put(policy, record.id);
      };
    });
    try { await execute(); before = "unexpected success"; }
    catch (error) { before = (error as { code?: string }).code; }
    await loadSchemaDocuments();
  }
  const value = await execute();
  return { before, value };
}

export async function factoryPolicy() {
  const digest = "a".repeat(64);
  const set = async (revision: string) => catalog(true, tx => {
    const metadata = tx.objectStore("catalog");
    const read = metadata.get(record.id);
    read.onsuccess = () => metadata.put({ ...read.result, factoryDigest: digest }, record.id);
    tx.objectStore("policies").put({ revision, fingerprints: [descriptor.fingerprint] }, record.id);
  });
  await set(digest);
  await assertCurrentSchema(descriptor);
  await set("b".repeat(64));
  try { await assertCurrentSchema(descriptor); return "unexpected success"; }
  catch (error) { return (error as { code: string }).code; }
}
