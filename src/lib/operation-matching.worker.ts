// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { evaluateOperations, evaluatePreparedOperations, type PreparedMatchingOperation } from "./matching.ts";
import { serveWorkerRpc } from "./worker-rpc.ts";
import { createMatchingLibrary } from "./matching-index.ts";

const library = createMatchingLibrary();

serveWorkerRpc({ evaluate: evaluateOperations,
  configure: library.configure,
  search(prompt: string, revision: string, details: boolean) {
    const prepared = library.read(revision);
    const started = performance.now();
    const result = evaluatePreparedOperations(prompt, prepared, details);
    const scoringMs = performance.now() - started;
    const scores = (matches: typeof result.results) => matches.map(({ operation, similarity }) => ({ id: operation.id, similarity }));
    return { scoringMs, considered: result.results.length ? prepared.length : 0, results: scores(result.results), candidates: details ? scores(result.candidates) : [] };
  },
  evaluatePrepared(prompt: string, prepared: PreparedMatchingOperation[]) {
    const result = evaluatePreparedOperations(prompt, prepared);
    return { candidates: result.candidates.map(({ operation, similarity }) => ({ id: operation.id, similarity })),
      results: result.results.map(match => match.operation.id) };
  },
});
