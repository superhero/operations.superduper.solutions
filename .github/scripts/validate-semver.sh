#!/usr/bin/env bash
set -euo pipefail

version="${1:?Usage: validate-semver.sh <version>}"
semver_re='^[0-9]+\.[0-9]+\.[0-9]+$'

[[ "$version" =~ $semver_re ]] || {
  echo "::error::Version '$version' must be unprefixed SemVer MAJOR.MINOR.PATCH."
  exit 1
}

echo "SemVer is valid: $version"
