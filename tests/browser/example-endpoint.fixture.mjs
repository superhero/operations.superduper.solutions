// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

/** Browser-only HTTP fixture. The application must send a request to receive any of these values. */
export function createExampleEndpoint() {
  const projects = [
    { id: "project-1", name: "Documentation", status: "active" },
    { id: "project-2", name: "Website", status: "archived" }
  ];
  const tasks = new Map([["task-1", { id: "task-1", projectId: "project-1", title: "Review the project guide", priority: "normal", completed: false }]]);
  let serial = 1;
  return async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const mediaType = request.headers()["content-type"] ?? "";
    const text = request.postData() ?? "";
    const body = text && mediaType.includes("json") ? JSON.parse(text) : text;
    let response;
    let status = 200;
    const project = /^\/projects\/([^/]+)(\/tasks)?$/.exec(url.pathname);
    const task = /^\/tasks\/([^/]+)$/.exec(url.pathname);
    if (method === "GET" && url.pathname === "/projects") {
      const name = (url.searchParams.get("name") ?? "").toLowerCase();
      response = projects.filter(project => project.name.toLowerCase().includes(name)).slice(0, Number(url.searchParams.get("limit") ?? 100));
    } else if (project && method === "GET" && !project[2]) {
      const id = decodeURIComponent(project[1]);
      if (id === "missing-project") { status = 404; response = { error: "Project was not found by the fixture endpoint." }; }
      else response = projects.find(project => project.id === id) ?? { id, name: "Fixture project", status: "active" };
    } else if (project && method === "POST" && project[2]) {
      response = { id: `task-${++serial}`, projectId: decodeURIComponent(project[1]), ...body, completed: false };
      tasks.set(response.id, response);
      status = 201;
    } else if (task && method === "PATCH") {
      const id = decodeURIComponent(task[1]);
      response = { ...tasks.get(id), id, ...body };
      tasks.set(id, response);
    } else if (url.pathname.startsWith("/examples/")) {
      const query = {};
      for (const key of new Set(url.searchParams.keys())) {
        const values = url.searchParams.getAll(key);
        query[key] = values.length > 1 ? values : values[0];
      }
      response = { method, url: url.href, origin: "browser test endpoint", args: query, headers: request.headers(),
        json: mediaType.includes("json") ? body : null, data: text,
        form: mediaType.includes("x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(text)) : {}, files: {} };
    } else throw new Error(`No browser endpoint fixture for ${method} ${url.pathname}`);
    await route.fulfill({ status, headers: { "access-control-allow-origin": "*" }, contentType: "application/json",
      body: method === "HEAD" || method === "OPTIONS" ? "" : JSON.stringify(response) });
  };
}
