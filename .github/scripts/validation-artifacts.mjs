// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createHash } from "node:crypto";
import { verifyPublishedBrowserEvidence } from './ci-report-evidence.mjs';
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseChangelog } from "./changelog.mjs";
import { toolchainPackages } from "../../tests/gherkin/execution-fingerprint.mjs";

export const ARTIFACT_NAMES = ["bundle", "coverage", "test-report", "validation-manifest"];
export const REPORT_FILES = ["index.html", "ui/html.meta.json.gz", "results.json", "provenance.json",
  "coverage/index.html", "coverage/coverage-summary.json", "badges/test-scenarios.json", "badges/test-scenarios.svg",
  "badges/test-coverage.json", "badges/test-coverage.svg"];
export const MANIFEST_NAME = "validation-manifest.json";
export const BUNDLE_FILES = ["_headers", "apple-touch-icon.png", "favicon.bmp", "favicon.gif", "favicon.ico",
  "favicon.jpg", "favicon.png", "favicon.ppm", "favicon.svg", "favicon.tiff", "index.html"];
export const isSha = value => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
export const isPositiveInteger = value => Number.isSafeInteger(value) && value > 0;
export const isRepository = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
const sha256 = value => createHash("sha256").update(value).digest("hex");
const sorted = entries => entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));

export function git(args, cwd = process.cwd())
{
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
}

// Each root subtree ID covers all descendants, including their modes and names.
// The sole exception is independently validated release-note material. Keep this
// exclusion narrow: documentation and automation are otherwise build inputs.
export function inputFingerprint(entries)
{
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("Missing Git tree entries.");
  const names = new Set();
  for (const entry of entries)
  {
    if (!entry || typeof entry.path !== "string" || !entry.path || /[\0/\uFFFD]/.test(entry.path)
      || !isSha(entry.sha) || !["100644", "100755", "120000", "040000", "160000"].includes(entry.mode)
      || entry.type !== ({ "040000": "tree", "160000": "commit" }[entry.mode] ?? "blob")
      || names.has(entry.path)) throw new Error("Invalid or duplicate Git tree entry.");
    names.add(entry.path);
    if (entry.path === "CHANGELOG.md" && (entry.mode !== "100644" || entry.type !== "blob"))
      throw new Error("Excluded CHANGELOG.md must be an ordinary Markdown file.");
  }
  const inputs = sorted(entries.filter(entry => entry.path !== "CHANGELOG.md")
    .map(({ path, mode, type, sha }) => ({ path, mode, type, sha })));
  return sha256(JSON.stringify(inputs));
}

export function localIdentity(sha, cwd = process.cwd())
{
  if (!isSha(sha)) throw new Error("A full tested commit SHA is required.");
  const testedTree = git(["rev-parse", `${sha}^{tree}`], cwd).trim();
  const entries = git(["ls-tree", "-z", sha], cwd).split("\0").filter(Boolean).map(record =>
  {
    const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40})\t([\s\S]+)$/.exec(record);
    if (!match) throw new Error("Invalid local Git tree entry.");
    return { mode: match[1], type: match[2], sha: match[3], path: match[4] };
  });
  if (entries.some(entry => entry.path === "CHANGELOG.md")) parseChangelog(git(["show", `${sha}:CHANGELOG.md`], cwd));
  return { testedTree, inputFingerprint: inputFingerprint(entries) };
}

function ordinaryFile(path)
{
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) throw new Error("Artifact contains a missing, empty, or nonregular file.");
  return sha256(readFileSync(path));
}

function regularDirectory(path)
{
  const absolute = resolve(path);
  for (let current = absolute; ; current = dirname(current))
  {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Artifact directory has a non-directory or symlink ancestor.");
    if (dirname(current) === current) break;
  }
}

export function inventory(directory, { coverage = false } = {})
{
  regularDirectory(directory);
  const files = Object.create(null);
  function visit(relative = "")
  {
    const names = readdirSync(join(directory, relative)).sort();
    if (names.length === 0) throw new Error("Artifact contains an empty directory.");
    for (const name of names)
    {
      const path = relative ? `${relative}/${name}` : name;
      // Raw V8 data is intentionally excluded from the published coverage artifact.
      if (coverage && path === "v8") continue;
      if (name.startsWith(".") || /[\0\r\n\\]/.test(name)) throw new Error("Artifact has an unsupported filename.");
      const stat = lstatSync(join(directory, path));
      if (stat.isSymbolicLink()) throw new Error("Artifact contains a symlink.");
      if (stat.isDirectory()) visit(path);
      else files[path] = ordinaryFile(join(directory, path));
    }
  }
  visit();
  if (Object.keys(files).length === 0) throw new Error("Artifact has no files.");
  return files;
}

