// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Given, Then, When } from "@cucumber/cucumber";
import { API, BASE_SHA, OTHER_SHA, REPOSITORY, SHA, get } from "./support.mjs";
import { badgeAdvance } from "./badge-advance.test.mjs";
import { releasedContent } from "./released-content.test.mjs";

const TAGS = `${API}/tags?per_page=100`;
const BRANCHES = `${API}/git/matching-refs/heads/`;
const CLOSED_PULLS = `${API}/pulls?state=closed&base=main&per_page=100`;
const MERGE = ["pr", "merge", "123", "--repo", REPOSITORY,
  "--merge", "--match-head-commit", SHA];

const mergeCommand = method => MERGE.map(argument => argument === "--merge" ? `--${method}` : argument);

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
    number: 123, state: "open", merged: false, draft: false,
    base: { ref: "main", sha: BASE_SHA, repo: { full_name: REPOSITORY } },
    head: { ref: "release/1.2.3", sha: SHA, repo: { full_name: REPOSITORY } }
  };
}

function mergeComparison(ahead = 2, behind = 0, base = BASE_SHA)
{
  return {
    status: behind ? "diverged" : "ahead", ahead_by: ahead, behind_by: behind, total_commits: ahead,
    base_commit: { sha: base },
    merge_base_commit: { sha: behind ? (base === BASE_SHA ? OTHER_SHA : BASE_SHA) : base }
  };
}

function refUpdate(base)
{
  return { method: "PATCH", endpoint: `${API}/git/refs/heads/${base}`,
    fields: { sha: SHA, force: "false" },
    response: { ref: `refs/heads/${base}`, object: { type: "commit", sha: SHA } } };
}

function liveBase(pr, sha = pr.base.sha)
{
  return get(`${API}/git/ref/heads/${encodeURIComponent(pr.base.ref)}`,
    { ref: `refs/heads/${pr.base.ref}`, object: { type: "commit", sha } });
}

function mergedPull(pr)
{
  return { ...structuredClone(pr), state: "closed", merged: true,
    merged_at: "2026-10-07T12:00:00Z", merge_commit_sha: SHA };
}

function fastForward(world, pr)
{
  world.fastForwardAttempted = true;
  world.mergeResponses.push(get(`${API}/pulls/123`, pr), liveBase(pr), refUpdate(pr.base.ref),
    get(`${API}/pulls/123`, mergedPull(pr)));
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
      }), releasedContent(BASE_SHA, SHA, [{ filename: "src/bootstrap.ts" }])];
      break;
    case "only badge changes after its release":
      this.policyResponses = [tagged, get(`${API}/compare/${SHA}...${version}`, {
        behind_by: 1, merge_base_commit: { sha: BASE_SHA }
      }), releasedContent(version, SHA, [{ filename: ".github/badges/version-dependency-vite.svg" }])];
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
    responses.push(releasedContent(released, SHA, changes === "code" ? [{ filename: "src/bootstrap.ts" }] :
      changes === "badge" ? [{ filename: ".github/badges/version-dependency-vite.svg" }] : []));
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
    case "no source branch": delete pr.head.ref; break;
    case "an empty source branch": pr.head.ref = ""; break;
    case "a non-string source branch": pr.head.ref = 123; break;
    case "an invalid source branch": pr.head.ref = "hotfix/../1.2.3"; break;
    case "fallen behind main": break;
    default: throw new Error(`Unknown pull request state: ${state}`);
  }
  this.mergeResponses = [get(`${API}/pulls/123`, pr)];
  if (["no changes", "a newer base commit", "newer base dependency badges", "fallen behind main"].includes(state))
    this.mergeResponses.push(liveBase(pr));
  if (["a newer base commit", "newer base dependency badges"].includes(state))
    this.mergeResponses.push(...badgeAdvance(BASE_SHA, OTHER_SHA,
      state === "a newer base commit" ? [{ filename: "src/bootstrap.ts" }] : undefined));
  if (["no changes", "fallen behind main"].includes(state))
    this.mergeResponses.push(get(`${API}/compare/${BASE_SHA}...${SHA}`,
      mergeComparison(2, state === "no changes" ? 0 : 1)));
  if (state === "fallen behind main")
    this.mergeResponses.push(...badgeAdvance(OTHER_SHA, BASE_SHA, [{ filename: "src/bootstrap.ts" }]));
  if (state === "newer base dependency badges")
    this.mergeResponses.push(get(`${API}/compare/${OTHER_SHA}...${SHA}`, mergeComparison(2, 1, OTHER_SHA)),
      ...badgeAdvance(BASE_SHA, OTHER_SHA));
  this.mergeAttempted = state === "newer base dependency badges";
  if (this.mergeAttempted) this.mergeResponses.push(get(`${API}/pulls/123`, pr), liveBase(pr),
    { command: MERGE }, get(`${API}/pulls/123`, mergedPull(pr)));
  if (state === "no changes") fastForward(this, pr);
});

