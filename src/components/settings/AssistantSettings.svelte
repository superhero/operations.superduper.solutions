<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import FieldSelect from "$lib/components/FieldSelect.svelte";
  import FieldInteger from "$lib/components/FieldInteger.svelte";
  import WorkflowCommentPreview from "../workflows/WorkflowCommentPreview.svelte";
  import { assistantSettingsKey, bonsaiModels, defaultAssistantSettings, validateAssistantSettings, type AssistantSettings as Preferences } from "$lib/assistant/config.ts";
  import { enabledAssistantTools, executeAssistantTool, type AssistantHost } from "$lib/assistant/tools.ts";
  import { assistantSkills } from "$lib/assistant/skills.ts";
  import type { AssistantCompatibility } from "$lib/assistant/compatibility.ts";
  import type { AssistantMessageView } from "$lib/assistant/pi-session.ts";
  import InferenceWorker from "$lib/assistant/inference.worker.ts?worker&inline";
  import { trackApplicationWorker } from "$lib/application-workers.ts";

  let { host }: { host: AssistantHost } = $props();
  let preferenceError = $state("");
  function readPreferences() {
    try { return validateAssistantSettings(JSON.parse(localStorage.getItem(assistantSettingsKey) ?? "{}")); }
    catch { preferenceError = "Saved assistant preferences could not be read. Using defaults for this session."; return { ...defaultAssistantSettings }; }
  }
  let preferences = $state<Preferences>(readPreferences());
  let phase = $state<"unloaded" | "checking" | "loading" | "ready" | "generating">("unloaded");
  const busy = $derived(["checking", "loading", "generating"].includes(phase));
  const locked = $derived(phase !== "unloaded");
  let status = $state("Load a model to start a local conversation.");
  let error = $state("");
  let compatibility = $state<AssistantCompatibility>();
  let messages = $state.raw<AssistantMessageView[]>([]);
  let prompt = $state("");
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
    catch (failure) { preferenceError = failure instanceof Error ? failure.message : String(failure); }
  }
  function terminate() {
    clearTimeout(timer); timer = undefined; toolAbort.abort();
    worker?.terminate(); worker = undefined; release?.(); release = undefined;
  }
  function stop() {
    terminate(); phase = "unloaded";
    status = "Model unloaded. Load a model to start a new conversation.";
  }
  function failure(message: string) { terminate(); phase = "unloaded"; error = message; status = "The assistant stopped. Load a model to try again."; }
  function deadline(ms: number) {
    clearTimeout(timer); timer = setTimeout(() => failure("Assistant deadline reached; the model was unloaded."), ms);
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
        const atBottom = !conversation || conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 50;
        messages = message.messages; error = message.error;
        if (atBottom) void tick().then(() => { if (alive && conversation) conversation.scrollTop = conversation.scrollHeight; });
      } else if (message.type === "done") { clearTimeout(timer); phase = "ready"; status = "Ready for your next message."; }
      else if (message.type === "error") failure(message.message);
      else if (message.type === "tool") {
        const signal = toolAbort.signal;
        void executeAssistantTool(host, loadedSettings, message.name, message.args, signal).then(value => {
          if (worker === instance && !signal.aborted) instance.postMessage({ type: "tool_result", id: message.id, value });
        }, failure => {
          if (worker === instance && !signal.aborted) instance.postMessage({ type: "tool_result", id: message.id, error: failure instanceof Error ? failure.message : String(failure) });
        });
      }
    };
    instance.onerror = event => { if (worker === instance) { event.preventDefault(); failure(event.message || "The inference worker stopped unexpectedly."); } };
    instance.onmessageerror = () => { if (worker === instance) failure("Could not read the assistant worker's response."); };
    return instance;
  }
  function check() {
    if (locked) return;
    error = ""; phase = "checking"; status = "Checking browser GPU computation…";
    try { deadline(20000); startWorker().postMessage({ type: "check" }); }
    catch (problem) { failure(problem instanceof Error ? problem.message : String(problem)); }
  }
  function load() {
    if (locked) return;
    try {
      loadedSettings = validateAssistantSettings(preferences); savePreferences();
      error = ""; messages = []; phase = "loading"; status = "Checking WebGPU and loading model…";
      deadline(loadedSettings.loadTimeout + 20000); startWorker().postMessage({ type: "load", settings: loadedSettings });
    } catch (problem) { failure(problem instanceof Error ? problem.message : String(problem)); }
  }
  function send() {
    if (phase !== "ready" || imagePreparing || (!prompt.trim() && !attachment)) return;
    phase = "generating"; error = ""; status = "The assistant is working…";
    toolAbort.abort(); toolAbort = new AbortController();
    deadline(loadedSettings.requestTimeout + 2000);
    worker!.postMessage({ type: "send", text: prompt, images: attachment ? [{ type: "image", ...attachment }] : [] });
    prompt = ""; attachment = null; if (imageInput) imageInput.value = "";
  }
  function reset() {
    if (phase !== "ready") return;
    phase = "generating"; error = ""; prompt = ""; attachment = null; if (imageInput) imageInput.value = ""; deadline(10000); worker!.postMessage({ type: "reset" });
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
    } catch (problem) { if (alive && generation === imageGeneration) error = problem instanceof Error ? problem.message : String(problem); }
    finally { if (alive && generation === imageGeneration) imagePreparing = false; }
  }
  onDestroy(() => { alive = false; imageGeneration++; terminate(); });
