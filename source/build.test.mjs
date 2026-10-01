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

Then("the production page contains inline JavaScript", function ()
{
  assert.match(html, /<script type="module">.+<\/script>/s);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
});
