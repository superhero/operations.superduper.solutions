# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Qualified form field representations
  Scenario: Form field corrections retain complete upstream bodies
    Then all thirteen form corrections preserve source identities schemas and request preimages

  Scenario: Form field source drift is rejected atomically
    Then changed native form fields cannot be partially corrected

  Scenario: Mixed scalar and array forms retain their validation
    Then qualified scalar and repeated form unions preserve types bounds exclusivity and uniqueness

  Scenario: Nested form options use bracket notation
    Then bracketed multipart options preserve structure and reject unqualified encodings

  Scenario: Typed JSON fields have no upload filename
    Then typed JSON text fields retain their part type without becoming file uploads

  Scenario: Native form operations retain files and private authentication
    Then all thirteen native form operations send their qualified payloads through private HTTP execution

  Scenario: Native union constraints fail before transport
    Then invalid native form union values and corrupt file envelopes cannot dispatch

  Scenario: Form representation changes invalidate private approval
    Then changed form wire styles cannot reuse earlier private authority
