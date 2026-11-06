// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { awsRestContracts, awsRestRoot, awsRestShape, awsRestSigningProfile, awsRestPrivateResultPaths } from "./aws-rest.ts";
import { awsSigningHeaders } from "./aws-signing.ts";

const methods = new Set(["get", "put", "post", "patch", "delete", "head", "options", "trace"]);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
function requireContract(valid: unknown, context = "source"): asserts valid {
  if (!valid) throw new Error(`AWS REST signing requires the reviewed native source and SDK wire contract (${context}).`);
}
function resolve(input: unknown, document: Record<string, any>): Record<string, any> {
  requireContract(object(input)); let value = input; const seen = new Set<string>();
  while (value.$ref !== undefined) {
    const ref = value.$ref; requireContract(typeof ref === "string" && ref.startsWith("#/") && !seen.has(ref) && seen.size < 24); seen.add(ref);
    let target: unknown = document;
    for (const segment of ref.slice(2).split("/")) {
      const key = segment.replace(/~1/g, "/").replace(/~0/g, "~"); requireContract(object(target) && Object.hasOwn(target, key)); target = target[key];
    }
    requireContract(object(target)); const { $ref: _ref, ...siblings } = value; value = { ...target, ...siblings };
  }
  if (Array.isArray(value.allOf)) {
    const combined: Record<string, any> = {}, properties: Record<string, any> = {}, required = new Set<string>();
    const annotations = new Set(["description", "title", "example", "examples", "default", "format", "xml", "deprecated", "externalDocs", "readOnly", "writeOnly"]);
    requireContract(value.allOf.filter((part: unknown) => Object.keys(resolve(part, document)).some(key => !annotations.has(key))).length <= 1,
      "composed input schema requires independent qualification");
    for (const part of value.allOf) {
      const shape = resolve(part, document); Object.assign(combined, shape); Object.assign(properties, shape.properties);
      for (const key of shape.required ?? []) required.add(key);
    }
    const { allOf: _allOf, ...siblings } = value;
    value = { ...combined, ...siblings, ...(Object.keys(properties).length ? { properties } : {}), ...(required.size ? { required: [...required] } : {}) };
  }
  return value;
}
/** AWS' generated source uses allOf for descriptions and formats such as
 * password/int64 as annotations. Retain the complete original declarations;
 * SDK timestamp/blob codecs enforce their actual wire representation. */
function inputPattern(pattern: string): string {
  try { new RegExp(pattern, "u"); return pattern; } catch { /* Translate the pinned AWS pattern dialect below. */ }
  let converted = pattern.replace(/^\\A/, "^").replace(/\\z$/, "$(?![\\s\\S])")
    .replaceAll("[\\p{Print}]", "[\\x20-\\x7e]").replaceAll("\\p{Print}", "[\\x20-\\x7e]")
    .replaceAll("[\\p{XDigit}]", "[0-9A-Fa-f]").replaceAll("\\p{XDigit}", "[0-9A-Fa-f]")
    .replaceAll("(?!\\.)+", "(?!\\.)");
  let result = "", inClass = false;
  for (let index = 0; index < converted.length; index++) {
    const character = converted[index]!;
    if (character === "\\" && index + 1 < converted.length) {
      const next = converted[++index]!;
      const identity = !/[A-Za-z0-9]/.test(next) && !"^$\\.*+?()[]{}|/".includes(next) && !(next === "-" && inClass);
      result += (identity ? "" : "\\") + next;
    } else { if (character === "[") inClass = true; else if (character === "]") inClass = false; result += character; }
  }
  try { new RegExp(result, "u"); } catch { requireContract(false, `unsupported AWS input pattern ${JSON.stringify(pattern)}`); }
  return result;
}
function inputSchema(input: unknown, document: Record<string, any>, depth = 0, seen = new Set<object>()): Record<string, any> {
  requireContract(depth <= 48 && object(input) && !seen.has(input), "recursive input schema");
  const next = new Set(seen); next.add(input); const schema = { ...resolve(input, document) };
  if (schema.format !== "binary") delete schema.format;
  delete schema.xml;
  if (typeof schema.pattern === "string") schema.pattern = inputPattern(schema.pattern);
  if (object(schema.properties)) schema.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, inputSchema(value, document, depth + 1, next)]));
  if (object(schema.items)) schema.items = inputSchema(schema.items, document, depth + 1, next);
  if (object(schema.additionalProperties)) schema.additionalProperties = inputSchema(schema.additionalProperties, document, depth + 1, next);
  for (const key of ["anyOf", "oneOf"]) if (Array.isArray(schema[key])) schema[key] = schema[key].map((value: unknown) => inputSchema(value, document, depth + 1, next));
  return schema;
}
const fileSchema = () => ({ type: "string", format: "binary", maxLength: 500000 });
export const awsRestSourcePins = (): Record<string, string> => Object.fromEntries(Object.entries(awsRestContracts().sources).map(([id, source]) => [id, source.sha256]));

