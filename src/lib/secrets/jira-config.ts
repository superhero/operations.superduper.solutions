// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { credentialObject } from "./bindings.ts";
import { VaultError, type ApprovedOperation, type JiraOAuthMetadata } from "./types.ts";

export const jiraOAuthProfile = "atlassian-jira-3lo-v1";
export const jiraOAuthScope = "read:jira-user offline_access";
export type JiraOAuthInput = { host: string; accessKeyId: string; label: string };
export type JiraOAuthTask = { id: string; authorizationUrl: string; expiresAt: number; fingerprint: string };
export type JiraOAuthSite = { id: string; name: string; url: string };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export const jiraUuid = uuid;
export function jiraHost(value: unknown, applicationOrigin?: string): string {
  try {
    if (typeof value !== "string" || value.length > 2048) throw new Error();
    const url = new URL(value), loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const development = applicationOrigin === undefined || ["localhost", "127.0.0.1", "[::1]"].includes(new URL(applicationOrigin).hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || url.protocol !== "https:"
      && !(url.protocol === "http:" && loopback && development)) throw new Error();
    return url.origin;
  } catch { throw new VaultError("PERMISSION"); }
}
export function jiraSiteUrl(value: unknown): string {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/"
      || !/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/.test(url.hostname) || url.hostname === "your-domain.atlassian.net") throw new Error();
    return url.origin;
  } catch { throw new VaultError("PERMISSION"); }
}
export function validateJiraInput(value: unknown, applicationOrigin: string): JiraOAuthInput {
  const input = credentialObject(value);
  if (Object.keys(input).length !== 3 || !uuid(input.accessKeyId) || typeof input.label !== "string" || !input.label.trim()
    || input.label.length > 100 || /[\u0000-\u001f\u007f]/.test(input.label)) throw new VaultError("INVALID");
  return { host: jiraHost(input.host, applicationOrigin), accessKeyId: input.accessKeyId, label: input.label.trim() };
}
export function validateJiraMetadata(value: unknown): JiraOAuthMetadata {
  const item = credentialObject(value);
  if (Object.keys(item).sort().join(",") !== "accountId,clientId,cloudId,configuration,host,hostId,profile,redirectUri,scope,siteUrl"
    || item.profile !== jiraOAuthProfile || item.scope !== jiraOAuthScope || !uuid(item.hostId) || !uuid(item.cloudId)
    || typeof item.configuration !== "string" || !/^[a-f0-9]{64}$/.test(item.configuration)
    || typeof item.clientId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(item.clientId)
    || typeof item.accountId !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(item.accountId)) throw new VaultError("INVALID");
  const host = jiraHost(item.host), siteUrl = jiraSiteUrl(item.siteUrl);
  if (item.host !== host || item.siteUrl !== siteUrl || item.redirectUri !== host + "/oauth/jira/callback") throw new VaultError("INVALID");
  return { profile: jiraOAuthProfile, scope: jiraOAuthScope, host, siteUrl, clientId: item.clientId,
    redirectUri: item.redirectUri, accountId: item.accountId, hostId: item.hostId, cloudId: item.cloudId, configuration: item.configuration };
}
export function jiraOAuthAlternative(descriptor: ApprovedOperation): number | undefined {
  try { if (jiraSiteUrl(descriptor.origin) !== descriptor.origin) return; } catch { return; }
  const operation = descriptor.operation;
  if (operation.method !== "GET" || operation.path !== "/rest/api/3/myself" || operation.bodyRequired || operation.bodyMediaType
    || operation.privatePath || operation.cloudflareUpload || operation.credentialResult || operation.responseStream
    || operation.fields.some(field => field.location !== "query" || field.name !== "expand" || field.type !== "string")) return;
  const index = operation.security?.findIndex(option => option.length === 1 && option[0]?.kind === "bearer"
    && option[0].name === "OAuth2" && option[0].header === "Authorization");
  if (index === undefined || index < 0) return;
  const declared = operation.oauthScopes?.[index]?.OAuth2;
  return declared && (declared.length !== 1 || declared[0] !== "read:jira-user") ? undefined : index;
}
