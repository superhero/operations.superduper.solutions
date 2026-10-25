# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@s3-files
Feature: Signed bounded S3 object files
  @coverage-gaps
  Scenario: Object contracts reject malformed authority metadata and stale models
    Then S3 rejects malformed addressing metadata and stale logical contracts at their public boundaries

  @coverage-gaps
  Scenario: A success status cannot replace the reviewed object response
    Then S3 rejects a nonstandard success without releasing object bytes

  Scenario: Native object corrections preserve source provenance and identities
    Then S3 corrects only reviewed object byte contracts and retains all native methods

  Scenario: Object addressing preserves real keys and rejects unqualified modes
    Then S3 regional path and virtual hosts preserve escaped keys without browser normalization

  Scenario Outline: Signed object bytes survive <style> addressing
    Then S3 "<style>" uploads raw bytes and metadata and downloads the same bounded file
    Examples:
      | style   |
      | path    |
      | virtual |

  Scenario: Uploaded files and ordinary Binary casts feed the signed workflow
    Then an S3 workflow runner preserves an uploaded file through an explicit Binary cast

  Scenario: Arbitrary object media remains Binary
    Then S3 object JSON text XML and finite stream media remain exact file bytes

  Scenario: Exposed checksums qualify returned bytes
    Then S3 accepts full object SHA256 and single part ETags and rejects missing altered or composite integrity

  Scenario: Hidden content encoding cannot silently change an object
    Then S3 rejects decompressed object bytes that do not match the stored checksum

  Scenario: Binary storage bounds apply before dispatch and release
    Then S3 accepts empty and maximum sized files and rejects oversized uploads and responses

  Scenario: Old wrappers unsupported inputs and invalid metadata cannot run
    Then S3 rejects XML Body wrappers unsupported headers metadata and dot segment keys before dispatch

  Scenario: Saved object credentials retain region and account authority
    Then S3 reload reuses opaque references while changed buckets regions keys expiry and schema reject stale authority

  Scenario: Interrupted object writes have an unconfirmed outcome without replay
    Then S3 cancellation and unverifiable write responses report possible completion and never retry

  Scenario: XML errors and private file contents cannot expose credentials
    Then S3 preserves scrubbed XML errors and blocks secret bearing object files
