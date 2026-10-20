// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { Then } from "@cucumber/cucumber";
import { repository } from "./workflow-storage.fixture.mjs";
import { expect } from "@playwright/test";
import { extractOperations, operations } from "../../src/lib/catalog.ts";
import { bundledCatalogs, catalogForOperation } from "../../src/lib/catalog-registry.ts";
import legacyRevisions from "../../src/catalogs/example-revisions.json" with { type: "json" };
import { createOperationGraph } from "../../src/lib/workflow-graph.ts";
import { chooseCatalogOperation, fillField, includeField, openCatalog, revealCatalogOperation, setMode, workflowAction, workspace } from "./workspace.steps.mjs";

const operation = id => operations.find(item => item.id === id);
const graph = id => createOperationGraph(operation(id), { x: 0, y: 0 }, id, catalogForOperation(id).document);
const runDialog = page => page.getByRole("dialog", { name: "Run workflow: Example requests", exact: true });
async function openRun(page, graphs, edges = []) {
  const doc = { version: 3, id: "examples-browser", name: "Example requests", nodes: graphs.flatMap(item => item.nodes),
    edges: [...graphs.flatMap(item => item.edges), ...edges], viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false };
  await repository(page, 'save', doc, null);
  await page.reload();
  await setMode(page, "workflow");
  await workflowAction(page, "Run");
  await expect(runDialog(page)).toBeVisible();
  return runDialog(page);
}
async function fillRun(page, label, value) {
  const run = runDialog(page);
  await includeField(page, label);
  const select = run.getByRole("combobox", { name: label, exact: true });
  if (await select.count()) {
    await select.click();
    await page.getByRole("option", { name: value, exact: true }).click();
  } else await run.getByRole("textbox", { name: label, exact: true })
    .or(run.getByRole("textbox", { name: `${label} value`, exact: true }))
    .or(run.getByRole("spinbutton", { name: label, exact: true })).fill(value);
}
async function interceptHttpbin(page) {
  const requests = [];
  await page.route("https://httpbin.org/**", async route => {
    const request = route.request();
    requests.push({ method: request.method(), url: request.url(), headers: request.headers(), body: request.postData() });
    const empty = ["HEAD", "OPTIONS"].includes(request.method());
    await route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" },
      contentType: empty ? "text/html" : "application/json", body: empty ? "" : JSON.stringify({ received: true }) });
  });
  return requests;
}
async function submitRun(page, name = "Start workflow") {
  await runDialog(page).getByRole("button", { name, exact: true }).click();
  await expect(runDialog(page).getByRole("status")).toHaveText("Operation completed.");
}

