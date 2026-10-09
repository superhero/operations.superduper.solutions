// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Given, When, Then } from '@cucumber/cucumber';
import { coverageFixture, coverageNavigation, realCoverageFixture, realCoverageNavigation } from './coverage-report.fixture.mjs';

async function openReport(world, output, name) {
  const url = world.coverageTransport === 'file' ? pathToFileURL(output).href : `${world.baseURL}/${name}`;
  world.coverageURLs.push(url);
  if (world.coverageTransport === 'file') {
    await world.page.route(url, route => route.continue());
  } else {
    const body = await readFile(output);
    await world.page.route(url, route => route.fulfill({ contentType: 'text/html', body }));
  }
  await world.page.goto(url);
}

Given('a standalone coverage report opened over {string}', async function (transport) {
  assert.ok(['http', 'file'].includes(transport), transport);
  this.coverageTransport = transport;
  this.coverageRequests = [];
  this.coverageURLs = [];
  this.page.on('request', request => this.coverageRequests.push(request.url()));
  await openReport(this, await coverageFixture(this.artifactDirectory), 'fixture-coverage.html');
});

When('I navigate coverage folders, files, source lines and browser history', async function () {
  await coverageNavigation(this.page);
  const output = await realCoverageFixture(join(this.artifactDirectory, 'real'));
  await openReport(this, output, 'real-coverage.html');
  await realCoverageNavigation(this.page);
});

Then('coverage navigation needs no separate pages or network assets', function () {
  assert.deepEqual(this.coverageRequests.filter(url =>
    !this.coverageURLs.includes(url.split('#')[0]) && !url.startsWith('data:')), []);
});
