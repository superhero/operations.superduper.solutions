// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
const counts = new Map();
/** Real loopback multipart parsing with no credential reflection. */
export function nullableFormEndpoint(request, response) {
  const url = new URL(request.url, 'http://localhost'), match = /^\/nullable-form-api\/([a-f0-9-]+)\/(items|observations)$/.exec(url.pathname);
  if (!match) return false;
  const [, id, action] = match;
  response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
  if (action === 'observations') { response.end(JSON.stringify({ calls: counts.get(id) ?? 0 })); return true; }
  void (async () => {
    const parts = []; let size = 0;
    for await (const part of request) { size += part.length; if (size > 1024 * 1024) throw new Error('Fixture request limit.'); parts.push(part); }
    const incoming = new Request('http://localhost/items', { method: request.method, headers: request.headers, body: Buffer.concat(parts) });
    const form = await incoming.formData(), file = form.get('file');
    if (!file || typeof file === 'string') throw new Error('Expected a file.');
    counts.set(id, (counts.get(id) ?? 0) + 1);
    response.end(JSON.stringify({ name: file.name, mediaType: file.type, size: file.size,
      base64: Buffer.from(await file.arrayBuffer()).toString('base64'), contentType: request.headers['content-type'], authorized: !!request.headers.authorization }));
  })().catch(() => { response.statusCode = 400; response.end(JSON.stringify({ error: 'Invalid synthetic upload.' })); });
  return true;
}
