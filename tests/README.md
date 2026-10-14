# Application tests and fixtures

New tests follow the [Cucumber reporting standard](../docs/adr/test-suite-reports.md):
each independently evaluated case is a named scenario or scenario-outline
example that appears in the combined report.

## Where new coverage belongs

| Behavior | Location and registration |
| --- | --- |
| Node-executable application logic | Feature and step files beside the source in `src/`; register both in the explicit `source` profile |
| Built artifact acceptance | `src/build.*` and `src/favicons.*`; the `acceptance` profile explicitly selects their feature and step files |
| Browser interactions and rendering | [`browser/`](browser/README.md); its profile discovers top-level `.feature` and `.steps.mjs` files |
| Repository automation | [`.github/tests/`](../.github/tests/README.md); its profile discovers top-level `.feature` and `.test.mjs` files |
| Test-only source fixtures | [`fixtures/`](fixtures/README.md), or beside the browser steps that use them |

[`cucumber.config.mjs`](../cucumber.config.mjs) is the registration authority.
The default source glob does not replace the explicit named profiles used by
npm and CI.

## Remaining smoke-test migration

Root `*.smoke.mjs` scripts await migration into browser Cucumber scenarios;
they do not appear in the combined report. Preserve their assertions and verify
each case's report inclusion before removing its old execution path.

Source unit tests live under `src/` and run through the source Cucumber profile.

## Results and procedures

Keep generated results under `tmp/`. The
[workflow guide](../.github/workflows/README.md#test-reports) owns suite and report
commands.
