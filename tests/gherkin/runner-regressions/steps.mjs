// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';
import { BeforeAll, Then, quickpickle } from 'quickpickle';
import { aggregateFailures, hookReportError } from '../quickpickle/src/diagnostics.mjs';
import { readResults } from '../../../.github/scripts/test-results.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const cli = join(root, 'node_modules/vitest/vitest.mjs');
const fixtures = new Map();

function executeFixture(mode, directory) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'run', '--configLoader', 'native', '--config',
      'tests/gherkin/runner-regressions/fixtures/vitest.config.mjs'], {
      cwd: root, detached: process.platform !== 'win32',
      env: { ...process.env, OPERATIONS_RUNNER_FIXTURE_MODE: mode,
        OPERATIONS_RUNNER_FIXTURE_OUTPUT: directory, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '', timedOut = false, interruptSent = false;
    // JSON-only Vitest reporters intentionally suppress captured console.log.
    // Observe actual step readiness through its durable event, not terminal UI.
    const watcher = mode.startsWith('interruption') ? watch(directory, () => {
      readFile(join(directory, 'ledger.ndjson'), 'utf8').then(text => {
        if (!interruptSent && text.includes('"kind":"interrupt-ready"')) {
          interruptSent = true;
          child.kill(mode === 'interruption-term' ? 'SIGTERM' : 'SIGINT');
        }
      }).catch(error => { if (error.code !== 'ENOENT') reject(error); });
    }) : undefined;
    const capture = chunk => {
      output = (output + chunk.toString()).slice(-65536);
      if (mode === 'interruption' && !interruptSent && output.includes('OPERATIONS_RUNNER_INTERRUPT_READY')) {
        interruptSent = true;
        child.kill('SIGINT');
      }
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const timer = setTimeout(() => {
      timedOut = true;
      // Kill the disposable child and its Vitest workers, never the parent job.
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') reject(error); }
    }, 20000);
    child.once('error', error => { clearTimeout(timer); watcher?.close(); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      watcher?.close();
      if (timedOut) reject(new Error(`Runner fixture ${mode} exceeded its process deadline.\n${output}`));
      else resolve({ code, output, interruptSent });
    });
  });
}

BeforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'operations-runner-'));
  // Node-only controls run sequentially inside the same bounded development/CI
  // job. Negative fixtures deliberately exit nonzero; outer Gherkin cases prove
  // their exact outcomes instead of hiding them with test.fails().
  for (const mode of ['positive', 'contracts', 'selection', 'retry', 'quarantine', 'worker', 'statuses', 'hook-errors', 'interruption', 'interruption-term', 'interruption-forced']) {
    const output = join(directory, mode);
    await mkdir(output);
    const execution = await executeFixture(mode, output);
    let results, ledger;
    try {
      ledger = (await readFile(join(output, 'ledger.ndjson'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      try { results = JSON.parse(await readFile(join(output, 'results.json'), 'utf8')); }
      catch (error) {
        // Interrupted runs may stop before reporters write JSON. Missing output
        // remains missing evidence, never a fabricated passing result.
        if (!(mode.startsWith('interruption') && execution.code !== 0 && error.code === 'ENOENT')) throw error;
      }
    } catch (error) { throw new Error(`Runner fixture ${mode} did not produce complete evidence.\n${execution.output}`, { cause: error }); }
    fixtures.set(mode, { ...execution, results, ledger, resultFile: join(output, 'results.json'),
      cases: results?.testResults.flatMap(file => file.assertionResults) ?? [] });
    const saved = fixtures.get(mode);
    saved.output += `\n${JSON.stringify({ success: results?.success,
      modules: results?.testResults.map(file => ({ name: file.name, message: file.message,
        status: file.status, failures: file.assertionResults.filter(item => item.status !== 'passed')
          .map(item => ({ title: item.title, status: item.status, messages: item.failureMessages })) })) }, null, 2)}`;
    if (mode === 'interruption-forced') {
      saved.disposedResources = ledger.filter(item => ['world-http-open', 'worker-http-open'].includes(item.kind));
      await verifyTerminatedResources(saved.disposedResources);
    } else if (mode === 'quarantine' || mode.startsWith('interruption')) {
      saved.disposedResources = await verifyDisposed(ledger);
    }
  }
});

async function verifyDisposed(ledger) {
  const resources = ledger.filter(item => ['world-http-open', 'worker-http-open'].includes(item.kind));
  for (const resource of resources) {
    const closed = ledger.find(item => item.kind === resource.kind.replace('-open', '-close')
      && item.port === resource.port && item.pid === resource.pid);
    assert.ok(closed && closed.listening === false, `Owned resource was not explicitly closed: ${JSON.stringify(resource)}`);
  }
  await verifyTerminatedResources(resources);
  return resources;
}

async function verifyTerminatedResources(resources) {
  for (const resource of resources) {
    let alive = true;
    try { process.kill(resource.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
    assert.equal(alive, false, `Fixture worker ${resource.pid} survived run completion`);
    await new Promise((done, reject) => {
      const socket = connect({ host: '127.0.0.1', port: resource.port });
      socket.setTimeout(500);
      socket.once('connect', () => { socket.destroy(); reject(new Error(`Owned HTTP port ${resource.port} is still listening`)); });
      socket.once('timeout', () => { socket.destroy(); reject(new Error(`Cannot determine whether owned port ${resource.port} closed`)); });
      socket.once('error', error => error.code === 'ECONNREFUSED' ? done() : reject(error));
    });
  }
}

function fixture(mode) {
  const found = fixtures.get(mode);
  assert.ok(found, `Missing ${mode} fixture evidence`);
  return found;
}

function scenario(name, mode = 'contracts') {
  const found = fixture(mode).cases.find(item => item.title.startsWith(`Scenario: ${name}`));
  assert.ok(found, `Missing fixture scenario ${name}`);
  return found;
}

function failure(name, message, mode = 'contracts') {
  const found = scenario(name, mode);
  assert.equal(found.status, 'failed');
  assert.match(found.failureMessages.join('\n'), message);
  return found;
}

function events(name, kinds, mode = 'contracts') {
  return fixture(mode).ledger.filter(item => item.scenario === name && kinds.includes(item.kind));
}

Then('the positive runner fixtures pass all seven cases', () => {
  const result = fixture('positive');
  assert.equal(result.code, 0, result.output);
  assert.equal(result.cases.length, 7);
  assert.ok(result.cases.every(item => item.status === 'passed'));
});

Then('their feature hooks each run once', () => {
  const ledger = fixture('positive').ledger;
  assert.equal(ledger.filter(item => item.kind === 'before-all').length, 2);
  assert.equal(ledger.filter(item => item.kind === 'after-all').length, 2);
  assert.ok(ledger.filter(item => item.kind === 'before-all').every(item => item.starts === 1));
});

Then('each positive fixture scenario initializes a fresh World', () => {
  const ledger = fixture('positive').ledger;
  const initialized = ledger.filter(item => item.kind === 'world-init');
  assert.equal(initialized.length, 7);
  // Files may have their own module instance; combine feature and World ID.
  assert.equal(new Set(initialized.map(item => `${item.feature}:${item.worldId}`)).size, 7);
  assert.equal(ledger.filter(item => item.kind === 'after').length, 7);
});

Then('DataTables and JSON docstrings retain their values', () => {
  assert.equal(scenario('DataTables and typed docstrings preserve values', 'positive').status, 'passed');
});

Then('all three outline rows have distinct canonical identities', () => {
  const rows = fixture('contracts').ledger.filter(item => item.kind === 'identity');
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(item => item.id)).size, 3);
  assert.deepEqual(rows.map(item => [item.meta.exampleBlock, item.meta.exampleRow]), [[0, 0], [0, 1], [1, 0]]);
});

Then('their inherited Examples tags are preserved', () => {
  const rows = fixture('contracts').ledger.filter(item => item.kind === 'identity');
  assert.ok(rows.every(item => item.meta.tags.includes('@runner-fixture')));
  assert.ok(rows.slice(0, 2).every(item => item.meta.tags.includes('@first')));
  assert.ok(rows[2].meta.tags.includes('@second'));
});

Then('selecting the second Examples block runs exactly one matching case', () => {
  const result = fixture('selection');
  assert.equal(result.code, 0, result.output);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].status, 'passed');
  const meta = result.cases[0].meta.gherkin;
  assert.equal(meta.exampleBlock, 1);
  assert.ok(meta.tags.includes('@second'));
  assert.ok(!meta.tags.includes('@first'));
});

Then('failed setup is reported without executing its unreachable body', () => {
  failure('World initialization failure still runs After', /EXPECTED_INIT_FAILURE/);
  failure('Before failure still runs After', /EXPECTED_BEFORE_FAILURE/);
  assert.ok(!fixture('contracts').ledger.some(item => item.kind === 'UNREACHABLE_BODY_RAN'));
});

