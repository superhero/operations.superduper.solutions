// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { preparePlan } from '../../tests/gherkin/ci.mjs';
import { command } from './ci-browser.mjs';
import { resolvePinnedBrowserImage } from './ci-browser-image.mjs';
try {
  const { image, imageReference } = await resolvePinnedBrowserImage({ run: command });
  const plan = await preparePlan({ ...process.env, CI_BROWSER_IMAGE_SHA: image, CI_BROWSER_IMAGE_REFERENCE: imageReference });
  console.log(`Prepared ${plan.units.length} independently verifiable browser features against ${plan.testedSha}.`);
} catch (error) { console.error(`::error::Cannot prepare incremental validation: ${error.message}`); process.exitCode = 1; }
