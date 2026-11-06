// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import pins from "./aws-query-pins.json" with {type:"json"};
import { awsQueryContracts, awsQueryHasPrivateOutput, awsQuerySigningProfile } from "./aws-query.ts";
import { projectAwsQueryResponse } from "./aws-query-private.ts";

export const awsQuerySourcePins = Object.fromEntries(Object.entries(pins).map(([id,pin])=>[id,pin.sha256]));
const object = (value:unknown):value is Record<string,any>=>!!value&&typeof value==="object"&&!Array.isArray(value);
function requireContract(value:unknown,context:string):asserts value {if (!value) throw new Error(`AWS Query requires the pinned native and SDK contracts (${context}).`);}
/** Canonical GET/POST identities stay distinct; the private codec owns Action,
 * Version, nested Query/EC2 encoding and SQS endpoint selection. */
export function bindAwsQuery(document:Record<string,any>):void {
  const data=awsQueryContracts(),matches=Object.entries(data.sources).filter(([,source])=>source.title===document.info?.title&&source.version===document.info?.version&&source.openapi===document.openapi);
  requireContract(matches.length===1&&object(document.paths),"service identity");
  const [catalog,source]=matches[0]!,hmac=document.components?.securitySchemes?.hmac;
  requireContract(hmac?.type==="apiKey"&&hmac.in==="header"&&hmac.name==="Authorization"&&hmac["x-amazon-apigateway-authtype"]==="awsSigv4","IAM declaration");
  requireContract(!Object.keys(document.components?.schemas??{}).some(key=>key.startsWith("OperationsAwsQuery_")),"reserved schema components");
  const plans=Object.entries(data.operations).filter(([,contract])=>contract.catalog===catalog).map(([id,contract])=>{
    const item=document.paths[contract.path],operation=item?.[contract.method.toLowerCase()];
    requireContract(object(item)&&object(operation)&&`${catalog}:${operation.operationId}`===id&&operation.servers===undefined
      &&operation["x-upstream-aws-query-contract"]===undefined&&operation["x-operations-aws-query"]===undefined&&operation["x-operations-aws-wire"]===undefined,id);
    return {id,contract,item,operation};
  });
  for (const {id,contract,item,operation} of plans) {
    operation["x-upstream-aws-query-contract"]={path:contract.path,parameters:structuredClone(operation.parameters??[]),
      pathParameters:structuredClone(item.parameters??[]),requestBody:structuredClone(operation.requestBody??null),
      responses:structuredClone(operation.responses),servers:structuredClone(document.servers),security:structuredClone(operation.security??document.security)};
    operation.parameters=[];operation.servers=structuredClone(source.endpoints);operation.security=contract.auth==="none"?[]:[{hmac:[]}];
    operation["x-operations-aws-query"]=awsQuerySigningProfile;operation["x-operations-aws-signing"]=awsQuerySigningProfile;
    const response=operation.responses?.[String(contract.status)];requireContract(object(response),id+": success response");
    response.content={"application/json":{schema:contract.output?projectAwsQueryResponse(document,catalog,contract.output):{type:"object",properties:{},additionalProperties:false}}};
    const identity={id,method:contract.method,path:contract.path};
    if (awsQueryHasPrivateOutput(identity)) {
      operation["x-operations-credential-result"]=true;operation["x-operations-private-result"]="private-result-v1";
    }
  }
}
