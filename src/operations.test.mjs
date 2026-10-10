// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { When, Then } from "@cucumber/cucumber";
import { extractOperations, operations } from "./lib/catalog.ts";
import { evaluateOperations, rankOperations } from "./lib/matching.ts";
import { InputValidationError, prepareRequest, validateInputValue } from "./lib/operation-input.ts";

const parameter = (schema = { type: "string" }, extra = {}) => ({ name: "value", in: "query", schema, ...extra });
const document = (operation = {}, item = {}) => ({ openapi: "3.1.0", paths: { "/items": { ...item, get: operation } } });
const withInput = schema => document({ parameters: [parameter(schema)] });
const withBody = (schema = { type: "object", properties: {} }, extra = {}) => document({ requestBody: {
  content: { "application/json": { schema } }, ...extra
} });
const get = id => operations.find(operation => operation.id === `demo:${id}`);
let failure;
let matches;

Then("the demo exposes four operations grouped as Projects and Tasks", function ()
{
  const demo = operations.filter(operation => operation.id.startsWith("demo:") && ["listProjects", "getProject", "createTask", "updateTask"].some(id => operation.id === `demo:${id}`));
  assert.equal(demo.length, 4);
  assert.deepEqual([...new Set(demo.map(operation => operation.group))], ["Projects", "Tasks"]);
  assert.deepEqual(demo.map(operation => operation.id), ["demo:listProjects", "demo:getProject", "demo:createTask", "demo:updateTask"]);
});

Then("preparing a demo task creates an encoded request preview without making a request", function ()
{
  assert.deepEqual(prepareRequest(get("createTask"), { "path:projectId": "project/a b", "body:title": "Write documentation", "body:priority": "normal", "body:estimate": "2.5" }), {
    method: "POST", path: "/projects/project%2Fa%20b/tasks", query: {}, body: { title: "Write documentation", priority: "normal", estimate: 2.5 }
  });
});

Then("catalog parameters preserve locations and operation overrides", function ()
{
  const doc = document({ summary: "Read items", description: "Inspect records", tags: [], parameters: [parameter({ type: "integer" }, { description: "An override" })] }, {
    summary: "Item operations", parameters: [parameter({ type: "string", description: "Original" })]
  });
  doc.paths["x-label"] = "Metadata";
  const [operation] = extractOperations(doc, "fixture");
  assert.equal(operation.id, "fixture:GET /items");
  assert.equal(operation.name, "Read items");
  assert.equal(operation.description, "Inspect records");
  assert.equal(operation.group, "Operations");
  assert.equal(operation.fields.length, 1);
  assert.equal(operation.fields[0].type, "integer");
  assert.equal(operation.fields[0].description, "An override");
  const [fallback] = extractOperations(document({ operationId: "readItems" }), "other");
  assert.equal(fallback.name, "readItems");
  assert.equal(extractOperations(document(), "other")[0].name, "GET /items");
});

Then("source names keep identical operation identifiers distinct", function ()
{
  assert.notEqual(extractOperations(document({ operationId: "read" }), "first")[0].id,
    extractOperations(document({ operationId: "read" }), "second")[0].id);
});

Then("local references resolve escaped names and chained references", function ()
{
  const doc = document({ parameters: [parameter({ $ref: "#/components/schemas/A~1B~0C" })] });
  doc.components = { schemas: { "A/B~C": { $ref: "#/components/schemas/Text" }, Text: { type: "string", minLength: 0, maxLength: 10 } } };
  assert.equal(extractOperations(doc, "fixture")[0].fields[0].maxLength, 10);
  const body = withBody();
  body.components = { request: body.paths["/items"].get.requestBody };
  body.paths["/items"].get.requestBody = { $ref: "#/components/request" };
  assert.deepEqual(extractOperations(body, "fixture")[0].fields, []);
});

