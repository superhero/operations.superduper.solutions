// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

const acronyms = new Map(Object.entries({
  ai: 'AI', api: 'API', cli: 'CLI', cpu: 'CPU', gpu: 'GPU', graphql: 'GraphQL', grpc: 'gRPC',
  http: 'HTTP', https: 'HTTPS', id: 'ID', ids: 'IDs', json: 'JSON', jwt: 'JWT', llm: 'LLM',
  mcp: 'MCP', oauth: 'OAuth', oauth2: 'OAuth2', rest: 'REST', rpc: 'RPC', sdk: 'SDK',
  sql: 'SQL', sse: 'SSE', ssh: 'SSH', tcp: 'TCP', udp: 'UDP', ui: 'UI', uri: 'URI', url: 'URL', xml: 'XML',
}));

/** Presentation only: retain source identifiers and existing acronym/brand casing. */
export function categoryLabel(value: string): string {
  return value.replace(/_+/g, ' ').replace(/\p{L}[\p{L}\p{N}]*/gu, word =>
    acronyms.get(word.toLowerCase()) ?? (/^v\d/i.test(word) ? word : word[0]!.toUpperCase() + word.slice(1)));
}
