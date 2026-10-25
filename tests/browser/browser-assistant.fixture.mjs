// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { operations } from '../../src/lib/catalog.ts';

// Only inference is scripted. The production Settings UI, capability dispatcher,
// graph validation, real handles, autosave and persistence run unchanged.
export async function loadAssistantModel(page) {
  const picker = page.getByRole('combobox', { name: 'Local model', exact: true });
  const selected = (await picker.locator('.field-select-value').innerText()).trim();
  await picker.click();
  await page.getByRole('option', { name: selected, exact: true }).click();
}

export async function installAssistantFixture(page) {
  const operation = operations.find(operation => operation.name === 'Example GET request');
  await page.addInitScript(({ operationId }) => {
    const NativeWorker = window.Worker;
    window.assistantFixture = { workers: 0, terminated: 0, calls: [], behavior: 'tools' };
    window.Worker = function(url, options) {
      if (options?.name !== 'operations-bonsai-inference') return new NativeWorker(url, options);
      const record = window.assistantFixture;
      record.workers++;
      const pending = new Map(); let next = 0, stopped = false;
      const worker = new EventTarget();
      const emit = data => { if (!stopped) { const event = new MessageEvent('message', { data }); worker.onmessage?.(event); worker.dispatchEvent(event); } };
      record.emit = emit;
      const failure = { name: 'OperationError', message: 'Synthetic inference failure', code: 'GPU_LOAD',
        stack: 'OperationError: Synthetic inference failure\n    at mapGpuBuffer (inference.worker.ts:42:7)',
        cause: { name: 'DeviceLostError', message: 'Synthetic device reset', code: 'DEVICE_LOST',
          stack: 'DeviceLostError: Synthetic device reset\n    at gpuReadback (webml.js:10:3)' } };
      const call = (name, args) => new Promise(resolve => { const id = ++next; pending.set(id, resolve); emit({ type: 'tool', id, name, args }); });
      const run = async text => {
        if (record.behavior === 'slow' || record.behavior === 'manual') return;
        if (record.behavior === 'error') { emit({ type: 'error', operation: 'send', error: failure }); return; }
        const messages = [{ role: 'user', text }];
        const tool = async (name, args) => {
          const response = await call(name, args); record.calls.push({ name, args, ...response });
          messages.push({ role: 'tool', tool: name, text: JSON.stringify(response.value ?? response.error), failed: !!response.error }); return response.value;
        };
        const summary = await tool('read_workflow', { section: 'summary' });
        const workflowId = summary.workflowId;
        await tool('read_application', { section: 'settings' });
        await tool('read_skill', { path: '/skills/workspace-design/SKILL.md' });
        const added = await tool('add_operation', { workflowId, operationId, x: 600, y: 400 });
        if (added) await tool('move_nodes', { workflowId, moves: [{ nodeId: added.nodeId, x: 720, y: 320 }] });
        await tool('read_ports', { nodeId: 'assistant-cast' });
        await tool('read_ports', { nodeId: 'assistant-stop' });
        await tool('connect_nodes', { workflowId, source: 'assistant-cast', sourceHandle: 'result', target: 'assistant-stop', targetHandle: 'value' });
        await tool('run_workflow', { workflowId });
        messages.push({ role: 'assistant', text: '**Done** ![blocked](https://example.com/assistant-leak)' });
        emit({ type: 'update', messages, error: '' }); emit({ type: 'done' });
      };
      worker.postMessage = message => queueMicrotask(() => {
        if (stopped) return;
        if (message.type === 'tool_result') { pending.get(message.id)?.(message); pending.delete(message.id); }
        else if (message.type === 'check') emit({ type: 'compatibility', value: { ready: true, summary: 'WebGPU compute verified.', fp32: true, fp16: true, adapter: 'Scripted test GPU', detail: '' } });
        else if (message.type === 'load') {
          record.settings = message.settings;
          if (record.behavior === 'load-error') emit({ type: 'error', operation: 'load', error: failure });
          else emit({ type: 'ready' });
        }
        else if (message.type === 'reset') { emit({ type: 'update', messages: [], error: '' }); emit({ type: 'done' }); }
        else if (message.type === 'send') { record.lastMessage = message; void run(message.text); }
      });
      worker.terminate = () => { if (!stopped) { stopped = true; record.terminated++; } };
      return worker;
    };
  }, { operationId: operation.id });
  await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' });
}
