// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import demo from "./catalogs/demo.openapi.json" with { type: "json" };
import { extractOperations, operations, updateCatalogs } from "./lib/catalog.ts";
import { catalogs, catalogForOperation } from "./lib/catalog-registry.ts";
import { addAdditionalProperty, createOperationGraph, createWorkflowGraph, removeGraphSelection, isWorkflowConnection } from "./lib/workflow-graph.ts";
import { createWorkflowRunner as createRequestRunner } from "./lib/workflow-runner.ts";
import { createWorkflowDemo } from "./lib/workflow-demo.ts";
import { createWorkflowRequestExecution, WorkflowResponseError, workflowExecutionForOperation, workflowRequestUrl } from "./lib/workflow-execution.ts";
import { responseHeaderReader } from "./lib/workflow-response.ts";
import { assertRequestDeadline } from "../tests/workflow-deadline.fixture.mjs";

const createWorkflowRunner = (value, startingNodeId) => createRequestRunner(value, startingNodeId, createWorkflowDemo());

const operation = name => operations.find(item => item.id === `demo:${name}`);
const document = (...graphs) => ({ version: 3, id: "run-test", name: "Run test", nodes: graphs.flatMap(graph => graph.nodes),
  edges: graphs.flatMap(graph => graph.edges), viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false });
const graph = (name, id = name) => createOperationGraph(operation(name), { x: 0, y: 0 }, id, demo);
const utility = (type, id, data) => ({ nodes: [{ type, id, data, position: { x: 0, y: 0 } }], edges: [] });
const find = (doc, owner, direction, name) => {
  for (const node of doc.nodes) {
    if (node.type !== "data" || node.data.ownerId !== owner || node.data.direction !== direction) continue;
    const field = node.data.fields.find(field => field.label === name);
    if (field) return { node, field };
  }
  throw new Error(`Missing ${owner} ${direction} ${name}`);
};
const mapping = (doc, from, to) => doc.edges.push({ id: `map-${doc.edges.length}`, kind: "mapping",
  source: from.node?.id ?? from.id, sourceHandle: from.field?.id ?? from.handle,
  target: to.node?.id ?? to.id, targetHandle: to.field?.id ?? to.handle });
const output = (doc, owner, name) => find(doc, owner, "outputs", name);
const input = (doc, owner, name) => find(doc, owner, "inputs", name);
const submit = async (runner, values = {}) => {
  const next = runner.next();
  assert.equal(next.kind, "operation");
  return runner.submit({ ...next.values, ...values });
};
const project = { "path:projectId": "project-1" };
const task = { ...project, "body:title": "A task created in the run", "body:priority": "high" };

Then("the injectable HTTP executor sends catalog requests and maps actual responses", async function () {
  const previous = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (options.method === "GET") return Response.json({ id: "returned-project", name: "Returned project", status: "active" });
    if (options.method === "POST") return Response.json({ id: "returned-task", ...JSON.parse(options.body), completed: false }, { status: 201 });
    return Response.json({ id: "returned-task", completed: JSON.parse(options.body).completed });
  };
  try {
    const doc = document(graph("getProject"), graph("createTask"), graph("updateTask"));
    mapping(doc, output(doc, "getProject", "Path value"), input(doc, "createTask", "Path value"));
    mapping(doc, output(doc, "createTask", "Path value"), input(doc, "updateTask", "Path value"));
    const runner = createRequestRunner(doc, undefined, createWorkflowRequestExecution());
    await submit(runner, { "path:projectId": "request project/1" });
    assert.equal(runner.next().values["path:projectId"], "returned-project");
    await submit(runner, { "body:title": "Remote task", "body:priority": "normal" });
    assert.equal(runner.next().values["path:taskId"], "returned-task");
    assert.equal((await submit(runner, { "body:completed": "true" })).response.body.completed, true);
    assert.equal(runner.next().kind, "complete");
    assert.deepEqual(requests.map(item => [item.options.method, item.url]), [
      ["GET", "https://example.com/projects/request%20project%2F1"],
      ["POST", "https://example.com/projects/returned-project/tasks"],
      ["PATCH", "https://example.com/tasks/returned-task"]
    ]);
    assert.equal(requests[0].options.body, null);
    assert.deepEqual(JSON.parse(requests[1].options.body), { title: "Remote task", priority: "normal" });
    assert.equal(requests[1].options.headers["Content-Type"], "application/json");
    assert.ok(requests.every(item => item.options.redirect === "error" && item.options.credentials === "omit"));
    assert.equal(workflowRequestUrl({ method: "GET", path: "/projects", query: { name: "A & B", limit: 1 } }, "https://example.com"), "https://example.com/projects?name=A+%26+B&limit=1");
    const execution = createWorkflowRequestExecution(async () => new Response(null, { status: 204 }));
    assert.equal((await execution.execute(operation("getProject"), project)).response.body, null);
    await assert.rejects(() => execution.execute({ ...operation("getProject"), method: "POST" }, project), /registered schemas/);
    await assert.rejects(() => execution.execute({ ...operation("getProject"), id: "unknown" }, project), /registered schemas/);
    await assert.rejects(() => execution.execute({ ...operation("getProject"), path: "https:\/\/another.example/" }, project), /registered schemas/);
  } finally { globalThis.fetch = previous; }
});

Then("workflow request failures explain network server and response problems and allow retry", async function () {
  const failed = createWorkflowRequestExecution(async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(() => failed.execute(operation("getProject"), project), /could not reach https:\/\/example.com/);
  await assert.rejects(() => failed.execute(operation("getProject"), project, AbortSignal.abort()), /cancelled/);
  await assertRequestDeadline(fetchRequest => createWorkflowRequestExecution(fetchRequest)
    .execute(operation("getProject"), project), /timed out/);
  const withoutContentType = new Response("no media type", { status: 500 });
  withoutContentType.headers.delete("Content-Type");
  for (const [response, expected, body] of [
    [new Response("server failure", { status: 503, statusText: "Unavailable" }), /503 Unavailable/, "server failure"],
    [new Response("missing", { status: 404 }), /404/, "missing"],
    [Response.json({ detail: "Invalid inputs" }, { status: 422 }), /422/, { detail: "Invalid inputs" }],
    [new Response('{"detail":"Rate limited"}', { status: 429, headers: { "Content-Type": "application/problem+json" } }), /429/, { detail: "Rate limited" }],
    [new Response("broken JSON", { status: 500, headers: { "Content-Type": "application/json" } }), /500/, "broken JSON"],
    [withoutContentType, /500/, "no media type"],
    [new Response("<!doctype html><title>Example Domain</title>", { headers: { "Content-Type": "application/json" } }), /did not return valid JSON/, "<!doctype html><title>Example Domain</title>"]
  ]) {
    const execution = createWorkflowRequestExecution(async () => response);
    await assert.rejects(() => execution.execute(operation("getProject"), project), error => {
      assert.ok(error instanceof WorkflowResponseError);
      assert.equal(error.name, "WorkflowResponseError");
      assert.match(error.message, expected);
      assert.deepEqual(error.response, { status: response.status, statusText: response.statusText,
        headers: Object.fromEntries(response.headers), body });
      return true;
    });
  }
  const streamingFailure = createWorkflowRequestExecution(async () => {
    return new Response(new ReadableStream({ start(stream) { stream.error(new TypeError("Disconnected while reading")); } }),
      { headers: { "Content-Type": "application/json" } });
  });
  await assert.rejects(() => streamingFailure.execute(operation("getProject"), project), /response could not be read/);
  await assert.rejects(() => streamingFailure.execute(operation("getProject"), project, AbortSignal.abort()), /cancelled/);
  await assertRequestDeadline(fetchRequest => createWorkflowRequestExecution(fetchRequest)
    .execute(operation("getProject"), project), /timed out/, { body: true });
  let calls = 0;
  const execution = createWorkflowRequestExecution(async () => {
    calls++;
    if (calls === 1) return new Response("not-json", { headers: { "Content-Type": "application/json" } });
    return Response.json({ id: "project-from-server", name: "Server project", status: "active" });
  });
  const runner = createRequestRunner(document(graph("getProject")), undefined, execution);
  const visit = runner.next();
  await assert.rejects(() => runner.submit({}), /this field is required/);
  assert.equal(calls, 0);
  await assert.rejects(() => runner.submit(project), /did not return valid JSON/);
  assert.equal(runner.next(), visit);
  assert.equal((await runner.submit(project)).response.body.id, "project-from-server");
  assert.equal(calls, 2);
  assert.equal(runner.next().kind, "complete");
});

Then("ending a workflow aborts pending requests and prevents late results from continuing the run", async function () {
  let resolve;
  let signal;
  const response = new Promise(done => resolve = done);
  const runner = createRequestRunner(document(graph("getProject")), undefined, {
    execute(operation, values, pendingSignal) { signal = pendingSignal; return response; }
  });
  runner.next();
  const pending = runner.submit(project);
  await assert.rejects(() => runner.submit(project), /already has a request in progress/);
  runner.end();
  assert.equal(signal.aborted, true);
  resolve({ request: { method: "GET", path: "/projects/project-1", query: {} }, response: { status: 200,
    statusText: "OK", headers: {}, body: { id: "late" } } });
  await assert.rejects(() => pending, /run has ended/);
  assert.equal(runner.next().message, "Run ended.");
});

Then("workflow runs offer starting choices and end without contacting a service", async function () {
  const previous = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("A local demo must never contact a service"); };
  try {
    const doc = document(graph("getProject", "first"), graph("getProject", "second"));
    const runner = createWorkflowRunner(doc);
    const choice = runner.next();
    assert.equal(choice.kind, "choice");
    assert.deepEqual(choice.choices.map(item => item.label), ["Example object response 1", "Example object response 2"]);
    assert.throws(() => runner.choose("missing"), /starting operations/);
    runner.choose("second");
    const current = runner.next();
    assert.equal(current.nodeId, "second");
    assert.equal(runner.next(), current);
    assert.equal((await submit(runner, project)).response.body.id, "project-1");
    assert.equal(runner.next().kind, "complete");
    assert.equal(runner.done, true);
    assert.equal(runner.next().message, "Workflow complete.");
    await assert.rejects(() => runner.submit(project), /no operation ready/);
    assert.throws(() => createWorkflowRunner(doc, "missing"), /starting operation is unavailable/);
    assert.equal(createWorkflowRunner(doc, "first").next().nodeId, "first");
    assert.throws(() => createWorkflowRunner(document()).next(), /no operations/);
  } finally { globalThis.fetch = previous; }
});

