// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { API, OTHER_SHA, REPOSITORY, SHA, post } from "./support.mjs";

const PROJECT = "operations-superduper-solutions";
const DEPLOYMENT = "12345678-abcd-1234-abcd-123456789012";
const BUNDLE = "d".repeat(64);

Given("a successful Pages deployment for {string}", function (branch)
{
  this.automation.env.CLOUDFLARE_ACCOUNT_ID = "a".repeat(32);
  this.automation.env.GITHUB_RUN_ID = "123";
  this.automation.env.GITHUB_STEP_SUMMARY = join(this.automation.root, "summary.md");
  writeFileSync(this.automation.env.GITHUB_STEP_SUMMARY, "");
  this.pagesRecording = {
    branch,
    args: [REPOSITORY, branch, SHA, BUNDLE, DEPLOYMENT, "success"],
    responses: [{ response: {
      success: true,
      result: {
        id: DEPLOYMENT,
        project_name: PROJECT,
        environment: branch === "main" ? "production" : "preview",
        url: `https://12345678.${PROJECT}.pages.dev`,
        deployment_trigger: { metadata: { branch, commit_hash: SHA, commit_message: `bundle-sha256:${BUNDLE}` } },
        latest_stage: { name: "deploy", status: "success" }
      }
    } }]
  };
});

Given("the existing Pages deployment belongs to an older commit", function ()
{
  this.pagesRecording.responses[0].response.result.deployment_trigger.metadata.commit_hash = OTHER_SHA;
});

Given("Pages first reports a successful build followed by an active deploy", function ()
{
  const result = this.pagesRecording.responses[0];
  const build = structuredClone(result);
  build.response.result.latest_stage = { name: "build", status: "success" };
  const deploy = structuredClone(result);
  deploy.response.result.latest_stage = { name: "deploy", status: "active" };
  this.pagesRecording.responses.unshift(build, deploy);
});

Given("Pages verification reports {string}", function (problem)
{
  const recording = this.pagesRecording;
  recording.failed = true;
  const result = recording.responses[0].response.result;
  if (problem === "failed deploy") result.latest_stage.status = "failure";
  else if (problem === "canceled deploy") result.latest_stage.status = "canceled";
  else if (problem === "wrong branch") result.deployment_trigger.metadata.branch = "main";
  else if (problem === "wrong environment") result.environment = "production";
  else if (problem === "wrong bundle") result.deployment_trigger.metadata.commit_message = `bundle-sha256:${"e".repeat(64)}`;
  else if (problem === "untrusted URL") result.url = "https://untrusted.example.test";
  else if (problem === "invalid JSON") recording.responses = [{ raw: "not JSON" }];
  else if (problem === "invalid stage") result.latest_stage = false;
  else if (problem === "API rejection") recording.responses = [{ response: { success: false, errors: [{ code: 10000,
    message: `Authentication failed: ${this.automation.env.CLOUDFLARE_API_TOKEN}` }] } }];
  else if (problem === "transport failure") recording.responses = [{ exit_code: 22,
    response: { success: false, errors: [{ code: 10000,
      message: `Authentication failed: ${this.automation.env.CLOUDFLARE_API_TOKEN}` }] },
    stderr: `curl error ${this.automation.env.GH_TOKEN}` }];
  else if (problem === "timeout")
  {
    result.latest_stage.status = "active";
    recording.responses = Array.from({ length: 13 }, () => structuredClone(recording.responses[0]));
  }
  else if (problem === "missing credentials")
  {
    delete this.automation.env.CLOUDFLARE_API_TOKEN;
    recording.responses = [];
  }
  else assert.fail(`Unknown Pages verification problem: ${problem}`);
});

Given("the Pages action failed before returning a deployment ID", function ()
{
  this.pagesRecording.args[4] = "";
  this.pagesRecording.args[5] = "failure";
  this.pagesRecording.failed = true;
  this.pagesRecording.responses = [];
});

Given("GitHub rejects Pages recording at {string}", function (operation)
{
  this.pagesRecording.githubFailure = operation;
});

