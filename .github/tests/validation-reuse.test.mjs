// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { After, Before, Given, Then, When } from "@cucumber/cucumber";
import { findValidation } from "../scripts/find-validation.mjs";
import { ARTIFACT_NAMES, BUNDLE_FILES, REPORT_FILES, MANIFEST_NAME, createManifest } from "../scripts/validation-artifacts.mjs";
import { ValidationRequestError } from "../scripts/validation-request.mjs";

const repository = "superhero/operations.superduper.solutions";
const apiRoot = `repos/${repository}`;
const changelog = "# Changelog\n\n## Latest\n\n<!-- changelog-latest-end -->\n";
const otherSha = "f".repeat(40);
const write = (path, contents) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents); };

Before({ tags: "@validation-reuse" }, function ()
{
  const root = mkdtempSync(join(tmpdir(), "operations-validation-reuse-"));
  const cwd = join(root, "repository");
  mkdirSync(cwd);
  this.validationReuse = {
    root, cwd, notes: [], calls: [], downloads: [], destination: join(root, "verified"),
    artifactRoot: join(root, "artifacts"), workflow: "ci-develop.yml",
    git: (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
  };
  this.validationReuse.git("init", "--quiet");
  this.validationReuse.git("config", "user.name", "Validation Fixture");
  this.validationReuse.git("config", "user.email", "validation@example.invalid");
});

After({ tags: "@validation-reuse" }, function ()
{
  rmSync(this.validationReuse.root, { recursive: true, force: true });
});

Given("a completed validation run with {string}", function (condition)
{
  const state = this.validationReuse;
  for (const path of ["src/application.ts", "src/application.feature", "package.json", "package-lock.json", ".node-version",
    ".github/workflows/ci-develop.yml", ".github/badges/version-dependency-vite.svg", "docs/design.md"])
    write(join(state.cwd, path), `original ${path}\n`);
  write(join(state.cwd, "CHANGELOG.md"), changelog);
  state.git("add", ".");
  state.git("commit", "--quiet", "-m", "Initial tested inputs");
  state.sourceSha = state.git("rev-parse", "HEAD");
  if (["a proposed merge checkout", "a shallow proposed merge checkout"].includes(condition))
  {
    const base = state.sourceSha;
    write(join(state.cwd, "src/application.ts"), "proposed source\n");
    state.git("add", ".");
    state.git("commit", "--quiet", "-m", "Proposed source");
    state.sourceSha = state.git("rev-parse", "HEAD");
    const merge = state.git("commit-tree", "HEAD^{tree}", "-p", base, "-p", state.sourceSha, "-m", "Proposed merge");
    state.git("checkout", "--quiet", "--detach", merge);
  }
  state.testedSha = state.git("rev-parse", "HEAD");
  for (const name of BUNDLE_FILES) write(join(state.artifactRoot, "bundle", name), `tested bundle ${name}\n`);
  write(join(state.artifactRoot, "coverage", "coverage-summary.json"), '{"total":{"lines":{"pct":100}}}\n');
  write(join(state.artifactRoot, "coverage", "index.html"), "<html>Original coverage report</html>\n");
  write(join(state.artifactRoot, "test-report", "test-report.html"), "<html>Original combined test report</html>\n");
  for (const file of REPORT_FILES.filter(file => file.startsWith("badges/")))
    write(join(state.artifactRoot, "test-report", file), `Original ${file}\n`);
  state.manifestOptions = { repository, runId: 123, runAttempt: 1, sourceSha: state.sourceSha, testedSha: state.testedSha,
    cwd: state.cwd, bundle: join(state.artifactRoot, "bundle"), coverage: join(state.artifactRoot, "coverage"),
    report: join(state.artifactRoot, "test-report", "test-report.html") };
  state.manifest = createManifest(state.manifestOptions);
  state.run = { id: 123, run_attempt: 1, head_sha: state.sourceSha, status: "completed", conclusion: "success",
    event: "pull_request", path: ".github/workflows/ci-develop.yml", repository: { id: 456, full_name: repository },
    head_repository: { id: 456, full_name: repository } };
  state.artifacts = ARTIFACT_NAMES.map((name, index) => ({ id: index + 2000, name, expired: false, size_in_bytes: 100,
    expires_at: "2099-01-01T00:00:00Z", workflow_run: { id: state.run.id, repository_id: 456,
      head_repository_id: 456, head_sha: state.sourceSha } }));
  state.commit = { sha: state.testedSha, tree: { sha: state.manifest.testedTree },
    parents: state.git("show", "-s", "--format=%P", state.testedSha).split(" ").filter(Boolean).map(sha => ({ sha })) };
  state.tree = { sha: state.manifest.testedTree, truncated: false,
    tree: state.git("ls-tree", "-z", state.testedSha).split("\0").filter(Boolean).map(record =>
    {
      const [metadata, path] = record.split("\t");
      const [mode, type, sha] = metadata.split(" ");
      return { mode, type, sha, path };
    }) };

  const changes = {
    "changed source": "src/application.ts", "changed dependencies": "package.json", "changed lockfile": "package-lock.json",
    "changed tests": "src/application.feature", "changed workflow": ".github/workflows/ci-develop.yml",
    "changed toolchain": ".node-version", "changed documentation": "docs/design.md",
    "changed dependency badges": ".github/badges/version-dependency-vite.svg"
  };
  if (changes[condition]) write(join(state.cwd, changes[condition]), "Changed relevant input\n");
  else switch (condition)
  {
    case "identical inputs": case "a proposed merge checkout": break;
    case "a shallow proposed merge checkout":
      write(join(state.cwd, ".git", "shallow"), `${state.testedSha}\n`);
      state.manifest = createManifest(state.manifestOptions); break;
    case "independently valid release notes": write(join(state.cwd, "CHANGELOG.md"), `${changelog}\n## 1.2.3\n`); break;
    case "changed file mode": chmodSync(join(state.cwd, "src/application.ts"), 0o755); break;
    case "malformed release notes": write(join(state.cwd, "CHANGELOG.md"), "# Unmanaged notes\n"); break;
    case "executable release notes": chmodSync(join(state.cwd, "CHANGELOG.md"), 0o755); break;
    case "symlink release notes":
      rmSync(join(state.cwd, "CHANGELOG.md")); symlinkSync("package.json", join(state.cwd, "CHANGELOG.md")); break;
    case "a successful release workflow":
      state.workflow = "ci-release.yml"; state.run.path = ".github/workflows/ci-release.yml"; break;
    case "a successful main workflow":
      state.workflow = "ci-main.yml"; state.run.path = ".github/workflows/ci-main.yml"; break;
    case "paginated validation artifacts":
      state.artifacts.unshift(...Array.from({ length: 99 }, (_, index) => ({ name: `unrelated-${index}` }))); break;
    case "an older complete validation": state.newerCandidate = true; break;
    case "budget exhaustion before a matching run":
      state.newerCandidate = true; state.slowCandidate = true; state.elapsed = 0; break;
    case "budget exhaustion during artifact download": state.slowDownload = true; state.elapsed = 0; break;
    case "too many candidates before a matching run": state.excessCandidates = true; break;
    case "a fork run": state.run.head_repository = { id: 999, full_name: "fork/project" }; break;
    case "another repository": state.run.repository.full_name = "other/project"; break;
    case "another workflow": state.run.path = ".github/workflows/ci-docs.yml"; break;
    case "another event": state.run.event = "workflow_dispatch"; break;
    case "a failed run": state.run.conclusion = "failure"; break;
    case "incomplete artifact pagination": state.extraArtifacts = 1; break;
    case "a missing bundle artifact": state.artifacts = state.artifacts.filter(artifact => artifact.name !== "bundle"); break;
    case "a missing manifest artifact": state.artifacts.pop(); break;
    case "an expired coverage artifact": state.artifacts[1].expired = true; break;
    case "a duplicate report artifact": state.artifacts.push({ ...state.artifacts[2], id: 9001 }); break;
    case "an artifact from another run": state.artifacts[0].workflow_run.id = 999; break;
    case "an old manifest attempt": state.manifest.runAttempt = 2; break;
    case "a manifest for another source": state.manifest.sourceSha = otherSha; break;
    case "an unrelated tested commit": state.manifest.testedSha = state.commit.sha = otherSha; break;
    case "a forged input fingerprint": state.tree.tree[0].sha = otherSha; break;
    case "an incomplete remote tree": state.tree.truncated = true; break;
    case "a corrupt bundle": write(join(state.artifactRoot, "bundle", "index.html"), "corrupt bundle\n"); break;
    case "an incomplete coverage report": rmSync(join(state.artifactRoot, "coverage", "coverage-summary.json")); break;
    case "a missing report badge": rmSync(join(state.artifactRoot, "test-report", "badges/test-scenarios.svg")); break;
    case "a modified report badge": write(join(state.artifactRoot, "test-report", "badges/test-coverage.json"), "modified badge\n"); break;
    case "a missing combined report": rmSync(join(state.artifactRoot, "test-report", "test-report.html")); break;
    case "an extra artifact file": write(join(state.artifactRoot, "bundle", "unexpected.html"), "extra file\n"); break;
    case "a prototype-named artifact file": write(join(state.artifactRoot, "bundle", "__proto__"), "extra file\n"); break;
    case "an extra empty artifact directory": mkdirSync(join(state.artifactRoot, "bundle", "empty")); break;
    case "a symlink in the bundle":
      rmSync(join(state.artifactRoot, "bundle", "index.html"));
      symlinkSync("favicon.svg", join(state.artifactRoot, "bundle", "index.html")); break;
    case "an unavailable artifact download": state.failDownload = true; break;
    case "a rerun during download": state.rerun = true; break;
    case "an unavailable GitHub API": state.failApi = true; break;
    case "a modified tracked checkout": state.modifyCheckout = true; break;
    default: assert.fail(`Unknown validation fixture: ${condition}`);
  }
  state.git("add", ".");
  if (state.git("status", "--porcelain")) state.git("commit", "--quiet", "-m", "Target changes");
  state.targetSha = state.git("rev-parse", "HEAD");
  if (state.modifyCheckout) write(join(state.cwd, "src/application.ts"), "Uncommitted input\n");
  write(join(state.artifactRoot, "validation-manifest", MANIFEST_NAME), JSON.stringify(state.manifest));
});

Given("validation remote reads encounter {string}", function (failure)
{
  const state = this.validationReuse;
  state.remoteFailure = failure;
  state.elapsed = 0;
  state.waits = [];
  state.retryTimeouts = [];
  state.failureEndpoint = `${apiRoot}/actions/artifacts?name=validation-manifest&per_page=100`;
  const fixtures = {
    "two API timeouts": ["timeout", 2, 3],
    "one API network interruption": ["network", 1, 2],
    "repeated API server failures": ["server", 3, 3],
    "API authorization failure": ["authorization", 1, 1],
    "missing API resource": ["not_found", 1, 1],
    "API rate limit": ["rate_limit", 1, 1],
    "malformed API response": ["invalid_response", 1, 1],
    "invalid proof after API recovery": ["timeout", 1, 2],
    "shrinking budget after two timeouts": ["timeout", 2, 3],
    "retry wait exhausts the budget": ["network", 1, 1]
  };
  if (fixtures[failure]) [state.failureKind, state.failuresRemaining, state.expectedAttempts] = fixtures[failure];
  else if (failure === "interrupted artifact download" || failure === "repeated artifact interruptions")
  {
    state.downloadFailures = failure === "interrupted artifact download" ? 1 : 3;
    state.expectedAttempts = failure === "interrupted artifact download" ? 2 : 3;
  }
  else assert.fail(`Unknown remote read fixture: ${failure}`);
  if (failure === "shrinking budget after two timeouts")
    state.failureEndpoint = `${apiRoot}/actions/runs/123/artifacts?per_page=100&page=1`;
  if (failure === "invalid proof after API recovery")
  {
    state.manifest.inputFingerprint = "f".repeat(64);
    write(join(state.artifactRoot, "validation-manifest", MANIFEST_NAME), JSON.stringify(state.manifest));
  }
});

When("matching validation artifacts are requested", async function ()
{
  const state = this.validationReuse;
  const api = async (endpoint, options) =>
  {
    state.calls.push(endpoint);
    if (state.elapsed !== undefined) state.timeouts ??= [];
    state.timeouts?.push(options.timeoutMs);
    if (state.remoteFailure === "shrinking budget after two timeouts" && state.calls.length <= 2) state.elapsed += 20000;
    if (state.remoteFailure && endpoint === state.failureEndpoint && !state.downloadFailures)
    {
      state.retryTimeouts.push(options.timeoutMs);
      if (state.failuresRemaining-- > 0)
      {
        if (state.remoteFailure === "shrinking budget after two timeouts") state.elapsed += options.timeoutMs;
        if (state.remoteFailure === "retry wait exhausts the budget") state.elapsed = 119500;
        throw new ValidationRequestError(state.failureKind, state.failureKind === "server" ? 503 : undefined);
      }
    }
    if (state.failApi) throw new Error("GitHub unavailable");
    if (endpoint === `${apiRoot}/actions/artifacts?name=validation-manifest&per_page=100`)
      return { artifacts: [...state.artifacts.filter(artifact => artifact.name === "validation-manifest"),
        ...(state.newerCandidate ? [{ name: "validation-manifest", expired: false, workflow_run: { id: 124 } }] : []),
        ...(state.excessCandidates ? Array.from({ length: 25 }, (_, index) => ({ name: "validation-manifest", expired: false,
          workflow_run: { id: 124 + index } })) : [])] };
    if (endpoint.startsWith(`${apiRoot}/actions/runs/123/artifacts?per_page=100&page=`))
    {
      const page = Number(endpoint.split("page=").at(-1));
      return { total_count: state.artifacts.length + (state.extraArtifacts ?? 0), artifacts: state.artifacts.slice((page - 1) * 100, page * 100) };
    }
    if (endpoint === `${apiRoot}/git/commits/${state.manifest.testedSha}`) return state.commit;
    if (endpoint === `${apiRoot}/git/trees/${state.manifest.testedTree}`)
    {
      if (state.slowDownload) state.elapsed = 119990;
      return state.tree;
    }
    if (endpoint === `${apiRoot}/actions/runs/123`)
      return { ...state.run, run_attempt: state.rerun && state.downloads.length > 0 ? 2 : 1 };
    if (endpoint === `${apiRoot}/actions/runs/124` && state.newerCandidate)
    {
      if (state.slowCandidate) state.elapsed = 120000;
      return { ...state.run, id: 124, conclusion: "failure" };
    }
    if (state.excessCandidates && /^repos\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(endpoint))
      return { ...state.run, id: Number(endpoint.split("/").at(-1)), conclusion: "failure" };
    state.unexpected = endpoint;
    throw new Error(`Unexpected API request: ${endpoint}`);
  };
  try
  {
    state.result = await findValidation({ repository, targetSha: state.targetSha, destination: state.destination, cwd: state.cwd,
      ...(state.elapsed !== undefined ? { now: () => state.elapsed } : {}),
      ...(state.remoteFailure ? { wait: async milliseconds => { state.waits.push(milliseconds); state.elapsed += milliseconds; } } : {}),
      api, download: async (ownerRepo, runId, name, directory, options) =>
      {
        assert.equal(ownerRepo, repository);
        assert.equal(runId, 123);
        state.downloads.push(name);
        state.transferDirectories ??= [];
        state.transferDirectories.push(directory);
        if (state.remoteFailure?.includes("artifact") && name === "bundle")
        {
          assert.ok(!existsSync(directory), "A retry must remove the previous partial artifact directory.");
          state.cleanedAttempts = (state.cleanedAttempts ?? 0) + 1;
          if (state.downloadFailures-- > 0)
          {
            write(join(directory, "partial-download"), "must not survive the retry");
            throw new ValidationRequestError("network");
          }
        }
        if (state.slowDownload && name === "bundle")
        {
          state.timeouts.push(options.timeoutMs);
          state.elapsed += 120000;
        }
        if (state.failDownload) throw new Error("Artifact unavailable");
        cpSync(join(state.artifactRoot, name), directory, { recursive: true, verbatimSymlinks: true });
      }, note: message => state.notes.push(message) });
  }
  catch (error) { state.error = error; }
  assert.equal(state.unexpected, undefined, state.unexpected);
  assert.ok(state.calls.every(endpoint => !/\/jobs(?:\?|$)/.test(endpoint)), "The trusted manifest must not require a redundant jobs API request.");
});

When("complete validation provenance is recorded", function ()
{
  try { createManifest(this.validationReuse.manifestOptions); }
  catch (error) { this.validationReuse.error = error; }
});

Then("validation is {string} with the original provenance", function (outcome)
{
  const state = this.validationReuse;
  assert.ifError(state.error);
  assert.equal(state.result.reused, outcome === "reused", state.notes.join("\n"));
  if (outcome === "reused")
  {
    assert.equal(state.result.source_run_id, "123");
    assert.equal(state.result.tested_sha, state.testedSha);
    assert.equal(state.result.input_fingerprint, state.manifest.inputFingerprint);
    assert.equal(readFileSync(join(state.destination, "bundle", "index.html"), "utf8"), "tested bundle index.html\n");
    assert.equal(readFileSync(join(state.destination, "test-report", "test-report.html"), "utf8"), "<html>Original combined test report</html>\n");
    for (const file of REPORT_FILES.filter(file => file.startsWith("badges/")))
      assert.equal(readFileSync(join(state.destination, "test-report", file), "utf8"), `Original ${file}\n`);
    assert.deepEqual(JSON.parse(readFileSync(join(state.destination, "validation-manifest", MANIFEST_NAME), "utf8")),
      JSON.parse(JSON.stringify(state.manifest)));
  }
  else
  {
    assert.equal(state.result.source_run_id, "");
    assert.equal(state.result.tested_sha, "");
    assert.ok(!existsSync(state.destination), "Rejected artifacts must not be available for publication.");
    assert.ok(state.notes.some(note => note.includes("full validation is required")));
  }
});

Then("the invalid validation request is rejected", function ()
{
  assert.ok(this.validationReuse.error, "Expected invalid managed input or incomplete validation to fail.");
  assert.ok(!existsSync(this.validationReuse.destination));
});

Then("the lookup stops safely at its runtime bound", function ()
{
  const state = this.validationReuse;
  if (state.slowCandidate)
  {
    assert.ok(!state.calls.includes(`${apiRoot}/actions/runs/123`), "A later matching run must not be inspected after the deadline.");
    assert.deepEqual(state.downloads, []);
  }
  else if (state.slowDownload)
  {
    assert.deepEqual(state.downloads, ["validation-manifest", "bundle"], "Coverage and reports must not be downloaded after exhausting the budget.");
    assert.equal(state.timeouts.at(-1), 10, "The artifact command must be limited to the remaining ten milliseconds.");
  }
  else
  {
    assert.equal(state.calls.filter(endpoint => /\/actions\/runs\/\d+$/.test(endpoint)).length, 20);
    assert.ok(!state.calls.includes(`${apiRoot}/actions/runs/123`), "The twenty-candidate cap must preserve the fresh-test fallback.");
  }
  if (state.elapsed !== undefined)
  {
    assert.ok(state.timeouts.every(value => Number.isSafeInteger(value) && value > 0 && value <= 30000));
    assert.ok(state.notes.some(note => note.includes("time budget exhausted")));
  }
});

Then("remote retries preserve the shared budget and clean artifacts", function ()
{
  const state = this.validationReuse;
  const attempts = state.remoteFailure.includes("artifact")
    ? state.downloads.filter(name => name === "bundle").length : state.retryTimeouts.length;
  assert.equal(attempts, state.expectedAttempts);
  assert.deepEqual(state.waits, Array.from({ length: attempts - 1 }, (_, index) => (index + 1) * 1000));
  if (state.remoteFailure === "shrinking budget after two timeouts") assert.deepEqual(state.retryTimeouts, [30000, 30000, 17000]);
  if (state.remoteFailure === "retry wait exhausts the budget")
  {
    assert.deepEqual(state.waits, []);
    assert.ok(state.notes.some(note => note.includes("time budget exhausted")));
  }
  if (state.remoteFailure.includes("artifact"))
  {
    assert.equal(state.cleanedAttempts, state.expectedAttempts);
    assert.ok(!existsSync(join(state.destination, "bundle", "partial-download")));
    for (const directory of state.transferDirectories)
      assert.ok(!existsSync(directory), "Every temporary transfer directory must be removed after lookup completes.");
  }
  if (state.result.reused) assert.equal(state.result.source_run_id, "123");
  assert.ok(state.notes.some(note => note.includes("attempt=1/3") && note.includes("timeout_ms=")));
});