Then("workflow runs validate inputs and pass created task identifiers to later operations", async function () {
  const doc = document(graph("getProject"), graph("createTask"), graph("updateTask"));
  mapping(doc, output(doc, "getProject", "Path value"), input(doc, "createTask", "Path value"));
  mapping(doc, output(doc, "createTask", "Path value"), input(doc, "updateTask", "Path value"));
  const before = structuredClone(doc);
  const runner = createWorkflowRunner(doc);
  assert.equal(runner.next().operation.id, "demo:getProject");
  await assert.rejects(() => runner.submit({}), /Path value: this field is required/);
  await assert.rejects(() => runner.submit({ "path:projectId": "missing" }), /not found in this demo/);
  assert.equal((await submit(runner, project)).response.body.name, "Documentation");
  const create = runner.next();
  assert.equal(create.operation.id, "demo:createTask");
  assert.deepEqual(create.values, project);
  assert.deepEqual(create.mappedFields, ["path:projectId"]);
  await assert.rejects(() => runner.submit({ ...task, "path:projectId": "project-2" }), /Connected values cannot be changed/);
  await assert.rejects(() => runner.submit(project), /Title: this field is required/);
  const created = await submit(runner, task);
  assert.equal(created.response.status, 201);
  assert.equal(created.response.body.id, "task-2");
  const update = runner.next();
  assert.deepEqual(update.values, { "path:taskId": "task-2" });
  const updated = await submit(runner, { "body:completed": "true" });
  assert.equal(updated.response.body.completed, true);
  assert.equal(updated.response.body.title, task["body:title"]);
  assert.equal(runner.next().kind, "complete");
  assert.deepEqual(doc, before);
});

Then("workflow demo state is isolated and operations enforce their documented constraints", async function () {
  const first = createWorkflowDemo();
  const second = createWorkflowDemo();
  const created = first.execute(operation("createTask"), { ...task, "body:estimate": "2.5" });
  assert.equal(created.response.body.estimate, 2.5);
  created.response.body.title = "Mutating a result must not change state";
  assert.equal(first.execute(operation("updateTask"), { "path:taskId": "task-2" }).response.body.title, task["body:title"]);
  assert.throws(() => second.execute(operation("updateTask"), { "path:taskId": "task-2" }), /not found in this demo/);
  assert.equal(second.execute(operation("updateTask"), { "path:taskId": "task-1", "body:title": "Changed", "body:priority": "low", "body:completed": "false" }).response.body.title, "Changed");
  assert.equal(first.execute(operation("updateTask"), { "path:taskId": "task-1" }).response.body.title, "Review the project guide");
  assert.equal(first.execute(operation("listProjects"), {}).response.body.length, 2);
  assert.deepEqual(first.execute(operation("listProjects"), { "query:name": "web", "query:limit": "1" }).response.body.map(item => item.id), ["project-2"]);
  assert.throws(() => first.execute(operation("listProjects"), { "query:limit": "0" }), /allowed range/);
  assert.throws(() => first.execute(operation("createTask"), { ...task, "body:priority": "urgent" }), /allowed values/);
  assert.throws(() => first.execute(operation("updateTask"), { "path:taskId": "task-1", "body:completed": "yes" }), /true or false/);
  assert.throws(() => first.execute({ ...operation("getProject"), method: "POST" }, project), /unavailable/);
  assert.throws(() => first.execute({ ...operation("getProject"), id: "other:unknown" }, project), /unavailable/);
});

Then("workflow switches select the first matching gate and casts prepare the next operation input", async function () {
  const doc = document(graph("updateTask", "update"), graph("listProjects", "selected"), graph("listProjects", "skipped"),
    utility("switch", "switch", { gates: [{ id: "true-first", operator: "==", value: "true" }, { id: "also-true", operator: "is_set", value: "" }] }),
    utility("cast", "cast", { targetType: "Number" }));
  mapping(doc, output(doc, "update", "Completed"), { id: "switch", handle: "value" });
  mapping(doc, { id: "switch", handle: "true-first" }, { id: "cast", handle: "value" });
  mapping(doc, { id: "cast", handle: "result" }, input(doc, "selected", "Result limit"));
  mapping(doc, { id: "switch", handle: "also-true" }, input(doc, "skipped", "Result limit"));
  const runner = createWorkflowRunner(doc);
  await submit(runner, { "path:taskId": "task-1", "body:completed": "true" });
  assert.equal(runner.next().nodeId, "selected");
  assert.equal(runner.next().values["query:limit"], "1");
  assert.equal((await submit(runner)).response.body.length, 1);
  assert.equal(runner.next().kind, "complete");
});

Then("connected switch operands and inactive branches determine which operations run", async function () {
  const doc = document(graph("getProject"), graph("createTask"),
    utility("switch", "switch", { gates: [{ id: "match", operator: "==", value: "a stale literal" }, { id: "unused", operator: "==", value: "none" }] }),
    utility("cast", "inactive-cast", { targetType: "Text" }), graph("getProject", "inactive"));
  mapping(doc, output(doc, "getProject", "Path value"), { id: "switch", handle: "value" });
  mapping(doc, output(doc, "getProject", "Path value"), { id: "switch", handle: "gate-value:match" });
  mapping(doc, { id: "switch", handle: "match" }, input(doc, "createTask", "Path value"));
  mapping(doc, { id: "switch", handle: "unused" }, { id: "inactive-cast", handle: "value" });
  mapping(doc, { id: "inactive-cast", handle: "result" }, input(doc, "inactive", "Path value"));
  const runner = createWorkflowRunner(doc);
  await submit(runner, project);
  assert.equal(runner.next().nodeId, "createTask");
  await submit(runner, task);
  assert.equal(runner.next().kind, "complete");
  doc.nodes.find(node => node.id === "switch").data.gates[0].operator = "!=";
  const noMatch = createWorkflowRunner(doc);
  await submit(noMatch, project);
  assert.equal(noMatch.next().kind, "complete");
});

