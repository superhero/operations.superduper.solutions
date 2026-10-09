// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// A small Istanbul-style report: named line anchors, repeated IDs, relative
// assets, per-page scripts and filenames that collide when punctuation is lost.
export async function coverageFixture(directory) {
  const input = join(directory, 'coverage');
  await mkdir(join(input, 'src', 'nested'), { recursive: true });
  const document = (body, prefix = '') => `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="${prefix}base.css"></head><body>${body}
    <script src="${prefix}report.js"></script></body></html>`;
  await writeFile(join(input, 'base.css'), '.line{height:28px}body{font-family:sans-serif;background-image:url("pixel.svg")}');
  await writeFile(join(input, 'pixel.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
  await writeFile(join(input, 'report.js'), `document.body.dataset.ready = 'true';
    document.getElementById('fileSearch')?.addEventListener('input', event => {
      for (const link of document.querySelectorAll('[data-file]'))
        link.hidden = !link.textContent.includes(event.target.value);
    });`);
  await writeFile(join(input, 'index.html'), document('<h1>All files</h1><a href="src/nested/index.html">src/nested</a>'));
  await writeFile(join(input, 'src/nested/index.html'), document(`<h1>src/nested</h1>
    <a href="../../index.html">All files</a><label>Filter <input id="fileSearch"></label>
    <a data-file href="source-a.ts.html">source-a.ts</a>
    <a data-file href="source_a.ts.html">source_a.ts</a>
    <a href="source-a.ts.html#L40">Open line 40</a>`, '../../'));
  for (const name of ['source-a.ts', 'source_a.ts']) {
    const lines = Array.from({ length: 80 }, (_, index) => `<div class="line"><a name="L${index + 1}"></a>
      <a href="#L${index + 1}">${index + 1}</a><code>${name} line ${index + 1}: &lt;script&gt;Ω&lt;/script&gt;</code></div>`).join('');
    await writeFile(join(input, 'src/nested', `${name}.html`), document(`<h1>${name}</h1>
      <a href="../../index.html">All files</a><a href="index.html">src/nested</a>${lines}`, '../../'));
  }
  const output = join(directory, 'test-coverage.html');
  execFileSync(process.execPath, [resolve('.github/scripts/generate-coverage-report.mjs'), output, input]);
  return output;
}

export async function coverageNavigation(page) {
  const frame = page.frameLocator('#coverage');
  const heading = async name => {
    await frame.getByRole('heading', { name, exact: true }).waitFor();
    await frame.locator('body[data-ready="true"]').waitFor();
    assert.equal(await page.locator('#coverage-error').textContent(), '');
  };
  const visibleLine = async line => {
    await page.waitForFunction(value => {
      const frame = document.getElementById('coverage');
      const marker = frame.contentDocument.getElementsByName(value)[0];
      const top = marker?.getBoundingClientRect().top;
      return top !== undefined && top >= -1 && top < frame.clientHeight;
    }, line);
  };
  await heading('All files');
  await frame.getByRole('link', { name: 'src/nested', exact: true }).click();
  await heading('src/nested');
  await frame.getByLabel('Filter').fill('source_a');
  assert.equal(await frame.getByRole('link', { name: 'source-a.ts', exact: true }).count(), 0);
  await frame.getByLabel('Filter').fill('');
  await frame.getByRole('link', { name: 'source-a.ts', exact: true }).click();
  await heading('source-a.ts');
  await frame.getByRole('link', { name: '40', exact: true }).click();
  await page.waitForURL(url => new URLSearchParams(url.hash.slice(1)).get('line') === 'L40');
  await heading('source-a.ts');
  await visibleLine('L40');
  const deepLink = page.url();
  await page.reload();
  await heading('source-a.ts');
  await visibleLine('L40');
  await frame.getByRole('link', { name: 'src/nested', exact: true }).click();
  await heading('src/nested');
  await frame.getByRole('link', { name: 'source_a.ts', exact: true }).click();
  await heading('source_a.ts');
  await page.goBack();
  await heading('src/nested');
  await page.goBack();
  await heading('source-a.ts');
  assert.equal(page.url(), deepLink);
  await visibleLine('L40');
  await page.goForward();
  await heading('src/nested');
  await frame.getByRole('link', { name: 'Open line 40', exact: true }).click();
  await heading('source-a.ts');
  await visibleLine('L40');
  await frame.getByRole('link', { name: 'All files', exact: true }).click();
  await heading('All files');
  await page.goto(page.url().split('#')[0]);
  await heading('All files');
  await frame.getByRole('link', { name: 'src/nested', exact: true }).click();
  await heading('src/nested');
  await page.goBack();
  await heading('All files');
  await page.goto(`${page.url().split('#')[0]}#file=missing.html`);
  await page.getByRole('alert').filter({ hasText: 'Unknown embedded coverage page: missing.html' }).waitFor();
  await page.goto(deepLink);
  await heading('source-a.ts');
  await visibleLine('L40');
}

// Use the installed c8/Istanbul reporter as well as the adversarial fixture.
// Generated coverage stays inside this scenario's directory, never in the
// application's coverage directory or its V8 collection directory.
export async function realCoverageFixture(directory) {
  await mkdir(join(directory, 'src', 'nested'), { recursive: true });
  await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
  await writeFile(join(directory, 'src', 'root.js'), 'export const answer = 42;\n');
  for (const name of ['source-a', 'source_a']) {
    const padding = Array.from({ length: 80 }, (_, index) => `// ${name} line ${index + 1}: Ω`).join('\n');
    await writeFile(join(directory, 'src', 'nested', `${name}.js`),
      `export function choose(value) {\n  if (value) return 'Ω';\n  return 'other';\n}\n${padding}\n`);
  }
  await writeFile(join(directory, 'exercise.mjs'), `import { answer } from './src/root.js';
    import { choose } from './src/nested/source-a.js';
    if (answer !== 42 || choose(true) !== 'Ω') throw new Error('Unexpected fixture result');\n`);
  execFileSync(process.execPath, [resolve('node_modules/c8/bin/c8.js'), '--all', '--src=src',
    '--include=src/**/*.js', '--reporter=html', '--reports-dir=coverage', '--temp-directory=v8',
    process.execPath, 'exercise.mjs'], { cwd: directory });
  const output = join(directory, 'test-coverage.html');
  execFileSync(process.execPath, [resolve('.github/scripts/generate-coverage-report.mjs'), output, join(directory, 'coverage')]);
  return output;
}

export async function realCoverageNavigation(page) {
  const frame = page.frameLocator('#coverage');
  const ready = async () => {
    await page.waitForFunction(() => {
      const doc = document.getElementById('coverage').contentDocument;
      return doc?.readyState === 'complete' && doc.documentElement.dataset.coveragePage;
    });
    assert.equal(await page.locator('#coverage-error').textContent(), '');
  };
  const visibleLine = async () => {
    await page.waitForFunction(() => {
      const frame = document.getElementById('coverage');
      const marker = frame.contentDocument?.getElementsByName('L40')[0];
      const top = marker?.getBoundingClientRect().top;
      return top !== undefined && top >= -1 && top < frame.clientHeight;
    });
  };
  await frame.getByRole('heading', { name: 'All files', exact: true }).waitFor();
  await ready();
  await frame.locator('a[href$="nested/index.html"]').click();
  const links = frame.locator('.coverage-summary tbody td.file a');
  await links.filter({ hasText: 'source-a.js' }).waitFor();
  await ready();
  const originalOrder = await links.allTextContents();
  assert.deepEqual([...originalOrder].sort(), ['source-a.js', 'source_a.js']);
  await frame.locator('th[data-col="file"]').click();
  assert.deepEqual(await links.allTextContents(), [...originalOrder].reverse());
  await frame.locator('#fileSearch').fill('source_a');
  assert.equal(await frame.locator('.coverage-summary tbody tr:visible').count(), 1);
  assert.equal(await frame.locator('.coverage-summary tbody tr:visible td.file a').textContent(), 'source_a.js');
  await frame.locator('#fileSearch').fill('');
  await frame.getByRole('link', { name: 'source-a.js', exact: true }).click();
  await frame.getByRole('heading').filter({ hasText: 'source-a.js' }).waitFor();
  await ready();
  assert.ok((await frame.locator('pre.prettyprint').textContent()).includes('Ω'));
  await frame.locator('a[href="#L40"]').click();
  await page.waitForURL(url => new URLSearchParams(url.hash.slice(1)).get('line') === 'L40');
  await visibleLine();
  const deepLink = page.url();
  await page.reload();
  await frame.getByRole('heading').filter({ hasText: 'source-a.js' }).waitFor();
  await ready();
  await visibleLine();
  await frame.locator('h1 a[href="index.html"]').click();
  await frame.getByRole('link', { name: 'source_a.js', exact: true }).waitFor();
  await ready();
  await frame.getByRole('link', { name: 'source_a.js', exact: true }).click();
  await frame.getByRole('heading').filter({ hasText: 'source_a.js' }).waitFor();
  await ready();
  await page.goBack();
  await frame.getByRole('link', { name: 'source_a.js', exact: true }).waitFor();
  await page.goBack();
  await frame.getByRole('heading').filter({ hasText: 'source-a.js' }).waitFor();
  assert.equal(page.url(), deepLink);
  await visibleLine();
  await page.goForward();
  await frame.getByRole('link', { name: 'source_a.js', exact: true }).waitFor();
  await ready();
}
