# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
"""Exercise status generation and publishing without registry or Cloudflare access."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


class StatusPublishingTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.root = Path(self.workspace.name)
        self.payload = self.root / "status.json"
        self.payload.write_text('{"message":"100%"}\n')
        self.calls = self.root / "curl.json"
        curl = self.root / "curl"
        curl.write_text("""#!/usr/bin/env python3
import json, os, pathlib, sys
pathlib.Path(os.environ['CURL_CALLS']).write_text(json.dumps(sys.argv[1:]))
print(os.environ['CURL_RESPONSE'])
sys.exit(int(os.environ['CURL_EXIT']))
""")
        curl.chmod(0o755)
        self.env = {
            **os.environ,
            "PATH": f"{self.root}:{os.environ['PATH']}",
            "CLOUDFLARE_API_TOKEN": "secret-test-token",
            "CLOUDFLARE_ACCOUNT_ID": "test-account",
            "GH_TOKEN": "secret-github-token",
            "GH_APP_PRIVATE_KEY": "secret-app-private-key",
            "CURL_CALLS": str(self.calls),
            "CURL_RESPONSE": '{"success":true}',
            "CURL_EXIT": "0",
        }

    def publish(self, key="develop/coverage.json", content_type="application/json"):
        result = subprocess.run(
            ["bash", str(SCRIPTS / "publish-status.sh"), str(self.payload), key, content_type],
            env=self.env,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotIn("secret-test-token", result.stdout + result.stderr)
        self.assertNotIn(self.env["GH_TOKEN"], result.stdout + result.stderr)
        self.assertNotIn(self.env["GH_APP_PRIVATE_KEY"], result.stdout + result.stderr)
        return result

    def test_publish_preserves_key_file_and_content_type(self):
        for key, content_type in [
            ("develop/coverage.json", "application/json"),
            ("test-coverage.html", "text/html"),
        ]:
            with self.subTest(key=key):
                result = self.publish(key, content_type)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout + result.stderr, "")
                args = json.loads(self.calls.read_text())
                self.assertEqual(args[args.index("--request") + 1], "PUT")
                self.assertIn(f"Content-Type: {content_type}", args)
                self.assertEqual(args[args.index("--data-binary") + 1], f"@{self.payload}")
                self.assertEqual(
                    args[-1],
                    "https://api.cloudflare.com/client/v4/accounts/test-account/"
                    f"r2/buckets/operations-status/objects/{key}",
                )

    def test_http_failure_is_fatal_without_echoing_response(self):
        self.env.update(CURL_EXIT="22", CURL_RESPONSE="secret-test-token")
        result = self.publish()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Failed to publish R2 object: develop/coverage.json", result.stderr)

    def test_unsuccessful_or_invalid_api_response_is_fatal(self):
        for response in ['{"success":false}', '{"error":"secret-test-token"}', "invalid JSON", "null"]:
            with self.subTest(response=response):
                self.env["CURL_RESPONSE"] = response
                result = self.publish()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("unsuccessful response for R2 object: develop/coverage.json", result.stderr)

    def test_api_failures_include_only_structured_error_details(self):
        self.env["CURL_RESPONSE"] = json.dumps({
            "success": False,
            "errors": [{"code": 10000, "message": "Authentication error"}],
            "result": {"private": "do not print this field"},
        })
        for status in ["0", "22"]:
            with self.subTest(curl_exit=status):
                self.env["CURL_EXIT"] = status
                result = self.publish()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Cloudflare error 10000: Authentication error", result.stderr)
                for context in (str(self.payload), "operations-status", "develop/coverage.json",
                                "application/json", "test-account"):
                    self.assertIn(context, result.stderr)
                self.assertNotIn("do not print this field", result.stdout + result.stderr)

    def test_api_error_messages_redact_literal_token(self):
        token = "secret.+[token]"
        self.env["CLOUDFLARE_API_TOKEN"] = token
        self.env["CURL_RESPONSE"] = json.dumps({
            "success": False,
            "errors": [{"code": 10000, "message": f"Invalid token {token}; supplied {token}"}],
        })
        result = self.publish()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(token, result.stdout + result.stderr)
        self.assertIn("Invalid token [REDACTED]; supplied [REDACTED]", result.stderr)

    def test_missing_credentials_prevent_request(self):
        for variable in ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]:
            with self.subTest(variable=variable):
                value = self.env.pop(variable)
                result = self.publish()
                self.env[variable] = value
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("credentials are not configured", result.stderr)
                self.assertIn(f"{variable} is missing", result.stderr)
                self.assertIn(str(self.payload), result.stderr)
                self.assertIn("develop/coverage.json", result.stderr)
                self.assertFalse(self.calls.exists())

    def test_missing_payload_prevents_request(self):
        self.payload.unlink()
        result = self.publish()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Status file does not exist", result.stderr)
        self.assertFalse(self.calls.exists())


class DependencyStatusTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.root = Path(self.workspace.name)
        self.manifest = self.root / "package.json"
        self.manifest.write_text(json.dumps({
            "devDependencies": {"@scope/tool": "1.0.0", "current": "2.0.0"},
        }))
        self.outdated = self.root / "outdated.json"
        self.output = self.root / "status"

    def generate(self, outdated):
        self.outdated.write_text(outdated)
        return subprocess.run(
            ["bash", str(SCRIPTS / "generate-dependency-status.sh"),
             str(self.manifest), str(self.outdated), str(self.output)],
            text=True,
            capture_output=True,
            check=False,
        )

    def badge(self, filename):
        return json.loads((self.output / filename).read_text())

    def test_latest_versions_drive_badges_and_preserve_filenames(self):
        result = self.generate(json.dumps({"@scope/tool": {"latest": "1.1.0"}}))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.badge("version-dependencies.json"), {
            "schemaVersion": 1, "label": "Dependencies", "message": "1 outdated", "color": "orange",
        })
        self.assertEqual(self.badge("version-dependency-scope--tool.json"), {
            "schemaVersion": 1, "label": "@scope/tool", "message": "1.0.0", "color": "orange",
        })
        self.assertEqual(self.badge("version-dependency-current.json")["color"], "blue")

    def test_current_dependencies_produce_green_summary(self):
        result = self.generate("{}")
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = self.badge("version-dependencies.json")
        self.assertEqual((summary["message"], summary["color"]), ("up to date", "brightgreen"))
        self.assertEqual(self.badge("version-dependency-scope--tool.json")["color"], "blue")

    def test_npm_errors_or_invalid_payloads_produce_no_badges(self):
        for payload in [
            '{"error":{"code":"E401","summary":"registry authentication failed"}}',
            '{"@scope/tool":{"current":"1.0.0"}}',
            '{"@scope/tool":{"latest":null}}',
            '{"@scope/tool":{"latest":""}}',
            '{"@scope/tool":"invalid"}', "[]", "null", "", "not JSON", '{}\n{}',
        ]:
            with self.subTest(payload=payload):
                result = self.generate(payload)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("did not return valid dependency data", result.stderr)
                self.assertFalse(self.output.exists())

    def test_npm_registry_errors_report_code_and_summary_without_raw_details(self):
        result = self.generate(json.dumps({
            "error": {"code": "E401", "summary": "registry authentication failed", "detail": "private npm details"},
            "raw": "private registry response",
        }))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("::error::npm outdated did not return valid dependency data.", result.stderr)
        self.assertIn("npm error E401: registry authentication failed", result.stderr)
        for context in (self.manifest, self.outdated, self.output):
            self.assertIn(str(context), result.stderr)
        self.assertNotIn("private", result.stdout + result.stderr)
        self.assertFalse(self.output.exists())

    def test_invalid_manifest_reports_file_and_reason_before_writing_badges(self):
        for manifest in ('{}', '{"devDependencies":{"tool":42}}', '{"devDependencies":null}',
                         'not JSON', '{"devDependencies":{}}\n{"devDependencies":{}}'):
            with self.subTest(manifest=manifest):
                self.manifest.write_text(manifest)
                result = self.generate("{}")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("::error::Package manifest", result.stderr)
                self.assertIn(str(self.manifest), result.stderr)
                self.assertIn("devDependencies object with string versions", result.stderr)
                self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
