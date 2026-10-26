<!-- Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import {onDestroy} from 'svelte';
  import FieldSelect from '$lib/components/FieldSelect.svelte';
  import HintButton from '$lib/components/HintButton.svelte';
  import MaterialIcon from '$lib/components/MaterialIcon.svelte';
  import {decisionModels, decisionProfile, validateDecisionRequest, type DecisionRequest, type DecisionResult} from '$lib/assistant/decision-models.ts';
  import DecisionWorker from '$lib/assistant/decision.worker.ts?worker&inline';
  import {trackApplicationWorker} from '$lib/application-workers.ts';
  import {decodeError} from '$lib/worker-rpc.ts';
  import {logger} from '$lib/logger.ts';
  let {languageActive = false, speechBusy = false, onActivity = (_active: boolean, _busy: boolean) => {}}: {languageActive?: boolean; speechBusy?: boolean; onActivity?: (active: boolean, busy: boolean) => void} = $props();
  let selected = $state('d3-lite'), phase = $state<'unloaded' | 'checking' | 'loading' | 'ready' | 'deciding'>('unloaded');
  let decisionState = $state('The status card is blue.'), question = $state('Is the status card blue?'), kind = $state('noul');
  let criteria = $state('translate: Translate between languages\nsummarize: Shorten a document\ncode: Write software');
  let status = $state(''), error = $state(''), result = $state<DecisionResult | null>(null);
  let worker: Worker | undefined, release: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const profile = $derived(decisionProfile(selected));
  const working = $derived(['checking', 'loading', 'deciding'].includes(phase));
  $effect(() => onActivity(phase !== 'unloaded', working));
  function terminate() {clearTimeout(timer); worker?.terminate(); release?.(); worker = undefined; release = undefined;}
  function unload() {terminate(); phase = 'unloaded'; result = null; status = 'Decision model unloaded.';}
  function fail(value: unknown) {
    const native = value instanceof Error ? value : new Error(String(value));
    logger.scope('assistant').scope('decision').error(native);
    error = native.message; terminate(); phase = 'unloaded';
  }
  function start(type: 'check' | 'load') {
    if (languageActive || speechBusy || phase !== 'unloaded') return;
    error = ''; result = null; phase = type === 'check' ? 'checking' : 'loading';
    status = type === 'check' ? 'Checking decision runtime requirements…' : 'Loading the selected native decision model…';
    const instance = new DecisionWorker({name: 'operations-native-decision'});
    worker = instance; release = trackApplicationWorker(instance, {reportErrors: false});
    timer = setTimeout(() => fail(new Error('Decision runtime operation timed out.')), type === 'check' ? 25000 : profile.settings.load_timeout_ms + 20000);
    instance.onmessage = ({data}) => {
      if (worker !== instance) return;
      if (data.type === 'compatibility') {
        status = data.value.summary;
        if (phase === 'checking') {terminate(); phase = 'unloaded';}
      } else if (data.type === 'progress') status = String(data.value.message ?? data.value.phase ?? 'Loading native model…');
      else if (data.type === 'ready') {clearTimeout(timer); phase = 'ready'; status = 'Ready for an explicit local decision.';}
      else if (data.type === 'result') {clearTimeout(timer); result = data.value; phase = 'ready'; status = 'Native decision complete.';}
      else if (data.type === 'error') {
        const native = decodeError(data.error);
        if (phase === 'deciding' && native.name === 'InputPreflightError') {clearTimeout(timer); error = native.message; phase = 'ready';}
        else fail(native);
      }
    };
    instance.onerror = event => fail(event.error ?? new Error(event.message || 'Decision worker failed.'));
    instance.onmessageerror = () => fail(new Error('Could not read the decision worker response.'));
    instance.postMessage({type, profile: selected, assetBase: new URL('./assistant-runtime/', document.baseURI).href});
  }
  function select(value: string) {if (languageActive || speechBusy || phase !== 'unloaded') return; selected = value; start('load');}
  function decide() {
    if (phase !== 'ready' || speechBusy) return;
    try {
      const q: DecisionRequest['questions']['q'] = {type: kind as DecisionRequest['questions']['q']['type'], instructions: question};
      const lines = criteria.split('\n').map(line => line.trim()).filter(Boolean);
      if (kind === 'score') q.criteria = lines;
      else if (kind === 'choice') {
        const pairs = lines.map(line => {const colon = line.indexOf(':'); if (colon < 1) throw new Error('Use label: description on each choice line.'); return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()] as const;});
        if (new Set(pairs.map(([label]) => label)).size !== pairs.length) throw new Error('Choice labels must be unique.');
        q.criteria = Object.fromEntries(pairs);
      }
      const request = validateDecisionRequest({state: decisionState, questions: {q}});
      error = ''; result = null; phase = 'deciding'; status = 'Computing native decision scores…';
      timer = setTimeout(() => fail(new Error('Native decision timed out; the model was unloaded.')), profile.settings.decision_timeout_ms + 2000);
      worker!.postMessage({type: 'decide', request});
    } catch (problem) {error = problem instanceof Error ? problem.message : String(problem);}
  }
  onDestroy(() => {terminate(); onActivity(false, false);});
