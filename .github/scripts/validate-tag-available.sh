#!/usr/bin/env bash
set -euo pipefail

usage='Usage: validate-tag-available.sh <repository> <version>'

[[ -n "${1:-}" ]] || { printf '%s\n<repository> is missing\n' "$usage" >&2; exit 1; }
[[ -n "${2:-}" ]] || { printf '%s\n<version> is missing\n' "$usage" >&2; exit 1; }

repository="$1"
version="$2"

if gh api "repos/$repository/git/ref/tags/$version" >/dev/null 2>&1; then
  echo "::error::Version tag '$version' already exists." >&2
  exit 1
fi

echo "Version tag is available: $version"
