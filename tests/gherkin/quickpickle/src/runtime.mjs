// Maintained QuickPickle scenario lifecycle. MIT License; see ../LICENSE.
import { DataTable } from './models/DataTable.mjs';
import { DocString } from './models/DocString.mjs';
import { findStepDefinitionMatch } from './steps.mjs';
import { applyHooks } from './hooks.mjs';
import { aggregateFailures, causeDetails } from './diagnostics.mjs';

// The package is externalized by every Node project. This state therefore spans
// feature modules in a worker: a poisoned worker never starts another World.
let unsettledWorkerFailure;
export const getWorkerFailure = () => unsettledWorkerFailure;
export const isWorkerQuarantined = () => Boolean(unsettledWorkerFailure);
const originalDiagnostics = new WeakMap();

function diagnosticError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

function rememberStack(error) {
  if (originalDiagnostics.has(error)) return;
  const stack = String(error.stack || '');
  const header = `${error.name || 'Error'}: ${error.message}`;
  originalDiagnostics.set(error, stack.startsWith(header)
    ? stack.slice(header.length) : stack ? `\n${stack}` : '');
}

function refreshDiagnosticStack(error) {
  rememberStack(error);
  error.stack = `${error.name || 'Error'}: ${error.message}${originalDiagnostics.get(error)}${causeDetails(error)}`;
  return error;
}

function markStepError(state, value) {
  const error = diagnosticError(value);
  rememberStack(error);
  if (!state.info.errors.includes(error)) {
    error.message = `${state.info.step} (#${state.info.line})\n${error.message}`;
    error.isStepError = true;
    state.info.errors.push(error);
  }
  return refreshDiagnosticStack(error);
}

function quarantine(cause) {
  unsettledWorkerFailure ??= new Error(
    'A timed-out task did not settle after abort; this worker is quarantined.', { cause });
}

/** Bound execution and then drain it; never confuse a race with cancellation. */
async function boundedWork(work, state, milliseconds, message, listenForAbort = true) {
  let timeout, graceTimer, aborted;
  const promise = Promise.resolve().then(work);
  // Attach rejection handling immediately, including when a deadline wins.
  const settled = promise.then(value => ({ settled: true, value }), error => ({ settled: true, error }));
  const abort = new Promise(resolve => {
    aborted = () => resolve({ aborted: true });
    if (listenForAbort) {
      if (state.signal.aborted) aborted();
      else state.signal.addEventListener('abort', aborted, { once: true });
    }
  });
  const result = await Promise.race([settled, abort,
    new Promise(resolve => { timeout = setTimeout(() => resolve({ timedOut: true }), milliseconds); })]);
  clearTimeout(timeout);
  state.signal.removeEventListener('abort', aborted);
  if (result.settled) {
    if (Object.hasOwn(result, 'error')) throw result.error;
    return result.value;
  }
  const error = result.aborted ? diagnosticError(state.signal.reason) : new Error(message);
  if (!result.aborted) error.name = 'QuickPickleTimeoutError';
  state.abortController.abort(error);
  const drained = await Promise.race([settled,
    new Promise(resolve => { graceTimer = setTimeout(() => resolve({ unsettled: true }), state.config.stepAbortGrace); })]);
  clearTimeout(graceTimer);
  if (drained.unsettled) { quarantine(error); error.quarantined = true; }
  throw error;
}

async function drainRegisteredWork(state) {
  const pending = [...state._quickpicklePendingWork];
  if (!pending.length) return;
  await boundedWork(() => Promise.allSettled(pending), state, state.config.stepAbortGrace,
    'Registered step work did not settle during cleanup', false);
}

export function runScenario(context, World, info, body) {
  const completion = executeScenario(context, World, info, body);
  // Vitest races a callback against its task signal. During cancellation that
  // race can finish before the callback's finally block, so suite/worker cleanup
  // must explicitly wait for this scenario's bounded ownership cleanup.
  const cleanupCompletion = completion.then(() => undefined, () => undefined);
  context.onTestFinished?.(() => cleanupCompletion,
    info.config.stepTimeout + 2 * info.config.stepAbortGrace);
  return completion;
}

