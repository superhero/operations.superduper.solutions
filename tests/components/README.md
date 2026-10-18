# Component tests

## Purpose

Seven Gherkin scenarios verify Svelte mounting, state, bindings, props, effects,
asynchronous updates and cleanup using native Chromium events. They run with QuickPickle core,
Vitest Browser Mode and `vitest-browser-svelte`.

## Files

- `component.feature` describes the integration contract.
- `component.steps.mjs` registers steps and unmounts every rendered fixture.
- `ReactiveFixture.svelte` exercises Svelte behavior without application startup.
- `lifecycle.mjs` records mount, event and cleanup ownership for assertions.

## Lifecycle contracts

Native radio clicks update group bindings and a document-title effect; prop
changes retain that selection, and unmount restores the prior title. A real
bidirectional slide retains its element and content when an outro is reversed,
then removes it only after closing finishes.

Controlled asynchronous work receives an abort signal. The cancellation case
unmounts its owner, mounts a replacement, then delivers the old result and checks
that nothing is published or rendered into the replacement. Checks wait on
observable state and animation events rather than arbitrary sleeps.

## Commands

Run `npm run test:components` in the matching Playwright environment. The release
browser job also runs these scenarios after the application browser suite.
Component results join the same HTML report as the other Gherkin suites.

The optional legacy QuickPickle browser adapter is intentionally excluded; native
browser events preserve current Svelte bindings.
