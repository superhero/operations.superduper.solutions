# Resource monitoring

> [!IMPORTANT]
> The application provides current and historical insights into processing, memory and storage usage.

## Dashboard

**Settings → Browser** presents Processing, Memory, Storage, Git filesystem and
Histogram views backed by browser and library APIs. Collection runs independently
of Settings in a dedicated worker. The dashboard shows the latest observations;
browser-local history retains completed 15-minute aggregates.

## Measurement boundaries

### Processing

Counts cover the recording tab's main JavaScript context and registered
application workers, including waiting workers. They exclude browser-internal
and operating-system threads; `hardwareConcurrency` is not a usage count.

A Window `PerformanceObserver` records main-thread long-task count, elapsed time,
blocking time beyond 50 ms per task and longest task. These measure stalls, not
CPU utilization. Ordinary webpage APIs expose neither CPU cycles nor aggregate
GPU utilization.

### Memory

`performance.memory` provides optional heap estimates.
`measureUserAgentSpecificMemory()` covers available categories for the recording
tab and its dedicated workers, not the browser process. It requires a secure,
cross-origin-isolated page and may wait for garbage collection. Categories vary;
separate styling, layout and image measurements are not guaranteed.

### Storage

`navigator.storage.estimate()` provides approximate origin-wide usage and quota.
Optional `usageDetails` may be incomplete or absent; utilization requires a
positive quota. localStorage estimates count key/value text bytes, not disk use.

Persistent storage is requested once per load without delaying startup, falling
back to best effort. The dashboard reads the resulting status through
`persisted()`.

### IndexedDB

Native APIs and `idb` readonly transactions supply database enumeration, schema
metadata and record counts. Without enumeration, inspection covers known
application databases and identifies that limitation. Physical database, store
and index sizes are unavailable.

Inspection aborts opens that would create databases, bounds blocked requests and
closes connections. It never reads record values or manipulates LightningFS
records.

### Git filesystem

The collector currently inspects workflow repositories through their shared
LightningFS instance and writer locks. `du()` supplies logical repository and
`.git` sizes; their difference is working-tree size. Git supplies refs, tracked
files, status and commits reachable from HEAD. Status counts can overlap; HEAD
history does not cover all branches.

The 60-day activity matrix groups committer timestamps by UTC day, with intensity
relative to the busiest day.

### Inspection safeguards

Repository inspection waits for storage initialization without invoking workflow
recovery, save, restore, checkout, commit or remote access. Individual database or
repository failures do not suppress other measurements. Failed or unsupported
values remain unavailable, never zero.

## Collection

### Coordination

An origin-wide Web Lock elects one recording worker. BroadcastChannel shares
snapshots, completed bars and the live aggregate with other tabs. Waiting workers
take over when the recording tab closes. Recording requires both APIs.

### Measurement cycle

The worker requests Window-only application-memory measurements through an
asynchronous page bridge. Once settled, the bridge reads heap, localStorage and
processing counters; the worker then collects storage estimates, record counts
and repository sizes. Cycles never overlap.

Failed or unavailable memory measurements still permit other counters, with a
30-second minimum cycle to prevent busy loops. Processing entries are drained
and reset per cycle without retaining raw entries; teardown disconnects the
observer. Application workers register after construction and are released on
termination, errors and page cleanup.

### Worker boundaries

Git operations and aggregation run in the dedicated worker, bundled inline to
preserve the single HTML artifact. LightningFS uses its runtime alias rather than
page HMR or overlay imports. Workers cannot eliminate garbage-collection delays,
storage locks or resource contention.

## History

### Aggregation

Calendar-aligned one-minute open/high/low/close accumulators feed aligned
15-minute bars. Only finite, available observations count; missing samples
produce neither zeroes nor empty intervals. A timer closes elapsed intervals
even while memory measurement is pending.

Only current minute and quarter accumulators remain in RAM; raw samples and
finalized minute detail are discarded. Open tabs also retain the live aggregate
and completed unsaved bars for handoff.

### Persistence

Only completed 15-minute bars enter Git. LightningFS `v1/metrics` contains the
`/metrics` repository, with immutable `bars/YYYY/MM/DD/HH-mm.json` interval files.
A separate writer lock and flushed journal recover interrupted writes without
changing workflow history. Identical retries add no commit; conflicting intervals
are reported. Completed bars have no automatic expiry.

Raw samples and minute detail never enter Git, where deleting files would still
leave them in history.

### Startup cache

Disposable localStorage entry `v1/metrics/cache` supplies the last storage and
memory reports and up to 96 completed bars, bounded to 512 KiB of serialized
characters. IndexedDB history and fresh measurements replace these previews.

Cached observations never become samples, unfinished bars are not cached, and
invalid or full localStorage cannot stop recording. The dashboard retains its
last known values while collection is pending.

### Histogram

The chart shows completed candles and a provisional live candle, with grouped
metric selection and tooltips for values and local-time intervals. Series cover
bytes, record counts, processing durations and tracked thread counts. Inventory
metadata, persistence status and storage utilization stay on the dashboard.

Retired series remain in saved history but leave the selector. A storage-type
series is hidden only when its entire history matches total storage and the
latest estimate does not distinguish them. Collection continues so later
divergence remains visible.

## Limits and verification

Measurements reflect each API's scope, not complete resource accounting. History
contains numeric metric keys and values, excluding workflow content, database
record values and memory-attribution URLs. Visualizations use the shared theme
and accessible text equivalents.

Recording continues with Settings closed, subject to browser throttling or
suspension. Closing every tab stops recording and loses the unfinished interval;
completed Git history survives reloads.

Browser tests cover database and repository inspection, nonmutation, unavailable
APIs and layouts. Aggregation and persistence have dedicated checks.
