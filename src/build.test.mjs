import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { Given, Then } from "@cucumber/cucumber";
import { faviconFiles } from "../build/favicons.mjs";

let html;

Given("the production build has completed", async function ()
{
  html = await readFile("dist/index.html", "utf8");
});

Then("the dist directory contains only the application page hosting headers and favicon compatibility files", async function ()
{
  assert.deepEqual((await readdir("dist")).sort(), ["_headers", "index.html", ...faviconFiles].sort());
});

Then("the hosting headers enable cross-origin isolation", async function ()
{
  const headers = await readFile("dist/_headers", "utf8");
  assert.match(headers, /^\/\*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: credentialless\n$/);
});

Then("the production page contains the application title", function ()
{
  assert.match(html, /operations\.superduper\.solutions/);
});

Then("the production page contains the workflow canvas", function ()
{
  assert.match(html, /Workflow canvas/);
});

Then("the production page contains the operation catalog and execution results", function ()
{
  assert.match(html, /Operation catalog/);
  assert.match(html, /Browse operations/);
  assert.match(html, /operation-prompt/);
  assert.match(html, /Start workflow/);
  assert.match(html, /Operation results/);
});

Then("the production page contains the separate example catalogs", function ()
{
  assert.match(html, /List projects/);
  assert.match(html, /Create task/);
  assert.match(html, /example\.com/);
  assert.match(html, /httpbin\.org/);
  assert.match(html, /Example TRACE request/);
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

Then("the production page contains the vault cryptography license notices", function ()
{
  assert.match(html, /Vault dependency notices/);
  assert.match(html, /Copyright \(c\) 2020 Dani Biró/);
  assert.match(html, /Permission is hereby granted, free of charge/);
  assert.match(html, /Copyright 2012, Samuel Neves/);
});
