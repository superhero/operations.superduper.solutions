// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import LightningFS from "@isomorphic-git/lightning-fs";
import { Buffer } from "buffer";
import * as git from "isomorphic-git";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { loadWorkflowDocuments, validateWorkflowDocument, workflowStorageKey, type WorkflowDocument } from "./workflow-document.ts";
import { describeWorkflowChange } from "./workflow-change-message.ts";
import type { StorageCommit, WorkflowStorageEntry, WorkflowStorageMetrics } from "./storage-metrics-types.d.ts";

// The isomorphic-git ESM build expects the browser Buffer polyfill.
if (!("Buffer" in globalThis)) Object.defineProperty(globalThis, "Buffer", { value: Buffer, configurable: true, writable: true });

export const workflowRepositoryDatabaseName = "operations-workflow-catalog-v1";
export const workflowFilesystemName = "operations-workflow-git-v1";
const root = "/repositories";
const filepath = "workflow.json";
const mainRef = "refs/heads/main";
const redoRef = "refs/workflow/redo";
const author = { name: "Local workflow editor", email: "workflow@localhost" };

type Preferences = Pick<WorkflowDocument, "viewport" | "snap" | "curved" | "dashed">;
type CatalogEntry = { id: string; name: string; repositoryPath: string };
// Missing format denotes the previous append-only Undo/Redo implementation.
type Navigation = { format?: 2; revision: string; undo: string[]; redo: string[] };
type LegacyPendingVersion = {
  id: string;
  blob: string;
  message: string;
  baseRevision: string | null;
  undo: string[];
  redo: string[];
  preferences: Preferences;
  forceCommit: boolean;
};
type PendingCommit = LegacyPendingVersion & {
  operation: "commit";
  timestamp: number;
  changeId?: string;
  targetRevision?: string;
  stash?: { name: string; oid: string };
};
type PendingNavigation = {
  operation: "navigate";
  id: string;
  baseRevision: string;
  targetRevision: string;
  undo: string[];
  redo: string[];
  redoTip: string | null;
  preferences: Preferences;
};
type PendingVersion = LegacyPendingVersion | PendingCommit | PendingNavigation;
interface ApplicationDatabase extends DBSchema
{
  catalog: { key: string; value: CatalogEntry };
  preferences: { key: string; value: Preferences };
  navigation: { key: string; value: Navigation };
  pending: { key: string; value: PendingVersion };
  removed: { key: string; value: boolean };
  migrated: { key: string; value: string };
  activity: { key: string; value: number };
}

export type WorkflowRevision = { oid: string; message: string; timestamp: number; parents: string[]; branches: string[] };
export type WorkflowRepositoryState = { document: WorkflowDocument; revision: string; canUndo: boolean; canRedo: boolean };
export type WorkflowRepositoryOptions = { databaseName?: string; filesystemName?: string; channelName?: string };

export class WorkflowConflictError extends Error
{
  constructor()
  {
    super("This workflow changed in another tab. Reopen it before editing this version.");
    this.name = "WorkflowConflictError";
  }
}

const filesystems = new Map<string, LightningFS>();
const queues = new Map<string, Promise<unknown>>();

export function workflowRepositoryPath(id: string): string
{
  // An encoded stable ID cannot become a path separator, dot segment, or display-name collision.
  return `${root}/w-${Array.from(id, character => character.codePointAt(0)!.toString(16)).join("-")}`;
}

const repositoryPath = workflowRepositoryPath;

function preferencesOf(document: WorkflowDocument): Preferences
{
  return { viewport: document.viewport, snap: document.snap, curved: document.curved, dashed: document.dashed };
}

const defaultPreferences: Preferences = { viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false };

function serialize(document: WorkflowDocument): string
{
  const { viewport: _viewport, snap: _snap, curved: _curved, dashed: _dashed, ...content } = validateWorkflowDocument(document);
  return `${JSON.stringify(content, null, 2)}\n`;
}

function deserialize(json: string, id: string, preferences: Preferences = defaultPreferences): WorkflowDocument
{
  const document = validateWorkflowDocument({ ...JSON.parse(json), ...preferences });
  if (document.id !== id) throw new Error("The saved workflow does not match its repository ID.");
  return document;
}