Then("nested workflow runs import inputs and export results without changing their saved snapshots", async function () {
  const child = document(graph("createTask"));
  child.id = "saved-child";
  child.name = "Create a task";
  const doc = document(graph("getProject"), createWorkflowGraph(child, { x: 0, y: 0 }, "nested"), graph("updateTask"));
  mapping(doc, output(doc, "getProject", "Path value"), input(doc, "nested", "Path value"));
  mapping(doc, output(doc, "nested", "Path value"), input(doc, "updateTask", "Path value"));
  const before = structuredClone(doc);
  child.nodes.find(node => node.type === "operation").data.operationId = "removed-from-original";
  const runner = createWorkflowRunner(doc);
  await submit(runner, project);
  assert.equal(runner.next().workflowName, "Create a task");
  assert.deepEqual(runner.next().values, project);
  await submit(runner, task);
  assert.equal(runner.next().operation.id, "demo:updateTask");
  assert.equal(runner.next().values["path:taskId"], "task-2");
  assert.equal((await submit(runner, { "body:completed": "true" })).response.body.completed, true);
  assert.equal(runner.next().kind, "complete");
  assert.deepEqual(doc, before);
  const choices = document(graph("getProject", "one"), graph("listProjects", "two"));
  choices.id = "nested-choices";
  const nested = createWorkflowRunner(document(createWorkflowGraph(choices, { x: 0, y: 0 }, "nested")));
  assert.equal(nested.next().kind, "choice");
  nested.choose("two");
  assert.equal((await submit(nested)).response.body.length, 2);
  assert.equal(nested.next().kind, "complete");
});

Then("workflow output fanout runs each consumer and conflicting contributions fail clearly", async function () {
  const doc = document(graph("getProject"), graph("getProject", "a"), graph("getProject", "b"));
  mapping(doc, output(doc, "getProject", "Path value"), input(doc, "a", "Path value"));
  mapping(doc, output(doc, "getProject", "Path value"), input(doc, "b", "Path value"));
  const runner = createWorkflowRunner(doc);
  for (const id of ["getProject", "a", "b"]) { assert.equal(runner.next().nodeId, id); await submit(runner, project); }
  assert.equal(runner.next().kind, "complete");
  mapping(doc, output(doc, "getProject", "Name"), input(doc, "a", "Path value"));
  const conflict = createWorkflowRunner(doc);
  await submit(conflict, project);
  assert.throws(() => conflict.next(), /different values to the same input/);
  assert.throws(() => conflict.next(), /different values to the same input/);
  const disconnected = document(graph("getProject", "one"), graph("getProject", "two"), graph("createTask"));
  mapping(disconnected, output(disconnected, "one", "Path value"), input(disconnected, "createTask", "Path value"));
  mapping(disconnected, output(disconnected, "two", "Name"), input(disconnected, "createTask", "Title"));
  const waiting = createWorkflowRunner(disconnected);
  waiting.next(); waiting.choose("one"); await submit(waiting, project);
  assert.throws(() => waiting.next(), /unresolved branch/);
});

Then("unavailable operations invalid mapped values and workflow cycles stop with useful errors", async function () {
  const bad = document(graph("getProject"));
  bad.nodes[0].data.operationId = "unavailable:operation";
  assert.throws(() => createWorkflowRunner(bad).next(), /unavailable in the registered schemas/);
  const wrongType = document(graph("getProject"), graph("listProjects"));
  mapping(wrongType, output(wrongType, "getProject", "Path value"), input(wrongType, "listProjects", "Result limit"));
  const typeRun = createWorkflowRunner(wrongType);
  await submit(typeRun, project);
  assert.throws(() => typeRun.next(), /needs an integer value/);
  const invalidPath = document(graph("getProject"));
  output(invalidPath, "getProject", "Path value").field.id = "unsupported";
  const pathRun = createWorkflowRunner(invalidPath);
  await submit(pathRun, project);
  assert.throws(() => pathRun.next(), /unsupported path/);
  const unmapped = document(graph("getProject"));
  input(unmapped, "getProject", "Path value").field.id = "unsupported";
  const unmappedRun = createWorkflowRunner(unmapped);
  assert.equal((await submit(unmappedRun, project)).response.body.id, "project-1", "An unused saved field does not block manual inputs.");
  const cycle = document(graph("getProject", "first"), graph("getProject", "second"));
  mapping(cycle, output(cycle, "first", "Path value"), input(cycle, "second", "Path value"));
  mapping(cycle, output(cycle, "second", "Path value"), input(cycle, "first", "Path value"));
  const cycleRun = createWorkflowRunner(cycle);
  cycleRun.next(); cycleRun.choose("first");
  await submit(cycleRun, project);
  await submit(cycleRun, project);
  assert.throws(() => cycleRun.next(), /loops back to a completed operation/);
  await assert.rejects(() => cycleRun.submit(project), /no operation ready/);
  const collection = document(graph("listProjects"), graph("getProject"));
  mapping(collection, output(collection, "listProjects", "Path value"), input(collection, "getProject", "Path value"));
  const arrayRun = createWorkflowRunner(collection);
  await submit(arrayRun);
  assert.throws(() => arrayRun.next(), /needs a string value/);
  const stale = document(graph("getProject"), graph("createTask"));
  const staleField = input(stale, "createTask", "Path value");
  staleField.field.id = encodeURIComponent(JSON.stringify(["input:path", "/removedProjectId"]));
  mapping(stale, output(stale, "getProject", "Path value"), staleField);
  const staleRun = createWorkflowRunner(stale);
  await submit(staleRun, project);
  assert.throws(() => staleRun.next(), /mapped field.*unsupported by this operation/);
});

Then("legacy workflow connections advance operations and cancellation ends the run", async function () {
  const doc = document(graph("getProject"), graph("listProjects"));
  doc.version = 1;
  doc.nodes = doc.nodes.filter(node => node.type === "operation").map(({ type, ...node }) => node);
  doc.edges = [{ id: "legacy", source: "getProject", target: "listProjects" }];
  const runner = createWorkflowRunner(doc);
  await submit(runner, project);
  assert.equal(runner.next().operation.id, "demo:listProjects");
  runner.end();
  assert.equal(runner.done, true);
  assert.equal(runner.next().message, "Run ended.");
  await assert.rejects(() => runner.submit({}), /no operation ready/);
  const all = createWorkflowRunner(doc);
  await submit(all, project); await submit(all);
  assert.equal(all.next().kind, "complete");
});

Then("workflow response mappings support optional values scalar bodies and success status ranges", async function () {
  const schema = structuredClone(demo);
  schema.paths["/projects/{projectId}"].get.responses = { "2XX": { description: "Project identifier", content: { "application/json": { schema: { type: "string" } } } } };
  const scalar = document(createOperationGraph(operation("getProject"), { x: 0, y: 0 }, "scalar", schema), graph("createTask"));
  mapping(scalar, output(scalar, "scalar", "Response body"), input(scalar, "createTask", "Path value"));
  const fixture = createWorkflowDemo();
  const scalarRunner = createRequestRunner(scalar, undefined, { execute(operation, values) {
    return operation.id === "demo:getProject" ? { request: { method: "GET", path: "/projects/project-1", query: {} }, response: {
      status: 202, statusText: "Accepted", headers: {}, body: "project-1" } }
      : fixture.execute(operation, values);
  } });
  await submit(scalarRunner, project);
  assert.equal(scalarRunner.next().values["path:projectId"], "project-1");
  await submit(scalarRunner, task);
  assert.equal(scalarRunner.next().kind, "complete");

  const missing = document(graph("getProject"), graph("createTask"),
    utility("switch", "unset", { gates: [{ id: "missing", operator: "is_not_set", value: "" }] }));
  mapping(missing, output(missing, "getProject", "Path value"), { id: "unset", handle: "value" });
  mapping(missing, { id: "unset", handle: "missing" }, input(missing, "createTask", "Path value"));
  const missingRunner = createRequestRunner(missing, undefined, { execute(operation, values) {
    return operation.id === "demo:getProject" ? { request: { method: "GET", path: "/projects/project-1", query: {} }, response: {
      status: 200, statusText: "OK", headers: {}, body: {} } }
      : fixture.execute(operation, values);
  } });
  await submit(missingRunner, project);
  assert.equal(missingRunner.next().nodeId, "createTask");
  assert.deepEqual(missingRunner.next().values, {});
  assert.deepEqual(missingRunner.next().mappedFields, []);
  await assert.rejects(() => missingRunner.submit({ "body:title": "Missing project", "body:priority": "normal" }), /Path value: this field is required/);
  await submit(missingRunner, task);
  assert.equal(missingRunner.next().kind, "complete");
});

