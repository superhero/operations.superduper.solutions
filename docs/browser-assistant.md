# Browser-local assistant

Settings → Assistant offers Bonsai 2 **2B, 4B and 9B**. Load one model, send
messages or an image, and inspect its tool results in the conversation. Closing
the pane keeps the model and tab-local conversation alive. Stop/unload terminates
the worker; loading again starts a new conversation. Preferences persist locally;
chat and images are not persisted. No account or API key is required.

The first integration follows the Pi browser handoff in
`llm-sds-01/inference/evaluations/pi-browser/HANDOFF.md`, from session
`01a12fd0-d517-7480-8b57-dd6dea35769d`. Its combined example is
[the preferred-engine collection](https://192.168.1.173:8444/jb-browser-pi-preferred-engines/).
`src/lib/assistant/config.ts` preserves the selected official model and projector
revisions, filenames, byte counts, runtime URL/checksum and original evidence IDs.

## Runtime and limits

Inference uses **Pi 1.3.0 + WebML WebGPU**, routed by the chosen engine. The native
message/tool transcript, streaming events, sequential Pi agent loop, progressive
skill reads, sampling and prefix-cache options adapt the reference implementation.
Ornith/Wllama and Bonsai 27B are intentionally outside this integration.

A worker is created only for a compatibility check or explicit model load. It
verifies a real FP32 shader computation and readback, and probes optional FP16
with a fresh adapter. The selected WebML runtime is GPU-only; it has no CPU
fallback or Wllama/JSPI/Memory64 requirement. The UI reports missing capabilities
and does not guess driver versions, free memory or mobile support. It limits
context configuration to 512–32768 tokens, defaults to the reference 4096, and
requires an output budget smaller than context. Allocation can still fail.

The runtime downloads directly from its immutable upstream Hugging Face URL.
Both its exact byte count and SHA-256 are checked before module import. Its
redistribution license was not established in the source handoff: the runtime is
not vendored, mirrored or placed in a build artifact. Pi's MIT notices accompany
the application. Official model weights/projectors remain remote and are loaded
at their pinned revisions; model cache and prefix snapshots on disk stay disabled.
The declared weight hashes in the original evaluation are not a claim that this
integration verifies whole multi-gigabyte model downloads.

Language plus vision downloads are approximately 0.79 GB (2B), 1.32 GB (4B) and
2.62 GB (9B). These are file sizes, not measured RAM/VRAM requirements. All three
selected source profiles passed their recorded text/tool/skill checks and failed
the OCR cards. Image support does not establish reliable text extraction. Desktop
source-run throughput is provisional; mobile and tablet inference are unqualified.
New sampling/context choices do not inherit the baseline's results.

Attachments retain the reference limits: one PNG/JPEG/WebP up to 10 MiB and
16 megapixels, downscaled without upsampling to the configured pixel budget.
The source and decoded bitmaps are released after conversion. Generation and
loading have bounded deadlines; the UI also enforces a hard worker deadline.
Stop/unload aborts pending tool dispatch and terminates worker-owned GPU work.

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
required on release/main. sds-01 is excluded from this task's local test workloads.
