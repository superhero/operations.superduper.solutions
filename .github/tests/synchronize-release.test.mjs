// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Given, Then, When } from "@cucumber/cucumber";
import { API, BASE_SHA, OTHER_SHA, REPOSITORY, SHA, get, post } from "./support.mjs";
import { badgeAdvance, dependencyBadge } from "./badge-advance.test.mjs";
import { releasedContent } from "./released-content.test.mjs";

const HOTFIX = "hotfix/0.0.25";
const RELEASE = "release/0.0.26";
const BADGE_SHA = "d".repeat(40);
const RECONCILED_SHA = "e".repeat(40);
const RELEASES = `${API}/pulls?state=open&base=main&per_page=100`;
const REFS = `${API}/git/matching-refs/heads/${HOTFIX}`;
const TAGS = `${API}/git/matching-refs/tags/0.0.26`;
const URL = `https://github.com/${REPOSITORY}/pull/125`;

function pull(head, base, sha = OTHER_SHA)
{
  return { number: 124, state: "open", html_url: URL,
    head: { ref: head, sha, repo: { full_name: REPOSITORY } }, base: { ref: base } };
}

function findPull(head, base, existing = false)
{
  return get(`${API}/pulls`, existing ? [pull(head, base)] : [], {
    fields: { state: "open", base, head: `superhero:${head}`, per_page: "100" }
  });
}

function createPull(head, base)
{
  return post(`${API}/pulls`, { html_url: URL }, { fields: { head, base } });
}

function prefix()
{
  const fork = pull("release/0.0.27", "main");
  fork.head.repo.full_name = "another/repository";
  return [get(`${API}/compare/main...develop`, { behind_by: 0 }),
    get(RELEASES, [], { pages: [[fork], [pull(RELEASE, "main")]] }),
    get(TAGS, []), get(`${API}/compare/${BASE_SHA}...${OTHER_SHA}`, { behind_by: 1 })];
}

function branch(sha)
{
  return get(REFS, sha ? [{ ref: `refs/heads/${HOTFIX}`, object: { sha } }] : []);
}

function reconcile(current, { badges = false, failure = false, raced = false } = {})
{
  const queue = [branch(current), get(`${API}/compare/${BASE_SHA}...${current}`, { behind_by: 1 })];
  if (badges) queue.push(...badgeAdvance(SHA, current));
  queue.push(branch(current), post(`${API}/merges`, { sha: RECONCILED_SHA }, {
    fields: { base: HOTFIX, head: BASE_SHA },
    ...(failure ? { exit_code: 1, stderr: "gh: HTTP 409: Merge conflict\n" } : {})
  }));
  if (!failure)
  {
    queue.push(branch(RECONCILED_SHA), releasedContent(BASE_SHA, RECONCILED_SHA,
      raced ? [{ filename: "src/new-work.ts" }] : badges ? [{ filename: dependencyBadge }] : []));
    if (!raced) queue.push(findPull(HOTFIX, RELEASE), createPull(HOTFIX, RELEASE));
  }
  return queue;
}

