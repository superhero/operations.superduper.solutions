// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { toggleConnectionStyle } from './connection-style.fixture.mjs';
import assert from 'node:assert/strict';
import { Given, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { readExport, setMode, workflow } from './workspace.steps.mjs';
import { setWorkflowNodeClearance, setWorkflowDashValues, storedDefaults } from './workflow-defaults.steps.mjs';
import { repository, storedWorkflows } from './workflow-storage.fixture.mjs';

const node = (page, id) => workflow(page).locator(`.svelte-flow__node[data-id="${id}"]`);
const edge = (page, id = 'routing-edge') => workflow(page).locator(`.svelte-flow__edge[data-id="${id}"]`);
// The interaction path always describes the complete route, including when
// separately painted dash segments replace the visible BaseEdge path.
const route = (page, id) => edge(page, id).locator('.svelte-flow__edge-interaction');
const handle = (page, id, port) => node(page, id).locator(`.svelte-flow__handle[data-handleid="${port}"]`);
const ghost = page => workflow(page).locator('.workflow-connection-preview');
const saved = page => expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
const cast = (id, x, y) => ({ id, type: 'cast', position: { x, y }, data: { targetType: 'Text' } });

function fixture({ connected = true, dashed = false, switchTarget = false, nativeHandles = false, narrowExit = false } = {}) {
  const document = {
    version: 3, id: 'routing-regression', name: 'Measured routing regression', description: '',
    nodes: [cast('routing-source', 80, 250), cast('routing-blocker', 430, 260),
      switchTarget ? { id: 'routing-target', type: 'switch', position: { x: 900, y: 290 },
        data: { gates: [{ id: 'routing-gate', operator: 'is_set', value: '' }] } } : cast('routing-target', 900, 290),
      cast('routing-later', 900, 510)],
    edges: connected ? [{ id: 'routing-edge', kind: 'mapping', source: 'routing-source', sourceHandle: 'result',
      target: 'routing-target', targetHandle: 'value' }] : [],
    viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed,
  };
  if (nativeHandles) {
    for (const item of document.nodes) if (item.id !== 'routing-blocker') {
      item.type = 'operation';
      item.data = { operationId: 'demo:listProjects', name: 'Example array response', description: '', method: 'GET', path: '/projects' };
    }
    document.nodes.find(item => item.id === 'routing-blocker').position.y = 280;
  }
  if (narrowExit) document.nodes = [cast('routing-source', 400, 250), cast('routing-blocker', 630, 250),
    cast('routing-target', 80, 360)];
  return document;
}

async function importRouting(world, options = {}) {
  const page = world.page;
  if (options.gap !== undefined) {
    await storedDefaults(page, { ...(await storedDefaults(page)), dashGap: options.gap });
    await page.reload();
  }
  await setMode(page, 'workflow');
  await page.getByLabel('Import workflow file', { exact: true }).setInputFiles({
    name: 'routing-regression.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture(options))),
  });
  await expect(node(page, 'routing-target')).toBeVisible();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await saved(page);
  world.routingBaseline = (await readExport(page)).document;
}

async function center(locator) {
  const bounds = await locator.boundingBox();
  assert.ok(bounds, 'The pointer target must be measured.');
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

async function beginConnection(page) {
  const start = await center(handle(page, 'routing-source', 'result'));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y, { steps: 3 });
}

async function pathGeometry(path, blockerId = 'routing-blocker') {
  return path.evaluate((element, blockerId) => {
    const transform = element.getScreenCTM();
    const length = element.getTotalLength();
    const at = distance => {
      const point = element.getPointAtLength(distance);
      const screen = new DOMPoint(point.x, point.y).matrixTransform(transform);
      return { x: screen.x, y: screen.y };
    };
    const blocker = document.querySelector(`.svelte-flow__node[data-id="${blockerId}"]`).getBoundingClientRect();
    let intersections = 0;
    for (let distance = 0; distance <= length; distance += 1) {
      const point = at(distance);
      if (point.x > blocker.left + 1 && point.x < blocker.right - 1 &&
        point.y > blocker.top + 1 && point.y < blocker.bottom - 1) intersections++;
    }
    return { d: element.getAttribute('d'), start: at(0), end: at(length), intersections };
  }, blockerId);
}

async function expectClearRoute(page, id) {
  await expect(route(page, id)).toHaveAttribute('d', /^M.+/);
  await expect.poll(async () => (await pathGeometry(route(page, id))).intersections,
    { message: 'The settled route must not cross the measured blocker.' }).toBe(0);
}

async function endpointErrors(page, id = 'routing-edge', targetId = 'routing-target') {
  const geometry = await pathGeometry(route(page, id));
  const source = await handle(page, 'routing-source', 'result').boundingBox();
  const target = await handle(page, targetId, 'value').boundingBox();
  return { source: Math.hypot(geometry.start.x - source.x - source.width, geometry.start.y - source.y - source.height / 2),
    target: Math.hypot(geometry.end.x - target.x, geometry.end.y - target.y - target.height / 2) };
}

async function frames(page, count = 2) {
  await page.evaluate(count => new Promise(resolve => {
    const next = () => --count <= 0 ? resolve() : requestAnimationFrame(next);
    requestAnimationFrame(next);
  }), count);
}

async function dragNode(page, id, dx, dy) {
  const start = await center(node(page, id).locator('.utility-title'));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try { await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 }); }
  finally { await page.mouse.up(); }
  await saved(page);
}

