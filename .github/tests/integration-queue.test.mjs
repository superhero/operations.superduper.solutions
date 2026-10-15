// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Given, Then, When } from "@cucumber/cucumber";
import { prepareIntegration } from "../scripts/prepare-integration.mjs";
import { ValidationRequestError } from "../scripts/validation-request.mjs";
import { API, REPOSITORY } from "./support.mjs";

function git(world, ...args)
{
  const result = spawnSync("git", args, { cwd: world.automation.root,
    env: { ...process.env, ...world.automation.env }, encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function rebuildMerge(world)
{
  const state = world.integrationQueue;
  state.merge = git(world, "commit-tree", state.mergeTree ?? state.tree, "-p", state.base, "-p", state.head, "-m", "Current proposed merge");
  state.pr.head.sha = state.options.headSha = state.head;
  state.pr.merge_commit_sha = state.merge;
  git(world, "update-ref", `refs/heads/${state.options.headBranch}`, state.head);
}

Given("a queued integration from {string} into {string} in {string} mode", function (headBranch, baseBranch, mode)
{
  git(this, "init", "-q", "--initial-branch=fixture");
  git(this, "config", "user.name", "Integration queue fixture");
  git(this, "config", "user.email", "integration@example.invalid");
  git(this, "config", "commit.gpgsign", "false");
  const workflowFile = `.github/workflows/ci-${baseBranch === "develop" ? "develop" : baseBranch.startsWith("release/") ? "release" : "support"}.yml`;
  mkdirSync(join(this.automation.root, ".github/workflows"), { recursive: true });
  for (const path of [workflowFile, ".github/workflows/prepare-integration.yml"])
    writeFileSync(join(this.automation.root, path), `name: ${path}\n`);
  git(this, "add", ".github");
  git(this, "commit", "-qm", "Initial target");
  const previous = git(this, "rev-parse", "HEAD");
  const tree = git(this, "rev-parse", "HEAD^{tree}");
  const base = git(this, "commit-tree", tree, "-p", previous, "-m", "Another PR advanced target while queued");
  const head = git(this, "commit-tree", tree, "-p", previous, "-m", "Candidate source");
  const other = git(this, "commit-tree", tree, "-p", base, "-m", "Concurrent advance");
  const eventSha = git(this, "commit-tree", tree, "-p", previous, "-p", head, "-m", "Original event merge");
  const options = { repository: REPOSITORY, pullRequest: 37, headBranch, baseBranch, mode, headSha: head,
    eventAction: "opened", eventBaseChanged: false, eventSha, workflowFile };
  this.integrationQueue = { previous, tree, base, head, other, options, calls: [], notes: [], waits: [], clock: 0,
    prReads: 0, baseReads: 0, mergeRead: false,
    pr: { number: 37, head: { ref: headBranch, sha: head, repo: { full_name: REPOSITORY } },
      base: { ref: baseBranch, sha: previous, repo: { full_name: REPOSITORY } },
      draft: false, merged: false, state: "open", mergeable: true } };
  git(this, "update-ref", `refs/heads/${baseBranch}`, base);
  rebuildMerge(this);
  this.integrationQueue.originalRefs = git(this, "show-ref");
});

Given("its event source already contains the current target", function ()
{
  const state = this.integrationQueue;
  state.head = git(this, "commit-tree", state.tree, "-p", state.base, "-m", "Refreshed candidate");
  rebuildMerge(this);
  state.options.eventSha = state.merge;
  state.originalRefs = git(this, "show-ref");
});

Given("its queued integration has {string}", function (condition)
{
  const state = this.integrationQueue;
  state.condition = condition;
  switch (condition)
  {
    case "a closed PR": state.pr.state = "closed"; break;
    case "a closed PR with a deleted fork": state.pr.state = "closed"; state.pr.head.repo = null; break;
    case "an already merged PR": state.pr.state = "closed"; state.pr.merged = true; break;
    case "a draft PR": state.pr.draft = true; break;
    case "a superseded event head": state.pr.head.sha = state.other; break;
    case "a title or description edit": state.options.eventAction = "edited"; break;
    case "a changed base branch event": state.options.eventAction = "edited"; state.options.eventBaseChanged = true; break;
    case "a mismatched PR identity": state.pr.base.repo.full_name = "foreign/project"; break;
    case "a fork source repository": state.options.headRepository = state.pr.head.repo.full_name = "fork/project"; break;
    case "an actual merge conflict": state.pr.mergeable = false; break;
    case "unavailable mergeability": state.pr.mergeable = null; break;
    case "temporarily unknown mergeability": state.pr.mergeable = null; break;
    case "an explicit merged release retry":
      state.options.runAttempt = 2;
      state.options.eventBaseSha = state.previous;
      state.pr.state = "closed";
      state.pr.merged = true;
      state.pr.merged_at = "2026-10-15T12:00:00Z";
      break;
    case "a caller workflow change in the new target":
    case "a reusable workflow change in the new target":
    {
      const path = condition.startsWith("a caller") ? state.options.workflowFile : ".github/workflows/prepare-integration.yml";
      writeFileSync(join(this.automation.root, path), "name: Altered workflow after this run was queued\n");
      git(this, "add", path);
      state.mergeTree = git(this, "write-tree");
      state.base = git(this, "commit-tree", state.mergeTree, "-p", state.previous, "-m", "Target changed workflow instructions");
      git(this, "update-ref", `refs/heads/${state.options.baseBranch}`, state.base);
      rebuildMerge(this);
      state.originalRefs = git(this, "show-ref");
      break;
    }
    case "a symbolic workflow file":
    case "an executable workflow file":
    case "a submodule workflow entry":
    case "a truncated workflow tree":
    case "a missing workflow entry":
    case "a duplicate workflow entry":
    case "an invalid workflow blob SHA":
    case "an incorrect workflow tree SHA": break;
    case "a newer canonical source ref":
    case "a source change during lookup":
    case "a closed PR during lookup":
    case "an invalid canonical target ref":
    case "reversed merge parents":
    case "a merge for the old target":
    case "an unrelated proposed commit":
    case "a target change during lookup":
    case "an exhausted overall read budget":
    case "temporarily stale proposed merge parents":
    case "an invalid ancestry comparison": break;
    default: assert.fail(`Unknown integration condition: ${condition}`);
  }
});

Given("its merged release retry has {string}", function (condition)
{
  const state = this.integrationQueue;
  switch (condition)
  {
    case "a deleted source branch":
      git(this, "update-ref", "-d", `refs/heads/${state.options.headBranch}`);
      state.originalRefs = git(this, "show-ref");
      break;
    case "only its original run": state.options.runAttempt = 1; break;
    case "a closed but unmerged PR": state.pr.merged = false; break;
    case "a different source revision": state.pr.head.sha = state.other; break;
    case "a development synchronization route": state.options.baseBranch = state.pr.base.ref = "develop"; break;
    case "a non-release source": state.options.headBranch = state.pr.head.ref = "feature/topic"; break;
    case "a fork source": state.options.headRepository = state.pr.head.repo.full_name = "fork/project"; break;
    case "no confirmed merge timestamp": delete state.pr.merged_at; break;
    case "an invalid merge timestamp": state.pr.merged_at = "not a timestamp"; break;
    case "an invalid merged commit": state.pr.merge_commit_sha = "invalid"; break;
    case "no original event base": delete state.options.eventBaseSha; break;
    case "a mismatched PR route": state.pr.base.ref = "develop"; break;
    default: assert.fail(`Unknown merged release retry condition: ${condition}`);
  }
});

Given("integration API reads fail with {string} for {int} attempts", function (kind, attempts)
{
  this.integrationQueue.failure = { kind, attempts };
});

function fixtureAPI(world, endpoint, options)
{
  const state = world.integrationQueue;
  state.calls.push({ endpoint, options });
  assert.equal(options.timeoutMs > 0 && options.timeoutMs <= 30000, true);
  if (state.condition === "an exhausted overall read budget") state.clock += 240001;
  if (state.failure && state.calls.length <= state.failure.attempts) throw new ValidationRequestError(state.failure.kind);
  if (endpoint === `${API}/pulls/37`)
  {
    state.prReads++;
    const result = structuredClone(state.pr);
    if (state.condition === "temporarily unknown mergeability" && state.prReads > 1) result.mergeable = true;
    if (state.condition === "a source change during lookup" && state.prReads > 1) result.head.sha = state.other;
    if (state.condition === "a closed PR during lookup" && state.prReads > 1) result.state = "closed";
    return result;
  }
  if (endpoint === `repos/${state.options.headRepository ?? REPOSITORY}/git/ref/heads/${encodeURIComponent(state.options.headBranch)}`)
    return { ref: `refs/heads/${state.options.headBranch}`, object: { type: "commit",
      sha: state.condition === "a newer canonical source ref" ? state.other : state.head } };
  if (endpoint === `${API}/git/ref/heads/${encodeURIComponent(state.options.baseBranch)}`)
  {
    state.baseReads++;
    return { ref: `refs/heads/${state.options.baseBranch}`, object: {
      type: state.condition === "an invalid canonical target ref" ? "tag" : "commit",
      sha: state.condition === "a target change during lookup" && state.baseReads > 1 ? state.other : state.base } };
  }
  if (endpoint === `${API}/compare/${state.base}...${state.head}`)
  {
    const behind = Number(git(world, "rev-list", "--count", `${state.head}..${state.base}`));
    const ahead = Number(git(world, "rev-list", "--count", `${state.base}..${state.head}`));
    return { base_commit: { sha: state.base }, merge_base_commit: { sha: git(world, "merge-base", state.base, state.head) },
      behind_by: state.condition === "an invalid ancestry comparison" ? -1 : behind,
      ahead_by: ahead, total_commits: ahead, status: behind ? (ahead ? "diverged" : "behind") : (ahead ? "ahead" : "identical") };
  }
  if (endpoint === `${API}/git/commits/${state.merge}`)
  {
    state.mergeRead = true;
    let parents = git(world, "show", "-s", "--format=%P", state.merge).split(" ");
    if (state.condition === "reversed merge parents") parents.reverse();
    if (state.condition === "a merge for the old target") parents[0] = state.previous;
    if (state.condition === "temporarily stale proposed merge parents" && state.prReads === 1) parents[0] = state.previous;
    if (state.condition === "an unrelated proposed commit") parents = [state.previous];
    return { sha: state.merge, parents: parents.map(sha => ({ sha })), tree: { sha: git(world, "rev-parse", `${state.merge}^{tree}`) } };
  }
  if (endpoint === `${API}/git/commits/${state.options.eventSha}`)
    return { sha: state.options.eventSha, tree: { sha: git(world, "rev-parse", `${state.options.eventSha}^{tree}`) } };
  const treeMatch = new RegExp(`^${API}/git/trees/([0-9a-f]{40})\\?recursive=1$`).exec(endpoint);
  if (treeMatch)
  {
    let tree = git(world, "ls-tree", "-r", treeMatch[1]).split("\n").map(line => {
      const [metadata, path] = line.split("\t");
      const [mode, type, sha] = metadata.split(" ");
      return { mode, type, sha, path };
    });
    const workflow = tree.find(entry => entry.path === state.options.workflowFile);
    if (state.condition === "a symbolic workflow file") workflow.mode = "120000";
    if (state.condition === "an executable workflow file") workflow.mode = "100755";
    if (state.condition === "a submodule workflow entry") { workflow.mode = "160000"; workflow.type = "commit"; }
    if (state.condition === "a missing workflow entry") tree = tree.filter(entry => entry !== workflow);
    if (state.condition === "a duplicate workflow entry") tree.push({ ...workflow });
    if (state.condition === "an invalid workflow blob SHA") workflow.sha = "invalid";
    return { sha: state.condition === "an incorrect workflow tree SHA" ? state.other : treeMatch[1],
      truncated: state.condition === "a truncated workflow tree", tree };
  }
  assert.fail(`Unexpected integration read: ${endpoint}`);
}

When("the integration queue slot is prepared", async function ()
{
  const state = this.integrationQueue;
  try
  {
    state.result = await prepareIntegration({ ...state.options, api: (endpoint, options) => fixtureAPI(this, endpoint, options),
      note: message => state.notes.push(message), now: () => state.clock,
      wait: async milliseconds => { state.waits.push(milliseconds); state.clock += milliseconds; } });
  }
  catch (error) { state.error = error; }
  assert.equal(git(this, "show-ref"), state.originalRefs, "Preparation must not change any source or target ref.");
  assert.equal(readFileSync(this.automation.output, "utf8"), "");
  assert.deepEqual(this.automation.calls(), [], "Injected read fixtures must not invoke real GitHub commands.");
});

Then("integration preparation requests a source refresh without running validation", function ()
{
  const state = this.integrationQueue;
  assert.ifError(state.error);
  assert.deepEqual(state.result, { ready: false, refresh: true, recovery: false, head_sha: state.head, base_sha: state.base, tested_sha: "" });
  assert.equal(state.mergeRead, false);
});

Then("integration preparation pins the current proposed merge", function ()
{
  const state = this.integrationQueue;
  assert.ifError(state.error);
  assert.deepEqual(state.result, { ready: true, refresh: false, recovery: false, head_sha: state.head, base_sha: state.base, tested_sha: state.merge });
  assert.equal(state.mergeRead, true);
});

Then("integration preparation pins the unchanged source", function ()
{
  const state = this.integrationQueue;
  assert.ifError(state.error);
  assert.deepEqual(state.result, { ready: true, refresh: false, recovery: false, head_sha: state.head, base_sha: state.base, tested_sha: state.head });
  assert.equal(state.mergeRead, false);
  assert.equal(state.calls.some(call => call.endpoint.includes("/compare/")), false);
});

Then("integration preparation resumes only the confirmed release publication", function ()
{
  const state = this.integrationQueue;
  assert.ifError(state.error);
  assert.deepEqual(state.result, { ready: true, refresh: false, recovery: true, head_sha: state.head, base_sha: state.previous, tested_sha: state.head });
  assert.equal(state.calls.length, 1, "Publication recovery must not depend on deleted source refs.");
  assert.equal(state.calls[0].endpoint, `${API}/pulls/37`);
});

Then("integration preparation skips the obsolete event", function ()
{
  const state = this.integrationQueue;
  assert.ifError(state.error);
  assert.deepEqual(state.result, { ready: false, refresh: false, recovery: false, head_sha: "", base_sha: "", tested_sha: "" });
  if (state.condition === "a title or description edit") assert.equal(state.calls.length, 0);
  if (["a closed PR", "a closed PR with a deleted fork", "an already merged PR", "a draft PR", "a superseded event head"].includes(state.condition))
    assert.equal(state.calls.length, 1);
});

Then("integration preparation fails with {string}", function (message)
{
  const state = this.integrationQueue;
  assert.ok(state.error, "Unverified integration must fail closed.");
  assert.ok(state.error.message.includes(message), state.error.message);
  assert.equal(state.result, undefined);
});

Then("integration API retry handling is {string} after {int} attempts", function (outcome, attempts)
{
  const state = this.integrationQueue;
  assert.equal(state.calls.slice(0, attempts).every(call => call.endpoint === `${API}/pulls/37`), true);
  assert.deepEqual(state.waits, Array.from({ length: attempts - 1 }, (_, index) => (index + 1) * 1000));
  assert.equal(state.notes.filter(note => note.startsWith("GitHub read:")).length,
    outcome === "ready" ? attempts - 1 : attempts);
  if (outcome === "ready")
  {
    assert.ifError(state.error);
    assert.equal(state.result.ready, true);
    assert.equal(state.result.tested_sha, state.merge);
  }
  else
  {
    assert.ok(state.error instanceof ValidationRequestError);
    assert.equal(state.calls.length, attempts);
    assert.equal(state.result, undefined);
  }
});

function executeCLI(world, responses)
{
  const state = world.integrationQueue;
  writeFileSync(world.automation.env.MOCK_QUEUE, JSON.stringify(responses));
  state.cli = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/prepare-integration.mjs", import.meta.url))], {
    cwd: world.automation.root, encoding: "utf8", timeout: 10000,
    env: { ...process.env, ...world.automation.env, REPOSITORY, PR_NUMBER: "37", HEAD_BRANCH: state.options.headBranch,
      BASE_BRANCH: state.options.baseBranch, HEAD_SHA: state.head, INTEGRATION_MODE: state.options.mode,
      EVENT_ACTION: state.options.eventAction, EVENT_BASE_CHANGED: "false", EVENT_SHA: state.options.eventSha,
      WORKFLOW_FILE: state.options.workflowFile }
  });
  assert.ifError(state.cli.error);
  assert.equal(readFileSync(world.automation.env.MOCK_ERRORS, "utf8"), "", state.cli.stderr);
  assert.deepEqual(JSON.parse(readFileSync(world.automation.env.MOCK_QUEUE, "utf8")), []);
  assert.equal(git(world, "show-ref"), state.originalRefs);
  assert.equal(world.automation.calls().every(call => call.method === "GET" && call.include === true), true);
}

When("the integration environment CLI prepares its queue slot", function ()
{
  const state = this.integrationQueue;
  const endpoints = [`${API}/pulls/37`, `${API}/git/ref/heads/${encodeURIComponent(state.options.headBranch)}`,
    `${API}/git/ref/heads/${encodeURIComponent(state.options.baseBranch)}`, `${API}/git/commits/${state.merge}`,
    `${API}/git/commits/${state.options.eventSha}`,
    ...[state.options.eventSha, state.merge].map(ref => `${API}/git/trees/${git(this, "rev-parse", `${ref}^{tree}`)}?recursive=1`),
    `${API}/pulls/37`, `${API}/git/ref/heads/${encodeURIComponent(state.options.headBranch)}`,
    `${API}/git/ref/heads/${encodeURIComponent(state.options.baseBranch)}`];
  executeCLI(this, endpoints.map(endpoint => ({ endpoint,
    raw: `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(fixtureAPI(this, endpoint, { timeoutMs: 30000 }))}` })));
});

Then("the integration CLI publishes the verified merge inputs", function ()
{
  const state = this.integrationQueue;
  assert.equal(state.cli.status, 0, state.cli.stdout + state.cli.stderr);
  assert.equal(readFileSync(this.automation.output, "utf8"),
    `ready=true\nrefresh=false\nrecovery=false\nhead_sha=${state.head}\nbase_sha=${state.base}\ntested_sha=${state.merge}\n`);
});

When("the integration environment CLI receives an API authorization failure", function ()
{
  executeCLI(this, [{ endpoint: `${API}/pulls/37`, exit_code: 1,
    raw: 'HTTP/2.0 403 Forbidden\r\nContent-Type: application/json\r\n\r\n{"message":"test-github-token"}',
    stderr: "A sensitive command failed: test-github-token test-app-private-key\n" }]);
});

Then("the integration CLI fails without publishing inputs or exposing credentials", function ()
{
  const state = this.integrationQueue;
  assert.equal(state.cli.status, 1);
  assert.equal(readFileSync(this.automation.output, "utf8"), "");
  const diagnostics = state.cli.stdout + state.cli.stderr;
  assert.match(diagnostics, /authorization failed/);
  for (const secret of [this.automation.env.GH_TOKEN, this.automation.env.GH_APP_PRIVATE_KEY])
    assert.equal(diagnostics.includes(secret), false);
});
