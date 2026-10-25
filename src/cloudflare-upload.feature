# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@cloudflare-upload
Feature: Private Cloudflare upload sessions
  Scenario: Native upload corrections preserve source and distinguish temporary credentials
    Then the pinned Cloudflare upload correction preserves native bytes and unrelated contracts

  Scenario: Worker assets use account upload and completion credentials in order
    Then a Workers upload session sends base64 file parts and consumes its private completion token

  Scenario: Already uploaded assets skip file writes
    Then an empty Workers upload bucket becomes a completion reference without an upload request

  Scenario: Pages operations use project scoped temporary authentication
    Then Pages checks uploads and registers hashes with its private short lived token

  Scenario: Upload references can flow through ordinary workflow connections
    Then a workflow upload reference selects private transport without exposing or persisting its JWT

  Scenario: Expired changed and invalid upload references cannot dispatch
    Then Cloudflare upload references reject expiry tenant changes schema changes wrong phases and cleared sessions

  Scenario: Invalid buckets and file bytes cannot dispatch
    Then Cloudflare validates manifest sizes bucket membership base64 mode and completion module parts

  Scenario: Failed and cancelled sessions expose no private result and do not replay
    Then Cloudflare failure cancellation malformed responses and token echoes stay private and invalidate references

  Scenario: Ordinary multipart and account calls keep their existing behavior
    Then Cloudflare custom base64 encoding leaves ordinary binary multipart and account token requests unchanged

  Scenario: Private upload contracts cannot fall back to public execution
    Then Cloudflare private profiles reject anonymous authority altered wire models and public dispatch

  Scenario: Platform Worker completion preserves its dispatch namespace
    Then a platform asset session completes only for its original Worker namespace and account

  @coverage-gaps
  Scenario: Acquisition enforces manifest token and scope limits
    Then Cloudflare acquisition rejects malformed manifests buckets and token validity claims

  @coverage-gaps
  Scenario: Pages completion requires exactly its checked and uploaded hashes
    Then Cloudflare Pages enforces missing hash state canonical file data and one use completion

  @coverage-gaps
  Scenario: Upload phases and multipart names remain strict
    Then Cloudflare rejects inconsistent upload transitions and malformed multipart file names

  @coverage-gaps
  Scenario: Private upload buckets respect the transport byte budget
    Then Cloudflare rejects upload buckets exceeding the private transport byte budget
