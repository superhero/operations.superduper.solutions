// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export const flatFormPath = kind => `/2010-04-01/Accounts/{AccountSid}/Calls/{CallSid}/${kind === 'CreateStream' ? 'Streams' : 'Siprec'}.json`;
export const flatFormBody = (document, kind) => document.paths[flatFormPath(kind)].post.requestBody.content['application/x-www-form-urlencoded'].schema;
export const flatFormValues = kind => ({ 'path:AccountSid': `AC${'a'.repeat(32)}`, 'path:CallSid': `CA${'b'.repeat(32)}`,
  ...(kind === 'CreateStream' ? { 'body:Url': 'wss://media.example.test/stream' } : { 'body:ConnectorName': 'reviewed-connector' }),
  'body:Name': 'A & B + C / café', 'body:Track': 'both_tracks', 'body:StatusCallbackMethod': 'POST',
  'body:Parameter1.Name': 'first.key', 'body:Parameter1.Value': 'a+b & c=d',
  'body:Parameter50.Name': 'middle', 'body:Parameter50.Value': '50 / %',
  'body:Parameter99.Name': 'last', 'body:Parameter99.Value': '最後' });