</script>

<section class="assistant-settings" aria-label="Browser assistant">
  <div class="model-card">
    <label for="assistant-model">Local model</label>
    <FieldSelect id="assistant-model" label="Local model" options={modelOptions} includePlaceholder={false} value={preferences.model} disabled={locked}
      onValueChange={value => { preferences.model = value; savePreferences(); }} />
    <p>{(model.bytes / 1e9).toFixed(2)} GB download · WebGPU · language and vision</p>
    <div class="actions">
      <button type="button" disabled={locked} onclick={load}>Load model</button>
      <button type="button" class="secondary" disabled={locked} onclick={check}>Check compatibility</button>
      {#if locked}<button type="button" class="secondary" onclick={stop}>{busy ? "Stop and unload" : "Unload model"}</button>{/if}
    </div>
    <p class="status" role="status">{status}</p>
  </div>
  <details class="assistant-details">
    <summary>Configuration</summary>
    <p>Unload the model to change configuration. Preferences are saved on this browser.</p>
    <fieldset disabled={locked} aria-label="Assistant configuration">
      <div class="options">
        {#each integers as setting}
          <div class="option"><label for={`assistant-${setting.key}`}>{setting.label}</label>
            <FieldInteger id={`assistant-${setting.key}`} label={setting.label} value={String(preferences[setting.key])} minimum={setting.minimum} maximum={setting.maximum} disabled={locked}
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
        {#each switches as setting}<label><input type="checkbox" bind:checked={preferences[setting.key]} onchange={savePreferences} />{setting.label}</label>{/each}
      </div>
    </fieldset>
  </details>
  <details class="assistant-details">
    <summary>Tools and skills</summary>
    <p>Reads cover catalogs, operation schemas, settings, saved workflows and current ports. Workspace edits add operations, move nodes and connect ports. Changes use normal save history and Undo.</p>
    <p>Operation execution and credentials are unavailable to the assistant.</p>
    <ul>{#each enabledAssistantTools(preferences) as tool}<li><strong>{tool.name}</strong> — {tool.description}</li>{/each}</ul>
    <ul>{#each assistantSkills as skill}<li><strong>{skill.name}</strong> — {skill.description}</li>{/each}</ul>
  </details>
  <details class="assistant-details">
    <summary>Compatibility and model details</summary>
    {#if compatibility}<p>{compatibility.summary} {compatibility.detail}</p><p>FP32: {compatibility.fp32 ? "verified" : "unavailable"} · FP16: {compatibility.fp16 ? "verified" : "unavailable"}</p><p>{compatibility.adapter}</p>{/if}
    <p>GPU only; no CPU fallback. Free RAM and VRAM are not exposed by browsers. Download size is not a measured memory requirement. Mobile and tablet inference are not qualified.</p>
    <p>These pinned Bonsai 2B, 4B and 9B profiles passed recorded text, tool and skill checks, but failed the OCR card checks. Image support does not imply reliable text extraction.</p>
    <p>Model: {model.model}<br />Revision: {model.revision}<br />Evidence: {model.run}<br />Runtime: WebML · Pi 1.3.0</p>
    <p>Runtime and model files load from Hugging Face when requested. Inference and application tool data stay in this browser. Chat lasts for this tab; a new model load starts a new conversation.</p>
  </details>
  {#if preferenceError}<p class="error" role="alert">{preferenceError}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable conversation needs keyboard focus.) -->
  <div class="conversation" role="log" aria-label="Assistant conversation" aria-live="off" bind:this={conversation} tabindex="0">
    {#if !messages.length}<p class="empty">Ask about an operation, explore a schema, or ask the assistant to arrange and connect your workspace.</p>{/if}
    {#each messages as message, index}
      <article class:user={message.role === "user"} class:tool={message.role === "tool"} class:failed={message.failed}>
        <strong>{message.role === "user" ? "You" : message.role === "tool" ? message.tool : "Bonsai"}</strong>
        {#if message.thinking}<details><summary>Reasoning</summary><pre>{message.thinking}</pre></details>{/if}
        {#if message.role === "assistant"}<WorkflowCommentPreview text={message.text} scope={`assistant-${index}`} allowImages={false} />{:else}<pre>{message.text}</pre>{/if}
      </article>
    {/each}
  </div>
  <form onsubmit={event => { event.preventDefault(); send(); }}>
    <label for="assistant-message">Message</label>
    <textarea id="assistant-message" rows="3" maxlength="16000" bind:value={prompt} disabled={phase !== "ready"} placeholder="Ask about your workspace…"
      onkeydown={event => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); } }}></textarea>
    {#if attachment}<div class="attachment"><img alt="Attachment ready to send" src={`data:${attachment.mimeType};base64,${attachment.data}`} /><button type="button" class="secondary" disabled={busy} onclick={() => { attachment = null; imageInput.value = ""; }}>Remove image</button></div>{/if}
    <div class="actions">
      <button type="submit" disabled={phase !== "ready" || imagePreparing || (!prompt.trim() && !attachment)}>Send message</button>
      <button type="button" class="secondary" disabled={phase !== "ready"} onclick={reset}>New conversation</button>
      <label class="attach">Attach image<input aria-label="Attach assistant image" type="file" accept="image/png,image/jpeg,image/webp" disabled={phase !== "ready" || imagePreparing} bind:this={imageInput} onchange={event => void prepareImage(event.currentTarget.files?.[0])} /></label>
    </div>
  </form>
</section>

<style>
  .assistant-settings { padding: 16px; display: grid; gap: 12px; min-width: 0; container-type: inline-size; color: var(--color-foreground); font-size: 12px; }
  .model-card, .assistant-details, form { padding: 12px; border-radius: 4px; background: var(--color-surface); min-width: 0; }
  .model-card { display: grid; gap: 8px; --field-background: var(--color-background); --field-foreground: var(--color-foreground); }
  label, summary { font-weight: 700; }
  summary { cursor: pointer; }
  p { margin: 8px 0; line-height: 1.6; overflow-wrap: anywhere; }
  .model-card p { margin: 0; }
  .status { color: var(--color-muted-foreground); }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  .options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
  .option { display: grid; gap: 8px; padding: 10px; border-radius: 4px; min-width: 0; background: var(--color-background); }
  .option input { width: 100%; min-width: 0; padding: 8px; border-radius: 4px; background: var(--color-muted); }
  .switches { display: flex; flex-wrap: wrap; gap: 12px 20px; margin-top: 12px; }
  .switches label { display: flex; align-items: center; gap: 6px; }
  input[type="checkbox"] { accent-color: var(--color-emphasis); }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  button { padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-primary); color: var(--color-primary-foreground); font-size: 12px; font-weight: 700; }
  button.secondary { background: var(--color-muted); color: var(--color-foreground); }
  button:disabled { opacity: 0.5; cursor: default; }
  .error { margin: 0; padding: 12px; border-radius: 4px; background: var(--color-error-background); color: var(--color-error-foreground); }
  ul { margin: 12px 0 0; padding-left: 18px; }
  li { margin: 6px 0; line-height: 1.5; overflow-wrap: anywhere; }
  .conversation { min-height: 180px; max-height: 480px; overflow-y: auto; overscroll-behavior: contain; padding: 10px; border-radius: 4px; background: var(--color-background); }
  .empty { color: var(--color-muted-foreground); padding: 12px; }
  article { margin: 0 0 10px; padding: 12px; border-radius: 4px; background: var(--color-surface); overflow-wrap: anywhere; }
  article > strong { display: block; color: var(--color-emphasis); margin-bottom: 8px; }
  article.user { background: var(--color-muted); }
  article.tool { border-left: 2px solid var(--color-emphasis); }
  article.failed { border-color: var(--color-error-foreground); }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; margin: 0; }
  form { display: grid; gap: 10px; }
  textarea { width: 100%; padding: 10px; resize: vertical; min-height: 80px; max-height: 400px; border-radius: 4px; background: var(--color-background); font: inherit; }
  .attach { min-width: 0; display: grid; gap: 6px; }
  .attach input { max-width: 100%; font-size: 11px; }
  .attachment { display: flex; align-items: center; gap: 12px; }
  .attachment img { max-width: 120px; max-height: 100px; }
  @container (max-width: 430px) { .options { grid-template-columns: 1fr; } }
</style>
