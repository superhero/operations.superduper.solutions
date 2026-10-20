// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { setMode } from './workspace.steps.mjs';
import { expandSchemaCard } from './schema-card.fixture.mjs';

Then('schema history compares any saved commits with lazy colored diffs and persistent conflict choices', async function () {
  const page = this.page;
  // Only the representative real bundled service is installed in this profile.
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('v1/catalogs/index'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite'); const store = tx.objectStore('state');
      const request = store.get('serviceDefaults');
      request.onsuccess = () => store.put(request.result.filter(id => id !== 'gcp-speech'), 'serviceDefaults');
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    }); db.close();
  });
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  const open = async () => {
    await setMode(page, 'settings');
    const toggle = page.locator('summary[aria-label="Schemas"]');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const card = page.locator('.schema-card[data-schema-id="gcp-speech"]');
    await expandSchemaCard(card);
    return card;
  };
  let card = await open();
  const changes = () => card.getByRole('region', { name: 'Schema changes' });
  const history = () => page.evaluate(async () => (await import('/schema-lifecycle-fixture.js')).getSchemaBranchHistory('gcp-speech'));
  const selectCommit = async (label, oid) => {
    await changes().getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: new RegExp(`^${oid.slice(0, 7)} ·`) }).click();
    await expect(changes()).toHaveAttribute('aria-busy', 'false');
  };
  const expectComparison = async (revision, base) => {
    await expect(changes()).toHaveAttribute('data-revision', revision);
    await expect(changes()).toHaveAttribute('data-base', base);
    await expect(card.locator('[data-version-oid].current')).toHaveAttribute('data-version-oid', revision);
    await expect(changes().getByRole('combobox', { name: 'Base commit', exact: true })).toContainText(base.slice(0, 7));
    await expect(changes().getByRole('combobox', { name: 'Compare commit', exact: true })).toContainText(revision.slice(0, 7));
    await expect(card.locator('svg.version-graph circle.current')).toHaveAttribute('data-commit', revision);
    await expect(card.locator('svg.version-graph circle.current')).toHaveAttribute('r', '6');
  };
  const revisionsToggle = () => card.getByRole('button', { name: 'Schema revisions', exact: true });
  await expect(revisionsToggle().locator('.material-symbols-rounded')).toHaveText('keyboard_arrow_right');
  await revisionsToggle().click();
  await expect(card.getByRole('region', { name: 'Schema revisions', exact: true })).toBeVisible();
  await expect(card.locator('.current-version')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Apply bundled revision', exact: true })).toHaveCount(0);
  await expect(card.locator('.branch-heads, .branch-labels, .comparison-version')).toHaveCount(0);
  const initial = await history();
  const published = initial.revisions.find(revision => !revision.parents.length).oid;
  const corrected = initial.current;
  await expectComparison(corrected, published);
  const selectors = () => changes().locator('.commit-selectors');
  await expect(selectors().locator('label')).toHaveCount(0);
  await expect(selectors().locator('.comparison-symbol')).toHaveText('compare_arrows');
  await page.evaluate(() => document.fonts.ready);
  const controls = await selectors().evaluate(element => {
    const base = element.querySelector('[aria-label="Base commit"]').getBoundingClientRect();
    const icon = element.querySelector('.comparison-symbol').getBoundingClientRect();
    const compare = element.querySelector('[aria-label="Compare commit"]').getBoundingClientRect();
    return { between: base.right <= icon.left && icon.right <= compare.left,
      centered: Math.abs(base.top + base.height / 2 - icon.top - icon.height / 2) < 1, iconWidth: icon.width };
  });
  assert.ok(controls.between && controls.centered, 'The comparison glyph sits centered between the selectors.');
  assert.ok(controls.iconWidth > 0 && controls.iconWidth <= 25, 'The bundled font renders an icon rather than the ligature text.');
  const graphStyle = await card.locator('svg.version-graph path').evaluateAll(paths => paths.map(path => getComputedStyle(path).strokeWidth));
  assert.ok(graphStyle.length); assert.ok(graphStyle.every(width => width === '2px'));
  assert.ok((await card.locator('.version-card').evaluateAll(cards => cards.map(card => getComputedStyle(card).borderLeftWidth))).every(width => width === '0px'));
  await expect(changes().locator('.change-group > summary')).toHaveText('Google OAuth alternatives11 operations corrected');
  await expect(changes().locator('.change-group')).not.toHaveAttribute('open');
  await expect(changes().locator('.field-change .diff-code')).toHaveCount(0);
  await changes().locator('.change-group > summary').click();
  const field = path => changes().locator('.field-change').filter({ has: page.locator('summary code', { hasText: new RegExp(`${path}$`) }) });
  const security = () => field('/security').first();
  const provenance = () => field('/x-upstream-security').first();
  await security().locator('summary').click();
  await expect(security().locator('.diff-side')).toHaveCount(2);
  await expect(security().locator('.diff-line.added').first()).toBeVisible();
  await expect(security().locator('.diff-line.removed').first()).toBeVisible();
  const backgrounds = await security().evaluate(element => ['.added', '.removed'].map(selector => getComputedStyle(element.querySelector(selector)).backgroundColor));
  assert.notEqual(backgrounds[0], backgrounds[1]);
  await provenance().locator('summary').click();
  await expect(provenance().locator('.diff-side')).toHaveCount(1);
  await expect(provenance().locator('.diff-side')).toHaveAttribute('data-side', 'after');
  await expect(provenance().locator('.diff-heading')).toHaveText('After');
  await expect(provenance().locator('.diff-line.added').first()).toBeVisible();
  // Reversal is valid, including comparing the root against its descendants.
  await selectCommit('Base commit', corrected);
  await selectCommit('Compare commit', published);
  await expectComparison(published, corrected);
  if (await changes().locator('.change-group').getAttribute('open') === null) await changes().locator('.change-group > summary').click();
  await provenance().locator('summary').click();
  await expect(provenance().locator('.diff-side')).toHaveCount(1);
  await expect(provenance().locator('.diff-side')).toHaveAttribute('data-side', 'before');
  await expect(provenance().locator('.diff-heading')).toHaveText('Before');
  // Equal endpoints have no diff, rather than treating a root as an addition.
  await selectCommit('Base commit', published);
  await expectComparison(published, published);
  await expect(changes()).toContainText('No content changes between the selected commits.');
  await card.locator(`[data-version-oid="${corrected}"] .version-card`).click();
  await expectComparison(corrected, published);
  assert.deepEqual(await history(), initial, 'Browsing and comparing never changes commits or refs.');

  const original = await page.evaluate(async oid => (await import('/schema-lifecycle-fixture.js')).readSchemaVersion('gcp-speech', oid), published);
  assert.ok(Object.values(original.paths).some(item => Object.values(item).some(operation => operation?.security?.some(requirement => requirement.Oauth2 && requirement.Oauth2c))));
  const name = card.getByRole('textbox', { name: 'Schema name', exact: true });
  await name.fill('My Speech API'); await name.press('Enter');
  await expect(name).toHaveValue('My Speech API');
  // Three commits: a fresh disclosure must compare the actual root with latest,
  // including both the earlier correction and the later name change.
  await revisionsToggle().click();
  await expect(changes()).toHaveCount(0);
  await revisionsToggle().click();
  const renamed = await history();
  await expectComparison(renamed.current, published);
  const optionOrders = [];
  for (const label of ['Base commit', 'Compare commit']) {
    const selector = changes().getByRole('combobox', { name: label, exact: true });
    await selector.click();
    await expect(page.getByRole('option')).toHaveCount(renamed.revisions.length);
    optionOrders.push((await page.getByRole('option').locator('.field-select-option-label').allTextContents()).map(text => text.slice(0, 7)));
    await selector.press('Escape');
  }
  assert.deepEqual(optionOrders[0], optionOrders[1], 'Both commit menus retain the same order regardless of their selected items.');
  assert.deepEqual(optionOrders[0], await card.locator('.version-meta code').allTextContents(), 'Both menus follow the visible commit graph order.');
  await expectComparison(renamed.current, published);
  await expect(changes().locator('.change-group > summary')).toContainText(['Schema information1 field', 'Authentication']);
  original.info.title = 'New upstream Speech title'; original.info.version = 'manual-update-2';
  await card.getByRole('button', { name: 'Replace My Speech API', exact: true }).click();
  await page.getByLabel('Replace OpenAPI document', { exact: true }).setInputFiles({ name: 'speech-upstream.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) });
  await expect(card.getByRole('region', { name: 'Review schema conflicts' })).toBeVisible();
  await expect(name).toHaveValue('My Speech API');
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  card = await open();
  const review = card.getByRole('region', { name: 'Review schema conflicts' });
  await expect(review).toBeVisible();
  await expect(review.getByRole('button', { name: 'Apply update', exact: true })).toBeDisabled();
  await review.getByRole('button', { name: 'Keep current: /info/title', exact: true }).click();
  await review.getByRole('button', { name: 'Apply update', exact: true }).click();
  await expect(review).toBeHidden();
  await expect(card.getByRole('textbox', { name: 'Schema name', exact: true })).toHaveValue('My Speech API');
  const integrated = await history();
  const current = integrated.current;
  const merged = await page.evaluate(async oid => (await import('/schema-lifecycle-fixture.js')).readSchemaVersion('gcp-speech', oid), current);
  assert.equal(merged.info.title, 'My Speech API'); assert.equal(merged.info.version, 'manual-update-2');
  await expectComparison(current, published);
  const commit = integrated.revisions.find(revision => revision.oid === current);
  assert.equal(commit.parents.length, 2);
  const other = commit.parents[1];
  await selectCommit('Base commit', other);
  await expectComparison(current, other);
  await expect(changes().locator('.field-change > summary')).toHaveCount(1);
  await expect(changes().locator('.field-change > summary')).toContainText('/info/title');
  await changes().locator('.change-group > summary').click();
  await changes().locator('.field-change > summary').click();
  await expect(changes().locator('.diff-line.removed')).toContainText('New upstream Speech title');
  await expect(changes().locator('.diff-line.added')).toContainText('My Speech API');
  await selectCommit('Base commit', published);
  await expectComparison(current, published);
  await changes().locator('.change-group').filter({ has: page.locator('summary strong', { hasText: /^Authentication$/ }) }).locator(':scope > summary').click();
  await security().locator('summary').click();
  await expect(security().locator('.diff-line.added').first()).toBeVisible();
  await mkdir(this.artifactDirectory, { recursive: true });
  await card.locator('.schema-history').screenshot({ path: `${this.artifactDirectory}/schema-history-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await card.evaluate(element => element.scrollWidth <= element.clientWidth), 'Schema revisions fit a mobile card.');
  const layout = await security().evaluate(element => {
    const before = element.querySelector('[data-side="before"]'); const after = element.querySelector('[data-side="after"]');
    const path = element.querySelector('summary code');
    const pre = before.querySelector('pre'); const scroller = before.querySelector('.diff-code');
    scroller.scrollLeft = 80; path.scrollLeft = 80;
    return { beforeTop: before.getBoundingClientRect().top, afterTop: after.getBoundingClientRect().top,
      headingLeft: before.querySelector('.diff-heading').getBoundingClientRect().left, summaryLeft: element.querySelector('summary').getBoundingClientRect().left,
      whiteSpace: getComputedStyle(pre).whiteSpace, pathWhiteSpace: getComputedStyle(path).whiteSpace,
      pathOverflow: getComputedStyle(path).overflowX, pathTextOverflow: getComputedStyle(path).textOverflow,
      pathTruncated: path.scrollWidth > path.clientWidth, scrolledCode: scroller.scrollLeft, scrolledPath: path.scrollLeft };
  });
  assert.ok(Math.abs(layout.beforeTop - layout.afterTop) < 1, 'Before and After headings align.');
  assert.ok(Math.abs(layout.headingLeft - layout.summaryLeft - 6) < 1, 'Diff content follows the same field padding.');
  assert.equal(layout.whiteSpace, 'pre'); assert.equal(layout.pathWhiteSpace, 'nowrap');
  assert.ok(layout.scrolledCode > 0, 'Long code lines scroll horizontally.');
  assert.equal(layout.pathOverflow, 'clip'); assert.equal(layout.pathTextOverflow, 'ellipsis');
  assert.ok(layout.pathTruncated, 'Long field paths are truncated to the available width.');
  assert.equal(layout.scrolledPath, 0, 'Field path rows cannot scroll horizontally.');
  const codePane = security().locator('[data-side="before"] .diff-code');
  await codePane.evaluate(element => element.scrollLeft = 0);
  await codePane.press('ArrowRight');
  await expect.poll(() => codePane.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await card.locator('.schema-history').screenshot({ path: `${this.artifactDirectory}/schema-history-mobile.png` });
  assert.deepEqual(await history(), integrated, 'Comparisons after conflict resolution remain read-only.');
});
