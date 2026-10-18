// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { defaultKeybindings, normalizeKeybindings, shortcutFromEvent, shortcutAction, modifierKeys, modifierPressed, formatShortcut } from './lib/keybindings.ts';
const event = patch => ({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, ...patch });
Then('keybindings normalize malformed settings and reject duplicate shortcuts', () => {
  for (const value of [null, undefined, [], true, {}, { undo: 'z', nodeSelection: 'bad' }, { undo: 'Mod+y' }])
    assert.deepEqual(normalizeKeybindings(value), defaultKeybindings);
  const saved = { ...defaultKeybindings, undo: 'Alt+Shift+u', nodeSelection: 'Mod', areaSelection: 'Alt' };
  assert.deepEqual(normalizeKeybindings(saved), saved);
  assert.equal(formatShortcut('Mod+Shift+u'), 'Ctrl/Cmd + Shift + U');
});
Then('shortcuts match Control and Command exactly and ignore composition', () => {
  assert.equal(shortcutAction(event({}), defaultKeybindings), 'undo');
  assert.equal(shortcutAction(event({ key: 'Y', ctrlKey: false, metaKey: true }), defaultKeybindings), 'redo');
  assert.equal(shortcutAction(event({ key: 'a' }), defaultKeybindings), 'selectAll');
  for (const patch of [{ isComposing: true }, { getModifierState: () => true }, { metaKey: true }, { ctrlKey: false }, { key: 'Control' }])
    assert.equal(shortcutFromEvent(event(patch)), null);
  assert.equal(shortcutAction(event({ altKey: true }), defaultKeybindings), null);
  assert.equal(shortcutAction(event({ key: 'y', shiftKey: true }), defaultKeybindings), null);
});
Then('selection modifiers map to flow keys and explicit shortcuts override redo aliases', () => {
  assert.deepEqual(modifierKeys('Mod'), ['Control', 'Meta']);
  assert.deepEqual(modifierKeys('Alt'), ['Alt']);
  assert.deepEqual(modifierKeys('Shift'), ['Shift']);
  assert.equal(modifierPressed(event({}), 'Mod'), true);
  assert.equal(modifierPressed(event({ ctrlKey: false, metaKey: true }), 'Mod'), true);
  assert.equal(modifierPressed(event({}), 'Shift'), false);
  assert.equal(modifierPressed(event({ altKey: true }), 'Alt'), true);
  assert.equal(shortcutAction(event({ shiftKey: true }), defaultKeybindings), 'redo');
  assert.equal(shortcutAction(event({ shiftKey: true }), { ...defaultKeybindings, undo: 'Mod+Shift+z' }), 'undo');
  assert.equal(shortcutAction(event({ shiftKey: true }), { ...defaultKeybindings, redo: 'Alt+r' }), null);
});
