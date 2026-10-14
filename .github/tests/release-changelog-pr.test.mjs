// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Given, When, Then } from "@cucumber/cucumber";
import { addCommits, formatChangelog, parseChangelog } from "../scripts/changelog.mjs";
import { API, REPOSITORY, get, post } from "./support.mjs";

const orchestrator = new URL("../scripts/create-release-changelog-pr.mjs", import.meta.url).href;
const preparation = new URL("../scripts/prepare-release-changelog.mjs", import.meta.url).href;
const version = "1.2.3", branch = `release/${version}`, docsBranch = `docs/release-changelog-${version}`;
const old = "e".repeat(40), first = "a".repeat(40), next = "b".repeat(40);
const marker = `<!-- release-changelog:${branch} -->`;
const pulls = `${API}/pulls?state=all&base=${encodeURIComponent(branch)}&head=${encodeURIComponent(`${REPOSITORY.split("/")[0]}:${docsBranch}`)}&per_page=100`;

function command(world, executable, args)
{
  const result = spawnSync(executable, args, { cwd: world.docsGit.root,
    env: { ...process.env, ...world.automation.env, GIT_CONFIG_NOSYSTEM: "1" }, encoding: "utf8", timeout: 10000 });
  assert.ifError(result.error);
  return result;
}
function git(world, ...args)
{
  const result = command(world, "git", args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function evaluate(world, module, name, args)
{
  return command(world, process.execPath, ["--input-type=module", "--eval",
    `import { ${name} } from ${JSON.stringify(module)}; console.log(JSON.stringify(${name}(JSON.parse(process.argv[1]))));`, JSON.stringify(args)]);
}
function commit(world, message)
{
  git(world, "add", "."); git(world, "commit", "-qm", message);
  return git(world, "rev-parse", "HEAD");
}
function remoteHead(world, name = docsBranch)
{
  return git(world, "ls-remote", world.docsGit.remote, `refs/heads/${name}`).split("\t")[0];
}
function releasePr(world)
{
  return { number: 124, state: "open", merged_at: null,
    head: { ref: branch, sha: world.docsGit.head, repo: { full_name: REPOSITORY } },
    base: { ref: "main", repo: { full_name: REPOSITORY } } };
}
function docsPr(world, sha)
{
  return { number: 125, state: "open", merged_at: null, body: marker,
    head: { ref: docsBranch, sha, repo: { full_name: REPOSITORY } },
    base: { ref: branch, repo: { full_name: REPOSITORY } } };
}
function generated(world)
{
  const result = evaluate(world, preparation, "prepareChangelogReview", { head: world.docsGit.head, version });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function seedDocs(world)
{
  const prepared = generated(world);
  git(world, "push", world.docsGit.remote, `${prepared.sha}:refs/heads/${docsBranch}`);
  world.docsGit.generated = prepared.sha;
  return prepared.sha;
}
function runReview(world)
{
  const state = world.docsGit;
  let queue = [get(`${API}/pulls/124`, releasePr(world))];
  if (!state.ready)
  {
    queue.push(get(pulls, state.pulls));
    if (!state.earlyFailure)
    {
      const recheck = releasePr(world);
      if (state.changedRelease) recheck.head.sha = "c".repeat(40);
      queue.push(get(`${API}/pulls/124`, recheck));
      if (!state.changedRelease)
      {
        queue.push(get(`${API}/pulls/124`, releasePr(world)));
        if (!state.pulls.some(pr => pr.state === "open"))
          queue.push(post(`${API}/pulls`, { number: 125 }, { fields: { head: docsBranch, base: branch } }));
      }
    }
  }
  writeFileSync(world.automation.env.MOCK_QUEUE, JSON.stringify(queue));
  state.result = state.cli ? command(world, "bash", [
    fileURLToPath(new URL("../scripts/create-release-changelog-pr.sh", import.meta.url)), REPOSITORY, "124", branch, state.head,
  ]) : evaluate(world, orchestrator, "createReleaseChangelogPr", {
    repository: REPOSITORY, number: 124, branch, head: state.head, remote: state.remote,
  });
  assert.equal(readFileSync(world.automation.env.MOCK_ERRORS, "utf8"), "", state.result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(world.automation.env.MOCK_QUEUE, "utf8")), [], state.result.stderr);
  if (state.result.status === 0) state.output = JSON.parse(state.result.stdout);
}

Given("a release awaiting changelog review", function ()
{
  const root = join(this.automation.root, "review-work");
  mkdirSync(root);
  this.docsGit = { root, remote: join(this.automation.root, "review-remote.git"), pulls: [] };
  git(this, "init", "-q", "--initial-branch=release-fixture");
  git(this, "config", "user.name", "Changelog fixture");
  git(this, "config", "user.email", "fixture@example.invalid");
  writeFileSync(join(root, "CHANGELOG.md"), formatChangelog({ staging: [
    { sha: first, message: "feat: a release entry\n\nKeep its complete body.", repository: REPOSITORY },
  ], releases: [{ version: "1.2.2", entries: [{ sha: old, message: "feat: already released", repository: REPOSITORY }] }] }));
  writeFileSync(join(root, "app.txt"), "the exact release payload\n");
  this.docsGit.head = commit(this, "feat: awaiting changelog review");
  git(this, "init", "--bare", "-q", this.docsGit.remote);
  git(this, "push", this.docsGit.remote, `${this.docsGit.head}:refs/heads/${branch}`);
});
Given("its generated changelog docs PR is open", function ()
{
  this.docsGit.pulls = [docsPr(this, seedDocs(this))];
});
Given("its generated changelog branch exists without a PR", function () { seedDocs(this); });
Given("its generated changelog docs PR has merged", function ()
{
  const sha = seedDocs(this);
  this.docsGit.pulls = [{ ...docsPr(this, sha), state: "closed", merged_at: "2026-10-14T00:00:00Z" }];
  this.docsGit.head = sha;
  this.docsGit.ready = true;
  git(this, "push", this.docsGit.remote, `${sha}:refs/heads/${branch}`);
});
Given("another change accumulates on the release", function ()
{
  git(this, "checkout", "--detach", this.docsGit.head);
  const path = join(this.docsGit.root, "CHANGELOG.md");
  writeFileSync(path, addCommits(readFileSync(path, "utf8"), [{ sha: next, message: "fix: another release entry" }], REPOSITORY));
  writeFileSync(join(this.docsGit.root, "fix.txt"), "retain the new release payload\n");
  this.docsGit.head = commit(this, "fix: release advances");
  this.docsGit.ready = false;
  git(this, "push", this.docsGit.remote, `${this.docsGit.head}:refs/heads/${branch}`);
});
Given("its changelog review encounters {string}", function (condition)
{
  this.docsGit.earlyFailure = true;
  switch (condition)
  {
    case "unrelated branch work":
      writeFileSync(join(this.docsGit.root, "manual.txt"), "keep this work\n");
      git(this, "push", this.docsGit.remote, `${commit(this, "docs: user work")}:refs/heads/${docsBranch}`);
      break;
    case "a manually edited generated branch":
      git(this, "checkout", "--detach", seedDocs(this));
      writeFileSync(join(this.docsGit.root, "CHANGELOG.md"), "manually authored content\n");
      git(this, "push", this.docsGit.remote, `${commit(this, "docs: preserve authored content")}:refs/heads/${docsBranch}`);
      break;
    case "an unrelated docs PR":
      this.docsGit.pulls = [{ ...docsPr(this, "c".repeat(40)), body: "Authored documentation" }];
      break;
    case "a closed unmerged docs PR":
      this.docsGit.pulls = [{ ...docsPr(this, "c".repeat(40)), state: "closed" }];
      break;
    case "a release advancing before publication":
      this.docsGit.earlyFailure = false;
      this.docsGit.changedRelease = true;
      break;
    case "a docs PR head that changed":
      seedDocs(this);
      this.docsGit.pulls = [docsPr(this, "c".repeat(40))];
      break;
    default: assert.fail(condition);
  }
  this.docsGit.expectedDocs = remoteHead(this);
});
When("its changelog docs PR is prepared", function ()
{
  runReview(this);
  assert.equal(this.docsGit.result.status, 0, this.docsGit.result.stderr);
});
When("the release workflow prepares its changelog docs PR", function ()
{
  this.docsGit.cli = true;
  git(this, "config", `url.${this.docsGit.remote}.insteadOf`, `https://github.com/${REPOSITORY}.git`);
  runReview(this);
  assert.equal(this.docsGit.result.status, 0, this.docsGit.result.stderr);
});
When("changelog review preparation is refused", function ()
{
  runReview(this);
  assert.notEqual(this.docsGit.result.status, 0);
});
Then("a changelog-only PR targets the release with every entry preserved", function ()
{
  assert.deepEqual(this.docsGit.output, { ready: false, docs_pr: 125 });
  const sha = remoteHead(this);
  assert.equal(git(this, "show", "-s", "--format=%P", sha), this.docsGit.head);
  assert.equal(git(this, "diff", "--name-only", this.docsGit.head, sha), "CHANGELOG.md");
  const document = parseChangelog(git(this, "show", `${sha}:CHANGELOG.md`));
  assert.deepEqual(document.staging, []);
  assert.deepEqual(document.releases.map(release => release.version), [version, "1.2.2"]);
  assert.equal(document.releases[0].entries[0].message, "feat: a release entry\n\nKeep its complete body.");
  assert.deepEqual(document.releases[1].entries.map(entry => entry.sha), [old]);
  const writes = this.automation.calls().filter(call => call.method !== "GET");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].fields.base, branch);
  assert.ok(writes[0].fields.body.includes(marker));
});
Then("the release snapshot remains unchanged", function ()
{
  assert.equal(remoteHead(this, branch), this.docsGit.head);
});
Then("the workflow receives a pending changelog PR output", function ()
{
  assert.equal(readFileSync(this.automation.output, "utf8"), "ready=false\ndocs_pr=125\n");
});
Then("the same changelog PR and commit are reused", function ()
{
  assert.deepEqual(this.docsGit.output, { ready: false, docs_pr: 125 });
  assert.equal(remoteHead(this), this.docsGit.generated);
  assert.ok(this.automation.calls().every(call => call.method === "GET"));
});
Then("the changelog PR refreshes to include the new release entry", function ()
{
  assert.deepEqual(this.docsGit.output, { ready: false, docs_pr: 125 });
  const sha = remoteHead(this);
  assert.equal(git(this, "show", "-s", "--format=%P", sha), this.docsGit.head);
  assert.equal(git(this, "diff", "--name-only", this.docsGit.head, sha), "CHANGELOG.md");
  const document = parseChangelog(git(this, "show", `${sha}:CHANGELOG.md`));
  assert.deepEqual(document.staging, []);
  assert.deepEqual(document.releases[0].entries.map(entry => entry.sha), [first, next]);
  assert.equal(git(this, "show", `${sha}:fix.txt`), "retain the new release payload");
});
Then("the canonical release changelog is ready without writes", function ()
{
  assert.deepEqual(this.docsGit.output, { ready: true });
  assert.equal(remoteHead(this, branch), this.docsGit.head);
  assert.ok(this.automation.calls().every(call => call.method === "GET"));
});
Then("changelog review reports {string} without changing branches", function (reason)
{
  assert.ok(this.docsGit.result.stderr.includes(reason), this.docsGit.result.stderr);
  assert.equal(remoteHead(this), this.docsGit.expectedDocs);
  assert.equal(remoteHead(this, branch), this.docsGit.head);
  assert.ok(this.automation.calls().every(call => call.method === "GET"));
});
When("another writer advances the docs branch before publication", function ()
{
  git(this, "checkout", "--detach", this.docsGit.generated);
  writeFileSync(join(this.docsGit.root, "concurrent.txt"), "preserve concurrent work\n");
  this.docsGit.concurrent = commit(this, "docs: concurrent writer");
  git(this, "push", this.docsGit.remote, `${this.docsGit.concurrent}:refs/heads/${docsBranch}`);
});
Then("publishing with the stale docs branch lease is refused", function ()
{
  const result = evaluate(this, preparation, "publishChangelogReview", {
    remote: this.docsGit.remote, branch: docsBranch, expected: this.docsGit.generated, sha: this.docsGit.generated,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /stale info/);
  assert.equal(remoteHead(this), this.docsGit.concurrent);
});
