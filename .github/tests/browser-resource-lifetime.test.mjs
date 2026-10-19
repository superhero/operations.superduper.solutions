// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Then } from '@cucumber/cucumber';
import { enterBrowserFeature, registerDevelopmentCleanup, releaseDevelopmentResources } from '../../tests/browser/development-resources.fixture.mjs';

Then('a feature transition closes its idle development server while same-feature entries preserve it', async () => {
  await enterBrowserFeature('resource-owner.feature');
  const server = createServer((_request, response) => response.end('ready'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const unregister = registerDevelopmentCleanup(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  try {
    assert.equal(await enterBrowserFeature('resource-owner.feature'), false);
    assert.equal(server.listening, true);
    assert.equal(await enterBrowserFeature('next-resource-owner.feature'), true);
    assert.equal(server.listening, false);
    await assert.rejects(enterBrowserFeature(''), /feature URI/);
  } finally { unregister(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
});
Then('a failed browser resource cleanup still releases other resources and permits retry', async () => {
  await enterBrowserFeature('cleanup-failure.feature');
  let released = 0;
  const first = registerDevelopmentCleanup(() => { throw new Error('fixture cleanup failure'); });
  const second = registerDevelopmentCleanup(() => { released++; });
  try {
    await assert.rejects(enterBrowserFeature('cleanup-retry.feature'), /Development resource cleanup failed/);
    assert.equal(released, 1);
    first();
    assert.equal(await enterBrowserFeature('cleanup-retry.feature'), true);
    assert.equal(released, 2);
    await releaseDevelopmentResources();
    assert.equal(released, 3);
  } finally { first(); second(); }
});