Given("release synchronization encounters {string}", function (state)
{
  this.synchronizationBranch = HOTFIX;
  this.synchronizationHead = SHA;
  this.synchronizationQueue = prefix();
  switch (state)
  {
    case "a release needing develop":
    case "an existing develop synchronization":
    case "develop already containing squashed content":
    case "develop differing only in dependency badges":
      this.synchronizationBranch = "release/0.0.25";
      this.synchronizationQueue = [get(`${API}/compare/main...develop`, { behind_by: 1 }),
        findPull("main", "develop", state === "an existing develop synchronization")];
      if (state !== "an existing develop synchronization") this.synchronizationQueue.push(createPull("main", "develop"));
      break;
    case "develop already containing main history":
      this.synchronizationBranch = "release/0.0.25";
      this.synchronizationQueue = [get(`${API}/compare/main...develop`, { behind_by: 0 })];
      break;
    case "a hotfix without an active release":
      this.synchronizationQueue = [this.synchronizationQueue[0], get(RELEASES, [])];
      break;
    case "a deleted hotfix branch":
    case "GitHub refusing a branch restore":
      this.synchronizationQueue.push(branch(), post(`${API}/git/refs`, {}, {
        fields: { ref: `refs/heads/${HOTFIX}`, sha: BASE_SHA }
      }));
      if (state === "GitHub refusing a branch restore")
        Object.assign(this.synchronizationQueue.at(-1), { exit_code: 1, stderr: "gh: HTTP 503\n" });
      else this.synchronizationQueue.push(branch(BASE_SHA), findPull(HOTFIX, RELEASE), createPull(HOTFIX, RELEASE));
      break;
    case "the original hotfix head":
      this.synchronizationQueue.push(...reconcile(SHA));
      break;
    case "badges after the original hotfix head":
      this.synchronizationQueue.push(...reconcile(BADGE_SHA, { badges: true }));
      break;
    case "a merge conflict during reconciliation":
      this.synchronizationQueue.push(...reconcile(SHA, { failure: true }));
      break;
    case "new code during reconciliation":
      this.synchronizationQueue.push(...reconcile(SHA, { raced: true }));
      break;
    case "a branch advancing before reconciliation":
      this.synchronizationQueue.push(branch(SHA),
        get(`${API}/compare/${BASE_SHA}...${SHA}`, { behind_by: 1 }), branch(BADGE_SHA));
      break;
    case "an existing hotfix synchronization":
      this.synchronizationQueue.push(branch(BASE_SHA), branch(BASE_SHA), findPull(HOTFIX, RELEASE, true));
      break;
    case "a fast-forwarded hotfix head":
      this.synchronizationHead = BASE_SHA;
      this.synchronizationQueue.push(branch(BASE_SHA), branch(BASE_SHA), findPull(HOTFIX, RELEASE), createPull(HOTFIX, RELEASE));
      break;
    case "a hotfix with only newer badges":
    case "an already reconciled hotfix":
      this.synchronizationQueue.push(branch(BADGE_SHA),
        get(`${API}/compare/${BASE_SHA}...${BADGE_SHA}`, { behind_by: 0 }), branch(BADGE_SHA),
        releasedContent(BASE_SHA, BADGE_SHA, state === "a hotfix with only newer badges" ? [{ filename: dependencyBadge }] : []),
        findPull(HOTFIX, RELEASE), createPull(HOTFIX, RELEASE));
      break;
    case "a release already containing the fix":
      this.synchronizationQueue.at(-1).response.behind_by = 0;
      break;
    case "an already tagged release target":
      this.synchronizationQueue.pop();
      this.synchronizationQueue.at(-1).response = [{ ref: "refs/tags/0.0.26" }];
      break;
    case "unexpected hotfix changes":
      this.synchronizationQueue.push(branch(BADGE_SHA),
        get(`${API}/compare/${BASE_SHA}...${BADGE_SHA}`, { behind_by: 1 }), ...badgeAdvance(SHA, BADGE_SHA,
        [{ filename: "src/bootstrap.ts" }]));
      break;
    case "ambiguous active releases":
      this.synchronizationQueue = [this.synchronizationQueue[0], get(RELEASES,
        [pull(RELEASE, "main"), pull("release/0.0.27", "main")])];
      break;
    case "GitHub failing to list releases":
      this.synchronizationQueue = [this.synchronizationQueue[0], get(RELEASES, {},
        { exit_code: 1, stderr: "gh: HTTP 503\n" })];
      break;
    default: assert.fail(`Unknown synchronization state: ${state}`);
  }
  this.synchronizationApiFailure = state.startsWith("GitHub ");
});

When("the released code is synchronized", function ()
{
  this.synchronizationResult = this.automation.execute("synchronize-release.sh",
    [REPOSITORY, this.synchronizationBranch, this.synchronizationHead, BASE_SHA], this.synchronizationQueue,
    { success: null, env: { GITHUB_STEP_SUMMARY: this.automation.output } });
});

Then("synchronization is {string} with {int} GitHub writes and reports {string}", function (outcome, writes, message)
{
  const result = this.synchronizationResult;
  assert.equal(result.status === 0, outcome === "accepted", result.stderr);
  const diagnostics = result.stdout + result.stderr;
  assert.ok(diagnostics.includes(message), diagnostics);
  if (outcome === "rejected")
    for (const value of [REPOSITORY, this.synchronizationBranch, SHA, BASE_SHA])
      assert.ok(result.stderr.includes(value), result.stderr);
  else assert.ok(readFileSync(this.automation.output, "utf8").includes(message));
  if (this.synchronizationApiFailure) assert.ok(result.stderr.includes("gh: HTTP 503"), result.stderr);
  assert.equal(this.automation.calls().filter(call => call.method !== "GET").length, writes);
  assert.ok(this.automation.calls().every(call => call.method !== "PATCH"), "Synchronization must not reset a branch ref");
});