Given('an imported routing workflow with a blocking node', async function () { await importRouting(this); });
Given('an imported routing workflow with a narrow output corridor', async function () { await importRouting(this, { narrowExit: true }); });
Given('an imported routing workflow ready for a new connection', async function () { await importRouting(this, { connected: false }); });
Given('an imported routing workflow with disabled switch controls', async function () {
  await importRouting(this, { connected: false, switchTarget: true });
});
Given('an imported routing workflow with dash gap {int}', async function (gap) {
  this.routingDashGap = gap;
  await importRouting(this, { dashed: true, gap });
});
async function observeRoutingWorkers(page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__routingWorkers = [];
    window.__routingWorkerControls = [];
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (options?.name === 'workflow-edge-routing') {
          this.observation = { index: window.__routingWorkers.length, terminated: 0, requests: 0, held: 0, hold: false,
            holdReplies: false, queued: 0, inFlight: 0, maxInFlight: 0, sent: [], delivered: [] };
          this.deliveries = [];
          window.__routingWorkers.push(this.observation);
          window.__routingWorkerControls.push({ release: () => {
            const deliver = this.deliveries.shift();
            if (!deliver) throw new Error('No routing reply is waiting.');
            this.observation.queued--;
            deliver();
          } });
        }
      }
      postMessage(message, ...options) {
        if (this.observation && message?.kind === 'request') {
          this.observation.requests++;
          this.observation.sent.push(structuredClone({ id: message.id, ...message.args[0] }));
          this.observation.inFlight++;
          this.observation.maxInFlight = Math.max(this.observation.maxInFlight, this.observation.inFlight);
          if (this.observation.hold) { this.observation.held++; return; }
        }
        return super.postMessage(message, ...options);
      }
      addEventListener(type, listener, options) {
        if (this.observation && type === 'message') {
          return super.addEventListener(type, event => {
            const deliver = () => {
              this.observation.inFlight--;
              this.observation.delivered.push({ id: event.data.id, sceneRevision: event.data.value?.sceneRevision,
                preview: event.data.value?.preview });
              if (typeof listener === 'function') listener.call(this, event);
              else listener.handleEvent(event);
            };
            if (this.observation.holdReplies) {
              this.observation.queued++;
              this.deliveries.push(deliver);
            } else deliver();
          }, options);
        }
        return super.addEventListener(type, listener, options);
      }
      terminate() {
        if (this.observation) this.observation.terminated++;
        return super.terminate();
      }
    };
  });
  await page.reload();
}

const routingWorker = page => page.evaluate(() => window.__routingWorkers.findLast(worker => worker.terminated === 0));
async function holdRoutingReplies(page) {
  await expect.poll(async () => (await routingWorker(page))?.inFlight).toBe(0);
  await page.evaluate(() => { window.__routingWorkers.findLast(worker => worker.terminated === 0).holdReplies = true; });
}
async function releaseRoutingReply(page, hold = true) {
  await page.evaluate(hold => {
    const worker = window.__routingWorkers.findLast(worker => worker.terminated === 0);
    worker.holdReplies = hold;
    window.__routingWorkerControls[worker.index].release();
  }, hold);
}
async function waitForHeldReply(page) {
  await expect.poll(async () => (await routingWorker(page))?.queued).toBe(1);
}

Given('an imported routing workflow with observable worker lifetimes', async function () {
  await observeRoutingWorkers(this.page);
  await importRouting(this);
});
Given('an unconnected routing workflow with observable worker replies', async function () {
  await observeRoutingWorkers(this.page);
  await importRouting(this, { connected: false });
});
Given('a routing workflow with native handles and observable worker replies', async function () {
  await observeRoutingWorkers(this.page);
  await importRouting(this, { connected: false, nativeHandles: true });
});

Then('the routed connection clears the blocker and meets its measured handles', async function () {
  await expectClearRoute(this.page);
  const geometry = await pathGeometry(route(this.page));
  const blocker = await node(this.page, 'routing-blocker').boundingBox();
  assert.ok(geometry.start.x < blocker.x && geometry.end.x > blocker.x + blocker.width &&
    [geometry.start.y, geometry.end.y].every(y => y > blocker.y && y < blocker.y + blocker.height),
  'The measured blocker must obstruct the direct connection so clearance requires a detour.');
  const errors = await endpointErrors(this.page);
  assert.ok(errors.source < 1 && errors.target < 1, `Measured attachment errors: ${JSON.stringify(errors)}`);
  await expect(route(this.page)).toHaveCSS('stroke-width', '20px');
});

Then('moving the routed target keeps its endpoint attached in every sampled frame', async function () {
  const page = this.page;
  await expectClearRoute(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const start = await center(node(page, 'routing-target').locator('.utility-title'));
  const original = await route(page).getAttribute('d');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    for (const [dx, dy] of [[-40, 25], [-85, 80], [0, 120], [-30, 45]]) {
      await page.mouse.move(start.x + dx, start.y + dy);
      await frames(page);
      const errors = await endpointErrors(page);
      assert.ok(errors.source < 1 && errors.target < 1, `A moving handle must stay attached: ${JSON.stringify(errors)}`);
    }
  } finally { await page.mouse.up(); }
  assert.notEqual(await route(page).getAttribute('d'), original, 'The target must actually move.');
  await expectClearRoute(page);
});

