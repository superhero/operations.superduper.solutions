#!/usr/bin/env bash
set -euo pipefail

repository="${1:?Usage: validate-tag-available.sh <repository> <version>}"
version="${2:?Usage: validate-tag-available.sh <repository> <version>}"

if gh api "repos/$repository/git/ref/tags/$version" >/dev/null 2>&1; then
  echo "::error::Version tag '$version' already exists."
  exit 1
fi

echo "Version tag is available: $version"
