// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { Given, When, Then, Before, After, QuickPickleWorld, setWorldConstructor } from 'quickpickle';
import { expect } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte/pure';
import { tick } from 'svelte';
import Probe from './ReactiveFixture.svelte';
import { lifecycle } from './lifecycle.mjs';

class SvelteComponentWorld extends QuickPickleWorld {
  async init() {
    await super.init();
    this.before = { ...lifecycle };
    this.pending = new Promise((resolve) => { this.resolveAction = resolve; });
    this.unmounted = false;
    this.originalTitle = document.title;
    this.publishedResults = [];
  }
}
setWorldConstructor(SvelteComponentWorld);

Before(() => {
  expect(document.querySelectorAll('[data-component-integration-fixture]')).toHaveLength(0);
  expect(lifecycle.mounts).toBe(lifecycle.destroys);
});
After(async (world) => {
  if (world.screen && !world.unmounted) await world.screen.unmount();
  world.resolveAction?.();
  await world.pending;
  await tick();
  expect(document.title).toBe(world.originalTitle);
  expect(document.querySelectorAll('[data-component-integration-fixture]')).toHaveLength(0);
  expect(lifecycle.mounts).toBe(lifecycle.destroys);
});
function componentProps(world) {
  return {
    waitForResult: signal => { world.requestSignal = signal; return world.pending; },
    onResult: result => { world.publishedResults.push(result); },
  };
}
Given('the Svelte component-integration component is mounted', async (world) => {
  world.screen = await render(Probe, componentProps(world));
  await expect.element(page.getByRole('heading', { name: 'Hello' })).toBeVisible();
  expect(lifecycle.mounts - world.before.mounts).toBe(1);
});
When('I increment the component counter', async () => {
  await page.getByRole('button', { name: 'Increment' }).click();
});
Then('the count is {int} and the multiplied value is {int}', async (_world, count, multiplied) => {
  await expect.element(page.getByTestId('count')).toHaveTextContent(`count: ${count}`);
  await expect.element(page.getByTestId('derived')).toHaveTextContent(`multiplied: ${multiplied}`);
});
When('I fill the component name with {string}', async (_world, value) => {
  await page.getByRole('textbox', { name: 'Name' }).fill(value);
});
Then('the bound name is {string}', async (_world, value) => {
  await expect.element(page.getByTestId('name')).toHaveTextContent(`name: ${value}`);
});
When('I enable the component checkbox', async () => {
  await page.getByRole('checkbox', { name: 'Enabled' }).click();
});
Then('the bound checkbox value is true', async () => {
  await expect.element(page.getByRole('checkbox', { name: 'Enabled' })).toBeChecked();
  await expect.element(page.getByTestId('enabled')).toHaveTextContent('enabled: true');
});
When('I update the component heading to {string} and multiplier to {int}', async (world, prefix, multiplier) => {
  await world.screen.rerender({ prefix, multiplier });
});
Then('the component heading is {string}', async (_world, name) => {
  await expect.element(page.getByRole('heading', { name })).toBeVisible();
});
When('I start the asynchronous component action', async () => {
  await page.getByRole('button', { name: 'Load' }).click();
});
Then('the component is pending and its action is disabled', async () => {
  await expect.element(page.getByRole('status')).toHaveTextContent('pending');
  await expect.element(page.getByRole('button', { name: 'Load' })).toBeDisabled();
});
When('the asynchronous component action resolves', (world) => { world.resolveAction(); });
Then('the component status is {string} and its action is enabled', async (_world, status) => {
  await expect.element(page.getByRole('status')).toHaveTextContent(status);
  await expect.element(page.getByRole('button', { name: 'Load' })).toBeEnabled();
});
When('I dispatch the component component-integration event', () => {
  window.dispatchEvent(new Event('component-integration-event'));
});
Then('the component has received {int} component-integration event', (world, count) => {
  expect(lifecycle.events - world.before.events).toBe(count);
});
When('I unmount the component', async (world) => {
  await world.screen.unmount();
  world.unmounted = true;
  expect(lifecycle.destroys - world.before.destroys).toBe(1);
});
Then('the component markup is absent', () => {
  expect(document.querySelector('[data-component-integration-fixture]')).toBeNull();
});

