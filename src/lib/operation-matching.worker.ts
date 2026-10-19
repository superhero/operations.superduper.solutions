// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { evaluateOperations, evaluatePreparedOperations, type PreparedMatchingOperation } from "./matching.ts";
import { serveWorkerRpc } from "./worker-rpc.ts";

serveWorkerRpc({ evaluate: evaluateOperations,
  evaluatePrepared(prompt: string, prepared: PreparedMatchingOperation[]) {
    const result = evaluatePreparedOperations(prompt, prepared);
    return { candidates: result.candidates.map(({ operation, similarity }) => ({ id: operation.id, similarity })),
      results: result.results.map(match => match.operation.id) };
  },
});
