import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from scope import CONTRACTS, FULL, affected_suites, changes, classify, github_selection, git, pre_push_controls, workflow_needs_product, yaml_data
from updates import ScopeSnapshot, SuiteResult, decide, snapshot


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
        os.environ.pop("GITHUB_WORKFLOW_REF", None)
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

    def test_sdk_selects_only_affected_source_tools_and_artifact(self):
        checkout = Path(__file__).resolve().parents[2]
        policy = json.loads((checkout / ".github/ci/suites.json").read_text())
        for name in ("README.md", "RELEASING.md", "packages/sdk-typescript/README.md"):
            self.assertEqual(affected_suites({name}, set(), policy), set())
        self.assertEqual(affected_suites({"packages/sdk-typescript/src/index.test.ts"}, set(), policy),
                         {"sdk-test", "sdk-typecheck"})
        self.assertEqual(affected_suites({"tools/find-pnpm.test.mjs"}, set(), policy), {"test-pnpm-tools"})
        self.assertEqual(affected_suites({"tools/fixtures/consumer.mts"}, set(), policy), {"sdk"})
        selected = affected_suites({"packages/api-contract/src/calendarFeeds.ts"}, set(), policy)
        self.assertEqual(selected, {"sdk", "sdk-build", "sdk-test", "sdk-typecheck"})

    def test_release_checkout_inputs_require_fresh_install_on_main(self):
        checkout = Path(__file__).resolve().parents[2]
        policy = Path(".github/ci/suites.json")
        policy.parent.mkdir()
        policy.write_bytes((checkout / policy).read_bytes())
        for filename, develop_selection in (
            ("packages/sdk-typescript/README.md", set()),
            ("tools/release.mjs", {"test-release-tools"}),
        ):
            before = self.commit()
            source = Path(filename)
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text("New input")
            after = self.commit()
            for ref, expected in (("refs/heads/develop", develop_selection),
                                  ("refs/heads/main", develop_selection | {"sdk"})):
                with self.subTest(filename=filename, ref=ref):
                    Path("event.json").write_text(json.dumps({"before": before, "ref": ref}))
                    with patch.dict(os.environ, GITHUB_SHA=after, GITHUB_EVENT_NAME="push",
                                    GITHUB_EVENT_PATH="event.json", GITHUB_REF=ref):
                        self.assertEqual(github_selection()[3], expected)

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
            self.assertEqual(github_selection(), ({".github/workflows/ci.yml"}, False, set(), set()))

    def test_policy_change_and_unowned_prose_do_not_select_every_suite(self):
        suites = Path(".github/ci/suites.json")
        suites.parent.mkdir()
        ordinary = {"suites": {"product": ["app.js"]},
                    "review_only": ["README.md"], "release_branches": []}
        owned = {**ordinary, "suites": {"product": ["app.js", "README.md"]}}
        unknown = {**ordinary, "review_only": []}
        broad_review = {**ordinary, "review_only": ["*"]}

        for index, (base_policy, candidate_policy, payload, expected) in enumerate((
            (ordinary, ordinary, "README.md", set()),
            (owned, ordinary, "README.md", FULL),
            (ordinary, owned, "README.md", FULL),
            (unknown, ordinary, "README.md", FULL),
            (ordinary, unknown, "README.md", FULL),
            (None, ordinary, "README.md", FULL),
            (ordinary, ordinary, "app.js", FULL),
            (broad_review, broad_review, "unregistered.sh", FULL),
        )):
            with self.subTest(base=base_policy, candidate=candidate_policy, payload=payload):
                git("switch", "--detach", "-q", self.base)
                if base_policy:
                    suites.parent.mkdir(exist_ok=True)
                    suites.write_text(json.dumps(base_policy))
                    base = self.commit()
                else:
                    base = self.base
                feature = f"policy-feature-{index}"
                git("switch", "-qc", feature)
                suites.parent.mkdir(exist_ok=True)
                suites.write_text(json.dumps({**candidate_policy, "affected_main_push": True}))
                Path(payload).write_text("Changed content\n")
                self.commit()
                git("switch", "--detach", "-q", base)
                git("merge", "--no-ff", "-qm", "Test policy and payload", feature)
                with patch.dict(os.environ, GITHUB_EVENT_NAME="pull_request",
                                GITHUB_SHA=git("rev-parse", "HEAD").decode().strip()):
                    controls, _, _, selected = github_selection()
                self.assertEqual(controls, {str(suites)})
                self.assertEqual(selected, expected)

    def test_yaml_setup_is_deferred_until_a_workflow_needs_parsing(self):
        workflow = Path(".github/workflows/ci.yml")
        workflow.write_text("jobs: {verification-scope: {steps: []}}\n")
        suites = Path(".github/ci/suites.json")
        suites.parent.mkdir()
        suites.write_text(json.dumps({
            "suites": {"product": ["app.js"]}, "review_only": ["README.md"], "release_branches": [],
        }))
        base = self.commit()
        git("switch", "-qc", "prose")
        Path("README.md").write_text("# Description\n")
        self.commit()
        git("switch", "-q", "develop")
        git("merge", "--no-ff", "-qm", "Test prose", "prose")
        target = str(Path.cwd() / "yaml-tool")
        with patch.dict(os.environ, GITHUB_EVENT_NAME="pull_request",
                        GITHUB_SHA=git("rev-parse", "HEAD").decode().strip(),
                        GITHUB_WORKFLOW_REF="spry/example/.github/workflows/ci.yml@refs/pull/7/merge",
                        SPRY_CI_YAML_TARGET=target), patch("scope.install_pinned_yaml") as install:
            self.assertEqual(github_selection(), (set(), False, set(), set()))
            install.assert_not_called()
            self.assertFalse(workflow_needs_product(str(workflow), {str(workflow)}, set(), base, base))
            install.assert_called_with(target)
        parser = Path(target, "yaml", "__init__.py")
        def make_parser(*args, **kwargs):
            parser.parent.mkdir(parents=True)
            parser.touch()
        with patch.dict(os.environ, SPRY_CI_YAML_TARGET=target), patch("scope.subprocess.run", side_effect=make_parser) as pip:
            self.assertEqual(yaml_data("name: Example"), {"name": "Example"})
            self.assertEqual(yaml_data("name: Another"), {"name": "Another"})
            pip.assert_called_once_with(
                (sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
                 "--target", target, "PyYAML==6.0.3"), check=True,
            )

    def test_action_installs_yaml_before_running_a_legacy_selector(self):
        root = Path(__file__).resolve().parents[2]
        action = yaml_data((root / ".github/actions/verification-scope/action.yml").read_bytes())
        select = next(step["run"] for step in action["runs"]["steps"] if step.get("id") == "select")
        selector = Path(".github/ci/scope.py")
        selector.parent.mkdir()
        selector.write_text(
            "import sys, yaml\nfrom pathlib import Path\n"
            "assert yaml.installed_by_fixture\n"
            "if __name__ == '__main__':\n"
            "    assert sys.argv[1] == 'github'\n"
            "    Path(sys.argv[2]).write_text('legacy CLI ran')\n"
        )
        runner = Path.cwd() / "runner"
        runner.mkdir()
        tools = Path.cwd() / "tools"
        tools.mkdir()
        python = tools / "python3"
        python.write_text(
            '#!/bin/sh\n'
            'if [ "$1" = -m ] && [ "$2" = pip ]; then\n'
            '  test "$7" = PyYAML==6.0.3 || exit 1\n'
            '  mkdir -p "$SPRY_CI_YAML_TARGET/yaml"\n'
            '  printf "installed_by_fixture = True\\n" > "$SPRY_CI_YAML_TARGET/yaml/__init__.py"\n'
            'else\n'
            '  exec "$FIXTURE_PYTHON" "$@"\n'
            'fi\n'
        )
        python.chmod(0o755)
        subprocess.run(
            ("bash", "-e", "-c", select),
            env={**os.environ, "PATH": f"{tools}{os.pathsep}{os.environ['PATH']}",
                 "FIXTURE_PYTHON": sys.executable, "GITHUB_EVENT_NAME": "pull_request",
                 "RUNNER_TEMP": str(runner), "GITHUB_ENV": str(runner / "environment")},
            check=True,
        )
        self.assertEqual((runner / "spry-verification-scope.json").read_text(), "legacy CLI ran")

    def test_scope_fingerprints_follow_tested_merge_changes(self):
        for directory in ("api", "db"):
            Path(directory).mkdir()
            Path(directory, "fixture").write_text("base\n")
        manifest = Path(".github/workflows/ci.yml")
        manifest.write_text("name: Fixture\n")
        base = self.commit()
        git("switch", "-qc", "feature")
        Path("api/fixture").write_text("feature\n")
        first_head = self.commit()
        git("switch", "-q", "develop")
        git("merge", "--no-ff", "-qm", "Test feature", "feature")

        def candidate(**options):
            runtime = options.pop("runtime", "pinned")
            return snapshot(
                git("rev-parse", "HEAD").decode().strip(),
                {"api": ["api/**"], "database": ["db/**"], "web": ["app.js"]},
                context="1/2/internal",
                common_inputs=[str(manifest)],
                execution_identity={scope: {"runtime": runtime, "command": scope}
                                    for scope in ("api", "database", "web")},
                **options,
            )

        first = candidate()
        self.assertEqual((first.base, first.head), (base, first_head))
        git("switch", "-q", "feature")
        Path("README.md").write_text("Description\n")
        self.commit()
        git("switch", "-qc", "same-base", base)
        git("merge", "--no-ff", "-qm", "Test prose update", "feature")
        prose = candidate()
        self.assertNotEqual(prose.tested, first.tested)
        self.assertEqual(prose.inputs, first.inputs)
        git("switch", "-qc", "new-base", base)
        Path("db/fixture").write_text("new base\n")
        self.commit()
        git("merge", "--no-ff", "-qm", "Test moved base", "feature")
        moved = candidate()
        passed = SuiteResult("api", first.inputs["api"], first.context, 11, 1, 1, 21, "success")
        unrelated_base = decide(moved, cumulative=["api"], previous=prose, update=True, observations=[passed])
        self.assertEqual(unrelated_base.required, ("api",))
        self.assertEqual(unrelated_base.execute, ())
        decision = decide(moved, cumulative=["api"], previous=prose, update=True,
                          prior_obligations=["database"], observations=[passed])
        self.assertEqual(decision.required, ("api", "database"))
        self.assertEqual(decision.execute, ("database",))
        self.assertEqual(decision.carry, {"api": passed})
        self.assertEqual(decision.unresolved, ())
        rebuilt = candidate(runtime="changed")
        self.assertEqual(
            decide(rebuilt, cumulative=["api"], previous=moved, update=True, observations=[passed]).execute,
            ("api",),
        )

        git("switch", "-qc", "promotion", base)
        git("merge", "--squash", "-q", "feature")
        pushed = self.commit()
        promoted = candidate(push_base=base)
        self.assertEqual((promoted.base, promoted.head), (base, pushed))
        self.assertEqual(decide(promoted, cumulative=["api"], observations=[passed]).carry, {"api": passed})

    def test_update_preserves_failures_and_reuses_matching_running_or_successful_jobs(self):
        context = "1/2/internal"
        current = ScopeSnapshot("1" * 40, "2" * 40, "3" * 40, context, {"api": "a" * 64, "web": "b" * 64})
        previous = ScopeSnapshot("4" * 40, "2" * 40, "5" * 40, context, current.inputs)
        success = SuiteResult("api", "a" * 64, context, 10, 1, 1, 105, "success")
        failure = SuiteResult("api", "a" * 64, context, 10, 1, 2, 106, "failure")
        running = SuiteResult("web", "b" * 64, context, 12, 2, 1, 107, "in_progress")
        foreign = SuiteResult("api", "a" * 64, "1/2/fork", 13, 3, 1, 108, "success")
        required = ["api", "web"]
        settings = {"cumulative": required, "previous": previous, "update": True}
        decision = decide(current, **settings, observations=[failure, foreign, running, success])
        self.assertEqual(decision.execute, ())
        self.assertEqual(decision.unresolved, ("api",))
        self.assertEqual(decision.wait, {"web": running})
        self.assertEqual(decision.carry, {})
        retry = decide(current, **settings, retry=["api"], observations=[failure, running])
        self.assertEqual(retry.execute, ("api",))
        self.assertEqual(retry.wait, {"web": running})
        cancelled = SuiteResult("api", "a" * 64, context, 14, 4, 1, 109, "cancelled")
        self.assertEqual(decide(current, **settings, observations=[success, cancelled]).unresolved, ("api", "web"))
        unknown = decide(current, cumulative=required, update=True, observations=[success])
        self.assertEqual(unknown.execute, ())
        self.assertEqual(unknown.carry, {"api": success})
        self.assertEqual(unknown.unresolved, ("web",))
        self.assertEqual(decide(current, cumulative=required, observations=[success]).execute, ("web",))

    def test_snapshots_cannot_change_and_latest_matching_attempt_wins_independent_of_order(self):
        inputs = {"api": "a" * 64}
        context = "1/2/internal"
        current = ScopeSnapshot("1" * 40, "2" * 40, "3" * 40, context, inputs)
        inputs["api"] = "b" * 64
        self.assertEqual(current.inputs["api"], "a" * 64)
        with self.assertRaises(TypeError):
            current.inputs["api"] = "b" * 64

        older_success = SuiteResult("api", "a" * 64, context, 10, 1, 1, 105, "success")
        older_conflict = SuiteResult("api", "a" * 64, context, 10, 1, 1, 105, "failure")
        newer = SuiteResult("api", "a" * 64, context, 10, 1, 2, 106, "success")
        for observations in ([older_success, older_conflict, newer], [newer, older_success, older_conflict]):
            self.assertEqual(decide(current, cumulative=["api"], observations=observations).carry, {"api": newer})
        with self.assertRaisesRegex(ValueError, "Conflicting latest job observations for api"):
            decide(current, cumulative=["api"], observations=[older_success, older_conflict])

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
            self.assertEqual(github_selection(), ({".github/workflows/ci.yml"}, False, set(), set()))


class HostedSuiteTests(unittest.TestCase):
    def test_positive_selection_and_unknown_fallback(self):
        policy = {"suites": {"app": ["src/**"], "db": ["db/**"]}, "review_only": ["README.md"]}
        self.assertEqual(affected_suites(set(), set(), policy), set())
        self.assertEqual(affected_suites({"README.md", ".github/ci/suites.json"}, {".github/ci/suites.json"}, policy), set())
        self.assertEqual(affected_suites({"src/main.ts"}, set(), policy), {"app"})
        self.assertEqual(affected_suites({"src/main.ts", "db/001.sql"}, set(), policy), {"app", "db"})
        self.assertEqual(affected_suites({"unowned.ts"}, set(), policy), FULL)


if __name__ == "__main__":
    unittest.main()
