// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import data from "./catalog-path-bindings.json" with { type: "json" };

type Action = { kind: "add"; parameter: Record<string, unknown> }
  | { kind: "rename"; name: string; target: string }
  | { kind: "remove"; name: string }
  | { kind: "query"; name: string; required: boolean };
type Contract = { catalog: string; id: string; method: string; path: string; parameters: unknown[] | null; actions: Action[] };
type Source = { sha256: string; title: string; version: string; openapi: string; servers: unknown };
const contracts = data as unknown as { version: 1; sources: Record<string, Source>; operations: Contract[] };
export const catalogPathBindingSources = Object.fromEntries(Object.entries(contracts.sources).map(([id, source]) => [id, source.sha256]));
export const readCatalogPathBindings = () => structuredClone(contracts);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
function requireContract(condition: unknown, context: string): asserts condition {
  if (!condition) throw new Error(`${context}: catalog path bindings do not match the reviewed source contract.`);
}
function resolveParameter(raw: unknown, document: Record<string, any>): Record<string, any> {
  let parameter = raw;
  const seen = new Set<string>();
  while (object(parameter) && parameter.$ref !== undefined) {
    const ref = parameter.$ref;
    requireContract(typeof ref === "string" && /^#\/components\/parameters\/[^/]+$/.test(ref)
      && Object.keys(parameter).length === 1 && !seen.has(ref) && seen.size < 8, "Parameter reference");
    seen.add(ref);
    const name = ref.slice("#/components/parameters/".length).replace(/~1/g, "/").replace(/~0/g, "~");
    parameter = object(document.components?.parameters) && Object.hasOwn(document.components.parameters, name)
      ? document.components.parameters[name] : undefined;
  }
  requireContract(object(parameter), "Parameter declaration");
  return parameter;
}

/** Repair explicit data defects, preserving native routes, peer methods and source parameters. */
export function bindCatalogPaths(document: Record<string, any>): void {
  const matches = Object.entries(contracts.sources).filter(([, source]) => source.title === document.info?.title
    && source.version === document.info?.version && source.openapi === document.openapi
    && JSON.stringify(source.servers) === JSON.stringify(document.servers));
  requireContract(matches.length === 1 && object(document.paths), "Catalog source");
  const [catalog] = matches[0]!;
  const plans: { operation: Record<string, any>; parameters: Record<string, any>[]; original: unknown }[] = [];
  for (const contract of contracts.operations.filter(operation => operation.catalog === catalog)) {
    const operation = document.paths[contract.path]?.[contract.method.toLowerCase()];
    requireContract(object(operation) && `${catalog}:${operation.operationId}` === contract.id
      && !Object.hasOwn(operation, "x-upstream-parameters")
      && JSON.stringify(operation.parameters ?? null) === JSON.stringify(contract.parameters), contract.id);
    const parameters: Record<string, any>[] = structuredClone(operation.parameters ?? []);
    for (const action of contract.actions) {
      if (action.kind === "add") {
        parameters.push(structuredClone(action.parameter));
        continue;
      }
      const indices = parameters.flatMap((parameter, index) => {
        const resolved = resolveParameter(parameter, document);
        return resolved.in === "path" && resolved.name === action.name ? [index] : [];
      });
      requireContract(indices.length === 1, `${contract.id}: ${action.name}`);
      const index = indices[0]!;
      if (action.kind === "remove") parameters.splice(index, 1);
      else {
        const parameter = structuredClone(resolveParameter(parameters[index], document));
        if (action.kind === "rename") parameter.name = action.target;
        else { parameter.in = "query"; parameter.required = action.required; }
        parameters[index] = parameter;
      }
    }
    const names = parameters.map(parameter => resolveParameter(parameter, document)).filter(parameter => parameter.in === "path").map(parameter => parameter.name);
    const placeholders = [...contract.path.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]);
    requireContract(new Set(names).size === names.length && names.length === new Set(placeholders).size
      && placeholders.every(name => names.includes(name)), contract.id);
    plans.push({ operation, parameters, original: structuredClone(operation.parameters ?? null) });
  }
  for (const { operation, parameters, original } of plans) {
    operation["x-upstream-parameters"] = original;
    operation.parameters = parameters;
  }
}
