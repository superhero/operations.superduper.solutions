// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { mkdir } from 'node:fs/promises';
import { Given, When, Then, After, Status } from '@cucumber/cucumber';
import { openReport, browseCoverage, assertMeasuredScope, openDirectSource, assertSourceState,
  assertDashboard, openBrowserEvidence, assertBrowserEvidence, assertPackagedAssets } from './coverage-report.fixture.mjs';

Given('a generated Vitest report is served by a plain HTTP server', { timeout: 90_000 }, async function () {
  await openReport(this);
});
Given('the complete Vitest report directory has moved away from its generating workspace', { timeout: 90_000 }, async function () {
  await openReport(this, true);
});
When('I browse coverage folders and filter filenames that differ only in punctuation', async function () {
  await browseCoverage(this.report);
});
Then('coverage retains both executed and unexecuted files in its measured scope', async function () {
  await assertMeasuredScope(this.report);
});
When('I open a source line directly and navigate its browser history', async function () {
  await openDirectSource(this.report);
});
Then('source text line anchors and reloads retain the selected file and line', async function () {
  await assertSourceState(this.report);
});
Then('the dashboard accounts for every passing Gherkin case and canonical example identity', async function () {
  await assertDashboard(this.report);
});
When('I filter the report and open its browser evidence scenario', async function () {
  await openBrowserEvidence(this.report);
});
Then('its screenshot is viewable and its trace attachment is downloadable', async function () {
  await assertBrowserEvidence(this.report);
});
Then('the report uses only its packaged assets with optional external typography blocked', function () {
  assertPackagedAssets(this.report);
});

After({ tags: '@coverage-report', timeout: 30_000 }, async function ({ result }) {
  const state = this.report;
  if (!state) return;
  const failed = result?.status !== Status.PASSED || state.errors.length || state.missing.length;
  const errors = [];
  try {
    if (failed) {
      await mkdir(this.artifactDirectory, { recursive: true });
      await this.attach(JSON.stringify({ missing: state.missing, external: state.external, errors: state.errors,
        page: state.page?.url(), source: state.sourcePage?.url() }), 'application/json');
      if (state.page && !state.page.isClosed()) await this.attach(await state.page.screenshot({ timeout: 5_000 }), 'image/png');
    }
  } catch (error) { errors.push(error); }
  try { await state.context?.tracing.stop(failed ? { path: `${this.artifactDirectory}/report-trace.zip` } : {}); }
  catch (error) { errors.push(error); }
  try { await state.context?.close(); } catch (error) { errors.push(error); }
  if (state.server?.listening) {
    try { await new Promise((done, reject) => state.server.close(error => error ? reject(error) : done())); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Static report inspection cleanup failed');
});
