// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { chooseCatalogOperation, fillField, workspace, setMode } from "./workspace.fixture.mjs";
import { mkdir } from "node:fs/promises";

const responsePanel = workspace;
const responseBody = page => page.getByRole("region", { name: "Response body", exact: true });
const execute = page => page.getByRole("button", { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
const reply = (route, body, status = 200) => route.fulfill({ status,
  headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify(body) });
const readBody = async page => JSON.parse(await responseBody(page).locator(".json-tree").evaluate(element => {
  const document = element.cloneNode(true);
  for (const icon of document.querySelectorAll(".json-toggle")) icon.remove();
  return document.textContent;
}));

Then('streamed operation progress at {int} pixels stays stable until cancellation or an explicit terminal result', async function (width) {
  const page = this.page;
  await page.setViewportSize({ width, height: 900 });
  const name = 'Bounded response stream';
  const document = { openapi: '3.1.0', info: { title: 'Streaming browser fixture', version: '1' }, servers: [{ url: 'https://httpbin.org' }],
    paths: { '/stream-fixture': { post: { operationId: 'stream-fixture', summary: name, 'x-operations-response-stream': 'openai-responses',
      responses: { 200: { description: 'Final response', content: {
        'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } },
        'text/event-stream': { schema: { type: 'object' } } } } } } } } };
  await page.evaluate(() => {
    const original = window.fetch.bind(window), encoder = new TextEncoder();
    const state = window.__streamFixture = { calls: 0, cancelled: false };
    window.fetch = async (input, init) => {
      if (String(input) !== 'https://httpbin.org/stream-fixture') return original(input, init);
      const attempt = ++state.calls;
      let timer;
      return new Response(new ReadableStream({ start(controller) {
        const event = value => controller.enqueue(encoder.encode('event: '+value.type+'\ndata: '+JSON.stringify(value)+'\n\n'));
        if (attempt === 1) {
          event({ type: 'response.output_text.delta', delta: 'incomplete text must not be a result' });
          timer = setTimeout(() => event({ type: 'response.output_text.delta', delta: 'still incomplete' }), 700);
        } else event({ type: 'response.completed', response: { id: 'resp_browser_fixture', object: 'response', status: 'completed', error: null, output: [] } });
      }, cancel() { clearTimeout(timer); state.cancelled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await setMode(page, 'settings');
  const schemas = page.locator('summary[aria-label="Schemas"]');
  if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({
    name: 'streaming-browser.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await expect(page.getByRole('switch', { name: 'Enable Streaming browser fixture', exact: true })).toHaveAttribute('aria-checked', 'true');
  await chooseCatalogOperation(page, name);
  await execute(page);
  const progress = page.getByRole('status', { name: 'Response progress', exact: true });
  await expect(progress).toContainText('Receiving response');
  const before = await progress.boundingBox();
  const footerBefore = await page.getByRole('button', { name: 'Cancel request', exact: true }).boundingBox();
  await expect(progress).toContainText('2 updates');
  assert.deepEqual(await progress.boundingBox(), before, 'Progress updates must preserve the reserved layout.');
  assert.deepEqual(await page.getByRole('button', { name: 'Cancel request', exact: true }).boundingBox(), footerBefore);
  await expect(page.getByRole('button', { name: 'Sending request…', exact: true })).toBeDisabled();
  await expect(responseBody(page)).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.__streamFixture.calls), 1);
  await page.getByRole('button', { name: 'Cancel request', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__streamFixture.cancelled)).toBe(true);
  await expect(page.getByRole('button', { name: 'Retry operation', exact: true })).toBeEnabled();
  assert.equal(await page.evaluate(() => window.__streamFixture.calls), 1, 'Cancellation must not replay a write.');
  await execute(page);
  await expect(responseBody(page)).toContainText('resp_browser_fixture');
  assert.equal(await page.evaluate(() => window.__streamFixture.calls), 2, 'Only the explicit retry may dispatch again.');
  assert.equal((await readBody(page)).id, 'resp_browser_fixture');
  await mkdir(this.artifactDirectory, { recursive: true });
  await page.screenshot({ path: `${this.artifactDirectory}/streaming-result-${width}.png` });
});

async function expectServerMetadata(page, url) {
  await expect(workspace(page).getByText(/^Live request/)).toHaveCount(0);
  await page.getByRole("button", { name: "Review operation details", exact: true }).click();
  const metadata = page.getByRole("region", { name: "Operation metadata", exact: true });
  await expect(metadata.locator("dt").filter({ hasText: /^Server URL$/ }).locator("xpath=following-sibling::dd[1]")).toHaveText(url);
  await expect(metadata.locator("dt").filter({ hasText: /^(Host|URL)$/ })).toHaveCount(0);
}

async function intercept(page, respond) {
  const requests = [];
  await page.route("https://httpbin.org/**", async route => {
    const request = route.request();
    requests.push({ method: request.method(), url: request.url(), headers: request.headers(), body: request.postData() });
    await respond(route, requests.length);
  });
  return requests;
}

function removeExpectedFailureDiagnostics(world, kind) {
  world.diagnostics = world.diagnostics.filter(item => !(kind === "http"
    ? item.type === "http-error" && item.url.startsWith("https://httpbin.org/") && item.status === 422
      || item.type === "console-error" && /Failed to load resource.*422/.test(item.message)
    : item.type === "console-error" && /Failed to load resource: net::ERR_CONNECTION_REFUSED/.test(item.message)));
}

Then("workflow operation execution sends the encoded query and headers and displays the received response", async function () {
  const page = this.page;
  const received = { server: "actual request result", nested: { count: 9, enabled: false } };
  const requests = await intercept(page, route => reply(route, received));
  await chooseCatalogOperation(page, "HTTPBin query and header inputs");
  for (const [label, value] of Object.entries({ "Sample ID": "space / value", Label: "blue & green", Count: "3", Ratio: "0.5",
    Enabled: "false", Priority: "high", Tags: '["one","two"]', "Example header": "header value" })) await fillField(page, label, value);
  await execute(page);
  await expect(responseBody(page)).toContainText("actual request result");
  assert.equal(requests.length, 1);
  const sent = requests[0];
  const url = new URL(sent.url);
  assert.equal(sent.method, "GET");
  assert.equal(url.origin, "https://httpbin.org");
  assert.equal(url.pathname, "/anything/parameters/space%20%2F%20value");
  assert.deepEqual([...url.searchParams], [["label", "blue & green"], ["count", "3"], ["ratio", "0.5"],
    ["enabled", "false"], ["priority", "high"], ["tags", "one"], ["tags", "two"]]);
  assert.equal(sent.headers["x-example-label"], "header value");
  assert.equal(sent.body, null);
  assert.deepEqual(await readBody(page), received);
  await expect(responsePanel(page)).toContainText("HTTP 200");
  await expectServerMetadata(page, "https://httpbin.org");
});

Then("workflow operation execution sends structured JSON and displays the received response", async function () {
  const page = this.page;
  const received = { saved: true, identifier: "server-assigned-42" };
  const requests = await intercept(page, route => reply(route, received, 201));
  await chooseCatalogOperation(page, "HTTPBin JSON object");
  for (const [label, value] of Object.entries({ Label: "submitted value", Count: "2", Enabled: "false",
    Profile: '{"name":"Ada","count":3}', Tags: '["docs","api"]', "Null value": "null" })) await fillField(page, label, value);
  await execute(page);
  await expect(responseBody(page)).toContainText("server-assigned-42");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(requests[0].body), { label: "submitted value", count: 2, enabled: false,
    profile: { name: "Ada", count: 3 }, tags: ["docs", "api"], note: null });
  assert.deepEqual(await readBody(page), received);
  await expect(responsePanel(page)).toContainText("HTTP 201");
});

Then("workflow operation execution displays an HTTP error body and can retry successfully", async function () {
  const page = this.page;
  const failure = { error: "The server rejected this request", code: "invalid-example" };
  const requests = await intercept(page, (route, count) => reply(route, count === 1 ? failure : { retried: true }, count === 1 ? 422 : 200));
  await chooseCatalogOperation(page, "HTTPBin GET request");
  await execute(page);
  await expect(responsePanel(page).getByRole("alert")).toContainText("422");
  await expect(responsePanel(page)).toContainText("HTTP 422");
  assert.deepEqual(await readBody(page), failure);
  await responsePanel(page).getByRole("button", { name: "Retry operation", exact: true }).click();
  await expect(responseBody(page)).toContainText("retried");
  await expect(responsePanel(page).getByRole("alert")).toHaveCount(0);
  await expect(responsePanel(page)).toContainText("HTTP 200");
  assert.equal(requests.length, 2);
  removeExpectedFailureDiagnostics(this, "http");
});

Then("workflow operation execution reports connection failure and can retry successfully", async function () {
  const page = this.page;
  const requests = await intercept(page, (route, count) => count === 1 ? route.abort("connectionrefused") : reply(route, { connected: true }));
  await chooseCatalogOperation(page, "HTTPBin GET request");
  await execute(page);
  await expect(responsePanel(page).getByRole("alert")).toContainText("could not reach https://httpbin.org");
  await expect(responseBody(page)).toHaveCount(0);
  await responsePanel(page).getByRole("button", { name: "Retry operation", exact: true }).click();
  await expect(responseBody(page)).toContainText("connected");
  await expect(responsePanel(page).getByRole("alert")).toHaveCount(0);
  assert.equal(requests.length, 2);
  removeExpectedFailureDiagnostics(this, "network");
});

Then("pending workflow operation execution prevents duplicates and supports cancellation and retry", async function () {
  const page = this.page;
  let pendingRoute;
  const requests = await intercept(page, async (route, count) => {
    if (count === 1) pendingRoute = route;
    else await reply(route, { retried: true });
  });
  await chooseCatalogOperation(page, "HTTPBin GET request");
  await execute(page);
  await expect.poll(() => requests.length).toBe(1);
  await expect(responsePanel(page).getByRole("button", { name: "Sending request…", exact: true })).toBeDisabled();
  // A second submit from the still-mounted form must not start a concurrent request.
  await workspace(page).locator('[aria-label="Current workflow operation"] form').dispatchEvent("submit");
  await responsePanel(page).getByRole("button", { name: "Cancel request", exact: true }).click();
  await expect(responsePanel(page)).toContainText("cancelled");
  await expect(responsePanel(page).getByRole("button", { name: "Cancel request", exact: true })).toHaveCount(0);
  assert.equal(requests.length, 1);
  await pendingRoute.abort("aborted");
  await responsePanel(page).getByRole("button", { name: "Retry operation", exact: true }).click();
  await expect(responseBody(page)).toContainText("retried");
  assert.equal(requests.length, 2);
});

Then("switching operation ignores a late response", async function () {
  const page = this.page;
  let pendingRoute;
  const requests = await intercept(page, async (route, count) => {
    if (count === 1) pendingRoute = route;
    else await reply(route, { current: "second operation" });
  });
  await chooseCatalogOperation(page, "HTTPBin GET request");
  await execute(page);
  await expect.poll(() => requests.length).toBe(1);
  await chooseCatalogOperation(page, "HTTPBin POST request");
  await expect(responseBody(page)).toHaveCount(0);
  await execute(page);
  await expect(responseBody(page)).toContainText("second operation");
  await reply(pendingRoute, { obsolete: "first operation" });
  await expect(responsePanel(page).getByRole("heading", { name: "1. httpbin.org / HTTPBin POST request", exact: true })).toBeVisible();
  assert.deepEqual(await readBody(page), { current: "second operation" });
  await expect(responsePanel(page).getByRole("alert")).toHaveCount(0);
  assert.equal(requests.length, 2);
});

Then("workflow example execution displays server data from an actual request", async function () {
  const page = this.page;
  const requests = [];
  const received = { id: "server-project", name: "Data from the HTTP endpoint", status: "received" };
  await page.route("https://example.com/**", async route => {
    requests.push({ method: route.request().method(), url: route.request().url() });
    await reply(route, received);
  });
  await chooseCatalogOperation(page, "Example object response");
  await fillField(page, "Path value", "project-2");
  await execute(page);
  await expect(responseBody(page)).toContainText("Data from the HTTP endpoint");
  assert.deepEqual(await readBody(page), received);
  await expect(responseBody(page)).not.toContainText("Website");
  await expectServerMetadata(page, "https://example.com");
  assert.deepEqual(requests, [{ method: "GET", url: "https://example.com/projects/project-2" }]);
});

Then('a binary operation at {int} pixels displays a bounded file and downloads exact bytes', async function (width) {
  const page = this.page;
  await page.setViewportSize({ width, height: 900 });
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
  const name = 'Exact binary download';
  const document = { openapi: '3.1.0', info: { title: 'Binary download fixture', version: '1' }, servers: [{ url: 'https://httpbin.org' }],
    paths: { '/exact-download': { get: { operationId: 'download-exact', summary: name, responses: { 200: { description: 'JSON or binary', content: {
      'application/json': { schema: { type: 'object' } }, 'application/pdf': { schema: { type: 'string', format: 'binary' } } } } } } } } };
  let calls = 0;
  await page.route('https://httpbin.org/exact-download', async route => {
    calls++;
    await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Disposition',
      'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="exact.pdf"' }, body: bytes });
  });
  await setMode(page, 'settings');
  const schemas = page.locator('summary[aria-label="Schemas"]');
  if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({ name: 'binary-download.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await expect(page.getByRole('switch', { name: 'Enable Binary download fixture', exact: true })).toHaveAttribute('aria-checked', 'true');
  await chooseCatalogOperation(page, name);
  await execute(page);
  await expect(responseBody(page)).toContainText('exact.pdf');
  await expect(responseBody(page)).toContainText('application/pdf');
  await expect(responseBody(page)).toContainText('256 bytes');
  await expect(responseBody(page).locator('.json-tree')).toHaveCount(0);
  const downloading = page.waitForEvent('download');
  await responseBody(page).getByRole('button', { name: 'Download file', exact: true }).click();
  const download = await downloading;
  assert.equal(download.suggestedFilename(), 'exact.pdf');
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), bytes); assert.equal(calls, 1);
  await mkdir(this.artifactDirectory, { recursive: true });
  await page.screenshot({ path: `${this.artifactDirectory}/binary-download-${width}.png` });
});
