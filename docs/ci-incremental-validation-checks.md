# Incremental CI implementation checks

Local verification on 2026-10-22 used the working implementation based on
`12f96beb4ab5b55b6734a4b229c6222b9b584ebe`. These are focused development checks,
not a complete release run or a measurement of GitHub integration latency.

## Browser correctness and capture comparison

The new unit runner completed all nine cases in
`tests/browser/keybindings.feature`, including worker teardown and receipt
verification. Full-registry collection resolved 59 features and 587 cases.
Static comparison preserved the 576 registrations in changed step modules and
the complete source profile inventory; helper extraction changed imports and
ownership, rather than authored assertions.

Three sequential full/minimal capture pairs exercised the existing
`workflow-menu.feature` case, alternating pair order. Each execution used a
fresh process and browser context, identical built application and fixtures,
Node 26.7.0, Playwright 1.63.0 and the pinned browser image. A local container
limited the entire workload to one CPU, 3 GiB memory with no extra swap, 384
processes and a 512 MiB Node heap. Networking was disabled. Other desktop work
continued; this was a small controlled sample, not isolated hardware.

| Pair | Order | Full capture | Minimal capture |
| --- | --- | ---: | ---: |
| 1 | Full, minimal | 9.607s | 8.015s |
| 2 | Minimal, full | 9.272s | 8.061s |
| 3 | Full, minimal | 9.473s | 8.601s |
| Median | | 9.473s | 8.061s |

Elapsed time includes unit process startup, execution and sealing, and excludes
plan/fixture preparation. All six executions passed the same case and steps.
The median difference was 1.412s, approximately 14.9%. This supports retaining
lighter ordinary capture; it does not predict the gain for the full corpus.
Failure screenshots, action traces and console/network diagnostics remain;
continuous DOM/source/image capture is the deliberate diagnostic tradeoff.
Trace-contract and explicit diagnostic tags retain full capture.

The built `dist/index.html` SHA-256 was
`719ea42d1b5f89196837ddedd6dde9bb3ca8004c890cc0a956cdb87a0c9d5720`.
Raw samples and owned job receipts were saved locally under
`.agents/tmp/ci-incremental-2026-10-22/` and `tmp/test/ci/pilot/`. Those ignored
artifacts may be removed later; the compact observations above remain.

## CI contracts

Focused Gherkin checks exercise the actual native Vitest JSON/blob/report path
in hermetic control repositories. They cover exact inventory, selective
invalidation, same-PR artifact association, cache hits and misses, expiry,
tampering, skipped or incomplete evidence, teardown failure, mixed attempts,
empty batches, cancellation and final workflow gates. A native control report
combines two browser units with five complete profiles and real V8 coverage;
these tiny controls test orchestration and cannot certify application behavior.

The existing complete-validation reuse and report contract features are also
checked. Workflow YAML parsing and Bash syntax checks cover changed workflows.
Full application regression, real GitHub artifact transfer cost, runner queue
delay, cold four-job balance and total runner-minutes remain CI measurements.
