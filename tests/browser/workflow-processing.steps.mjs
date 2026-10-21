// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { createHmac } from 'node:crypto';
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { setMode, readExport, workflow } from './workspace.steps.mjs';
import { loadGraphFixture } from './workflow-graph.fixture.mjs';
import { defaultProcessingData } from '../../src/lib/workflow-processing.ts';
import { parseWorkflowFile } from '../../src/lib/workflow-file.ts';
import { operations } from '../../src/lib/catalog.ts';
import { catalogForOperation } from '../../src/lib/catalog-registry.ts';
import { createOperationGraph } from '../../src/lib/workflow-graph.ts';
import { gesture } from './workflow-single-input.steps.mjs';

const configuration = (kind, operation, parameters = {}) => {
  const value = defaultProcessingData(kind, operation);
  return { ...value, parameters: { ...value.parameters, ...parameters } };
};
const processor = (type, operation, parameters = {}, x = 500) => ({ id: type, type, position: { x, y: 300 }, data: configuration(type, operation, parameters) });
const source = value => ({ id: 'source', type: 'file', position: { x: 100, y: 300 }, data: { file: parseWorkflowFile('input.json', JSON.stringify(value)) } });
const connection = (source, target, sourceHandle = 'result', targetHandle = 'value') => ({ id: `${source}:${sourceHandle}:${target}:${targetHandle}`, kind: 'mapping', source, target, sourceHandle, targetHandle });
const document = (nodes, edges) => ({ version: 3, id: 'processing-browser', name: 'Processing browser', nodes, edges,
  viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: true, dashed: false });
