@component-integration @svelte
Feature: Gherkin component tests preserve Svelte behavior with current browser tooling

  Scenario: Native browser events update state derived values and bindings
    Given the Svelte component-integration component is mounted
    When I increment the component counter
    Then the count is 1 and the multiplied value is 2
    When I fill the component name with "Ada"
    Then the bound name is "Ada"
    When I enable the component checkbox
    Then the bound checkbox value is true

  Scenario: Updating component props preserves local reactive state
    Given the Svelte component-integration component is mounted
    When I increment the component counter
    And I update the component heading to "Welcome" and multiplier to 3
    Then the component heading is "Welcome"
    And the count is 1 and the multiplied value is 3

  Scenario: Awaited locators observe controlled asynchronous updates
    Given the Svelte component-integration component is mounted
    When I fill the component name with "Grace"
    And I start the asynchronous component action
    Then the component is pending and its action is disabled
    When the asynchronous component action resolves
    Then the component status is "ready: Grace" and its action is enabled

  Scenario: Unmount removes markup and event listeners
    Given the Svelte component-integration component is mounted
    When I dispatch the component component-integration event
    Then the component has received 1 component-integration event
    When I unmount the component
    And I dispatch the component component-integration event
    Then the component has received 1 component-integration event
    And the component markup is absent

  Scenario: Native radio bindings update document effects and clean up on unmount
    Given the Svelte component-integration component is mounted
    Then the bound radio choice is "first"
    And the component synchronizes the document title to "Hello · first"
    When I select the component radio option "Second"
    Then the bound radio choice is "second"
    And the component synchronizes the document title to "Hello · second"
    When I update the component heading to "Welcome" and multiplier to 3
    Then the component synchronizes the document title to "Welcome · second"
    When I unmount the component
    Then the original document title is restored

  Scenario: Bidirectional component transitions retain content through reversal
    Given the Svelte component-integration component is mounted
    When I toggle the animated component details
    Then the details enter through a real browser animation
    And the component details finish opening
    When I toggle the animated component details
    Then closing details stay rendered until their transition ends
    When I toggle the animated component details
    Then the same details reopen without losing their content
    When I toggle the animated component details
    Then the closed details leave the document

  Scenario: Unmount cancels pending work and rejects a late result after replacement
    Given the Svelte component-integration component is mounted
    When I fill the component name with "Discarded"
    And I start the asynchronous component action
    Then the component is pending and its action is disabled
    When I unmount the component
    Then the pending component request has been aborted
    When I mount a replacement component
    And the cancelled component action resolves late
    Then the replacement remains idle without publishing the cancelled result