Given("the validated pull request merges {string} into {string} with {int} commits ahead and {int} behind using {string}", function (head, base, ahead, behind, method)
{
  const pr = pullRequest();
  pr.head.ref = head;
  pr.base.ref = base;
  this.mergeHead = head;
  this.mergeBase = base;
  this.verifyLiveBases = head === "feature/editor" && base === "develop" && ahead === 2 && behind === 0;
  this.mergeCommand = mergeCommand(method);
  this.mergeAttempted = method !== "fast-forward";
  this.mergeResponses = [get(`${API}/pulls/123`, pr), liveBase(pr),
    get(`${API}/compare/${BASE_SHA}...${SHA}`, mergeComparison(ahead, behind))];
  if (base === "main" && behind) this.mergeResponses.push(...badgeAdvance(OTHER_SHA, BASE_SHA));
  if (this.mergeAttempted) this.mergeResponses.push(get(`${API}/pulls/123`, pr), liveBase(pr),
    { command: this.mergeCommand }, get(`${API}/pulls/123`, mergedPull(pr)));
  else fastForward(this, pr);
});

Given("a possible fast-forward encounters {string}", function (state)
{
  const pr = pullRequest();
  pr.head.ref = "main";
  pr.base.ref = "develop";
  this.mergeHead = "main";
  this.mergeBase = "develop";
  const comparison = mergeComparison();
  this.mergeResponses = [get(`${API}/pulls/123`, pr), liveBase(pr), get(`${API}/compare/${BASE_SHA}...${SHA}`, comparison)];
  switch (state)
  {
    case "incomplete comparison metadata": delete comparison.total_commits; return;
    case "a comparison of another base": comparison.base_commit.sha = OTHER_SHA; return;
    case "fractional commit counts": comparison.ahead_by = comparison.total_commits = 1.5; return;
    case "inconsistent commit counts": comparison.total_commits = 1; return;
  }
  const current = structuredClone(pr);
  this.mergeResponses.push(get(`${API}/pulls/123`, current));
  switch (state)
  {
    case "a changed head before writing": current.head.sha = OTHER_SHA; return;
    case "a changed source branch before writing": current.head.ref = "release/1.2.3"; return;
    case "a changed base before writing":
      // Keep the PR metadata stale while the actual target moves.
      this.mergeResponses.push(liveBase(pr, OTHER_SHA)); return;
    case "a new draft before writing": current.draft = true; return;
  }
  const update = refUpdate("develop");
  this.fastForwardAttempted = true;
  this.mergeResponses.push(liveBase(pr), update);
  switch (state)
  {
    case "GitHub rejecting the ref update":
      Object.assign(update, { exit_code: 1, stderr: "GitHub unavailable" });
      this.mergeResponses.push(get(`${API}/pulls/123`, pr));
      return;
    case "a lost ref response after success":
      Object.assign(update, { exit_code: 1, stderr: "GitHub connection lost" });
      this.mergeResponses.push(get(`${API}/pulls/123`, mergedPull(pr)));
      return;
    case "an unexpected ref update response": update.response.object.sha = OTHER_SHA; return;
    case "delayed merged PR recognition":
      this.mergeResponses.push(get(`${API}/pulls/123`, pr), get(`${API}/pulls/123`, mergedPull(pr)));
      return;
    case "an indirect merge retaining a test-merge SHA":
      this.mergeResponses.push(get(`${API}/pulls/123`, { ...mergedPull(pr), merge_commit_sha: OTHER_SHA }));
      return;
    case "missing merged PR recognition":
      this.mergeTimeout = 0;
      this.mergeResponses.push(get(`${API}/pulls/123`, pr));
      return;
    default: throw new Error(`Unknown fast-forward state: ${state}`);
  }
});

