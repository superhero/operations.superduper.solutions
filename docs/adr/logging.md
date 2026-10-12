# Shared diagnostic logging

## Context

Diagnostics need consistent severity and feature context across the application,
development server, scripts and tests. Browser errors must retain their native
stacks and causes. Forwarding every console error can create a reporting loop
when the development transport itself fails.

## Decision

Use Pail for diagnostic logging. The application's
[shared logger](../../src/lib/logger.ts) starts with the `operations` scope and
supports additional feature scopes. Its browser reporter keeps native `Error`
objects inspectable in the console and sends application error objects directly
to the [development overlay](development-diagnostics.md).

The [Vite configuration](../../vite.config.mjs) disables Vite console forwarding
and configures Visulima to intercept warnings rather than errors. Failed overlay
transmissions are reported with `console.error`, which does not feed them back
into the overlay. Original errors and transport failures remain in the browser
console; uncaught exceptions and unhandled rejections still reach the overlay.

Use `@visulima/inspector` for readable text snapshots of diagnostic values.
[Runtime error normalization](../../src/dev/runtime-error.ts) uses it for thrown
or rejected values that are not native errors, preserving available browser
details without inventing a stack at the reporting site.

## Usage

- Import `logger` from the shared module and use `logger.info`, `logger.warn` or
  `logger.error` at the appropriate severity. Use `logger.scope("feature")` when
  the feature name helps identify the source.
- Pass native `Error` objects directly, for example
  `logger.error("Could not save settings", error)`. Keep `Error.cause` intact so
  console inspection and overlay stack traces remain useful. Use
  `inspect(value)` with Pail when a diagnostic needs a text snapshot of another
  value.
- Log diagnostic messages rather than workflow content or request credentials.
- Node scripts and tests also use Pail for diagnostics, as in the
  [test-report generator](../../.github/scripts/generate-test-report.mjs).
  Keep machine-readable output in its original format rather than routing it
  through the diagnostic formatter.

## Consequences

Shared severity and scopes make failures easier to trace while native errors
remain available for inspection. Application errors intended for the development
overlay must go through the shared logger with an error object; direct console
errors remain console diagnostics. Text snapshots are useful for object details
but do not replace native errors and their cause chains.
