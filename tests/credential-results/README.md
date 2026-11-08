# Private credential results

`src/credential-results.feature` tests all 27 OP-041 native operations with mocked
HTTP responses, plus source pins/projections, private inputs, encrypted vault
persistence, multi-value atomicity, lock/cancellation/source/storage races,
malformed/error/oversized responses and refusal of public execution.

Run focused source cases with:

```sh
node tests/gherkin/run.mjs source --features src/credential-results.feature
```

`node tests/credential-results/run-ui.mjs` builds a test-only browser entry and
uses an isolated Chromium context. It creates a real encrypted vault, checks
anonymous result binding, locks/unlocks it, and checks that credential input
fields require private connections. It also acquires an intercepted provider
response through the real vault worker and verifies references, encrypted
backup and the separate explicit-copy path. It blocks external network traffic
and stores a
small result at `tmp/test/credential-results-ui/result.json`.

For the exact insertion/persistence inventory, select the IDs in
`tests/credential-result-operations.json` using `test:catalog-additions`. Every
attempt has a fresh workflow; deletion is verified before the next addition.
Use the project's bounded, pinned browser environment for both browser checks.

Production results replace reviewed secret leaves with `{credentialId,label}`
references to values saved in Secrets. Declared metadata survives; unclassified
fields at credential-bearing response objects are withheld. Missing/nullable
values and masked webhook secrets do not create fake credentials. Repeated
values reuse their vault record. The complete original response contracts stay
in source provenance; the effective graph schema describes references.

The registry also guards the Assets import token and GitHub App manifest
conversion. Their separate endpoint/authentication qualifications remain in
OP-011 and OP-037; they are not counted as passing OP-041 inventory entries.
