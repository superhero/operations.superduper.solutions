// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
/** Isolated loopback endpoint: return only public query data, never the key. */
export function queryArrayEndpoint(request, response) {
  const url = new URL(request.url, 'http://localhost');
  if (!/^\/query-array-api\/[a-f0-9-]+\/items$/.test(url.pathname)) return false;
  const publicParts = url.search.slice(1).split('&').filter(part => decodeURIComponent(part.split('=')[0]) !== 'api_key');
  const colors = publicParts.find(part => part.startsWith('colors='))?.slice(7);
  response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ colors: colors === undefined ? [] : colors.split(',').map(decodeURIComponent),
    rawQuery: publicParts.join('&'), credentialPresent: url.searchParams.has('api_key') }));
  return true;
}
