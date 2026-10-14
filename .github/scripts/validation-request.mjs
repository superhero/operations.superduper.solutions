// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { execFileSync } from "node:child_process";

const descriptions = {
  timeout: "request timed out", network: "temporary network failure", server: "transient server failure",
  rate_limit: "rate limited; automatic retry declined", authorization: "authorization failed",
  not_found: "requested resource unavailable", http: "HTTP request failed",
  invalid_response: "invalid API response", command: "GitHub CLI failed"
};

// Only fixed classifications leave this boundary. gh stderr, response bodies,
// and process-error messages can contain credentials or signed download URLs.
export class ValidationRequestError extends Error
{
  constructor(kind, status)
  {
    super(descriptions[kind] ?? descriptions.command);
    this.name = "ValidationRequestError";
    this.kind = Object.hasOwn(descriptions, kind) ? kind : "command";
    this.retryable = ["timeout", "network", "server"].includes(this.kind);
    if (Number.isInteger(status) && status >= 100 && status <= 599) this.httpStatus = status;
  }
}

export function requestFailureDescription(error)
{
  return error instanceof ValidationRequestError
    ? `${error.message}${error.httpStatus ? ` (HTTP ${error.httpStatus})` : ""}`
    : "invalid validation evidence or unavailable local files";
}

function httpFailure(status, headers = "")
{
  // Do not retry rate limits without interpreting their required wait. This
  // includes Retry-After on server failures, which overrides our short backoff.
  if (status === 429 || /^(?:retry-after\s*:|x-ratelimit-remaining\s*:\s*0\s*$)/im.test(headers))
    return new ValidationRequestError("rate_limit", status);
  if ([401, 403].includes(status)) return new ValidationRequestError("authorization", status);
  if (status === 404) return new ValidationRequestError("not_found", status);
  return new ValidationRequestError([500, 502, 503, 504].includes(status) ? "server" : "http", status);
}

function responseParts(text)
{
  if (typeof text !== "string") return undefined;
  const match = /^HTTP\/\d(?:\.\d+)? ([1-5]\d\d)(?: [^\r\n]*)?\r?\n((?:[^\r\n]+\r?\n)*)\r?\n/.exec(text);
  return match && { status: Number(match[1]), headers: match[2], body: text.slice(match[0].length) };
}

function commandFailure(error)
{
  if (error.code === "ETIMEDOUT") return new ValidationRequestError("timeout");
  const response = responseParts(error.stdout);
  if (response && response.status >= 400) return httpFailure(response.status, response.headers);
  const stderr = typeof error.stderr === "string" ? error.stderr : "";
  // gh run download has no --include option. Its standard HTTP error suffix
  // still permits classification without emitting the signed URL around it.
  const status = /\bHTTP\s+([45]\d\d)\b|\bstatus code:\s*([45]\d\d)\b/i.exec(stderr);
  const statusCode = status ? Number(status[1] ?? status[2]) : undefined;
  if (/\brate limit(?:ed| exceeded)?\b|\bretry-after\b/i.test(stderr)) return new ValidationRequestError("rate_limit", statusCode);
  if (statusCode) return httpFailure(statusCode);
  if (/\b(?:i\/o timeout|TLS handshake timeout|context deadline exceeded|Client\.Timeout exceeded)\b/i.test(stderr))
    return new ValidationRequestError("timeout");
  if (["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "EPIPE"].includes(error.code)
    || /\b(?:connection reset by peer|connection refused|temporary failure in name resolution|no such host|network is unreachable|unexpected EOF)\b/i.test(stderr)
    || /:\s*EOF\s*$/m.test(stderr)) return new ValidationRequestError("network");
  return new ValidationRequestError("command");
}

function invoke(args, { timeoutMs, env = process.env })
{
  try
  {
    return execFileSync("gh", args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs,
      killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 });
  }
  catch (error) { throw commandFailure(error); }
}

export function githubRequest(endpoint, options)
{
  const response = responseParts(invoke(["api", "--include", endpoint], options));
  if (!response) throw new ValidationRequestError("invalid_response");
  if (response.status < 200 || response.status >= 300) throw httpFailure(response.status, response.headers);
  try { return JSON.parse(response.body); }
  catch { throw new ValidationRequestError("invalid_response"); }
}

export function githubDownload(repository, runId, name, directory, options)
{
  invoke(["run", "download", String(runId), "--repo", repository, "--name", name, "--dir", directory], options);
}