Then("response previews use documented success examples only", function ()
{
  assert.equal(get("getProject").responseExample.name, "Documentation");
  const doc = document({ responses: {
    400: { content: { "application/json": { example: { error: "Invalid" } } } },
    202: { description: "Accepted" },
    203: { content: { "text/plain": { example: "Ignored" } } },
    204: { content: { "application/json": {} } },
    205: { content: { "application/json": { example: null } } }
  } });
  assert.equal(extractOperations(doc, "fixture")[0].responseExample, "Ignored");
  assert.equal(extractOperations(doc, "fixture")[0].responseMediaType, "text/plain");
  delete doc.paths["/items"].get.responses[203];
  delete doc.paths["/items"].get.responses[204];
  assert.equal(extractOperations(doc, "fixture")[0].responseExample, null);
  delete doc.paths["/items"].get.responses[205];
  assert.equal(extractOperations(doc, "fixture")[0].responseExample, undefined);
  doc.paths["/items"].get.responses[200] = { content: { "application/json": { schema: { $ref: "#/sample" } } } };
  doc.sample = { type: "string", example: "From a shared schema" };
  assert.equal(extractOperations(doc, "fixture")[0].responseExample, "From a shared schema");
});

const invalidCatalogs = {
  "a non-object document": () => [],
  "an unsupported version": () => ({ ...document(), openapi: "2.0" }),
  "an empty source": () => document(),
  "missing paths": () => ({ openapi: "3.0.3" }),
  "no operations": () => ({ openapi: "3.0.3", paths: {} }),
  "a remote reference": () => withInput({ $ref: "https://example.invalid/schema.json" }),
  "a cyclic reference": () => { const doc = withInput({ $ref: "#/loop" }); doc.loop = { $ref: "#/loop" }; return doc; },
  "a missing reference": () => withInput({ $ref: "#/missing" }),
  "a malformed reference escape": () => withInput({ $ref: "#/bad~3name" }),
  "reference sibling fields": () => withInput({ $ref: "#/item", description: "Unsupported override" }),
  "a numeric reference": () => withInput({ $ref: 1 }),
  "duplicate operation IDs": () => ({ openapi: "3.1.0", paths: { "/a": { get: { operationId: "same" }, post: { operationId: "same" } } } }),
  "non-array parameters": () => document({ parameters: {} }),
  "an unsupported location": () => document({ parameters: [parameter(undefined, { in: "cookie" })] }),
  "an unnamed parameter": () => document({ parameters: [parameter(undefined, { name: "" })] }),
  "an optional path parameter": () => document({ parameters: [parameter(undefined, { in: "path" })] }),
  "an invalid required flag": () => document({ parameters: [parameter(undefined, { required: "yes" })] }),
  "duplicate parameters": () => document({ parameters: [parameter(), parameter()] }),
  "a missing path parameter": () => ({ openapi: "3.1.0", paths: { "/items/{id}": { get: {} } } }),
  "an unused path parameter": () => document({ parameters: [parameter(undefined, { in: "path", required: true })] }),
  "missing array items": () => withInput({ type: "array" }),
  "an unsupported constraint": () => withInput({ type: "string", pattern: "a+" }),
  "an invalid enum type": () => withInput({ type: "string", enum: [1] }),
  "an empty enum": () => withInput({ type: "string", enum: [] }),
  "a fractional integer enum": () => withInput({ type: "integer", enum: [1.5] }),
  "a string length on a number": () => withInput({ type: "number", minLength: 1 }),
  "a fractional length": () => withInput({ type: "string", minLength: 1.5 }),
  "a negative length": () => withInput({ type: "string", maxLength: -1 }),
  "a nonnumeric limit": () => withInput({ type: "number", minimum: "1" }),
  "an infinite limit": () => withInput({ type: "number", minimum: Infinity }),
  "a numeric bound on text": () => withInput({ type: "string", maximum: 10 }),
  "conflicting numeric bounds": () => withInput({ type: "number", minimum: 10, maximum: 1 }),
  "conflicting text bounds": () => withInput({ type: "string", minLength: 10, maxLength: 1 }),
  "an unsupported media type": () => withBody(undefined, { content: { "application/xml": {} } }),
  "invalid body required": () => withBody(undefined, { required: "yes" }),
  "an unknown schema type": () => withBody({ type: "date" }),
  "dynamic body properties": () => withBody({ type: "object", properties: {}, additionalProperties: true }),
  "undeclared required fields": () => withBody({ type: "object", properties: {}, required: ["missing"] }),
  "invalid required fields": () => withBody({ type: "object", properties: {}, required: "value" }),
  "invalid operation tags": () => document({ tags: "Items" }),
  "blank operation tags": () => document({ tags: [""] })
};