export function validateArtifactContract(files)
{
  if (JSON.stringify(Object.keys(files.bundle).sort()) !== JSON.stringify([...BUNDLE_FILES].sort())
    || !files.coverage["coverage-summary.json"] || !files.coverage["index.html"]
    || REPORT_FILES.some(path => !files["test-report"][path])
    || !Object.keys(files["test-report"]).some(path => /^ui\/assets\/.+\.js$/.test(path))
    || !Object.keys(files["test-report"]).some(path => /^ui\/assets\/.+\.css$/.test(path))
    || Object.keys(files["test-report"]).some(path => !REPORT_FILES.includes(path)
      && !/^(?:ui|coverage|attachments|badges|evidence)\//.test(path)))
    throw new Error("Validation artifacts do not contain the complete bundle, coverage and test report.");
}

export function validateReportEvidence(directory, { testedSha, runId, runAttempt, schemaVersion } = {})
{
  const provenance = JSON.parse(readFileSync(join(directory, "provenance.json"), "utf8"));
  const incremental = provenance.schemaVersion === 3;
  const expected = ["source", "acceptance", "automation", "browser", "components", "runner"].sort();
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const version = value => typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
  const keys = value => JSON.stringify(Object.keys(value).sort());
  const requiredVersions = ["node", ...toolchainPackages].sort();
  const installedVersions = value => object(value)
    && keys(value) === JSON.stringify(requiredVersions)
    && typeof value.node === "string" && value.node.startsWith("v") && version(value.node.slice(1))
    && toolchainPackages.every(name => version(value[name]));
  if (!isSha(testedSha) || !isPositiveInteger(runId) || !isPositiveInteger(runAttempt)
    || !([2, 3].includes(provenance.schemaVersion)) || (schemaVersion !== undefined && schemaVersion !== provenance.schemaVersion) || provenance.complete !== true || provenance.diagnostic !== false
    || provenance.mergeExitCode !== 0 || provenance.testedSha !== testedSha
    || !Array.isArray(provenance.suites)
    || provenance.suites.some(suite => !object(suite))
    || JSON.stringify(provenance.suites.map(suite => suite.profile).sort()) !== JSON.stringify(expected)
    || provenance.suites.some(suite => suite.head !== testedSha || !isPositiveInteger(suite.cases)
      || suite.project !== (suite.profile === "browser" ? "browser-chromium" : suite.profile)
      || String(suite.runId) !== String(runId) || (incremental && suite.profile !== "browser"
        ? !isPositiveInteger(Number(suite.runAttempt)) || Number(suite.runAttempt) > Number(runAttempt)
        : String(suite.runAttempt) !== String(runAttempt))
      || !digest(suite.resultHash) || (!(incremental && suite.profile === "browser") && !digest(suite.blobHash)) || !digest(suite.configFingerprint)
      || !installedVersions(suite.dependencyVersions)))
    throw new Error("Report lacks complete successful provenance for all Gherkin suites.");
  const signatures = provenance.suites.map(suite => JSON.stringify(Object.entries(suite.dependencyVersions).sort()));
  if (new Set(provenance.suites.map(suite => suite.configFingerprint)).size !== 1 || new Set(signatures).size !== 1)
    throw new Error("Report suites do not share the original configuration and installed toolchain.");
  if (incremental) {
    const browser = verifyPublishedBrowserEvidence(directory, provenance, { testedSha, runId, runAttempt });
    const nonbrowser = provenance.suites.filter(suite => suite.profile !== "browser");
    const names = [...nonbrowser.map(suite => `${suite.project}.json`), ...browser.units.map(unit => `units/${unit.id}.json`)].sort();
    if (!object(provenance.inputHashes) || keys(provenance.inputHashes) !== JSON.stringify(names)
      || nonbrowser.some(suite => provenance.inputHashes[`${suite.project}.json`] !== suite.blobHash))
      throw new Error("Incremental report input hashes do not match verified profile and unit blobs.");
  } else {
    const blobNames = provenance.suites.map(suite => `${suite.project}.json`).sort();
    if (!object(provenance.inputHashes) || keys(provenance.inputHashes) !== JSON.stringify(blobNames)
      || provenance.suites.some(suite => provenance.inputHashes[`${suite.project}.json`] !== suite.blobHash))
      throw new Error("Report input hashes do not match the six verified suite blobs.");
  }
  // Recorded versions describe the original producer. Reuse never substitutes
  // the current machine's toolchain or configuration for those recorded bytes.
  const summary = JSON.parse(readFileSync(join(directory, "coverage/coverage-summary.json"), "utf8")).total;
  for (const metric of ["lines", "statements", "functions", "branches"])
    if (!isPositiveInteger(summary?.[metric]?.total) || summary[metric].covered !== summary[metric].total
      || summary[metric].skipped !== 0 || summary[metric].pct !== 100)
      throw new Error("Report coverage does not satisfy every 100% threshold.");
  return provenance;
}

export function createManifest({ repository, runId, runAttempt, sourceSha, testedSha, bundle, coverage, report, cwd = process.cwd() })
{
  if (!isRepository(repository) || !isPositiveInteger(runId) || !isPositiveInteger(runAttempt)
    || !isSha(sourceSha) || !isSha(testedSha)) throw new Error("Invalid validation provenance.");
  if (git(["rev-parse", "HEAD"], cwd).trim() !== testedSha) throw new Error("Manifest must describe the checked-out commit.");
  git(["diff", "--quiet", testedSha, "--"], cwd);
  // Read raw commit headers: pretty-log parent fields disappear at shallow
  // checkout boundaries even though the original commit object retains them.
  const parents = git(["cat-file", "-p", testedSha], cwd).split("\n\n", 1)[0].split("\n")
    .filter(line => line.startsWith("parent ")).map(line => line.slice(7));
  if (testedSha !== sourceSha && !(parents.length === 2 && parents[1] === sourceSha))
    throw new Error("Tested commit must be the source head or its proposed merge.");
  const files = { bundle: inventory(bundle), coverage: inventory(coverage, { coverage: true }),
    "test-report": inventory(dirname(report)) };
  validateArtifactContract(files);
  const reportProvenance = validateReportEvidence(dirname(report), { testedSha, runId, runAttempt });
  return { schemaVersion: reportProvenance.schemaVersion, repository, runId, runAttempt, sourceSha, testedSha,
    ...localIdentity(testedSha, cwd), files };
}

export function validateManifestProvenance(manifest, expected = manifest)
{
  if (!manifest || ![2, 3].includes(manifest.schemaVersion) || !isRepository(manifest.repository)
    || !isPositiveInteger(manifest.runId) || !isPositiveInteger(manifest.runAttempt)
    || !isSha(manifest.sourceSha) || !isSha(manifest.testedSha) || !isSha(manifest.testedTree)
    || !/^[a-f0-9]{64}$/.test(manifest.inputFingerprint ?? "")
    || !expected || ["repository", "runId", "runAttempt", "sourceSha", "testedSha"]
      .some(field => manifest[field] !== expected[field]))
    throw new Error("Validation manifest does not match the original tested run provenance.");
}

export function verifyArtifacts(manifest, directory)
{
  validateManifestProvenance(manifest);
  const actual = { bundle: inventory(join(directory, "bundle")), coverage: inventory(join(directory, "coverage")),
    "test-report": inventory(join(directory, "test-report")) };
  validateArtifactContract(actual);
  validateReportEvidence(join(directory, "test-report"), manifest);
  if (!manifest.files || JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(Object.keys(actual).sort()))
    throw new Error("Manifest artifact set is incomplete.");
  for (const name of Object.keys(actual))
  {
    const expected = manifest.files[name];
    if (!expected || JSON.stringify(Object.keys(actual[name]).sort()) !== JSON.stringify(Object.keys(expected).sort())
      || Object.entries(actual[name]).some(([path, digest]) => expected[path] !== digest))
      throw new Error(`Artifact '${name}' differs from the tested files.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
{
  try
  {
    const [command, ...args] = process.argv.slice(2);
    if (command === "verify")
    {
      const [file, directory, repository, runId, runAttempt, sourceSha, testedSha, ...extra] = args;
      if (!testedSha || extra.length) throw new Error("Usage: validation-artifacts.mjs verify <manifest-file> <artifact-directory> <repository> <run-id> <run-attempt> <source-sha> <tested-sha>.");
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      validateManifestProvenance(manifest, { repository, runId: Number(runId), runAttempt: Number(runAttempt), sourceSha, testedSha });
      verifyArtifacts(manifest, directory);
    }
    else
    {
      const [repository, runId, runAttempt, sourceSha, testedSha, bundle, coverage, report, output, ...extra] = args;
      if (command !== "create" || !output || extra.length) throw new Error("Usage: validation-artifacts.mjs create <repository> <run-id> <run-attempt> <source-sha> <tested-sha> <bundle-dir> <coverage-dir> <report-file> <manifest-file>.");
      const manifest = createManifest({ repository, runId: Number(runId), runAttempt: Number(runAttempt), sourceSha, testedSha, bundle, coverage, report });
      writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }
  catch (error)
  {
    // Child-process errors may contain credential-bearing environment details.
    console.error(`::error::Could not record complete validation proof: ${error.code ? "Git or filesystem validation failed." : error.message}`);
    process.exitCode = 1;
  }
}
