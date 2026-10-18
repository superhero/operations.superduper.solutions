# QuickPickle integration

## Purpose

This private, source-maintained fork registers Gherkin cases in Vitest. The root
package uses `file:tests/gherkin/quickpickle`; installing dependencies does not
patch `node_modules`. Runtime modules and their declarations are reviewed here.

## Upstream

The starting point is QuickPickle 1.11.2 at revision
`36e8810bf10cea835db63a6fd6767c2eb22a9268`. [UPSTREAM.json](UPSTREAM.json)
records the original source and published artifact hashes. [LICENSE](LICENSE)
retains upstream's MIT terms and attribution. Upstream-derived modules remain
readable ESM; there is no minified vendored bundle or install-time generator.

The optional visual helpers preserve the upstream API. They are not a reason to
install QuickPickle's older Svelte adapter; component tests use normal browser
events and the current Svelte integration.

## Maintained differences

- Every Examples block and inherited tag is retained. Canonical metadata uses
  relative feature paths and independent scenario/example locations, registered
  before execution so skipped and TODO cases retain their identities.
- Cucumber tag expressions select cases; generated feature source maps retain
  the original text and line locations.
- Initialization, Before and step failures receive cleanup. Cleanup hooks all
  run, ordered by ascending explicit weight and reverse registration at equal
  weight. Aggregate headlines and stacks expose body, cleanup and cause details
  while preserving native errors. Feature-hook report boundaries keep the native
  aggregate as their cause because Vitest otherwise flattens it and its module
  JSON exposes only the first message. Cyclic diagnostic graphs are bounded.
- Scenarios own an abort signal and registered pending work. Deadlines abort,
  then bounded-drain work before After or another scenario. A public
  `onTestFinished` barrier keeps Vitest's cancellation race from advancing to
  suite or worker teardown before scenario cleanup settles.
- The original Vitest context survives Worlds that use `context` for a browser.
- The plugin includes its patch identity in Vite's cache directory and namespaces
  Vitest's separate persistent module cache by transformer options. Tag selection
  and deadlines cannot reuse a feature generated with different settings.
  `testModule` lets browser projects supply a worker-fixture-aware Vitest test.

## Cancellation boundary

Aborting a signal cannot terminate arbitrary JavaScript or external processes.
If work exceeds the grace period, the shared worker is quarantined: later cases
fail before creating their World. Owned browser resources still receive After
and worker-fixture teardown. The fork exposes `getWorkerFailure()` and
`isWorkerQuarantined()` so the runner can report this condition. Vitest disposes
the failed worker; do not reset quarantine or retry other cases inside it.

Use task timeouts longer than the step deadline, grace and cleanup budget.
Resource-owning adapters must register their underlying promises in
`_quickpicklePendingWork` and release owned resources in cleanup. This contract
does not claim to cancel untracked subprocesses or uncontrolled I/O.

## Maintenance

Keep `src/*.mjs` and matching `*.d.mts` declarations together. Bump the package
version and `QUICKPICKLE_PATCH_ID` after changing transformer/runtime contracts;
this invalidates transformed feature caches. Preserve the recorded upstream
snapshot when comparing newer versions.

Gherkin regressions live in `../runner-regressions`. They inspect real machine
results and cleanup ledgers, including intentional failures in disposable child
workers. Replace this fork only after upstream passes those contracts and case
identity/report parity; a newer package version alone is insufficient evidence.
