// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { Then } from "@cucumber/cucumber";
import { awsSyntheticValues, verifyAwsSignature } from "../tests/aws-sigv4.fixture.mjs";
import { awsRestContracts, awsRestEndpoint } from "./lib/aws-rest.ts";
import { awsGetBodyProfile, awsGetBodyRegions } from "./lib/aws-get-body-contract.ts";
import { approvedOperation } from "./lib/secrets/policy.ts";
import { executeCredentialed } from "./lib/secrets/execution.ts";
import { createHttpConnection, resolveHttpConnection, httpConnectionReference, connectionCredentialIds } from "./lib/secrets/http-connections.ts";
import { signAwsRequest } from "./lib/secrets/aws-sigv4.ts";
import { fetchAwsGetBody } from "./lib/secrets/aws-get-body.ts";
import { createAwsGetBodyCompanion, forwardAwsGetBody } from "../companions/aws-get-body/host.mjs";
import { readServiceSchema, readServiceSchemaUpstream } from "./lib/service-schema-packs.ts";
import { inspectServiceSchema } from "./lib/service-catalog.ts";
import { encodeWorkflowBinary, validateWorkflowBinary } from "./lib/workflow-binary.ts";
import { bindAwsRest } from "./lib/aws-rest-bindings.ts";
import { VaultSession } from "./lib/secrets/session.ts";
import { VaultError } from "./lib/secrets/types.ts";
import { newVaultKey, recoveryKey, randomBase64, wrapVaultKey } from "./lib/secrets/crypto.ts";
import { sealSnapshot } from "./lib/secrets/format.ts";
import { prepareAwsRestRequest } from "./lib/aws-rest-codec.ts";
import { appendRequestQuery } from "./lib/query-serialization.ts";
import { vaultVariablePlaceholder } from "./lib/secrets/variables.ts";
import displayCorrections from "./lib/operation-display.json" with { type: "json" };
import { createOperationGraph } from "./lib/workflow-graph.ts";
import { validateWorkflowDocument, parseWorkflowDocument } from "./lib/workflow-document.ts";

