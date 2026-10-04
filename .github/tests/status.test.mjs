// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { REPOSITORY } from "./support.mjs";

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

Given("the dependency registry reports {string}", function (state)
{
  this.automation.env.GITHUB_REPOSITORY = REPOSITORY;
  this.automation.env.NPM_TOKEN = "test-npm-secret";
  this.automation.env.NODE_AUTH_TOKEN = "test-node-secret";
  const responses = {
    current: { response: {} },
    outdated: { response: { "@scope/tool": { latest: "1.1.0" } }, exit_code: 1 },
    empty: { raw: "" },
    "failure without JSON": {
      raw: "not JSON", exit_code: 1,
      stderr: `npm error ECONNRESET: registry connection closed at https://private-user:private-password@registry.example.test\n` +
        `${this.automation.env.GH_TOKEN} ${this.automation.env.CLOUDFLARE_API_TOKEN} ` +
        `${this.automation.env.NPM_TOKEN} ${this.automation.env.NODE_AUTH_TOKEN}\n${"debug detail ".repeat(200)}`
    }
  };
  if (["failure 1", "failure 2"].includes(state))
  {
    responses[state] = {
      response: { error: { code: "E401", summary: `authentication failed: ${this.automation.env.GH_TOKEN}`,
        detail: "private registry detail" } },
      stderr: `private registry stderr ${this.automation.env.GH_TOKEN}`, exit_code: Number(state.at(-1))
    };
  }
  assert.ok(Object.hasOwn(responses, state), `Unknown dependency registry state: ${state}`);
  this.dependencyUpdate = { state, response: responses[state] };
  writeFileSync(join(this.automation.root, "package.json"),
    JSON.stringify({ devDependencies: { "@scope/tool": "1.0.0" } }));
  // A previous run's badge must never become part of this publication.
  mkdirSync(join(this.automation.root, "tmp/status"), { recursive: true });
  writeFileSync(join(this.automation.root, "tmp/status/stale.json"), "{}");
});

When("dependency status is updated for {string}", function (branch)
{
  const { state, response } = this.dependencyUpdate;
  const allowed = ["main", "develop"].includes(branch);
  const responses = allowed ? [{ executable: "npm", command: ["outdated", "--json"], ...response }] : [];
  if (allowed && !state.startsWith("failure"))
  {
    const prefix = branch === "main" ? "" : "develop/";
    const env = this.automation.env;
    this.dependencyUpdate.badges = [
      ["version-dependencies.json", { schemaVersion: 1, label: "Dependencies",
        message: state === "outdated" ? "1 outdated" : "up to date",
        color: state === "outdated" ? "orange" : "brightgreen" }],
      ["version-dependency-scope--tool.json", { schemaVersion: 1, label: "@scope/tool", message: "1.0.0",
        color: state === "outdated" ? "orange" : "blue" }]
    ];
    for (const [file, json] of this.dependencyUpdate.badges)
    {
      responses.push({ executable: "curl", command: ["--fail-with-body", "--silent", "--show-error", "--request", "PUT",
        "--header", `Authorization: Bearer ${env.CLOUDFLARE_API_TOKEN}`, "--header", "Content-Type: application/json",
        "--data-binary", { file, json },
        `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/r2/buckets/operations-status/objects/${prefix}${file}`],
      response: { success: true } });
    }
  }
  this.result = this.automation.execute("update-dependency-status.sh", branch ? [branch] : [], responses,
    { success: null });
});

Then("only current dependency badges are published under {string}", function (prefix)
{
  assert.equal(this.result.status, 0, this.result.stderr);
  const requests = this.automation.calls();
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.slice(1).map(request => request.command.at(-1).split("/objects/")[1]),
    [`${prefix}version-dependencies.json`, `${prefix}version-dependency-scope--tool.json`]);
  assert.equal(this.dependencyUpdate.badges[0][1].message, "up to date");
});

Then("the published dependency summary says {string}", function (message)
{
  assert.equal(this.result.status, 0, this.result.stderr);
  assert.equal(this.automation.calls().length, 3);
  assert.equal(this.dependencyUpdate.badges[0][1].message, message);
});

Then("the registry failure includes the branch and safe npm error summary", function ()
{
  assert.equal(this.result.status, this.dependencyUpdate.response.exit_code);
  for (const value of [REPOSITORY, "branch='main'", "package.json", "npm outdated --json", `exit ${this.result.status}`,
    "npm error E401: authentication failed: [REDACTED]"])
    assert.ok(this.result.stderr.includes(value), this.result.stderr);
  for (const value of ["private registry detail", "private registry stderr"])
    assert.ok(!this.result.stderr.includes(value), this.result.stderr);
  assert.deepEqual(this.automation.calls().map(request => request.command), [["outdated", "--json"]]);
});

Then("the dependency status update fails with {string} before external requests", function (reason)
{
  assert.notEqual(this.result.status, 0);
  assert.ok(this.result.stderr.includes(reason), this.result.stderr);
  assert.deepEqual(this.automation.calls(), []);
});

Then("the registry failure reports sanitized stderr without publishing", function ()
{
  assert.equal(this.result.status, 1);
  for (const value of [REPOSITORY, "branch='main'", "package.json", "npm outdated --json",
    "npm error ECONNRESET: registry connection closed", "https://[REDACTED]@registry.example.test"])
    assert.ok(this.result.stderr.includes(value), this.result.stderr);
  for (const value of ["private-user", "private-password", this.automation.env.NPM_TOKEN, this.automation.env.NODE_AUTH_TOKEN])
    assert.ok(!this.result.stderr.includes(value), this.result.stderr);
  const lines = this.result.stderr.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[1].length <= 1000, lines[1]);
  assert.deepEqual(this.automation.calls().map(request => request.command), [["outdated", "--json"]]);
});

Then("temporary registry data is removed", function ()
{
  assert.deepEqual(readdirSync(this.automation.root).filter(file => file.startsWith("dependency-status.")), []);
  assert.equal(existsSync(join(this.automation.root, "tmp/status/stale.json")), true);
});
