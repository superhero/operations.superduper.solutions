"""Offline Gitflow policy and merge-race regression tests.

Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
"""

import json
import unittest

import test_release_automation as harness


API = harness.API
SHA = harness.SHA
BASE_SHA = "c" * 40
REPOSITORY = harness.REPOSITORY
get = harness.get
TAGS = f"{API}/tags?per_page=100"
BRANCHES = f"{API}/git/matching-refs/heads/"
CLOSED_PULLS = f"{API}/pulls?state=closed&base=main&per_page=100"

MERGE_MOCK = '''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

work = Path(__file__).resolve().parent
args = sys.argv[1:]
if args[:1] == ["api"]:
    os.execv(str(work / "gh-api"), [str(work / "gh-api"), *args])
(work / "merge.json").write_text(json.dumps(args))
if args != json.loads((work / "expected-merge.json").read_text()):
    sys.exit("Unexpected merge command: " + str(args))
if (work / "merge-error").exists():
    sys.exit("gh: Pull request is not mergeable")
'''


class GitflowPolicyTests(unittest.TestCase):
    execute = harness.ReleaseAutomationTests.execute

    def setUp(self):
        harness.ReleaseAutomationTests.setUp(self)
        (self.work / "gh").rename(self.work / "gh-api")
        gh = self.work / "gh"
        gh.write_text(MERGE_MOCK)
        gh.chmod(0o755)
        self.merge_log = self.work / "merge.json"
        self.merge_command = ["pr", "merge", "123", "--repo", REPOSITORY,
                              "--auto", "--merge", "--match-head-commit", SHA]
        (self.work / "expected-merge.json").write_text(json.dumps(self.merge_command))

    def validate(self, head, base, responses=None, success=True):
        result = self.execute("validate-pr.sh", [REPOSITORY, head, base, SHA], responses or [], success)
        if not success:
            for context in (REPOSITORY, head, base, SHA):
                self.assertIn(context, result.stderr)
        return result

    def version_prefix(self, tags=(), branches=()):
        return [get(TAGS, [{"name": name} for name in tags]),
                get(CLOSED_PULLS, []),
                get(BRANCHES, [{"ref": "refs/heads/" + branch} for branch in branches])]

    def merged_version(self, branch="release/1.2.3"):
        return {"merged_at": "2026-10-04T16:24:20Z", "merge_commit_sha": BASE_SHA,
                "head": {"ref": branch, "repo": {"full_name": REPOSITORY}}}

    def merge(self, responses, success=True, base="develop"):
        result = self.execute("auto-merge.sh", [REPOSITORY, "123", SHA, base, BASE_SHA], responses, success)
        if success:
            self.assertEqual(json.loads(self.merge_log.read_text()), self.merge_command)
        else:
            self.assertFalse(self.merge_log.exists())
            for context in (REPOSITORY, "PR #123", SHA, base, BASE_SHA):
                self.assertIn(context, result.stderr)
        return result

    def pull_request(self, base="develop"):
        return {"state": "open", "draft": False, "base": {"ref": base, "sha": BASE_SHA},
                "head": {"sha": SHA, "repo": {"full_name": REPOSITORY}}}

    def test_all_allowed_branch_directions(self):
        for head, base in (("feature/name", "develop"), ("bugfix/name", "develop"),
                           ("main", "develop"), ("release/1.0.0", "develop"),
                           ("hotfix/1.0.0", "develop"), ("release/1.0.0", "main"),
                           ("hotfix/1.0.0", "main"), ("hotfix/1.0.0", "release/2.0.0"),
                           ("hotfix/1.0.0", "support/1.x")):
            with self.subTest(head=head, base=base):
                responses = self.version_prefix() if head.startswith(("release/", "hotfix/")) else []
                if base == "main":
                    responses.append(get(f"{API}/compare/main...{SHA}", {"behind_by": 0}))
                self.validate(head, base, responses)

    def test_disallowed_branch_directions_do_not_query_github(self):
        for head, base in (("develop", "main"), ("feature/name", "main"), ("bugfix/name", "main"),
                           ("support/1.x", "develop"), ("release/1.0.0", "release/2.0.0"),
                           ("feature/name", "support/1.x"), ("main", "support/1.x"),
                           ("hotfix/1.0.0", "feature/name"), ("other", "develop")):
            with self.subTest(head=head, base=base):
                result = self.validate(head, base, success=False)
                self.assertIn("may not merge", result.stderr)

    def test_strict_unprefixed_semver(self):
        for version in ("01.2.3", "1.02.3", "1.2.03", "v1.2.3", "1.2.3-rc.1", "1.2", "1.2.3/extra"):
            with self.subTest(version=version):
                result = self.validate("release/" + version, "main", success=False)
                self.assertIn("SemVer", result.stderr)
        for version in ("0.0.0", "1.2.3", "10.20.30"):
            with self.subTest(version=version):
                self.execute("validate-semver.sh", [version], [])

    def test_invalid_head_sha_reports_selected_arguments(self):
        result = self.execute("validate-pr.sh", [REPOSITORY, "release/1.2.3", "main", "bad-sha"], [], False)
        for context in (REPOSITORY, "release/1.2.3", "main", "bad-sha", "Usage:", "40-character head SHA"):
            self.assertIn(context, result.stderr)

    def test_existing_tag_cannot_be_released_again(self):
        result = self.validate("release/1.2.3", "main", [get(TAGS, [{"name": "1.2.3"}])], False)
        self.assertIn("already exists", result.stderr)

    def test_tagged_release_and_hotfix_can_sync_to_develop(self):
        for kind in ("release", "hotfix"):
            with self.subTest(kind=kind):
                self.validate(f"{kind}/1.2.3", "develop", [get(TAGS, [{"name": "1.2.3"}]),
                    get(f"{API}/compare/{SHA}...1.2.3", {"behind_by": 0})])

    def test_tagged_branch_with_unreleased_changes_cannot_bypass_policy(self):
        result = self.validate("release/1.2.3", "develop", [get(TAGS, [{"name": "1.2.3"}]),
            get(f"{API}/compare/{SHA}...1.2.3", {"behind_by": 1})], False)
        self.assertIn("outside its released version", result.stderr)

    def test_merged_version_remains_reserved_before_tagging_and_after_branch_deletion(self):
        for head, base in (("release/1.2.3", "main"), ("hotfix/1.2.3", "main"),
                           ("hotfix/1.2.3", "release/1.3.0"), ("hotfix/1.2.3", "support/1.x")):
            with self.subTest(head=head, base=base):
                result = self.validate(head, base, [get(TAGS, []),
                    get(CLOSED_PULLS, pages=[[], [self.merged_version()]])], False)
                self.assertIn("already exists", result.stderr)

    def test_pending_tag_allows_only_changes_contained_in_recorded_merge_to_sync(self):
        for kind in ("release", "hotfix"):
            for behind in (0, 1):
                with self.subTest(kind=kind, behind=behind):
                    branch = f"{kind}/1.2.3"
                    self.validate(branch, "develop", [get(TAGS, []),
                        get(CLOSED_PULLS, [self.merged_version(branch)]),
                        get(f"{API}/compare/{SHA}...{BASE_SHA}", {"behind_by": behind})], behind == 0)

    def test_unrelated_or_unmerged_prs_do_not_reserve_version(self):
        foreign = self.merged_version()
        foreign["head"]["repo"]["full_name"] = "other/repository"
        unmerged = {**self.merged_version(), "merged_at": None}
        self.validate("release/1.2.3", "develop", [get(TAGS, []),
            get(CLOSED_PULLS, [self.merged_version("release/1.2.2"), foreign, unmerged]),
            get(BRANCHES, [])])

    def test_ambiguous_or_missing_merge_commit_fails_closed(self):
        for pulls in ([{**self.merged_version(), "merge_commit_sha": None}],
                      [self.merged_version(), self.merged_version("hotfix/1.2.3")]):
            with self.subTest(pulls=pulls):
                self.validate("release/1.2.3", "develop", [get(TAGS, []), get(CLOSED_PULLS, pulls)], False)

    def test_one_active_branch_per_kind(self):
        for kind in ("release", "hotfix"):
            with self.subTest(kind=kind):
                result = self.validate(f"{kind}/1.2.3", "develop",
                    self.version_prefix(branches=[f"{kind}/1.2.3", f"{kind}/1.3.0"]), False)
                self.assertIn("Conflicting active", result.stderr)

    def test_old_tagged_branches_are_not_active(self):
        self.validate("release/1.2.3", "develop",
                      self.version_prefix(tags=["1.2.2"], branches=["release/1.2.2", "release/1.2.3"]))

    def test_release_and_hotfix_cannot_reserve_same_version(self):
        for head, other in (("release/1.2.3", "hotfix/1.2.3"), ("hotfix/1.2.3", "release/1.2.3")):
            with self.subTest(head=head):
                self.validate(head, "develop", self.version_prefix(branches=[other]), False)

    def test_release_and_hotfix_can_have_different_active_versions(self):
        self.validate("release/1.3.0", "develop", self.version_prefix(branches=["hotfix/1.2.3"]))

    def test_paginated_branch_and_tag_lists(self):
        self.validate("release/1.2.3", "develop", [
            get(TAGS, pages=[[], [{"name": "1.2.2"}]]),
            get(CLOSED_PULLS, []),
            get(BRANCHES, pages=[[], [{"ref": "refs/heads/release/1.2.2"}]]),
        ])

    def test_hotfix_uses_latest_tag_reachable_from_target_line(self):
        self.validate("hotfix/1.2.10", "support/1.x", self.version_prefix(tags=["1.2.8", "2.0.0", "1.2.9"]) + [
            get(f"{API}/compare/2.0.0...support/1.x", {"behind_by": 3}),
            get(f"{API}/compare/1.2.9...support/1.x", {"behind_by": 0}),
        ])

    def test_hotfix_must_increment_patch_only(self):
        for version in ("1.3.0", "2.0.0", "1.2.11"):
            with self.subTest(version=version):
                result = self.validate("hotfix/" + version, "release/1.3.0", self.version_prefix(tags=["1.2.9"]) + [
                    get(f"{API}/compare/1.2.9...release/1.3.0", {"behind_by": 0}),
                ], False)
                self.assertIn("expected '1.2.10'", result.stderr)

    def test_main_must_be_contained_in_release_artifact_head(self):
        result = self.validate("release/1.2.3", "main", self.version_prefix() + [
            get(f"{API}/compare/main...{SHA}", {"behind_by": 1}),
        ], False)
        self.assertIn("must include current main", result.stderr)

    def test_api_errors_fail_closed_at_every_policy_lookup(self):
        fixtures = self.version_prefix(tags=["1.2.2"]) + [
            get(f"{API}/compare/main...{SHA}", {"behind_by": 0}),
            get(f"{API}/compare/1.2.2...main", {"behind_by": 0}),
        ]
        operations = ["list repository tags", "inspect closed main PRs", "list repository branches",
                      f"compare main...{SHA}", "compare 1.2.2...main"]
        for index in range(len(fixtures)):
            with self.subTest(endpoint=fixtures[index]["endpoint"]):
                result = self.validate("hotfix/1.2.3", "main",
                                       fixtures[:index] + [{**fixtures[index], "exit_code": 1}], False)
                self.assertIn(operations[index], result.stderr)
        result = self.validate("release/1.2.3", "develop", [get(TAGS, [{"name": "1.2.3"}]),
            get(f"{API}/compare/{SHA}...1.2.3", exit_code=1)], False)
        self.assertIn(f"Could not compare {SHA}...1.2.3", result.stderr)

    def test_auto_merge_preserves_exact_head_requirement(self):
        self.merge([get(f"{API}/pulls/123", self.pull_request())])

    def test_auto_merge_rechecks_main_immediately_before_merge(self):
        self.merge([get(f"{API}/pulls/123", self.pull_request("main")),
                    get(f"{API}/compare/main...{SHA}", {"behind_by": 0})], base="main")

    def test_auto_merge_rejects_new_main_commits(self):
        result = self.merge([get(f"{API}/pulls/123", self.pull_request("main")),
                            get(f"{API}/compare/main...{SHA}", {"behind_by": 1})], False, base="main")
        self.assertIn("Main changed", result.stderr)
        self.assertIn("behind_by=1", result.stderr)

    def test_auto_merge_rejects_retargeted_pr(self):
        for validated_base, actual_base in (("develop", "main"), ("main", "develop")):
            with self.subTest(validated_base=validated_base, actual_base=actual_base):
                result = self.merge([get(f"{API}/pulls/123", self.pull_request(actual_base))],
                                    False, base=validated_base)
                self.assertIn(f"Base branch changed: expected {validated_base}, found {actual_base}", result.stderr)

    def test_auto_merge_rejects_changed_base_commits(self):
        for base in ("develop", "main", "release/1.3.0", "support/1.x"):
            with self.subTest(base=base):
                pr = self.pull_request(base)
                pr["base"]["sha"] = harness.OTHER_SHA
                result = self.merge([get(f"{API}/pulls/123", pr)], False, base=base)
                self.assertIn("base changed; update the branch and rerun CI", result.stderr)
                self.assertIn(f"Expected {BASE_SHA}, found {harness.OTHER_SHA}", result.stderr)

    def test_auto_merge_rejects_closed_draft_or_changed_heads(self):
        for change, reason in (
            ({"state": "closed"}, "State is closed; expected open"),
            ({"draft": True}, "Draft status is true; expected false"),
            ({"head": {"sha": harness.OTHER_SHA, "repo": {"full_name": REPOSITORY}}},
             f"Head changed: expected {SHA}, found {harness.OTHER_SHA}"),
            ({"head": {"sha": SHA, "repo": {"full_name": "other/repository"}}},
             f"Head repository is other/repository; expected {REPOSITORY}"),
        ):
            with self.subTest(change=change):
                pr = {**self.pull_request(), **change}
                result = self.merge([get(f"{API}/pulls/123", pr)], False)
                self.assertIn(reason, result.stderr)

    def test_auto_merge_api_errors_never_merge(self):
        result = self.merge([get(f"{API}/pulls/123", exit_code=1)], False)
        self.assertIn("Could not read current pull request state", result.stderr)
        result = self.merge([get(f"{API}/pulls/123", self.pull_request("main")),
                            get(f"{API}/compare/main...{SHA}", exit_code=1)], False, base="main")
        self.assertIn(f"Could not compare main...{SHA} before merging", result.stderr)
        (self.work / "merge-error").touch()
        result = self.execute("auto-merge.sh", [REPOSITORY, "123", SHA, "develop", BASE_SHA],
                              [get(f"{API}/pulls/123", self.pull_request())], False)
        self.assertIn("gh: Pull request is not mergeable", result.stderr)
        self.assertIn("GitHub could not merge the validated pull request", result.stderr)
        for context in (REPOSITORY, "PR #123", SHA, "develop", BASE_SHA):
            self.assertIn(context, result.stderr)


if __name__ == "__main__":
    unittest.main()
