// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Run with Brave Chromium: node tests/storage-namespace.smoke.mjs

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { pail } from "@visulima/pail";

const fixtureId = "virtual:storage-namespace-test";
const server = await createServer({ configFile: false, root: resolve("src"),
  cacheDir: resolve("tmp/test/storage-namespace/.vite"),
  optimizeDeps: { include: ["@isomorphic-git/lightning-fs", "isomorphic-git", "buffer", "idb"] },
  server: { host: "127.0.0.1", port: 0, strictPort: true },
  plugins: [{ name: "storage-namespace-test-fixture",
    resolveId(id) { if (id === fixtureId) return `\0${fixtureId}`; },
    load(id) { if (id === `\0${fixtureId}`) return `
      export { default as LightningFS } from '@isomorphic-git/lightning-fs';
      export * as git from 'isomorphic-git';
      export { openDB } from 'idb';
      export { loadSettings, saveSetting } from '/lib/app-settings.ts';
      export { createWorkflowRepository, workflowRepositoryPath } from '/lib/workflow-repository.ts';
      export { createMetricsHistoryRepository } from '/lib/metrics-history-repository.ts';
      export { prepareStorageNamespaces } from '/lib/storage-namespace.ts';
      export { migrateDatabase, migrateFilesystem, removeMigratedDatabase } from '/lib/storage-namespace-migration.ts';
    `; },
  }],
});

const legacy = { settings: "operations-preferences-v1", catalog: "operations-workflow-catalog-v1",
  workflows: "operations-workflow-git-v1", metrics: "operations-metrics-git-v1" };
const current = { settings: "v1/settings", catalog: "v1/workflows/index", workflows: "v1/workflows", metrics: "v1/metrics" };
const legacyDatabaseNames = [...Object.values(legacy), `${legacy.workflows}_lock`, `${legacy.metrics}_lock`];
const savedSettings = { theme: "dark", palette: "sunset", developerToolbar: true,
  workflowDefaults: { dashed: true, curved: true, snap: true, gridSize: 27, dashGap: 6, curveStrength: 71, nodeClearance: 24 } };
const document = { version: 3, id: "namespace-migration-workflow", name: "Original workflow", description: "Saved before namespace migration",
  nodes: [], edges: [], viewport: { x: 35, y: -17, zoom: 1.25 }, snap: true, curved: true, dashed: true };
const duration = 15 * 60_000;
const start = Date.UTC(2026, 0, 1);
const bar = index => ({ start: start + index * duration, end: start + (index + 1) * duration,
  metrics: { usage: { open: 10 + index, high: 16 + index, low: 8 + index, close: 14 + index, count: 3 } } });
const failures = [];
let browser;

async function newContext(baseURL) {
  const context = await browser.newContext();
  await context.route(`${baseURL}/__storage-namespace-test`, route => route.fulfill({ contentType: "text/html",
    body: "<!doctype html><title>Isolated storage namespace test</title>" }));
  return context;
}

async function openPage(context, baseURL) {
  const page = await context.newPage();
  page.on("pageerror", error => failures.push(error.message));
  await page.goto(`${baseURL}/__storage-namespace-test`);
  await page.evaluate(async fixtureId => { globalThis.fixture = await import(`/@id/${fixtureId}`); }, fixtureId);
  return page;
}

const names = page => page.evaluate(async () => (await indexedDB.databases()).map(database => database.name).sort());

async function prepare(page) {
  await page.evaluate(async () => {
    try { await fixture.prepareStorageNamespaces(); }
    catch (error) {
      const messages = [];
      for (let current = error; current; current = current.cause) messages.push(current.stack ?? String(current));
      throw new Error(messages.join("\nCaused by: "));
    }
  });
}

