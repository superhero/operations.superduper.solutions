// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { After, Before, Then } from "@cucumber/cucumber";
import { catalogs, replaceCatalogs } from "./lib/catalog-registry.ts";
import { responseHeaderReader } from "./lib/workflow-response.ts";

Before({ tags: "@workflow-response" }, function () {
  this.responseCatalogs = catalogs;
});

After({ tags: "@workflow-response" }, function () {
  replaceCatalogs(this.responseCatalogs);
});

function schemaContext(response = { headers: {} }) {
  const document = { paths: { "/projects/{projectId}": { get: { responses: { 200: response } } } }, components: {} };
  replaceCatalogs([{ ...catalogs.find(catalog => catalog.id === "demo"), document }]);
  return document;
}
function read(schema, value, header = {}) {
  schemaContext({ headers: { "X-Value": { schema, ...header } } });
  return responseHeaderReader("demo:getProject", 200, { "x-value": value })("X-Value");
}

Then("response headers preserve strings and decode null enum and constant values", () => {
  assert.equal(read({}, "raw"), "raw");
  assert.equal(read({ type: "null" }, "null"), null);
  assert.throws(() => read({ type: "null" }, "missing"), /expected null/);
  assert.equal(read({ type: "string", enum: ["yes"] }, "yes"), "yes");
  assert.throws(() => read({ type: "string", enum: ["yes"] }, "no"), /not permitted/);
  assert.equal(read({ type: "string", const: "yes" }, "yes"), "yes");
  assert.throws(() => read({ type: "string", const: "yes" }, "no"), /not permitted/);
  assert.deepEqual(read({ type: "array", items: { type: "string" } }, ""), []);
  assert.deepEqual(read({ type: "array", items: { type: "string" } }, "a,b", { style: "simple" }), ["a", "b"]);
  assert.throws(() => read({ anyOf: [] }, "x"), /combined header/);
  assert.throws(() => read({ type: "array", items: { anyOf: [] } }, "x"), /combined header/);
  assert.throws(() => read({ type: "string" }, "x", { style: "form" }), /only simple/);
});

Then("simple header objects validate names required properties and flat property types", () => {
  assert.deepEqual(read({ properties: { named: { type: "string" } } }, "named,value,other,raw"), { named: "value", other: "raw" });
  assert.deepEqual(read({ type: "object" }, ""), {});
  assert.deepEqual(read({ type: "object", required: ["named", 9] }, "named,value"), { named: "value" });
  assert.throws(() => read({ type: "object", required: ["missing"] }, ""), /is missing/);
  assert.throws(() => read({ type: "object", additionalProperties: false }, "extra,value"), /not permitted/);
  assert.throws(() => read({ type: "object" }, "a,1,a,2"), /duplicate property/);
  assert.throws(() => read({ type: "object" }, "missing", { explode: true }), /name=value/);
});

Then("response header references fail safely when cyclic malformed external or absent", () => {
  const document = schemaContext();
  for (const reference of ["https://example.test/schema", "#/components/~q", 4, "#/components/Cycle", "#/components/Absent", "#/components/Scalar/nested"]) {
    document.components = { Cycle: { $ref: "#/components/Cycle" }, Scalar: 1 };
    document.paths["/projects/{projectId}"].get.responses[200].headers = { "X-Value": { schema: { $ref: reference } } };
    assert.throws(() => responseHeaderReader("demo:getProject", 200, { "x-value": "a" })("X-Value"), /schema.*(unavailable|recursive)/);
  }
});

Then("header decoding uses response ranges and defaults while undeclared metadata stays raw", () => {
  const document = schemaContext();
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