Given("GitHub fails while {string}", function (operation)
{
  const pr = pullRequest();
  pr.head.ref = "hotfix/1.2.4";
  this.mergeHead = pr.head.ref;
  this.mergeCommand = mergeCommand("squash");
  const responses = [
    get(`${API}/pulls/123`, pr), liveBase(pr),
    get(`${API}/compare/${BASE_SHA}...${SHA}`, mergeComparison()),
    get(`${API}/pulls/123`, pr), liveBase(pr),
    { command: this.mergeCommand }
  ];
  const index = { "reading the pull request": 0, "comparing main to the head": 2, "submitting the merge": 5 }[operation];
  assert.notEqual(index, undefined, operation);
  this.mergeResponses = responses.slice(0, index + 1);
  Object.assign(this.mergeResponses[index], { exit_code: 1, stderr: "GitHub unavailable" });
  this.mergeAttempted = index === 5;
  if (this.mergeAttempted) this.mergeResponses.push(get(`${API}/pulls/123`, pr));
});

Given("automatic merge completion encounters {string}", function (state)
{
  const pr = pullRequest();
  pr.head.ref = this.mergeHead = "bugfix/editor";
  pr.base.ref = this.mergeBase = "develop";
  const merged = mergedPull(pr);
  this.mergeResponses = [get(`${API}/pulls/123`, merged)];
  switch (state)
  {
    case "an already merged retry": merged.base.sha = OTHER_SHA; return;
    case "an already merged different PR": merged.number = 124; return;
    case "an already merged different source": merged.head.ref = "bugfix/other"; return;
    case "an already merged different head": merged.head.sha = OTHER_SHA; return;
    case "an already merged different destination": merged.base.ref = "support/1.x"; return;
    case "an already merged different source repository": merged.head.repo.full_name = "other/repository"; return;
    case "an already merged different target repository": merged.base.repo.full_name = "other/repository"; return;
    case "an already merged retry without merge metadata":
      merged.merge_commit_sha = null;
      this.mergeTimeout = 0;
      return;
    case "an already merged retry with malformed merge metadata": merged.merge_commit_sha = "invalid"; return;
  }
  // Keep mutable PR snapshots independent: GitHub may change state between reads.
  const current = structuredClone(pr);
  this.mergeResponses = [get(`${API}/pulls/123`, pr), liveBase(pr),
    get(`${API}/compare/${BASE_SHA}...${SHA}`, mergeComparison()),
    get(`${API}/pulls/123`, current)];
  switch (state)
  {
    case "a racing merge before submission": Object.assign(current, merged); return;
    case "a changed head before squash submission": current.head.sha = OTHER_SHA; return;
    case "a changed base before squash submission":
      this.mergeResponses.push(liveBase(pr, OTHER_SHA)); return;
  }
  this.mergeAttempted = true;
  this.mergeCommand = mergeCommand("squash");
  const request = { command: this.mergeCommand };
  this.mergeResponses.push(liveBase(pr), request);
  switch (state)
  {
    case "delayed merge confirmation":
      this.mergeResponses.push(get(`${API}/pulls/123`, pr), get(`${API}/pulls/123`, merged));
      return;
    case "delayed merge commit metadata":
      this.mergeResponses.push(get(`${API}/pulls/123`, { ...merged, merge_commit_sha: null }),
        get(`${API}/pulls/123`, { ...merged, merge_commit_sha: OTHER_SHA }));
      return;
    case "a merge that remains open":
      this.mergeTimeout = 0;
      this.mergeResponses.push(get(`${API}/pulls/123`, pr));
      return;
    case "a PR closed without merging after submission":
      this.mergeResponses.push(get(`${API}/pulls/123`, { ...pr, state: "closed" }));
      return;
    case "a different merged head after submission":
      merged.head.sha = OTHER_SHA;
      this.mergeResponses.push(get(`${API}/pulls/123`, merged));
      return;
    case "a lost merge response after success":
      Object.assign(request, { exit_code: 1, stderr: "GitHub connection lost" });
      this.mergeResponses.push(get(`${API}/pulls/123`, merged));
      return;
    case "GitHub failing during confirmation":
      this.mergeResponses.push(get(`${API}/pulls/123`, {}, { exit_code: 1, stderr: "GitHub unavailable" }));
      return;
    default: throw new Error(`Unknown merge completion state: ${state}`);
  }
});