async function nativeFixture(id) {
  const contract = awsRestContracts().operations[id]; assert.ok(contract, id);
  const source = awsRestContracts().sources[contract.catalog], document = await readServiceSchema(contract.catalog);
  const operation = inspectServiceSchema(document, contract.catalog, new Set([id])).operations.find(item => item.id === id);
  assert.ok(operation && !operation.unavailableReason, id);
  const origin = source.endpoint.url.replace(/\{([^{}]+)\}/g, (_, name) => source.endpoint.variables[name].default);
  const descriptor = await approvedOperation(operation, origin), reference = {}, records = [];
  for (const [part, value] of Object.entries(awsSyntheticValues)) {
    reference[part] = crypto.randomUUID(); records.push({ id: reference[part], label: part, value, kind: "secret", grants: [] });
  }
  const binding = { alternative: 0, fingerprint: descriptor.fingerprint, credentials: { [operation.security[0][0].name]: reference } };
  const input = Object.fromEntries(operation.fields.filter(field => field.required && field.location !== "body")
    .map(field => [field.key, field.type === "integer" || field.type === "number" ? "1" : "fixture"]));
  for (const field of operation.fields.filter(field => field.location === "body" && field.format === "binary"))
    input[field.key] = JSON.stringify(encodeWorkflowBinary("request.bin", new TextEncoder().encode("request λ"), "application/octet-stream"));
  return { descriptor, records, binding, input, contract, source };
}
function privateResult(result, extra = []) {
  for (const secret of [...Object.values(awsSyntheticValues), ...extra])
    assert.ok(!JSON.stringify(result).includes(secret), "Private value crossed the executor boundary");
}
Then("each of the fourteen native AWS REST providers signs its final request bytes independently", async () => {
  const selected = [
    ["aws-apigateway:GetAccount", '{"apiKeyVersion":"4"}'],
    ["aws-apigatewayv2:GetApis", '{"items":[]}'],
    ["aws-backup:ListBackupVaults", '{"BackupVaultList":[]}'],
    ["aws-batch:DescribeJobDefinitions", '{"jobDefinitions":[]}'],
    ["aws-cloudfront:GetDistribution2020_05_31", '<Distribution xmlns="http://cloudfront.amazonaws.com/doc/2020-05-31/"><Id>D1</Id></Distribution>', "text/xml"],
    ["aws-eks:ListClusters", '{"clusters":[]}'],
    ["aws-elasticfilesystem:DescribeFileSystems", '{"FileSystems":[]}'],
    ["aws-lambda:ListAliases", '{"Aliases":[]}'],
    ["aws-opensearch:ListDomainNames", '{"DomainNames":[]}'],
    ["aws-polly:DescribeVoices", '{"Voices":[]}'],
    ["aws-route53:ListHostedZones", '<ListHostedZonesResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/"><HostedZones/><Marker/><IsTruncated>false</IsTruncated><MaxItems>100</MaxItems></ListHostedZonesResponse>', "text/xml"],
    ["aws-runtime-sagemaker:InvokeEndpoint", "response λ", "application/octet-stream"],
    ["aws-s3:ListBuckets", '<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Buckets/></ListAllMyBucketsResult>', "application/xml"],
    ["aws-sesv2:GetAccount", '{"SendQuota":{"Max24HourSend":100}}'],
  ];
  const found = new Set();
  for (const [id, wireBody, media = "application/json"] of selected) {
    const f = await nativeFixture(id); let calls = 0;
    const result = await executeCredentialed(f.descriptor, f.input, f.binding, f.records, { assertCurrent() {},
      async fetchRequest(address, init) {
        calls++; assert.equal(init.method, f.contract.method); assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit");
        const context = awsRestEndpoint(f.descriptor.origin, f.descriptor.operation); assert.ok(context);
        verifyAwsSignature(address, init, awsSyntheticValues, context.service, context.region);
        if (f.descriptor.operation.id === "aws-runtime-sagemaker:InvokeEndpoint") assert.equal(new TextDecoder().decode(init.body), "request λ");
        return new Response(wireBody, { status: 200, headers: { "content-type": media } });
      } });
    assert.equal(calls, 1, id); assert.equal(result.response.status, 200); privateResult(result); found.add(f.contract.catalog);
    if (id === "aws-runtime-sagemaker:InvokeEndpoint") {
      const file = validateWorkflowBinary(result.response.body.Body); assert.equal(new TextDecoder().decode(Uint8Array.fromBase64(file.base64)), "response λ");
    }
    await assert.rejects(approvedOperation({ ...f.descriptor.operation, awsRestRevision: "0".repeat(64) }, f.descriptor.origin));
  }
  assert.equal(found.size, 14);
});

Then("native AWS REST credential producers adopt wire response leaves before exposing results", async () => {
  const issued = "ISSUED_PRIVATE_AWS_REST_5729", location = "https://downloads.example.test/archive?token=" + issued;
  const selected = [
    ["aws-apigateway:CreateApiKey", { id: "key", value: issued }],
    ["aws-apigateway:GetApiKey", { id: "key", value: issued }],
    ["aws-apigateway:GetApiKeys", { item: [{ id: "key", value: issued }] }],
    ["aws-apigateway:UpdateApiKey", { id: "key", value: issued }],
    ["aws-lambda:GetFunction", { Code: { Location: location } }],
    ["aws-lambda:GetLayerVersion", { Content: { Location: location } }],
  ];
  for (const [id, wireBody] of selected) {
    const f = await nativeFixture(id), acquired = [], responseId = crypto.randomUUID(); let calls = 0;
    const options = { assertCurrent() {}, async fetchRequest(address, init) {
      calls++; const context = awsRestEndpoint(f.descriptor.origin, f.descriptor.operation);
      verifyAwsSignature(address, init, awsSyntheticValues, context.service, context.region);
      return Response.json(wireBody, { status: f.contract.status });
    } };
    await assert.rejects(executeCredentialed(f.descriptor, f.input, f.binding, f.records, options), { code: "PERMISSION" }); assert.equal(calls, 0);
    const result = await executeCredentialed(f.descriptor, f.input, f.binding, f.records, { ...options,
      async adoptPrivateResults(values) { acquired.push(...values); return values.map(() => ({ credentialId: responseId, label: "Private AWS result" })); } });
    assert.equal(calls, 1, id); assert.equal(acquired.length, 1, id); assert.equal(acquired[0].value, id.startsWith("aws-lambda") ? location : issued);
    privateResult(result, [issued, location]); assert.ok(JSON.stringify(result).includes(responseId));
    if (id === "aws-apigateway:CreateApiKey") await assert.rejects(executeCredentialed(f.descriptor, { ...f.input, "body:value": issued },
      f.binding, f.records, { ...options, async adoptPrivateResults() { return []; } }), { code: "PERMISSION" });
  }
  const s3 = await nativeFixture("aws-s3:HeadObject");
  await assert.rejects(executeCredentialed(s3.descriptor, { ...s3.input, "header:x-amz-server-side-encryption-customer-key": issued },
    s3.binding, s3.records, { assertCurrent() {}, async fetchRequest() { assert.fail("A plaintext SSE key must not dispatch"); } }), { code: "PERMISSION" });
});

