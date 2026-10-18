// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const qualifiedOutcomes = ['passing behavior', 'assertion failure', 'After-hook failure'];
const cache = new Map();
const screenshot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6E0AAAAASUVORK5CYII=', 'base64');
// A valid empty ZIP tests attachment downloads without starting another browser.
// Real Playwright traces are produced by the normal browser-support hooks.
const zip = Buffer.from('504b05060000000000000000000000000000000000000000', 'hex');
const quote = JSON.stringify;

function normalizedOptions(options) {
  const result = { outcome: 'passing behavior', html: true, coverage: true,
    projects: ['source'], outline: false, coverageThresholds: false, ...options };
  if (!qualifiedOutcomes.includes(result.outcome)) throw new Error(`Unknown report fixture outcome: ${result.outcome}`);
  if (typeof result.coverageThresholds !== 'boolean' || result.coverageThresholds
    && (!result.coverage || result.outcome !== 'passing behavior'))
    throw new Error('The coverage threshold control requires coverage and otherwise passing cases.');
  if (!Array.isArray(result.projects) || !result.projects.length || result.projects.some(name =>
    !['source', 'acceptance', 'automation', 'browser-chromium', 'components', 'runner'].includes(name)))
    throw new Error('Report fixtures need supported project identities.');
  return result;
}

