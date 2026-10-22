// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { preparePlan } from '../../tests/gherkin/ci.mjs';
const version = JSON.parse(readFileSync('package.json', 'utf8')).devDependencies['@playwright/test'];
const image = `mcr.microsoft.com/playwright:v${version}-noble`;
try {
  const identity = execFileSync('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim();
  const references = JSON.parse(execFileSync('docker', ['image', 'inspect', image, '--format', '{{json .RepoDigests}}'], { encoding: 'utf8' }));
  const reference = references.find(value => /^mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}$/.test(value));
  if (!reference) throw new Error('Pinned browser image has no immutable registry digest.');
  const plan = await preparePlan({ ...process.env, CI_BROWSER_IMAGE_SHA: identity, CI_BROWSER_IMAGE_REFERENCE: reference });
  console.log(`Prepared ${plan.units.length} independently verifiable browser features against ${plan.testedSha}.`);
} catch (error) { console.error(`::error::Cannot prepare incremental validation: ${error.message}`); process.exitCode = 1; }
