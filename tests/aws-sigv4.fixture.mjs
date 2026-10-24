// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Node-only independent verifier shared by source and browser Gherkin cases.
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
const values = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', sessionToken: 'AWS_SESSION_PRIVATE_5729+/=' };
const digest = input => createHash('sha256').update(input).digest('hex');
const hmac = (key, input) => createHmac('sha256', key).update(input).digest();
const encode = input => encodeURIComponent(input).replace(/[!'()*]/g, c => '%'+c.charCodeAt(0).toString(16).toUpperCase());
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
function verify(url, init, expected = values, service = 'lambda') {
  const target = new URL(url), headers = new Headers(init.headers), authorization = headers.get('Authorization');
  const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(authorization);
  assert.ok(match); assert.equal(match[1], expected.accessKeyId);
  const scope = match[2], [day,region,signedService,terminator] = scope.split('/');
  assert.equal(region, target.hostname.split('.')[1]); assert.equal(signedService, service); assert.equal(terminator, 'aws4_request');
  const date = headers.get('X-Amz-Date'); assert.match(date, /^\d{8}T\d{6}Z$/); assert.equal(date.slice(0,8),day);
  const names = match[3].split(';'); assert.deepEqual(names, [...names].sort()); assert.ok(names.includes('host'));
  const canonicalHeaders = names.map(name => name+':'+(name === 'host' ? target.host : headers.get(name)).trim().replace(/\s+/g, ' ')+'\n').join('');
  const query = [...target.searchParams].map(pair => pair.map(encode)).sort((a,b) => compare(a[0],b[0]) || compare(a[1],b[1])).map(pair => pair.join('=')).join('&');
  const canonicalPath = target.pathname.split('/').map(encode).join('/');
  const hash = digest(init.body ?? new Uint8Array()); assert.equal(headers.get('x-amz-content-sha256'), hash);
  const canonical = [init.method,canonicalPath,query,canonicalHeaders,match[3],hash].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4'+expected.secretAccessKey,day),region),service),'aws4_request');
  assert.equal(match[4],hmac(key,['AWS4-HMAC-SHA256',date,scope,digest(canonical)].join('\n')).toString('hex'));
  assert.equal(headers.get('X-Amz-Security-Token'), expected.sessionToken ?? null);
  return { authorization, signature: match[4], scope, date };
}

export { values as awsSyntheticValues, verify as verifyAwsSignature, digest as awsDigest };