When(/^the catalog contains (.+)$/, function (problem)
{
  failure = undefined;
  try { extractOperations(invalidCatalogs[problem](), problem === "an empty source" ? "" : "fixture"); }
  catch (error) { failure = error; }
});

Then("catalog loading fails mentioning {string}", function (reason)
{
  assert.ok(failure instanceof Error);
  assert.ok(failure.message.includes(reason), failure.message);
});

When("I search the demo operations for {string}", function (prompt)
{
  matches = rankOperations(prompt, operations);
});

Then("the first matching operation is {string}", function (identifier)
{
  assert.equal(matches[0].operation.id, identifier);
  assert.ok(matches[0].similarity > 0.5 && matches[0].similarity <= 1);
});

Then("empty and oversized searches return no operations", function ()
{
  for (const query of ["", "__--", "z".repeat(257)]) assert.deepEqual(rankOperations(query, operations), []);
  assert.deepEqual(rankOperations("List projects", []), []);
});

Then("equal matching scores are ordered by operation identifier", function ()
{
  const entries = Array.from({ length: 12 }, (_, index) => ({ ...operations[0], id: `fixture:${String(11 - index).padStart(2, "0")}` }));
  assert.deepEqual(rankOperations("List projects", entries).map(result => result.operation.id),
    Array.from({ length: 12 }, (_, index) => `fixture:${String(index).padStart(2, "0")}`));
});

Then("every operation above fifty percent is included once in descending similarity order", function ()
{
  const entries = Array.from({ length: 12 }, (_, index) => ({
    ...operations[0], id: `fixture:${index}`, name: ["abce", "abcd", "abcde"][index % 3]
  }));
  const results = rankOperations("abcd", entries);
  assert.equal(results.length, 12);
  assert.equal(new Set(results.map(result => result.operation.id)).size, 12);
  assert.deepEqual(results.map(result => result.similarity), [1, 1, 1, 1, 0.8, 0.8, 0.8, 0.8, 0.75, 0.75, 0.75, 0.75]);
});

Then("lower scoring operations fill the top five in identifier order for tied scores", function ()
{
  const entries = Array.from({ length: 12 }, (_, index) => ({
    ...operations[0], id: `fixture:${String(index).padStart(2, "0")}`, name: index === 0 ? "abcd" : index === 1 ? "abce" : "axyz"
  })).reverse();
  const results = rankOperations("abcd", entries);
  assert.deepEqual(results.map(result => result.operation.id),
    Array.from({ length: 5 }, (_, index) => `fixture:${String(index).padStart(2, "0")}`));
  assert.deepEqual(results.map(result => result.similarity), [1, 0.75, ...Array(3).fill(0.25)]);
});

Then("an exact fifty percent match is included only when it is in the top five", function ()
{
  const boundary = { ...operations[0], id: "fixture:boundary", name: "abef" };
  const alone = evaluateOperations("abcd", [boundary]);
  assert.equal(alone.candidates[0].similarity, 0.5);
  assert.deepEqual(alone.results, alone.candidates);
  const stronger = Array.from({ length: 5 }, (_, index) => ({ ...operations[0], id: `fixture:${index}`, name: "abcd" }));
  const crowded = evaluateOperations("abcd", [...stronger, boundary]);
  assert.equal(crowded.candidates[5].similarity, 0.5);
  assert.deepEqual(crowded.results.map(result => result.operation.id), stronger.map(operation => operation.id));
});

