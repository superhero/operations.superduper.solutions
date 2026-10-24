// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { cloudflareOrigin, uploadCompletionConsumer, uploadSessionConsumer } from "../cloudflare-upload.ts";
import type { PreparedRequest } from "../operation-input.ts";
import { validateWorkflowBinary } from "../workflow-binary.ts";
import { VaultError, vaultLimits, type ApprovedOperation, type CredentialBinding } from "./types.ts";
import { canonicalPolicyValue, validateCredentialPath } from "./policy.ts";

type Scope = { schema: string; account?: string; script?: string; namespace?: string; project?: string };
type Session = { id: string; scope: Scope; owner: string; jwt: string; expiresAt: number; kind: "workers" | "pages";
  phase: "upload" | "completion"; buckets: string[][]; sizes: Record<string, number>; hashes?: string[]; missing?: string[]; busy?: boolean };
export type CloudflareUploadLease = { id: string; files?: string[]; hashes?: string[]; completion?: boolean };
const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new VaultError("INVALID");
  return value as Record<string, any>;
};
const hashes = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 1000 || value.some(hash => typeof hash !== "string" || !/^[a-f0-9]{32}$/.test(hash))
    || new Set(value).size !== value.length) throw new VaultError("INVALID");
  return [...value];
};
const owner = (binding: CredentialBinding) => canonicalPolicyValue(binding.connection ?? binding.credentials);
function scope(descriptor: ApprovedOperation, request: PreparedRequest): Scope {
  if (descriptor.origin !== cloudflareOrigin) throw new VaultError("PERMISSION");
  validateCredentialPath(request.path);
  const template = descriptor.operation.path.split("/"), parts = request.path.split("/");
  if (template.length !== parts.length) throw new VaultError("PERMISSION");
  const values: Record<string, string> = {};
  template.forEach((part, index) => {
    if (!part.startsWith("{")) { if (parts[index] !== part) throw new VaultError("PERMISSION"); return; }
    const value = decodeURIComponent(parts[index]!);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new VaultError("PERMISSION");
    values[part.slice(1, -1)] = value;
  });
  if (values.account_id && !/^[a-f0-9]{32}$/.test(values.account_id)) throw new VaultError("PERMISSION");
  return { schema: descriptor.operation.id.split(":")[0]!, ...(values.account_id ? { account: values.account_id } : {}),
    ...(values.script_name ? { script: values.script_name } : {}), ...(values.dispatch_namespace ? { namespace: values.dispatch_namespace } : {}),
    ...(values.project_name ? { project: values.project_name } : {}) };
}

function manifestSizes(body: unknown): Record<string, number> {
  const manifest = object(object(body).manifest), sizes: Record<string, number> = Object.create(null);
  if (Object.keys(manifest).length > 1000) throw new VaultError("LIMIT");
  for (const [path, value] of Object.entries(manifest)) {
    const entry = object(value);
    if (!path.startsWith("/") || /[\\\u0000\r\n]/.test(path) || !/^[a-f0-9]{32}$/.test(entry.hash)
      || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 500000
      || sizes[entry.hash] !== undefined && sizes[entry.hash] !== entry.size) throw new VaultError("INVALID");
    sizes[entry.hash] = entry.size;
  }
  return sizes;
}

/** Only the owning vault worker retains JWTs. References expire on lock, mutation,
 * cancellation or failure; no token/session is persisted or returned over RPC. */
