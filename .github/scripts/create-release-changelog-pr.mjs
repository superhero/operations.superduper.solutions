// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { assertChangelogReviewBranch, prepareChangelogReview, publishChangelogReview } from "./prepare-release-changelog.mjs";

const SHA = /^[0-9a-f]{40}$/;
function run(command, args, { env, allowFailure = false } = {})
{
  const result = spawnSync(command, args, { env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1", ...env },
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`${command} ${args[0]} failed: ${result.stderr.trim()}`);
  return result;
}
function api(endpoint, fields)
{
  return JSON.parse(run("gh", ["api", ...(fields ? ["--method", "POST"] : []), endpoint,
    ...Object.entries(fields ?? {}).flatMap(([key, value]) => ["-f", `${key}=${value}`])]).stdout);
}

export function createReleaseChangelogPr({ repository, number, branch, head,
  remote = `https://github.com/${repository}.git`, token = process.env.GH_TOKEN })
{
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[1-9]\d*$/.test(String(number)) ||
      !/^release\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(branch) || !SHA.test(head))
    throw new Error("Expected repository, release PR number, release/version branch, and exact head SHA.");
  const version = branch.slice("release/".length);
  const docsBranch = `docs/release-changelog-${version}`;
  const marker = `<!-- release-changelog:${branch} -->`;
  const endpoint = `repos/${repository}`;
  const gitEnv = token ? { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}` } : {};
  const assertCurrentRelease = () =>
  {
    const release = api(`${endpoint}/pulls/${number}`);
    if (release.state !== "open" || release.merged_at || release.head?.ref !== branch ||
        release.head?.sha !== head || release.head?.repo?.full_name !== repository ||
        release.base?.ref !== "main" || release.base?.repo?.full_name !== repository || branchHead(branch) !== head)
      throw new Error("The release PR changed during changelog preparation; retry its current head.");
  };
  const ensureCommit = sha =>
  {
    if (run("git", ["cat-file", "-e", `${sha}^{commit}`], { allowFailure: true }).status !== 0)
      run("git", ["fetch", "--no-tags", remote, sha], { env: gitEnv });
  };
  const branchHead = (name = docsBranch) =>
  {
    const refs = run("git", ["ls-remote", "--heads", remote, `refs/heads/${name}`], { env: gitEnv }).stdout.trim();
    if (!refs) return "";
    const [sha, ref, ...extra] = refs.split(/\s+/);
    if (!SHA.test(sha) || ref !== `refs/heads/${name}` || extra.length)
      throw new Error("Could not identify one changelog docs branch head.");
    return sha;
  };
  assertCurrentRelease();
  ensureCommit(head);
  const prepared = prepareChangelogReview({ head, version });
  if (prepared.ready) return { ready: true };

  const pulls = run("gh", ["api", "--paginate",
    `${endpoint}/pulls?state=all&base=${encodeURIComponent(branch)}&head=${encodeURIComponent(`${repository.split("/")[0]}:${docsBranch}`)}&per_page=100`,
    "--jq", ".[] | @json"]).stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  // Recheck the returned identities even though the API request filters them.
  if (pulls.some(pr => pr.head?.ref !== docsBranch || pr.head?.repo?.full_name !== repository ||
      pr.base?.ref !== branch || pr.base?.repo?.full_name !== repository || !(pr.body ?? "").includes(marker)))
    throw new Error("The changelog docs PR has unexpected ownership or target; refusing to replace it.");
  const open = pulls.filter(pr => pr.state === "open");
  if (open.length > 1) throw new Error("Multiple open changelog docs PRs match this release.");
  if (!open.length && pulls.some(pr => pr.state === "closed" && !pr.merged_at))
    throw new Error("The changelog docs PR was closed without merging; reopen it to retry.");
  const existing = branchHead();
  if (open.length && (!existing || open[0].head.sha !== existing))
    throw new Error("The changelog docs PR head changed; retry its current head.");
  if (existing)
  {
    ensureCommit(existing);
    assertChangelogReviewBranch({ sha: existing, head, version });
  }
  assertCurrentRelease();
  publishChangelogReview({ remote, branch: docsBranch, expected: existing, sha: prepared.sha, token });
  assertCurrentRelease();
  if (branchHead() !== prepared.sha) throw new Error("The changelog docs branch changed before opening its PR; retry.");
  const docsPr = open[0] ?? api(`${endpoint}/pulls`, {
    base: branch, head: docsBranch, title: `docs(changelog): release ${version}`,
    body: `Version the accumulated Latest entries for ${branch}. Merge this documentation PR before the release can reach main.\n\n${marker}`,
  });
  if (!Number.isSafeInteger(docsPr.number) || docsPr.number < 1) throw new Error("GitHub returned an invalid changelog PR number.");
  return { ready: false, docs_pr: docsPr.number };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
{
  const [repository, number, branch, head] = process.argv.slice(2);
  try
  {
    const output = createReleaseChangelogPr({ repository, number, branch, head });
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(output).map(([key, value]) => `${key}=${value}\n`).join(""));
    if (process.env.GITHUB_STEP_SUMMARY && output.docs_pr)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `Release ${branch} awaits [changelog PR #${output.docs_pr}](${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repository}/pull/${output.docs_pr}).\n`);
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
  catch (error)
  {
    process.stderr.write(`::error::${error.message} (repository=${repository} release_pr=${number} head_branch=${branch} head_sha=${head})\n`);
    process.exitCode = 1;
  }
}
