// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeBoundedThreadParams } from './native-stored-thread.ts';
import { nativeUuid } from './native-runtime-contract.ts';
import { NativeCommandInputError } from './native-command.ts';

export const nativeGuardianMethod = 'thread/approveGuardianDeniedAction';
export const nativeGuardianApprovalMethod = 'operations/guardian/approve';
export const nativeGuardianStarted = 'item/autoApprovalReview/started';
export const nativeGuardianCompleted = 'item/autoApprovalReview/completed';
const text = { type: 'string', minLength: 1, maxLength: 8192 };
const multiline = { ...text, 'x-native-multiline': true };
const opaqueId = { ...text, maxLength: 256 };
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties: Record<string, Record<string, unknown>>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false as const, properties, required });
const array = (items: Record<string, unknown>, maxItems = 128) => ({ type: 'array', maxItems, items });
export function nativeGuardianInputSchema() {
  return object({ threadId: { ...opaqueId, title: 'Thread ID' }, reviewId: { ...opaqueId, title: 'Review ID', description: 'Select a recent denial observed on this connection. Its exact action requires human confirmation; editable denial events are not accepted.' } });
}
export function nativeGuardianParams(input: unknown) {
  const p = nativeBoundedThreadParams(nativeGuardianInputSchema(), input);
  if (typeof p.threadId !== 'string' || !/^[A-Za-z0-9_-]{1,192}$/.test(p.threadId)) throw new NativeCommandInputError('threadId', 'Use the owned loaded thread identifier.');
  if (nativeUuid(p.threadId)) p.threadId = p.threadId.toLowerCase();
  return p as { threadId: string; reviewId: string };
}
const filesystemPath = object({ type: { type: 'string', enum: ['path', 'glob_pattern', 'special'] }, path: text, pattern: text,
  value: object({ kind: { type: 'string', enum: ['root', 'minimal', 'project_roots', 'tmpdir', 'slash_tmp', 'unknown'] }, path: text, subpath: nullable(text) }, ['kind']) }, ['type']);
const filesystem = object({ read: nullable(array(text)), write: nullable(array(text)), entries: nullable(array(object({ access: { type: 'string', enum: ['read', 'write', 'deny'] }, path: filesystemPath }))),
  globScanMaxDepth: nullable({ type: 'integer', minimum: 1, maximum: 1048576 }) }, []);
const permissions = object({ network: nullable(object({ enabled: { type: ['boolean', 'null'] } }, [])), fileSystem: nullable(filesystem) }, []);
const actionFields: Record<string, string[]> = {
  command: ['type', 'source', 'command', 'cwd'], execve: ['type', 'source', 'program', 'argv', 'cwd'],
  writeStdin: ['type', 'approvalId', 'processId', 'stdin', 'cwd'], applyPatch: ['type', 'cwd', 'files'],
  networkAccess: ['type', 'target', 'host', 'protocol', 'port'],
  mcpToolCall: ['type', 'server', 'toolName', 'connectorId', 'connectorName', 'toolTitle'], requestPermissions: ['type', 'reason', 'permissions']
};
const actionSchema = object({ type: { type: 'string', enum: Object.keys(actionFields) }, source: { type: 'string', enum: ['shell', 'unifiedExec'] }, command: multiline, cwd: text,
  program: text, argv: array({ type: 'string', maxLength: 8192, 'x-native-multiline': true }), approvalId: opaqueId, processId: opaqueId, stdin: { type: 'string', maxLength: 8192, 'x-native-multiline': true }, files: array(text),
  target: text, host: { ...text, maxLength: 2048 }, protocol: { type: 'string', enum: ['http', 'https', 'socks5Tcp', 'socks5Udp'] }, port: { type: 'integer', minimum: 0, maximum: 65535 },
  server: opaqueId, toolName: opaqueId, connectorId: nullable(opaqueId), connectorName: nullable(multiline), toolTitle: nullable(multiline), reason: nullable(multiline), permissions }, ['type']);
