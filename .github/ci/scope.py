"""Select check-definition and product verification from the same Git diff."""

import json
import os
import re
import subprocess
import sys
from pathlib import Path


CONTROL_DIRECTORIES = (".github/workflows/", ".github/actions/", ".github/ci/", ".husky/", ".githooks/", "scripts/ci/")
LINT_CONFIG = {".github/actionlint.yaml", ".github/actionlint.yml"}
CONTRACTS = Path(".github/ci/contracts.json")
CHECK_SCRIPT = re.compile(r"(?:verify|test|typecheck|lint|check)(?::[\w-]+)*|format:check|local:verify")
OID = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
SELECTION_ERRORS = (OSError, subprocess.CalledProcessError, ValueError, KeyError)


def git(*args):
    return subprocess.check_output(("git", *args), stderr=subprocess.DEVNULL)


def changes(*revisions):
    return {
        os.fsdecode(path)
        for path in git("diff", "--no-renames", "--name-only", "-z", *revisions, "--").split(b"\0")
        if path
    }


def package_changes(before, after):
    old = json.loads(git("show", f"{before}:package.json"))
    new = json.loads(git("show", f"{after}:package.json"))
    lint_staged_changed = old.pop("lint-staged", None) != new.pop("lint-staged", None)
    old_scripts = old.pop("scripts", {})
    new_scripts = new.pop("scripts", {})
    changed = {
        key for key in old_scripts.keys() | new_scripts.keys()
        if old_scripts.get(key) != new_scripts.get(key)
    }
    check_scripts = {key for key in changed if CHECK_SCRIPT.fullmatch(key)}
    check_only = old == new and changed == check_scripts
    return check_only, check_scripts, lint_staged_changed


def registered_check_paths(revision):
    try:
        return json.loads(git("show", f"{revision}:{CONTRACTS}")).keys() - {"package.json"}
    except SELECTION_ERRORS + (AttributeError,):
        return set()


def classify(paths, before, after):
    registered = LINT_CONFIG | (registered_check_paths(before) & registered_check_paths(after))
    controls = {path for path in paths if path.startswith(CONTROL_DIRECTORIES) or path in registered}
    product_paths = paths - controls
    scripts = set()
    if "package.json" in paths:
        try:
            check_only, scripts, lint_staged_changed = package_changes(before, after)
        except SELECTION_ERRORS + (AttributeError, TypeError):
            check_only, lint_staged_changed = False, False
        if scripts or lint_staged_changed:
            controls.add("package.json")
            if check_only:
                product_paths.remove("package.json")
    return controls, not controls or bool(product_paths), scripts


def github_selection():
    event = os.environ["GITHUB_EVENT_NAME"]
    if event not in {"pull_request", "push"}:
        return set(), True, set()
    head = os.environ["GITHUB_SHA"]
    if event == "pull_request":
        # The checked-out merge tree includes integration effects from the actual base.
        before = git("rev-parse", f"{head}^1").decode().strip()
    else:
        payload = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
        before = payload["before"]
        if payload.get("created"):
            default_ref = f"refs/heads/{payload['repository']['default_branch']}"
            if payload["ref"].startswith("refs/heads/") and payload["ref"] != default_ref:
                default_tip = f"refs/remotes/origin/{payload['repository']['default_branch']}"
                before = git("merge-base", default_tip, head).decode().strip()
    return classify(changes(before, head), before, head)


def pre_push_controls(remote, updates):
    # New branches have no old tip on the destination. Use the integration
    # branch the checkout knows about, or retain the local check if unknown.
    scopes = []
    for update in updates.splitlines():
        _, head, target, before = update.split()
        if not OID.fullmatch(head) or not OID.fullmatch(before):
            return False
        if not head.strip("0"):
            continue
        if not before.strip("0"):
            if not target.startswith("refs/heads/"):
                return False
            for ref in ("develop", "HEAD", "main"):
                try:
                    before = git("merge-base", f"refs/remotes/{remote}/{ref}", head).decode().strip()
                    break
                except subprocess.CalledProcessError:
                    continue
        scopes.append(classify(changes(before, head), before, head))
    return bool(scopes) and all(not product for _, product, _ in scopes)


def main():
    mode, *args = sys.argv[1:]
    if mode == "staged":
        _, product, _ = classify(changes("--cached"), "HEAD", "")
        return int(product)
    if mode == "pre-push":
        return int(not pre_push_controls(args[0], sys.stdin.read()))
    if mode != "github":
        raise ValueError(f"Unknown verification scope: {mode}")
    try:
        controls, product, scripts = github_selection()
    except SELECTION_ERRORS:
        print("Git comparison unavailable. Select product verification.")
        controls, product, scripts = set(), True, set()

    workflow = any(
        path.startswith((".github/workflows/", ".github/actions/")) or path in LINT_CONFIG
        for path in controls
    )
    Path(args[0]).write_text(json.dumps({"controls": sorted(controls), "scripts": sorted(scripts)}))
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        for key, selected in (("product", product), ("checks", bool(controls)), ("workflows", workflow)):
            print(f"{key}={str(selected).lower()}", file=output)
    print(f"Selected product verification: {product}; check-definition paths: {len(controls)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SELECTION_ERRORS:
        sys.exit(1)