Then("inactive switch operands preserve active gates and missing main values are explained", async function () {
  const doc = document(graph("getProject"), graph("createTask"), graph("getProject", "skipped"),
    utility("switch", "filter", { gates: [{ id: "never", operator: "==", value: "never-match" }] }),
    utility("switch", "main", { gates: [{ id: "equal", operator: "==", value: "project-1" }, { id: "set", operator: "is_set", value: "" }] }),
    utility("switch", "inactive", { gates: [{ id: "set", operator: "is_set", value: "" }] }));
  mapping(doc, output(doc, "getProject", "Path value"), { id: "filter", handle: "value" });
  mapping(doc, output(doc, "getProject", "Path value"), { id: "main", handle: "value" });
  mapping(doc, { id: "filter", handle: "never" }, { id: "main", handle: "gate-value:equal" });
  mapping(doc, { id: "filter", handle: "never" }, { id: "inactive", handle: "value" });
  mapping(doc, { id: "inactive", handle: "set" }, input(doc, "skipped", "Path value"));
  mapping(doc, { id: "main", handle: "equal" }, input(doc, "skipped", "Path value"));
  mapping(doc, { id: "main", handle: "set" }, input(doc, "createTask", "Path value"));
  const runner = createWorkflowRunner(doc);
  await submit(runner, project);
  assert.equal(runner.next().nodeId, "createTask");
  await submit(runner, task);
  assert.equal(runner.next().kind, "complete");
  const noMain = document(graph("getProject"), utility("switch", "switch", { gates: [{ id: "operand", operator: "==", value: "" }] }));
  mapping(noMain, output(noMain, "getProject", "Path value"), { id: "switch", handle: "gate-value:operand" });
  const broken = createWorkflowRunner(noMain);
  await submit(broken, project);
  assert.throws(() => broken.next(), /Switch needs a connected input value/);
  broken.end();
  assert.equal(broken.next().message, "Run ended.");
});

Then("workflow runs stop after two hundred operations without sending another request", async function () {
  const doc = document();
  doc.version = 1;
  for (let index = 0; index < 201; index++) {
    const { type, ...node } = graph("getProject", `step-${index}`).nodes[0];
    doc.nodes.push(node);
    if (index) doc.edges.push({ id: `next-${index}`, source: `step-${index - 1}`, target: `step-${index}` });
  }
  let requests = 0;
  const fixture = createWorkflowDemo();
  const runner = createRequestRunner(doc, undefined, { execute(operation, values) { requests++; return fixture.execute(operation, values); } });
  for (let index = 0; index < 200; index++) await submit(runner, project);
  assert.throws(() => runner.next(), /exceeded 200 operation steps/);
  assert.equal(requests, 200);
});

const catalogOperation = id => operations.find(item => item.id === id);
const catalogGraph = (id, owner = id) => createOperationGraph(catalogOperation(id), { x: 0, y: 0 }, owner, catalogForOperation(id).document);
const atPath = (doc, owner, direction, path) => {
  for (const node of doc.nodes) if (node.type === "data" && node.data.ownerId === owner && node.data.direction === direction) {
    const field = node.data.fields.find(field => {
      const [group, pointer] = JSON.parse(decodeURIComponent(field.id));
      return pointer === (direction === "outputs" && group.startsWith("response:") ? `/body${path}` : path);
    });
    if (field) return { node, field };
  }
  throw new Error(`Missing ${owner} ${direction} ${path}`);
};
const jsonValues = { "body:label": "A & B", "body:count": "2", "body:ratio": "1.5", "body:enabled": "false",
  "body:priority": "high", "body:profile": '{"name":"Ada","count":3}', "body:tags": '["one","two"]', "body:note": "null" };

Then("both example catalogs send HTTP requests to their registered origins by default", async function () {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return options.method === "HEAD" || options.method === "OPTIONS" ? new Response(null) : Response.json({ method: options.method, remote: true });
  };
  try {
    for (const [prefix, origin] of [["demo:mock", "https://example.com"], ["httpbin:echo", "https://httpbin.org"]]) {
      for (const op of operations.filter(op => op.id.startsWith(prefix) && !op.fields.length && op.method !== "TRACE")) {
        const result = await submit(createRequestRunner(document(catalogGraph(op.id))));
        assert.equal(result.request.method, op.method);
        assert.equal(result.response.status, 200);
        assert.equal(new URL(calls.at(-1).url).origin, origin);
        if (["HEAD", "OPTIONS"].includes(op.method)) assert.equal(result.response.body, null);
        else assert.equal(result.response.body.remote, true);
      }
    }
    assert.equal(calls.length, 14);
    const forbidden = createRequestRunner(document(catalogGraph("demo:mockTrace")));
    await assert.rejects(() => submit(forbidden), { message: "Browsers do not permit TRACE requests." });
    assert.equal(calls.length, 14);
    assert.deepEqual(workflowExecutionForOperation("demo:mockTrace"), { kind: "http", origin: "https://example.com" });
    assert.deepEqual(workflowExecutionForOperation(catalogOperation("httpbin:echoGet")), { kind: "http", origin: "https://httpbin.org" });
    assert.throws(() => workflowExecutionForOperation("unknown:operation"), /registered schemas/);
    assert.throws(() => createWorkflowDemo().execute(catalogOperation("httpbin:echoGet"), {}), /unavailable/);
    const realTask = createRequestRunner(document(graph("createTask")));
    assert.deepEqual((await submit(realTask, task)).response.body, { method: "POST", remote: true });
    assert.equal(calls.at(-1).url, "https://example.com/projects/project-1/tasks");
    const first = createWorkflowRunner(document(graph("createTask")));
    const second = createWorkflowRunner(document(graph("createTask")));
    assert.equal((await submit(first, task)).response.body.id, "task-2");
    assert.equal((await submit(second, task)).response.body.id, "task-2");
  } finally { globalThis.fetch = previous; }
});

