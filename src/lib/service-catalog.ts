// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { credentialResultProfile, privateResultVersion, supportsCredentialResults } from "./credential-results.ts";
import { parameterContentSchema } from "./parameter-content.ts";
import { operationDisplayName } from "./operation-display.ts";
import { configureGitlabJsonForm } from "./gitlab-form.ts";
import { configureMistralVariant, mistralVariantRoute } from "./mistral-variant.ts";
import { configureGmailMessage } from "./gmail-message.ts";
import { cloudflareUploadProfile, configureCloudflareUpload } from "./cloudflare-upload.ts";
import { awsWireProfile, configureAwsWire, validAwsWireModel } from "./aws-wire.ts";
import { awsRestProfile, awsSigningMarker, lambdaSigningCandidate, configureAwsSigning, validAwsSigningModel } from "./aws-signing.ts";
import { awsRestSigningProfile, awsRestWirePath } from "./aws-rest.ts";
import { awsJsonSigningProfile, configureAwsJson, validAwsJsonModel } from "./aws-json.ts";
import { awsQuerySigningProfile, configureAwsQuery, validAwsQueryModel } from "./aws-query.ts";
import { configureS3Files, s3FilesProfile, validS3FilesModel } from "./s3-files.ts";
import type { BodyMediaType, InputField, InputSchema, Operation } from "./catalog.ts";
import type { CatalogGroup } from "./catalog-registry.ts";
import { inspectCodexSchema, isCodexSchema } from "./codex-schema.ts";
import { extractCredentialPermissions, extractOperationSecurity, inspectSecurityAlternatives, supportedSecurityAlternative } from "./operation-security.ts";
import { operationServerUrl, validateSchemaDocumentId } from "./schema-documents.ts";
import { ServerConfigurationRequiredError } from "./server-url.ts";
import { isBinaryMediaType, containsBinaryInput, validateBinarySchema } from "./workflow-binary.ts";
import { inspectResponseContent } from "./workflow-response-body.ts";
import { normalizeStringUnion, validateFormBody } from "./form-input.ts";
import { multipartBodySchema } from "./multipart-parts.ts";
import { responseStreamProfile } from "./workflow-response-stream.ts";
import { privatePathProfile } from "./server-url.ts";
import { dockerNativeReadOperation } from "./docker-native-model.ts";
import { withOperationCapabilities, type CapabilityIssue, type CapabilityArea } from "./operation-capabilities.ts";
import { acceptsScalarQueryExplode, configureQueryArray } from "./query-serialization.ts";
import { configureSimplePathArray, configureSimpleHeaderArray, parameterContext, validatePathParameters } from "./parameter-serialization.ts";
import { providerPathSecurity } from "./provider-path-bindings.ts";
import { isJsonRequestMediaType, isYamlRequestMediaType, isJsonLinesRequestMediaType } from "./request-media.ts";
import { literalQueryRoute } from "./literal-query.ts";

