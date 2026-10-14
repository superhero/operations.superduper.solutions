// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ARTIFACT_NAMES, MANIFEST_NAME, inputFingerprint, inventory, isPositiveInteger, isRepository, isSha,
  localIdentity, verifyArtifacts } from "./validation-artifacts.mjs";

export const TRUSTED_WORKFLOWS = {
  "ci-develop.yml": "Test and Build",
  "ci-release.yml": "Test and Build",
  "ci-main.yml": "Test and Build Release"
};
const LOOKUP_BUDGET_MS = 120000;
const MAX_CANDIDATES = 20;
class LookupBudgetExhausted extends Error {}
const invoke = (args, timeoutMs) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs,
  killSignal: "SIGKILL",
  maxBuffer: 16 * 1024 * 1024 });
const github = (endpoint, { timeoutMs }) => JSON.parse(invoke(["api", endpoint], timeoutMs));
const downloadArtifact = (repository, runId, name, directory, { timeoutMs }) => invoke([
  "run", "download", String(runId), "--repo", repository, "--name", name, "--dir", directory
], timeoutMs);

function trustedRun(run, repository, workflow)
{
  return run && isPositiveInteger(run.id) && isPositiveInteger(run.run_attempt) && isSha(run.head_sha)
    && run.status === "completed" && run.conclusion === "success" && run.event === "pull_request"
    && typeof run.path === "string" && run.path.split("@")[0] === `.github/workflows/${workflow}`
    && run.repository?.full_name === repository && run.head_repository?.full_name === repository
    && isPositiveInteger(run.repository.id) && run.head_repository.id === run.repository.id;
}

async function allPages(api, endpoint, key)
{
  const collected = [];
  let count;
  for (let page = 1; page <= 10; page++)
  {
    const result = await api(`${endpoint}?per_page=100&page=${page}`);
    if (!Number.isSafeInteger(result.total_count) || result.total_count < 0 || result.total_count > 1000
      || (count !== undefined && result.total_count !== count) || !Array.isArray(result[key])
      || result[key].length > 100) throw new Error("Incomplete GitHub pagination.");
    count = result.total_count;
    collected.push(...result[key]);
    if (collected.length === count) return collected;
    if (collected.length > count || result[key].length !== 100) throw new Error("Incomplete GitHub pagination.");
  }
  throw new Error("GitHub pagination exceeded the validation lookup limit.");
}

function validArtifact(artifact, run)
{
  return isPositiveInteger(artifact.id) && artifact.expired === false && isPositiveInteger(artifact.size_in_bytes)
    && artifact.workflow_run?.id === run.id && artifact.workflow_run.head_sha === run.head_sha
    && artifact.workflow_run.repository_id === run.repository.id
    && artifact.workflow_run.head_repository_id === run.repository.id
    && Number.isFinite(Date.parse(artifact.expires_at)) && Date.parse(artifact.expires_at) > Date.now();
}

