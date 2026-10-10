// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { operations, type JsonValue, type Operation } from "./catalog.ts";
import { catalogForOperation } from "./catalog-registry.ts";
import { prepareRequest, type PreparedRequest } from "./operation-input.ts";
import type { WorkflowResponse } from "./workflow-execution.ts";

export type DemoResult = { request: PreparedRequest; response: WorkflowResponse };
type Project = { id: string; name: string; status: string };
type Task = { id: string; projectId: string; title: string; priority: string; completed: boolean; estimate?: number };

/** Explicit test fixture, with mutable data scoped to one injected executor. */
export function createWorkflowDemo()
{
  const projects: Project[] = [
    { id: "project-1", name: "Documentation", status: "active" },
    { id: "project-2", name: "Website", status: "archived" }
  ];
  const tasks = new Map<string, Task>([["task-1", {
    id: "task-1", projectId: "project-1", title: "Review the project guide", priority: "normal", completed: false
  }]]);
  let serial = 1;
  return {
    execute(operation: Operation, values: Record<string, string>): DemoResult
    {
      const canonical = operations.find(item => item.id === operation.id);
      if (!canonical || canonical.method !== operation.method || canonical.path !== operation.path
        || catalogForOperation(canonical.id)!.id !== "demo")
        throw new Error("This operation is unavailable in the local demo.");
      const request = prepareRequest(canonical, values);
      let response: WorkflowResponse;
      if (canonical.id === "demo:listProjects")
      {
        const name = String(request.query.name ?? "").toLowerCase();
        response = { status: 200, body: projects.filter(project => project.name.toLowerCase().includes(name))
          .slice(0, Number(request.query.limit ?? 100)) };
      }
      else if (canonical.id === "demo:getProject" || canonical.id === "demo:createTask")
      {
        const id = decodeURIComponent(request.path.split("/")[2]!);
        const project = projects.find(item => item.id === id);
        if (!project) throw new Error(`Project “${id}” was not found in this demo. Use project-1 or project-2.`);
        if (canonical.id === "demo:getProject") response = { status: 200, body: project };
        else
        {
          const body = request.body as Record<string, JsonValue>;
          const task: Task = { id: `task-${++serial}`, projectId: id, title: String(body.title),
            priority: String(body.priority), completed: false,
            ...(body.estimate === undefined ? {} : { estimate: Number(body.estimate) }) };
          tasks.set(task.id, task);
          response = { status: 201, body: task };
        }
      }
      else if (canonical.id === "demo:updateTask")
      {
        const id = decodeURIComponent(request.path.split("/")[2]!);
        const task = tasks.get(id);
        if (!task) throw new Error(`Task “${id}” was not found in this demo. Use task-1 or an ID created earlier in this run.`);
        const body = request.body as Record<string, JsonValue>;
        const updated: Task = { ...task,
          ...(body.title === undefined ? {} : { title: String(body.title) }),
          ...(body.priority === undefined ? {} : { priority: String(body.priority) }),
          ...(body.completed === undefined ? {} : { completed: body.completed === true }) };
        tasks.set(id, updated);
        response = { status: 200, body: updated };
      }
      else
      {
        const origin = catalogForOperation(canonical.id)!.execution.origin;
        const url = new URL(request.path, origin);
        for (const [name, value] of Object.entries(request.query))
          for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(name, String(item));
        response = { status: 200, body: canonical.method === "HEAD" || canonical.method === "OPTIONS" ? null : {
          method: request.method, url: url.href, origin: "local mock", args: request.query, headers: request.headers ?? {},
          json: request.contentType ? null : request.body ?? null,
          data: request.contentType === "text/plain" ? request.body : !request.contentType && request.body !== undefined ? JSON.stringify(request.body) : "",
          form: request.contentType === "application/x-www-form-urlencoded" || request.contentType === "multipart/form-data" ? request.body : {}, files: {}
        } };
      }
      return { request, response: structuredClone(response) };
    }
  };
}
