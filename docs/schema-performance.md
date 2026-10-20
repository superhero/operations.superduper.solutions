# Schema performance

The first optimization was measured on 19 October 2026 against `70c484c`
(0.0.54). The optimized build keeps all 42 service packs and 13,859 operations,
plus the two examples. Numeric samples,
heap breakdowns, transfer counts and tested bundle hashes are in
[`schema-performance.json`](schema-performance.json).

## Current status and remaining work

The latest pass adds bounded exact search, delegated catalog help and faster
canonical-model source decoding. See [the runtime follow-up](#bounded-search-catalog-help-and-larger-workflows)
for the three requested priorities, repeated comparisons and verification.

The loading/storage pass merged in
[#358](https://github.com/superhero/operations.superduper.solutions/pull/358),
and the interaction pass in
[#359](https://github.com/superhero/operations.superduper.solutions/pull/359)
(`00cf348`). Their historical measurements remain below. The rendering and
matching follow-up investigates all five subsequent priorities:

| Priority | Outcome |
| --- | --- |
| Measurement and startup | Added opt-in snapshot-free timing passes, matching-worker CPU profiles, page-clock phase boundaries, repeated fresh/persisted startup, native thread CPU and container throttling counters. Diagnostic profiles and primary timing/retention samples are separate. |
| Hidden UI construction | Settings controls mount only for the selected, visible section, then release after closing. The drawer retains the selected section and Application numeric drafts. Browser's cheap dots remain mounted; its dashboard releases after closing. Existing menu buttons, hierarchy, native Tab navigation and offscreen rendering remain. |
| Compact result allocation/sorting | Score the complete inventory, retain every result above 0.5 plus the exact remaining top-five places, and sort only those retained results. Report mode still returns the complete ranking. Independent result oracles cover both modes. |
| Index lifetime and cancellation | Clear/close releases the worker; unchanged completed results reopen without scoring. Source/text/report-mode changes invalidate those results. Superseded queries share an installation that has not started scoring; active CPU work still terminates immediately. Source changes also release idle obsolete indexes. |
| Repeated canonical models | Measured projection, adaptation, approval, accounting and temporary/released heap across two real services and batch sizes. Reverted a batch-local reference-metadata cache because paired gains were inconsistent; canonical models remain independent. |

See [the follow-up evidence](#rendering-and-matching-follow-up) for samples,
limitations, checks and the next investigation. The stored JSON includes discarded
experiment results so an unretained prototype cannot be mistaken for delivered code.

### Measurement correction

The previous saved page profile contained about 620ms of self samples in
Playwright snapshot helpers (`visitNode`, `checkAndReturn`, `ensureCachedData`)
out of 2,296ms sampled, about 27%. That was harness CPU, not application CPU;
subtracting it from an individual search would be invalid. The old profiling
helper also omitted the matching worker.

The new minimal mode disables Playwright screenshots, DOM snapshots and sources
only for explicitly selected profiling scenarios. Ordinary tests keep complete
failure traces. Matching-worker diagnostics warm a target before attaching and
stop/disable profiling in cleanup. Primary heap snapshots occur before profiling,
which can itself retain script data. Connected DOM counts are separate from CDP's
counts, which can include detached documents.

Historical profile: `final-profile/search-page.cpuprofile`, SHA-256
`a52615ada52be94d32cfa94259ddaa474456d368af34e0e9469b5c16ba838658`,
under the local `schema-interaction-performance` evidence directory.

### Deferred delivery change

Separate schema assets remain deferred. Before implementation, agree how the
single-file/offline distribution will work, define content-addressed pack/index
versions and integrity checks, and qualify cache updates, eviction, partial
failures, offline recovery, asset allowlists and deployment/bundle validation.
Disabling a schema currently saves decoding/preparation, not download bytes.

## Startup and retention

| Browser state | Startup before → after | Used JS heap before → after |
| --- | --- | --- |
| Fresh schema store, all enabled | 5.81s → 1.30s | 286.2 → 46.4 MiB |
| Reload, all enabled | 3.75s → 1.00s | 285.5 → 45.6 MiB |
| Reload, all disabled | 3.06s → 0.89s | 243.6 → 36.7 MiB |
| Reload, three enabled | 3.04s → 0.88s | 243.1 → 36.8 MiB |

Initial transfer changed from 44 complete documents and 13,892 executable models
to 44 compact headers and the same operation inventory. No complete document or
executable model crossed that boundary during startup. The disabled case received
neither documents nor descriptors.

Four enablement changes took 1.48–2.46s each before, and 0.17–0.24s after.
They previously transferred 176 more full documents; now only the re-enabled
schema's descriptors cross the boundary.

## Inspection

Opening and closing the OpenAI source left 556.2 MiB of used heap and a mounted
viewer before. After optimization, the closed viewer is removed and used heap
falls to 52.3 MiB. Its open heap is 65.8 MiB. Copy and download retain full content.

The original Cloudflare inspector stalled the page beyond 120s in a separate
check. Its replacement passes bounded rendering, Load more, close and reopen
checks in Chromium, Firefox and WebKit. It starts with at most 1,000 rows instead
of constructing the complete expanded tree.

## Exact matching

Warm native Node medians, five samples per query, excluding assertions:

| Query | Before | After |
| --- | --- | --- |
| List projects | 188ms | 58ms |
| Create a new project | 270ms | 88ms |
| get | 109ms | 12ms |
| List all running virtual machines in the selected project | 581ms | 250ms |

The first optimization prepares its index in 44ms per operation snapshot; the
interaction follow-up below reuses unchanged schemas. Every measured candidate,
score, ordering and selected result matches an independent implementation of the
previous contract. Additional cases cover Unicode, common affixes and invalid queries.

Browser keypress-to-menu times, including worker startup and rendering, changed
from 972/1,070/453ms to 579/678/303ms for the first three queries. Match counts
remain 291/326/5, including examples. Those times are not the matching CPU medians.

## Profiling findings

CPU profiles exposed large allocation and serialization costs during toggles.
Sampled page non-idle time across four changes fell from 6.83s to 0.86s; sampled
garbage collection fell from 1.10s to under 10ms. The schema worker spends nearly
all that interaction waiting after the change. These sampled durations are
diagnostic observations, not exact CPU accounting.

In the first pass, expanded groups and tooltips remained a candidate for further
rendering work. Removing tooltip machinery from controls whose tooltips are
disabled reduced window keydown listeners for “Create a new project” from 1,262
to 760. The
interaction follow-up below addresses tooltip state and offscreen rendering; the
next-work section records the remaining DOM and measurement limits.

## Method and limits

Both builds used the same Gherkin harness on `sds-01`, one job at a time:
2 CPUs, 3 GiB RAM, 512 processes, 1,800 MiB Node heap, Node 26.7.0 and Playwright
1.63.0 with Chromium 153. Browser snapshots force GC on the page and dedicated
workers. Heap totals cover those JS heaps; they are not browser RSS or exact
application storage sizes. Container memory includes test infrastructure.

The browser comparison is one paired run, consistent with earlier exploratory
measurements. Startup measures local navigation to actual readiness, excluding
the loader's closing animation. It is not a public-network download benchmark.
Search timings include CPU sampling; fixed timing thresholds do not gate CI.

Native matching timing runs in a worker launched by its Gherkin step. Measuring
the same tight loop inside Vitest's VM produced a different performance profile,
including an apparent long-query regression absent from native execution. The
parent step checks the independent oracle; every native timed result must match
its signature. Profiles exclude signature generation and assertions.

## Verification

Focused checks cover the complete source inventory and every targeted canonical
model, matching cancellation, cache eviction, invalid caches, quota failure,
independent histories, factory updates, authored ownership, interrupted writes,
cross-tab policy rejection, schema management, disclosure focus and workflow history.
New pure cache/index/model modules have 100% measured source coverage. Native
storage cases and complete-library inspection cases pass in all three engines.

Typechecking and the normal build, including icon and index freshness, pass.
One existing vault-node accessibility warning remains. Full regression and CI
were not run for this branch.

## Reproduce

Use a prepared, resource-capped test environment and the pinned toolchain:

```sh
npm run build
SCHEMA_PROFILE_OUTPUT=tmp/schema-profile node tests/gherkin/run.mjs source src/schema-performance.feature
SCHEMA_PROFILE_OUTPUT=tmp/schema-profile node tests/gherkin/run.mjs browser tests/browser/service-defaults.feature --tags @schema-profile
```

Use separate output directories and `SCHEMA_PROFILE_LABEL` values for compared
builds. Raw CPU profiles and browser traces remain generated test artifacts.

## Delivery tradeoff

Precomputed discovery increases the single HTML's gzip size from 7.80 MB to
8.23 MB, about 5.5%. All compressed sources still ship in that file. Disabling a
schema avoids decoding and model preparation, rather than removing download bytes.
Separate cacheable source assets could reduce delivery cost, but require an
explicit change to the single-file/offline contract.

See [OpenAPI adaptation](adr/openapi-adaptation.md),
[worker boundaries](adr/dedicated-workers.md) and
[local persistence](adr/local-resource-management.md) for the implemented contracts.

## Interaction follow-up

The four delivered interaction improvements compare `develop` at `4dcf8a7` with
`97efc3c` (merged by #359 as `00cf348`), using the same capped host and browser
harness. Complete samples, transfer counts, heap breakdowns and build hashes are
in [`schema-interaction-performance.json`](schema-interaction-performance.json).

| Work | Before | After |
| --- | --- | --- |
| “List projects” input → menu | 634ms | 493ms |
| “Create a new project” input → menu | 695ms | 571ms |
| “get” input → menu | 319ms | 323ms |
| Normalization after changing Frankfurter's nine operations, native median | 35.5ms | 2.2ms |
| Prepared operations sent across three searches | 41,676 | 13,892 |
| Candidate scores returned across those searches | 41,676 | 622 |
| Matching workers created across those searches | 3 | 1 |
| Window keydown listeners after “Create a new project” | 760 | 336 |
| Requests to restore 16 operations from two schemas | 16 | 2 |
| Policy transactions to load six operations from one schema | 6 | 1 |

The menu uses browser-managed
[`content-visibility`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility)
to skip offscreen contents while retaining real buttons and native focus order.
It shares [one Bits UI tooltip controller](https://www.bits-ui.com/docs/components/tooltip)
across row triggers; popup content mounts when needed. Focus can scroll to the
last row, and consecutive rows keep normal Tab navigation. Disabled-operation
reasons remain supported. The functional check verifies that more than half of
the long menu's contents are skipped before scrolling in each browser engine.

Completed searches retain their worker and installed indexes. Queries carry text
and a snapshot token; opt-in developer reports still request every candidate's
score. Active aborts terminate the obsolete worker immediately. Source changes
reuse the other 41 schemas' normalized vectors, while failed or cancelled workers
reinstall the main thread's cached indexes. Ranking rules are unchanged.

Model requests group by schema and current source identity, with a maximum of 16
operations per batch and coalescing for overlapping loads. Each operation retains
its own canonical adaptation, reference closure and credential fingerprint.
Storage tests compare the models with individual reads and verify that a failed
batch publishes no partial credential policy.

These are one paired browser run and five warm native index samples. There is
no measured gain for the five-match “get” case. Fresh startup was 1.19s versus
1.53s in this pair; this change targets later interaction work. Initial used JS
heap remains about 46.4 MiB. Keeping the search worker adds about 4.7 MiB of worker
heap after searching; total heap after closing inspection is 52.3 → 56.8 MiB.
The HTML grows by 4,545 bytes, or 1,650 bytes with native Node gzip. Delivery
continues as one offline-capable HTML; separate schema downloads remain deferred.

Fifteen focused source scenarios pass, with 100% statement, branch, function and
line coverage for the matching index, matching client/worker and model loader.
Selected menu, cancellation, revision rejection, batch storage and workflow
restoration scenarios pass in Chromium, Firefox and WebKit. All eleven schema
lifecycle/live-prompt scenarios also pass in Chromium. Typechecking and the
normal build pass, retaining the existing vault-node warning. Full regression
remains with CI; this work does not change or monitor CI workflows.

To reproduce the added native comparison, run the focused
`src/schema-interaction.feature` with `SCHEMA_PROFILE_OUTPUT` set. The existing
browser profile command above now also records matching-worker transfer counts.




## Rendering and matching follow-up

The third pass compares `09eb5c0` with the runtime hashes and built HTML hashes in
[`schema-rendering-performance.json`](schema-rendering-performance.json). Both use
the same worker timing probe and focused Gherkin harness on the capped host.

Primary browser values below are medians of three fresh/persisted starts or five
inputs per query. Heap snapshots force GC on the page and dedicated workers
before any diagnostic profiler is enabled.

| Measurement | Before | After |
| --- | --- | --- |
| Fresh schema-store startup | 1203ms | 859ms |
| Persisted schema-store startup | 886ms | 642ms |
| Startup used JS heap | 43.23 MiB | 27.25 MiB |
| Connected startup DOM nodes | 3,254 | 603 |
| Closed-settings window keydown listeners | 336 | 27 |
| Used JS heap after search closes | 49.61 MiB | 29.04 MiB |
| “List projects” input → DOM publication | 319ms | 300ms |
| “Create a new project” input → DOM publication | 307ms | 312ms |
| “get” input → DOM publication | 167ms | 183ms |

These measurements attribute the large fixed listener and heap costs to mounted
settings controls: opening Schemas creates its controls, and closing the section
or drawer releases them. The Browser indicator and existing slide sequence remain;
its dashboard releases when closed. The menu retains native buttons and Tab order.

Closing search releases about 4.76 MiB in this sample. Reopening unchanged results starts
no worker; source changes invalidate that cache. Active scoring cancellation still
terminates actual CPU work, while an unfinished installation can serve its latest
query without another full-index transfer. Normal completed searches remain reusable
while navigation stays open. The main enabled-schema index still occupies memory.

The earlier one-pair startup slowdown was not reproduced: three repeated starts
of `4dcf8a7` measured 1.29–1.34s fresh and 0.91–0.98s persisted; the current baseline
and candidate samples are recorded independently. This does not isolate the cause
of the earlier outlier. Routing disables HTTP cache, so these are local storage and
readiness measurements rather than network or warm-HTTP-cache benchmarks.

### Matching measurements and limits

Native compact-mode wall-time medians, five alternating full/compact pairs after
warmup, excluding assertions and signature generation:

| Query | Before | After |
| --- | --- | --- |
| List projects | 57.0ms | 54.5ms |
| Create a new project | 91.7ms | 83.7ms |
| get | 17.3ms | 8.0ms |
| List all running virtual machines in the selected project | 289.7ms | 260.8ms |

The JSON also retains OS-accounted native worker-thread CPU, raw wall-time
samples and container CPU counters. Browser timings changed direction in some
earlier pairs; warmup and shared-host conditions matter. Alternating both modes
in the same installed browser worker checks their exact results and avoids
confounding each mode with a separate worker startup. A smaller allocation count
does not establish a universal end-to-end speedup. The narrow search remains
dominated by the 150ms debounce.

Page-clock phases distinguish input, first RPC, index installation, worker search,
DOM publication and a subsequent two-frame rendering opportunity. The last value
is a frame proxy, not proof of paint or a field INP measurement. Worker `scoringMs`
excludes reply construction/transfer; RPC duration includes queueing and transfer.
Throttling counters identify container quota delays, not every form of contention.
Diagnostic CPU profiles include page, schema-library and matching targets, and
remain separate from the unprofiled timing and retention samples.

### Canonical model investigation

The native model fixture samples 32 operations distributed across each real
schema. It records adaptation, effective server resolution, reference projection,
approval/fingerprinting, byte accounting, and temporary/released heap. Models and
policy signatures remain identical with loop batch sizes 1, 8 and 16. Storage
transactions, worker messages and browser rendering are outside this fixture;
its batch-size timings do not select a new RPC budget.

| Service, 32 operations at batch size 16 | Model work | Projection | Approval | Temporary heap |
| --- | --- | --- | --- | --- |
| openai | 50.6ms | 27.8ms | 14.7ms | 3.78 MiB |
| cloudflare | 29.0ms | 7.6ms | 12.5ms | 2.23 MiB |

After releasing outputs and forcing GC, the measured retained change was close
to zero. This is native worker heap accounting, not browser RSS or an arbitrary
large-workflow bound. Active workflow models still remain pinned by design.

A batch-local reference-metadata cache preserved every measured projection but
changed the OpenAI median from 18.6ms to 19.5ms and Cloudflare from 9.2ms to 8.5ms
in alternating paired samples. The ranges overlapped and gains were inconsistent,
so it was reverted. A separate scoring helper also failed to establish a browser
benefit and was reverted. Neither experiment is delivered application code.

Any future projection sharing must use immutable complete source/revision/adapter
identity and account for operation roots, allowed cross-operation references,
traversal kind, recursion/depth and execution context. Mutable report outputs and
partial input adaptations cannot become shared complete executable models.

### Verification and reproduction

Focused Gherkin checks pass for cancellation before/after replies, installation
replacement, late failures, schema deltas, exact ranking, closed controls, cached
menu reopening and invalidation. The final delivery and navigation checks pass in
Chromium, Firefox and WebKit, including normal Browser slide motion, mobile focus,
Tab scrolling, tooltips and saved-default failure/retry. Changed matching modules
have 100% scoped statement/branch/function/line coverage. Build and typecheck pass
with the existing vault-variable accessibility warning.

The failed-save check exposed an existing Firefox console-presentation mismatch
on the baseline too. It now asserts the actual logged Error and cause arguments
instead of browser-specific text; unrelated console errors still fail the scenario.
No CI workflow was changed, and full regression and CI monitoring were not run.

Use one prepared job on `sds-01`: 2 CPUs, 3 GiB RAM and total memory/swap, 512
processes, 1,800 MiB Node heap, Node 26.7.0 and Playwright 1.63.0/Chromium 153.
The small Docker launcher has a separate 0.05 CPU/128 MiB cap. Ordinary regression
traces remain enabled. For matched baseline/candidate evidence:

```sh
SCHEMA_PROFILE_LOW_OVERHEAD=1 SCHEMA_PROFILE_OUTPUT=tmp/schema-follow-up \
  node tests/gherkin/run.mjs browser tests/browser/service-defaults.feature --tags @schema-next
SCHEMA_PROFILE_OUTPUT=tmp/schema-follow-up \
  node tests/gherkin/run.mjs source src/schema-performance.feature
SCHEMA_PROFILE_OUTPUT=tmp/schema-follow-up \
  node tests/gherkin/run.mjs source src/schema-interaction.feature --tags @schema-model-profile
```

### Follow-up selected after that pass

The next pass was selected to prioritize a provably bounded edit-distance calculation in compact mode, retaining
all above-threshold results and exact top-five ties. Scoring still dominates worker
CPU after removing full allocation/sorting. Keep the independent oracle and test
long/Unicode queries. Profile a representative larger workflow before revisiting
projection caches; the measured 32-operation model work does not justify persistent
sharing yet. Further menu windowing needs evidence after the hidden-controls fix
and must preserve native focus and hierarchy. Separate asset delivery remains deferred.

## Bounded search, catalog help and larger workflows

This pass starts from `d94ed2a` and addresses the three requested runtime priorities. Build hashes, runtime hashes and raw samples are in [`search-workflow-performance.json`](search-workflow-performance.json).

Compact matching uses a sound edit-distance band and the current result cutoff. Every result above 0.5 and the exact remaining top-five places retain their original scores and tie ordering. Developer reports still calculate the complete ranking.

Five alternating warm samples in one native worker, comparing the previous compact scorer with the candidate (median and range, milliseconds):

| Query | Before | After |
| --- | --- | --- |
| List projects | 51.7 (51.1–60.4) | 9.4 (9.1–14.0) |
| Create a new project | 82.4 (81.9–123.5) | 34.3 (33.9–52.4) |
| get | 7.9 (7.7–8.0) | 0.4 (0.3–0.5) |
| List all running virtual machines in the selected project | 244.2 (237.1–308.7) | 178.9 (165.4–244.0) |

Catalog help uses one library trigger with delegated pointer/focus handling and an explicit anchor. This avoids registering each row and repeatedly copying the library’s trigger map. Rows remain native buttons; hierarchy, Tab order, focus scrolling, unavailable explanations, global tooltip opt-out, touch suppression and closing motion remain covered. A closed/pending hint releases its target after presence ends.

Three sequential production baseline/candidate pairs, alternating order, with three inputs per query per run. Snapshots and CPU profiling are excluded from these timing intervals; values are medians and ranges in milliseconds.

| Query | Input → DOM before | Input → DOM after | Reply → DOM before | Reply → DOM after |
| --- | --- | --- | --- | --- |
| List projects | 282 (275–320) | 215 (201–222) | 61 (55–98) | 42 (35–54) |
| Create a new project | 311 (293–333) | 235 (220–250) | 65 (59–75) | 34 (28–49) |
| get | 184 (183–187) | 172 (161–174) | 5 (4–6) | 19 (8–21) |

The 150ms typing debounce remains part of the measured wait. Narrow searches remain debounce-bound. Reply-to-DOM improved for the broad queries. The narrow query’s reply-to-DOM interval increased while its overall input-to-DOM latency decreased; this pass does not establish the cause of that phase difference or claim that every publication becomes faster. CDP page counters and a separate bounded rendering trace retain style/layout/paint evidence; these are not field INP measurements.

### Larger workflow restoration

The browser fixture restores 96 distinct supported operations spread across OpenAI and Cloudflare. Every restore uses six schema batches of at most 16 models, with identical IDs and accounted payload bytes. The first measured restore also materializes source histories; subsequent reloads retain those histories.

| Measurement | Before | After |
| --- | --- | --- |
| First source-use startup | 2566 (2554–2573) | 2481 (2401–2492) |
| Persisted workflow reload | 1138 (1086–2144) | 1024 (999–1084) |
| Persisted model RPC sum | 332 (317–399) | 228 (223–311) |

The worker profile identified base64-to-byte conversion as substantial source-read CPU. The decoder uses the [native byte API](https://tc39.es/proposal-arraybuffer-base64/spec/) when available, with an explicit-loop compatibility path. Compressed packs, versioning, storage and history semantics stay intact. Both paths retain size limits, strict UTF-8, SHA-256 verification and JSON/root validation. No shared mutable canonical projection cache was added.

These are local synthetic workflows with canonical operations and no connection edges. They measure actual browser storage, worker messages, model installation and rendering, unlike the earlier isolated 32-model fixture. They do not qualify physical mobile devices or public-network loading.

### Verification and next work

Nineteen focused source scenarios pass, including the complete service ranking oracle and all 42 audited packs. Five scoped Gherkin coverage scenarios cover the scoring and pack-decoding modules with 100% statements, branches, functions and lines. Eighteen focused browser checks cover native navigation, help lifecycle, closed controls/workers, clearing, cancellation and mobile selection in Chromium, Firefox and WebKit. Build and typechecking pass with the existing vault-node accessibility warning. Heavy profiling remains in the existing serialized service-library group. No CI workflow was changed or monitored; the full regression suite remains CI’s responsibility.

Reproduce the focused evidence in the prepared, capped environment described above:

```sh
node tests/gherkin/run.mjs source src/schema-performance.feature src/service-schema-packs.feature src/operation-matching.feature
SCHEMA_PROFILE_OUTPUT=tmp/schema-runtime SCHEMA_PROFILE_LOW_OVERHEAD=1 \
  node tests/gherkin/run.mjs browser tests/browser/service-defaults.feature \
  --tags '@menu-runtime-profile or @workflow-runtime-profile'
```

The native benchmark optionally accepts `SCHEMA_PROFILE_MATCHING_REFERENCE`, a
trusted baseline matcher module, to alternate current/reference calls in the same
worker. Keep comparison builds, output directories and labels separate.

Further windowing or canonical-model caches need a measured benefit beyond this pass and must retain focus and model independence. The fixed search debounce is a separate interaction-policy decision. Separate schema delivery remains deferred at the user’s request.


## Schema header color feedback (20 October 2026)

The schema title inherited a 180 ms color transition while the newly revealed
Wrap lines control already used its target foreground. Existing action buttons
also transitioned their inherited color. The header and action foreground/background
pairs now switch together. The wrap fade, arrow rotation, disclosure slide,
hover scaling and focus-outline transition remain.

Production Chromium measurements on sds-01 used one 2-CPU / 3-GiB job, Node
26.7.0, Playwright 1.63.0, 1280×900 at 1× DPR and the two example catalogs.
Three repeated openings per theme gave these click-to-target-title-color values:

| Theme | Before median (range), ms | After median (range), ms | Median reduction |
| --- | --- | --- | --- |
| Dark | 206.84 (206.42–214.80) | 7.90 (7.52–12.06) | 198.94 ms / 96.2% |
| Light | 207.46 (206.48–207.50) | 6.62 (6.15–33.98) | 200.84 ms / 96.8% |

The baseline wrap control was already partly visible after roughly 55–64 ms.
After the change, title and persistent action colors match on the same sampled
frame. Closings use the same immediate color-pair swap. First openings per theme
were recorded separately. These are rAF/computed-color observations from a real
click; physical display latency and field INP were not measured. Baseline ran
before candidate on a shared headless host; there are no tail-latency claims.

Separate short Chrome traces retain style/layout/paint attribution. Their aggregate
costs are similar; the result is faster visual feedback. First-open frame gaps of
65–86 ms remain; their cause was not isolated in this focused color check. No production listeners,
workers or caches were added. Raw samples, conditions and trace summaries are in
[schema-header-feedback.json](schema-header-feedback.json); full diagnostic evidence
is retained locally in the ignored task directory named there.
