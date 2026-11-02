// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import example from '../../examples/workflow-charts.json' with { type: 'json' };
import expandedExample from '../../examples/workflow-charts-expanded.json' with { type: 'json' };
import { extractOperations } from '../../src/lib/catalog.ts';
import { createOperationGraph } from '../../src/lib/workflow-graph.ts';
import { defaultChartData } from '../../src/lib/workflow-chart.ts';
import { loadGraphFixture } from './workflow-graph.fixture.mjs';
import { storedWorkflows } from './workflow-storage.fixture.mjs';
import { chooseCatalogOperation, setMode, workflowAction } from './workspace.fixture.mjs';

const runDialog = page => page.getByRole('dialog', { name: /^Run workflow:/ });
Then('the chart example renders seven run views with multiple series and a table', async function () {
  const page = this.page;
  await setMode(page, 'workflow'); await loadGraphFixture(page, example);
  await expect(page.locator('.svelte-flow__node-chart')).toHaveCount(7);
  await expect(page.locator('.chart-view')).toHaveCount(0);
  await workflowAction(page, 'Run');
  const run = runDialog(page);
  const dialogBounds = await run.boundingBox(), viewport = page.viewportSize();
  assert.ok(dialogBounds.width > viewport.width * 0.9 && dialogBounds.height > viewport.height * 0.9);
  await expect(run.getByRole('tab', { name: 'Forms', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(run.getByRole('heading', { name: 'Workflow complete.', exact: true })).toBeVisible();
  await expect(run.getByRole('tab')).toHaveCount(8);
  await mkdir(this.artifactDirectory, { recursive: true });
  for (const kind of ['line', 'bar', 'pie', 'area', 'scatter', 'sankey', 'table']) {
    const name = kind[0].toUpperCase() + kind.slice(1);
    await run.getByRole('tab', { name, exact: true }).click();
    const view = run.locator(`[data-chart-kind="${kind}"]`);
    await expect(view).toBeVisible();
    await expect(view).toHaveAttribute('data-point-count', kind === 'sankey' ? '2' : kind === 'table' || kind === 'pie' ? '12' : '24');
    if (kind === 'table') {
      await expect(view.getByRole('table', { name: 'Table', exact: true })).toBeVisible();
      await expect(view.getByRole('columnheader', { name: 'CPU', exact: true })).toBeVisible();
      await expect(view.getByRole('row')).toHaveCount(13);
    } else await expect(view.locator('svg')).toBeVisible();
    if (['line', 'area', 'bar'].includes(kind)) await expect(view).toHaveAttribute('data-series-count', '2');
    if (kind === 'line') await page.screenshot({ path: `${this.artifactDirectory}/workflow-line-tabs.png` });
  }
  await mkdir(this.artifactDirectory, { recursive: true });
  await page.screenshot({ path: `${this.artifactDirectory}/workflow-view-tabs.png` });
  await run.getByRole('tab', { name: 'Table', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(run.getByRole('tab', { name: 'Forms', exact: true })).toBeFocused();
  await page.keyboard.press('End'); await expect(run.getByRole('tab', { name: 'Table', exact: true })).toBeFocused();
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
  const saved = (await storedWorkflows(page))[0];
  for (const node of saved.nodes.filter(node => node.type === 'chart')) {
    assert.equal(Object.hasOwn(node.data, 'rows'), false);
    assert.equal(node.data.series.some(series => Object.hasOwn(series, 'points')), false);
  }
});
Then('changing a chart to Sankey replaces series ports with nodes and links', async function () {
  const page = this.page;
  await setMode(page, 'workflow'); await loadGraphFixture(page, example);
  const node = page.locator('.svelte-flow__node[data-id="chart-line"]');
  await node.click(); await node.getByRole('combobox', { name: 'Chart view', exact: true }).click();
  await page.getByRole('option', { name: 'Sankey', exact: true }).click();
  await expect(node.locator('.svelte-flow__handle[data-handleid="nodes"]')).toHaveCount(1);
  await expect(node.locator('.svelte-flow__handle[data-handleid="links"]')).toHaveCount(1);
  await expect(node.locator('.svelte-flow__handle[data-handleid="cpu"]')).toHaveCount(0);
  await expect.poll(async () => (await storedWorkflows(page))[0].nodes.find(node => node.id === 'chart-line').data.kind).toBe('sankey');
  const saved = (await storedWorkflows(page))[0];
  assert.equal(saved.edges.some(edge => edge.target === 'chart-line'), false);
});
Then('a streamed workflow preserves forms across tabs and cancels its request on quit', async function () {
  const page = this.page, id = randomUUID(), path = `/monitoring-fixture/${id}/samples`, summary = 'Watch measurements';
  const streamOperation = {
    operationId: 'samples', summary, 'x-operations-response-stream': 'ndjson',
    parameters: [{ name: 'label', in: 'query', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Measurements', content: {
      'application/json': { schema: { type: 'object', properties: { cpu: { type: 'number' }, memory: { type: 'number' } } } },
      'application/x-ndjson': { schema: { type: 'object' } }
    } } }
  };
  const schema = { openapi: '3.1.0', info: { title: 'Live measurements', version: '1' },
    servers: [{ url: this.baseURL }], paths: { [path]: { get: streamOperation }, [`/monitoring-fixture/${id}/submit`]: { post: {
      operationId: 'submit', summary: 'Confirm selection', parameters: [{ name: 'previous', in: 'query', schema: { type: 'number' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['label'], properties: { label: { type: 'string' } } } } } },
      responses: { 200: { description: 'Accepted', content: { 'application/json': { schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } } } } }
    } } } };
  await setMode(page, 'settings');
  const schemas = page.locator('summary[aria-label="Schemas"]');
  if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({ name: 'live-measurements.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(schema)) });
  await expect(page.getByRole('switch', { name: 'Enable Live measurements', exact: true })).toHaveAttribute('aria-checked', 'true');
  await chooseCatalogOperation(page, summary, 'workflow'); await setMode(page, 'workflow');
  await chooseCatalogOperation(page, 'Confirm selection', 'workflow');
  await expect.poll(async () => (await storedWorkflows(page))[0]?.nodes.some(node => node.type === 'operation')).toBe(true);
  const original = { ...(await storedWorkflows(page))[0], version: 3, description: '' };
  for (const fieldName of ['cpu', 'memory']) {
    const output = original.nodes.find(node => node.type === 'data' && node.data.direction === 'outputs' && node.data.fields.some(field => field.label === fieldName));
    assert.ok(output, `Expected ${fieldName} output`);
    const handle = output.data.fields.find(field => field.label === fieldName).id;
    const target = 'live-' + fieldName;
    original.nodes.push({ id: target, type: 'chart', position: { x: 800, y: fieldName === 'cpu' ? 0 : 500 }, data: { ...defaultChartData(), title: fieldName.toUpperCase(), maxPoints: 5 } });
    original.edges.push({ id: target + '-edge', kind: 'mapping', source: output.id, sourceHandle: handle, target, targetHandle: 'value' });
  }
  const source = original.nodes.find(node => node.type === 'data' && node.data.direction === 'outputs' && node.data.fields.some(field => field.label === 'cpu'));
  const next = original.nodes.find(node => node.type === 'operation' && node.data.name === 'Confirm selection');
  const nextInput = original.nodes.find(node => node.type === 'data' && node.data.ownerId === next.id && node.data.direction === 'inputs' && node.data.fields.some(field => field.label === 'previous'));
  original.edges.push({ id: 'continue-with-first-sample', kind: 'mapping', source: source.id, sourceHandle: source.data.fields.find(field => field.label === 'cpu').id,
    target: nextInput.id, targetHandle: nextInput.data.fields.find(field => field.label === 'previous').id });
  await loadGraphFixture(page, original); await workflowAction(page, 'Run');
  const run = runDialog(page), input = run.getByRole('textbox', { name: 'label', exact: true });
  await input.fill('keep this value');
  await run.getByRole('tab', { name: 'CPU', exact: true }).click();
  await expect(run.getByText('Waiting for connected workflow data…', { exact: true })).toBeVisible();
  await run.getByRole('tab', { name: 'Forms', exact: true }).click(); await expect(input).toHaveValue('keep this value');
  await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  for (const name of ['CPU', 'MEMORY', 'CPU']) {
    await run.getByRole('tab', { name, exact: true }).click();
    await expect(run.locator('.chart-view')).toHaveAttribute('data-point-count', '5');
    await expect(run.locator('.chart-view svg')).toBeVisible();
  }
  const status = async () => (await this.context.request.get(`${this.baseURL}/monitoring-fixture/${id}/status`)).json();
  const before = await status(); assert.equal(before.requests, 1); assert.equal(before.active, 1);
  await run.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await run.getByRole('button', { name: 'Pause updates', exact: true }).click();
  const values = () => run.locator('.chart-plot').getAttribute('aria-label');
  await expect(run.locator('.chart-view')).toHaveAttribute('data-paused', 'true');
  const frozen = await values();
  assert.match(frozen, /The data is as follows:/, 'The accessible chart description includes its rendered values');
  await expect.poll(async () => (await status()).samples).toBeGreaterThan(before.samples + 2);
  assert.equal(await values(), frozen);
  await run.getByRole('tab', { name: 'MEMORY', exact: true }).click();
  await run.getByRole('tab', { name: 'CPU', exact: true }).click();
  await expect(run.locator('.chart-view')).toHaveAttribute('data-paused', 'true');
  await expect(run.locator('.chart-view')).toHaveAttribute('data-zoom-level', '150');
  await run.getByRole('button', { name: 'Resume updates', exact: true }).click();
  await expect.poll(values).not.toBe(frozen);
  await run.getByRole('tab', { name: 'Forms', exact: true }).click(); await expect(input).toHaveValue('keep this value');
  await expect(run.getByRole('button', { name: 'Stop stream Watch measurements', exact: true })).toBeVisible();
  await run.getByRole('button', { name: 'Next operation', exact: true }).click();
  await run.getByRole('textbox', { name: 'label', exact: true }).fill('submitted while streaming');
  await run.getByRole('button', { name: 'Run operation', exact: true }).click();
  await expect(run.getByText('Operation completed.', { exact: true })).toBeVisible();
  const submitted = await status(); assert.equal(submitted.forms, 1); assert.equal(submitted.lastLabel, 'submitted while streaming'); assert.equal(submitted.active, 1);
  assert.equal(submitted.lastPrevious, '1');
  await run.getByRole('button', { name: 'Next operation', exact: true }).click();
  await expect(run.getByRole('heading', { name: 'Workflow complete.', exact: true })).toBeVisible();
  await run.getByRole('tab', { name: 'CPU', exact: true }).click();
  const pathBefore = await run.locator('.chart-view svg path').evaluateAll(paths => paths.map(path => path.getAttribute('d')).join('|'));
  await expect.poll(() => run.locator('.chart-view svg path').evaluateAll(paths => paths.map(path => path.getAttribute('d')).join('|'))).not.toBe(pathBefore);
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
  await expect.poll(async () => (await status()).active).toBe(0);
  assert.equal((await status()).requests, 1);
});

Then('invalid chart values remain local while zero slices and table text have honest displays', async function () {
  const page = this.page, document = structuredClone(example);
  const samples = document.nodes.find(node => node.id === 'samples');
  samples.data.file.value = [{ time: 0, cpu: 'invalid', memory: 4, label: '<img src=x onerror=alert(1)>' }];
  samples.data.file.source = JSON.stringify(samples.data.file.value);
  const zeros = structuredClone(samples); zeros.id = 'zeros'; zeros.data.file.value = [0, 0]; zeros.data.file.source = '[0,0]';
  document.nodes.push(zeros);
  const pie = document.nodes.find(node => node.id === 'chart-pie'); pie.data.xPath = ''; pie.data.yPath = '';
  document.edges = document.edges.filter(edge => edge.target !== pie.id);
  document.edges.push({ id: 'zero-pie', kind: 'mapping', source: zeros.id, sourceHandle: 'value', target: pie.id, targetHandle: 'value' });
  document.nodes.find(node => node.id === 'chart-table').data.columns.push({ id: 'text', label: 'Text', path: '/label' });
  await setMode(page, 'workflow'); await loadGraphFixture(page, document); await workflowAction(page, 'Run');
  const run = runDialog(page);
  await expect(run.getByRole('heading', { name: 'Workflow complete.', exact: true })).toBeVisible();
  await run.getByRole('tab', { name: 'Line', exact: true }).click();
  await expect(run.getByRole('alert')).toContainText('CPU: The value field must contain finite numbers');
  await run.getByRole('tab', { name: 'Pie', exact: true }).click();
  await expect(run.getByText('No positive slice values to display.', { exact: true })).toBeVisible();
  await run.getByRole('tab', { name: 'Table', exact: true }).click();
  await expect(run.getByRole('cell', { name: '<img src=x onerror=alert(1)>', exact: true })).toBeVisible();
  await expect(run.locator('table img')).toHaveCount(0);
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
});

async function chartPaints(view) {
  return view.locator('svg').evaluate(svg => {
    const probe = document.createElement('span'); document.body.append(probe);
    const normalized = value => {
      if (!value || value === 'none' || value.startsWith('url(')) return null;
      probe.style.color = ''; probe.style.color = value;
      if (!probe.style.color) throw new Error(`Unresolved paint ${value}`);
      const channels = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number);
      if (channels.length > 3 && channels[3] === 0) return null;
      return channels.slice(0, 3).join(',');
    };
    try {
      const tones = Array.from({ length: 6 }, (_, index) => normalized(getComputedStyle(svg).getPropertyValue(`--tone-${index + 1}`).trim()));
      const allowed = color => {
        const actual = color.split(',').map(Number);
        return tones.some(a => tones.some(b => {
          const start = a.split(',').map(Number), end = b.split(',').map(Number);
          const axis = start.reduce((best, value, index) => Math.abs(value - end[index]) > Math.abs(start[best] - end[best]) ? index : best, 0);
          if (Math.abs(start[axis] - end[axis]) <= 1) return actual.every((value, index) => Math.abs(value - start[index]) <= 1);
          const weight = (actual[axis] - start[axis]) / (end[axis] - start[axis]);
          return weight >= 0 && weight <= 1 && actual.every((value, index) => Math.abs(value - (start[index] + weight * (end[index] - start[index]))) <= 1.1);
        }));
      };
      const paints = new Set(), details = [];
      for (const element of svg.querySelectorAll('path,rect,circle,polygon,line,text')) {
        if (element.closest('clipPath,mask')) continue;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
        const bounds = element.getBBox();
        const values = [element.localName === 'line' || !bounds.width || !bounds.height || Number(style.fillOpacity) === 0 ? null : style.fill,
          parseFloat(style.strokeWidth) === 0 || Number(style.strokeOpacity) === 0 ? null : style.stroke];
        for (const value of values) {
          const color = normalized(value);
          if (color) { paints.add(color); if (!allowed(color)) details.push({ color, tag: element.localName, html: element.outerHTML.slice(0, 250) }); }
        }
      }
      return { tones, paints: [...paints], foreign: details.slice(0, 8) };
    } finally { probe.remove(); }
  });
}
Then('chart marks and tooltips use theme colors across views and live theme changes', async function () {
  const page = this.page;
  await setMode(page, 'workflow'); await loadGraphFixture(page, example); await workflowAction(page, 'Run');
  const run = runDialog(page);
  for (const palette of ['blue-horizon', 'sunflower']) for (const dark of [true, false]) {
    await page.evaluate(({ palette, dark }) => {
      document.documentElement.dataset.palette = palette; document.documentElement.dataset.theme = dark ? 'dark' : 'light'; document.documentElement.classList.toggle('dark', dark);
    }, { palette, dark });
    for (const name of ['Line', 'Bar', 'Area', 'Scatter', 'Pie', 'Sankey']) {
      await run.getByRole('tab', { name, exact: true }).click();
      const view = run.locator('.chart-view'); await expect(view.locator('svg')).toBeVisible();
      if (name === 'Pie') {
        const plot = view.locator('.chart-plot'), box = await plot.boundingBox();
        await plot.hover({ position: { x: box.width * 0.64, y: box.height * 0.55 } });
        await expect(view.locator('svg text').filter({ hasText: /^Pie$/ })).toBeVisible();
      } else if (name === 'Sankey') {
        const plot = view.locator('.chart-plot'), box = await plot.boundingBox();
        await plot.hover({ position: { x: box.width * 0.06, y: box.height * 0.5 } });
      }
      await expect.poll(async () => (await chartPaints(view)).foreign, { message: `${name} must paint theme tones or their blends (${palette}, dark=${dark})` }).toEqual([]);
      if (name === 'Pie') await expect(view.locator('svg pattern')).toHaveCount(0);
      const colors = await chartPaints(view); assert.ok(colors.paints.length >= 2);
      if (palette === 'blue-horizon' && dark && ['Pie', 'Sankey'].includes(name)) {
        await mkdir(this.artifactDirectory, { recursive: true });
        await page.screenshot({ path: `${this.artifactDirectory}/themed-${name.toLowerCase()}.png` });
      }
    }
  }
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
});
Then('narrow pie views keep percentage labels inside the plot and names in a legend', async function () {
  const page = this.page; await page.setViewportSize({ width: 460, height: 820 });
  await setMode(page, 'workflow'); await loadGraphFixture(page, example); await workflowAction(page, 'Run');
  const run = runDialog(page); await run.getByRole('tab', { name: 'Pie', exact: true }).click();
  const plot = run.locator('.chart-plot'); await expect(plot.locator('svg')).toBeVisible();
  const labels = await plot.locator('svg').evaluate(svg => {
    const bounds = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('text')].filter(text => /^\d+(?:\.\d+)?%$/.test(text.textContent)).map(text => {
      const box = text.getBoundingClientRect();return { text: text.textContent, inside: box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom };
    });
  });
  assert.ok(labels.length); assert.ok(labels.every(label => label.inside), JSON.stringify(labels));
  await expect(plot.locator('text').filter({ hasText: /^Sample / }).first()).toBeVisible();
  await mkdir(this.artifactDirectory, { recursive: true }); await page.screenshot({ path: `${this.artifactDirectory}/narrow-themed-pie.png` });
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
});

Then('two live sources keep separate controls while their views continue updating', async function () {
  const page = this.page, id = randomUUID(), summary = 'Observe parallel samples';
  const operation = {
    operationId: 'samples', summary, 'x-operations-response-stream': 'ndjson',
    parameters: [{ name: 'previous', in: 'query', schema: { type: 'number' } }],
    responses: { 200: { description: 'Measurements', content: {
      'application/json': { schema: { type: 'object', properties: { cpu: { type: 'number' }, memory: { type: 'number' } } } },
      'application/x-ndjson': { schema: { type: 'object' } }
    } } }
  };
  const schema = { openapi: '3.1.0', info: { title: 'Parallel measurements', version: '1' }, servers: [{ url: this.baseURL }],
    paths: { [`/monitoring-fixture/${id}/samples`]: { get: operation } } };
  await setMode(page, 'settings');
  const schemas = page.locator('summary[aria-label="Schemas"]');
  if (await schemas.getAttribute('aria-expanded') !== 'true') await schemas.click();
  await page.locator('input[type="file"][aria-label="Upload OpenAPI document"]').setInputFiles({ name: 'parallel-measurements.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(schema)) });
  await expect(page.getByRole('switch', { name: 'Enable Parallel measurements', exact: true })).toHaveAttribute('aria-checked', 'true');
  await chooseCatalogOperation(page, summary, 'workflow'); await setMode(page, 'workflow');
  await expect.poll(async () => (await storedWorkflows(page))[0]?.nodes.some(node => node.type === 'operation')).toBe(true);
  const document = { ...(await storedWorkflows(page))[0], version: 3, description: '' };
  const first = document.nodes.find(node => node.type === 'operation'); first.data.name = 'CPU stream';
  const model = { ...extractOperations(schema, 'parallel-fixture')[0], id: first.data.operationId };
  const second = createOperationGraph(model, { x: 400, y: 0 }, 'second-stream', schema);
  second.nodes.find(node => node.type === 'operation').data.name = 'Memory stream';
  document.nodes.push(...second.nodes); document.edges.push(...second.edges);
  const output = (owner, field) => document.nodes.find(node => node.type === 'data' && node.data.ownerId === owner && node.data.direction === 'outputs' && node.data.fields.some(item => item.label === field));
  const cpu = output(first.id, 'cpu');
  const previous = document.nodes.find(node => node.type === 'data' && node.data.ownerId === 'second-stream' && node.data.direction === 'inputs' && node.data.fields.some(field => field.label === 'previous'));
  document.edges.push({ id: 'parallel-next', kind: 'mapping', source: cpu.id, sourceHandle: cpu.data.fields.find(field => field.label === 'cpu').id,
    target: previous.id, targetHandle: previous.data.fields.find(field => field.label === 'previous').id });
  for (const [owner, field, name] of [[first.id, 'cpu', 'CPU'], ['second-stream', 'memory', 'Memory']]) {
    const source = output(owner, field), target = 'parallel-' + field;
    document.nodes.push({ id: target, type: 'chart', position: { x: 900, y: field === 'cpu' ? 0 : 500 }, data: { ...defaultChartData(), title: name, maxPoints: 50 } });
    document.edges.push({ id: target, kind: 'mapping', source: source.id, sourceHandle: source.data.fields.find(item => item.label === field).id, target, targetHandle: 'value' });
  }
  await loadGraphFixture(page, document); await workflowAction(page, 'Run');
  const run = runDialog(page), status = async () => (await this.context.request.get(`${this.baseURL}/monitoring-fixture/${id}/status`)).json();
  await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  await run.getByRole('button', { name: 'Next operation', exact: true }).click();
  await run.getByRole('button', { name: 'Run operation', exact: true }).click();
  await expect(run.getByRole('button', { name: 'Stop stream CPU stream', exact: true })).toBeVisible();
  await expect(run.getByRole('button', { name: 'Stop stream Memory stream', exact: true })).toBeVisible();
  await expect.poll(async () => (await status()).active).toBe(2);
  await run.getByRole('button', { name: 'Stop stream CPU stream', exact: true }).click();
  await expect.poll(async () => (await status()).active).toBe(1);
  await run.getByRole('tab', { name: 'Memory', exact: true }).click();
  const view = run.locator('.chart-view'), before = Number(await view.getAttribute('data-point-count'));
  await expect.poll(async () => Number(await view.getAttribute('data-point-count'))).toBeGreaterThan(before);
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
  await expect.poll(async () => (await status()).active).toBe(0);
  assert.equal((await status()).requests, 2);
});

Then('expanded comparisons render dense views with solid pie slices and paged tables', async function () {
  const page = this.page;
  await setMode(page, 'workflow'); await loadGraphFixture(page, expandedExample); await workflowAction(page, 'Run');
  const run = runDialog(page);
  await expect(run.getByRole('heading', { name: 'Workflow complete.', exact: true })).toBeVisible();
  await expect(run.getByRole('tab')).toHaveCount(15);
  await mkdir(this.artifactDirectory, { recursive: true });
  for (const [kind, title, count] of [
    ['line', 'Line (1,000 samples)', 6000], ['bar', 'Bar (24 regions)', 144],
    ['pie', 'Pie (24 services)', 24], ['area', 'Area (1,000 samples)', 6000],
    ['scatter', 'Scatter (6,000 points)', 6000], ['sankey', 'Sankey (23 nodes, 60 links)', 60],
    ['table', 'Table (1,000 rows)', 1000]
  ]) {
    await run.getByRole('tab', { name: title, exact: true }).click();
    const view = run.locator(`[data-chart-kind="${kind}"]`);
    await expect(view).toHaveAttribute('data-point-count', String(count));
    await expect(view.getByRole('alert')).toHaveCount(0);
    if (kind === 'table') {
      await expect(view.locator('tbody tr')).toHaveCount(50);
      await expect(view.getByText('Page 1 of 20 · 1000 rows', { exact: true })).toBeVisible();
      await view.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(view.locator('tbody tr').first().locator('td').first()).toHaveText('50');
      await view.getByRole('button', { name: 'Previous', exact: true }).click();
      await expect(view.locator('tbody tr').first().locator('td').first()).toHaveText('0');
    } else {
      await expect(view.locator('svg')).toBeVisible();
      assert.deepEqual((await chartPaints(view)).foreign, []);
      if (kind === 'pie') {
        await expect(view.locator('svg pattern')).toHaveCount(0);
        const colors = await view.locator('svg path').evaluateAll(paths => [...new Set(paths.filter(path => path.getAttribute('d')?.includes('A')).map(path => getComputedStyle(path).fill))]);
        assert.equal(colors.length, 24);
        const labels = await view.locator('svg text').evaluateAll(texts => texts.filter(text => /^\d+(?:\.\d+)?%$/.test(text.textContent)).map(text => {
          const box = text.getBoundingClientRect(); return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
        }).filter(box => box.right > box.left && box.bottom > box.top));
        assert.ok(labels.length);
        for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i], b = labels[j];
          assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, 'Dense pie labels must not overlap');
        }
      }
      await expect(view.locator('svg pattern')).toHaveCount(0);
      if (kind === 'sankey') {
        const labels = await view.locator('svg').evaluate(svg => {
          const bounds = svg.getBoundingClientRect();
          return [...svg.querySelectorAll('text')].map(text => {
            const box = text.getBoundingClientRect();
            return { text: text.textContent, inside: box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom };
          });
        });
        assert.equal(labels.length, 23); assert.ok(labels.every(label => label.inside), JSON.stringify(labels));
      }
    }
    await page.screenshot({ path: `${this.artifactDirectory}/dense-${kind}.png` });
  }
  await run.getByRole('tab', { name: 'Sankey', exact: true }).click();
  await expect(run.locator('.chart-view')).toHaveAttribute('data-point-count', '2');
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
});

Then('dense charts support range zoom magnification reset filtering and local export', async function () {
  const page = this.page;
  await setMode(page, 'workflow'); await loadGraphFixture(page, expandedExample); await workflowAction(page, 'Run');
  const run = runDialog(page);
  await run.getByRole('tab', { name: 'Line (1,000 samples)', exact: true }).click();
  let view = run.locator('.chart-view');
  const box = await view.locator('.plot-viewport').boundingBox();
  assert.ok(box.width > page.viewportSize().width * 0.85); assert.ok(box.height > page.viewportSize().height * 0.5);
  await view.getByRole('button', { name: 'Zoom in', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(view).toHaveAttribute('data-zoom-level', '150');
  const memory = () => run.locator('.chart-view svg text').filter({ hasText: /^Memory$/ });
  const active = await memory().evaluate(text => getComputedStyle(text).fill);
  await memory().click(); await view.getByRole('button', { name: 'Zoom in', exact: true }).hover();
  await expect.poll(() => memory().evaluate(text => getComputedStyle(text).fill)).not.toBe(active);
  const inactive = await memory().evaluate(text => getComputedStyle(text).fill);
  await run.getByRole('tab', { name: 'Bar (24 regions)', exact: true }).click();
  await run.getByRole('tab', { name: 'Line (1,000 samples)', exact: true }).click();
  view = run.locator('.chart-view'); await expect(view).toHaveAttribute('data-zoom-level', '150');
  await expect.poll(() => memory().evaluate(text => getComputedStyle(text).fill)).toBe(inactive);
  const svgDownload = page.waitForEvent('download'); await view.getByRole('button', { name: 'Save SVG', exact: true }).click();
  const svg = await svgDownload; assert.match(svg.suggestedFilename(), /\.svg$/); assert.match(await readFile(await svg.path(), 'utf8'), /<svg/);
  await view.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(view).toHaveAttribute('data-zoom-level', '100');
  await expect.poll(() => memory().evaluate(text => getComputedStyle(text).fill)).toBe(active);
  await run.getByRole('tab', { name: 'Sankey (23 nodes, 60 links)', exact: true }).click();
  view = run.locator('.chart-view'); await view.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const plot = view.locator('.plot-viewport');
  await expect.poll(() => plot.evaluate(element => element.scrollWidth / element.clientWidth)).toBeGreaterThan(1.4);
  await plot.evaluate(element => { element.scrollLeft = 100; element.scrollTop = 50; });
  assert.ok(await plot.evaluate(element => element.scrollLeft > 0 && element.scrollTop > 0));
  await view.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect.poll(() => plot.evaluate(element => element.scrollWidth / element.clientWidth)).toBeLessThan(1.01);
  await run.getByRole('tab', { name: 'Table (1,000 rows)', exact: true }).click();
  view = run.locator('.chart-view'); await view.getByRole('searchbox', { name: 'Filter rows', exact: true }).fill('999');
  await expect(view.locator('tbody tr')).toHaveCount(1); await expect(view.locator('tbody td').first()).toHaveText('999');
  const jsonDownload = page.waitForEvent('download'); await view.getByRole('button', { name: 'Save JSON', exact: true }).click();
  const json = JSON.parse(await readFile(await (await jsonDownload).path(), 'utf8'));
  assert.equal(json.rows.length, 1); assert.equal(json.columns.length, 7);
  await run.getByRole('tab', { name: 'Line (1,000 samples)', exact: true }).click();
  await run.getByRole('tab', { name: 'Table (1,000 rows)', exact: true }).click();
  await expect(run.getByRole('searchbox', { name: 'Filter rows', exact: true })).toHaveValue('999');
  await mkdir(this.artifactDirectory, { recursive: true }); await page.screenshot({ path: `${this.artifactDirectory}/filtered-table.png` });
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
  for (const node of (await storedWorkflows(page))[0].nodes.filter(node => node.type === 'chart')) {
    assert.equal(Object.hasOwn(node.data, 'inspection'), false); assert.equal(Object.hasOwn(node.data, 'frozen'), false);
  }
});

Then('chart patterns start off and saved per-type choices survive a reload', async function () {
  const page = this.page;
  const open = async () => {
    await setMode(page, 'settings');
    const application = page.locator('summary[aria-label="Application"]');
    if (await application.getAttribute('aria-expanded') !== 'true') await application.click();
  };
  await open();
  const contrast = await page.getByRole('group', { name: 'Chart patterns', exact: true }).evaluate(element => {
    const rgb = color => color.match(/[\d.]+/g).map(Number);
    const foreground = rgb(getComputedStyle(element).color);
    let background = [0, 0, 0];
    for (let node = element; node; node = node.parentElement) {
      const candidate = rgb(getComputedStyle(node).backgroundColor);
      if (candidate.length === 3 || candidate[3] > 0) { background = candidate; break; }
    }
    const light = channels => channels.slice(0, 3).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const a = light(foreground), b = light(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  assert.ok(contrast >= 4.5, `Pattern labels need readable contrast: ${contrast}`);
  for (const kind of ['Line', 'Bar', 'Pie', 'Area', 'Scatter', 'Sankey']) await expect(page.getByRole('combobox', { name: kind + ' pattern', exact: true })).toContainText('Off');
  for (const [kind, option] of [['Line', 'Dashed'], ['Bar', 'Vertical lines'], ['Area', 'Horizontal lines'], ['Pie', 'Diagonal lines'], ['Sankey', 'Dots']]) {
    await page.getByRole('combobox', { name: kind + ' pattern', exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  }
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('v1/settings'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction('settings').objectStore('settings').get('chartSettings');
      read.onsuccess = () => { db.close(); resolve(read.result?.patterns); }; read.onerror = () => reject(read.error);
    };
  }))).toEqual({ line: 'dashed', bar: 'vertical', area: 'horizontal', pie: 'diagonal', scatter: 'none', sankey: 'dots' });
  await page.reload(); await open();
  await expect(page.getByRole('combobox', { name: 'Bar pattern', exact: true })).toContainText('Vertical lines');
  await expect(page.getByRole('combobox', { name: 'Sankey pattern', exact: true })).toContainText('Dots');
  await mkdir(this.artifactDirectory, { recursive: true }); await page.screenshot({ path: `${this.artifactDirectory}/chart-pattern-settings.png` });
  await setMode(page, 'workflow'); await loadGraphFixture(page, example); await workflowAction(page, 'Run');
  const run = runDialog(page);
  for (const name of ['Bar', 'Area', 'Pie', 'Sankey']) {
    await run.getByRole('tab', { name, exact: true }).click();
    const view = run.locator('.chart-view'); await expect(view.locator('svg')).toBeVisible();
    await expect.poll(() => view.locator('svg pattern').count()).toBeGreaterThan(0);
    assert.deepEqual((await chartPaints(view)).foreign, []);
  }
  await run.getByRole('tab', { name: 'Scatter', exact: true }).click();
  await expect(run.locator('.chart-view svg pattern')).toHaveCount(0);
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
});

async function plottedAxisLabels(view) {
  return view.locator('.chart-plot').evaluate(plot => {
    const bounds = plot.getBoundingClientRect(), bottom = bounds.height - 70;
    const x = [], y = [], categories = [];
    for (const text of plot.querySelectorAll('svg text')) {
      const box = text.getBoundingClientRect();
      if (!box.width || !box.height || getComputedStyle(text).visibility === 'hidden') continue;
      const label = text.textContent.trim(), cx = (box.left + box.right) / 2 - bounds.left, cy = (box.top + box.bottom) / 2 - bounds.top;
      const number = /^-?[\d,]+(?:\.\d+)?$/.test(label) ? Number(label.replaceAll(',', '')) : null;
      if (cy >= bottom && cy < bottom + 30 && cx >= 45) {
        if (number !== null) x.push(number);
        if (/^Region \d+$/.test(label)) categories.push(Number(label.slice(-2)));
      }
      if (box.right - bounds.left <= 52 && cy >= 35 && cy <= bottom + 2 && number !== null) y.push(number);
    }
    return { x, y, categories };
  });
}
Then('plot selections zoom Line Area Bar and Scatter to the chosen coordinates', async function () {
  const page = this.page;
  await setMode(page, 'workflow'); await loadGraphFixture(page, expandedExample); await workflowAction(page, 'Run');
  const run = runDialog(page);
  await mkdir(this.artifactDirectory, { recursive: true });
  for (const [kind, name] of [['line', 'Line (1,000 samples)'], ['area', 'Area (1,000 samples)'], ['bar', 'Bar (24 regions)'], ['scatter', 'Scatter (6,000 points)']]) {
    await run.getByRole('tab', { name, exact: true }).click();
    const view = run.locator('.chart-view'), plot = view.locator('.chart-plot');
    await expect(plot.locator('svg')).toBeVisible();
    const box = await plot.boundingBox(), before = await plottedAxisLabels(view);
    const left = box.x + 54, top = box.y + 40, width = box.width - 74, height = box.height - 110;
    const a = { x: left + width * 0.2, y: top + height * 0.25 }, b = { x: left + width * 0.6, y: top + height * 0.75 };
    await page.mouse.click(a.x, a.y); await expect(view).toHaveAttribute('data-zoom-level', '100');
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 });
    await expect(view.locator('.chart-selection')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(run).toBeVisible(); await expect(view.locator('.chart-selection')).toHaveCount(0);
    await page.mouse.up(); await expect(view).toHaveAttribute('data-zoom-level', '100');
    const start = kind === 'area' ? b : a, end = kind === 'area' ? a : b;
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 8 });
    await expect(view.locator('.chart-selection')).toBeVisible();
    if (kind === 'line') await page.screenshot({ path: `${this.artifactDirectory}/selecting-line-region.png` });
    await page.mouse.up(); await expect(view.locator('.chart-selection')).toHaveCount(0);
    await expect.poll(async () => Number(await view.getAttribute('data-zoom-level'))).toBeGreaterThan(180);
    await expect.poll(async () => Math.max(...(await plottedAxisLabels(view)).y)).toBeLessThan(Math.max(...before.y));
    const after = await plottedAxisLabels(view);
    assert.ok(after.y.length >= 2 && Math.min(...after.y) > Math.min(...before.y) && Math.max(...after.y) < Math.max(...before.y), JSON.stringify({ kind, before, after }));
    if (kind === 'bar') assert.ok(after.categories.length && Math.min(...after.categories) >= 4 && Math.max(...after.categories) <= 17, JSON.stringify(after));
    else assert.ok(after.x.length >= 2 && Math.min(...after.x) > Math.min(...before.x) && Math.max(...after.x) < Math.max(...before.x), JSON.stringify({ kind, before, after }));
    const zoom = await view.getAttribute('data-zoom-level');
    await page.screenshot({ path: `${this.artifactDirectory}/selected-${kind}-region.png` });
    await run.getByRole('tab', { name: 'Forms', exact: true }).click();
    await run.getByRole('tab', { name, exact: true }).click(); await expect(run.locator('.chart-view')).toHaveAttribute('data-zoom-level', zoom);
    if (kind === 'line') {
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
      await expect.poll(async () => Math.min(...(await plottedAxisLabels(run.locator('.chart-view'))).x)).toBeGreaterThan(Math.min(...after.x));
      assert.ok(Math.max(...(await plottedAxisLabels(run.locator('.chart-view'))).x) < Math.max(...after.x));
    }
    await run.getByRole('button', { name: 'Reset view', exact: true }).click();
    await expect(run.locator('.chart-view')).toHaveAttribute('data-zoom-level', '100');
    await expect.poll(() => plottedAxisLabels(run.locator('.chart-view'))).toEqual(before);
    if (kind === 'line') {
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, a.y + 2, { steps: 6 });
      await expect(run.locator('.chart-selection')).toHaveCount(0);
      await page.keyboard.down('Shift'); await expect(run.locator('.chart-selection')).toBeVisible();
      await page.keyboard.up('Shift'); await expect(run.locator('.chart-selection')).toHaveCount(0);
      await page.mouse.up(); await expect(run.locator('.chart-view')).toHaveAttribute('data-zoom-level', '100');
      await page.keyboard.down('Shift'); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, a.y + 2, { steps: 6 });
      const band = await run.locator('.chart-selection').boundingBox(); assert.ok(band.height >= height - 1);
      await page.mouse.up(); await page.keyboard.up('Shift');
      await expect.poll(async () => Math.min(...(await plottedAxisLabels(run.locator('.chart-view'))).x)).toBeGreaterThan(Math.min(...before.x));
      const horizontal = await plottedAxisLabels(run.locator('.chart-view'));
      assert.deepEqual(horizontal.y, before.y); assert.ok(Math.min(...horizontal.x) > Math.min(...before.x));
      const zoom = await run.locator('.chart-view').getAttribute('data-zoom-level');
      await page.keyboard.down('Alt'); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 140, a.y, { steps: 8 }); await page.mouse.up(); await page.keyboard.up('Alt');
      await expect(run.locator('.chart-selection')).toHaveCount(0);
      await expect.poll(async () => (await plottedAxisLabels(run.locator('.chart-view'))).x).not.toEqual(horizontal.x);
      await expect(run.locator('.chart-view')).toHaveAttribute('data-zoom-level', zoom);
      await run.getByRole('button', { name: 'Reset view', exact: true }).click();
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 2, b.y, { steps: 6 });
      await expect(run.locator('.chart-selection')).toHaveCount(0); await page.mouse.up();
      await expect(run.locator('.chart-view')).toHaveAttribute('data-zoom-level', '100');
      await page.keyboard.down('Shift'); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 2, b.y, { steps: 6 });
      const verticalBand = await run.locator('.chart-selection').boundingBox(); assert.ok(verticalBand.width >= width - 1);
      await page.screenshot({ path: `${this.artifactDirectory}/shift-axis-selection.png` });
      await page.mouse.up(); await page.keyboard.up('Shift');
      await expect.poll(async () => Math.min(...(await plottedAxisLabels(run.locator('.chart-view'))).y)).toBeGreaterThan(Math.min(...before.y));
      assert.deepEqual((await plottedAxisLabels(run.locator('.chart-view'))).x, before.x);
      await run.getByRole('button', { name: 'Reset view', exact: true }).click();
    }
  }
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
});

