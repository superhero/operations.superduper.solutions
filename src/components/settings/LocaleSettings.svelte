<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import FieldSelect from "$lib/components/FieldSelect.svelte";
  import { formatDateTime, getTimeZoneOptions, type LocaleSettings } from "$lib/locale-settings.ts";

  let { value, onValueChange, error = "", onRetry }: {
    value: LocaleSettings;
    onValueChange: (next: LocaleSettings) => void;
    error?: string;
    onRetry?: () => void;
  } = $props();

  const dateOptions: { value: LocaleSettings["dateFormat"]; label: string }[] = [
    { value: "system", label: "Automatic (browser default)" },
    { value: "dmy", label: "DD/MM/YYYY" },
    { value: "mdy", label: "MM/DD/YYYY" },
    { value: "ymd", label: "YYYY-MM-DD" },
    { value: "long", label: "Long (localized)" }
  ];
  const timeOptions: { value: LocaleSettings["timeFormat"]; label: string }[] = [
    { value: "system", label: "Automatic (browser default)" },
    { value: "12h", label: "12-hour" },
    { value: "24h", label: "24-hour" }
  ];
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const availableTimeZones = getTimeZoneOptions();
  const timeZoneOptions = $derived.by(() => {
    const zones = new Set(availableTimeZones);
    if (value.timeZone !== "system" && !zones.has(value.timeZone)) {
      try {
        new Intl.DateTimeFormat(undefined, { timeZone: value.timeZone });
        zones.add(value.timeZone);
      } catch { /* Invalid persisted timezones are normalized by the settings model. */ }
    }
    return [
      { value: "system", label: `Automatic (${browserTimeZone || "browser default"})` },
      ...[...zones].sort().map(timeZone => ({ value: timeZone, label: timeZone.replaceAll("_", " ") }))
    ];
  });
  const preview = $derived(formatDateTime(Date.now(), value, navigator.languages));
</script>

<fieldset class="locale-settings" aria-label="Locale preferences">
  <div class="locale-options">
    <div class="locale-option">
      <label for="locale-date-format">Date format</label>
      <FieldSelect id="locale-date-format" label="Date format" value={value.dateFormat} options={dateOptions} includePlaceholder={false}
        onValueChange={dateFormat => onValueChange({ ...value, dateFormat: dateFormat as LocaleSettings["dateFormat"] })} />
    </div>
    <div class="locale-option">
      <label for="locale-time-format">Time format</label>
      <FieldSelect id="locale-time-format" label="Time format" value={value.timeFormat} options={timeOptions} includePlaceholder={false}
        onValueChange={timeFormat => onValueChange({ ...value, timeFormat: timeFormat as LocaleSettings["timeFormat"] })} />
    </div>
    <div class="locale-option">
      <label for="locale-time-zone">Timezone</label>
      <FieldSelect id="locale-time-zone" label="Timezone" value={value.timeZone} options={timeZoneOptions} includePlaceholder={false}
        onValueChange={timeZone => onValueChange({ ...value, timeZone })} />
    </div>
  </div>
  <div class="locale-preview">
    <span>Preview</span>
    <output aria-label="Date and time preview" aria-live="polite" aria-atomic="true">{preview}</output>
  </div>
  {#if error}
    <div class="defaults-error">
      <p role="alert">{error}</p>
      {#if onRetry}<button class="defaults-retry" type="button" onclick={onRetry}>Retry saving</button>{/if}
    </div>
  {/if}
</fieldset>

<style>
  .locale-settings { min-width: 0; margin: 0; padding: 16px; border: 0; container-type: inline-size; color: var(--color-foreground); }
  .locale-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .locale-option { display: grid; align-content: start; gap: 8px; min-width: 0; padding: 10px; border-radius: 4px; background: var(--color-surface); --field-background: var(--color-background); --field-foreground: var(--color-foreground); }
  .locale-option label { font-size: 12px; font-weight: 700; }
  .locale-option :global(.field-select-trigger) { border-radius: 4px; font-size: 12px; }
  .locale-preview { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 12px; margin-top: 12px; color: var(--color-catalog-active-foreground); font-size: 12px; }
  .locale-preview > span { font-weight: 700; }
  .locale-preview output { min-width: 0; overflow-wrap: anywhere; }
  .defaults-error { display: grid; justify-items: start; gap: 10px; margin-top: 12px; }
  .defaults-error p { margin: 0; padding: 10px 12px; border-radius: 4px; background: var(--color-error-background); color: var(--color-error-foreground); font-size: 12px; overflow-wrap: anywhere; }
  .defaults-retry { padding: 8px 12px; border: 0; border-radius: 4px; background: var(--color-primary); color: var(--color-primary-foreground); font-size: 12px; font-weight: 700; }
  @container (max-width: 650px) { .locale-options { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @container (max-width: 430px) { .locale-options { grid-template-columns: 1fr; } }
</style>
