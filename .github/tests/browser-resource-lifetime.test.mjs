// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'flatted';
import { readBlobResults } from '../scripts/test-results.mjs';
import { Then } from '@cucumber/cucumber';
import { browserProjects } from '../../tests/gherkin/browser-projects.mjs';
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

Then('browser project scheduling covers every selected feature once without overlapping the complete library', async () => {
  const features = ['tests/browser/live-prompt.feature', 'tests/browser/service-defaults.feature', 'tests/browser/vault.feature'];
  const projects = browserProjects(features, 'browser-chromium', 2);
  assert.deepEqual(projects.flatMap(project => project.test.include).sort(), [...features].sort());
  assert.equal(projects[0].test.name, 'browser-chromium-service-library');
  assert.deepEqual(projects[0].test.include, ['tests/browser/service-defaults.feature']);
  assert.equal(projects[0].test.maxWorkers, 1);
  assert.equal(projects[0].test.fileParallelism, false);
  assert.ok(projects[0].test.sequence.groupOrder < projects[1].test.sequence.groupOrder);
  assert.equal(projects[1].test.maxWorkers, 2);
  const { default: merge } = await import('../../tests/gherkin/merge.config.mjs');
  const names = merge.test.projects.map(project => project.test.name);
  for (const engine of ['chromium', 'firefox', 'webkit'])
    for (const project of browserProjects(features, `browser-${engine}`, 2))
      assert.ok(names.includes(project.test.name), `${project.test.name} must remain mergeable into the HTML report`);
});
Then('browser project scheduling does not add unselected features or empty projects', () => {
  assert.equal(browserProjects(['tests/browser/vault.feature'], 'browser-chromium', 2), undefined);
  const projects = browserProjects(['tests/browser/service-defaults.feature'], 'browser-firefox', 1);
  assert.equal(projects.length, 1);
  assert.deepEqual(projects[0].test.include, ['tests/browser/service-defaults.feature']);
  assert.equal(projects[0].test.name, 'browser-firefox-service-library');
});

Then('browser blob validation accepts each declared phase and rejects swapped or unrelated projects', () => {
  const directory = mkdtempSync(join(tmpdir(), 'browser-phase-evidence-'));
  const features = ['tests/browser/service-defaults.feature', 'tests/browser/live-prompt.feature'];
  const files = features.map((uri, index) => ({ type: 'suite', filepath: uri,
    projectName: index ? 'browser-chromium-application' : 'browser-chromium-service-library',
    result: { state: 'pass' }, tasks: [{ type: 'test', name: 'Phase evidence', result: { state: 'pass' },
      meta: { gherkin: { uri, line: 3 } } }] }));
  const path = join(directory, 'browser.json');
  const save = () => writeFileSync(path, stringify(['5.0.5', files, []]));
  try {
    save();
    assert.equal(readBlobResults(path, 'browser-chromium', directory, features).cases.length, 2);
    for (const [index, wrong] of [[0, 'browser-chromium-application'], [1, 'browser-chromium-service-library'], [0, 'automation'], [0, 'browser-chromium']]) {
      const original = files[index].projectName;
      files[index].projectName = wrong; save();
      assert.throws(() => readBlobResults(path, 'browser-chromium', directory, features), /Blob project/);
      files[index].projectName = original;
    }
    files.shift();
    files[0].projectName = 'browser-chromium'; save();
    assert.equal(readBlobResults(path, 'browser-chromium', directory, features.slice(1)).cases.length, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
