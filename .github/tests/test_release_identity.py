# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
"""Resolve release identity from a pushed commit using offline GitHub fixtures."""

import unittest

import test_release_automation as harness


MERGE_SHA = "c" * 40
ENDPOINT = f"{harness.API}/commits/{MERGE_SHA}/pulls?per_page=100"


def release_pr(branch="release/0.0.25", number=124):
    pr = harness.merged_release(branch)
    pr["number"] = number
    pr["merge_commit_sha"] = MERGE_SHA
    pr["base"]["repo"] = {"full_name": harness.REPOSITORY}
    return pr


class ReleaseIdentityTests(unittest.TestCase):
    # Delegate fixture operations without inheriting or rediscovering its tests.
    setUp = harness.ReleaseAutomationTests.setUp
    execute = harness.ReleaseAutomationTests.execute
    calls = harness.ReleaseAutomationTests.calls
    assert_context = harness.ReleaseAutomationTests.assert_context

    def select(self, responses, success=True, merge_sha=MERGE_SHA):
        self.output.write_text("")
        result = self.execute("find-release-pr.sh", [harness.REPOSITORY, merge_sha],
                              responses, success)
        if not success:
            self.assertEqual(self.output.read_text(), "")
            self.assert_context(result, merge_sha=merge_sha)
        return result

    def test_release_and_hotfix_emit_only_validated_identity(self):
        for branch in ["release/0.0.25", "hotfix/0.0.25"]:
            with self.subTest(branch=branch):
                self.select([harness.get(ENDPOINT, [release_pr(branch)])])
                self.assertEqual(self.output.read_text(),
                                 f"pr_number=124\nhead_branch={branch}\nhead_sha={harness.SHA}\n")
                self.assertTrue(all(call["method"] == "GET" for call in self.calls()))

    def test_develop_trigger_at_same_merge_sha_is_ignored(self):
        trigger = release_pr("develop", 123)
        self.select([harness.get(ENDPOINT, [trigger, release_pr()])])
        self.assertIn("pr_number=124\n", self.output.read_text())

    def test_identity_mismatches_cannot_supply_release_context(self):
        changes = [
            (("merge_commit_sha",), harness.OTHER_SHA),
            (("base", "ref"), "develop"),
            (("base", "repo", "full_name"), "another/repository"),
            (("head", "repo", "full_name"), "another/repository"),
            (("state",), "open"),
            (("merged_at",), None),
            (("merged_at",), ""),
            (("head", "ref"), "develop"),
            (("head", "ref"), "feature/change"),
        ]
        for path, value in changes:
            with self.subTest(path=path, value=value):
                pr = release_pr()
                target = pr
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = value
                result = self.select([harness.get(ENDPOINT, [pr])], False)
                self.assertIn("found 0", result.stderr)

    def test_ambiguous_release_identity_is_rejected(self):
        result = self.select([harness.get(ENDPOINT, [
            release_pr(), release_pr("hotfix/0.0.26", 125),
        ])], False)
        self.assertIn("found 2", result.stderr)
        self.assertIn("#124 release/0.0.25", result.stderr)
        self.assertIn("#125 hotfix/0.0.26", result.stderr)

    def test_later_pages_are_considered(self):
        self.select([harness.get(ENDPOINT, pages=[[], [release_pr("develop", 123)], [release_pr()]])])
        self.assertIn("pr_number=124\n", self.output.read_text())

    def test_empty_associations_fail_closed(self):
        result = self.select([harness.get(ENDPOINT, [])], False)
        self.assertIn("found 0", result.stderr)

    def test_api_failure_preserves_native_reason_and_commit_context(self):
        result = self.select([harness.get(ENDPOINT, exit_code=1, stderr="gh: HTTP 403\n")], False)
        self.assertIn("gh: HTTP 403", result.stderr)
        self.assertIn("Could not list pull requests associated with the pushed merge commit", result.stderr)

    def test_malformed_pr_numbers_are_rejected(self):
        for number in [0, -1, 1.5, "124", "invalid", None]:
            with self.subTest(number=number):
                result = self.select([harness.get(ENDPOINT, [release_pr(number=number)])], False)
                self.assertIn("must be a positive integer", result.stderr)

    def test_malformed_head_shas_are_rejected(self):
        for sha in ["", "abc123", "A" * 40, "g" * 40, None, f"{harness.SHA}\ninjected=value"]:
            with self.subTest(sha=sha):
                pr = release_pr()
                pr["head"]["sha"] = sha
                result = self.select([harness.get(ENDPOINT, [pr])], False)
                self.assertIn("invalid head SHA", result.stderr)

    def test_noncanonical_versions_are_rejected(self):
        for version in ["", "01.2.3", "1.02.3", "1.2.03", "v1.2.3", "1.2.3-rc.1", "1.2.3\ninjected=value"]:
            with self.subTest(version=version):
                result = self.select([harness.get(ENDPOINT, [release_pr(f"release/{version}")])], False)
                self.assertIn("invalid release version", result.stderr)

    def test_malformed_input_merge_sha_is_rejected_without_api_call(self):
        for sha in ["", "abc123", "A" * 40, "g" * 40]:
            with self.subTest(sha=sha):
                result = self.select([], False, merge_sha=sha)
                self.assertIn("Merge SHA must contain 40 lowercase hexadecimal characters", result.stderr)


if __name__ == "__main__":
    unittest.main()