Then('scrolling over each plot zooms in and out while reset and saved inspection still work', async function () {
  const page = this.page;
  await setMode(page, 'workflow'); await loadGraphFixture(page, example); await workflowAction(page, 'Run');
  const run = runDialog(page);
  for (const kind of ['line', 'area', 'bar', 'scatter', 'pie', 'sankey']) {
    const name = kind[0].toUpperCase() + kind.slice(1);
    await run.getByRole('tab', { name, exact: true }).click();
    let view = run.locator('.chart-view');
    await expect(view.locator('svg')).toBeVisible();
    const box = await view.locator('.plot-viewport').boundingBox();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
    await page.mouse.wheel(0, -120);
    await expect.poll(async () => Number(await view.getAttribute('data-zoom-level')), { message: kind + ' wheel must zoom without Ctrl' }).toBeGreaterThan(100);
    const zoom = Number(await view.getAttribute('data-zoom-level'));
    if (kind === 'sankey') {
      const viewport = view.locator('.plot-viewport');
      const before = await viewport.evaluate(element => [element.scrollLeft, element.scrollTop]);
      await page.keyboard.down('Shift'); await page.mouse.wheel(0, 80); await page.keyboard.up('Shift');
      await expect.poll(() => viewport.evaluate(element => [element.scrollLeft, element.scrollTop])).not.toEqual(before);
      await expect(view).toHaveAttribute('data-zoom-level', String(zoom));
    }
    await run.getByRole('tab', { name: 'Forms', exact: true }).click();
    await run.getByRole('tab', { name, exact: true }).click();
    view = run.locator('.chart-view'); await expect(view).toHaveAttribute('data-zoom-level', String(zoom));
    const nextBox = await view.locator('.plot-viewport').boundingBox();
    await page.mouse.move(nextBox.x + nextBox.width * 0.55, nextBox.y + nextBox.height * 0.5);
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => Number(await view.getAttribute('data-zoom-level'))).toBeLessThan(zoom);
    await view.getByRole('button', { name: 'Reset view', exact: true }).click(); await expect(view).toHaveAttribute('data-zoom-level', '100');
  }
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
});

