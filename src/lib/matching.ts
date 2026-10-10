// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { Operation } from "./catalog.ts";

export const minimumSimilarity = 0.5;
export const topResultCount = 5;
export type OperationMatch = { operation: Operation; similarity: number };

function normalize(value: string): string
{
  return value.normalize("NFKC").replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function similarity(left: string, right: string): number
{
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++)
  {
    const current = [row];
    for (let column = 1; column <= right.length; column++)
      current[column] = Math.min(current[column - 1]! + 1, previous[column]! + 1,
        previous[column - 1]! + Number(left[row - 1] !== right[column - 1]));
    previous = current;
  }
  return 1 - previous[right.length]! / Math.max(left.length, right.length);
}

export function evaluateOperations(prompt: string, operations: Operation[]): { candidates: OperationMatch[]; results: OperationMatch[] }
{
  const query = normalize(prompt);
  if (!query || query.length > 256) return { candidates: [], results: [] };
  const candidates = operations.map(operation => ({ operation, similarity: Math.max(...[
    operation.name, operation.id, operation.id.slice(operation.id.indexOf(":") + 1)
  ].map(name => similarity(query, normalize(name)))) }))
    .sort((left, right) => right.similarity - left.similarity || left.operation.id.localeCompare(right.operation.id));
  // A single pass merges both selections without repeating their overlap.
  return { candidates, results: candidates.filter((result, index) => index < topResultCount || result.similarity > minimumSimilarity) };
}

export function rankOperations(prompt: string, operations: Operation[]): OperationMatch[]
{
  return evaluateOperations(prompt, operations).results;
}