export async function findValidation({ repository, targetSha, destination, cwd = process.cwd(), api = github,
  download = downloadArtifact, note = console.log, now = () => performance.now() })
{
  if (!isRepository(repository) || !isSha(targetSha) || !destination) throw new Error("Repository, full target SHA and destination are required.");
  if (existsSync(destination)) throw new Error("Validation destination must not exist; refusing to mix artifacts.");
  const target = localIdentity(targetSha, cwd);
  const result = { reused: false, source_run_id: "", tested_sha: "", input_fingerprint: target.inputFingerprint };
  // Reuse is optional. Bound the whole network lookup, including each command,
  // so an unavailable or busy history leaves time to fall back to fresh tests.
  const deadline = now() + LOOKUP_BUDGET_MS;
  const remaining = () =>
  {
    const duration = deadline - now();
    if (duration <= 0) throw new LookupBudgetExhausted();
    return Math.ceil(duration);
  };
  const bounded = async (operation, timeoutMs, ...args) =>
  {
    const value = await operation(...args, { timeoutMs: Math.min(timeoutMs, remaining()) });
    remaining();
    return value;
  };
  const request = endpoint => bounded(api, 10000, endpoint);
  const downloadWithinBudget = (...args) => bounded(download, 30000, ...args);
  let candidates = [];
  try
  {
    // A bounded recent history is an optimization only; anything older falls
    // back to full validation. Discover proofs first so the initial rollout
    // does not inspect hundreds of runs which never produced this contract.
    const proofs = await request(`repos/${repository}/actions/artifacts?name=validation-manifest&per_page=100`);
    if (!Array.isArray(proofs.artifacts) || proofs.artifacts.length > 100) throw new Error("Invalid validation artifact list.");
    candidates = [...new Set(proofs.artifacts.filter(artifact => artifact.name === "validation-manifest"
      && artifact.expired === false && isPositiveInteger(artifact.workflow_run?.id)).map(artifact => artifact.workflow_run.id))]
      .sort((a, b) => b - a).slice(0, MAX_CANDIDATES);
  }
  catch { note("Validation proof lookup unavailable; fresh validation remains available."); }
  for (const runId of candidates)
  {
    if (now() >= deadline)
    {
      note("Validation lookup time budget exhausted; full validation is required.");
      break;
    }
    const temporary = mkdtempSync(join(tmpdir(), "validation-reuse-"));
    let phase = "trusted workflow identity";
    let copying = false;
    try
    {
      const run = await request(`repos/${repository}/actions/runs/${runId}`);
      const workflow = typeof run.path === "string" ? run.path.split("@")[0].split("/").at(-1) : "";
      if (!Object.hasOwn(TRUSTED_WORKFLOWS, workflow) || run.id !== runId || !trustedRun(run, repository, workflow))
        throw new Error("Validation proof was not produced by a trusted successful workflow run.");
      phase = "successful validation jobs";
      const jobs = await allPages(request, `repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, "jobs");
      for (const name of ["Automation Checks", TRUSTED_WORKFLOWS[workflow]])
      {
        const matches = jobs.filter(job => job.name === name);
        if (matches.length !== 1 || matches[0].status !== "completed" || matches[0].conclusion !== "success"
          || matches[0].run_id !== run.id || matches[0].head_sha !== run.head_sha)
          throw new Error("Expected validation jobs did not complete successfully.");
      }
      phase = "complete unexpired artifacts";
      const artifacts = await allPages(request, `repos/${repository}/actions/runs/${run.id}/artifacts`, "artifacts");
      for (const name of ARTIFACT_NAMES)
      {
        const matches = artifacts.filter(artifact => artifact.name === name);
        if (matches.length !== 1 || !validArtifact(matches[0], run))
          throw new Error("Required validation artifacts are missing, expired, or ambiguous.");
      }
      phase = "manifest download and original run provenance";
      await downloadWithinBudget(repository, run.id, "validation-manifest", join(temporary, "validation-manifest"));
      const manifestDirectory = join(temporary, "validation-manifest");
      if (JSON.stringify(Object.keys(inventory(manifestDirectory))) !== JSON.stringify([MANIFEST_NAME]))
        throw new Error("Unexpected validation manifest files.");
      const manifest = JSON.parse(readFileSync(join(temporary, "validation-manifest", MANIFEST_NAME), "utf8"));
      if (manifest.schemaVersion !== 1 || manifest.repository !== repository || manifest.runId !== run.id
        || manifest.runAttempt !== run.run_attempt || manifest.sourceSha !== run.head_sha
        || !isSha(manifest.testedSha) || !isSha(manifest.testedTree)
        || manifest.inputFingerprint !== target.inputFingerprint)
        throw new Error("Validation identity or relevant inputs differ.");
      phase = "verified tested commit and input tree";
      const commit = await request(`repos/${repository}/git/commits/${manifest.testedSha}`);
      if (commit.sha !== manifest.testedSha || commit.tree?.sha !== manifest.testedTree
        || (manifest.testedSha !== run.head_sha && !(commit.parents?.length === 2 && commit.parents[1].sha === run.head_sha)))
        throw new Error("Tested checkout is unrelated to the trusted workflow run.");
      const tree = await request(`repos/${repository}/git/trees/${manifest.testedTree}`);
      if (tree.sha !== manifest.testedTree || tree.truncated !== false
        || inputFingerprint(tree.tree) !== target.inputFingerprint)
        throw new Error("GitHub tested tree does not match the target inputs.");
      phase = "artifact download and tested file hashes";
      for (const name of ARTIFACT_NAMES.filter(name => name !== "validation-manifest"))
        await downloadWithinBudget(repository, run.id, name, join(temporary, name));
      verifyArtifacts(manifest, temporary);
      // A rerun can replace artifacts. Refuse evidence whose successful attempt
      // changed while it was being inspected and downloaded.
      phase = "stable successful run attempt";
      const current = await request(`repos/${repository}/actions/runs/${run.id}`);
      if (!trustedRun(current, repository, workflow) || current.run_attempt !== run.run_attempt
        || current.head_sha !== run.head_sha) throw new Error("Workflow run changed during validation lookup.");
      phase = "verified artifact staging";
      copying = true;
      cpSync(temporary, destination, { recursive: true, errorOnExist: true, force: false });
      remaining();
      note(`Reusing complete validation from ${repository} run ${run.id}, tested commit ${manifest.testedSha}.`);
      return { ...result, reused: true, source_run_id: String(run.id), tested_sha: manifest.testedSha };
    }
    catch (error)
    {
      if (copying) rmSync(destination, { recursive: true, force: true });
      if (error instanceof LookupBudgetExhausted)
      {
        note("Validation lookup time budget exhausted; full validation is required.");
        break;
      }
      note(`Validation run ${runId} rejected during ${phase}; trying another run.`);
    }
    finally { rmSync(temporary, { recursive: true, force: true }); }
  }
  note("No trusted complete validation matches the target inputs; full validation is required.");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
{
  try
  {
    const [repository, targetSha, destination, ...extra] = process.argv.slice(2);
    if (extra.length || !process.env.GITHUB_OUTPUT) throw new Error("Usage: find-validation.mjs <repository> <target-sha> <destination>; GITHUB_OUTPUT is required.");
    const result = await findValidation({ repository, targetSha, destination });
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(""));
  }
  catch (error)
  {
    console.error(`::error::Cannot find validation: ${error.code ? "Git or filesystem validation failed." : error.message}`);
    process.exitCode = 1;
  }
}
