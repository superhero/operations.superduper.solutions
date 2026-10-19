// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { Operation } from "./catalog.ts";

export const minimumSimilarity = 0.5;
export const topResultCount = 5;
export type MatchableOperation = Pick<Operation, "id" | "name">;
export type OperationMatch<T extends MatchableOperation = Operation> = { operation: T; similarity: number };
export type OperationEvaluation<T extends MatchableOperation = Operation> = {
  candidates: OperationMatch<T>[];
  results: OperationMatch<T>[];
};

function normalize(value: string): string
{
  return value.normalize("NFKC").replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export type PreparedMatchingOperation<T extends MatchableOperation = MatchableOperation> = { operation: T; names: string[] };

/** Build once per immutable catalogue snapshot, independently of query text. */
export function prepareMatchingOperations<T extends MatchableOperation>(operations: readonly T[]): PreparedMatchingOperation<T>[]
{
  return operations.map(operation => ({ operation, names: [...new Set([
    operation.name, operation.id, operation.id.slice(operation.id.indexOf(":") + 1)
  ].map(normalize))] }));
}

function distance(left: string, right: string, row: Uint32Array): number
{
  let start = 0, leftEnd = left.length, rightEnd = right.length;
  while (start < leftEnd && start < rightEnd && left.charCodeAt(start) === right.charCodeAt(start)) start++;
  while (leftEnd > start && rightEnd > start && left.charCodeAt(leftEnd - 1) === right.charCodeAt(rightEnd - 1)) { leftEnd--; rightEnd--; }
  let leftLength = leftEnd - start, rightLength = rightEnd - start;
  if (!leftLength || !rightLength) return leftLength + rightLength;
  if (leftLength > rightLength)
  {
    [left, right] = [right, left];
    [leftLength, rightLength] = [rightLength, leftLength];
  }
  for (let column = 0; column <= leftLength; column++) row[column] = column;
  for (let line = 1; line <= rightLength; line++)
  {
    let diagonal = row[0]!;
    row[0] = line;
    const character = right.charCodeAt(start + line - 1);
    for (let column = 1; column <= leftLength; column++)
    {
      const above = row[column]!;
      row[column] = Math.min(above + 1, row[column - 1]! + 1,
        diagonal + Number(left.charCodeAt(start + column - 1) !== character));
      diagonal = above;
    }
  }
  return row[leftLength]!;
}

export function evaluatePreparedOperations<T extends MatchableOperation>(prompt: string, operations: readonly PreparedMatchingOperation<T>[]): OperationEvaluation<T>
{
  const query = normalize(prompt);
  if (!query || query.length > 256) return { candidates: [], results: [] };
  // The shorter side never exceeds the bounded query, even for very long names.
  const row = new Uint32Array(query.length + 1);
  const candidates = operations.map(({ operation, names }) => {
    let similarity = 0;
    for (const name of names)
    {
      const length = Math.max(query.length, name.length);
      // A length difference is a lower bound on edit distance. Pruning only
      // variants that cannot improve the current score preserves every score.
      if (1 - Math.abs(query.length - name.length) / length <= similarity) continue;
      similarity = Math.max(similarity, 1 - distance(query, name, row) / length);
    }
    return { operation, similarity };
  })
    .sort((left, right) => right.similarity - left.similarity || left.operation.id.localeCompare(right.operation.id));
  // A single pass merges both selections without repeating their overlap.
  return { candidates, results: candidates.filter((result, index) => index < topResultCount || result.similarity > minimumSimilarity) };
}

export function createOperationMatcher<T extends MatchableOperation>(operations: readonly T[]): (prompt: string) => OperationEvaluation<T>
{
  const prepared = prepareMatchingOperations(operations);
  return prompt => evaluatePreparedOperations(prompt, prepared);
}

export function evaluateOperations<T extends MatchableOperation>(prompt: string, operations: readonly T[]): OperationEvaluation<T>
{
  const query = normalize(prompt);
  if (!query || query.length > 256) return { candidates: [], results: [] };
  return createOperationMatcher(operations)(prompt);
}

export function rankOperations<T extends MatchableOperation>(prompt: string, operations: readonly T[]): OperationMatch<T>[]
{
  return evaluateOperations(prompt, operations).results;
}
