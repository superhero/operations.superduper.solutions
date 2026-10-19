// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createFixtureServer, ownedBrowser } from './support.mjs';

// Assertions are advanced by the named steps in legacy-smoke.feature.
export async function* journey(world, variant) {

const fixtureId = "virtual:schema-storage-test";
const server = await createFixtureServer({ configFile: false, root: resolve("src"),
  cacheDir: resolve("tmp/test/schema-storage/.vite"),
  optimizeDeps: { include: ["@isomorphic-git/lightning-fs", "isomorphic-git", "buffer", "idb", "yaml"] },
  server: { host: "127.0.0.1", port: 0, strictPort: true },
  plugins: [{ name: "schema-storage-test-fixture",
    resolveId(id) { if (id === fixtureId) return `\0${fixtureId}`; },
    load(id) { if (id === `\0${fixtureId}`) return `
      export * from '/lib/schema-storage.ts';
      export { default as LightningFS } from '@isomorphic-git/lightning-fs';
      export * as git from 'isomorphic-git';
      export { openDB } from 'idb';
    `; },
  }],
});
const failures = [];
let browser;
let context;
const document = (title, version = "1") => ({ openapi: "3.1.0", info: { title, version },
  servers: [{ url: "https://schema.example.test/api" }],
  paths: { "/items": { get: { operationId: "list", responses: { "200": { description: "OK" } } } } },
});
const record = (id, title) => ({ id, file: "same.openapi.json", document: document(title), enabled: true, createdAt: 100, updatedAt: 100 });

async function importFixture(page) {
  await page.evaluate(async id => { globalThis.fixture = await import(`/@id/${id}`); }, fixtureId);
}
async function history(page, id) { return page.evaluate(id => fixture.getSchemaHistory(id), id); }
async function records(page) { return page.evaluate(() => fixture.loadSchemaDocuments()); }
async function put(page, value) { return page.evaluate(value => fixture.putSchemaDocument(value), value); }
async function move(page, id, targetId, placement) { return page.evaluate(args => fixture.moveSchemaDocument(...args), [id, targetId, placement]); }
async function metadata(page) {
  return page.evaluate(async () => {
    const database = await fixture.openDB("v1/catalogs/index");
    try { return { catalog: await database.getAll("catalog"), pending: await database.getAll("pending"), seeded: await database.get("state", "seeded"), order: await database.get("state", "order") }; }
    finally { database.close(); }
  });
}

try {
  await server.listen();
  const baseURL = server.resolvedUrls.local[0].replace(/\/$/, "");
  browser = ownedBrowser(world);
  context = await browser.newContext();
  await context.route(`${baseURL}/__schema-storage-test`, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Schema storage test</title>" }));
  const page = await context.newPage();
  page.on("pageerror", error => failures.push(error.message));
  await page.goto(`${baseURL}/__schema-storage-test`);
  await importFixture(page);

  const initial = await records(page);
  assert.deepEqual(initial.map(value => value.id), ["demo", "httpbin"]);
  assert.ok(initial.every(value => value.groups?.length));
  for (const id of ["demo", "httpbin"]) assert.equal((await history(page, id)).length, 1);
  assert.equal((await metadata(page)).seeded, true);

  const first = record("schema-first", "First API");
  const second = record("schema-second", "Second API");
  await put(page, first);
  await put(page, second);
  const firstBefore = await history(page, first.id);
  const secondBefore = await history(page, second.id);
  assert.equal(firstBefore.length, 1);
  assert.equal(secondBefore.length, 1);
  assert.notEqual(firstBefore[0].oid, secondBefore[0].oid);
  const savedMetadata = await metadata(page);
  const firstMetadata = savedMetadata.catalog.find(value => value.id === first.id);
  const secondMetadata = savedMetadata.catalog.find(value => value.id === second.id);
  assert.notEqual(firstMetadata.repositoryPath, secondMetadata.repositoryPath);
  assert.equal(firstMetadata.repositoryPath, "/repositories/schema-first");
  assert.ok(savedMetadata.catalog.every(value => !Object.hasOwn(value, "document")), "Document content belongs only to its Git filesystem.");

yield "schema documents have independent repositories and metadata contains no document bodies";
  const replaced = { ...first, document: document("First API replaced", "2"), file: "replacement.yaml", createdAt: 999, updatedAt: 200 };
  const replacementResult = await put(page, replaced);
  assert.equal(replacementResult.createdAt, first.createdAt, "Replacing must preserve creation identity.");
  assert.equal(replacementResult.file, "replacement.yaml");
  const firstAfter = await history(page, first.id);
  assert.equal(firstAfter.length, 2);
  assert.deepEqual(firstAfter[0].parents, [firstBefore[0].oid]);
  assert.deepEqual(await history(page, second.id), secondBefore, "Replacing one document cannot touch the other repository.");
  const previous = await page.evaluate(({ id, oid }) => fixture.readSchemaVersion(id, oid), { id: first.id, oid: firstBefore[0].oid });
  assert.deepEqual(previous, first.document);
  assert.deepEqual(await history(page, first.id), firstAfter, "Reading an older blob must leave the repository head unchanged.");
  assert.equal((await records(page)).find(value => value.id === first.id).document.info.version, "2");

  await page.evaluate(id => fixture.setSchemaDocumentEnabled(id, false), first.id);
  await page.evaluate(id => fixture.setSchemaDocumentEnabled(id, true), first.id);
  await put(page, { ...replacementResult, enabled: true, updatedAt: 202 });
  assert.deepEqual(await history(page, first.id), firstAfter, "Enablement and identical replacements must not create Git commits.");
  const disabled = await page.evaluate(id => fixture.setSchemaDocumentEnabled(id, false), first.id);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.document.info.version, "2");
  assert.deepEqual(await history(page, first.id), firstAfter);
  await put(page, { ...replacementResult, enabled: true });
  assert.equal((await records(page)).find(value => value.id === first.id).enabled, false, "An identical replacement must preserve current enablement too.");

yield "replacement and enablement preserve identity and immutable historical versions";
  const failuresBeforeJournal = await page.evaluate(async value => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (record, ...args) {
      if (this.name === "pending" && record.metadata?.id === value.id) throw new DOMException("Injected journal quota failure", "QuotaExceededError");
      return original.call(this, record, ...args);
    };
    try { await fixture.putSchemaDocument(value); return null; }
    catch (error) { return error.message; }
    finally { IDBObjectStore.prototype.put = original; }
  }, { ...replacementResult, document: document("Failed replacement", "3"), updatedAt: 300 });
  assert.match(failuresBeforeJournal, /Injected journal quota failure/);
  assert.deepEqual(await history(page, first.id), firstAfter);
  assert.equal((await records(page)).find(value => value.id === first.id).document.info.version, "2");
  assert.equal((await metadata(page)).pending.length, 0);

  const failureAfterCommit = await page.evaluate(async value => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (record, ...args) {
      if (this.name === "catalog" && record.id === value.id) throw new DOMException("Injected metadata quota failure", "QuotaExceededError");
      return original.call(this, record, ...args);
    };
    try { await fixture.putSchemaDocument(value); return null; }
    catch (error) { return error.message; }
    finally { IDBObjectStore.prototype.put = original; }
  }, { ...replacementResult, document: document("Recovered replacement", "4"), updatedAt: 400 });
  assert.match(failureAfterCommit, /Injected metadata quota failure/);
  const unfinished = (await metadata(page)).pending;
  assert.equal(unfinished.length, 1);
  assert.equal(Object.hasOwn(unfinished[0], "document"), false);
  assert.equal(Object.hasOwn(unfinished[0].metadata, "document"), false);
  const targetRevision = unfinished[0].revision;
  await page.reload();
  await importFixture(page);
  assert.equal((await records(page)).find(value => value.id === first.id).document.info.version, "4");
  assert.equal((await records(page)).find(value => value.id === first.id).enabled, false, "Replacement must preserve the latest saved enablement.");
  const recoveredHistory = await history(page, first.id);
  assert.equal(recoveredHistory.length, 3);
  assert.equal(recoveredHistory[0].oid, targetRevision, "Recovery must reuse the durable Git commit.");
  assert.equal((await metadata(page)).pending.length, 0);

