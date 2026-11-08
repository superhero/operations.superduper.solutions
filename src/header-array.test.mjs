// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { extractOperations } from "./lib/catalog.ts";
import { inspectServiceSchema } from "./lib/service-catalog.ts";
import { prepareRequest, InputValidationError } from "./lib/operation-input.ts";
import { readServiceSchema } from "./lib/service-schema-packs.ts";
import { approvedOperation } from "./lib/secrets/policy.ts";
import { executeCredentialed } from "./lib/secrets/execution.ts";
import { decodeAwsRestResponse } from "./lib/aws-rest-codec.ts";
import { awsSyntheticValues, verifyAwsSignature } from "../tests/aws-sigv4.fixture.mjs";
function fixture(parameter = {}, items = { type: "string" }) {
  return { openapi: "3.0.3", info: { title: "Header arrays", version: "1" }, servers: [{ url: "https://example.test" }],
    paths: { "/objects": { get: { operationId: "headers", summary: "Headers", parameters: [
      { name: "X-Fields", in: "header", schema: { type: "array", items }, ...parameter }],
      responses: { "200": { description: "Success" } } } } } };
}
const models = document => [extractOperations(document, "fixture")[0], inspectServiceSchema(document, "fixture").operations[0]];
Then("primitive header arrays use comma delimiters without URL escaping in both explode modes", () => {
  for (const style of [undefined, "simple"]) for (const explode of [undefined, false, true]) {
    const document = fixture({ ...(style ? { style } : {}), ...(explode === undefined ? {} : { explode }) });
    for (const operation of models(document)) {
      assert.equal(operation.unavailableReason, undefined);
      const request = prepareRequest(operation, { "header:X-Fields": '["name","literal%2Fvalue","a/b"]' });
      assert.equal(request.headers["X-Fields"], "name,literal%2Fvalue,a/b");
      assert.equal(prepareRequest(operation, {}).headers, undefined);
      assert.equal(prepareRequest(operation, { "header:X-Fields": "[]" }).headers["X-Fields"], "");
    }
  }
  for (const [type, value, expected] of [["integer", "[1,2]", "1,2"], ["boolean", "[true,false]", "true,false"]])
    for (const operation of models(fixture({}, { type }))) assert.equal(prepareRequest(operation, { "header:X-Fields": value }).headers["X-Fields"], expected);
});
Then("header array validation identifies the offending parameter without accepting complex or unsafe values", () => {
  for (const document of [fixture({ style: "form" }), fixture({ explode: "false" }), fixture({ allowReserved: true }),
    fixture({ allowEmptyValue: true }), fixture({}, { type: "string", nullable: true }), fixture({}, { type: "object", properties: {} }),
    fixture({}, { type: "array", items: { type: "string" } }), fixture({}, { type: "string", format: "binary" })]) {
    assert.throws(() => extractOperations(document, "fixture"), /X-Fields/);
    const operation = inspectServiceSchema(document, "fixture").operations[0];
    assert.ok(operation.unavailableReason, JSON.stringify(document.paths["/objects"].get.parameters[0]));
    assert.ok(operation.capabilities.issues.some(issue => issue.message.includes("X-Fields")));
  }
  for (const operation of models(fixture())) for (const value of ['["a,b"]', '["line\\nbreak"]', '["a\\u0000b"]', "[null]", "[{}]"])
    assert.throws(() => prepareRequest(operation, { "header:X-Fields": value }),
      error => error instanceof InputValidationError && error.fieldKey === "header:X-Fields");
});
Then("native ListObjects retains its identity signs RestoreStatus and decodes ListBucketResult", async () => {
  const document = await readServiceSchema("aws-s3"), selected = new Set(["aws-s3:ListObjects"]);
  const operation = inspectServiceSchema(document, "aws-s3", selected).operations[0];
  assert.equal(operation.id, "aws-s3:ListObjects"); assert.equal(operation.path, "/{Bucket}"); assert.equal(operation.method, "GET");
  assert.equal(operation.unavailableReason, undefined);
  const scoped = structuredClone(document); scoped.paths = { "/{Bucket}": { get: document.paths["/{Bucket}"].get } };
  assert.equal(extractOperations(scoped, "aws-s3")[0].id, operation.id);
  const descriptor = await approvedOperation(operation, "https://s3.us-east-1.amazonaws.com"), records = [], references = {};
  for (const [part, value] of Object.entries(awsSyntheticValues)) {
    references[part] = crypto.randomUUID(); records.push({ id: references[part], label: part, value, kind: "secret", grants: [] });
  }
  const binding = { alternative: 0, fingerprint: descriptor.fingerprint, credentials: { [operation.security[0][0].name]: references } };
  const xml = '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>fixture-bucket</Name><Prefix/><Marker/><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated><Contents><Key>λ &amp; β.txt</Key><LastModified>2026-11-05T12:00:00Z</LastModified><Size>42</Size><StorageClass>STANDARD</StorageClass><RestoreStatus><IsRestoreInProgress>false</IsRestoreInProgress><RestoreExpiryDate>2026-12-01T12:00:00Z</RestoreExpiryDate></RestoreStatus></Contents></ListBucketResult>';
  let calls = 0;
  const result = await executeCredentialed(descriptor, { "path:Bucket": "fixture-bucket", "header:x-amz-optional-object-attributes": '["RestoreStatus"]',
    "query:prefix": "reports/λ?x=1&y=2" }, binding, records, { assertCurrent() {},
    async fetchRequest(address, init) {
      calls++; verifyAwsSignature(address, init, awsSyntheticValues, "s3", "us-east-1");
      assert.equal(new Headers(init.headers).get("x-amz-optional-object-attributes"), "RestoreStatus");
      assert.equal(new URL(address).pathname, "/fixture-bucket"); assert.equal(new URL(address).searchParams.get("prefix"), "reports/λ?x=1&y=2");
      assert.equal(init.body, null);
      return new Response(xml, { headers: { "Content-Type": "application/xml", "x-amz-request-charged": "requester" } });
    } });
  assert.equal(calls, 1); assert.equal(result.response.body.Name, "fixture-bucket"); assert.equal(result.response.body.IsTruncated, false);
  assert.equal(result.response.body.Contents[0].Key, "λ & β.txt"); assert.equal(result.response.body.Contents[0].Size, 42);
  assert.equal(result.response.body.Contents[0].RestoreStatus.IsRestoreInProgress, false);
  assert.equal(result.response.body.Contents[0].RestoreStatus.RestoreExpiryDate, "2026-12-01T12:00:00.000Z");
  assert.equal(result.response.body.RequestCharged, "requester");
  for (const value of Object.values(awsSyntheticValues)) assert.ok(!JSON.stringify(result).includes(value));
  assert.throws(() => prepareRequest(operation, { "path:Bucket": "fixture-bucket", "header:x-amz-optional-object-attributes": '["unknown"]' }), InputValidationError);
  assert.throws(() => decodeAwsRestResponse(operation, new TextEncoder().encode(xml.replaceAll("ListBucketResult", "Unexpected")), new Headers({ "Content-Type": "application/xml" }), 200),
    error => error.code === "CODEC");
});
