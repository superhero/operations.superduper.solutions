// Maintained QuickPickle diagnostics. MIT License; see ../LICENSE.

/** Readable nested errors without losing native Error objects or following cycles. */
function describe(value, stacks, seen = new Set(), depth = 0) {
  if (!value || typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular error reference]';
  if (depth >= 32) return '[Error nesting exceeds 32 levels]';
  seen.add(value);
  const heading = `${value.name || 'Error'}: ${value.message || String(value)}`;
  const output = [stacks && typeof value.stack === 'string' ? value.stack : heading];
  if (value.cause !== undefined && !(stacks && typeof value.stack === 'string'
    && value.stack.includes('\n\nCause chain:\n')))
    output.push(`Cause: ${describe(value.cause, stacks, seen, depth + 1)}`);
  if (Array.isArray(value.errors)) for (const error of value.errors)
    output.push(describe(error, stacks, seen, depth + 1));
  return output.join('\n');
}

export function causeDetails(error) {
  return error.cause === undefined ? ''
    : `\n\nCause chain:\n${describe(error.cause, true, new Set([error]))}`;
}

/**
 * Vitest intentionally flattens AggregateError.errors. Its module JSON exposes
 * only the first flattened error's message, so a feature hook needs one report
 * boundary while keeping the untouched native aggregate available as cause.
 */
export function hookReportError(error) {
  if (!(error instanceof AggregateError) && (!(error instanceof Error) || error.cause === undefined)) return error;
  const message = error.cause === undefined ? error.message
    : `${error.message}\n\nCause: ${describe(error.cause, false, new Set([error]))}`;
  const report = new Error(message, { cause: error });
  report.name = 'QuickPickleHookError';
  report.stack = `${report.name}: ${message}\n\n${error.stack}${causeDetails(error)}`;
  return report;
}

export function aggregateFailures(errors, message) {
  const failures = [...errors];
  const details = failures.map(error => describe(error, false));
  const aggregate = new AggregateError(failures, `${message}\n\n${details.join('\n\n')}`);
  // JSON reporters commonly expose only stack/message, not .errors. Retain the
  // complete native errors array and also make their actual frames inspectable.
  aggregate.stack += `\n\nNested failure stacks:\n${failures.map(error => describe(error, true)).join('\n\n')}`;
  return aggregate;
}