Then("HTTP examples serialize JSON text forms headers and repeated query values correctly", async function () {
  const requests = [];
  const execution = createWorkflowRequestExecution(async (url, options) => { requests.push({ url, options }); return Response.json({ accepted: true }); });
  const run = (name, values = {}) => execution.execute(catalogOperation(`httpbin:echo${name}`), values);
  await run("Parameters", { "path:sampleId": "with / space", "query:label": "A & B", "query:count": "2", "query:ratio": "1.5",
    "query:enabled": "false", "query:tags": '["one","two & more"]', "header:X-Example-Label": "custom value" });
  const url = new URL(requests.at(-1).url);
  assert.equal(url.origin, "https://httpbin.org");
  assert.ok(url.pathname.endsWith("with%20%2F%20space"));
  assert.deepEqual(url.searchParams.getAll("tags"), ["one", "two & more"]);
  assert.equal(url.searchParams.get("enabled"), "false");
  assert.equal(requests.at(-1).options.headers["X-Example-Label"], "custom value");
  assert.equal(requests.at(-1).options.headers["Content-Type"], undefined);
  await run("JsonObject", jsonValues);
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { label: "A & B", count: 2, ratio: 1.5, enabled: false, priority: "high",
    profile: { name: "Ada", count: 3 }, tags: ["one", "two"], note: null });
  await run("JsonArray", { "body:$": '["one","two"]' });
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), ["one", "two"]);
  await run("JsonScalar", { "body:$": "hello" });
  assert.equal(requests.at(-1).options.body, '"hello"');
  assert.equal(requests.at(-1).options.headers["Content-Type"], "application/json");
  await run("PlainText", { "body:$": "raw text\nsecond line" });
  assert.equal(requests.at(-1).options.body, "raw text\nsecond line");
  assert.equal(requests.at(-1).options.headers["Content-Type"], "text/plain");
  await run("UrlEncoded", { "body:name": "A & B", "body:message": "hello + world" });
  assert.ok(requests.at(-1).options.body instanceof URLSearchParams);
  assert.equal(requests.at(-1).options.body.toString(), "name=A+%26+B&message=hello+%2B+world");
  assert.equal(requests.at(-1).options.headers["Content-Type"], "application/x-www-form-urlencoded");
  await run("Multipart", { "body:name": "A & B", "body:message": "hello" });
  assert.ok(requests.at(-1).options.body instanceof FormData);
  assert.deepEqual([...requests.at(-1).options.body.entries()], [["name", "A & B"], ["message", "hello"]]);
  assert.equal(requests.at(-1).options.headers["Content-Type"], undefined);
  assert.ok(new Request(requests.at(-1).url, requests.at(-1).options).headers.get("Content-Type").startsWith("multipart/form-data; boundary="));
  assert.equal(workflowRequestUrl({ method: "GET", path: "/anything", query: { "filter[name]": "Ada", tags: ["a", "b"] } }, "https://httpbin.org"),
    "https://httpbin.org/anything?filter%5Bname%5D=Ada&tags=a&tags=b");
  const count = requests.length;
  await assert.rejects(() => run("Parameters"), /this field is required/);
  await assert.rejects(() => execution.execute(operation("mockTrace"), {}), /Browsers do not permit TRACE/);
  assert.equal(requests.length, count);
  for (const status of [204, 205]) {
    const empty = createWorkflowRequestExecution(async () => new Response(null, { status }));
    assert.equal((await empty.execute(catalogOperation("httpbin:echoGet"), {})).response.body, null);
  }
  const empty = createWorkflowRequestExecution(async () => new Response(null));
  assert.equal((await empty.execute(catalogOperation("httpbin:echoHead"), {})).response.body, null);
  assert.equal((await empty.execute(catalogOperation("httpbin:echoOptions"), {})).response.body, null);
  const text = createWorkflowRequestExecution(async () => new Response("allowed methods", { headers: { "Content-Type": "text/plain" } }));
  assert.equal((await text.execute(catalogOperation("httpbin:echoOptions"), {})).response.body, "allowed methods");
  const fallback = createWorkflowRequestExecution(async () => { const response = Response.json({ options: true }); response.headers.delete("Content-Type"); return response; });
  assert.deepEqual((await fallback.execute(catalogOperation("httpbin:echoOptions"), {})).response.body, { options: true });
  const demoExecution = createWorkflowDemo();
  assert.equal(demoExecution.execute(operation("mockHead"), {}).response.body, null);
  assert.equal(demoExecution.execute(operation("mockOptions"), {}).response.body, null);
  assert.equal(demoExecution.execute(operation("mockJsonScalar"), { "body:$": "hello" }).response.body.data, '"hello"');
  for (const [name, values, property, expected] of [
    ["mockJsonObject", jsonValues, "json", { label: "A & B", count: 2, ratio: 1.5, enabled: false, priority: "high", profile: { name: "Ada", count: 3 }, tags: ["one", "two"], note: null }],
    ["mockPlainText", { "body:$": "raw" }, "data", "raw"],
    ["mockUrlEncoded", { "body:name": "Ada" }, "form", { name: "Ada" }],
    ["mockMultipart", { "body:name": "Ada" }, "form", { name: "Ada" }],
    ["mockParameters", { "path:sampleId": "demo", "query:tags": '["a","b"]', "query:count": "2", "header:X-Example-Label": "demo" }, "headers", { "X-Example-Label": "demo" }]
  ]) assert.deepEqual(demoExecution.execute(operation(name), values).response.body[property], expected);
});

Then("structured values root bodies and nested fields flow between example operations", async function () {
  const doc = document(catalogGraph("demo:mockJsonObject", "source"), catalogGraph("demo:mockJsonObject", "target"),
    catalogGraph("demo:mockJsonArray", "array"), catalogGraph("demo:mockJsonScalar", "scalar"), catalogGraph("demo:mockPlainText", "text"));
  for (const path of ["/profile/name", "/profile/count", "/tags/items", "/note"])
    mapping(doc, atPath(doc, "source", "outputs", `/json${path}`), atPath(doc, "target", "inputs", path));
  mapping(doc, atPath(doc, "target", "outputs", "/json/tags"), atPath(doc, "array", "inputs", "/items"));
  mapping(doc, atPath(doc, "source", "outputs", "/json/label"), atPath(doc, "scalar", "inputs", ""));
  mapping(doc, atPath(doc, "scalar", "outputs", "/json"), atPath(doc, "text", "inputs", ""));
  const runner = createWorkflowRunner(doc);
  await submit(runner, jsonValues);
  assert.equal(runner.next().nodeId, "target");
  assert.deepEqual(runner.next().values, { "body:note": null, "body:profile": '{"name":"Ada","count":3}', "body:tags": '["one","two"]' });
  await submit(runner);
  assert.equal(runner.next().nodeId, "scalar");
  await submit(runner);
  assert.equal(runner.next().nodeId, "array");
  assert.deepEqual((await submit(runner)).response.body.json, ["one", "two"]);
  assert.equal(runner.next().nodeId, "text");
  assert.equal((await submit(runner)).response.body.data, "A & B");
  assert.equal(runner.next().kind, "complete");

  const live = document(catalogGraph("httpbin:echoJsonObject", "remote"), catalogGraph("demo:mockJsonObject", "local"));
  mapping(live, atPath(live, "remote", "outputs", "/json/profile"), atPath(live, "local", "inputs", "/profile"));
  const previous = globalThis.fetch;
  const origins = [];
  globalThis.fetch = async (url, options) => { origins.push(new URL(url).origin); return Response.json({ json: JSON.parse(options.body) }); };
  try {
    const mixed = createRequestRunner(live);
    await submit(mixed, jsonValues);
    assert.equal(mixed.next().values["body:profile"], '{"name":"Ada","count":3}');
    assert.deepEqual((await submit(mixed)).response.body.json.profile, { name: "Ada", count: 3 });
    assert.deepEqual(origins, ["https://httpbin.org", "https://example.com"]);
  } finally { globalThis.fetch = previous; }
});

Then("invalid structured connections stop before the next request", async function () {
  const make = (from, to) => {
    const doc = document(catalogGraph("demo:mockJsonObject", "source"), catalogGraph("demo:mockJsonObject", "target"));
    mapping(doc, atPath(doc, "source", "outputs", from), atPath(doc, "target", "inputs", to));
    return doc;
  };
  for (const [from, to, expected] of [["/json/label", "/profile", /needs a object/], ["/json/profile", "/tags", /needs a array/],
    ["/json/label", "/note", /needs a null/], ["/json/label", "/tags/items", /array item path needs an array/],
    ["/json/tags", "/profile", /needs a object/], ["/json/note", "/profile", /needs a object/]]) {
    const runner = createWorkflowRunner(make(from, to));
    await submit(runner, jsonValues);
    assert.throws(() => runner.next(), expected);
  }
  const conflicting = make("/json/profile", "/profile");
  mapping(conflicting, atPath(conflicting, "source", "outputs", "/json/label"), atPath(conflicting, "target", "inputs", "/profile/name"));
  const run = createWorkflowRunner(conflicting);
  await submit(run, jsonValues);
  assert.throws(() => run.next(), /conflicting values/);
  const consistent = make("/json/profile", "/profile");
  mapping(consistent, atPath(consistent, "source", "outputs", "/json/profile/name"), atPath(consistent, "target", "inputs", "/profile/name"));
  const valid = createWorkflowRunner(consistent);
  await submit(valid, jsonValues);
  assert.equal((await submit(valid)).response.body.json.profile.name, "Ada");
});

const pointerPart = name => name.replaceAll("~", "~0").replaceAll("/", "~1");
const addProperty = (doc, owner, direction, path, name, type, schema) => {
  const panel = doc.nodes.find(node => node.type === "data" && node.data.ownerId === owner && node.data.direction === direction
    && (() => {
      const [group, pointer] = JSON.parse(decodeURIComponent(node.id.slice(owner.length + 1)));
      return pointer === (direction === "outputs" && group.startsWith("response:") ? `/body${path}` : path);
    })());
  const graph = addAdditionalProperty(doc.nodes, doc.edges, panel.id, name, type, schema);
  Object.assign(doc, graph);
  return atPath(doc, owner, direction, `${path}/${pointerPart(name)}`);
};
const dynamicFixture = (schema, components) => {
  const source = { openapi: "3.1.0", info: { title: "Dynamic inputs", version: "1" },
    servers: [{ url: "https://example.com" }], components, paths: {
    "/dynamic-source": { get: { operationId: "dynamicSource", responses: { 200: { content: { "application/json": { schema } } } } } },
    "/dynamic-target": { post: { operationId: "dynamicTarget", requestBody: { required: true, content: { "application/json": { schema } } },
      responses: { 200: { content: { "application/json": { schema } } } } } }
  } };
  const added = extractOperations(source, "dynamic-fixture");
  const doc = document(createOperationGraph(added[0], { x: 0, y: 0 }, "source", source),
    createOperationGraph(added[1], { x: 0, y: 0 }, "target", source));
  return { source, added, doc };
};

