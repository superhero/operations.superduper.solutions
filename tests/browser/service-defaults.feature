# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Default service schemas in the application
  @service-defaults
  Scenario Outline: Google Workspace and product catalogs support saved workflows on desktop and mobile
    When I use a viewport of <width> by 844 pixels
    Then Google Workspace YouTube Analytics and Search Console are grouped and Gmail and Drive nodes survive reload

    Examples:
      | width |
      | 390   |
      | 1280  |

  @service-defaults
  Scenario Outline: Cloudflare Realtime SFU operations can be added and restored on desktop and mobile
    When I use a viewport of <width> by 844 pixels
    Then Cloudflare Realtime SFU appears beside the account API and its workflow node survives reload

    Examples:
      | width |
      | 390   |
      | 1280  |

  @service-defaults
  Scenario Outline: Cloud service collections remain browsable on desktop and mobile
    When I use a viewport of <width> by 844 pixels
    Then the cloud collections retain their provider counts and representative workflow contracts

    Examples:
      | width |
      | 390   |
      | 1280  |

  @service-defaults
  Scenario: Provider names use product paths and refresh saved factory labels
    Then provider schema names use these paths across saved-label updates
      | id                 | previous                          | name                               |
      | aws-lambda         | AWS — Lambda                      | AWS / Lambda                       |
      | aws-s3             | AWS — S3                          | AWS / S3                           |
      | bitbucket          | Bitbucket / Cloud                 | Atlassian / Bitbucket / Cloud      |
      | bluesky-app        | Bluesky — App and AT Protocol      | Bluesky / App and AT Protocol       |
      | bluesky-dms        | Bluesky — Direct messages         | Bluesky / Direct messages          |
      | bluesky-moderation | Bluesky — Ozone moderation        | Bluesky / Ozone moderation         |
      | confluence         | Confluence / Cloud                | Atlassian / Confluence / Cloud     |
      | cloudflare         | Cloudflare                        | Cloudflare / API                  |
      | docker             | Docker Engine                     | Docker / Engine                    |
      | dukascopy          | Dukascopy Trading Tools           | Dukascopy / Trading Tools          |
      | ecb                | ECB Data Portal                   | ECB / Data Portal                  |
      | fred               | FRED / Federal Reserve Economic Data | Federal Reserve / FRED            |
      | alfred             | ALFRED / Archival Federal Reserve Economic Data | Federal Reserve / ALFRED |
      | gcp-compute        | Google Cloud — Compute            | Google / Cloud / Compute           |
      | gcp-storage        | Google Cloud — Storage            | Google / Cloud / Storage           |
      | gemini             | Google Gemini — Interactions      | Google / Gemini / Interactions     |
      | hetzner            | Hetzner Cloud                     | Hetzner / Cloud                    |
      | huggingface        | Hugging Face — Inference Endpoints | Hugging Face / Inference Endpoints |
      | jira               | Jira / Cloud                      | Atlassian / Jira / Cloud           |
      | azure-resources    | Microsoft Azure — Resources       | Microsoft / Azure / Resources      |
      | telegram           | Telegram Bot API                  | Telegram / Bot API                 |

  @service-defaults
  Scenario: FRED and ALFRED are separate economic data catalogs with usable workflow nodes
    Then FRED observations and ALFRED vintages are available in separate catalogs and survive workflow reload

  @service-defaults
  Scenario: Atlassian product names appear consistently in settings and the operation menu
    Then all Atlassian catalogs share the provider prefix and retain a newly disabled product after reload

  @service-defaults
  Scenario: Schemas remain alphabetical after renames uploads and legacy saved orders
    Then schemas always sort by displayed name without manual controls

  @service-defaults
  Scenario: Fresh profiles include the complete collection and retain local choices
    Then all service schemas appear and preserve disablement renames and default protection after reload

  Scenario: Existing profiles receive new defaults without losing authored documents
    Then the default schema migration preserves an existing custom document and disabled example

  @service-defaults @schema-profile @chromium-only
  Scenario: Measure schema startup search management and inspector retention
    Then schema lifecycle performance is measured with the complete service collection

  @service-defaults
  Scenario: Large schema inspection renders a bounded page and releases closed content
    Then the largest bundled schema can be inspected without retaining its closed viewer

  @service-defaults
  Scenario: Closing an inspector ignores an outstanding source response
    Then a closed schema inspector ignores a delayed source reply and can reopen

  @service-defaults
  Scenario: Long search menus keep native navigation and one active help popup
    Then full-library search renders nearby rows and shares tooltip state

  @service-defaults @catalog-help
  Scenario: Catalog help preserves hover keyboard explanations and the tooltip preference
    Then delegated catalog help preserves disabled explanations anchors and dismissal

  @service-defaults @schema-profile @schema-next @chromium-only
  Scenario: Measure repeated startup and untraced search phases
    Then startup and search phases are measured separately from diagnostic profiling

  @service-defaults
  Scenario: Closed settings and search release their controls and worker
    Then closed settings and search retain no inactive controls or matching worker

  @service-defaults @schema-profile @chromium-only @menu-runtime-profile
  Scenario: Attribute search completion to scoring script style and layout
    Then repeated menu searches retain their output and record rendering costs

  @service-defaults @schema-profile @chromium-only @workflow-runtime-profile
  Scenario: Restore a larger workflow through actual storage and worker messages
    Then a ninety-six-operation workflow restores with bounded canonical models