async function buildFixture(root, options, assets) {
  await mkdir(join(root, 'features'), { recursive: true });
  await mkdir(join(root, 'evidence'), { recursive: true });
  await mkdir(join(root, 'src/nested'), { recursive: true });
  await mkdir(join(root, 'tests/gherkin'), { recursive: true });
  await mkdir(join(root, 'tmp/test/blobs'), { recursive: true });
  await mkdir(join(root, 'tmp/test/executions'), { recursive: true });
  await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
  await writeFile(join(root, 'package.json'), '{"type":"module","private":true}\n');
  await writeFile(join(root, 'evidence/page.png'), assets.screenshot);
  await writeFile(join(root, 'evidence/trace-download.zip'), assets.trace);
  await writeFile(join(root, 'src/root.js'), 'export const answer = 42;\n');
  for (const name of ['source-a', 'source_a']) await writeFile(join(root, `src/nested/${name}.js`),
    `export function choose(value) {\n  if (value) return 'Ω';\n  return 'other';\n}\n`
    + Array.from({ length: 80 }, (_, index) => `// ${name} line ${index + 1}: Ω <script>`).join('\n') + '\n');
  const features = options.projects.map(name => `features/${name}.feature`);
  for (const [index, project] of options.projects.entries()) {
    const cases = options.outline ? `  Background:\n    Given a fixture background\n\n`
      + `  Scenario: An independently reported passing source behavior\n    Then the independent source behavior succeeds\n\n`
      + `  Scenario Outline: The observed source behavior\n    Then the observed source behavior is checked for "<value>"\n`
      + `    Examples:\n      | value |\n      | same  |\n      | same  |\n`
      : `  Scenario: An independently reported passing source behavior\n    Then the independent source behavior succeeds\n\n`
      + `  @observed-source\n  Scenario: The observed source behavior\n    Then the observed source behavior is checked\n`;
    await writeFile(join(root, features[index]), `@fixture\nFeature: ${project} reporting fixture\n${cases}`);
  }
  await writeFile(join(root, 'steps.mjs'), `import assert from 'node:assert/strict';
import { join } from 'node:path';
import { After, Given, Then } from 'quickpickle';
import { answer } from './src/root.js';
import { choose } from './src/nested/source-a.js';
const outcome = ${quote(options.outcome)};
Given('a fixture background', () => assert.equal(answer, 42));
Then('the independent source behavior succeeds', async world => {
  assert.equal(answer, 42); assert.equal(choose(true), 'Ω');
  await world._quickpickleContext.annotate('Fixture screenshot', { path: join(import.meta.dirname, 'evidence/page.png'), contentType: 'image/png' });
  await world._quickpickleContext.annotate('Fixture trace download', { path: join(import.meta.dirname, 'evidence/trace-download.zip'), contentType: 'application/zip' });
});
Then('the observed source behavior is checked', () => {
  assert.notEqual(outcome, 'assertion failure', 'Source assertion failed deliberately');
});
Then('the observed source behavior is checked for {string}', (_, value) => assert.equal(value, 'same'));
After('@observed-source', () => {
  assert.notEqual(outcome, 'After-hook failure', 'Source cleanup failed deliberately');
});
`);
  const coverage = options.coverage ? {
    enabled: true, provider: 'v8', include: ['src/**/*.js'], exclude: [],
    reportOnFailure: true, reportsDirectory: 'tmp/test/report/coverage',
    reporter: ['json', 'json-summary', 'html'],
    ...(options.coverageThresholds ? { thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 } } : {}),
  } : { enabled: false };
  // Use the application's real execution defaults and native QuickPickle
  // registration; only fixture paths, outputs and coverage scope differ.
  const sharedConfig = fileURLToPath(new URL('../config.mjs', import.meta.url));
  const config = `import { createTestConfig } from ${quote(sharedConfig)};
import { quickpickle } from 'quickpickle';
const base = await createTestConfig('source');
const root = import.meta.dirname;
const projects = ${quote(options.projects)};
const common = { environment: 'node', pool: 'forks', maxWorkers: 1, fileParallelism: false,
  isolate: false, retry: 0, testTimeout: 10000, hookTimeout: 10000,
  setupFiles: ['steps.mjs'], server: { deps: { external: ['quickpickle', /[\\\\/]tests[\\\\/]gherkin[\\\\/]quickpickle[\\\\/]/] } } };
// Setup arrays are inherited by projects; repeating them concatenates the same
// registration twice and creates ambiguous steps in an otherwise passing run.
const { setupFiles, ...projectDefaults } = common;
export default { ...base, root, cacheDir: 'tmp/test/cache',
  plugins: projects.length === 1 ? [quickpickle({ root, stepTimeout: 5000 })] : [],
  test: { ...base.test, ...common, name: projects[0], include: ${quote(features)},
    attachmentsDir: 'tmp/test/report/attachments', coverage: ${quote(coverage)},
    reporters: [['json', { outputFile: 'tmp/test/report/results.json' }],
      ['blob', { outputFile: 'tmp/test/blobs/fixture.json' }],
      ${options.html ? "['html', { outputDir: 'tmp/test/report' }]" : ''}].filter(Boolean),
    ...(projects.length > 1 ? { include: [], projects: projects.map(name => ({
      root, plugins: [quickpickle({ root, stepTimeout: 5000 })],
      test: { ...projectDefaults, name, include: ['features/' + name + '.feature'] }
    })) } : {})
  }
};
`;
  await writeFile(join(root, 'vitest.config.mjs'), config);
  await writeFile(join(root, 'tests/gherkin/merge.config.mjs'), `import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
const output = process.env.OPERATIONS_REPORT_DIRECTORY || 'tmp/test/merged-report';
export default defineConfig({ root: fileURLToPath(new URL('../../', import.meta.url)),
  test: { include: [], projects: ${quote(options.projects)}.map(name => ({test:{name, include:[]}})),
    coverage: { ...${quote(coverage)}, reportsDirectory: output + '/coverage' },
    reporters: [['json',{outputFile:output+'/results.json'}], ['html',{outputDir:output}]]
  }
});\n`);
  const execution = spawnSync(process.execPath, [join(repository, 'node_modules/vitest/vitest.mjs'),
    'run', '--configLoader', 'native', '--config', join(root, 'vitest.config.mjs')], {
    cwd: root, env: { ...process.env, OPERATIONS_TEST_TAGS: '', OPERATIONS_FEATURES: '',
      OPERATIONS_TEST_PROFILE: 'source', OPERATIONS_COVERAGE: '0' },
    encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024,
  });
  if (execution.error) throw execution.error;
  if (!existsSync(join(root, 'tmp/test/report/results.json')))
    throw new Error(`Vitest report fixture produced no machine results.\n${execution.stdout}\n${execution.stderr}`);
  await writeFile(join(root, 'tmp/test/executions/fixture.json'), JSON.stringify({ featurePaths: features,
    complete: false, diagnostic: true, reason: 'Tiny Gherkin controls are not full application validation.' }));
  await writeFile(join(root, 'tmp/test/execution.json'), JSON.stringify({ status: execution.status,
    stdout: execution.stdout, stderr: execution.stderr }));
}

