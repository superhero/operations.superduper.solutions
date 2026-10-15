// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { githubRequest, ValidationRequestError, requestFailureDescription } from "./validation-request.mjs";

const sha = value => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const skipped = () => ({ ready: false, refresh: false, recovery: false, head_sha: "", base_sha: "", tested_sha: "" });
class IntegrationError extends Error {}
const require = (condition, message) => { if (!condition) throw new IntegrationError(message); };

function branch(value)
{
  if (typeof value !== "string" || /[\x00-\x20\x7f]/.test(value)) return false;
  try { execFileSync("git", ["check-ref-format", `refs/heads/${value}`], { stdio: "ignore", timeout: 2000 }); return true; }
  catch { return false; }
}

// The queue owns scheduling. This helper only reads GitHub and pins the exact
// event head against the target that exists when its queue slot starts.
export async function prepareIntegration({ repository, headRepository = repository, pullRequest, headBranch, baseBranch, headSha,
  eventAction, eventBaseChanged = false, mode, runAttempt = 1, eventBaseSha, eventSha, workflowFile,
  api = githubRequest, note = console.log,
  now = () => performance.now(), wait = milliseconds => new Promise(done => setTimeout(done, milliseconds)) })
{
  require(typeof repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
    && typeof headRepository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(headRepository)
    && Number.isSafeInteger(pullRequest) && pullRequest > 0 && sha(headSha) && branch(headBranch) && branch(baseBranch)
    && ["merge", "head", "docs"].includes(mode) && typeof eventBaseChanged === "boolean"
    && Number.isSafeInteger(runAttempt) && runAttempt > 0
    && (mode !== "merge" || (sha(eventSha) && typeof workflowFile === "string"
      && /^\.github\/workflows\/ci-(?:develop|release|support)\.yml$/.test(workflowFile)))
    && ["opened", "synchronize", "reopened", "edited", "ready_for_review"].includes(eventAction),
  "Integration preparation requires a repository, PR number, valid branches, event head and supported mode/event.");
  if (eventAction === "edited" && !eventBaseChanged)
  {
    note("Skipping a PR title or description edit; integration inputs did not change.");
    return skipped();
  }

  const deadline = now() + 240000;
  const remaining = () => {
    require(now() < deadline, "Integration preparation exceeded its read budget; retry when GitHub is available.");
    return Math.ceil(deadline - now());
  };
  const read = async endpoint => {
    for (let attempt = 1; attempt <= 3; attempt++)
    {
      try
      {
        const response = await api(endpoint, { timeoutMs: Math.min(30000, remaining()) });
        remaining();
        return response;
      }
      catch (error)
      {
        if (error instanceof IntegrationError) throw error;
        note(`GitHub read: ${requestFailureDescription(error)}; attempt=${attempt}/3.`);
        if (!(error instanceof ValidationRequestError) || !error.retryable || attempt === 3) throw error;
        require(remaining() > attempt * 1000, "Integration preparation exceeded its read budget; retry when GitHub is available.");
        await wait(attempt * 1000);
      }
    }
  };
  const endpoint = `repos/${repository}`;
  const readPR = () => read(`${endpoint}/pulls/${pullRequest}`);
  const current = pr => {
    require(pr?.number === pullRequest && typeof pr.draft === "boolean" && typeof pr.merged === "boolean"
      && ["open", "closed"].includes(pr.state), "GitHub returned invalid pull request state.");
    // Closed PRs may already have lost their source branch or fork repository.
    if (pr.state !== "open" || pr.merged || pr.draft) return false;
    require(pr.head?.repo?.full_name === headRepository && pr.base?.repo?.full_name === repository
      && pr.head.ref === headBranch && pr.base.ref === baseBranch && sha(pr.head.sha) && sha(pr.base.sha),
    "Pull request identity or metadata no longer matches this integration route.");
    return pr.head.sha === headSha;
  };
  const readRef = async (name, owner = repository) => {
    const ref = await read(`repos/${owner}/git/ref/heads/${encodeURIComponent(name)}`);
    require(ref?.ref === `refs/heads/${name}` && ref.object?.type === "commit" && sha(ref.object.sha),
      "GitHub returned an invalid canonical branch ref; no integration is safe.");
    return ref.object.sha;
  };
  let pr = await readPR();
  // An explicit rerun may resume publication after this exact release merged.
  // Keep its original event base: downstream release validation independently
  // verifies the confirmed merged tree before tagging or deployment resumes.
  if (runAttempt > 1 && mode === "head" && baseBranch === "main" && headRepository === repository
    && /^(?:release|hotfix)\//.test(headBranch) && pr?.state === "closed" && pr.merged === true && pr.head?.sha === headSha)
  {
    require(pr.number === pullRequest && pr.head.repo?.full_name === repository && pr.base?.repo?.full_name === repository
      && pr.head.ref === headBranch && pr.base.ref === baseBranch && pr.draft === false && sha(eventBaseSha)
      && sha(pr.merge_commit_sha) && typeof pr.merged_at === "string" && Number.isFinite(Date.parse(pr.merged_at)),
    "The release retry does not identify a confirmed merge of this exact event; publication remains blocked.");
    note("Resuming explicit release publication recovery; downstream validation must confirm the original merged tree.");
    return { ready: true, refresh: false, recovery: true, head_sha: headSha, base_sha: eventBaseSha, tested_sha: headSha };
  }
  if (!current(pr))
  {
    note("Skipping a closed, draft or superseded pull request run.");
    return skipped();
  }
  if (await readRef(headBranch, headRepository) !== headSha)
  {
    note("Skipping a superseded source revision; its new event owns integration.");
    return skipped();
  }
  const baseSha = await readRef(baseBranch);
  const result = { ...skipped(), head_sha: headSha, base_sha: baseSha };
  const stillCurrent = async () => {
    if (!current(await readPR()) || await readRef(headBranch, headRepository) !== headSha) return false;
    require(await readRef(baseBranch) === baseSha,
      "The target changed during integration preparation; rerun against its latest revision.");
    return true;
  };

  // Source-only release preparation has its own ancestry and changelog
  // reconciliation guards. Other routes require a mergeable proposed result.
  if (mode !== "head")
  {
    // GitHub can briefly return null while generating its proposed merge.
    for (let attempt = 0; pr.mergeable === null && attempt < 2; attempt++)
    {
      require(remaining() > 1000, "Integration preparation exceeded its read budget; retry when GitHub is available.");
      await wait(1000);
      pr = await readPR();
      if (!current(pr)) return skipped();
    }
    require(pr.mergeable !== false, "The pull request has merge conflicts; resolve them against the latest target and push the branch.");
    require(pr.mergeable === true, "GitHub has not produced a mergeable revision; retry integration preparation.");
  }

  // Only disposable development candidates may receive the target's history.
  // In particular, main -> develop and released hotfix synchronization must
  // never modify their source branch to acquire unreleased target changes.
  if (headRepository === repository && mode === "merge" && /^(?:feature|bugfix)\//.test(headBranch)
    && (baseBranch === "develop" || baseBranch.startsWith("release/")))
  {
    const comparison = await read(`${endpoint}/compare/${baseSha}...${headSha}`);
    require(comparison?.base_commit?.sha === baseSha && sha(comparison.merge_base_commit?.sha)
      && count(comparison.ahead_by) && count(comparison.behind_by) && count(comparison.total_commits)
      && comparison.total_commits === comparison.ahead_by
      && (comparison.behind_by === 0
        ? comparison.merge_base_commit.sha === baseSha && (comparison.ahead_by === 0
          ? comparison.status === "identical" && baseSha === headSha : comparison.status === "ahead")
        : comparison.merge_base_commit.sha !== baseSha && comparison.status === (comparison.ahead_by === 0 ? "behind" : "diverged")),
    "GitHub returned an invalid ancestry comparison; no source refresh is safe.");
    if (comparison.behind_by > 0)
    {
      if (!await stillCurrent()) return skipped();
      note("The source needs the latest target. Refresh it with an expected-head lease; its synchronize event will run validation.");
      return { ...result, refresh: true };
    }
  }

  let testedSha = headSha;
  if (mode === "merge")
  {
    let verified = false;
    let testedCommit;
    for (let attempt = 0; attempt < 3; attempt++)
    {
      if (sha(pr.merge_commit_sha) && pr.mergeable === true)
      {
        const merge = await read(`${endpoint}/git/commits/${pr.merge_commit_sha}`);
        if (merge?.sha === pr.merge_commit_sha && Array.isArray(merge.parents) && merge.parents.length === 2
          && merge.parents[0]?.sha === baseSha && merge.parents[1]?.sha === headSha)
        {
          testedSha = merge.sha;
          testedCommit = merge;
          verified = true;
          break;
        }
      }
      if (attempt < 2)
      {
        require(remaining() > 1000, "Integration preparation exceeded its read budget; retry when GitHub is available.");
        await wait(1000);
        pr = await readPR();
        if (!current(pr)) return skipped();
        require(pr.mergeable !== false, "The pull request has merge conflicts; resolve them against the latest target and push the branch.");
      }
    }
    require(verified, "The proposed merge does not contain the exact live target and event head; retry after GitHub refreshes it.");
    if (testedSha !== eventSha)
    {
      // Workflow code is fixed when a run is created. New target application
      // changes may be tested, but newly merged workflow instructions must not
      // be certified by a run executing older instructions.
      const paths = [workflowFile, ".github/workflows/prepare-integration.yml"];
      const trees = [];
      for (const ref of [eventSha, testedSha])
      {
        const commit = ref === testedSha ? testedCommit : await read(`${endpoint}/git/commits/${ref}`);
        require(commit?.sha === ref && sha(commit.tree?.sha),
          "Cannot verify the integration commit tree; trigger a fresh workflow event before integration.");
        const tree = await read(`${endpoint}/git/trees/${commit.tree.sha}?recursive=1`);
        require(tree?.sha === commit.tree.sha && tree.truncated === false && Array.isArray(tree.tree),
          "Cannot verify the complete integration tree; trigger a fresh workflow event before integration.");
        trees.push(paths.map(path => {
          const files = tree.tree.filter(entry => entry?.path === path);
          require(files.length === 1 && files[0].mode === "100644" && files[0].type === "blob" && sha(files[0].sha),
            "Cannot verify regular integration workflow files; trigger a fresh workflow event before integration.");
          return files[0].sha;
        }));
      }
      require(trees[0].every((blob, index) => blob === trees[1][index]),
        "Integration workflow code changed while queued; trigger a fresh workflow event before validating the new target.");
    }
  }
  if (!await stillCurrent())
  {
    note("Skipping a pull request that changed while its integration inputs were resolved.");
    return skipped();
  }
  note("Pinned the event source and current target for validation; the merge guard will recheck both before writing.");
  return { ...result, ready: true, tested_sha: testedSha };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
{
  try
  {
    require(process.argv.length === 2 && ["true", "false"].includes(process.env.EVENT_BASE_CHANGED ?? "false"),
      "Use environment inputs only, with EVENT_BASE_CHANGED set to true or false.");
    const result = await prepareIntegration({ repository: process.env.REPOSITORY, headRepository: process.env.HEAD_REPOSITORY,
      pullRequest: Number(process.env.PR_NUMBER),
      headBranch: process.env.HEAD_BRANCH, baseBranch: process.env.BASE_BRANCH, headSha: process.env.HEAD_SHA,
      eventAction: process.env.EVENT_ACTION, eventBaseChanged: process.env.EVENT_BASE_CHANGED === "true",
      mode: process.env.INTEGRATION_MODE, runAttempt: Number(process.env.RUN_ATTEMPT ?? "1"),
      eventBaseSha: process.env.EVENT_BASE_SHA, eventSha: process.env.EVENT_SHA, workflowFile: process.env.WORKFLOW_FILE });
    require(typeof process.env.GITHUB_OUTPUT === "string" && process.env.GITHUB_OUTPUT.length > 0,
      "GITHUB_OUTPUT is required to publish integration inputs.");
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(""));
  }
  catch (error)
  {
    console.error(`::error::Integration preparation failed: ${error instanceof IntegrationError ? error.message : requestFailureDescription(error)}`);
    process.exitCode = 1;
  }
}
