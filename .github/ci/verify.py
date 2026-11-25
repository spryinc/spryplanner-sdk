"""Validate selected verification definitions without installing product dependencies."""

import ast
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from scope import CONTRACTS, LINT_CONFIG


TOKEN_ACTION = "actions/create-github-app-token@v3"
MISSING_APP_ID = f'missing input "app-id" which is required by action "{TOKEN_ACTION}"'
UNKNOWN_CLIENT_ID = f'input "client-id" is not defined in action "{TOKEN_ACTION}"'


WORKFLOW_TOKEN_INPUTS = """
def fields(node)
  return {} unless node.is_a?(Psych::Nodes::Mapping)
  node.children.each_slice(2).each_with_object({}) do |(key, value), result|
    result[key.value] = value if key.respond_to?(:value)
  end
end

root = fields(Psych.parse_file(ARGV.fetch(0)).root)
pairs = fields(root["jobs"]).values.flat_map do |job|
  steps = fields(job)["steps"]
  next [] unless steps.is_a?(Psych::Nodes::Sequence)
  steps.children.map do |step|
    step = fields(step)
    use = step["uses"]
    input = fields(step["with"])["client-id"]
    next unless use.is_a?(Psych::Nodes::Scalar) && use.value == ARGV.fetch(1)
    next unless input.is_a?(Psych::Nodes::Scalar) && !input.value.strip.empty?
    next if input.plain && ["null", "~"].include?(input.value.downcase)
    [use.start_line + 1, input.start_line + 1]
  end.compact
end
puts JSON.generate(pairs)
"""


def legacy_token_diagnostics(diagnostics):
    """Allow the supported client-id scalar only on the step that supplies it."""
    ignored = set()
    paths = {
        report["filepath"] for report in diagnostics
        if report["message"].startswith(UNKNOWN_CLIENT_ID)
    }
    for path in paths:
        pairs = subprocess.check_output([
            "ruby", "-rpsych", "-rjson", "-e", WORKFLOW_TOKEN_INPUTS, path, TOKEN_ACTION,
        ])
        for use_line, input_line in json.loads(pairs):
            ignored.add((path, use_line, MISSING_APP_ID))
            ignored.add((path, input_line, UNKNOWN_CLIENT_ID))
    return ignored


def validate_composite_actions(controls):
    for filename in sorted(controls):
        path = Path(filename)
        if not filename.startswith(".github/actions/") or path.name not in {"action.yml", "action.yaml"}:
            continue
        if not path.is_file():
            continue
        data = subprocess.check_output([
            "ruby", "-rpsych", "-rjson", "-e",
            'puts JSON.generate(Psych.safe_load(File.read(ARGV.fetch(0)), aliases: true))',
            filename,
        ])
        action = json.loads(data)
        runs = action["runs"]
        if runs["using"] != "composite":
            continue
        for index, step in enumerate(runs["steps"], 1):
            if "run" not in step:
                continue
            source = re.sub(r"\$\{\{.*?\}\}", "github_expression", step["run"], flags=re.DOTALL)
            shell = Path(step["shell"].split()[0]).name
            label = f"{filename} step {index}"
            if shell in {"bash", "sh"}:
                subprocess.run([shell, "-n", "-c", source, label], check=True)
            elif shell == "python":
                ast.parse(source, filename=label)


def lint_workflows(controls):
    workflows = {
        path for path in controls
        if path.startswith(".github/workflows/") and Path(path).suffix in {".yml", ".yaml"}
    }
    if controls & LINT_CONFIG or any(path.startswith(".github/actions/") for path in controls):
        workflows.update(str(path) for path in Path(".github/workflows").glob("*.y*ml"))
    workflows = sorted(path for path in workflows if Path(path).is_file())
    if workflows:
        if not shutil.which("shellcheck"):
            raise SystemExit("ShellCheck is required to validate workflow shell syntax")
        result = subprocess.run([
            os.environ.get("ACTIONLINT", "actionlint"), "-pyflakes=", "-format", "{{json .}}",
            *workflows,
        ], env={**os.environ, "SHELLCHECK_OPTS": "--severity=error"}, text=True, stdout=subprocess.PIPE)
        if result.returncode not in {0, 1} or (result.returncode and not result.stdout):
            result.check_returncode()
        reports = json.loads(result.stdout or "[]")
        ignored = legacy_token_diagnostics(reports)
        failures = [
            item for item in reports
            if not any(item["filepath"] == path and item["line"] == line and item["message"].startswith(message)
                       for path, line, message in ignored)
        ]
        if failures:
            for item in failures:
                print(f"{item['filepath']}:{item['line']}:{item['column']}: {item['message']}", file=sys.stderr)
            raise SystemExit(1)


def validate_local_files(controls, scripts):
    for filename in sorted(controls):
        path = Path(filename)
        if not path.is_file():
            continue
        if path.suffix == ".py":
            ast.parse(path.read_bytes(), filename=filename)
        elif path.suffix in {".js", ".mjs", ".cjs"}:
            subprocess.run(["node", "--check", filename], check=True)
        elif path.suffix == ".sh" or filename.startswith((".husky/", ".githooks/")):
            source = path.read_text()
            shell = "bash" if source.startswith(("#!/bin/bash", "#!/usr/bin/env bash")) else "sh"
            subprocess.run([shell, "-n", filename], check=True)
    if "package.json" in controls and Path("package.json").is_file():
        manifest = json.loads(Path("package.json").read_text())
        commands = manifest.get("scripts", {})
        staged = manifest.get("lint-staged", {})
        for command in [commands[name] for name in scripts if name in commands]:
            subprocess.run(["sh", "-n", "-c", command], check=True)
        for entry in staged.values():
            for command in entry if isinstance(entry, list) else [entry]:
                subprocess.run(["sh", "-n", "-c", command], check=True)


def run_contracts(controls):
    if CONTRACTS.is_file():
        commands = json.loads(CONTRACTS.read_text())
        for command in sorted({
            tuple(command)
            for path, checks in commands.items()
            if path in controls or str(CONTRACTS) in controls
            for command in checks
        }):
            if any(argument.startswith("--test-name-pattern=") for argument in command):
                result = subprocess.run(
                    (*command[:2], "--test-reporter=tap", *command[2:]),
                    check=False, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                )
                print(result.stdout, end="")
                result.check_returncode()
                if not any(line.startswith("# pass ") and int(line.split()[-1]) > 0
                           for line in result.stdout.splitlines()):
                    raise SystemExit(f"No workflow contract tests matched {command}")
            else:
                subprocess.run(command, check=True)


def main():
    selection = json.loads(Path(sys.argv[1]).read_text())
    controls = set(selection["controls"])
    lint_workflows(controls)
    validate_composite_actions(controls)
    validate_local_files(controls, selection["scripts"])
    for tests in ("test_scope.py", "test_verify.py"):
        subprocess.run([sys.executable, "-B", f".github/ci/{tests}"], check=True)
    run_contracts(controls)


if __name__ == "__main__":
    main()