Then('its raw pointer line and translucent snapped route survive a body drop', async function () {
  const page = this.page;
  const drop = await center(node(page, 'routing-target').locator('.utility-title strong'));
  await beginConnection(page);
  await page.mouse.move(drop.x, drop.y, { steps: 12 });
  await expect(ghost(page)).toHaveAttribute('data-target', 'routing-target');
  await expect(ghost(page)).toHaveAttribute('data-target-handle', 'value');
  await expect(ghost(page)).toHaveCSS('opacity', '0.35');
  const raw = workflow(page).locator('.svelte-flow__connection-path:not(.svelte-flow__connection-snap)');
  await expect.poll(async () => {
    const end = (await pathGeometry(raw)).end;
    return Math.hypot(end.x - drop.x, end.y - drop.y);
  }).toBeLessThan(1);
  await expect.poll(async () => (await pathGeometry(ghost(page).locator('path'))).intersections).toBe(0);
  const preview = await ghost(page).locator('path').getAttribute('d');
  await page.evaluate(() => {
    window.__routingDropPaths = [];
    const capture = () => {
      const path = document.querySelector('.svelte-flow__edge .svelte-flow__edge-interaction');
      if (path?.getAttribute('d')) window.__routingDropPaths.push(path.getAttribute('d'));
    };
    window.__routingDropObserver = new MutationObserver(capture);
    window.__routingDropObserver.observe(document.querySelector('.svelte-flow'), { subtree: true, childList: true, attributes: true, attributeFilter: ['d'] });
  });
  try {
    await page.mouse.up();
    await expect(workflow(page).locator('.svelte-flow__edge')).toHaveCount(1);
    await expect(ghost(page)).toHaveCount(0);
    await expect(raw).toHaveCount(0);
    const paths = await page.evaluate(() => window.__routingDropPaths);
    assert.ok(paths.length > 0, 'The edge insertion must be observed.');
    assert.equal(paths[0], preview, 'The first dropped edge must inherit the exact routed snap preview.');
  } finally {
    await page.evaluate(() => window.__routingDropObserver.disconnect());
    await page.mouse.up();
  }
});

Then('dropping a routed connection over its disabled {word} finishes the connection', async function (kind) {
  const page = this.page;
  const control = kind === 'button' ? node(page, 'routing-target').getByRole('button', { name: 'Remove gate 1', exact: true })
    : node(page, 'routing-target').getByRole('textbox', { name: 'Gate 1 value', exact: true });
  await expect(control).toBeDisabled();
  const drop = await center(control);
  await beginConnection(page);
  await page.mouse.move(drop.x, drop.y, { steps: 12 });
  await expect(ghost(page)).toHaveAttribute('data-target', 'routing-target');
  await page.mouse.up();
  await expect(workflow(page).locator('.svelte-flow__edge')).toHaveCount(1);
  await expect(ghost(page)).toHaveCount(0);
  await expect(workflow(page).locator('.svelte-flow__connection')).toHaveCount(0);
  const document = (await readExport(page)).document;
  assert.deepEqual(document.edges.map(({ id, ...connection }) => connection), [{ kind: 'mapping',
    source: 'routing-source', sourceHandle: 'result', target: 'routing-target', targetHandle: 'value' }]);
});

async function dashSnapshot(page) {
  return workflow(page).locator('.flow-routing-dash').evaluateAll(paths => paths.map(path => {
    const length = path.getTotalLength();
    const start = path.getPointAtLength(0), end = path.getPointAtLength(length);
    const style = getComputedStyle(path);
    return { edge: path.closest('.svelte-flow__edge').dataset.id, d: path.getAttribute('d'),
      start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y },
      dash: style.strokeDasharray.split(/[ ,]+/).map(parseFloat), offset: parseFloat(style.strokeDashoffset),
      animation: style.animationName };
  }));
}

function expectSharedPhase(segments, gap, length = 8) {
  const period = length + gap;
  for (const segment of segments) {
    assert.deepEqual(segment.dash, [length, gap], 'Every routed dash must use the configured length and gap.');
    assert.equal(segment.animation, 'none', 'Each segment must inherit the shared clock.');
  }
  let overlaps = 0;
  for (const [index, a] of segments.entries()) for (const b of segments.slice(index + 1)) {
    if (a.edge === b.edge || !/^M[^AQC]*L[^AQC]*$/i.test(a.d) || !/^M[^AQC]*L[^AQC]*$/i.test(b.d)) continue;
    const axis = Math.abs(a.start.y - a.end.y) < 0.01 ? 'x' : 'y';
    const fixed = axis === 'x' ? 'y' : 'x';
    const direction = Math.sign(a.end[axis] - a.start[axis]);
    if (Math.abs(a.start[fixed] - b.start[fixed]) > 0.01 || Math.abs(b.start[fixed] - b.end[fixed]) > 0.01 ||
      direction !== Math.sign(b.end[axis] - b.start[axis])) continue;
    const low = Math.max(Math.min(a.start[axis], a.end[axis]), Math.min(b.start[axis], b.end[axis]));
    const high = Math.min(Math.max(a.start[axis], a.end[axis]), Math.max(b.start[axis], b.end[axis]));
    if (high - low < 8) continue;
    const point = (low + high) / 2;
    const difference = Math.abs((Math.abs(point - a.start[axis]) + a.offset - Math.abs(point - b.start[axis]) - b.offset) % period);
    assert.ok(Math.min(difference, period - difference) < 0.05, 'Shared coordinates must display the same dash phase.');
    overlaps++;
  }
  assert.ok(overlaps > 0, 'The fixture must contain overlapping straight segments from different edges.');
}