const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve("http://127.0.0.1:" + server.address().port)));
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
function localFetch(address, init) {
  return new Promise((resolve, reject) => {
    const call = httpRequest(address, { method: init.method, headers: Object.fromEntries(new Headers(init.headers)), signal: init.signal }, response => {
      const parts = []; response.on("data", part => parts.push(part)); response.on("error", reject);
      response.on("end", () => resolve(new Response(Buffer.concat(parts), { status: response.statusCode, headers: response.headers })));
    });
    call.on("error", reject); call.end(init.body);
  });
}
Then("the saved EFS companion connection forwards an actual signed GET body without exposing keys", async () => {
  const f = await nativeFixture("aws-elasticfilesystem:DescribeAccountPreferences"), pairingKey = "P".repeat(43);
  const pairingKeyId = crypto.randomUUID(); f.records.push({ id: pairingKeyId, label: "EFS pairing", kind: "secret", value: pairingKey, grants: [] });
  const connection = await createHttpConnection({ label: "EFS", account: "Fixture", format: "schema", relay: { host: "https://efs-companion.example.test", pairingKeyId } },
    f.descriptor, f.binding, f.records);
  f.records.find(record => record.id === connectionCredentialIds(connection)[0]).connections = [connection];
  const binding = { alternative: 0, fingerprint: f.descriptor.fingerprint, credentials: {}, connection: httpConnectionReference(connection) }, requests = [];
  const upstream = createServer((req, res) => { void (async () => {
    const parts = []; for await (const part of req) parts.push(part);
    requests.push({ method: req.method, headers: req.headers, body: Buffer.concat(parts) });
    res.writeHead(200, { "content-type": "application/json" }); res.end('{"NextToken":"next-page"}');
  })(); });
  const upstreamOrigin = await listen(upstream);
  const companion = createAwsGetBodyCompanion({ publicOrigin: connection.relay.host, pairingKey, allowedOrigins: ["https://operations.example.test"] },
    { request(address, options, callback) {
      assert.equal(address, f.descriptor.origin + f.descriptor.operation.path);
      return httpRequest(upstreamOrigin, options, callback);
    } });
  const server = createServer((req, res) => { void companion.handle(req, res); }), local = await listen(server);
  const transport = async (address, init) => {
    assert.equal(address, connection.relay.host + "/v1/efs/account-preferences");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer " + pairingKey);
    const payload = JSON.parse(init.body);
    assert.ok(!JSON.stringify(payload).includes(awsSyntheticValues.secretAccessKey));
    return localFetch(local + "/v1/efs/account-preferences", { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)),
      Host: "efs-companion.example.test", Origin: "https://operations.example.test" } });
  };
  try {
    const input = { "body:MaxResults": "2", "body:NextToken": "page-λ" };
    const result = await executeCredentialed(f.descriptor, input, binding, f.records, { assertCurrent() {}, fetchRequest: transport });
    assert.equal(requests.length, 1); assert.equal(requests[0].method, "GET");
    assert.deepEqual(JSON.parse(requests[0].body), { MaxResults: 2, NextToken: "page-λ" });
    verifyAwsSignature(f.descriptor.origin + f.descriptor.operation.path, { method: "GET", headers: requests[0].headers, body: requests[0].body },
      awsSyntheticValues, "elasticfilesystem", "us-east-1");
    assert.equal(result.response.body.NextToken, "next-page"); privateResult(result, [pairingKey]);
    await assert.rejects(executeCredentialed(f.descriptor, input, f.binding, f.records, { assertCurrent() {}, fetchRequest: transport }), { code: "AWS_GET_BODY_TRANSPORT" });
    let direct = 0;
    await executeCredentialed(f.descriptor, {}, f.binding, f.records, { assertCurrent() {}, async fetchRequest(address, init) {
      direct++; assert.equal(new URL(address).origin, f.descriptor.origin); assert.equal(init.body, null); return Response.json({});
    } }); assert.equal(direct, 1);
    const altered = structuredClone(f.records); altered.find(record => record.id === pairingKeyId).value = "Q".repeat(43);
    await assert.rejects(resolveHttpConnection(f.descriptor, binding, altered), { code: "PERMISSION" });
    const lambda = await nativeFixture("aws-lambda:ListAliases");
    await assert.rejects(createHttpConnection({ label: "Wrong", account: "Wrong", format: "schema", relay: { host: connection.relay.host, pairingKeyId } },
      lambda.descriptor, lambda.binding, [...lambda.records, f.records.find(record => record.id === pairingKeyId)]), { code: "PERMISSION" });
    for (const [origin, key, path, status] of [["https://other.example.test", pairingKey, "/v1/efs/account-preferences", 403],
      ["https://operations.example.test", "wrong", "/v1/efs/account-preferences", 401], ["https://operations.example.test", pairingKey, "/proxy", 403]]) {
      const response = await localFetch(local + path, { method: "POST", headers: { Host: "efs-companion.example.test", Origin: origin,
        Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: "{}" }); assert.equal(response.status, status);
    }
    assert.equal(requests.length, 1);
    assert.deepEqual([...awsGetBodyRegions], f.source.endpoint.variables.region.enum);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(executeCredentialed(f.descriptor, input, binding, f.records,
      { assertCurrent() {}, fetchRequest: transport, signal: controller.signal }), { code: "CANCELLED" });
  } finally { companion.close(); await close(server); await close(upstream); }
});

