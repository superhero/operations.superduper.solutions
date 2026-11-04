Feature: Verified local model storage
  Scenario: Verified model files reject corrupt ranges cancellation and quota failures
    Then model installation verifies complete bytes and cleans failed partial downloads
  Scenario: Stored models coordinate tabs shared files and owner death
    Then model file leases protect logical use and shared assets across tabs
  Scenario: Model storage stays lazy and uses cached files in a fresh worker
    Then saved model files and local image bytes load without publisher requests
