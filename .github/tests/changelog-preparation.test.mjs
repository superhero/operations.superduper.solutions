// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { parseDocument } from "yaml";
import { addCommits, parseChangelog, releaseChangelog } from "../scripts/changelog.mjs";
import { API, REPOSITORY, get } from "./support.mjs";

const SOURCE = "feature/latest-messages";
const TRAILER = "Changelog-Generated: latest-v1";
const LEGACY_TRAILER = "Changelog-Generated: staging-v1";
const RELEASE_TRAILER = "Changelog-Generated: release-v1";
const generatedTrailer = format => ({ Latest: TRAILER, Staging: LEGACY_TRAILER, Release: RELEASE_TRAILER })[format];
function git(world, ...args)
{
  const result = spawnSync("git", args, { cwd: world.automation.root,
    env: { ...process.env, ...world.automation.env }, encoding: "utf8", timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trimEnd();
}
function commitMessage(world, message, file = "application.txt", content = `${message}\n`)
{
  writeFileSync(join(world.automation.root, file), content);
  git(world, "add", "--", file);
  const result = spawnSync("git", ["commit", "-q", "-F", "-"], { cwd: world.automation.root,
    env: { ...process.env, ...world.automation.env }, input: message, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const sha = git(world, "rev-parse", "HEAD");
  const body = spawnSync("git", ["cat-file", "commit", sha], { cwd: world.automation.root, encoding: "utf8" }).stdout;
  world.preparationMessages.push({ sha, message: body.slice(body.indexOf("\n\n") + 2) });
  return sha;
}
function source(world, count)
{
  world.preparationMessages = [];
  git(world, "init", "-q", "--initial-branch=develop");
  git(world, "config", "user.name", "Changelog Tester");
  git(world, "config", "user.email", "changelog@example.invalid");
  writeFileSync(join(world.automation.root, "application.txt"), "initial\n");
  writeFileSync(join(world.automation.root, "CHANGELOG.md"), "# Changelog\n\n## Latest\n\n<!-- changelog-latest-end -->\n");
  git(world, "add", "application.txt", "CHANGELOG.md");
  git(world, "commit", "-q", "-m", "Initial project");
  world.preparationBase = git(world, "rev-parse", "HEAD");
  git(world, "switch", "-q", "-c", SOURCE);
  const messages = count ? Array.from({ length: count }, (_, index) => `fix: retained message ${index + 1}\n\nBody ${index + 1}.\n`) : [
    "feat: retain the full rationale\n\nFirst paragraph.\n\nSecond paragraph with `code`, <html>, and ``` fences.\n\nReviewed-by: Contributor\n",
    "chore(changelog): record Latest commit messages\n\nA manual commit with the same subject must remain.\n"
  ];
  for (const message of messages) commitMessage(world, message);
  world.preparationHead = git(world, "rev-parse", "HEAD");
  world.preparationRemote = join(world.automation.root, "remote.git");
  git(world, "init", "--bare", "-q", world.preparationRemote);
  git(world, "remote", "add", "origin", world.preparationRemote);
  git(world, "push", "-q", "origin", "develop", SOURCE);
}
function pull(world)
{
  return { number: 73, state: "open", merged: false, draft: false,
    head: { sha: world.preparationHead, ref: SOURCE, repo: { full_name: REPOSITORY } },
    base: { sha: world.preparationBase, ref: "develop", repo: { full_name: REPOSITORY } } };
}
function reference(branch, sha)
{
  return get(`${API}/git/ref/heads/${encodeURIComponent(branch)}`,
    { ref: `refs/heads/${branch}`, object: { type: "commit", sha } });
}
function checks(world)
{
  return [get(`${API}/pulls/73`, pull(world)), reference(SOURCE, world.preparationHead),
    reference("develop", world.preparationBase)];
}
function remote(world, branch)
{
  return git(world, "--git-dir", world.preparationRemote, "rev-parse", `refs/heads/${branch}`);
}
Given("a changelog source with full commit messages", function () { source(this); });
Given("a changelog source with {int} small commits", function (count) { source(this, count); });
Given("a commit with the {string} generated trailer changes application content", function (format)
{
  const trailer = generatedTrailer(format);
  this.preparationHead = commitMessage(this, `fix: handwritten with metadata trailer\n\nKeep this application change.\n\n${trailer}\n`);
  git(this, "push", "-q", "origin", SOURCE);
});
Given("an earlier {string} generated changelog commit precedes more source work", function (format)
{
  let text = addCommits("", this.preparationMessages, REPOSITORY);
  if (format === "Staging") text = text.replace("## Latest", "## Staging")
    .replace("<!-- changelog-latest-end -->", "<!-- changelog-staging-end -->");
  if (format === "Release") text = releaseChangelog(text, "1.2.3");
  const trailer = generatedTrailer(format);
  this.preparationEarlierGenerated = commitMessage(this, `chore(changelog): record ${format} commit messages\n\n${trailer}\n`,
    "CHANGELOG.md", text);
  this.preparationMessages.pop();
  this.preparationHead = commitMessage(this, "fix: source work after changelog preparation\n\nPreserve this follow-up as well.\n");
  git(this, "push", "-q", "origin", SOURCE);
});
Given("a changelog-only merge commit has the release generated trailer", function ()
{
  writeFileSync(join(this.automation.root, "CHANGELOG.md"), addCommits("", this.preparationMessages, REPOSITORY));
  git(this, "add", "CHANGELOG.md");
  const tree = git(this, "write-tree");
  const message = `docs: preserve a manual merge rationale\n\n${RELEASE_TRAILER}\n`;
  const merged = spawnSync("git", ["commit-tree", tree, "-p", this.preparationHead, "-p", this.preparationBase, "-F", "-"],
    { cwd: this.automation.root, env: { ...process.env, ...this.automation.env }, input: message, encoding: "utf8" });
  assert.equal(merged.status, 0, merged.stderr);
  const sha = merged.stdout.trim();
  assert.equal(git(this, "diff", "--name-only", this.preparationHead, sha), "CHANGELOG.md");
  git(this, "update-ref", `refs/heads/${SOURCE}`, sha);
  this.preparationMessages.push({ sha, message });
  this.preparationHead = sha;
  git(this, "push", "-q", "origin", SOURCE);
});
Given("changelog preparation encounters {string}", function (state)
{
  this.preparationState = state;
});
When("the source changelog is prepared", function ()
{
  let queue = checks(this);
  const state = this.preparationState;
  const changed = "d".repeat(40);
  if (["stale PR head", "stale PR base", "mismatched source branch", "mismatched base branch", "forked source", "draft source", "closed source"].includes(state))
  {
    queue = queue.slice(0, 1);
    const pr = queue[0].response;
    if (state === "stale PR head") pr.head.sha = changed;
    if (state === "stale PR base") pr.base.sha = changed;
    if (state === "mismatched source branch") pr.head.ref = "feature/another";
    if (state === "mismatched base branch") pr.base.ref = "main";
    if (state === "forked source") pr.head.repo.full_name = "outsider/project";
    if (state === "draft source") pr.draft = true;
    if (state === "closed source") pr.state = "closed";
  }
  else if (state === "stale live source")
  {
    queue = queue.slice(0, 2);
    queue[1].response.object.sha = changed;
  }
  else if (state === "stale live base") queue[2].response.object.sha = changed;
  else
  {
    queue.push(...checks(this));
    if (state === "source changes before push")
    {
      queue.pop();
      queue.at(-1).response.object.sha = changed;
    }
    if (state === "base changes before push") queue.at(-1).response.object.sha = changed;
    if (state === "source races the push lease")
    {
      // Metadata can lag behind an actual concurrent push. The final Git lease
      // must reject this even though every mocked API read still matches.
      const race = commitMessage(this, "fix: concurrent source change\n");
      git(this, "push", "-q", "origin", SOURCE);
      this.preparationRacedHead = race;
    }
  }
  this.preparationResult = this.automation.execute("prepare-changelog.sh",
    [REPOSITORY, "73", this.preparationHead, "develop", this.preparationBase, SOURCE], queue, { success: null });
});
Then("a single changelog commit extends the exact source head", function ()
{
  assert.equal(this.preparationResult.status, 0, this.preparationResult.stderr);
  this.preparationGenerated = remote(this, SOURCE);
  assert.notEqual(this.preparationGenerated, this.preparationHead);
  assert.equal(git(this, "show", "-s", "--format=%P", this.preparationGenerated), this.preparationHead);
  assert.equal(git(this, "diff-tree", "--no-commit-id", "--name-only", "-r", this.preparationGenerated), "CHANGELOG.md");
  assert.match(git(this, "show", "-s", "--format=%B", this.preparationGenerated), /Changelog-Generated: latest-v1$/);
  assert.equal(remote(this, "develop"), this.preparationBase);
  assert.equal(git(this, "rev-parse", "HEAD"), this.preparationHead, "The caller checkout must remain unchanged");
  assert.equal(readFileSync(this.automation.output, "utf8"), "updated=true\n");
});
Then("every full source message is preserved", function ()
{
  assert.equal(this.preparationResult.status, 0, this.preparationResult.stderr);
  const text = git(this, "show", `${remote(this, SOURCE)}:CHANGELOG.md`);
  assert.ok(text.startsWith("# Changelog\n\n## Latest\n"));
  assert.ok(text.includes("<!-- changelog-latest-end -->"));
  const document = parseChangelog(text);
  const entries = [...document.staging, ...document.releases.flatMap(release => release.entries)];
  const bySha = (left, right) => left.sha.localeCompare(right.sha);
  assert.deepEqual(entries.map(entry => ({ sha: entry.sha, message: entry.message })).sort(bySha),
    [...this.preparationMessages].sort(bySha));
  for (const { sha, message } of this.preparationMessages)
  {
    assert.ok(text.includes(sha), `Missing source SHA ${sha}`);
    assert.ok(text.includes(message), `Missing full source message ${sha}`);
  }
});
Then("the earlier generated changelog commit is excluded", function ()
{
  const text = git(this, "show", `${remote(this, SOURCE)}:CHANGELOG.md`);
  assert.ok(!text.includes(this.preparationEarlierGenerated), "Earlier generated commits must remain excluded after renaming");
});
When("preparation retries at the generated head", function ()
{
  this.preparationHead = this.preparationGenerated;
  writeFileSync(this.automation.output, "");
  this.preparationResult = this.automation.execute("prepare-changelog.sh",
    [REPOSITORY, "73", this.preparationHead, "develop", this.preparationBase, SOURCE], [...checks(this), ...checks(this)], { success: null });
});
Then("preparation reports that no source update is needed", function ()
{
  assert.equal(this.preparationResult.status, 0, this.preparationResult.stderr);
  assert.equal(readFileSync(this.automation.output, "utf8"), "updated=false\n");
  assert.equal(remote(this, SOURCE), this.preparationGenerated);
  const text = git(this, "show", `${this.preparationGenerated}:CHANGELOG.md`);
  assert.ok(!text.includes(this.preparationGenerated), "Generated metadata commits must not generate another entry");
});
Then("preparation rejects the update without changing either branch", function ()
{
  assert.notEqual(this.preparationResult.status, 0);
  assert.match(this.preparationResult.stderr, /Changelog preparation failed/);
  assert.equal(remote(this, SOURCE), this.preparationRacedHead ?? this.preparationHead);
  assert.equal(remote(this, "develop"), this.preparationBase);
  assert.equal(readFileSync(this.automation.output, "utf8"), "");
});

Then("develop changelog preparation is isolated from heavy tests and safely gated", function ()
{
  const document = parseDocument(readFileSync(new URL("../workflows/ci-develop.yml", import.meta.url), "utf8"), { uniqueKeys: true });
  assert.deepEqual(document.errors, []);
  const { jobs } = document.toJS();
  const prepare = jobs["prepare-changelog"];
  assert.deepEqual(prepare.needs, ["integration", "workflow-checks", "validate-pr"]);
  for (const prerequisite of ["integration", "validate-pr", "prepare-changelog"])
    assert.ok(jobs.application.needs.includes(prerequisite));
  assert.match(jobs.application.if, /needs\.prepare-changelog\.outputs\.updated != 'true'/);
  const prepareEnabled = new Function("github", "needs", "startsWith", `return (${prepare.if});`);
  for (const source of ["feature/topic", "bugfix/topic", "main", "release/1.2.3", "docs/topic"])
    for (const ready of ["true", "false", ""])
      assert.equal(prepareEnabled({ head_ref: source }, { integration: { outputs: { ready } } },
        (value, prefix) => value.startsWith(prefix)), ready === "true" && !source.startsWith("docs/"),
      "Only prepared non-documentation routes may prepare the changelog");
  const eligibility = prepare.env.PREPARE_LATEST;
  for (const source of ["feature/topic", "bugfix/topic", "main", "release/1.2.3"])
    for (const fork of [false, true])
      for (const draft of [false, true])
      {
        const github = { head_ref: source, repository: REPOSITORY,
          event: { pull_request: { draft, head: { repo: { full_name: fork ? "fork/project" : REPOSITORY } } } } };
        const evaluate = new Function("github", "startsWith", `return (${eligibility.replace(/^\s*\$\{\{([\s\S]*)\}\}\s*$/, "$1")});`);
        assert.equal(evaluate(github, (value, prefix) => value.startsWith(prefix)),
          !fork && !draft && /^(feature|bugfix)\//.test(source));
      }
  assert.ok(prepare.steps.every(step => step.if === "env.PREPARE_LATEST == 'true'"));
  assert.deepEqual(prepare.steps[0].with, { ref: "${{ needs.integration.outputs.base_sha }}", "fetch-depth": 0, "persist-credentials": false });
  assert.equal(prepare.steps[1].env.TESTED_SHA, "${{ needs.integration.outputs.tested_sha }}");
  assert.match(prepare.steps[1].run, /git show "\$TESTED_SHA:\.github\/scripts\/\$file"/);
  assert.equal(prepare.steps[2].with["permission-contents"], "write");
  assert.equal(prepare.steps[2].with["permission-pull-requests"], "read");
  assert.doesNotMatch(prepare.steps.map(step => step.run ?? "").join("\n"), /npm (?:ci|install)|git (?:checkout|switch)/);
});
