# Schema performance

Measured on 19 October 2026 against `70c484c` (0.0.54). The optimized build keeps
all 42 service packs and 13,859 operations, plus the two examples. Numeric samples,
heap breakdowns, transfer counts and tested bundle hashes are in
[`schema-performance.json`](schema-performance.json).

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

Index preparation takes 44ms once per operation snapshot. Every measured candidate,
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

Search still spends substantial time rendering expanded groups and tooltips.
Removing tooltip machinery from controls whose tooltips are disabled reduced
window keydown listeners for “Create a new project” from 1,262 to 760. Further
navigation virtualization or lazy tooltip construction deserves a separate
keyboard-accessibility and timing comparison.

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