yield "interrupted schema writes preserve the old revision or recover the durable commit";
  const readOnlyRefresh = await page.evaluate(async () => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (record, ...args) {
      if (["catalog", "pending", "removed", "state"].includes(this.name)) throw new Error("Refresh attempted to write application metadata.");
      return original.call(this, record, ...args);
    };
    try { return (await fixture.loadSchemaDocuments()).length; }
    finally { IDBObjectStore.prototype.put = original; }
  });
  assert.equal(readOnlyRefresh, 4);

  const beforeRename = (await records(page)).find(value => value.id === first.id);
  const renamed = await page.evaluate(id => fixture.renameSchemaDocument(id, "  Renamed API  "), first.id);
  const renamedHistory = await history(page, first.id);
  assert.deepEqual(renamed, { ...beforeRename, document: { ...beforeRename.document,
    info: { ...beforeRename.document.info, title: "Renamed API" } }, updatedAt: renamed.updatedAt,
    revision: renamedHistory[0].oid, gitRevision: renamedHistory[0].oid,
    summary: { ...beforeRename.summary, name: "Renamed API" } },
  "Renaming updates the title, summary and source identity while preserving other content and metadata.");
  assert.ok(renamed.updatedAt > beforeRename.updatedAt);
  assert.equal(renamedHistory.length, recoveredHistory.length + 1);
  assert.equal(renamedHistory[0].message, "Rename OpenAPI schema: Recovered replacement → Renamed API");
  assert.deepEqual(renamedHistory[0].parents, [recoveredHistory[0].oid]);
  assert.deepEqual(await history(page, second.id), secondBefore, "Renaming must not touch another schema's repository.");
  assert.equal((await metadata(page)).catalog.find(value => value.id === first.id).repositoryPath, firstMetadata.repositoryPath);
  const beforeRenameVersion = await page.evaluate(({ id, oid }) => fixture.readSchemaVersion(id, oid),
    { id: first.id, oid: recoveredHistory[0].oid });
  assert.deepEqual(beforeRenameVersion, beforeRename.document, "Rename history retains the previous document.");
  await page.evaluate(id => fixture.renameSchemaDocument(id, " Renamed API "), first.id);
  assert.deepEqual(await history(page, first.id), renamedHistory, "An unchanged name creates no revision.");
  await assert.rejects(page.evaluate(id => fixture.renameSchemaDocument(id, "  "), first.id), /Enter a schema name/);
  assert.deepEqual(await history(page, first.id), renamedHistory, "An invalid name cannot change history.");
  await page.reload();
  await importFixture(page);
  assert.deepEqual((await records(page)).find(value => value.id === first.id), renamed, "The renamed title persists across reloads.");

