# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Qualified operation display metadata
  Scenario: Name corrections preserve repaired sources and reject route mismatches
    Then operation display names only repair the qualified invalid metadata

  Scenario: Description corrections retain full documentation and repaired upstream text
    Then workflow descriptions only shorten the qualified overlong metadata

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
      | twilio:ListUsageRecordDaily |
      | twilio:ListUsageRecordLastMonth |
      | twilio:ListUsageRecordMonthly |
      | twilio:ListUsageRecordThisMonth |
      | twilio:ListUsageRecordToday |
      | twilio:ListUsageRecordYearly |
      | twilio:ListUsageRecordYesterday |
      | twilio:UpdateAddress |
      | twilio:UpdateConference |
      | twilio:UpdateKey |
      | twilio:UpdateSigningKey |
      | azure-app-service:WebApps_CreateOrUpdateSwiftVirtualNetworkConnectionWithCheck |
      | azure-app-service:WebApps_CreateOrUpdateSwiftVirtualNetworkConnectionWithCheckSlot |
      | azure-app-service:WebApps_ListBackupStatusSecrets |
      | azure-app-service:WebApps_ListBackupStatusSecretsSlot |
      | azure-app-service:WebApps_UpdateSwiftVirtualNetworkConnectionWithCheck |
      | azure-app-service:WebApps_UpdateSwiftVirtualNetworkConnectionWithCheckSlot |
      | groq:uploadFile |
      | xai:handle_create_public_url_request |
      | xai:handle_generic_model_request |
      | xai:handle_get_deferred_completion_request |
      | xai:handle_language_models_list_request |
      | xai:handle_list_files_request |
      | xai:handle_revoke_public_url_request |
      | xai:handle_upload_file_request |
      | aws-s3:GetObject |
      | aws-s3:PutObject |
      | bitbucket:GET /repositories/{workspace}/{repo_slug}/pullrequests/activity |
      | bitbucket:GET /repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/activity |
      | bitbucket:GET /repositories/{workspace}/{repo_slug}/src/{commit}/{path} |