Then('a later connection shares animated dash phase along overlapping routed segments', async function () {
  const page = this.page;
  await expectClearRoute(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(workflow(page).locator('.flow-routing-dashes').first()).toBeVisible();
  const first = await dashSnapshot(page);
  await expect.poll(async () => (await dashSnapshot(page))[0]?.offset).not.toBe(first[0].offset);
  const target = await center(handle(page, 'routing-later', 'value'));
  await beginConnection(page);
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
  await expect(workflow(page).locator('.svelte-flow__edge')).toHaveCount(2);
  await expect.poll(async () => new Set((await dashSnapshot(page)).map(segment => segment.edge)).size).toBe(2);
  for (let sample = 0; sample < 4; sample++) {
    expectSharedPhase(await dashSnapshot(page), this.routingDashGap);
    await frames(page, 3);
  }
});

Then('reduced motion keeps the routed dashes stationary', async function () {
  const page = this.page;
  await expectClearRoute(page);
  await expect(workflow(page).locator('.flow-routing-dashes').first()).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const animated = await dashSnapshot(page);
  await expect.poll(async () => (await dashSnapshot(page))[0]?.offset).not.toBe(animated[0].offset);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await frames(page);
  const still = await dashSnapshot(page);
  await frames(page, 10);
  assert.deepEqual(await dashSnapshot(page), still, 'Reduced motion must freeze every routed dash segment.');
});

// This journey checks both connection styles, repeated settings changes and reload.
// Keep individual Playwright waits short while allowing the complete journey to finish.
Then('dash length gap and speed update existing routes and previews and pause both connection styles', { timeout: 60_000 }, async function () {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expectClearRoute(page);
  const later = await center(handle(page, 'routing-later', 'value'));
  await beginConnection(page);
  await page.mouse.move(later.x, later.y, { steps: 12 });
  await page.mouse.up();
  await expect(workflow(page).locator('.svelte-flow__edge')).toHaveCount(2);
  await saved(page);
  let baseline = (await readExport(page)).document;
  let history = await repository(page, 'history', baseline.id);
  const flow = workflow(page).locator('.svelte-flow');
  const curvedPaths = workflow(page).locator('.svelte-flow__edge .svelte-flow__edge-path:not(.flow-routing-dash):not(.flow-routing-dash-base)');
  const change = async values => {
    await setWorkflowDashValues(page, values);
    await setMode(page, 'workflow');
  };
  const clock = async (locator, length, gap, speed) => {
    await expect.poll(() => locator.evaluate(element => {
      const style = getComputedStyle(element);
      return { period: Number(style.getPropertyValue('--flow-routing-dash-period')),
        duration: parseFloat(style.animationDuration), state: style.animationPlayState };
    })).toEqual({ period: length + gap, duration: (length + gap) / Math.max(1, speed), state: speed ? 'running' : 'paused' });
  };
  const preview = async (length, gap) => {
    const target = await center(handle(page, 'routing-blocker', 'value'));
    await beginConnection(page);
    try {
      await page.mouse.move(target.x, target.y, { steps: 12 });
      await expect(ghost(page)).toHaveAttribute('data-target', 'routing-blocker');
      await expect(ghost(page).locator('path')).toHaveCSS('stroke-dasharray', `${length}px, ${gap}px`);
    } finally {
      await page.keyboard.press('Escape');
      await page.mouse.up();
    }
    await expect(ghost(page)).toHaveCount(0);
    await expect(workflow(page).locator('.svelte-flow__edge')).toHaveCount(2);
  };
  const curvedSnapshot = () => curvedPaths.evaluateAll(paths => paths.map(path => {
    const style = getComputedStyle(path);
    return { dash: style.strokeDasharray.split(/[ ,]+/).map(parseFloat), offset: parseFloat(style.strokeDashoffset) };
  }));
  await change({ dashLength: 11, dashGap: 7, dashSpeed: 30 });
  await expect.poll(async () => new Set((await dashSnapshot(page)).map(segment => segment.edge)).size).toBe(2);
  await clock(flow, 11, 7, 30);
  for (let sample = 0; sample < 3; sample++) {
    expectSharedPhase(await dashSnapshot(page), 7, 11);
    await frames(page, 3);
  }
  const moving = await dashSnapshot(page);
  await expect.poll(async () => (await dashSnapshot(page))[0].offset).not.toBe(moving[0].offset);
  await preview(11, 7);
  await change({ dashSpeed: 0 });
  await clock(flow, 11, 7, 0);
  const paused = await dashSnapshot(page);
  await frames(page, 10);
  assert.deepEqual(await dashSnapshot(page), paused, 'Zero speed must freeze every orthogonal dash segment.');
  await change({ dashSpeed: 60 });
  await clock(flow, 11, 7, 60);
  await expect.poll(async () => (await dashSnapshot(page))[0].offset).not.toBe(paused[0].offset);
  expectSharedPhase(await dashSnapshot(page), 7, 11);
  assert.deepEqual((await readExport(page)).document, baseline, 'Dash appearance remains a browser preference.');
  assert.deepEqual(await repository(page, 'history', baseline.id), history);

  await toggleConnectionStyle(page);
  await expect(route(page)).toHaveAttribute('d', /^M.* C/);
  await expect(curvedPaths).toHaveCount(2);
  await saved(page);
  baseline = (await readExport(page)).document;
  history = await repository(page, 'history', baseline.id);
  await change({ dashLength: 19, dashGap: 5, dashSpeed: 24 });
  for (const path of await curvedPaths.all()) {
    await expect(path).toHaveCSS('stroke-dasharray', '19px, 5px');
    await clock(path, 19, 5, 24);
  }
  await preview(19, 5);
  await change({ dashSpeed: 0 });
  for (const path of await curvedPaths.all()) await clock(path, 19, 5, 0);
  const curvedPaused = await curvedSnapshot();
  await frames(page, 10);
  assert.deepEqual(await curvedSnapshot(), curvedPaused, 'Zero speed must freeze both curved connections.');
  await change({ dashSpeed: 48 });
  for (const path of await curvedPaths.all()) await clock(path, 19, 5, 48);
  await expect.poll(async () => (await curvedSnapshot())[0].offset).not.toBe(curvedPaused[0].offset);
  assert.deepEqual((await readExport(page)).document, baseline);
  assert.deepEqual(await repository(page, 'history', baseline.id), history, 'Dash changes must not add workflow history.');
  await page.reload();
  await setMode(page, 'workflow');
  await expect(curvedPaths).toHaveCount(2);
  for (const path of await curvedPaths.all()) {
    await expect(path).toHaveCSS('stroke-dasharray', '19px, 5px');
    await clock(path, 19, 5, 48);
  }
});

async function changeCurveStrength(page, value) {
  await setMode(page, 'settings');
  const settings = page.getByRole('region', { name: 'Settings workspace', exact: true });
  const group = settings.locator('summary[aria-label="Application"]');
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
  const input = settings.getByRole('textbox', { name: 'Curve strength value', exact: true });
  await input.fill(String(value));
  await input.press('Tab');
  await expect.poll(async () => (await storedDefaults(page)).curveStrength).toBe(value);
  await setMode(page, 'workflow');
}

Then('changing curve strength changes safe routed bends without changing its endpoints', async function () {
  const page = this.page;
  // Leave room for different radii; tight corridors legitimately clamp both
  // strengths to the same sharp bend and cannot prove this setting changes.
  await dragNode(page, 'routing-blocker', 0, 300);
  await dragNode(page, 'routing-target', 0, -180);
  await toggleConnectionStyle(page);
  const values = [];
  for (const strength of [50, 200, 1000]) {
    await changeCurveStrength(page, strength);
    await expect(route(page)).toHaveAttribute('d', /^M.* C/);
    await expectClearRoute(page);
    values.push(await route(page).getAttribute('d'));
    const errors = await endpointErrors(page);
    assert.ok(errors.source < 1 && errors.target < 1, 'Curved paths must retain measured endpoints.');
  }
  assert.notEqual(values[0], values[1], 'Strength must change safe bends without changing the routed corridor.');
  await changeCurveStrength(page, 0);
  await expect(route(page)).not.toHaveAttribute('d', / A/);
  await expectClearRoute(page);
  await toggleConnectionStyle(page);
  await expectClearRoute(page);
});

Then('moving and undoing the blocker restores its derived route without saving routing state', async function () {
  const page = this.page;
  await expectClearRoute(page);
  const originalPath = await route(page).getAttribute('d');
  await dragNode(page, 'routing-blocker', 0, 190);
  await expect.poll(() => route(page).getAttribute('d')).not.toBe(originalPath);
  const changed = (await readExport(page)).document;
  assert.deepEqual(changed.edges, this.routingBaseline.edges, 'Derived routing must not add fields to saved edges.');
  assert.deepEqual(Object.keys(changed).sort(), Object.keys(this.routingBaseline).sort(), 'Routing must not add document state.');
  for (const item of changed.nodes) assert.deepEqual(Object.keys(item).sort(), ['data', 'id', 'position', 'type']);
  await page.reload();
  await setMode(page, 'workflow');
  await expectClearRoute(page);
  assert.deepEqual((await readExport(page)).document, changed, 'Reload must retain the graph document exactly.');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  await expect(route(page)).toHaveAttribute('d', originalPath);
  const restored = (await readExport(page)).document;
  assert.deepEqual(restored.nodes, this.routingBaseline.nodes);
  assert.deepEqual(restored.edges, this.routingBaseline.edges);
  const persisted = (await storedWorkflows(page)).find(document => document.id === restored.id);
  assert.deepEqual(persisted, restored);
  const history = await repository(page, 'inspect', restored.id);
  for (const version of history.versions) {
    const document = JSON.parse(version.text);
    assert.deepEqual(document.edges, restored.edges, 'Every durable version must contain connections without routing caches.');
  }
});

Then('pending routing work closes with the canvas and reopening creates one fresh worker', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 1000, height: 844 });
  const observations = () => page.evaluate(() => window.__routingWorkers);
  const live = async () => (await observations()).filter(worker => worker.terminated === 0);
  await expectClearRoute(page);
  await expect.poll(async () => (await live()).length).toBe(1);
  await page.evaluate(() => { window.__routingWorkers.find(worker => worker.terminated === 0).hold = true; });
  const target = await center(node(page, 'routing-later').locator('.utility-title strong'));
  await beginConnection(page);
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await expect.poll(async () => (await live())[0]?.held).toBe(1);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  const before = (await observations()).length;
  await setMode(page, 'settings');
  await expect.poll(async () => (await live()).length).toBe(0);
  assert.ok((await observations()).every(worker => worker.terminated === 1),
    'Every inactive routing worker must terminate exactly once, even with a pending calculation.');
  await setMode(page, 'workflow');
  await expectClearRoute(page);
  await expect.poll(async () => (await live()).length).toBe(1);
  assert.equal((await observations()).length, before + 1, 'Reopening must create exactly one fresh routing worker.');
  await toggleConnectionStyle(page);
  await expectClearRoute(page);
  await expect.poll(async () => (await live()).length).toBe(1);
  await toggleConnectionStyle(page);
  await expectClearRoute(page);
  await expect.poll(async () => (await live()).length).toBe(1);
  assert.equal((await observations()).length, before + 1, 'Switching styles must reuse the same routing worker.');
});

