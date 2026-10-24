# Private Telegram bot connections

Telegram Bot API operations use a saved HTTP connection. In the workflow
credentials panel, choose **Bot token**, select an existing vault key containing
the raw bot token, and save a named connection. The worker supplies the token
in Telegram's URL path. Local reload retains an opaque connection reference;
portable workflow documents strip it. No token is written into a schema server
URL, workflow history, request preview or connection metadata.

The native server remains
`https://api.telegram.org/bot{botToken}`, with its `<bot_token>` placeholder.
A versioned `telegram-private-path` recipe annotates the 180 native methods
without rewriting that server or the published source. Its canonical public
endpoint is `https://api.telegram.org`; the private path placement is part of
the approved operation and encrypted connection configuration.

Only that explicit template, fixed HTTPS host and a single Bot API method name
can use the private slot. Endpoint overrides, token-filled server defaults,
literal token server URLs, encoded separators, traversal, malformed raw tokens,
missing connections and stale references fail before dispatch. The raw token
must consist of a numeric bot ID, one colon and a bounded alphanumeric/dash/
underscore secret. The provider checks whether it is valid. Arbitrary URL
interpolation and local Bot API server implementations are not supported.

The private executor resolves the current encrypted record, constructs and
checks the final URL, and sends it with omitted cookies, no referrer and
redirects disabled. Headers, status text and response bodies are scrubbed for
raw, percent-encoded and double-encoded token/URL forms, including lowercase
escapes. Fetch exceptions expose a static error without the native cause.
There is no automatic replay. The actual network URL necessarily contains the
token; browser network tools, Telegram and intervening network infrastructure
can observe that URL. The redaction boundary covers application results and
diagnostics, not browser or remote network logs.

Generic server-variable validation remains in force. Ordinary non-secret
server defaults still resolve; unresolved placeholders remain blocked. Older
Telegram documents require the reviewed private-path metadata and connection
instead of substituting a token into their server URL. This does not remove
secrets that a user previously pasted into document text or Git history.

Verified against the bundled Telegram Bot API 10.1 source, SHA-256
`f5234e87e6880f87fbba5bd594d80d2d235bac2d9388a47b00b109bc5fe0e6cc`,
and [Telegram's official request/authentication contract](https://core.telegram.org/bots/api#making-requests)
on 2026-10-24. Source generation rejects a changed native revision pending
requalification. The original source bytes remain unchanged.

Capability inspection exposes 179 of the 180 native methods. `setChatPhoto`
retains its existing unsupported form-schema limitation. Deterministic fixtures
exercise native `getMe`, JSON `sendMessage` and multipart `uploadStickerFile`,
connection reuse, invalid destinations/tokens, redaction and unchanged generic
URL guards. Selected browser cases cover phone/desktop save, reload, re-unlock
and dispatch through the production vault worker. These checks do not qualify
live bot accounts, Telegram workload semantics or browser CORS permission.
