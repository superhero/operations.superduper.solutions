# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@http-streaming
Feature: Bounded terminal HTTP stream results
  Scenario Outline: <mode> <profile> frames produce one stable JSON result
    Then "<mode>" "<profile>" streaming preserves the terminal value across chunk boundaries
    Examples:
      | mode    | profile          |
      | public  | openai-responses |
      | private | openai-responses |
      | public  | ollama-chat      |
      | private | ollama-chat      |
      | public  | ollama-generate  |
      | private | ollama-generate  |

  Scenario Outline: <mode> SSE accepts a final CR delimiter without another byte
    Then "<mode>" SSE terminal line endings are complete without a following byte
    Examples:
      | mode    |
      | public  |
      | private |

  Scenario Outline: <mode> stream failures cannot become partial success
    Then "<mode>" streams reject invalid incomplete oversized and aborted outcomes without replay
    Examples:
      | mode    |
      | public  |
      | private |

  Scenario Outline: <mode> streaming obeys connect idle and run deadlines
    Then "<mode>" HTTP streams have bounded deadlines that do not extend on progress
    Examples:
      | mode    |
      | public  |
      | private |

  Scenario: Final stream values enter the existing JSON graph exactly once
    Then streaming workflow routing waits for completion and sends one terminal JSON value downstream

  Scenario: Credential echoes cannot cross the streaming progress boundary
    Then private stream progress contains counts only and the assembled result is scrubbed before routing

  Scenario: Native OpenAI and Ollama streaming remains pinned and reviewable
    Then pinned OpenAI and Ollama operations select reviewed stream profiles while unrelated streams stay unavailable
