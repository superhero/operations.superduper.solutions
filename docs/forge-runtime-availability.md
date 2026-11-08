# Forge LLM catalog availability

The active Forge Containers catalog omits `GET /forge/llm` and
`POST /forge/llm/{model}` while a Forge-hosted LLM integration is unavailable.
The other 58 operations remain available. The original bundled provider schema
retains both omitted routes, and the effective catalog records their IDs and
reason under `x-operations-forge-llm-exclusion`.

These endpoints need a Forge application/container and its platform-provided
invocation or installation context. Their real egress destination comes from
`FORGE_EGRESS_PROXY_URL`; the published localhost default is illustrative.
Replacing the undeclared `forgeProxyToken` security name with a bearer token
would not provide that runtime. See the official
[Forge LLM API](https://developer.atlassian.com/platform/forge/rest/v2/api-group-forge-llm/)
and [container API reference](https://developer.atlassian.com/platform/forge/containers-reference/ref-api/).

Restoration requires a qualified Forge-hosted transport with its actual app,
installation, egress origin and Forge proxy authorization context. Verify that
runtime and its request/response handling before removing the versioned
`forge-llm-exclusion` recipe. The recipe is pinned to the reviewed source and
rejects changed identities or authentication contracts so upstream updates
receive a fresh review. This exclusion is a catalog disposition, not a passing
insertion or a newly supported execution path. Existing imported workflows
retain their original stored definitions and execution guards.
