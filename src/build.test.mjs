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

Then("the production page contains the add-node action", function ()
{
  assert.match(html, /Add node/);
});

Then("the production page contains the initial nodes", function ()
{
  assert.match(html, /Node 1/);
  assert.match(html, /Node 2/);
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