Then('Sankey nodes and flows toggle independently and keep their highlights across tabs and zoom', async function () {
  const page = this.page;
  await setMode(page, 'workflow'); await loadGraphFixture(page, expandedExample); await workflowAction(page, 'Run');
  const run = runDialog(page), tab = run.getByRole('tab', { name: 'Sankey (23 nodes, 60 links)', exact: true });
  await tab.click();
  const view = run.locator('[data-chart-kind="sankey"]'), clear = view.getByRole('button', { name: /^Clear highlights/ });
  await expect(view.locator('svg')).toBeVisible();
  const nodePoint = async name => {
    const label = view.locator('svg text').filter({ hasText: new RegExp('^' + name + '$') }).first();
    await expect(label).toBeVisible();
    const box = await label.boundingBox();
    return { x: box.x - 10, y: box.y + box.height / 2 };
  };
  const nodePaint = async name => {
    const point = await nodePoint(name);
    return view.locator('svg').evaluate((svg, point) => {
      const node = [...svg.querySelectorAll('path,rect')].find(element => {
        if (element.closest('defs,clipPath,mask')) return false;
        const box = element.getBoundingClientRect();
        return box.width > 5 && box.width < 50 && box.left < point.x && box.right > point.x && box.top < point.y && box.bottom > point.y;
      });
      if (!node) throw new Error('No painted node at ' + JSON.stringify(point));
      const style = getComputedStyle(node);
      return { opacity: Number(style.opacity) * Number(style.fillOpacity), border: parseFloat(style.strokeWidth) };
    }, point);
  };
  const ribbons = () => view.locator('svg').evaluate(svg => [...svg.querySelectorAll('path')]
    .filter(element => !element.closest('defs,clipPath,mask') && (element.getAttribute('d').match(/C/g) ?? []).length === 2)
    .map(element => {
      const style = getComputedStyle(element), box = element.getBoundingClientRect();
      return { opacity: Number(style.opacity) * Number(style.fillOpacity), x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }));
  const clickNode = async name => { const point = await nodePoint(name); await page.mouse.click(point.x, point.y); };
  const selected = async name => (await nodePaint(name)).border === 3;
  await expect(clear).toBeDisabled();
  const baseline = (await ribbons()).map(link => link.opacity);
  assert.equal(baseline.length, 60); assert.ok(baseline.every(opacity => opacity === 0.3));
  const europe = await nodePoint('Europe');
  await page.mouse.move(europe.x, europe.y);
  await expect(view.locator('svg text').filter({ hasText: /^Europe$/ })).toHaveCount(2);
  assert.deepEqual((await ribbons()).map(link => link.opacity), baseline, 'Hover must keep the original flow paints');
  await expect(clear).toBeDisabled();
  await clickNode('Europe'); await expect(clear).toHaveAccessibleName('Clear highlights (1)');
  await expect.poll(() => selected('Europe')).toBe(true);
  await expect.poll(async () => (await nodePaint('North America')).opacity).toBe(0.25);
  const firstCount = (await ribbons()).filter(link => link.opacity === 0.7).length;
  assert.ok(firstCount > 0 && firstCount < 60);
  await clickNode('North America'); await expect(clear).toHaveAccessibleName('Clear highlights (2)');
  await expect.poll(() => selected('Europe')).toBe(true); await expect.poll(() => selected('North America')).toBe(true);
  assert.ok((await ribbons()).filter(link => link.opacity === 0.7).length > firstCount);
  await mkdir(this.artifactDirectory, { recursive: true });
  await page.screenshot({ path: `${this.artifactDirectory}/sankey-multiple-highlights.png` });
  await run.getByRole('tab', { name: 'Forms', exact: true }).click(); await tab.click();
  await expect(clear).toHaveAccessibleName('Clear highlights (2)'); await expect.poll(() => selected('Europe')).toBe(true);
  await view.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(view).toHaveAttribute('data-zoom-level', '150'); await expect.poll(() => selected('Europe')).toBe(true);
  await clear.click(); await expect(clear).toBeDisabled(); await expect(view).toHaveAttribute('data-zoom-level', '150');
  await expect.poll(async () => (await ribbons()).map(link => link.opacity)).toEqual(baseline);
  await view.getByRole('button', { name: 'Reset view', exact: true }).click();
  await clickNode('Europe'); await clickNode('North America');
  await clickNode('Europe'); await expect(clear).toHaveAccessibleName('Clear highlights (1)');
  await expect.poll(() => selected('Europe')).toBe(false); await expect.poll(() => selected('North America')).toBe(true);
  await clickNode('North America'); await expect(clear).toBeDisabled();
  await expect.poll(async () => (await ribbons()).map(link => link.opacity)).toEqual(baseline);
  const edge = (await ribbons())[0];
  await page.mouse.click(edge.x, edge.y); await expect(clear).toHaveAccessibleName('Clear highlights (1)');
  await expect.poll(async () => (await ribbons()).filter(link => link.opacity === 0.9).length).toBe(1);
  await clickNode('Europe'); await expect(clear).toHaveAccessibleName('Clear highlights (2)');
  await expect.poll(async () => (await ribbons()).filter(link => link.opacity === 0.9).length).toBe(1);
  await page.mouse.click(edge.x, edge.y); await expect(clear).toHaveAccessibleName('Clear highlights (1)');
  await expect.poll(() => selected('Europe')).toBe(true);
  await expect.poll(async () => (await ribbons()).some(link => link.opacity === 0.9)).toBe(false);
  await view.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await view.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(view).toHaveAttribute('data-zoom-level', '100'); await expect(clear).toBeDisabled();
  await expect.poll(async () => (await ribbons()).map(link => link.opacity)).toEqual(baseline);
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
});

Then('table values use monospace stripes aligned types and themed booleans without changing exports', async function () {
  const page = this.page, document = structuredClone(example);
  document.nodes = document.nodes.filter(node => ['samples', 'chart-table'].includes(node.id));
  document.edges = document.edges.filter(edge => edge.source === 'samples' && edge.target === 'chart-table');
  const samples = document.nodes.find(node => node.id === 'samples');
  samples.data.file.value = Array.from({ length: 55 }, (_, index) => ({
    sample: 'sample-' + String(index).padStart(3, '0'), count: index + 1,
    latency: index === 1 ? 0.1 + 0.2 : index === 54 ? 1.005 : 1.2,
    ready: index % 2 === 0, mixed: index === 54 ? 'pending' : index + 0.5,
    code: String(index).padStart(3, '0'), literal: index % 2 ? 'true' : 'false', empty: null
  }));
  samples.data.file.source = JSON.stringify(samples.data.file.value);
  document.nodes.find(node => node.id === 'chart-table').data.columns = ['sample', 'count', 'latency', 'ready', 'mixed', 'code', 'literal', 'empty']
    .map(name => ({ id: name, label: name, path: '/' + name }));
  await setMode(page, 'workflow'); await loadGraphFixture(page, document); await workflowAction(page, 'Run');
  const run = runDialog(page); await run.getByRole('tab', { name: 'Table', exact: true }).click();
  const view = run.locator('[data-chart-kind="table"]'), table = view.getByRole('table'), body = table.locator('tbody tr');
  await expect(body).toHaveCount(50);
  await expect(view.getByRole('button', { name: 'Previous', exact: true })).toHaveCount(0);
  const next = view.getByRole('button', { name: 'Next', exact: true });
  await expect(next.locator('.material-symbols-rounded')).toHaveText('arrow_circle_right');
  assert.match(await next.locator('.material-symbols-rounded').evaluate(icon => getComputedStyle(icon).fontFamily), /Material Symbols Rounded/);
  assert.deepEqual(await body.nth(0).locator('td').allTextContents().then(cells => cells.map(value => value.trim())),
    ['sample-000', '1', '1.200', 'true', '0.5', '000', 'false', '']);
  await expect(body.nth(1).locator('td').nth(2)).toHaveText('0.300');
  const alignments = await table.evaluate(element => ({
    headers: [...element.querySelectorAll('th')].map(cell => getComputedStyle(cell).textAlign),
    cells: [...element.querySelector('tbody tr').children].map(cell => getComputedStyle(cell).textAlign),
    font: getComputedStyle(element.querySelector('td')).fontFamily,
    rows: [...element.querySelectorAll('tbody tr')].slice(0, 2).map(row => getComputedStyle(row).backgroundColor)
  }));
  const aligned = ['left', 'right', 'right', 'center', 'left', 'left', 'left', 'left'];
  assert.deepEqual(alignments.headers, aligned); assert.deepEqual(alignments.cells, aligned);
  assert.match(alignments.font, /monospace/); assert.notEqual(alignments.rows[0], alignments.rows[1]);
  await expect(body.nth(0).locator('td').nth(6).locator('span')).toHaveCount(0);
  await view.getByRole('button', { name: 'Next', exact: true }).click(); await expect(body).toHaveCount(5);
  await expect(view.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
  await expect(view.getByRole('button', { name: 'Previous', exact: true }).locator('.material-symbols-rounded')).toHaveText('arrow_circle_left');
  await expect(body.nth(4).locator('td').nth(2)).toHaveText('1.005');
  await expect(body.nth(4).locator('td').nth(4)).toHaveText('pending');
  const filter = view.getByRole('searchbox', { name: 'Filter rows', exact: true });
  await filter.fill('1.200'); await expect(body.nth(0).locator('td').nth(2)).toHaveText('1.200');
  await expect(view.getByText('Page 1 of 2 · 53 rows of 55', { exact: true })).toBeVisible();
  await filter.fill('sample-001'); await expect(body).toHaveCount(1);
  await expect(view.locator('.table-pages button')).toHaveCount(0);
  await expect(body.nth(0).locator('td').nth(2)).toHaveText('0.300');
  const download = page.waitForEvent('download'); await view.getByRole('button', { name: 'Save JSON', exact: true }).click();
  const exported = await download, json = JSON.parse(await readFile(await exported.path(), 'utf8'));
  assert.equal(json.rows.length, 1); assert.equal(json.rows[0][2], '0.30000000000000004');
  assert.equal(json.rows[0][3], 'false'); assert.deepEqual(Object.keys(json).sort(), ['columns', 'rows']);
  await filter.fill('');
  await mkdir(this.artifactDirectory, { recursive: true });
  let previousColors;
  for (const palette of ['default', 'neon', 'citrus']) for (const dark of [false, true]) {
    await page.evaluate(({ palette, dark }) => {
      document.documentElement.dataset.palette = palette; document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.classList.toggle('dark', dark);
    }, { palette, dark });
    const paints = () => table.locator('.boolean-value').evaluateAll(labels => labels.slice(0, 2).map(label => {
      const style = getComputedStyle(label); return { color: style.color, background: style.backgroundColor };
    }));
    if (previousColors) await expect.poll(paints).not.toEqual(previousColors);
    const colors = await paints(); assert.notDeepEqual(colors[0], colors[1]);
    const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    for (const paint of colors) assert.ok((Math.max(luminance(paint.color), luminance(paint.background)) + 0.05) /
      (Math.min(luminance(paint.color), luminance(paint.background)) + 0.05) >= 4.5, JSON.stringify(paint));
    previousColors = colors;
    if (palette === 'default') await page.screenshot({ path: `${this.artifactDirectory}/typed-table-${dark ? 'dark' : 'light'}.png` });
  }
  await run.getByRole('tab', { name: 'Forms', exact: true }).click(); await run.getByRole('tab', { name: 'Table', exact: true }).click();
  await expect(body.nth(1).locator('td').nth(2)).toHaveText('0.300');
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
});

Then('repeated diagram wheel zoom produces no native resize errors', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 1724, height: 954 });
  await setMode(page, 'workflow'); await loadGraphFixture(page, expandedExample); await workflowAction(page, 'Run');
  const run = runDialog(page);
  await page.evaluate(() => {
    window.__chartResizeErrors = [];
    window.addEventListener('error', event => { if (/ResizeObserver/.test(event.message)) window.__chartResizeErrors.push(event.message); });
    document.documentElement.dataset.palette = 'obsidian'; document.documentElement.dataset.theme = 'dark'; document.documentElement.classList.add('dark');
  });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const [name, width, height] of [['Sankey (23 nodes, 60 links)', 1724, 954], ['Sankey (23 nodes, 60 links)', 1077, 713], ['Pie (24 services)', 736, 862]]) {
    await run.getByRole('tab', { name, exact: true }).click();
    await page.setViewportSize({ width, height });
    const view = run.locator('.chart-view'); await expect(view.locator('svg')).toBeVisible();
    for (const delta of [-120, 120]) {
      for (let step = 0; step < 7; step++) {
        const box = await view.locator('.plot-viewport').boundingBox();
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
        await page.mouse.wheel(0, delta); await settle();
      }
      await expect(view).toHaveAttribute('data-zoom-level', delta < 0 ? '400' : '100');
    }
    await expect.poll(() => page.evaluate(() => window.__chartResizeErrors)).toEqual([]);
    await run.getByRole('tab', { name: 'Forms', exact: true }).click(); await settle();
  }
  await run.getByRole('button', { name: 'Quit', exact: true }).click(); await settle();
  assert.deepEqual(await page.evaluate(() => window.__chartResizeErrors), []);
});

