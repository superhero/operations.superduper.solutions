# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@operation-security
Feature: OpenAPI authentication requirements
  Imported operations describe supported credentials without granting permission to use them.

  Scenario: Credential permission metadata cannot bypass canonical security validation
    Then credential permission metadata is validated at schema loading and private approval

  Scenario: Unsupported choices keep original positions without disabling supported choices
    Then unavailable HTTP choices retain source indices AND members and explicit anonymous alternatives

  Scenario: An unavailable signer cannot become a plain API-key request
    Then unsupported signing stays unavailable beside a supported credential alternative

  Scenario Outline: A malformed mixed authentication declaration stays fail closed for <kind>
    Then a malformed mixed authentication choice "<kind>" still rejects the complete operation
    Examples:
      | kind                  |
      | undeclared scheme     |
      | nonempty scopes       |
      | invalid alternative   |
      | missing scheme        |
      | invalid HTTP token    |
      | unknown scheme fields |
      | invalid description   |
      | duplicate headers     |
      | duplicate queries     |

  Scenario Outline: Effective authentication preserves <case>
    Given root authentication <root> and operation authentication <operation>
    Then normalized authentication is <expected> and credentials are <required>

    Examples:
      | case                         | root            | operation                               | expected                              | required |
      | absent declarations          | absent          | absent                                  | absent                                | optional |
      | inherited bearer             | [{"Bearer":[]}] | absent                                  | [["Bearer"]]                          | required |
      | inherited anonymous override | []              | absent                                  | []                                    | optional |
      | explicit operation override  | [{"Bearer":[]}] | [{"Key":[]}]                            | [["Key"]]                             | required |
      | removed root authentication  | [{"Bearer":[]}] | []                                      | []                                    | optional |
      | anonymous operation          | [{"Bearer":[]}] | [{}]                                    | [[]]                                  | optional |
      | optional bearer              | absent          | [{"Bearer":[]},{}]                      | [["Bearer"],[]]                       | optional |
      | anonymous first alternative  | absent          | [{},{"Bearer":[]}]                      | [[],["Bearer"]]                       | optional |
      | required combined schemes    | absent          | [{"Bearer":[],"Key":[]}]                | [["Bearer","Key"]]                    | required |
      | alternative combined schemes | absent          | [{"Bearer":[],"Key":[]},{"Backup":[]}]  | [["Bearer","Key"],["Backup"]]         | required |
      | same-header alternatives     | absent          | [{"Key":[]},{"Backup":[]}]              | [["Key"],["Backup"]]                   | required |
      | inherited query API key      | [{"Query":[]}]  | absent                                  | [["Query"]]                           | required |
      | mixed query and header keys  | absent          | [{"Query":[],"Key":[],"Bearer":[]}]      | [["Query","Key","Bearer"]]            | required |
      | case-sensitive query keys    | absent          | [{"Query":[],"UpperQuery":[]}]           | [["Query","UpperQuery"]]              | required |

  Scenario: Supported metadata survives full schema import without changing anonymous operation shapes
    Then schema import preserves supported authentication metadata and anonymous operation shapes

  Scenario: Security declarations remain independent of operation identifiers
    Then reusing an operation identifier does not supply an authentication declaration

  Scenario Outline: Malformed authentication declaration rejects <case>
    Given root authentication <root> and operation authentication <operation>
    Then authentication extraction fails with "<diagnostic>"

    Examples:
      | case                  | root             | operation          | diagnostic                 |
      | null root             | null             | absent             | must be an array           |
      | object root           | {}               | absent             | must be an array           |
      | null override         | [{"Bearer":[]}]  | null               | must be an array           |
      | string override       | absent           | "Bearer"           | must be an array           |
      | null alternative      | absent           | [null]             | expected an object         |
      | array alternative     | absent           | [[]]               | expected an object         |
      | string alternative    | absent           | ["Bearer"]         | expected an object         |
      | blank scheme name     | absent           | [{" ":[]}]         | nonempty strings           |
      | non-array scopes      | absent           | [{"Bearer":null}]  | only empty scope arrays    |
      | bearer scopes         | absent           | [{"Bearer":["a"]}] | only empty scope arrays    |
      | API-key scopes        | absent           | [{"Key":["role"]}] | only empty scope arrays    |
      | undeclared scheme     | absent           | [{"Unknown":[]}]   | without a declared scheme  |
      | inherited object key  | absent           | [{"constructor":[]}] | without a declared scheme |

  Scenario Outline: Unsupported or malformed security scheme rejects <case>
    Given authentication scheme <definition>
    Then authentication extraction fails with "<diagnostic>"

    Examples:
      | case                 | definition                                           | diagnostic                         |
      | null definition      | null                                                 | expected an object                 |
      | array definition     | []                                                   | expected an object                 |
      | string definition    | "Bearer"                                             | expected an object                 |
      | absent type          | {}                                                   | only HTTP bearer and header        |
      | OAuth2               | {"type":"oauth2","flows":{}}                          | only HTTP bearer and header        |
      | OpenID Connect       | {"type":"openIdConnect","openIdConnectUrl":"https://api.example.test"} | only HTTP bearer and header |
      | mutual TLS           | {"type":"mutualTLS"}                                 | only HTTP bearer and header        |
      | HTTP basic           | {"type":"http","scheme":"basic"}                     | only HTTP bearer authentication    |
      | missing HTTP scheme  | {"type":"http"}                                      | only HTTP bearer authentication    |
      | invalid bearer hint  | {"type":"http","scheme":"bearer","bearerFormat":4}  | bearerFormat must be a string      |
      | invalid description  | {"type":"http","scheme":"bearer","description":[]}  | description must be a string       |
      | unknown fields       | {"type":"http","scheme":"bearer","flows":{}}        | unsupported security scheme fields |
      | cookie API key       | {"type":"apiKey","in":"cookie","name":"key"}        | only header and query API keys     |
      | missing placement    | {"type":"apiKey","name":"X-Key"}                     | only header and query API keys     |
      | missing query name   | {"type":"apiKey","in":"query"}                       | invalid credential query parameter |
      | empty query name     | {"type":"apiKey","in":"query","name":""}             | invalid credential query parameter |
      | query separator      | {"type":"apiKey","in":"query","name":"key&other"}    | invalid credential query parameter |
      | query assignment     | {"type":"apiKey","in":"query","name":"key=value"}    | invalid credential query parameter |
      | encoded query name   | {"type":"apiKey","in":"query","name":"api%5Fkey"}    | invalid credential query parameter |
      | query whitespace     | {"type":"apiKey","in":"query","name":"api key"}      | invalid credential query parameter |
      | missing header name  | {"type":"apiKey","in":"header"}                     | invalid credential header name     |
      | empty header name    | {"type":"apiKey","in":"header","name":""}           | invalid credential header name     |
      | whitespace in header | {"type":"apiKey","in":"header","name":"X Key"}      | invalid credential header name     |
      | newline in header    | {"type":"apiKey","in":"header","name":"X-Key\\n"}    | invalid credential header name     |

  Scenario Outline: Credential headers cannot control <header>
    Given an API key in header "<header>"
    Then authentication extraction fails with "unsupported credential header"

    Examples:
      | header                         |
      | Accept                         |
      | ACCEPT-CHARSET                 |
      | Accept-Encoding                |
      | Access-Control-Request-Headers |
      | Access-Control-Request-Method  |
      | Connection                     |
      | Content-Length                 |
      | Content-Type                   |
      | Cookie                         |
      | Cookie2                        |
      | Date                           |
      | DNT                            |
      | Expect                         |
      | Host                           |
      | Keep-Alive                     |
      | Origin                         |
      | Referer                        |
      | Set-Cookie                     |
      | TE                             |
      | Trailer                        |
      | Transfer-Encoding              |
      | Upgrade                        |
      | Via                            |
      | Proxy-Authorization            |
      | sEc-Fetch-Site                 |
      | X-HTTP-Method                  |
      | X-HTTP-Method-Override         |
      | X-Method-Override             |

  Scenario Outline: Authentication references reject <case>
    Given authentication scheme <definition>
    Then authentication extraction fails with "<diagnostic>"

    Examples:
      | case                    | definition                                                           | diagnostic                    |
      | non-string references   | {"$ref":5}                                                           | references must be local      |
      | remote references       | {"$ref":"https://api.example.test/security.json"}                     | references must be local      |
      | file references         | {"$ref":"file:///tmp/security.json"}                                 | references must be local      |
      | reference siblings      | {"$ref":"#/components/securitySchemes/Bearer","description":"ignored"} | without sibling fields      |
      | direct cycles           | {"$ref":"#/components/securitySchemes/Test"}                          | cyclic or malformed           |
      | malformed percent       | {"$ref":"#/components/securitySchemes/%zz"}                           | malformed security scheme     |
      | malformed pointer       | {"$ref":"#/components/securitySchemes/a~2b"}                           | cyclic or malformed           |
      | truncated pointer       | {"$ref":"#/components/securitySchemes/a~"}                             | cyclic or malformed           |
      | missing targets         | {"$ref":"#/components/securitySchemes/Missing"}                       | expected an object            |
      | inherited targets       | {"$ref":"#/components/securitySchemes/constructor"}                   | expected an object            |
      | non-object intermediates | {"$ref":"#/openapi/nested"}                                         | expected an object            |

  Scenario: Local authentication references preserve names and decode escaped pointer tokens
    Then local authentication references preserve aliases and resolve escaped pointer tokens

  Scenario: Indirect security reference cycles are rejected
    Then indirect security reference cycles fail without resolving external documents

  Scenario Outline: Incomplete security containers reject <case>
    Given authentication containers <containers>
    Then authentication extraction fails with "<diagnostic>"

    Examples:
      | case                    | containers                            | diagnostic                    |
      | missing components      | {}                                    | without a declared scheme     |
      | missing security schemes | {"components":{}}                    | without a declared scheme     |
      | null components         | {"components":null}                   | expected an object            |
      | array components        | {"components":[]}                     | expected an object            |
      | null security schemes   | {"components":{"securitySchemes":null}} | expected an object          |

  Scenario Outline: Combined schemes reject <case>
    Given root authentication absent and operation authentication <operation>
    Then authentication extraction fails with "duplicate credential header"

    Examples:
      | case                      | operation                       |
      | bearer with API key       | [{"Bearer":[],"Authorization":[]}] |
      | case-insensitive API keys | [{"Key":[],"Backup":[]}]        |

  Scenario: Undefined security values follow the same inheritance as absent declarations
    Then undefined authentication declarations inherit the root requirements

  Scenario: Combined query API keys cannot overwrite the same parameter
    Given root authentication absent and operation authentication [{"Query":[],"QueryAlias":[]}]
    Then authentication extraction fails with "duplicate credential query parameter"