When("automatic merging runs", function ()
{
  this.mergeResult = this.automation.execute("auto-merge.sh",
    [REPOSITORY, "123", SHA, this.mergeBase ?? "main", BASE_SHA,
      this.mergeHead ?? "release/1.2.3", String(this.mergeTimeout ?? 180)], this.mergeResponses, { success: null });
});

Then("automatic merging is {string}", { timeout: 60000 }, function (outcome)
{
  checkResult(this.mergeResult, outcome, [REPOSITORY, "PR #123", SHA, this.mergeBase ?? "main", BASE_SHA,
    this.mergeHead ?? "release/1.2.3"]);
  if (outcome === "accepted")
  {
    assert.ok(this.mergeResult.stdout.includes(`GitHub confirmed ${REPOSITORY} PR #123 merged`), this.mergeResult.stdout);
    const confirmedSha = this.mergeResult.stdout.match(/merge_sha=([0-9a-f]{40})/)[1];
    assert.equal(readFileSync(this.automation.output, "utf8"), `merge_sha=${confirmedSha}\n`);
  }
  else assert.equal(readFileSync(this.automation.output, "utf8"), "");
  assert.deepEqual(this.automation.calls().filter(call => call.command).map(call => call.command),
    this.mergeAttempted ? [this.mergeCommand ?? MERGE] : []);
  const writes = this.automation.calls().filter(call => !call.command && call.method !== "GET");
  assert.deepEqual(writes, this.fastForwardAttempted ? [{ method: "PATCH",
    endpoint: `${API}/git/refs/heads/${this.mergeBase ?? "main"}`, fields: { sha: SHA, force: "false" } }] : []);
  if (this.verifyLiveBases) verifyLiveBaseGuards(this);
});

Then("the merge error explains {string}", function (reason)
{
  if (reason) assert.ok(this.mergeResult.stderr.includes(reason), this.mergeResult.stderr);
});