const registerDynamicFixture = source => {
  const previous = catalogs;
  updateCatalogs([...catalogs, { id: "dynamic-fixture", name: source.info.title, file: "fixture.json",
    document: source, groups: [], execution: { kind: "http", origin: "https://example.com" } }]);
  return () => updateCatalogs(previous);
};

Then("nullable workflow mappings preserve null lock connected values and send exact JSON", async function () {
  for (const [schema, response, paths, expected] of [
    [{ type: "object", properties: { value: { type: ["string", "null"] }, literal: { type: "string", nullable: true },
      omitted: { type: "string", nullable: true } }, required: ["value"] }, { value: null, literal: "null" },
      ["/value", "/literal", "/omitted"], { "body:value": null, "body:literal": "null" }],
    [{ type: ["string", "null"] }, null, [""], { "body:$": null }]
  ]) {
    const { source, doc } = dynamicFixture(schema);
    for (const path of paths) mapping(doc, atPath(doc, "source", "outputs", path), atPath(doc, "target", "inputs", path));
    const requests = [];
    const restore = registerDynamicFixture(source);
    try {
      const runner = createRequestRunner(doc, undefined, createWorkflowRequestExecution(async (_url, options) => {
        requests.push(options);
        return Response.json(options.method === "GET" ? response : JSON.parse(options.body));
      }));
      await submit(runner);
      const visit = runner.next();
      assert.deepEqual(visit.values, expected);
      assert.deepEqual(new Set(visit.mappedFields), new Set(Object.keys(expected)));
      const key = Object.keys(expected)[0];
      for (const replacement of [undefined, "null", "changed"])
        await assert.rejects(() => runner.submit({ ...visit.values, [key]: replacement }), /Connected values cannot be changed/);
      assert.equal(requests.length, 1);
      const completed = await runner.submit({ ...visit.values, "body:omitted": undefined });
      assert.deepEqual(completed.request.body, response);
      assert.equal(requests[1].body, JSON.stringify(response));
      assert.equal(requests[1].headers["Content-Type"], "application/json");
      assert.equal(runner.next().kind, "complete");
    } finally { restore(); }
  }
  const { source, added } = dynamicFixture({ type: ["object", "null"], required: ["value"],
    properties: { value: { type: "string" } }, additionalProperties: false });
  const restore = registerDynamicFixture(source);
  const requests = [];
  try {
    const executor = createWorkflowRequestExecution(async (_url, options) => { requests.push(options); return Response.json({}); });
    const result = await executor.execute(added[1], { "body:$": null });
    assert.equal(result.request.body, null);
    assert.equal(requests[0].body, "null");
    await assert.rejects(() => executor.execute(added[1], { "body:$": undefined }), /required/);
    assert.equal(requests.length, 1);
  } finally { restore(); }
});

Then("added root and nested properties retain unusual names and selected types in requests", async function () {
  for (const policy of [{}, { additionalProperties: true }]) {
    const fixture = dynamicFixture({ type: "object", ...policy, properties: { dictionary: { type: "object", ...policy } } });
    const { source, added, doc } = fixture;
    const response = JSON.parse('{"text":"123","blank":"","spaces":"  ","number":123,"flag":false,"empty":null,"list":[1,"mixed",null],"items":"literal items","*":"literal wildcard","a/b~c":"escaped","__proto__":{"items":{"*":"safe"}},"dictionary":{"items":"nested items","*":"nested wildcard","a/b~c":"nested escaped","__proto__":"nested safe"}}');
    for (const [name, type] of [["text", "Text"], ["number", "Number"], ["flag", "Boolean"], ["empty", "Null"],
      ["list", "Array"], ["items", "Text"], ["*", "Text"], ["a/b~c", "Text"], ["blank", "Text"], ["spaces", "Text"]]) {
      const from = addProperty(doc, "source", "outputs", "", name, type, source);
      const to = addProperty(doc, "target", "inputs", "", name, type, source);
      mapping(doc, from, to);
    }
    for (const owner of ["source", "target"]) {
      const direction = owner === "source" ? "outputs" : "inputs";
      addProperty(doc, owner, direction, "", "__proto__", "Object", source);
      addProperty(doc, owner, direction, "/__proto__", "items", "Object", source);
      addProperty(doc, owner, direction, "/__proto__/items", "*", "Text", source);
    }
    mapping(doc, atPath(doc, "source", "outputs", "/__proto__/items/*"), atPath(doc, "target", "inputs", "/__proto__/items/*"));
    for (const name of ["items", "*", "a/b~c", "__proto__"]) {
      const from = addProperty(doc, "source", "outputs", "/dictionary", name, "Text", source);
      const to = addProperty(doc, "target", "inputs", "/dictionary", name, "Text", source);
      mapping(doc, from, to);
    }
    addProperty(doc, "target", "inputs", "", "manual", "Text", source);
    const requests = [];
    const execution = createWorkflowRequestExecution(async (url, options) => {
      requests.push(options.body === null ? null : JSON.parse(options.body));
      return Response.json(options.method === "GET" ? response : requests.at(-1));
    });
    const restore = registerDynamicFixture(source);
    try {
      const runner = createRequestRunner(JSON.parse(JSON.stringify(doc)), undefined, execution);
      await submit(runner);
      assert.equal(runner.next().operation.fields.find(field => field.name === "text").type, "string");
      assert.equal(runner.next().operation.fields.find(field => field.name === "manual").type, "string");
      assert.equal(runner.next().mappedFields.includes("body:manual"), false);
      assert.equal(runner.next().values["body:text"], "123");
      assert.equal(runner.next().values["body:number"], "123");
      assert.equal(added[1].fields.some(field => field.name === "text"), false);
      const expected = { ...response, manual: "Entered during the run" };
      assert.deepEqual((await submit(runner, { "body:manual": "Entered during the run" })).request.body, expected);
      assert.deepEqual(requests, [null, expected]);
      assert.equal(Object.getPrototypeOf(requests[1]), Object.prototype);
      assert.equal(runner.next().kind, "complete");
    } finally { restore(); }
  }
});

Then("schema constrained additional properties map array entries and reject invalid responses", async function () {
  const fixture = dynamicFixture({ type: "object", additionalProperties: { $ref: "#/components/schemas/Rows" } }, {
    schemas: { Rows: { type: "array", minItems: 1, items: { type: "object", additionalProperties: { type: "integer", minimum: 1, maximum: 3 } } } }
  });
  const { source, added, doc } = fixture;
  for (const owner of ["source", "target"]) {
    const direction = owner === "source" ? "outputs" : "inputs";
    addProperty(doc, owner, direction, "", "rows", "Array", source);
    for (const name of ["items", "*", "a/b~c", "__proto__"]) addProperty(doc, owner, direction, "/rows/items", name, "Integer", source);
  }
  for (const name of ["items", "*", "a/b~c", "__proto__"]) {
    const path = `/rows/items/${pointerPart(name)}`;
    mapping(doc, atPath(doc, "source", "outputs", path), atPath(doc, "target", "inputs", path));
  }
  const restore = registerDynamicFixture(source);
  try {
    for (const valid of [true, false]) {
      const response = JSON.parse('{"rows":[{"items":1,"*":2,"a/b~c":3,"__proto__":1},{"items":3,"*":1,"a/b~c":2,"__proto__":3}]}');
      if (!valid) response.rows[0].items = 0;
      const requests = [];
      const runner = createRequestRunner(doc, undefined, createWorkflowRequestExecution(async (url, options) => {
        requests.push(options.body === null ? null : JSON.parse(options.body));
        return Response.json(options.method === "GET" ? response : requests.at(-1));
      }));
      await submit(runner);
      if (valid) {
        assert.deepEqual((await submit(runner)).request.body, response);
        assert.deepEqual(requests, [null, response]);
      } else {
        assert.throws(() => runner.next(), /outside the allowed range/);
        assert.equal(requests.length, 1);
      }
    }
  } finally { restore(); }
});

const responseField = (doc, owner, path, status = "200") => {
  for (const node of doc.nodes) if (node.type === "data" && node.data.ownerId === owner && node.data.direction === "outputs") {
    const field = node.data.fields.find(field => {
      const [group, pointer] = JSON.parse(decodeURIComponent(field.id));
      return (group === `response:${status}` || group.startsWith(`response:${status}:`)) && pointer === path;
    });
    if (field) return { node, field };
  }
  throw new Error(`Missing response field ${owner} ${status} ${path}`);
};

