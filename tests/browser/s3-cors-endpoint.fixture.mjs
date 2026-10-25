// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Native loopback CORS probe. Signature authority is the synthetic S3 fixture;
// production-worker destination and signing are tested separately.
import { createHash } from 'node:crypto';
import { awsSyntheticValues, verifyAwsSignature } from '../aws-sigv4.fixture.mjs';
export const s3CorsLogicalUrl = 'https://s3.us-east-1.amazonaws.com/operations-cors-bucket/object.bin';
export function s3FixtureChecksums(bytes) {
  return { ETag: '"'+createHash('md5').update(bytes).digest('hex')+'"',
    'x-amz-checksum-sha256': createHash('sha256').update(bytes).digest('base64'), 'x-amz-checksum-type': 'FULL_OBJECT' };
}
export function createS3CorsEndpoint(applicationOrigin) {
  const records = new Map(), objects = new Map();
  const methods = ['PUT', 'GET', 'OPTIONS'];
  const allowedHeaders = ['authorization', 'content-type', 'x-amz-checksum-mode', 'x-amz-checksum-sha256', 'x-amz-content-sha256',
    'x-amz-date', 'x-amz-security-token', 'x-amz-meta-note'];
  return (request, response) => {
    const match = /^\/s3-cors\/([a-z0-9-]+)\/(allow|deny-header|deny-method|hidden|observations)$/.exec(request.url ?? '');
    if (!match) return false;
    const [, id, mode] = match;
    if (mode === 'observations') { response.writeHead(200, {'Content-Type':'application/json'});response.end(JSON.stringify(records.get(id) ?? []));return true; }
    const events = records.get(id) ?? [], event = { method:request.method, mode }; events.push(event);records.set(id,events);
    response.setHeader('Cache-Control','no-store');
    if (request.headers.origin === applicationOrigin()) response.setHeader('Access-Control-Allow-Origin',applicationOrigin());
    response.setHeader('Vary','Origin');
    if (request.method === 'OPTIONS') {
      event.requestedMethod=request.headers['access-control-request-method'];
      event.requestedHeaders=String(request.headers['access-control-request-headers']??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
      event.sentAuthorization=Object.hasOwn(request.headers,'authorization');
      response.writeHead(204,{'Access-Control-Allow-Methods':(mode==='deny-method'?['GET','OPTIONS']:methods).join(', '),
        'Access-Control-Allow-Headers':allowedHeaders.filter(h=>mode!=='deny-header'||h!=='x-amz-security-token').join(', '),'Access-Control-Max-Age':'0'});
      response.end();return true;
    }
    if (mode !== 'hidden') response.setHeader('Access-Control-Expose-Headers','ETag, x-amz-checksum-sha256, x-amz-checksum-type, Content-Disposition');
    void (async()=>{
      const parts=[];let length=0;for await(const part of request){length+=part.length;if(length>500000)throw new Error('Fixture upload limit');parts.push(part);}
      const body=Buffer.concat(parts);
      verifyAwsSignature(s3CorsLogicalUrl,{method:request.method,headers:request.headers,...(request.method==='PUT'?{body}:{})},awsSyntheticValues,'s3');event.verified=true;
      if(request.method==='PUT'){objects.set(id,body);event.storedBytes=body.length;response.writeHead(200,{...s3FixtureChecksums(body),'Content-Type':'text/plain'});response.end();}
      else{const bytes=objects.get(id)??Buffer.alloc(0);response.writeHead(200,{...s3FixtureChecksums(bytes),'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="cors.bin"'});response.end(bytes);}
    })().catch(()=>{event.failed=true;if(!response.headersSent)response.writeHead(500);response.end('Synthetic CORS endpoint refusal');});
    return true;
  };
}
