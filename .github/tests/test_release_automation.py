"""Offline regression tests: every GitHub request must match a queued fixture.

Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
"""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = "superhero/operations.superduper.solutions"
API = f"repos/{REPOSITORY}"
SHA = "a" * 40
OTHER_SHA = "b" * 40
PULLS = f"{API}/pulls?state=all&base=main&per_page=100"
RUNS = f"{API}/actions/workflows/ci-main.yml/runs"

MOCK_GH = r'''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import subprocess
import sys

args = sys.argv[1:]
if not args or args.pop(0) != "api":
    sys.exit("Only mocked gh api requests are permitted")
method, endpoint, query, fields = "GET", None, None, {}
while args:
    arg = args.pop(0)
    if arg == "--method":
        method = args.pop(0)
    elif arg == "--jq":
        query = args.pop(0)
    elif arg in ("-f", "-F"):
        key, value = args.pop(0).split("=", 1)
        fields[key] = value
    elif arg == "--paginate":
        pass
    elif arg.startswith("-"):
        sys.exit("Unsupported gh flag: " + arg)
    elif endpoint is None:
        endpoint = arg
    else:
        sys.exit("Unexpected gh positional argument: " + arg)

path = Path(os.environ["MOCK_QUEUE"])
queue = json.loads(path.read_text())
if not queue:
    sys.exit("Unexpected request: " + str((method, endpoint)))
item = queue.pop(0)
path.write_text(json.dumps(queue))
with Path(os.environ["MOCK_LOG"]).open("a") as log:
    log.write(json.dumps({"method": method, "endpoint": endpoint, "fields": fields}) + "\n")
if (method, endpoint) != (item.get("method", "GET"), item["endpoint"]):
    sys.exit("Request mismatch: " + str((method, endpoint, item)))
for key, value in item.get("fields", {}).items():
    if fields.get(key) != value:
        sys.exit("Field mismatch: " + key)
if item.get("exit_code"):
    sys.stderr.write(item.get("stderr", ""))
    sys.exit(item["exit_code"])
pages = item.get("pages", [item.get("response", {})])
raw = "\n".join(json.dumps(page) for page in pages)
if query:
    result = subprocess.run(["jq", "-r", query], input=raw, text=True, capture_output=True)
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    sys.exit(result.returncode)
print(raw)
'''


def get(endpoint, response=None, **kwargs):
    return {"endpoint": endpoint, "response": response, **kwargs}


def post(endpoint, response=None, **kwargs):
    return get(endpoint, response, method="POST", **kwargs)


def release(state="open", merged=False, legacy=False):
    return {
        "number": 124,
        "state": state,
        "merged_at": "2026-10-04T16:24:20Z" if merged else None,
        "body": (
            f"Automatically created from develop by PR #123 at {SHA}."
            if legacy else f"<!-- release-source:123:{SHA} -->"
        ),
        "head": {"ref": "release/0.0.25", "sha": SHA, "repo": {"full_name": REPOSITORY}},
    }


def source():
    return {
        "state": "open", "draft": False,
        "head": {"ref": "develop", "sha": SHA, "repo": {"full_name": REPOSITORY}},
        "base": {"ref": "main"},
    }


def merged_release(branch="release/0.0.25"):
    pr = release("closed", True)
    pr.update(merged=True, base={"ref": "main"})
    pr["head"]["ref"] = branch
    return pr


def run(run_id=42, branch="release/0.0.25", sha=SHA, prs=None):
    return {
        "id": run_id, "head_branch": branch, "head_sha": sha,
        "head_repository": {"full_name": REPOSITORY},
        "event": "pull_request", "pull_requests": [] if prs is None else prs,
    }


class ReleaseAutomationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.work = Path(self.directory.name)
        self.queue = self.work / "queue.json"
        self.log = self.work / "log.jsonl"
        self.output = self.work / "output"
        self.output.touch()
        gh = self.work / "gh"
        gh.write_text(MOCK_GH)
        gh.chmod(0o755)
        sleep = self.work / "sleep"
        sleep.write_text("#!/bin/sh\nexit 0\n")
        sleep.chmod(0o755)

    def execute(self, script, arguments, responses, success=True):
        self.queue.write_text(json.dumps(responses))
        env = {**os.environ, "PATH": str(self.work) + os.pathsep + os.environ["PATH"],
               "MOCK_QUEUE": str(self.queue), "MOCK_LOG": str(self.log),
               "GITHUB_OUTPUT": str(self.output)}
        # Even an accidental new gh operation encounters the mock, never GitHub.
        result = subprocess.run(["bash", str(ROOT / ".github" / "scripts" / script), *arguments],
                                cwd=self.work, env=env, text=True, capture_output=True, timeout=10)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(self.queue.read_text()), [], result.stdout + result.stderr)
        return result

    def create(self, responses, success=True):
        return self.execute("create-release-pr.sh", [REPOSITORY, "123", SHA], responses, success)

    def find(self, responses, success=True, timeout="0"):
        return self.execute("find-release-ci.sh", [REPOSITORY, "124", SHA, timeout], responses, success)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def assert_context(self, result, **inputs):
        self.assertIn(f"repository={REPOSITORY}", result.stderr)
        for name, value in inputs.items():
            self.assertIn(f"{name}={value}", result.stderr)

    def new_release_prefix(self, tags=None, branches=None):
        return [
            get(PULLS, []), get(f"{API}/pulls/123", source()),
            get(f"{API}/compare/main...{SHA}", {"ahead_by": 2, "behind_by": 0}),
            get(f"{API}/tags?per_page=100", [{"name": "0.0.24"}] if tags is None else tags),
            get(f"{API}/git/matching-refs/heads/", [] if branches is None else branches),
        ]

    def test_create_release_preserves_identity_without_posting_comments(self):
        self.create(self.new_release_prefix() + [
            post(f"{API}/git/refs", fields={"ref": "refs/heads/release/0.0.25", "sha": SHA}),
            post(f"{API}/pulls", {"number": 124}, fields={"head": "release/0.0.25", "base": "main"}),
        ])
        self.assertFalse(any("/comments" in call["endpoint"] for call in self.calls()))
        self.assertIn(f"<!-- release-source:123:{SHA} -->", self.calls()[6]["fields"]["body"])
        self.assertEqual(self.output.read_text(), "version=0.0.25\nrelease_pr=124\n")

    def test_retry_reuses_open_release_without_allocating_version(self):
        self.create([get(PULLS, [release()])])
        self.assertEqual(self.output.read_text(), "version=0.0.25\nrelease_pr=124\n")
        self.assertTrue(all(call["method"] == "GET" for call in self.calls()))

    def test_retry_after_merge_reuses_legacy_release_on_later_page(self):
        self.create([
            get(PULLS, pages=[[], [release("closed", True, legacy=True)]]),
        ])
        self.assertIn("version=0.0.25", self.output.read_text())
        self.assertTrue(all(call["method"] == "GET" for call in self.calls()))

    def test_retry_reuses_release_after_its_head_has_advanced(self):
        pr = release()
        pr["head"]["sha"] = OTHER_SHA
        self.create([get(PULLS, [pr])])
        self.assertIn("release_pr=124", self.output.read_text())
        self.assertEqual(len(self.calls()), 1)

    def test_release_cannot_take_version_reserved_by_hotfix(self):
        result = self.create(self.new_release_prefix(branches=[{
            "ref": "refs/heads/hotfix/0.0.25", "object": {"sha": OTHER_SHA},
        }]), False)
        self.assertIn("reserved by an active hotfix", result.stderr)
        self.assertTrue(all(call["method"] == "GET" for call in self.calls()))

    def test_closed_unmerged_release_requires_reopening(self):
        result = self.create([get(PULLS, [release("closed")])], False)
        self.assertIn("reopen", result.stderr)
        self.assertIn("PR #124 (release/0.0.25)", result.stderr)
        self.assert_context(result, source_pr=123, source_sha=SHA)

    def test_duplicate_release_identity_reports_source_context(self):
        duplicate = release()
        duplicate["number"] = 125
        result = self.create([get(PULLS, [release(), duplicate])], False)
        self.assertIn("Multiple releases match this source", result.stderr)
        self.assert_context(result, source_pr=123, source_sha=SHA)

    def test_stale_closed_or_changed_trigger_never_creates_branch(self):
        for field, value in (("state", "closed"), ("draft", True)):
            with self.subTest(field=field):
                pr = source()
                pr[field] = value
                result = self.create([get(PULLS, []), get(f"{API}/pulls/123", pr)], False)
                self.assertIn("Release trigger", result.stderr)
                self.assertIn(f"{field}={str(value).lower()}", result.stderr)
                self.assert_context(result, source_pr=123, source_sha=SHA)

    def test_changed_source_sha_never_creates_branch(self):
        pr = source()
        pr["head"]["sha"] = OTHER_SHA
        result = self.create([get(PULLS, []), get(f"{API}/pulls/123", pr)], False)
        self.assertIn("no longer matches", result.stderr)
        self.assertIn(f"develop@{OTHER_SHA}", result.stderr)
        self.assert_context(result, source_pr=123, source_sha=SHA)

    def test_source_already_released_has_no_side_effects(self):
        result = self.create([
            get(PULLS, []), get(f"{API}/pulls/123", source()),
            get(f"{API}/compare/main...{SHA}", {"ahead_by": 0, "behind_by": 0}),
        ], False)
        self.assertIn("unreleased changes", result.stderr)
        self.assertIn("expected ahead_by>0 behind_by=0, actual ahead_by=0 behind_by=0", result.stderr)
        self.assert_context(result, source_pr=123, source_sha=SHA)

    def test_first_release_with_no_tags(self):
        self.create(self.new_release_prefix(tags=[]) + [
            post(f"{API}/git/refs", fields={"ref": "refs/heads/release/0.0.1"}),
            post(f"{API}/pulls", {"number": 124}),
        ])
        self.assertIn("version=0.0.1", self.output.read_text())

    def test_retry_after_branch_creation_reuses_matching_branch(self):
        self.create(self.new_release_prefix(branches=[{
            "ref": "refs/heads/release/0.0.25", "object": {"sha": SHA},
        }]) + [post(f"{API}/pulls", {"number": 124})])
        self.assertFalse(any(call["endpoint"] == f"{API}/git/refs" for call in self.calls()))

    def test_conflicting_branch_never_creates_pr(self):
        result = self.create(self.new_release_prefix(branches=[{
            "ref": "refs/heads/release/0.0.25", "object": {"sha": OTHER_SHA},
        }]), False)
        self.assertIn("different commit", result.stderr)
        self.assertIn("release/0.0.25", result.stderr)
        self.assert_context(result, source_pr=123, source_sha=SHA,
                            expected_sha=SHA, actual_sha=OTHER_SHA)

    def test_other_active_release_is_rejected(self):
        other = release()
        other["body"] = "Different trigger"
        result = self.create([
            get(PULLS, [other]), get(f"{API}/pulls/123", source()),
            get(f"{API}/compare/main...{SHA}", {"ahead_by": 1, "behind_by": 0}),
        ], False)
        self.assertIn("Another release is active", result.stderr)

    def test_untagged_orphan_release_branch_is_rejected(self):
        result = self.create(self.new_release_prefix(branches=[{
            "ref": "refs/heads/release/1.0.0", "object": {"sha": OTHER_SHA},
        }]), False)
        self.assertIn("Another untagged release branch", result.stderr)

    def test_github_error_is_not_treated_as_an_empty_release_list(self):
        result = self.create([get(PULLS, exit_code=1, stderr="gh: HTTP 503\n")], False)
        self.assertIn("gh: HTTP 503", result.stderr)
        self.assertIn("Could not list pull requests targeting main", result.stderr)
        self.assert_context(result, source_pr=123, source_sha=SHA)
        self.assertEqual(self.output.read_text(), "")

    def test_release_api_errors_identify_operation_and_source(self):
        responses = self.new_release_prefix() + [
            post(f"{API}/git/refs"), post(f"{API}/pulls", {"number": 124}),
        ]
        operations = [
            (1, "Could not read source PR"),
            (2, f"Could not compare main...{SHA}"),
            (3, "Could not list version tags"),
            (4, "Could not list branches before creating release/0.0.25"),
            (5, f"Could not create release/0.0.25 at {SHA}"),
            (6, "Could not open release PR release/0.0.25 -> main for version 0.0.25"),
        ]
        for index, operation in operations:
            with self.subTest(operation=operation):
                failure = {**responses[index], "exit_code": 1, "stderr": "gh: HTTP 503\n"}
                result = self.create(responses[:index] + [failure], False)
                self.assertIn("gh: HTTP 503", result.stderr)
                self.assertIn(operation, result.stderr)
                self.assert_context(result, source_pr=123, source_sha=SHA)
                self.assertEqual(self.output.read_text(), "")

    def ci_prefix(self, runs=None, branch="release/0.0.25"):
        return [get(f"{API}/pulls/124", merged_release(branch)),
                get(RUNS, {"workflow_runs": [run(branch=branch)] if runs is None else runs},
                    fields={"head_sha": SHA, "branch": branch, "event": "pull_request"})]

    def artifacts(self, missing=None, expired=None):
        return {"artifacts": [{"name": name, "expired": name == expired}
                              for name in ("bundle", "coverage", "coverage-status") if name != missing]}

    def test_waits_for_ci_instead_of_failing_while_report_uploads(self):
        self.find(self.ci_prefix() + [
            get(f"{API}/actions/runs/42", {"status": "in_progress", "conclusion": None}),
            get(f"{API}/actions/runs/42", {"status": "completed", "conclusion": "success"}),
            get(f"{API}/actions/runs/42/artifacts?per_page=100", self.artifacts()),
        ], timeout="30")
        self.assertEqual(self.output.read_text(), "run_id=42\n")

    def test_ignores_develop_same_sha_wrong_sha_and_wrong_pr(self):
        self.find(self.ci_prefix([
            run(), run(43, branch="develop"), run(44, sha=OTHER_SHA), run(45, prs=[{"number": 999}]),
        ]) + [
            get(f"{API}/actions/runs/42", {"status": "completed", "conclusion": "success"}),
            get(f"{API}/actions/runs/42/artifacts?per_page=100", self.artifacts()),
        ])
        self.assertEqual(self.output.read_text(), "run_id=42\n")

    def test_hotfix_uses_its_own_validated_artifacts(self):
        self.find(self.ci_prefix(branch="hotfix/0.0.25") + [
            get(f"{API}/actions/runs/42", {"status": "completed", "conclusion": "success"}),
            get(f"{API}/actions/runs/42/artifacts?per_page=100", self.artifacts()),
        ])

    def test_waits_when_run_is_not_visible_yet_and_handles_paginated_artifacts(self):
        self.find(self.ci_prefix([]) + [
            get(RUNS, pages=[{"workflow_runs": []}, {"workflow_runs": [run()]}]),
            get(f"{API}/actions/runs/42", {"status": "completed", "conclusion": "success"}),
            get(f"{API}/actions/runs/42/artifacts?per_page=100", pages=[
                {"artifacts": [{"name": "bundle", "expired": False}]},
                {"artifacts": [{"name": "coverage", "expired": False},
                               {"name": "coverage-status", "expired": False}]},
            ]),
        ], timeout="30")
        self.assertEqual(self.output.read_text(), "run_id=42\n")

    def test_unmerged_release_cannot_supply_deployment_artifacts(self):
        pr = merged_release()
        pr["merged"] = False
        result = self.find([get(f"{API}/pulls/124", pr)], False)
        self.assertIn("not a merged release", result.stderr)
        self.assertIn("actual merged=false", result.stderr)
        self.assert_context(result, release_pr=124, head_sha=SHA)

    def test_failed_newest_run_does_not_fall_back_to_old_success(self):
        result = self.find(self.ci_prefix([run(41), run(42)]) + [
            get(f"{API}/actions/runs/42", {"status": "completed", "conclusion": "failure"}),
        ], False)
        self.assertIn("finished with failure", result.stderr)
        self.assertIn("expected success", result.stderr)
        self.assert_context(result, release_pr=124, head_sha=SHA, run_id=42,
                            branch="release/0.0.25")

    def test_cancelled_run_is_not_deployable(self):
        result = self.find(self.ci_prefix() + [
            get(f"{API}/actions/runs/42", {"status": "completed", "conclusion": "cancelled"}),
        ], False)
        self.assertIn("finished with cancelled", result.stderr)

    def test_missing_or_expired_required_artifact_is_rejected(self):
        for arguments in ({"missing": "coverage"}, {"expired": "bundle"}):
            with self.subTest(arguments=arguments):
                result = self.find(self.ci_prefix() + [
                    get(f"{API}/actions/runs/42", {"status": "completed", "conclusion": "success"}),
                    get(f"{API}/actions/runs/42/artifacts?per_page=100", self.artifacts(**arguments)),
                ], False)
                self.assertIn("missing required artifacts", result.stderr)
                self.assertIn(f"missing required artifacts: {next(iter(arguments.values()))}", result.stderr)
                self.assertIn("available unexpired artifacts:", result.stderr)
                self.assert_context(result, release_pr=124, head_sha=SHA, run_id=42)

    def test_ci_api_errors_preserve_reason_and_identify_release_operation(self):
        responses = self.ci_prefix() + [
            get(f"{API}/actions/runs/42", {"status": "completed", "conclusion": "success"}),
            get(f"{API}/actions/runs/42/artifacts?per_page=100", self.artifacts()),
        ]
        operations = [
            "Could not read release PR", "Could not list ci-main.yml",
            "Could not read release CI run 42", "Could not list artifacts for release CI run 42",
        ]
        for index, operation in enumerate(operations):
            with self.subTest(operation=operation):
                failure = {**responses[index], "exit_code": 1, "stderr": "gh: HTTP 403\n"}
                result = self.find(responses[:index] + [failure], False)
                self.assertIn("gh: HTTP 403", result.stderr)
                self.assertIn(operation, result.stderr)
                self.assert_context(result, release_pr=124, head_sha=SHA)
                if index >= 2:
                    self.assert_context(result, run_id=42, branch="release/0.0.25")
                self.assertEqual(self.output.read_text(), "")

    def test_missing_or_incomplete_run_times_out(self):
        for runs in ([], [run()]):
            with self.subTest(runs=runs):
                responses = self.ci_prefix(runs)
                if runs:
                    responses.append(get(f"{API}/actions/runs/42", {"status": "in_progress"}))
                result = self.find(responses, False)
                self.assertIn("Timed out", result.stderr)
                self.assertIn(f"last_status={'in_progress' if runs else 'not-found'}", result.stderr)
                self.assert_context(result, release_pr=124, head_sha=SHA, timeout_seconds=0,
                                    run_id=42 if runs else "not-found")

    def test_invalid_timeout_reports_its_value_and_release_inputs(self):
        result = self.find([], False, timeout="invalid")
        self.assertIn("nonnegative number of seconds", result.stderr)
        self.assert_context(result, release_pr=124, head_sha=SHA, timeout_seconds="invalid")

    def test_current_release_is_accepted_and_stale_release_rejected(self):
        for current, success in ((SHA, True), (OTHER_SHA, False)):
            with self.subTest(current=current):
                result = self.execute("validate-current-release.sh", [REPOSITORY, SHA],
                                      [get(f"{API}/git/ref/heads/main", {"object": {"sha": current}})], success)
                if not success:
                    self.assertIn("refusing to overwrite production", result.stderr)
                    self.assertIn(f"expected main={SHA}, actual main={OTHER_SHA}", result.stderr)
                    self.assert_context(result, merge_sha=SHA)

    def test_current_main_api_error_preserves_reason_and_merge_context(self):
        result = self.execute("validate-current-release.sh", [REPOSITORY, SHA], [
            get(f"{API}/git/ref/heads/main", exit_code=1, stderr="gh: network unavailable\n"),
        ], False)
        self.assertIn("gh: network unavailable", result.stderr)
        self.assertIn("Could not read current main SHA before production publishing", result.stderr)
        self.assert_context(result, merge_sha=SHA)


if __name__ == "__main__":
    unittest.main()
