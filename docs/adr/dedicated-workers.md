# Dedicated workers

> [!IMPORTANT]
> Dedicated workers handle background processing to reduce main-thread workload.

## Work distribution

Separate workers handle:

- **Schemas:** repository access, parsing, validation and operation extraction.
  The page reuses prepared results instead of repeating this work.
- **Workflows:** initialization, loading, autosave and Git history.
- **Resources:** measurements, aggregation and history persistence.
- **Connections:** bounded orthogonal route searches while an active workflow
  uses straight connections; rendering remains on the page.

Workers are bundled inline to retain a single HTML application. Themes, small
settings reads and rendering remain on the main thread. Window-only APIs use an
asynchronous bridge. Workers reduce competing work without guaranteeing smooth
animation during module loading or rendering.

## Reliability

Persistence retains existing locks, IndexedDB stores and recovery journals.
Failed calls reject with native error details and cause chains; no fallback
storage copy is created. Development hot replacement drains accepted calls
before terminating workers.
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