Then("evaluation retains every compared score and the exact proposed results", function ()
{
  const evaluation = evaluateOperations("List projects", operations);
  assert.equal(evaluation.candidates.length, operations.length);
  assert.equal(evaluation.candidates[0].similarity, 1);
  assert.ok(evaluation.candidates.some(candidate => candidate.similarity <= 0.5));
  assert.deepEqual(evaluation.results, rankOperations("List projects", operations));
  const unrelated = evaluateOperations("xylophone nebula", operations);
  assert.equal(unrelated.candidates.length, operations.length);
  assert.ok(unrelated.candidates.every(candidate => candidate.similarity <= 0.5));
  assert.deepEqual(unrelated.results, unrelated.candidates.slice(0, 5));
});

Then("text, numbers, booleans and enum inputs are converted correctly", function ()
{
  assert.deepEqual(prepareRequest(get("listProjects"), { "query:name": "Field notes", "query:limit": "10" }).query, { name: "Field notes", limit: 10 });
  for (const value of ["true", "false"])
    assert.equal(prepareRequest(get("updateTask"), { "path:taskId": "task1", "body:completed": value }).body.completed, value === "true");
  for (const [type, value] of [["integer", 2], ["number", 2.5], ["boolean", true]])
  {
    const [operation] = extractOperations(withInput({ type, enum: [value] }), "fixture");
    assert.equal(prepareRequest(operation, { "query:value": String(value) }).query.value, value);
  }
  const [decimal] = extractOperations(withInput({ type: "number" }), "fixture");
  for (const [raw, value] of [[".5", 0.5], ["01", 1], ["-0.5", -0.5], ["2e1", 20]])
    assert.equal(prepareRequest(decimal, { "query:value": raw }).query.value, value);
  for (const length of [70, 120]) {
    const title = "😀".repeat(length);
    assert.equal(prepareRequest(get("createTask"), { "path:projectId": "one", "body:title": title, "body:priority": "normal" }).body.title, title);
  }
  const doc = withBody({ type: "object", properties: JSON.parse('{"__proto__":{"type":"string"}}') });
  const request = prepareRequest(extractOperations(doc, "fixture")[0], { "body:__proto__": "literal" });
  assert.equal(request.body.__proto__, "literal");
  assert.equal(Object.getPrototypeOf(request.body), Object.prototype);
});

Then("absent optional bodies and fields stay absent", function ()
{
  assert.deepEqual(prepareRequest(get("listProjects"), {}), { method: "GET", path: "/projects", query: {} });
  const [optional] = extractOperations(withBody({ type: "object", properties: { title: { type: "string" } }, required: ["title"] }), "fixture");
  assert.equal(prepareRequest(optional, {}).body, undefined);
  assert.deepEqual(prepareRequest(optional, { "body:title": "Hello" }).body, { title: "Hello" });
  const [empty] = extractOperations(withBody(undefined, { required: true }), "fixture");
  assert.deepEqual(prepareRequest(empty, {}).body, {});
});

const invalidInputs = {
  "a missing required path": () => [get("getProject"), {}],
  "a missing required body": () => [get("createTask"), { "path:projectId": "one" }],
  "a blank required value": () => [get("createTask"), { "path:projectId": "one", "body:title": "  " }],
  "a fractional integer": () => [get("listProjects"), { "query:limit": "1.5" }],
  "an invalid numeric value": () => [get("listProjects"), { "query:limit": "no" }],
  "an infinite numeric value": () => [get("listProjects"), { "query:limit": "1e999" }],
  "a malformed exponent": () => [get("listProjects"), { "query:limit": "1e" }],
  "a malformed decimal": () => [get("listProjects"), { "query:limit": "1.2.3" }],
  "a long Unicode string": () => [get("updateTask"), { "path:taskId": "one", "body:title": "😀".repeat(121) }],
  "a hexadecimal number": () => [get("listProjects"), { "query:limit": "0xff" }],
  "a number below minimum": () => [get("listProjects"), { "query:limit": "0" }],
  "a number above maximum": () => [get("listProjects"), { "query:limit": "101" }],
  "a short string": () => [{ ...get("updateTask"), fields: [{ ...get("updateTask").fields[1], minLength: 2 }] }, { "body:title": "x" }],
  "a long string": () => [get("updateTask"), { "path:taskId": "one", "body:title": "x".repeat(121) }],
  "an unknown enum value": () => [get("updateTask"), { "path:taskId": "one", "body:priority": "urgent" }],
  "an invalid boolean value": () => [get("updateTask"), { "path:taskId": "one", "body:completed": "yes" }]
};