Then("the EFS relay rejects changed signed requests unsafe responses and stale private guards", async () => {
  const f = await nativeFixture("aws-elasticfilesystem:DescribeAccountPreferences"), address = f.descriptor.origin + f.descriptor.operation.path;
  const signed = await signAwsRequest("GET", address, new Headers({ Accept: "application/json", "Content-Type": "application/json" }),
    '{"MaxResults":2}', awsSyntheticValues, { service: "elasticfilesystem", region: "us-east-1" });
  const input = { profile: awsGetBodyProfile, fingerprint: f.descriptor.fingerprint, address, headers: Object.fromEntries(signed.headers), body: new TextDecoder().decode(signed.body) };
  const noDispatch = { request() { assert.fail("Rejected relay input must not reach a socket"); } };
  for (const altered of [{ ...input, address: address + "?nextToken=wrong" }, { ...input, address: address.replace("us-east-1", "unknown-region") },
    { ...input, address: "http://127.0.0.1/" }, { ...input, body: '{"MaxResults":3}' }, { ...input, headers: { ...input.headers, cookie: "private" } },
    { ...input, headers: { ...input.headers, authorization: input.headers.authorization.replace("/elasticfilesystem/", "/lambda/") } },
    { ...input, body: '{"NextToken":"' + "x".repeat(129) + '"}' }])
    await assert.rejects(forwardAwsGetBody(altered, undefined, noDispatch));
  await assert.rejects(forwardAwsGetBody(input, undefined, { ...noDispatch, now: () => signed.signedAt + 60001 }));
  let mode = "redirect";
  const server = createServer((req, res) => {
    req.resume();
    if (mode === "redirect") { res.writeHead(302, { Location: "https://other.example.test" }); res.end(); }
    else if (mode === "large") { res.writeHead(200); res.end("x".repeat(1024 * 1024 + 1)); }
    else { res.writeHead(200); res.end(Buffer.from([255])); }
  }), local = await listen(server);
  try {
    let requests = 0;
    const runtime = { request(_address, options, callback) { requests++; return httpRequest(local, options, callback); } };
    await assert.rejects(forwardAwsGetBody(input, undefined, runtime)); assert.equal(requests, 1); mode = "large";
    await assert.rejects(forwardAwsGetBody(input, undefined, runtime)); assert.equal(requests, 2); mode = "invalid";
    await assert.rejects(forwardAwsGetBody(input, undefined, runtime)); assert.equal(requests, 3);
  } finally { await close(server); }
  const pairingKeyId = crypto.randomUUID(), key = "P".repeat(43);
  const connection = await createHttpConnection({ label: "EFS", account: "Fixture", format: "schema", relay: { host: "https://efs-companion.example.test", pairingKeyId } },
    f.descriptor, f.binding, [...f.records, { id: pairingKeyId, label: "Pair", value: key, kind: "secret", grants: [] }]);
  const records = [...f.records, { id: pairingKeyId, label: "Pair", value: key, kind: "secret", grants: [] }];
  let guards = 0;
  await assert.rejects(fetchAwsGetBody(f.descriptor, connection.relay, records, address, { method: "GET", body: signed.body, headers: signed.headers },
    async () => Response.json({ profile: awsGetBodyProfile, fingerprint: f.descriptor.fingerprint, status: 200, statusText: "OK", headers: {}, body: "{}" }),
    () => { if (++guards === 2) throw Object.assign(new Error("Changed vault"), { code: "PERMISSION" }); }), { code: "PERMISSION" });
});

