// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { Given, Then, After, AfterAll, Status } from '@cucumber/cucumber';
import { contracts } from './legacy-smoke/contracts.mjs';
import { closeFixtureServers, ownedBrowser } from './legacy-smoke/support.mjs';

Given('the isolated browser fixture {string} uses {string}', async function (name, variant) {
  assert.ok(Object.hasOwn(contracts, name), `Unknown browser fixture: ${name}`);
  assert.equal(this.legacyJourney, undefined, 'A scenario must own exactly one browser journey');
  await mkdir(this.artifactDirectory, { recursive: true });
  const { journey } = await import(`./legacy-smoke/${name}.fixture.mjs`);
  this.legacyJourney = journey(this, variant);
  this.legacyAbort = () => { this.legacyClosing = ownedBrowser(this).close(); this.legacyClosing.catch(() => {}); };
  this.signal?.addEventListener('abort', this.legacyAbort, { once: true });
});

for (const label of new Set(Object.values(contracts).flat())) {
  Then(label, { timeout: 180_000 }, async function () {
    assert.ok(this.legacyJourney, 'The browser journey has not been initialized');
    const result = await this.legacyJourney.next();
    assert.equal(result.done, false, `Missing browser assertion group: ${label}`);
    assert.equal(result.value, label, 'The Gherkin steps must match their assertion groups in order');
  });
}
Then('every assertion in the browser journey has completed', { timeout: 30_000 }, async function () {
  assert.ok(this.legacyJourney, 'The browser journey has not been initialized');
  const result = await this.legacyJourney.next();
  assert.equal(result.done, true, `Unreported browser assertion group: ${result.value}`);
  this.legacyCompleted = true;
});

After({ tags: '@legacy-smoke', timeout: 30_000 }, async function ({ result }) {
  this.signal?.removeEventListener('abort', this.legacyAbort);
  const errors = [];
  try { await this.legacyJourney?.return(); } catch (error) { errors.push(error); }
  try { await (this.legacyClosing ?? ownedBrowser(this).close()); } catch (error) { errors.push(error); }
  if (result?.status !== Status.PASSED || errors.length) {
    for (const path of this.legacyTraces ?? []) {
      try { await this.attach(await readFile(path), 'application/zip'); } catch (error) { errors.push(error); }
    }
  } else assert.equal(this.legacyCompleted, true, 'A reported scenario must finish every assertion group');
  if (errors.length) throw new AggregateError(errors, 'Browser journey cleanup failed');
});
AfterAll({ timeout: 30_000 }, closeFixtureServers);
