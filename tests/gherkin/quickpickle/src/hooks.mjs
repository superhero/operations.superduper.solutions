// Derived from QuickPickle 1.11.2, copyright SamZiegler and David Hunt.
// MIT License; see ../LICENSE and UPSTREAM.json.
import { tagsFunction } from './tags.mjs';
import { aggregateFailures } from './diagnostics.mjs';

const allHooks = { beforeAll: [], before: [], beforeStep: [],
  afterAll: [], after: [], afterStep: [] };

export async function applyHooks(name, state) {
  const cleanup = ['after', 'afterStep', 'afterAll'].includes(name);
  const hooks = allHooks[name].map((hook, index) => ({ hook, index })).sort((a, b) =>
    a.hook.weight - b.hook.weight || (cleanup ? b.index - a.index : a.index - b.index));
  const failures = [];
  for (const { hook } of hooks) {
    if (!hook.tagsFunction(state.info.tags.map(tag => tag.toLowerCase()))) continue;
    try { await hook.f(state); }
    catch (error) {
      if (!cleanup) throw error;
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw aggregateFailures(failures, `${name} cleanup hooks failed`);
  return state;
}

function addHook(name, optionsOrCallback, callback) {
  const options = typeof optionsOrCallback === 'function' ? { f: optionsOrCallback }
    : typeof optionsOrCallback === 'string' ? { tags: optionsOrCallback }
      : optionsOrCallback || {};
  const hook = { name: '', tags: '', weight: 0, ...options,
    ...(typeof callback === 'function' ? { f: callback } : {}) };
  if (typeof hook.f !== 'function') throw new TypeError(`A ${name} callback is required.`);
  if (!Number.isFinite(hook.weight)) throw new TypeError('Hook weight must be finite.');
  hook.tagsFunction = tagsFunction(hook.tags.toLowerCase());
  allHooks[name].push(hook);
}

export const BeforeAll = (options, callback) => addHook('beforeAll', options, callback);
export const Before = (options, callback) => addHook('before', options, callback);
export const BeforeStep = (options, callback) => addHook('beforeStep', options, callback);
export const AfterAll = (options, callback) => addHook('afterAll', options, callback);
export const After = (options, callback) => addHook('after', options, callback);
export const AfterStep = (options, callback) => addHook('afterStep', options, callback);
