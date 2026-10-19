# Dedicated workers

> [!IMPORTANT]
> Dedicated workers handle background processing to reduce main-thread workload.

## Work distribution

Separate workers handle:

- **Schemas:** metadata, repository access, parsing, validation and operation
  extraction. Startup publishes compact discovery indexes for enabled sources;
  later requests return bounded batches of canonical models or one document. Metadata-only changes
  do not clone the complete library again.
- **Workflows:** initialization, loading, autosave and Git history.
- **Matching:** prompt evaluation, cancelled when newer text or schemas replace
  the pending search.
- **Resources:** measurements, aggregation and history persistence.
- **Errors:** bounded IndexedDB history, independent of resource sampling and
  isolated from its own failure-reporting path.
- **Connections:** bounded orthogonal route searches while an active workflow
  uses straight connections; rendering remains on the page.
- **Secrets:** password derivation, encrypted vault changes and approved
  credentialed requests. Window-only passkey ceremonies pass temporary PRF
  material to this worker.

Workers are bundled inline to retain a single HTML application. Themes, small
settings reads and rendering remain on the main thread. Window-only APIs use an
asynchronous bridge. Workers reduce competing work without guaranteeing smooth
animation during module loading or rendering.

Matching retains normalized indexes per enabled schema and updates only changed
schemas. Completed searches reuse their worker and its installed indexes. Queries
send text and a snapshot token; replies include matched IDs and scores. Full
candidate scores cross the boundary only when developer evaluation details are
enabled. The page retains its original operation references. New text terminates
an executing obsolete worker immediately; its replacement reinstalls the cached
indexes. Crashes also invalidate worker-side index state. Exact scoring, Unicode
normalization and tie ordering remain unchanged.

## Reliability

Persistence retains existing locks, IndexedDB stores and recovery journals.
Failed calls reject with native error details and cause chains; no fallback
storage copy is created. Development hot replacement drains accepted calls
before terminating workers.
Secret workers instead terminate immediately on lock or cancellation, reject
late results and report safe typed errors without credential-bearing causes.
Disposable routing calculations cancel immediately when their canvas closes or
changes mode. Only the latest pending scene is retained, and obsolete scene or
drag replies cannot replace current geometry.

## Startup progress

The loading screen and console report the same actual initialization stages.
Background refreshes do not replay them. Successful startup shows `Completed`
before fading out the loader; failures reveal the rendered app and recovery
controls.

## Loading preview

With `npm run dev`, open `/?dev-loading=1` to hold startup at its first stage
while the animation runs. Omit the parameter for normal startup; production
ignores it.
