<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import HintButton from "$lib/components/HintButton.svelte";
  import FieldSelect from "$lib/components/FieldSelect.svelte";
  import FieldInteger from "$lib/components/FieldInteger.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import WorkflowCommentPreview from "../workflows/WorkflowCommentPreview.svelte";
  import { assistantSettingsKey, bonsaiModels, defaultAssistantSettings, validateAssistantSettings, type AssistantSettings as Preferences } from "$lib/assistant/config.ts";
  import { enabledAssistantTools, executeAssistantTool, type AssistantHost } from "$lib/assistant/tools.ts";
  import { assistantSkills } from "$lib/assistant/skills.ts";
  import type { AssistantCompatibility } from "$lib/assistant/compatibility.ts";
  import type { AssistantMessageView } from "$lib/assistant/pi-session.ts";
  import InferenceWorker from "$lib/assistant/inference.worker.ts?worker&inline";
  import { trackApplicationWorker } from "$lib/application-workers.ts";
  import SpeechSettings from "./SpeechSettings.svelte";
  import { appendDictation } from "$lib/speech/config.js";
  import type { Dictation } from "$lib/speech/controller.js";
  import { encodeError, decodeError } from "$lib/worker-rpc.ts";
  import { logger } from "$lib/logger.ts";

  let { host, visible = true }: { host: AssistantHost; visible?: boolean } = $props();
  let preferenceError = $state("");
  function readPreferences() {
    try { return validateAssistantSettings(JSON.parse(localStorage.getItem(assistantSettingsKey) ?? "{}")); }
    catch (problem) { report(problem, "settings"); preferenceError = "Saved assistant preferences could not be read. Using defaults for this session."; return { ...defaultAssistantSettings }; }
  }
  let preferences = $state<Preferences>(readPreferences());
  let phase = $state<"unloaded" | "checking" | "loading" | "ready" | "generating">("unloaded");
  const busy = $derived(["checking", "loading", "generating"].includes(phase));
  const locked = $derived(phase !== "unloaded");
  let status = $state("");
  let error = $state("");
  let compatibility = $state<AssistantCompatibility>();
  let messages = $state.raw<AssistantMessageView[]>([]);
  const messageFields = ["role", "text", "thinking", "tool", "failed", "imageCount"] as const;
  let prompt = $state("");
  function growMessage(input: HTMLTextAreaElement, _draft: { prompt: string; visible: boolean }) {
    let active = true, width = 0;
    const resize = () => {
      if (!active || !input.clientWidth) return;
      const positions: Array<[HTMLElement, number]> = [];
      for (let parent = input.parentElement; parent; parent = parent.parentElement) positions.push([parent, parent.scrollTop]);
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
      for (const [parent, top] of positions) parent.scrollTop = top;
    };
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width !== width) { width = entry.contentRect.width; resize(); }
    });
    observer.observe(input);
    queueMicrotask(resize);
    void document.fonts.ready.then(resize);
    return { update: () => queueMicrotask(resize), destroy: () => { active = false; observer.disconnect(); } };
  }
  let speechReady = $state(false), speechBusy = $state(false), speechRecording = $state(false);
  let speechSettings: SpeechSettings;
  let configurationOpen = $state(false);
  async function toggleDictation() {
    if (!speechReady) configurationOpen = true;
    await tick();
    await speechSettings.toggleDictation();
  }
  let speechSession = "", confirmedSpeech = "";
  let dictationWarning = $state("");
  function dictate(value: Dictation) {
    if (value.sessionId !== speechSession) { speechSession = value.sessionId; confirmedSpeech = ""; dictationWarning = ""; }
    const result = appendDictation(prompt, confirmedSpeech, value.confirmed);
    prompt = result.draft; confirmedSpeech = result.confirmed;
    if (result.truncated) dictationWarning = "The message reached its character limit. The complete transcript is kept in local speech diagnostics.";
  }
  let attachment = $state<{ data: string; mimeType: string } | null>(null);
  let imagePreparing = $state(false);
  let imageInput: HTMLInputElement;
  let conversation: HTMLDivElement;
  let worker: Worker | undefined, release: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let toolAbort = new AbortController();
  let loadedSettings: Preferences = { ...defaultAssistantSettings };
  let alive = true;
  let imageGeneration = 0;
  let followNextUpdate = false;
  const model = $derived(bonsaiModels.find(model => model.id === preferences.model)!);
  const modelOptions = bonsaiModels.map(model => ({ value: model.id, label: model.label }));
  const integers = [
    { key: "context", label: "Context tokens", minimum: 512, maximum: 32768 },
    { key: "maxTokens", label: "Output tokens", minimum: 1, maximum: 20000 },
    { key: "topK", label: "Top K", minimum: 1, maximum: 64 },
    { key: "imagePixels", label: "Image pixel budget", minimum: 16384, maximum: 1048576 },
    { key: "maxTurns", label: "Model turns per message", minimum: 1, maximum: 32 },
    { key: "maxToolCalls", label: "Tool calls per message", minimum: 1, maximum: 64 },
    { key: "seed", label: "Seed", minimum: 0, maximum: 4294967295 },
    { key: "responseTimeout", label: "Response deadline (ms)", minimum: 1000, maximum: 3600000 },
    { key: "requestTimeout", label: "Message deadline (ms)", minimum: 1000, maximum: 3600000 },
    { key: "loadTimeout", label: "Load deadline (ms)", minimum: 30000, maximum: 3600000 },
  ] as const;
  const switches = [
    { key: "tools", label: "Application tools" }, { key: "editing", label: "Workspace editing" }, { key: "skills", label: "Skills" },
    { key: "thinking", label: "Reasoning" }, { key: "sampling", label: "Sample responses" }, { key: "prefixCache", label: "Prefix cache" },
  ] as const;

  function savePreferences() {
    try { localStorage.setItem(assistantSettingsKey, JSON.stringify(validateAssistantSettings(preferences))); preferenceError = ""; }
    catch (problem) { preferenceError = report(problem, "settings"); }
  }
  function terminate() {
    clearTimeout(timer); timer = undefined; toolAbort.abort();
    worker?.terminate(); worker = undefined; release?.(); release = undefined;
  }
  function stop() {
    terminate(); clearAttachment(); phase = "unloaded";
    status = "Model unloaded. Load a model to start a new conversation.";
  }
  function report(problem: unknown, operation: string) {
    const native = problem instanceof Error ? problem : decodeError(encodeError(problem));
    logger.scope("assistant").scope(operation).error(native);
    return native.message;
  }
  function failure(problem: unknown, operation: string = phase) {
    error = report(problem, operation); terminate(); phase = "unloaded";
    status = "The assistant stopped. Load a model to try again.";
  }
  function deadline(ms: number) {
    clearTimeout(timer); timer = setTimeout(() => failure(new Error("Assistant deadline reached; the model was unloaded.")), ms);
  }
  function startWorker() {
    if (worker) return worker;
    const instance = new InferenceWorker({ name: "operations-bonsai-inference" });
    worker = instance; toolAbort = new AbortController();
    release = trackApplicationWorker(instance, { scope: "assistant", reportErrors: false });
    instance.onmessage = event => {
      if (worker !== instance) return;
      const message = event.data;
      if (message.type === "compatibility") {
        compatibility = message.value;
        if (phase === "checking") { terminate(); phase = "unloaded"; status = message.value.summary; }
      } else if (message.type === "progress") {
        const value = message.value;
        status = typeof value === "string" ? value : String(value?.message ?? value?.status ?? "Loading model…");
        if (typeof value?.progress === "number") status += ` ${Math.round(value.progress * 100)}%`;
      } else if (message.type === "ready") { clearTimeout(timer); phase = "ready"; status = "Ready · inference stays in this browser."; }
      else if (message.type === "update") {
        const atBottom = followNextUpdate || !conversation || conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 50;
        followNextUpdate = false;
        // A worker snapshot clones every object. Keep completed row identities so
        // streaming a reply only invalidates the message that actually changed.
        messages = message.messages.map((next: AssistantMessageView, index: number) => {
          const previous = messages[index];
          return previous && messageFields.every(key => previous[key] === next[key]) ? previous : next;
        });
        error = message.error;
        if (atBottom) void tick().then(() => { if (alive && conversation) conversation.scrollTop = conversation.scrollHeight; });
      } else if (message.type === "done") { clearTimeout(timer); phase = "ready"; status = "Ready for your next message."; }
      else if (message.type === "error") failure(decodeError(message.error), message.operation);
      else if (message.type === "diagnostic") report(decodeError(message.error), message.operation);
      else if (message.type === "tool") {
        const signal = toolAbort.signal;
        void executeAssistantTool(host, loadedSettings, message.name, message.args, signal).then(value => {
          if (worker === instance && !signal.aborted) instance.postMessage({ type: "tool_result", id: message.id, value });
        }, failure => {
          if (worker === instance && !signal.aborted) instance.postMessage({ type: "tool_result", id: message.id, error: failure instanceof Error ? failure.message : String(failure) });
        });
      }
    };
    instance.onerror = event => { if (worker === instance) {
      event.preventDefault();
      failure(event.error ?? { name: "WorkerError", message: event.message || "The inference worker stopped unexpectedly.",
        ...(event.filename ? { stack: `at ${event.filename}:${event.lineno}:${event.colno}` } : {}) });
    } };
    instance.onmessageerror = () => { if (worker === instance) failure({ name: "WorkerError", message: "Could not read the assistant worker's response." }); };
    return instance;
  }
  function check() {
    if (locked) return;
    error = ""; phase = "checking"; status = "Checking browser GPU computation…";
    try { deadline(20000); startWorker().postMessage({ type: "check" }); }
    catch (problem) { failure(problem, "check"); }
  }
  function selectModel(value: string) {
    if (locked) return;
    preferences.model = value;
    load();
  }
  function load() {
    if (locked) return;
    try {
      loadedSettings = validateAssistantSettings(preferences); savePreferences();
      clearAttachment();
      error = ""; messages = []; phase = "loading"; status = "Checking WebGPU and loading model…";
      deadline(loadedSettings.loadTimeout + 20000); startWorker().postMessage({ type: "load", settings: loadedSettings });
    } catch (problem) { failure(problem, "load"); }
  }
  function send() {
    if (phase !== "ready" || imagePreparing || speechBusy || (!prompt.trim() && !attachment)) return;
    phase = "generating"; error = ""; status = "The assistant is working…";
    followNextUpdate = true;
    toolAbort.abort(); toolAbort = new AbortController();
    deadline(loadedSettings.requestTimeout + 2000);
    worker!.postMessage({ type: "send", text: prompt, images: attachment ? [{ type: "image", ...attachment }] : [] });
    prompt = ""; dictationWarning = ""; clearAttachment();
  }
  function reset() {
    if (phase !== "ready" || speechBusy) return;
    phase = "generating"; error = ""; prompt = ""; dictationWarning = ""; clearAttachment(); deadline(10000); worker!.postMessage({ type: "reset" });
  }
  function clearAttachment() {
    imageGeneration++; imagePreparing = false; attachment = null;
    if (imageInput) imageInput.value = "";
  }
  async function prepareImage(file: File | undefined) {
    if (!file) return;
    const generation = ++imageGeneration;
    imagePreparing = true; error = "";
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10485760) throw new Error("Choose a PNG, JPEG or WebP image up to 10 MiB.");
      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width * bitmap.height > 16000000) throw new Error("Choose an image up to 16 megapixels.");
        const scale = Math.min(1, Math.sqrt(preferences.imagePixels / (bitmap.width * bitmap.height)));
        const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.floor(bitmap.width * scale)); canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        if (alive && generation === imageGeneration) attachment = { data: canvas.toDataURL("image/png").split(",")[1]!, mimeType: "image/png" };
      } finally { bitmap.close(); }
    } catch (problem) { if (alive && generation === imageGeneration) { error = report(problem, "image"); imageInput.value = ""; } }
    finally { if (alive && generation === imageGeneration) imagePreparing = false; }
  }
  onDestroy(() => { alive = false; imageGeneration++; terminate(); });