type Review = { status: 'inProgress' | 'approved' | 'denied' | 'timedOut' | 'aborted'; riskLevel: string | null; userAuthorization: string | null; rationale: string | null };
type Start = { threadId: string; turnId: string; reviewId: string; targetItemId: string | null; startedAtMs: number; review: Review; action: Record<string, unknown> };
export type NativeGuardianDenial = Start & { completedAtMs: number; decisionSource: 'agent' };
export type NativeGuardianDenialNotice = { kind: 'guardian-denial'; threadId: string; turnId: string; reviewId: string; targetItemId: string | null; actionType: string };
export type NativeGuardianApprovalNotice = { kind: 'guardian-approval'; token: string; denial: NativeGuardianDenial };

function payload(input: unknown, completed: boolean) {
  const time = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
  const schema = object({ threadId: opaqueId, turnId: opaqueId, reviewId: opaqueId, targetItemId: nullable(opaqueId), startedAtMs: time,
    ...(completed ? { completedAtMs: time, decisionSource: { type: 'string', enum: ['agent'] } } : {}),
    review: object({ status: { type: 'string', enum: completed ? ['approved', 'denied', 'timedOut', 'aborted'] : ['inProgress'] },
      riskLevel: { type: ['string', 'null'], enum: ['low', 'medium', 'high', 'critical', null] },
      userAuthorization: { type: ['string', 'null'], enum: ['unknown', 'low', 'medium', 'high', null] }, rationale: { type: ['string', 'null'], maxLength: 8192, 'x-native-multiline': true } }), action: actionSchema });
  const p = nativeBoundedThreadParams(schema, input) as unknown as NativeGuardianDenial;
  if (new TextEncoder().encode(JSON.stringify(p)).byteLength > 49152 || completed && p.completedAtMs < p.startedAtMs) throw new Error('Invalid bounded Guardian lifecycle.');
  const action = p.action, allowed = actionFields[action.type as string]!;
  const optional = ['connectorId', 'connectorName', 'toolTitle', 'reason'];
  if (Object.keys(action).some(key => !allowed.includes(key)) || allowed.some(key => !optional.includes(key) && !Object.hasOwn(action, key))) throw new Error('Invalid Guardian action variant.');
  const fs = ((action.permissions as { fileSystem?: Record<string, unknown> } | undefined)?.fileSystem);
  for (const entry of (fs?.entries ?? []) as { path: Record<string, unknown> }[]) {
    const path = entry.path, keys = path.type === 'path' ? ['type', 'path'] : path.type === 'glob_pattern' ? ['type', 'pattern'] : ['type', 'value'];
    if (Object.keys(path).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(path, key))) throw new Error('Invalid Guardian permission path.');
    if (path.type === 'special') {
      const special = path.value as Record<string, unknown>, fields = special.kind === 'unknown' ? ['kind', 'path', 'subpath'] : special.kind === 'project_roots' ? ['kind', 'subpath'] : ['kind'];
      if (Object.keys(special).some(key => !fields.includes(key)) || special.kind === 'unknown' && !Object.hasOwn(special, 'path')) throw new Error('Invalid Guardian special path.');
    }
  }
  return p;
}
/** Both the companion and private worker independently retain observed lifecycles. */
export class NativeGuardianReviews {
  private pending = new Map<string, { value: Start; observedAt: number }>();
  private denials = new Map<string, { value: NativeGuardianDenial; observedAt: number }>();
  private seen = new Set<string>();
  private now: () => number;
  constructor(now = () => Date.now()) { this.now = now; }
  private prune() { for (const map of [this.pending, this.denials]) for (const [id, record] of map) if (this.now() - record.observedAt > 600000) map.delete(id); }
  started(value: unknown, threadId: string, turnId: string) {
    this.prune(); const p = payload(value, false);
    if (p.threadId !== threadId || p.turnId !== turnId || this.seen.has(p.reviewId) || this.seen.size >= 256 || this.pending.size + this.denials.size >= 32) throw new Error('Unowned or duplicate Guardian review.');
    this.seen.add(p.reviewId);
    this.pending.set(p.reviewId, { value: p, observedAt: this.now() });
  }
  completed(value: unknown, threadId: string, turnId: string) {
    this.prune(); const p = payload(value, true), started = this.pending.get(p.reviewId)?.value;
    if (!started || p.threadId !== threadId || p.turnId !== turnId || p.threadId !== started.threadId || p.turnId !== started.turnId
      || p.targetItemId !== started.targetItemId || p.startedAtMs !== started.startedAtMs || JSON.stringify(p.action) !== JSON.stringify(started.action)) throw new Error('Guardian completion changed its observed owner or action.');
    this.pending.delete(p.reviewId);
    if (p.review.status !== 'denied') return;
    this.denials.set(p.reviewId, { value: p, observedAt: this.now() }); return structuredClone(p);
  }
  get(input: unknown) {
    this.prune(); const params = nativeGuardianParams(input), value = this.denials.get(params.reviewId)?.value;
    if (!value || value.threadId !== params.threadId) throw new NativeCommandInputError('reviewId', 'Select a recent denial observed on this runtime connection.');
    return structuredClone(value);
  }
  consume(input: unknown) { const value = this.get(input); this.denials.delete(value.reviewId); return value; }
  forgetThread(threadId: string) { for (const map of [this.pending, this.denials]) for (const [id, record] of map) if (record.value.threadId === threadId) map.delete(id); }
  clear() { this.pending.clear(); this.denials.clear(); this.seen.clear(); }
}