async function settledGhost(page, target) {
  await expect(ghost(page)).toHaveAttribute('data-target', target);
  await expect.poll(async () => (await routingWorker(page)).delivered.at(-1)?.preview?.target).toBe(target);
  await expect.poll(async () => (await routingWorker(page)).inFlight).toBe(0);
  await frames(page);
}

async function observeFirstDroppedPath(page) {
  await page.evaluate(() => {
    window.__routingDropPaths = [];
    window.__routingDropObserver = new MutationObserver(() => {
      const path = document.querySelector('.svelte-flow__edge .svelte-flow__edge-interaction');
      if (path?.getAttribute('d')) window.__routingDropPaths.push(path.getAttribute('d'));
    });
    window.__routingDropObserver.observe(document.querySelector('.svelte-flow'),
      { subtree: true, childList: true, attributes: true, attributeFilter: ['d'] });
  });
}

async function firstDroppedPath(page) {
  await expect(workflow(page).locator('.svelte-flow__edge')).toHaveCount(1);
  await expect(ghost(page)).toHaveCount(0);
  return page.evaluate(() => {
    window.__routingDropObserver.disconnect();
    return window.__routingDropPaths[0];
  });
}

Then('rapid node movement retains one calculation and only the newest pending scene', async function () {
  const page = this.page;
  await expectClearRoute(page);
  await holdRoutingReplies(page);
  const before = await routingWorker(page);
  const start = await center(node(page, 'routing-target').locator('.utility-title'));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    // Cross XYFlow's activation threshold before waiting for a changed scene.
    await page.mouse.move(start.x + 4, start.y + 4);
    await page.mouse.move(start.x - 30, start.y + 25);
    await waitForHeldReply(page);
    for (const [dx, dy] of [[-80, 60], [-120, 100], [-60, 160], [-30, 200]]) {
      await page.mouse.move(start.x + dx, start.y + dy);
      await frames(page);
    }
  } finally { await page.mouse.up(); }
  await frames(page);
  const pending = await routingWorker(page);
  assert.equal(pending.requests, before.requests + 1, 'Pointer updates must not post additional calculations while one is in flight.');
  assert.equal(pending.inFlight, 1);
  assert.equal(pending.maxInFlight, 1);
  const projected = await route(page).getAttribute('d');
  const latest = await node(page, 'routing-target').evaluate(element => {
    const position = new DOMMatrix(element.style.transform);
    return { x: position.e, y: position.f };
  });
  await releaseRoutingReply(page);
  await waitForHeldReply(page);
  const after = await routingWorker(page);
  assert.equal(after.requests, before.requests + 2, 'The settled calculation must be followed by exactly one latest scene.');
  const submitted = after.sent.at(-1).scene.nodes.find(item => item.id === 'routing-target');
  assert.deepEqual({ x: submitted.x, y: submitted.y }, latest, 'The pending scene must use the latest measured node position.');
  assert.ok(after.sent.at(-1).sceneRevision > pending.sent.at(-1).sceneRevision);
  assert.equal(await route(page).getAttribute('d'), projected, 'An old scene reply must not replace the currently projected route.');
  await releaseRoutingReply(page, false);
  await expect.poll(async () => (await routingWorker(page)).inFlight).toBe(0);
  await expectClearRoute(page);
  assert.equal((await routingWorker(page)).maxInFlight, 1);
});