</script>

<section class="assistant-settings" aria-label="Browser assistant">
  <div class="assistant-chat">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable conversation needs keyboard focus.) -->
  <div class="conversation" class:empty={!messages.length && phase !== "generating"} role="log" aria-label="Assistant conversation" aria-live="off" bind:this={conversation} tabindex={messages.length ? 0 : -1}>
    {#each messages as message, index}
      <article class:user={message.role === "user"} class:tool={message.role === "tool"} class:failed={message.failed}>
        {#if message.role === "tool"}
          <details class="tool-result"><summary><span>{message.tool}</span><span class="tool-state">{message.failed ? "Failed" : "Result"}</span><MaterialIcon name="chevron_forward" size={16} /></summary><pre>{message.text}</pre></details>
        {:else}
          <strong>{message.role === "user" ? "You" : "Bonsai"}</strong>
          {#if message.imageCount}<p class="image-note"><MaterialIcon name="image" size={16} />{message.imageCount === 1 ? "1 image attached" : `${message.imageCount} images attached`}</p>{/if}
          {#if message.thinking}<details><summary>Reasoning<MaterialIcon name="chevron_forward" size={16} /></summary><pre>{message.thinking}</pre></details>{/if}
          {#if message.role === "assistant"}<WorkflowCommentPreview text={message.text} scope={`assistant-${index}`} allowImages={false} />{:else}<pre>{message.text}</pre>{/if}
        {/if}
      </article>
    {/each}
  </div>
  <form class="composer" onsubmit={event => { event.preventDefault(); send(); }}>
    <div class="composer-header">
      <div class="model-picker">
        <MaterialIcon name="robot" size={16} />
        <FieldSelect id="assistant-model" label="Local model" options={modelOptions} includePlaceholder={false} value={preferences.model} disabled={locked} active={visible}
          onValueChange={selectModel} onReselect={selectModel} />
      </div>
      <span class="context-window" aria-label={`Context window: ${preferences.context} tokens`}>{new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(preferences.context)} context</span>
      <div class="model-actions" role="group" aria-label="Model controls">
        {#if locked}
          <HintButton type="button" class="composer-action" label="New conversation" disabled={phase !== "ready" || speechBusy} onclick={reset}><MaterialIcon name="add_comment" size={18} /></HintButton>
          <HintButton type="button" class="composer-action" label={busy ? "Stop and unload" : "Unload model"} onclick={stop}><MaterialIcon name={busy ? "stop" : "power_settings_new"} size={18} /></HintButton>
        {:else}
          <HintButton type="button" class="composer-action" label="Check compatibility" onclick={check}><MaterialIcon name="fact_check" size={18} /></HintButton>
        {/if}
      </div>
    </div>
    <label for="assistant-message" class="sr-only">Message</label>
    <textarea id="assistant-message" rows="3" maxlength="16000" use:growMessage={{ prompt, visible }} bind:value={prompt} disabled={phase !== "ready" && phase !== "generating" && !speechReady} placeholder="Prompt"
      onkeydown={event => { if (phase === "ready" && event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); } }}></textarea>
    {#if attachment}<div class="attachment"><img alt="Attachment ready to send" src={`data:${attachment.mimeType};base64,${attachment.data}`} /><button type="button" class="secondary" disabled={busy} onclick={clearAttachment}>Remove image</button></div>{/if}
    {#if imagePreparing}<p class="image-preparing" role="status">Preparing image…</p>{/if}
    <div class="composer-toolbar" role="group" aria-label="Message actions">
      <HintButton type="button" class="composer-action attach-action" label="Attach image" disabled={phase !== "ready" || imagePreparing} onclick={() => imageInput.click()}><MaterialIcon name="attach_file" size={16} /><span class="attach-label">Attach image</span></HintButton>
      <div class="composer-tools">
        <HintButton type="button" class={speechRecording ? "composer-action recording" : "composer-action"} label={speechRecording ? "Stop dictation" : "Dictate"} aria-pressed={speechRecording} disabled={speechBusy && !speechRecording} onclick={() => void toggleDictation()}><MaterialIcon name={speechRecording ? "stop" : "mic"} size={16} /><span>{speechRecording ? "Stop" : "Dictate"}</span></HintButton>
        <HintButton type="button" class="composer-action" label="Assistant configuration" aria-expanded={configurationOpen} aria-controls="assistant-configuration-panel" onclick={() => configurationOpen = !configurationOpen}><MaterialIcon name="tune" size={18} /></HintButton>
      </div>
      <input hidden aria-label="Attach assistant image" type="file" accept="image/png,image/jpeg,image/webp" disabled={phase !== "ready" || imagePreparing} bind:this={imageInput} onchange={event => void prepareImage(event.currentTarget.files?.[0])} />
    </div>
  </form>
  </div>
  <p class="status" class:sr-only={!status} role="status">{status}</p>
  {#if preferenceError}<p class="error" role="alert">{preferenceError}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if dictationWarning}<p class="error" role="status">{dictationWarning}</p>{/if}
  <div id="assistant-configuration-panel" class="assistant-configuration" hidden={!configurationOpen} inert={!configurationOpen}>
  <SpeechSettings bind:this={speechSettings} {visible} onDictation={dictate} onActivity={value => { speechReady = value.ready; speechBusy = value.busy; speechRecording = value.recording; }} />
  <details class="assistant-details">
    <summary>Configuration<MaterialIcon name="chevron_forward" size={16} /></summary>
    <p>{locked ? "Unload the model to change configuration. " : ""}Preferences are saved on this browser.</p>
    <fieldset disabled={locked} aria-label="Assistant configuration">
      <div class="options">
        {#each integers as setting}
          <div class="option"><label for={`assistant-${setting.key}`}>{setting.label}</label>
            <FieldInteger id={`assistant-${setting.key}`} label={setting.label} value={String(preferences[setting.key])} minimum={setting.minimum} maximum={setting.maximum} disabled={locked} logarithmic={setting.maximum > 1000}
              onValueChange={value => { preferences[setting.key] = Number(value); savePreferences(); }} />
          </div>
        {/each}
        {#each [{ key: "temperature", label: "Temperature", min: 0.01, max: 2 }, { key: "topP", label: "Top P", min: 0.001, max: 1 }, { key: "minP", label: "Min P", min: 0, max: 1 }] as setting}
          <div class="option"><label for={`assistant-${setting.key}`}>{setting.label}</label>
            <input id={`assistant-${setting.key}`} type="number" min={setting.min} max={setting.max} step="any" value={preferences[setting.key as "temperature" | "topP" | "minP"]}
              oninput={event => { preferences[setting.key as "temperature" | "topP" | "minP"] = event.currentTarget.valueAsNumber; savePreferences(); }} />
          </div>
        {/each}
      </div>
      <div class="switches">
        {#each switches as setting}
          <label class="switch-option"><span>{setting.label}</span><span class="switch-control">
            <input type="checkbox" bind:checked={preferences[setting.key]} onchange={savePreferences} /><span aria-hidden="true"></span>
          </span></label>
        {/each}
      </div>
    </fieldset>
  </details>
  <details class="assistant-details">
    <summary>Tools and skills<MaterialIcon name="chevron_forward" size={16} /></summary>
    <p>Reads cover catalogs, operation schemas, settings, saved workflows and current ports. Workspace edits add operations, move nodes and connect ports. Changes use normal save history and Undo.</p>
    <p>Operation execution and credentials are unavailable to the assistant.</p>
    <ul>{#each enabledAssistantTools(preferences) as tool}<li><strong>{tool.name}</strong> — {tool.description}</li>{/each}</ul>
    <ul>{#each assistantSkills as skill}<li><strong>{skill.name}</strong> — {skill.description}</li>{/each}</ul>
  </details>
  <details class="assistant-details">
    <summary>Compatibility and model details<MaterialIcon name="chevron_forward" size={16} /></summary>
    {#if compatibility}<p>{compatibility.summary} {compatibility.detail}</p><p>FP32: {compatibility.fp32 ? "verified" : "unavailable"} · FP16: {compatibility.fp16 ? "verified" : "unavailable"}</p><p>{compatibility.adapter}</p>{/if}
    <p>{(model.bytes / 1e9).toFixed(2)} GB download · WebGPU · language and vision</p>
    <p>GPU only; no CPU fallback. Free RAM and VRAM are not exposed by browsers. Download size is not a measured memory requirement. Mobile and tablet inference are not qualified.</p>
    <p>These pinned Bonsai 2B, 4B and 9B profiles passed recorded text, tool and skill checks, but failed the OCR card checks. Image support does not imply reliable text extraction.</p>
    <p>Model: {model.model}<br />Revision: {model.revision}<br />Evidence: {model.run}<br />Runtime: WebML · Pi 1.3.0</p>
    <p>Runtime and model files load from Hugging Face when requested. Inference and application tool data stay in this browser. Chat lasts for this tab; a new model load starts a new conversation.</p>
  </details>

  </div>
</section>

<style>
  .assistant-settings { padding: 16px 0; display: grid; gap: 12px; min-width: 0; container-type: inline-size; color: var(--color-foreground); font-size: 12px; }
  .assistant-details { padding: 12px; border-radius: 4px; background: var(--color-surface); min-width: 0; }
  .assistant-configuration { display: grid; gap: 12px; min-width: 0; }
  .assistant-configuration[hidden] { display: none; }
  .assistant-chat { min-width: 0; }
  .composer { padding: 0; border: 2px solid var(--color-muted); border-radius: 4px; background: var(--color-background); min-width: 0; overflow: clip; }
  .composer-header, .composer-toolbar { display: flex; align-items: center; gap: 6px; padding: 3px 6px; background: var(--color-surface); }
  .composer-header { border-bottom: 1px solid var(--color-muted); }
  .model-picker { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; padding-left: 6px; }
  .model-picker :global(.field-select-trigger) { width: auto; min-height: 32px; padding: 4px 0; gap: 4px; background: transparent; color: var(--color-foreground); font-size: 11px; }
  .model-picker :global(.field-select-value) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  :global(.field-select-content[aria-label="Local model"]) { width: max-content; min-width: var(--bits-select-anchor-width); max-width: calc(100vw - 24px); }
  :global(.field-select-content[aria-label="Local model"] .field-select-option-label) { white-space: nowrap; }
  .context-window { color: var(--color-muted-foreground); font-size: 10px; white-space: nowrap; }
  .model-actions, .composer-tools { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
  .composer-toolbar { justify-content: space-between; flex-wrap: wrap; border-top: 1px solid var(--color-muted); }
  .composer-tools { margin-left: auto; }
  .assistant-settings :global(.composer-action) { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 30px; min-height: 32px; padding: 4px 6px; border: 0; border-radius: 4px; background: transparent; color: var(--color-foreground); font-size: 11px; font-weight: 600; cursor: pointer; }
  .assistant-settings :global(.composer-action:disabled) { color: var(--color-muted-foreground); cursor: default; }
  .assistant-settings :global(.recording) { background: var(--color-error-background); color: var(--color-error-foreground); }
  .composer :global(:focus-visible:not(textarea)) { outline-offset: -2px; }
  .image-preparing { padding: 0 10px; }
  label, summary { font-weight: 700; }
  summary { display: flex; align-items: center; gap: 8px; min-height: 24px; cursor: pointer; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary :global(.material-symbols-rounded) { margin-left: auto; }
  details[open] > summary :global(.material-symbols-rounded) { transform: rotate(90deg); }
  p { margin: 8px 0; line-height: 1.6; overflow-wrap: anywhere; }
  .status { margin: 0; color: var(--color-muted-foreground); }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  .options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
  .option { display: grid; gap: 8px; padding: 10px; border-radius: 4px; min-width: 0; background: var(--color-background); }
  .option input { width: 100%; min-width: 0; padding: 8px; border-radius: 4px; background: var(--color-muted); }
  .switches { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
  .switch-option { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 10px; border-radius: 4px; background: var(--color-background); cursor: pointer; }
  .switch-option:has(:disabled) { opacity: 0.5; cursor: default; }
  .switch-option:has(:focus-visible) { outline: 2px solid var(--color-ring); outline-offset: 2px; }
  .switch-control { position: relative; flex-shrink: 0; width: 40px; height: 24px; padding: 3px; border-radius: 4px; background: var(--color-muted-foreground); }
  .switch-control input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: inherit; }
  .switch-control > span { display: block; width: 18px; height: 18px; border-radius: 2px; pointer-events: none; background: var(--color-surface); }
  .switch-control:has(:checked) { background: var(--color-catalog-active); }
  .switch-control:has(:checked) > span { transform: translateX(16px); background: var(--color-catalog-active-foreground); }
  button { min-height: 36px; padding: 6px 12px; border: 0; border-radius: 4px; background: var(--color-primary); color: var(--color-primary-foreground); font-size: 12px; font-weight: 700; cursor: pointer; }
  button.secondary { background: var(--color-muted); color: var(--color-foreground); }
  button:disabled { opacity: 0.5; cursor: default; }
  .error { margin: 0; padding: 12px; border-radius: 4px; background: var(--color-error-background); color: var(--color-error-foreground); }
  ul { margin: 12px 0 0; padding-left: 18px; }
  li { margin: 6px 0; line-height: 1.5; overflow-wrap: anywhere; }
  .conversation { height: clamp(160px, 24dvh, 320px); overflow-y: auto; overscroll-behavior: contain; padding: 10px; border-radius: 4px; background: var(--color-background); }
  .conversation:not(.empty) { margin-bottom: 12px; }
  .conversation.empty { height: 0; padding: 0; }
  article { margin: 0 0 10px; padding: 12px; border-radius: 4px; background: var(--color-surface); overflow-wrap: anywhere; }
  article > strong { display: block; color: var(--color-emphasis); margin-bottom: 8px; }
  article.user { background: var(--color-muted); }
  article.tool { border-left: 2px solid var(--color-emphasis); }
  article.failed { border-color: var(--color-error-foreground); }
  .tool-result summary { min-height: 24px; }
  .tool-result summary > span:first-child { min-width: 0; overflow-wrap: anywhere; }
  .tool-state { margin-left: auto; color: var(--color-muted-foreground); font-weight: 400; }
  .tool-result summary :global(.material-symbols-rounded) { margin-left: 0; }
  article.failed .tool-state { color: var(--color-error-foreground); }
  details > pre { margin-top: 10px; }
  .image-note { display: flex; align-items: center; gap: 6px; color: var(--color-muted-foreground); }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; margin: 0; }
  textarea { width: 100%; padding: 10px; resize: none; overflow: hidden; min-height: 80px; display: block; border: 0; border-radius: 0; background: var(--color-background); font: inherit; }
  .attachment { display: flex; align-items: center; gap: 12px; padding: 8px 10px; }
  .attachment img { max-width: 120px; max-height: 100px; }
  @container (max-width: 280px) { .context-window, .attach-label { display: none; } }
  @container (max-width: 430px) { .options, .switches { grid-template-columns: 1fr; } }
  @media (prefers-reduced-motion: no-preference) {
    summary :global(.material-symbols-rounded), .switch-control, .switch-control > span { transition: transform 180ms ease-in, background-color 180ms ease-in; }
  }
</style>