When('I select the component radio option {string}', async (_world, label) => {
  await page.getByRole('radio', { name: label, exact: true }).click();
});
Then('the bound radio choice is {string}', async (_world, choice) => {
  await expect.element(page.getByTestId('choice')).toHaveTextContent(`choice: ${choice}`);
  await expect.element(page.getByRole('radio', { name: choice === 'first' ? 'First' : 'Second', exact: true })).toBeChecked();
  await expect.element(page.getByRole('radio', { name: choice === 'first' ? 'Second' : 'First', exact: true })).not.toBeChecked();
});
Then('the component synchronizes the document title to {string}', async (_world, title) => {
  await expect.poll(() => document.title).toBe(title);
});
Then('the original document title is restored', async world => {
  await expect.poll(() => document.title).toBe(world.originalTitle);
});
When('I toggle the animated component details', async () => {
  await page.getByRole('button', { name: 'Toggle details', exact: true }).click();
});
Then('the details enter through a real browser animation', async world => {
  await expect.element(page.getByTestId('transition-status')).toHaveTextContent('opening');
  world.detailsElement = document.querySelector('[data-testid="transition-panel"]');
  expect(world.detailsElement).not.toBeNull();
  await expect.poll(() => world.detailsElement.getAnimations().some(animation => animation.playState === 'running')).toBe(true);
});
Then('the component details finish opening', async () => {
  await expect.element(page.getByTestId('transition-status'), { timeout: 5_000 }).toHaveTextContent('open');
  await expect.element(page.getByTestId('transition-panel')).toBeVisible();
});
Then('closing details stay rendered until their transition ends', async world => {
  await expect.element(page.getByTestId('transition-status')).toHaveTextContent('closing');
  expect(document.querySelector('[data-testid="transition-panel"]')).toBe(world.detailsElement);
  await expect.poll(() => world.detailsElement.getAnimations().some(animation => animation.playState === 'running')).toBe(true);
});
Then('the same details reopen without losing their content', async world => {
  await expect.element(page.getByTestId('transition-status'), { timeout: 5_000 }).toHaveTextContent('open');
  expect(document.querySelector('[data-testid="transition-panel"]')).toBe(world.detailsElement);
  await expect.element(page.getByTestId('transition-panel')).toHaveTextContent('Details remain readable while their disclosure opens and closes.');
});
Then('the closed details leave the document', async () => {
  await expect.poll(() => document.querySelector('[data-testid="transition-panel"]'), { timeout: 5_000 }).toBeNull();
  await expect.element(page.getByTestId('transition-status')).toHaveTextContent('closed');
});
Then('the pending component request has been aborted', world => {
  expect(world.requestSignal).toBeInstanceOf(AbortSignal);
  expect(world.requestSignal.aborted).toBe(true);
});
When('I mount a replacement component', async world => {
  world.screen = await render(Probe, { ...componentProps(world), prefix: 'Replacement' });
  world.unmounted = false;
  await expect.element(page.getByRole('heading', { name: 'Replacement', exact: true })).toBeVisible();
});
When('the cancelled component action resolves late', async world => {
  world.resolveAction();
  await world.pending;
  await tick();
});
Then('the replacement remains idle without publishing the cancelled result', async world => {
  await expect.element(page.getByRole('status')).toHaveTextContent('idle');
  await expect.element(page.getByRole('button', { name: 'Load' })).toBeEnabled();
  expect(world.publishedResults).toEqual([]);
  expect(lifecycle.mounts - world.before.mounts).toBe(2);
  expect(lifecycle.destroys - world.before.destroys).toBe(1);
});
