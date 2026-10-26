// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// Static transport only: inference and model data remain in the browser.
export function nativeWasmWorker(paths) {
  const nativePaths = new Set(paths);
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (!nativePaths.has(url.pathname)) return env.ASSETS.fetch(request);
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return new Response('Method not allowed', {status: 405, headers: {Allow: 'GET, HEAD'}});
      url.pathname += '.gz';
      const assetHeaders = new Headers(request.headers);
      assetHeaders.set('Accept-Encoding', 'identity');
      assetHeaders.delete('Range'); assetHeaders.delete('If-Range');
      const asset = await env.ASSETS.fetch(new Request(url, {method: request.method, headers: assetHeaders}));
      if (!asset.ok && asset.status !== 304) return asset;
      const headers = new Headers(asset.headers);
      headers.set('Content-Type', 'application/wasm');
      headers.set('Content-Encoding', 'gzip');
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
      headers.set('Cache-Control', `${headers.get('Cache-Control') || 'public, max-age=0, must-revalidate'}, no-transform`);
      headers.delete('Content-Length');
      return new Response(request.method === 'HEAD' ? null : asset.body,
        {status: asset.status, headers, encodeBody: 'manual'});
    },
  };
}
