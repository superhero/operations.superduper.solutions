// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { API, get, OTHER_SHA, REPOSITORY, SHA } from "./support.mjs";

const PROJECT = "operations-superduper-solutions";
const ID = "12345678-1234-1234-1234-123456789abc";
const HTML = "<!doctype html><html><body>Verified application</body></html>\n";
const HASH = createHash("sha256").update(HTML).digest("hex");
const QUERY = "query($owner: String!, $name: String!, $ref: String!) { repository(owner: $owner, name: $name) { ref(qualifiedName: $ref) { target { oid } } } }";

Given("a tested Pages bundle for {string}", function (branch)
{
  const bundle = join(this.automation.root, "dist");
  mkdirSync(bundle);
  writeFileSync(join(bundle, "index.html"), HTML);
  this.automation.env.GITHUB_STEP_SUMMARY = join(this.automation.root, "summary.md");
  writeFileSync(this.automation.env.GITHUB_STEP_SUMMARY, "");
  this.pages = { branch, bundle, state: "empty", branchState: "current" };
});

Given("the Pages destination is {string}", function (state)
{
  this.pages.state = state;
});

Given("the Pages branch is {string}", function (state)
{
  this.pages.branchState = state;
});

Given("the Pages bundle is {string}", function (state)
{
  const { bundle } = this.pages;
  if (state === "empty HTML") writeFileSync(join(bundle, "index.html"), "");
  else if (state === "extra file") writeFileSync(join(bundle, "style.css"), "body {}");
  else if (state === "hidden file") writeFileSync(join(bundle, ".assetsignore"), "*");
  else if (state === "nested directory") mkdirSync(join(bundle, "assets"));
  else if (state === "symlink")
  {
    const target = join(this.automation.root, "index.html");
    writeFileSync(target, HTML);
    unlinkSync(join(bundle, "index.html"));
    symlinkSync(target, join(bundle, "index.html"));
  }
  else assert.fail(`Unknown Pages bundle state: ${state}`);
  this.pages.invalidInput = true;
});

