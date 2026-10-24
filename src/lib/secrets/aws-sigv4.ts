// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { SignatureV4, clearCredentialCache } from "@smithy/signature-v4";
import { Sha256WebCrypto } from "@smithy/core/checksum";
import { HttpRequest } from "@smithy/core/protocols";
import { awsSigningHeaders } from "../aws-signing.ts";
import { VaultError } from "./types.ts";

export type AwsSigningValues = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
export type AwsSigningContext = { service: string; region: string; now?: () => number };
const encoder = new TextEncoder();
/** Signs copies of final bytes. The returned body and headers are sent together;
 * no multipart boundary, public credential provider or ambient SDK credentials. */
export async function signAwsRequest(method: string, address: string, initialHeaders: Headers, input: BodyInit | null | undefined,
  values: AwsSigningValues, context: AwsSigningContext) {
  try {
    const credentials = { ...values }, url = new URL(address), headers = new Headers(initialHeaders);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || !/^[A-Z]+$/.test(method)
      || !/^[a-z][a-z0-9-]{0,62}$/.test(context.service) || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(context.region)
      || !/^[A-Za-z0-9]{1,128}$/.test(credentials.accessKeyId) || !/^[A-Za-z0-9/+=]{1,128}$/.test(credentials.secretAccessKey)
      || credentials.sessionToken !== undefined && (!credentials.sessionToken || credentials.sessionToken.length > 16384 || /[^\x21-\x7e]/.test(credentials.sessionToken))) throw new VaultError("INVALID");
    if ([...headers.keys()].some(name => awsSigningHeaders.has(name.toLowerCase()) || ["host", "cookie", "proxy-authorization"].includes(name.toLowerCase()))
      || [...url.searchParams.keys()].some(name => /^x-amz-/i.test(name))) throw new VaultError("PERMISSION");
    let body: Uint8Array<ArrayBuffer> | undefined;
    if (input != null) {
      if (typeof input === "string") body = encoder.encode(input);
      else if (input instanceof ArrayBuffer) body = new Uint8Array(input.slice(0));
      else if (input instanceof Uint8Array) body = new Uint8Array(input);
      else if (input instanceof Blob) {
        if (input.size > 8 * 1024 * 1024) throw new VaultError("LIMIT");
        body = new Uint8Array(await input.arrayBuffer());
      }
      else throw new VaultError("PERMISSION");
      if (body.byteLength > 8 * 1024 * 1024) throw new VaultError("LIMIT");
    }
    const signedAt = (context.now ?? Date.now)();
    if (!Number.isSafeInteger(signedAt) || signedAt <= 0 || !Number.isFinite(new Date(signedAt).getTime())) throw new VaultError("INVALID");
    const query: Record<string, string[]> = Object.create(null);
    for (const [key, value] of url.searchParams) (query[key] ??= []).push(value);
    const signer = new SignatureV4({ service: context.service, region: context.region, credentials,
      sha256: Sha256WebCrypto, uriEscapePath: context.service !== "s3", applyChecksum: true });
    const request = new HttpRequest({ method, protocol: url.protocol, hostname: url.hostname, path: url.pathname,
      ...(url.port ? { port: Number(url.port) } : {}), query, headers: { ...Object.fromEntries(headers), host: url.host }, ...(body ? { body } : {}) });
    const signed = await signer.sign(request, { signingDate: new Date(signedAt) });
    const result = new Headers(signed.headers); result.delete("host");
    const authorization = result.get("Authorization")!;
    return { headers: result, body, signedAt, secrets: [credentials.accessKeyId, credentials.secretAccessKey,
      ...(credentials.sessionToken ? [credentials.sessionToken] : []), authorization,
      ...[...authorization.matchAll(/(?:Credential|Signature)=([^, ]+)/g)].map(match => match[1]!)] };
  } catch (error) { throw error instanceof VaultError ? error : new VaultError("PERMISSION"); }
  finally { clearCredentialCache(); }
}
