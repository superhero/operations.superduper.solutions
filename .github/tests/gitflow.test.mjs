// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { API, BASE_SHA, OTHER_SHA, REPOSITORY, SHA, get } from "./support.mjs";
import { badgeAdvance } from "./badge-advance.test.mjs";

const TAGS = `${API}/tags?per_page=100`;
const BRANCHES = `${API}/git/matching-refs/heads/`;
const CLOSED_PULLS = `${API}/pulls?state=closed&base=main&per_page=100`;
const MERGE = ["pr", "merge", "123", "--repo", REPOSITORY,
  "--auto", "--merge", "--match-head-commit", SHA];

function availableVersion(tags = [], branches = [])
{
  return [
    get(TAGS, tags.map(name => ({ name }))),
    get(CLOSED_PULLS, []),
    get(BRANCHES, branches.map(branch => ({ ref: `refs/heads/${branch}` })))
  ];
}

function mergedRelease(version, kind = "release")
{
  return {
    merged_at: "2026-10-04T16:24:20Z",
    merge_commit_sha: BASE_SHA,
    head: { ref: `${kind}/${version}`, repo: { full_name: REPOSITORY } }
  };
}

function pullRequest()
{
  return {
    state: "open", draft: false,
    base: { ref: "main", sha: BASE_SHA },
    head: { sha: SHA, repo: { full_name: REPOSITORY } }
  };
}

function checkResult(result, outcome, context)
{
  if (outcome === "accepted")
    assert.equal(result.status, 0, result.stderr);
  else
  {
    assert.notEqual(result.status, 0, result.stdout);
    for (const value of context)
      assert.ok(result.stderr.includes(value), `Missing failure context: ${value}\n${result.stderr}`);
  }
}

Given("a repository without released versions or active release branches", function ()
{
  this.policyResponses = undefined;
});

Given("version {string} has {string}", function (version, reservation)
{
  const tagged = get(TAGS, [{ name: version }]);
  const merged = [get(TAGS, []), get(CLOSED_PULLS, {}, { pages: [[], [mergedRelease(version)]] })];
  switch (reservation)
  {
    case "a published tag":
      this.policyResponses = base => base === "main" ? [tagged] :
        [tagged, get(`${API}/compare/${SHA}...${version}`, { behind_by: 0 })];
      break;
    case "a merged release awaiting its tag":
      this.policyResponses = merged;
      break;
    case "an active hotfix with this version":
      this.policyResponses = availableVersion([], [`hotfix/${version}`]);
      break;
    case "another active release":
      this.policyResponses = availableVersion([], ["release/1.3.0"]);
      break;
    case "unmerged changes after its release":
      this.policyResponses = [...merged, get(`${API}/compare/${SHA}...${BASE_SHA}`, {
        behind_by: 1, merge_base_commit: { sha: BASE_SHA }
      }), ...badgeAdvance(BASE_SHA, SHA, [{ filename: "src/bootstrap.ts" }])];
      break;
    case "only badge changes after its release":
      this.policyResponses = [tagged, get(`${API}/compare/${SHA}...${version}`, {
        behind_by: 1, merge_base_commit: { sha: BASE_SHA }
      }), ...badgeAdvance(BASE_SHA, SHA)];
      break;
    default: throw new Error(`Unknown reservation: ${reservation}`);
  }
});

Given("main has commits missing from the release head", function ()
{
  this.policyResponses = [...availableVersion(), get(`${API}/compare/main...${SHA}`, {
    behind_by: 1, merge_base_commit: { sha: BASE_SHA }, base_commit: { sha: OTHER_SHA }
  }), ...badgeAdvance(BASE_SHA, OTHER_SHA, [{ filename: "src/bootstrap.ts" }])];
});

Given("main only has dependency badge commits missing from the release head", function ()
{
  this.policyResponses = [...availableVersion(), get(`${API}/compare/main...${SHA}`, {
    behind_by: 1, merge_base_commit: { sha: BASE_SHA }, base_commit: { sha: OTHER_SHA }
  }), ...badgeAdvance(BASE_SHA, OTHER_SHA)];
});