const saved = async page => {
  await workflow(page).focus();
  await expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
};
const panel = page => page.getByRole('dialog', { name: 'Run workflow: Processing browser', exact: true });
async function choose(page, node, label, option) {
  await node.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

Then('reopening Transform with an offscreen selection keeps its first visible frame stable at vertical position {int}', async function (y) {
  const page = this.page;
  await setMode(page, 'workflow');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loadGraphFixture(page, document([{ ...processor('transform', 'jwt_sign'), position: { x: 20, y } }], []));
  const trigger = workflow(page).getByRole('combobox', { name: 'Transform operation', exact: true });
  const samples = [];
  // Warm reopens, after trigger hover settles, isolate selected-item placement.
  for (let attempt = 0; attempt < 3; attempt++) {
    await trigger.hover();
    await trigger.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))); });
    await page.evaluate(() => {
      window.__selectOpening = new Promise(resolve => {
        const frames = [];
        let started = false, remaining = 20;
        document.addEventListener('pointerdown', () => { started = true; }, { once: true, capture: true });
        function frame(time) {
          const content = document.querySelector('.workflow-node-select-options');
          const viewport = content?.querySelector('[data-select-viewport]');
          const selected = content?.querySelector('[aria-selected="true"]');
          if (started && content && viewport && selected) {
            const popup = content.getBoundingClientRect(), item = selected.getBoundingClientRect(), clip = viewport.getBoundingClientRect();
            if (popup.width && popup.height && popup.y >= 0 && popup.bottom <= innerHeight && getComputedStyle(content).visibility !== 'hidden')
              frames.push({ time, x: popup.x, y: popup.y, width: popup.width, height: popup.height, scroll: viewport.scrollTop,
                outerScroll: content.scrollTop, viewportY: clip.y - popup.y,
                item: item.y - clip.y, selectedVisible: item.top >= clip.top - 1 && item.bottom <= clip.bottom + 1,
                pageScroll: document.scrollingElement.scrollTop });
          }
          if (started && --remaining <= 0) resolve(frames); else requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      });
    });
    await trigger.click();
    const bounds = await page.locator('.workflow-node-select-options [data-select-viewport]').boundingBox();
    await page.mouse.move(bounds.x + 24, bounds.y + 1);
    samples.push(await page.evaluate(() => window.__selectOpening));
    await trigger.press('Escape');
  }
  await mkdir(this.artifactDirectory, { recursive: true });
  await writeFile(`${this.artifactDirectory}/select-opening-${process.env.SELECT_OPEN_PROFILE ?? 'regression'}.json`, JSON.stringify({ viewport: page.viewportSize(), samples }, null, 2));
  if (process.env.SELECT_OPEN_PROFILE) {
    // Separate attribution from the geometry samples; do not time this trace.
    const client = await page.context().newCDPSession(page);
    await client.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing', transferMode: 'ReturnAsStream' });
    await trigger.click();
    await expect(page.getByRole('option', { name: 'Sign JWT', exact: true })).toBeInViewport({ ratio: 0.9 });
    const bounds = await page.locator('.workflow-node-select-options [data-select-viewport]').boundingBox();
    await page.mouse.move(bounds.x + 24, bounds.y + 1);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const complete = new Promise(resolve => client.once('Tracing.tracingComplete', resolve));
    await client.send('Tracing.end');
    const { stream } = await complete;
    const chunks = [];
    while (true) {
      const chunk = await client.send('IO.read', { handle: stream });
      chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8'));
      if (chunk.eof) break;
    }
    await client.send('IO.close', { handle: stream });
    await writeFile(`${this.artifactDirectory}/select-opening-${process.env.SELECT_OPEN_PROFILE}.trace.json`, Buffer.concat(chunks));
    await client.detach();
    await trigger.press('Escape');
  }
  for (const frames of samples) {
    assert.ok(frames.length >= 2, 'Capture visible opening frames.');
    assert.ok(frames.every(frame => frame.selectedVisible), `The selected option must be visible from the first frame: ${JSON.stringify(frames)}`);
    assert.ok(frames.every(frame => frame.outerScroll === 0), `Only the option viewport may scroll: ${JSON.stringify(frames)}`);
    assert.equal(new Set(frames.map(frame => frame.scroll)).size, 1, 'Hovering must not change the option scroll offset.');
    for (const property of ['x', 'y', 'width', 'height', 'viewportY', 'item', 'pageScroll']) {
      const values = frames.map(frame => frame[property]);
      assert.ok(Math.max(...values) - Math.min(...values) <= 1, `Opening must not shift ${property}: ${JSON.stringify(frames)}`);
    }
  }
  await trigger.click();
  const viewport = page.locator('.workflow-node-select-options [data-select-viewport]');
  const label = await viewport.evaluate(element => {
    const top = element.getBoundingClientRect().top + 1;
    return [...element.querySelectorAll('[role="option"]')].find(option => {
      const bounds = option.getBoundingClientRect();
      return bounds.top <= top && bounds.bottom > top;
    })?.getAttribute('data-label');
  });
  assert.ok(label, 'A partly visible option remains clickable.');
  const bounds = await viewport.boundingBox();
  await page.mouse.click(bounds.x + 24, bounds.y + 1);
  await expect(trigger).toContainText(label);
});

