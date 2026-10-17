// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseChangelog } from "./changelog.mjs";

export const ARTIFACT_NAMES = ["bundle", "coverage", "test-report", "validation-manifest"];
export const REPORT_FILES = ["test-report.html", "badges/test-scenarios.json", "badges/test-scenarios.svg",
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
    || JSON.stringify(Object.keys(files["test-report"]).sort()) !== JSON.stringify([...REPORT_FILES].sort()))
    throw new Error("Validation artifacts do not contain the complete bundle, coverage and test report.");
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
  return { schemaVersion: 1, repository, runId, runAttempt, sourceSha, testedSha,
    ...localIdentity(testedSha, cwd), files };
}

export function verifyArtifacts(manifest, directory)
{
  const actual = { bundle: inventory(join(directory, "bundle")), coverage: inventory(join(directory, "coverage")),
    "test-report": inventory(join(directory, "test-report")) };
  validateArtifactContract(actual);
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
    const [command, repository, runId, runAttempt, sourceSha, testedSha, bundle, coverage, report, output, ...extra] = process.argv.slice(2);
    if (command !== "create" || !output || extra.length) throw new Error("Usage: validation-artifacts.mjs create <repository> <run-id> <run-attempt> <source-sha> <tested-sha> <bundle-dir> <coverage-dir> <report-file> <manifest-file>.");
    const manifest = createManifest({ repository, runId: Number(runId), runAttempt: Number(runAttempt), sourceSha, testedSha, bundle, coverage, report });
    writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  catch (error)
  {
    // Child-process errors may contain credential-bearing environment details.
    console.error(`::error::Could not record complete validation proof: ${error.code ? "Git or filesystem validation failed." : error.message}`);
    process.exitCode = 1;
  }
}
