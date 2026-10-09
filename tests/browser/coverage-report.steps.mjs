// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Given, When, Then } from '@cucumber/cucumber';
import { coverageFixture, coverageNavigation } from './coverage-report.fixture.mjs';

Given('a standalone coverage report opened over {string}', async function (transport) {
  const output = await coverageFixture(this.artifactDirectory);
  this.coverageRequests = [];
  this.page.on('request', request => this.coverageRequests.push(request.url()));
  if (transport === 'file') {
    this.coverageURL = pathToFileURL(output).href;
    await this.page.route(this.coverageURL, route => route.continue());
  } else {
    assert.equal(transport, 'http');
    this.coverageURL = `${this.baseURL}/test-coverage.html`;
    const body = await readFile(output);
    await this.page.route(this.coverageURL, route => route.fulfill({ contentType: 'text/html', body }));
  }
  await this.page.goto(this.coverageURL);
});

When('I navigate coverage folders, files, source lines and browser history', async function () {
  await coverageNavigation(this.page);
});

Then('coverage navigation needs no separate pages or network assets', function () {
  assert.deepEqual(this.coverageRequests.filter(url =>
    url.split('#')[0] !== this.coverageURL && !url.startsWith('blob:') && !url.startsWith('data:')), []);
});
