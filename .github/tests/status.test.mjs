// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import "./support.mjs";

Given("a status file for {string} with content type {string}", function (key, type)
{
  this.publication = { key, type, file: join(this.automation.root, "status"), response: { success: true } };
  writeFileSync(this.publication.file, "release status\n");
});

Given("Cloudflare returns {string}", function (response)
{
  const publication = this.publication;
  if (response === "authentication failure")
  {
    this.automation.env.CLOUDFLARE_API_TOKEN = "secret.+[token]";
    publication.response = { success: false, errors: [{ code: 10000,
      message: `Authentication failed: ${this.automation.env.CLOUDFLARE_API_TOKEN}` }], private: "private response detail" };
    publication.exit_code = 22;
  }
  else if (response === "unsuccessful response") publication.response = { success: false };
  else if (response === "invalid JSON") publication.raw = "not JSON";
  else assert.fail(`Unknown Cloudflare response: ${response}`);
});

Given("the publishing input {string} is missing", function (input)
{
  if (input === "file") unlinkSync(this.publication.file);
  else delete this.automation.env[input];
  this.publication.noRequest = true;
});

When("the status is published", function ()
{
  const { key, type, file, noRequest, ...response } = this.publication;
  const env = this.automation.env;
  const command = ["--fail-with-body", "--silent", "--show-error", "--request", "PUT",
    "--header", `Authorization: Bearer ${env.CLOUDFLARE_API_TOKEN}`, "--header", `Content-Type: ${type}`,
    "--data-binary", `@${file}`,
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/r2/buckets/operations-status/objects/${key}`];
  this.result = this.automation.execute("publish-status.sh", [file, key, type],
    noRequest ? [] : [{ command, ...response }], { success: null });
});

Then("R2 receives the file at its configured destination", function ()
{
  assert.equal(this.result.status, 0, this.result.stderr);
  assert.equal(this.result.stdout + this.result.stderr, "");
  assert.equal(this.automation.calls().length, 1);
  assert.equal(readFileSync(this.publication.file, "utf8"), "release status\n");
});

Then("publishing fails with {string} and destination context", function (reason)
{
  assert.notEqual(this.result.status, 0);
  for (const value of [reason, this.publication.file, this.publication.key, this.publication.type, "operations-status"])
    assert.ok(this.result.stderr.includes(value), this.result.stderr);
  assert.ok(!this.result.stderr.includes("private response detail"));
});

Then("no publishing request was made", function ()
{
  assert.deepEqual(this.automation.calls(), []);
});

Given("dependency data that is {string}", function (state)
{
  this.manifest = join(this.automation.root, "package.json");
  this.outdated = join(this.automation.root, "outdated.json");
  this.badges = join(this.automation.root, "badges");
  const manifest = { devDependencies: { "@scope/tool": "1.0.0", current: "2.0.0" } };
  const responses = {
    current: {}, outdated: { "@scope/tool": { latest: "1.1.0" } },
    "registry error": { error: { code: "E401", summary: "authentication failed", detail: "private registry detail" } },
    "missing version": { "@scope/tool": { latest: null } }, "invalid manifest": {}
  };
  assert.ok(Object.hasOwn(responses, state), `Unknown dependency state: ${state}`);
  if (state === "invalid manifest") manifest.devDependencies.current = 42;
  writeFileSync(this.manifest, JSON.stringify(manifest));
  writeFileSync(this.outdated, JSON.stringify(responses[state]));
});

When("dependency badges are generated", function ()
{
  this.result = this.automation.execute("generate-dependency-status.sh",
    [this.manifest, this.outdated, this.badges], [], { success: null });
});

Then("the dependency summary says {string} in {string}", function (message, color)
{
  assert.equal(this.result.status, 0, this.result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(this.badges, "version-dependencies.json"), "utf8")),
    { schemaVersion: 1, label: "Dependencies", message, color });
});

Then("the scoped package badge uses its stable filename and {string} color", function (color)
{
  assert.deepEqual(JSON.parse(readFileSync(join(this.badges, "version-dependency-scope--tool.json"), "utf8")),
    { schemaVersion: 1, label: "@scope/tool", message: "1.0.0", color });
  assert.equal(JSON.parse(readFileSync(join(this.badges, "version-dependency-current.json"), "utf8")).color, "blue");
});

Then("badge generation fails with {string} and input paths", function (reason)
{
  assert.notEqual(this.result.status, 0);
  for (const value of [reason, this.manifest, this.outdated, this.badges])
    assert.ok(this.result.stderr.includes(value), this.result.stderr);
  assert.ok(!this.result.stderr.includes("private registry detail"));
});

Then("no dependency badges are written", function ()
{
  assert.equal(existsSync(this.badges), false);
});
