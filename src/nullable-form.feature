# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Bounded nullable multipart fields
  Scenario: Valid files retain exact identity and bytes through private preparation
    Then nullable file declarations preserve filename media and bytes in canonical private multipart requests

  Scenario: Omission empty files and explicit null remain distinct
    Then required optional empty and null file values have separate preparation outcomes

  Scenario: Nullable primitive siblings retain their non-null constraints
    Then nullable primitive form fields accept constrained values while rejecting explicit null

  Scenario: File byte bounds remain enforced before dispatch
    Then nullable files retain schema and global byte limits with no private dispatch on failure

  Scenario: Unknown file constraints and form shapes remain unavailable
    Then nullable file models reject enum pattern malformed bounds unknown unions and unsupported transports

  Scenario: Private authority includes file constraints and source nullability
    Then stale private bindings cannot change nullable file constraints or encodings

  Scenario: The pinned GitLab upload preserves a bounded required file
    Then the native GitLab upload prepares its canonical file without changing its source
