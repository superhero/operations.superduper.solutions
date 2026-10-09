import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { Given, Then } from "@cucumber/cucumber";

let html;

Given("the production build has completed", async function ()
{
  html = await readFile("dist/index.html", "utf8");
});

Then("the dist directory contains only {string}", async function (filename)
{
  assert.deepEqual(await readdir("dist"), [filename]);
});

Then("the production page contains the application title", function ()
{
  assert.match(html, /operations\.superduper\.solutions/);
});

Then("the production page contains the workflow canvas", function ()
{
  assert.match(html, /Workflow canvas/);
});

Then("the production page contains the operation catalog and request preview", function ()
{
  assert.match(html, /Operation catalog/);
  assert.match(html, /Find operations/);
  assert.match(html, /Prepared locally\. No request has been sent\./);
});

Then("the production page contains the separate example catalogs", function ()
{
  assert.match(html, /List projects/);
  assert.match(html, /Create task/);
  assert.match(html, /Examples · example\.com/);
  assert.match(html, /Examples · httpbin/);
  assert.match(html, /Mock TRACE request/);
  assert.match(html, /HTTPBin multipart text fields/);
  assert.doesNotMatch(html, /\b(?:adamo|telecom|laya)\b|admin-theme|\/v1\/systemone/i);
});

Then("the production page contains inline JavaScript", function ()
{
  assert.match(html, /<script\b(?=[^>]*\btype=["\']module["\'])[^>]*>.+<\/script>/s);
});

Then("the production page has no external JavaScript source", function ()
{
  assert.doesNotMatch(html, /<script[^>]+src=/i);
});

Then("the production page contains inline CSS", function ()
{
  assert.match(html, /<style\b[^>]*>.+<\/style>/s);
});

Then("the production page has no external stylesheet", function ()
{
  assert.doesNotMatch(html, /<link[^>]+rel=["']stylesheet["']/i);
});
