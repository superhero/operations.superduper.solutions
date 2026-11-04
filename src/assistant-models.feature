Feature: Accepted native assistant and decision engines
  Scenario: Native text adapters preserve trained tools and allocation fallback
    Then Wllama tools keep native arguments and only allocation failures change placement
  Scenario: Gemma keeps its classic worker and native tool protocol
    Then Gemma streams through a classic worker and preserves native tool messages
  Scenario: Image tools swap models while preserving the Pi conversation
    Then image inspection preserves original attachments and the active Pi transcript across two swaps
  Scenario: Image failures and cancellation release owned resources
    Then invalid image references never suspend text and failed vision cleanup blocks restoration
  Scenario: Compatible image sessions use their owned GPU and official artifacts
    Then compatible image loaders bind each official session to the verified owned device
  Scenario: Image device limits fail before releasing text
    Then incompatible image adapters leave the existing text model loaded
  Scenario: Image setup failures release partially owned resources
    Then compatible image setup failures destroy owned devices and release partial sessions
  Scenario: Development image factories bypass stale build output
    Then development image requests use current source beside older built runtime assets
  Scenario: Development image bundles share compilation and recover from failure
    Then development image compilation is cached refreshed and retried without stale fallback
  Scenario: Native decision requests and answers retain their contracts
    Then decision profiles validate exact questions and native probability readouts
  Scenario: Decision input guards reject truncation before scoring
    Then native decision guards preserve complete inputs and separate CPU compatibility
  Scenario: Native execution requirements fail before model downloads
    Then native runtime checks distinguish CPU placement from missing GPU and Wasm features
  Scenario: Compatible text is a separate strict GPU profile
    Then compatible MiniCPM preserves legacy placement and caps its qualified settings
  Scenario: Compatible native text keeps trained messages and GPU placement evidence
    Then compatible native text binds the pinned ABI and streams original tool calls
  Scenario: Incomplete GPU evidence and CPU model computation cannot pass
    Then compatible text refuses unproved or CPU model placement after log rollover
  Scenario: Compatible text cancellation awaits native disposal
    Then compatible text cancellation drains and failed cleanup stays failed
  Scenario: Installed catalogs contain complete immutable language and image files
    Then installed model catalogs retain exact language files and both complete image variants
  Scenario: Installed text uses the cache reader at every native loading seam
    Then all language adapters receive the installed reader without changing model placement
  Scenario: Failed installation releases its own logical use claim
    Then model asset preparation retains successful claims and releases failed or canceled ones
  Scenario: Compatible text choices bind each model to its qualified runtime pair
    Then compatible Ornith and LFM3 use fixed GPU settings and reject mixed native pairs
  Scenario: LFM3 reasoning remains separate from visible answers
    Then the trained LFM3 reasoning boundary preserves raw output without leaking truncated thoughts