Then('both failed setup scenarios receive one After callback', () => {
  for (const name of ['World initialization failure still runs After', 'Before failure still runs After'])
    assert.equal(events(name, ['after']).length, 1);
});

Then('the timed-out cooperative step reports its deadline', () => {
  failure('Cooperative timeout aborts and settles before cleanup', /Step timed out after 80ms/);
});

Then('its work settles before After and the following case', () => {
  const entries = events('Cooperative timeout aborts and settles before cleanup', ['cooperative-settled', 'after']);
  assert.deepEqual(entries.map(item => item.kind), ['cooperative-settled', 'after']);
  assert.ok(!fixture('contracts').ledger.some(item => item.kind === 'UNEXPECTED_COOPERATIVE_COMPLETION'));
  assert.equal(scenario('Following cooperative timeout starts after settlement').status, 'passed');
});

Then('the short uncooperative step reports its deadline', () => {
  failure('Short uncooperative work is drained after its deadline', /Step timed out after 80ms/);
});

Then('its work finishes before After and the following case', () => {
  const entries = events('Short uncooperative work is drained after its deadline', ['uncooperative-settled', 'after']);
  assert.deepEqual(entries.map(item => item.kind), ['uncooperative-settled', 'after']);
  assert.equal(scenario('Following scenario cannot overlap drained old work').status, 'passed');
});

Then('the undefined step has its complete diagnostic in the machine report', () => {
  const found = failure('Error details are retained for machine reporting', /Undefined\. Implement with the following snippet/);
  assert.match(found.failureMessages.join('\n'), /deliberately undefined patched-core step/);
  assert.match(found.failureMessages.join('\n'), /\bat\s/);
});

Then('its failed step metadata retains the same error', () => {
  const found = scenario('Error details are retained for machine reporting');
  const step = found.meta.gherkin.steps[0];
  assert.equal(step.status, 'failed');
  assert.match(step.error.message, /Undefined/);
  assert.ok(step.error.stack.includes(step.error.message));
});

Then('After callbacks unwind in reverse registration order despite a failure', () => {
  failure('A failing After does not skip remaining cleanup', /EXPECTED_AFTER_FAILURE/);
  assert.deepEqual(events('A failing After does not skip remaining cleanup',
    ['throwing-after', 'remaining-after', 'after']).map(item => item.kind),
  ['throwing-after', 'remaining-after', 'after']);
});

Then('all AfterStep callbacks finish before scenario After despite a failure', () => {
  failure('A failing AfterStep does not skip remaining step cleanup', /EXPECTED_AFTER_STEP_FAILURE/);
  assert.deepEqual(events('A failing AfterStep does not skip remaining step cleanup',
    ['throwing-after-step', 'remaining-after-step', 'after-step', 'after']).map(item => item.kind),
  ['throwing-after-step', 'remaining-after-step', 'after-step', 'after']);
});

Then('the retry fixture passes on its second attempt', () => {
  const result = fixture('retry');
  assert.equal(result.code, 0, result.output);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].status, 'passed');
  assert.deepEqual(result.ledger.filter(item => item.kind === 'retry-attempt').map(item => item.attempt), [1, 2]);
});

Then('both attempts have different Worlds and receive cleanup', () => {
  const ledger = fixture('retry').ledger;
  const worlds = ledger.filter(item => item.kind === 'world-init').map(item => item.worldId);
  assert.equal(worlds.length, 2);
  assert.equal(new Set(worlds).size, 2);
  assert.deepEqual(ledger.filter(item => item.kind === 'after').map(item => item.worldId), worlds);
});

Then('the noncooperating step exceeds its bounded grace', () => {
  const result = fixture('quarantine');
  assert.equal(result.code, 1, result.output);
  assert.equal(result.cases.length, 2);
  failure('Work that ignores abort exceeds the bounded grace', /Step timed out after 80ms/, 'quarantine');
});

Then('the following case fails before World construction or its body', () => {
  failure('A subsequent case is rejected before its World starts', /worker has unsettled timed-out work/, 'quarantine');
  const ledger = fixture('quarantine').ledger;
  assert.equal(ledger.filter(item => item.kind === 'init').length, 1);
  assert.ok(!ledger.some(item => item.kind === 'UNREACHABLE_BODY_RAN'));
  assert.equal(ledger.filter(item => item.kind === 'after').length, 1);
  assert.ok(ledger.some(item => item.kind === 'quarantine-active-handle'));
  assert.equal(fixture('quarantine').disposedResources.length, 2);
  assert.equal(ledger.filter(item => item.kind === 'worker-fixture-stop').length, 1);
});

