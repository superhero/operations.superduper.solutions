// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Given, When, Then } from "@cucumber/cucumber";
import { API, REPOSITORY, SHA, OTHER_SHA, BASE_SHA, get, post } from "./support.mjs";

const PULLS = `${API}/pulls?state=all&base=main&per_page=100`;
const RUNS = `${API}/actions/workflows/ci-main.yml/runs`;
const ASSOCIATED = `${API}/commits/${BASE_SHA}/pulls?per_page=100`;
const ARTIFACTS = `${API}/actions/runs/42/artifacts?per_page=100`;
const marker = `<!-- release-source:123:${SHA} -->`;

function release(branch = "release/0.0.25")
{
  return {
    number: 124, state: "closed", merged: true, merged_at: "2026-10-04T16:24:20Z",
    merge_commit_sha: BASE_SHA, body: marker,
    head: { ref: branch, sha: SHA, repo: { full_name: REPOSITORY } },
    base: { ref: "main", repo: { full_name: REPOSITORY } },
  };
}

function source()
{
  return { state: "open", draft: false, head: { ref: "develop", sha: SHA,
    repo: { full_name: REPOSITORY } }, base: { ref: "main" } };
}

function createPrefix(tags = [{ name: "0.0.24" }], branches = [])
{
  return [get(PULLS, []), get(`${API}/pulls/123`, source()),
    get(`${API}/compare/main...${SHA}`, { ahead_by: 2, behind_by: 0 }),
    get(`${API}/tags?per_page=100`, tags), get(`${API}/git/matching-refs/heads/`, branches)];
}

function ciRun(id = 42, branch = "release/0.0.25")
{
  return { id, head_branch: branch, head_sha: SHA, head_repository: { full_name: REPOSITORY },
    event: "pull_request", pull_requests: [] };
}

function ciPrefix(runs = [ciRun()], branch = "release/0.0.25")
{
  return [get(`${API}/pulls/124`, release(branch)), get(RUNS, { workflow_runs: runs },
    { fields: { head_sha: SHA, branch, event: "pull_request" } })];
}

function artifacts()
{
  return ["bundle", "coverage", "test-report"].map(name => ({ name, expired: false }));
}

function completed(id = 42, conclusion = "success")
{
  return get(`${API}/actions/runs/${id}`, { status: "completed", conclusion });
}

function invoke(world, script, args, success)
{
  world.releaseResult = world.automation.execute(script, args, world.releaseQueue, { success });
}

function output(world)
{
  return readFileSync(world.automation.output, "utf8");
}

function failure(world, reason, context)
{
  assert.ok(world.releaseResult.stderr.includes(reason), world.releaseResult.stderr);
  for(const item of [`repository=${REPOSITORY}`, ...context])
  {
    assert.ok(world.releaseResult.stderr.includes(item), world.releaseResult.stderr);
  }
}

Given("the latest release tag is {string}", function (tag)
{
  this.releaseQueue = [...createPrefix([{ name: tag }]),
    post(`${API}/git/refs`, {}, { fields: { ref: "refs/heads/release/0.0.25", sha: SHA } }),
    post(`${API}/pulls`, { number: 124 }, { fields: { head: "release/0.0.25", base: "main" } })];
});

Given("the same release already has {string}", function (existing)
{
  if(existing === "only its branch")
  {
    this.releaseQueue = [...createPrefix(undefined, [
      { ref: "refs/heads/release/0.0.25", object: { sha: SHA } },
    ]), post(`${API}/pulls`, { number: 124 })];
    return;
  }
  const pr = release();
  if(existing === "an open PR")
  {
    pr.state = "open";
    pr.merged_at = null;
    pr.head.sha = OTHER_SHA;
  }
  else
  {
    assert.equal(existing, "a merged PR");
    pr.body = `Automatically created from develop by PR #123 at ${SHA}.`;
  }
  this.releaseQueue = [get(PULLS, [], { pages: [[], [pr]] })];
});

