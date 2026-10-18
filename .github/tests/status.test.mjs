// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { REPOSITORY } from "./support.mjs";
import { publishReport } from "../scripts/publish-report.mjs";
import { REPORT_FILES, inventory } from "../scripts/validation-artifacts.mjs";
import { createHash } from "node:crypto";
import { toolchainPackages } from "../../tests/gherkin/execution-fingerprint.mjs";

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
  const command = ["--fail-with-body", "--silent", "--show-error",
    "--connect-timeout", "10", "--max-time", "30", "--retry", "2", "--retry-delay", "1", "--retry-all-errors", "--request", "PUT",
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

Given("dependency badges will be refreshed with the registry check", function ()
{
  this.dependencyUpdate.badges = join(this.automation.root, "badges");
});

When("dependency status is updated for {string}", function (branch)
{
  const { response } = this.dependencyUpdate;
  this.dependencyUpdate.branch = branch;
  const allowed = !this.dependencyUpdate.invalidBranch;
  const responses = allowed ? [{ executable: "npm", command: ["outdated", "--json"], ...response }] : [];
  const args = branch ? [branch] : [];
  if (this.dependencyUpdate.badges) args.push(this.dependencyUpdate.badges);
  this.result = this.automation.execute("update-dependency-status.sh", args, responses,
    { success: null });
});

Then("the dependency badges reflect the same registry result", function ()
{
  assert.equal(this.result.status, 0, this.result.stderr);
  const colour = this.dependencyUpdate.state === "outdated" ? "#fe7d37" : "#007ec6";
  for (const slug of ["scope--tool", "another"])
    assert.ok(readFileSync(join(this.dependencyUpdate.badges, `version-dependency-${slug}.svg`), "utf8")
      .includes(`fill="${colour}"`));
});

Then("the failed registry check creates no badges", function ()
{
  assert.notEqual(this.result.status, 0);
  assert.equal(existsSync(this.dependencyUpdate.badges), false);
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

Given("a complete Vitest report directory", function ()
{
  const directory = join(this.automation.root, "report");
  const head = "a".repeat(40);
  this.reportPublication = { directory, prefix: `reports/${head}-123-1`, calls: [], guards: 0,
    expectedProvenance: { repository: 'owner/project', runId: 123, runAttempt: 1, sourceSha: head, testedSha: head } };
  for (const file of [...REPORT_FILES, "ui/assets/index.js", "ui/assets/index.css", "attachments/screenshot.png", "attachments/trace.zip"]) {
    const target = join(directory, file);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, `Original ${file}\n`);
  }
  const suites = ["source", "acceptance", "automation", "browser", "components", "runner"]
    .map((profile, index) => ({ profile, project: profile === "browser" ? "browser-chromium" : profile,
      head, cases: 1, runId: "123", runAttempt: "1", resultHash: "e".repeat(64),
      blobHash: (index + 1).toString(16).repeat(64), configFingerprint: "f".repeat(64),
      dependencyVersions: { node: "v20.1.0", ...Object.fromEntries(toolchainPackages.map(name => [name, "1.2.3"])) } }));
  writeFileSync(join(directory, "provenance.json"), JSON.stringify({ schemaVersion: 2,
    complete: true, diagnostic: false, mergeExitCode: 0, testedSha: head, suites,
    inputHashes: Object.fromEntries(suites.map(suite => [`${suite.project}.json`, suite.blobHash])) }));
  writeFileSync(join(directory, "coverage/coverage-summary.json"), JSON.stringify({ total:
    Object.fromEntries(["lines", "branches", "functions", "statements"].map(metric =>
      [metric, { total: 1, covered: 1, skipped: 0, pct: 100 }])) }));
  this.reportPublication.manifest = { schemaVersion: 2, ...this.reportPublication.expectedProvenance,
    testedTree: 'b'.repeat(40), inputFingerprint: 'c'.repeat(64), files: { 'test-report': inventory(directory) } };
});
Given("the report is diagnostic rather than complete validation", function ()
{
  const path = join(this.reportPublication.directory, "provenance.json");
  const value = JSON.parse(readFileSync(path)); value.complete = false; value.diagnostic = true;
  writeFileSync(path, JSON.stringify(value));
});
function publishFixture(world, failure) {
  const state = world.reportPublication;
  try {
    state.plan = publishReport(state.directory, state.prefix, {
      manifest: state.manifest, expectedProvenance: state.expectedProvenance,
      run(command, [script, file, key, type]) {
        assert.equal(command, "bash"); assert.equal(script, ".github/scripts/publish-status.sh");
        state.calls.push({ file, key, type, contents: readFileSync(file) });
        if (failure === "concurrent" && state.calls.length === 1)
          writeFileSync(join(state.directory, "ui/assets/index.css"), "Changed after snapshot");
        return { status: failure === "asset" && key.endsWith(".css") ? 1 : 0 };
      },
      guard() { state.guards++; if (failure === "newer") throw new Error("Newer release"); },
    });
  } catch (error) { state.error = error; }
}
When("the report directory is published successfully", function () { publishFixture(this); });
When("report publication fails on a CSS asset", function () { publishFixture(this, "asset"); });
When("a newer release is detected before publishing report pointers", function () { publishFixture(this, "newer"); });
Then("report assets retain their MIME types under an immutable prefix", function ()
{
  const state = this.reportPublication;
  assert.ifError(state.error);
  const types = { "ui/assets/index.js": "text/javascript; charset=utf-8", "ui/assets/index.css": "text/css; charset=utf-8",
    "ui/html.meta.json.gz": "application/gzip", "attachments/screenshot.png": "image/png", "attachments/trace.zip": "application/zip", "badges/test-scenarios.json": "application/json; charset=utf-8",
    "badges/test-coverage.svg": "image/svg+xml" };
  for (const [path, type] of Object.entries(types)) {
    const item = state.calls.find(call => call.key === `${state.prefix}/${path}`);
    assert.equal(item?.type, type);
    assert.deepEqual(readFileSync(join(state.directory, path)), item.contents, "Publication must not alter original report evidence");
  }
});
Then("report entries and stable pointers are published after their dependencies", function ()
{
  const state = this.reportPublication;
  const keys = state.calls.map(call => call.key);
  assert.equal(keys.filter(key => key.startsWith(`${state.prefix}/`)).at(-1), `${state.prefix}/index.html`);
  assert.deepEqual(keys.slice(-2), ["test-coverage.html", "test-report.html"]);
  for (const badge of ['test-scenarios', 'test-coverage']) for (const format of ['json', 'svg'])
    assert.ok(keys.indexOf(`badges/${badge}.${format}`) < keys.indexOf('test-report.html'));
  assert.equal(state.guards, 6);
  assert.ok(state.calls.at(-1).contents.toString().includes(`/${state.prefix}/index.html`));
});
Then("no report entry or stable pointer is published", function ()
{
  const state = this.reportPublication;
  assert.ok(state.error);
  assert.ok(state.calls.length > 0);
  assert.ok(state.calls.every(call => call.key !== `${state.prefix}/index.html` && call.key.startsWith(`${state.prefix}/`)));
  assert.equal(state.guards, 0);
});
Then("immutable report assets remain available without replacing stable pointers", function ()
{
  const state = this.reportPublication;
  assert.ok(state.error);
  assert.equal(state.calls.at(-1).key, `${state.prefix}/index.html`);
  assert.ok(state.calls.every(call => call.key.startsWith(`${state.prefix}/`)));
  assert.equal(state.guards, 1);
});
Then("no report publication requests are made", function ()
{
  assert.ok(this.reportPublication.error);
  assert.deepEqual(this.reportPublication.calls, []);
});

Given("the validated publication input has {string}", function (defect) {
  const state = this.reportPublication;
  const modifications = { 'modified CSS': 'ui/assets/index.css', 'modified attachment': 'attachments/trace.zip',
    'modified results': 'results.json', 'modified provenance': 'provenance.json' };
  if (modifications[defect]) writeFileSync(join(state.directory, modifications[defect]), 'Changed after validation');
  else if (defect === 'missing UI asset') unlinkSync(join(state.directory, 'ui/assets/index.js'));
  else if (defect === 'missing manifest') delete state.manifest;
  else if (defect === 'manifest from another run') state.manifest.runId++;
  else if (defect === 'manifest from another commit') state.manifest.testedSha = 'f'.repeat(40);
  else assert.fail(`Unknown publication integrity defect: ${defect}`);
});
When("the downloaded report changes during publication", function () { publishFixture(this, 'concurrent'); });
Then("published assets retain the original validated snapshot", function () {
  const state = this.reportPublication;
  assert.ifError(state.error);
  for (const call of state.calls.filter(call => call.key.startsWith(`${state.prefix}/`))) {
    const path = call.key.slice(state.prefix.length + 1);
    assert.equal(createHash('sha256').update(call.contents).digest('hex'), state.manifest.files['test-report'][path]);
  }
  assert.equal(readFileSync(join(state.directory, 'ui/assets/index.css'), 'utf8'), 'Changed after snapshot');
});