/** Keep the frozen operation identity while correcting its actual wire contract. */
export function bindAwsRest(document: Record<string, any>): void {
  const data = awsRestContracts(), matches = Object.entries(data.sources).filter(([, source]) => source.title === document.info?.title
    && source.version === document.info?.version && source.openapi === document.openapi);
  requireContract(matches.length === 1 && object(document.paths) && document["x-upstream-aws-rest-servers"] === undefined);
  const [catalog, source] = matches[0]!;
  requireContract(Array.isArray(document.servers) && document.servers.some((server: unknown) => JSON.stringify(server) === JSON.stringify(source.endpoint)));
  const plans = Object.entries(data.operations).filter(([, contract]) => contract.catalog === catalog).map(([id, contract]) => {
    const item = document.paths[contract.nativePath], operation = item?.[contract.nativeMethod.toLowerCase()];
    requireContract(object(item) && item.servers === undefined && object(operation) && `${catalog}:${operation.operationId}` === id
      && operation.servers === undefined && operation["x-operations-aws-signing"] === undefined
      && operation["x-upstream-aws-rest-parameters"] === undefined && operation["x-upstream-aws-rest-body"] === undefined
      && operation["x-upstream-aws-rest-responses"] === undefined);
    if (contract.path !== contract.nativePath || contract.method !== contract.nativeMethod)
      requireContract(!document.paths[contract.path]?.[contract.method.toLowerCase()]);
    const input = awsRestRoot(source, contract.input, contract.inputTraits), output = awsRestRoot(source, contract.output, contract.outputTraits);
    return { id, contract, item, operation, input, output };
  });
  document["x-upstream-aws-rest-servers"] = structuredClone(document.servers);
  document.servers = [structuredClone(source.endpoint)];
  for (const { id, contract, item, operation, input, output } of plans) {
    const parameters = operation.parameters ?? []; requireContract(Array.isArray(parameters));
    const kept = parameters.filter((raw: unknown) => { const parameter = resolve(raw, document);
      return parameter.in !== "header" || !awsSigningHeaders.has(String(parameter.name).toLowerCase()); });
    if (kept.length !== parameters.length) {
      operation["x-upstream-aws-rest-parameters"] = structuredClone(parameters); operation.parameters = kept;
    }
    if (id === "aws-s3control:CreateBucket") {
      requireContract(parameters.some((raw: unknown) => { const parameter = resolve(raw, document);
        return parameter.in === "header" && parameter.name.toLowerCase() === "x-amz-outpost-id"; }), id);
      operation["x-upstream-aws-rest-parameters"] ??= structuredClone(parameters);
      operation.parameters = (operation.parameters ?? parameters).map((raw: unknown) => {
        const parameter = resolve(raw, document);
        return parameter.in === "header" && parameter.name.toLowerCase() === "x-amz-outpost-id"
          ? { ...structuredClone(parameter), required: true } : raw;
      });
    }
    if (contract.path !== contract.nativePath || contract.method !== contract.nativeMethod || id === "aws-sesv2:ListRecommendations") {
      const body = resolve(operation.requestBody, document), media = body.content?.["application/json"]; requireContract(object(media));
      const shape = structuredClone(resolve(media.schema, document)); requireContract(object(shape.properties));
      const migrated = (operation.parameters ?? []).filter((raw: unknown) => {
        const parameter = resolve(raw, document); return parameter.in === "query" && ["PageSize", "NextToken"].includes(parameter.name);
      });
      if (operation["x-upstream-aws-rest-parameters"] === undefined) operation["x-upstream-aws-rest-parameters"] = structuredClone(operation.parameters ?? []);
      for (const raw of migrated) {
        const parameter = resolve(raw, document); requireContract(input.members?.[parameter.name] && !input.members[parameter.name]!.location);
        shape.properties[parameter.name] ??= structuredClone(parameter.schema);
      }
      operation.parameters = (operation.parameters ?? []).filter((parameter: unknown) => !migrated.includes(parameter));
      operation["x-upstream-aws-rest-body"] = structuredClone(operation.requestBody);
      operation.requestBody = { ...body, content: { "application/json": { ...media, schema: shape } } };
      if (contract.path !== contract.nativePath || contract.method !== contract.nativeMethod) {
        operation["x-upstream-aws-rest-route"] = { method: contract.nativeMethod, path: contract.nativePath };
        delete item[contract.nativeMethod.toLowerCase()];
        const common = Object.fromEntries(Object.entries(item).filter(([key]) => !methods.has(key)));
        document.paths[contract.path] = { ...common, ...document.paths[contract.path], [contract.method.toLowerCase()]: operation };
        if (!Object.keys(item).some(key => methods.has(key))) delete document.paths[contract.nativePath];
      }
    }
    if ((contract.wirePath || contract.xmlRequest) && source.protocol === "rest-xml" && operation.requestBody
      && !(input.payload && input.members?.[input.payload] && awsRestShape(source, input.members[input.payload]!).type === "blob")) {
      const body = resolve(operation.requestBody, document), entries = Object.entries(body.content ?? {});
      requireContract(entries.length === 1 && ["text/xml", "application/xml", "application/json"].includes(entries[0]![0]), id);
      const media = entries[0]![1]; requireContract(object(media), id);
      const schema = structuredClone(resolve(media.schema, document)); requireContract(object(schema.properties), id);
      operation["x-upstream-aws-rest-body"] ??= structuredClone(operation.requestBody);
      for (const [name, member] of Object.entries(input.members ?? {})) if (member.location === "headers") {
        const wire = member.locationName ?? name, key = Object.hasOwn(schema.properties, wire) ? wire : name;
        if (!Object.hasOwn(schema.properties, key)) continue;
        operation["x-upstream-aws-rest-parameters"] ??= structuredClone(operation.parameters ?? []);
        operation.parameters ??= [];
        requireContract(!operation.parameters.some((parameter: unknown) => { const p = resolve(parameter, document); return p.in === "header" && p.name.toLowerCase() === wire.toLowerCase(); }), id);
        operation.parameters.push({ name: wire, in: "header", required: input.required?.includes(name) === true, schema: schema.properties[key] });
        delete schema.properties[key];
        if (Array.isArray(schema.required)) schema.required = schema.required.filter((value: string) => value !== key);
      }
      const bodyMembers = Object.entries(input.members ?? {}).filter(([, member]) => !member.location);
      if (!input.payload && bodyMembers.length === 0) {
        requireContract(Object.keys(schema.properties).length === 0, id); delete operation.requestBody;
      } else {
        const required = new Set((input.required ?? []).filter(name => !input.members?.[name]?.location));
        if (Array.isArray(schema.required)) schema.required = schema.required.filter((key: string) => required.has(key)
          || bodyMembers.some(([name, member]) => member.locationName === key && required.has(name)));
        operation.requestBody = { ...body, required: required.size > 0, content: { "application/json": { ...media, schema } } };
      }
    }
    const payload = input.payload ? input.members?.[input.payload] : undefined;
    if (payload && awsRestShape(source, payload).type === "blob") {
      requireContract(operation["x-upstream-aws-rest-body"] === undefined && object(operation.requestBody));
      operation["x-upstream-aws-rest-body"] = structuredClone(operation.requestBody);
      operation.requestBody = { ...operation.requestBody, required: input.required?.includes(input.payload!) === true,
        content: { "application/octet-stream": { schema: fileSchema() } } };
    }
    const result = output.payload ? output.members?.[output.payload] : undefined, resolved = result ? awsRestShape(source, result) : undefined;
    if (resolved?.type === "blob" || resolved?.eventstream) {
      operation["x-upstream-aws-rest-responses"] = structuredClone(operation.responses);
      for (const [status, response] of Object.entries(operation.responses ?? {})) if (/^2\d\d$/.test(status)) {
        const content = (response as Record<string, any>).content; requireContract(object(content), id);
        const media = content["application/json"] ?? Object.values(content)[0]; requireContract(object(media), id);
        const schema = structuredClone(resolve(media.schema, document)); requireContract(object(schema.properties) && schema.properties[output.payload!], id);
        if (resolved.type === "blob") schema.properties[output.payload!] = fileSchema();
        else {
          const event = structuredClone(resolve(schema.properties[output.payload!], document)); requireContract(object(event.properties), id);
          for (const [name, member] of Object.entries(resolved.members ?? {})) {
            const shape = awsRestShape(source, member), eventPayload = Object.entries(shape.members ?? {}).find(([, member]) => member.eventpayload);
            if (eventPayload && awsRestShape(source, eventPayload[1]).type === "blob") {
              const child = structuredClone(resolve(event.properties[name], document)); requireContract(object(child.properties));
              child.properties[eventPayload[0]] = fileSchema(); event.properties[name] = child;
            }
          }
          schema.properties[output.payload!] = { type: "array", items: event };
        }
        media.schema = schema;
      }
    }
    if (operation.parameters) {
      if (operation["x-upstream-aws-rest-parameters"] === undefined) operation["x-upstream-aws-rest-parameters"] = structuredClone(operation.parameters);
      const bodyParameters: { name: string; schema: unknown; required: boolean }[] = [];
      operation.parameters = operation.parameters.flatMap((raw: unknown) => {
        const parameter = resolve(raw, document);
        const location = ({ path: "uri", query: "querystring", header: "header" } as Record<string, string>)[parameter.in];
        const named = Object.entries(input.members ?? {}).filter(([name, member]) => parameter.name === (member.locationName ?? name)
          || parameter.name === name || String(parameter.name).toLowerCase() === (member.locationName ?? name).toLowerCase());
        // Generated catalogs sometimes expose a literal SDK subresource as an
        // editable parameter. Its pinned value is supplied by the wire contract.
        if (parameter.in === "query" && contract.fixedQuery?.some(([name]) => name === parameter.name)
          && !named.some(([, member]) => member.location === "querystring")) return [];
        const matches = named.filter(([, member]) => member.location === location || location === "header" && member.location === "headers");
        const bodyMatch = named.filter(([, member]) => !member.location);
        if (!matches.length && parameter.in === "query" && bodyMatch.length === 1) {
          const getBody = id === "aws-elasticfilesystem:DescribeAccountPreferences" && contract.method === "GET";
          requireContract(source.protocol === "rest-json" && !input.payload && (getBody || !["GET", "HEAD", "DELETE"].includes(contract.method)), id);
          const [name, member] = bodyMatch[0]!;
          bodyParameters.push({ name: member.locationName ?? name, schema: parameter.schema, required: input.required?.includes(name) === true });
          return [];
        }
        requireContract(matches.length === 1, `${id}: ${parameter.in} parameter ${JSON.stringify(parameter.name)}`);
        const [name, member] = matches[0]!;
        const wire = member.locationName ?? name;
        // Some generated packs append generic pagination placeholders beside the
        // real SDK wire declaration. Keep its constraints, rather than two aliases.
        const pagination = ["Pagination limit", "Pagination token"].includes(parameter.description)
          && parameter.name === name && parameter.required === false
          && object(parameter.schema) && parameter.schema.type === "string" && Object.keys(parameter.schema).length === 1;
        if (pagination && (operation.parameters as unknown[]).some(other => {
          const candidate = resolve(other, document);
          return other !== raw && candidate.in === parameter.in && candidate.name === wire
            && candidate.description !== parameter.description;
        })) return [];
        const schema = parameter.schema ? inputSchema(parameter.schema, document) : undefined;
        if (member.location === "headers") {
          requireContract(schema?.type === "object" && parameter.in === "header" && parameter.content === undefined, id);
          return [{ ...parameter, name: wire, schema: { type: "string", maxLength: 65536 },
            description: (parameter.description ?? "") + " Enter a JSON object of string metadata values; names are appended to " + wire + "." }];
        }
        if (id === "aws-runtime-sagemaker:InvokeEndpoint" && member.location === "header" && wire.toLowerCase() === "x-amzn-sagemaker-custom-attributes") {
          // The source explicitly requires visible US-ASCII. Its unanchored
          // \p{ASCII}* expression otherwise matches the empty substring of anything.
          requireContract(schema?.type === "string" && schema.pattern === "\\p{ASCII}*" && schema.maxLength === 1024, id);
          schema.pattern = "^[\\x20-\\x7e]*$(?![\\s\\S])";
        }
        if (member.location === "querystring" && awsRestShape(source, member).type === "map") {
          requireContract(object(schema) && schema.type === "object" && parameter.content === undefined, id);
          // The editor accepts structured JSON; the qualified AWS codec expands
          // its map into separate query keys, as the pinned REST SDK does.
          const { schema: _schema, style: _style, explode: _explode, ...metadata } = parameter;
          return [{ ...metadata, name: wire, content: { "application/json": { schema } } }];
        }
        return [{ ...parameter, name: wire, ...(schema ? { schema } : {}) }];
      });
      if (bodyParameters.length) {
        if (operation["x-upstream-aws-rest-body"] === undefined) operation["x-upstream-aws-rest-body"] = structuredClone(operation.requestBody ?? null);
        const body = operation.requestBody ? resolve(operation.requestBody, document) : {};
        const media = body.content?.["application/json"] ?? {}, schema = media.schema ? structuredClone(resolve(media.schema, document)) : { type: "object", properties: {} };
        requireContract(object(schema.properties), id); const required = new Set<string>(schema.required ?? []);
        for (const parameter of bodyParameters) { schema.properties[parameter.name] ??= structuredClone(parameter.schema); if (parameter.required) required.add(parameter.name); }
        if (required.size) schema.required = [...required];
        operation.requestBody = { ...body, required: body.required === true || bodyParameters.some(parameter => parameter.required),
          content: { "application/json": { ...media, schema } } };
      }
    }
    if (operation.requestBody) {
      if (operation["x-upstream-aws-rest-body"] === undefined) operation["x-upstream-aws-rest-body"] = structuredClone(operation.requestBody);
      const body = resolve(operation.requestBody, document);
      if (id === "aws-elasticfilesystem:DescribeAccountPreferences") requireContract(!input.payload && !input.required?.length, id);
      operation.requestBody = { ...body, ...(id === "aws-elasticfilesystem:DescribeAccountPreferences" ? { required: false } : {}),
        content: Object.fromEntries(Object.entries(body.content).map(([type, raw]) => {
        requireContract(object(raw), id); return [type, { ...raw, schema: inputSchema(raw.schema, document) }];
      })) };
    }
    operation["x-operations-aws-signing"] = awsRestSigningProfile;
    if (Object.hasOwn(awsRestPrivateResultPaths, id)) operation["x-operations-credential-result"] = true;
  }
}
