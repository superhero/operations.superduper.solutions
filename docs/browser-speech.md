# Browser-local speech input

Open **Settings → Assistant → Speech input**. Choose CPU INT8 (about 0.67 GB)
or WebGPU FP32 encoder (about 2.50 GB, INT8 CPU decoder), then **Load speech**.
Both use NVIDIA Parakeet TDT 0.6B v3 through parakeet.js 1.4.4 and ONNX Runtime
Web 1.30.0. FP16 is experimental and is not offered as a qualified profile.

**Dictate** requests microphone permission. Confirmed sentences append to the
message draft; provisional words remain visible separately. Typed edits survive
later partial results. **Stop dictation** finalizes pending words. The model
never sends a message automatically. Bonsai must be ready before Send is enabled.
Speech can prepare a draft before Bonsai is loaded. Whole-recording refinement
is optional and off by default; enabling it inserts text only at completion.

Capture stops after 55 seconds, when Assistant/Speech input closes, or when the
page becomes hidden. Unload/page teardown terminates speech workers and stops
tracks. A late permission grant after cancellation immediately stops its tracks.
Audio files are decoded/resampled locally to mono 16 kHz (0.1–60 seconds, at
most 10 MiB). No speech service, hosted model or browser Web Speech API is used.

The latest 20 captures retain exact recognizer PCM as IEEE float32 WAV, signal
levels, capture settings, partial/final transcripts, timestamps, VAD/feature
statistics and error/reset events in local IndexedDB. **Local speech diagnostics**
offers playback, optional expected text with normalized word-error comparison,
JSON export including audio, and deletion. Sharing an export is a user action.
Application assistant tools cannot read these recordings.

Model files persist in parakeet.js's browser cache; the large GPU external-data
file streams to browser-local OPFS storage to avoid buffering gigabytes of
download chunks in memory. That profile requires OPFS support. After one successful load,
**Restore loaded speech when Assistant opens** restores the selected profile on
reload without requesting the microphone. Unload clears that restoration state
but retains downloads. Clear speech cache removes only Parakeet resources;
recordings have a separate delete control. Cache eviction or private browsing
may require downloading again. Private browsing can impose a quota smaller than
the GPU weights; choose CPU or use a regular browser profile in that case.

Download progress has a two-minute idle deadline and a twenty-minute total
deadline. After files are ready, initialization has a separate **120-second**
deadline. This deliberately separates cold multi-gigabyte downloads from BS's
initialization watchdog. A failure terminates the worker and offers **Retry
speech**; retry starts a fresh worker without an automatic retry/fallback loop.
The selected GPU profile never silently substitutes CPU encoding.

## Implementation and provenance

The supplied handoff's AO implementation provides the AudioWorklet capture,
TEN-VAD detection, continuous features, sentence merger, pause/Stop semantics
and single-flight decoder. PCM reaches a separate feature worker while CPU
inference is occupied. Context is six seconds for CPU and thirty for GPU;
coalescing drops redundant recognition jobs, never captured audio.

The BS initialization patch is applied at build time to a hash-checked
parakeet.js source file. Encoder and decoder sessions are created sequentially
for both profiles, with stage messages; GPU retains the decoder WASM bootstrap.
The installed package is not mutated. `model.lock.json` and `runtime.lock.json`
pin artifacts and integrity checks. The ONNX files are ysdede's maintainer
conversion, not NVIDIA-native ONNX weights.

The application remains a single embedded HTML client. Speech is an optional
`speech/` module bundle requested on Load; ORT's 26 MB Asyncify WASM exceeds the
Cloudflare Pages 25 MiB asset limit and is fetched from a version-pinned CDN,
verified and cached locally. Model downloads use revision-pinned Hugging Face
URLs with streaming SHA-256 (Git blob SHA-1 for vocabulary). Cross-origin
isolation uses existing COOP/COEP hosting headers. HTTPS or localhost is required
for microphone capture. Reloading cached speech requires the local runtime
bundle to remain available; inference itself makes no server requests.

Preserved [dependency notices](../src/lib/speech/NOTICES.md) include TEN-VAD's
Apache license **with Agora additional conditions**, its BSD notices, and
Parakeet/ORT licenses. Distribution includes the original separate license
files. First-party browser wiring follows the application's AGPL license.

AO/BS reference evidence establishes successful desktop runs, not universal
startup or transcription reliability. Very short/cut-off utterances can
hallucinate; VAD can miss quiet/noisy speech. GPU availability, memory, startup
and microphone sample-rate support vary. Mobile/tablet performance and thermal
behavior remain unqualified. Existing Bonsai vision/OCR limitations still apply.

Primary references: [parakeet.js](https://github.com/ysdede/parakeet.js),
[NVIDIA model](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3),
[ONNX browser artifacts](https://huggingface.co/ysdede/parakeet-tdt-0.6b-v3-onnx),
[ORT web configuration](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html),
[microphone capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
[Pages limits](https://developers.cloudflare.com/pages/platform/limits/).

The source coverage scope includes speech algorithms, integrity checks and
protocol helpers. DOM/audio/IndexedDB orchestration and worker entry points are
checked through browser scenarios, following the existing worker-client split.
CI retains full regression checks; model downloads are excluded from ordinary CI.

## Integration verification

The [functional evidence](browser-speech-quality.json) records real CPU file
and AudioWorklet microphone transcription of a pinned public JFK fixture,
followed by cached restoration with external requests blocked. A regular-profile
GPU run completed streaming download and integrity verification; encoder creation
exceeded this desktop test's 4 GiB cgroup cap. GPU inference is not newly qualified
on that constrained configuration. The supplied AO/BS successful GPU evidence and
its documented limitations are preserved; no automatic CPU substitution occurs.

Focused Gherkin checks exercise merging, pauses, silence, partition-invariant
features, RPC ordering/failure, integrity/pins and streamed-download recovery.
Browser scenarios exercise repeated recordings, editable drafts, permission
denial/late grants, microphone cleanup, cached restoration, initialization Retry,
local WAV/JSON export and a narrow Settings layout.