type Value = Record<string, unknown>;
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const primitives = ["string", "number", "integer", "boolean", "null"];
const annotation = new Set(["title", "description", "default", "example", "examples", "deprecated", "format", "externalDocs", "xml", "readOnly", "writeOnly"]);
const constraints = new Set(["type", "nullable", "enum", "const", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties", "propertyNames", "pattern", "properties", "required", "additionalProperties", "items"]);
const value = (input: unknown): Value => input && typeof input === "object" && !Array.isArray(input) ? input as Value : {};
const text = (input: unknown, fallback = ""): string => typeof input === "string" ? input : fallback;
const json = (): InputSchema => ({ type: "json" });

/** Two reviewed flat forms have 99 explicitly named pairs, not nested arrays.
 * Only this root gets 203 slots; children and every other schema keep 200. */
function formPropertyBudget(operation: Operation, schema: Value, document: Value): number {
  const contracts: Record<string, { path: string; ordinary: string[]; required: string[] }> = {
    "twilio:CreateSiprec": { path: "/2010-04-01/Accounts/{AccountSid}/Calls/{CallSid}/Siprec.json",
      ordinary: ["Name", "ConnectorName", "Track", "StatusCallback", "StatusCallbackMethod"], required: [] },
    "twilio:CreateStream": { path: "/2010-04-01/Accounts/{AccountSid}/Calls/{CallSid}/Streams.json",
      ordinary: ["Url", "Name", "Track", "StatusCallback", "StatusCallbackMethod"], required: ["Url"] },
  };
  const contract = contracts[operation.id];
  if (!contract || operation.method !== "POST" || operation.path !== contract.path
    || value(document.info).title !== "Twilio - Api" || value(document.info).version !== "1.0.0"
    || schema.type !== "object" || Object.keys(schema).some(key => !["type", "title", "properties", "required"].includes(key))) return 200;
  const names = [...contract.ordinary, ...Array.from({ length: 99 }, (_, index) => [`Parameter${index + 1}.Name`, `Parameter${index + 1}.Value`]).flat()];
  const properties = value(schema.properties);
  if (Object.keys(properties).length !== names.length || names.some(name => !Object.hasOwn(properties, name))
    || JSON.stringify(schema.required ?? []) !== JSON.stringify(contract.required)
    || names.some(name => resolve(properties[name], document).type !== "string")) return 200;
  return names.length;
}

/** Resolve schema references without expanding recursive models or discarding siblings. */
function resolve(input: unknown, document: Value): Value
{
  let result = value(input);
  const seen = new Set<string>();
  while (typeof result.$ref === "string")
  {
    const ref = result.$ref;
    if (!ref.startsWith("#/") || seen.has(ref)) return { type: "json" };
    seen.add(ref);
    const target = ref.slice(2).split("/").reduce<unknown>((parent, part) => {
      const object = parent && typeof parent === "object" ? parent as Value : {};
      const key = decodeURIComponent(part).replace(/~1/g, "/").replace(/~0/g, "~");
      return Object.hasOwn(object, key) ? object[key] : undefined;
    }, document);
    if (!target || typeof target !== "object") throw new Error(`Unresolved schema reference: ${ref}`);
    const { $ref: _ref, ...siblings } = result;
    if (Object.keys(siblings).some(key => !annotation.has(key) && !key.startsWith("x-"))) return { type: "json" };
    result = { ...value(target), ...siblings };
  }
  return result;
}

/** Keep familiar controls where their constraints are representable. Other JSON
 * Schema vocabularies remain in the source and use explicit server validation. */
function inputSchema(input: unknown, document: Value, depth: number, ancestors: Set<unknown>, binary: boolean, rootPropertyBudget = 200): InputSchema
{
  if (depth > 8 || ancestors.has(input)) return json();
  const shape = normalizeStringUnion(resolve(input, document), branch => resolve(branch, document));
  const variants = shape.anyOf ?? shape.oneOf;
  if (Array.isArray(variants) && variants.length === 2)
  {
    const nonNull = variants.filter(item => value(item).type !== "null");
    if (nonNull.length === 1) {
      const inner = inputSchema(nonNull[0], document, depth + 1, ancestors, binary);
      if (binary && (Object.keys(shape).some(key => !["anyOf", "oneOf"].includes(key) && !annotation.has(key) && !key.startsWith("x-"))
        || shape.format === "binary" && inner.format !== "binary")) throw new Error("Nullable form union constraints must remain on the non-null value branch.");
      return { ...inner, nullable: true };
    }
  }
  if (binary && Array.isArray(variants) && variants.length >= 2 && variants.length <= 32
    && Object.keys(shape).every(key => key === "anyOf" || key === "oneOf" || key === "discriminator" || annotation.has(key) || key.startsWith("x-"))) {
    const branches = variants.map(branch => inputSchema(branch, document, depth + 1, new Set([...ancestors, input]), binary));
    if (branches.every(branch => branch.type !== "json" || branch.anyOf !== undefined || branch.oneOf !== undefined))
      return { type: "json", [shape.anyOf === undefined ? "oneOf" : "anyOf"]: branches };
  }
  if (Object.keys(shape).some(key => !constraints.has(key) && !annotation.has(key) && !key.startsWith("x-"))) return json();
  const types = Array.isArray(shape.type) ? shape.type.filter(type => type !== "null") : [shape.type];
  const type = types.length === 1 ? types[0] : undefined;
  const inferred = type ?? (shape.properties ? "object" : shape.items ? "array" : typeof shape.const === "string" ? "string" : undefined);
  if (typeof inferred !== "string" || ![...primitives, "object", "array"].includes(inferred)) return json();
  if (shape.enum !== undefined && (!Array.isArray(shape.enum) || shape.enum.some(item => item !== null && !["string", "number", "boolean"].includes(typeof item)))) return json();
  if (Object.hasOwn(shape, "const") && shape.const !== null && !["string", "number", "boolean"].includes(typeof shape.const)) return json();
  const result: InputSchema = { type: inferred as InputSchema["type"] };
  for (const key of ["minProperties", "maxProperties"] as const) if (shape[key] !== undefined) {
    if (inferred !== "object" || typeof shape[key] !== "number" || !Number.isSafeInteger(shape[key]) || (shape[key] as number) < 0) return json();
    result[key] = shape[key] as number;
  }
  if (result.minProperties !== undefined && result.maxProperties !== undefined && result.minProperties > result.maxProperties) return json();
  if (shape.propertyNames !== undefined && inferred !== "object") return json();
  if (shape.uniqueItems !== undefined) {
    if (inferred !== "array" || typeof shape.uniqueItems !== "boolean") return json();
    result.uniqueItems = shape.uniqueItems;
  }
  if (binary && inferred === "string" && shape.format === "binary") result.format = "binary";
  if (shape.nullable === true || Array.isArray(shape.type) && shape.type.includes("null")) result.nullable = true;
  if (Array.isArray(shape.enum) && shape.enum.every(item => item === null || ["string", "number", "boolean"].includes(typeof item)))
    result.enum = shape.enum as NonNullable<InputSchema["enum"]>;
  if (Object.hasOwn(shape, "const") && (shape.const === null || ["string", "number", "boolean"].includes(typeof shape.const))) result.enum = [shape.const as string | number | boolean | null];
  if (result.format) validateBinarySchema(shape);
  for (const key of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"] as const)
    if (typeof shape[key] === "number" && Number.isFinite(shape[key])) result[key] = shape[key];
  if (typeof shape.pattern === "string")
  {
    try { new RegExp(shape.pattern, "u"); result.pattern = shape.pattern; } catch { return json(); }
  }
  const next = new Set([...ancestors, input]);
  if (inferred === "array") result.items = inputSchema(shape.items, document, depth + 1, next, binary);
  if (inferred === "object")
  {
    if (shape.propertyNames !== undefined) {
      result.propertyNames = inputSchema(shape.propertyNames, document, depth + 1, next, true);
      if (result.propertyNames.type !== "string" || result.propertyNames.format) return json();
    }
    const properties = Object.entries(value(shape.properties)).filter(([, property]) => resolve(property, document).readOnly !== true);
    if (properties.length > (depth === 0 ? rootPropertyBudget : 200)) return json();
    result.properties = Object.fromEntries(properties.map(([name, property]) => {
      try { return [name, inputSchema(property, document, depth + 1, next, binary)]; }
      catch (error) { throw new Error(`Field ${JSON.stringify(name)}: ${(error as Error).message}`, { cause: error }); }
    }));
    if (Array.isArray(shape.required) && shape.required.some(name => typeof name !== "string" || !Object.hasOwn(value(shape.properties), name))) return json();
    result.required = Array.isArray(shape.required) ? shape.required.filter((name): name is string => typeof name === "string" && Object.hasOwn(result.properties!, name)) : [];
    result.additionalProperties = typeof shape.additionalProperties === "boolean" ? shape.additionalProperties
      : shape.additionalProperties && Object.keys(value(shape.additionalProperties)).length ? inputSchema(shape.additionalProperties, document, depth + 1, next, binary) : true;
  }
  return result;
}

export function serviceInputSchema(input: unknown, document: Value, binary: boolean): InputSchema {
  return inputSchema(input, document, 0, new Set(), binary);
}

function field(name: string, location: InputField["location"], raw: unknown, required: boolean, document: Value, description: unknown, binary = false, schemaOverride?: InputSchema): InputField
{
  const schema = schemaOverride ?? inputSchema(raw, document, 0, new Set(), binary);
  const shape = resolve(raw, document);
  const defaultValue = required && location !== "body" && ["string", "number", "boolean"].includes(typeof shape.default)
    ? schema.type === "json" ? JSON.stringify(shape.default) : String(shape.default) : undefined;
  return { ...schema, schema, ...(defaultValue !== undefined ? { defaultValue } : {}), key: `${location}:${name}`, name, location, required,
    label: text(shape.title, name === "$" ? "Request body" : name.replace(/[_-]/g, " ").replace(/^./, letter => letter.toUpperCase())),
    description: [text(description, text(shape.description)), ...(schema.type === "json" ? ["Enter a JSON value. Advanced schema rules are validated by the API."] : [])].filter(Boolean).join("\n\n") };
}

/** OAuth access tokens use the existing bearer transport. Keep the original
 * scope requirements in the approved operation; no login flow is synthesized. */
export function serviceOperationSecurity(document: Value, source: Value, operation: Operation): Operation["security"]
{
  const declaration = source.security === undefined ? document.security : source.security;
  const permissionSource = Object.hasOwn(source, "x-credential-permissions") ? source
    : source.security === undefined ? document : {};
  if (!Array.isArray(declaration)) {
    const result = extractOperationSecurity(document, source);
    // With no security declaration, supplied permission metadata is rejected.
    // A valid permissions result requires an array declaration handled below.
    extractCredentialPermissions(permissionSource["x-credential-permissions"], result);
    return result;
  }
  const schemes = value(value(document.components).securitySchemes);
  const normalizedSchemes = { ...schemes };
  if (lambdaSigningCandidate(operation)) for (const [name, raw] of Object.entries(schemes)) {
    const definition = resolve(raw, document);
    if (definition["x-amazon-apigateway-authtype"] === "awsSigv4" && definition["x-operations-aws-sigv4"] === undefined)
      normalizedSchemes[name] = { ...definition, "x-operations-aws-sigv4": awsRestProfile };
  }
  let oauth = false;
  const requirements = declaration.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Security requirements must be objects.");
    return Object.fromEntries(Object.entries(raw).map(([name, scopes]) => {
      const definition = resolve(schemes[name], document);
      if (definition.type !== "oauth2") return [name, scopes];
      if (!Array.isArray(scopes) || scopes.some(scope => typeof scope !== "string")) throw new Error("OAuth scopes must be strings.");
      oauth = true;
      Object.defineProperty(normalizedSchemes, name, { value: { type: "http", scheme: "bearer",
        ...(awsSigningMarker(definition) ? { "x-amazon-apigateway-authtype": definition["x-amazon-apigateway-authtype"] } : {}) }, enumerable: true, configurable: true });
      return [name, []];
    }));
  });
  if (oauth) operation.oauthScopes = declaration.map(raw => Object.fromEntries(Object.entries(raw).map(([name, scopes]) => [name, [...scopes as string[]]])));
  const result = inspectSecurityAlternatives({ ...document, components: { ...value(document.components), securitySchemes: normalizedSchemes } },
    { security: requirements, ...(source["x-operations-aws-signing"] === undefined ? {} : { "x-operations-aws-signing": source["x-operations-aws-signing"] }) });
  const permissions = extractCredentialPermissions(permissionSource["x-credential-permissions"], result);
  if (permissions) operation.credentialPermissions = permissions;
  return providerPathSecurity(document, operation.id, result);
}

export function inspectServiceSchema(document: Value, id: string, selected?: ReadonlySet<string>, location?: Pick<Operation, "path" | "method">): {
  document: Value; operations: Operation[]; name: string; serverUrl: string; groups: CatalogGroup[];
}
{
  validateSchemaDocumentId(id);
  if (isCodexSchema(document)) return inspectCodexSchema(document, id, selected);
  if (!/^3\.(0|1)\.\d+$/.test(text(document.openapi)) || typeof value(document.info).title !== "string" || !Object.keys(value(document.paths)).length)
    throw new Error("The service schema must declare OpenAPI 3.0/3.1, a title and HTTP paths.");
  const operations: Operation[] = [];
  const identities = new Set<string>();
  const groups = new Map<string, CatalogGroup>();
  let serverUrl = "";
  const paths = value(document.paths);
  for (const [path, rawItem] of location ? [[location.path, paths[location.path]] as const] : Object.entries(paths))
  {
    if (!path.startsWith("/")) continue;
    const item = resolve(rawItem, document);
    for (const [method, rawOperation] of location ? [[location.method.toLowerCase(), item[location.method.toLowerCase()]] as const] : Object.entries(item))
    {
      if (!methods.has(method)) continue;
      const source = value(rawOperation);
      const identity = `${id}:${text(source.operationId, `${method.toUpperCase()} ${path}`)}`;
      if (selected && !selected.has(identity)) continue;
      if (identities.has(identity)) throw new Error(`Duplicate service operation: ${identity}`);
      identities.add(identity);
      const group = Array.isArray(source.tags) ? text(source.tags[0], "Operations") : "Operations";
      const operation: Operation = { id: identity, name: text(source.summary, text(source.operationId, `${method.toUpperCase()} ${path}`)),
        description: text(source.description), group, method: method.toUpperCase(), path, fields: [], bodyRequired: false };
      if (source["x-operations-aws-signing"] === awsRestSigningProfile) operation.awsRest = awsRestSigningProfile;
      const jsonTarget = source["x-operations-aws-json"] === awsJsonSigningProfile;
      if (jsonTarget) { operation.awsJson = awsJsonSigningProfile; configureAwsJson(operation); }
      const queryTarget = source["x-operations-aws-query"] === awsQuerySigningProfile;
      if (queryTarget) { operation.awsQuery = awsQuerySigningProfile; configureAwsQuery(operation); }
      const sdkTarget = jsonTarget || queryTarget;
      operation.name = operationDisplayName(operation);
      const issues: CapabilityIssue[] = [];
      const inspect = (area: CapabilityArea, code: string, check: () => void): boolean => {
        try { check(); return true; }
        catch (error) { issues.push({ area, code, message: error instanceof Error ? error.message : String(error) }); return false; }
      };
      const docker = dockerNativeReadOperation(document, operation);
      if (docker) {
        Object.assign(operation, docker);
        try { serverUrl ||= operationServerUrl(document, operation); } catch { /* Native route has no implicit HTTP server. */ }
      } else {
        inspect("endpoint", "invalid-contract", () => {
          const profile = privatePathProfile(source["x-operations-private-path"]);
          if (profile) operation.privatePath = profile;
        });
        inspect("response", "invalid-contract", () => {
          if (source["x-operations-credential-result"] !== undefined) {
            if (source["x-operations-credential-result"] !== true) throw new Error("Credential result metadata must be true when present.");
            operation.credentialResult = true;
          }
          if (source["x-operations-private-result"] !== undefined) {
            if (source["x-operations-private-result"] !== privateResultVersion) throw new Error("Unknown private credential-result profile.");
            operation.credentialResultProfile = privateResultVersion; credentialResultProfile(operation);
          }
        });
        try {
          const url = operationServerUrl(document, operation);
          serverUrl ||= url;
          if (new URL(url).hostname === "no-default") throw new ServerConfigurationRequiredError("Configure this schema’s server URL for your account before running it.");
        } catch (error) {
          issues.push({ area: "endpoint", code: error instanceof ServerConfigurationRequiredError ? "configuration-required" : "invalid-contract",
            message: error instanceof Error ? error.message : String(error) });
        }
        let upload: ReturnType<typeof cloudflareUploadProfile>;
        let wire: ReturnType<typeof awsWireProfile>, s3: ReturnType<typeof s3FilesProfile>;
        inspect("request", "invalid-contract", () => {
          wire = awsWireProfile(source["x-operations-aws-wire"]);
          s3 = s3FilesProfile(source["x-operations-s3-files"]);
          upload = cloudflareUploadProfile(source["x-operations-cloudflare-upload"]);
          if (wire) configureAwsWire(operation, wire);
          else if (s3) configureS3Files(operation, s3);
          else if (upload) configureCloudflareUpload(operation, upload);
        });
        inspect("endpoint", "unsupported-contract", () => {
          configureMistralVariant(operation, source["x-operations-mistral-variant"], source["x-operations-response-stream"]);
          const wirePath = awsRestWirePath(operation) ?? mistralVariantRoute(operation)?.path ?? literalQueryRoute(path)?.path ?? path;
          if (!wire && !sdkTarget && (wirePath.includes("//") || /[\\?#\u0000-\u0020\u007f]/.test(wirePath))) throw new Error("This endpoint uses a path or transport that is not supported.");
        });
        if (!upload && !wire && !s3 && !sdkTarget) {
          let parametersValid = true;
          const parameterListsValid = inspect("request", "unsupported-contract", () => {
            const fields = new Map<string, InputField>();
            for (const parameters of [item.parameters, source.parameters])
            {
              if (parameters === undefined) continue;
              if (!Array.isArray(parameters)) throw new Error("Parameters must be an array.");
              for (const raw of parameters)
              {
                const valid = inspect("request", "unsupported-contract", () => {
                  const parameter = resolve(raw, document);
                  let input: InputField | undefined;
                  try {
                    const location = text(parameter.in);
                    if (!["path", "query", "header"].includes(location) || typeof parameter.name !== "string")
                      throw new Error("Only named path, query and header parameters are supported.");
                    const content = parameterContentSchema(parameter);
                    input = field(parameter.name, location as InputField["location"], content ?? parameter.schema, parameter.required === true, document, parameter.description,
                      !!content || location === "query" && parameter.explode === false
                        || location === "header" && resolve(parameter.schema, document).type === "array");
                    if (content) {
                      if (containsBinaryInput(input.schema!)) throw new Error("JSON content parameters cannot contain binary files.");
                      input.parameterContentType = "application/json";
                    }
                    else {
                      const style = location === "query" ? input.type === "object" ? "deepObject" : "form" : "simple";
                      const csv = configureQueryArray(input, parameter);
                      const scalarQuery = acceptsScalarQueryExplode(input, parameter);
                      const pathArray = configureSimplePathArray(input, parameter);
                      const headerArray = configureSimpleHeaderArray(input, parameter);
                      if (parameter.style !== undefined && parameter.style !== style
                        || parameter.explode !== undefined && parameter.explode !== (location === "query") && !csv && !pathArray && !headerArray && !scalarQuery
                        || location !== "query" && ["object", "array"].includes(input.type) && !pathArray && !headerArray)
                        throw new Error("Unsupported parameter serialization; use primitive values, simple path/header arrays or supported form/deepObject query parameters.");
                    }
                    fields.set(location === "header" ? input.key.toLowerCase() : input.key, input);
                  } catch (error) {
                    throw new Error(`${parameterContext(parameter, input?.type)}: ${(error as Error).message}`, { cause: error });
                  }
                });
                if (!valid) parametersValid = false;
              }
            }
            operation.fields = [...fields.values()];
          });
          parametersValid &&= parameterListsValid;
          inspect("request", "unsupported-contract", () => {
            if (source.requestBody !== undefined)
            {
              const body = resolve(source.requestBody, document);
              if (body.required !== undefined && typeof body.required !== "boolean") throw new Error("Request body required must be Boolean.");
              if (!body.content || typeof body.content !== "object" || Array.isArray(body.content)) throw new Error("Request body content must be an object of declared media types.");
              const content = value(body.content);
              if (!Object.keys(content).length) {
                if (body.required === true) throw new Error("Required request body has no declared media types.");
                return;
              }
              const binaryMediaTypes = Object.keys(content).filter(type => {
                const schema = resolve(value(content[type]).schema, document);
                return isBinaryMediaType(type) && schema.type === "string" && schema.format === "binary";
              });
              const mediaType = ["application/json", "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"].find(type => content[type])
                ?? Object.keys(content).find(isJsonRequestMediaType) ?? Object.keys(content).find(isYamlRequestMediaType)
                ?? Object.keys(content).find(isJsonLinesRequestMediaType) ?? binaryMediaTypes[0];
              if (!mediaType) throw new Error(`This request requires an unsupported binary or streaming media type. Declared request media types: ${Object.keys(content).join(", ")}.`);
              const schema = resolve(value(content[mediaType]).schema, document);
              const binary = mediaType === "multipart/form-data" || mediaType === "application/x-www-form-urlencoded" || binaryMediaTypes.includes(mediaType);
              const encodedForm = mediaType === "multipart/form-data" && (value(content[mediaType]).encoding !== undefined
                || schema.oneOf !== undefined || schema.$defs !== undefined);
              const compiled = encodedForm ? multipartBodySchema(schema, raw => resolve(raw, document), raw => serviceInputSchema(raw, document, true)) : undefined;
              const parsed = compiled?.schema ?? inputSchema(schema, document, 0, new Set(), binary || isYamlRequestMediaType(mediaType),
                mediaType === "application/x-www-form-urlencoded" ? formPropertyBudget(operation, schema, document) : 200);
              if (isYamlRequestMediaType(mediaType) && (value(content[mediaType]).encoding !== undefined
                || !binaryMediaTypes.includes(mediaType) && containsBinaryInput(parsed)))
                throw new Error("Structured YAML bodies cannot contain binary files or custom field encodings.");
              if (isJsonLinesRequestMediaType(mediaType) && value(content[mediaType]).encoding !== undefined)
                throw new Error("JSON Lines bodies cannot use custom field encodings.");
              operation.bodyRequired = body.required === true;
              operation.bodyMediaType = mediaType as BodyMediaType;
              operation.bodySchema = parsed;
              if (binaryMediaTypes.includes(mediaType)) {
                if (parsed.format !== "binary" || parsed.nullable || binaryMediaTypes.some(type => value(content[type]).encoding !== undefined))
                  throw new Error("This binary body requires an unsupported schema or custom encoding.");
                if (binaryMediaTypes.some(type => JSON.stringify(inputSchema(value(content[type]).schema, document, 0, new Set(), true)) !== JSON.stringify(parsed)))
                  throw new Error("Binary media alternatives must use the same file schema.");
                operation.binaryMediaTypes = binaryMediaTypes;
              }
              else if (mediaType === "application/x-www-form-urlencoded" && containsBinaryInput(parsed)) throw new Error("Binary fields require a raw file body or multipart/form-data.");
              if ((mediaType === "text/plain" || isJsonLinesRequestMediaType(mediaType)) && parsed.type !== "string")
                throw new Error(`${mediaType} requires a string schema.`);
              if (mediaType.endsWith("form-data") || mediaType.endsWith("form-urlencoded")) {
                const parts = validateFormBody(parsed, mediaType === "multipart/form-data", value(content[mediaType]).encoding, compiled?.mixed);
                if (Object.keys(parts).length) operation.multipartParts = parts;
              }
              if (parsed.type === "object" && !parsed.nullable)
                for (const [name, property] of Object.entries(compiled?.properties ?? value(schema.properties)))
                {
                  if (resolve(property, document).readOnly === true) continue;
                  operation.fields.push(field(name, "body", property, parsed.required!.includes(name), document, undefined, binary, encodedForm ? parsed.properties?.[name] : undefined));
                }
              else
              {
                operation.bodyValue = true;
                operation.fields.push(field("$", "body", schema, true, document, body.description, binary));
              }
            }
            configureGitlabJsonForm(operation, source["x-operations-gitlab-form"]);
            configureGmailMessage(operation, source["x-operations-gmail-message"]);
          });
          if (parametersValid) inspect("endpoint", "invalid-contract", () => validatePathParameters(path, operation.fields));
        }
        inspect("authentication", "invalid-contract", () => {
          const authorization = serviceOperationSecurity(document, source, operation);
          if (authorization !== undefined) operation.security = authorization;
          if (!wire && !s3 && !sdkTarget && authorization?.flat().some(scheme => scheme.kind === "aws-sigv4")) configureAwsSigning(operation);
          if (authorization?.length && !authorization.some(supportedSecurityAlternative)) issues.push({ area: "authentication", code: "unsupported-authentication",
            message: authorization.flat().find(scheme => scheme.kind === "unsupported")!.reason });
        });
        inspect("response", "unsupported-contract", () => {
          const responses = value(source.responses);
          const stream = responseStreamProfile(source["x-operations-response-stream"]);
          if (stream) operation.responseStream = stream;
          const responseContent = inspectResponseContent(responses, document, stream);
          if (responseContent) operation.responseContent = responseContent;
          const response = resolve(responses[Object.keys(responses).find(status => /^2\d\d$/.test(status)) ?? "default"], document);
          const content = value(response.content);
          const mediaType = content["application/json"] ? "application/json" : Object.keys(content)[0];
          if (mediaType) operation.responseMediaType = mediaType;
          const media = value(content[mediaType!]);
          if (media.example !== undefined) operation.responseExample = media.example;
          if (s3) configureS3Files(operation, s3);
          if (wire) configureAwsWire(operation, wire);
        });
        inspect("request", "unsupported-contract", () => {
          if ((wire || s3 || sdkTarget || operation.security?.flat().some(scheme => scheme.kind === "aws-sigv4"))
            && !(queryTarget ? validAwsQueryModel(operation) : jsonTarget ? validAwsJsonModel(operation) : wire ? validAwsWireModel(operation) : s3 ? validS3FilesModel(operation) : validAwsSigningModel(operation)))
            throw new Error("This AWS operation requires a supported REST request and JSON response profile.");
        });
        if (operation.credentialResultProfile) inspect("response", "invalid-contract", () => { credentialResultProfile(operation); });
        if (operation.credentialResult && !supportsCredentialResults(operation)) issues.push({ area: "response", code: "unsupported-contract", message: "This operation returns credentials. Its private result adoption contract has not been qualified." });
      }
      withOperationCapabilities(operation, issues);
      operations.push(operation);
      if (!groups.has(group)) groups.set(group, { id: `${id}:tag:${encodeURIComponent(group)}`, name: group, description: "", operationIds: [] });
      groups.get(group)!.operationIds!.push(identity);
    }
  }
  if (!operations.length) throw new Error("The service schema has no HTTP operations.");
  const name = text(value(document.info).title);
  return { document, operations, name, serverUrl, groups: [{ id, name, description: text(value(document.info).description), children: [...groups.values()] }] };
}