Then("workflow response envelopes map status messages headers and nested body values", async function () {
  const fixture = dynamicFixture({ type: "object", properties: {
    status: { type: "integer" }, statusText: { type: "string" }, body: { type: "string" },
    count: { type: "integer" }, values: { type: "array", items: { type: "integer" } },
    headers: { type: "object", additionalProperties: true }
  } });
  fixture.source.paths["/dynamic-source"].get.responses[200].headers = {
    "X-Count": { schema: { type: "integer" } }, "X-Values": { schema: { type: "array", items: { type: "integer" } } }
  };
  const restore = registerDynamicFixture(fixture.source);
  try {
    const doc = document(createOperationGraph(fixture.added[0], { x: 0, y: 0 }, "source", fixture.source),
      createOperationGraph(fixture.added[1], { x: 0, y: 0 }, "target", fixture.source));
    for (const [from, to] of [["/status", "/status"], ["/statusText", "/statusText"], ["/body/body", "/body"],
      ["/headers/X-Count", "/count"], ["/headers/X-Values", "/values"], ["/headers", "/headers"]])
      mapping(doc, responseField(doc, "source", from), atPath(doc, "target", "inputs", to));
    const runner = createRequestRunner(doc, undefined, createWorkflowRequestExecution(async (url, options) => options.method === "GET"
      ? Response.json({ body: "actual body", status: 999 }, { statusText: "Fine", headers: {
        "x-count": "7", "X-VALUES": "1, 2,3", "x-undeclared": "raw"
      } }) : Response.json(JSON.parse(options.body))));
    const first = await submit(runner);
    assert.equal(first.response.statusText, "Fine");
    assert.equal(first.response.headers["x-count"], "7", "execution retains raw header values");
    const second = await submit(runner);
    assert.deepEqual(second.request.body, { status: 200, statusText: "Fine", body: "actual body", count: 7, values: [1, 2, 3],
      headers: { "content-type": "application/json", "X-Count": 7, "X-Values": [1, 2, 3], "x-undeclared": "raw" } });

    const noBodySchema = structuredClone(demo);
    noBodySchema.paths["/projects/{projectId}"].get.responses = { 204: { description: "No content" } };
    const noBody = document(createOperationGraph(operation("getProject"), { x: 0, y: 0 }, "source", noBodySchema), catalogGraph("demo:mockJsonObject", "target"));
    mapping(noBody, responseField(noBody, "source", "/body", "204"), atPath(noBody, "target", "inputs", "/note"));
    const emptyRunner = createRequestRunner(noBody, undefined, createWorkflowRequestExecution(async (url, options) =>
      options.method === "GET" ? new Response(null, { status: 204 }) : Response.json(JSON.parse(options.body))));
    assert.equal((await submit(emptyRunner, project)).response.statusText, "", "absent status messages remain empty");
    assert.deepEqual((await submit(emptyRunner)).request.body, { note: null });
  } finally { restore(); }
});

Then("documented response headers decode simple scalars arrays and objects safely", function () {
  const fixture = dynamicFixture({ type: "object" }, { headers: { Count: { schema: { $ref: "#/components/schemas/Count" } } },
    schemas: { Count: { type: "integer" } } });
  fixture.source.paths["/dynamic-source"].get.responses[200].headers = {
    "X-Count": { $ref: "#/components/headers/Count" },
    "X-Array": { schema: { type: "array", items: { type: "number" } } },
    "X-Object": { explode: true, schema: { type: "object", properties: { count: { type: "integer" }, flag: { type: "boolean" } }, additionalProperties: false } },
    "X-Pairs": { schema: { type: "object", properties: { count: { type: "integer" } }, additionalProperties: { type: "boolean" } } },
    "X-Nested": { schema: { type: "array", items: { type: "object" } } },
    "X-Content": { content: { "application/json": { schema: { type: "object" } } } }
  };
  const restore = registerDynamicFixture(fixture.source);
  try {
    const reader = raw => responseHeaderReader(fixture.added[0].id, 200, raw);
    assert.equal(reader({ "x-count": "12" })("X-COUNT"), 12);
    assert.deepEqual(reader({ "x-array": "1.5, 2,3e2" })("x-array"), [1.5, 2, 300]);
    assert.deepEqual(reader({ "x-object": "count=2,flag=false" })("X-Object"), { count: 2, flag: false });
    assert.deepEqual(reader({ "x-pairs": "count,3,other,true" })("X-Pairs"), { count: 3, other: true });
    assert.equal(reader({ "x-undeclared": "001" })("X-Undeclared"), "001");
    assert.equal(reader({})("missing"), undefined);
    for (const [raw, name, message] of [[{ "x-count": "twelve" }, "X-Count", /valid integer/],
      [{ "x-count": "9007199254740992" }, "X-Count", /valid integer/],
      [{ "x-object": "count=2,flag=no" }, "X-Object", /true or false/],
      [{ "x-pairs": "count" }, "X-Pairs", /alternating property/],
      [{ "x-nested": "nested" }, "X-Nested", /nested or alternative/],
      [{ "x-content": "{}" }, "X-Content", /only simple/]])
      assert.throws(() => reader(raw)(name), message);
  } finally { restore(); }
});

Then("response routing prefers exact statuses then ranges then defaults", async function () {
  for (const [status, includeRange, expected] of [[200, true, "exact"], [202, true, "range"], [202, false, "fallback"]]) {
    const schema = structuredClone(demo);
    const response = { description: "Project identifier", content: { "application/json": { schema: { type: "string" } } } };
    schema.paths["/projects/{projectId}"].get.responses = { 200: response, ...(includeRange ? { "2XX": response } : {}), default: response };
    const doc = document(createOperationGraph(operation("getProject"), { x: 0, y: 0 }, "source", schema),
      graph("createTask", "exact"), ...(includeRange ? [graph("createTask", "range")] : []), graph("createTask", "fallback"));
    for (const [key, owner] of [["200", "exact"], ...(includeRange ? [["2XX", "range"]] : []), ["default", "fallback"]])
      mapping(doc, responseField(doc, "source", "/body", key), input(doc, owner, "Path value"));
    const fixture = createWorkflowDemo();
    const runner = createRequestRunner(doc, undefined, { execute(operation, values) {
      return operation.id === "demo:getProject" ? { request: { method: "GET", path: "/projects/project-1", query: {} },
        response: { status, statusText: "", headers: {}, body: "project-1" } } : fixture.execute(operation, values);
    } });
    await submit(runner, project);
    assert.equal(runner.next().nodeId, expected);
    await submit(runner, task);
    assert.equal(runner.next().kind, "complete", "less specific response branches remain inactive");
  }
});

Then("legacy response body properties remain unambiguous beside envelope fields", async function () {
  const source = graph("getProject", "source");
  const outputIds = new Set(source.nodes.filter(node => node.type === "data" && node.data.direction === "outputs").map(node => node.id));
  source.nodes = source.nodes.filter(node => !outputIds.has(node.id));
  source.edges = source.edges.filter(edge => !outputIds.has(edge.source) && !outputIds.has(edge.target));
  const field = { id: encodeURIComponent(JSON.stringify(["output:200:application/json", "/body"])), label: "Legacy body property",
    type: "Text", required: false, description: "", connectable: true };
  const id = `source:${encodeURIComponent(JSON.stringify(["output:200:application/json", ""]))}`;
  source.nodes.push({ id, type: "data", position: { x: 0, y: 0 }, data: { ownerId: "source", direction: "outputs", label: "Response", fields: [field] } });
  source.edges.push({ id: `schema:${id}`, kind: "schema", source: "source", target: id, sourceHandle: `schema:${id}`, targetHandle: "value" });
  const doc = document(source, graph("createTask", "target"));
  mapping(doc, output(doc, "source", "Legacy body property"), input(doc, "target", "Path value"));
  const fixture = createWorkflowDemo();
  const runner = createRequestRunner(doc, undefined, { execute(operation, values) {
    return operation.id === "demo:getProject" ? { request: { method: "GET", path: "/projects/project-1", query: {} },
      response: { status: 200, statusText: "OK", headers: {}, body: { body: "project-1" } } } : fixture.execute(operation, values);
  } });
  await submit(runner, project);
  assert.equal(runner.next().values["path:projectId"], "project-1");
  await submit(runner, task);
  assert.equal(runner.next().kind, "complete");
});

