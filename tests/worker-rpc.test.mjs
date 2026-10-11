// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerClient, emitWorkerEvent, serveWorkerRpc } from '../src/lib/worker-rpc.ts';

class FakeWorker extends EventTarget {
  messages = [];
  terminated = false;
  postMessage(message) { this.messages.push(structuredClone(message)); }
  terminate() { this.terminated = true; }
  reply(data) { this.dispatchEvent(new MessageEvent('message', { data })); }
}

test('worker calls start lazily, correlate responses, forward events, and preserve error chains', async () => {
  let instance;
  const client = createWorkerClient(() => instance = new FakeWorker());
  const events = [];
  const unsubscribe = client.subscribe(event => events.push(event));
  assert.equal(instance, undefined);
  const first = client.call('first'), second = client.call('second');
  instance.reply({ kind: 'result', id: 2, value: 'second result' });
  instance.reply({ kind: 'result', id: 1, value: 'first result' });
  assert.deepEqual(await Promise.all([first, second]), ['first result', 'second result']);
  instance.reply({ kind: 'result', id: 1, value: 'duplicate result' });
  instance.reply({ kind: 'result', id: 999, value: 'unknown request' });
  instance.reply({ kind: 'event', event: { type: 'startup', data: 'Loading' } });
  assert.deepEqual(events, [{ type: 'startup', data: 'Loading' }]);
  unsubscribe();
  instance.reply({ kind: 'event', event: { type: 'change', data: null } });
  assert.equal(events.length, 1);
  const failed = client.call('failure');
  instance.reply({ kind: 'error', id: 3, error: { name: 'StorageError', message: 'Cannot read settings', stack: 'worker stack',
    cause: { name: 'TimeoutError', message: 'Storage timed out', code: 23 } } });
  await assert.rejects(failed, error => error instanceof Error && error.name === 'StorageError'
    && error.stack === 'worker stack' && error.cause.name === 'TimeoutError' && error.cause.code === 23);
  client.dispose();
  assert.equal(instance.terminated, true);
});

test('disposing a worker drains an accepted write before termination', async () => {
  const instance = new FakeWorker();
  const client = createWorkerClient(() => instance);
  const saving = client.call('save');
  client.dispose();
  assert.equal(instance.terminated, false);
  await assert.rejects(client.call('save'), /has been closed/);
  instance.reply({ kind: 'result', id: 1, value: 'committed' });
  assert.equal(await saving, 'committed');
  assert.equal(instance.terminated, true);
});

test('worker crashes reject pending calls and a later explicit call can retry', async () => {
  const instances = [];
  const client = createWorkerClient(() => { const worker = new FakeWorker(); instances.push(worker); return worker; });
  const pending = client.call('read');
  instances[0].dispatchEvent(Object.assign(new Event('error'), { message: 'Worker failed', filename: 'worker.js', lineno: 9, colno: 1 }));
  await assert.rejects(pending, error => error.name === 'WorkerError' && error.stack.includes('worker.js:9:1'));
  assert.equal(instances[0].terminated, true);
  const retried = client.call('read');
  instances[1].reply({ kind: 'result', id: 2, value: 'recovered' });
  assert.equal(await retried, 'recovered');
  client.dispose();
});

test('worker transport failures without diagnostics reject pending calls and terminate the worker', async () => {
  for (const [event, message] of [
    [new Event('error'), /background worker failed to start or stopped unexpectedly/],
    [new Event('messageerror'), /Could not read the background worker's response/],
  ]) {
    const instance = new FakeWorker();
    const client = createWorkerClient(() => instance);
    const failed = client.call('read');
    instance.dispatchEvent(event);
    await assert.rejects(failed, message);
    assert.equal(instance.terminated, true);
    client.dispose();
  }
});

test('worker server preserves native error diagnostics and rejects unlisted methods', async () => {
  const originalAdd = globalThis.addEventListener, originalPost = globalThis.postMessage;
  let handler;
  const replies = [];
  globalThis.addEventListener = (_type, listener) => { handler = listener; };
  globalThis.postMessage = value => replies.push(value);
  try {
    serveWorkerRpc({ fail() { throw new Error('Read failed', { cause: new DOMException('Timed out', 'TimeoutError') }); } });
    await handler({ data: { kind: 'request', id: 1, method: 'fail', args: [] } });
    assert.equal(replies[0].error.message, 'Read failed');
    assert.match(replies[0].error.stack, /worker-rpc.test.mjs/);
    assert.equal(replies[0].error.cause.name, 'TimeoutError');
    assert.equal(replies[0].error.cause.code, 23);
    await handler({ data: { kind: 'request', id: 2, method: 'toString', args: [] } });
    assert.match(replies[1].error.message, /Unknown worker operation/);
  } finally {
    if (originalAdd === undefined) delete globalThis.addEventListener; else globalThis.addEventListener = originalAdd;
    if (originalPost === undefined) delete globalThis.postMessage; else globalThis.postMessage = originalPost;
  }
});

test('worker messages round-trip results, aggregate failures, and bounded circular causes', async () => {
  const originalAdd = globalThis.addEventListener, originalPost = globalThis.postMessage;
  let handler;
  const replies = [];
  globalThis.addEventListener = (_type, listener) => { handler = listener; };
  globalThis.postMessage = value => replies.push(value);
  const instance = new FakeWorker();
  const client = createWorkerClient(() => instance);
  try {
    const circular = new Error('Circular cause');
    circular.cause = circular;
    const aggregate = new AggregateError([new TypeError('Invalid entry'), 'plain failure'], 'Multiple writes failed');
    aggregate.code = 'WRITE_FAILED';
    serveWorkerRpc({ sum: (left, right) => left + right, circular() { throw circular; },
      aggregate() { throw aggregate; }, empty() { throw null; } });
    await handler({ data: undefined });
    await handler({ data: { kind: 'event', event: { type: 'unrelated' } } });
    assert.equal(replies.length, 0);
    emitWorkerEvent('progress', { completed: 2 });
    assert.deepEqual(replies.pop(), { kind: 'event', event: { type: 'progress', data: { completed: 2 } } });

    const sum = client.call('sum', [2, 3]);
    await handler({ data: instance.messages.at(-1) });
    instance.reply(replies.pop());
    assert.equal(await sum, 5);

    const aggregated = client.call('aggregate');
    await handler({ data: instance.messages.at(-1) });
    instance.reply(replies.pop());
    await assert.rejects(aggregated, error => error instanceof AggregateError && error.code === 'WRITE_FAILED'
      && error.errors[0].name === 'TypeError' && error.errors[0].message === 'Invalid entry'
      && error.errors[1].name === 'Error' && error.errors[1].message === 'plain failure');

    const bounded = client.call('circular');
    await handler({ data: instance.messages.at(-1) });
    instance.reply(replies.pop());
    await assert.rejects(bounded, error => {
      let depth = 0;
      while (error.cause) { error = error.cause; depth++; }
      assert.equal(depth, 9);
      assert.equal(error.message, 'Further error causes omitted.');
      return true;
    });

    const empty = client.call('empty');
    await handler({ data: instance.messages.at(-1) });
    instance.reply(replies.pop());
    await assert.rejects(empty, { name: 'Error', message: 'null' });
  } finally {
    client.dispose();
    if (originalAdd === undefined) delete globalThis.addEventListener; else globalThis.addEventListener = originalAdd;
    if (originalPost === undefined) delete globalThis.postMessage; else globalThis.postMessage = originalPost;
  }
});