When(/^I prepare a request with (.+)$/, function (problem)
{
  failure = undefined;
  try { prepareRequest(...invalidInputs[problem]()); }
  catch (error) { failure = error; }
});

Then("preparation fails mentioning {string}", function (reason)
{
  assert.ok(failure instanceof InputValidationError);
  assert.ok(failure.fieldKey);
  assert.ok(failure.message.includes(reason), failure.message);
});

const bodyOperation = (schema, type = "application/json", required = true) => extractOperations(withBody(schema, {
  required, content: { [type]: { schema } }
}), "fixture")[0];
const inputOperation = (schema, extra = {}) => extractOperations(document({ parameters: [parameter(schema, extra)] }), "fixture")[0];

Then("both example schemas expose methods and body alternatives", function ()
{
  for (const source of ["demo", "httpbin"])
  {
    const bundled = operations.filter(operation => operation.id.startsWith(`${source}:`));
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
      assert.ok(bundled.some(operation => operation.method === method), `${source}: ${method}`);
    for (const type of ["application/json", "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"])
      assert.ok(bundled.some(operation => operation.bodyMediaType === type), `${source}: ${type}`);
    for (const type of ["string", "number", "integer", "boolean", "object", "array", "null"])
      assert.ok(bundled.some(operation => operation.fields.some(field => field.type === type)), `${source}: ${type}`);
  }
});

Then("request inputs preserve structured JSON, headers and query collections", function ()
{
  const [operation] = extractOperations(document({ parameters: [
    parameter({ type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 }, { name: "tag", style: "form", explode: true }),
    parameter({ type: "object", properties: { active: { type: "boolean" }, count: { type: "integer" } }, required: ["active"] }, { name: "filter", style: "deepObject", explode: true }),
    parameter({ type: "string" }, { name: "X-Example", in: "header", style: "simple", explode: false }),
    parameter({ type: "number" }, { name: "X-Count", in: "header" }),
    parameter({ type: "null", enum: [null] }, { name: "empty" })
  ] }), "fixture");
  assert.deepEqual(prepareRequest(operation, { "query:tag": '["a","b"]', "query:filter": '{"active":false,"count":2}', "header:X-Example": "test", "header:X-Count": "2", "query:empty": "null" }), {
    method: "GET", path: "/items", query: { tag: ["a", "b"], "filter[active]": false, "filter[count]": 2, empty: null }, headers: { "X-Example": "test", "X-Count": "2" }
  });
  assert.throws(() => prepareRequest(operation, { "header:X-Example": "a\nb" }), /line breaks/);
  const override = extractOperations(document({ parameters: [parameter({ type: "string" }, { name: "x-key", in: "header" })] }, {
    parameters: [parameter({ type: "integer" }, { name: "X-Key", in: "header" })]
  }), "fixture")[0];
  assert.equal(override.fields.length, 1);
  assert.equal(override.fields[0].name, "x-key");
  const nested = bodyOperation({ type: "object", properties: {
    details: { type: "object", properties: { name: { type: "string" }, note: { type: "null" } }, required: ["name"] },
    rows: { type: "array", items: { type: "array", items: { type: "integer" } } }
  } });
  assert.deepEqual(prepareRequest(nested, { "body:details": '{"name":"A","note":null}', "body:rows": "[[1,2],[]]" }).body,
    { details: { name: "A", note: null }, rows: [[1, 2], []] });
  const refs = withBody({ type: "object", properties: { details: { $ref: "#/detail" } } });
  refs.detail = { type: "object", properties: { name: { type: "string" } }, additionalProperties: false };
  assert.deepEqual(prepareRequest(extractOperations(refs, "fixture")[0], { "body:details": '{"name":"A"}' }).body, { details: { name: "A" } });
});

