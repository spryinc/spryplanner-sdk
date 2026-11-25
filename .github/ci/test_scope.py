import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from scope import CONTRACTS, changes, classify, github_selection, git, pre_push_controls, workflow_needs_product


class VerificationScopeTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        cwd = os.getcwd()
        os.chdir(temp.name)
        self.addCleanup(os.chdir, cwd)
        self.addCleanup(patch.stopall)
        # Git hooks can export repository paths. Use our synthetic repository.
        patch.dict(os.environ).start()
        for key in ("GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX"):
            os.environ.pop(key, None)
        git("init", "-q", "-b", "develop")
        git("config", "user.email", "verification@example.invalid")
        git("config", "user.name", "Verification fixture")
        git("config", "core.hooksPath", "/dev/null")
        Path(".github/workflows").mkdir(parents=True)
        Path(".husky").mkdir()
        Path("app.js").write_text("export const current = 1;\n")
        Path("package.json").write_text(json.dumps({"scripts": {"test": "node --test"}}))
        self.base = self.commit()

    def commit(self):
        git("add", "--all")
        git("commit", "-qm", "Fixture")
        return git("rev-parse", "HEAD").decode().strip()

    def test_check_definitions_and_product_changes_are_independently_selected(self):
        Path(".github/workflows/ci.yml").touch()
        Path(".husky/pre-push").touch()
        git("add", "--all")
        self.assertEqual(
            classify(changes("--cached"), "HEAD", ""),
            ({".github/workflows/ci.yml", ".husky/pre-push"}, False, set()),
        )
        Path("app.js").write_text("export const current = 2;\n")
        git("add", "--all")
        self.assertTrue(classify(changes("--cached"), "HEAD", "")[1])
        self.assertEqual(classify({"app.js"}, "HEAD", ""), (set(), True, set()))
        self.assertEqual(classify(set(), "HEAD", ""), (set(), True, set()))

    def test_check_only_package_edits_and_shared_dependencies(self):
        package = Path("package.json")
        package.write_text(json.dumps({"scripts": {"test": "node --test check.test.js"}}))
        git("add", "package.json")
        self.assertEqual(classify(changes("--cached"), "HEAD", ""), ({"package.json"}, False, {"test"}))
        package.write_text(json.dumps({
            "scripts": {"test": "node --test check.test.js", "local:verify": "node scripts/verify.js"},
            "dependencies": {"product": "1.0.0"},
        }))
        git("add", "package.json")
        self.assertEqual(
            classify(changes("--cached"), "HEAD", ""),
            ({"package.json"}, True, {"local:verify", "test"}),
        )

    def test_multiple_push_ref_updates_and_new_branch(self):
        git("update-ref", "refs/remotes/origin/develop", self.base)
        Path(".husky/pre-push").touch()
        checks = self.commit()
        Path("app.js").write_text("export const current = 2;\n")
        mixed = self.commit()
        update = f"refs/heads/checks {checks} refs/heads/checks {self.base}"
        self.assertTrue(pre_push_controls("origin", update))
        self.assertTrue(pre_push_controls("origin", f"refs/heads/checks {checks} refs/heads/checks {'0' * 40}"))
        self.assertFalse(pre_push_controls("origin", f"{update}\nrefs/heads/mixed {mixed} refs/heads/mixed {self.base}"))

    def test_a_new_registration_cannot_skip_product_verification(self):
        CONTRACTS.parent.mkdir(exist_ok=True)
        CONTRACTS.write_text(json.dumps({"app.js": []}))
        Path("app.js").write_text("export const current = 2;\n")
        git("add", "--all")
        self.assertEqual(classify(changes("--cached"), "HEAD", ""), ({str(CONTRACTS)}, True, set()))

    def test_pull_request_compares_the_integration_tree_to_its_base(self):
        git("switch", "-qc", "controls")
        Path(".github/workflows/ci.yml").touch()
        self.commit()
        git("switch", "-q", "develop")
        Path("app.js").write_text("export const current = 2;\n")
        self.commit()
        git("merge", "--no-ff", "-qm", "Integrate controls", "controls")
        with patch.dict(os.environ, GITHUB_EVENT_NAME="pull_request", GITHUB_SHA=git("rev-parse", "HEAD").decode().strip()):
            self.assertEqual(github_selection(), ({".github/workflows/ci.yml"}, False, set()))

    def test_workflow_execution_changes_select_only_the_affected_workflow(self):
        ci = Path(".github/workflows/ci.yml")
        image = Path(".github/workflows/image.yml")
        source = """jobs:
  verification-scope:
    timeout-minutes: 5
    steps:
      - uses: ./.github/actions/verification-scope
        with:
          validate: 'true'
  verify-product:
    services:
      database:
        image: postgres:16
    steps:
      - run: pnpm run test
"""
        ci.write_text(source)
        image.write_text(source.replace("validate: 'true'", "validate: 'false'"))
        base = self.commit()
        ci.write_text(source.replace("timeout-minutes: 5", "timeout-minutes: 6"))
        metadata = self.commit()
        self.assertFalse(workflow_needs_product(str(ci), {str(ci)}, set(), base, metadata))
        ci.write_text(source.replace("postgres:16", "postgres:18"))
        execution = self.commit()
        self.assertTrue(workflow_needs_product(str(ci), {str(ci)}, set(), base, execution))
        self.assertFalse(workflow_needs_product(str(image), {str(ci)}, set(), base, execution))
        self.assertTrue(workflow_needs_product(str(ci), {"package.json"}, {"test"}, base, execution))
        self.assertFalse(workflow_needs_product(str(image), {"package.json"}, {"test"}, base, execution))


    def test_missing_push_base_selects_product(self):
        scope = Path(__file__).with_name("scope.py").resolve()
        Path("event.json").write_text(json.dumps({"before": "0" * 40}))
        subprocess.run(
            [sys.executable, str(scope), "github", "selection.json"],
            env={**os.environ, "GITHUB_EVENT_NAME": "push", "GITHUB_EVENT_PATH": "event.json",
                 "GITHUB_SHA": self.base, "GITHUB_OUTPUT": "output"},
            check=True,
            capture_output=True,
        )
        self.assertIn("product=true", Path("output").read_text())

    def test_new_branch_push_uses_default_branch_when_available(self):
        git("update-ref", "refs/remotes/origin/develop", self.base)
        Path(".github/workflows/ci.yml").touch()
        head = self.commit()
        Path("event.json").write_text(json.dumps({
            "before": "0" * 40,
            "created": True,
            "ref": "refs/heads/controls",
            "repository": {"default_branch": "develop"},
        }))
        with patch.dict(os.environ, GITHUB_EVENT_NAME="push", GITHUB_SHA=head, GITHUB_EVENT_PATH="event.json"):
            self.assertEqual(github_selection(), ({".github/workflows/ci.yml"}, False, set()))


if __name__ == "__main__":
    unittest.main()
