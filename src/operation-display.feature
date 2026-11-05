# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Qualified operation display metadata
  Scenario: Name corrections preserve repaired sources and reject route mismatches
    Then operation display names only repair the qualified invalid metadata

  Scenario Outline: Corrected operation metadata survives workflow persistence
    Then the corrected operation "<id>" has persistable display metadata and retains its source documentation

    Examples:
      | id |
      | twilio:CreateAddress |
      | twilio:CreateIncomingPhoneNumberLocal |
      | twilio:CreateIncomingPhoneNumberMobile |
      | twilio:CreateIncomingPhoneNumberTollFree |
      | twilio:CreateNewKey |
      | twilio:CreateParticipant |
      | twilio:CreateValidationRequest |
      | twilio:DeleteAddress |
      | twilio:DeleteKey |
      | twilio:DeleteRecordingTranscription |
      | twilio:DeleteSigningKey |
      | twilio:DeleteUsageTrigger |
      | twilio:FetchAddress |
      | twilio:FetchAvailablePhoneNumberCountry |
      | twilio:FetchCallNotification |
      | twilio:FetchKey |
      | twilio:FetchRecordingTranscription |
      | twilio:FetchSigningKey |
      | twilio:ListAddress |
      | twilio:ListAvailablePhoneNumberCountry |
      | twilio:ListAvailablePhoneNumberLocal |
      | twilio:ListAvailablePhoneNumberMachineToMachine |
      | twilio:ListAvailablePhoneNumberMobile |
      | twilio:ListAvailablePhoneNumberNational |
      | twilio:ListAvailablePhoneNumberSharedCost |
      | twilio:ListAvailablePhoneNumberTollFree |
      | twilio:ListAvailablePhoneNumberVoip |
      | twilio:ListCallNotification |
      | twilio:ListDependentPhoneNumber |
      | twilio:ListIncomingPhoneNumberLocal |
      | twilio:ListIncomingPhoneNumberMobile |
      | twilio:ListIncomingPhoneNumberTollFree |
      | twilio:ListKey |
      | twilio:ListRecordingTranscription |
      | twilio:ListSigningKey |
      | twilio:ListUsageRecordAllTime |