Then('field mapping rows support editing nesting cancellation history and real execution', async function () {
  const page = this.page;
  await setMode(page, 'workflow');
  const input = { ...source({ profile: { name: 'Alice' }, members: [{ age: 0 }] }), position: { x: -500, y: 20 } };
  const mapping = { ...processor('transform', 'map_fields', { fields: '{"legacy":"/profile/name"}' }), position: { x: 20, y: 20 } };
  await loadGraphFixture(page, document([input, mapping], [connection('source', 'transform', 'value')]));
  const node = workflow(page).locator('[data-processing-kind="transform"]');
  await expect(node.locator('textarea')).toHaveCount(0);
  await expect(node.getByRole('list', { name: 'Field mappings' })).toContainText('profile › name');
  await node.getByRole('button', { name: 'Edit mapping legacy', exact: true }).click();
  await node.getByRole('textbox', { name: 'New field name', exact: true }).fill('Customer name');
  await node.getByRole('button', { name: 'Save mapping', exact: true }).click();
  await expect(node.getByRole('button', { name: 'Edit mapping Customer name', exact: true })).toBeVisible();

  await node.getByRole('button', { name: 'Add mapping', exact: true }).click();
  await node.getByRole('textbox', { name: 'New field name', exact: true }).fill('Customer name');
  await node.getByRole('textbox', { name: 'Source field 1', exact: true }).fill('members');
  await node.getByRole('button', { name: 'Add nested field', exact: true }).click();
  await node.getByRole('textbox', { name: 'Source field 2', exact: true }).fill('0');
  await node.getByRole('button', { name: 'Add nested field', exact: true }).click();
  await node.getByRole('textbox', { name: 'Source field 3', exact: true }).fill('age');
  await mkdir(this.artifactDirectory, { recursive: true });
  await node.screenshot({ path: `${this.artifactDirectory}/field-mapping-editor.png` });
  await node.getByRole('button', { name: 'Save mapping', exact: true }).click();
  await expect(node.getByRole('alert')).toHaveText('That new field name is already used. Choose a different name.');
  await node.getByRole('textbox', { name: 'New field name', exact: true }).fill('First age');
  await node.getByRole('textbox', { name: 'New field name', exact: true }).press('Enter');
  await expect(node.getByRole('button', { name: 'Edit mapping First age', exact: true })).toContainText('members › 0 › age');

  await node.getByRole('button', { name: 'Add mapping', exact: true }).click();
  await node.getByRole('textbox', { name: 'New field name', exact: true }).fill('Discard this draft');
  await choose(page, node, 'Copy from', 'Entire input');
  await expect(node.getByRole('textbox', { name: 'Source field 1', exact: true })).toHaveCount(0);
  await node.getByRole('textbox', { name: 'New field name', exact: true }).press('Escape');
  await expect(node.getByRole('button', { name: 'Add mapping', exact: true })).toBeFocused();
  await expect(node.getByRole('listitem')).toHaveCount(2);

  await node.getByRole('button', { name: 'Remove mapping First age', exact: true }).click();
  await saved(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(node.getByRole('button', { name: 'Edit mapping First age', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(node.getByRole('button', { name: 'Edit mapping First age', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  const exported = (await readExport(page)).document;
  assert.deepEqual(JSON.parse(exported.nodes.find(node => node.id === 'transform').data.parameters.fields),
    { 'Customer name': '/profile/name', 'First age': '/members/0/age' });
  await mkdir(this.artifactDirectory, { recursive: true });
  await node.screenshot({ path: `${this.artifactDirectory}/field-mappings.png` });
  await page.reload();
  await setMode(page, 'workflow');
  await expect(node.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  const run = panel(page);
  await expect(run.getByRole('heading', { name: 'Workflow complete.', exact: true })).toBeVisible();
  await run.getByText('Processing results (1)', { exact: true }).click();
  assert.deepEqual(JSON.parse(await run.getByRole('region', { name: 'Map fields result' }).locator('pre').textContent()),
    { 'Customer name': 'Alice', 'First age': 0 });
});

Then('long workflow dropdowns scroll inside their popup without moving the canvas', async function () {
  const page = this.page;
  await setMode(page, 'workflow');
  await page.getByRole('button', { name: 'Transform', exact: true }).click();
  const node = workflow(page).locator('[data-processing-kind="transform"]');
  const trigger = node.getByRole('combobox', { name: 'Transform operation', exact: true });
  const canvas = workflow(page).locator('.svelte-flow__viewport');
  await trigger.click();
  const list = page.getByRole('listbox', { name: 'Transform operation', exact: true });
  const viewport = list.locator('[data-select-viewport]');
  const geometry = await viewport.evaluate(element => ({
    height: element.clientHeight, scrollHeight: element.scrollHeight, scrollbar: getComputedStyle(element).scrollbarWidth,
    webkitScrollbar: CSS.supports('selector(::-webkit-scrollbar)') ? getComputedStyle(element, '::-webkit-scrollbar').display : undefined,
    outerHeight: element.parentElement.clientHeight, outerScrollHeight: element.parentElement.scrollHeight,
  }));
  assert.ok(geometry.height < geometry.scrollHeight, `The option viewport must own scrolling: ${JSON.stringify(geometry)}`);
  assert.notEqual(geometry.scrollbar, 'none', 'The popup must show a scrollbar.');
  assert.notEqual(geometry.webkitScrollbar, 'none', 'WebKit scrollbars must remain visible.');
  const bounds = await list.boundingBox(), size = page.viewportSize();
  assert.ok(bounds.height <= 320 && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= size.width && bounds.y + bounds.height <= size.height);
  await viewport.evaluate(element => { element.scrollTop = 0; });
  await viewport.hover({ position: { x: 24, y: 24 } });
  const initial = await viewport.evaluate(element => element.scrollTop);
  const before = await canvas.getAttribute('style');
  await page.mouse.wheel(0, 600);
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(initial);
  const last = list.getByRole('option', { name: 'Sign JWT', exact: true });
  await expect(last).toBeInViewport({ ratio: 0.9 });
  await expect(canvas).toHaveAttribute('style', before);
  await last.click();
  await expect(trigger).toContainText('Sign JWT');
  await trigger.press('Space');
  await trigger.press('Home');
  await trigger.press('Enter');
  await expect(trigger).toContainText('Encode UTF-8');
  await trigger.press('Space');
  await trigger.press('End');
  await trigger.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText('Encode UTF-8');
  await saved(page);
  assert.equal((await readExport(page)).document.nodes.find(node => node.type === 'transform').data.operation, 'utf8_encode');
});

Then('JWT shows signing key types and uses a connected Key ID with reversible manual editing', async function () {
  const page = this.page, key = '01234567890123456789012345678901';
  await setMode(page, 'workflow');
  const payload = { ...source({ sub: 'subject' }), position: { x: 100, y: 100 } };
  const signingKey = { ...source(key), id: 'signing-key', position: { x: 100, y: 350 } };
  const kid = { ...source('connected-id'), id: 'kid', position: { x: 100, y: 600 } };
  await loadGraphFixture(page, document([payload, signingKey, kid, processor('transform', 'jwt_sign', { key_id: 'manual-id' }, 600)],
    [connection('source', 'transform', 'value'), connection('signing-key', 'transform', 'value', 'key')]));
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  const jwt = workflow(page).locator('[data-processing-kind="transform"]');
  const input = jwt.getByLabel('Key ID (optional)', { exact: true });
  const handle = jwt.locator('.svelte-flow__handle[data-handleid="key_id"]');
  await expect(jwt.locator('.key-type')).toHaveText('Text | Binary');
  await expect(jwt.locator('.svelte-flow__handle[data-handleid="key"]')).toHaveAttribute('aria-label', 'Signing key input (Text | Binary)');
  await expect(handle).toHaveAttribute('aria-label', 'Key ID (optional) input (Text)');
  await expect(input).toBeEditable();
  await expect(input).toHaveValue('manual-id');
  await gesture(page, workflow(page).locator('.svelte-flow__node[data-id="kid"] .svelte-flow__handle.source'), handle);
  await expect(input).toBeDisabled();
  await saved(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(input).toBeEditable();
  await expect(input).toHaveValue('manual-id');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(input).toBeDisabled();
  await saved(page);
  const exported = (await readExport(page)).document;
  assert.equal(exported.nodes.find(node => node.id === 'transform').data.parameters.key_id, 'manual-id');
  assert.ok(exported.edges.some(edge => edge.target === 'transform' && edge.targetHandle === 'key_id'));
  await page.reload();
  await setMode(page, 'workflow');
  await expect(input).toBeDisabled();
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  const run = panel(page);
  await expect(run.getByRole('heading', { name: 'Workflow complete.', exact: true })).toBeVisible();
  await run.getByText('Processing results (1)', { exact: true }).click();
  const token = JSON.parse(await run.getByRole('region', { name: 'Sign JWT result' }).locator('pre').textContent());
  const [header, claims, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'HS256', typ: 'JWT', kid: 'connected-id' });
  assert.equal(signature, createHmac('sha256', key).update(`${header}.${claims}`).digest('base64url'));
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await choose(page, jwt, 'Transform operation', 'Sign HMAC-SHA256');
  await expect(handle).toHaveCount(0);
  await expect(jwt.locator('.key-type')).toHaveText('Text | Binary');
  await saved(page);
  assert.ok(!(await readExport(page)).document.edges.some(edge => edge.targetHandle === 'key_id'));
});

Then('Select field is offered by Filter and old Transform nodes restore and execute as Filter', async function () {
  const page = this.page;
  await setMode(page, 'workflow');
  await loadGraphFixture(page, document([processor('transform', 'base64_encode')], []));
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  const transform = workflow(page).locator('[data-processing-kind="transform"]');
  await transform.getByRole('combobox', { name: 'Transform operation', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Select field', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  const filter = workflow(page).locator('[data-processing-kind="filter"]');
  await choose(page, filter, 'Filter operation', 'Select field');
  await expect(filter.locator('.utility-title .utility-type')).toHaveText('Object | Array');
  await expect(filter.locator('.svelte-flow__handle.target')).toHaveAttribute('aria-label', 'Filter input (Object | Array)');
  const legacy = document([source({ profile: { name: 'Alice' } }), processor('transform', 'select_field', { path: '/profile/name' })],
    [connection('source', 'transform', 'value')]);
  await loadGraphFixture(page, legacy);
  await expect(transform).toHaveCount(0);
  await expect(filter.getByRole('combobox', { name: 'Filter operation', exact: true })).toContainText('Select field');
  const exported = (await readExport(page)).document;
  assert.deepEqual(exported.nodes.find(node => node.id === 'transform'), { ...legacy.nodes[1], type: 'filter' });
  assert.deepEqual(exported.edges, legacy.edges);
  await page.reload();
  await setMode(page, 'workflow');
  await expect(filter.getByLabel('Field path (JSON pointer)', { exact: true })).toHaveValue('/profile/name');
  await expect(filter.locator('.output-type')).toHaveText('Text');
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  const run = panel(page);
  await expect(run.getByRole('heading', { name: 'Workflow complete.', exact: true })).toBeVisible();
  await run.getByText('Processing results (1)', { exact: true }).click();
  await expect(run.getByRole('region', { name: 'Select field result' })).toContainText('"Alice"');
  await expect(run.getByRole('alert')).toHaveCount(0);
});

Then('Parse JSON restores without a type selector and connects directly to a matching input', async function () {
  const page = this.page;
  await setMode(page, 'workflow');
  await loadGraphFixture(page, document([source(JSON.stringify('  hello  ')), processor('transform', 'json_parse', { type: 'Object' }),
    processor('filter', 'trim', {}, 900)], [connection('source', 'transform', 'value')]));
  const transform = workflow(page).locator('[data-processing-kind="transform"]');
  const filter = workflow(page).locator('[data-processing-kind="filter"]');
  const output = transform.locator('.svelte-flow__handle.source');
  const badge = transform.locator('.output-type');
  const label = 'JsonValue';
  await expect(transform.getByRole('combobox', { name: 'Result type', exact: true })).toHaveCount(0);
  await expect(badge).toHaveText(label);
  await expect(output).toHaveAttribute('aria-label', `Transform result (${label})`);
  await saved(page);
  assert.deepEqual((await readExport(page)).document.nodes.find(node => node.type === 'transform').data.parameters, {});
  await page.reload();
  await setMode(page, 'workflow');
  await expect(badge).toHaveText(label);
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  const fits = await badge.evaluate(element => {
    const badge = element.getBoundingClientRect(), card = element.closest('.workflow-processing-node').getBoundingClientRect();
    return badge.left >= card.left && badge.right <= card.right;
  });
  assert.equal(fits, true, 'Known type alternatives remain inside the processing card.');
  await gesture(page, output, filter.locator('.svelte-flow__handle.target'));
  await expect(filter.locator('.svelte-flow__handle.target')).toHaveAttribute('aria-disabled', 'true');
  await saved(page);
  const exported = (await readExport(page)).document;
  assert.equal(exported.nodes.some(node => node.type === 'cast'), false);
  assert.ok(exported.edges.some(edge => edge.source === 'transform' && edge.target === 'filter'));
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  const run = panel(page);
  await expect(run.getByRole('heading', { name: 'Workflow complete.', exact: true })).toBeVisible();
  await run.getByText('Processing results (2)', { exact: true }).click();
  await expect(run.getByRole('region', { name: 'Trim text result' })).toContainText('"hello"');
  await expect(run.getByRole('alert')).toHaveCount(0);
});

Then('Transform input labels follow its selected operation before any connection', async function () {
  const page = this.page;
  await setMode(page, 'workflow');
  await page.getByRole('button', { name: 'Transform', exact: true }).click();
  const transform = workflow(page).locator('[data-processing-kind="transform"]');
  const badge = transform.locator('.utility-title .utility-type');
  const handle = transform.locator('.utility-title .svelte-flow__handle.target');
  await expect(badge).toHaveText('Text | Binary');
  for (const [operation, expected] of [
    ['Decode UTF-8', 'Binary'], ['Parse JSON', 'Text'],
    ['Sign JWT', 'Object'], ['Serialize JSON', 'JSON'], ['Encode Base64', 'Text | Binary']
  ]) {
    await choose(page, transform, 'Transform operation', operation);
    await expect(badge).toHaveText(expected);
    await expect(handle).toHaveAttribute('aria-label', `Transform input (${expected})`);
  }
  await saved(page);
  assert.equal((await readExport(page)).document.edges.length, 0);
  await page.reload();
  await setMode(page, 'workflow');
  await expect(badge).toHaveText('Text | Binary');
});

Then('Stop can be added undone exported and restored with only an input', async function () {
  const page = this.page;
  await setMode(page, 'workflow');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const stop = workflow(page).locator('.workflow-stop-node');
  await expect(stop).toBeVisible();
  await expect(stop.locator('.svelte-flow__handle.target')).toHaveCount(1);
  await expect(stop.locator('.svelte-flow__handle.source')).toHaveCount(0);
  await saved(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(stop).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(stop).toBeVisible();
  await saved(page);
  const exported = (await readExport(page)).document;
  assert.deepEqual(exported.nodes.find(node => node.type === 'stop').data, {});
  await page.reload();
  await setMode(page, 'workflow');
  await expect(stop).toBeVisible();
  assert.equal((await readExport(page)).document.nodes.filter(node => node.type === 'stop').length, 1);
});

Then(/^Stop connected to assertion Failure (ends|preserves) the run without an error$/, async function (outcome) {
  const page = this.page;
  await setMode(page, 'workflow');
  let requests = 0;
  await page.route('https://example.com/**', async route => {
    requests++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  const operation = operations.find(operation => operation.id === 'demo:mockPlainText');
  const graph = createOperationGraph(operation, { x: 1200, y: 300 }, 'target', catalogForOperation(operation.id).document);
  const input = graph.nodes.find(node => node.type === 'data' && node.data.direction === 'inputs' && node.data.fields.some(field => field.connectable && field.type === 'Text'));
  const handle = input.data.fields.find(field => field.connectable && field.type === 'Text').id;
  const stop = { id: 'stop', type: 'stop', position: { x: 900, y: 100 }, data: {} };
  await loadGraphFixture(page, document([source('original'), processor('assert', 'expect', { operator: 'equals', expected: outcome === 'ends' ? 'other' : 'original' }), stop, ...graph.nodes],
    [connection('source', 'assert', 'value'), connection('assert', 'stop', 'failure'), connection('assert', input.id, 'success', handle), ...graph.edges]));
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  const run = panel(page);
  if (outcome === 'ends') {
    await expect(run.getByRole('heading', { name: 'Workflow stopped.', exact: true })).toBeVisible();
    await expect(run.getByRole('button', { name: 'Start workflow', exact: true })).toHaveCount(0);
    assert.equal(requests, 0);
  } else {
    const field = run.locator('form').getByRole('textbox').first();
    await expect(field).toHaveValue('original');
    await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
    await expect(run.getByText('Operation completed.', { exact: true })).toBeVisible();
    await run.getByRole('button', { name: 'Next operation', exact: true }).click();
    await expect(run.getByRole('heading', { name: 'Workflow complete.', exact: true })).toBeVisible();
    assert.equal(requests, 1);
  }
  await expect(run.getByRole('alert')).toHaveCount(0);
});

Then('Transform Filter and Assert can be configured undone exported and restored', async function () {
  const page = this.page;
  await setMode(page, 'workflow');
  await page.getByRole('button', { name: 'Transform', exact: true }).click();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  const transform = workflow(page).locator('[data-processing-kind="transform"]');
  const filter = workflow(page).locator('[data-processing-kind="filter"]');
  const assertion = workflow(page).locator('[data-processing-kind="assert"]');
  await choose(page, transform, 'Transform operation', 'Hash SHA-256');
  await expect(transform.locator('.utility-title strong')).toHaveText('Hash SHA-256');
  await saved(page);
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await choose(page, filter, 'Filter operation', 'Substring');
  await filter.getByLabel('Start (inclusive)', { exact: true }).fill('1');
  await filter.getByLabel('End (exclusive)', { exact: true }).fill('3');
  await saved(page);
  // Expanding a placed card preserves its position. Move it as a user would
  // before adding its neighbour, then verify the saved layout after reload.
  if (page.viewportSize().width >= 1000) {
    const title = await filter.locator('.utility-title').boundingBox();
    await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
    await page.mouse.down();
    await page.mouse.move(title.x + title.width / 2 - 340, title.y + title.height / 2, { steps: 8 });
    await page.mouse.up();
    await saved(page);
  }
  await page.getByRole('button', { name: 'Assert', exact: true }).click();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await expect(assertion.getByLabel('Expected value', { exact: true })).toHaveCount(0);
  await choose(page, assertion, 'Condition', 'Equals');
  await expect(assertion.getByLabel('Expected value', { exact: true })).toBeEnabled();
  await saved(page);
  await assertion.getByLabel('Expected value', { exact: true }).fill('abc');
  await saved(page);
  let exported = (await readExport(page)).document;
  assert.deepEqual(exported.nodes.filter(node => ['transform', 'filter', 'assert'].includes(node.type)).map(node => node.type).sort(), ['assert', 'filter', 'transform']);
  assert.equal(exported.nodes.find(node => node.type === 'filter').data.parameters.end, '3');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(assertion.getByLabel('Expected value', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(assertion.getByLabel('Expected value', { exact: true })).toHaveValue('abc');
  await saved(page);
  await page.reload();
  await setMode(page, 'workflow');
  await expect(workflow(page).locator('[data-processing-kind]')).toHaveCount(3);
  exported = (await readExport(page)).document;
  assert.equal(exported.nodes.find(node => node.type === 'assert').data.parameters.expected, 'abc');
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  const positions = exported.nodes.map(node => ({ id: node.id, position: node.position }));
  assert.deepEqual(positions, (await readExport(page)).document.nodes.map(node => ({ id: node.id, position: node.position })));
  await mkdir(this.artifactDirectory, { recursive: true });
  await workflow(page).screenshot({ path: `${this.artifactDirectory}/processing-nodes.png` });
});

Then('a file filter transform and assertion complete without an HTTP operation or leaked worker', async function () {
  const page = this.page;
  await setMode(page, 'workflow');
  await page.evaluate(() => {
    const NativeWorker = window.Worker;
    window.__processingWorkers = [];
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (options?.name === 'workflow-processing') { this.record = { calls: 0, terminated: 0 }; window.__processingWorkers.push(this.record); }
      }
      postMessage(message, ...args) { if (this.record && message?.kind === 'request') this.record.calls++; return super.postMessage(message, ...args); }
      terminate() { if (this.record) this.record.terminated++; return super.terminate(); }
    };
  });
  await loadGraphFixture(page, document([source('  abc  '), processor('filter', 'trim', {}, 500), processor('transform', 'base64_encode', {}, 900),
    processor('assert', 'expect', { operator: 'equals', expected: 'YWJj' }, 1300)],
  [connection('source', 'filter', 'value'), connection('filter', 'transform'), connection('transform', 'assert')]));
  await expect(workflow(page).locator('[data-processing-kind="transform"] .utility-title .utility-type')).toHaveText('Text | Binary');
  await expect(workflow(page).locator('[data-processing-kind="assert"] .utility-title .utility-type')).toHaveText('Text');
  assert.equal(await page.evaluate(() => window.__processingWorkers.length), 0);
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  const run = panel(page);
  await expect(run.getByRole('heading', { name: 'Workflow complete.', exact: true })).toBeVisible();
  await run.getByText('Processing results (3)', { exact: true }).click();
  await expect(run.getByRole('region', { name: 'Encode Base64 result' })).toContainText('YWJj');
  await expect(run.getByText('Assert · Success', { exact: true })).toBeVisible();
  await expect(run.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__processingWorkers)).toEqual([{ calls: 3, terminated: 1 }]);
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
});

Then('the real vault worker checks a private transformation without returning its value', async function () {
  const result = await this.page.evaluate(async () => {
    const fixture = await import('/vault-storage-fixture.js');
    return fixture.checkProcessingAssertion();
  });
  assert.deepEqual(result, { matched: true, unmatched: false, jwtKeyId: true, manualKeyId: false });
  assert.ok(!JSON.stringify(result).includes('private-processing-browser-canary'));
});

Then(/^an assertion with a (failure|success) connection proceeds with its original value or manual input$/, async function (output) {
  const page = this.page;
  await setMode(page, 'workflow');
  const operation = operations.find(operation => operation.id === 'demo:mockPlainText');
  const graph = createOperationGraph(operation, { x: 1000, y: 300 }, 'target', catalogForOperation(operation.id).document);
  const input = graph.nodes.find(node => node.type === 'data' && node.data.direction === 'inputs' && node.data.fields.some(field => field.connectable && field.type === 'Text'));
  const handle = input.data.fields.find(field => field.connectable && field.type === 'Text').id;
  let sent;
  await page.route('https://example.com/**', async route => {
    sent = route.request().postData();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await loadGraphFixture(page, document([source('original'), processor('assert', 'expect', { operator: 'equals', expected: 'other' }), ...graph.nodes],
    [connection('source', 'assert', 'value'), connection('assert', input.id, output, handle), ...graph.edges]));
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  const run = panel(page), field = run.locator('form').getByRole('textbox').first();
  await expect(field).toBeVisible();
  if (output === 'failure') { await expect(field).toHaveValue('original'); await expect(field).not.toBeEditable(); }
  else { await expect(field).toBeEditable(); await field.fill('Manual fallback'); }
  await expect(run.getByRole('alert')).toHaveCount(0);
  await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  await expect(run.getByText('Operation completed.', { exact: true })).toBeVisible();
  assert.equal(sent, output === 'failure' ? 'original' : 'Manual fallback');
  await run.getByRole('button', { name: 'Next operation', exact: true }).click();
  await expect(run.getByRole('heading', { name: 'Workflow complete.', exact: true })).toBeVisible();
});
