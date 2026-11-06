// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createHash, timingSafeEqual } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { awsGetBodyProfile, awsGetBodyRegion, awsGetBodyInput, awsGetBodyResponseLimit } from "../../src/lib/aws-get-body-contract.ts";
const allowedHeaders = ["accept", "authorization", "content-type", "x-amz-content-sha256", "x-amz-date", "x-amz-security-token"];
const digest = input => createHash("sha256").update(input).digest("hex");
const object = value => value && typeof value === "object" && !Array.isArray(value);
const sameKey = (actual, expected) => typeof actual === "string" && Buffer.byteLength(actual) === Buffer.byteLength(expected)
  && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
function origin(value, httpsOnly = false) {
  const url = new URL(value);
  if (url.origin !== value || url.protocol !== "https:" && (httpsOnly || url.protocol !== "http:"
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("Invalid companion origin.");
  return value;
}
export async function forwardAwsGetBody(input, signal, runtime = {}) {
  if (!object(input) || Object.keys(input).sort().join(",") !== "address,body,fingerprint,headers,profile"
    || input.profile !== awsGetBodyProfile || typeof input.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(input.fingerprint)
    || typeof input.address !== "string" || !object(input.headers) || Object.keys(input.headers).some(key => !allowedHeaders.includes(key))
    || Object.values(input.headers).some(value => typeof value !== "string" || value.length > 17000 || /[^\x20-\x7e]/.test(value))) throw new Error("PERMISSION");
  const region = awsGetBodyRegion(input.address), body = Buffer.from(awsGetBodyInput(input.body));
  const headers = input.headers, auth = /^AWS4-HMAC-SHA256 Credential=[A-Za-z0-9]{1,128}\/(\d{8})\/([^/]+)\/elasticfilesystem\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=[a-f0-9]{64}$/.exec(headers.authorization ?? "");
  const date = headers["x-amz-date"] ?? "", instant = Date.parse(date.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, "$1-$2-$3T$4:$5:$6Z"));
  const signedNames = ["host", ...Object.keys(headers).filter(key => key !== "authorization")].sort().join(";");
  if (!auth || auth[1] !== date.slice(0, 8) || auth[2] !== region || auth[3] !== signedNames || !/^\d{8}T\d{6}Z$/.test(date)
    || !Number.isFinite(instant) || Math.abs((runtime.now ?? Date.now)() - instant) > 60000
    || headers["x-amz-content-sha256"] !== digest(body) || headers["content-type"] !== "application/json" || headers.accept !== "application/json") throw new Error("PERMISSION");
  return new Promise((resolve, reject) => {
    const request = (runtime.request ?? httpsRequest)(input.address, { method: "GET", headers: { ...headers, "content-length": body.length },
      signal, rejectUnauthorized: true }, response => {
      const parts = []; let size = 0;
      response.on("data", part => {
        size += part.length;
        if (size > awsGetBodyResponseLimit) { response.destroy(); request.destroy(new Error("LIMIT")); } else parts.push(part);
      });
      response.on("error", reject); response.on("aborted", () => reject(new Error("NETWORK")));
      response.on("end", () => {
        const status = response.statusCode;
        if (!Number.isInteger(status) || status < 200 || status > 599 || status >= 300 && status < 400) return reject(new Error("NETWORK"));
        const headers = Object.fromEntries(["content-type", "x-amzn-requestid"].flatMap(key => typeof response.headers[key] === "string" ? [[key, response.headers[key]]] : []));
        try {
          const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts));
          resolve({ profile: awsGetBodyProfile, fingerprint: input.fingerprint, status, statusText: response.statusMessage ?? "", headers, body });
        } catch { reject(new Error("NETWORK")); }
      });
    });
    request.on("error", reject); request.end(body);
  });
}
/** TLS + an owner-issued key and explicit browser origins authorize this one read. */
export function createAwsGetBodyCompanion(config, runtime = {}) {
  const publicOrigin = origin(config.publicOrigin, true), allowed = config.allowedOrigins;
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(config.pairingKey) || !Array.isArray(allowed) || !allowed.length || allowed.length > 8
    || allowed.some(value => origin(value) !== value || value === publicOrigin)) throw new Error("Invalid EFS companion configuration.");
  const controllers = new Set(); let closed = false;
  async function handle(req, res) {
    const requestOrigin = req.headers.origin;
    const answer = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin",
        ...(allowed.includes(requestOrigin) ? { "Access-Control-Allow-Origin": requestOrigin, "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "0" } : {}) });
      res.end(value === undefined ? undefined : JSON.stringify(value));
    };
    let controller;
    try {
      if (closed || req.headers.host !== new URL(publicOrigin).host || !allowed.includes(requestOrigin) || req.url !== "/v1/efs/account-preferences")
        return answer(403, { error: "PERMISSION" });
      if (req.method === "OPTIONS") {
        const requested = String(req.headers["access-control-request-headers"] ?? "").toLowerCase().split(",").map(value => value.trim()).filter(Boolean);
        return req.headers["access-control-request-method"] === "POST" && requested.every(value => ["authorization", "content-type"].includes(value))
          ? answer(204) : answer(403, { error: "PERMISSION" });
      }
      if (req.method !== "POST" || !sameKey(req.headers.authorization, "Bearer " + config.pairingKey) || req.headers["content-type"] !== "application/json")
        return answer(401, { error: "PERMISSION" });
      if (controllers.size >= 4) return answer(429, { error: "LIMIT" });
      controller = new AbortController(); controllers.add(controller);
      res.once("close", () => { if (!res.writableFinished) controller.abort(); });
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
      const parts = []; let size = 0;
      for await (const part of req) { size += part.length; if (size > 65536) throw new Error("LIMIT"); parts.push(part); }
      const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)));
      const result = await forwardAwsGetBody(input, signal, runtime);
      if (signal.aborted || closed) throw new Error("PERMISSION");
      answer(200, result);
    } catch {
      if (!res.headersSent && !res.destroyed) answer(400, { error: "PERMISSION" });
    } finally { if (controller) controllers.delete(controller); }
  }
  return { handle, close() { closed = true; for (const controller of controllers) controller.abort(); controllers.clear(); } };
}