Then('the contract fixtures report eight passed cases and seven intended failures', () => {
  const result = fixture('contracts');
  assert.equal(result.code, 1, result.output);
  assert.equal(result.cases.length, 15);
  assert.equal(result.cases.filter(item => item.status === 'passed').length, 8);
  assert.equal(result.cases.filter(item => item.status === 'failed').length, 7);
  assert.ok(result.cases.every(item => ['passed', 'failed'].includes(item.status)));
});

Then('every fixture result exposes its relative feature and example location', () => {
  for (const mode of ['positive', 'contracts', 'selection', 'retry']) for (const item of fixture(mode).cases) {
    const meta = item.meta.gherkin;
    assert.ok(meta.uri.startsWith('tests/gherkin/runner-regressions/fixtures/'));
    assert.ok(meta.line > 0 && meta.exampleLine >= meta.line);
    assert.ok(meta.id.startsWith(`${meta.uri}:`));
    assert.ok(meta.steps.length > 0);
    if (item.status === 'passed') assert.ok(meta.steps.every(step => step.status === 'passed'));
  }
});

Then('transformed features carry their original source map', async () => {
  const filename = join(root, 'tests/gherkin/runner-regressions/fixtures/positive-a.feature');
  const source = await readFile(filename, 'utf8');
  const plugin = quickpickle();
  plugin.configResolved({ root });
  const transformed = plugin.transform(source, filename);
  assert.equal(transformed.map.version, 3);
  assert.deepEqual(transformed.map.sources, [filename]);
  assert.deepEqual(transformed.map.sourcesContent, [source]);
  assert.ok(transformed.map.mappings.length > 0);
  const first = await quickpickle({ tagExpression: '@first' }).config({ cacheDir: '/tmp/runner-cache' });
  const second = await quickpickle({ tagExpression: '@second' }).config({ cacheDir: '/tmp/runner-cache' });
  assert.notEqual(first.test.fsModuleCachePath, second.test.fsModuleCachePath,
    'Different tag selections must not share Vitest persistent feature transforms');
});

Then('both extended-test fixture cases pass', () => {
  const result = fixture('worker');
  assert.equal(result.code, 0, result.output);
  assert.equal(result.cases.length, 2);
  assert.ok(result.cases.every(item => item.status === 'passed'));
});

Then('one owned worker resource starts and stops around both features', () => {
  const ledger = fixture('worker').ledger;
  assert.equal(ledger.filter(item => item.kind === 'worker-fixture-start').length, 1);
  assert.equal(ledger.filter(item => item.kind === 'worker-fixture-stop').length, 1);
  const start = ledger.findIndex(item => item.kind === 'worker-fixture-start');
  const stop = ledger.findIndex(item => item.kind === 'worker-fixture-stop');
  const bodies = ledger.map((item, index) => item.kind === 'body' ? index : -1).filter(index => index >= 0);
  assert.equal(bodies.length, 2);
  assert.ok(bodies.every(index => index > start && index < stop));
});

Then('skipped and TODO controls retain canonical metadata without executing their bodies', () => {
  const result = fixture('statuses');
  assert.equal(result.code, 0, result.output);
  assert.equal(result.cases.length, 3);
  assert.equal(result.results.numPassedTests, 1);
  assert.equal(result.results.numPendingTests, 1);
  assert.equal(result.results.numTodoTests, 1);
  assert.deepEqual(result.cases.map(item => item.status), ['passed', 'skipped', 'todo']);
  assert.equal(new Set(result.cases.map(item => item.meta.gherkin.id)).size, 3);
  assert.ok(result.cases.every(item => item.meta.gherkin.uri.endsWith('/statuses.feature')));
  assert.equal(result.ledger.filter(item => item.kind === 'world-init').length, 1);
  assert.equal(result.ledger.filter(item => item.kind === 'body').length, 1);
});

Then('the failing body and both failing After callbacks remain visible in JSON', () => {
  const found = failure('A body failure and two cleanup failures remain visible', /EXPECTED_BODY_FAILURE/, 'hook-errors');
  const text = found.failureMessages.join('\n');
  for (const name of ['EXPECTED_BODY_CAUSE', 'EXPECTED_CLEANUP_A', 'EXPECTED_CLEANUP_B']) assert.ok(text.includes(name), text);
  assert.match(text, /steps-hook-errors\.mjs:\d+/);
  assert.equal(scenario('A later body still executes before suite cleanup fails', 'hook-errors').status, 'passed');
});

