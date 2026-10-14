# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation @pages-deployment
Feature: Reuse the active Pages deployment when the tested bundle is unchanged
  The destination branch, final HTML bytes, hosting headers, and every icon determine whether a deployment is needed.
  A preview for another branch or an older alias target cannot stand in for the current destination.

  Scenario Outline: Compare the bundle with the active destination
    Given a tested Pages bundle for "<branch>"
    And the Pages destination is "<state>"
    When the Pages deployment is prepared
    Then the Pages decision is deploy "<deploy>" and skipped "false"

    Examples:
      | branch        | state                     | deploy |
      | develop       | empty                     | true   |
      | develop       | identical                 | false  |
      | release/1.2.3 | identical on second page  | false  |
      | hotfix/1.2.4  | changed                   | true   |
      | develop       | unmarked                  | true   |
      | develop       | no commit message         | true   |
      | develop       | legacy HTML hash          | true   |
      | develop       | identical without alias   | true   |
      | main          | identical                 | false  |
      | main          | empty                     | true   |

  Scenario: A hosting header change invalidates an otherwise identical deployment
    Given a tested Pages bundle for "develop"
    And the Pages destination is "identical"
    And the Pages bundle is "changed headers"
    When the Pages deployment is prepared
    Then the Pages decision is deploy "true" and skipped "false"

  Scenario: A dependency badge update does not invalidate a tested bundle
    Given a tested Pages bundle for "develop"
    And the Pages destination is "identical"
    And the Pages branch is "advanced with badges"
    When the Pages deployment is prepared
    Then the Pages decision is deploy "false" and skipped "false"

  Scenario Outline: A change to any hosted icon invalidates an otherwise identical deployment
    Given a tested Pages bundle for "develop"
    And the Pages destination is "identical"
    And the Pages icon "<filename>" has changed
    When the Pages deployment is prepared
    Then the Pages decision is deploy "true" and skipped "false"

    Examples:
      | filename             |
      | favicon.svg          |
      | favicon.ico          |
      | favicon.png          |
      | favicon.bmp          |
      | favicon.gif          |
      | favicon.jpg          |
      | favicon.ppm          |
      | favicon.tiff         |
      | apple-touch-icon.png |

  Scenario Outline: Every hosted fallback must be present as a nonempty regular file
    Given a tested Pages bundle for "develop"
    And the Pages icon "<filename>" is "<state>"
    When the Pages deployment is prepared
    Then Pages preparation fails with "eleven nonempty regular application, hosting, and favicon files"

    Examples:
      | filename             | state       |
      | favicon.svg          | missing     |
      | favicon.ico          | missing     |
      | favicon.png          | missing     |
      | favicon.bmp          | missing     |
      | favicon.gif          | missing     |
      | favicon.jpg          | missing     |
      | favicon.ppm          | missing     |
      | favicon.tiff         | missing     |
      | apple-touch-icon.png | missing     |
      | favicon.png          | empty       |
      | favicon.ico          | a symlink   |
      | favicon.svg          | a directory |

  Scenario Outline: A stale preview cannot replace a newer branch
    Given a tested Pages bundle for "release/1.2.3"
    And the Pages destination is "empty"
    And the Pages branch is "<state>"
    When the Pages deployment is prepared
    Then the Pages decision is deploy "false" and skipped "true"

    Examples:
      | state                 |
      | deleted               |
      | advanced with code    |

  Scenario Outline: Production guards and GitHub access failures remain errors
    Given a tested Pages bundle for "<branch>"
    And the Pages destination is "identical"
    And the Pages branch is "<state>"
    When the Pages deployment is prepared
    Then Pages preparation fails with "<reason>"

    Examples:
      | branch  | state                 | reason                         |
      | main    | deleted               | production branch no longer    |
      | main    | advanced with code    | Production was superseded      |
      | develop | permission denied     | Could not read the destination |

  Scenario Outline: Only an unambiguous successful destination can be reused
    Given a tested Pages bundle for "develop"
    And the Pages destination is "<state>"
    When the Pages deployment is prepared
    Then Pages preparation fails with "<reason>"

    Examples:
      | state                 | reason                         |
      | wrong project         | unexpected project             |
      | failed deployment     | active destination deployment  |
      | wrong branch          | active destination deployment  |
      | wrong environment     | active destination deployment  |
      | invalid URL           | active destination deployment  |
      | duplicate aliases     | More than one deployment       |
      | incomplete pagination | incomplete preview deployment  |
      | API failure           | Cloudflare error 10000         |

  Scenario Outline: The bundle hash covers the entire supported deployment
    Given a tested Pages bundle for "develop"
    And the Pages bundle is "<state>"
    When the Pages deployment is prepared
    Then Pages preparation fails with "eleven nonempty regular application, hosting, and favicon files"

    Examples:
      | state             |
      | empty HTML        |
      | missing HTML      |
      | empty headers     |
      | missing headers   |
      | extra file        |
      | hidden file       |
      | nested directory  |
      | symlink           |
      | headers symlink   |

  Scenario: Unconfigured branch types cannot claim a Pages alias
    Given a tested Pages bundle for "feature/new-ui"
    When the Pages deployment is prepared
    Then Pages preparation fails with "Pages deployment supports"