export class CloudflareUploadSessions {
  private sessions = new Map<string, Session>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }
  clear(): void { this.sessions.clear(); }
  private current(id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.expiresAt <= this.now()) { this.sessions.delete(id); throw new VaultError("PERMISSION"); }
    return session;
  }
  assertCurrent(lease?: CloudflareUploadLease): void { if (lease) this.current(lease.id); }
  private retain(session: Omit<Session, "id">): Session {
    for (const [id, value] of this.sessions) if (value.expiresAt <= this.now()) this.sessions.delete(id);
    if (this.sessions.size >= 32) throw new VaultError("LIMIT");
    const created = { ...session, id: crypto.randomUUID() }; this.sessions.set(created.id, created); return created;
  }
  private expiry(jwt: unknown): { jwt: string; expiresAt: number } {
    if (typeof jwt !== "string" || jwt.length > vaultLimits.secretBytes || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt)) throw new VaultError("INVALID");
    try {
      const encoded = jwt.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
      const payload = object(JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))));
      if (!Number.isSafeInteger(payload.exp) || payload.exp * 1000 <= this.now() || payload.nbf !== undefined
        && (!Number.isSafeInteger(payload.nbf) || payload.nbf * 1000 > this.now())) throw new VaultError("PERMISSION");
      return { jwt, expiresAt: Math.min(payload.exp * 1000, this.now() + 3600000) };
    } catch { throw new VaultError("PERMISSION"); }
  }
  authorize(descriptor: ApprovedOperation, request: PreparedRequest, binding: CredentialBinding, reference?: string):
    { request: PreparedRequest; lease?: CloudflareUploadLease; authorization?: string; secrets: string[] } {
    const profile = descriptor.operation.cloudflareUpload!, target = scope(descriptor, request);
    if (profile === "workers-session" || profile === "platform-session") manifestSizes(request.body);
    if (!uploadSessionConsumer(profile) && !uploadCompletionConsumer(profile)) return { request, secrets: [] };
    const completion = uploadCompletionConsumer(profile), metadata = completion ? object(object(request.body).metadata) : undefined;
    const id = completion ? object(metadata!.assets).jwt : reference;
    if (completion && !Object.hasOwn(object(object(request.body).files), metadata!.main_module)) throw new VaultError("INVALID");
    if (typeof id !== "string") throw new VaultError("PERMISSION");
    const session = this.current(id);
    const kind = profile.startsWith("pages-") ? "pages" : "workers";
    if (session.busy || session.kind !== kind || session.phase !== (completion ? "completion" : "upload")
      || session.scope.schema !== target.schema || target.account && target.account !== session.scope.account
      || completion && (canonicalPolicyValue(target) !== canonicalPolicyValue(session.scope) || owner(binding) !== session.owner)) throw new VaultError("PERMISSION");
    const lease: CloudflareUploadLease = { id, ...(completion ? { completion: true } : {}) };
    if (profile === "workers-upload") {
      if (request.query.base64 !== true) throw new VaultError("PERMISSION");
      const files = object(object(request.body).files), names = Object.keys(files).sort();
      if (!session.buckets.some(bucket => canonicalPolicyValue([...bucket].sort()) === canonicalPolicyValue(names))) throw new VaultError("PERMISSION");
      let bytes = 0;
      for (const [hash, file] of Object.entries(files)) {
        const binary = validateWorkflowBinary(file);
        if (binary.size !== session.sizes[hash]) throw new VaultError("INVALID");
        bytes += binary.size;
      }
      if (bytes > vaultLimits.responseBytes) throw new VaultError("LIMIT");
      lease.files = names;
    } else if (profile === "pages-check") lease.hashes = hashes(object(request.body).hashes);
    else if (profile === "pages-upload") {
      if (!Array.isArray(request.body) || !request.body.length || request.body.length > 100 || !session.missing) throw new VaultError("PERMISSION");
      let total = 0;
      lease.files = request.body.map(raw => {
        const file = object(raw);
        if (file.base64 !== true || !session.missing!.includes(file.key) || typeof file.value !== "string") throw new VaultError("PERMISSION");
        try {
          const decoded = atob(file.value); if (btoa(decoded) !== file.value || decoded.length > 500000) throw new VaultError("LIMIT"); total += decoded.length;
        } catch { throw new VaultError("INVALID"); }
        return file.key as string;
      });
      if (new Set(lease.files).size !== lease.files.length || total > vaultLimits.responseBytes) throw new VaultError("LIMIT");
    } else if (profile === "pages-complete") {
      lease.hashes = hashes(object(request.body).hashes);
      if (!session.hashes || session.missing?.length || lease.hashes.some(hash => !session.hashes!.includes(hash))) throw new VaultError("PERMISSION");
    }
    session.busy = true;
    const privateRequest = structuredClone(request);
    if (completion) (privateRequest.body as Record<string, any>).metadata.assets.jwt = session.jwt;
    return { request: privateRequest, lease, ...(completion ? {} : { authorization: `Bearer ${session.jwt}` }), secrets: [session.jwt, `Bearer ${session.jwt}`] };
  }
  finish(descriptor: ApprovedOperation, request: PreparedRequest, binding: CredentialBinding, status: number,
    body: unknown, lease?: CloudflareUploadLease): { body: unknown; secrets: string[] } {
    const profile = descriptor.operation.cloudflareUpload!, envelope = object(body);
    if (status < 200 || status >= 300 || envelope.success !== true) throw new VaultError("NETWORK");
    const result = envelope.result;
    let session: Session | undefined, secrets: string[] = [];
    if (profile === "workers-session" || profile === "platform-session" || profile === "pages-session") {
      const token = this.expiry(object(result).jwt); secrets = [token.jwt, `Bearer ${token.jwt}`];
      const sizes = profile === "pages-session" ? {} : manifestSizes(request.body);
      const buckets = profile === "pages-session" ? [] : object(result).buckets;
      if (!Array.isArray(buckets) || buckets.length > 1000) throw new VaultError("INVALID");
      const groups = buckets.map(hashes), listed = groups.flat();
      if (new Set(listed).size !== listed.length || listed.some(hash => !Object.hasOwn(sizes, hash)) || groups.some(group => !group.length || group.length > 100)) throw new VaultError("INVALID");
      session = this.retain({ ...token, scope: scope(descriptor, request), owner: owner(binding), kind: profile === "pages-session" ? "pages" : "workers",
        phase: profile === "pages-session" || groups.length ? "upload" : "completion", buckets: groups, sizes });
    } else {
      if (!lease) throw new VaultError("PERMISSION");
      session = this.current(lease.id); session.busy = false;
      if (lease.completion) { this.sessions.delete(session.id); return { body: { success: true, result: { completed: true, ...(typeof result?.id === "string" && result.id.length <= 256 ? { id: result.id } : {}) } }, secrets }; }
      if (profile === "workers-upload") {
        if (![201, 202].includes(status)) throw new VaultError("INVALID");
        session.buckets = session.buckets.filter(bucket => canonicalPolicyValue([...bucket].sort()) !== canonicalPolicyValue(lease.files));
        if (status === 201) {
          if (session.buckets.length) throw new VaultError("INVALID");
          const token = this.expiry(object(result).jwt); secrets = [token.jwt, `Bearer ${token.jwt}`];
          this.sessions.delete(session.id); session = this.retain({ ...session, ...token, phase: "completion", busy: false });
        } else if (!session.buckets.length) throw new VaultError("INVALID");
      } else if (profile === "pages-check") {
        const missing = hashes(result);
        if (missing.some(hash => !lease.hashes!.includes(hash))) throw new VaultError("INVALID");
        session.hashes = lease.hashes!; session.missing = missing;
      } else if (profile === "pages-upload") session.missing = session.missing!.filter(hash => !lease.files!.includes(hash));
      else if (profile === "pages-complete") { this.sessions.delete(session.id); return { body: { success: true, result: { completed: true } }, secrets }; }
    }
    return { body: { success: true, result: { session: session.id, expiresAt: session.expiresAt, phase: session.phase,
      ...(session.kind === "workers" ? { buckets: session.buckets } : session.missing ? { missing: session.missing } : {}) } }, secrets };
  }
}
