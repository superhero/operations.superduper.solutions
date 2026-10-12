# Development diagnostics

## Context

Development failures need source details and actionable recovery guidance while
the application remains available behind the error dialog. Optional performance
tools should follow the application's appearance without occupying the interface
by default.

## Decision

Use Visulima's error overlay for development compilation and runtime errors.
The [Vite integration](../../vite.config.mjs) loads
[custom CSS](../../src/dev/error-overlay.css) that follows the selected palette
and light/dark mode. Error dialogs work independently of the optional toolbar.
Both development plugins are excluded from production builds.

Preserve the standard `Error.cause` chain. The
[overlay context](../../src/dev/error-overlay-context.ts) presents a compact
tree of error types and available codes, highlights the current error, and uses
Visulima's existing navigation to select related details. Because Visulima's
formatted payload omits codes, [development error tracking](../../src/dev/error-chain.ts)
retains them in memory. Messages, source frames and cause navigation remain
available; history tracks separate reports. [Logging](logging.md) owns how
application errors reach the overlay.

[Settings storage errors](../../src/lib/app-settings.ts) distinguish failed
database opens, reads and saves, retain the original cause, and explain recovery.
The [application](../../src/App.svelte) reports these native errors through Pail
after rendering so the interface and palette are ready behind the overlay.
Production displays a descriptive startup alert instead. Settings retains its
recovery controls in both modes; [startup loading](background-loading.md) releases
the loading screen when storage fails.

## Usage

- Start development with `npm run dev` after `npm ci`. Select an error-tree entry
  to inspect its message and source details; use report history for separate
  failures.
- For unavailable saved settings, use **Settings → Browser → Retry saved
  settings**. Follow the error's recovery guidance. For a timeout, close other
  app tabs and retry; if it persists, save browser work, fully quit all browser
  instances and reopen the app. Restart the browser before considering any
  destructive storage reset. Browser/profile contention is a possible cause,
  not something the webpage can confirm.
- Enable **Settings → Developer → Developer toolbar** to opt in. The choice is
  saved in IndexedDB. Once enabled, use **Alt+Shift+D** or the bottom-center
  toolbar to open Timeline, Performance and Vite Config panels. The
  [toolbar theme](../../src/dev/toolbar-theme.ts) follows the app's appearance.

## Consequences

Developers can inspect related failures without losing the original error or
access to recovery controls. Production keeps the storage guidance without
shipping developer dialogs or panels. The overlay navigation and theme adapters
depend on Visulima's rendered structure, so dependency upgrades must preserve
these integrations.