Then("request bodies preserve scalar JSON, plain text and form values", function ()
{
  for (const [schema, raw, expected] of [
    [{ type: "array", items: { type: "number" } }, "[1,2.5]", [1, 2.5]],
    [{ type: "string" }, "hello", "hello"], [{ type: "integer" }, "2", 2], [{ type: "number" }, "2.5", 2.5],
    [{ type: "boolean" }, "false", false], [{ type: "null" }, "null", null]
  ])
  {
    const operation = bodyOperation(schema);
    assert.equal(operation.bodyValue, true);
    assert.equal(operation.fields[0].label, "Request body");
    assert.deepEqual(prepareRequest(operation, { "body:$": raw }), { method: "GET", path: "/items", query: {}, body: expected });
    assert.throws(() => prepareRequest(operation, {}), /required/);
    assert.equal(prepareRequest(bodyOperation(schema, "application/json", false), {}).body, undefined);
  }
  const plain = bodyOperation({ type: "string", title: "Message" }, "text/plain");
  assert.equal(plain.fields[0].label, "Message");
  assert.deepEqual(prepareRequest(plain, { "body:$": "text\nwith whitespace" }), {
    method: "GET", path: "/items", query: {}, body: "text\nwith whitespace", contentType: "text/plain"
  });
  for (const type of ["application/x-www-form-urlencoded", "multipart/form-data"])
  {
    const operation = bodyOperation({ type: "object", properties: { title: { type: "string" }, count: { type: "integer" }, active: { type: "boolean" } }, required: ["title"] }, type);
    assert.deepEqual(prepareRequest(operation, { "body:title": "a&b", "body:count": "3", "body:active": "true" }), {
      method: "GET", path: "/items", query: {}, body: { title: "a&b", count: 3, active: true }, contentType: type
    });
  }
  const noExample = extractOperations(document({ responses: { 200: { content: { "text/plain": {} } } } }), "fixture")[0];
  assert.equal(noExample.responseMediaType, "text/plain");
  assert.equal(noExample.responseExample, undefined);
});

Then("unsupported structures and serializations fail during catalog loading", function ()
{
  const badSchemas = [
    [{ type: "object", properties: {}, enum: [{}] }, /unsupported schema fields/],
    [{ type: "array", items: { type: "string" }, minItems: -1 }, /invalid minItems/],
    [{ type: "array", items: { type: "string" }, minItems: 2, maxItems: 1 }, /minimum exceeds/],
    [{ type: "string", minItems: 1 }, /invalid minItems/],
    [{ type: "null", enum: ["null"] }, /enum values/],
    [{ type: "number", enum: [Infinity] }, /enum values/],
    [{ type: "array", items: { type: "string", format: "binary" } }, /unsupported schema fields/],
    [{ type: ["string", "null"] }, /unsupported input type/]
  ];
  for (const [schema, reason] of badSchemas) assert.throws(() => bodyOperation(schema), reason);
  const recursive = withBody({ type: "object", properties: { child: { $ref: "#/node" } } });
  recursive.node = recursive.paths["/items"].get.requestBody.content["application/json"].schema;
  assert.throws(() => extractOperations(recursive, "fixture"), /nesting exceeds/);
  for (const extra of [{ style: "spaceDelimited" }, { explode: false }, { explode: "true" }])
    assert.throws(() => inputOperation({ type: "array", items: { type: "string" } }, extra), /serialization/);
  for (const [schema, extra] of [
    [{ type: "array", items: { type: "object", properties: {} } }, {}],
    [{ type: "object", properties: { nested: { type: "array", items: { type: "string" } } } }, { style: "deepObject" }],
    [{ type: "array", items: { type: "string" } }, { in: "header" }],
    [{ type: "string" }, { in: "header", name: "invalid name" }],
    [{ type: "string" }, { in: "header", explode: true }]
  ]) assert.throws(() => inputOperation(schema, extra), /serialization|header name/);
  assert.throws(() => extractOperations(document({ parameters: [parameter(undefined, { in: "header", name: "X-Key" }), parameter(undefined, { in: "header", name: "x-key" })] }), "fixture"), /duplicate parameter/);
  assert.throws(() => inputOperation({ type: "object", properties: {} }), /serialization/);
  assert.throws(() => bodyOperation({ type: "number" }, "text/plain"), /string schema/);
  for (const type of ["application/x-www-form-urlencoded", "multipart/form-data"])
    for (const schema of [{ type: "array", items: { type: "string" } }, { type: "object", properties: { file: { type: "array", items: { type: "string" } } } }])
      assert.throws(() => bodyOperation(schema, type), /primitive text fields/);
  assert.throws(() => extractOperations(withBody(undefined, { content: { "application/json": {}, "text/plain": {} } }), "fixture"), /choose one supported/);
  assert.throws(() => extractOperations(withBody(undefined, { content: { "multipart/form-data": { schema: { type: "object", properties: {} }, encoding: {} } } }), "fixture"), /unsupported schema fields/);
});

