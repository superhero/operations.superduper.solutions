# Default service schemas

The application bundles 42 packs covering 38 providers and 13,859 HTTP operations,
alongside the two examples. Manage them in **Settings → Schemas**. Installation
loads API descriptions locally; it does not contact provider APIs or supply credentials.

## Included contracts

| Schema | HTTP operations | Source |
|---|---:|---|
| Anthropic / Claude | 144 | [Source](https://github.com/anthropics/anthropic-sdk-typescript/blob/sdk-v0.120.0/.stats.yml) |
| AWS — Lambda | 66 | [Source](https://github.com/aws/api-models-aws) |
| AWS — S3 | 97 | [Source](https://github.com/aws/api-models-aws) |
| Bitbucket Cloud | 299 | [Source](https://dac-static.atlassian.com/cloud/bitbucket/swagger.v3.json) |
| Bluesky — App and AT Protocol | 152 | [Source](https://github.com/bluesky-social/endpoints-standalone) |
| Bluesky — Direct messages | 38 | [Source](https://github.com/bluesky-social/endpoints-standalone) |
| Bluesky — Ozone moderation | 45 | [Source](https://github.com/bluesky-social/endpoints-standalone) |
| Cloudflare | 3,761 | [Source](https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.yaml) |
| Cohere | 42 | [Source](https://raw.githubusercontent.com/cohere-ai/cohere-developer-experience/main/cohere-openapi.yaml) |
| Confluence Cloud | 252 | [Source](https://dac-static.atlassian.com/cloud/confluence/openapi-v2.v3.json) |
| DeepSeek | 11 | [Source](https://api-docs.deepseek.com/api/create-chat-completion/) |
| DigitalOcean | 855 | [Source](https://raw.githubusercontent.com/digitalocean/openapi/main/specification/DigitalOcean-public.v2.yaml) |
| Discord | 246 | [Source](https://raw.githubusercontent.com/discord/discord-api-spec/main/specs/openapi.json) |
| Docker Engine | 108 | [Source](https://raw.githubusercontent.com/moby/moby/master/api/swagger.yaml) |
| Dukascopy Trading Tools | 1 | [Source](https://www.dukascopy.com/trading-tools/api/documentation) |
| ECB Data Portal | 11 | [Source](https://data.ecb.europa.eu/help/api/overview) |
| ElevenLabs | 418 | [Source](https://api.elevenlabs.io/openapi.json) |
| Frankfurter | 9 | [Source](https://api.frankfurter.dev/v2/openapi.json) |
| FRED / GeoFRED | 35 | [Source](https://fred.stlouisfed.org/docs/api/fred/) |
| GitHub | 1,242 | [Source](https://raw.githubusercontent.com/github/rest-api-description/main/descriptions-next/api.github.com/api.github.com.yaml) |
| GitLab | 1,869 | [Source](https://gitlab.com/gitlab-org/gitlab/-/raw/master/doc/api/openapi/openapi_v3.yaml) |
| Google Cloud — Compute | 758 | [Source](https://compute.googleapis.com/$discovery/rest?version=v1) |
| Google Cloud — Storage | 76 | [Source](https://storage.googleapis.com/$discovery/rest?version=v1) |
| Google Gemini — Interactions | 37 | [Source](https://ai.google.dev/static/api/interactions.openapi.json) |
| Groq | 23 | [Source](https://github.com/groq/groq-typescript/blob/v1.6.0/.stats.yml) |
| Hetzner Cloud | 190 | [Source](https://docs.hetzner.cloud/cloud.spec.json) |
| Hugging Face — Inference Endpoints | 46 | [Source](https://api.endpoints.huggingface.cloud/openapi.json) |
| Jira Cloud | 630 | [Source](https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json) |
| Microsoft Azure — Resources | 40 | [Source](https://github.com/Azure/azure-rest-api-specs) |
| Mistral | 173 | [Source](https://raw.githubusercontent.com/mistralai/platform-docs-public/main/openapi.yaml) |
| Ollama | 17 | [Source](https://raw.githubusercontent.com/ollama/ollama/main/docs/openapi.yaml) |
| OpenAI | 360 | [Source](https://raw.githubusercontent.com/openai/openai-openapi/main/openapi.yaml) |
| OpenRouter | 152 | [Source](https://openrouter.ai/openapi.json) |
| Render | 228 | [Source](https://api-docs.render.com/openapi/render-public-api-1.json) |
| Replicate | 36 | [Source](https://api.replicate.com/openapi.json) |
| Resend | 142 | [Source](https://raw.githubusercontent.com/resend/resend-openapi/main/resend.yaml) |
| Telegram Bot API | 180 | [Source](https://raw.githubusercontent.com/photon-hq/telegram-api/main/specs/telegram-bot-api.openapi.json) |
| Together AI | 208 | [Source](https://docs.together.ai/openapi.yaml) |
| Twilio | 197 | [Source](https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/yaml/twilio_api_v2010.yaml) |
| Vercel | 465 | [Source](https://openapi.vercel.sh/) |
| X / Twitter | 156 | [Source](https://raw.githubusercontent.com/xdevplatform/xdk/main/latest-openapi.json) |
| xAI | 44 | [Source](https://api.x.ai/api-docs/openapi.json) |

## Scope decisions

- Google Cloud covers Compute and Storage; AWS covers S3 and Lambda; Azure covers
  Resource Manager Resources. Each provider publishes separate product contracts.
- Gemini uses Interactions; Hugging Face uses Inference Endpoints. These names do
  not imply every API offered by the provider.
- Bluesky uses official App/AT Protocol, chat and Ozone documents. Server selection
  distinguishes public AppView, relay and personal data servers.
- Docker and Azure Swagger documents are converted to OpenAPI 3; external
  references are bundled locally while retaining recursive references.
- DeepSeek and Dukascopy snapshots come from structured official documentation.
  Dukascopy retains procedure choices on its shared HTTP endpoint.
- Anthropic and Groq artifacts are identified by official SDK metadata. Missing
  version labels are explicitly supplied for Anthropic and Bluesky. The inventory
  retains provenance, including community conversions.

## Execution limits

Typed controls cover supported constraints. Advanced JSON schemas use a JSON
input with API-side validation. Unsupported authentication, serialization and
binary transports remain visible with an execution limitation. AWS signing is
unsupported. OAuth access tokens use bearer transport; login, token refresh and
scope acquisition are outside this feature.

Browser CORS and local-network restrictions still apply. Docker needs an HTTP
endpoint because browsers cannot use its Unix socket. Ollama must permit the
application origin. Account-specific server placeholders need configuration.
No provider credentials are bundled.

## Local ownership

Existing profiles receive missing defaults once. Deletions, enablement and order
survive reloads. Unmodified defaults follow packaged revisions; renaming,
replacement or history inspection creates a Git copy that updates do not overwrite.

See [OpenAPI adaptation](adr/openapi-adaptation.md) and the
[pack guide](../src/catalogs/services/README.md) for persistence and refresh details.