</script>

<details class="decision-settings">
  <summary>Decision models<MaterialIcon name="chevron_forward" size={16} /></summary>
  <p>Score a state against an explicit question. These models do not write chat replies or run workflows.</p>
  {#if speechBusy}<p>Stop dictation before computing a decision.</p>{/if}
  {#if languageActive}<p>Unload the language model to use a decision model.</p>{/if}
  <FieldSelect id="decision-model" label="Decision model" options={decisionModels.map(model => ({value: model.id, label: model.label}))}
    value={selected} includePlaceholder={false} disabled={languageActive || speechBusy || phase !== 'unloaded'} onValueChange={select} onReselect={select} />
  <div class="decision-actions">
    {#if phase === 'unloaded'}
      <HintButton type="button" class="decision-action" label="Check decision compatibility" disabled={languageActive || speechBusy} onclick={() => start('check')}><MaterialIcon name="fact_check" size={18} /></HintButton>
    {:else}
      <HintButton type="button" class="decision-action" label={working ? 'Stop decision model' : 'Unload decision model'} onclick={unload}><MaterialIcon name="power_settings_new" size={18} /></HintButton>
    {/if}
    <span class="runtime-label">{profile.engine === 'strands-onnx' ? (profile.browser_probe.device === 'wasm' ? 'CPU' : 'WebGPU') : 'Native GPU'} · 1024 input tokens</span>
  </div>
  {#if status}<p role="status">{status}</p>{/if}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <fieldset disabled={phase !== 'ready' || speechBusy}>
    <label for="decision-state">State</label><textarea id="decision-state" rows="3" maxlength="56000" bind:value={decisionState}></textarea>
    <label for="decision-question">Question</label><input id="decision-question" maxlength="4000" bind:value={question} />
    <FieldSelect id="decision-kind" label="Answer kind" value={kind} options={[{value:'noul',label:'Yes / no'},{value:'choice',label:'Choose a label'},{value:'score',label:'Ordered score'}]}
      disabled={phase !== 'ready'} onValueChange={value => kind = value} />
    {#if kind !== 'noul'}<label for="decision-criteria">{kind === 'choice' ? 'Choices (label: description, one per line)' : 'Score levels (lowest first, one per line)'}</label><textarea id="decision-criteria" rows="4" bind:value={criteria}></textarea>{/if}
    <button type="button" onclick={decide}>Score decision</button>
  </fieldset>
  {#if result}
    <div class="decision-result" role="region" aria-label="Decision result" aria-live="polite">
      <p><strong>{profile.label}</strong></p>
      <dl>{#each Object.entries(result.answers.q.probabilities) as [label, probability]}<dt>{label}</dt><dd>{probability.toLocaleString(undefined, {maximumSignificantDigits: 7})}</dd>{/each}</dl>
      {#if result.answers.q.confidence !== undefined}<p>Native confidence: {result.answers.q.confidence}</p>{/if}
      <p>Confidence has a different meaning in each model family.</p>
      <details><summary>Native result</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
    </div>
  {/if}
</details>
<style>
  .decision-settings {padding:12px;background:var(--color-surface);border-radius:4px;min-width:0;}
  summary {display:flex;align-items:center;gap:8px;font-weight:700;cursor:pointer;list-style:none;}
  summary :global(.material-symbols-rounded) {margin-left:auto;}
  details[open]>summary :global(.material-symbols-rounded) {transform:rotate(90deg);}
  .decision-actions {display:flex;align-items:center;gap:8px;margin-top:8px;}
  .runtime-label,p {font-size:12px;line-height:1.5;}
  fieldset {display:grid;gap:8px;margin:12px 0 0;min-width:0;border:0;padding:0;}
  label {font-weight:700;}
  input,textarea {width:100%;min-width:0;padding:8px;border:0;border-radius:4px;background:var(--color-background);color:var(--color-foreground);font:inherit;}
  button {justify-self:start;min-height:32px;padding:4px 8px;border:0;border-radius:4px;background:var(--color-primary);color:var(--color-primary-foreground);font:inherit;font-weight:700;}
  .error {padding:8px;background:var(--color-error-background);color:var(--color-error-foreground);}
  dl {display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;} dd {margin:0;}
  pre {max-height:320px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;}
</style>
