<!-- Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS. -->
<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import type { Operation } from '../../src/lib/catalog.ts';
  import type { CredentialBinding } from '../../src/lib/secrets/types.ts';
  import CredentialBindingSelector from '../../src/lib/components/CredentialBindingSelector.svelte';
  import OperationFields from '../../src/lib/components/OperationFields.svelte';
  let { operation, privateInputOperation, onChange }: { operation:Operation; privateInputOperation:Operation;
    onChange:(binding:CredentialBinding|undefined)=>void } = $props();
</script>
<Tooltip.Provider>
  <CredentialBindingSelector {operation} {onChange} />
  <OperationFields operation={privateInputOperation} values={{}} idPrefix="private-input" onValueChange={() => {}} />
</Tooltip.Provider>
