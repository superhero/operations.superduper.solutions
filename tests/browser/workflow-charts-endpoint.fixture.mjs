// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export function createWorkflowChartsEndpoint() {
  const states = new Map();
  return (request, response) => {
    const url = new URL(request.url, 'http://fixture.local');
    const match = /^\/monitoring-fixture\/([a-z0-9-]+)\/(samples|status|submit)$/.exec(url.pathname);
    if (!match) return false;
    const [, id, action] = match;
    const state = states.get(id) ?? { requests: 0, active: 0, samples: 0, closed: 0, forms: 0, lastLabel: null, lastPrevious: null };
    states.set(id, state);
    if (action === 'status') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(state)); return true; }
    if (action === 'submit') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        state.forms++; state.lastLabel = JSON.parse(body).label; state.lastPrevious = url.searchParams.get('previous');
        response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"accepted":true}');
      });
      return true;
    }
    state.requests++; state.active++;
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    const emit = () => {
      state.samples++;
      response.write(JSON.stringify({ cpu: state.samples, memory: state.samples * 2 }) + '\n');
    };
    emit();
    const timer = setInterval(emit, 150);
    response.once('close', () => { clearInterval(timer); state.active--; state.closed++; });
    return true;
  };
}
