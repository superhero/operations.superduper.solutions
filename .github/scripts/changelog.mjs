// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export const STAGING_TRAILER = "Changelog-Generated: staging-v1";
const STAGING_END = "<!-- changelog-staging-end -->";

const SHA = /^[0-9a-f]{40}$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/;
const emptyDocument = () => ({ staging: [], releases: [] });

function requireValue(condition, reason)
{
  if (!condition) throw new Error(`Invalid changelog: ${reason}`);
}

function validateEntry(entry)
{
  requireValue(entry && typeof entry === "object" && typeof entry.sha === "string" && SHA.test(entry.sha),
    "commit ID must be a full lowercase SHA");
  requireValue(typeof entry.message === "string" && entry.message.trim().length > 0 && !entry.message.includes("\0"),
    `commit ${entry.sha} must have a nonempty message without NUL bytes`);
  requireValue(entry.repository === undefined ||
    (typeof entry.repository === "string" && REPOSITORY.test(entry.repository)), "repository must be an owner/name slug");
}

function validateVersion(version)
{
  requireValue(typeof version === "string" && VERSION.test(version),
    "version must be unprefixed SemVer MAJOR.MINOR.PATCH with no leading zeros");
}

function validateDocument(document)
{
  requireValue(document && Array.isArray(document.staging) && Array.isArray(document.releases), "invalid document structure");
  const versions = new Set();
  const commits = new Set();
  for (const release of document.releases)
  {
    validateVersion(release.version);
    requireValue(!versions.has(release.version), `duplicate version ${release.version}`);
    requireValue(Array.isArray(release.entries), `invalid entries for ${release.version}`);
    versions.add(release.version);
  }
  for (const entry of [document.staging, ...document.releases.map(release => release.entries)].flat())
  {
    validateEntry(entry);
    requireValue(!commits.has(entry.sha), `duplicate commit ID ${entry.sha}`);
    commits.add(entry.sha);
  }
}