Then("EFS relay references survive encrypted reload and invalidate when their pairing key rotates", async () => {
  const key = await newVaultKey(), id = crypto.randomUUID(), methodId = crypto.randomUUID(), recovery = randomBase64(128), salt = randomBase64(16);
  const envelope = { id: methodId, kind: "recovery", revision: 1, salt,
    wrappedKey: await wrapVaultKey(key, await recoveryKey(recovery, salt), { vaultId: id, epoch: 1, kind: "recovery", id: methodId, revision: 1 }) };
  const storage = { state: { revision: 1, lockEpoch: 1, snapshot: await sealSnapshot({ id, epoch: 1, revision: 1, envelopes: [envelope], records: [] }, key) },
    async read() { return structuredClone(this.state); },
    async replace(expected, snapshot, keys) {
      if (expected.revision !== this.state.revision || expected.lockEpoch !== this.state.lockEpoch) throw new VaultError("CONFLICT");
      this.state = { revision: this.state.revision + 1, lockEpoch: this.state.lockEpoch + 1, snapshot: structuredClone(snapshot), keys: structuredClone(keys) };
      return this.read();
    },
    async indexKeys(expected, keys) { assert.equal(expected.revision, this.state.revision); this.state.keys = structuredClone(keys); return this.read(); },
    async lock() { this.state.revision++; this.state.lockEpoch++; return this.read(); } };
  const proof = { methodId, secret: recovery }, session = new VaultSession(storage), f = await nativeFixture("aws-elasticfilesystem:DescribeAccountPreferences");
  await session.unlock(proof);
  const reference = {};
  for (const [part, value] of Object.entries(awsSyntheticValues)) {
    const summaries = await session.put(null, { label: part, kind: "secret", value }); reference[part] = summaries.find(item => item.label === part).id;
  }
  const pairing = "P".repeat(43), summaries = await session.put(null, { label: "EFS pairing", kind: "secret", value: pairing });
  const pairingKeyId = summaries.find(item => item.label === "EFS pairing").id;
  const manual = { alternative: 0, fingerprint: f.descriptor.fingerprint, credentials: { [f.descriptor.operation.security[0][0].name]: reference } };
  const connection = await session.putConnection({ label: "Encrypted EFS", account: "Fixture account", format: "schema",
    relay: { host: "https://efs-companion.example.test", pairingKeyId } }, f.descriptor, manual);
  const backup = await session.backup();
  for (const privateText of [pairing, ...Object.values(awsSyntheticValues), connection.label, connection.relay.host]) assert.ok(!backup.includes(privateText));
  session.lock(); await assert.rejects(session.connections(), { code: "LOCKED" });
  const reloaded = new VaultSession(storage); await reloaded.unlock(proof);
  assert.deepEqual(await reloaded.connections(), [connection]);
  const selected = await reloaded.connectionBinding(httpConnectionReference(connection), f.descriptor);
  assert.deepEqual(selected.credentials, {}); assert.equal(selected.connection.fingerprint, connection.fingerprint);
  await reloaded.put(proof, { id: pairingKeyId, label: "EFS pairing", kind: "secret", value: "Q".repeat(43) });
  const [rotated] = await reloaded.connections();
  assert.equal(rotated.revision, connection.revision + 1); assert.notEqual(rotated.fingerprint, connection.fingerprint);
  await assert.rejects(reloaded.connectionBinding(httpConnectionReference(connection), f.descriptor), { code: "PERMISSION" });
  await assert.rejects(reloaded.connectionBinding(httpConnectionReference(rotated), f.descriptor), { code: "PERMISSION" });
  const saved = await reloaded.putConnection({ label: connection.label, account: connection.account, format: "schema",
    reference: httpConnectionReference(rotated), relay: { host: connection.relay.host, pairingKeyId } }, f.descriptor, manual);
  assert.ok(await reloaded.connectionBinding(httpConnectionReference(saved), f.descriptor));
  await reloaded.remove(proof, pairingKeyId); assert.deepEqual(await reloaded.connections(), []); reloaded.lock();
});

