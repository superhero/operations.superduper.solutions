// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Run in a bounded host subprocess. Never forward its token into Docker.
import { DefaultArtifactClient } from '@actions/artifact';
import { readFileSync, writeFileSync } from 'node:fs';
const [file] = process.argv.slice(2);
try {
  const input = JSON.parse(readFileSync(file, 'utf8'));
  const client = new DefaultArtifactClient();
  let response;
  if (input.command === 'upload') {
    response = await client.uploadArtifact(input.name, input.files, input.directory, { retentionDays: 7, compressionLevel: 1 });
    if (!response.id || !response.digest) throw new Error('Incomplete upload response.');
  } else if (input.command === 'download') {
    const [repositoryOwner, repositoryName] = input.repository.split('/');
    // The SDK compares the complete algorithm-prefixed digest from GitHub.
    response = await client.downloadArtifact(input.id, { path: input.directory, expectedHash: input.digest,
      findBy: { token: process.env.GH_TOKEN, workflowRunId: input.runId, repositoryOwner, repositoryName } });
    if (response.digestMismatch) throw new Error('Artifact digest mismatch.');
  } else throw new Error('Unknown artifact operation.');
  writeFileSync(`${file}.result`, JSON.stringify(response));
} catch { console.error('GitHub artifact operation failed; no result is certified.'); process.exitCode = 1; }