// Include schemas and binary/Map values: LightningFS superblocks are structured clones.
async function databaseSnapshot(page, databaseNames) {
  return page.evaluate(async databaseNames => {
    const encode = value => {
      if (value instanceof ArrayBuffer) return { bytes: [...new Uint8Array(value)] };
      if (ArrayBuffer.isView(value)) return { type: value.constructor.name,
        bytes: [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)] };
      if (value instanceof Map) return { map: [...value].map(([key, value]) => [encode(key), encode(value)]) };
      if (value instanceof Date) return { date: value.toISOString() };
      if (Array.isArray(value)) return value.map(encode);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, value]) => [key, encode(value)]));
      return value;
    };
    const snapshot = {};
    for (const name of databaseNames) {
      const database = await fixture.openDB(name);
      try {
        const stores = {};
        for (const storeName of database.objectStoreNames) {
          const transaction = database.transaction(storeName);
          const store = transaction.store;
          const indexes = [...store.indexNames].map(name => {
            const index = store.index(name);
            return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
          });
          const [keys, values] = await Promise.all([store.getAllKeys(), store.getAll()]);
          await transaction.done;
          stores[storeName] = { keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes,
            entries: keys.map((key, index) => [encode(key), encode(values[index])]) };
        }
        snapshot[name] = { version: database.version, stores };
      } finally { database.close(); }
    }
    return snapshot;
  }, databaseNames);
}

async function inspectWorkflow(page, filesystemName, databaseName) {
  return page.evaluate(async ({ filesystemName, databaseName, id }) => {
    const fs = new fixture.LightningFS(filesystemName, { defer: true });
    const dir = fixture.workflowRepositoryPath(id);
    const database = await fixture.openDB(databaseName);
    try {
      const branches = Object.fromEntries(await Promise.all((await fixture.git.listBranches({ fs, dir })).sort()
        .map(async name => [name, await fixture.git.resolveRef({ fs, dir, ref: `refs/heads/${name}` })])));
      const result = { branches, head: await fixture.git.resolveRef({ fs, dir, ref: "HEAD" }),
        redo: await fixture.git.resolveRef({ fs, dir, ref: "refs/workflow/redo" }),
        index: [...await fs.promises.readFile(`${dir}/.git/index`)],
        working: await fs.promises.readFile(`${dir}/workflow.json`, "utf8"),
        note: await fs.promises.readFile(`${dir}/untracked-note.txt`, "utf8"),
        status: await fixture.git.statusMatrix({ fs, dir, refresh: false }),
        navigation: await database.get("navigation", id), preferences: await database.get("preferences", id) };
      await fs.promises.flush();
      return result;
    } finally { database.close(); }
  }, { filesystemName, databaseName, id: document.id });
}

async function loadDefaults(page) {
  return page.evaluate(async id => {
    globalThis.workflows ??= fixture.createWorkflowRepository();
    globalThis.metrics ??= fixture.createMetricsHistoryRepository();
    const settings = await fixture.loadSettings(["default", "sunset"]);
    if (settings.storageError) throw settings.storageError;
    const history = await workflows.history(id);
    return { settings, workflow: await workflows.load(id), history,
      versions: await Promise.all(history.map(revision => workflows.readVersion(id, revision.oid))), bars: await metrics.load() };
  }, document.id);
}

async function inspectMetrics(page, filesystemName) {
  return page.evaluate(async filesystemName => {
    const fs = new fixture.LightningFS(filesystemName, { defer: true });
    const dir = "/metrics";
    const history = (await fixture.git.log({ fs, dir })).map(({ oid, commit }) => ({ oid, parent: commit.parent, message: commit.message }));
    return { history, status: await fixture.git.statusMatrix({ fs, dir, refresh: false }) };
  }, filesystemName);
}

async function inspectFiles(page, filesystemName) {
  return page.evaluate(async filesystemName => {
    const fs = new fixture.LightningFS(filesystemName, { defer: true });
    return { binary: [...await fs.promises.readFile("/migration-binary")],
      mode: (await fs.promises.lstat("/migration-binary")).mode,
      symlink: await fs.promises.readlink("/migration-symlink"),
      dangling: await fs.promises.readlink("/migration-dangling") };
  }, filesystemName);
}