Given("the Pages recording argument {string} is invalid", function (argument)
{
  const position = { branch: 1, commit: 2, bundle: 3, "deployment ID": 4 }[argument];
  assert.notEqual(position, undefined);
  this.pagesRecording.args[position] = "invalid/../../identity";
  this.pagesRecording.invalid = true;
});

When("the Pages deployment outcome is recorded", function ()
{
  const recording = this.pagesRecording;
  const env = this.automation.env;
  const command = ["--fail-with-body", "--silent", "--show-error", "--connect-timeout", "10", "--max-time", "15",
    "--header", `Authorization: Bearer ${env.CLOUDFLARE_API_TOKEN}`,
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT}/deployments/${DEPLOYMENT}`];
  const responses = recording.responses.map(response => ({ executable: "curl", command, ...response }));
  const failure = { exit_code: 1, stderr: `HTTP 403: Forbidden ${env.GH_TOKEN} ${env.CLOUDFLARE_API_TOKEN}` };
  responses.push(post(`${API}/deployments`, { id: 456 },
    recording.githubFailure === "deployment create" ? failure : {}));
  if (recording.githubFailure !== "deployment create")
    responses.push(post(`${API}/deployments/456/statuses`, { state: recording.failed ? "failure" : "success" },
      recording.githubFailure === "deployment status" ? failure : {}));
  this.result = this.automation.execute("record-pages-deployment.sh", recording.args,
    recording.invalid ? [] : responses, { success: null });
});

function verifyGithubRecords(world, state)
{
  const { branch, args } = world.pagesRecording;
  const requests = world.automation.calls().filter(call => call.method === "POST");
  const production = branch === "main";
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].body, {
    ref: SHA,
    environment: production ? "production" : branch,
    auto_merge: false,
    required_contexts: [],
    production_environment: production,
    transient_environment: false,
    description: `Cloudflare Pages: ${branch}`,
    payload: { bundle_sha256: BUNDLE, cloudflare_deployment_id: args[4] }
  });
  const status = requests[1].body;
  assert.equal(status.state, state);
  assert.equal(status.auto_inactive, true);
  assert.equal(status.environment_url, `https://${production ? "" : `${branch.replaceAll(/[^a-z0-9]/g, "-")}.`}${PROJECT}.pages.dev`);
  assert.equal(status.log_url, `https://github.com/${REPOSITORY}/actions/runs/123`);
}

Then("GitHub records a successful Pages deployment for the requested commit", function ()
{
  assert.equal(this.result.status, 0, this.result.stderr);
  verifyGithubRecords(this, "success");
});

Then("the Pages summary links to the stable branch and immutable deployment URLs", function ()
{
  const summary = readFileSync(this.automation.env.GITHUB_STEP_SUMMARY, "utf8");
  const status = this.automation.calls().at(-1).body;
  for (const value of ["**success**", SHA, status.environment_url, `https://12345678.${PROJECT}.pages.dev`])
    assert.ok(summary.includes(value), summary);
});

Then("GitHub records a failed Pages deployment with {string}", function (reason)
{
  assert.notEqual(this.result.status, 0);
  verifyGithubRecords(this, "failure");
  assert.ok(this.result.stderr.includes(reason), this.result.stderr);
  const summary = readFileSync(this.automation.env.GITHUB_STEP_SUMMARY, "utf8");
  assert.ok(summary.includes("**failure**"), summary);
  for (const secret of [this.automation.env.GH_TOKEN, this.automation.env.CLOUDFLARE_API_TOKEN].filter(Boolean))
  {
    assert.ok(!summary.includes(secret), summary);
    assert.ok(!this.automation.calls().at(-1).body.description.includes(secret));
  }
});

Then("Pages recording fails with {string} and safe deployment context", function (reason)
{
  assert.notEqual(this.result.status, 0);
  for (const value of [reason, "HTTP 403: Forbidden", "[REDACTED]", REPOSITORY, "branch=develop", SHA, BUNDLE, DEPLOYMENT])
    assert.ok(this.result.stderr.includes(value), this.result.stderr);
});

Then("no external Pages recording request is made", function ()
{
  assert.notEqual(this.result.status, 0);
  assert.deepEqual(this.automation.calls(), []);
});
