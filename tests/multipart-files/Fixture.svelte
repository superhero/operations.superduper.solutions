<!-- Copyright (C) 2026 Erik Landvall; SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import OperationFieldControl from '../../src/lib/components/OperationFieldControl.svelte';
  import type { InputField } from '../../src/lib/catalog.ts';
  const field: InputField = {key:'body:files',name:'files',label:'Files',description:'',location:'body',required:true,type:'array',
    schema:{type:'array',minItems:1,maxItems:2,items:{type:'string',format:'binary'}}};
  let value = $state(''), active = $state(true), disabled = $state(false), emissions = 0;
  (window as any).multipartFilesFixture = {
    read:()=>({value,emissions}), deactivate:()=>{active=false;}, disable:()=>{disabled=true;}
  };
</script>
<OperationFieldControl {field} id="files" {value} {active} {disabled} onValueChange={next=>{value=next;emissions++;}} />
