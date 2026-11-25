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


def legacy_token_diagnostics(diagnostics):
    """Allow the supported client-id input only on the step that supplies it."""
    ignored = set()
    for report in diagnostics:
        if not report["message"].startswith(UNKNOWN_CLIENT_ID):
            continue
        path, number = report["filepath"], report["line"]
        lines = Path(path).read_text().splitlines()
        match = re.match(r"^([ ]+)client-id:\s*(\S.*)$", lines[number - 1])
        if not match or match[2] in {"''", '""', "null", "~"}:
            continue
        indent = len(match[1]) - 2
        with_index = next(
            (i for i in range(number - 2, -1, -1)
             if lines[i].strip() and len(lines[i]) - len(lines[i].lstrip()) <= indent),
            None,
        )
        if with_index is None or lines[with_index].strip() != "with:":
            continue
        for i in range(with_index - 1, -1, -1):
            line = lines[i]
            if line.strip().removeprefix("- ") == f"uses: {TOKEN_ACTION}":
                ignored.add((path, number, UNKNOWN_CLIENT_ID))
                ignored.add((path, i + 1, MISSING_APP_ID))
                break
            if line.lstrip().startswith("- "):
                break
    return ignored


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


selection = json.loads(Path(sys.argv[1]).read_text())
controls = set(selection["controls"])
lint_workflows(controls)
validate_local_files(controls, selection["scripts"])
subprocess.run([sys.executable, "-B", ".github/ci/test_scope.py"], check=True)
run_contracts(controls)
