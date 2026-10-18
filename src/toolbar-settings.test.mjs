// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { toolbarButtonGroups, toolbarButtonNames, defaultToolbarButtons, normalizeToolbarButtons } from './lib/toolbar-settings.ts';
Then('toolbar preferences default to visible and normalize only known boolean choices', () => {
  for (const value of [null, undefined, [], true, 42, {}]) assert.deepEqual(normalizeToolbarButtons(value), defaultToolbarButtons);
  const grouped = toolbarButtonGroups.flatMap(group => group.buttons);
  assert.equal(new Set(grouped).size, toolbarButtonNames.length);
  assert.deepEqual([...grouped].sort(), [...toolbarButtonNames].sort());
  const saved = normalizeToolbarButtons({ copy: false, paste: true, run: 'false', unknown: false });
  assert.equal(saved.copy, false);
  assert.equal(saved.paste, true);
  assert.equal(saved.run, true);
  assert.equal(Object.hasOwn(saved, 'unknown'), false);
  assert.equal(Object.keys(saved).length, toolbarButtonNames.length);
  saved.copy = true;
  assert.equal(normalizeToolbarButtons({ copy: false }).copy, false);
  assert.ok(Object.values(defaultToolbarButtons).every(Boolean));
});
