// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { InputSchema, JsonValue, Operation } from "./catalog.ts";
import type { PreparedRequest } from "./operation-input.ts";
import { awsQueryDataSha256, decodeAwsQueryData } from "./aws-query-data.ts";
import { awsJsonInputSchema, awsJsonPattern, type AwsJsonShape } from "./aws-json.ts";
import { decodeAwsXmlShape, parseAwsXmlDocument } from "./aws-rest-codec.ts";
import { sameSchemaValue } from "./schema-merge.ts";
import { WorkflowBodyError } from "./workflow-body-error.ts";
import policy from "./aws-query-private-policy.json" with {type:"json"};

export const awsQuerySigningProfile = "aws-query-v1";
export type AwsQuerySigningProfile = typeof awsQuerySigningProfile;
export const awsQueryModelRevision = `${awsQueryDataSha256}:private-${policy.version}`;
export interface AwsQueryShape extends AwsJsonShape {
  members?: Record<string, AwsQueryShape>; member?: AwsQueryShape; key?: AwsQueryShape; value?: AwsQueryShape;
  flattened?: boolean; queryName?: string; xmlAttribute?: boolean; xmlNamespace?: {uri?: string; prefix?: string};
  resultWrapper?: string; location?: string;
}
type Endpoint = {url: string; variables?: Record<string,{default: string; enum?: string[]}>};
export type AwsQuerySource = {
  sha256: string; title: string; version: string; openapi: string; endpoints: Endpoint[];
  protocol: "query" | "ec2"; service: string; namespace: string; apiVersion: string;
  sdk: {url: string; sha256: string}; shapes: Record<string,AwsQueryShape>;
};
export type AwsQueryContract = {
  catalog: string; operation: string; method: string; path: string; queuePath: boolean; auth: "none" | "sigv4";
  input: string | null; output: string | null; inputTraits?: AwsQueryShape; outputTraits?: AwsQueryShape; status: number;
};
type Data = {version: 1; sources: Record<string,AwsQuerySource>; operations: Record<string,AwsQueryContract>};
let cached: Data | undefined;
const object = (value: unknown): value is Record<string,unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function invalid(): never { throw new WorkflowBodyError("CODEC"); }
function freeze(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
}
export function awsQueryContracts(): Data {
  if (!cached) {
    const data = decodeAwsQueryData() as Data;
    if (data.version !== 1 || Object.keys(data.sources).length !== 12 || Object.keys(data.operations).length !== 2726) invalid();
    freeze(data); cached = data;
  }
  return cached;
}
export function awsQueryContract(operation: Pick<Operation,"id"|"method"|"path">): AwsQueryContract | undefined {
  const operations = awsQueryContracts().operations, contract = Object.hasOwn(operations,operation.id) ? operations[operation.id] : undefined;
  return contract?.method === operation.method && contract.path === operation.path ? contract : undefined;
}
export function awsQueryShape(source: AwsQuerySource, reference: AwsQueryShape): AwsQueryShape {
  if (!reference.shape) return reference;
  const shape = Object.hasOwn(source.shapes,reference.shape) ? source.shapes[reference.shape] : undefined;
  if (!shape) invalid(); return {...shape,...reference};
}
function root(source: AwsQuerySource, contract: AwsQueryContract): AwsQueryShape {
  const shape: AwsQueryShape = contract.input ? awsQueryShape(source,{shape:contract.input,...contract.inputTraits}) : {type:"structure",members:{}};
  if (!contract.queuePath) return shape;
  // A native SQS queue path supplies the routing information otherwise carried
  // by the SDK's QueueUrl. The documented HTTP Query request uses that URI.
  return {...shape,members:Object.fromEntries(Object.entries(shape.members??{}).filter(([name])=>name!=="QueueUrl")),
    required:(shape.required??[]).filter(name=>name!=="QueueUrl")};
}
const members = policy.members as Record<string,Record<string,string[]>>;
const maps = policy.mapKeys as Record<string,Record<string,string[]>>;
const inputs = policy.inputMembers as Record<string,string[]>;
const inputNames = new Set(policy.inputNames), sensitiveCatalogs = new Set<string>(policy.sensitiveCatalogs);
export function awsQueryPrivateMember(catalog: string, shape: string | undefined, member: string): boolean {
  if (!shape) return false;
  if (members[catalog]?.[shape]?.includes(member)) return true;
  const source = awsQueryContracts().sources[catalog]!, reference = source.shapes[shape]?.members?.[member];
  const value = reference && awsQueryShape(source,reference);
  return sensitiveCatalogs.has(catalog) && value?.sensitive === true && ["string","blob"].includes(value.type??"");
}
export function awsQueryPrivateMapKeys(catalog: string, shape: string | undefined): readonly string[] { return shape ? maps[catalog]?.[shape]??[] : []; }
function privateDescendant(catalog: string, reference: AwsQueryShape, input: boolean, seen = new Set<string>()): boolean {
  if (reference.shape && seen.has(reference.shape)) return false; if (reference.shape) seen.add(reference.shape);
  const source = awsQueryContracts().sources[catalog]!, shape = awsQueryShape(source,reference);
  if (input && sensitiveCatalogs.has(catalog) && shape.sensitive && ["string","blob"].includes(shape.type??"")) return true;
  if (shape.type === "structure") return Object.entries(shape.members??{}).some(([name,member])=>
    (input ? inputNames.has(name)||inputs[catalog]?.includes(name) : awsQueryPrivateMember(catalog,reference.shape,name)) || privateDescendant(catalog,member,input,seen));
  if (shape.type === "map") return awsQueryPrivateMapKeys(catalog,reference.shape).length>0 || !!shape.value && privateDescendant(catalog,shape.value,input,seen);
  return shape.type === "list" && !!shape.member && privateDescendant(catalog,shape.member,input,seen);
}
const privateOutputs = new Map<string,boolean>();
export function awsQueryHasPrivateOutput(operation: Pick<Operation,"id"|"method"|"path">): boolean {
  const contract = awsQueryContract(operation); if (!contract?.output) return false;
  if (!privateOutputs.has(operation.id)) privateOutputs.set(operation.id,privateDescendant(contract.catalog,{shape:contract.output},false));
  return privateOutputs.get(operation.id)!;
}
export function awsQueryPrivateInputKeys(operation: Pick<Operation,"id"|"method"|"path">): string[] {
  const contract = awsQueryContract(operation); if (!contract?.input) return [];
  const source = awsQueryContracts().sources[contract.catalog]!, shape = root(source,contract);
  return Object.entries(shape.members??{}).filter(([name,member])=>inputNames.has(name)||inputs[contract.catalog]?.includes(name)||privateDescendant(contract.catalog,member,true)).map(([name])=>"body:"+name);
}
/** Only source-pinned service authorities may receive query signatures/tokens. */
export function awsQueryEndpoint(origin: string, operation: Pick<Operation,"id"|"method"|"path">): {service: string; region: string} | undefined {
  const contract = awsQueryContract(operation); if (!contract) return;
  const source = awsQueryContracts().sources[contract.catalog]!;
  try {
    const url = new URL(origin);
    if (url.protocol!=="https:" || url.username || url.password || url.port || url.pathname!=="/" || url.search || url.hash) return;
    for (const endpoint of source.endpoints) for (const region of endpoint.variables?.region?.enum??[url.hostname.includes(".us-gov.")?"us-gov-west-1":"us-east-1"]) {
      const candidate = endpoint.url.replace(/\{([^{}]+)\}/g,(_,name:string)=>name==="region"?region:endpoint.variables?.[name]?.default??"");
      if (url.origin===candidate) return {service:source.service,region};
    }
  } catch { /* An arbitrary queue URL or service hostname is not authorization. */ }
}
export function configureAwsQuery(operation: Operation): void {
  const contract = awsQueryContract(operation);
  if (!contract || operation.awsQuery!==awsQuerySigningProfile || operation.awsJson || operation.awsRest || operation.awsWire || operation.s3Files
    || operation.privatePath || operation.cloudflareUpload || operation.responseStream || operation.protocol || operation.rpc) invalid();
  const source = awsQueryContracts().sources[contract.catalog]!, shape = root(source,contract), schema = awsJsonInputSchema(source,shape);
  if (schema.type!=="object" || !schema.properties) invalid();
  operation.awsQueryRevision=awsQueryModelRevision; operation.bodySchema=schema; operation.bodyRequired=!!schema.required?.length;
  operation.bodyMediaType="application/json"; operation.responseMediaType="application/json";
  for (const key of ["bodyValue","binaryMediaTypes","responseContent"] as const) delete operation[key];
  if (awsQueryHasPrivateOutput(operation)) { operation.credentialResult=true; operation.credentialResultProfile="private-result-v1"; }
  else if (operation.credentialResult!==undefined || operation.credentialResultProfile!==undefined) invalid();
  operation.fields=Object.entries(schema.properties).map(([name,member])=>{
    const {required:_required,properties:_properties,items:_items,...scalar}=member;
    return {...scalar,key:"body:"+name,name,label:name,description:"",location:"body",required:schema.required?.includes(name)===true,schema:member};
  });
  if (contract.queuePath) for (const [name,pattern] of [["AccountNumber","^\\d{12}$"],["QueueName","^[A-Za-z0-9_-]{1,80}(?:\\.fifo)?$"]]) {
    const field: InputSchema={type:"string",pattern:pattern!,maxLength:name==="QueueName"?80:12};
    operation.fields.unshift({...field,key:"path:"+name,name:name!,label:name!,description:"",location:"path",required:true,schema:field});
  }
}
export function validAwsQueryModel(operation: Operation): boolean {
  const contract=awsQueryContract(operation);
  if (!contract || operation.awsQuery!==awsQuerySigningProfile || operation.awsQueryRevision!==awsQueryModelRevision) return false;
  const expected={...operation};try {configureAwsQuery(expected);} catch {return false;}
  for (const key of ["fields","bodySchema","bodyRequired","bodyMediaType","bodyValue","binaryMediaTypes","responseContent","responseMediaType","credentialResult","credentialResultProfile"] as const)
    if (!sameSchemaValue(expected[key],operation[key])) return false;
  return contract.auth==="none" ? operation.security?.length===0 : operation.security?.length===1 && operation.security[0]?.length===1
    && operation.security[0][0]?.kind==="aws-sigv4" && operation.security[0][0].name==="hmac" && operation.security[0][0].header==="Authorization" && operation.security[0][0].profile===awsQuerySigningProfile;
}
export const maxAwsQueryBytes=8*1024*1024;
function bounded() {let nodes=0;return (depth:number)=>{if (++nodes>50000 || depth>48) throw new WorkflowBodyError("LIMIT");};}
function range(shape: AwsQueryShape, length: number) {if (shape.min!==undefined && length<shape.min || shape.max!==undefined && length>shape.max) invalid();}
function scalar(source: AwsQuerySource, ref: AwsQueryShape, value: unknown): string {
  const shape=awsQueryShape(source,ref);
  if (shape.type==="timestamp") {const date=typeof value==="number"?new Date(value*1000):typeof value==="string"?new Date(value):invalid();if (!Number.isFinite(date.getTime())) invalid();return shape.timestampFormat==="unixTimestamp"?String(date.getTime()/1000):shape.timestampFormat==="rfc822"?date.toUTCString():date.toISOString();}
  if (shape.type==="boolean") {if (typeof value!=="boolean") invalid();return String(value);}
  if (["integer","long","float","double"].includes(shape.type??"")) {if (typeof value!=="number" || !Number.isFinite(value) || ["integer","long"].includes(shape.type!)&&!Number.isSafeInteger(value)) invalid();range(shape,value);return String(value);}
  if (typeof value!=="string" || !value.isWellFormed()) invalid();
  if (shape.type==="blob") {try {const bytes=Uint8Array.fromBase64(value);if (bytes.toBase64()!==value) invalid();range(shape,bytes.byteLength);} catch {invalid();}return value;}
  if (shape.type!=="string") invalid();range(shape,value.length);
  if (shape.enum&&!shape.enum.includes(value) || shape.pattern&&!new RegExp(awsJsonPattern(shape.pattern),"u").test(value)) invalid();return value;
}
/** Match the pinned QueryParamSerializer, including EC2 casing and list rules. */
export function prepareAwsQueryRequest(operation: Operation, request: PreparedRequest): PreparedRequest {
  if (!validAwsQueryModel(operation)) invalid();
  const contract=awsQueryContract(operation)!,source=awsQueryContracts().sources[contract.catalog]!,input=root(source,contract),visit=bounded();
  const parameters: Record<string,string>={Action:contract.operation,Version:source.apiVersion};
  const name=(member:AwsQueryShape,fallback:string)=>{const wire=member.queryName??member.locationName??fallback;return source.protocol==="ec2"&&!member.queryName?wire[0]!.toUpperCase()+wire.slice(1):wire;};
  const put=(key:string,value:string)=>{if (Object.hasOwn(parameters,key)) invalid();Object.defineProperty(parameters,key,{value,enumerable:true,writable:true,configurable:true});};
  function write(prefix:string,value:unknown,ref:AwsQueryShape,depth:number):void {
    visit(depth);const shape=awsQueryShape(source,ref);
    if (shape.type==="structure") {
      if (!object(value) || Object.keys(value).some(key=>!Object.hasOwn(shape.members??{},key))) invalid();
      for (const [key,member] of Object.entries(shape.members??{})) {
        const item=value[key];if (item===undefined || item===null) {if (shape.required?.includes(key)) invalid();continue;}
        write(prefix?prefix+"."+name(member,key):name(member,key),item,member,depth+1);
      }
    } else if (shape.type==="list") {
      if (!Array.isArray(value) || !shape.member) invalid();range(shape,value.length);
      if (!value.length && source.protocol!=="ec2") put(prefix,"");
      value.forEach((item,index)=>{
        let key=prefix;
        if (source.protocol!=="ec2" && shape.flattened && (shape.member?.queryName || shape.member?.locationName)) key=prefix.split(".").slice(0,-1).concat(name(shape.member,"")).join(".");
        const suffix=source.protocol==="ec2" || shape.flattened ? "" : "."+(shape.member?.queryName??shape.member?.locationName??"member");
        write(key+suffix+"."+(index+1),item,shape.member!,depth+1);
      });
    } else if (shape.type==="map") {
      if (!object(value) || !shape.key || !shape.value) invalid();range(shape,Object.keys(value).length);
      Object.entries(value).forEach(([key,item],index)=>{const base=prefix+(shape.flattened?".":".entry.")+(index+1)+".";
        write(base+(shape.key?.queryName??shape.key?.locationName??"key"),key,shape.key!,depth+1);write(base+(shape.value?.queryName??shape.value?.locationName??"value"),item,shape.value!,depth+1);});
    } else put(prefix,scalar(source,ref,value));
  }
  write("",request.body??{},input,0);
  const selector=contract.path.slice(contract.path.indexOf("#"));if (!request.path.endsWith(selector)) invalid();
  let path=contract.queuePath?request.path.slice(0,-selector.length).replace(/\/$/,""):"/",origin:string|undefined;
  if (contract.catalog==="aws-sqs" && !contract.queuePath && object(request.body) && typeof request.body.QueueUrl==="string") {
    let queue: URL;try {queue=new URL(request.body.QueueUrl);} catch {invalid();}
    if (queue.protocol!=="https:" || queue.username || queue.password || queue.port || queue.search || queue.hash) invalid();
    origin=queue.origin;path=queue.pathname.replace(/\/$/,"");
  }
  if (contract.catalog==="aws-sqs" && path!=="/" && !/^\/\d{12}\/[A-Za-z0-9_-]{1,80}(?:\.fifo)?$/.test(path)) invalid();
  const bytes=new TextEncoder().encode(new URLSearchParams(parameters).toString());if (bytes.byteLength>maxAwsQueryBytes) throw new WorkflowBodyError("LIMIT");
  const result: PreparedRequest={method:contract.method,path,query:contract.method==="GET"?parameters:{},...(origin?{awsQueryOrigin:origin}:{})};
  return contract.method==="GET"?result:{...result,body:new TextDecoder().decode(bytes),bodyFormat:"text",contentType:"application/x-www-form-urlencoded"};
}
export function awsQueryTarget(operation: Operation, origin: string, request: PreparedRequest): URL {
  if (!awsQueryEndpoint(origin,operation) || request.awsQueryOrigin && request.awsQueryOrigin!==new URL(origin).origin) invalid();
  const url=new URL(new URL(origin).origin+request.path);if (url.origin!==new URL(origin).origin || url.search || url.hash) invalid();return url;
}
export function decodeAwsQueryBody(operation: Operation, bytes: Uint8Array, headers: Headers, status: number): JsonValue {
  if (!validAwsQueryModel(operation)) invalid();if (bytes.byteLength>maxAwsQueryBytes) throw new WorkflowBodyError("LIMIT");
  const contract=awsQueryContract(operation)!,source=awsQueryContracts().sources[contract.catalog]!,ok=status>=200&&status<300;
  const media=(headers.get("Content-Type")??"").split(";",1)[0]!.trim().toLowerCase();if (!["text/xml","application/xml"].includes(media)) throw new WorkflowBodyError("MEDIA");
  const [name,root]=parseAwsXmlDocument(bytes,source.namespace,ok);if (!object(root)) invalid();
  const requestId=root.RequestId??root.requestId;
  if (!ok) {
    const errors=object(root.Errors)?root.Errors:root,error=Array.isArray(errors.Error)?errors.Error[0]:errors.Error;
    if (!object(error)) invalid();return {Error:Object.fromEntries(["Code","Message","Type"].flatMap(key=>typeof error[key]==="string"?[[key,error[key] as string]]:[])),...(typeof requestId==="string"?{RequestId:requestId}:{})};
  }
  if (["Error","ErrorResponse","Errors"].includes(name)) invalid();
  const wrapper=contract.outputTraits?.resultWrapper;
  const value=wrapper?root[wrapper]:root;if (wrapper&&!Object.hasOwn(root,wrapper)) invalid();
  const decoded=contract.output?decodeAwsXmlShape(source,{shape:contract.output,...contract.outputTraits},value):{};
  if (!object(decoded)) invalid();
  const metadata=object(root.ResponseMetadata)?root.ResponseMetadata:undefined;
  return {...decoded,...(metadata&&typeof metadata.RequestId==="string"?{ResponseMetadata:{RequestId:metadata.RequestId}}:{})};
}
