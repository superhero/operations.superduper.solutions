// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { setMode } from './workspace.fixture.mjs';
import { expandSchemaCard, revealSchemaCard, expectSchemaName } from './schema-card.fixture.mjs';
import { captureRevisionClose, captureRevisionOpen, traceRevisionClose } from './schema-revisions-motion.fixture.mjs';

Then('DigitalOcean revisions compare published security with retained token permissions', async function () {
  const page = this.page;
  await setMode(page, 'settings');
  await page.locator('summary[aria-label="Schemas"]').click();
  const card = await expandSchemaCard(page.locator('[data-schema-id="digitalocean"]'));
  await card.getByRole('button', { name: 'Schema revisions', exact: true }).click();
  const history = card.locator('.schema-history');
  await expect(history.locator('[data-version-oid]')).toHaveCount(2);
  await expect(history.getByText('Apply schema corrections: DigitalOcean bearer permissions', { exact: true })).toBeVisible();
  const diff = history.locator('.revision-diff');
  await expect(diff).toHaveAttribute('aria-busy', 'false');
  assert.notEqual(await diff.getAttribute('data-revision'), await diff.getAttribute('data-base'));
  await expect(diff.getByRole('combobox', { name: 'Base commit', exact: true })).toContainText('Import published schema: DigitalOcean');
  await expect(diff.getByRole('combobox', { name: 'Compare commit', exact: true })).toContainText('DigitalOcean bearer permissions');
  const group = diff.locator('.change-group').filter({ has: page.locator(':scope > summary strong', { hasText: 'Authentication' }) });
  await group.locator(':scope > summary').click();
  const permission = group.locator('.field-change').filter({ has: page.locator(':scope > summary code[title$="/x-credential-permissions"]') }).first();
  await permission.locator(':scope > summary').click();
  await expect(permission.locator('.field-content')).toHaveAttribute('aria-busy', 'false');
  await expect(permission.locator('[data-side="before"]')).toHaveCount(0);
  await expect(permission.locator('[data-side="after"] .diff-line.added').filter({ hasText: 'bearer_auth' })).toHaveCount(1);
  await expect(permission.locator('[data-side="after"]')).toContainText('action_gateway:read');
  await mkdir(this.artifactDirectory, { recursive: true });
  await card.screenshot({ path: `${this.artifactDirectory}/digitalocean-correction.png` });
});

Then('schema revisions open without flashing disabled comparison controls', async function () {
  const page = this.page;
  await setMode(page, 'settings');
  await page.locator('summary[aria-label="Schemas"]').click();
  const card = await expandSchemaCard(page.locator('[data-schema-id="cohere"]'));
  const toggle = card.getByRole('button', { name: 'Schema revisions', exact: true });
  const panel = card.locator('.schema-history > .reveal-panel');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const close = async () => {
    if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
    await expect(panel).toHaveAttribute('hidden', '');
    await expect(panel.locator('[data-version-oid]')).toHaveCount(0);
  };
  const samples = [];
  for (let sample = 0; sample < 3; sample++) {
    await close();
    samples.push(await captureRevisionOpen(panel, toggle));
  }
  await mkdir(this.artifactDirectory, { recursive: true });
  await close();
  const diagnostic = await traceRevisionClose(this.context, page, `${this.artifactDirectory}/revision-expand.chrome.json`,
    () => captureRevisionOpen(panel, toggle), 'expand');
  const report = { width: page.viewportSize().width, browser: this.browser.version(), motion: 'no-preference',
    source: 'cohere', samples, diagnostic,
    instrumentation: 'rAF geometry/computed-color reads; normal Playwright snapshots; CDP in separate diagnostic pass; routing disables HTTP cache' };
  await writeFile(`${this.artifactDirectory}/revision-expand.json`, JSON.stringify(report, null, 2));
  await this.attach(JSON.stringify(report), 'application/json');
  await card.locator('.schema-history').screenshot({ path: `${this.artifactDirectory}/revision-expand.png` });
  for (const sample of samples) {
    assert.ok(sample.ready, 'The initial comparison must finish loading.');
    const visible = sample.frames.filter(frame => frame.height > 0 && frame.controls.length);
    assert.ok(visible.length, 'Loaded comparison controls must become visible.');
    const final = visible.at(-1);
    for (const frame of visible) {
      assert.ok(frame.controls.every(control => !control.disabled), 'Initial comparison controls appear ready, without a disabled flash.');
      assert.deepEqual(frame.controls, final.controls, 'Comparison colors are correct from their first rendered frame.');
      assert.equal(frame.current, final.revision, 'The initial current revision is selected when its row first appears.');
    }
  }
});