Then('a delayed reply from a cancelled drag cannot change the next drag preview', async function () {
  const page = this.page;
  const oldTarget = await center(node(page, 'routing-target').locator('.utility-title strong'));
  const laterTarget = await center(node(page, 'routing-later').locator('.utility-title strong'));
  await beginConnection(page);
  await page.mouse.move(oldTarget.x, oldTarget.y, { steps: 8 });
  await settledGhost(page, 'routing-target');
  await holdRoutingReplies(page);
  await page.mouse.move(laterTarget.x, laterTarget.y);
  await waitForHeldReply(page);
  const old = (await routingWorker(page)).sent.at(-1);
  assert.equal(old.preview.target, 'routing-later');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(ghost(page)).toHaveCount(0);
  await beginConnection(page);
  await page.mouse.move(oldTarget.x, oldTarget.y, { steps: 8 });
  await expect(ghost(page)).toHaveAttribute('data-target', 'routing-target');
  const fresh = await ghost(page).locator('path').getAttribute('d');
  await releaseRoutingReply(page);
  await waitForHeldReply(page);
  const current = (await routingWorker(page)).sent.at(-1);
  assert.equal(current.sceneRevision, old.sceneRevision, 'This must exercise drag-session protection within the same scene.');
  assert.ok(current.previewSession > old.previewSession, 'The second drag must have a distinct session.');
  assert.equal(current.preview.target, 'routing-target');
  assert.equal(await ghost(page).locator('path').getAttribute('d'), fresh,
    'The previous drag reply must not seed a detour into the new drag.');
  await releaseRoutingReply(page, false);
  await settledGhost(page, 'routing-target');
  await expect.poll(async () => (await pathGeometry(ghost(page).locator('path'))).intersections).toBe(0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(workflow(page).locator('.svelte-flow__edge')).toHaveCount(0);
  assert.equal((await routingWorker(page)).maxInFlight, 1);
});

Then('changing snap targets with a delayed reply preserves the first dropped edge geometry', async function () {
  const page = this.page;
  const original = await center(node(page, 'routing-target').locator('.utility-title strong'));
  const latest = await center(node(page, 'routing-later').locator('.utility-title strong'));
  await beginConnection(page);
  await page.mouse.move(original.x, original.y, { steps: 8 });
  await settledGhost(page, 'routing-target');
  await expect.poll(async () => (await pathGeometry(ghost(page).locator('path'))).intersections).toBe(0);
  const originalPath = await ghost(page).locator('path').getAttribute('d');
  await holdRoutingReplies(page);
  await page.mouse.move(latest.x, latest.y);
  await expect(ghost(page)).toHaveAttribute('data-target', 'routing-later');
  await waitForHeldReply(page);
  const projected = await ghost(page).locator('path').getAttribute('d');
  assert.notEqual(projected, originalPath, 'The ghost must already project to the newly selected target.');
  assert.equal((await routingWorker(page)).delivered.at(-1).preview.target, 'routing-target',
    'The renderer must still be using the earlier target calculation.');
  await observeFirstDroppedPath(page);
  await page.mouse.up();
  assert.equal(await firstDroppedPath(page), projected,
    'The first completed edge must keep the visible projected detour before the new target reply arrives.');
  await releaseRoutingReply(page);
  await waitForHeldReply(page);
  assert.equal(await workflow(page).locator('.svelte-flow__edge-interaction').getAttribute('d'), projected,
    'The outdated preview reply must not displace the inherited completed edge.');
  await releaseRoutingReply(page, false);
  const document = (await readExport(page)).document;
  assert.equal(document.edges[0].target, 'routing-later');
});

Then('a reverse handle drag preserves the preview geometry when its edge direction is normalized', async function () {
  const page = this.page;
  const from = node(page, 'routing-target').locator('.svelte-flow__handle.target');
  const to = node(page, 'routing-source').locator('.svelte-flow__handle.source');
  await expect(from).toHaveClass(/connectablestart/);
  const start = await center(from), end = await center(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 10, start.y, { steps: 3 });
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await settledGhost(page, 'routing-source');
  const preview = await ghost(page).locator('path').getAttribute('d');
  await holdRoutingReplies(page);
  await observeFirstDroppedPath(page);
  await page.mouse.up();
  const completed = await firstDroppedPath(page);
  assert.ok(completed, 'The first reverse-created edge must be observed.');
  const difference = await page.evaluate(({ preview, completed }) => {
    const paths = [preview, completed].map(d => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      return path;
    });
    const lengths = paths.map(path => path.getTotalLength());
    let difference = Math.abs(lengths[0] - lengths[1]);
    for (let index = 0; index <= 80; index++) {
      const before = paths[0].getPointAtLength(lengths[0] * index / 80);
      const after = paths[1].getPointAtLength(lengths[1] * (1 - index / 80));
      difference = Math.max(difference, Math.hypot(before.x - after.x, before.y - after.y));
    }
    return difference;
  }, { preview, completed });
  assert.ok(difference < 0.05, `Reversing connection ownership must preserve its visible route (difference ${difference}).`);
  const document = (await readExport(page)).document;
  assert.equal(document.edges[0].source, 'routing-source');
  assert.equal(document.edges[0].target, 'routing-target');
});

