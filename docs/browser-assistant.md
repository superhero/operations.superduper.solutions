# Browser-local assistant

The AI pane provides browser-local chat. Open **Settings → AI** for language,
image and speech models, decisions, tools and compatibility. Selecting a language
model loads it; opening Settings does not download weights. Closing the pane
keeps the loaded model and tab-local conversation alive. Preferences persist;
chat and images remain tab-local. No account or API key is required.

The canonical [model-family guide](assistant-models.md) lists the current text,
vision and decision profiles. Exact source revisions, formats and original
acceptance attempts live in the catalogs and
[source provenance](../src/lib/assistant/reference-sources.json). Reference
acceptance and Operations qualification are separate records.

## Runtime and limits

Pi 1.3.0 coordinates streaming, sequential tools and progressive skill reads.
Bonsai uses the verified WebML runtime, Ornith/MiniCPM use native Wllama and Gemma
uses LiteRT-LM. CPU and partial GPU execution remain explicit where supported.
Capability checks test actual computation before model loading; successful small
probes do not establish model memory fit or mobile support.

**MiniCPM5 · 2.52B · FP32** is a separate, opt-in native Wllama profile.
It uses the pinned official Q4_K_M weights with full GPU model execution and
FP32 activations/KV, without requiring shader-f16. It keeps greedy decoding,
reasoning and prefix caching off, and caps context/output at4096/256 tokens.
It rejects CPU/hybrid fallback. The original MiniCPM option retains its existing
placement choices. One native Operations skill/application/image task passed its exact final-answer
oracle. The original suite retained an immediate-unload timing assertion failure;
later disposal/termination and terminal cleanup were observed. See
[compatible text evidence](assistant-compatible-text-quality.json) for scope.

Each text forward budgets the complete prompt, history and tool results.
Bonsai uses its native counter on the generating session; current Gemma/Wllama
bindings use a clearly labeled estimate. Output is capped by available context
and an explicit application reserve. Overflow preserves history and completed
tool effects. See [context evidence](assistant-context-quality.json) for the
qualified native scope and estimation limits.

Images use the separate pinned LFM2.5-VL1.6B tool. Original FP16/Q4 remains the
default. Compatible FP32/Q4 is opt-in, requires at least nine storage buffers per
shader stage and is checked before releasing text. Its sessions bind an owned
GPU device; CPU shape/indexing/preprocessing operators remain possible. The
compatible profile uses context1024, greedy output128 and white-square
letterboxing. Native execution does not guarantee reliable OCR or general image
answers; [vision evidence](assistant-vision-quality.json) records the actual
checks and failures.

The image tool releases physical text allocations while retaining Pi/history,
then disposes vision before restoring the exact text settings. Conversations
retain at most three local PNG/JPEG/WebP images, each up to10MiB/16MP and8192
pixels per side. New conversation clears them. Worker operations have bounded
deadlines; unknown or failed cleanup can leave text unloaded.

WebML's runtime source is fetched from its immutable upstream URL and checked
for exact byte count and SHA256 before import. Its redistribution license was
not established in the source handoff, so that runtime is not vendored or bundled.
Other runtime packages and notices are pinned in the application distribution.
Language selection automatically saves and verifies its immutable publisher files
before initialization. Image files are saved on first inspection. Whole-file
SHA256 and size must match before a complete IndexedDB marker is written; failed
ranges, cancellation and quota errors discard incomplete downloads. Model reads
then use local storage without publisher fallback. Missing required blocks fail;
optional metadata probes receive a local404. WebML's own disk cache and prefix
snapshot store remain disabled, separately from this application-owned store.

**Settings → AI → Model storage** lists verified files and removes unused models.
Same-origin tabs hold shared logical use claims through physical model handoff;
removal needs exclusive ownership. Shared files remain while another installed
profile references them. Runtime files bundled with the application still load
from this origin; cached model files do not establish fully offline SPA support.
Decision and speech installation remain separate integration work.

## Error diagnostics

Assistant failures use the shared application logger and appear in
**Settings → Logs → Errors**. The worker preserves native error types, codes,
stacks and nested causes using the same error transport as other application
workers. Model-load failures also identify the last loading stage and retain up
to four native WebML diagnostics, including reported device-loss details.
Generation failures are recorded before Pi converts them to conversational text;
explicit cancellation is not recorded as an inference failure.

Expand a saved error and choose **Copy error details** to copy its diagnostic
tree, origin, occurrence count and first/last-seen times. This uses the existing
bounded history snapshots. Missing native stacks remain missing rather than
being replaced by a misleading UI stack. Clipboard failures leave the displayed
diagnostics available for manual selection.

## Application capabilities

The closed tool registry exposes:

- Application summary, selected nodes/connections, visible canvas, UI settings,
  pane/search state, catalog summaries and saved workflow summaries.
- Operation search by words, catalog, method, path and description; operation
  input/documentation reads; paged schema JSON-pointer inspection.
- Current/saved workflow nodes and connections; per-node connection queries;
  current visible ports with exact handles and availability.
- On-demand `workspace-design` and `application-guide` skill instructions.
- Add a catalog operation with its schema panels, move visible nodes and connect
  compatible output/input ports in the current workflow.

