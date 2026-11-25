"""Validate selected verification definitions without installing product dependencies."""

import ast
import json
import os
import subprocess
import sys
from pathlib import Path

from scope import CONTRACTS, LINT_CONFIG


def lint_workflows(controls):
    workflows = {
        path for path in controls
        if path.startswith(".github/workflows/") and Path(path).suffix in {".yml", ".yaml"}
    }
    if controls & LINT_CONFIG or any(path.startswith(".github/actions/") for path in controls):
        workflows.update(str(path) for path in Path(".github/workflows").glob("*.y*ml"))
    workflows = sorted(path for path in workflows if Path(path).is_file())
    if workflows:
        # v1.7.12's metadata predates the supported v3 client-id input.
        subprocess.run([
            os.environ.get("ACTIONLINT", "actionlint"), "-shellcheck=", "-pyflakes=",
            "-ignore", 'missing input "app-id" which is required by action "actions/create-github-app-token@v3"',
            "-ignore", 'input "client-id" is not defined in action "actions/create-github-app-token@v3"',
            *workflows,
        ], check=True)


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
