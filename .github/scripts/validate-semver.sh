#!/usr/bin/env bash
set -euo pipefail

usage='Usage: validate-semver.sh <version>'

[[ -n "${1:-}" ]] || { printf '%s\n<version> is missing\n' "$usage" >&2; exit 1; }

version="$1"
semver_re='^[0-9]+\.[0-9]+\.[0-9]+$'

[[ "$version" =~ $semver_re ]] || {
  echo "::error::Version '$version' must be unprefixed SemVer MAJOR.MINOR.PATCH." >&2
  exit 1
}

echo "SemVer is valid: $version"