Then('weighted hooks run in their declared order despite cleanup failures', () => {
  const ledger = fixture('hook-errors').ledger.filter(item =>
    item.scenario === 'A body failure and two cleanup failures remain visible');
  assert.deepEqual(ledger.map(item => item.kind), ['before-minus-10', 'before-10-first',
    'before-10-second', 'body-failed', 'after-minus-10', 'after-0-second', 'after-0-first', 'after-10']);
});

Then('both AfterAll failures remain visible and every suite cleanup runs', () => {
  const result = fixture('hook-errors');
  assert.equal(result.code, 1, result.output);
  assert.equal(result.results.success, false);
  assert.equal(result.cases.length, 2);
  const message = result.results.testResults.map(file => file.message).join('\n');
  assert.match(message, /EXPECTED_AFTERALL_A/);
  assert.match(message, /EXPECTED_AFTERALL_B/);
  assert.deepEqual(result.ledger.filter(item => item.kind.startsWith('suite-')).map(item => item.kind),
    ['suite-after-minus-10', 'suite-after-0-second', 'suite-after-0-first', 'suite-after-10']);
});

Then('nested cyclic failures have bounded readable diagnostics', () => {
  const cause = new Error('CYCLIC_CAUSE');
  cause.cause = cause;
  const nested = new AggregateError([cause], 'CYCLIC_AGGREGATE');
  nested.errors.push(nested);
  const result = aggregateFailures([nested], 'Outer error');
  assert.equal(result.errors[0], nested);
  assert.equal(nested.errors[0].cause, cause);
  assert.match(result.message, /CYCLIC_CAUSE/);
  assert.match(result.message, /Circular error reference/);
  assert.match(result.stack, /Circular error reference/);
  assert.ok(result.stack.length < 20000);
  const hook = hookReportError(result);
  assert.equal(hook.cause, result);
  assert.equal(hook.cause.errors[0], nested);
  assert.ok(hook.stack.length < 40000);
});

Then('external {string} aborts the operation and explicitly cleans owned resources before disposal', (_world, signal) => {
  const result = fixture(signal === 'SIGTERM' ? 'interruption-term' : 'interruption');
  assert.equal(result.interruptSent, true);
  assert.notEqual(result.code, 0, result.output);
  assert.equal(result.code, signal === 'SIGTERM' ? 143 : 130, result.output);
  assert.deepEqual(result.ledger.filter(item => item.kind === 'unrelated-interrupt'), [{
    kind: 'unrelated-interrupt', signal, loggerExitRetained: true,
  }], 'Graceful cancellation must preserve unrelated signal handlers and logger exit cleanup');
  const aborted = result.ledger.findIndex(item => item.kind === 'external-interrupt-abort');
  const after = result.ledger.findIndex(item => item.kind === 'after');
  const stopped = result.ledger.findIndex(item => item.kind === 'worker-fixture-stop');
  assert.ok(aborted >= 0 && after > aborted && stopped > after, JSON.stringify(result.ledger));
  assert.doesNotMatch(result.ledger[aborted].reason || '', /timed out after|Step timed out/);
  assert.equal(result.disposedResources.length, 2);
  if (result.results) assert.ok(!result.results.success || result.cases.some(item => item.status !== 'passed'),
    'An interrupted operation cannot provide complete passing evidence');
});

Then('forced interruption terminates the blocked worker and closes its owned ports', () => {
  const result = fixture('interruption-forced');
  assert.equal(result.interruptSent, true);
  assert.equal(result.code, 130, result.output);
  assert.match(result.output, /Test cancellation did not settle; forcing worker termination\./);
  assert.equal(result.disposedResources.length, 2);
  assert.equal(result.ledger.filter(item => item.kind === 'init').length, 1,
    'No later World may start after noncooperating work');
  assert.ok(!result.ledger.some(item => ['after', 'worker-fixture-stop', 'UNREACHABLE_BODY_RAN'].includes(item.kind)),
    'Forced process disposal cannot claim callbacks ran in a blocked worker');
  if (result.results) {
    assert.equal(result.cases.every(item => item.status === 'passed'), false,
      'A terminated worker cannot provide complete passing evidence');
    assert.throws(() => readResults(result.resultFile, { root }),
      /result totals disagree with individual cases/,
      'The actual result validator must reject this pinned interrupted report');
  }
});