Then(/^a workflow request that (honors|ignores) cancellation can be cancelled without ending its run$/, async function (behavior) {
  let settle;
  let signal;
  let calls = 0;
  const response = { request: { method: "GET", path: "/projects/project-1", query: {} },
    response: { status: 200, statusText: "OK", headers: {}, body: { id: "project-1" } } };
  const runner = createRequestRunner(document(graph("getProject")), undefined, {
    execute(_operation, _values, pendingSignal) {
      signal = pendingSignal;
      if (++calls > 1) return response;
      return new Promise((resolve, reject) => {
        settle = () => behavior === "honors" && signal.aborted
          ? reject(new Error("The request was cancelled.")) : resolve(response);
      });
    }
  });
  runner.cancelPending();
  const visit = runner.next();
  const pendingRequest = runner.submit(project);
  runner.cancelPending();
  assert.equal(signal.aborted, true);
  assert.equal(runner.done, false);
  await assert.rejects(() => runner.submit(project), /already has a request in progress/);
  settle();
  await assert.rejects(pendingRequest, /request was cancelled/);
  assert.equal(runner.next(), visit);
  assert.equal((await runner.submit(project)).response.body.id, "project-1");
  assert.equal(signal.aborted, false);
  runner.cancelPending();
  assert.equal(runner.next().kind, "complete");
});

Then('service workflow inputs retain required defaults generic JSON values and execution guards', async () => {
  const canonical = operation('getProject');
  const fields = canonical.fields;
  try {
    canonical.fields = fields.map(field => field.key === 'path:projectId' ? { ...field, defaultValue: 'project-1' } : field);
    const runner = createWorkflowRunner(document(graph('getProject')));
    assert.equal(runner.next().values['path:projectId'], 'project-1');
    canonical.unavailableReason = 'Unsupported service transport';
    assert.throws(() => createWorkflowRunner(document(graph('getProject'))).next(), /Unsupported service transport/);
  } finally { canonical.fields = fields; delete canonical.unavailableReason; }
  for (const response of ['literal text', 7, false, null, { nested: [1, true] }]) {
    const fixture = dynamicFixture({ type: 'string' });
    const restore = registerDynamicFixture(fixture.source);
    try {
      const target = operations.find(item => item.id === fixture.added[1].id);
      target.fields = target.fields.map(field => ({ ...field, type: 'json', schema: { type: 'json' } }));
      target.bodySchema = { type: 'json' };
      mapping(fixture.doc, atPath(fixture.doc, 'source', 'outputs', ''), atPath(fixture.doc, 'target', 'inputs', ''));
      const runner = createRequestRunner(fixture.doc, undefined, createWorkflowRequestExecution(async (_url, options) =>
        Response.json(options.method === 'GET' ? response : JSON.parse(options.body))));
      await submit(runner);
      const next = runner.next();
      assert.equal(next.values['body:$'], JSON.stringify(response));
      assert.deepEqual((await runner.submit(next.values)).request.body, response);
    } finally { restore(); }
  }
});


Then("response schema links persist and route each selected status through the shared fields", async function () {
  const { parseWorkflowDocument } = await import("./lib/workflow-document.ts");
  const schema = structuredClone(demo);
  const response = { description: "Shared error", content: { "application/json": { schema: { type: "string" } } } };
  schema.paths["/projects/{projectId}"].get.responses = { 401: response, 404: response,
    400: { description: "Different", content: { "application/json": { schema: { type: "integer" } } } } };
  for (const status of [401, 404]) {
    let doc = document(createOperationGraph(operation("getProject"), { x: 0, y: 0 }, "source", schema), graph("createTask", "target"));
    const root = code => doc.edges.find(edge => edge.kind === "schema" && edge.source === "source" &&
      decodeURIComponent(edge.target).includes(`response:${code}`));
    const canonical = root(401), alternate = root(404), wrong = root(400);
    const hidden = removeGraphSelection({ nodes: [{ id: alternate.target }], edges: [] }, doc.nodes, doc.edges);
    doc = { ...doc, ...hidden };
    const link = { id: "shared-response", kind: "response", source: "source", sourceHandle: alternate.sourceHandle,
      target: canonical.target, targetHandle: "value" };
    assert.ok(isWorkflowConnection(link, doc.nodes, doc.edges), "hidden 404 can connect to visible compatible 401");
    assert.equal(isWorkflowConnection({ ...link, sourceHandle: wrong.sourceHandle }, doc.nodes, doc.edges), false);
    doc.edges.push(link);
    assert.equal(isWorkflowConnection(link, doc.nodes, doc.edges), false, "duplicate response links are rejected");
    mapping(doc, responseField(doc, "source", "/body", "401"), input(doc, "target", "Path value"));
    doc = parseWorkflowDocument(JSON.stringify(doc));
    assert.ok(doc.edges.some(edge => edge.id === link.id && edge.kind === "response"));
    const { copyWorkflowSelection, pasteWorkflowSelection } = await import("./lib/workflow-clipboard.ts");
    const copied = pasteWorkflowSelection(copyWorkflowSelection(doc, ["source", "target"], []));
    assert.doesNotThrow(() => parseWorkflowDocument(JSON.stringify({ ...doc, ...copied })));
    const differentOwner = { ...link, source: "target" };
    assert.equal(isWorkflowConnection(differentOwner, doc.nodes, doc.edges), false);
    assert.throws(() => parseWorkflowDocument(JSON.stringify({ ...doc, edges: [...doc.edges, { ...link, id: "duplicate" }] })));
    const fixture = createWorkflowDemo();
    const runner = createRequestRunner(doc, undefined, { execute(operation, values) {
      return operation.id === "demo:getProject" ? { request: { method: "GET", path: "/projects/project-1", query: {} },
        response: { status, statusText: "Error", headers: {}, body: "project-1" } } : fixture.execute(operation, values);
    } });
    await submit(runner, project);
    assert.equal(runner.next().nodeId, "target");
    assert.equal(runner.next().values["path:projectId"], "project-1");
    await submit(runner, task);
    assert.equal(runner.next().kind, "complete");
  }
});

Then("one input schema fans mapped values out to multiple operations after reload", async function () {
  const { parseWorkflowDocument } = await import("./lib/workflow-document.ts");
  const doc = document(graph("getProject", "source"), graph("createTask", "first"), graph("createTask", "second"), graph("createTask", "third"));
  const root = owner => doc.edges.find(edge => edge.kind === "schema" && edge.target === owner &&
    decodeURIComponent(edge.source).includes('input:path'));
  const canonical = root("first");
  for (const owner of ["second", "third"]) {
    const attachment = root(owner);
    const hidden = removeGraphSelection({ nodes: [{ id: attachment.source }], edges: [] }, doc.nodes, doc.edges);
    Object.assign(doc, hidden);
    const link = { id: `input-${owner}`, kind: "input", source: canonical.source, sourceHandle: "value",
      target: owner, targetHandle: attachment.targetHandle };
    assert.ok(isWorkflowConnection(link, doc.nodes, doc.edges));
    doc.edges.push(link);
  }
  mapping(doc, output(doc, "source", "Path value"), input(doc, "first", "Path value"));
  const saved = parseWorkflowDocument(JSON.stringify(doc));
  assert.equal(saved.edges.filter(edge => edge.kind === "input").length, 2);
  const fixture = createWorkflowDemo();
  const runner = createRequestRunner(saved, "source", fixture);
  await submit(runner, project);
  const visited = new Set();
  for (let index = 0; index < 3; index++) {
    let next = runner.next();
    if (next.kind === "choice") { runner.choose(next.choices[0].id); next = runner.next(); }
    assert.equal(next.kind, "operation");
    assert.equal(next.values["path:projectId"], "project-1");
    visited.add(next.nodeId);
    await submit(runner, task);
  }
  assert.deepEqual([...visited].sort(), ["first", "second", "third"]);
  assert.equal(runner.next().kind, "complete");
  const { pasteWorkflowSelection, copyWorkflowSelection } = await import("./lib/workflow-clipboard.ts");
  assert.doesNotThrow(() => parseWorkflowDocument(JSON.stringify({ ...doc, ...pasteWorkflowSelection(copyWorkflowSelection(doc, ["first", "second", "third", "source"], [])) })));
  assert.equal(isWorkflowConnection({ source: canonical.source, sourceHandle: "value", target: "second", targetHandle: doc.edges.find(edge => edge.kind === "schema" && edge.target === "second" && decodeURIComponent(edge.source).includes("input:body"))?.targetHandle }, doc.nodes, doc.edges), false);
});
