# Application tests and fixtures

New tests follow the [shared test reporting standard](../docs/adr/test-suite-reports.md):
each independently evaluated case is a named scenario or scenario-outline
example that appears in the combined report.

## Where new coverage belongs

| Behavior | Location and registration |
| --- | --- |
| Node-executable application logic | Feature and step files beside the source in `src/`; register both in the explicit `source` profile |
| Built artifact acceptance | `src/build.*` and `src/favicons.*`; the `acceptance` profile explicitly selects their feature and step files |
| Browser interactions and rendering | [`browser/`](browser/README.md); its profile discovers top-level `.feature` and `.steps.mjs` files |
| Repository automation | [`.github/tests/`](../.github/tests/README.md); its profile discovers top-level `.feature` and `.test.mjs` files |
| Svelte component integration | [`components/`](components/README.md); the `components` project owns reactive component fixtures |
| Gherkin execution and runner contracts | [`gherkin/`](gherkin/README.md); shared configuration and the `runner` project |
| Test-only source fixtures | [`fixtures/`](fixtures/README.md), or beside the browser steps that use them |

[`tests/gherkin/profiles.mjs`](gherkin/profiles.mjs) is the registration authority.
The default source glob does not replace the explicit named profiles used by
npm and CI.

## Browser lifecycle regressions

The former root smoke scripts are named Gherkin cases in
[`browser/legacy-smoke.feature`](browser/legacy-smoke.feature). Their
[assertion map](browser/legacy-smoke/README.md) records preserved behavior and
existing coverage reused during migration. Each fault and independent browser
context has its own reported case; related lifecycle phases remain explicit
steps of that case.

Source unit tests live under `src/` and run through the source Gherkin project.

## Results and procedures

Keep generated results under `tmp/`. The
[workflow guide](../.github/workflows/README.md#test-reports) owns suite and report
commands.
