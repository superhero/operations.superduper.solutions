// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from './native-runtime-contract.ts';
import { NativeMcpInputError } from './native-mcp-read.ts';

export const nativeMcpOAuthMethod = 'mcpServer/oauth/login';
export const nativeMcpOAuthNotification = 'mcpServer/oauthLogin/completed';
export const nativeMcpOAuthLimits = { startMs: 45000, timeoutSecs: 300, graceMs: 5000 } as const;
export type NativeMcpOAuthCompletion = { name: string; success: boolean; loginId?: string | null; threadId?: string | null; error?: string | null };
export type NativeMcpOAuthNotice = { kind: 'mcp-login'; server: string; loginId: string; authorizationUrl: string };
const owned = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,192}$/.test(value);
const text = (value: unknown, maximum: number) => typeof value === 'string' && value.isWellFormed() && [...value].length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
export function nativeMcpOAuthInputSchema() {
  return { type: 'object', additionalProperties: false as const, properties: {
    name: { type: 'string', title: 'Server name', minLength: 1, maxLength: 256 },
    threadId: { type: ['string', 'null'], title: 'Thread ID', minLength: 1, maxLength: 192, pattern: '^[A-Za-z0-9_-]+$',
      description: 'Optional thread already loaded by this paired workflow. Requires current workflow approval; omit for standalone login.' },
    scopes: { type: ['array', 'null'], title: 'Scopes', maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 512 },
      description: 'Explicit OAuth scopes; an empty list adds none. Provider defaults still apply. Omit/null uses SDK discovery/configuration.' },
    clientRegistration: { type: ['string', 'null'], title: 'Registration strategy', enum: ['auto', 'cimd', 'dcr', null] },
    timeoutSecs: { type: ['integer', 'null'], title: 'Sign-in timeout', minimum: 1, maximum: 300,
      description: 'Seconds to finish sign-in. The pinned SDK defaults to 300.' }
  } as Record<string, Record<string, unknown>>, required: ['name'] };
}
export function nativeMcpOAuthParams(value: unknown): Record<string, unknown> {
  const bad = (field: string, message: string): never => { throw new NativeMcpInputError(field, message); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('params', 'Enter MCP sign-in parameters as an object.');
  const item = nativeObject(value, Object.keys(value)), allowed = nativeMcpOAuthInputSchema().properties;
  for (const key of Object.keys(item)) if (!Object.hasOwn(allowed, key)) bad(key, 'MCP sign-in cannot override credentials, callbacks or runtime configuration.');
  if (!text(item.name, 256) || !(item.name as string).trim()) bad('name', 'Enter the configured MCP server name.');
  if (item.threadId != null && !owned(item.threadId)) bad('threadId', 'Select a thread loaded by this paired runtime.');
  if (item.clientRegistration != null && (typeof item.clientRegistration !== 'string' || !['auto', 'cimd', 'dcr'].includes(item.clientRegistration))) bad('clientRegistration', 'Select auto, cimd or dcr registration.');
  if (item.timeoutSecs != null && (!Number.isSafeInteger(item.timeoutSecs) || Number(item.timeoutSecs) < 1 || Number(item.timeoutSecs) > 300)) bad('timeoutSecs', 'Sign-in timeout must be between 1 and 300 seconds.');
  if (item.scopes != null && (!Array.isArray(item.scopes) || item.scopes.length > 16 || item.scopes.some(scope => typeof scope !== 'string' || scope.length > 512 || !/^[\x21\x23-\x5b\x5d-\x7e]+$/.test(scope)))) bad('scopes', 'Supply at most 16 bounded OAuth scope tokens without whitespace.');
  return structuredClone(item);
}
export function nativeMcpAuthorizationUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value) || !value.isWellFormed()) throw new Error('Invalid MCP authorization URL.');
  const url = new URL(value);
  if (url.href.length > 8192 || url.username || url.password || url.hash || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    || [...url.searchParams.keys()].some(key => ['access_token', 'refresh_token', 'id_token', 'client_secret', 'code_verifier', 'client_assertion'].includes(key.toLowerCase()))) throw new Error('Invalid MCP authorization URL.');
  return url.href;
}

/** Both sides correlate exactly one attempt, including completion before acknowledgement. */
export class NativeMcpOAuthCorrelation {
  private readonly name: string;
  private readonly thread: string | null;
  private id: string | undefined;
  private early: NativeMcpOAuthCompletion | undefined;
  private finished = false;
  constructor(input: unknown) { const params = nativeMcpOAuthParams(input); this.name = params.name as string; this.thread = (params.threadId as string | null | undefined) ?? null; }
  acknowledge(value: unknown): { notice: NativeMcpOAuthNotice; completion?: NativeMcpOAuthCompletion } {
    const result = nativeObject(value, ['authorizationUrl', 'loginId']);
    if (this.id || !owned(result.loginId)) throw new Error('Invalid MCP login acknowledgement.');
    const authorizationUrl = nativeMcpAuthorizationUrl(result.authorizationUrl); this.id = result.loginId;
    const early = this.early; this.early = undefined;
    const completion = early ? this.complete(early) : undefined;
    return { notice: { kind: 'mcp-login', server: this.name, loginId: this.id, authorizationUrl }, ...(completion ? { completion } : {}) };
  }
  complete(value: unknown): NativeMcpOAuthCompletion | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MCP login completion.');
    const item = nativeObject(value, Object.keys(value));
    if (Object.keys(item).some(key => !['name', 'success', 'loginId', 'threadId', 'error'].includes(key)) || item.name !== this.name
      || typeof item.success !== 'boolean' || !owned(item.loginId) || (item.threadId ?? null) !== this.thread
      || item.error != null && !text(item.error, 4096) || item.success && item.error != null || this.finished) throw new Error('Unowned MCP login completion.');
    const result = structuredClone(item) as NativeMcpOAuthCompletion;
    if (!this.id) { if (this.early) throw new Error('Duplicate MCP login completion.'); this.early = result; return; }
    if (item.loginId !== this.id) throw new Error('Unowned MCP login ID.');
    this.finished = true; return result;
  }
}
