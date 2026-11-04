// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { installAssistantFixture, loadAssistantModel, installDecisionFixture } from './browser-assistant.fixture.mjs';
import { setMode } from './workspace.fixture.mjs';
import { loadGraphFixture } from './workflow-graph.fixture.mjs';

async function openAssistant(page) {
  await setMode(page, 'settings');
  const mode = page.getByRole('switch', { name: 'AI assistant', exact: true });
  if (await mode.getAttribute('aria-checked') !== 'true') await mode.click();
  return page.getByRole('region', { name: 'Browser assistant', exact: true });
}
async function openConfiguration(panel) {
  const page = panel.page();
  await panel.getByRole('button', { name: 'Assistant configuration', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'AI assistant', exact: true })).toHaveAttribute('aria-checked', 'false');
  const configuration = page.locator('#assistant-configuration-panel');
  await expect(configuration).toBeVisible();
  return configuration;
}

async function graph(page) {
  await loadGraphFixture(page, { version: 3, id: 'assistant-test', name: 'Assistant test', nodes: [
    { id: 'assistant-cast', type: 'cast', position: { x: 100, y: 100 }, data: { targetType: 'Text' } },
    { id: 'assistant-stop', type: 'stop', position: { x: 400, y: 100 }, data: {} },
  ], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false });
}
function consumeExpectedError(world, message) {
  const matching = world.diagnostics.filter(item => item.type === 'console-error' && item.message.includes(message));
  expect(matching).toHaveLength(1);
  world.diagnostics = world.diagnostics.filter(item => !matching.includes(item));
}
Then('the pane switches between settings and assistant without losing its session', async function() {
  const page = this.page;
  await installAssistantFixture(page);
  await setMode(page, 'workflow');
  const header = page.getByRole('banner');
  const aiButton = header.getByRole('button', { name: 'AI assistant', exact: true });
  const settingsButton = header.getByRole('button', { name: 'Settings', exact: true });
  const headerPositions = await Promise.all([aiButton.boundingBox(), settingsButton.boundingBox()]);
  expect(headerPositions[0].x + headerPositions[0].width).toBeCloseTo(headerPositions[1].x, 2);
  await expect(aiButton.locator('.material-symbols-rounded')).toHaveText('robot');
  await aiButton.click();
  const mode = page.getByRole('switch', { name: 'AI assistant', exact: true });
  const theme = page.getByRole('switch', { name: 'Dark theme', exact: true });
  const application = page.locator('summary[aria-label="Application"]');
  await page.mouse.move(0, 0);
  const controlHeight = await aiButton.evaluate(el => el.offsetHeight);
  await expect.poll(async () => {
    const bounds = await Promise.all([aiButton, settingsButton, mode, theme].map(control => control.boundingBox()));
    return Math.max(...bounds.map(box => Math.abs(box.height - controlHeight)));
  }).toBeLessThan(0.1);
  const aligned = await Promise.all([aiButton, settingsButton, mode, theme].map(control => control.boundingBox()));
  expect(Math.max(...aligned.map(box => box.y)) - Math.min(...aligned.map(box => box.y))).toBeLessThan(0.5);
  const expectHighlight = async (control, iconName) => {
    await expect.poll(async () => {
      const [thumb, icon] = await Promise.all([control.locator('.switch-thumb').boundingBox(), control.locator('.material-symbols-rounded').filter({ hasText: new RegExp(`^${iconName}$`) }).boundingBox()]);
      return Math.max(Math.abs(thumb.x + thumb.width / 2 - icon.x - icon.width / 2), Math.abs(thumb.y + thumb.height / 2 - icon.y - icon.height / 2));
    }).toBeLessThan(0.5);
  };
  await expectHighlight(mode, 'robot');
  await expectHighlight(theme, await theme.getAttribute('aria-checked') === 'true' ? 'dark_mode' : 'light_mode');
  await expect(mode).toHaveAttribute('aria-checked', 'true');
  await expect(aiButton).toHaveAttribute('aria-pressed', 'true');
  await expect(settingsButton).toHaveAttribute('aria-pressed', 'false');
  const robot = mode.locator('.material-symbols-rounded').filter({ hasText: /^robot$/ });
  const tune = mode.locator('.material-symbols-rounded').filter({ hasText: /^tune$/ });
  const icons = await Promise.all([robot.boundingBox(), tune.boundingBox(), mode.locator('.switch-thumb').boundingBox()]);
  expect(icons[0].x).toBeLessThan(icons[1].x);
  expect(icons[2].x).toBeLessThan(icons[1].x);
  await settingsButton.click();
  await expect(settingsButton).toHaveAttribute('aria-pressed', 'true');
  await expect(aiButton).toHaveAttribute('aria-pressed', 'false');
  await expectHighlight(mode, 'tune');
  await application.click();
  const positions = await Promise.all([mode.boundingBox(), theme.boundingBox()]);
  expect(positions[0].x + positions[0].width).toBeLessThan(positions[1].x);
  await mode.focus();
  await page.keyboard.press('Space');
  const panel = page.getByRole('region', { name: 'Browser assistant', exact: true });
  await expect(panel).toBeVisible();
  await expect(application).toBeHidden();
  expect(await page.evaluate(() => window.assistantFixture.workers)).toBe(0);
  await loadAssistantModel(page);
  const draft = panel.getByRole('textbox', { name: 'Message', exact: true });
  await draft.fill('Keep my draft while I configure the app');
  await settingsButton.click();
  await expect(application).toBeVisible();
  await expect(application).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toBeHidden();
  expect(await page.evaluate(() => window.assistantFixture.terminated)).toBe(0);
  await aiButton.click();
  await expect(draft).toHaveValue('Keep my draft while I configure the app');
  await expect(panel.getByRole('button', { name: 'Unload model', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.assistantFixture.workers)).toBe(1);
  await theme.click();
  await expectHighlight(theme, await theme.getAttribute('aria-checked') === 'true' ? 'dark_mode' : 'light_mode');
  await expect(mode).toHaveAttribute('aria-checked', 'true');
  await aiButton.click();
  await expect(panel).toBeHidden();
  await expect(aiButton).toBeFocused();
  await settingsButton.click();
  await expect(application).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(settingsButton).toBeFocused();
  await aiButton.click();
  await expect(draft).toHaveValue('Keep my draft while I configure the app');
  await page.screenshot({ path: `${this.artifactDirectory}/header-assistant-buttons.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  const narrow = await Promise.all([mode.boundingBox(), theme.boundingBox()]);
  expect(narrow[0].x + narrow[0].width).toBeLessThanOrEqual(narrow[1].x);
  for (const box of narrow) expect(box.height).toBeCloseTo(controlHeight, 1);
  await expectHighlight(mode, 'robot');
  expect(await page.locator('#settings-panel').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: `${this.artifactDirectory}/settings-assistant-switch.png` });
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  await expect(mode).toHaveAttribute('aria-checked', 'true');
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => window.assistantFixture.workers)).toBe(0);
});

Then('AI settings preserve drafts attachments and streamed replies across pane navigation', async function() {
  const page = this.page;
  await page.addInitScript(() => {
    const native = IDBFactory.prototype.open;
    window.aiSettingsHydration = { opens: 0 };
    IDBFactory.prototype.open = function(name, ...args) {
      if (name === 'v1/speech/recordings') window.aiSettingsHydration.opens++;
      return native.call(this, name, ...args);
    };
  });
  await installAssistantFixture(page);
  await setMode(page, 'settings');
  const mode = page.getByRole('switch', { name: 'AI assistant', exact: true });
  if (await mode.getAttribute('aria-checked') === 'true') await mode.click();
  const heading = page.locator('summary[aria-label="AI"]');
  await expect(heading).toBeVisible();
  expect(await page.evaluate(() => window.aiSettingsHydration.opens)).toBe(0);
  await heading.click();
  const configuration = page.locator('#assistant-configuration-panel');
  await expect(configuration).toBeVisible();
  await expect(configuration.getByRole('combobox', { name: 'Language model', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.aiSettingsHydration.opens)).toBe(1);
  await expect(configuration.locator('.speech-settings > summary')).toBeVisible();
  await expect(configuration.locator('.decision-settings > summary')).toBeVisible();
  expect(await page.evaluate(() => window.assistantFixture.workers)).toBe(0);
  const panel = await openAssistant(page);
  await loadAssistantModel(page);
  const draft = panel.getByRole('textbox', { name: 'Message', exact: true });
  await draft.fill('Keep this draft and image');
  const image = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8; return canvas.toDataURL().split(',')[1]; }), 'base64');
  await panel.getByLabel('Attach assistant image', { exact: true }).setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: image });
  await expect(panel.getByRole('img', { name: 'Attachment ready to send', exact: true })).toBeVisible();
  await openConfiguration(panel);
  await expect(panel).toBeHidden();
  await expect(configuration.getByRole('combobox', { name: 'Language model', exact: true })).toBeDisabled();
  await expect(configuration.getByRole('checkbox', { name: 'Application tools', exact: true })).toBeDisabled();
  await expect(configuration.getByRole('button', { name: 'Unload language model', exact: true })).toBeVisible();
  const loaded = await page.evaluate(() => structuredClone(window.assistantFixture.settings));
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.locator('#settings-panel').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `${this.artifactDirectory}/normal-ai-settings-${width}.png` });
  }
  await page.getByRole('switch', { name: 'Dark theme', exact: true }).click();
  await page.screenshot({ path: `${this.artifactDirectory}/normal-ai-settings-other-theme.png` });
  await openAssistant(page);
  await expect(draft).toHaveValue('Keep this draft and image');
  await expect(panel.getByRole('img', { name: 'Attachment ready to send', exact: true })).toBeVisible();
  await page.evaluate(() => window.assistantFixture.behavior = 'manual');
  await draft.press('Enter');
  await page.evaluate(() => window.assistantFixture.emit({ type: 'update', messages: [{ role: 'user', text: 'Keep this draft and image', imageCount: 1 }, { role: 'assistant', text: 'Still working' }], error: '' }));
  await openConfiguration(panel);
  await expect(configuration.getByRole('button', { name: 'Stop and unload language model', exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.assistantFixture.emit({ type: 'update', messages: [{ role: 'user', text: 'Keep this draft and image', imageCount: 1 }, { role: 'assistant', text: 'Finished while Settings was open' }], error: '' });
    window.assistantFixture.emit({ type: 'done' });
  });
  await expect(configuration.getByRole('button', { name: 'Unload language model', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.assistantFixture.settings)).toEqual(loaded);
  expect(await page.evaluate(() => [window.assistantFixture.workers, window.assistantFixture.terminated])).toEqual([1, 0]);
  await openAssistant(page);
  await expect(panel.getByRole('log')).toContainText('Finished while Settings was open');
  expect(await page.evaluate(() => window.aiSettingsHydration.opens)).toBe(1);
  await openConfiguration(panel);
  await configuration.getByRole('button', { name: 'Unload language model', exact: true }).click();
  await expect(configuration.getByRole('combobox', { name: 'Language model', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.assistantFixture.terminated)).toBe(1);
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  await expect(heading).toHaveAttribute('aria-expanded', 'true');
  await expect(configuration).toBeVisible();
});

Then('the assistant settings expose accepted local models and remember configuration', async function() {
  const page = this.page; await installAssistantFixture(page);
  expect(await page.evaluate(() => window.assistantFixture.workers)).toBe(0);
  let panel = await openAssistant(page);
  expect(await page.evaluate(() => window.assistantFixture.workers)).toBe(0);
  const composer = panel.locator('form.composer');
  await expect(panel.getByRole('button', { name: 'Load model', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toHaveAttribute('placeholder', 'Prompt');
  await expect(page.locator('.assistant-configuration')).toBeHidden();
  expect((await panel.locator('.conversation').boundingBox()).height).toBe(0);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const [box, modelRow, prompt, toolbar] = await Promise.all([composer.boundingBox(), composer.locator('.composer-header').boundingBox(), composer.getByRole('textbox').boundingBox(), composer.locator('.composer-toolbar').boundingBox()]);
    expect(box.height).toBeLessThanOrEqual(190);
    expect(modelRow.y + modelRow.height).toBeLessThanOrEqual(prompt.y + 1);
    expect(prompt.y + prompt.height).toBeLessThanOrEqual(toolbar.y + 1);
    expect(await composer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `${this.artifactDirectory}/compact-assistant-${width}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 844 });
  let picker = panel.getByRole('combobox', { name: 'Local model', exact: true });
  await picker.click();
  await expect(page.getByRole('option').locator('.field-select-option-label')).toHaveText(['Bonsai 2 · 2B','Bonsai 2 · 4B','Bonsai 2 · 9B','Bonsai 2 · 27B','Ornith 1.5 · 9B Q4_K_M','Ornith 1.5 · 9B Q8_0','Gemma 4 · E2B','MiniCPM5 · 2.52B','MiniCPM5 · 2.52B · FP32','Ornith 1.5 · 9B · Q4 · FP32','Ornith 1.5 · 9B · Q8 · FP32','LFM3 · 1.7B · Q4 · FP32']);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.assistantFixture.workers)).toBe(0);
  await picker.click();
  await page.getByRole('option', { name: 'Bonsai 2 · 2B', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Unload model', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.assistantFixture.settings.model)).toBe('2b');
  expect(await page.evaluate(() => window.assistantFixture.workers)).toBe(1);
  await panel.getByRole('button', { name: 'Unload model', exact: true }).click();
  let configuration = await openConfiguration(panel);
  await configuration.getByLabel('Workspace editing', { exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(configuration.getByLabel('Workspace editing', { exact: true })).not.toBeChecked();
  await openAssistant(page);
  await picker.click();
  await page.getByRole('option', { name: 'Bonsai 2 · 4B', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Unload model', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.assistantFixture.settings.model)).toBe('4b');
  expect(await page.evaluate(() => window.assistantFixture.settings.editing)).toBe(false);
  await expect(picker).toBeDisabled();
  await panel.getByRole('button', { name: 'Unload model', exact: true }).click();
  await panel.getByRole('button', { name: 'Check compatibility', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('WebGPU compute verified.');
  expect(await page.evaluate(() => window.assistantFixture.terminated)).toBe(3);
  await page.reload(); panel = await openAssistant(page);
  expect(await page.evaluate(() => window.assistantFixture.workers)).toBe(0);
  await expect(panel.getByRole('combobox', { name: 'Local model', exact: true }).locator('.field-select-value')).toHaveText('Bonsai 2 · 4B');
  configuration = await openConfiguration(panel);
  await expect(configuration.getByLabel('Workspace editing', { exact: true })).not.toBeChecked();
  await openAssistant(page);
  picker = panel.getByRole('combobox', { name: 'Local model', exact: true });
  await picker.focus(); await picker.press('Enter'); await picker.press('Enter');
  expect(await page.evaluate(() => window.assistantFixture.settings.model)).toBe('4b');
  await expect(panel.getByRole('button', { name: 'Unload model', exact: true })).toBeVisible();
  await expect(panel.getByRole('combobox', { name: 'Local model', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Unload model', exact: true }).click();
});
Then('the assistant can inspect add move and connect through the workspace UI boundary', async function() {
  const page = this.page; await installAssistantFixture(page); await graph(page);
  const panel = await openAssistant(page), requests = [];
  page.on('request', request => { if (request.url().startsWith('https://example.com/')) requests.push(request.url()); });
  await loadAssistantModel(page);
  await panel.getByRole('textbox', { name: 'Message', exact: true }).fill('Inspect and connect this workspace');
  await panel.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await expect(panel.getByRole('log')).toContainText('Done');
  const calls = await page.evaluate(() => window.assistantFixture.calls);
  for (const name of ['read_workflow','read_application','read_skill','add_operation','move_nodes','read_ports','connect_nodes'])
    expect(calls.filter(call => call.name === name).every(call => !call.error), `${name}: ${JSON.stringify(calls)}`).toBe(true);
  expect(calls.find(call => call.name === 'run_workflow').error).toContain('not available');
  await expect(page.locator('.svelte-flow__node-operation')).toHaveCount(1);
  await expect(page.locator('.svelte-flow__edge:not(.workflow-schema-edge)')).toHaveCount(1);
  const added = calls.find(call => call.name === 'add_operation').value.nodeId;
  const transform = await page.locator(`.svelte-flow__node[data-id="${added}"]`).getAttribute('style');
  expect(transform).toContain('720px'); expect(transform).toContain('320px');
  expect(requests).toHaveLength(0); await expect(panel.getByRole('log').locator('img')).toHaveCount(0);
  await this.attach(await panel.screenshot({ timeout: 5000 }), 'image/png');
  await expect(page.getByRole('dialog', { name: /^Run workflow:/ })).toHaveCount(0);
  await setMode(page, 'workflow');
  await page.getByRole('region', { name: 'Workflow canvas', exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.svelte-flow__edge:not(.workflow-schema-edge)')).toHaveCount(0);
  await openAssistant(page);
  await page.getByRole('switch', { name: 'AI assistant', exact: true }).click();
  expect(await page.evaluate(() => window.assistantFixture.terminated)).toBe(0);
  await page.getByRole('switch', { name: 'AI assistant', exact: true }).click();
  await expect(panel.getByRole('log')).toContainText('Done');
  await panel.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(panel.getByRole('log')).not.toContainText('Done');
});
Then('assistant read only mode and unload prevent further workspace edits', async function() {
  const page = this.page; await installAssistantFixture(page); await graph(page);
  const panel = await openAssistant(page);
  const configuration = await openConfiguration(panel);
  await configuration.getByLabel('Workspace editing', { exact: true }).uncheck();
  await openAssistant(page);
  await loadAssistantModel(page);
  await panel.getByRole('textbox', { name: 'Message', exact: true }).fill('Inspect but do not edit');
  await panel.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await expect(panel.getByRole('log')).toContainText('Done');
  const calls = await page.evaluate(() => window.assistantFixture.calls);
  expect(calls.find(call => call.name === 'add_operation').error).toContain('not available');
  expect(calls.find(call => call.name === 'connect_nodes').error).toContain('not available');
  await expect(page.locator('.svelte-flow__node')).toHaveCount(2);
  await page.evaluate(() => window.assistantFixture.behavior = 'slow');
  await panel.getByRole('textbox', { name: 'Message', exact: true }).fill('Wait');
  await panel.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await panel.getByRole('button', { name: 'Stop and unload', exact: true }).click();
  await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.assistantFixture.terminated)).toBe(1);
});
Then('assistant messaging remains usable on a narrow viewport and reports failure', async function() {
  const page = this.page; await installAssistantFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await openAssistant(page);
  await expect(panel.getByRole('combobox', { name: 'Local model', exact: true })).toBeVisible();
  const bounds = await panel.boundingBox(); expect(bounds.width).toBeLessThanOrEqual(390);
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.evaluate(() => window.assistantFixture.behavior = 'error');
  await loadAssistantModel(page);
  await panel.getByRole('textbox', { name: 'Message', exact: true }).fill('Hi');
  await panel.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await expect(panel.getByRole('alert')).toContainText('Synthetic inference failure');
  await expect(panel.getByRole('combobox', { name: 'Local model', exact: true })).toBeEnabled();
  consumeExpectedError(this, 'Synthetic inference failure');
});
Then('assistant loading failures reach the shared history and copy their native error chain', async function() {
  const page = this.page; await installAssistantFixture(page);
  await page.evaluate(() => window.assistantFixture.behavior = 'load-error');
  const panel = await openAssistant(page);
  await panel.getByRole('combobox', { name: 'Local model', exact: true }).click();
  await page.getByRole('option', { name: 'Bonsai 2 · 2B', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Synthetic inference failure');
  consumeExpectedError(this, 'Synthetic inference failure');
  await page.getByRole('switch', { name: 'AI assistant', exact: true }).click();
  const browser = page.locator('summary[aria-label="Browser"]');
  if (await browser.getAttribute('aria-expanded') !== 'true') await browser.click();
  await expect(browser.locator('..').locator('.storage-dashboard')).toBeVisible();
  await expect(browser.locator('..').locator('.storage-building')).toHaveCount(0);
  await browser.locator('..').locator(':scope > .disclosure-panel').evaluate(async element => {
    await Promise.allSettled(element.getAnimations().map(animation => animation.finished));
  });
  await page.locator('summary[aria-label="Logs"]').click();
  const history = page.getByRole('region', { name: 'Errors', exact: true });
  const entry = history.locator('details.entry').filter({ hasText: 'assistant' });
  await expect(entry).toHaveCount(1);
  await entry.locator('summary').click();
  await expect(entry).toContainText('1 occurrence');
  await expect(entry).toContainText('inference.worker.ts:42:7');
  await expect(entry).toContainText('webml.js:10:3');
  await expect(entry).toContainText('DEVICE_LOST');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: { async writeText(value) { window.copiedAssistantError = value; } } }));
  await entry.getByRole('button', { name: 'Copy error details', exact: true }).click();
  await expect(entry.getByRole('status')).toHaveText('Error details copied.');
  const copied = JSON.parse(await page.evaluate(() => window.copiedAssistantError));
  expect(copied.origin.scope).toBe('operations > assistant > load');
  expect(copied.error.name).toBe('OperationError');
  expect(copied.error.stack).toContain('inference.worker.ts:42:7');
  expect(copied.error.cause.stack).toContain('webml.js:10:3');
  expect(copied.error.cause.code).toBe('DEVICE_LOST');
  expect(copied.occurrences).toBe(1);
  await page.evaluate(() => navigator.clipboard.writeText = async () => { throw new DOMException('Synthetic clipboard denied', 'NotAllowedError'); });
  await entry.getByRole('button', { name: 'Copy error details', exact: true }).click();
  await expect(entry.getByRole('status')).toContainText('Could not copy error details');
  consumeExpectedError(this, 'Synthetic clipboard denied');
});
async function checkRealCompatibility(page) {
  const requests = [];
  page.on('request', request => { if (/huggingface|\.gguf/.test(request.url())) requests.push(request.url()); });
  const panel = await openAssistant(page);
  await panel.getByRole('button', { name: 'Check compatibility', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Check compatibility', exact: true })).toBeEnabled({ timeout: 25000 });
  await expect(panel.getByRole('status')).toContainText(/WebGPU|HTTPS|localhost/);
  await expect(panel.getByRole('alert')).toHaveCount(0);
  expect(requests).toHaveLength(0);
}
Then('the assistant checks its real browser worker without downloading model files', async function() {
  await checkRealCompatibility(this.page);
});
Then('the same compatibility check succeeds in a development worker', { timeout: 90000 }, async function() {
  const { createFixtureServer, waitForApplicationReady } = await import('./legacy-smoke/support.mjs');
  const server = await createFixtureServer({});
  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}`;
  const allowDevelopment = route => route.continue();
  await this.context.route(`${url}/**`, allowDevelopment);
  try {
    await this.page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await waitForApplicationReady(this.page);
    await checkRealCompatibility(this.page);
    const decision = await this.page.evaluate(() => new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./lib/assistant/decision.worker.ts?worker_file&type=module', location.href), {type:'module'});
      const timer = setTimeout(() => {worker.terminate(); reject(Error('Decision compatibility timed out'));},15000);
      worker.onerror = event => {event.preventDefault(); clearTimeout(timer); worker.terminate(); reject(Error(event.message));};
      worker.onmessage = ({data}) => {if(data.type==='compatibility'){clearTimeout(timer);worker.terminate();resolve(data.value);}else if(data.type==='error'){clearTimeout(timer);worker.terminate();reject(Error(data.error.message));}};
      worker.postMessage({type:'check',profile:'strands-cpu'});
    }));
    expect(decision.ready).toBe(true);expect(decision.summary).toContain('CPU Wasm');
    const image = await this.page.evaluate(async () => {
      const factory = await import(new URL('./assistant-runtime/vision-engine.js', location.href).href);
      const pin = factory.resolveVisionPin({model:'LiquidAI/LFM2.5-VL-1.6B-ONNX',settings:{precision_variant:'official-q4-fp32-compatible-v1'}});
      if (pin.precisionVariant !== 'official-q4-fp32-compatible-v1') throw Error('Development served a stale image factory');
      return new Promise((resolve,reject) => {
        const worker = new Worker(new URL('./assistant-runtime/vision-worker.js',location.href),{type:'module'});
        const timer=setTimeout(()=>{worker.terminate();reject(Error('Development image worker startup timed out'));},15000);
        worker.onerror=event=>{event.preventDefault();clearTimeout(timer);worker.terminate();reject(Error(event.message));};
        worker.onmessage=({data})=>{if(data.type==='error'){clearTimeout(timer);worker.terminate();resolve(data.message+(data.stack?'\n'+data.stack:''));}};
        // Reject in the current device selector before any model download.
        worker.postMessage({id:1,type:'load',pin:{precisionVariant:'not-a-qualified-variant'}});
      });
    });
    expect(image).toContain('Unqualified vision precision variant');
  } finally { await this.context.unroute(`${url}/**`, allowDevelopment); }
});

Then('assistant drafts expand the message input without internal scrolling', async function() {
  const page = this.page; await installAssistantFixture(page);
  await page.evaluate(() => window.assistantFixture.behavior = 'manual');
  const panel = await openAssistant(page), input = panel.getByRole('textbox', { name: 'Message', exact: true });
  await loadAssistantModel(page);
  const initialHeight = (await input.boundingBox()).height;
  const metrics = () => input.evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight, scroll: el.scrollTop }));
  const expectNoScroll = async () => {
    await expect.poll(async () => { const value = await metrics(); return value.content - value.height; }, { message: JSON.stringify(await metrics()) }).toBeLessThanOrEqual(1);
    expect((await metrics()).scroll).toBe(0);
  };
  await input.fill('A typed draft');
  for (let line = 0; line < 6; line++) { await input.press('Shift+Enter'); await input.pressSequentially('Another line'); }
  await expect.poll(async () => (await metrics()).height).toBeGreaterThan(initialHeight);
  await expectNoScroll();
  await input.fill(Array.from({ length: 40 }, (_, i) => `Pasted line ${i + 1}`).join('\n') + '\n');
  await expect.poll(async () => (await metrics()).height).toBeGreaterThan(400);
  await expectNoScroll();
  await input.press('Control+a'); await input.press('Backspace');
  await expect.poll(async () => (await metrics()).height).toBe(initialHeight);
  await input.fill('This draft wraps to fit the available pane width. '.repeat(14));
  const wideHeight = (await metrics()).height;
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await metrics()).height).toBeGreaterThan(wideHeight);
  await expectNoScroll();
  await page.locator('#settings-panel').evaluate(el => el.scrollTop = 0);
  await page.screenshot({ path: `${this.artifactDirectory}/assistant-message-auto-height.png` });
  await page.setViewportSize({ width: 1280, height: 844 });
  await expect.poll(async () => (await metrics()).height).toBe(wideHeight);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect.poll(async () => (await metrics()).height).toBe(initialHeight);
  await expectNoScroll();
  await page.evaluate(() => window.assistantFixture.emit({ type: 'done' }));
});

Then('assistant streaming keeps drafts focus and readable tool details', async function() {
  const page = this.page; await installAssistantFixture(page);
  await page.evaluate(() => window.assistantFixture.behavior = 'manual');
  const panel = await openAssistant(page), input = panel.getByRole('textbox', { name: 'Message', exact: true }), log = panel.getByRole('log');
  await loadAssistantModel(page);
  await input.fill('Start a reply'); await input.press('Enter');
  await expect(input).toBeFocused(); await expect(input).toBeEnabled();
  await input.fill('A draft for the next message');
  const pane = page.locator('#settings-panel'), composer = panel.locator('form.composer');
  const initialComposerTop = await composer.evaluate(element => element.offsetTop);
  const bottomGap = () => pane.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight);
  const expectNaturalConversation = async () => {
    await expect.poll(() => log.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
    expect(await log.evaluate(element => element.scrollTop)).toBe(0);
    expect((await log.boundingBox()).height).toBeGreaterThan(await pane.evaluate(element => element.clientHeight));
  };
  await expect(panel.getByRole('button', { name: 'Send message', exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    window.assistantFixture.history = [{ role: 'user', text: 'Start a reply' }, { role: 'tool', tool: 'read_operation', text: 'Complete tool details remain available.' },
      { role: 'assistant', text: 'A long streamed answer.\n\n'.repeat(100) }];
    window.assistantFixture.emit({ type: 'update', messages: window.assistantFixture.history, error: '' });
  });
  const details = log.locator('.tool-result'); await expect(details).not.toHaveAttribute('open');
  await expect(details.locator('pre')).toBeHidden();
  await expect.poll(bottomGap).toBeLessThan(2);
  await expectNaturalConversation();
  expect(await composer.evaluate(element => element.offsetTop)).toBeGreaterThan(initialComposerTop);
  await pane.evaluate(element => element.scrollTop = 0);
  const paneBox = await pane.boundingBox();
  await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + 180);
  await page.mouse.wheel(0, 250);
  await expect.poll(() => pane.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await log.evaluate(element => element.scrollTop)).toBe(0);
  await pane.evaluate(element => element.scrollTop = 0);
  await page.evaluate(() => window.assistantFixture.emit({ type: 'update', messages: [...window.assistantFixture.history, { role: 'assistant', text: 'Latest chunk' }], error: '' }));
  await expect(log).toContainText('Latest chunk');
  await expect.poll(() => pane.evaluate(element => element.scrollTop)).toBe(0);
  await details.locator('summary').click();
  await expect(details.locator('pre')).toBeVisible();
  await page.evaluate(() => window.assistantFixture.emit({ type: 'done' }));
  await expect(input).toHaveValue('A draft for the next message');
  await expect(panel.getByRole('status')).toHaveText('Ready for your next message.');
  await input.press('Enter');
  await page.evaluate(() => window.assistantFixture.emit({ type: 'update', messages: [...window.assistantFixture.history, { role: 'user', text: 'A draft for the next message' }, { role: 'assistant', text: 'New reply' }], error: '' }));
  await expect(log).toContainText('New reply');
  await expect.poll(bottomGap).toBeLessThan(2);
  await page.evaluate(() => window.assistantFixture.emit({ type: 'update', messages: [...window.assistantFixture.history, { role: 'user', text: 'A draft for the next message' }, { role: 'assistant', text: 'The answer keeps growing.\n\n'.repeat(30) + 'Streaming tail' }], error: '' }));
  await expect(log).toContainText('Streaming tail');
  await expect.poll(bottomGap).toBeLessThan(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expectNaturalConversation();
  await pane.evaluate(element => element.scrollTop = 0);
  await page.screenshot({ path: `${this.artifactDirectory}/assistant-pane-conversation-top.png` });
  await pane.evaluate(element => element.scrollTop = element.scrollHeight);
  await page.screenshot({ path: `${this.artifactDirectory}/assistant-pane-conversation-bottom.png` });
});

Then('assistant attachments and new conversation respect asynchronous image cleanup', async function() {
  const page = this.page; await installAssistantFixture(page);
  await page.evaluate(() => window.assistantFixture.behavior = 'manual');
  const panel = await openAssistant(page), upload = panel.getByLabel('Attach assistant image', { exact: true });
  await loadAssistantModel(page);
  const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8; return canvas.toDataURL().split(',')[1]; });
  const file = { name: 'example.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
  await upload.setInputFiles(file);
  await expect(panel.getByRole('img', { name: 'Attachment ready to send', exact: true })).toBeVisible();
  await panel.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  expect(await page.evaluate(() => window.assistantFixture.lastMessage.images.length)).toBe(1);
  await expect(panel.getByRole('img')).toHaveCount(0);
  await page.evaluate(() => { window.assistantFixture.emit({ type: 'update', messages: [{ role: 'user', text: '', imageCount: 1 }, { role: 'assistant', text: 'Image received' }], error: '' }); window.assistantFixture.emit({ type: 'done' }); });
  await expect(panel.getByRole('log')).toContainText('1 image attached');
  await page.evaluate(() => {
    const decode = window.createImageBitmap.bind(window);
    window.createImageBitmap = (...args) => {
      const prepared = new Promise(resolve => window.assistantFixture.finishImage = resolve).then(() => decode(...args));
      window.assistantFixture.imagePrepared = prepared.then(() => {});
      return prepared;
    };
  });
  await upload.setInputFiles(file); await expect(panel.getByText('Preparing image…', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(panel.getByRole('log')).not.toContainText('Image received');
  await page.evaluate(async () => { window.assistantFixture.finishImage(); await window.assistantFixture.imagePrepared; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await expect(panel.getByRole('img')).toHaveCount(0);
  await expect(panel.getByText('Preparing image…', { exact: true })).toHaveCount(0);
  await upload.setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  await expect(panel.getByRole('alert')).toContainText('Choose a PNG');
  consumeExpectedError(this, 'Choose a PNG');
  expect(await upload.inputValue()).toBe('');
});

Then('Gemma MiniCPM and Ornith load on selection with their supported settings', async function() {
  const page=this.page;await installAssistantFixture(page);const panel=await openAssistant(page);
  const picker=panel.getByRole('combobox',{name:'Local model',exact:true});
  for(const [label,id] of [['Gemma 4 · E2B','gemma-e2b'],['MiniCPM5 · 2.52B','minicpm5-2b'],['Ornith 1.5 · 9B Q4_K_M','ornith-q4'],['Ornith 1.5 · 9B Q8_0','ornith-q8'],['Bonsai 2 · 27B','27b']]) {
    await picker.click();await page.getByRole('option',{name:label,exact:true}).click();
    await expect(panel.getByRole('button',{name:'Unload model',exact:true})).toBeVisible();
    const settings=await page.evaluate(()=>window.assistantFixture.settings);expect(settings.model).toBe(id);
    if(id==='gemma-e2b'){expect(settings.sampling).toBe(false);expect(settings.thinking).toBe(false);expect(settings.prefixCache).toBe(false);expect(settings.maxTokens).toBe(256);}
    if(id.startsWith('ornith'))expect(settings.executionMode).toBe('gpu');
    await panel.getByRole('button',{name:'Unload model',exact:true}).click();
    if(id==='minicpm5-2b') {
      const configuration = await openConfiguration(panel);
      await configuration.getByRole('combobox',{name:'Execution',exact:true}).click();await page.getByRole('option',{name:'CPU',exact:true}).click();
      await openAssistant(page);
      await picker.click();await page.getByRole('option',{name:label,exact:true}).click();
      await expect(panel.getByRole('button',{name:'Unload model',exact:true})).toBeVisible();
      expect(await page.evaluate(()=>window.assistantFixture.settings.executionMode)).toBe('cpu');
      await panel.getByRole('button',{name:'Unload model',exact:true}).click();
    }
    if(id==='gemma-e2b') {
      const configuration = await openConfiguration(panel);
      for(const name of ['Reasoning','Sample responses','Prefix cache'])await expect(configuration.getByRole('checkbox',{name,exact:true})).toBeDisabled();
      await openAssistant(page);
    }
  }
  expect(await page.evaluate(()=>window.assistantFixture.terminated)).toBe(6);
});
Then('decision controls preserve native results and release their exclusive model session', async function() {
  const page=this.page;await installDecisionFixture(page);const panel=await openAssistant(page);const configuration=await openConfiguration(panel);
  await configuration.locator('.decision-settings > summary').click();
  const section=configuration.locator('.decision-settings'), picker=section.getByRole('combobox',{name:'Decision model',exact:true});
  await picker.click();await expect(page.getByRole('option')).toHaveCount(16);await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>window.decisionFixture.workers)).toBe(0);
  await picker.click();await page.getByRole('option',{name:'Strands · 2B INT4 CPU',exact:true}).click();
  await expect(section.getByRole('button',{name:'Score decision',exact:true})).toBeEnabled();
  await expect(configuration.getByRole('combobox',{name:'Language model',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>window.decisionFixture.messages.map(row=>row.type))).toEqual(['load']);
  await section.getByRole('button',{name:'Score decision',exact:true}).click();
  const output=section.getByRole('region',{name:'Decision result',exact:true});await expect(output).toContainText('0.85');
  await output.locator('summary').click();await expect(output).toContainText('native_fixture');await expect(output).toContainText('rendered_tokens');
  const messages=await page.evaluate(()=>window.decisionFixture.messages);expect(messages[0].profile).toBe('strands-cpu');expect(messages[1].request.questions.q.type).toBe('noul');
  await section.getByRole('button',{name:'Unload decision model',exact:true}).click();
  await expect(configuration.getByRole('combobox',{name:'Language model',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>window.decisionFixture.terminated)).toBe(1);
  await picker.click();await page.getByRole('option',{name:'D3 lite · 0.8B · FP32',exact:true}).click();
  await expect(section.locator('.runtime-label')).toContainText('FP32 GPU backbone');
  await expect(section).toContainText('input embedding and small readout may use CPU');
  await section.getByRole('button',{name:'Score decision',exact:true}).click();
  await expect(output).toContainText('0.85');
  expect(await page.evaluate(()=>window.decisionFixture.messages.find(row=>row.profile==='d3-lite-fp32').type)).toBe('load');
  await section.getByRole('button',{name:'Unload decision model',exact:true}).click();
  expect(await page.evaluate(()=>window.decisionFixture.terminated)).toBe(2);
});
Then('the shared FP32 decision artifact retains all native readout APIs',{timeout:90000},async function(){
  const requests=[];this.page.on('request',request=>{if(/huggingface|\.gguf/.test(request.url()))requests.push(request.url());});
  const result=await this.page.evaluate(async()=>{
    const base=new URL('./assistant-runtime/decision/',location.href);
    const code=`const base=${JSON.stringify(base.href)};try {const {Wllama}=await import(base+'vendor/wllama-fp32/index.js');await import(base+'engine.mjs');for(const name of ['inspectSystemOne','createSystemOne','createCompletion','createBlockReadout','createInlineReadout'])if(typeof Wllama.prototype[name]!=='function')throw Error('Missing native '+name);const bytes=await(await fetch(base+'vendor/wllama-fp32/wllama.wasm')).arrayBuffer();await WebAssembly.compile(bytes);const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');postMessage({bytes:bytes.byteLength,sha});}catch(error){postMessage({error:error.message});}`;
    const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'})),worker=new Worker(url,{type:'module'});
    try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('FP32 artifact import timed out')),45000);worker.onerror=event=>{event.preventDefault();clearTimeout(timer);reject(Error(event.message));};worker.onmessage=({data})=>{clearTimeout(timer);data.error?reject(Error(data.error)):resolve(data);};});}
    finally{worker.terminate();URL.revokeObjectURL(url);}
  });
  expect(result.bytes).toBe(9386116);expect(result.sha).toBe('2eff6cb50e99d1d80c57e4ed235b659303318d98097d64fe0b39aa8f6b730541');expect(requests).toEqual([]);
});
Then('native runtime modules and compressed Wasm load in real browser workers', {timeout:90000}, async function() {
  const page=this.page, requests=[];page.on('request',request=>{if(/huggingface|\.gguf/.test(request.url()))requests.push(request.url());});
  const result=await page.evaluate(async()=>{
    const base=new URL('./assistant-runtime/',location.href), sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
    const compressed=await(await fetch(new URL('compressed-assets.json',base))).json();
    for(const item of compressed){const response=await fetch(item.path), bytes=await response.arrayBuffer();if(!response.ok||bytes.byteLength!==item.bytes||await sha(bytes)!==item.sha256)throw Error('Compressed native asset does not restore its pinned bytes: '+item.path);}
    for(const folder of ['wllama','wllama-d3-inspect','wllama-elephant','wllama-pplx-v3']) {
      const response=await fetch(new URL('decision/vendor/'+folder+'/wllama.wasm',base));await WebAssembly.compile(await response.arrayBuffer());
    }
    const worker=new Worker(new URL('litert/candidate-bootstrap.js',base),{type:'classic'});
    try {await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Gemma bootstrap timed out')),15000);worker.onerror=event=>{event.preventDefault();clearTimeout(timer);reject(Error(event.message));};worker.onmessage=({data})=>{if(data.type==='bootstrap_ready'){clearTimeout(timer);resolve();}else if(data.type==='bootstrap_error'){clearTimeout(timer);reject(Error(data.error.message));}};worker.postMessage({type:'bootstrap',moduleUrl:new URL('gemma-worker.js',base).href});});}
    finally {worker.terminate();}
    let imports=0;
    for(const entry of ['gemma-worker.js','vision-worker.js']) {
      const source=await(await fetch(new URL(entry,base))).text();
      for(const match of source.matchAll(/import\(["']([^"']+\.js)["']\)/g)) {
        const url=new URL(match[1],new URL(entry,base)).href, code='import('+JSON.stringify(url)+').then(()=>postMessage({ok:true})).catch(error=>postMessage({error:error.message}))', blob=URL.createObjectURL(new Blob([code],{type:'text/javascript'})), child=new Worker(blob,{type:'module'});
        try {await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Native module import timed out')),15000);child.onerror=event=>{event.preventDefault();clearTimeout(timer);reject(Error(event.message));};child.onmessage=({data})=>{clearTimeout(timer);data.error?reject(Error(data.error)):resolve();};});imports++;}
        finally {child.terminate();URL.revokeObjectURL(blob);}
      }
    }
    for(const path of ['load-language.mjs','decision/engine.mjs',...['wllama','wllama-d3-inspect','wllama-elephant','wllama-pplx-v3'].map(folder=>'decision/vendor/'+folder+'/index.js')]) {
      const code='import('+JSON.stringify(new URL(path,base).href)+').then(()=>postMessage({ok:true})).catch(error=>postMessage({error:error.message}))';
      const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'})), child=new Worker(url,{type:'module'});
      try {await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Native decision module import timed out')),15000);child.onerror=event=>{event.preventDefault();clearTimeout(timer);reject(Error(event.message));};child.onmessage=({data})=>{clearTimeout(timer);data.error?reject(Error(data.error)):resolve();};});imports++;}
      finally {child.terminate();URL.revokeObjectURL(url);}
    }
    return {compressed:compressed.length,imports};
  });
  expect(result.compressed).toBeGreaterThan(0);expect(result.imports).toBeGreaterThanOrEqual(2);expect(requests).toEqual([]);
});

Then('assistant context feedback preserves drafts and successful messages on overflow', async function() {
  const page = this.page; await installAssistantFixture(page);
  const panel = await openAssistant(page); await loadAssistantModel(page);
  const draft = panel.getByRole('textbox', { name: 'Message', exact: true });
  await draft.fill('Keep my next draft');
  await page.evaluate(() => {
    window.assistantFixture.emit({ type: 'context', value: { inputTokens: 2300, contextTokens: 4096, reserveTokens: 128, maxTokens: 256, kind: 'native', method: 'fixture native counter' } });
    window.assistantFixture.emit({ type: 'update', messages: [{ role: 'user', text: 'Earlier message' }, { role: 'assistant', text: 'Earlier successful answer' }], error: '' });
  });
  await expect(panel.locator('.context-budget')).toContainText('native count');
  await expect(panel.locator('.context-budget')).not.toContainText('estimate');
  await page.evaluate(() => {
    window.assistantFixture.emit({ type: 'context', value: { inputTokens: 5000, contextTokens: 4096, reserveTokens: 128, maxTokens: 0, kind: 'estimate', method: 'fixture estimate' } });
    window.assistantFixture.emit({ type: 'update', messages: [{ role: 'user', text: 'Earlier message' }, { role: 'assistant', text: 'Earlier successful answer' }], error: 'The estimated prompt has no room for a reply. No messages were removed.' });
    window.assistantFixture.emit({ type: 'done' });
  });
  await expect(panel.locator('.context-budget')).toContainText('estimate');
  await expect(panel.locator('.context-budget')).toContainText('0 output tokens');
  await expect(panel.locator('.context-budget')).toContainText('native template and tokenizer may use a different count');
  await expect(panel.getByRole('alert')).toContainText('No messages were removed');
  await expect(panel.getByRole('log')).toContainText('Earlier successful answer');
  await expect(draft).toHaveValue('Keep my next draft');
  await panel.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(panel.locator('.context-budget')).toHaveCount(0);
  await expect(panel.getByRole('log')).not.toContainText('Earlier successful answer');
  await page.evaluate(() => {
    window.assistantFixture.emit({ type: 'context', value: { inputTokens: 100, contextTokens: 4096, reserveTokens: 128, maxTokens: 256, kind: 'native', method: 'fixture' } });
  });
  await expect(panel.locator('.context-budget')).toBeVisible();
  await page.evaluate(() => window.assistantFixture.emit({ type: 'error', operation: 'worker', error: { name: 'DeviceLostError', message: 'Synthetic context-device failure' } }));
  await expect(panel.locator('.context-budget')).toHaveCount(0);
  await expect(draft).toBeDisabled();
  consumeExpectedError(this, 'Synthetic context-device failure');
});

Then('image runtime preferences select the served compatible model without changing text placement', async function() {
  const page=this.page;await installAssistantFixture(page);const panel=await openAssistant(page), configuration=await openConfiguration(panel);
  const picker=configuration.getByRole('combobox',{name:'Image runtime',exact:true});
  await expect(picker.locator('.field-select-value')).toHaveText('Original FP16/Q4');
  await picker.click();await page.getByRole('option',{name:'Compatible FP32/Q4',exact:true}).click();
  expect(await page.evaluate(()=>window.assistantFixture.workers)).toBe(0);
  await page.reload();await page.locator('#startup-status').waitFor({state:'detached'});
  await expect(picker.locator('.field-select-value')).toHaveText('Compatible FP32/Q4');
  const language=configuration.getByRole('combobox',{name:'Language model',exact:true});await language.click();await page.getByRole('option',{name:'Bonsai 2 · 2B',exact:true}).click();
  await expect(picker).toBeDisabled();expect(await page.evaluate(()=>window.assistantFixture.settings.visionMode)).toBe('compatible');
  expect(await page.evaluate(()=>window.assistantFixture.settings.executionMode)).toBe('auto');
  const served=await page.evaluate(async()=>{
    const module=await import(new URL('./assistant-runtime/vision-engine.js',document.baseURI).href);
    const previousHandler=window.onmessage;
    const worker=await import(new URL('./assistant-runtime/vision-worker.js',document.baseURI).href);
    if(window.onmessage!==previousHandler)throw Error('Inspecting worker exports changed the page handler');
    if(typeof worker.bindVisionSessionOptions!=='function'||typeof worker.configureVisionDevice!=='function')throw Error('Built image worker is missing compatible session helpers');
    let request;
    const fake={terminate(){},postMessage(value){if(value.type==='load')request=value;queueMicrotask(()=>fake.onmessage({data:{id:value.id,type:'result',result:{}}}));}};
    const profile={model:'LiquidAI/LFM2.5-VL-1.6B-ONNX',revision:'d0e00ca26cc42892d9f3c4380faa631927218209',settings:{precision_variant:'official-q4-fp32-compatible-v1',max_new_tokens:128,context_tokens:1024}};
    const engine=await module.createVisionEngine(profile,{createWorker:()=>fake});await engine.dispose();
    return {variant:request.pin.precisionVariant,dtype:request.pin.dtype,external:request.pin.externalData,output:request.outputTokens};
  });
  expect(served).toEqual({variant:'official-q4-fp32-compatible-v1',dtype:{embed_tokens:'fp32',vision_encoder:'q4',decoder_model_merged:'q4'},external:{embed_tokens:false,vision_encoder:true,decoder_model_merged:true},output:128});
  await configuration.getByRole('button',{name:'Unload language model',exact:true}).click();
});

Then('local model leases coordinate browser tabs cancellation and owner worker death', {timeout:90000}, async function() {
  const {createFixtureServer,waitForApplicationReady}=await import('./legacy-smoke/support.mjs');
  const server=await createFixtureServer({}),url=`http://127.0.0.1:${server.httpServer.address().port}`;
  const allow=route=>route.continue();await this.context.route(`${url}/**`,allow);
  const other=await this.context.newPage();
  try {
    for(const page of [this.page,other]) {
      await page.goto(url,{waitUntil:'networkidle',timeout:60000});await waitForApplicationReady(page);
      await page.addScriptTag({type:'module',content:`import {BrowserRuntimeOwner} from ${JSON.stringify(url+'/lib/assistant/runtime-ownership.js')};window.RuntimeOwner=BrowserRuntimeOwner;`});
      await page.waitForFunction(()=>!!window.RuntimeOwner);
    }
    await this.page.evaluate(async()=>{
      window.ownEvents=[];
      window.own=new window.RuntimeOwner({suspend:async()=>{window.ownEvents.push('dispose-start');await new Promise(resolve=>window.finishDispose=resolve);window.ownEvents.push('dispose-end');}});
      await window.own.run(async()=>window.ownEvents.push('loaded'));
      window.turn=window.own.run(async()=>{window.ownEvents.push('turn');await new Promise(resolve=>window.finishTool=resolve);window.ownEvents.push('tool-result');});
    });
    await other.evaluate(()=>{
      window.ownEvents=[];window.own=new window.RuntimeOwner({suspend:async()=>window.ownEvents.push('disposed')});
      window.pending=window.own.run(async()=>window.ownEvents.push('acquired'));
    });
    expect(await other.evaluate(()=>window.ownEvents)).toEqual([]);
    await this.page.evaluate(()=>window.finishTool());
    await expect.poll(()=>this.page.evaluate(()=>window.ownEvents.includes('dispose-start'))).toBe(true);
    expect(await other.evaluate(()=>window.ownEvents)).toEqual([]);
    await this.page.evaluate(()=>window.finishDispose());await other.evaluate(()=>window.pending);
    expect(await this.page.evaluate(()=>window.ownEvents)).toEqual(['loaded','turn','tool-result','dispose-start','dispose-end']);
    await other.evaluate(()=>{window.turn=window.own.run(async()=>new Promise(resolve=>window.finishTurn=resolve));});
    await this.page.evaluate(()=>{
      window.cancelled=new AbortController();window.cancelRan=false;
      window.waiter=new window.RuntimeOwner({suspend:async()=>{}});
      window.cancelResult=window.waiter.run(async()=>{window.cancelRan=true;},{signal:window.cancelled.signal}).then(()=>'',error=>error.name);
      window.cancelled.abort(new DOMException('Queued turn cancelled.','AbortError'));
    });
    expect(await this.page.evaluate(()=>window.cancelResult)).toBe('AbortError');
    expect(await this.page.evaluate(()=>window.cancelRan)).toBe(false);
    expect(await other.evaluate(()=>window.ownEvents)).toEqual(['acquired']);
    await other.evaluate(()=>window.finishTurn());await other.evaluate(async()=>{await window.turn;await window.own.close();});
    await this.page.evaluate(async()=>{await window.turn;await window.own.close();await window.waiter.close();});
    await this.page.evaluate(async moduleUrl=>{
      const source=`import {BrowserRuntimeOwner} from ${JSON.stringify(moduleUrl)};const owner=new BrowserRuntimeOwner({suspend:async()=>{}});owner.run(async()=>{postMessage('held');await new Promise(()=>{});});`;
      const blob=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
      window.ownerWorker=new Worker(blob,{type:'module'});
      try {await new Promise((resolve,reject)=>{window.ownerWorker.onmessage=()=>resolve();window.ownerWorker.onerror=event=>reject(Error(event.message));});}
      finally {URL.revokeObjectURL(blob);}
      window.afterDeath=false;window.successor=new window.RuntimeOwner({suspend:async()=>{}});
      window.successorRun=window.successor.run(async()=>{window.afterDeath=true;});
    },url+'/lib/assistant/runtime-ownership.js');
    expect(await this.page.evaluate(()=>window.afterDeath)).toBe(false);
    await this.page.evaluate(()=>window.ownerWorker.terminate());
    await this.page.evaluate(()=>window.successorRun);expect(await this.page.evaluate(()=>window.afterDeath)).toBe(true);
    await this.page.evaluate(()=>window.successor.close());
  } finally {await other.close();await this.context.unroute(`${url}/**`,allow);}
});

Then('compatible MiniCPM settings and its paired native artifacts remain browser-local', {timeout:90000}, async function() {
  const page=this.page;await installAssistantFixture(page);const panel=await openAssistant(page),picker=panel.getByRole('combobox',{name:'Local model',exact:true});
  await picker.click();await page.getByRole('option',{name:'MiniCPM5 · 2.52B · FP32',exact:true}).click();
  await expect(panel.getByRole('button',{name:'Unload model',exact:true})).toBeVisible();
  await page.evaluate(()=>window.assistantFixture.emit({type:'update',messages:[{role:'assistant',text:'Profile reply.'}],error:''}));await expect(panel.getByRole('log',{name:'Assistant conversation'}).locator('article > strong')).toHaveText('MiniCPM5');
  const loaded=await page.evaluate(()=>window.assistantFixture.settings);expect(loaded.model).toBe('minicpm5-fp32');expect(loaded.executionMode).toBe('gpu');expect(loaded.context).toBe(4096);expect(loaded.maxTokens).toBe(256);
  const config=await openConfiguration(panel);await config.getByRole('button',{name:'Unload language model',exact:true}).click();
  for(const name of ['Reasoning','Sample responses','Prefix cache'])await expect(config.getByRole('checkbox',{name,exact:true})).toBeDisabled();
  await expect(config.getByRole('slider',{name:'Context tokens',exact:true})).toHaveAttribute('aria-valuemax','4096');
  await expect(config.getByRole('slider',{name:'Output tokens',exact:true})).toHaveAttribute('aria-valuemax','256');
  await config.getByRole('combobox',{name:'Execution',exact:true}).click();expect(await page.getByRole('option').evaluateAll(options=>options.map(option=>option.getAttribute('data-value')))).toEqual(['','gpu']);await page.keyboard.press('Escape');
  await openAssistant(page);
  for(const [label,id]of[['Ornith 1.5 · 9B · Q4 · FP32','ornith-q4-fp32'],['Ornith 1.5 · 9B · Q8 · FP32','ornith-q8-fp32'],['LFM3 · 1.7B · Q4 · FP32','lfm3-fp32']]){
    await picker.click();await page.getByRole('option',{name:label,exact:true}).click();await expect(panel.getByRole('button',{name:'Unload model',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>{const s=window.assistantFixture.settings;return{model:s.model,executionMode:s.executionMode,context:s.context,maxTokens:s.maxTokens,thinking:s.thinking,sampling:s.sampling,prefixCache:s.prefixCache};})).toEqual({model:id,executionMode:'gpu',context:4096,maxTokens:256,thinking:false,sampling:false,prefixCache:false});
    await page.evaluate(()=>window.assistantFixture.emit({type:'update',messages:[{role:'assistant',text:'Profile reply.'}],error:''}));await expect(panel.getByRole('log',{name:'Assistant conversation'}).locator('article > strong')).toHaveText(label.split(' · ')[0]);
    const settings=await openConfiguration(panel);await settings.getByRole('button',{name:'Unload language model',exact:true}).click();
    for(const name of['Reasoning','Sample responses','Prefix cache'])await expect(settings.getByRole('checkbox',{name,exact:true})).toBeDisabled();
    await openAssistant(page);
  }
  for(const width of [390,320]){await page.setViewportSize({width,height:844});expect(await page.locator('#settings-panel').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);}
  const imports=[];for(const folder of['upstream','lfm3-upstream'])imports.push(await page.evaluate(folder=>new Promise((resolve,reject)=>{
    const sdk=new URL('./assistant-runtime/text-fp32/'+folder+'/index.js',document.baseURI).href,wasm=new URL('./assistant-runtime/text-fp32/'+folder+'/wllama.wasm',document.baseURI).href;
    const factory=new URL('./assistant-runtime/text-fp32/engine.mjs',document.baseURI).href;const code=`import {loadFp32Chat} from ${JSON.stringify(factory)};import {Wllama} from ${JSON.stringify(sdk)};const bytes=await(await fetch(${JSON.stringify(wasm)})).arrayBuffer();await WebAssembly.compile(bytes);const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');postMessage({factory:typeof loadFp32Chat,sdk:typeof Wllama,bytes:bytes.byteLength,sha});`;
    const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'})),worker=new Worker(url,{type:'module'});
    const done=(error,value)=>{clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>done(Error('Compatible native artifact import timed out')),20000);
    worker.onerror=event=>{event.preventDefault();done(Error(event.message));};worker.onmessage=({data})=>done(null,data);
  }),folder));
  expect(imports).toEqual([{factory:'function',sdk:'function',bytes:9326027,sha:'b4862a3d30aaac1d33afbbba430d4d48a3e8baeb55b1a2e632fac51478ec7cc0'},{factory:'function',sdk:'function',bytes:9456086,sha:'5ae95c179c98794498b7d9a4b9594ddf58c2804c4367b76a92393bd8953b02f3'}]);
});
