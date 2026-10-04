#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

file="${1:-}"
object_key="${2:-}"
content_type="${3:-}"
context="file='$file', bucket='operations-status', object='$object_key', content-type='$content_type', account='${CLOUDFLARE_ACCOUNT_ID:-unset}'"
[[ $# == 3 && -n "$object_key" && -n "$content_type" ]] || {
  echo "::error::Usage: publish-status.sh <file> <object-key> <content-type> ($context)." >&2
  exit 1
}

[[ -f "$file" ]] || {
  echo "::error::Status file does not exist: $file ($context)." >&2
  exit 1
}
[[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || {
  echo "::error::Cloudflare R2 credentials are not configured: CLOUDFLARE_API_TOKEN is missing ($context)." >&2
  exit 1
}
[[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]] || {
  echo "::error::Cloudflare R2 credentials are not configured: CLOUDFLARE_ACCOUNT_ID is missing ($context)." >&2
  exit 1
}

print_api_errors() {
  jq -r --arg token "$CLOUDFLARE_API_TOKEN" '
    .errors[]? | select(type == "object") |
    "Cloudflare error \(.code // "unknown"): \(.message // "No message provided")" |
    split($token) | join("[REDACTED]")
  ' <<< "$response" >&2 2>/dev/null || true
}

if ! response="$(curl --fail-with-body --silent --show-error \
  --request PUT \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --header "Content-Type: $content_type" \
  --data-binary @"$file" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/operations-status/objects/$object_key")"; then
  echo "::error::Failed to publish R2 object: $object_key ($context)." >&2
  print_api_errors
  exit 1
fi

if ! jq -e '.success == true' <<< "$response" >/dev/null 2>&1; then
  echo "::error::Cloudflare returned an unsuccessful response for R2 object: $object_key ($context)." >&2
  print_api_errors
  exit 1
fi
