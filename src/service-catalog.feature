# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Default service operation catalogs
  Scenario: Google Workspace and product APIs preserve their scoped workflow contracts
    Then Google product catalogs retain these collections and prepare scoped Gmail and Drive requests
      | prefix             | count |
      | Google / Workspace | 19    |
      | Google / YouTube   | 2     |
      | Google / Analytics | 2     |
      | Google / Search Console | 1 |

  Scenario: Cloudflare Realtime SFU complements the existing account API with app-secret authentication
    Then Cloudflare retains its account API and adds the published Realtime SFU contracts with their own credentials

  Scenario Outline: Cloud service collections preserve their published contracts and existing schemas
    Then "<provider>" has <count> cloud schemas under "<prefix>" including "<services>"

    Examples:
      | provider | count | prefix            | services                                                                                                                   |
      | aws      | 55    | AWS               | aws-ec2,aws-dynamodb,aws-ecs,aws-eks,aws-rds,aws-states,aws-sqs,aws-iam,aws-kms,aws-sagemaker                                    |
      | gcp      | 52    | Google / Cloud    | gcp-run,gcp-container,gcp-bigquery,gcp-firestore,gcp-pubsub,gcp-secretmanager,gcp-cloudbuild,gcp-aiplatform,gcp-cloudbilling       |
      | azure    | 13    | Microsoft / Azure | azure-compute,azure-virtual-networks,azure-storage,azure-keyvault,azure-aks,azure-app-service,azure-cosmos-db,azure-sql-databases |

  Scenario: Atlassian catalogs retain published product contracts and unambiguous workflow identities
    Then the Atlassian collection includes its published product APIs without changing established catalog identities

  Scenario: FRED and ALFRED expose economic series historical vintages and their real authentication transports
    Then FRED and ALFRED retain the economic API inventory and prepare authenticated historical and bulk requests

  Scenario: Unresolved service servers retain the source and block execution until configured
    Then Telegram placeholder defaults remain visible in the source and cannot produce an executable endpoint

  Scenario: Every packaged HTTP operation remains represented
    Then the default service index retains every packaged operation and reports execution limits

  Scenario: Standard inputs and advanced JSON remain usable without altering the source
    Then service inputs preserve standard validation and explicitly use server validation for complex JSON

  Scenario: OAuth tokens retain the declared scope boundary
    Then service OAuth tokens use bearer credentials with scope-bound operation fingerprints

  Scenario: Invalid contracts fail clearly and advanced constraints retain JSON input
    Then service contract guards reject invalid operations without dropping their source

  Scenario: Local references defaults and empty form definitions remain usable
    Then service reference defaults and form guards preserve their declared behavior

  Scenario: Generic JSON inputs cannot accidentally stringify structured URL values
    Then service request preparation rejects unsupported structured parameter values
