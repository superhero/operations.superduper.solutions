// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { WorkflowDocument } from "./workflow-document.ts";
import type { Operation, OperationModel } from "./catalog.ts";

export const schemaModelBatchSize = 16;

/** Coalesce overlapping loads and bound each schema's in-flight model payload. */
export function createSchemaModelLoader(options: {
  existing: (id: string) => Operation | undefined;
  identity: (id: string) => string | undefined;
  read: (schema: string, identity: string, ids: string[]) => Promise<OperationModel[]>;
  install: (model: OperationModel) => Operation;
}) {
  const loading = new Map<string, Promise<Operation>>();
  return async (ids: Iterable<string>): Promise<Operation[]> => {
    const requested = [...new Set(ids)];
    const entries = requested.map(id => {
      const existing = options.existing(id);
      const identity = existing ? undefined : options.identity(id);
      if (!existing && (!identity || id.indexOf(":") < 1))
        throw new Error("This operation is not available in the registered schemas.");
      return { id, existing, identity: identity!, key: JSON.stringify([id, identity]) };
    });
    const groups = new Map<string, typeof entries>();
    for (const entry of entries) if (!entry.existing && !loading.has(entry.key)) {
      const schema = entry.id.slice(0, entry.id.indexOf(":"));
      const group = JSON.stringify([schema, entry.identity]);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(entry);
    }
    let preceding = Promise.resolve();
    for (const [group, entries] of groups) for (let offset = 0; offset < entries.length; offset += schemaModelBatchSize) {
      const batch = entries.slice(offset, offset + schemaModelBatchSize);
      const [schema, identity] = JSON.parse(group) as [string, string];
      const work = preceding.then(() => options.read(schema, identity, batch.map(entry => entry.id))).then(models => {
        if (models.length !== batch.length || models.some((model, index) => model.operation.id !== batch[index]!.id || model.sourceIdentity !== identity))
          throw new Error("The background operation batch is incomplete or outdated. Try again.");
        return models.map(options.install);
      });
      preceding = work.then(() => {});
      // The last scheduling link is otherwise not observed if a read fails.
      void preceding.catch(() => {});
      for (const [index, entry] of batch.entries()) {
        const pending = work.then(operations => operations[index]!).finally(() => {
          loading.delete(entry.key);
        });
        loading.set(entry.key, pending);
      }
    }
    return Promise.all(entries.map(entry => entry.existing ?? loading.get(entry.key)!));
  };
}

export function workflowOperationIds(document: WorkflowDocument): Set<string>
{
  const ids = new Set<string>();
  function visit(document: WorkflowDocument) {
    for (const node of document.nodes) {
      if (!node.type || node.type === "operation") ids.add(node.data.operationId);
      else if (node.type === "workflow") visit(node.data.snapshot);
    }
  }
  visit(document);
  return ids;
}
