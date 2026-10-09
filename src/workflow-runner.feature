# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Step through workflow requests with explicit test responses
  Scenario: Inject HTTP execution for transport tests
    Then the injectable HTTP executor sends catalog requests and maps actual responses

  Scenario: Failed requests remain retryable without producing outputs
    Then workflow request failures explain network server and response problems and allow retry

  Scenario: Cancel an in-flight operation
    Then ending a workflow aborts pending requests and prevents late results from continuing the run

  Scenario: Choose a starting operation without running disconnected branches
    Then workflow runs offer starting choices and end without contacting a service

  Scenario: Connected fields carry actual demo results between operations
    Then workflow runs validate inputs and pass created task identifiers to later operations

  Scenario: Every workflow run has independent local data
    Then workflow demo state is isolated and operations enforce their documented constraints

  Scenario: Switch and Cast route connected values
    Then workflow switches select the first matching gate and casts prepare the next operation input

  Scenario: Mapped Switch operands and inactive branches
    Then connected switch operands and inactive branches determine which operations run

  Scenario: A saved workflow executes its embedded snapshot
    Then nested workflow runs import inputs and export results without changing their saved snapshots

  Scenario: Multiple consumers and conflicting inputs
    Then workflow output fanout runs each consumer and conflicting contributions fail clearly

  Scenario: Invalid runtime connections and cycles
    Then unavailable operations invalid mapped values and workflow cycles stop with useful errors

  Scenario: Legacy workflows remain runnable
    Then legacy workflow connections advance operations and cancellation ends the run

  Scenario: Response schemas preserve missing values and scalar response bodies
    Then workflow response mappings support optional values scalar bodies and success status ranges

  Scenario: An inactive operand does not disable the remaining Switch gates
    Then inactive switch operands preserve active gates and missing main values are explained

  Scenario: A long workflow stops at the execution step limit
    Then workflow runs stop after two hundred operations without sending another request

  Scenario: Example catalogs select isolated mock execution or live HTTP execution
    Then mock examples cover every method without network traffic and live examples use their registered origin

  Scenario: HTTP requests preserve media types parameters and empty responses
    Then HTTP examples serialize JSON text forms headers and repeated query values correctly

  Scenario: Structured workflow mappings retain their schema types
    Then structured values root bodies and nested fields flow between example operations

  Scenario: Structured mappings reject incompatible or conflicting values
    Then invalid structured connections stop before the next request