function missing(error: unknown): boolean
{
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function revisionMessage(message: string): string
{
  return message.trim().replace(/\n\nWorkflow-Change: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "");
}

async function serialized<T>(key: string, task: () => Promise<T>): Promise<T>
{
  const previous = queues.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(() => {
    if (!globalThis.navigator?.locks)
      throw new Error("This browser does not support the locks required to save workflow history safely.");
    return navigator.locks.request(key, task);
  });
  queues.set(key, pending);
  try { return await pending; }
  finally { if (queues.get(key) === pending) queues.delete(key); }
}

export function createWorkflowRepository(options: WorkflowRepositoryOptions = {})
{
  const databaseName = options.databaseName ?? workflowRepositoryDatabaseName;
  const filesystemName = options.filesystemName ?? workflowFilesystemName;
  const lockPrefix = `workflow-repository:${filesystemName}`;
  const listeners = new Set<() => void>();
  let fs: LightningFS;
  let database: IDBPDatabase<ApplicationDatabase>;
  let ready: Promise<void> | undefined;
  let channel: BroadcastChannel | undefined;
  const legacyMessages = new Map<string, string>();

  function notify(): void
  {
    for (const listener of listeners) queueMicrotask(listener);
  }

  function announce(): void
  {
    notify();
    channel?.postMessage("changed");
  }

  function locked<T>(id: string, task: () => Promise<T>): Promise<T>
  {
    return serialized(`${lockPrefix}:${repositoryPath(id)}`, task);
  }

  async function exists(path: string): Promise<boolean>
  {
    try { await fs.promises.stat(path); return true; }
    catch (error) { if (missing(error)) return false; throw error; }
  }

  async function mkdir(path: string): Promise<void>
  {
    try { await fs.promises.mkdir(path); }
    catch (error)
    {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
  }

  async function removeTree(path: string): Promise<void>
  {
    if (!await exists(path)) return;
    const stat = await fs.promises.lstat(path);
    if (!stat.isDirectory()) { await fs.promises.unlink(path); return; }
    for (const child of await fs.promises.readdir(path)) await removeTree(`${path}/${child}`);
    await fs.promises.rmdir(path);
  }

  async function refValue(id: string, ref: string): Promise<string | null>
  {
    try { return await git.resolveRef({ fs, dir: repositoryPath(id), ref }); }
    catch (error) { if (error instanceof git.Errors.NotFoundError) return null; throw error; }
  }

  const head = (id: string) => refValue(id, mainRef);

  async function versionText(id: string, oid: string): Promise<string>
  {
    const { blob } = await git.readBlob({ fs, dir: repositoryPath(id), oid, filepath });
    return new TextDecoder().decode(blob);
  }

  async function workingText(id: string): Promise<string | null>
  {
    try { return await fs.promises.readFile(`${repositoryPath(id)}/${filepath}`, "utf8"); }
    catch (error) { if (missing(error)) return null; throw error; }
  }

  async function firstParents(id: string, revision: string): Promise<string[]>
  {
    const result: string[] = [];
    let current: string | undefined = revision;
    while (current)
    {
      if (result.includes(current)) throw new Error("The workflow history contains a cyclic parent chain.");
      result.push(current);
      current = (await git.readCommit({ fs, dir: repositoryPath(id), oid: current })).commit.parent[0];
    }
    return result;
  }

  async function navigation(id: string, revision: string): Promise<Navigation>
  {
    const saved = await database.get("navigation", id);
    if (saved?.format === 2 && saved.revision === revision) return saved;
    const undo = (await firstParents(id, revision)).slice(1).reverse();
    const future = await refValue(id, redoRef);
    const futureChain = future ? await firstParents(id, future) : [];
    const selected = futureChain.indexOf(revision);
    // Legacy synthetic Undo/Redo commits stay in Git. Only the navigation metadata
    // changes to following existing commits; no historical commit is rewritten.
    return { format: 2, revision, undo, redo: selected > 0 ? futureChain.slice(0, selected) : [] };
  }

  async function finish(id: string, document: WorkflowDocument, navigationState: Navigation): Promise<void>
  {
    const transaction = database.transaction(["catalog", "preferences", "navigation", "pending", "activity"], "readwrite");
    void transaction.done.catch(() => {});
    const activity = transaction.objectStore("activity");
    const nextActivity = Math.max(Date.now(), ...((await activity.getAll()).map(value => value + 1)));
    await transaction.objectStore("catalog").put({ id, name: document.name, repositoryPath: repositoryPath(id) }, id);
    await transaction.objectStore("preferences").put(preferencesOf(document), id);
    await transaction.objectStore("navigation").put(navigationState, id);
    await transaction.objectStore("pending").delete(id);
    await activity.put(nextActivity, id);
    await transaction.done;
  }

  async function selectRevision(id: string, revision: string): Promise<void>
  {
    const dir = repositoryPath(id);
    await git.writeRef({ fs, dir, ref: mainRef, value: revision, force: true });
    await git.writeRef({ fs, dir, ref: "HEAD", value: mainRef, symbolic: true, force: true });
    await fs.promises.flush();
  }

  async function clearRedoRef(id: string): Promise<void>
  {
    if (await refValue(id, redoRef)) await git.deleteRef({ fs, dir: repositoryPath(id), ref: redoRef });
  }

  async function reserveStash(id: string): Promise<PendingCommit["stash"]>
  {
    const oid = await refValue(id, redoRef);
    if (!oid) return undefined;
    const branches = await git.listBranches({ fs, dir: repositoryPath(id) });
    const numbers = branches.filter(name => /^stash-[1-9][0-9]*$/.test(name)).map(name => Number(name.slice(6)));
    const next = Math.max(0, ...numbers) + 1;
    if (!Number.isSafeInteger(next)) throw new Error("The workflow has exhausted its stash branch numbers.");
    return { name: `stash-${next}`, oid };
  }

  async function archiveFuture(id: string, stash: NonNullable<PendingCommit["stash"]>): Promise<void>
  {
    const existing = await refValue(id, `refs/heads/${stash.name}`);
    if (existing && existing !== stash.oid) throw new WorkflowConflictError();
    if (!existing) await git.branch({ fs, dir: repositoryPath(id), ref: stash.name, object: stash.oid });
    // Preserve the abandoned future before changing the main reference.
    await fs.promises.flush();
  }

  async function completeCommit(id: string, pending: PendingCommit, text: string): Promise<void>
  {
    const current = await head(id);
    if (current !== pending.baseRevision && current !== pending.targetRevision) throw new WorkflowConflictError();
    const document = deserialize(text, id, pending.preferences);
    if (pending.stash) await archiveFuture(id, pending.stash);
    if (!pending.targetRevision)
    {
      const dir = repositoryPath(id);
      await git.add({ fs, dir, filepath });
      const identity = { ...author, timestamp: pending.timestamp, timezoneOffset: 0 };
      // A durable action identifier distinguishes identical edits made within the
      // same second while replaying this journal produces exactly the same OID.
      const message = pending.changeId ? `${pending.message}\n\nWorkflow-Change: ${pending.changeId}` : pending.message;
      const revision = await git.commit({ fs, dir, ref: mainRef, noUpdateBranch: true,
        parent: pending.baseRevision ? [pending.baseRevision] : [], message,
        author: identity, committer: identity });
      await fs.promises.flush();
      pending = { ...pending, targetRevision: revision };
      await database.put("pending", pending, id);
    }
    // The commit object is durable before its OID is journalled or main is moved.
    // Replaying this sequence retains the same OID and reserved stash name.
    await selectRevision(id, pending.targetRevision!);
    await clearRedoRef(id);
    await fs.promises.flush();
    await finish(id, document, { format: 2, revision: pending.targetRevision!, undo: pending.undo, redo: [] });
    announce();
  }

  async function completeNavigation(id: string, pending: PendingNavigation): Promise<void>
  {
    const current = await head(id);
    if (current !== pending.baseRevision && current !== pending.targetRevision) throw new WorkflowConflictError();
    const dir = repositoryPath(id);
    const text = await versionText(id, pending.targetRevision);
    const document = deserialize(text, id, pending.preferences);
    if (pending.redoTip) await git.writeRef({ fs, dir, ref: redoRef, value: pending.redoTip, force: true });
    await fs.promises.writeFile(`${dir}/${filepath}`, text, "utf8");
    await git.add({ fs, dir, filepath });
    // The old future and selected working file/index are durable before moving main.
    await fs.promises.flush();
    await selectRevision(id, pending.targetRevision);
    if (!pending.redoTip) await clearRedoRef(id);
    await fs.promises.flush();
    await finish(id, document, { format: 2, revision: pending.targetRevision, undo: pending.undo, redo: pending.redo });
    announce();
  }

  async function recoverLegacy(id: string, pending: LegacyPendingVersion, text: string): Promise<void>
  {
    const { oid: blob } = await git.hashBlob({ object: text });
    if (pending.blob !== blob) { await database.delete("pending", id); return; }
    const document = deserialize(text, id, pending.preferences);
    let revision = await head(id);
    if (!revision || await versionText(id, revision) !== text || pending.forceCommit && revision === pending.baseRevision)
    {
      const dir = repositoryPath(id);
      await git.add({ fs, dir, filepath });
      revision = await git.commit({ fs, dir, ref: mainRef, message: pending.message, author });
    }
    await fs.promises.flush();
    // Finish the old transaction before migrating its metadata to real commit navigation.
    await finish(id, document, { revision, undo: pending.undo, redo: pending.redo });
  }

  async function recover(id: string): Promise<void>
  {
    if (await database.get("removed", id))
    {
      await removeTree(repositoryPath(id));
      await fs.promises.flush();
      return;
    }
    const pending = await database.get("pending", id);
    if (pending && "operation" in pending && pending.operation === "navigate")
    {
      await completeNavigation(id, pending);
      return;
    }
    let text = await workingText(id);
    if (text === null && pending && "operation" in pending && pending.operation === "commit" && pending.targetRevision)
    {
      // A journalled durable commit can repair a missing working file without
      // creating another version or discarding the unfinished transaction.
      text = await versionText(id, pending.targetRevision);
      await fs.promises.writeFile(`${repositoryPath(id)}/${filepath}`, text, "utf8");
      await git.add({ fs, dir: repositoryPath(id), filepath });
      await fs.promises.flush();
    }
    if (text === null)
    {
      if (pending) await database.delete("pending", id);
      return;
    }
    if (pending)
    {
      if ("operation" in pending)
      {
        const { oid: blob } = await git.hashBlob({ object: text });
        if (pending.blob === blob) { await completeCommit(id, pending, text); return; }
        if (pending.targetRevision || pending.stash && await refValue(id, `refs/heads/${pending.stash.name}`))
          throw new Error("The pending workflow commit no longer matches its working file.");
        await database.delete("pending", id);
      }
      else await recoverLegacy(id, pending, text);
    }
    const preferences = await database.get("preferences", id) ?? defaultPreferences;
    const document = deserialize(text, id, preferences);
    const revision = await head(id);
    if (!revision || await versionText(id, revision) !== text)
    {
      const current = revision ? await navigation(id, revision) : { undo: [], redo: [] };
      await write(document, revision, revision ? [...current.undo, revision] : [], "Recover saved workflow");
      return;
    }
    const catalog = await database.get("catalog", id);
    const savedNavigation = await database.get("navigation", id);
    if (!catalog || catalog.name !== document.name || savedNavigation?.revision !== revision || savedNavigation.format !== 2)
    {
      await fs.promises.flush();
      await finish(id, document, await navigation(id, revision));
      announce();
    }
  }

  async function state(id: string): Promise<WorkflowRepositoryState>
  {
    if (await database.get("removed", id)) throw new Error("This workflow has been removed.");
    const text = await workingText(id);
    const revision = await head(id);
    if (text === null || !revision) throw new Error("This workflow could not be found in this browser.");
    const preferences = await database.get("preferences", id) ?? defaultPreferences;
    const current = await navigation(id, revision);
    return { document: deserialize(text, id, preferences), revision, canUndo: current.undo.length > 0, canRedo: current.redo.length > 0 };
  }

  async function write(document: WorkflowDocument, previous: string | null, undo: string[], message: string, forceCommit = false): Promise<WorkflowRepositoryState>
  {
    const id = document.id;
    const dir = repositoryPath(id);
    await mkdir(dir);
    if (!await exists(`${dir}/.git/HEAD`)) await git.init({ fs, dir, defaultBranch: "main" });
    const text = serialize(document);
    const { oid: blob } = await git.hashBlob({ object: text });
    const stash = await reserveStash(id);
    const pending: PendingCommit = { operation: "commit", id, blob, message, baseRevision: previous, undo, redo: [],
      preferences: preferencesOf(document), forceCommit, timestamp: Math.floor(Date.now() / 1000), changeId: crypto.randomUUID(),
      ...(stash ? { stash } : {}) };
    await database.put("pending", pending, id);
    await fs.promises.writeFile(`${dir}/${filepath}`, text, "utf8");
    await fs.promises.flush();
    await completeCommit(id, pending, text);
    return state(id);
  }

  async function saveLocked(document: WorkflowDocument, expectedRevision: string | null, message?: string): Promise<WorkflowRepositoryState>
  {
    const id = document.id;
    if (await database.get("removed", id)) throw new WorkflowConflictError();
    await recover(id);
    const revision = await head(id);
    const currentText = await workingText(id);
    if (revision && currentText === serialize(document))
    {
      // Includes retrying a write whose commit succeeded before its caller received the result.
      const transaction = database.transaction(["preferences", "activity"], "readwrite");
      void transaction.done.catch(() => {});
      const activity = transaction.objectStore("activity");
      const nextActivity = Math.max(Date.now(), ...((await activity.getAll()).map(value => value + 1)));
      await transaction.objectStore("preferences").put(preferencesOf(document), id);
      await activity.put(nextActivity, id);
      await transaction.done;
      announce();
      return state(id);
    }
    if (revision !== expectedRevision) throw new WorkflowConflictError();
    const current = revision ? await navigation(id, revision) : { undo: [], redo: [] };
    const description = message ?? describeWorkflowChange(revision ? deserialize(await versionText(id, revision), id) : null, document);
    return write(document, revision, revision ? [...current.undo, revision] : [], description);
  }

  async function bootstrap(): Promise<void>
  {
    let sharedFilesystem = filesystems.get(filesystemName);
    if (!sharedFilesystem)
    {
      sharedFilesystem = new LightningFS(filesystemName, { defer: true });
      filesystems.set(filesystemName, sharedFilesystem);
    }
    fs = sharedFilesystem;
    database = await openDB<ApplicationDatabase>(databaseName, 2, {
      upgrade(database) {
        for (const store of ["catalog", "preferences", "navigation", "pending", "removed", "migrated", "activity"] as const)
          if (!database.objectStoreNames.contains(store)) database.createObjectStore(store);
      },
      blocking() {
        database.close();
      }
    });
    if (typeof BroadcastChannel !== "undefined")
    {
      channel ??= new BroadcastChannel(options.channelName ?? `${databaseName}:changes`);
      channel.onmessage = notify;
    }
    await serialized(`${lockPrefix}:initialize`, async () => {
      await mkdir(root);
      const ids = new Set([
        ...await database.getAllKeys("catalog"), ...await database.getAllKeys("pending"), ...await database.getAllKeys("removed")
      ]);
      for (const directory of await fs.promises.readdir(root))
      {
        const path = `${root}/${directory}`;
        if (!/^w-[a-f0-9]+(?:-[a-f0-9]+)*$/.test(directory))
          throw new Error("A saved workflow repository has an invalid identifier.");
        const points = directory.slice(2).split("-").map(value => Number.parseInt(value, 16));
        if (points.some(value => value > 0x10ffff)) throw new Error("A saved workflow repository has an invalid identifier.");
        const id = String.fromCodePoint(...points);
        if (repositoryPath(id) !== path) throw new Error("A saved workflow repository has an invalid identifier.");
        // Read workflow.json only inside the same lock used by writers/deletion.
        ids.add(id);
      }
      for (const id of ids) await locked(id, () => recover(id));
      await fs.promises.flush();
    });
  }

  async function migrate(storage: Pick<Storage, "getItem" | "removeItem">): Promise<void>
  {
    await serialized(`${lockPrefix}:migration`, async () => {
      const legacy = storage.getItem(workflowStorageKey);
      if (legacy === null) return;
      const documents = loadWorkflowDocuments({ getItem: () => legacy });
      for (const document of documents)
      {
        await locked(document.id, async () => {
          const { oid: fingerprint } = await git.hashBlob({ object: JSON.stringify(document) });
          if (await database.get("migrated", document.id) === fingerprint || await database.get("removed", document.id)) return;
          await saveLocked(document, null, "Import existing workflow");
          await database.put("migrated", fingerprint, document.id);
        });
      }
      if (storage.getItem(workflowStorageKey) !== legacy)
        throw new Error("The previous workflow collection changed during migration. Reload to finish importing it.");
      storage.removeItem(workflowStorageKey);
    });
  }

  async function initialize(legacyStorage?: Pick<Storage, "getItem" | "removeItem">): Promise<void>
  {
    ready ??= bootstrap().then(async () => {
      if (legacyStorage) return;
      let storage: Storage;
      try
      {
        storage = localStorage;
        storage.getItem(workflowStorageKey);
      }
      catch
      {
        // Some browsers block localStorage separately from IndexedDB. Leave any legacy
        // data untouched and keep existing IndexedDB repositories usable.
        return;
      }
      await migrate(storage);
    }).catch(error => { ready = undefined; throw error; });
    await ready;
    if (legacyStorage) await migrate(legacyStorage);
  }

  async function historyGraph(id: string): Promise<WorkflowRevision[]>
  {
    const dir = repositoryPath(id);
    const branchNames = (await git.listBranches({ fs, dir })).sort((left, right) =>
      left === "main" ? -1 : right === "main" ? 1 : left.localeCompare(right, undefined, { numeric: true }));
    const roots = new Map<string, string[]>();
    for (const branch of branchNames)
    {
      const oid = await refValue(id, `refs/heads/${branch}`);
      if (oid) roots.set(oid, [...(roots.get(oid) ?? []), branch]);
    }
    const future = await refValue(id, redoRef);
    if (future && !roots.has(future)) roots.set(future, []);
    const nodes = new Map<string, WorkflowRevision>();
    const mainLine = new Set<string>();
    for (const [root, branches] of roots)
    {
      for (const { oid, commit } of await git.log({ fs, dir, ref: root }))
      {
        nodes.set(oid, { oid, message: revisionMessage(commit.message), timestamp: commit.author.timestamp * 1000,
          parents: [...commit.parent], branches: roots.get(oid) ?? [] });
        if (branches.includes("main")) mainLine.add(oid);
      }
    }
    const children = new Map([...nodes.keys()].map(oid => [oid, 0]));
    for (const node of nodes.values()) for (const parent of node.parents)
      if (children.has(parent)) children.set(parent, children.get(parent)! + 1);
    const available = [...nodes.values()].filter(node => children.get(node.oid) === 0);
    const result: WorkflowRevision[] = [];
    while (available.length)
    {
      available.sort((left, right) => Number(mainLine.has(right.oid)) - Number(mainLine.has(left.oid)) ||
        right.timestamp - left.timestamp || left.oid.localeCompare(right.oid));
      const node = available.shift()!;
      result.push(node);
      for (const parent of node.parents)
      {
        if (!children.has(parent)) continue;
        const remaining = children.get(parent)! - 1;
        children.set(parent, remaining);
        if (!remaining) available.push(nodes.get(parent)!);
      }
    }
    if (result.length !== nodes.size) throw new Error("The workflow history contains a cyclic parent graph.");
    return result;
  }

  async function historicalDocument(id: string, oid: string): Promise<WorkflowDocument>
  {
    if (!/^[a-f0-9]{40}$/.test(oid)) throw new Error("Invalid workflow revision.");
    const entries = await historyGraph(id);
    if (!entries.some(entry => entry.oid === oid)) throw new Error("This revision is not in the workflow's history.");
    const preferences = await database.get("preferences", id) ?? defaultPreferences;
    return deserialize(await versionText(id, oid), id, preferences);
  }

  async function describeHistory(id: string, entries: WorkflowRevision[]): Promise<WorkflowRevision[]>
  {
    const documents = new Map<string, Promise<WorkflowDocument>>();
    const documentAt = (oid: string) => {
      let document = documents.get(oid);
      if (!document)
      {
        document = versionText(id, oid).then(text => deserialize(text, id));
        documents.set(oid, document);
      }
      return document;
    };
    for (const entry of entries)
    {
      if (entry.message !== "Update workflow") continue;
      const key = `${id}:${entry.oid}`;
      let message = legacyMessages.get(key);
      if (!message)
      {
        try
        {
          const after = await documentAt(entry.oid);
          const before = entry.parents[0] ? await documentAt(entry.parents[0]) : null;
          message = describeWorkflowChange(before, after);
          legacyMessages.set(key, message);
        }
        catch { continue; } // Keep history readable if an old snapshot cannot be read.
      }
      entry.message = message;
    }
    return entries;
  }

  async function navigate(id: string, expectedRevision: string, direction: "undo" | "redo"): Promise<WorkflowRepositoryState>
  {
    await initialize();
    return locked(id, async () => {
      await recover(id);
      const current = await state(id);
      if (current.revision !== expectedRevision) throw new WorkflowConflictError();
      const saved = await navigation(id, current.revision);
      const target = saved[direction].at(-1);
      if (!target) return current;
      const undo = direction === "undo" ? saved.undo.slice(0, -1) : [...saved.undo, current.revision];
      const redo = direction === "redo" ? saved.redo.slice(0, -1) : [...saved.redo, current.revision];
      const future = redo.length ? await refValue(id, redoRef) ?? current.revision : null;
      const pending: PendingNavigation = { operation: "navigate", id, baseRevision: current.revision,
        targetRevision: target, undo, redo, redoTip: future, preferences: preferencesOf(current.document) };
      await database.put("pending", pending, id);
      await completeNavigation(id, pending);
      return state(id);
    });
  }

  async function repositoryMetrics(entry: CatalogEntry, today: number): Promise<WorkflowStorageMetrics>
  {
    const dir = repositoryPath(entry.id);
    if (entry.repositoryPath !== dir) throw new Error("The workflow repository path does not match its ID.");
    const branch = await git.currentBranch({ fs, dir }) ?? null;
    let currentHead: string | null;
    try { currentHead = await git.resolveRef({ fs, dir, ref: "HEAD" }); }
    catch (error)
    {
      // An unborn branch is valid; other ref errors remain visible in this repository's report.
      if (branch !== null && error instanceof git.Errors.NotFoundError) currentHead = null;
      else throw error;
    }
    const [repositorySize, gitSize, fileStat, branchesResult, tagsResult, remotesResult, filesResult, statusResult, historyResult] =
      await Promise.allSettled([
        fs.promises.du(dir),
        fs.promises.du(`${dir}/.git`),
        fs.promises.stat(`${dir}/${filepath}`).catch(error => { if (missing(error)) return null; throw error; }),
        git.listBranches({ fs, dir }),
        git.listTags({ fs, dir }),
        git.listRemotes({ fs, dir }),
        git.listFiles({ fs, dir }),
        // Disabling refresh prevents a status read from rewriting the index's stat cache.
        git.statusMatrix({ fs, dir, refresh: false }),
        currentHead ? git.log({ fs, dir, ref: currentHead }) : Promise.resolve([])
      ]);
    // Keep the repository lock until every read has settled, including failed scans.
    function result<T>(value: PromiseSettledResult<T>): T
    {
      if (value.status === "rejected") throw value.reason;
      return value.value;
    }
    const repositoryBytes = result(repositorySize);
    const gitBytes = result(gitSize);
    const stat = result(fileStat);
    const branches = result(branchesResult);
    const tags = result(tagsResult);
    const remotes = result(remotesResult).map(remote => ({ name: remote.remote, url: remote.url }));
    const trackedFiles = result(filesResult);
    const matrix = result(statusResult);
    const commits: StorageCommit[] = result(historyResult).map(({ oid, commit }) => ({
      oid, message: revisionMessage(commit.message), timestamp: commit.committer.timestamp * 1000,
      author: `${commit.author.name} <${commit.author.email}>`,
      committer: `${commit.committer.name} <${commit.committer.email}>`,
      parents: [...commit.parent]
    }));
    const day = 86_400_000;
    const activity = Array.from({ length: 30 }, (_, index) =>
      ({ date: new Date(today - (29 - index) * day).toISOString().slice(0, 10), count: 0 }));
    const buckets = new Map(activity.map(bucket => [bucket.date, bucket]));
    for (const commit of commits)
    {
      const bucket = buckets.get(new Date(commit.timestamp).toISOString().slice(0, 10));
      if (bucket) bucket.count++;
    }
    return {
      repositoryBytes, gitBytes, workingTreeBytes: Math.max(0, repositoryBytes - gitBytes),
      branch, head: currentHead, branches, tags, remotes, trackedFiles,
      // Categories can overlap, just as Git's staged and working-tree status columns do.
      status: {
        clean: matrix.every(([, head, workdir, stage]) => head === workdir && workdir === stage),
        modified: matrix.filter(([, head, workdir, stage]) =>
          stage > 0 && (workdir > 0 && workdir !== stage || head > 0 && head !== stage)).length,
        staged: matrix.filter(([, head, , stage]) => head !== stage).length,
        untracked: matrix.filter(([, , workdir, stage]) => workdir > 0 && stage === 0).length,
        deleted: matrix.filter(([, head, workdir, stage]) =>
          head > 0 && stage === 0 || workdir === 0 && (head > 0 || stage > 0)).length
      },
      commitCount: commits.length, latest: commits[0] ?? null, recent: commits.slice(0, 10), activity,
      workflowFile: stat ? { bytes: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs } : null
    };
  }

  return {
    initialize,
    async storageMetrics(): Promise<WorkflowStorageEntry[]>
    {
      await initialize();
      const now = new Date();
      const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const entries = await database.getAll("catalog");
      const report: WorkflowStorageEntry[] = [];
      for (const entry of entries)
      {
        try
        {
          const item = await locked(entry.id, async () => {
            const current = await database.get("catalog", entry.id);
            if (!current || await database.get("removed", entry.id)) return null;
            // Monitoring does not load/recover a workflow, stage changes, or create commits.
            return { ...current, metrics: await repositoryMetrics(current, today), error: null };
          });
          if (item) report.push(item);
        }
        catch (error)
        {
          report.push({ ...entry, metrics: null, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return report;
    },
    subscribe(listener: () => void): () => void
    {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async list(): Promise<WorkflowDocument[]>
    {
      await initialize();
      const entries = await database.getAll("catalog");
      const activity = new Map(await Promise.all(entries.map(async entry =>
        [entry.id, await database.get("activity", entry.id) ?? 0] as const)));
      entries.sort((left, right) => activity.get(left.id)! - activity.get(right.id)!);
      const documents: WorkflowDocument[] = [];
      for (const entry of entries)
      {
        await locked(entry.id, async () => {
          if (await database.get("removed", entry.id)) return;
          await recover(entry.id);
          documents.push((await state(entry.id)).document);
        });
      }
      return documents;
    },
    async load(id: string): Promise<WorkflowRepositoryState>
    {
      await initialize();
      return locked(id, async () => { await recover(id); return state(id); });
    },
    async save(value: WorkflowDocument, expectedRevision: string | null, message?: string): Promise<WorkflowRepositoryState>
    {
      // Take an immutable, normalized snapshot before waiting behind another write.
      const document = validateWorkflowDocument(value);
      await initialize();
      return locked(document.id, () => saveLocked(document, expectedRevision, message));
    },
    async remove(ids: string[]): Promise<void>
    {
      await initialize();
      for (const id of new Set(ids))
      {
        await locked(id, async () => {
          const transaction = database.transaction(["removed", "catalog", "preferences", "navigation", "pending", "activity"], "readwrite");
          void transaction.done.catch(() => {});
          await transaction.objectStore("removed").put(true, id);
          for (const name of ["catalog", "preferences", "navigation", "pending", "activity"] as const) await transaction.objectStore(name).delete(id);
          await transaction.done;
          await removeTree(repositoryPath(id));
          await fs.promises.flush();
          announce();
        });
      }
    },
    async history(id: string): Promise<WorkflowRevision[]>
    {
      await initialize();
      return locked(id, async () => {
        if (await database.get("removed", id)) throw new Error("This workflow has been removed.");
        return describeHistory(id, await historyGraph(id));
      });
    },
    async readVersion(id: string, oid: string): Promise<WorkflowDocument>
    {
      await initialize();
      return locked(id, () => historicalDocument(id, oid));
    },
    async restore(id: string, oid: string, expectedRevision: string): Promise<WorkflowRepositoryState>
    {
      await initialize();
      return locked(id, async () => {
        await recover(id);
        const current = await state(id);
        if (current.revision !== expectedRevision) throw new WorkflowConflictError();
        const document = await historicalDocument(id, oid);
        const saved = await navigation(id, current.revision);
        return write(document, current.revision, [...saved.undo, current.revision], `Restore workflow version ${oid.slice(0, 7)}`, true);
      });
    },
    undo: (id: string, expectedRevision: string) => navigate(id, expectedRevision, "undo"),
    redo: (id: string, expectedRevision: string) => navigate(id, expectedRevision, "redo")
  };
}

export const workflowRepository = createWorkflowRepository();