yield "schema renames preserve other repositories and persist without redundant commits";
  const beforeMove = await records(page);
  const originalOrder = beforeMove.map(value => value.id);
  assert.deepEqual(originalOrder, ["demo", "httpbin", first.id, second.id], "Imports append after existing schemas.");
  await move(page, second.id, first.id, "before");
  const movedOrder = ["demo", "httpbin", second.id, first.id];
  assert.deepEqual((await records(page)).map(value => value.id), movedOrder);
  await move(page, second.id, first.id, "after");
  assert.deepEqual((await records(page)).map(value => value.id), originalOrder);
  await move(page, second.id, "demo", "before");
  assert.deepEqual((await records(page)).map(value => value.id), [second.id, "demo", "httpbin", first.id], "Moving across multiple cards preserves every other card's order.");
  await move(page, second.id, first.id, "after");
  assert.deepEqual((await records(page)).map(value => value.id), originalOrder);
  await move(page, second.id, first.id, "before");
  await page.evaluate(async ({ id, targetId }) => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (record, ...args) {
      if (this.name === "state") throw new Error("An unchanged order attempted a metadata write.");
      return original.call(this, record, ...args);
    };
    try {
      await fixture.moveSchemaDocument(id, id, "after");
      await fixture.moveSchemaDocument(id, targetId, "before");
    }
    finally { IDBObjectStore.prototype.put = original; }
  }, { id: second.id, targetId: first.id });
  await assert.rejects(move(page, second.id, "missing-schema", "before"), /could not be found/);
  assert.deepEqual((await metadata(page)).order, movedOrder, "Self-drops, unchanged placements and missing targets keep the current order.");
  await page.reload();
  await importFixture(page);
  assert.deepEqual((await records(page)).map(value => value.id), movedOrder, "Order persists across reloads.");
  assert.deepEqual(await history(page, first.id), renamedHistory, "Moving cards creates no schema revisions.");
  assert.deepEqual(await history(page, second.id), secondBefore);
  await page.evaluate(id => fixture.renameSchemaDocument(id, "Renamed again"), first.id);
  assert.deepEqual((await records(page)).map(value => value.id), movedOrder, "Document edits retain the selected order.");

  // Older metadata without an ordering uses a stable fallback; stale or duplicate IDs are ignored.
  const fallbackOrder = [...beforeMove].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)).map(value => value.id);
  await page.evaluate(async () => {
    const database = await fixture.openDB("v1/catalogs/index");
    try { await database.delete("state", "order"); } finally { database.close(); }
  });
  assert.deepEqual((await records(page)).map(value => value.id), fallbackOrder);
  await page.evaluate(async id => {
    const database = await fixture.openDB("v1/catalogs/index");
    try { await database.put("state", ["missing-schema", id, id], "order"); } finally { database.close(); }
  }, second.id);
  assert.deepEqual((await records(page)).map(value => value.id), [second.id, ...fallbackOrder.filter(id => id !== second.id)]);
  await page.evaluate(async order => {
    const database = await fixture.openDB("v1/catalogs/index");
    try { await database.put("state", order, "order"); } finally { database.close(); }
  }, movedOrder);
  const appended = { ...record("schema-appended", "Appended API"), createdAt: 0 };
  await put(page, appended);
  assert.deepEqual((await records(page)).map(value => value.id), [...movedOrder, appended.id], "New imports append regardless of imported timestamps.");
  await page.evaluate(id => fixture.deleteSchemaDocument(id), appended.id);
  assert.deepEqual((await metadata(page)).order, movedOrder, "Deletion removes stale order entries.");