Then('schema revisions close without collapsing their content early and support reversal and reduced motion', async function () {
  const page = this.page;
  await setMode(page, 'settings');
  await page.locator('summary[aria-label="Schemas"]').click();
  const card = await expandSchemaCard(page.locator('[data-schema-id="cohere"]'));
  const toggle = card.getByRole('button', { name: 'Schema revisions', exact: true });
  const panel = card.locator('.schema-history > .reveal-panel');
  const rows = panel.locator('[data-version-oid]');
  const open = async () => {
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await expect(panel.locator('.revision-diff[data-revision]')).toHaveAttribute('aria-busy', 'false');
    await expect.poll(() => panel.evaluate(element => element.getAnimations().length)).toBe(0);
    assert.ok(await rows.count());
  };
  await open();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(panel).toHaveCSS('transition-duration', '0.24s, 0s');
  const samples = [];
  for (let sample = 0; sample < 3; sample++) {
    await open();
    samples.push(await captureRevisionClose(panel, toggle));
  }
  await mkdir(this.artifactDirectory, { recursive: true });
  await open();
  const diagnostic = await traceRevisionClose(this.context, page, `${this.artifactDirectory}/revision-collapse.chrome.json`,
    () => captureRevisionClose(panel, toggle));
  const report = { width: page.viewportSize().width, browser: this.browser.version(), motion: 'no-preference',
    source: 'cohere', samples, diagnostic, instrumentation: 'rAF geometry/row reads; normal Playwright snapshots; CDP in separate diagnostic pass; routing disables HTTP cache' };
  await writeFile(`${this.artifactDirectory}/revision-collapse.json`, JSON.stringify(report, null, 2));
  await this.attach(JSON.stringify(report), 'application/json');
  for (const sample of samples) {
    assert.equal(sample.immediate.rows, sample.before.rows, 'Closing must retain outgoing revision rows until the slide ends.');
    assert.ok(sample.frames.some(frame => frame.height > 1 && frame.height < sample.before.height - 1), 'Closing has visible intermediate heights.');
    assert.ok(sample.frames.every(frame => frame.height < 1 || frame.rows === sample.before.rows), 'The body stays intact throughout the slide.');
    assert.ok(sample.frames.every(frame => Math.abs(frame.headerTop - sample.before.headerTop) < 1), 'The closing header stays in place.');
    assert.equal(sample.frames.at(-1).rows, 0, 'Closed revision content is released.');
  }

  // Pause real CSS transitions so reversal cannot race the test driver.
  await open();
  await panel.evaluate(element => {
    element.__holdRevisionSlide = new MutationObserver(() => {
      getComputedStyle(element).gridTemplateRows;
      for (const animation of element.getAnimations()) animation.pause();
    });
    element.__holdRevisionSlide.observe(element, { attributes: true, attributeFilter: ['class'] });
  });
  const halfway = () => panel.evaluate(async element => {
    const animation = element.getAnimations().find(item => item.transitionProperty === 'grid-template-rows');
    if (!animation) throw new Error('A real closing slide must be active.');
    await animation.ready;
    animation.currentTime = Number(animation.effect.getTiming().duration) / 2;
    await new Promise(resolve => requestAnimationFrame(resolve));
    return { height: element.getBoundingClientRect().height, rows: element.querySelectorAll('[data-version-oid]').length };
  });
  try {
    await toggle.click();
    const closing = await halfway();
    assert.ok(closing.height > 0 && closing.rows > 0);
    await toggle.click();
    await halfway();
    await panel.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
    await expect(panel.locator('.revision-diff[data-revision]')).toHaveAttribute('aria-busy', 'false');
    assert.ok(await rows.count(), 'A superseded close cannot clear reopened revisions.');
    await toggle.click();
    const repeated = await halfway();
    assert.ok(repeated.height > 0 && repeated.rows > 0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(rows).toHaveCount(0);
    await expect(panel).toHaveAttribute('hidden', '');
    assert.equal(await panel.evaluate(element => element.getAnimations().length), 0);
    await open();
    await toggle.press('Enter');
    await expect(rows).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await open();
    await card.getByRole('button', { name: /^Schema details:/ }).click();
    await expect(card.locator('.schema-history')).toHaveCount(0);
  } finally { await panel.evaluateAll(elements => elements.forEach(element => element.__holdRevisionSlide?.disconnect())); }
});

Then('schema name folders preserve keyboard access renaming disablement deletion and reload', async function () {
  const page = this.page;
  const open = async () => {
    await setMode(page, 'settings');
    const toggle = page.locator('summary[aria-label="Schemas"]');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const section = page.getByRole('region', { name: 'OpenAPI documents', exact: true });
    await expect(section).toHaveAttribute('aria-busy', 'false');
    return section;
  };
  let section = await open();
  const group = name => section.locator(`summary[aria-label=${JSON.stringify(`Schema group: ${name}`)}]`);
  const ids = new Map();
  for (const title of ['Tools / Files / First', 'Tools / Files / Second', 'Tools / Other']) {
    const document = { openapi: '3.1.0', info: { title, version: '1', description: `Description of ${title}` },
      servers: [{ url: 'https://tree.example.test' }], paths: { '/v1/unrelated/resource': {
        get: { operationId: 'list', tags: ['Ignored / Tag'], responses: { '200': { description: 'OK' } } },
      } } };
    await section.locator('input[type=file][aria-label="Upload OpenAPI document"]').setInputFiles({
      name: 'tree.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
    });
    const card = section.locator('.schema-card').filter({ has: page.locator(`.schema-name-label[aria-label=${JSON.stringify(`Open schema: ${title}`)}]`) });
    await expect(card).toHaveCount(1);
    ids.set(title, await card.getAttribute('data-schema-id'));
    await expect(section).toHaveAttribute('aria-busy', 'false');
  }
  const card = title => section.locator(`[data-schema-id="${ids.get(title)}"]`);
  const first = card('Tools / Files / First');
  const second = card('Tools / Files / Second');
  await expect(section.locator('.schema-list')).toHaveCount(1);
  await expect(section.locator('.schema-list .schema-toolbar')).toHaveCount(0);
  await expect(section.locator('.schema-toolbar').getByRole('button', { name: 'Upload OpenAPI document', exact: true })).toBeVisible();
  await expect(section.locator('[data-schema-group]')).toHaveCount(2);
  await expect(group('Tools')).toHaveAttribute('aria-expanded', 'false');
  await expect(group('Tools / Files')).toBeHidden();
  await expect(first).toBeHidden();
  await expect(section.locator('[data-schema-id="demo"]')).toBeVisible();
  await group('Tools').press('Enter');
  await expect(group('Tools / Files')).toBeVisible();
  await expect(group('Tools / Files')).toHaveAttribute('aria-expanded', 'false');
  await group('Tools / Files').press('Space');
  await expectSchemaName(first, 'Tools / Files / First');
  await expectSchemaName(second, 'Tools / Files / Second');
  await first.getByRole('switch').click();
  await expect(first.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(first).toBeVisible();
  await first.getByRole('button', { name: 'Open schema: Tools / Files / First', exact: true }).click();
  const name = first.getByRole('textbox', { name: 'Schema name', exact: true });
  await expect(name).toHaveValue('Tools / Files / First');
  await first.locator('.schema-disclosure > summary .schema-title').click();
  await expect(first.locator('.json-view')).toContainText('/v1/unrelated/resource');
  await name.fill('Moved / Things / Renamed');
  await name.press('Enter');
  await expect(first.getByRole('textbox', { name: 'Schema name', exact: true })).toHaveValue('Moved / Things / Renamed');
  await expect(group('Moved')).toHaveAttribute('aria-expanded', 'true');
  await expect(group('Moved / Things')).toHaveAttribute('aria-expanded', 'true');
  await expect(first.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(second).toBeVisible();
  await first.locator('.schema-disclosure > summary .schema-title').click();
  await expect(first.locator('.json-view')).toBeVisible();
  await group('Moved').press('Enter');
  await expect(first).toBeHidden();
  await expect(first.locator('.json-view')).toHaveCount(0);
  await group('Moved').press('Enter');
  await expect(group('Moved / Things')).toHaveAttribute('aria-expanded', 'false');
  await group('Moved / Things').press('Enter');
  await expectSchemaName(first, 'Moved / Things / Renamed');
  await expect(first.getByRole('button', { name: /^Schema details:/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(first.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expandSchemaCard(second);
  await second.getByRole('switch').click();
  await expect(second.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await second.getByRole('button', { name: 'Delete Tools / Files / Second', exact: true }).click();
  await second.getByRole('group', { name: 'Confirm deletion of Tools / Files / Second', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(second).toHaveCount(0);
  await expect(group('Tools / Files')).toHaveCount(0);
  await expectSchemaName(card('Tools / Other'), 'Tools / Other');
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  section = await open();
  await expect(group('Moved')).toHaveAttribute('aria-expanded', 'false');
  await revealSchemaCard(first);
  await expectSchemaName(first, 'Moved / Things / Renamed');
  await expect(first.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(second).toHaveCount(0);
  await group('Tools').press('Enter');
  await expect(section.locator('.schema-list')).toBeInViewport();
  const bounds = await section.locator('.schema-list').evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }));
  assert.ok(bounds.content <= bounds.width + 1, 'Nested folders fit the pane without horizontal overflow.');
  await mkdir(this.artifactDirectory, { recursive: true });
  await section.screenshot({ path: `${this.artifactDirectory}/schema-name-tree-${page.viewportSize().width}.png` });
});

Then('schema settings explain deletion restrictions and cancel confirmation when an upload is reactivated', async function () {
  const page = this.page;
  const open = async () => {
    await setMode(page, 'settings');
    const toggle = page.locator('summary[aria-label="Schemas"]');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    return page.getByRole('region', { name: 'OpenAPI documents', exact: true });
  };
  const panel = await open();
  const hoverDeletion = async (card, remove, message) => {
    // Revealing a card changes its height. Finish that motion, then scroll and
    // let its scroll event dismiss any old tooltip before entering the button.
    await card.evaluate(async element => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.allSettled(element.getAnimations({ subtree: true })
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished));
    });
    await remove.scrollIntoViewIfNeeded();
    await expect(remove).toBeInViewport();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.mouse.move(0, 0);
    await remove.hover();
    await expect(page.getByRole('tooltip')).toHaveText(message);
  };
  for (const id of ['demo', 'httpbin']) {
    const card = await expandSchemaCard(panel.locator(`[data-schema-id="${id}"]`));
    const remove = card.getByRole('button', { name: /^Delete / });
    await expect(remove).toBeDisabled();
    await hoverDeletion(card, remove, 'Default schemas cannot be deleted.');
    await card.getByRole('switch').click();
    await expect(card.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await expect(remove).toBeDisabled();
  }
  const title = 'Disposable uploaded schema';
  const document = { openapi: '3.1.0', info: { title, version: '1' },
    servers: [{ url: 'https://schema.example.test' }],
    paths: { '/items': { get: { operationId: 'list', responses: { '200': { description: 'OK' } } } } } };
  await panel.locator('input[type=file][aria-label="Upload OpenAPI document"]').setInputFiles({
    name: 'upload.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
  });
  const card = panel.locator('.schema-card').filter({ has: page.locator('.schema-name-label', { hasText: title }) });
  const id = await card.getAttribute('data-schema-id');
  const uploaded = panel.locator(`[data-schema-id="${id}"]`);
  await expandSchemaCard(uploaded);
  const remove = uploaded.getByRole('button', { name: `Delete ${title}`, exact: true });
  const enabled = uploaded.getByRole('switch');
  const confirmation = uploaded.getByRole('group', { name: `Confirm deletion of ${title}`, exact: true });
  await expect(remove).toBeDisabled();
  await hoverDeletion(uploaded, remove, 'Disable this schema before deleting it.');
  await enabled.click();
  await expect(enabled).toHaveAttribute('aria-checked', 'false');
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(confirmation).toBeVisible();
  await enabled.click();
  await expect(enabled).toHaveAttribute('aria-checked', 'true');
  await expect(confirmation).toHaveCount(0);
  await expect(remove).toBeDisabled();
  await enabled.click();
  await expect(remove).toBeEnabled();
  await expect(confirmation).toHaveCount(0);
  await remove.click();
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(uploaded).toBeVisible();
  await remove.click();
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(uploaded).toHaveCount(0);
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  await open();
  await expect(page.locator(`[data-schema-id="${id}"]`)).toHaveCount(0);
  for (const id of ['demo', 'httpbin']) {
    const card = await expandSchemaCard(page.locator(`[data-schema-id="${id}"]`));
    await expect(card.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await expect(card.getByRole('button', { name: /^Delete / })).toBeDisabled();
  }
});

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
  const expectCommitWeights = async container => {
    const hashes = await container.locator('.commit-hash').evaluateAll(elements => elements.map(element => getComputedStyle(element).fontWeight));
    const subjects = await container.locator('.commit-subject').evaluateAll(elements => elements.map(element => getComputedStyle(element).fontWeight));
    assert.ok(hashes.length && hashes.length === subjects.length, 'Each formatted commit includes a hash and description.');
    assert.ok(hashes.every(weight => weight === '400'), 'Commit hashes use regular weight.');
    assert.ok(subjects.every(weight => weight === '700'), 'Commit descriptions remain bold.');
  };
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
  await expectCommitWeights(selectors());
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
  await expect(security().locator('.diff-heading')).toHaveText(['Before', 'After']);
  await expect(security().locator('.diff-line.added').first()).toBeVisible();
  await expect(security().locator('.diff-line.removed').first()).toBeVisible();
  const backgrounds = await security().evaluate(element => ['.added', '.removed'].map(selector => getComputedStyle(element.querySelector(selector)).backgroundColor));
  assert.notEqual(backgrounds[0], backgrounds[1]);
  await provenance().locator('summary').click();
  await expect(provenance().locator('.diff-side')).toHaveCount(1);
  await expect(provenance().locator('.diff-side')).toHaveAttribute('data-side', 'after');
  await expect(provenance().locator('.diff-heading')).toHaveCount(0);
  await expect(provenance().locator('.diff-line.added').first()).toBeVisible();
  // Reversal is valid, including comparing the root against its descendants.
  await selectCommit('Base commit', corrected);
  await selectCommit('Compare commit', published);
  await expectComparison(published, corrected);
  if (await changes().locator('.change-group').getAttribute('open') === null) await changes().locator('.change-group > summary').click();
  await provenance().locator('summary').click();
  await expect(provenance().locator('.diff-side')).toHaveCount(1);
  await expect(provenance().locator('.diff-side')).toHaveAttribute('data-side', 'before');
  await expect(provenance().locator('.diff-heading')).toHaveCount(0);
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
  await expect(page.getByRole('region', { name: 'OpenAPI documents', exact: true })).toHaveAttribute('aria-busy', 'false');
  await expect(name).toHaveValue('My Speech API');
  // Three commits: a fresh disclosure must compare the actual root with latest,
  // including both the earlier correction and the later name change.
  if (await revisionsToggle().getAttribute('aria-expanded') === 'true') await revisionsToggle().click();
  await expect(changes()).toHaveCount(0);
  await revisionsToggle().click();
  const renamed = await history();
  await expectComparison(renamed.current, published);
  const optionOrders = [];
  for (const label of ['Base commit', 'Compare commit']) {
    const selector = changes().getByRole('combobox', { name: label, exact: true });
    await selector.click();
    await expect(page.getByRole('option')).toHaveCount(renamed.revisions.length);
    await expectCommitWeights(page.getByRole('option'));
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
