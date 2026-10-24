# HTTP response streaming

Operations supports bounded terminal JSON results for three reviewed HTTP
operations. Events are transient input to the response reader, not persistent
workflow values. Ordinary JSON, text and binary results keep their existing
decoders.

| Operation | Wire format | Successful terminal condition |
| --- | --- | --- |
| OpenAI `POST /v1/responses` (`createResponse`) | SSE | `response.completed` with a completed Response object |
| Ollama `POST /api/chat` (`chat`) | NDJSON | A valid object with `done: true` |
| Ollama `POST /api/generate` (`generate`) | NDJSON | A valid object with `done: true` |

OpenAI's terminal Response supplies the final object. Ollama content and
thinking segments are assembled in order, including any content in the terminal
line; chat tool calls are retained as data. This reader never executes tools.
Provider failures, malformed frames, cancellation and EOF before the terminal
condition produce an error without routing partial values.

## Workflow and private execution

The final result uses the existing `application/json` schema and graph ports.
`transportMediaType` records the SSE/NDJSON transport; received HTTP headers
retain their actual content type. Newly created graphs omit a separate stream
event representation and preserve existing JSON port identities.

The run view reserves space for numeric response progress and supports the
existing Cancel request control. Progress is `{ bytes, events }`, emitted at most
once per 500 milliseconds apart from the initial and terminal notifications.
It contains no event text, provider errors, tool arguments or partial results.
Counts describe transport activity, not completion or token estimates.

Private execution parses frames inside the vault worker, checks the active
session before publishing progress, and scrubs the assembled result before it
crosses the worker boundary. The client validates progress counts and associates
them with the pending request and worker generation. Locking or cancelling
abandons that request. There is no automatic reconnect, resubmission or retry;
an explicit retry may repeat a write that the provider already accepted.

## Bounds

| Limit | Value |
| --- | --- |
| Connect / ordinary response deadline | 15 seconds |
| Stream inactivity deadline | 15 seconds since the last nonempty byte chunk |
| Stream run deadline | 120 seconds after a qualified stream starts |
| Total stream bytes | 8 MiB |
| Frame text | 1,048,576 UTF-16 code units |
| Parsed events / nonempty NDJSON lines | 10,000 |
| Input chunks / consecutive empty chunks | 65,536 / 1,024 |
| JSON depth / visited values per frame or assembled result | 64 / 100,000 |

The profiled vault RPC has a 150-second watchdog; ordinary vault calls retain
their 30-second watchdog. Heartbeats can satisfy inactivity but cannot extend
the run deadline. Readers are cancelled and timers cleared on every exit.

SSE uses fatal UTF-8 decoding, handles CR/LF/CRLF across arbitrary chunks and
requires a blank line to dispatch a frame. NDJSON requires a newline after each
object. Transport closure alone cannot manufacture a successful terminal frame.

## Reviewed sources and verification

Checked 2026-10-24 against [OpenAI Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events),
[Ollama streaming](https://docs.ollama.com/api/streaming) and
[HTML SSE interpretation](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation).
The bundled source documents remain unchanged. The versioned
`http-response-streaming` recipe annotates only the three operations above and
requires their reviewed endpoint, operation identity and JSON/wire declarations.
Source generation also requires these original document SHA-256 pins:

- OpenAI 2.3.0: `b7ec5bd5e29c40f0bfa2e53c06ece711a40276653646d9f3db77498d6579ab41`.
- Ollama 0.1.0: `16f3b75a4944e1fb0e5b68fedc30b5974406dc2ac125d07cb33dde6981e2f99b`.

The deterministic contracts live in
[`workflow-stream-response.feature`](../src/workflow-stream-response.feature),
with selected browser cases for mobile/desktop progress, cancellation and the
production vault worker/client boundary. These are fixture checks, not claims
of live provider qualification. Requalify source pins and terminal semantics
when provider contracts change. Other SSE/NDJSON dialects remain unsupported;
this feature does not implement Codex App Server events. Browser CORS, local
network policy and existing credential authority still apply.