yield "schema ordering survives reload and ignores stale duplicate or unchanged placements";
  await page.evaluate(id => fixture.deleteSchemaDocument(id), first.id);
  assert.equal((await records(page)).some(value => value.id === first.id), false);
  assert.deepEqual(await history(page, second.id), secondBefore);
  assert.equal((await page.evaluate(async id => {
    try { await fixture.getSchemaHistory(id); return "found"; } catch (error) { return error.message; }
  }, first.id)).includes("could not be found"), true);
  // Inspect the shared filesystem after CRUD releases its own LightningFS lease.
  const repositories = await page.evaluate(async () => {
    const filesystem = new fixture.LightningFS("v1/catalogs", { defer: true });
    return filesystem.promises.readdir("/repositories");
  });
  assert.ok(!repositories.includes(first.id));
  assert.ok(repositories.includes(second.id));

  for (const value of await records(page)) await page.evaluate(id => fixture.deleteSchemaDocument(id), value.id);
  await page.reload();
  await importFixture(page);
  assert.deepEqual(await records(page), [], "An intentionally empty catalog must remain empty after reload.");
  assert.equal((await metadata(page)).seeded, true);
yield "schema deletion removes only its repository and an intentionally empty catalog stays empty";
  assert.deepEqual(failures, []);

}
finally {
  await context?.close();
  await browser?.close();
  await server.close();
}

}