async function minimumNodeClearance(path, nodeId) {
  return path.evaluate((element, nodeId) => {
    const matrix = element.getScreenCTM();
    const zoom = Math.hypot(matrix.a, matrix.b);
    const bounds = document.querySelector(`.svelte-flow__node[data-id="${nodeId}"]`).getBoundingClientRect();
    const length = element.getTotalLength();
    let minimum = Infinity;
    for (let distance = 0; distance <= length; distance += 0.5) {
      const point = element.getPointAtLength(distance);
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      const dx = Math.max(bounds.left - screen.x, 0, screen.x - bounds.right);
      const dy = Math.max(bounds.top - screen.y, 0, screen.y - bounds.bottom);
      minimum = Math.min(minimum, Math.hypot(dx, dy) / zoom);
    }
    return minimum;
  }, nodeId);
}

Then('changing node clearance preserves measured spacing without changing the workflow document', async function () {
  const page = this.page;
  await expectClearRoute(page);
  await expect.poll(() => minimumNodeClearance(route(page), 'routing-blocker'),
    { message: 'The default route must leave sixteen diagram units around the measured blocker.' }).toBeGreaterThanOrEqual(15.5);
  const originalPath = await route(page).getAttribute('d');
  const originalDocument = (await readExport(page)).document;
  assert.equal((await storedDefaults(page)).nodeClearance, 16);
  await setWorkflowNodeClearance(page, 36);
  await setMode(page, 'workflow');
  await expect.poll(() => route(page).getAttribute('d')).not.toBe(originalPath);
  await expect.poll(() => minimumNodeClearance(route(page), 'routing-blocker'),
    { message: 'Changing the setting must reroute the existing edge with the new minimum spacing.' }).toBeGreaterThanOrEqual(35.5);
  const changedPath = await route(page).getAttribute('d');
  assert.deepEqual((await readExport(page)).document, originalDocument,
    'Node clearance is an application preference; changing it must preserve the workflow and its node positions.');
  const attachment = await endpointErrors(page);
  assert.ok(attachment.source < 1 && attachment.target < 1, 'Clearance must preserve exact handle attachment.');
  await page.reload();
  assert.equal((await storedDefaults(page)).nodeClearance, 36);
  await setMode(page, 'workflow');
  await expect(route(page)).toHaveAttribute('d', changedPath);
  assert.ok(await minimumNodeClearance(route(page), 'routing-blocker') >= 35.5,
    'Reloading must retain the configured separation from the measured node body.');
  assert.deepEqual((await readExport(page)).document, originalDocument);
});