Then("nested values enforce declared types, required fields and bounds", function ()
{
  const schema = { type: "array", minItems: 1, maxItems: 2, items: { type: "object", required: ["text"], properties: {
    text: { type: "string", minLength: 2, maxLength: 3, enum: ["ok", "yes"] },
    number: { type: "number", minimum: 1, maximum: 2 }, integer: { type: "integer" }, flag: { type: "boolean" }, empty: { type: "null" }
  } } };
  const operation = bodyOperation(schema);
  const field = operation.fields[0];
  const valid = [{ text: "ok", number: 1.5, integer: 2, flag: false, empty: null }];
  assert.doesNotThrow(() => validateInputValue(field, valid));
  assert.deepEqual(prepareRequest(operation, { "body:$": JSON.stringify(valid) }).body, valid);
  for (const [value, reason] of [
    [[], /item count/], [[{}, {}, {}], /item count/], [[{}], /required/],
    [[{ text: "ok", extra: 1 }], /not a declared property/], [[{ text: "x" }], /text length/], [[{ text: "xxxx" }], /text length/],
    [[{ text: "no" }], /allowed values/], [[{ text: "ok", number: 0 }], /allowed range/], [[{ text: "ok", number: 3 }], /allowed range/],
    [[{ text: "ok", integer: 1.2 }], /valid integer/], [[{ text: "ok", number: Infinity }], /valid number/],
    [[{ text: "ok", flag: "false" }], /valid boolean/], [[{ text: "ok", empty: false }], /valid null/],
    [[{ text: null }], /valid string/], [[null], /valid object/], [[[]], /valid object/], [[false], /valid object/], [{}, /valid array/]
  ]) assert.throws(() => validateInputValue(field, value), reason);
  assert.throws(() => prepareRequest(operation, { "body:$": "invalid JSON" }), /valid JSON/);
  assert.throws(() => prepareRequest(bodyOperation({ type: "null" }), { "body:$": "false" }), /valid null/);
  const numberField = inputOperation({ type: "number", minimum: 0, maximum: 5 }).fields[0];
  assert.doesNotThrow(() => validateInputValue(numberField, 2));
  assert.throws(() => validateInputValue(numberField, "2"), /valid number/);
  const enumField = inputOperation({ type: "null", enum: [null] }).fields[0];
  assert.doesNotThrow(() => validateInputValue(enumField, null));
  const obj = bodyOperation({ type: "object", properties: { child: { type: "object", properties: JSON.parse('{"__proto__":{"type":"string"}}') } } });
  const result = prepareRequest(obj, { "body:child": '{"__proto__":"literal"}' });
  assert.equal(result.body.child.__proto__, "literal");
  assert.equal(Object.getPrototypeOf(result.body.child), Object.prototype);
});
