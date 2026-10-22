// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Cucumber-style registration remains a thin adapter over the Gherkin runner.
import {
  Given as qpGiven, When as qpWhen, Then as qpThen,
  Before as qpBefore, After as qpAfter,
  BeforeAll as qpBeforeAll, AfterAll as qpAfterAll,
  BeforeStep as qpBeforeStep, AfterStep as qpAfterStep,
  QuickPickleWorld, setWorldConstructor as qpSetWorldConstructor,
  defineParameterType as qpDefineParameterType, DataTable,
} from 'quickpickle';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';

export { DataTable };
const registrations = [];
function registration(kind, detail = {}) {
  const owner = [...new Error().stack.matchAll(/(file:\/\/[^\s)]+?):\d+:\d+/g)]
    .map(match => relative(resolve(import.meta.dirname, '../..'), fileURLToPath(match[1])).replaceAll('\\', '/'))
    .find(path => path !== 'tests/gherkin/cucumber-compat.mjs' && !path.startsWith('../') && !path.startsWith('node_modules/'));
  if (!owner && process.env.OPERATIONS_CI_DISCOVERY === '1') throw new Error(`Cannot identify ${kind} registration owner.`);
  const ordinal = registrations.filter(entry => entry.owner === owner && entry.kind === kind).length;
  const entry = { kind, owner, ordinal, ...detail };
  registrations.push(entry);
  return entry;
}
export const registrationInventory = () => registrations.map(entry => ({ ...entry }));
export function defineParameterType(type) {
  registration('parameter', { name: type.name });
  return qpDefineParameterType(type);
}
export const Status = Object.freeze(Object.fromEntries([
  'UNKNOWN', 'PASSED', 'SKIPPED', 'PENDING', 'UNDEFINED', 'AMBIGUOUS', 'FAILED',
].map(status => [status, status])));

let defaultTimeout = 5000;
let configuredParameters = {};
let afterWeight = 0;
let annotationSequence = 0;

export function configureCompatibility({ worldParameters = {} } = {}) {
  configuredParameters = worldParameters;
}

function parameters() {
  return { ...configuredParameters,
    ...JSON.parse(process.env.OPERATIONS_WORLD_PARAMETERS ?? '{}') };
}

export class World extends QuickPickleWorld {
  constructor(context, info) {
    super(context, info);
    // Browser support intentionally reuses `context` for its Playwright context.
    this._quickpickleContext = context;
    this.parameters = parameters();
  }

  async attach(data, mediaType = 'text/plain') {
    const attachment = { contentType: mediaType };
    if (typeof data === 'string') {
      attachment.body = data;
      attachment.bodyEncoding = 'utf-8';
    } else if (data instanceof Uint8Array) attachment.body = data;
    else throw new TypeError('Attachments must be strings or Uint8Array payloads.');
    return this._quickpickleContext.annotate(`Gherkin evidence ${++annotationSequence}`, attachment);
  }

  async log(...messages) { await this.attach(messages.join(' '), 'text/plain'); }
  async link(url) { await this.attach(String(url), 'text/uri-list'); }
}

qpSetWorldConstructor(World);
export function setWorldConstructor(constructor) { registration('world'); qpSetWorldConstructor(constructor); }
export function setDefaultTimeout(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw new TypeError('Invalid Cucumber default timeout.');
  defaultTimeout = milliseconds;
  registration('timeout');
}

function argumentsForHook(world) {
  const errors = [...(world.info?.errors ?? [])];
  if (world._quickpickleFailure && !errors.includes(world._quickpickleFailure)) errors.push(world._quickpickleFailure);
  return {
    pickle: {
      name: world.info?.scenario ?? '',
      tags: (world.info?.tags ?? []).map(name => ({ name })),
    },
    result: { status: errors.length ? Status.FAILED : Status.PASSED,
      message: errors.map(error => error?.stack ?? error?.message ?? String(error)).join('\n') },
  };
}

async function invoke(world, callback, args, milliseconds, description) {
  const pending = Promise.resolve().then(() => callback.apply(world, args));
  // The patched core drains this set before cleanup/next-scenario execution.
  const work = world._quickpicklePendingWork ??= new Set();
  work.add(pending);
  pending.then(() => work.delete(pending), () => work.delete(pending));
  pending.catch(() => {});
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${description} timed out after ${milliseconds}ms`);
      error.name = 'TimeoutError';
      world.abortController?.abort(error);
      reject(error);
    }, milliseconds);
  });
  try { return await Promise.race([pending, timeout]); }
  finally { clearTimeout(timer); }
}

function registerStep(register, pattern, optionsOrCallback, maybeCallback) {
  const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
  const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
  if (typeof callback !== 'function') throw new TypeError('Expected a Cucumber step callback.');
  const entry = registration('step', { pattern: String(pattern) });
  const wrapped = (world, ...args) => invoke(world, callback, args,
    options?.timeout ?? defaultTimeout, String(pattern));
  wrapped.registration = entry;
  register(pattern, wrapped);
}

export function Given(...args) { registerStep(qpGiven, ...args); }
export function When(...args) { registerStep(qpWhen, ...args); }
export function Then(...args) { registerStep(qpThen, ...args); }
export const defineStep = Given;

function registerHook(register, after, all, optionsOrCallback, maybeCallback) {
  const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
  const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
  registration('hook', { phase: register.name, after, all, tags: options?.tags ?? '' });
  if (typeof callback !== 'function') throw new TypeError('Expected a Cucumber hook callback.');
  const wrapped = async world => {
    if (all) world.parameters = parameters();
    await invoke(world, callback, all ? [] : [argumentsForHook(world)],
      options?.timeout ?? defaultTimeout, options?.name ?? 'Cucumber hook');
  };
  // Browser fixtures belong to Vitest's worker lifetime, not a predicted number
  // of feature completions. Its fixture teardown also covers filtered runs.
  if (all && process.env.OPERATIONS_TEST_PROFILE === 'browser') {
    (after ? workerAfter : workerBefore).push(wrapped);
    return;
  }
  register({ tags: options?.tags ?? '', ...(after ? { weight: --afterWeight } : {}) }, wrapped);
}

export function Before(...args) { registerHook(qpBefore, false, false, ...args); }
export function After(...args) { registerHook(qpAfter, true, false, ...args); }
export function BeforeStep(...args) { registerHook(qpBeforeStep, false, false, ...args); }
export function AfterStep(...args) { registerHook(qpAfterStep, true, false, ...args); }
export function BeforeAll(...args) { registerHook(qpBeforeAll, false, true, ...args); }
export function AfterAll(...args) { registerHook(qpAfterAll, true, true, ...args); }

const workerBefore = [];
const workerAfter = [];
let workerStarted;
let workerStopped = false;
export async function initializeWorker() {
  workerStarted ??= (async () => {
    const world = { parameters: parameters() };
    for (const hook of workerBefore) await hook(world);
  })();
  return workerStarted;
}
export async function cleanupWorker() {
  if (workerStopped) return;
  workerStopped = true;
  const errors = [];
  const world = { parameters: parameters() };
  for (const hook of [...workerAfter].reverse()) {
    try { await hook(world); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Browser worker cleanup failed');
}
