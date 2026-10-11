// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogs, replaceCatalogs } from "../src/lib/catalog-registry.ts";
import { responseHeaderReader } from "../src/lib/workflow-response.ts";

const originals = new WeakMap();
function schemaContext(t, response = { headers: {} }) {
  if (!originals.has(t)) {
    originals.set(t, catalogs);
    t.after(() => replaceCatalogs(originals.get(t)));
  }
  const document = { paths: { "/projects/{projectId}": { get: { responses: { 200: response } } } }, components: {} };
  replaceCatalogs([{ ...catalogs.find(catalog => catalog.id === "demo"), document }]);
  return document;
}
function read(t, schema, value, header = {}) {
  schemaContext(t, { headers: { "X-Value": { schema, ...header } } });
  return responseHeaderReader("demo:getProject", 200, { "x-value": value })("X-Value");
}

test("response headers preserve strings and decode null enum and constant values", t => {
  assert.equal(read(t, {}, "raw"), "raw");
  assert.equal(read(t, { type: "null" }, "null"), null);
  assert.throws(() => read(t, { type: "null" }, "missing"), /expected null/);
  assert.equal(read(t, { type: "string", enum: ["yes"] }, "yes"), "yes");
  assert.throws(() => read(t, { type: "string", enum: ["yes"] }, "no"), /not permitted/);
  assert.equal(read(t, { type: "string", const: "yes" }, "yes"), "yes");
  assert.throws(() => read(t, { type: "string", const: "yes" }, "no"), /not permitted/);
  assert.deepEqual(read(t, { type: "array", items: { type: "string" } }, ""), []);
  assert.deepEqual(read(t, { type: "array", items: { type: "string" } }, "a,b", { style: "simple" }), ["a", "b"]);
  assert.throws(() => read(t, { anyOf: [] }, "x"), /combined header/);
  assert.throws(() => read(t, { type: "array", items: { anyOf: [] } }, "x"), /combined header/);
  assert.throws(() => read(t, { type: "string" }, "x", { style: "form" }), /only simple/);
});

test("simple header objects validate names required properties and flat property types", t => {
  assert.deepEqual(read(t, { properties: { named: { type: "string" } } }, "named,value,other,raw"), { named: "value", other: "raw" });
  assert.deepEqual(read(t, { type: "object" }, ""), {});
  assert.deepEqual(read(t, { type: "object", required: ["named", 9] }, "named,value"), { named: "value" });
  assert.throws(() => read(t, { type: "object", required: ["missing"] }, ""), /is missing/);
  assert.throws(() => read(t, { type: "object", additionalProperties: false }, "extra,value"), /not permitted/);
  assert.throws(() => read(t, { type: "object" }, "a,1,a,2"), /duplicate property/);
  assert.throws(() => read(t, { type: "object" }, "missing", { explode: true }), /name=value/);
});

test("response header references fail safely when cyclic malformed external or absent", t => {
  const document = schemaContext(t);
  for (const reference of ["https://example.test/schema", "#/components/~q", 4, "#/components/Cycle", "#/components/Absent", "#/components/Scalar/nested"]) {
    document.components = { Cycle: { $ref: "#/components/Cycle" }, Scalar: 1 };
    document.paths["/projects/{projectId}"].get.responses[200].headers = { "X-Value": { schema: { $ref: reference } } };
    assert.throws(() => responseHeaderReader("demo:getProject", 200, { "x-value": "a" })("X-Value"), /schema.*(unavailable|recursive)/);
  }
});

test("header decoding uses response ranges and defaults while undeclared metadata stays raw", t => {
  const document = schemaContext(t);
  const path = document.paths["/projects/{projectId}"].get;
  path.responses = { "2XX": { headers: { "X-Value": { schema: { type: "integer" } } } }, default: { headers: { "X-Value": { schema: { type: "boolean" } } } } };
  assert.equal(responseHeaderReader("demo:getProject", 202, { "x-value": "3" })("X-Value"), 3);
  assert.equal(responseHeaderReader("demo:getProject", 404, { "x-value": "true" })("X-Value"), true);
  path.responses = { 200: {} };
  assert.equal(responseHeaderReader("demo:getProject", 200, { "x-value": "3" })("X-Value"), "3");
  assert.equal(responseHeaderReader("demo:getProject", 202, { "x-value": "3" })("X-Value"), "3");
  delete path.responses;
  assert.equal(responseHeaderReader("demo:getProject", 200, { "x-value": "3" })("X-Value"), "3");
  assert.equal(responseHeaderReader("missing:operation", 200, { "x-value": "3" })("X-Value"), "3");
  delete document.paths;
  assert.equal(responseHeaderReader("demo:getProject", 200, { "x-value": "3" })("X-Value"), "3");
});
