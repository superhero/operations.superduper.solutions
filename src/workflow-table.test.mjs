// Copyright (C) 2026 Erik Landvall; SPDX-License-Identifier: AGPL-3.0-only.
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Then } from '@cucumber/cucumber';
import { chartSnapshot, updateChartSnapshot, defaultChartData } from './lib/workflow-chart.ts';
import { tableColumnFormats } from './lib/workflow-table.ts';
import { chartPalette, tableBooleanStyles } from './lib/workflow-chart-presentation.ts';

const table = values => chartSnapshot('table', 'run', { ...defaultChartData(), kind: 'table' }, values);
Then('table columns infer genuine numeric and boolean types across bounded updates', () => {
  const snapshot = table([{ n: 1, b: true, id: '001', literal: 'false', blank: null, mixed: 2 },
    { n: 1.25, b: false, id: '002', literal: 'true', blank: null, mixed: '2' }]);
  assert.deepEqual(tableColumnFormats(snapshot).map(column => column.kind), ['number', 'boolean', 'text', 'text', 'text', 'text']);
  assert.deepEqual(snapshot.rowTypes[0], ['number', 'boolean', 'text', 'text', 'empty', 'number']);
  assert.equal(tableColumnFormats(snapshot)[2].format('001'), '001');
  assert.equal(tableColumnFormats(table([true, null, false]))[0].kind, 'boolean');
  assert.equal(tableColumnFormats(table([1, undefined, 2]))[0].kind, 'number');
  assert.equal(tableColumnFormats(table([true, 'true']))[0].kind, 'text');
  const data = { ...defaultChartData(), kind: 'table', maxPoints: 2 };
  let live = updateChartSnapshot(undefined, 'table', 'run', data, 'rows', [1, '2']);
  live = updateChartSnapshot(live, 'table', 'run', data, 'rows', [3.25], true);
  assert.equal(tableColumnFormats(live)[0].kind, 'text');
  live = updateChartSnapshot(live, 'table', 'run', data, 'rows', [4], true);
  assert.deepEqual(live.rowTypes, [['number'], ['number']]);
  assert.deepEqual(live.rows, [['3.25'], ['4']]);
  assert.equal(tableColumnFormats(live)[0].format('4'), '4.00');
  live = updateChartSnapshot(live, 'table', 'run', data, 'rows', [false]);
  assert.deepEqual(live.rowTypes, [['boolean']]);
});
Then('table decimal formatting keeps meaningful fractions and suppresses rounding noise', () => {
  const cases = [
    [[0.1 + 0.2, 1.2, 2, null], ['0.3', '1.2', '2.0', '']],
    [[1.0050000000000001, -2.5, 3], ['1.005', '-2.500', '3.000']],
    [[0.1000000000000001, 0.7 - 0.6], ['0.1', '0.1']],
    [[1.0000000000000002, -0, -2], ['1', '0', '-2']],
    [[1.23456789, 1.23], ['1.23456789', '1.23000000']],
    [[0.0000001, 0.0000002], ['0.0000001', '0.0000002']],
    [[0.1 + 0.2, 0.1000000000000001, 1e-18], ['0.300000000000000000', '0.100000000000000000', '0.000000000000000001']],
    [[1000000000000.25, 2], ['1000000000000.25', '2.00']],
    [[1e-25, 1.25e-25, 0], ['1.00E-25', '1.25E-25', '0.00E0']],
    [[0.1 + 0.2, 1.25e-25], ['3.00E-1', '1.25E-25']],
    [[1e25, 2.5e25], ['1.0E25', '2.5E25']]
  ];
  for (const [values, expected] of cases) {
    const snapshot = table(values), raw = structuredClone(snapshot.rows), column = tableColumnFormats(snapshot)[0];
    assert.deepEqual(snapshot.rows.map(row => column.format(row[0])), expected, JSON.stringify(values));
    assert.deepEqual(snapshot.rows, raw, 'Display precision must leave raw/exported text intact');
  }
});
Then('boolean table styles keep readable red and green hints in every theme mode', () => {
  const css = readFileSync(new URL('./palette.css', import.meta.url), 'utf8');
  const rgb = color => color.startsWith('#') ? color.slice(1).match(/../g).map(value => parseInt(value, 16)) : color.match(/[\d.]+/g).map(Number);
  const luminance = color => rgb(color).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  let themes = 0;
  for (const block of css.matchAll(/\{([^}]+)\}/g)) {
    const tones = [...block[1].matchAll(/--palette-\d:\s*(#[\da-f]{6})/gi)].map(match => match[1]);
    if (tones.length !== 6) continue;
    for (const active of [tones, [...tones].reverse()]) {
      const palette = chartPalette({ getPropertyValue: name => active[Number(name.slice(-1)) - 1] });
      const styles = tableBooleanStyles(palette); assert.notDeepEqual(styles.true, styles.false);
      for (const { color, background } of Object.values(styles)) {
        const contrast = (Math.max(luminance(color), luminance(background)) + 0.05) / (Math.min(luminance(color), luminance(background)) + 0.05);
        assert.ok(contrast >= 4.5, JSON.stringify({ tones: active, color, background, contrast }));
      }
      themes++;
    }
  }
  assert.ok(themes >= 40);
});

Then('repeated numbers share formatting and incomplete runtime rows remain text', () => {
  const repeated = table([1.2, 1.2, 2]), column = tableColumnFormats(repeated)[0];
  assert.deepEqual(repeated.rows.map(row => column.format(row[0])), ['1.2', '1.2', '2.0']);
  const incomplete = { columns: [{ id: 'old', label: 'Old' }], rows: [[], ['001']], rowTypes: undefined };
  const legacy = tableColumnFormats(incomplete)[0]; assert.equal(legacy.kind, 'text'); assert.equal(legacy.format('001'), '001');
});
