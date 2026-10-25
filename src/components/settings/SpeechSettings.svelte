<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import FieldSelect from "$lib/components/FieldSelect.svelte";
  import MaterialIcon from "$lib/components/MaterialIcon.svelte";
  import { SpeechController, type SpeechState, type Dictation, type Recording } from "$lib/speech/controller.js";
  import { speechProfiles } from "$lib/speech/config.js";
  import { compare } from "$lib/speech/diagnostics.js";
  import { clearSpeechCache, deleteRecordings, saveRecording } from "$lib/speech/storage.js";
  let { visible = true, onDictation, onActivity }: { visible?: boolean; onDictation: (text: Dictation) => void; onActivity: (state: { ready: boolean; busy: boolean; recording: boolean }) => void } = $props();
  let speechState = $state<SpeechState>({ phase: "unloaded", status: "", error: "", provisional: "", storageError: "", seconds: 0 });
  let records = $state.raw<Recording[]>([]);
  let selectedId = $state("");
  let playback = $state("");
  let localError = $state("");
  let storageBusy = $state(false);
  let audioInput: HTMLInputElement;
  let opened = $state(false);
  let panel: HTMLDetailsElement;
  export async function toggleDictation() {
    opened = true;
    if (speechState.phase === "recording" || speechState.phase === "requesting") await controller.stopRecording();
    else if (speechState.phase === "ready" && !storageBusy) await controller.startRecording();
    else {
      await tick();
      panel.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    }
  }
  const controller = new SpeechController({ state: value => { speechState = value; }, text: value => onDictation(value),
    recordings: value => { records = value; if (!selectedId && value[0]) selectedId = value[0].id; } });
  let preferences = $state({ ...controller.preferences });
  const loaded = $derived(speechState.phase !== "unloaded");
  const busy = $derived(["requesting", "recording", "finalizing"].includes(speechState.phase));
  const profile = $derived(speechProfiles.find(p => p.value === preferences.mode)!);
  const selected = $derived(records.find(record => record.id === selectedId));
  const transcript = $derived(selected?.final?.text || selected?.partials.at(-1)?.text || "");
  const comparison = $derived(selected?.expected && selected.final ? compare(selected.expected, selected.final.text) : null);
  $effect(() => { onActivity({ ready: speechState.phase === "ready" || busy, busy, recording: speechState.phase === "recording" || speechState.phase === "requesting" }); });
  $effect(() => { if (!visible) controller.hidden(); });
  $effect(() => { if (!opened) controller.hidden(); });
  let restored = false;
  $effect(() => {
    if (visible && !restored) {
      restored = true;
      if (preferences.restore && preferences.loaded) { opened = true; controller.load(); }
    }
  });
  $effect(() => {
    if (selected?.audio) {
      const url = URL.createObjectURL(selected.audio); playback = url;
      return () => URL.revokeObjectURL(url);
    }
    playback = "";
  });
  function preference(value: Partial<typeof preferences>) { controller.preferencesChanged(value); preferences = { ...controller.preferences }; }
  function visibility() { if (document.hidden) controller.hidden(); }
  document.addEventListener("visibilitychange", visibility);
  onDestroy(() => { document.removeEventListener("visibilitychange", visibility); controller.destroy(); });
  async function clearCache() {
    try { localError = ""; await clearSpeechCache(); } catch (error) { localError = error instanceof Error ? error.message : String(error); }
  }
  async function clearRecordings() {
    storageBusy = true;
    try { localError = ""; await controller.flushStorage(); await deleteRecordings(); selectedId = ""; await controller.refreshRecordings(); }
    catch (error) { localError = error instanceof Error ? error.message : String(error); }
    finally { storageBusy = false; }
  }
  async function reference(value: string) {
    if (!selected) return;
    const record = { ...selected, expected: value }; storageBusy = true;
    try { await controller.flushStorage(); await saveRecording(record); await controller.refreshRecordings(); }
    catch (error) { localError = error instanceof Error ? error.message : String(error); }
    finally { storageBusy = false; }
  }
  async function exportRecording() {
    if (!selected) return;
    try {
      const record = selected;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(record.audio);
      });
      const url = URL.createObjectURL(new Blob([JSON.stringify({ schema: 1, ...record, comparison,
        audio: { format: "mono IEEE float32 WAV", sampleRate: 16000, dataUrl } }, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `parakeet-debug-${record.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { localError = error instanceof Error ? error.message : String(error); }
  }
</script>

<details class="speech-settings" bind:this={panel} bind:open={opened}>
  <summary>Speech input<MaterialIcon name="chevron_forward" size={16} /></summary>
  <div class="speech-card">
    <label for="speech-profile">Parakeet TDT 0.6B v3</label>
    <FieldSelect id="speech-profile" label="Speech runtime" options={speechProfiles} includePlaceholder={false} value={preferences.mode} disabled={loaded}
      onValueChange={value => preference({ mode: value })} />
    <p>{(profile.bytes / 1e9).toFixed(2)} GB model download · {preferences.mode === "cpu" ? "CPU encoder and decoder" : "WebGPU encoder · INT8 CPU decoder"}</p>
    {#if preferences.mode === "gpu-fp32"}<p>Needs browser file storage and substantially more memory than the download size. Private browsing may have too little storage space.</p>{/if}
    <div class="speech-actions">
      {#if !loaded}
        <button type="button" onclick={() => controller.load()}>{speechState.error ? "Retry speech" : "Load speech"}</button>
        <button type="button" class="secondary" onclick={clearCache}>Clear speech cache</button>
      {:else}
        <button type="button" class="secondary" onclick={() => { controller.unload(); preferences = { ...controller.preferences }; }}>Unload speech</button>
      {/if}
      {#if speechState.phase === "recording" || speechState.phase === "requesting"}
        <button type="button" class="recording" onclick={() => void controller.stopRecording()}>{speechState.phase === "requesting" ? "Cancel microphone" : "Stop dictation"}</button>
      {:else}
        <button type="button" disabled={speechState.phase !== "ready" || storageBusy} onclick={() => void controller.startRecording()}><MaterialIcon name="mic" size={18} />Dictate</button>
        <button type="button" class="secondary" disabled={speechState.phase !== "ready" || storageBusy} onclick={() => audioInput.click()}>Choose audio</button>
      {/if}
      <input hidden aria-label="Transcribe audio file" type="file" accept="audio/*" disabled={speechState.phase !== "ready"} bind:this={audioInput}
        onchange={event => { void controller.file(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
    </div>
    <p class="status" role="status">{speechState.status}{busy ? ` · ${speechState.seconds.toFixed(1)}s` : ""}</p>
    {#if speechState.provisional}<p class="provisional" aria-label="Provisional transcript">{speechState.provisional}</p>{/if}
    {#if speechState.error}<p class="error" role="alert">{speechState.error}</p>{/if}
    {#if speechState.storageError}<p class="error" role="alert">{speechState.storageError}</p>{/if}
    {#if localError}<p class="error" role="alert">{localError}</p>{/if}
    <label class="switch"><span>Restore loaded speech when Assistant opens</span><input type="checkbox" checked={preferences.restore} onchange={event => preference({ restore: event.currentTarget.checked })} /></label>
    <label class="switch"><span>Refine the whole recording after Stop</span><input type="checkbox" disabled={busy} checked={preferences.refine} onchange={event => preference({ refine: event.currentTarget.checked })} /></label>
    <p>Speak for up to 55 seconds, or choose audio up to 60 seconds and 10 MiB. Confirmed text is added to your draft. Send it when you are ready.</p>
    <p>Closing Assistant or hiding this page stops the microphone. Short or quiet speech can be missed or misheard. WebGPU startup varies by browser and device; CPU is available as an explicit choice.</p>
  </div>
  <details class="diagnostics">
    <summary>Local speech diagnostics<MaterialIcon name="chevron_forward" size={16} /></summary>
    <p>The latest 20 recordings, transcripts and diagnostics are saved in this browser. Nothing is uploaded. Export only when you want to share a capture.</p>
    {#if records.length}
      <FieldSelect id="speech-recordings" label="Saved speech recordings" includePlaceholder={false}
        options={records.map(record => ({ value: record.id, label: `${new Date(record.created).toLocaleString()} · ${record.status}` }))} value={selectedId} onValueChange={value => selectedId = value} />
      {#if selected}
        {#if playback}<audio aria-label="Saved speech recording" controls src={playback}><track kind="captions" /></audio>{/if}
        <p class="transcript">{transcript || "No transcript."}</p>
        <label for="speech-reference">What you said (optional)</label>
        <textarea id="speech-reference" rows="2" maxlength="4000" value={selected.expected} disabled={busy} onchange={event => void reference(event.currentTarget.value)}></textarea>
        {#if comparison}<p>{comparison.substitutions} changed · {comparison.deletions} omitted · {comparison.insertions} extra words · {comparison.wer === null ? "No reference words" : `${(comparison.wer * 100).toFixed(1)}% word error rate`} (ignoring case and punctuation).</p>{/if}
        <details><summary>Capture details<MaterialIcon name="chevron_forward" size={16} /></summary><pre>{JSON.stringify({ ...selected, audio: undefined }, null, 2)}</pre></details>
        <div class="speech-actions"><button type="button" class="secondary" disabled={storageBusy} onclick={exportRecording}>Export recording and diagnostics</button></div>
      {/if}
      <button type="button" class="secondary" disabled={busy || storageBusy} onclick={clearRecordings}>Delete saved recordings</button>
    {:else}<p>No saved recordings.</p>{/if}
  </details>
</details>

<style>
  .speech-settings { border-radius: 4px; background: var(--color-surface); padding: 12px; }
  summary { display: flex; align-items: center; justify-content: space-between; cursor: pointer; font-weight: 700; min-height: 32px; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary :global(.material-symbols-rounded) { transition: transform 120ms; }
  details[open] > summary :global(.material-symbols-rounded) { transform: rotate(90deg); }
  .speech-card { --field-background: var(--color-background); --field-foreground: var(--color-foreground); }
  .speech-card, .diagnostics { margin-top: 10px; display: grid; gap: 10px; }
  .diagnostics:not([open]) { display: block; }
  label { font-size: 12px; font-weight: 700; }
  p { font-size: 12px; margin: 0; line-height: 1.5; color: var(--color-muted-foreground); }
  .speech-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  button { min-height: 44px; padding: 8px 12px; border-radius: 4px; background: var(--color-primary); color: var(--color-primary-foreground); font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; }
  button.secondary { background: var(--color-muted); color: var(--color-foreground); }
  button:disabled { opacity: .45; cursor: default; }
  button.recording { background: var(--color-error-background); color: var(--color-error-foreground); }
  .error { padding: 10px; border-radius: 4px; color: var(--color-error-foreground); background: var(--color-error-background); overflow-wrap: anywhere; }
  .provisional { font-style: italic; }
  .transcript { white-space: pre-wrap; color: var(--color-foreground); }
  .switch { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 44px; cursor: pointer; font-size: 12px; }
  .switch input { appearance: none; width: 40px; min-width: 40px; height: 24px; border-radius: 4px; background: var(--color-muted-foreground); padding: 3px; cursor: pointer; }
  .switch input::before { content: ""; display: block; width: 18px; height: 18px; background: var(--color-background); border-radius: 2px; transition: transform 120ms; }
  .switch input:checked { background: var(--color-catalog-active); }
  .switch input:checked::before { transform: translateX(16px); background: var(--color-catalog-active-foreground); }
  .switch input:disabled { opacity: .45; cursor: default; }
  audio, textarea { width: 100%; min-width: 0; }
  textarea { padding: 8px; border-radius: 4px; background: var(--color-background); resize: vertical; }
  pre { max-height: 240px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
</style>
