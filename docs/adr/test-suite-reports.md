# Test suite reports

> [!IMPORTANT]
> Test reporting includes every test, and release validation requires 100% coverage of explicitly scoped application logic.

## Behavioral cases

Every authored test uses Gherkin. Each independently evaluated case is a named
scenario or scenario-outline example; Given/When/Then describes behavior and
step definitions contain implementation details.

Helpers, shell scripts and Playwright assertions run within those steps. They
must not hide independent cases behind an aggregate pass. A case passes only
when all its steps and hooks pass; skipped or unfinished work is not a pass.

## Execution

QuickPickle registers Gherkin cases with Vitest. Cucumber supplies the Gherkin
parser and expression vocabulary; a small adapter preserves existing Cucumber
step and hook APIs without running a second test runner.

Source, acceptance, automation, browser, component and runner-contract suites
share that execution model. Playwright controls application browsers; Vitest
Browser Mode and the current Svelte adapter exercise components.

Shared browser resources belong to the worker lifetime, and each scenario has
its own context. Cancellation and failed setup must still release resources.

## Unified report

Vitest's built-in HTML report combines all six suites with their coverage pages,
screenshots, diagnostics and trace downloads. The complete report directory is
one publication artifact; assets remain alongside its entry page.

Canonical feature and example-row identities preserve discovery across jobs.
Successful publication requires every declared case and step to pass, matching
execution hashes, the same tested revision and complete unfiltered results.
Diagnostic reports remain explicitly incomplete and cannot certify validation.

Scenario badges count cases, including outline examples, from these results.
Coverage and scenario badges travel with the validated report; generated test
badges are not committed to application branches.

## Coverage

Release validation requires **100% statements, branches, functions and lines**
within `coverage.config.json`. Vitest's V8 provider includes unexecuted files in
that explicit application scope; this is not whole-application coverage.

Excluded browser adapters, worker entry points and startup code still require
behavioral tests. Scope changes must preserve that verification. Passing cases,
complete reporting and coverage remain separate gates; assertions must verify
meaningful outcomes rather than merely execute code.

Pane scroll restoration is a browser adapter: its behavior depends on native
layout, fonts, animations and resize observation. Desktop and compact touch
browser scenarios verify restoration, immediate refresh and user interaction;
the snapshot validation and storage logic remain in source coverage.

## Integration evidence

Develop integration builds previews; test suites run there only when manually
requested. Release candidates automatically run all suites and scoped coverage.

Later release/main integration may reuse a successful release's evidence when
all tracked inputs match except the independently checked root changelog. The
original workflow, run attempt, commit, complete artifact set and file hashes
must verify. Otherwise validation runs again.

Reuse preserves report bytes and original provenance. It never relabels earlier
results as freshly executed tests.
