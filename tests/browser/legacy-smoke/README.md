# Native browser lifecycle fixtures

## Reported cases

[`../legacy-smoke.feature`](../legacy-smoke.feature) replaces the eleven former
`tests/*.smoke.mjs` entry points with **37 reported Gherkin cases**. No helper
starts another test runner or hides an independent case in a subprocess.

Each fixture exports an asynchronous journey. A named Gherkin step advances it
to the next matching assertion group. The completion step rejects missing or
extra groups, and the scenario hook finishes pending cleanup after failure.
This preserves shared state for meaningful save/reload/recovery journeys while
keeping independent faults and contexts in separate scenarios.

## Assertion map

| Former script | Reported destination | Preserved assertions |
| --- | --- | --- |
| `appearance-cache.smoke.mjs` | Six appearance startup examples | Cache painting before JavaScript/IndexedDB; authoritative and empty settings; reload; rejected writes; corrupt JSON/version; blocked storage; safe failed-load fallback. |
| `runtime-errors.smoke.mjs` | Six runtime normalization examples | Native identity/stack, source coordinates, ResizeObserver errors, zero/string/circular rejections; one transport/history entry; no invented frames or reporting cascade. |
| `settings-startup.smoke.mjs` | Four settings recovery examples | Old preferences store; blocked open/read/security; native causes/codes; overlay cause navigation; retries without reload; no late writes; successful later reads/writes; nested cause codes. |
| `resize-observer.smoke.mjs` | Two motion examples | Real ResizeObserver notifications; settled startup/settings/search/report/schema heights; wrapping and narrow viewport changes, with normal and reduced motion. |
| `startup-progress.smoke.mjs` | Five startup lifecycle examples | Thirteen ordered stages; saved canvas before loader removal; worker history and notifications; settings/workflow stalls; worker errors; intentional preview hold. |
| `metrics-recorder.smoke.mjs` | One worker lifecycle and two cache examples | Native long tasks; serialized measurement; OHLC aggregation/Git; read-only workflow monitoring; leader/follower handoff; cached preview before durable history; page lifecycle accounting; corrupt/blocked cache. |
| `metrics-history-repository.smoke.mjs` | Metrics history journey | Journal/staged-file recovery; duplicate/conflicting/invalid writes; concurrent appends; aggregate-only files; clean Git state; durable fresh-document reads. |
| `schema-storage.smoke.mjs` | Schema repository journey | Independent histories; immutable identity; metadata-only enablement; journal quota/committed-metadata recovery; read-only refresh; renaming/ordering; isolated and durable deletion. |
| `storage-namespace.smoke.mjs` | Five namespace examples | Fresh discovery; complete migration with branches/redo, schema/index metadata, binary/modes/symlinks; active recorder blocking and interrupted-copy recovery; repeat startup; completed-copy cleanup; proven database/filesystem deletion boundaries. |
| `schemas-settings.smoke.mjs` | Schema management, full-document viewer and lock-retry journeys | Worker-backed JSON/YAML upload; catalog request execution; workflow retention; replacement/history; enablement; download; invalid input; isolated deletion; blur/Enter rename; drag preview/cancel/keyboard/reload; worker responsiveness; initial lock recovery. |
| `dev-overlay.smoke.mjs` | Development tools journey | Persisted/disabled toolbar; native source links; live palette and syntax roles; error dismissal/reopening; failed transport recursion guard; Pail recovery; accessible animated loader with stalled settings. |

## Existing coverage reused

The old schema-management script also contained a full JSON-viewer journey.
Its operation-only expansion expectation predates the current method-level
preset and conflicted with the application behavior. The method-expansion expectation is covered by
the existing `json-view.feature` cases:

- `Settings schema methods are expanded for an operation overview` verifies the
  current default branch/method expansion and resetting it on reopen.
- Operation JSON cases cover keyboard navigation, interruption and wrapping.
  The separate full-document schema case retains the original whole-document
  clipboard, lazy rendering, root folding, focus and closed-header background
  assertions; these are not treated as redundant with operation-only JSON.

Everything else remains in the assertion map above. UI actions use the current
Settings drawer behavior; tooltip text is not substituted for accessible labels.

The legacy scripts targeted Chromium. Their migrated feature retains that
boundary with `@chromium-only`, including native long-task and clipboard APIs.

## Server and browser ownership

`support.mjs` lazily shares a development server and its module graph per worker.
Storage fixtures register virtual modules on that server. Development source-link
checks use a separate copied application root so absolute editor paths still
resolve to the original source.

The browser belongs to the shared browser harness. Each journey owns fresh
contexts, records traces, and closes only those contexts. Failure cleanup and
abort handling release them; worker teardown closes the fixture servers.
Generated pages, copies, caches, diagnostic JSON and traces stay under `tmp/`.

## Focused checks

Select the feature, a named scenario, or a tag such as `@appearance-cache`,
`@runtime-errors`, `@settings-startup`, `@metrics-recorder` or `@schemas-settings`
through the browser Gherkin runner. The suite needs a real browser and the
application build, so use the shared resource-limited remote test job.
