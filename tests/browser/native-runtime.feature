# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-runtime-ui @service-defaults
Feature: Pair native runtimes from the private settings worker
  The production vault worker owns the authenticated HTTPS and WSS lifecycle.

  Background:
    Given I create a vault in the Secrets settings and save a synthetic credential

  @native-test-tls @native-agent-profile @native-turn-control-ui
  Scenario: An owned running turn accepts an instruction and native interruption
    Then the running workflow turn can be steered and interrupted through its private worker

  @native-test-tls @native-agent-profile @native-turn-work-ui
  Scenario: Review and compaction wait for completion through the production worker
    Then the owned workflow review and compaction finish after their native turns

  @native-test-tls @native-agent-profile @native-guardian-ui
  Scenario: An observed Guardian denial requires human confirmation through the production worker
    Then the workflow selects and confirms its observed Guardian denial before native approval

  @native-test-tls @native-account-actions-ui
  Scenario Outline: Account action <method> waits for explicit approval through the production worker
    Then account action "<method>" requires confirmation before its native dispatch
    Examples:
      | method                              |
      | account/rateLimitResetCredit/consume |
      | account/sendAddCreditsNudgeEmail     |

  @native-test-tls @native-gateway-oauth-ui
  Scenario: Gateway workflows cancel and retry through the production private worker
    Then gateway authentication cancels its owned native login through the production worker

  @native-test-tls @native-gateway-oauth-ui @native-gateway-peer-ui
  Scenario: Gateway workflow sign-in instructions disappear after confirmed completion
    Then the gateway workflow form keeps its handoff transient until confirmation

  @native-test-tls
  Scenario: A read only pairing runs account state through a workflow
    Then a read only native pairing returns account state through the production workflow worker

  @native-test-tls
  Scenario: A read only pairing initializes a new owned child through a workflow
    Then a read only native pairing initializes through the production workflow worker

  @native-test-tls @native-metadata-ui
  Scenario Outline: A read only pairing queries <method> through a workflow
    Then a read only native pairing queries "<method>" through the production workflow worker

    Examples:
      | method                          |
      | model/list                      |
      | modelProvider/capabilities/read  |
      | permissionProfile/list          |
      | hooks/list                      |

  @native-test-tls @native-apps-ui
  Scenario Outline: A read only pairing queries standalone <method> through a workflow
    Then a read only native pairing queries "<method>" through the production workflow worker

    Examples:
      | method         |
      | app/installed  |
      | app/list       |
      | app/read       |

  @native-test-tls @native-mcp-read-ui
  Scenario Outline: A read only pairing reads configured MCP <method> through a workflow
    Then a read only native pairing queries "<method>" through the production workflow worker

    Examples:
      | method                  |
      | mcpServerStatus/list    |
      | mcpServer/resource/read |

  @native-test-tls @native-mcp-oauth-ui
  Scenario: MCP sign-in waits for owned completion through the production workflow worker
    Then native MCP sign-in exposes a transient link and waits for completion in the production worker

  @native-test-tls @native-fs-read-ui
  Scenario Outline: A read only pairing reads native workspace <method> through a workflow
    Then a read only native pairing queries "<method>" through the production workflow worker

    Examples:
      | method           |
      | fs/readFile      |
      | fs/readDirectory |
      | fs/getMetadata   |
      | fuzzyFileSearch  |

  @native-test-tls @native-fs-write-ui
  Scenario Outline: An explicit mutation pairing applies native workspace <method> through a workflow
    Then a read only native pairing queries "<method>" through the production workflow worker

    Examples:
      | method             |
      | fs/writeFile       |
      | fs/createDirectory |
      | fs/copy            |
      | fs/remove          |

  @native-test-tls @native-fs-watch-ui
  Scenario: Private worker watch controls deliver owned events while preserving sibling cancellation
    Then native watch controls cross the production worker and client without blocking unwatch

  @native-test-tls @native-command-ui
  Scenario: Private worker commands preserve approval concurrent controls and sibling cancellation
    Then private command controls cross the production worker with owned approval and cancellation

  @native-test-tls @native-command-ui
  Scenario Outline: Native command workflows preserve approval controls and <ending> in the production browser
    Then a native command workflow preserves its "<ending>" lifecycle in the production browser

    Examples:
      | ending    |
      | terminate |
      | stop      |

  @native-test-tls @native-sections-ui
  Scenario: Native thread sections persist create rename clear delete and list in workflows
    Then native thread sections preserve metadata and appearance through production browser workflows

  @native-test-tls @native-fs-watch-ui
  Scenario Outline: Native watch workflows preserve events and <ending> through the production worker
    Then a native watch workflow preserves its "<ending>" lifecycle in the production browser

    Examples:
      | ending    |
      | unwatch   |
      | stop      |
      | root-loss |

  @native-test-tls @native-feedback-ui
  Scenario: Feedback uploads run through the production private worker with owned synthetic delivery
    Then a read only native pairing queries "feedback/upload" through the production workflow worker

  @native-test-tls
  Scenario: A private native pairing survives reload and explicit reconnect
    Then native runtime settings pair reconnect and disconnect through the production worker

  @native-test-tls
  Scenario: Changed account and schema authority revoke a native pairing
    Then native runtime settings reject changed authority until the pairing is explicitly replaced

  Scenario: Untrusted TLS never receives a private pairing request
    Then native runtime settings reject an untrusted companion certificate

  @native-test-tls
  Scenario: A foreign allowed Origin cannot receive the private pairing key
    Then native runtime settings enforce real companion CORS before sending its pairing key

  @native-test-tls @native-configuration-read-ui
  Scenario Outline: Paired configuration read <method> works without agent or provider authentication
    Then a read only native pairing queries "<method>" through the production workflow worker

    Examples:
      | method                     |
      | config/read                |
      | configRequirements/read    |
      | experimentalFeature/list   |
      | skills/list                |

  @native-test-tls @native-configuration-control-ui
  Scenario Outline: Paired configuration control <method> changes its SDK session
    Then a paired configuration control executes "<method>" through the production workflow worker

    Examples:
      | method                              |
      | experimentalFeature/enablement/set |
      | skills/extraRoots/set               |
      | config/mcpServer/reload             |

  @native-test-tls @native-real-runtime @native-configuration-write-ui
  Scenario Outline: Paired configuration write <method> saves verified settings
    Then a paired configuration write executes "<method>" through the production workflow worker

    Examples:
      | method              |
      | config/value/write  |
      | config/batchWrite   |
      | skills/config/write |

  @native-test-tls @native-real-runtime @native-configuration-write-ui @native-configuration-read-ui @native-configuration-control-ui
  Scenario: Paired configuration writes continue with the original workflow binding
    Then verified configuration writes advance later workflow calls from their original binding

  @native-test-tls @native-real-runtime @native-migration-ui
  Scenario Outline: Paired migration <method> uses verified native state
    Then a paired migration executes "<method>" through the production workflow worker

    Examples:
      | method                                    |
      | externalAgentConfig/detect                |
      | externalAgentConfig/import                |
      | externalAgentConfig/import/readHistories   |
      | externalAgentConfig/import/recordHistory   |

  @native-test-tls @native-real-runtime @native-migration-ui
  Scenario: Paired migrations continue with the original workflow binding
    Then verified migrations continue with their original workflow binding without publishing private values

  @native-test-tls @native-real-runtime @native-stored-thread-read-ui
  Scenario Outline: Paired stored-thread read <method> uses its owned persisted store
    Then a paired stored-thread read executes "<method>" through the production workflow worker

    Examples:
      | method                       |
      | thread/list                  |
      | thread/loaded/list           |
      | thread/read                  |
      | thread/turns/list            |
      | thread/items/list            |
      | thread/goal/get              |
      | thread/attachment/list       |
      | thread/attachmentOwner/list  |

  @native-test-tls @native-real-runtime @native-thread-lifecycle-ui
  Scenario Outline: Paired thread lifecycle <method> mutates only its owned store
    Then a paired thread lifecycle action executes "<method>" through the production workflow worker

    Examples:
      | method                 |
      | thread/archive         |
      | thread/delete          |
      | thread/unarchive       |
      | thread/unsubscribe     |
      | thread/metadata/update |
      | thread/name/set        |
      | thread/section/move    |

  @native-test-tls @native-real-runtime @native-thread-lifecycle-ui @native-agent-ui
  Scenario: An approved browser workflow forks a thread after explicit resume
    Then an approved lifecycle workflow resumes and forks its owned thread through the production worker

  @native-test-tls @native-real-runtime @native-thread-content-ui @native-agent-ui @native-thread-shell-ui
  Scenario: An approved browser workflow edits owned thread contents and goals
    Then an approved content workflow preserves attachment goal and history contracts through the production worker

  @native-test-tls @native-real-runtime @native-account-read-ui
  Scenario Outline: A paired account read executes <method> with the actual SDK
    Then a read only native pairing queries "<method>" through the production workflow worker

    Examples:
      | method                         |
      | account/gatewayOAuth/read      |
      | account/rateLimits/read        |
      | account/usage/read             |
      | account/workspaceMessages/read |

  @native-test-tls @native-real-runtime @native-account-auth-ui
  Scenario: Account authentication retains reference changes and concurrent owned cancellation in the browser worker
    Then account authentication updates references and cancels its owned sign-in through the production worker

  @native-test-tls @native-account-auth-ui @native-auth-device-peer
  Scenario: Device sign-in instructions remain transient in a workflow form
    Then the account workflow form shows a transient device code and waits for confirmation

  @native-test-tls @native-plugins-read-ui
  Scenario Outline: Paired plugin read <method> completes without agent or write approval
    Then a read only native pairing queries "<method>" through the production workflow worker

    Examples:
      | method            |
      | plugin/installed  |
      | plugin/list       |
      | plugin/read       |
      | plugin/skill/read |
      | plugin/share/list |

  @native-test-tls @native-real-runtime @native-marketplaces-ui
  Scenario Outline: Paired marketplace <method> verifies real effects through the production worker
    Then a read only native pairing queries "<method>" through the production workflow worker

    Examples:
      | method              |
      | marketplace/add     |
      | marketplace/upgrade |
      | marketplace/remove  |

  @native-test-tls @native-real-runtime @native-plugin-management-ui
  Scenario Outline: Paired plugin management <method> verifies real effects through the production worker
    Then a read only native pairing queries "<method>" through the production workflow worker

    Examples:
      | method           |
      | plugin/install   |
      | plugin/uninstall |
      | plugin/reconcile |

  @native-test-tls @native-real-runtime @native-plugin-sharing-ui
  Scenario Outline: Paired plugin sharing <method> verifies real effects through the production worker
    Then a read only native pairing queries "<method>" through the production workflow worker

    Examples:
      | method                     |
      | plugin/share/save          |
      | plugin/share/updateTargets |
      | plugin/share/checkout      |
      | plugin/share/delete        |

  @native-test-tls @native-real-runtime @native-windows-readiness-ui
  Scenario: Paired Windows readiness reports real platform status through the production worker
    Then a read only native pairing queries "windowsSandbox/readiness" through the production workflow worker
