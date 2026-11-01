// Copyright (C) 2026 Erik Landvall; SPDX-License-Identifier: AGPL-3.0-only.
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { defaultChartSettings, normalizeChartSettings, chartPatternKinds, chartPatternOptions, chartDecal } from './lib/chart-settings.ts';
import { chartSettingsState } from './lib/chart-settings-state.ts';
import { chartPalette, chartIdentityStyle, chartNamedStyles, tableBooleanStyles } from './lib/workflow-chart-presentation.ts';
import { createChartInspection, zoomChartRange, chartPlotBounds, chartSelection, chartLegendLayout, sankeyHighlights, sankeyNodeKey, sankeyLinkKey } from './lib/workflow-chart-interaction.ts';

Then('chart preferences default to solid graphs and validate each graph independently', () => {
  for (const value of [null, undefined, false, [], {}, { patterns: null }, { patterns: 'diagonal' }]) assert.deepEqual(normalizeChartSettings(value), defaultChartSettings);
  const selected = normalizeChartSettings({ patterns: { bar: 'vertical', area: 'horizontal', sankey: 'dots', pie: 'diagonal', line: 'dashed', scatter: 'invented', unknown: 'dots' } });
  assert.deepEqual(selected.patterns, { bar: 'vertical', area: 'horizontal', sankey: 'dots', pie: 'diagonal', line: 'dashed', scatter: 'none' });
  assert.deepEqual(normalizeChartSettings({ patterns: { line: 'vertical', bar: 'dashed' } }), defaultChartSettings);
  for (const kind of chartPatternKinds) for (const option of chartPatternOptions(kind)) assert.equal(normalizeChartSettings({ patterns: { [kind]: option.value } }).patterns[kind], option.value);
  selected.patterns.bar = 'none'; assert.equal(defaultChartSettings.patterns.bar, 'none');
});
Then('chart patterns keep the supplied theme color and support independent fill and line styles', () => {
  const color = '#eee9df';
  for (const pattern of ['none', 'dashed', 'dotted']) assert.equal(chartDecal(pattern, color), undefined);
  const shapes = ['diagonal', 'vertical', 'horizontal', 'dots'].map(pattern => chartDecal(pattern, color));
  assert.ok(shapes.every(shape => shape.color === color));
  assert.equal(new Set(shapes.map(shape => JSON.stringify(shape))).size, 4);
  assert.equal(shapes[3].symbol, 'circle');
});
Then('chart zoom preserves its centre and clamps its bounds without sharing run state', () => {
  assert.deepEqual(zoomChartRange({ start: 0, end: 100 }, 2), { start: 25, end: 75 });
  assert.deepEqual(zoomChartRange({ start: 25, end: 75 }, 0.5), { start: 0, end: 100 });
  assert.deepEqual(zoomChartRange({ start: 95, end: 100 }, 0.5), { start: 90, end: 100 });
  let range = { start: 0, end: 100 };
  for (let i = 0; i < 40; i++) range = zoomChartRange(range, 2);
  assert.equal(range.end - range.start, 1);
  const first = createChartInspection(), second = createChartInspection();
  first.x = range; first.selected.CPU = false; first.paused = true; first.filter = 'cpu';
  assert.deepEqual(second, createChartInspection());
});
Then('chart selections require Shift for axis ranges and stay inside the plot', () => {
  const plot = chartPlotBounds(800, 500, true);
  assert.equal(chartSelection([150, 120], [153, 122], plot), undefined);
  assert.equal(chartSelection([20, 120], [400, 300], plot), undefined);
  const forward = chartSelection([150, 120], [500, 300], plot);
  assert.deepEqual(forward, { left: 150, top: 120, right: 500, bottom: 300, zoomX: true, zoomY: true });
  assert.deepEqual(chartSelection([500, 300], [150, 120], plot), forward);
  assert.deepEqual(chartSelection([150, 120], [900, 900], plot), { left: 150, top: 120, right: plot.right, bottom: plot.bottom, zoomX: true, zoomY: true });
  assert.equal(chartSelection([150, 120], [500, 122], plot), undefined);
  assert.equal(chartSelection([150, 120], [152, 300], plot), undefined);
  assert.equal(chartSelection([150, 120], [153, 122], plot, true), undefined);
  assert.deepEqual(chartSelection([150, 120], [500, 122], plot, true), { left: 150, right: 500, top: plot.top, bottom: plot.bottom, zoomX: true, zoomY: false });
  assert.deepEqual(chartSelection([150, 120], [152, 300], plot, true), { left: plot.left, right: plot.right, top: 120, bottom: 300, zoomX: false, zoomY: true });
  assert.deepEqual(chartSelection([500, 122], [150, 120], plot, true), chartSelection([150, 120], [500, 122], plot, true));
  assert.deepEqual(chartSelection([150, 120], [500, 300], plot, true), { left: 150, right: 500, top: plot.top, bottom: plot.bottom, zoomX: true, zoomY: false });
});

