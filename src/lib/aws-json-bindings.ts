// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import pins from "./aws-json-pins.json" with { type: "json" };
import { awsJsonContracts, awsJsonEndpoints, awsJsonHasPrivateOutput, awsJsonSigningProfile } from "./aws-json.ts";
import { projectAwsJsonPrivateResponse } from "./aws-json-private.ts";
import { awsSigningHeaders } from "./aws-signing.ts";

export const awsJsonSourcePins = Object.fromEntries(Object.entries(pins).map(([id, source]) => [id, source.sha256]));
const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
function requireContract(value: unknown, context: string): asserts value {
  if (!value) throw new Error(`AWS JSON targets require the pinned native and SDK contracts (${context}).`);
}
function parameter(raw: unknown, document: Record<string, any>): Record<string, any> {
  requireContract(object(raw), "parameter");
  if (raw.$ref === undefined) return raw;
  requireContract(typeof raw.$ref === "string" && raw.$ref.startsWith("#/components/parameters/"), "parameter reference");
  const name = raw.$ref.slice("#/components/parameters/".length);
  const result = document.components?.parameters?.[name]; requireContract(object(result), "parameter target"); return result;
}
/** Preserve the native identity and declarations; move fragment selectors and
 * signing headers into the reviewed private HTTP codec. */
export function bindAwsJson(document: Record<string, any>): void {
  const data = awsJsonContracts(), matches = Object.entries(data.sources).filter(([, source]) => source.title === document.info?.title
    && source.version === document.info?.version && source.openapi === document.openapi);
  requireContract(matches.length === 1 && object(document.paths), "service identity");
  const [catalog, source] = matches[0]!;
  const hmac = document.components?.securitySchemes?.hmac;
  requireContract(hmac?.type === "apiKey" && hmac.in === "header" && hmac.name === "Authorization"
    && hmac["x-amazon-apigateway-authtype"] === "awsSigv4" && JSON.stringify(document.security) === '[{"hmac":[]}]', "IAM declaration");
  requireContract(!Object.keys(document.components?.schemas ?? {}).some(key => key.startsWith("OperationsAwsJsonPrivate_")), "reserved output components");
  for (const endpoint of source.endpoints) requireContract(document.servers?.some((server: any) => server.url === endpoint.url
    && Object.entries(endpoint.variables).every(([name, variable]) => server.variables?.[name]?.default === variable.default
      && JSON.stringify(server.variables?.[name]?.enum) === JSON.stringify(variable.enum))), "HTTPS authority");
  const plans = Object.entries(data.operations).filter(([, contract]) => contract.catalog === catalog).map(([id, contract]) => {
    const path = "/#X-Amz-Target=" + contract.target, item = document.paths[path], operation = item?.post;
    requireContract(object(item) && object(operation) && `${catalog}:${operation.operationId}` === id
      && operation["x-operations-aws-json"] === undefined && operation["x-operations-aws-signing"] === undefined
      && operation["x-upstream-aws-json-contract"] === undefined && operation.servers === undefined && operation.security === undefined, id);
    requireContract(contract.input ? operation.requestBody?.content?.["application/json"]?.schema?.$ref === "#/components/schemas/" + contract.input
      : operation.requestBody === undefined, id + ": body root");
    const headers = (item.parameters ?? []).map((raw: unknown) => parameter(raw, document));
    requireContract(headers.every((value: any) => value.in === "header" && awsSigningHeaders.has(String(value.name).toLowerCase())), id + ": signer headers");
    const parameters = operation.parameters ?? []; requireContract(Array.isArray(parameters), id + ": parameters");
    const target = parameters.find((raw: unknown) => parameter(raw, document).name === "X-Amz-Target");
    const declaration = target && parameter(target, document);
    requireContract(declaration?.in === "header" && declaration.required === true && JSON.stringify(declaration.schema?.enum) === JSON.stringify([contract.target]), id + ": target");
    requireContract(parameters.every((raw: unknown) => raw === target || parameter(raw, document).in === "query"
      && ["Pagination limit", "Pagination token"].includes(parameter(raw, document).description)), id + ": pagination");
    return { id, contract, path, item, operation, parameters };
  });
  for (const { id, contract, path, item, operation, parameters } of plans) {
    operation["x-upstream-aws-json-contract"] = { path, parameters: structuredClone(parameters),
      pathParameters: structuredClone(item.parameters ?? []), requestBody: structuredClone(operation.requestBody ?? null),
      responses: structuredClone(operation.responses), servers: structuredClone(document.servers), security: structuredClone(document.security) };
    item.parameters = []; operation.parameters = []; operation.servers = awsJsonEndpoints(contract);
    operation.security = contract.auth === "none" ? [] : [{ hmac: [] }];
    operation["x-operations-aws-json"] = awsJsonSigningProfile;
    operation["x-operations-aws-signing"] = awsJsonSigningProfile;
    const identity = { id, method: "POST", path };
    if (awsJsonHasPrivateOutput(identity)) {
      requireContract(contract.output && object(operation.responses?.[String(contract.status)]), id + ": success response");
      operation["x-upstream-private-result-responses"] = structuredClone(operation.responses);
      const response = operation.responses[String(contract.status)];
      response.content = { "application/json": { schema: projectAwsJsonPrivateResponse(document, catalog, contract.output) } };
      delete response.example; delete response.examples;
      operation["x-operations-credential-result"] = true; operation["x-operations-private-result"] = "private-result-v1";
    }
  }
}
