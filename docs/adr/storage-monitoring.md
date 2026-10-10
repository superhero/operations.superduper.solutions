# Browser-local storage monitoring

Settings exposes a collapsible Storage dashboard. It collects a snapshot when opened and when Refresh is pressed, with no background polling or persisted metrics. Measurements use browser and library APIs, not a second accounting system.

Keep the three measurement boundaries distinct:

- **Browser storage:** `navigator.storage.estimate()` supplies approximate usage and quota for the current origin. Remaining quota is clamped to zero, and utilization is unavailable when quota is zero or missing. Optional `usageDetails` categories may be incomplete or absent. `persisted()` reports persistence status; monitoring never calls `persist()` or requests permission.
- **IndexedDB:** enumerate available databases with `indexedDB.databases()` and inspect versions, stores, record counts, primary keys and index definitions through `idb` readonly transactions. Where enumeration is unavailable, inspect only known application database names and label that scope. Abort any open that would create a missing database, close inspection connections, and bound blocked requests. Do not read record values or manipulate LightningFS records. There is no physical per-database, per-store or per-index byte measurement to display.
- **Workflow repositories:** use the existing shared LightningFS and workflow locks. `du()` supplies logical repository and `.git` sizes; their difference is the working tree size. Git APIs supply refs, HEAD, remotes, tracked files and file-status counts. Counts may overlap when a file is both staged and modified. Commit count covers commits reachable from HEAD; recent history and the 30-day UTC activity chart use committer timestamps. These are not the total unique commits across every branch.

Inspection does not save, restore, checkout, commit or contact remotes. It waits for normal workflow-storage initialization, then reads each catalogue entry independently without invoking per-workflow recovery. One unreadable database or repository must not suppress unrelated metrics. Unsupported or failed measurements remain unavailable, never a fabricated zero. Chart values have equivalent readable text and use the existing theme roles.

Browser tests exercise actual IndexedDB databases and Git repositories, including schema/index counts, logical sizes, reload-safe nonmutation, refresh, unavailable APIs and narrow layouts. The browser-only collector is outside Node coverage, alongside the existing IndexedDB adapters.

Reference APIs: [Storage estimates](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate), [persistence status](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persisted), [database enumeration](https://developer.mozilla.org/en-US/docs/Web/API/IDBFactory/databases), [idb](https://github.com/jakearchibald/idb), [LightningFS](https://github.com/isomorphic-git/lightning-fs), [Git status matrix](https://isomorphic-git.org/docs/en/statusMatrix).