Then('wheel input scrolls run tabs while native gestures and keyboard navigation remain usable', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 920, height: 720 });
  await setMode(page, 'workflow'); await loadGraphFixture(page, expandedExample); await workflowAction(page, 'Run');
  const run = runDialog(page), tabs = run.getByRole('tablist', { name: 'Workflow run views', exact: true });
  const selected = run.getByRole('tab', { name: 'Line', exact: true }); await selected.click();
  const view = run.locator('.chart-view'); await view.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(view).toHaveAttribute('data-zoom-level', '150');
  const position = () => tabs.evaluate(element => element.scrollLeft);
  const wheel = async (x, y) => {
    const box = await tabs.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(x, y);
  };
  assert.ok(await tabs.evaluate(element => element.scrollWidth > element.clientWidth));
  await tabs.evaluate(element => { element.scrollLeft = 0; });
  await wheel(0, 320); await expect.poll(position).toBeGreaterThan(100);
  await expect(selected).toHaveAttribute('aria-selected', 'true'); await expect(view).toHaveAttribute('data-zoom-level', '150');
  await mkdir(this.artifactDirectory, { recursive: true });
  await page.screenshot({ path: `${this.artifactDirectory}/wheel-scrolled-run-tabs.png` });
  await wheel(0, -320); await expect.poll(position).toBe(0);
  await wheel(240, 0); await expect.poll(position).toBeGreaterThan(100);
  await wheel(-240, 0); await expect.poll(position).toBe(0);
  await page.keyboard.down('Shift'); await wheel(0, 240); await page.keyboard.up('Shift');
  await expect.poll(position).toBeGreaterThan(100);
  const dispatch = options => tabs.evaluate((element, options) => {
    const before = element.scrollLeft, event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...options });
    const uncanceled = element.dispatchEvent(event);
    return { before, after: element.scrollLeft, uncanceled, width: element.clientWidth, max: element.scrollWidth - element.clientWidth,
      line: Number.parseFloat(getComputedStyle(element).lineHeight) || 16 };
  }, options);
  await tabs.evaluate(element => { element.scrollLeft = 0; });
  const line = await dispatch({ deltaY: 2, deltaMode: 1 }); assert.equal(line.uncanceled, false); assert.ok(Math.abs(line.after - line.line * 2) <= 1);
  const paged = await dispatch({ deltaY: 1, deltaMode: 2 }); assert.equal(paged.uncanceled, false); assert.ok(Math.abs(paged.after - Math.min(paged.max, paged.before + paged.width)) <= 1);
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const native = await dispatch({ deltaY: -100, [modifier]: true }); assert.equal(native.uncanceled, true); assert.equal(native.before, native.after);
  }
  await tabs.evaluate(element => { element.scrollLeft = 0; });
  const start = await dispatch({ deltaY: -100 }); assert.equal(start.uncanceled, true); assert.equal(start.after, 0);
  await tabs.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  const end = await dispatch({ deltaY: 100 }); assert.equal(end.uncanceled, true); assert.equal(end.before, end.after);
  await run.getByRole('tab', { name: 'Forms', exact: true }).focus(); await page.keyboard.press('End');
  const last = run.getByRole('tab', { name: 'Table (1,000 rows)', exact: true });
  await expect(last).toBeFocused(); await expect(last).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft'); await expect(run.getByRole('tab', { name: 'Sankey (23 nodes, 60 links)', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight'); await expect(last).toBeFocused();
  await page.keyboard.press('Home'); await expect(run.getByRole('tab', { name: 'Forms', exact: true })).toBeFocused();
  await expect.poll(position).toBe(0);
  const fullWidth = await tabs.evaluate(element => element.scrollWidth);
  await page.setViewportSize({ width: fullWidth + 200, height: 720 });
  await expect.poll(() => tabs.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const fits = await dispatch({ deltaY: 100 }); assert.equal(fits.uncanceled, true); assert.equal(fits.after, 0);
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
});

