// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export async function resolvePinnedBrowserImage({ root = process.cwd(), run, pull = false } = {}) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const version = manifest.devDependencies['@playwright/test'];
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Browser runtime must declare an exact Playwright version.');
  const tag = `mcr.microsoft.com/playwright:v${version}-noble`;
  if (pull && (await run('docker', ['pull', tag], { cwd: root, quiet: true, timeoutMs: 300_000 })).code !== 0)
    throw new Error('Cannot acquire the declared browser image.');
  const identity = await run('docker', ['image', 'inspect', tag, '--format', '{{.Id}}'], { cwd: root, quiet: true });
  const references = await run('docker', ['image', 'inspect', tag, '--format', '{{json .RepoDigests}}'], { cwd: root, quiet: true });
  if (identity.code !== 0 || references.code !== 0 || !/^sha256:[a-f0-9]{64}$/.test(identity.output))
    throw new Error('Cannot verify the declared browser image.');
  let digests;
  try { digests = JSON.parse(references.output); } catch { throw new Error('Browser image registry digests are invalid.'); }
  const imageReference = Array.isArray(digests) && digests.find(value => typeof value === 'string'
    && /^mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}$/.test(value));
  if (!imageReference) throw new Error('Pinned browser image has no immutable registry digest.');
  return { image: identity.output, imageReference };
}