let legacyExamples;
async function legacyExamplesFor(version) {
  legacyExamples ??= readFile(new URL('../fixtures/bundled-examples/legacy.json.gz', import.meta.url))
    .then(bytes => JSON.parse(gunzipSync(bytes)));
  const entries = await legacyExamples;
  const selected = entries.filter(entry => entry.id === 'httpbin' || entry.version === version);
  for (const entry of selected) {
    const known = legacyRevisions.find(revision => revision.id === entry.id && revision.sourceCommit === entry.sourceCommit);
    for (const key of ['document', 'groups']) {
      const text = `${JSON.stringify(entry[key], null, 2)}\n`;
      assert.equal(createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex'), known[key]);
    }
  }
  return structuredClone(selected);
}

async function savedExampleState(page) {
  return page.evaluate(async () => {
    const api = await import('/schema-lifecycle-fixture.js');
    const metadata = await api.listSchemaMetadata();
    const examples = [];
    for (const record of metadata.filter(record => ['demo', 'httpbin'].includes(record.id))) {
      examples.push({ record: await api.readSchemaDocument(record.id), history: await api.getSchemaHistory(record.id),
        names: record.enabled ? (await api.readSchemaDiscovery(record.id)).operations.map(operation => operation.name) : [] });
    }
    return { order: metadata.map(record => record.id), examples };
  });
}

async function seedLegacyExamples(page, entries, authored = false) {
  await page.evaluate(async ({ entries, authored }) => {
    const api = await import('/schema-lifecycle-fixture.js');
    for (const entry of entries) {
      const record = await api.readSchemaDocument(entry.id);
      await api.putSchemaDocument({ ...record, document: entry.document, groups: entry.groups });
    }
    if (authored) await api.deleteSchemaDocument('httpbin');
    else {
      await api.setSchemaDocumentEnabled('httpbin', false);
    }
    // Reproduce a browser installation from before bundled-example version tracking.
    await api.editStore('state', 'exampleRevisions', 'delete');
  }, { entries, authored });
  return savedExampleState(page);
}

Then('saved {string} examples update their labels and keep saved workflows', async function (version) {
  const page = this.page;
  const entries = await legacyExamplesFor(version);
  const demo = entries.find(entry => entry.id === 'demo');
  if (version === 'extended') demo.groups[0].name = 'My example category';
  const before = await seedLegacyExamples(page, entries);
  assert.ok(before.examples.find(example => example.record.id === 'demo').names.includes('Get project'));
  const oldOperation = extractOperations(demo.document, 'demo').find(operation => operation.id === 'demo:getProject');
  const oldGraph = createOperationGraph(oldOperation, { x: 0, y: 0 }, 'saved-example', demo.document);
  await openRun(page, [oldGraph]);
  await fillRun(page, 'Path value', 'saved-example');
  await submitRun(page);
  assert.equal(this.exampleRequests.at(-1).url, 'https://example.com/projects/saved-example');
  await runDialog(page).getByRole('button', { name: 'Quit', exact: true }).click();

  const after = await savedExampleState(page);
  assert.deepEqual(after.order.filter(id => ['demo', 'httpbin'].includes(id)), ['demo', 'httpbin']);
  for (const example of after.examples) {
    const original = before.examples.find(entry => entry.record.id === example.record.id);
    const current = bundledCatalogs.find(catalog => catalog.id === example.record.id);
    assert.deepEqual(example.record.document, current.document);
    assert.equal(example.record.enabled, original.record.enabled);
    assert.equal(example.record.createdAt, original.record.createdAt);
    assert.deepEqual(example.history.slice(1), original.history);
    assert.deepEqual(example.history[0].parents, [original.history[0].oid]);
    assert.match(example.history[0].message, /^Update bundled OpenAPI example:/);
    assert.deepEqual(example.record.groups, version === 'extended' && current.id === 'demo' ? demo.groups : current.groups);
    const oldDocument = await page.evaluate(async ({ id, oid }) =>
      (await import('/schema-lifecycle-fixture.js')).readSchemaVersion(id, oid), { id: current.id, oid: original.history[0].oid });
    assert.deepEqual(oldDocument, original.record.document);
  }
  for (const name of ['Example array response', 'Example object response', 'Example POST body', 'Example PATCH body'])
    await expect((await revealCatalogOperation(page, name)).getByRole('button', { name: `Add to workflow: ${name}`, exact: true })).toBeVisible();
  const catalog = page.getByRole('navigation', { name: 'Operation catalog', exact: true });
  for (const name of ['List projects', 'Get project', 'Create task', 'Update task'])
    await expect(catalog.getByText(name, { exact: true })).toHaveCount(0);
  await page.reload();
  await setMode(page, 'workflow');
  const repeated = await savedExampleState(page);
  assert.deepEqual(repeated, after, 'A later startup must not append duplicate migrations');
});

Then('updating bundled examples preserves edited and deleted schemas', async function () {
  const page = this.page;
  const entries = await legacyExamplesFor('extended');
  const demo = entries.find(entry => entry.id === 'demo');
  demo.document.info.title = 'My edited examples';
  demo.document.paths['/projects/{projectId}'].get.summary = 'My custom operation';
  const before = await seedLegacyExamples(page, entries, true);
  await page.reload();
  await setMode(page, 'workflow');
  assert.deepEqual(await savedExampleState(page), before);
  await expect((await revealCatalogOperation(page, 'My custom operation'))
    .getByRole('button', { name: 'Add to workflow: My custom operation', exact: true })).toBeVisible();
  await setMode(page, 'settings');
  await page.locator('summary[aria-label="Schemas"]').click();
  await expect(page.locator('[data-schema-id="httpbin"]')).toHaveCount(0);
});

Then("both example catalogs prepare typed query and header values", async function () {
  const page = this.page;
  await interceptHttpbin(page);
  await openCatalog(page);
  const catalog = page.getByRole("navigation", { name: "Operation catalog", exact: true });
  for (const name of ["example.com", "httpbin.org"])
    await expect(catalog.getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByText("Demo catalog · 4 operations", { exact: true })).toHaveCount(0);
  await chooseCatalogOperation(page, "HTTPBin query and header inputs");
  for (const [label, value] of Object.entries({ "Sample ID": "space / value", Label: "blue", Count: "3", Ratio: "0.5",
    Enabled: "false", Priority: "high", Tags: '["one","two"]', "Example header": "header value" }))
    await fillField(page, label, value);
  await page.getByRole("button", { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
  const preview = JSON.parse(await workspace(page).getByRole("region", { name: /^(Prepared request|Step \d+ prepared request)$/ }).textContent());
  assert.equal(preview.path, "/anything/parameters/space%20%2F%20value");
  assert.deepEqual(preview.query, { label: "blue", count: 3, ratio: 0.5, enabled: false, priority: "high", tags: ["one", "two"] });
  assert.deepEqual(preview.headers, { "X-Example-Label": "header value" });
});

Then("structured example fields validate JSON and preserve nested types", async function () {
  const page = this.page;
  await interceptHttpbin(page);
  await chooseCatalogOperation(page, "HTTPBin JSON object");
  await fillField(page, "Profile", '{"name":');
  await page.getByRole("button", { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
  await expect(workspace(page).getByRole("alert")).toContainText("enter valid JSON");
  await expect(workspace(page).getByRole("textbox", { name: "Profile", exact: true })).toBeFocused();
  await fillField(page, "Profile", '{"name":"Ada","count":3}');
  await fillField(page, "Tags", '["docs","api"]');
  await fillField(page, "Null value", "null");
  await fillField(page, "Count", "2");
  await fillField(page, "Enabled", "false");
  await page.getByRole("button", { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
  const preview = JSON.parse(await workspace(page).getByRole("region", { name: /^(Prepared request|Step \d+ prepared request)$/ }).textContent());
  assert.deepEqual(preview.body, { profile: { name: "Ada", count: 3 }, tags: ["docs", "api"], note: null, count: 2, enabled: false });
});

Then("the live example sends a {string} request", async function (method) {
  const page = this.page;
  const requests = await interceptHttpbin(page);
  const op = operations.find(item => item.id.startsWith("httpbin:echo") && item.method === method);
  const run = await openRun(page, [graph(op.id)]);
  await expect(run).toContainText("Server: https://httpbin.org");
  await submitRun(page);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, method);
  assert.equal(requests[0].url, `https://httpbin.org${op.path}`);
  await expect(run.getByRole("region", { name: "Step 1 response", exact: true }))
    .toContainText(["HEAD", "OPTIONS"].includes(method) ? "No response body." : "received");
});

Then("the live example encodes a {string} body", async function (kind) {
  const page = this.page;
  const requests = await interceptHttpbin(page);
  await openRun(page, [graph(`httpbin:echo${kind}`)]);
  const fields = {
    JsonObject: { Label: "body example", Count: "2", Enabled: "false", Profile: '{"name":"Ada","count":3}', Tags: '["api"]', "Null value": "null" },
    JsonArray: { "Example array": '["one","two"]' }, JsonScalar: { "Example scalar": "a JSON string" },
    PlainText: { "Text body": "first line\nsecond line" },
    UrlEncoded: { Name: "Ada & Bob", Message: "a=b + c" }, Multipart: { Name: "Ada & Bob", Message: "a=b + c" }
  }[kind];
  for (const [label, value] of Object.entries(fields)) await fillRun(page, label, value);
  await submitRun(page);
  assert.equal(requests.length, 1);
  const sent = requests[0];
  assert.equal(sent.method, "POST");
  if (kind === "JsonObject") assert.deepEqual(JSON.parse(sent.body), { label: "body example", count: 2, enabled: false,
    profile: { name: "Ada", count: 3 }, tags: ["api"], note: null });
  else if (kind === "JsonArray") assert.deepEqual(JSON.parse(sent.body), ["one", "two"]);
  else if (kind === "JsonScalar") assert.equal(JSON.parse(sent.body), "a JSON string");
  else if (kind === "PlainText") { assert.equal(sent.headers["content-type"], "text/plain"); assert.equal(sent.body, "first line\nsecond line"); }
  else if (kind === "UrlEncoded") {
    assert.equal(sent.headers["content-type"], "application/x-www-form-urlencoded");
    assert.deepEqual(Object.fromEntries(new URLSearchParams(sent.body)), { name: "Ada & Bob", message: "a=b + c" });
  } else {
    assert.match(sent.headers["content-type"], /^multipart\/form-data; boundary=/);
    assert.match(sent.body, /name="name"\r\n\r\nAda & Bob/);
    assert.match(sent.body, /name="message"\r\n\r\na=b \+ c/);
  }
  if (kind.startsWith("Json")) assert.equal(sent.headers["content-type"], "application/json");
});

Then("a mixed workflow passes an HTTP response array to the next schema", async function () {
  const page = this.page;
  const requests = await interceptHttpbin(page);
  const example = graph("demo:mockJsonArray");
  const live = graph("httpbin:echoJsonArray");
  const output = example.nodes.find(node => node.type === "data" && node.data.direction === "outputs" && node.data.fields.some(field => field.name === "json" || field.label === "Example array"));
  const outputField = output.data.fields.find(field => field.name === "json" || field.label === "Example array");
  const input = live.nodes.find(node => node.type === "data" && node.data.direction === "inputs");
  const inputField = input.data.fields.find(field => field.label === "Items");
  const run = await openRun(page, [example, live], [{ id: "array-mapping", kind: "mapping", source: output.id,
    sourceHandle: outputField.id, target: input.id, targetHandle: inputField.id }]);
  await expect(run).toContainText("Server: https://example.com");
  await fillRun(page, "Example array", '["shared","values"]');
  await submitRun(page);
  assert.equal(requests.length, 0);
  assert.equal(this.exampleRequests.length, 1);
  assert.equal(this.exampleRequests[0].method, "POST");
  assert.deepEqual(JSON.parse(this.exampleRequests[0].body), ["shared", "values"]);
  await run.getByRole("button", { name: "Next operation", exact: true }).click();
  await expect(run).toContainText("Server: https://httpbin.org");
  await expect(run.getByRole("textbox", { name: "Example array", exact: true })).toBeDisabled();
  await submitRun(page, "Run operation");
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].body), ["shared", "values"]);
});