Then("AWS REST binding corrections retain source evidence constraints and strict drift rejection", async () => {
  const backupRaw = await readServiceSchemaUpstream("aws-backup"), backup = await readServiceSchema("aws-backup");
  const path = awsRestContracts().operations["aws-backup:ListBackupPlans"].nativePath, before = backupRaw.paths[path].get.parameters, after = backup.paths[path].get;
  assert.deepEqual(after["x-upstream-aws-rest-parameters"], before);
  const limits = after.parameters.filter(parameter => parameter.name === "maxResults" && parameter.in === "query");
  assert.equal(limits.length, 1); assert.equal(limits[0].schema.minimum, 1); assert.equal(limits[0].schema.maximum, 1000);
  const raw = await readServiceSchemaUpstream("aws-elasticfilesystem"), normalized = await readServiceSchema("aws-elasticfilesystem");
  const efsPath = "/2015-02-01/account-preferences";
  assert.equal(raw.paths[efsPath].get.requestBody.required, true);
  assert.equal(normalized.paths[efsPath].get.requestBody.required, false);
  assert.deepEqual(normalized.paths[efsPath].get["x-upstream-aws-rest-body"], raw.paths[efsPath].get.requestBody);
  const changedServer = structuredClone(raw); changedServer.servers = [{ url: "https://other.example.test" }];
  assert.throws(() => bindAwsRest(changedServer));
  const changedId = structuredClone(raw); changedId.paths[efsPath].get.operationId = "Changed";
  assert.throws(() => bindAwsRest(changedId));
  const composed = structuredClone(raw); composed.paths[efsPath].get.requestBody.content["application/json"].schema.properties.NextToken = { allOf: [{ type: "string" }, { maxLength: 128 }] };
  assert.throws(() => bindAwsRest(composed), /independent qualification/);
  const offering = await nativeFixture("aws-opensearch:DescribeReservedInstanceOfferings");
  const hex = offering.descriptor.operation.fields.find(field => field.name === "offeringId").schema.pattern;
  assert.ok(new RegExp(hex, "u").test("abcdef12-ABCD-1234-abcd-1234567890ab"));
  assert.ok(!new RegExp(hex, "u").test("zzzzzzzz-ABCD-1234-abcd-1234567890ab"));
  const runtime = await nativeFixture("aws-runtime-sagemaker:InvokeEndpoint");
  const ascii = runtime.descriptor.operation.fields.find(field => /custom-attributes/i.test(field.name)).schema.pattern;
  assert.ok(new RegExp(ascii, "u").test("visible ASCII"));
  assert.ok(!new RegExp(ascii, "u").test("non-ASCII é")); assert.ok(!new RegExp(ascii, "u").test("line\n"));
});

