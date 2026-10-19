// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { WorkflowDocument } from "./workflow-document.ts";

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
