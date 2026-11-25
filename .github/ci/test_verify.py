import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from verify import TOKEN_ACTION, MISSING_APP_ID, UNKNOWN_CLIENT_ID
from verify import legacy_token_diagnostics, owned_package_scripts, require_contract_matches, validate_composite_actions
from scope import validate_result_gates, yaml_data


class VerificationDefinitionTest(unittest.TestCase):
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
