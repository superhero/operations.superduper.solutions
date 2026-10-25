# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-rpc
Feature: Native RPC operation models
  Native schemas retain their wire identity without gaining HTTP or native execution authority.

  Scenario: Pinned Codex requests hydrate with exact parameter reference closures
    Then native RPC hydration preserves pinned methods versions and schema references

  Scenario: Invalid and excessive native contracts are rejected before publication
    Then native RPC scoping rejects ambiguous requests and invalid reference closures

  @coverage-gaps
  Scenario: Native wire schemas retain bounded reference closure and optional inputs
    Then native RPC schemas reject excessive nesting and absent wire errors while preserving optional parameters

  Scenario: Native policy identity binds the exact method version and schema
    Then native model approvals reject altered schemas and HTTP authorization

  Scenario: Native cached models retain their protocol and source ownership
    Then native model installation rejects stale sources and retains protocol through republication

  Scenario: Native models share bounded batches and reject stale replies
    Then native model batches coalesce requests and enforce source identity

  Scenario: Native parameter result and error ports survive workflow import
    Then native workflow graphs retain their schema identity without HTTP response fields

  Scenario: Malformed native saved identities cannot masquerade as HTTP operations
    Then native workflow imports reject mismatched protocol method and version metadata

  Scenario: Hydrated native methods never enter HTTP or credential execution
    Then native execution remains guarded after model loading and forged page edits
