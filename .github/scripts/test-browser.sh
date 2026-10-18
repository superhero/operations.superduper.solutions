#!/usr/bin/env bash
# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
mkdir -p tmp/test/browser tmp/test/blobs tmp/test/executions tmp/test/attachments
runtime_directory=tmp/test/browser/.runtime
mkdir -p "$runtime_directory"
trap 'rm -rf -- "$runtime_directory"' EXIT
fail() { echo "Browser tests: $*" | tee tmp/test/browser/runner.log >&2; exit 1; }
[[ -s dist/index.html ]] || fail "Missing built application '$PWD/dist/index.html'. Run npm run build first."
command -v docker >/dev/null || fail 'Docker is not installed.'
docker info >/dev/null 2>&1 || fail 'Cannot connect to Docker.'
version="$(node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const manifest = JSON.parse(readFileSync("package.json"));
  const declared = manifest.devDependencies["@playwright/test"];
  const installed = JSON.parse(readFileSync("node_modules/@playwright/test/package.json")).version;
  if (!/^\d+\.\d+\.\d+$/.test(declared) || declared !== installed)
    throw new Error("Playwright must match its exact declared version. Run npm ci.");
  if (process.version !== "v" + manifest.engines.node)
    throw new Error("Use the project Node version: " + manifest.engines.node);
  process.stdout.write(declared);
')" || fail 'Cannot resolve the pinned Node/Playwright toolchain.'
image="mcr.microsoft.com/playwright:v${version}-noble"
node_binary="$(readlink -f "$(command -v node)")"
memory=2g
processes=256
if [[ "${GITHUB_ACTIONS:-}" == true ]]; then memory=4g; processes=512; fi
runner_arguments=()
if (( $# == 0 )) && [[ "${BROWSER_ENGINE:-chromium}" == chromium ]]; then runner_arguments+=(--with-components); fi
echo "Browser tests: image=$image, output=tmp/test, memory=$memory."
# Match the host's pinned Node runtime; the browser image otherwise supplies a
# different Node version. Source stays read-only and all output is bounded.
docker run --rm --init --network=none --read-only --shm-size=1g \
  --cpus=2 --memory="$memory" --memory-swap="$memory" --pids-limit="$processes" \
  --cap-drop=ALL --security-opt=no-new-privileges \
  --user "$(id -u):$(id -g)" --env HOME=/tmp --env CI=true \
  --env GITHUB_ACTIONS --env GITHUB_RUN_ID --env GITHUB_RUN_ATTEMPT \
  --env OPERATIONS_TEST_WORKERS \
  --env TMPDIR=/workspace/tmp/test/browser/.runtime \
  --env "BROWSER_TEST_IMAGE=$image" --env "BROWSER_ENGINE=${BROWSER_ENGINE:-chromium}" \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m \
  --mount "type=bind,source=$PWD,target=/workspace,readonly" \
  --mount "type=bind,source=$PWD/tmp/test,target=/workspace/tmp/test" \
  --mount "type=bind,source=$node_binary,target=/usr/local/bin/node,readonly" \
  --workdir /workspace "$image" \
  node tests/browser/run.mjs "${runner_arguments[@]}" "$@" \
  2>&1 | tee tmp/test/browser/runner.log
