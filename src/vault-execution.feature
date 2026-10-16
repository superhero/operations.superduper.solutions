# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@vault-execution
Feature: Approved credential execution
  Credentials leave the worker only for an explicitly approved operation and selected authentication alternative.

  Scenario: Approval fingerprints bind complete immutable operation definitions
    Then credential approval fingerprints bind complete immutable operation definitions

  Scenario Outline: Strict credential destinations reject <case>
    Then credential destination <origin> is rejected
    Examples:
      | case                 | origin                                  |
      | non-string           | null                                    |
      | public cleartext     | "http://api.example.test/v1"             |
      | abbreviated loopback | "http://127.1/v1"                        |
      | relative URL         | "/api"                                  |
      | unsupported scheme   | "file:///tmp/api"                        |
      | embedded password    | "https://user:pass@api.example.test"      |
      | query string         | "https://api.example.test?token=value"   |
      | fragment             | "https://api.example.test#part"          |
      | malformed port       | "https://api.example.test:invalid"       |
      | encoded host         | "https://%61pi.example.test"             |
      | raw traversal        | "https://api.example.test/v1/../admin"   |
      | encoded traversal    | "https://api.example.test/%2e%2e/admin"  |
      | encoded slash        | "https://api.example.test/v1%2fadmin"    |
      | encoded backslash    | "https://api.example.test/v1%5cadmin"    |
      | double encoding      | "https://api.example.test/%252e%252e"    |
      | malformed encoding   | "https://api.example.test/%zz"          |
      | double slash         | "https://api.example.test//admin"       |
      | leading whitespace   | " https://api.example.test"             |
      | unresolved template  | "https://api.example.test/{version}"    |

  Scenario Outline: Development loopback and HTTPS destinations normalize <origin>
    Then credential destination "<origin>" normalizes to "<expected>"
    Examples:
      | origin                              | expected                       |
      | HTTPS://API.EXAMPLE.TEST:443/v1/      | https://api.example.test/v1     |
      | https://api.example.test             | https://api.example.test        |
      | http://localhost:8080/v1             | http://localhost:8080/v1        |
      | http://127.0.0.1/v1                  | http://127.0.0.1/v1             |
      | http://[::1]:8080/v1                 | http://[::1]:8080/v1            |

  Scenario Outline: Cleartext destinations require a loopback application for <case>
    Then application origin "<application>" <outcome> cleartext credential destination "<destination>"
    Examples:
      | case                        | application                    | outcome | destination                    |
      | hosted HTTPS application    | https://app.example.test       | rejects | http://localhost:8080/v1        |
      | hosted HTTP application     | http://app.example.test        | rejects | http://127.0.0.1/v1             |
      | absent application location | absent                         | rejects | http://localhost:8080/v1        |
      | opaque application origin   | null                           | rejects | http://localhost:8080/v1        |
      | unrelated origin scheme     | ftp://localhost                | rejects | http://localhost:8080/v1        |
      | misleading application host | http://localhost.example.test  | rejects | http://localhost:8080/v1        |
      | localhost development       | http://localhost:5173          | allows  | http://localhost:8080/v1        |
      | IPv4 development            | http://127.0.0.1:5173          | allows  | http://127.0.0.1/v1             |
      | IPv6 development            | http://[::1]:5173              | allows  | http://[::1]:8080/v1            |
      | secure loopback development | https://localhost:5173         | allows  | http://127.0.0.1/v1             |
      | local app public cleartext  | http://localhost:5173          | rejects | http://api.example.test/v1      |
      | local app abbreviated host  | http://localhost:5173          | rejects | http://127.1/v1                 |

  Scenario Outline: Invalid approval descriptors reject <case>
    Then invalid approval case "<case>" fails closed
    Examples:
      | case                        |
      | unknown method              |
      | blank identity              |
      | missing fields              |
      | unsafe operation path       |
      | invalid security container  |
      | invalid alternative         |
      | missing security scheme     |
      | duplicate security name     |
      | duplicate credential header |
      | unsupported security kind   |
      | inconsistent security name  |
      | changed bearer placement    |
      | forbidden API key header    |
      | non-JSON metadata           |
      | accessor metadata           |
      | symbol metadata             |
      | excessive metadata nesting  |
      | changed stored fingerprint  |
      | changed stored origin       |
      | extra descriptor properties |

  Scenario Outline: Stored grants reject operation drift in <part>
    Then credential grants reject operation drift in "<part>" before dispatch
    Examples:
      | part          |
      | origin        |
      | base path     |
      | method        |
      | path          |
      | fields        |
      | response      |
      | header        |

  Scenario: Selected alternatives require all grants and keep node credentials independent
    Then selected alternatives require all grants and keep node credentials independent

  Scenario Outline: Invalid credential bindings reject <case>
    Then credential binding case "<case>" fails before dispatch
    Examples:
      | case                  |
      | wrong fingerprint     |
      | missing alternative   |
      | fractional alternative |
      | anonymous alternative |
      | no security           |
      | missing bindings      |
      | extra binding         |
      | wrong scheme          |
      | missing credential    |
      | duplicate credential  |
      | wrong credential kind |
      | wrong grant scheme    |
      | wrong grant descriptor |
      | empty credential      |
      | padded credential     |
      | newline credential    |
      | oversized credential  |
      | public auth collision |
      | public alternate collision |
      | duplicate public headers |
      | unsupported public header |
      | path value traversal  |
      | path value separator  |
      | unresolved path       |

  Scenario: Public field validation preserves safe field identity and diagnostics
    Then credential execution preserves sanitized public field validation errors

  @explicit-input-values
  Scenario: Credentialed nullable inputs retain presence and validation
    Then credentialed requests distinguish omitted null and literal null inputs before dispatch

  Scenario Outline: Credentialed request bodies preserve <media>
    Then credentialed requests preserve "<media>" body serialization
    Examples:
      | media                               |
      | application/json                    |
      | text/plain                          |
      | application/x-www-form-urlencoded    |
      | multipart/form-data                 |

  Scenario: Response echoes split across decoded chunks are removed from previews and results
    Then credential echoes split across chunks are removed from previews and results

  Scenario: JSON response strings and keys are sanitized after decoding
    Then credentialed JSON responses sanitize nested strings and keys

  Scenario: Redaction cannot reproduce credentials through markers or joined fragments
    Then credential redaction removes marker values and newly joined secret fragments

  Scenario Outline: HTTP response semantics preserve <case>
    Then credentialed response case "<case>" preserves safe HTTP semantics
    Examples:
      | case                    |
      | JSON success            |
      | plain text success      |
      | declared JSON success   |
      | untyped JSON success    |
      | no content              |
      | reset content           |
      | HEAD                    |
      | empty OPTIONS           |
      | bodyless text           |
      | JSON HTTP error         |
      | text HTTP error         |
      | untyped HTTP error      |
      | malformed error JSON    |
      | malformed success JSON  |

  Scenario Outline: Cancellation and current-policy checks stop <case>
    Then credential execution stops "<case>" without accepting stale results
    Examples:
      | case                  |
      | before dispatch       |
      | while fetching        |
      | while streaming       |
      | policy before send    |
      | policy before accept  |
      | timed out             |
      | transport failure     |
      | response read failure |
      | redirected response   |

  Scenario Outline: Decoded response size is bounded despite <case>
    Then credential response limit handles "<case>" before fully buffering
    Examples:
      | case                       |
      | absent Content-Length      |
      | false Content-Length       |
      | multibyte decoded content  |
      | endless chunks             |

  Scenario Outline: Real loopback requests reject <kind> redirects before a second dispatch
    Then real credentialed requests reject "<kind>" redirects before a second dispatch
    Examples:
      | kind         |
      | same-origin  |
      | cross-origin |
