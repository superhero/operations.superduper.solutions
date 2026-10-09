// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import demo from "./catalogs/demo.openapi.json" with { type: "json" };
import { operations } from "./lib/catalog.ts";
import { catalogForOperation } from "./lib/catalog-registry.ts";
import { createOperationGraph, createWorkflowGraph } from "./lib/workflow-graph.ts";
import { createWorkflowRunner as createRequestRunner } from "./lib/workflow-runner.ts";
import { createWorkflowDemo } from "./lib/workflow-demo.ts";
import { createWorkflowRequestExecution, workflowExecutionForOperation, workflowRequestUrl } from "./lib/workflow-execution.ts";

const createWorkflowRunner = createRequestRunner;

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
    mapping(doc, output(doc, "getProject", "Project ID"), input(doc, "createTask", "Project ID"));
    mapping(doc, output(doc, "createTask", "Task ID"), input(doc, "updateTask", "Task ID"));
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
    await assert.rejects(() => execution.execute({ ...operation("getProject"), method: "POST" }, project), /bundled test catalog/);
    await assert.rejects(() => execution.execute({ ...operation("getProject"), id: "unknown" }, project), /bundled test catalog/);
    await assert.rejects(() => execution.execute({ ...operation("getProject"), path: "https:\/\/another.example/" }, project), /bundled test catalog/);
  } finally { globalThis.fetch = previous; }
});