// Extend the existing merge-policy scenario without changing the scenario count.
// Ref fixtures are independent of PR metadata, including the stale-base case.
function verifyLiveBaseGuards(world)
{
  const automation = world.automation;
  const paths = [automation.output, automation.env.MOCK_LOG, automation.env.MOCK_ERRORS];
  const saved = paths.map(path => readFileSync(path));
  const pr = pullRequest();
  pr.head.ref = "feature/editor";
  pr.base.ref = "develop";
  const args = [REPOSITORY, "123", SHA, "develop", BASE_SHA, pr.head.ref, "0"];
  const prefix = [get(`${API}/pulls/123`, pr), liveBase(pr),
    get(`${API}/compare/${BASE_SHA}...${SHA}`, mergeComparison()), get(`${API}/pulls/123`, pr)];
  function run(label, responses, accepted = false, reason = "")
  {
    for (const path of paths) writeFileSync(path, "");
    const result = automation.execute("auto-merge.sh", args, responses, { success: null });
    const context = `${label}: ${result.stdout}${result.stderr}`;
    assert.equal(result.status === 0, accepted, context);
    if (reason) assert.ok(result.stderr.includes(reason), context);
    const writes = automation.calls().filter(call => call.command || call.method !== "GET");
    if (!accepted)
    {
      assert.deepEqual(writes, [], `${label}: rejection must precede any mutation`);
      assert.equal(readFileSync(automation.output, "utf8"), "", context);
      for (const value of [REPOSITORY, "PR #123", SHA, BASE_SHA, pr.head.ref, pr.base.ref])
        assert.ok(result.stderr.includes(value), context);
    }
    else
    {
      assert.deepEqual(writes.map(call => call.command), [mergeCommand("squash")], context);
      assert.equal(readFileSync(automation.output, "utf8"), `merge_sha=${SHA}\n`, context);
    }
  }
  try
  {
    run("code advanced while PR metadata stayed stale",
      [get(`${API}/pulls/123`, pr), liveBase(pr, OTHER_SHA),
        ...badgeAdvance(BASE_SHA, OTHER_SHA, [{ filename: "src/bootstrap.ts" }])], false, "base changed");
    run("target advanced between the two live reads",
      [...prefix, liveBase(pr, OTHER_SHA)], false, "actual live base");
    const badgeComparison = mergeComparison(2, 1, OTHER_SHA);
    run("verified badge advance with stale PR metadata",
      [get(`${API}/pulls/123`, pr), liveBase(pr, OTHER_SHA), ...badgeAdvance(BASE_SHA, OTHER_SHA),
        get(`${API}/compare/${OTHER_SHA}...${SHA}`, badgeComparison), get(`${API}/pulls/123`, pr),
        liveBase(pr, OTHER_SHA), { command: mergeCommand("squash") }, get(`${API}/pulls/123`, mergedPull(pr))], true);
    // The live ref, not a lagging PR .base.sha, also governs the final recheck.
    const stale = structuredClone(pr);
    stale.base.sha = OTHER_SHA;
    run("PR metadata differs while the verified live target is unchanged",
      [get(`${API}/pulls/123`, stale), liveBase(pr), prefix[2], get(`${API}/pulls/123`, stale),
        liveBase(pr), { command: mergeCommand("squash") }, get(`${API}/pulls/123`, mergedPull(stale))], true);
    for (const stage of ["initial", "final"])
    {
      for (const state of ["API failure", "deleted ref", "wrong ref", "wrong object type", "missing SHA",
        "malformed SHA", "SHA with newline", "multiple responses", "invalid JSON"])
      {
        const ref = liveBase(pr);
        switch (state)
        {
          case "API failure": Object.assign(ref, { exit_code: 1, stderr: "gh: HTTP 503\n" }); break;
          case "deleted ref": Object.assign(ref, { exit_code: 1, stderr: "gh: HTTP 404\n" }); break;
          case "wrong ref": ref.response.ref = "refs/heads/main"; break;
          case "wrong object type": ref.response.object.type = "tag"; break;
          case "missing SHA": delete ref.response.object.sha; break;
          case "malformed SHA": ref.response.object.sha = "bad"; break;
          case "SHA with newline": ref.response.object.sha += "\n"; break;
          case "multiple responses": ref.pages = [ref.response, ref.response]; break;
          case "invalid JSON": ref.raw = "not JSON"; break;
        }
        run(`${stage}: ${state}`, [...(stage === "initial" ? [prefix[0]] : prefix), ref], false,
          ref.exit_code ? "Could not read live target ref" : "Invalid live target ref response");
      }
    }
  }
  finally
  {
    paths.forEach((path, index) => writeFileSync(path, saved[index]));
  }
}