Then("AWS REST timestamps repeated query values and private SSE headers retain their wire representations", async () => {
  const backup = await nativeFixture("aws-backup:ListBackupJobs");
  const queried = prepareAwsRestRequest(backup.descriptor.operation, { method: "GET", path: backup.descriptor.operation.path,
    query: { createdAfter: 1700000000 } });
  assert.equal(queried.query.createdAfter, "2023-11-14T22:13:20.000Z");
  const api = await nativeFixture("aws-apigateway:GetResources");
  const repeated = prepareAwsRestRequest(api.descriptor.operation, { method: "GET", path: api.descriptor.operation.path,
    query: { embed: ["methods", "a&b"] }, querySerialization: { embed: "form-csv" } });
  const url = new URL("https://example.test/"); appendRequestQuery(url, repeated);
  assert.deepEqual(url.searchParams.getAll("embed"), ["methods", "a&b"]); assert.equal(url.searchParams.has("b"), false);
  const f = await nativeFixture("aws-s3:HeadObject"), rawKey = Buffer.alloc(32, 75), encodedKey = rawKey.toString("base64"), secretId = crypto.randomUUID();
  f.records.push({ id: secretId, label: "SSE key", kind: "secret", value: encodedKey, grants: [] });
  const keyField = f.descriptor.operation.fields.find(field => field.name.toLowerCase() === "x-amz-server-side-encryption-customer-key");
  const md5Field = f.descriptor.operation.fields.find(field => field.name.toLowerCase() === "x-amz-server-side-encryption-customer-key-md5");
  const algorithm = f.descriptor.operation.fields.find(field => field.name.toLowerCase() === "x-amz-server-side-encryption-customer-algorithm");
  const modified = f.descriptor.operation.fields.find(field => field.name.toLowerCase() === "if-modified-since");
  let calls = 0;
  const result = await executeCredentialed(f.descriptor, { ...f.input, [keyField.key]: vaultVariablePlaceholder,
    [md5Field.key]: createHash("md5").update(rawKey).digest("base64"), [algorithm.key]: "AES256", [modified.key]: "2023-11-14T22:13:20.000Z" },
    f.binding, f.records, { assertCurrent() {}, variables: [{ key: keyField.key, path: [], credentialId: secretId }],
      async fetchRequest(address, init) {
        calls++; const context = awsRestEndpoint(f.descriptor.origin, f.descriptor.operation);
        verifyAwsSignature(address, init, awsSyntheticValues, context.service, context.region);
        assert.equal(new Headers(init.headers).get(keyField.name), encodedKey);
        assert.equal(new Headers(init.headers).get(modified.name), "Tue, 14 Nov 2023 22:13:20 GMT");
        return new Response(null, { status: 200, headers: { "content-length": "9", "last-modified": "Tue, 14 Nov 2023 22:13:20 GMT" } });
      } });
  assert.equal(calls, 1); assert.equal(result.response.body.ContentLength, 9); privateResult(result, [encodedKey]);
});