Then('wrapped legends keep entries clear of the plot and crowded legends scroll without zooming', async function () {
  const page = this.page, names = expandedExample.nodes.find(node => node.id === 'dense-slices').data.file.value.map(slice => slice.service);
  const document = structuredClone(expandedExample), slices = document.nodes.find(node => node.id === 'dense-slices');
  slices.data.file.value.push({ service: 'Unavailable sample', requests: null });
  slices.data.file.source = JSON.stringify(slices.data.file.value);
  document.nodes.find(node => node.id === 'dense-pie').data.maxPoints = Math.max(25, document.nodes.find(node => node.id === 'dense-pie').data.maxPoints);
  await page.setViewportSize({ width: 1280, height: 900 });
  await setMode(page, 'workflow'); await loadGraphFixture(page, document); await workflowAction(page, 'Run');
  await page.evaluate(() => {
    document.documentElement.dataset.palette = 'obsidian'; document.documentElement.dataset.theme = 'dark'; document.documentElement.classList.add('dark');
  });
  const run = runDialog(page), tab = run.getByRole('tab', { name: 'Pie (24 services)', exact: true });
  await tab.click();
  const view = run.locator('[data-chart-kind="pie"]'), plot = view.locator('.chart-plot');
  let previousRows = 0;
  await mkdir(this.artifactDirectory, { recursive: true });
  for (const [width, height] of [[1280, 900], [760, 1000]]) {
    await page.setViewportSize({ width, height }); await expect(view).toHaveAttribute('data-legend-mode', 'wrap');
    await expect.poll(() => plot.locator('svg').evaluate(svg => Math.abs(svg.getBoundingClientRect().width - svg.parentElement.getBoundingClientRect().width))).toBeLessThan(2);
    const layout = await plot.locator('svg').evaluate((svg, names) => {
      const bounds = svg.getBoundingClientRect();
      const labels = [...svg.querySelectorAll('text')].filter(text => names.includes(text.textContent)).map(text => {
        const box = text.getBoundingClientRect(); return { name: text.textContent, left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      });
      const pie = [...svg.querySelectorAll('path')].filter(path => path.getAttribute('d')?.includes('A')).map(path => path.getBoundingClientRect()).filter(box => box.width > 30 || box.height > 30);
      return { labels, bounds: { left: bounds.left, right: bounds.right }, pieTop: Math.min(...pie.map(box => box.top)) };
    }, names);
    assert.equal(layout.labels.length, names.length);
    await expect(plot.getByText('Unavailable sample', { exact: true })).toHaveCount(0);
    assert.ok(layout.labels.every(label => label.left >= layout.bounds.left && label.right <= layout.bounds.right));
    const rows = [];
    for (const label of layout.labels) if (!rows.some(top => Math.abs(top - label.top) < 6)) rows.push(label.top);
    assert.ok(rows.length > Math.max(1, previousRows)); previousRows = rows.length;
    assert.ok(layout.pieTop > Math.max(...layout.labels.map(label => label.bottom)), JSON.stringify(layout));
    for (let i = 0; i < layout.labels.length; i++) for (let j = i + 1; j < layout.labels.length; j++) {
      const a = layout.labels[i], b = layout.labels[j];
      assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, 'Wrapped legend entries must not overlap');
    }
    assert.deepEqual((await chartPaints(view)).foreign, []);
    await page.screenshot({ path: `${this.artifactDirectory}/wrapped-legend-${width}.png` });
  }
  const lastName = names.at(-1), lastLabel = () => plot.getByText(lastName, { exact: true }).first();
  const active = await lastLabel().evaluate(text => getComputedStyle(text).fill);
  await lastLabel().click(); await view.getByRole('button', { name: 'Zoom in', exact: true }).hover();
  await expect.poll(() => lastLabel().evaluate(text => getComputedStyle(text).fill)).not.toBe(active);
  const inactive = await lastLabel().evaluate(text => getComputedStyle(text).fill);
  const download = page.waitForEvent('download'); await view.getByRole('button', { name: 'Save SVG', exact: true }).click();
  const exported = await download, svg = await readFile(await exported.path(), 'utf8');
  for (const name of names) assert.ok(svg.includes(name), 'SVG export must retain every wrapped legend entry: ' + name);
  await run.getByRole('tab', { name: 'Forms', exact: true }).click(); await tab.click();
  await expect.poll(() => lastLabel().evaluate(text => getComputedStyle(text).fill)).toBe(inactive);
  await page.setViewportSize({ width: 460, height: 540 }); await expect(view).toHaveAttribute('data-legend-mode', 'scroll');
  const pager = () => plot.locator('svg text').filter({ hasText: /^\d+\/\d+$/ }).first();
  await expect(pager()).toBeVisible(); const firstPage = await pager().textContent();
  const wheel = async (x, y) => {
    const box = await plot.boundingBox(); await page.mouse.move(box.x + 20, box.y + 8); await page.mouse.wheel(x, y);
  };
  await wheel(0, 240); await expect.poll(() => pager().textContent()).not.toBe(firstPage);
  await expect(view).toHaveAttribute('data-zoom-level', '100');
  await wheel(-240, 0); await expect.poll(() => pager().textContent()).toBe(firstPage);
  for (let step = 0; step < 5; step++) await wheel(0, 240);
  await expect.poll(async () => { const [current, total] = (await pager().textContent()).split('/'); return current === total; }).toBe(true);
  const lastPage = await pager().textContent();
  await run.getByRole('tab', { name: 'Forms', exact: true }).click(); await tab.click();
  await expect.poll(() => pager().textContent()).toBe(lastPage);
  await view.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect.poll(() => pager().textContent()).toBe(firstPage); await expect(view).toHaveAttribute('data-zoom-level', '100');
  await page.screenshot({ path: `${this.artifactDirectory}/wheel-legend-compact.png` });
  await run.getByRole('button', { name: 'Quit', exact: true }).click();
});