async function executeScenario(context, World, info, body) {
  if (unsettledWorkerFailure) throw new Error(
    'Scenario not started because this worker has unsettled timed-out work.', { cause: unsettledWorkerFailure });
  let state, failure, parentAbort;
  try {
    state = new World(context, info, info.config.worldConfig);
    state._quickpickleContext = context;
    state.info.gherkin = info.gherkin;
    state.abortController = new AbortController();
    state.signal = state.abortController.signal;
    state._quickpicklePendingWork = new Set();
    parentAbort = () => state.abortController.abort(context.signal.reason);
    if (context.signal?.aborted) parentAbort();
    else context.signal?.addEventListener('abort', parentAbort, { once: true });
    if (context.task) context.task.meta.gherkin = structuredClone(info.gherkin);
    await boundedWork(() => state.init(), state, state.config.stepTimeout, 'World initialization timed out');
    await boundedWork(() => applyHooks('before', state), state, state.config.stepTimeout, 'Before hook timed out');
    await body(state);
  } catch (error) {
    failure = diagnosticError(error);
    if (state) state._quickpickleFailure = failure;
  } finally {
    if (state) {
      try { await drainRegisteredWork(state); }
      catch (error) { failure = failure ? aggregateFailures([failure, error], 'Scenario and pending work failed') : error; }
      try { await boundedWork(() => applyHooks('after', state), state,
        state.config.stepTimeout, 'After hook timed out', false); }
      catch (error) { failure = failure ? aggregateFailures([failure, error], 'Scenario and cleanup failed') : error; }
      state.abortController.abort(failure || new Error('Scenario finished'));
      context.signal?.removeEventListener('abort', parentAbort);
    }
  }
  if (failure) throw refreshDiagnosticStack(diagnosticError(failure));
}

export async function gherkinStep(stepType, step, state, line, stepIndex, explodedIndex, data) {
  Object.assign(state.info, { stepType, step, line, stepIdx: stepIndex, explodedIdx: explodedIndex });
  const started = Date.now();
  let failure;
  const execute = async () => {
    let result;
    try {
      await applyHooks('beforeStep', state);
      let dataType = '';
      if (Array.isArray(data)) { data = new DataTable(data); dataType = 'dataTable'; }
      else if (data && Object.hasOwn(data, 'content')) {
        data = new DocString(data.content, data.mediaType); dataType = 'docString';
      }
      const match = findStepDefinitionMatch(step, { stepType, dataType });
      result = await match.stepDefinition.f(state, ...match.parameters, data);
    } catch (error) { failure = markStepError(state, error); }
    finally {
      try { await applyHooks('afterStep', state); }
      catch (error) {
        const cleanup = markStepError(state, error);
        failure = failure ? aggregateFailures([failure, cleanup], 'Step and AfterStep failed') : cleanup;
      }
    }
    if (failure) throw failure;
    return result;
  };
  try {
    await boundedWork(execute, state, state.config.stepTimeout,
      `Step timed out after ${state.config.stepTimeout}ms`);
  } catch (error) {
    failure = markStepError(state, error);
    if (!(state.tagsMatch(state.config.softFailTags) && !state.isComplete && !state.signal.aborted)) throw failure;
  } finally {
    const result = state._quickpickleContext?.task?.meta?.gherkin?.steps.find(item => item.line === line);
    if (result) Object.assign(result, { status: failure ? 'failed' : 'passed',
      duration: Date.now() - started, error: failure ? {
        name: failure.name, message: failure.message, stack: failure.stack,
      } : undefined });
  }
  if (state.isComplete && state.info.errors.length) throw refreshDiagnosticStack(aggregateFailures(
    state.info.errors, `Scenario finished with ${state.info.errors.length} errors:\n\n${state.info.errors.map(error => error.message).join('\n\n')}`));
}
