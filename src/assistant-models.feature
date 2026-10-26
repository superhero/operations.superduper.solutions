Feature: Accepted native assistant and decision engines
  Scenario: Native text adapters preserve trained tools and allocation fallback
    Then Wllama tools keep native arguments and only allocation failures change placement
  Scenario: Gemma keeps its classic worker and native tool protocol
    Then Gemma streams through a classic worker and preserves native tool messages
  Scenario: Image tools swap models while preserving the Pi conversation
    Then image inspection preserves original attachments and the active Pi transcript across two swaps
  Scenario: Image failures and cancellation release owned resources
    Then invalid image references never suspend text and failed vision cleanup blocks restoration
  Scenario: Native decision requests and answers retain their contracts
    Then decision profiles validate exact questions and native probability readouts
  Scenario: Decision input guards reject truncation before scoring
    Then native decision guards preserve complete inputs and separate CPU compatibility
  Scenario: Native execution requirements fail before model downloads
    Then native runtime checks distinguish CPU placement from missing GPU and Wasm features
