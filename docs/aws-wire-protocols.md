# AWS target JSON and Action/Version profiles

Four reviewed native operations now use their actual AWS wire protocols:

| Service | Native operation identity | Request | Result |
| --- | --- | --- | --- |
| DynamoDB | BatchGetItem | POST `/`, fixed X-Amz-Target, AWS JSON 1.0 | JSON with typed attributes and UnprocessedKeys |
| DynamoDB | ListTables | POST `/`, fixed X-Amz-Target, AWS JSON 1.0 | JSON with table names and optional cursor |
| STS | GET_GetCallerIdentity | GET `/`, fixed Action/Version query | Verified XML envelope decoded to identity JSON |
| STS | POST_GetCallerIdentity | POST `/`, fixed Action/Version form body | Verified XML envelope decoded to identity JSON |

The native `/#X-Amz-Target=...` and `/#Action=...` paths remain operation
identities for discovery, hydration and saved workflows. They never become HTTP
addresses. Request preparation produces `/` and the documented headers, query or
body before the private worker signs the final immutable bytes. These remain
HTTP operations; no native JSON-RPC transport is implied.

The source-pinned `aws-wire-protocols` correction retains the original compressed
DynamoDB 2012-08-10 and STS 2011-06-15 schemas. It preserves all 53 and 16 operation
identities respectively, and the selected original contracts under
`x-upstream-aws-wire-contract`. Other operations retain their own limitations.
Selected operations offer explicit standard HTTPS regional servers. Configure
the actual region, for example `https://dynamodb.us-east-1.amazonaws.com` or
`https://sts.us-east-1.amazonaws.com`. The same reviewed standard-region set as
the [AWS signer](aws-signing.md) applies. Global STS, HTTP, other partitions,
FIPS/dual-stack, custom endpoints, ports and base paths are outside these profiles.

The current pinned inventory contains 55 AWS packs and 5,422 operations. Of its
4,704 fragment paths, 4,514 explicitly encode Target or Action; 190 are other
query/subresource suffixes. This delivery supports four of those 4,514 methods.
DynamoDB has 2/53 reviewed methods and STS 2/16; the other 51 and 14 remain
unavailable. Together with the independent Lambda and S3 profiles, seven AWS
operation models are available. Signing does not enable the remaining codecs.

Unlock the vault, select **hmac**, and choose the stored AWS access key ID,
secret access key and optional temporary session token. Saved connections retain
encrypted references, service profile and endpoint authority. Re-unlock after
reload. A connection can serve both reviewed operations for the same service;
changing service, region or credentials requires a current connection reference.
These profiles do not obtain temporary credentials or create cloud resources.

DynamoDB inputs use the low-level AttributeValue representation. Supply
RequestItems as a table map containing Keys with `S`, `N` or base64 `B` values;
numbers remain strings, including values larger than JavaScript's exact integer
range. The reviewed optional projection, consistency and capacity fields remain
available. Empty keys, unknown fields and batches exceeding 100 keys are rejected
before dispatch. This does not add a DocumentClient or silently marshal ordinary
application objects. ListTables sends `{}` when no options are supplied; its
limit and pagination cursor belong in the JSON body. The worker owns X-Amz-Target
and the `application/x-amz-json-1.0` media type. Neither is a public credential or
an editable routing field.

DynamoDB responses require the matching AWS JSON 1.0 media type and a JSON object.
Returned type tags, number strings, cursors and UnprocessedKeys remain intact.
No pagination, unprocessed-key retry or other request replay happens automatically.
The existing response bound is 8 MiB; BatchGetItem's larger service-side maximum
does not enlarge that local bound.

STS owns Action=GetCallerIdentity and Version=2011-06-15. The POST body is
URL-encoded bytes; GET uses the equivalent signed query and no body. There are no
editable Action/Version inputs. Success returns Account, Arn, UserId and
ResponseMetadata.RequestId as strings in a logical JSON result, with the actual
XML media retained as transport metadata. Known XML errors retain their HTTP
status and decoded error information; private credential echoes are scrubbed.

The STS decoder uses the already installed `fast-xml-parser`, pinned directly to
5.11.2. It accepts the fixed STS namespace/envelopes under a 64 KiB response bound
and eight levels of nesting. DTDs, external/custom entities, CDATA, extra processing
instructions, duplicate elements, mismatched roots/namespaces and non-string
identity fields are rejected. XML built-in and numeric references decode once;
numeric-looking identifiers keep their leading zeros. This is a bounded STS
codec, not general XML support for other AWS Query, EC2 or REST/XML methods.

Focused evidence uses independent signature verification, encrypted connection
reload, native schema identities and the production vault worker at phone and
desktop widths. Browser provider interception proves those workflow paths; it
does not qualify AWS browser CORS, an IAM account or a deployed origin. Live
qualification needs separately authorized resources and remains pending.

Primary contracts reviewed 2026-10-25: [BatchGetItem](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html),
[ListTables](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_ListTables.html),
[GetCallerIdentity](https://docs.aws.amazon.com/STS/latest/APIReference/API_GetCallerIdentity.html),
[STS regional endpoints](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sts_vpc_endpoint_create.html)
and the [parser's maintained implementation](https://github.com/NaturalIntelligence/fast-xml-parser).
Requalify the correction when its pinned native source or reviewed protocol changes.
