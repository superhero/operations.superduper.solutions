<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import type { InputField, Operation } from "../catalog.ts";
  import { inputAllowsNull, type InputValues, type InputValidationError } from "../operation-input.ts";
  import OperationFieldControl from "./OperationFieldControl.svelte";
  import OperationFieldToggle from "./OperationFieldToggle.svelte";
  import HintButton from "./HintButton.svelte";
  import MaterialIcon from "./MaterialIcon.svelte";
  import Reveal from "./Reveal.svelte";

  let { operation, values, onValueChange, idPrefix = "field", active = true, disabled = false,
    mappedFields = [], fieldError = null, portalZIndex = 40 }: {
    operation: Operation; values: InputValues; onValueChange: (field: InputField, value: string | null | undefined) => void;
    idPrefix?: string; active?: boolean; disabled?: boolean; mappedFields?: string[];
    fieldError?: InputValidationError | null; portalZIndex?: number;
  } = $props();
  const locations = [{ key: "path", label: "Path" }, { key: "query", label: "Query" },
    { key: "header", label: "Headers" }, { key: "body", label: "Request body" }] as const;
  let fieldHelp = $state<string[]>([]);
  let drafts = $state<Record<string, string>>({});
  let includedValues = $state<InputValues>({});
  // Keep required indicators aligned with request preparation: an explicitly
  // supplied empty string is still a value for an additional body property.
  const bodyProvided = $derived(Boolean(operation.bodyRequired || operation.fields.some(field =>
    field.location === "body" && (values[field.key] === null || values[field.key]?.trim()
      || field.type === "string" && operation.bodySchema?.type === "object"
        && !Object.hasOwn(operation.bodySchema.properties ?? {}, field.name) && typeof values[field.key] === "string"))));
  function omit(field: InputField, checked: boolean) {
    if (checked) {
      const value = values[field.key];
      includedValues[field.key] = value;
      if (typeof value === "string") drafts[field.key] = value;
      onValueChange(field, undefined);
    } else {
      const previous = includedValues[field.key];
      onValueChange(field, previous === undefined ? "" : previous);
    }
  }
  function sendNull(field: InputField, checked: boolean) {
    const value = values[field.key];
    if (checked && typeof value === "string") drafts[field.key] = value;
    onValueChange(field, checked ? null : drafts[field.key] ?? "");
  }
  function toggleHelp(key: string) {
    fieldHelp = fieldHelp.includes(key) ? fieldHelp.filter(value => value !== key) : [...fieldHelp, key];
  }
  function describedBy(field: InputField) {
    return [fieldHelp.includes(field.key) ? `${idPrefix}-help-${field.key}` : "",
      values[field.key] === null || Object.hasOwn(values, field.key) && values[field.key] === undefined ? `${idPrefix}-state-${field.key}` : "",
      mappedFields.includes(field.key) ? `${idPrefix}-connected-${field.key}` : "",
      fieldError?.fieldKey === field.key ? `${idPrefix}-error-${field.key}` : ""].filter(Boolean).join(" ") || undefined;
  }
</script>

