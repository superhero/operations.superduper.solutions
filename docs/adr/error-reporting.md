# Errors are reported clearly through the user interface and console

## Context

Failures need enough context to identify their source and support recovery.
Console diagnostics and error dialogs should describe the same failure without
losing its original stack or causes, or creating a reporting loop.

## Decision

Diagnostics share severity, feature context and native errors across console
output and the user interface. Development provides source inspection and
optional diagnostic tools; production provides actionable recovery guidance
without shipping developer panels.

### Console logging and error delivery

Pail provides logging for the application, development server, scripts and tests.
The application's [shared logger](../../src/lib/logger.ts) starts with the
`operations` scope and supports additional feature scopes. Its browser reporter
keeps native `Error` objects inspectable in the console and sends application
errors directly to Visulima's development overlay.

The [Vite configuration](../../vite.config.mjs) disables Vite console forwarding
and configures Visulima to intercept warnings rather than errors. Failed overlay
transmissions use `console.error`, which does not feed them back into the
overlay. Original errors and transport failures remain in the console; uncaught
exceptions and unhandled rejections still reach the overlay.

[`@visulima/inspector`](../../src/dev/runtime-error.ts) supplies readable text
snapshots for values that are not native errors. Runtime normalization retains
available browser details without inventing a stack at the reporting site.

### Error display and recovery

Visulima displays development compilation and runtime errors with
[theme-aware CSS](../../src/dev/error-overlay.css). The
[overlay context](../../src/dev/error-overlay-context.ts) presents `Error.cause`
as a tree of error types and available codes, highlights the current error, and
uses Visulima's navigation for related details. Since its formatted payload
omits codes, [error tracking](../../src/dev/error-chain.ts) retains them in memory.
Messages, source frames and cause navigation remain available; report history
tracks separate failures.

[Settings errors](../../src/lib/app-settings.ts) distinguish failed database
opens, reads and saves, preserve the original cause, and explain recovery. The
[application](../../src/App.svelte) reports them through Pail after rendering so
the interface and palette are ready behind the overlay. Production displays a
descriptive startup alert instead. Settings retains recovery controls in both
modes, and [startup loading](dedicated-workers.md) releases the loading
screen when storage fails.

The overlay works independently of the optional developer toolbar. Both
development plugins are excluded from production builds. The toolbar's
[theme adapter](../../src/dev/toolbar-theme.ts) follows the application's
appearance.

## Usage

- Import the shared `logger`; choose `info`, `warn` or `error` for the severity
  and `logger.scope("feature")` when feature context helps identify the source.
  Pass native errors directly, for example
  `logger.error("Could not save settings", error)`, with `Error.cause` intact.
  Use `inspect(value)` only when a text snapshot of another value is useful.
- Log diagnostics rather than workflow content or request credentials. Node
  scripts and tests also use Pail, as in the
  [test-report generator](../../.github/scripts/generate-test-report.mjs).
  Preserve machine-readable output instead of applying diagnostic formatting.
- Start development with `npm run dev` after `npm ci`. Select an error-tree
  entry for its message and source details; use report history for separate
  failures.
- For unavailable settings, use **Settings → Browser → Retry saved settings**
  and follow the error's guidance. On timeout, close other app tabs and retry.
  If it persists, save browser work, fully quit all browser instances and reopen
  the app. Restart before considering a destructive storage reset.
  Browser/profile contention is a possible cause, not something the webpage
  can confirm.
- Enable **Settings → Developer → Developer toolbar** to opt in. The choice is
  saved in IndexedDB. Use **Alt+Shift+D** or the bottom-center toolbar to open
  Timeline, Performance and Vite Config panels.

## Consequences

Related failures remain traceable without losing native errors or access to
recovery controls. Application errors intended for the development overlay go
through the shared logger with an error object; direct console errors remain
console diagnostics. Text snapshots do not replace native errors or their
causes. Visulima's navigation and theme adapters depend on its rendered
structure, so dependency upgrades must preserve these integrations.