Given("release creation encounters {string}", function (conflict)
{
  switch(conflict)
  {
    case "a hotfix reserving the version":
      this.releaseQueue = createPrefix(undefined, [{ ref: "refs/heads/hotfix/0.0.25", object: { sha: OTHER_SHA } }]);
      break;
    case "the branch at another commit":
      this.releaseQueue = createPrefix(undefined, [{ ref: "refs/heads/release/0.0.25", object: { sha: OTHER_SHA } }]);
      break;
    case "an advanced source PR":
      const trigger = source();
      trigger.head.sha = OTHER_SHA;
      this.releaseQueue = [get(PULLS, []), get(`${API}/pulls/123`, trigger)];
      break;
    default: assert.fail(`Unknown conflict: ${conflict}`);
  }
});

When("release creation succeeds", function ()
{
  invoke(this, "create-release-pr.sh", [REPOSITORY, "123", SHA], true);
});
When("release creation is refused", function ()
{
  invoke(this, "create-release-pr.sh", [REPOSITORY, "123", SHA], false);
});
Then("release PR {int} identifies version {string}", function (number, version)
{
  assert.equal(output(this), `version=${version}\nrelease_pr=${number}\n`);
});
Then("release PR {int} identifies version {string} and its source commit", function (number, version)
{
  assert.equal(output(this), `version=${version}\nrelease_pr=${number}\n`);
  const request = this.automation.calls().find(call => call.method === "POST" && call.endpoint === `${API}/pulls`);
  assert.ok(request.fields.body.includes(marker));
});
Then("no release comments are posted", function ()
{
  assert.ok(this.automation.calls().every(call => !call.endpoint.includes("/comments")));
});
Then("the retry performs {int} GitHub writes", function (count)
{
  assert.equal(this.automation.calls().filter(call => call.method !== "GET").length, count);
});
Then("release automation reports {string} with the source PR and commit", function (reason)
{
  failure(this, reason, ["source_pr=123", `source_sha=${SHA}`]);
});
Then("no release output or GitHub writes are produced", function ()
{
  assert.equal(output(this), "");
  assert.ok(this.automation.calls().every(call => call.method === "GET"));
});
Then("no release output is produced", function () { assert.equal(output(this), ""); });

Given("GitHub rejects {string} with HTTP 503", function (operation)
{
  const operations = {
    "listing releases": ["create-release-pr.sh", [REPOSITORY, "123", SHA], [get(PULLS)], ["source_pr=123", `source_sha=${SHA}`]],
    "opening the release PR": ["create-release-pr.sh", [REPOSITORY, "123", SHA],
      [...createPrefix(), post(`${API}/git/refs`), post(`${API}/pulls`)], ["source_pr=123", `source_sha=${SHA}`]],
    "finding release artifacts": ["find-release-ci.sh", [REPOSITORY, "124", SHA, "0"],
      [...ciPrefix(), completed(), get(ARTIFACTS)], ["release_pr=124", `head_sha=${SHA}`, "run_id=42"]],
  };
  assert.ok(operations[operation], `Unknown operation: ${operation}`);
  [this.releaseScript, this.releaseArgs, this.releaseQueue, this.releaseContext] = operations[operation];
  Object.assign(this.releaseQueue.at(-1), { exit_code: 1, stderr: "gh: HTTP 503\n" });
});
When("that release operation is attempted", function ()
{
  invoke(this, this.releaseScript, this.releaseArgs, false);
});
Then("release automation reports {string} and the GitHub failure", function (reason)
{
  failure(this, reason, [...this.releaseContext, "gh: HTTP 503"]);
});

Given("the pushed commit has a merged {string} PR after a develop PR on another page", function (branch)
{
  this.releaseQueue = [get(ASSOCIATED, [], { pages: [[release("develop")], [release(branch)]] })];
});
Given("the pushed commit has {string}", function (association)
{
  const pr = release();
  const associations = [pr];
  switch(association)
  {
    case "a different merge commit": pr.merge_commit_sha = OTHER_SHA; break;
    case "a fork PR": pr.head.repo.full_name = "another/repository"; break;
    case "two matching PRs": associations.push({ ...release("hotfix/0.0.26"), number: 125 }); break;
    default: assert.fail(`Unknown association: ${association}`);
  }
  this.releaseQueue = [get(ASSOCIATED, associations)];
});
When("the pushed release is resolved", function () { invoke(this, "find-release-pr.sh", [REPOSITORY, BASE_SHA], true); });
When("the pushed release is refused", function () { invoke(this, "find-release-pr.sh", [REPOSITORY, BASE_SHA], false); });
Then("only PR {int} and its validated {string} head are returned", function (number, branch)
{
  assert.equal(output(this), `pr_number=${number}\nhead_branch=${branch}\nhead_sha=${SHA}\n`);
  assert.ok(this.automation.calls().every(call => call.method === "GET"));
});
Then("release identity reports {string} with the pushed commit", function (reason)
{
  failure(this, reason, [`merge_sha=${BASE_SHA}`]);
});

