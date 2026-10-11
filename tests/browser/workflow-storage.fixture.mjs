// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export async function repository(page, method, ...args) {
  if (method === 'interruptCatalogFinish') {
    // Model the outage in every repository realm. Otherwise a worker reacting
    // to an earlier broadcast can recover the journal before the crash is read.
    await Promise.all(page.workers().map(worker => worker.evaluate(() => {
      if (self.workflowInterruptedCatalogTransaction) return;
      self.workflowInterruptedCatalogTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, ...options) {
        if (this.name === 'v1/workflows/index' && Array.isArray(stores) && stores.includes('catalog') && stores.includes('pending'))
          throw new Error('Interrupted catalogue update after Git commit');
        return self.workflowInterruptedCatalogTransaction.call(this, stores, ...options);
      };
    })));
  }
  return page.evaluate(async ({ method, args }) => {
    const fixture = await import('/workflow-repository-fixture.js');
    return fixture.callRepository(method, args);
  }, { method, args });
}
export const storedWorkflows = page => repository(page, 'list');

export async function workflowStorageWorker(page) {
  for (const worker of page.workers())
    if (await worker.evaluate(() => self.name) === 'operations-workflows') return worker;
  throw new Error('The workflow repository worker must be running before injecting a storage failure.');
}

export async function blockWorkflowSaving(page, message = "Browser storage unavailable for autosave review") {
  const worker = await workflowStorageWorker(page);
  await worker.evaluate(message => {
    self.workflowAutosaveTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      if (mode === 'readwrite' && this.name === 'v1/workflows/index') throw new Error(message);
      return self.workflowAutosaveTransaction.call(this, stores, mode, options);
    };
  }, message);
}

export async function restoreWorkflowSaving(page) {
  const worker = await workflowStorageWorker(page);
  await worker.evaluate(() => {
    if (self.workflowAutosaveTransaction) IDBDatabase.prototype.transaction = self.workflowAutosaveTransaction;
    delete self.workflowAutosaveTransaction;
  });
}