/**
 * Produce real Gherkin/Vitest results, assets and V8 coverage. Cache only the
 * immutable control run; each caller gets its own writable copy for mutations.
 */
export async function createReportFixture(directory, options = {}) {
  const settings = normalizedOptions(options);
  const assets = settings.attachments ? {
    screenshot: await readFile(settings.attachments.screenshotPath),
    trace: await readFile(settings.attachments.tracePath),
  } : { screenshot, trace: zip };
  const digest = value => createHash('sha256').update(value).digest('hex');
  const key = JSON.stringify({ ...settings,
    attachments: { screenshot: digest(assets.screenshot), trace: digest(assets.trace) } });
  if (!cache.has(key)) cache.set(key, (async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'operations-vitest-report-'));
    await buildFixture(fixture, settings, assets);
    return fixture;
  })());
  const source = await cache.get(key);
  await cp(source, directory, { recursive: true, dereference: false,
    filter: path => !path.includes('/tmp/test/cache/') });
  const reportDirectory = join(directory, 'tmp/test/report');
  const jsonFile = join(reportDirectory, 'results.json');
  const results = JSON.parse(await readFile(jsonFile, 'utf8'));
  const execution = JSON.parse(await readFile(join(directory, 'tmp/test/execution.json'), 'utf8'));
  const cases = results.testResults.flatMap(file => file.assertionResults);
  const expected = settings.projects.length * (settings.outline ? 3 : 2);
  const everyCasePassed = cases.every(item => item.status === 'passed');
  if (cases.length !== expected || (settings.outcome === 'passing behavior'
    && (!everyCasePassed || (!settings.coverageThresholds && (execution.status !== 0 || !results.success)))))
    throw new Error(`Report control did not execute its declared ${expected} cases successfully.\n`
      + cases.filter(item => item.status !== 'passed').flatMap(item => item.failureMessages).join('\n')
      + `\n${execution.stdout}\n${execution.stderr}`);
  if (settings.coverageThresholds) {
    const summary = JSON.parse(await readFile(join(reportDirectory, 'coverage/coverage-summary.json'), 'utf8'));
    const diagnostics = `${execution.stdout}\n${execution.stderr}`.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    const thresholdError = /^ERROR: Coverage for (?:statements|branches|functions|lines) \([\d.]+%\) does not meet global threshold \(100%\)$/;
    const errors = diagnostics.split(/\r?\n/).map(line => line.trim()).filter(line => /ERROR:|Error:|Unhandled|FAIL\b/.test(line));
    if (execution.status !== 1 || results.numFailedTests !== 0 || results.numPendingTests !== 0
      || results.numTodoTests !== 0 || results.numFailedTestSuites !== 0 || !everyCasePassed
      || cases.some(item => !item.meta?.gherkin?.steps?.every(step => step.status === 'passed'))
      || errors.some(line => !thresholdError.test(line)))
      throw new Error(`The coverage control failed outside its expected threshold gate.\n${diagnostics}`);
    for (const metric of ['statements', 'branches', 'functions', 'lines']) {
      const message = new RegExp(`ERROR: Coverage for ${metric} \\([\\d.]+%\\) does not meet global threshold \\(100%\\)`);
      if (!(summary.total?.[metric]?.pct < 100) || !message.test(diagnostics))
        throw new Error(`The real ${metric} coverage threshold did not fail as expected.\n${diagnostics}`);
    }
  }
  return { root: directory, reportDirectory, index: join(reportDirectory, 'index.html'),
    coverageDirectory: join(reportDirectory, 'coverage'), jsonFile,
    blobDirectory: join(directory, 'tmp/test/blobs'), results, execution,
    featurePaths: settings.projects.map(name => `features/${name}.feature`),
    projectJsonFiles: [jsonFile], projects: settings.projects };
}
