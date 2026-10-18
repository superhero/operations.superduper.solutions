# Gherkin integration

## Test ownership

Every test case is a Gherkin scenario. QuickPickle registers those scenarios with
Vitest; the small Cucumber compatibility adapter preserves existing step and hook
registration without starting a second runner.

`profiles.mjs` declares source, acceptance, automation, browser, component and runner-contract
inputs. `config.mjs` defines the shared execution and coverage rules. The root
`vitest.config.mjs` delegates to it.

## Focused commands

Use `node tests/gherkin/run.mjs <profile>` and select feature paths, `--tags
'@tag and not @other'` or `-t 'scenario name'`. Examples are independent cases
identified by their feature URI and row line. Filtered runs remain useful for
local development but cannot supply complete release evidence.

## Node modules

Node suites use ordinary Vitest transforms so V8 coverage maps to the same source
that executed. One narrow Vite plugin replaces the matching worker constructor
adapter; the real matching client and RPC remain under test. The schema extractor
failure test uses a restored Vitest spy in that same module graph, avoiding mixed
native and transformed byte offsets in coverage.

## Browser lifetime

Browser steps load as native modules: Playwright serializes callback functions,
and Vite helpers inside those functions would fail in the page. `native-steps.mjs`
redirects only the Cucumber registration import to the compatibility adapter.

Each scenario owns a fresh context. An automatic Vitest worker fixture owns shared
browser, server and development-server hooks. Cleanup is independent of feature
counts, names or tags. Abort closes scenario contexts; screenshots, diagnostics
and traces become report attachments. SIGINT/SIGTERM request cancellation and
cleanup; interrupted runs remain unsuccessful.

## Reports and coverage

Each suite writes JSON and a Vitest blob under `tmp/test`. `merge.config.mjs`
combines results and raw coverage without running tests again. The HTML report and
its coverage pages are published together from `tmp/test/report`.

Coverage uses `coverage.config.json` for the explicit application scope and requires 100% of
statements, branches, functions and lines. Include unexecuted files; a passing
scenario count does not replace that gate.

## Runner maintenance

`quickpickle` is the locally maintained, pinned package in `quickpickle/`.
`runner-regressions/` contains Gherkin cases for its behavior and cleanup contract.
Update its version whenever generated code changes, so transform caches cannot
reuse an older runner implementation.

Vitest 5.0.5's logger exits immediately on OS signals. `interrupt-reporter.mjs`
guards and replaces only those pinned signal handlers so Vitest can cancel work
and close resources. Remove the shim once upstream supports graceful signal
handling; retain the interruption scenarios when upgrading.
