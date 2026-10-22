// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Collection only: never construct Worlds or invoke browser/hooks here.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateMessages } from '@cucumber/gherkin';
import { globSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function collectBindings(features, { scoped = false } = {}) {
  process.env.OPERATIONS_TEST_PROFILE = 'browser';
  process.env.OPERATIONS_CI_DISCOVERY = '1';
  if (!scoped) await import('./setup.browser.mjs');
  const { registrationInventory } = await import('./cucumber-compat.mjs');
  const { findStepDefinitionMatch } = await import('./quickpickle/src/steps.mjs');
  const { tagsFunction } = await import('./quickpickle/src/tags.mjs');
  const registrations = registrationInventory();
  const always = registrations.filter(entry => !['step', 'hook'].includes(entry.kind));
  const result = [];
  for (const feature of features) {
    let id = 0;
    const messages = generateMessages(readFileSync(feature, 'utf8'), feature, 'text/x.cucumber.gherkin+plain',
      { includeGherkinDocument: true, includePickles: true, newId: () => String(++id) });
    const error = messages.find(item => item.parseError)?.parseError;
    if (error) throw new Error(`Invalid Gherkin ${feature}: ${error.message}`);
    const cases = messages.filter(item => item.pickle).map(({ pickle }) => {
      const tags = pickle.tags.map(tag => tag.name.toLowerCase());
      const hooks = registrations.filter(entry => entry.kind === 'hook'
        && (entry.all || tagsFunction(entry.tags.toLowerCase())(tags)));
      const steps = pickle.steps.map(step => {
        const { stepDefinition } = findStepDefinitionMatch(step.text, { stepType: 'Context', dataType: '' });
        if (!stepDefinition.f.registration?.owner) throw new Error(`Unowned definition: ${feature}: ${step.text}`);
        return { text: step.text, registration: stepDefinition.f.registration };
      });
      return { name: pickle.name, tags, hooks, steps };
    });
    const roots = [...new Set([...always, ...cases.flatMap(item => [...item.hooks, ...item.steps.map(step => step.registration)])]
      .map(entry => entry.owner))].sort();
    if (!cases.length || roots.some(path => !path)) throw new Error(`Incomplete binding inventory: ${feature}`);
    result.push({ feature, cases, roots });
  }
  if (scoped) {
    const unit = JSON.parse(readFileSync(process.env.OPERATIONS_CI_CONTEXT, 'utf8'));
    const observed = result.find(item => item.feature === unit.feature);
    if (JSON.stringify(observed?.cases) !== JSON.stringify(unit.bindings))
      throw new Error(`Scoped step/hook bindings differ from the full registry: ${unit.feature}`);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [output, ...features] = process.argv.slice(2);
  if (!output) throw new Error('Usage: ci-discover.mjs <output> [feature ...]');
  const selected = features.length ? features : globSync('tests/browser/*.feature').sort();
  writeFileSync(output, JSON.stringify(await collectBindings(selected)) + '\n');
}