Given("support line {string} contains {string} but not {string}", function (base, reachable, unrelated)
{
  this.policyResponses = [
    ...availableVersion([reachable, unrelated]),
    get(`${API}/compare/${unrelated}...${base}`, { behind_by: 3 }),
    get(`${API}/compare/${reachable}...${base}`, { behind_by: 0 })
  ];
});

Given("GitHub cannot list repository tags", function ()
{
  this.policyResponses = [get(TAGS, {}, { exit_code: 1, stderr: "GitHub unavailable" })];
});

function hotfixSynchronization(state, base)
{
  const { version, reservation, target = "active", changes, failure, supportBase = "1.2.3" } = state;
  const tagged = reservation === "with a tag";
  const targetVersion = base.replace(/^release\//, "");
  const tags = tagged ? [version] : [];
  const closed = tagged ? [] : [mergedRelease(version, "hotfix")];
  if (target === "tagged") tags.push(targetVersion);
  if (target === "merged") closed.push(mergedRelease(targetVersion));
  if (base.startsWith("support/") && supportBase) tags.push(supportBase);
  const responses = [get(TAGS, tags.map(name => ({ name })))];
  const unavailable = { exit_code: 1, stderr: "GitHub unavailable" };
  if (!tagged) responses.push(get(CLOSED_PULLS, closed));
  if (base === "main") return responses;
  if (base.startsWith("release/"))
  {
    if (!/^release\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(base) || target === "tagged") return responses;
    if (tagged) responses.push(get(CLOSED_PULLS, closed, failure === "target lookup" ? unavailable : {}));
    if (target === "merged" || failure === "target lookup") return responses;
  }
  const released = tagged ? version : BASE_SHA;
  responses.push(get(`${API}/compare/${SHA}...${released}`, {
    behind_by: changes ? 1 : 0, merge_base_commit: { sha: BASE_SHA }
  }, failure === "source comparison" ? unavailable : {}));
  if (failure === "source comparison") return responses;
  if (changes)
  {
    responses.push(...badgeAdvance(BASE_SHA, SHA, changes === "code" ? [{ filename: "src/bootstrap.ts" }] : undefined));
    if (changes === "code") return responses;
  }
  if (base.startsWith("support/"))
  {
    for (const tag of [...tags].sort((left, right) => right.localeCompare(left, undefined, { numeric: true })))
    {
      responses.push(get(`${API}/compare/${tag}...${base}`, { behind_by: tag === supportBase ? 0 : 1 },
        failure === "support comparison" ? unavailable : {}));
      if (tag === supportBase || failure === "support comparison") break;
    }
  }
  return responses;
}

Given("hotfix {string} was released {string}", function (version, reservation)
{
  assert.ok(["with a tag", "awaiting its tag"].includes(reservation), reservation);
  this.releasedHotfix = { version, reservation };
  this.policyResponses = base => hotfixSynchronization(this.releasedHotfix, base);
});

Given("the hotfix release target is {string}", function (target)
{
  this.releasedHotfix.target = target;
});

Given("the released hotfix has later {string} changes", function (changes)
{
  this.releasedHotfix.changes = changes;
});

Given("the support target has {string}", function (line)
{
  this.releasedHotfix.supportBase = line === "no released base" ? null : "1.2.9";
});

Given("GitHub fails during hotfix synchronization {string}", function (failure)
{
  this.releasedHotfix.failure = failure;
});

When("Gitflow validates {string} into {string}", function (head, base)
{
  this.policyArguments = [REPOSITORY, head, base, SHA];
  let responses = typeof this.policyResponses === "function" ? this.policyResponses(base) : this.policyResponses;
  if (!responses)
  {
    responses = [];
    if (/^(release|hotfix)\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(head))
    {
      responses = availableVersion();
      if (base === "main") responses.push(get(`${API}/compare/main...${SHA}`, { behind_by: 0 }));
    }
  }
  this.policyResult = this.automation.execute("validate-pr.sh", this.policyArguments, responses, { success: null });
});

Then("Gitflow validation is {string}", function (outcome)
{
  checkResult(this.policyResult, outcome, this.policyArguments);
  assert.ok(this.automation.calls().every(call => !call.command && call.method === "GET"));
});

Then("the Gitflow error explains {string}", function (reason)
{
  if (reason) assert.ok(this.policyResult.stderr.includes(reason), this.policyResult.stderr);
});

Given("the validated pull request has {string} when merging starts", function (state)
{
  const pr = pullRequest();
  switch (state)
  {
    case "no changes": break;
    case "been closed": pr.state = "closed"; break;
    case "become a draft": pr.draft = true; break;
    case "a different head": pr.head.sha = OTHER_SHA; break;
    case "a different target": pr.base.ref = "develop"; break;
    case "a newer base commit": pr.base.sha = OTHER_SHA; break;
    case "newer base dependency badges": pr.base.sha = OTHER_SHA; break;
    case "a fork as its source": pr.head.repo.full_name = "other/repository"; break;
    case "fallen behind main": break;
    default: throw new Error(`Unknown pull request state: ${state}`);
  }
  this.mergeResponses = [get(`${API}/pulls/123`, pr)];
  if (["a newer base commit", "newer base dependency badges"].includes(state))
    this.mergeResponses.push(...badgeAdvance(BASE_SHA, OTHER_SHA,
      state === "a newer base commit" ? [{ filename: "src/bootstrap.ts" }] : undefined));
  if (["no changes", "fallen behind main"].includes(state))
    this.mergeResponses.push(get(`${API}/compare/main...${SHA}`, { behind_by: state === "no changes" ? 0 : 1,
      merge_base_commit: { sha: BASE_SHA }, base_commit: { sha: OTHER_SHA } }));
  if (state === "fallen behind main")
    this.mergeResponses.push(...badgeAdvance(BASE_SHA, OTHER_SHA, [{ filename: "src/bootstrap.ts" }]));
  if (state === "newer base dependency badges")
    this.mergeResponses.push(get(`${API}/compare/main...${SHA}`, { behind_by: 1,
      merge_base_commit: { sha: BASE_SHA }, base_commit: { sha: OTHER_SHA } }), ...badgeAdvance(BASE_SHA, OTHER_SHA));
  this.mergeAttempted = ["no changes", "newer base dependency badges"].includes(state);
  if (this.mergeAttempted) this.mergeResponses.push({ command: MERGE });
});

Given("GitHub fails while {string}", function (operation)
{
  const responses = [
    get(`${API}/pulls/123`, pullRequest()),
    get(`${API}/compare/main...${SHA}`, { behind_by: 0 }),
    { command: MERGE }
  ];
  const index = ["reading the pull request", "comparing main to the head", "submitting the merge"].indexOf(operation);
  assert.ok(index >= 0, operation);
  this.mergeResponses = responses.slice(0, index + 1);
  Object.assign(this.mergeResponses[index], { exit_code: 1, stderr: "GitHub unavailable" });
  this.mergeAttempted = index === 2;
});

When("automatic merging runs", function ()
{
  this.mergeResult = this.automation.execute("auto-merge.sh",
    [REPOSITORY, "123", SHA, "main", BASE_SHA], this.mergeResponses, { success: null });
});

Then("automatic merging is {string}", function (outcome)
{
  checkResult(this.mergeResult, outcome, [REPOSITORY, "PR #123", SHA, "main", BASE_SHA]);
  assert.deepEqual(this.automation.calls().filter(call => call.command).map(call => call.command),
    this.mergeAttempted ? [MERGE] : []);
});

Then("the merge error explains {string}", function (reason)
{
  if (reason) assert.ok(this.mergeResult.stderr.includes(reason), this.mergeResult.stderr);
});