Then('its narrow output corridor preserves {int} units around unconstrained node faces', async function (clearance) {
  const page = this.page;
  if (clearance !== 16) {
    await setWorkflowNodeClearance(page, clearance);
    await setMode(page, 'workflow');
  }
  await expect(route(page)).toHaveAttribute('d', /^M.+/);
  const terminalGap = await route(page).evaluate(element => {
    const zoom = Math.hypot(element.getScreenCTM().a, element.getScreenCTM().b);
    const source = document.querySelector('.svelte-flow__node[data-id="routing-source"] .svelte-flow__handle[data-handleid="result"]').getBoundingClientRect();
    const blocker = document.querySelector('.svelte-flow__node[data-id="routing-blocker"]').getBoundingClientRect();
    return (blocker.left - source.right) / zoom;
  });
  assert.ok(terminalGap > 0 && terminalGap < 12,
    `The measured output corridor must be narrower than either tested clearance (gap ${terminalGap}).`);
  const faceClearances = () => route(page).evaluate(element => {
    const matrix = element.getScreenCTM(), zoom = Math.hypot(matrix.a, matrix.b);
    const nodes = ['routing-source', 'routing-target'].map(id => ({ id,
      bounds: document.querySelector(`.svelte-flow__node[data-id="${id}"]`).getBoundingClientRect(),
      clearance: Infinity, firstX: Infinity, lastX: -Infinity }));
    const length = element.getTotalLength();
    for (let distance = 0; distance <= length; distance += 0.5) {
      const point = element.getPointAtLength(distance);
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      for (const item of nodes) {
        // Exclude the source's constrained right face and the target's left
        // handle stem; every route crossing a node's width must clear its body.
        if (screen.x < item.bounds.left || screen.x > item.bounds.right) continue;
        item.clearance = Math.min(item.clearance,
          Math.max(item.bounds.top - screen.y, 0, screen.y - item.bounds.bottom) / zoom);
        item.firstX = Math.min(item.firstX, screen.x);
        item.lastX = Math.max(item.lastX, screen.x);
      }
    }
    return nodes.map(item => ({ id: item.id, clearance: item.clearance,
      coveredWidth: (item.lastX - item.firstX) / item.bounds.width }));
  });
  await expect.poll(async () => Math.min(...(await faceClearances()).map(item => item.clearance)),
    { message: 'A narrow terminal corridor must not remove clearance from the other node faces.' })
    .toBeGreaterThanOrEqual(clearance - 0.5);
  for (const item of await faceClearances()) assert.ok(item.coveredWidth > 0.9,
    `The route must cross the width of ${item.id}, so its top/bottom clearance check cannot be vacuous.`);
  const attachment = await endpointErrors(page);
  assert.ok(attachment.source < 1 && attachment.target < 1, 'Local clearance relaxation must preserve exact handle attachment.');
});