Then("workflow request failures explain network server and response problems and allow retry", async function () {
  const failed = createWorkflowRequestExecution(async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(() => failed.execute(operation("getProject"), project), /could not reach https:\/\/example.com/);
  await assert.rejects(() => failed.execute(operation("getProject"), project, AbortSignal.abort()), /cancelled/);
  const timeout = AbortSignal.timeout;
  AbortSignal.timeout = () => AbortSignal.abort();
  try { await assert.rejects(() => failed.execute(operation("getProject"), project), /timed out/); }
  finally { AbortSignal.timeout = timeout; }
  for (const [response, expected] of [
    [new Response("server failure", { status: 503, statusText: "Unavailable" }), /503 Unavailable/],
    [new Response("missing", { status: 404 }), /404/],
    [new Response("<!doctype html><title>Example Domain</title>"), /did not return valid JSON/]
  ]) {
    const execution = createWorkflowRequestExecution(async () => response);
    await assert.rejects(() => execution.execute(operation("getProject"), project), expected);
  }
  const streamingFailure = createWorkflowRequestExecution(async () => {
    const response = Response.json({});
    response.text = async () => { throw new TypeError("Disconnected while reading"); };
    return response;
  });
  await assert.rejects(() => streamingFailure.execute(operation("getProject"), project), /response could not be read/);
  await assert.rejects(() => streamingFailure.execute(operation("getProject"), project, AbortSignal.abort()), /cancelled/);
  AbortSignal.timeout = () => AbortSignal.abort();
  try { await assert.rejects(() => streamingFailure.execute(operation("getProject"), project), /timed out/); }
  finally { AbortSignal.timeout = timeout; }
  let calls = 0;
  const execution = createWorkflowRequestExecution(async () => {
    calls++;
    if (calls === 1) return new Response("not-json");
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
  resolve({ request: { method: "GET", path: "/projects/project-1", query: {} }, response: { status: 200, body: { id: "late" } } });
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
    assert.deepEqual(choice.choices.map(item => item.label), ["Get project 1", "Get project 2"]);
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
  mapping(doc, output(doc, "getProject", "Project ID"), input(doc, "createTask", "Project ID"));
  mapping(doc, output(doc, "createTask", "Task ID"), input(doc, "updateTask", "Task ID"));
  const before = structuredClone(doc);
  const runner = createWorkflowRunner(doc);
  assert.equal(runner.next().operation.id, "demo:getProject");
  await assert.rejects(() => runner.submit({}), /Project ID: this field is required/);
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
  mapping(doc, output(doc, "getProject", "Project ID"), { id: "switch", handle: "value" });
  mapping(doc, output(doc, "getProject", "Project ID"), { id: "switch", handle: "gate-value:match" });
  mapping(doc, { id: "switch", handle: "match" }, input(doc, "createTask", "Project ID"));
  mapping(doc, { id: "switch", handle: "unused" }, { id: "inactive-cast", handle: "value" });
  mapping(doc, { id: "inactive-cast", handle: "result" }, input(doc, "inactive", "Project ID"));
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
  mapping(doc, output(doc, "getProject", "Project ID"), input(doc, "nested", "Project ID"));
  mapping(doc, output(doc, "nested", "Task ID"), input(doc, "updateTask", "Task ID"));
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
  mapping(doc, output(doc, "getProject", "Project ID"), input(doc, "a", "Project ID"));
  mapping(doc, output(doc, "getProject", "Project ID"), input(doc, "b", "Project ID"));
  const runner = createWorkflowRunner(doc);
  for (const id of ["getProject", "a", "b"]) { assert.equal(runner.next().nodeId, id); await submit(runner, project); }
  assert.equal(runner.next().kind, "complete");
  mapping(doc, output(doc, "getProject", "Project name"), input(doc, "a", "Project ID"));
  const conflict = createWorkflowRunner(doc);
  await submit(conflict, project);
  assert.throws(() => conflict.next(), /different values to the same input/);
  assert.throws(() => conflict.next(), /different values to the same input/);
  const disconnected = document(graph("getProject", "one"), graph("getProject", "two"), graph("createTask"));
  mapping(disconnected, output(disconnected, "one", "Project ID"), input(disconnected, "createTask", "Project ID"));
  mapping(disconnected, output(disconnected, "two", "Project name"), input(disconnected, "createTask", "Title"));
  const waiting = createWorkflowRunner(disconnected);
  waiting.next(); waiting.choose("one"); await submit(waiting, project);
  assert.throws(() => waiting.next(), /unresolved branch/);
});

Then("unavailable operations invalid mapped values and workflow cycles stop with useful errors", async function () {
  const bad = document(graph("getProject"));
  bad.nodes[0].data.operationId = "unavailable:operation";
  assert.throws(() => createWorkflowRunner(bad).next(), /unavailable in the bundled test catalog/);
  const wrongType = document(graph("getProject"), graph("listProjects"));
  mapping(wrongType, output(wrongType, "getProject", "Project ID"), input(wrongType, "listProjects", "Result limit"));
  const typeRun = createWorkflowRunner(wrongType);
  await submit(typeRun, project);
  assert.throws(() => typeRun.next(), /needs an integer value/);
  const invalidPath = document(graph("getProject"));
  output(invalidPath, "getProject", "Project ID").field.id = "unsupported";
  const pathRun = createWorkflowRunner(invalidPath);
  await submit(pathRun, project);
  assert.throws(() => pathRun.next(), /unsupported path/);
  const cycle = document(graph("getProject", "first"), graph("getProject", "second"));
  mapping(cycle, output(cycle, "first", "Project ID"), input(cycle, "second", "Project ID"));
  mapping(cycle, output(cycle, "second", "Project ID"), input(cycle, "first", "Project ID"));
  const cycleRun = createWorkflowRunner(cycle);
  cycleRun.next(); cycleRun.choose("first");
  await submit(cycleRun, project);
  await submit(cycleRun, project);
  assert.throws(() => cycleRun.next(), /loops back to a completed operation/);
  await assert.rejects(() => cycleRun.submit(project), /no operation ready/);
  const collection = document(graph("listProjects"), graph("getProject"));
  mapping(collection, output(collection, "listProjects", "Project ID"), input(collection, "getProject", "Project ID"));
  const arrayRun = createWorkflowRunner(collection);
  await submit(arrayRun);
  assert.throws(() => arrayRun.next(), /needs a string value/);
  const stale = document(graph("getProject"), graph("createTask"));
  const staleField = input(stale, "createTask", "Project ID");
  staleField.field.id = encodeURIComponent(JSON.stringify(["input:path", "/removedProjectId"]));
  mapping(stale, output(stale, "getProject", "Project ID"), staleField);
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
  mapping(scalar, output(scalar, "scalar", "Response body"), input(scalar, "createTask", "Project ID"));
  const fixture = createWorkflowDemo();
  const scalarRunner = createRequestRunner(scalar, undefined, { execute(operation, values) {
    return operation.id === "demo:getProject" ? { request: { method: "GET", path: "/projects/project-1", query: {} }, response: { status: 202, body: "project-1" } }
      : fixture.execute(operation, values);
  } });
  await submit(scalarRunner, project);
  assert.equal(scalarRunner.next().values["path:projectId"], "project-1");
  await submit(scalarRunner, task);
  assert.equal(scalarRunner.next().kind, "complete");

  const missing = document(graph("getProject"), graph("createTask"),
    utility("switch", "unset", { gates: [{ id: "missing", operator: "is_not_set", value: "" }] }));
  mapping(missing, output(missing, "getProject", "Project ID"), { id: "unset", handle: "value" });
  mapping(missing, { id: "unset", handle: "missing" }, input(missing, "createTask", "Project ID"));
  const missingRunner = createRequestRunner(missing, undefined, { execute(operation, values) {
    return operation.id === "demo:getProject" ? { request: { method: "GET", path: "/projects/project-1", query: {} }, response: { status: 200, body: {} } }
      : fixture.execute(operation, values);
  } });
  await submit(missingRunner, project);
  assert.equal(missingRunner.next().nodeId, "createTask");
  assert.deepEqual(missingRunner.next().values, {});
  assert.deepEqual(missingRunner.next().mappedFields, []);
  await assert.rejects(() => missingRunner.submit({ "body:title": "Missing project", "body:priority": "normal" }), /Project ID: this field is required/);
  await submit(missingRunner, task);
  assert.equal(missingRunner.next().kind, "complete");
});

Then("inactive switch operands preserve active gates and missing main values are explained", async function () {
  const doc = document(graph("getProject"), graph("createTask"), graph("getProject", "skipped"),
    utility("switch", "filter", { gates: [{ id: "never", operator: "==", value: "never-match" }] }),
    utility("switch", "main", { gates: [{ id: "equal", operator: "==", value: "project-1" }, { id: "set", operator: "is_set", value: "" }] }),
    utility("switch", "inactive", { gates: [{ id: "set", operator: "is_set", value: "" }] }));
  mapping(doc, output(doc, "getProject", "Project ID"), { id: "filter", handle: "value" });
  mapping(doc, output(doc, "getProject", "Project ID"), { id: "main", handle: "value" });
  mapping(doc, { id: "filter", handle: "never" }, { id: "main", handle: "gate-value:equal" });
  mapping(doc, { id: "filter", handle: "never" }, { id: "inactive", handle: "value" });
  mapping(doc, { id: "inactive", handle: "set" }, input(doc, "skipped", "Project ID"));
  mapping(doc, { id: "main", handle: "equal" }, input(doc, "skipped", "Project ID"));
  mapping(doc, { id: "main", handle: "set" }, input(doc, "createTask", "Project ID"));
  const runner = createWorkflowRunner(doc);
  await submit(runner, project);
  assert.equal(runner.next().nodeId, "createTask");
  await submit(runner, task);
  assert.equal(runner.next().kind, "complete");
  const noMain = document(graph("getProject"), utility("switch", "switch", { gates: [{ id: "operand", operator: "==", value: "" }] }));
  mapping(noMain, output(noMain, "getProject", "Project ID"), { id: "switch", handle: "gate-value:operand" });
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
    const field = node.data.fields.find(field => JSON.parse(decodeURIComponent(field.id))[1] === path);
    if (field) return { node, field };
  }
  throw new Error(`Missing ${owner} ${direction} ${path}`);
};
const jsonValues = { "body:label": "A & B", "body:count": "2", "body:ratio": "1.5", "body:enabled": "false",
  "body:priority": "high", "body:profile": '{"name":"Ada","count":3}', "body:tags": '["one","two"]', "body:note": "null" };

Then("mock examples cover every method without network traffic and live examples use their registered origin", async function () {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return options.method === "HEAD" || options.method === "OPTIONS" ? new Response(null) : Response.json({ method: options.method, remote: true });
  };
  try {
    for (const op of operations.filter(op => op.id.startsWith("demo:mock") && !op.fields.length)) {
      const result = await submit(createRequestRunner(document(catalogGraph(op.id))));
      assert.equal(result.request.method, op.method);
      assert.equal(result.response.status, 200);
      if (["HEAD", "OPTIONS"].includes(op.method)) assert.equal(result.response.body, null);
      else assert.equal(result.response.body.method, op.method);
    }
    assert.equal(calls.length, 0);
    for (const op of operations.filter(op => op.id.startsWith("httpbin:echo") && !op.fields.length)) {
      const result = await submit(createRequestRunner(document(catalogGraph(op.id))));
      assert.equal(result.request.method, op.method);
      if (!["HEAD", "OPTIONS"].includes(op.method)) assert.equal(result.response.body.remote, true);
    }
    assert.equal(calls.length, 7);
    assert.ok(calls.every(call => call.url.startsWith("https://httpbin.org/")));
    assert.deepEqual(workflowExecutionForOperation("demo:mockTrace"), { kind: "mock", origin: "https://example.com" });
    assert.deepEqual(workflowExecutionForOperation(catalogOperation("httpbin:echoGet")), { kind: "http", origin: "https://httpbin.org" });
    assert.throws(() => workflowExecutionForOperation("unknown:operation"), /bundled test catalog/);
    assert.throws(() => createWorkflowDemo().execute(catalogOperation("httpbin:echoGet"), {}), /unavailable/);
    const first = createRequestRunner(document(graph("createTask")));
    const second = createRequestRunner(document(graph("createTask")));
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
  const runner = createRequestRunner(doc);
  await submit(runner, jsonValues);
  assert.equal(runner.next().nodeId, "target");
  assert.deepEqual(runner.next().values, { "body:note": "null", "body:profile": '{"name":"Ada","count":3}', "body:tags": '["one","two"]' });
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
  globalThis.fetch = async (url, options) => { assert.ok(url.startsWith("https://httpbin.org")); return Response.json({ json: JSON.parse(options.body) }); };
  try {
    const mixed = createRequestRunner(live);
    await submit(mixed, jsonValues);
    assert.equal(mixed.next().values["body:profile"], '{"name":"Ada","count":3}');
    assert.deepEqual((await submit(mixed)).response.body.json.profile, { name: "Ada", count: 3 });
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
    const runner = createRequestRunner(make(from, to));
    await submit(runner, jsonValues);
    assert.throws(() => runner.next(), expected);
  }
  const conflicting = make("/json/profile", "/profile");
  mapping(conflicting, atPath(conflicting, "source", "outputs", "/json/label"), atPath(conflicting, "target", "inputs", "/profile/name"));
  const run = createRequestRunner(conflicting);
  await submit(run, jsonValues);
  assert.throws(() => run.next(), /conflicting values/);
  const consistent = make("/json/profile", "/profile");
  mapping(consistent, atPath(consistent, "source", "outputs", "/json/profile/name"), atPath(consistent, "target", "inputs", "/profile/name"));
  const valid = createRequestRunner(consistent);
  await submit(valid, jsonValues);
  assert.equal((await submit(valid)).response.body.json.profile.name, "Ada");
});