Given("a merged {string} PR has these CI runs", function (branch, table)
{
  const runs = table.hashes().map(row => ({ ...ciRun(Number(row.id), row.branch === "release" ? branch : row.branch),
    event: row.event, head_sha: row.commit === "tested" ? SHA : OTHER_SHA,
    pull_requests: [{ number: Number(row.PR) }] }));
  this.releaseQueue = ciPrefix(runs, branch);
});
Given("release CI run {int} succeeded with all required artifacts", function (id)
{
  this.releaseQueue.push(completed(id), get(`${API}/actions/runs/${id}/artifacts?per_page=100`, { artifacts: artifacts() }));
});
Given("release CI run {int} finished with {string}", function (id, conclusion)
{
  this.releaseQueue.push(completed(id, conclusion));
});
Given("release CI succeeded but {string} is {string}", function (name, condition)
{
  assert.ok(["missing", "expired"].includes(condition));
  const available = artifacts().filter(item => condition !== "missing" || item.name !== name)
    .map(item => ({ ...item, expired: condition === "expired" && item.name === name }));
  this.releaseQueue = [...ciPrefix(), completed(), get(ARTIFACTS, { artifacts: available })];
});
Given("release CI appears after a delay and finishes on the next poll", function ()
{
  this.releaseTimeout = "30";
  this.releaseQueue = [...ciPrefix([]), get(RUNS, {}, { pages: [{ workflow_runs: [] }, { workflow_runs: [ciRun()] }] }),
    get(`${API}/actions/runs/42`, { status: "in_progress", conclusion: null }), completed(),
    get(ARTIFACTS, {}, { pages: [{ artifacts: artifacts().slice(0, 1) }, { artifacts: artifacts().slice(1) }] })];
});
Given("the release PR has not merged", function ()
{
  this.releaseQueue = [get(`${API}/pulls/124`, { ...release(), merged: false })];
});
When("release artifacts are selected", function ()
{
  invoke(this, "find-release-ci.sh", [REPOSITORY, "124", SHA, this.releaseTimeout ?? "0"], true);
});
When("release artifact selection is refused", function ()
{
  invoke(this, "find-release-ci.sh", [REPOSITORY, "124", SHA, "0"], false);
});
Then("only release CI run {int} supplies artifacts", function (id)
{
  assert.equal(output(this), `run_id=${id}\n`);
  for(const call of this.automation.calls().filter(call => call.endpoint === RUNS))
  {
    assert.equal(call.fields.event, "pull_request");
  }
});
Then("artifact selection reports {string} with the release and commit", function (reason)
{
  failure(this, reason, ["release_pr=124", `head_sha=${SHA}`]);
});

Given("main contains {string}", function (commit)
{
  assert.ok(["this release", "a newer release"].includes(commit));
  this.releaseCurrent = commit === "this release";
  this.releaseQueue = [get(`${API}/git/ref/heads/main`, { object: { sha: this.releaseCurrent ? SHA : OTHER_SHA } })];
});
When("production freshness is checked", function ()
{
  invoke(this, "validate-current-release.sh", [REPOSITORY, SHA], this.releaseCurrent);
});
Then("production publishing is {string}", function (decision)
{
  assert.equal(this.releaseResult.status === 0, decision === "allowed");
  if(decision === "refused")
  {
    failure(this, "refusing to overwrite production", [`merge_sha=${SHA}`, `expected main=${SHA}, actual main=${OTHER_SHA}`]);
  }
  assert.ok(this.automation.calls().every(call => call.method === "GET"));
});
