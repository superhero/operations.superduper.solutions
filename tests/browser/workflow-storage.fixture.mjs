// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export const storageKey = "operations-flow-documents-v1";
export const repository = (page, method, ...args) => page.evaluate(async ({ method, args }) => {
  const fixture = await import('/workflow-repository-fixture.js');
  return fixture.callRepository(method, args);
}, { method, args });
export const storedWorkflows = page => repository(page, 'list');

export async function blockWorkflowSaving(page, message = "Browser storage unavailable for autosave review") {
  await page.evaluate(message => {
    window.workflowAutosaveTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      if (mode === 'readwrite' && this.name === 'operations-workflow-catalog-v1') throw new Error(message);
      return window.workflowAutosaveTransaction.call(this, stores, mode, options);
    };
  }, message);
}

export async function restoreWorkflowSaving(page) {
  await page.evaluate(() => {
    if (window.workflowAutosaveTransaction) IDBDatabase.prototype.transaction = window.workflowAutosaveTransaction;
    delete window.workflowAutosaveTransaction;
  });
}
