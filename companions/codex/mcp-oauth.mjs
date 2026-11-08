// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { NativeMcpOAuthCorrelation, nativeMcpOAuthMethod, nativeMcpOAuthNotification, nativeMcpOAuthParams } from '../../src/lib/native-mcp-oauth.ts';

/** Exact standalone login role. URLs never imply completion or a second login grant. */
export function createCodexMcpOAuthSession({ send }) {
  let correlation, requestId;
  return { request(frame) {
    const params = nativeMcpOAuthParams(frame.params);
    if (frame.method !== nativeMcpOAuthMethod || correlation || params.threadId != null) throw new Error('Invalid standalone MCP login.');
    correlation = new NativeMcpOAuthCorrelation(params); requestId = frame.id;
    return { ...frame, params };
  }, receive(frame) {
    if (frame.method === nativeMcpOAuthNotification) {
      if (!correlation || Object.hasOwn(frame, 'id')) throw new Error('Unowned MCP login notification.');
      const completed = correlation.complete(frame.params);
      if (completed) send({ method: nativeMcpOAuthNotification, params: completed });
      return true;
    }
    if (requestId !== undefined && frame.id === requestId && Object.hasOwn(frame, 'result')) {
      const acknowledgement = correlation.acknowledge(frame.result); send(frame);
      if (acknowledgement.completion) send({ method: nativeMcpOAuthNotification, params: acknowledgement.completion });
      return true;
    }
    return false;
  } };
}