try {
  await server.listen();
  const baseURL = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: "/usr/bin/brave-browser" });

  // Discovery on a fresh origin must not manufacture legacy databases or catalogs.
  const fresh = await newContext(baseURL);
  const freshPage = await openPage(fresh, baseURL);
  assert.deepEqual(await names(freshPage), []);
  await prepare(freshPage);
  let discovered = await names(freshPage);
  assert.ok(legacyDatabaseNames.every(name => !discovered.includes(name)));
  assert.ok(!discovered.includes("v1/catalogs"), "The future OpenAPI catalog namespace must remain unused.");
  await freshPage.evaluate(async () => {
    const settings = await fixture.loadSettings(["default"]);
    if (settings.storageError) throw settings.storageError;
    await fixture.createWorkflowRepository().initialize();
    await fixture.createMetricsHistoryRepository().load();
  });
  discovered = await names(freshPage);
  assert.ok(Object.values(current).every(name => discovered.includes(name)));
  assert.ok(legacyDatabaseNames.every(name => !discovered.includes(name)));
  assert.ok(!discovered.includes("v1/catalogs"));
  await fresh.close();

  const context = await newContext(baseURL);
  const seed = await openPage(context, baseURL);
  const expected = await seed.evaluate(async ({ legacy, savedSettings, document, bars }) => {
    const database = await fixture.openDB(legacy.settings, 1, { upgrade(database) {
      database.createObjectStore("preferences");
      const extra = database.createObjectStore("extra", { keyPath: "id", autoIncrement: true });
      extra.createIndex("labels", "labels", { multiEntry: true });
    } });
    const transaction = database.transaction(["preferences", "extra"], "readwrite");
    for (const [key, value] of Object.entries(savedSettings)) await transaction.objectStore("preferences").put(value, key);
    await transaction.objectStore("extra").put({ id: 4, labels: ["preserve", "schema"], binary: new Uint8Array([0, 128, 255]) });
    await transaction.done;
    database.close();
    const repository = fixture.createWorkflowRepository({ databaseName: legacy.catalog, filesystemName: legacy.workflows });
    const original = await repository.save(document, null, "Create original workflow");
    const second = await repository.save({ ...document, name: "Saved future" }, original.revision, "Save original future");
    await repository.undo(document.id, second.revision);
    const fork = await repository.save({ ...document, name: "Forked workflow" }, original.revision, "Fork saved workflow");
    const latest = await repository.save({ ...document, name: "Redo future" }, fork.revision, "Save redo future");
    const workflow = await repository.undo(document.id, latest.revision);
    const history = await repository.history(document.id);
    const versions = await Promise.all(history.map(revision => repository.readVersion(document.id, revision.oid)));
    const fs = new fixture.LightningFS(legacy.workflows);
    await fs.promises.writeFile(`${fixture.workflowRepositoryPath(document.id)}/untracked-note.txt`, "Local untracked work\n", "utf8");
    await fs.promises.writeFile("/migration-binary", new Uint8Array([0, 128, 255, 10]), { mode: 0o755 });
    await fs.promises.symlink("/migration-binary", "/migration-symlink");
    await fs.promises.symlink("/missing-file", "/migration-dangling");
    await fs.promises.flush();
    await fixture.createMetricsHistoryRepository({ filesystemName: legacy.metrics }).save(bars);
    for (const name of [`${legacy.workflows}_lock`, `${legacy.metrics}_lock`]) {
      const lock = await fixture.openDB(name, 1, { upgrade(database) { database.createObjectStore(name); } });
      await lock.put(name, { holder: "expired-legacy-lock", expires: 0 }, "lock");
      lock.close();
    }
    return { workflow, history, versions };
  }, { legacy, savedSettings, document, bars: [bar(0), bar(1)] });
  assert.equal(expected.history.length, 4);
  assert.ok(expected.history.some(revision => revision.branches.includes("stash-1")));
  assert.equal(expected.workflow.canRedo, true);
  const originalGit = await inspectWorkflow(seed, legacy.workflows, legacy.catalog);
  const originalMetrics = await inspectMetrics(seed, legacy.metrics);
  const originalFiles = await inspectFiles(seed, legacy.workflows);
  await seed.close();

  const page = await openPage(context, baseURL);
  const originalDatabases = await databaseSnapshot(page, legacyDatabaseNames);
  const holder = await openPage(context, baseURL);
  await holder.evaluate(() => new Promise((resolve, reject) => {
    void navigator.locks.request("operations-metrics-recorder-v1", () => new Promise(release => {
      globalThis.releaseRecorder = release;
      resolve();
    })).catch(reject);
  }));
  await assert.rejects(prepare(page), /close|another|other|record|tab/i,
    "An active legacy recorder must prevent copying storage while it can still write.");
  assert.deepEqual(await databaseSnapshot(page, legacyDatabaseNames), originalDatabases);
  await holder.close();
  await page.waitForFunction(async () => !(await navigator.locks.query()).held
    .some(lock => lock.name === "operations-metrics-recorder-v1"));
  // A crashed copy may leave a durable intent marker and partial destination files.
  await page.evaluate(async ({ legacy, current }) => {
    const fs = new fixture.LightningFS(current.workflows);
    await fs.promises.writeFile("/.operations-namespace-migration.json", JSON.stringify({ version: 1,
      source: legacy.workflows, target: current.workflows, state: "copying" }), "utf8");
    await fs.promises.mkdir("/interrupted-copy");
    await fs.promises.writeFile("/interrupted-copy/incomplete.bin", new Uint8Array([1, 2, 3]));
    await fs.promises.flush();
  }, { legacy, current });
  await prepare(page);
  assert.equal(await page.evaluate(async name => {
    const fs = new fixture.LightningFS(name, { defer: true });
    return (await fs.promises.readdir("/")).includes("interrupted-copy");
  }, current.workflows), false);

  const migrated = await loadDefaults(page);
  assert.deepEqual(migrated.settings, { ...savedSettings, locale: { dateFormat: "system", timeFormat: "system", timeZone: "system" }, storageError: null });
  assert.deepEqual(migrated.workflow, expected.workflow);
  assert.deepEqual(migrated.history, expected.history);
  assert.deepEqual(migrated.versions, expected.versions);
  assert.deepEqual(migrated.bars, [bar(0), bar(1)]);
  assert.deepEqual(await inspectWorkflow(page, current.workflows, current.catalog), originalGit);
  assert.deepEqual(await inspectMetrics(page, current.metrics), originalMetrics);
  assert.deepEqual(await inspectFiles(page, current.workflows), originalFiles);
  const copiedSettings = await databaseSnapshot(page, [current.settings]);
  assert.equal(copiedSettings[current.settings].version, originalDatabases[legacy.settings].version);
  for (const [name, store] of Object.entries(originalDatabases[legacy.settings].stores))
    assert.deepEqual(copiedSettings[current.settings].stores[name], store);
  discovered = await names(page);
  assert.ok(legacyDatabaseNames.every(name => !discovered.includes(name)), "Successful migration must remove legacy databases and auxiliary locks.");
  assert.ok(Object.values(current).every(name => discovered.includes(name)));
  assert.ok(!discovered.includes("v1/catalogs"));

  // Repeated startup must retain edits made after the copy instead of replaying old data.
  const edited = await page.evaluate(async ({ id, nextBar }) => {
    await fixture.saveSetting("theme", "light");
    const previous = await workflows.load(id);
    const workflow = await workflows.save({ ...previous.document, name: "Edited after migration" }, previous.revision, "Edit after migration");
    await metrics.save([nextBar]);
    await fixture.prepareStorageNamespaces();
    return workflow;
  }, { id: document.id, nextBar: bar(2) });
  assert.deepEqual((await loadDefaults(page)).workflow, edited);
  await page.close();

  const reloaded = await openPage(context, baseURL);
  await prepare(reloaded);
  const retained = await loadDefaults(reloaded);
  assert.deepEqual(retained.settings, { ...savedSettings, theme: "light", locale: { dateFormat: "system", timeFormat: "system", timeZone: "system" }, storageError: null });
  assert.deepEqual(retained.workflow, edited);
  assert.equal(retained.history.length, 5);
  for (const revision of expected.history) assert.ok(retained.history.some(value => value.oid === revision.oid));
  assert.deepEqual(retained.bars, [bar(0), bar(1), bar(2)]);
  assert.deepEqual(await inspectFiles(reloaded, current.workflows), originalFiles);
  discovered = await names(reloaded);
  assert.ok(legacyDatabaseNames.every(name => !discovered.includes(name)), "Reload must not recreate any removed legacy database.");
  await context.close();

  // A previous app version may have completed the copies but retained backups.
  const backups = await newContext(baseURL);
  const backupSeed = await openPage(backups, baseURL);
  await backupSeed.evaluate(async ({ legacy, current, bar }) => {
    const database = await fixture.openDB(legacy.settings, 1, { upgrade(database) { database.createObjectStore("preferences"); } });
    await database.put("preferences", "dark", "theme");
    database.close();
    await fixture.migrateDatabase(legacy.settings, current.settings);
    await fixture.createMetricsHistoryRepository({ filesystemName: legacy.metrics }).save([bar]);
    await fixture.migrateFilesystem(legacy.metrics, current.metrics);
  }, { legacy, current, bar: bar(0) });
  discovered = await names(backupSeed);
  assert.ok([legacy.settings, legacy.metrics, current.settings, current.metrics].every(name => discovered.includes(name)));
  await backupSeed.close();
  const backupPage = await openPage(backups, baseURL);
  await prepare(backupPage);
  discovered = await names(backupPage);
  assert.ok(legacyDatabaseNames.every(name => !discovered.includes(name)));
  assert.equal(await backupPage.evaluate(async () => (await fixture.loadSettings(["default"])).theme), "dark");
  assert.deepEqual(await backupPage.evaluate(() => fixture.createMetricsHistoryRepository().load()), [bar(0)]);
  await backups.close();

  // Cleanup requires proof that this exact source finished copying to this target.
  const cleanup = await newContext(baseURL);
  const cleanupPage = await openPage(cleanup, baseURL);
  for (const filesystem of [false, true]) {
    const source = `cleanup-old-${filesystem ? "fs" : "db"}`;
    const target = `cleanup-new-${filesystem ? "fs" : "db"}`;
    await cleanupPage.evaluate(async ({ source, target, filesystem }) => {
      for (const name of [source, target]) {
        if (filesystem) {
          const fs = new fixture.LightningFS(name);
          await fs.promises.writeFile("/preserved.bin", new Uint8Array([0, 128, 255]));
          await fs.promises.flush();
        } else {
          const database = await fixture.openDB(name, 1, { upgrade(database) {
            database.createObjectStore("values");
            database.createObjectStore("__operations_namespace_migration__");
          } });
          await database.put("values", "Saved content", "value");
          database.close();
        }
      }
    }, { source, target, filesystem });
    const beforeCleanup = await databaseSnapshot(cleanupPage, [source]);
    for (const marker of [null, { version: 1, source, target, state: "copying" },
      { version: 1, source: "different-source", target, state: "complete" }]) {
      await cleanupPage.evaluate(async ({ target, filesystem, marker }) => {
        if (!marker) return;
        if (filesystem) {
          const fs = new fixture.LightningFS(target);
          await fs.promises.writeFile("/.operations-namespace-migration.json", JSON.stringify(marker), "utf8");
          await fs.promises.flush();
        } else {
          const database = await fixture.openDB(target);
          await database.put("__operations_namespace_migration__", marker, "migration");
          database.close();
        }
      }, { target, filesystem, marker });
      await assert.rejects(cleanupPage.evaluate(({ source, target, filesystem }) =>
        fixture.removeMigratedDatabase(source, target, filesystem), { source, target, filesystem }), /complet|marker|migrat|verif/i);
      assert.deepEqual(await databaseSnapshot(cleanupPage, [source]), beforeCleanup,
        "Unproven cleanup must retain every source record.");
    }
    if (filesystem) continue;
    await cleanupPage.evaluate(async ({ source, target }) => {
      const database = await fixture.openDB(target);
      await database.put("__operations_namespace_migration__", { version: 1, source, target, state: "complete" }, "migration");
      database.close();
      globalThis.heldCleanupSource = await fixture.openDB(source);
    }, { source, target });
    await assert.rejects(cleanupPage.evaluate(({ source, target }) => fixture.removeMigratedDatabase(source, target, false),
      { source, target }), /block|close|time|respond/i, "A live legacy database connection must report blocked deletion.");
    assert.equal(await cleanupPage.evaluate(() => heldCleanupSource.get("values", "value")), "Saved content");
    assert.ok((await names(cleanupPage)).includes(source));
    await cleanupPage.evaluate(() => heldCleanupSource.close());
    await cleanupPage.evaluate(({ source, target }) => fixture.removeMigratedDatabase(source, target, false), { source, target });
    assert.ok(!(await names(cleanupPage)).includes(source));
    const kept = await databaseSnapshot(cleanupPage, [target]);
    assert.deepEqual(kept[target].stores.values.entries, [["value", "Saved content"]]);
  }
  await cleanup.close();
  assert.deepEqual(failures, []);
  pail.force.success("Storage namespaces passed: settings/schema, workflow Git/history/redo/stash, metrics, binary files/symlinks, blocked recorder retry, interrupted copy, proven cleanup, blocked deletion retry, and durable reload.");
} finally {
  await browser?.close();
  await server.close();
}