Then('Sankey highlights combine clicked items and ignore missing selections', () => {
  const graph = { nodes: ['Europe', 'America', 'Edge', 'Storage'].map(name => ({ name })), links: [
    { source: 'Europe', target: 'Edge', value: 30 }, { source: 'America', target: 'Edge', value: 20 }, { source: 'Edge', target: 'Storage', value: 50 }
  ] };
  const europe = sankeyNodeKey('Europe'), america = sankeyNodeKey('America'), storage = sankeyLinkKey('Edge', 'Storage');
  const first = sankeyHighlights(graph, [europe]);
  assert.deepEqual([...first.nodes].sort(), ['Edge', 'Europe']);
  assert.deepEqual([...first.links], [sankeyLinkKey('Europe', 'Edge')]);
  const combined = sankeyHighlights(graph, [europe, america, storage]);
  assert.equal(combined.active, true);
  assert.deepEqual([...combined.selectedNodes].sort(), ['America', 'Europe']);
  assert.deepEqual([...combined.selectedLinks], [storage]);
  assert.equal(combined.nodes.size, 4); assert.equal(combined.links.size, 3);
  const updated = { nodes: [...graph.nodes].reverse(), links: [...graph.links].reverse().map(link => ({ ...link, value: link.value * 2 })) };
  assert.deepEqual(sankeyHighlights(updated, [europe, america, storage]), combined);
  assert.deepEqual([...sankeyHighlights(graph, [america]).nodes].sort(), ['America', 'Edge']);
  assert.equal(sankeyHighlights(graph, []).active, false);
  assert.equal(sankeyHighlights(graph, [sankeyNodeKey('Removed'), sankeyLinkKey('Removed', 'Edge')]).active, false);
  assert.notEqual(sankeyNodeKey('Edge'), sankeyLinkKey('Edge', ''));
  const firstRun = createChartInspection(), secondRun = createChartInspection();
  firstRun.sankeySelection.push(europe); assert.deepEqual(secondRun.sankeySelection, []);
});

Then('legend rows fit the measured width and share their reserved space with selection geometry', () => {
  assert.equal(chartPlotBounds(800, 500, false).top, 16);
  const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
  const measured = name => name.length * 8;
  const wrapped = chartLegendLayout(names, 220, 800, 12, measured);
  assert.equal(wrapped.scroll, false); assert.ok(wrapped.height > wrapped.lineHeight);
  assert.deepEqual(wrapped.items.map(item => item.name), names);
  assert.ok(wrapped.items.every(item => item.width + wrapped.itemWidth + 9 <= wrapped.available));
  assert.equal(chartPlotBounds(220, 800, true, wrapped.height).top, wrapped.height + 12);
  const wider = chartLegendLayout(names, 1000, 800, 12, measured);
  assert.ok(wider.height < wrapped.height); assert.equal(wider.scroll, false);
  const crowded = chartLegendLayout(names, 220, 200, 12, measured);
  assert.equal(crowded.scroll, true); assert.equal(crowded.height, crowded.lineHeight);
  const long = chartLegendLayout(['x'.repeat(200)], 220, 800, 12, measured);
  assert.equal(long.items[0].truncated, true);
  assert.ok(long.items[0].width + long.itemWidth + 9 <= long.available);
  assert.equal(chartLegendLayout([], 220, 800, 12, measured).height, 0);
  assert.equal(chartLegendLayout(['Alpha', 'Alpha'], 220, 800, 12, measured).items.length, 1);
  const first = createChartInspection(), second = createChartInspection(); first.legendScroll = 6;
  assert.equal(second.legendScroll, 0);
});

Then('chart pattern subscribers receive normalized updates and release their subscription', () => {
  const seen = [], unsubscribe = chartSettingsState.subscribe(value => seen.push(structuredClone(value)));
  try {
    const next = normalizeChartSettings({ patterns: { line: 'dashed', pie: 'dots' } });
    chartSettingsState.set(next);
    assert.deepEqual(seen.at(-1), next); assert.equal(defaultChartSettings.patterns.line, 'none');
    unsubscribe(); const count = seen.length; chartSettingsState.set(defaultChartSettings); assert.equal(seen.length, count);
  } finally { unsubscribe(); chartSettingsState.set(defaultChartSettings); }
});
Then('chart colors reject malformed tones and keep degenerate palettes bounded', () => {
  const palette = chartPalette({ getPropertyValue: () => '#888888' });
  for (const invalid of ['invalid', 'rgb(1)']) assert.throws(() => chartIdentityStyle('CPU', { ...palette, colors: [invalid, invalid, invalid, invalid] }), /RGB color tones/);
  const styles = chartNamedStyles(['CPU', 'Memory'], palette);
  assert.equal(styles.size, 2); assert.ok([...styles.values()].every(style => style.color === 'rgb(136, 136, 136)'));
  const booleans = tableBooleanStyles(palette);
  assert.equal(booleans.true.color, '#888888'); assert.equal(booleans.false.color, '#888888');
});
