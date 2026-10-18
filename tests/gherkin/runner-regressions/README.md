# Runner regressions

## Authored cases

`contracts.feature` owns the reported Gherkin cases. Its steps run small,
disposable Node-only Vitest projects and inspect real JSON results and cleanup
ledgers. Every top-level case must pass. Intentional failure controls are asserted
inside those cases, rather than exempted from normal report validation.

## Fixture boundaries

`fixtures/*.feature` are inputs to those controls, not additional top-level
suite cases. They cover Examples blocks, Rules, Worlds, typed arguments, tag
selection, errors, cleanup, retries and cancellation. Never add this directory
to the root project's ordinary feature glob.

The quarantine control runs in a separate process with an active timer and an
unsettled promise. Subsequent Worlds are rejected. Scenario After and worker
teardown explicitly close their HTTP servers; the outer case verifies closed
ports and a terminated worker PID after Vitest exits. This proves disposal of
live work, rather than relying on an unresolved promise that cannot keep Node
alive. Readiness-controlled SIGINT and SIGTERM cases verify the same cleanup
during interruption. The shared interrupt reporter forwards these OS signals to
Vitest's supported cancellation API; plain run mode otherwise exits before
cleanup. Missing interrupted results remain missing, and interrupted runs cannot
certify success. The process deadline kills only the fixture's process group if
shutdown itself stops responding.

## Focused execution

Use `npm run test:runner`. The launcher writes the same machine/blob results
and canonical case evidence as the other Vitest projects. Fixture processes run
sequentially inside the calling job's CPU, memory and process limits. They do not
start browsers or application servers.
