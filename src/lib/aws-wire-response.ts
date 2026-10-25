// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { awsWireContracts, type AwsWireProfile } from "./aws-wire.ts";
import { WorkflowBodyError } from "./workflow-body-error.ts";

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const namespace = "https://sts.amazonaws.com/doc/2011-06-15/";
export const maxStsXmlBytes = 65536;
function invalid(): never { throw new WorkflowBodyError("CODEC"); }
function strings(value: unknown, required: string[], optional: string[] = []): Record<string, string> {
  if (!object(value) || Object.keys(value).some(key => ![...required, ...optional].includes(key))
    || required.some(key => !Object.hasOwn(value, key)) || Object.values(value).some(item => typeof item !== "string" || item.length > 8192)) invalid();
  return value;
}
/** A fixed STS shape, not an arbitrary XML-to-JSON conversion or entity resolver. */
export function decodeAwsWireResponse(profile: AwsWireProfile, text: string, media: string, status: number): unknown {
  const ok = status >= 200 && status < 300;
  if (awsWireContracts[profile].service === "dynamodb") {
    if (media !== "application/x-amz-json-1.0") throw new WorkflowBodyError("MEDIA");
    try { const value = JSON.parse(text); if (!object(value)) invalid(); return value; } catch { invalid(); }
  }
  if (!["text/xml", "application/xml"].includes(media)) throw new WorkflowBodyError("MEDIA");
  // Reject declarations capable of entities/DTD/CDATA, extra processing instructions,
  // and oversized/deep trees before asking the maintained parser to allocate a tree.
  if (new TextEncoder().encode(text).byteLength > maxStsXmlBytes || /<!|<\?(?!xml(?:\s|\?>))/i.test(text)
    || /&(?!(?:amp|lt|gt|apos|quot|#(?:\d+|x[0-9a-fA-F]+));)/.test(text)
    || (text.match(/</g)?.length ?? 0) > 64 || XMLValidator.validate(text, { allowBooleanAttributes: false }) !== true) invalid();
  let parsed: unknown;
  try { parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", ignoreDeclaration: true,
    parseTagValue: false, parseAttributeValue: false, trimValues: true, processEntities: true, htmlEntities: true, maxNestedTags: 8 }).parse(text); }
  catch { invalid(); }
  if (!object(parsed) || Object.keys(parsed).length !== 1) invalid();
  const root = parsed[ok ? "GetCallerIdentityResponse" : "ErrorResponse"];
  if (!object(root) || root["@xmlns"] !== namespace) invalid();
  if (ok) {
    if (status !== 200 || Object.keys(root).some(key => !["@xmlns", "GetCallerIdentityResult", "ResponseMetadata"].includes(key))) invalid();
    const result = strings(root.GetCallerIdentityResult, ["Account", "Arn", "UserId"]);
    const metadata = strings(root.ResponseMetadata, ["RequestId"]);
    return { ...result, ResponseMetadata: metadata };
  }
  if (Object.keys(root).some(key => !["@xmlns", "Error", "RequestId"].includes(key)) || typeof root.RequestId !== "string") invalid();
  return { Error: strings(root.Error, ["Code", "Message"], ["Type", "Detail"]), RequestId: root.RequestId };
}
