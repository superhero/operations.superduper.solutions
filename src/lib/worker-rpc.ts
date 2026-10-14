// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { trackApplicationWorker } from "./application-workers.ts";
import { reportApplicationError } from "./error-diagnostics.ts";

type RemoteError = { name: string; message: string; stack?: string; code?: string | number; cause?: RemoteError; errors?: RemoteError[] };
type Request = { kind: "request"; id: number; method: string; args: unknown[] };
export type WorkerEvent = { type: string; data: unknown };
type Reply = { kind: "result"; id: number; value: unknown } | { kind: "error"; id: number; error: RemoteError }
  | { kind: "event"; event: WorkerEvent };

function encodeError(value: unknown, depth = 0): RemoteError {
  if (depth > 8) return { name: "Error", message: "Further error causes omitted." };
  const error = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result: RemoteError = {
    name: typeof error.name === "string" ? error.name : "Error",
    message: typeof error.message === "string" ? error.message : String(value),
  };
  if (typeof error.stack === "string") result.stack = error.stack;
  if (typeof error.code === "string" || typeof error.code === "number") result.code = error.code;
  if (error.cause !== undefined) result.cause = encodeError(error.cause, depth + 1);
  if (Array.isArray(error.errors)) result.errors = error.errors.map(item => encodeError(item, depth + 1));
  return result;
}

function decodeError(value: RemoteError): Error {
  const options = value.cause ? { cause: decodeError(value.cause) } : undefined;
  const error = value.errors ? new AggregateError(value.errors.map(decodeError), value.message, options) : new Error(value.message, options);
  error.name = value.name;
  if (value.stack) error.stack = value.stack;
  if (value.code !== undefined) Object.defineProperty(error, "code", { value: value.code, enumerable: true });
  return error;
}

/** Lazy, tracked calls. Disposal drains writes unless immediate cancellation is requested. */
export function createWorkerClient(factory: () => Worker, options: { reportErrors?: boolean; scope?: string } = {}) {
  let worker: Worker | undefined;
  let release: (() => void) | undefined;
  let nextId = 0;
  let disposed = false;
  const requests = new Map<number, { method: string; resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
  const listeners = new Set<(event: WorkerEvent) => void>();

  function stop(error?: Error) {
    worker?.terminate();
    worker = undefined;
    release?.();
    release = undefined;
    if (error) for (const request of requests.values()) request.reject(error);
    requests.clear();
  }

  function start(): Worker {
    if (disposed) throw new Error("This background worker has been closed.");
    if (worker) return worker;
    const created = factory();
    worker = created;
    release = trackApplicationWorker(created, options);
    created.addEventListener("message", (event: MessageEvent<Reply>) => {
      const reply = event.data;
      if (reply.kind === "event") { for (const listener of listeners) listener(reply.event); return; }
      const request = requests.get(reply.id);
      if (!request) return;
      requests.delete(reply.id);
      if (reply.kind === "error") {
        const error = decodeError(reply.error);
        if (options.reportErrors !== false) reportApplicationError(error, { source: "worker", scope: options.scope, operation: request.method });
        request.reject(error);
      }
      else request.resolve(reply.value);
      if (disposed && requests.size === 0) stop();
    });
    created.addEventListener("error", event => {
      const error = new Error(event.message || "The background worker failed to start or stopped unexpectedly.", { cause: event.error });
      error.name = "WorkerError";
      if (event.filename) error.stack += `\n    at ${event.filename}:${event.lineno}:${event.colno}`;
      stop(error);
    });
    created.addEventListener("messageerror", () => stop(new Error("Could not read the background worker's response.")));
    return created;
  }

  return {
    call<T>(method: string, args: unknown[] = []): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const id = ++nextId;
        try {
          const active = start();
          requests.set(id, { method, resolve: value => resolve(value as T), reject });
          active.postMessage({ kind: "request", id, method, args } satisfies Request);
        } catch (error) {
          requests.delete(id);
          if (!disposed && options.reportErrors !== false) reportApplicationError(error, { source: "worker", scope: options.scope, operation: method });
          reject(error);
        }
      });
    },
    subscribe(listener: (event: WorkerEvent) => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose(immediate = false): void {
      disposed = true;
      listeners.clear();
      if (immediate) stop(new DOMException("The background calculation was cancelled.", "AbortError"));
      else if (requests.size === 0) stop();
    },
  };
}

const scope = globalThis as unknown as Pick<Worker, "addEventListener" | "postMessage">;

export function emitWorkerEvent(type: string, data: unknown): void {
  scope.postMessage({ kind: "event", event: { type, data } } satisfies Reply);
}

/** Only explicitly listed methods are callable across this worker boundary. */
export function serveWorkerRpc(methods: Record<string, (...args: any[]) => unknown>): void {
  scope.addEventListener("message", async (event: MessageEvent<Request>) => {
    const request = event.data;
    if (request?.kind !== "request") return;
    try {
      if (!Object.hasOwn(methods, request.method)) throw new Error(`Unknown worker operation: ${request.method}`);
      const value = await methods[request.method]!(...request.args);
      scope.postMessage({ kind: "result", id: request.id, value } satisfies Reply);
    } catch (error) {
      scope.postMessage({ kind: "error", id: request.id, error: encodeError(error) } satisfies Reply);
    }
  });
}
