# Dedicated workers handle background processing to reduce main-thread workload

Background computation and persistence share resources with rendering when they run on the main thread. Dedicated workers handle eligible work so the interface has less competing work to perform. Schema processing, workflow Git operations and resource recording have separate, persistent workers, bundled as inline Vite workers so the production application remains a single HTML file.

The schema worker prepares storage namespaces, reads and writes repositories, parses uploads, validates documents, extracts operations, and prepares summaries and source fingerprints. The page publishes the resulting registry without repeating validation or extraction. Unchanged sources retain their existing operation objects. Card summaries use the prepared metadata instead of inspecting the full schema on every render.

The workflow worker owns the editor's repository client for initialization, loading, autosave and history. Existing Web Locks, IndexedDB stores and recovery journals remain authoritative. It forwards startup stages and repository notifications to the page. Direct backend entry points remain available to the metrics worker and persistence tests.

The resource recorder collects measurements, aggregates intervals and persists their history in its own worker. Window-only APIs use an asynchronous bridge to the main thread; see [resource monitoring](resource-monitoring.md).

Worker calls preserve error names, messages, stacks, codes and cause chains. Failed calls reject normally; no persisted fallback copy is introduced. Development disposal drains accepted calls before terminating a worker so hot replacement does not interrupt a write.

Theme application, small settings reads, DOM rendering and loader painting remain on the main thread. Workers reduce competing CPU work but do not guarantee every animation frame during module evaluation or rendering. Browser checks cover startup stages and failures, reload persistence, history and notifications, schema management, and continued rendering during a 1,500-operation upload.

## Startup progress and loading preview

Report actual initialization work so a slow startup identifies the operation being
awaited. The loading screen and the logger's `startup` scope share the stages in
[`startup-progress.ts`](../../src/lib/startup-progress.ts), currently 13. For
example, the console reports `Reading settings — 3 of 13`; the screen places the
count above the action. Stages cover settings reads, schema loading, workflow
storage and repository checks, and canvas restoration. Later background refreshes
do not replay startup progress.

On success, show `Completed` before fading out the loading screen. On failure,
release the screen when the app has rendered so its recovery controls remain
usable. See [diagnostics and error reporting](error-view.md) for settings
storage errors and recovery.

To develop the animation, run `npm run dev` and open `/?dev-loading=1`. This pauses
startup at `Loading application — 1 of 13` while the CSS animation continues.
Remove the query parameter to load the app normally. The preview is gated by
`import.meta.env.DEV` in [`src/index.ts`](../../src/index.ts) and is ignored in
production.
