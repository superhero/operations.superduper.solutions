// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { operations } from "../../src/lib/catalog.ts";
import { catalogForOperation } from "../../src/lib/catalog-registry.ts";
import { createOperationGraph } from "../../src/lib/workflow-graph.ts";
import { chooseCatalogOperation, fillField, openCatalog, setMode, workflowAction, workspace } from "./workspace.steps.mjs";

const operation = id => operations.find(item => item.id === id);
const graph = id => createOperationGraph(operation(id), { x: 0, y: 0 }, id, catalogForOperation(id).document);
const runDialog = page => page.getByRole("dialog", { name: "Run workflow: Example requests", exact: true });
async function openRun(page, graphs, edges = []) {
  const doc = { version: 3, id: "examples-browser", name: "Example requests", nodes: graphs.flatMap(item => item.nodes),
    edges: [...graphs.flatMap(item => item.edges), ...edges], viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false };
  await page.evaluate(doc => localStorage.setItem("operations-flow-documents-v1", JSON.stringify([doc])), doc);
  await page.reload();
  await setMode(page, "workflow");
  await workflowAction(page, "Run");
  await expect(runDialog(page)).toBeVisible();
  return runDialog(page);
}
async function fillRun(page, label, value) {
  const run = runDialog(page);
  const select = run.getByRole("combobox", { name: label, exact: true });
  if (await select.count()) {
    await select.click();
    await page.getByRole("option", { name: value, exact: true }).click();
  } else await run.getByRole("textbox", { name: label, exact: true })
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
  await page.getByRole("button", { name: "Execute operation", exact: true }).click();
  const preview = JSON.parse(await workspace(page).getByRole("region", { name: "Prepared request", exact: true }).textContent());
  assert.equal(preview.path, "/anything/parameters/space%20%2F%20value");
  assert.deepEqual(preview.query, { label: "blue", count: 3, ratio: 0.5, enabled: false, priority: "high", tags: ["one", "two"] });
  assert.deepEqual(preview.headers, { "X-Example-Label": "header value" });
});

Then("structured example fields validate JSON and preserve nested types", async function () {
  const page = this.page;
  await interceptHttpbin(page);
  await chooseCatalogOperation(page, "HTTPBin JSON object");
  await fillField(page, "Profile", '{"name":');
  await page.getByRole("button", { name: "Execute operation", exact: true }).click();
  await expect(workspace(page).getByRole("alert")).toContainText("enter valid JSON");
  await expect(workspace(page).getByRole("textbox", { name: "Profile", exact: true })).toBeFocused();
  await fillField(page, "Profile", '{"name":"Ada","count":3}');
  await fillField(page, "Tags", '["docs","api"]');
  await fillField(page, "Null value", "null");
  await fillField(page, "Count", "2");
  await fillField(page, "Enabled", "false");
  await page.getByRole("button", { name: "Execute operation", exact: true }).click();
  const preview = JSON.parse(await workspace(page).getByRole("region", { name: "Prepared request", exact: true }).textContent());
  assert.deepEqual(preview.body, { profile: { name: "Ada", count: 3 }, tags: ["docs", "api"], note: null, count: 2, enabled: false });
});

Then("the live example sends a {string} request", async function (method) {
  const page = this.page;
  const requests = await interceptHttpbin(page);
  const op = operations.find(item => item.id.startsWith("httpbin:echo") && item.method === method);
  const run = await openRun(page, [graph(op.id)]);
  await expect(run).toContainText("Live example: https://httpbin.org");
  await submitRun(page);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, method);
  assert.equal(requests[0].url, `https://httpbin.org${op.path}`);
  await expect(run.getByRole("region", { name: "Step 1 response", exact: true }))
    .toContainText(["HEAD", "OPTIONS"].includes(method) ? "null" : "received");
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
  await expect(run).toContainText("Live example: https://example.com");
  await fillRun(page, "Example array", '["shared","values"]');
  await submitRun(page);
  assert.equal(requests.length, 0);
  assert.equal(this.exampleRequests.length, 1);
  assert.equal(this.exampleRequests[0].method, "POST");
  assert.deepEqual(JSON.parse(this.exampleRequests[0].body), ["shared", "values"]);
  await run.getByRole("button", { name: "Next operation", exact: true }).click();
  await expect(run).toContainText("Live example: https://httpbin.org");
  await expect(run.getByRole("textbox", { name: "Example array", exact: true })).toBeDisabled();
  await submitRun(page, "Run operation");
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].body), ["shared", "values"]);
});
