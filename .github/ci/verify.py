"""Validate selected verification definitions without installing product dependencies."""

import ast
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from scope import CONTRACTS, LINT_CONFIG, validate_result_gates, workflow_execution, yaml_data


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
        action = yaml_data(path.read_bytes())
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
        for workflow in workflows:
            try:
                validate_result_gates(yaml_data(Path(workflow).read_bytes()), workflow)
            except ValueError as error:
                raise SystemExit(f"{workflow}: {error}") from error
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


SCRIPT_CALL = re.compile(
    r"(?:corepack[ \t]+)?(?:pnpm|npm)[ \t]+(?:(?:run|run-script)[ \t]+)?"
    r"([A-Za-z][\w:-]*)(?:[ \t]+[-./\w:=]+)*"
)


def root_script_calls(source):
    # Count straightforward root commands. A shell script with conditionals,
    # directory changes, quoting or unknown commands needs an explicit contract.
    commands = [command.strip() for line in source.splitlines() for command in line.split("&&")]
    matches = [SCRIPT_CALL.fullmatch(command) for command in commands if command]
    return [match[1] for match in matches] if all(matches) else []


def owned_package_scripts(document, commands):
    workflow, workers = workflow_execution(document)
    root = workflow.get("defaults", {}).get("run", {}).get("working-directory", ".")
    pending = []
    for job in workers.values():
        if job.get("if"):
            continue
        directory = job.get("defaults", {}).get("run", {}).get("working-directory", root)
        for step in job.get("steps", []):
            if not step.get("if") and step.get("working-directory", directory) in {"", ".", "./"}:
                pending.extend(root_script_calls(step.get("run", "")))
    owned = set()
    while pending:
        name = pending.pop()
        if name in commands and name not in owned:
            owned.add(name)
            pending.extend(root_script_calls(commands[name]))
    return owned


def validate_script_owners(scripts):
    if not scripts or not os.environ.get("GITHUB_WORKFLOW_REF"):
        return
    workflow = os.environ["GITHUB_WORKFLOW_REF"].split("/", 2)[-1].split("@", 1)[0]
    manifest = json.loads(Path("package.json").read_text())
    commands = manifest.get("scripts", {})
    existing = set(scripts) & commands.keys()
    if not existing:
        return
    direct_contracts = set()
    if CONTRACTS.is_file():
        direct_contracts = {
            command[2] for command in json.loads(CONTRACTS.read_text()).get("package.json", [])
            if len(command) >= 3 and command[0] in {"pnpm", "npm"} and command[1] == "run"
        }
    unowned = existing - owned_package_scripts(yaml_data(Path(workflow).read_bytes()), commands) - direct_contracts
    if unowned:
        names = ", ".join(sorted(unowned))
        raise SystemExit(f"Changed package checks need an executable hosted job or package.json contract: {names}")


def root_locked_version(package):
    lockfile = yaml_data(Path("pnpm-lock.yaml").read_bytes())
    version = lockfile["importers"]["."]["devDependencies"][package]["version"]
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError(f"Expected a pinned root version for {package}")
    return version


def format_changed_controls(controls):
    package = Path("package.json")
    if not package.is_file():
        return
    if "prettier" not in json.loads(package.read_text()).get("devDependencies", {}):
        return
    files = sorted(name for name in controls
                   if Path(name).suffix in {".json", ".yml", ".yaml", ".md"} and Path(name).is_file())
    if files:
        version = root_locked_version("prettier")
        subprocess.run(["npm", "exec", "--yes", "--ignore-scripts", f"--package=prettier@{version}",
                        "--", "prettier", "--check", "--", *files], check=True)


def require_contract_matches(pattern, output):
    if not pattern.startswith("^(?:") or not pattern.endswith(")$"):
        raise ValueError(f"Expected a pattern made of exact test names: {pattern}")
    expected = len(re.split(r"(?<!\\)\|", pattern[4:-2]))
    matched = {
        match[1] for line in output.splitlines()
        if "# SKIP" not in line and "# TODO" not in line
        if (match := re.fullmatch(r"ok \d+ - (.+)", line))
        and re.fullmatch(pattern, match[1])
    }
    if len(matched) != expected:
        raise SystemExit(f"Expected {expected} workflow contract tests, found {len(matched)} for {pattern}")


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
                pattern = next(arg.split("=", 1)[1] for arg in command if arg.startswith("--test-name-pattern="))
                require_contract_matches(pattern, result.stdout)
            else:
                subprocess.run(command, check=True)


def main():
    selection = json.loads(Path(sys.argv[1]).read_text())
    controls = set(selection["controls"])
    lint_workflows(controls)
    validate_composite_actions(controls)
    validate_local_files(controls, selection["scripts"])
    validate_script_owners(selection["scripts"])
    format_changed_controls(controls)
    for tests in ("test_scope.py", "test_verify.py"):
        subprocess.run([sys.executable, "-B", f".github/ci/{tests}"], check=True)
    run_contracts(controls)


if __name__ == "__main__":
    main()
