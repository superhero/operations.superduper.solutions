// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, When, Then } from "@cucumber/cucumber";
import { API, REPOSITORY, SHA, OTHER_SHA, BASE_SHA, get, post } from "./support.mjs";
import { badgeAdvance, dependencyBadge } from "./badge-advance.test.mjs";

const PULLS = `${API}/pulls?state=all&base=main&per_page=100`;
const marker = `<!-- release-source:123:${SHA} -->`;
const TREE = "e".repeat(40);
const PRIOR_MAIN = "f".repeat(40);
const PRIOR_TREE = "d".repeat(40);

function preparedRelease(main = BASE_SHA, tree = TREE)
{
  return { sha: OTHER_SHA, parents: [{ sha: SHA }, { sha: main }], commit: { tree: { sha: tree } } };
}

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
    get(`${API}/compare/main...${SHA}`, { ahead_by: 2, behind_by: 0, base_commit: { sha: BASE_SHA } }),
    get(`${API}/tags?per_page=100`, tags), get(`${API}/git/matching-refs/heads/`, branches)];
}

function invoke(world, script, args, success)
{
  if (script === "create-release-pr.sh")
  {
    // Release tests isolate API orchestration; merge-preview tests use real Git histories.
    writeFileSync(join(world.automation.root, "git"), `#!/bin/sh
case "$1" in
  cat-file) exit 0 ;;
  merge-tree) if [ "$3" = '${PRIOR_MAIN}' ]; then printf '%s\\n' '${PRIOR_TREE}'; else printf '%s\\n' '${TREE}'; fi ;;
  diff) if [ -n "$RELEASE_CHANGED_PATH" ]; then printf '%s\\0' "$RELEASE_CHANGED_PATH"; fi ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
    world.automation.env.RELEASE_CHANGED_PATH = world.releaseChangedPath ?? "src/bootstrap.ts";
  }
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

Given("develop has unreleased changes and main has only newer dependency badges", function ()
{
  this.releaseQueue = createPrefix();
  this.releaseQueue[2].response.behind_by = 1;
  this.releaseQueue.push(post(`${API}/git/refs`, {}, { fields: { ref: "refs/heads/release/0.0.25", sha: SHA } }),
    post(`${API}/merges`, preparedRelease(), { fields: { base: "release/0.0.25", head: BASE_SHA } }),
    post(`${API}/pulls`, { number: 124 }, { fields: { head: "release/0.0.25", base: "main" } }));
});

Given("develop has new work after squash synchronization with main", function ()
{
  this.releaseQueue = createPrefix();
  this.releaseQueue[2].response.behind_by = 3;
  this.releaseQueue.push(post(`${API}/git/refs`, {}, { fields: { ref: "refs/heads/release/0.0.25", sha: SHA } }),
    post(`${API}/merges`, preparedRelease(), { fields: { base: "release/0.0.25", head: BASE_SHA } }),
    post(`${API}/pulls`, { number: 124 }));
});

Given("the same release already has {string}", function (existing)
{
  if(["only its branch", "its prepared integration", "its integration before a badge update"].includes(existing))
  {
    const prepared = existing !== "only its branch";
    const badgesAdvanced = existing === "its integration before a badge update";
    this.releaseQueue = [...createPrefix(undefined, [
      { ref: "refs/heads/release/0.0.25", object: { sha: prepared ? OTHER_SHA : SHA } },
    ])];
    if (prepared)
    {
      this.releaseQueue[2].response.behind_by = 3;
      this.releaseQueue.push(get(`${API}/commits/${OTHER_SHA}`,
        badgesAdvanced ? preparedRelease(PRIOR_MAIN, PRIOR_TREE) : preparedRelease()));
      if (badgesAdvanced) this.releaseQueue.push(...badgeAdvance(PRIOR_MAIN, BASE_SHA));
    }
    this.releaseQueue.push(post(`${API}/pulls`, { number: 124 }));
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
      this.releaseQueue.push(get(`${API}/commits/${OTHER_SHA}`, { ...preparedRelease(), parents: [{ sha: BASE_SHA }] }));
      break;
    case "a prepared branch with another tree":
      this.releaseQueue = createPrefix(undefined, [{ ref: "refs/heads/release/0.0.25", object: { sha: OTHER_SHA } }]);
      this.releaseQueue.push(get(`${API}/commits/${OTHER_SHA}`, { ...preparedRelease(), commit: { tree: { sha: BASE_SHA } } }));
      break;
    case "main code changing after preparation":
      this.releaseQueue = createPrefix(undefined, [{ ref: "refs/heads/release/0.0.25", object: { sha: OTHER_SHA } }]);
      this.releaseQueue[2].response.behind_by = 3;
      this.releaseQueue.push(get(`${API}/commits/${OTHER_SHA}`, preparedRelease(PRIOR_MAIN, PRIOR_TREE)),
        ...badgeAdvance(PRIOR_MAIN, BASE_SHA, [{ filename: "src/bootstrap.ts" }]));
      break;
    case "an advanced source PR":
      const trigger = source();
      trigger.head.sha = OTHER_SHA;
      this.releaseQueue = [get(PULLS, []), get(`${API}/pulls/123`, trigger)];
      break;
    case "only dependency badge changes":
    case "already released content after squash":
      this.releaseQueue = createPrefix().slice(0, 3);
      this.releaseQueue[2].response.behind_by = 3;
      this.releaseChangedPath = conflict === "only dependency badge changes" ? dependencyBadge : "";
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

function releaseState(branch, merged = false, mergeSha = OTHER_SHA)
{
  return { ...release(branch), state: merged ? "closed" : "open", draft: false,
    merged, merged_at: merged ? "2026-10-05T16:24:20Z" : null,
    merge_commit_sha: merged ? mergeSha : null,
    base: { ref: "main", sha: BASE_SHA, repo: { full_name: REPOSITORY } } };
}

const releaseRead = pr => get(`${API}/pulls/124`, pr);
const currentMain = sha => get(`${API}/git/ref/heads/main`, { object: { sha } });
const squashCommand = ["pr", "merge", "124", "--repo", REPOSITORY, "--auto", "--squash", "--match-head-commit", SHA];

function releaseComparison()
{
  return get(`${API}/compare/${BASE_SHA}...${SHA}`, {
    status: "ahead", ahead_by: 2, behind_by: 0, total_commits: 2,
    base_commit: { sha: BASE_SHA }, merge_base_commit: { sha: BASE_SHA }
  });
}

Given("release PR {string} is {string} during {string}", function (branch, condition, operation)
{
  this.releaseOperation = operation;
  this.releaseExpectedBranch = branch;
  this.releaseTimeout = "30";
  this.releaseMergedSha = OTHER_SHA;
  const open = releaseState(branch);
  const merged = releaseState(branch, true);
  this.releaseQueue = [releaseRead(open)];
  switch (condition)
  {
    case "open and valid":
    case "an open draft":
      open.draft = condition === "an open draft";
      this.releaseQueue.push(get(`${API}/tags?per_page=100`, []),
        get(`${API}/pulls?state=closed&base=main&per_page=100`, []),
        get(`${API}/git/matching-refs/heads/`, []), get(`${API}/compare/main...${SHA}`, { behind_by: 0 }));
      break;
    case "already merged":
      this.releaseQueue = [releaseRead(merged), currentMain(OTHER_SHA)];
      break;
    case "already merged with a delayed merge SHA":
      this.releaseQueue = [releaseRead({ ...merged, merge_commit_sha: null }),
        releaseRead(merged), currentMain(OTHER_SHA)];
      break;
    case "already merged with newer badges":
      this.releaseQueue = [releaseRead(merged), currentMain(BASE_SHA), ...badgeAdvance(OTHER_SHA, BASE_SHA)];
      break;
    case "merged during validation":
      this.releaseQueue.push(get(`${API}/tags?per_page=100`, [{ name: "0.0.25" }]),
        releaseRead(merged), currentMain(OTHER_SHA));
      break;
    case "merged before the merge helper reads it":
      this.releaseQueue.push(releaseRead(merged), releaseRead(merged), currentMain(OTHER_SHA));
      break;
    case "merged despite a merge command error":
      this.releaseQueue.push(releaseRead(open), releaseComparison(),
        { command: squashCommand, exit_code: 1, stderr: "gh: HTTP 503\n" },
        releaseRead(merged), currentMain(OTHER_SHA));
      break;
    case "queued before it merges":
      this.releaseQueue.push(releaseRead(open), releaseComparison(), { command: squashCommand },
        releaseRead(open), releaseRead(merged), currentMain(OTHER_SHA));
      break;
    case "fast-forwarded by the merge helper":
      this.releaseMergedSha = SHA;
      merged.merge_commit_sha = SHA;
      this.releaseQueue.push(releaseRead(open), releaseComparison(), releaseRead(open),
        { method: "PATCH", endpoint: `${API}/git/refs/heads/main`, fields: { sha: SHA, force: "false" },
          response: { ref: "refs/heads/main", object: { type: "commit", sha: SHA } } },
        releaseRead(merged), releaseRead(merged), currentMain(SHA));
      break;
    default: assert.fail(`Unknown release PR condition: ${condition}`);
  }
});

Given("release PR orchestration encounters {string} during {string}", function (condition, operation)
{
  this.releaseOperation = operation;
  this.releaseExpectedBranch = "hotfix/0.0.25";
  this.releaseTimeout = "0";
  const open = releaseState(this.releaseExpectedBranch);
  const merged = releaseState(this.releaseExpectedBranch, true);
  this.releaseQueue = [releaseRead(open)];
  switch (condition)
  {
    case "a source fork": open.head.repo.full_name = "another/repository"; break;
    case "a target fork": open.base.repo.full_name = "another/repository"; break;
    case "a changed source branch": open.head.ref = "hotfix/0.0.26"; break;
    case "a changed source commit": open.head.sha = BASE_SHA; break;
    case "a changed target branch": open.base.ref = "develop"; break;
    case "a closed unmerged PR": open.state = "closed"; break;
    case "a draft PR": open.draft = true; break;
    case "an invalid actual merge SHA":
    case "a missing actual merge SHA":
      merged.merge_commit_sha = condition === "a missing actual merge SHA" ? null : "invalid-merge-sha";
      this.releaseQueue = [releaseRead(merged)];
      break;
    case "a superseded merged release":
      this.releaseQueue = [releaseRead(merged), currentMain(BASE_SHA),
        ...badgeAdvance(OTHER_SHA, BASE_SHA, [{ filename: "src/bootstrap.ts" }])];
      break;
    case "a failed version validation":
      this.releaseQueue.push(get(`${API}/tags?per_page=100`, [{ name: "0.0.25" }]), releaseRead(open));
      break;
    case "a failed validation API":
      this.releaseQueue.push(get(`${API}/tags?per_page=100`, {}, { exit_code: 1, stderr: "gh: HTTP 503\n" }), releaseRead(open));
      break;
    case "an unavailable PR API":
      Object.assign(this.releaseQueue[0], { exit_code: 1, stderr: "gh: HTTP 503\n" });
      break;
    case "a failed merge command":
      this.releaseQueue.push(releaseRead(open), releaseComparison(),
        { command: squashCommand, exit_code: 1, stderr: "gh: HTTP 503\n" }, releaseRead(open));
      break;
    case "a merge that remains queued":
    case "an identity change while waiting":
    case "an unavailable confirmation API":
      this.releaseQueue.push(releaseRead(open), releaseComparison(), { command: squashCommand });
      const followup = releaseRead(structuredClone(open));
      if (condition === "an identity change while waiting") followup.response.head.sha = BASE_SHA;
      if (condition === "an unavailable confirmation API")
        Object.assign(followup, { exit_code: 1, stderr: "gh: HTTP 503\n" });
      this.releaseQueue.push(followup);
      break;
    default: assert.fail(`Unknown orchestration failure: ${condition}`);
  }
});

When("release PR orchestration runs", function ()
{
  const args = [REPOSITORY, "124", this.releaseExpectedBranch, SHA, BASE_SHA];
  if (this.releaseOperation === "merge") args.push(this.releaseTimeout);
  invoke(this, `${this.releaseOperation}-release-pr.sh`, args, null);
});

Then("the release PR is {string} with {int} GitHub writes", function (result, writes)
{
  assert.equal(this.releaseResult.status, 0, this.releaseResult.stderr);
  assert.equal(output(this), result === "validated" ? "" :
    `merge_sha=${this.releaseMergedSha}\nhead_branch=${this.releaseExpectedBranch}\nhead_sha=${SHA}\npr_number=124\n`);
  assert.equal(this.automation.calls().filter(call => call.method !== "GET").length, writes);
  assert.ok(!this.releaseResult.stderr.includes("::error::"), this.releaseResult.stderr);
});

Then("release PR orchestration refuses {string} with {int} GitHub writes", function (reason, writes)
{
  assert.notEqual(this.releaseResult.status, 0, this.releaseResult.stdout);
  failure(this, reason, ["release_pr=124", `head_branch=${this.releaseExpectedBranch}`, `head_sha=${SHA}`, `tested_base_sha=${BASE_SHA}`]);
  assert.equal(output(this), "");
  assert.equal(this.automation.calls().filter(call => call.method !== "GET").length, writes);
});

Given("main contains {string}", function (commit)
{
  assert.ok(["this release", "a newer release", "only newer dependency badges"].includes(commit));
  this.releaseCurrent = commit !== "a newer release";
  this.releaseQueue = [get(`${API}/git/ref/heads/main`, { object: { sha: commit === "this release" ? SHA : OTHER_SHA } })];
  if (commit !== "this release")
  {
    const advance = badgeAdvance(SHA, OTHER_SHA);
    if (commit === "a newer release")
    {
      advance[0].response.commits[0].parents.push({ sha: BASE_SHA });
      advance.pop();
    }
    this.releaseQueue.push(...advance);
  }
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
