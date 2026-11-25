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


def yaml_data(source):
    import yaml

    return yaml.load(source, Loader=yaml.BaseLoader)


def job_condition(value):
    condition = (value or "").strip().removeprefix("${{").removesuffix("}}").strip()
    selected = "needs.verification-scope.outputs.product == 'true'"
    optional = "needs.verification-scope.outputs.product != 'false'"
    dispatch = "github.event_name == 'workflow_dispatch'"
    pull_request = "github.event_name == 'pull_request'"
    prefix = f"!cancelled() && ({dispatch} || {optional})"
    if condition in {selected, prefix, f"!cancelled() && {optional}"}:
        return ""
    if condition.startswith(selected + " && "):
        return condition[len(selected + " && "):]
    if condition.startswith(prefix + " && (") and condition.endswith(")"):
        return condition[len(prefix + " && ("):-1]
    release = "needs.verify-release.result == 'success'"
    if condition == f"!cancelled() && (({pull_request} && {optional}) || ({dispatch} && {release}))":
        return f"always() && ({pull_request} || {release})"
    return condition


def result_gate(job, workers):
    """Check the complete result assertion before treating the job as a wrapper."""
    variables = {"PRODUCT_RESULT": workers[0]} if len(workers) == 1 else dict(zip(("BUILD", "INSTALL"), workers))
    scoped_env = {
        "SCOPE": "${{ needs.verification-scope.result }}",
        "PRODUCT_SELECTED": "${{ needs.verification-scope.outputs.product }}",
    }
    env = {**scoped_env, **{key: f"${{{{ needs.{value}.result }}}}" for key, value in variables.items()}}
    success = " && ".join(f'test "${key}" = success' for key in variables)
    skipped = " && ".join(f'test "${key}" = skipped' for key in variables)
    command = (
        'test "$SCOPE" = success || exit 1\n'
        'case "$PRODUCT_SELECTED" in\n'
        f'  true) {success} ;;\n'
        f'  false) {skipped} ;;\n'
        '  *) exit 1 ;;\n'
        'esac'
    )
    steps = job.get("steps", [])
    return (not job.keys() - {"name", "if", "needs", "runs-on", "timeout-minutes", "steps"}
            and job.get("if") == "always()" and job.get("needs") == ["verification-scope", *workers]
            and len(steps) == 1 and not steps[0].keys() - {"name", "env", "run"}
            and steps[0].get("env") == env
            and steps[0].get("run", "").strip() == command)


def validate_result_gates(document, workflow=None):
    jobs = document.get("jobs", {})
    for worker in jobs:
        if worker.endswith("-product"):
            gate = worker.removesuffix("-product")
            if not result_gate(jobs.get(gate, {}), [worker]):
                raise ValueError(f"Invalid required result gate for {worker}: {gate}")
    if workflow == ".github/workflows/sdk-ci.yml":
        if not result_gate(jobs.get("required", {}), ["build", "install"]):
            raise ValueError("Invalid SDK qualification result gate")


def workflow_execution(document):
    """Compare worker definitions after removing the known selector wiring."""
    document = dict(document)
    jobs = document.pop("jobs")
    wrappers = {
        job_id for job_id, job in jobs.items()
        if f"{job_id}-product" in jobs and result_gate(job, [f"{job_id}-product"])
    }
    workers = {}
    for job_id, definition in jobs.items():
        job = dict(definition)
        if job_id == "verification-scope" or job_id in wrappers:
            continue
        # The SDK already has a result-only gate; the scope runs that gate.
        needs = job.pop("needs", [])
        if isinstance(needs, str):
            needs = [needs]
        needs = [name for name in needs if name != "verification-scope"]
        if job_id == "required" and needs == ["build", "install"]:
            legacy = definition.get("needs") == ["build", "install"]
            if (legacy or result_gate(definition, ["build", "install"])) and needs == ["build", "install"]:
                continue
        if needs:
            job["needs"] = needs
        condition = job_condition(job.pop("if", None))
        if condition:
            job["if"] = condition
        key = job_id.removesuffix("-product") if job_id.removesuffix("-product") in wrappers else job_id
        job.pop("name", None)
        workers[key] = job
    return document, workers


def uses_changed_action(document, action_paths):
    if not action_paths:
        return False
    _, jobs = workflow_execution(document)
    for job in jobs.values():
        for step in job.get("steps", []):
            use = step.get("uses", "")
            if use.startswith("./") and any(name.startswith(use[2:].rstrip("/") + "/") for name in action_paths):
                return True
    return False


def workflow_needs_product(workflow, controls, scripts, before, head):
    prefix = ".github/workflows/"
    if not workflow.startswith(prefix):
        return True
    actions = {name for name in controls if name.startswith(".github/actions/")}
    verifier_paths = registered_check_paths(before) & registered_check_paths(head)
    executable_changed = bool(scripts or (controls & verifier_paths) - {
        name for name in verifier_paths if name.startswith(CONTROL_DIRECTORIES)
    })
    if workflow not in controls and not actions and not executable_changed:
        return False
    try:
        candidate = yaml_data(git("show", f"{head}:{workflow}"))
        selector = candidate["jobs"]["verification-scope"]
        primary = any(
            step.get("with", {}).get("validate") in {"true", True}
            for step in selector["steps"]
        )
        if (executable_changed and primary) or uses_changed_action(candidate, actions):
            return True
        return workflow in controls and workflow_execution(
            yaml_data(git("show", f"{before}:{workflow}"))
        ) != workflow_execution(candidate)
    except SELECTION_ERRORS + (TypeError, AttributeError):
        # An unknown workflow shape cannot prove its worker is unchanged.
        return True


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
    controls, product, scripts = classify(changes(before, head), before, head)
    workflow_ref = os.environ.get("GITHUB_WORKFLOW_REF", "")
    workflow = workflow_ref.split("/", 2)[-1].split("@", 1)[0]
    if not product and workflow:
        product = workflow_needs_product(workflow, controls, scripts, before, head)
    return controls, product, scripts


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