Then("the four AWS REST description synopses persist while canonical source documentation remains complete", async () => {
  const ids = ["aws-batch:CreateComputeEnvironment", "aws-elasticfilesystem:CreateMountTarget", "aws-lambda:CreateFunction", "aws-s3:HeadObject"];
  for (const id of ids) {
    const f = await nativeFixture(id), operation = f.descriptor.operation, document = await readServiceSchema(f.contract.catalog), before = JSON.stringify(document);
    assert.ok(operation.description.length > 4000);
    const graph = createOperationGraph(operation, { x: 0, y: 0 }, "fixture", document);
    assert.equal(graph.nodes[0].data.description, displayCorrections[id].description);
    const saved = validateWorkflowDocument({ version: 2, id: crypto.randomUUID(), name: "AWS metadata", ...graph,
      viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false });
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(saved)), saved);
    assert.equal(JSON.stringify(document), before);
  }
});

function eventFrame(name, payload) {
  const parts = Object.entries({ ":message-type": "event", ":event-type": name,
    ":content-type": name === "PayloadChunk" ? "application/octet-stream" : "application/json" }).map(([name, value]) => {
    const key = Buffer.from(name), data = Buffer.from(value), entry = Buffer.alloc(key.length + data.length + 4);
    entry[0] = key.length; key.copy(entry, 1); entry[key.length + 1] = 7; entry.writeUInt16BE(data.length, key.length + 2); data.copy(entry, key.length + 4);
    return entry;
  });
  const headers = Buffer.concat(parts), data = Buffer.from(payload), frame = Buffer.alloc(headers.length + data.length + 16);
  frame.writeUInt32BE(frame.length); frame.writeUInt32BE(headers.length, 4); frame.writeUInt32BE(crc32(frame.subarray(0, 8)), 8);
  headers.copy(frame, 12); data.copy(frame, headers.length + 12); frame.writeUInt32BE(crc32(frame.subarray(0, -4)), frame.length - 4); return frame;
}
Then("REST file envelopes and event chunks with known secrets are withheld without corrupting clean bytes", async () => {
  for (const id of ["aws-runtime-sagemaker:InvokeEndpoint", "aws-lambda:Invoke", "aws-lambda:InvokeWithResponseStream"]) {
    const f = await nativeFixture(id);
    for (const leaking of [false, true]) {
      const payload = leaking ? "prefix-" + awsSyntheticValues.secretAccessKey + "-suffix" : "clean response λ";
      const event = id === "aws-lambda:InvokeWithResponseStream";
      const wire = event ? Buffer.concat([eventFrame("PayloadChunk", payload), eventFrame("InvokeComplete", "{}")]) : payload;
      const result = await executeCredentialed(f.descriptor, f.input, f.binding, f.records, { assertCurrent() {},
        async fetchRequest() { return new Response(wire, { headers: { "content-type": event ? "application/vnd.amazon.eventstream" : "application/octet-stream" } }); } });
      if (leaking) {
        assert.equal(result.response.body, null); assert.equal(result.response.redacted, true);
        assert.ok(!JSON.stringify(result).includes(Buffer.from(awsSyntheticValues.secretAccessKey).toString("base64"))); privateResult(result);
      } else {
        const file = validateWorkflowBinary(event ? result.response.body.EventStream[0].PayloadChunk.Payload
          : id === "aws-lambda:Invoke" ? result.response.body.Payload : result.response.body.Body);
        assert.equal(Buffer.from(file.base64, "base64").toString("utf8"), payload); assert.equal(result.response.redacted, undefined);
      }
    }
    if (id.startsWith("aws-lambda:")) {
      assert.equal(f.descriptor.operation.bodyRequired, false);
      const noBody = Object.fromEntries(Object.entries(f.input).filter(([key]) => !key.startsWith("body:")));
      const event = id === "aws-lambda:InvokeWithResponseStream";
      await executeCredentialed(f.descriptor, noBody, f.binding, f.records, { assertCurrent() {},
        async fetchRequest(_address, init) {
          assert.equal(init.body, null);
          return new Response(event ? Buffer.concat([eventFrame("PayloadChunk", "empty input"), eventFrame("InvokeComplete", "{}")]) : "empty input",
            { headers: { "content-type": event ? "application/vnd.amazon.eventstream" : "application/octet-stream" } });
        } });
    }
  }
});
