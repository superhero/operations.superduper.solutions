import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { Given, Then } from "@cucumber/cucumber";
import { listBundleFiles, OAUTH_FILES } from "../.github/scripts/bundle-contract.mjs";

let html;

Given("the production build has completed", async function ()
{
  html = await readFile("dist/index.html", "utf8");
});

Then("the dist directory contains the application hosting files and optional speech resources", async function ()
{
  const files = listBundleFiles('dist');
  for (const file of OAUTH_FILES) {
    assert.ok(files.includes(file), `The current build must include ${file}.`);
    assert.equal(await readFile(`dist/${file}`, 'utf8'), await readFile(`src/public/${file}`, 'utf8'));
  }
});

Then("optional speech resources preserve runtime isolation and license notices", async function () {
  const speech = await readFile('dist/speech/worker.js', 'utf8');
  assert.match(speech, /encoder_session_start|Creating encoder session/);
  assert.match(speech, /1\.30\.0/); assert.match(speech, /f88260fa0777fe0868dda6df85d1a98f012a4a7a/);
  assert.doesNotMatch(html, /ortWasmThreaded|class ContinuousFeatures/);
  assert.match(await readFile('dist/speech/features.js', 'utf8'), /mel-/);
  assert.match(await readFile('dist/speech/licenses/TEN-VAD-LICENSE', 'utf8'), /additional conditions/);
  assert.match(await readFile('dist/speech/licenses/onnxruntime-LICENSE', 'utf8'), /Microsoft/);
  assert.match(html, /Speech dependency notices/);
});

Then("the hosting headers enable cross-origin isolation", async function ()
{
  const headers = await readFile("dist/_headers", "utf8");
  assert.match(headers, /^\/\*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: credentialless\n(?:\n|$)/);
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
  assert.match(html, /Example array response/);
  assert.match(html, /Example POST body/);
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

Then("the production page contains the Pi assistant license notices", function ()
{
  assert.match(html, /Assistant dependency notices/);
  assert.match(html, /@earendil-works\/pi-agent-core/);
  assert.match(html, /Copyright \(c\) 2025 Mario Zechner/);
});

Then("native assistant resources preserve decoded Wasm pins and hosting rewrites", async function () {
  const versions = JSON.parse(await readFile('dist/assistant-runtime/runtime-versions.json', 'utf8'));
  assert.equal(versions.modelWeightsBundled, false);
  const compressed = JSON.parse(await readFile('dist/assistant-runtime/compressed-assets.json', 'utf8'));
  assert.ok(compressed.length > 0, 'Native runtimes must preserve oversized Wasm through encoded transport.');
  const headers = await readFile('dist/_headers', 'utf8');
  const redirects = await readFile('dist/_redirects', 'utf8');
  for (const asset of compressed) {
    const packed = await readFile(`dist${asset.path}.gz`);
    const decoded = gunzipSync(packed);
    assert.equal(createHash('sha256').update(decoded).digest('hex'), asset.sha256);
    assert.equal(decoded.length, asset.bytes);
    assert.ok(packed.length <= 25 * 1024 ** 2);
    assert.ok(headers.includes(`${asset.path}\n  Content-Type: application/wasm\n  Content-Encoding: gzip\n`));
    assert.ok(redirects.includes(`${asset.path} ${asset.path}.gz 200`));
  }
});
