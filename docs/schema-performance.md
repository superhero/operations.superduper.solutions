# Schema performance

The first optimization was measured on 19 October 2026 against `70c484c`
(0.0.54). The optimized build keeps all 42 service packs and 13,859 operations,
plus the two examples. Numeric samples,
heap breakdowns, transfer counts and tested bundle hashes are in
[`schema-performance.json`](schema-performance.json).

## Current status and next work

Both optimization passes are merged into `develop`: the loading/storage changes
in [#358](https://github.com/superhero/operations.superduper.solutions/pull/358),
and the four interaction changes in
[#359](https://github.com/superhero/operations.superduper.solutions/pull/359)
(`00cf348`). Offscreen menu rendering/shared tooltips, reusable matching workers
with compact replies, per-schema normalized indexes and batched workflow models
are implemented. The measurements below distinguish the two passes.

The next priorities are investigations, not promises of additional speedups:

| Order | Work | Evidence and acceptance |
| --- | --- | --- |
| 1 | Improve measurement and check startup | Separate app work from tracing/selector overhead; profile the matching worker too. Repeat paired cold/warm startup samples to investigate 1.19s → 1.53s, rather than dismissing or declaring a regression from one pair. Record input, debounce, worker configuration/scoring, DOM publication and next-paint timings separately. |
| 2 | Reduce remaining UI construction | `content-visibility` skips offscreen contents but leaves all matched buttons, components and trigger registrations mounted. Measure group/disclosure updates and hidden settings controls; reduce unnecessary state/listeners before considering full DOM windowing. Preserve Tab order, focus scrolling, hierarchy, hover outlines and mobile behavior. |
| 3 | Avoid full result allocation/sorting in compact matching mode | The worker currently evaluates and sorts every candidate even when its reply includes only matches. Benchmark retaining all above-threshold matches plus the exact top five, then sorting their union. Preserve every score, ID-based tie order and report-mode ranking; heuristic shortlists remain outside the contract. |
| 4 | Bound persistent index retention and cancellation costs | Reuse adds about 4.7 MiB of worker heap. Main-thread index refresh does not immediately update an idle worker, and an active abort requires reinstalling the catalog in its replacement. Measure disable-all, closed-menu and rapid-typing lifecycles before choosing explicit release or another cancellation strategy. Keep actual CPU cancellation and stale-reply rejection. |
| 5 | Measure large-workflow canonical model costs | Batches reduce messages/transactions, but each operation still gets its own canonical adaptation, reference closure and fingerprint. Measure repeated references, transient/retained heap and batch-size effects before introducing shared immutable projections. Qualify revision, adapter, root, recursion/depth and execution-context keys; never reuse a partial projection as a complete model. |

The next implementation should first improve the focused measurement harness,
then use those results to select the UI change. Keep the ordinary regression
traces available. Use one capped job on `sds-01`; full regression and CI following
remain governed by the existing focused-testing instructions. Any new eager
preparation belongs inside startup loading, following
[startup readiness](adr/startup-readiness.md), rather than post-startup idle work.

### New findings from the existing evidence

A read-only inspection of the final search-page CPU profile found about 620ms of
self samples in Playwright snapshot helpers (`visitNode`, `checkAndReturn` and
`ensureCachedData`) out of 2,296ms sampled: about 27%. These helpers are present in
the installed Playwright 1.63.0 snapshot implementation. The browser tests enable
[tracing with snapshots](../tests/browser/support.mjs). This time is test-harness
work, so the profile must not be read as pure application CPU or used to subtract
620ms from any individual search latency. The paired timings remain observations
under the same harness; native matching/index benchmarks are separate.

The [CPU profiling helper](../tests/browser/schema-profile.fixture.mjs) currently
attaches to the page and schema-library worker, not the matching worker. It cannot
attribute browser matching CPU. Also, 336 window keydown listeners remain even
for the five-match search. Code inspection confirms that the closed Schemas
[section](../src/components/SettingsWorkspace.svelte) still mounts its cards
and per-button tooltip controllers; how much of that fixed listener count and
runtime cost they explain is not yet isolated.

Profile provenance: `final-profile/search-page.cpuprofile`, SHA-256
`a52615ada52be94d32cfa94259ddaa474456d368af34e0e9469b5c16ba838658`,
under the local `schema-interaction-performance` evidence directory. This is a
reanalysis of the saved trace, not a new benchmark or a change to test behavior.

### Deferred delivery change (original item 5)

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
