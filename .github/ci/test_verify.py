import os
import json
from copy import deepcopy
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from verify import TOKEN_ACTION, MISSING_APP_ID, UNKNOWN_CLIENT_ID
from verify import legacy_token_diagnostics, owned_package_scripts, require_contract_matches, validate_composite_actions
from scope import validate_result_gates, yaml_data


class VerificationDefinitionTest(unittest.TestCase):
    def test_hosted_gate_requires_selected_results_and_existing_jobs(self):
        root = Path(__file__).resolve().parents[2]
        policy_path = root / ".github/ci/suites.json"
        policy = json.loads(policy_path.read_text()) if policy_path.is_file() else {}
        if "hosted" not in policy:
            self.skipTest("No hosted result reuse configured")
        from verify import validate_workflow
        path = ".github/workflows/sdk-ci.yml"
        workflow = yaml_data((root / path).read_bytes())
        validate_workflow(workflow, path, policy)
        for change in (
            lambda jobs: jobs["required"]["needs"].remove("tested-candidate"),
            lambda jobs: jobs["required"]["steps"][0].update(run="true"),
            lambda jobs: jobs["required"]["steps"][2].update({"if": "false"}),
            lambda jobs: jobs["verify-sdk"].update({"if": "false"}),
            lambda jobs: jobs["install"].update({"if": "false"}),
            lambda jobs: jobs["required"]["steps"][0]["env"].pop("INSTALL_RESULT"),
        ):
            changed = deepcopy(workflow)
            change(changed["jobs"])
            with self.assertRaises(ValueError):
                validate_workflow(changed, path, policy)

    def test_sdk_install_routing_requires_a_complete_matching_pr_matrix(self):
        import github_updates as updates
        from updates import ScopeSnapshot

        root = Path(__file__).resolve().parents[2]
        policy = json.loads((root / ".github/ci/suites.json").read_text())
        workflow = ".github/workflows/sdk-ci.yml"
        tested, before_tested, base, head, before = (str(i) * 40 for i in range(1, 6))
        environment = "1" * 64
        inputs = {suite: "2" * 64 for suite in policy["suites"]}
        previous = ScopeSnapshot(before_tested, base, before, "7/9/internal", inputs)
        run = {"id": 10, "repository": {"id": 7}, "workflow_id": 9, "path": workflow,
               "head_branch": "feature", "run_number": 10}
        prior = {**run, "id": 8, "run_number": 8, "run_attempt": 1, "head_sha": before,
                 "head_repository": {"id": 7}, "pull_requests": [{"number": 4}], "status": "completed"}
        jobs = [
            {"name": f"Candidate / Tested {before_tested} for 4 [sdk] [sdk] {environment}",
             "run_id": 8, "run_attempt": 1, "id": 30},
            {"name": "Suites verify-sdk", "run_id": 8, "run_attempt": 1, "id": 31,
             "status": "completed", "conclusion": "success", "steps": [
                 {"name": "Record matching runner inputs", "conclusion": "success"},
                 {"name": "Execute selected suite: sdk", "conclusion": "success"},
             ]},
            *({"name": name, "run_id": 8, "run_attempt": 1, "status": "completed", "conclusion": "success"}
              for name in sorted(updates.SDK_INSTALL_JOBS)),
        ]
        staged = {**prior, "run_attempt": 2}
        second_attempt = [{**job, "run_attempt": 2, "id": 100 + index} for index, job in enumerate(jobs)]
        partial = [*second_attempt[:-2], {**second_attempt[-2], "conclusion": "failure"}]
        no_sdk = {**second_attempt[0], "name": second_attempt[0]["name"].replace("[sdk] [sdk]", "[sdk] []")}

        def lookup(path, **query):
            if path == "actions/runs/10":
                return run
            if path == "actions/workflows/9/runs":
                return {"workflow_runs": [staged if any(job["run_attempt"] == 2 for job in records) else prior]}
            if path == "actions/runs/8/jobs":
                return {"jobs": records}
            if path == f"commits/{tested}/pulls":
                return []
            self.fail(f"Unexpected GitHub request: {path}")

        cases = (
            ("unrelated update", "pull_request", "synchronize", jobs, False, True, "false", "[]"),
            ("missing matrix job", "pull_request", "synchronize", jobs[:-1], False, True, "false", '["sdk"]'),
            ("duplicate matrix job", "pull_request", "synchronize", jobs + jobs[-1:], False, True, "false", '["sdk"]'),
            ("wrong attempt", "pull_request", "synchronize", [*jobs[:-1], {**jobs[-1], "run_attempt": 2}], False, True, "false", '["sdk"]'),
            ("failed matrix", "pull_request", "synchronize", [*jobs[:-1], {**jobs[-1], "conclusion": "failure"}], False, True, "false", '["sdk"]'),
            ("newer partial matrix", "pull_request", "synchronize", [*jobs, *partial], False, True, "false", '["sdk"]'),
            ("newer missing producer", "pull_request", "synchronize", [*jobs, second_attempt[0]], False, True, "false", '["sdk"]'),
            ("newer skipped install", "pull_request", "synchronize", [*jobs, no_sdk], False, True, "false", "[]"),
            ("untrusted workflow", "pull_request", "synchronize", jobs, False, False, "false", '["sdk"]'),
            ("changed package", "pull_request", "synchronize", jobs, True, True, "true", "[]"),
            ("open PR", "pull_request", "opened", jobs, False, True, "true", "[]"),
            ("release push", "push", None, jobs, False, True, "true", "[]"),
        )
        with tempfile.TemporaryDirectory() as folder:
            event = Path(folder, "event.json")
            output = Path(folder, "output")
            for name, kind, action, records, changed, trusted, expected, unresolved in cases:
                with self.subTest(name=name):
                    payload = {"before": before}
                    if kind == "pull_request":
                        payload.update(action=action, number=4, pull_request={"head": {"repo": {"id": 7}}})
                    event.write_text(json.dumps(payload))
                    output.write_text("")
                    current = ScopeSnapshot(tested, base, head, "7/9/internal", {
                        **inputs, "sdk": "3" * 64 if changed else inputs["sdk"],
                    })
                    with (patch.dict(os.environ, GITHUB_EVENT_PATH=str(event), GITHUB_OUTPUT=str(output),
                                     GITHUB_SHA=tested, GITHUB_EVENT_NAME=kind, GITHUB_REPOSITORY_ID="7",
                                     GITHUB_RUN_ID="10", GITHUB_RUN_ATTEMPT="1"),
                          patch.object(updates, "git", return_value=tested.encode()),
                          patch.object(updates, "workflow_path", return_value=workflow),
                          patch.object(updates, "load_suites", return_value=policy),
                          patch.object(updates, "api", side_effect=lookup),
                          patch.object(updates, "environment_key", return_value=environment),
                          patch.object(updates, "candidate_snapshot", side_effect=lambda commit, *args, **kwargs:
                                       current if commit == tested else previous),
                          patch.object(updates, "unchanged_controls", side_effect=lambda left, right, path:
                                       trusted if left == base else True),
                          patch.object(updates, "authenticated_revision", return_value=before_tested),
                          patch.object(updates, "acquire_commit", return_value=True),
                          patch.object(updates, "checked_parent", return_value=before)):
                        updates.route(["sdk"])
                    routed = dict(line.split("=", 1) for line in output.read_text().splitlines())
                    self.assertEqual(routed["run_sdk"], expected)
                    self.assertEqual(routed["unresolved"], unresolved)

    def test_hosted_gate_reserves_time_for_the_registered_wait(self):
        from verify import validate_workflow
        root = Path(__file__).resolve().parents[2]
        path = ".github/workflows/sdk-ci.yml"
        policy = json.loads((root / ".github/ci/suites.json").read_text())
        if "hosted" not in policy:
            self.skipTest("No hosted result reuse configured")
        workflow = yaml_data((root / path).read_bytes())
        gate = workflow["jobs"][policy["hosted_workflows"][path]["gate"]]
        policy["hosted_workflows"][path]["wait_minutes"] = 45
        with self.assertRaisesRegex(ValueError, "Invalid timeout"):
            validate_workflow(workflow, ".github/workflows/sdk-ci.yml", policy)
        gate["timeout-minutes"] = "47"
        validate_workflow(workflow, ".github/workflows/sdk-ci.yml", policy)
        for invalid in (True, 0, 359, "45"):
            policy["hosted_workflows"][path]["wait_minutes"] = invalid
            with self.assertRaisesRegex(ValueError, "Hosted wait_minutes"):
                validate_workflow(workflow, ".github/workflows/sdk-ci.yml", policy)

    def test_definition_proof_cannot_record_a_skipped_validation(self):
        from verify import validate_workflow
        from validation_history import STEP

        root = Path(__file__).resolve().parents[2]
        policy_file = root / ".github/ci/suites.json"
        policy = json.loads(policy_file.read_text()) if policy_file.is_file() else {}
        if "hosted" not in policy:
            self.skipTest("No hosted result reuse configured")
        workflow = yaml_data((root / ".github/workflows/sdk-ci.yml").read_bytes())
        steps = workflow["jobs"]["verification-scope"]["steps"]
        if len(steps) == 4:
            del steps[2]
        validate_workflow(workflow, ".github/workflows/sdk-ci.yml", policy)
        steps.insert(2, {"name": f"{STEP} ${{{{ steps.scope.outputs.definition-proof }}}}",
                         "if": "steps.scope.outputs.definition-proof != ''", "run": "true"})
        validate_workflow(workflow, ".github/workflows/sdk-ci.yml", policy)
        steps[2]["if"] = "always()"
        with self.assertRaises(ValueError):
            validate_workflow(workflow, ".github/workflows/sdk-ci.yml", policy)

    def test_definition_history_requires_an_exact_successful_execution(self):
        import validation_history as history

        tested, head, key = "1" * 40, "2" * 40, "3" * 64
        workflow = ".github/workflows/ci.yml"
        run = {"id": 31, "event": "pull_request", "repository": {"id": 7},
               "head_sha": head, "path": workflow, "run_attempt": 3}
        payload = {"pull_request": {"number": 4, "head": {"repo": {"id": 7}, "sha": head}}}
        environment = {"GH_TOKEN": "fixture-only", "GITHUB_REPOSITORY": "spryinc/fixture",
                       "GITHUB_REPOSITORY_ID": "7", "GITHUB_RUN_ID": "31",
                       "GITHUB_EVENT_NAME": "pull_request", "GITHUB_JOB": "verification-scope",
                       "GITHUB_WORKFLOW_REF": f"spryinc/fixture/{workflow}@refs/pull/4/merge"}
        actual = {"name": "Real selector", "id": 100, "run_id": 31, "run_attempt": 1, "conclusion": "success",
                  "steps": [{"name": f"{history.STEP} {key}", "conclusion": "success"}]}
        with (tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, environment, clear=True),
              patch.object(history, "git", return_value=b"jobs: {verification-scope: {name: Real selector}}")):
            event = Path(folder, "event.json")
            event.write_text(json.dumps(payload))
            os.environ["GITHUB_EVENT_PATH"] = str(event)
            for newer, job_result, identity, expected in (
                ({"name": f"{history.STEP} {key}", "conclusion": "skipped"}, "success", tested, (1, 100)),
                ({"name": f"{history.STEP} {key}", "conclusion": "failure"}, "failure", tested, None),
                ({"name": history.STEP, "conclusion": "skipped"}, "failure", tested, None),
                ({"name": f"{history.STEP} {'4' * 64}", "conclusion": "success"}, "success", tested, (1, 100)),
                ({"name": f"{history.STEP} {key}", "conclusion": "skipped"}, "success", head, None),
            ):
                latest = {**actual, "id": 101, "run_attempt": 2, "conclusion": job_result, "steps": [newer]}
                with (patch.object(history, "api", side_effect=[run, {"jobs": [latest, actual]}]),
                      patch.object(history, "authenticated_revision", return_value=identity)):
                    self.assertEqual(history.reusable_validation(tested, 3, key), expected)
            lookalike = {**actual, "name": "Other job"}
            duplicate = {**actual, "id": 102}
            for jobs in ([lookalike], [actual, duplicate]):
                with patch.object(history, "api", side_effect=[run, {"jobs": jobs}]):
                    self.assertIsNone(history.reusable_validation(tested, 3, key))
            with patch.object(history, "api") as lookup:
                self.assertIsNone(history.reusable_validation(tested, 1, key))
                payload["pull_request"]["head"]["repo"]["id"] = 8
                event.write_text(json.dumps(payload))
                self.assertIsNone(history.reusable_validation(tested, 3, key))
                lookup.assert_not_called()

    def test_definition_validation_key_tracks_runner_image_and_selected_checks(self):
        import validation_history as history

        with (tempfile.TemporaryDirectory() as folder,
              patch.dict(os.environ, {"ImageVersion": "runner-1"}),
              patch.object(history, "environment_key", return_value="runtime")):
            selection = Path(folder, "selection.json")
            selection.write_text('{"controls":["first"],"scripts":[]}')
            workflow = "spryinc/fixture/.github/workflows/ci.yml@refs/pull/4/merge"
            baseline = history.validation_key(selection, "1" * 40, workflow)
            self.assertNotEqual(baseline, history.validation_key(selection, "2" * 40, workflow))
            with patch.dict(os.environ, {"ImageVersion": "runner-2"}):
                self.assertNotEqual(baseline, history.validation_key(selection, "1" * 40, workflow))
            selection.write_text('{"controls":["second"],"scripts":[]}')
            self.assertNotEqual(baseline, history.validation_key(selection, "1" * 40, workflow))
            contracts = Path(folder, "contracts.json")
            contracts.write_text('{"second":[["node","check-live.mjs"]]}')
            with patch.object(history, "CONTRACTS", contracts):
                self.assertIsNone(history.validation_key(selection, "1" * 40, workflow))

    def test_only_nonempty_client_ids_suppress_the_step_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory:
            workflow = Path(directory, "workflow.yml")
            for value, accepted in (
                ("# no ID", False),
                (">-", False),
                ("'' # no ID", False),
                ("Iv1.example", True),
            ):
                with self.subTest(value=value):
                    # Mapping order is unrelated to the meaning of the step.
                    workflow.write_text(
                        "jobs:\n  proof:\n    steps:\n"
                        f"      - with:\n          client-id: {value}\n"
                        f"        uses: {TOKEN_ACTION}\n"
                    )
                    reports = [
                        {"filepath": str(workflow), "line": 5, "message": UNKNOWN_CLIENT_ID},
                        {"filepath": str(workflow), "line": 6, "message": MISSING_APP_ID},
                    ]
                    ignored = legacy_token_diagnostics(reports)
                    self.assertEqual(len(ignored), 2 if accepted else 0)

    def test_contract_requires_every_named_test(self):
        pattern = r"^(?:first case|second case)$"
        require_contract_matches(pattern, "ok 1 - first case\nok 2 - second case")
        for output in (
            "ok 1 - first case",
            "ok 1 - first case\nok 2 - second case # SKIP",
            "ok 1 - test/contract.test.mjs",
        ):
            with self.assertRaises(SystemExit):
                require_contract_matches(pattern, output)


    def test_edited_scripts_must_have_an_executable_owner(self):
        workflow = {"jobs": {"check": {"steps": [{"run": "pnpm run verify"}]}}}
        commands = {"verify": "pnpm run test && pnpm run lint", "test": "node --test",
                    "lint": "eslint .", "verify:pre-push": "pnpm run verify"}
        self.assertEqual(owned_package_scripts(workflow, commands), {"verify", "test", "lint"})
        workflow["defaults"] = {"run": {"working-directory": "apps/site"}}
        self.assertFalse(owned_package_scripts(workflow, commands))
        del workflow["defaults"]
        for source in ("cd apps/site && pnpm run test", "if false; then\npnpm test\nfi"):
            workflow["jobs"]["check"]["steps"][0]["run"] = source
            self.assertFalse(owned_package_scripts(workflow, commands))

    def test_required_result_gate_cannot_accept_failure(self):
        document = yaml_data(b"""
jobs:
  verify-product: {}
  verify:
    if: always()
    needs: [verification-scope, verify-product]
    steps:
      - env:
          SCOPE: ${{ needs.verification-scope.result }}
          PRODUCT_SELECTED: ${{ needs.verification-scope.outputs.product }}
          PRODUCT_RESULT: ${{ needs.verify-product.result }}
        run: |
          test "$SCOPE" = success || exit 1
          case "$PRODUCT_SELECTED" in
            true) test "$PRODUCT_RESULT" = success ;;
            false) test "$PRODUCT_RESULT" = skipped ;;
            *) exit 1 ;;
          esac
""")
        validate_result_gates(document)
        gate = document["jobs"]["verify"]
        gate["continue-on-error"] = "true"
        with self.assertRaises(ValueError):
            validate_result_gates(document)
        del gate["continue-on-error"]
        gate["steps"][0]["run"] = gate["steps"][0]["run"].replace('test "$PRODUCT_RESULT" = success', "true")
        with self.assertRaises(ValueError):
            validate_result_gates(document)

    def test_sdk_required_gate_is_enforced_by_workflow_path(self):
        renamed = {"jobs": {"required": {"name": "A different display name"}}}
        with self.assertRaises(ValueError):
            validate_result_gates(renamed, ".github/workflows/sdk-ci.yml")

    def test_composite_validates_its_shell_without_executing_it(self):
        with tempfile.TemporaryDirectory() as directory:
            original = Path.cwd()
            try:
                os.chdir(directory)
                action = Path(".github/actions/proof/action.yml")
                action.parent.mkdir(parents=True)
                prefix = "runs:\n  using: composite\n  steps:\n    - shell: bash\n"
                action.write_text(prefix + '      run: printf "%s" "${{ inputs.value }}"\n')
                validate_composite_actions({str(action)})
                action.write_text(prefix + "      run: if true; then\n")
                with self.assertRaises(subprocess.CalledProcessError):
                    validate_composite_actions({str(action)})
            finally:
                os.chdir(original)


if __name__ == "__main__":
    unittest.main()