/** Match pinned v2 TryFrom conversions; paths are converted by the native host. */
export function nativeGuardianEvent(denial: NativeGuardianDenial, pathUri: (path: string) => string) {
  const a = denial.action, type = String(a.type), action: Record<string, unknown> = {};
  const aliases: Record<string, string> = { writeStdin: 'write_stdin', applyPatch: 'apply_patch', networkAccess: 'network_access', mcpToolCall: 'mcp_tool_call', requestPermissions: 'request_permissions' };
  const fields: Record<string, string> = { approvalId: 'approval_id', processId: 'process_id', toolName: 'tool_name', connectorId: 'connector_id', connectorName: 'connector_name', toolTitle: 'tool_title' };
  for (const [key, value] of Object.entries(a)) action[fields[key] ?? key] = structuredClone(value);
  action.type = aliases[type] ?? type;
  if (a.source === 'unifiedExec') action.source = 'unified_exec';
  if (a.protocol === 'socks5Tcp') action.protocol = 'socks5_tcp';
  if (a.protocol === 'socks5Udp') action.protocol = 'socks5_udp';
  if (type === 'writeStdin') action.cwd = pathUri(a.cwd as string);
  if (type === 'requestPermissions') {
    const input = a.permissions as { network?: unknown; fileSystem?: Record<string, unknown> | null }, fs = input.fileSystem;
    const result: Record<string, unknown> = {};
    if (Object.hasOwn(input, 'network')) result.network = structuredClone(input.network);
    if (Object.hasOwn(input, 'fileSystem')) {
      if (fs == null) result.file_system = null;
      else {
        const convertPath = (path: Record<string, unknown>) => path.type === 'path' ? { ...path, path: pathUri(path.path as string) } : structuredClone(path);
        const entries = fs.entries != null ? (fs.entries as { path: Record<string, unknown>; access: string }[]).map(entry => ({ path: convertPath(entry.path), access: entry.access }))
          : ['read', 'write'].flatMap(access => ((fs[access] ?? []) as string[]).map(path => ({ access, path: { type: 'path', path: pathUri(path) } })));
        result.file_system = { entries, ...(Object.hasOwn(fs, 'globScanMaxDepth') ? { glob_scan_max_depth: fs.globScanMaxDepth } : {}) };
      }
    }
    action.permissions = result;
  }
  return { id: denial.reviewId, target_item_id: denial.targetItemId, turn_id: denial.turnId, started_at_ms: denial.startedAtMs,
    completed_at_ms: denial.completedAtMs, status: 'denied', risk_level: denial.review.riskLevel, user_authorization: denial.review.userAuthorization,
    rationale: denial.review.rationale, decision_source: denial.decisionSource, action };
}