When("the Pages deployment is prepared", function ()
{
  const { branch, bundle, state, branchState } = this.pages;
  const env = this.automation.env;
  const alias = branch === "main" ? `https://${PROJECT}.pages.dev`
    : `https://${branch.toLowerCase().replaceAll(/[^a-z0-9]/g, "-")}.${PROJECT}.pages.dev`;
  this.pages.alias = alias;
  const deployment = {
    id: ID,
    url: `https://12345678.${PROJECT}.pages.dev`,
    aliases: [alias],
    environment: branch === "main" ? "production" : "preview",
    latest_stage: { name: "deploy", status: "success" },
    deployment_trigger: { metadata: { branch, commit_message: `bundle-sha256:${HASH}` } }
  };
  if (state === "changed") deployment.deployment_trigger.metadata.commit_message = `bundle-sha256:${"b".repeat(64)}`;
  if (state === "unmarked") deployment.deployment_trigger.metadata.commit_message = "Previous release";
  if (state === "no commit message") deployment.deployment_trigger.metadata.commit_message = null;
  if (state === "identical without alias") deployment.aliases = null;
  if (state === "failed deployment") deployment.latest_stage.status = "failure";
  if (state === "wrong branch") deployment.deployment_trigger.metadata.branch = "release/9.0.0";
  if (state === "wrong environment") deployment.environment = "production";
  if (state === "invalid URL") deployment.url = "https://untrusted.invalid/application";

  const base = `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT}`;
  const cloudflare = (endpoint, result, options = {}) => ({
    executable: "curl",
    command: ["--fail-with-body", "--silent", "--show-error", "--connect-timeout", "10", "--max-time", "60", "--request", "GET",
      "--header", `Authorization: Bearer ${env.CLOUDFLARE_API_TOKEN}`, `https://api.cloudflare.com/client/v4${endpoint}`],
    response: { success: true, result }, ...options
  });
  const project = { name: PROJECT, subdomain: `${PROJECT}.pages.dev`, production_branch: "main",
    canonical_deployment: state === "empty" ? null : deployment };
  if (state === "wrong project") project.production_branch = "develop";
  const responses = [cloudflare(base, project)];
  if (state === "API failure")
  {
    responses[0].response = { success: false, errors: [{ code: 10000,
      message: `Authentication failed: ${env.CLOUDFLARE_API_TOKEN}` }], private: "private response detail" };
    responses[0].exit_code = 22;
    responses[0].stderr = `curl failure ${env.GH_TOKEN}`;
  }
  const failedProject = ["wrong project", "API failure"].includes(state);
  if (!failedProject && branch !== "main")
  {
    const deployments = state === "empty" ? [] : [deployment];
    if (state === "duplicate aliases") deployments.push({ ...deployment, id: "87654321-1234-1234-1234-123456789abc" });
    const paginated = state === "identical on second page";
    const page = (number, entries, total) => cloudflare(`${base}/deployments?env=preview&page=${number}&per_page=25`, entries,
      { response: { success: true, result: entries,
        result_info: { page: number, per_page: 25, count: entries.length, total_pages: total } } });
    if (paginated)
    {
      responses.push(page(1, Array.from({ length: 25 }, () => ({ ...deployment, aliases: null })), 2));
      responses.push(page(2, deployments, 2));
    }
    else responses.push(page(1, deployments, deployments.length ? 1 : 0));
    if (state === "incomplete pagination") responses.at(-1).response.result_info.count++;
  }
  const failedDestination = failedProject || ["failed deployment", "wrong branch", "wrong environment", "invalid URL",
    "duplicate aliases", "incomplete pagination"].includes(state);
  if (!failedDestination)
  {
    const ref = branchState === "deleted" ? null : { target: { oid: branchState.startsWith("advanced") ? OTHER_SHA : SHA } };
    const request = { method: "POST", endpoint: "graphql",
      body: { query: QUERY, variables: { owner: "superhero", name: REPOSITORY.split("/")[1], ref: `refs/heads/${branch}` } },
      response: { data: { repository: { ref } } } };
    if (branchState === "permission denied")
    {
      request.response = { errors: [{ message: `Resource not accessible: ${env.GH_TOKEN}` }], data: { repository: null } };
      request.exit_code = 1;
    }
    responses.push(request);
    if (branchState.startsWith("advanced"))
    {
      responses.push(get(`${API}/compare/${SHA}...${OTHER_SHA}?per_page=100`, {
        status: "ahead", behind_by: 0, ahead_by: 1, total_commits: 1, base_commit: { sha: SHA },
        merge_base_commit: { sha: SHA }, commits: [{ sha: OTHER_SHA, parents: [{ sha: SHA }] }]
      }));
      responses.push(get(`${API}/commits/${OTHER_SHA}?per_page=100`, { sha: OTHER_SHA,
        files: [{ filename: branchState === "advanced with badges" ? ".github/badges/version-dependency-svelte.svg" : "src/app.ts" }] }));
    }
  }
  const noRequests = this.pages.invalidInput || branch.startsWith("feature/");
  this.result = this.automation.execute("prepare-pages-deployment.sh", [REPOSITORY, branch, SHA, bundle],
    noRequests ? [] : responses, { success: null });
});

Then("the Pages decision is deploy {string} and skipped {string}", function (deploy, skipped)
{
  assert.equal(this.result.status, 0, this.result.stderr);
  const output = Object.fromEntries(readFileSync(this.automation.output, "utf8").trim().split("\n")
    .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  assert.deepEqual(output, {
    deploy, skipped, bundle_hash: HASH, alias_url: this.pages.alias,
    deployment_id: deploy === "false" && skipped === "false" ? ID : "",
    deployment_url: deploy === "false" && skipped === "false" ? `https://12345678.${PROJECT}.pages.dev` : ""
  });
  assert.ok(this.result.stdout.includes(this.pages.branch), this.result.stdout);
  assert.equal(readFileSync(this.automation.env.GITHUB_STEP_SUMMARY, "utf8"), this.result.stdout);
  if (skipped === "true" && this.pages.branchState === "advanced with code")
  {
    assert.ok(this.result.stderr.includes("Could not verify a safe Pages preview advance"), this.result.stderr);
    assert.ok(this.result.stderr.includes("Commit changes files outside dependency version SVGs"), this.result.stderr);
  }
  assert.ok(this.automation.calls().every(call => call.method !== "POST" || call.endpoint === "graphql"));
});

Then("Pages preparation fails with {string}", function (reason)
{
  assert.notEqual(this.result.status, 0, this.result.stdout + this.result.stderr);
  for (const value of [reason, REPOSITORY, this.pages.branch, SHA, this.pages.bundle, PROJECT])
    assert.ok(this.result.stderr.includes(value), this.result.stderr);
  assert.equal(readFileSync(this.automation.output, "utf8"), "");
  assert.ok(!this.result.stderr.includes("private response detail"), this.result.stderr);
});
