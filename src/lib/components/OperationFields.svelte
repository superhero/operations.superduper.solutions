<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import type { InputField, Operation } from "../catalog.ts";
  import type { InputValidationError } from "../operation-input.ts";
  import OperationFieldControl from "./OperationFieldControl.svelte";
  import HintButton from "./HintButton.svelte";
  import MaterialIcon from "./MaterialIcon.svelte";
  import Reveal from "./Reveal.svelte";

  let { operation, values, onValueChange, idPrefix = "field", active = true, disabled = false,
    mappedFields = [], fieldError = null, portalZIndex = 40 }: {
    operation: Operation; values: Record<string, string>; onValueChange: (field: InputField, value: string) => void;
    idPrefix?: string; active?: boolean; disabled?: boolean; mappedFields?: string[];
    fieldError?: InputValidationError | null; portalZIndex?: number;
  } = $props();
  const locations = [{ key: "path", label: "Path" }, { key: "query", label: "Query" },
    { key: "header", label: "Headers" }, { key: "body", label: "Request body" }] as const;
  let fieldHelp = $state<string[]>([]);
  // Keep required indicators aligned with request preparation: an explicitly
  // supplied empty string is still a value for an additional body property.
  const bodyProvided = $derived(Boolean(operation.bodyRequired || operation.fields.some(field =>
    field.location === "body" && (values[field.key]?.trim()
      || field.type === "string" && operation.bodySchema?.type === "object"
        && !Object.hasOwn(operation.bodySchema.properties ?? {}, field.name) && Object.hasOwn(values, field.key)))));
  function toggleHelp(key: string) {
    fieldHelp = fieldHelp.includes(key) ? fieldHelp.filter(value => value !== key) : [...fieldHelp, key];
  }
  function describedBy(field: InputField) {
    return [field.description && fieldHelp.includes(field.key) ? `${idPrefix}-help-${field.key}` : "",
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
          <div class="operation-field">
            <div class="joined-field">
              <label for={`${idPrefix}-${field.key}`}>{field.label}</label>
              <OperationFieldControl {field} id={`${idPrefix}-${field.key}`} value={values[field.key] ?? ""} {active}
                disabled={disabled || connected} {portalZIndex} onValueChange={value => onValueChange(field, value)}
                required={field.required && (field.location !== "body" || bodyProvided)}
                multiline={field.location === "body" && operation.bodyMediaType === "text/plain"}
                invalid={fieldError?.fieldKey === field.key} describedBy={describedBy(field)} />
              {#if field.required || field.description}
                <div class="field-actions">
                  {#if field.required}
                    <HintButton label="Required" labelAsName={false}>
                      {#snippet child({ props })}
                        {@const { type: _type, disabled: _disabled, tabindex: _tabindex, ...hintProps } = props}
                        <span {...hintProps} class="required-marker" aria-hidden="true"><MaterialIcon name="asterisk" size={18} /></span>
                      {/snippet}
                    </HintButton>
                  {/if}
                  {#if field.description}
                    <HintButton type="button" class="info-button field-info" tabindex={-1} label="Description"
                      aria-label={`About ${field.label}`} aria-expanded={fieldHelp.includes(field.key)}
                      aria-controls={`${idPrefix}-help-${field.key}`} onclick={() => toggleHelp(field.key)}>
                      <MaterialIcon name="info" size={18} />
                    </HintButton>
                  {/if}
                </div>
              {/if}
            </div>
            {#if connected}<p class="hint" id={`${idPrefix}-connected-${field.key}`}>Connected from workflow</p>{/if}
            {#if field.description}
              <Reveal open={fieldHelp.includes(field.key)} id={`${idPrefix}-help-${field.key}`}>
                <p class="hint field-description">{field.description}</p>
              </Reveal>
            {/if}
            {#if fieldError?.fieldKey === field.key}<p role="alert" id={`${idPrefix}-error-${field.key}`} class="error">{fieldError.message}</p>{/if}
          </div>
        {/each}
      </fieldset>
    {/if}
  {/each}
  {#if !operation.fields.length}<p class="hint">This operation does not accept any input.</p>{/if}
</div>
