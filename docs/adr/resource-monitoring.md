# The application provides current and historical insights into processing, memory and storage usage

## Context and decision

Application data and its history live in the browser. Current measurements help explain resource use; recorded measurements make changes over time visible. Settings → Browser therefore presents Processing, Memory, Storage, Git filesystem and Histogram views backed by browser and library APIs.

Collection runs independently of Settings in a dedicated worker. The dashboard shows the latest available observations, and history retains completed 15-minute aggregates. This follows the [background-processing decision](dedicated-workers.md) and gives measurements their own history under the [content-versioning model](browser-git-versioning.md).

## Measurement boundaries

- **Processing:** counts cover the recording tab's main JavaScript context and registered application workers, including waiting workers. They do not enumerate browser-internal or operating-system threads; `hardwareConcurrency` is not a usage count. A Window `PerformanceObserver` aggregates main-thread long-task count, elapsed time, blocking time beyond 50 ms per task and longest task. These describe stalls, not CPU utilization. Ordinary webpage APIs do not expose CPU cycles or aggregate GPU utilization.
- **Memory:** `performance.memory` supplies optional heap estimates. `measureUserAgentSpecificMemory()` supplies available categories for the recording tab and its dedicated workers, not the whole browser process. Its support requires a secure, cross-origin-isolated page; categories vary by browser, and styling, layout and image memory are not individually guaranteed. Native measurement may wait for garbage collection.
- **Storage:** `navigator.storage.estimate()` supplies approximate origin-wide usage and quota. Optional `usageDetails` can be incomplete or absent; utilization is unavailable without a positive quota. The localStorage counter estimates key/value text bytes, not physical disk use. The application requests persistent storage once per load without delaying startup and falls back to best effort; the dashboard reads the resulting status with `persisted()`.
- **IndexedDB:** database enumeration, schema metadata and record counts come from native APIs and `idb` readonly transactions. If enumeration is unavailable, inspection covers known application databases and identifies that limitation. Opens that would create databases are aborted; blocked requests are bounded and connections closed. Inspection never reads record values or manipulates LightningFS records. Physical sizes per database, store or index are unavailable.
- **Git filesystem:** the current repository collector inspects workflow repositories through their shared LightningFS instance and writer locks. `du()` gives logical repository and `.git` sizes; their difference is the working tree size. Git supplies refs, tracked files, status and commits reachable from HEAD. Status counts can overlap, and HEAD history is not every branch's combined history. The 60-day activity matrix groups committer timestamps by UTC day, with intensity relative to the busiest day.

Repository inspection waits for normal storage initialization but does not invoke per-workflow recovery, save, restore, checkout, commit or contact remotes. Individual database or repository failures do not suppress unrelated measurements. Failed or unsupported values remain unavailable rather than becoming zeroes.

## Collection and coordination

An origin-wide Web Lock elects one recording worker. A BroadcastChannel distributes snapshots, completed bars and the live aggregate to other tabs; a waiting worker takes over when the recording tab closes. Recording requires both APIs.

Because application-memory measurement is Window-only, the worker requests it through an asynchronous page bridge. Once it settles, the bridge reads heap, localStorage and processing counters, then the worker collects storage estimates, record counts and repository sizes. Collection never overlaps itself. Failed or unavailable memory measurements still allow other counters, with a 30-second minimum cycle instead of a busy loop. Processing entries are drained and reset per collection, without retaining raw entries; teardown disconnects the observer. App-owned workers are registered after construction and released on termination, errors and page cleanup.

Git operations and aggregation run in the dedicated worker. The worker is embedded in the single HTML deployment artifact, with the runtime alias needed by LightningFS rather than page HMR or overlay imports. Worker execution cannot eliminate garbage-collection delays, storage locks or resource contention.

## Aggregation, persistence and startup

Calendar-aligned one-minute open/high/low/close accumulators feed calendar-aligned 15-minute bars. Counts include only finite, available observations; absent samples do not create zeroes or empty intervals. A timer closes elapsed intervals even while memory measurement is pending. Only the current minute and quarter accumulators remain in RAM; raw samples and finalized minute detail are discarded. Open tabs also retain the live aggregate and completed unsaved bars for handoff.

Only completed 15-minute bars enter Git. The `v1/metrics` LightningFS database contains `/metrics`, with immutable interval files at `bars/YYYY/MM/DD/HH-mm.json`. A separate writer lock and flushed journal recover interrupted writes without changing workflow history. Identical retries create no extra commit; conflicting intervals are reported. Raw samples and minute detail never enter Git objects, where later deletion would leave them in history. Completed bars have no automatic expiry.

A disposable `v1/metrics/cache` localStorage entry supplies the last storage and memory reports and up to 96 completed bars at startup, bounded to 512 KiB of serialized characters. IndexedDB history and fresh measurements replace these previews. Cached observations never become new samples, unfinished bars are not cached, and invalid or full localStorage cannot stop recording. Restarts preserve the last known dashboard values while collection is pending.

The Histogram shows completed candles and a provisional live candle, with grouped metric selection and tooltips for values and local-time intervals. Candle series cover resource measurements such as bytes, record counts, processing durations and tracked thread counts. Inventory metadata, persistence status and storage utilization remain dashboard information. Retired series stay in saved history but leave the selector. A storage-type series is hidden only when its complete history matches total storage and the latest estimate does not distinguish them; collection continues so later divergence remains visible.

## Consequences

Measurements are useful observations within each API's scope, not a complete resource accounting system. History contains numeric metric keys and values, not workflow contents, database record values or memory-attribution URLs. Visualizations use the shared theme and accessible text equivalents.

Recording continues with Settings closed, but browsers can throttle or suspend background tabs. Closing every tab stops recording and loses the unfinished interval; completed Git history survives reloads. Browser tests cover actual database and repository inspection, nonmutation, unavailable APIs and layouts, while aggregation and persistence have dedicated checks.
