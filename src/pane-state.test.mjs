// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, After, Then } from '@cucumber/cucumber';
import { vi } from 'vitest';
import { paneStateKey, emptyNavigationState, readPaneState, savePaneState, flushPaneState } from './lib/pane-state.ts';

const state = () => ({ version: 1, navigationOpen: true, settingsOpen: true, lastOpenedPane: 'settings',
  navigation: { prompt: 'Upload file', catalogPath: ['provider', 'files'], workflowsOpen: true,
    matchingOpen: true, searchExpansion: { files: false, messages: true }, scrollTop: 160 },
  settings: { section: 'theme', scrollTop: 420 } });
let contents, writes;
Before({ tags: '@pane-state' }, () => {
  contents = new Map(); writes = [];
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: key => contents.get(key) ?? null,
    setItem: (key, value) => { writes.push([key, value]); contents.set(key, value); } });
  flushPaneState();
});
After({ tags: '@pane-state' }, () => { flushPaneState(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const store = value => contents.set(paneStateKey, JSON.stringify(value));

Then('the pane snapshot falls back for {word}', kind => {
  const snapshots = { malformed: '{', oversized: ' '.repeat(200_001), null: 'null', array: '[]' };
  if (kind !== 'missing') contents.set(paneStateKey, snapshots[kind]);
  assert.equal(readPaneState(), null);
});
Then('the pane snapshot falls back for unsupported version', () => {
  store({ ...state(), version: 2 }); assert.equal(readPaneState(), null);
});
Then('the pane snapshot falls back for missing navigation', () => {
  store({ ...state(), navigationOpen: undefined }); assert.equal(readPaneState(), null);
});
Then('the pane snapshot falls back for missing settings', () => {
  store({ ...state(), settingsOpen: undefined }); assert.equal(readPaneState(), null);
});
Then('pane storage retains visibility navigation settings and reading positions', () => {
  const original = state(); savePaneState(original); flushPaneState();
  assert.deepEqual(readPaneState(), original);
  assert.deepEqual(writes.map(([key]) => key), [paneStateKey]);
});
Then('pane state recovers nested {word} values', kind => {
  const nested = { null: null, array: [], scalar: 7 }[kind];
  store({ version: 1, navigationOpen: false, settingsOpen: false, navigation: nested, settings: nested });
  assert.deepEqual(readPaneState(), { version: 1, navigationOpen: false, settingsOpen: false,
    lastOpenedPane: 'navigation', navigation: emptyNavigationState(), settings: { section: null, scrollTop: 0 } });
});
Then('pane snapshots limit oversized fields and reject invalid expansion entries', () => {
  const snapshot = state();
  snapshot.navigation.prompt = 'q'.repeat(500);
  snapshot.navigation.catalogPath = [17, 'x'.repeat(2049), ...Array.from({ length: 70 }, (_, i) => `branch-${i}`)];
  snapshot.navigation.searchExpansion = Object.fromEntries([['x'.repeat(8193), true], ['invalid', 7],
    ...Array.from({ length: 270 }, (_, i) => [`branch-${i}`, Boolean(i % 2)])]);
  snapshot.navigation.scrollTop = 20_000_000;
  snapshot.settings.section = 'unsupported';
  store(snapshot);
  const saved = readPaneState();
  assert.equal(saved.navigation.prompt, 'q'.repeat(240));
  assert.deepEqual(saved.navigation.catalogPath, Array.from({ length: 64 }, (_, i) => `branch-${i}`));
  assert.deepEqual(saved.navigation.searchExpansion, Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`branch-${i}`, Boolean(i % 2)])));
  assert.equal(saved.navigation.scrollTop, 10_000_000);
  assert.deepEqual(saved.settings, { section: null, scrollTop: 420 });
});
Then('pane reading positions reject {word}', kind => {
  const position = { negative: '-3', infinite: '1e400', text: '"42"' }[kind];
  contents.set(paneStateKey, `{"version":1,"navigationOpen":true,"settingsOpen":false,"navigation":{"scrollTop":${position}},"settings":{"scrollTop":${position}}}`);
  const saved = readPaneState();
  assert.equal(saved.navigation.scrollTop, 0); assert.equal(saved.settings.scrollTop, 0);
});
Then('pane snapshots coalesce writes and flush synchronously without duplicate writes', () => {
  const first = state(), second = { ...state(), navigationOpen: false };
  savePaneState(first); vi.advanceTimersByTime(100); savePaneState(second); vi.advanceTimersByTime(149);
  assert.equal(writes.length, 0);
  flushPaneState(); assert.deepEqual(readPaneState(), second);
  vi.advanceTimersByTime(150); flushPaneState(); assert.equal(writes.length, 1);
  savePaneState(first); vi.advanceTimersByTime(150);
  assert.deepEqual(readPaneState(), first); assert.equal(writes.length, 2);
});
Then('pane state tolerates blocked reads and writes and can recover', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Storage blocked'); }, setItem: () => { throw new Error('Storage full'); } });
  assert.equal(readPaneState(), null);
  assert.doesNotThrow(() => { savePaneState(state()); flushPaneState(); flushPaneState(); });
  vi.stubGlobal('localStorage', { getItem: key => contents.get(key) ?? null, setItem: (key, value) => contents.set(key, value) });
  savePaneState(state()); flushPaneState(); assert.deepEqual(readPaneState(), state());
});
Then('separate default navigation states do not share mutable contents', () => {
  const first = emptyNavigationState(); first.catalogPath.push('changed'); first.searchExpansion.changed = true;
  assert.deepEqual(emptyNavigationState(), { prompt: '', catalogPath: [], workflowsOpen: false, matchingOpen: false, searchExpansion: {}, scrollTop: 0 });
});
