// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readResults } from './test-results.mjs';

const [output, ...arguments_] = process.argv.slice(2);
const check = arguments_.at(-1) === '--check';
const inputs = check ? arguments_.slice(0, -1) : arguments_;
try {
  if (!output || !inputs.length) throw new Error('Usage: generate-scenario-badge.sh <output-directory> <vitest-json>... [--check].');
  const reports = inputs.map(file => readResults(file));
  const ids = reports.flatMap(report => report.ids);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate case identities across scenario badge inputs.');
  const scenarios = reports.flatMap(report => report.cases);
  const passed = scenarios.filter(item => item.status === 'passed').length;
  const total = scenarios.length;
  const message = passed === total ? `${total} passed` : `${passed}/${total} passed`;
  const color = scenarios.some(item => item.status === 'failed') ? 'red' : passed === total ? 'brightgreen' : 'orange';
  const background = { red: '#e05d44', brightgreen: '#4c1', orange: '#fe7d37' }[color];
  const labelWidth = 110, valueWidth = message.length * 7 + 12, width = labelWidth + valueWidth;
  const files = {
    'test-scenarios.json': `${JSON.stringify({ schemaVersion: 1, label: 'Test Scenarios', message, color })}\n`,
    'test-scenarios.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="Test Scenarios: ${message}">
  <!-- Copyright (C) 2026 Erik Landvall; SPDX-License-Identifier: AGPL-3.0-only. See LICENSE and LICENSE-ADDITIONAL-TERMS. -->
  <title>Test Scenarios: ${message}</title>
  <clipPath id="round"><rect width="${width}" height="20" rx="3"/></clipPath>
  <g clip-path="url(#round)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${background}"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans Mono,monospace" font-size="11">
    <text x="${labelWidth / 2}" y="14">Test Scenarios</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${message}</text>
  </g>
</svg>\n`,
  };
  if (check) {
    for (const [name, expected] of Object.entries(files)) {
      if (readFileSync(join(output, name), 'utf8') !== expected) throw new Error(`Scenario badge is missing or stale: '${join(output, name)}'.`);
    }
  } else {
    mkdirSync(output, { recursive: true });
    for (const [name, content] of Object.entries(files)) writeFileSync(join(output, name), content);
  }
} catch (error) {
  console.error(`::error::${error.message} Inputs='${inputs.join(' ')}', output='${output ?? ''}'. Run npm run badges:scenarios to regenerate the report badges.`);
  process.exitCode = 1;
}
