# Bounded Twilio forms

The bundled `twilio:CreateSiprec` and `twilio:CreateStream` operations now retain
all 203 primitive request properties: five ordinary fields and the explicitly
named `Parameter1.Name`/`Parameter1.Value` through
`Parameter99.Name`/`Parameter99.Value`. These are literal form keys, not JSON
objects or arrays.

Twilio documents the
[Streams form and its 99 custom parameter pairs](https://www.twilio.com/docs/voice/api/stream-resource)
and the [SIPREC form fields](https://www.twilio.com/docs/voice/api/siprec).
The bundled native source remains pinned at SHA-256
`912992d3da38d4c43e693ae519976c47ea410db67bdebe9997b872a949e7acad`;
this implementation does not rewrite it or rename its operation identities.

## Boundaries and controls

Only the reviewed Twilio version, operation identities, POST paths, exact property
set and required-field declarations qualify for a 203-property root. Every
property must still resolve to a string, and the ordinary reader retains its
enums, patterns and other representable constraints. Other roots keep the
200-property limit; nested schemas and depth budgets are unchanged. Additional
or renamed fields, structured parameter values and unrelated providers do not
receive this exception.

The request form initially shows the five ordinary body controls. Use **Add
optional field** to select individual parameter names and values as needed.
Required, already supplied, connected and invalid fields stay visible. Existing
omission, null, help and disabled controls continue to apply. The selector reuses
the application's accessible dropdown and works at phone and desktop widths.
All 203 fields remain in the executable model; normal canvas projection limits
remain in place.

Requests retain the selected case-sensitive dotted names and ordinary
`application/x-www-form-urlencoded` escaping. Omitted optional parameters produce
no form entries. All 99 pairs can be supplied; required values and enums are
checked before dispatch. Canonical private approval includes every declared
field, so changed constraints invalidate old credential bindings.

## Verification

`src/flat-form.feature` checks both native models, exact private Basic-auth request
preparation, all 99 pairs, the 200/201-property boundary, unsupported shapes,
requiredness and stale approval. Browser cases select and send the last pair on
the actual Run form without rendering all 203 controls. A related ordinary form
case checks that the existing field-presence behavior remains intact.

Checks use one owned sds-01 Swarm job at a time with four CPUs, 16 GiB RAM,
zero additional swap, 512 PIDs and no GPU. Synthetic requests qualify preparation
and UI behavior; no live Twilio account, call or recording is created.
