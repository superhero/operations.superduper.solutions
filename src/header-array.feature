# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Reviewed simple header arrays
  Scenario: Simple header arrays preserve literal values through both parsers
    Then primitive header arrays use comma delimiters without URL escaping in both explode modes

  Scenario: Header arrays reject ambiguous bytes and unsupported representations
    Then header array validation identifies the offending parameter without accepting complex or unsafe values

  Scenario: Native S3 ListObjects has a signed array header and its real XML result
    Then native ListObjects retains its identity signs RestoreStatus and decodes ListBucketResult