Every mutation carries the workflow ID. The UI checks the current workflow,
workspace availability and concurrent changes after asynchronous preparation.
It uses canonical graph creation, connection types, occupancy, binary casts,
validation, autosave and normal version history. These edits do not open execution
or operation parameter dialogs. The existing Undo control reverses saved changes.
The assistant cannot remove nodes/connections, replace occupied inputs or alter
operation values. Workspace editing, tools and skills can be disabled independently
before loading.

Both Pi and the UI dispatcher validate tool arguments. Unknown/disabled tools,
unknown properties, invalid pointers, overlarge results, oversized move batches,
nonfinite/out-of-bounds coordinates and stale workflows fail explicitly. Reads
are paged (up to 20 entries, 12K-character result ceiling). Credentials/bindings
and uploaded workflow-file payloads are omitted; there is no general storage,
filesystem, URL-fetch, arbitrary code or operation/workflow execution tool.
Application text and tool results are treated as data in the system prompt.
The allowlist, rather than that prompt, defines the available capabilities.

Assistant replies use the shared Markdown parser and plugins, with automatic
remote image loading disabled for generated output. User-supplied attachments
are decoded locally. Ordinary workflow comment image behavior is unchanged.

## Verification

`src/browser-assistant.feature` checks configuration/pins, permission enforcement,
redaction/paging, canonical graph edits, real GPU-probe readback contracts with
fake devices, integrity failures, native message conversion and streaming,
real Pi tool/skill round trips, cancellation and request limits. Scripted native
responses use fresh confirmation values to establish tool-result delivery.

`tests/browser/browser-assistant.feature` exercises Settings, persistence,
resource lifecycle, read-only mode, actual graph edits/port discovery/autosave,
reply-image containment and narrow layouts. Only inference is scripted: no model
weights are downloaded and no real GPU throughput or vision qualification is
claimed. The worker entry point is excluded from Node source coverage, as with
existing worker entry points; its integration boundary is exercised through
browser UI contracts. The engine, probes, Pi adapter, tools and graph logic remain
in the source coverage gate.

Full source, acceptance, automation, component and browser validation remains
owned by CI. Development checks select affected cases under the project resource
boundary; sds-01 is preferred when it has headroom. Controlled inference fixtures
are distinct from the separately recorded real-model qualification.

## Rendering and interaction review

The 2026-10-23 review keeps the conversation and composer above optional settings.
The chat viewport has a stable height while replies grow; sending follows the
new reply, while incoming chunks preserve a reader's scroll position. The
composer stays available for drafting during generation. Tool results collapse
into expandable rows with their complete content retained. Buttons, switches,
disclosure indicators and large numeric ranges follow the Settings controls.
Image-only messages show an attachment indicator; reset/unload invalidates image
preparation so an old decode cannot repopulate a cleared conversation.

Two avoidable costs were verified: the worker projected every prior message
before its 40 ms publication throttle, and cloned snapshots invalidated completed
Svelte rows. Projection now happens at publication, and equal message views keep
their identity. Three alternating browser pairs with 40 prior messages and 80
updates showed median main-thread script time of **699 → 456 ms**. All candidate
samples retained the full transcript, followed the bottom correctly and had no
tasks over 50 ms. Style/layout counters increased; these local samples establish
the measured tradeoff, not field INP or a guarantee for every device. A separate
synthetic eight-delta publication benchmark reduced transcript projections from
2,010 to 251 with identical final output.

[The measurement record](browser-assistant-quality.json) preserves raw samples,
source/build hashes, conditions and limits. Comparisons used production HTML,
fresh profiles, Chromium 153, one CPU and 2 GiB with no additional swap. Initial
history layout stayed outside the timed interval. A separate Chrome trace was
used for attribution; its profiler-start overhead is excluded from comparisons.
The [Playwright CDP interface](https://playwright.dev/docs/api/class-cdpsession)
provides the counters; scripted inference isolates UI work from GPU inference.

Focused verification covers all seven Assistant browser cases in Chromium,
streaming/image cases in Firefox and WebKit, keyboard switch operation, draft
focus, fixed composer position, scroll behavior, complete tool expansion,
late image cleanup and rejected-file retry. Light/dark and 390 px layouts were
inspected, including reduced motion. The nine source cases retain 100% coverage
of the changed session module; typecheck and production build pass.

A separate real Bonsai 2B smoke test on the final UI loaded the pinned model,
generated a greeting, read application state and reported the exact fresh
workflow ID returned by the tool. It verified unload and had no page errors or
credential-bearing requests. This used desktop Chrome 155, an RTX 5060 Ti,
FP32, and explicit Vulkan test flags/ICD selection under a one-CPU, 3-GiB cap.
FP16 was unavailable. The page cannot enable those browser flags. This is not a
new qualification of 4B/9B, OCR, mobile/tablet inference or general throughput;
the per-model limitations above remain applicable.

[Installation evidence](assistant-storage-quality.json) records the actual shipped-installer and fresh-worker MiniCPM/compatible-image task with publisher requests blocked, plus targeted storage failure and cross-tab checks. Other installed native model families and original FP16 image execution do not inherit that acceptance.
