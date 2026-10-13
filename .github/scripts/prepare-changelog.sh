#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail

repository="${1:-}"
pull_request="${2:-}"
head_sha="${3:-}"
base_branch="${4:-}"
base_sha="${5:-}"
head_branch="${6:-}"
temporary=''
trap '[[ -z "$temporary" ]] || rm -rf "$temporary"' EXIT
fail() {
  printf '::error::Changelog preparation failed for %s PR #%s (%s at %s -> %s at %s): %s\n' \
    "$repository" "$pull_request" "$head_branch" "$head_sha" "$base_branch" "$base_sha" "$*" >&2
  exit 1
}
[[ $# == 6 && "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ && "$pull_request" =~ ^[1-9][0-9]*$ ]] ||
  fail 'Expected repository, PR number, full head SHA, base branch, full base SHA, and source branch.'
[[ "$head_sha" =~ ^[0-9a-f]{40}$ && "$base_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'Full commit SHAs are required.'
case "$base_branch:$head_branch" in
  develop:feature/*|develop:bugfix/*|develop:docs/*) ;;
  *) fail 'Only feature, bugfix, or docs pull requests targeting develop prepare Staging.' ;;
esac
git check-ref-format "refs/heads/$head_branch" || fail 'Invalid source branch.'

# Both the PR and canonical branch refs must still match this exact event.
# A source ref lease protects the final push; GitHub has no atomic base lock.
check_current() {
  local pr branch expected reference encoded actual
  pr="$(gh api "repos/$repository/pulls/$pull_request")" || fail 'Could not read current pull request.'
  jq -e --argjson number "$pull_request" --arg repository "$repository" \
    --arg head "$head_sha" --arg base "$base_sha" --arg source "$head_branch" --arg target "$base_branch" '
    .number == $number and .state == "open" and .merged == false and .draft == false and
    .head.repo.full_name == $repository and .base.repo.full_name == $repository and
    .head.ref == $source and .head.sha == $head and .base.ref == $target and .base.sha == $base
  ' <<< "$pr" >/dev/null || fail 'Pull request identity, state, source or base changed; rerun CI.'
  for branch in "$head_branch" "$base_branch"; do
    expected="$head_sha"
    [[ "$branch" != "$base_branch" ]] || expected="$base_sha"
    encoded="$(jq -rn --arg branch "$branch" '$branch | @uri')"
    reference="$(gh api "repos/$repository/git/ref/heads/$encoded")" || fail "Could not read live ref $branch."
    actual="$(jq -ers --arg ref "refs/heads/$branch" '
      select(length == 1) | .[0] | select(.ref == $ref and .object.type == "commit") |
      .object.sha | select(type == "string" and test("^[0-9a-f]{40}$"))
    ' <<< "$reference")" || fail "Invalid live ref $branch."
    [[ "$actual" == "$expected" ]] || fail "Live ref $branch changed; expected $expected, found $actual; rerun CI."
  done
}
check_current
for sha in "$base_sha" "$head_sha"; do
  git cat-file -e "$sha^{commit}" || fail "Pinned commit $sha is unavailable; fetch complete history."
done
[[ "$(git rev-parse --is-shallow-repository)" == false ]] || fail 'Complete Git history is required to preserve every commit message.'
temporary="$(mktemp -d)"
node "$(dirname "${BASH_SOURCE[0]}")/prepare-changelog.mjs" "$base_sha" "$head_sha" "$repository" "$temporary/CHANGELOG.md" ||
  fail 'Could not collect the full commit messages.'
blob="$(git hash-object -w -- "$temporary/CHANGELOG.md")"
existing="$(git rev-parse --verify "$head_sha:CHANGELOG.md" 2>/dev/null || true)"
if [[ "$existing" == "$blob" ]]; then
  check_current
  [[ -z "${GITHUB_OUTPUT:-}" ]] || echo 'updated=false' >> "$GITHUB_OUTPUT"
  echo 'Staging already preserves every source commit message; CI may continue.'
  exit 0
fi
# Build only a CHANGELOG.md tree edit. Do not check out or execute proposed code,
# change the caller's index, or rewrite any existing commit.
export GIT_INDEX_FILE="$temporary/index"
git read-tree "$head_sha"
git update-index --add --cacheinfo "100644,$blob,CHANGELOG.md"
tree="$(git write-tree)"
commit="$(GIT_AUTHOR_NAME='github-actions[bot]' GIT_AUTHOR_EMAIL='41898282+github-actions[bot]@users.noreply.github.com' \
  GIT_COMMITTER_NAME='github-actions[bot]' GIT_COMMITTER_EMAIL='41898282+github-actions[bot]@users.noreply.github.com' \
  git commit-tree "$tree" -p "$head_sha" <<'MESSAGE'
chore(changelog): record Staging commit messages

Changelog-Generated: staging-v1
MESSAGE
)"
check_current
[[ -n "${GH_TOKEN:-}" ]] || fail 'A scoped GitHub App token is required for the source update.'
authorization="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w 0)"
echo "::add-mask::$authorization"
GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0="http.${GITHUB_SERVER_URL:-https://github.com}/.extraheader" \
  GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $authorization" \
  git push --force-with-lease="refs/heads/$head_branch:$head_sha" origin "$commit:refs/heads/$head_branch" ||
  fail 'Source changed or GitHub refused the update; no history was rewritten. Rerun CI.'
[[ -z "${GITHUB_OUTPUT:-}" ]] || echo 'updated=true' >> "$GITHUB_OUTPUT"
echo "Prepared Staging at $commit; the synchronize run must validate the new source head before merging."
