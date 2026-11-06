// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { PrivateResultContract } from "../credential-results.ts";
import type { AcquiredReference, AcquiredValue } from "./credential-results.ts";
import { awsQueryContract, awsQueryContracts, awsQueryModelRevision, awsQueryPrivateMapKeys, awsQueryPrivateMember,
  awsQueryShape, type AwsQueryShape } from "../aws-query.ts";
import { VaultError, vaultLimits } from "./types.ts";

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
/** Classify the decoded SDK value inside the private worker, including recursive
 * structures and named map keys. No raw credential leaf is returned to the page. */
export function prepareAwsQueryCredentialResults(profile: PrivateResultContract, status: number, input: unknown) {
  const identity = profile.awsQuery;
  const contract = identity && awsQueryContract({ id: identity.id, method: profile.method, path: profile.path });
  if (!identity || identity.revision !== awsQueryModelRevision || !contract?.output || profile.catalog !== contract.catalog || status !== contract.status)
    throw new VaultError("PERMISSION");
  const source = awsQueryContracts().sources[contract.catalog]!;
  const values: AcquiredValue[] = [], indexes = new Map<string, number>(), placements: { parent: Record<string, unknown>; key: string; index: number }[] = [];
  let nodes = 0;
  function capture(parent: Record<string, unknown>, key: string, value: unknown, path: string[]): void {
    if (typeof value !== "string" || !value.isWellFormed()) throw new VaultError("INVALID");
    if (new TextEncoder().encode(value).byteLength > vaultLimits.secretBytes) throw new VaultError("LIMIT");
    Object.defineProperty(parent, key, { value: null, enumerable: true, writable: true, configurable: true });
    if (!value || /^"?\*+"?$/.test(value)) return;
    let index = indexes.get(value);
    if (index === undefined) {
      if (values.length >= vaultLimits.records) throw new VaultError("LIMIT");
      index = values.length; indexes.set(value, index); values.push({ value, field: path.join(".") });
    }
    placements.push({ parent, key, index });
  }
  function walk(reference: AwsQueryShape, value: unknown, path: string[] = [], depth = 0): unknown {
    if (++nodes > 50000 || depth > 48) throw new VaultError("LIMIT");
    const shape = awsQueryShape(source, reference);
    if (shape.type === "structure") {
      if (!object(value)) throw new VaultError("INVALID");
      const result: Record<string, unknown> = {};
      for (const [name, member] of Object.entries(shape.members ?? {})) {
        if (!Object.hasOwn(value, name)) { if (shape.required?.includes(name)) throw new VaultError("INVALID"); continue; }
        const childPath = [...path, name];
        if (awsQueryPrivateMember(contract!.catalog, reference.shape, name)) capture(result, name, value[name], childPath);
        else Object.defineProperty(result, name, { value: walk(member, value[name], childPath, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      return result;
    }
    if (shape.type === "list") {
      if (!Array.isArray(value) || !shape.member) throw new VaultError("INVALID");
      return value.map((item, index) => walk(shape.member!, item, [...path, String(index)], depth + 1));
    }
    if (shape.type === "map") {
      if (!object(value) || !shape.value) throw new VaultError("INVALID");
      const result: Record<string, unknown> = {}, keys = awsQueryPrivateMapKeys(contract!.catalog, reference.shape);
      const allowed = shape.key ? awsQueryShape(source, shape.key).enum : undefined;
      for (const [name, item] of Object.entries(value)) {
        if (allowed && !allowed.includes(name)) continue;
        const childPath = [...path, name];
        if (keys.includes("*") || keys.includes(name)) capture(result, name, item, childPath);
        else Object.defineProperty(result, name, { value: walk(shape.value, item, childPath, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      return result;
    }
    if (shape.type === "boolean" ? typeof value !== "boolean"
      : ["integer", "long", "float", "double"].includes(shape.type ?? "") ? typeof value !== "number" || !Number.isFinite(value)
      : typeof value !== "string") throw new VaultError("INVALID");
    return value;
  }
  const body = walk({ shape: contract.output }, input);
  return { values, complete(references: readonly AcquiredReference[]) {
    if (references.length !== values.length || references.some(reference => !object(reference) || Object.keys(reference).length !== 2
      || typeof reference.credentialId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(reference.credentialId)
      || typeof reference.label !== "string")) throw new VaultError("INVALID");
    for (const placement of placements) placement.parent[placement.key] = structuredClone(references[placement.index]);
    return body;
  } };
}