function commitHeading(entry)
{
  const label = `\`${entry.sha.slice(0, 7)}\``;
  return `### Commit ${entry.repository ? `[${label}](https://github.com/${entry.repository}/commit/${entry.sha})` : label}`;
}

function messageFence(message)
{
  let length = 3;
  for (const match of message.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  return "`".repeat(length);
}

function formatEntry(entry)
{
  const fence = messageFence(entry.message);
  return `<!-- changelog-commit:${entry.sha} -->\n${commitHeading(entry)}\n\n${fence}text\n${entry.message}\n${fence}`;
}

function compareVersions(left, right)
{
  const a = left.version.split(".").map(BigInt);
  const b = right.version.split(".").map(BigInt);
  for (let index = 0; index < a.length; index++)
  {
    if (a[index] !== b[index]) return a[index] > b[index] ? -1 : 1;
  }
  return 0;
}

/** Render a validated document with Staging first and newest release versions first. */
export function formatChangelog(document)
{
  validateDocument(document);
  const sections = [{ version: "Staging", entries: document.staging }, ...[...document.releases].sort(compareVersions)];
  // Keep a boundary after Staging even when empty. Without it, Git can merge a
  // release heading above old entries and silently place new staged work below it.
  return `# Changelog\n\n${sections.map(section => `## ${section.version}${section.entries.length ?
    `\n\n${section.entries.map(formatEntry).join("\n\n")}` : ""}${section.version === "Staging" ?
    `\n\n${STAGING_END}` : ""}`).join("\n\n")}\n`;
}

/** Parse only the managed format. Unknown prose fails rather than being silently erased. */
export function parseChangelog(text)
{
  requireValue(typeof text === "string", "document must be text");
  if (text.trim() === "") return emptyDocument();
  const lines = text.split("\n");
  const document = emptyDocument();
  requireValue(lines[0] === "# Changelog", "expected # Changelog title");
  let index = 1;
  const skipBlank = () => { while (lines[index] === "") index++; };
  skipBlank();
  requireValue(lines[index] === "## Staging", "expected Staging as the first section");
  index++;
  let entries = document.staging;
  let stagingClosed = false;
  while (index < lines.length)
  {
    skipBlank();
    if (index >= lines.length) break;
    if (lines[index] === STAGING_END)
    {
      requireValue(!stagingClosed && entries === document.staging, "duplicate or misplaced Staging boundary");
      stagingClosed = true;
      index++;
      continue;
    }
    if (lines[index].startsWith("## "))
    {
      const version = lines[index++].slice(3);
      validateVersion(version);
      requireValue(stagingClosed, "missing Staging boundary before released versions");
      const release = { version, entries: [] };
      document.releases.push(release);
      entries = release.entries;
      continue;
    }
    const marker = /^<!-- changelog-commit:([0-9a-f]{40}) -->$/.exec(lines[index++]);
    requireValue(marker, `unrecognized content at line ${index}; refusing to discard authored content`);
    requireValue(!stagingClosed || entries !== document.staging, "commit outside Staging boundary");
    const entry = { sha: marker[1] };
    const heading = lines[index++];
    const link = /^### Commit \[`[0-9a-f]{7}`\]\(https:\/\/github\.com\/([^/]+\/[^/]+)\/commit\/[0-9a-f]{40}\)$/.exec(heading);
    if (link) entry.repository = link[1];
    requireValue(heading === commitHeading(entry), `commit heading does not match ${entry.sha}`);
    requireValue(lines[index++] === "", `expected blank line after commit ${entry.sha}`);
    const fence = /^(`{3,})text$/.exec(lines[index++]);
    requireValue(fence, `expected literal message fence for commit ${entry.sha}`);
    const start = index;
    while (index < lines.length && lines[index] !== fence[1]) index++;
    requireValue(index < lines.length, `unclosed message fence for commit ${entry.sha}`);
    entry.message = lines.slice(start, index++).join("\n");
    requireValue(fence[1] === messageFence(entry.message), `unsafe or noncanonical message fence for commit ${entry.sha}`);
    entries.push(entry);
  }
  // Accept the original empty initializer, but require the boundary once entries
  // or releases exist. The next rendering upgrades that empty initializer.
  requireValue(stagingClosed || (document.staging.length === 0 && document.releases.length === 0),
    "missing Staging boundary");
  validateDocument(document);
  return document;
}

function combineDocuments(documents)
{
  const document = emptyDocument();
  const locations = new Map();
  const releases = new Map();
  const add = (entry, version) =>
  {
    const existing = locations.get(entry.sha);
    if (existing)
    {
      requireValue(existing.entry.message === entry.message, `conflicting messages for commit ${entry.sha}`);
      requireValue(!existing.entry.repository || !entry.repository || existing.entry.repository === entry.repository,
        `conflicting repositories for commit ${entry.sha}`);
      requireValue(!existing.version || !version || existing.version === version,
        `conflicting release versions for commit ${entry.sha}`);
      if (!existing.entry.repository && entry.repository) existing.entry.repository = entry.repository;
      if (!existing.version && version)
      {
        document.staging.splice(document.staging.indexOf(existing.entry), 1);
        releases.get(version).entries.push(existing.entry);
        existing.version = version;
      }
      return;
    }
    const copy = { ...entry };
    (version ? releases.get(version).entries : document.staging).push(copy);
    locations.set(entry.sha, { entry: copy, version });
  };
  for (const source of documents)
  {
    for (const release of source.releases)
    {
      if (!releases.has(release.version))
      {
        const copy = { version: release.version, entries: [] };
        releases.set(release.version, copy);
        document.releases.push(copy);
      }
      for (const entry of release.entries) add(entry, release.version);
    }
    for (const entry of source.staging) add(entry);
  }
  return document;
}

/** Union documents by full SHA. Released placement wins over a stale Staging copy. */
export function mergeChangelogs(...texts)
{
  return formatChangelog(combineDocuments(texts.map(parseChangelog)));
}

/** Append previously unseen commits, preserving every character of their full messages. */
export function addCommits(text, commits, repository)
{
  requireValue(Array.isArray(commits), "commits must be an array");
  const additions = commits.map(commit => ({ sha: commit?.sha, message: commit?.message,
    ...(repository === undefined ? {} : { repository }) }));
  for (const entry of additions) validateEntry(entry);
  return formatChangelog(combineDocuments([parseChangelog(text), { staging: additions, releases: [] }]));
}

/** Fold Staging into a release, also supporting retries that extend the same version. */
export function releaseChangelog(text, version)
{
  validateVersion(version);
  const document = parseChangelog(text);
  let release = document.releases.find(candidate => candidate.version === version);
  if (!release)
  {
    release = { version, entries: [] };
    document.releases.push(release);
  }
  release.entries.push(...document.staging);
  document.staging = [];
  return formatChangelog(document);
}