<div class="operation-fields">
  {#each locations as location}
    {@const fields = operation.fields.filter(field => field.location === location.key)}
    {#if fields.length}
      <fieldset class="request-input-group">
        <legend class="context-label">{location.label}</legend>
        {#if location.key === "body" && !operation.bodyRequired}<p class="hint">Optional body. Starred fields are required when providing a body.</p>{/if}
        {#each fields as field (field.key)}
          {@const connected = mappedFields.includes(field.key)}
          {@const omitted = Object.hasOwn(values, field.key) && values[field.key] === undefined}
          {@const nullValue = values[field.key] === null}
          {@const schema = field.schema ?? field}
          <div class="operation-field">
            <div class="joined-field">
              <label for={`${idPrefix}-${field.key}`}>{field.label}</label>
              <OperationFieldControl {field} id={`${idPrefix}-${field.key}`} value={values[field.key] ?? drafts[field.key] ?? ""} {active}
                disabled={disabled || connected || omitted || nullValue} {portalZIndex} onValueChange={value => onValueChange(field, value)}
                required={field.required && (field.location !== "body" || bodyProvided)}
                multiline={field.location === "body" && operation.bodyMediaType === "text/plain"}
                invalid={fieldError?.fieldKey === field.key} describedBy={describedBy(field)} />
              <div class="field-actions">
                {#if !field.required || operation.bodyValue && field.location === "body" && !operation.bodyRequired}
                  <OperationFieldToggle label={`Do not send ${field.label}`} hint="Do not send" icon="hide_source"
                    controls={`${idPrefix}-${field.key}`} checked={omitted} disabled={disabled || connected}
                    onchange={checked => omit(field, checked)} />
                {/if}
                {#if inputAllowsNull(field)}
                  <OperationFieldToggle label={`Send ${field.label} as null`} hint="Send as null" icon="cancel"
                    controls={`${idPrefix}-${field.key}`} checked={nullValue} disabled={disabled || connected || omitted}
                    onchange={checked => sendNull(field, checked)} />
                {/if}
                {#if field.required}
                  <HintButton label="Required" labelAsName={false}>
                    {#snippet child({ props })}
                      {@const { type: _type, disabled: _disabled, tabindex: _tabindex, ...hintProps } = props}
                      <span {...hintProps} class="required-marker" aria-hidden="true"><MaterialIcon name="asterisk" size={18} /></span>
                    {/snippet}
                  </HintButton>
                {/if}
                <HintButton type="button" class="info-button field-info" label="Field information"
                  aria-label={`About ${field.label}`} aria-expanded={fieldHelp.includes(field.key)}
                  aria-controls={`${idPrefix}-help-${field.key}`} onclick={() => toggleHelp(field.key)}>
                  <MaterialIcon name="info" size={18} />
                </HintButton>
              </div>
            </div>
            {#if connected}<p class="hint" id={`${idPrefix}-connected-${field.key}`}>Connected from workflow</p>{/if}
            {#if omitted || nullValue}<p class="hint" id={`${idPrefix}-state-${field.key}`}>{omitted ? "Not sent" : "Sent as null"}</p>{/if}
            <Reveal open={fieldHelp.includes(field.key)} id={`${idPrefix}-help-${field.key}`}>
              <div class="field-details">
                {#if field.description}<p class="hint field-description">{field.description}</p>{/if}
                <dl>
                  <div><dt>Type</dt><dd>{field.type}{inputAllowsNull(field) && field.type !== "null" ? " or null" : ""}</dd></div>
                  <div><dt>Required</dt><dd>{field.required ? field.location === "body" && !operation.bodyRequired ? "When providing a body" : "Yes" : "No"}</dd></div>
                  {#if schema.enum}<div><dt>Allowed values</dt><dd>{schema.enum.map(value => JSON.stringify(value)).join(", ")}</dd></div>{/if}
                  {#if schema.minimum !== undefined}<div><dt>Minimum</dt><dd>{schema.minimum}</dd></div>{/if}
                  {#if schema.maximum !== undefined}<div><dt>Maximum</dt><dd>{schema.maximum}</dd></div>{/if}
                  {#if schema.minLength !== undefined}<div><dt>Minimum length</dt><dd>{schema.minLength}</dd></div>{/if}
                  {#if schema.maxLength !== undefined}<div><dt>Maximum length</dt><dd>{schema.maxLength}</dd></div>{/if}
                  {#if schema.minItems !== undefined}<div><dt>Minimum items</dt><dd>{schema.minItems}</dd></div>{/if}
                  {#if schema.maxItems !== undefined}<div><dt>Maximum items</dt><dd>{schema.maxItems}</dd></div>{/if}
                </dl>
              </div>
            </Reveal>
            {#if fieldError?.fieldKey === field.key}<p role="alert" id={`${idPrefix}-error-${field.key}`} class="error">{fieldError.message}</p>{/if}
          </div>
        {/each}
      </fieldset>
    {/if}
  {/each}
  {#if !operation.fields.length}<p class="hint">This operation does not accept any input.</p>{/if}
</div>

<style>
  .field-details { display: grid; gap: 8px; padding: 10px 0; }
  dl { display: grid; gap: 4px; margin: 0; font-size: 12px; }
  dl div { display: flex; flex-wrap: wrap; gap: 4px 12px; }
  dt { color: var(--color-muted-foreground); }
  dd { margin: 0; overflow-wrap: anywhere; }
</style>
