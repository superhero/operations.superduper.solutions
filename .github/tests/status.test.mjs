// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
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

Given("the dependency registry reports {string}", function (state)
{
  this.automation.env.GITHUB_REPOSITORY = REPOSITORY;
  this.automation.env.GITHUB_STEP_SUMMARY = join(this.automation.root, "summary.md");
  this.automation.env.NPM_TOKEN = "test-npm-secret";
  this.automation.env.NODE_AUTH_TOKEN = "test-node-secret";
  delete this.automation.env.CLOUDFLARE_API_TOKEN;
  delete this.automation.env.CLOUDFLARE_ACCOUNT_ID;
  writeFileSync(this.automation.env.GITHUB_STEP_SUMMARY, "");
  const responses = {
    current: { response: {} },
    outdated: { response: {
      "@scope/tool": { current: "1.0.0", wanted: "1.0.1", latest: "1.1.0" },
      another: { current: "2.0.0", wanted: "2.0.0", latest: "3.0.0" }
    }, exit_code: 1 },
    empty: { raw: "" },
    "missing version": { response: { "@scope/tool": { current: "1.0.0", wanted: "1.0.1", latest: null } } },
    "failure without JSON": {
      raw: "not JSON", exit_code: 1,
      stderr: `npm error ECONNRESET: registry connection closed at https://private-user:private-password@registry.example.test\n` +
        `${this.automation.env.GH_TOKEN} ` +
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
    JSON.stringify({ devDependencies: { "@scope/tool": "1.0.0", another: "2.0.0" } }));
});

Given("the dependency branch name is invalid", function ()
{
  this.dependencyUpdate.invalidBranch = true;
});

When("dependency status is updated for {string}", function (branch)
{
  const { response } = this.dependencyUpdate;
  this.dependencyUpdate.branch = branch;
  const allowed = !this.dependencyUpdate.invalidBranch;
  const responses = allowed ? [{ executable: "npm", command: ["outdated", "--json"], ...response }] : [];
  this.result = this.automation.execute("update-dependency-status.sh", branch ? [branch] : [], responses,
    { success: null });
});

Then("the workflow reports {string} for that branch", function (message)
{
  assert.equal(this.result.status, 0, this.result.stderr);
  assert.deepEqual(this.automation.calls().map(request => request.command), [["outdated", "--json"]]);
  assert.equal(readFileSync(this.automation.env.GITHUB_STEP_SUMMARY, "utf8"), this.result.stdout);
  for (const value of [message, this.dependencyUpdate.branch])
    assert.ok(this.result.stdout.includes(value), this.result.stdout);
});

Then("the workflow shows each outdated package with its current, wanted and latest versions", function ()
{
  for (const value of ["| Package | Current | Wanted | Latest |",
    "| @scope/tool | 1.0.0 | 1.0.1 | 1.1.0 |", "| another | 2.0.0 | 2.0.0 | 3.0.0 |"])
    assert.ok(this.result.stdout.includes(value), this.result.stdout);
});

Then("the workflow displays the branch name as escaped text", function ()
{
  assert.equal(this.result.status, 0, this.result.stderr);
  assert.deepEqual(this.automation.calls().map(request => request.command), [["outdated", "--json"]]);
  assert.equal(readFileSync(this.automation.env.GITHUB_STEP_SUMMARY, "utf8"), this.result.stdout);
  assert.ok(this.result.stdout.includes("feature/report\\|&lt;preview&gt;\\`tick"), this.result.stdout);
  assert.ok(!this.result.stdout.includes(this.dependencyUpdate.branch), this.result.stdout);
});

Then("invalid dependency data does not produce a successful report", function ()
{
  assert.notEqual(this.result.status, 0);
  for (const value of [REPOSITORY, "branch='main'", "package.json", "npm outdated --json"])
    assert.ok(this.result.stderr.includes(value), this.result.stderr);
  assert.deepEqual(this.automation.calls().map(request => request.command), [["outdated", "--json"]]);
});

Then("no successful dependency report is written", function ()
{
  assert.equal(this.result.stdout, "");
  assert.equal(readFileSync(this.automation.env.GITHUB_STEP_SUMMARY, "utf8"), "");
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
  for (const value of [reason, REPOSITORY, this.dependencyUpdate.branch])
    assert.ok(this.result.stderr.includes(value), this.result.stderr);
  assert.deepEqual(this.automation.calls(), []);
});

Then("the registry failure reports sanitized stderr", function ()
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
});
