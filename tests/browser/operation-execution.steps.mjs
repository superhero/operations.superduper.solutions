// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { chooseCatalogOperation, fillField, workspace } from "./workspace.steps.mjs";

const responsePanel = page => page.getByRole("region", { name: "Operation response", exact: true });
const responseBody = page => page.getByRole("region", { name: "Response body", exact: true });
const execute = page => page.getByRole("button", { name: "Execute operation", exact: true }).click();
const reply = (route, body, status = 200) => route.fulfill({ status,
  headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify(body) });
const readBody = async page => JSON.parse(await responseBody(page).locator(".json-tree").evaluate(element => {
  const document = element.cloneNode(true);
  for (const icon of document.querySelectorAll(".json-toggle")) icon.remove();
  return document.textContent;
}));

async function expectServerMetadata(page, url) {
  await expect(workspace(page).getByText(/^Live request/)).toHaveCount(0);
  await page.getByRole("button", { name: "Edit inputs", exact: true }).click();
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

Then("direct execution sends the encoded query and headers and displays the received response", async function () {
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

Then("direct execution sends structured JSON and displays the received response", async function () {
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

Then("direct execution displays an HTTP error body and can retry successfully", async function () {
  const page = this.page;
  const failure = { error: "The server rejected this request", code: "invalid-example" };
  const requests = await intercept(page, (route, count) => reply(route, count === 1 ? failure : { retried: true }, count === 1 ? 422 : 200));
  await chooseCatalogOperation(page, "HTTPBin GET request");
  await execute(page);
  await expect(responsePanel(page).getByRole("alert")).toContainText("422");
  await expect(responsePanel(page)).toContainText("HTTP 422");
  assert.deepEqual(await readBody(page), failure);
  await responsePanel(page).getByRole("button", { name: "Retry request", exact: true }).click();
  await expect(responseBody(page)).toContainText("retried");
  await expect(responsePanel(page).getByRole("alert")).toHaveCount(0);
  await expect(responsePanel(page)).toContainText("HTTP 200");
  assert.equal(requests.length, 2);
  removeExpectedFailureDiagnostics(this, "http");
});

Then("direct execution reports connection failure and can retry successfully", async function () {
  const page = this.page;
  const requests = await intercept(page, (route, count) => count === 1 ? route.abort("connectionrefused") : reply(route, { connected: true }));
  await chooseCatalogOperation(page, "HTTPBin GET request");
  await execute(page);
  await expect(responsePanel(page).getByRole("alert")).toContainText("could not reach https://httpbin.org");
  await expect(responseBody(page)).toHaveCount(0);
  await responsePanel(page).getByRole("button", { name: "Retry request", exact: true }).click();
  await expect(responseBody(page)).toContainText("connected");
  await expect(responsePanel(page).getByRole("alert")).toHaveCount(0);
  assert.equal(requests.length, 2);
  removeExpectedFailureDiagnostics(this, "network");
});

Then("pending direct execution prevents duplicates and supports cancellation and retry", async function () {
  const page = this.page;
  let pendingRoute;
  const requests = await intercept(page, async (route, count) => {
    if (count === 1) pendingRoute = route;
    else await reply(route, { retried: true });
  });
  await chooseCatalogOperation(page, "HTTPBin GET request");
  await execute(page);
  await expect.poll(() => requests.length).toBe(1);
  await expect(responsePanel(page).getByRole("status")).toContainText("Request in progress");
  // A second submit from the still-mounted form must not start a concurrent request.
  await workspace(page).locator('[aria-label="Operation step"] form').dispatchEvent("submit");
  await responsePanel(page).getByRole("button", { name: "Cancel request", exact: true }).click();
  await expect(responsePanel(page)).toContainText("cancelled");
  await expect(responsePanel(page).getByRole("button", { name: "Cancel request", exact: true })).toHaveCount(0);
  assert.equal(requests.length, 1);
  await pendingRoute.abort("aborted");
  await responsePanel(page).getByRole("button", { name: "Retry request", exact: true }).click();
  await expect(responseBody(page)).toContainText("retried");
  assert.equal(requests.length, 2);
});

Then("switching operation ignores a late direct response", async function () {
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
  await expect(responsePanel(page).getByRole("heading", { name: "HTTPBin POST request", exact: true })).toBeVisible();
  assert.deepEqual(await readBody(page), { current: "second operation" });
  await expect(responsePanel(page).getByRole("alert")).toHaveCount(0);
  assert.equal(requests.length, 2);
});

Then("direct example execution displays server data from an actual request", async function () {
  const page = this.page;
  const requests = [];
  const received = { id: "server-project", name: "Data from the HTTP endpoint", status: "received" };
  await page.route("https://example.com/**", async route => {
    requests.push({ method: route.request().method(), url: route.request().url() });
    await reply(route, received);
  });
  await chooseCatalogOperation(page, "Get project");
  await fillField(page, "Project ID", "project-2");
  await execute(page);
  await expect(responseBody(page)).toContainText("Data from the HTTP endpoint");
  assert.deepEqual(await readBody(page), received);
  await expect(responseBody(page)).not.toContainText("Website");
  await expectServerMetadata(page, "https://example.com");
  assert.deepEqual(requests, [{ method: "GET", url: "https://example.com/projects/project-2" }]);
});
