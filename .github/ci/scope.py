"""Select check-definition and product verification from the same Git diff."""

from importlib import invalidate_caches
import json
from fnmatch import fnmatchcase
import os
import re
import subprocess
import sys
from pathlib import Path


CONTROL_DIRECTORIES = (".github/workflows/", ".github/actions/", ".github/ci/", ".husky/", ".githooks/", "scripts/ci/")
LINT_CONFIG = {".github/actionlint.yaml", ".github/actionlint.yml"}
CONTRACTS = Path(".github/ci/contracts.json")
SUITES = Path(".github/ci/suites.json")
FULL = {"*"}
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


# Supports deferred PyYAML installation in GitHub Actions.
def install_pinned_yaml(target):
    if not (Path(target) / "yaml" / "__init__.py").is_file():
        try:
            subprocess.run(
                (sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
                 "--target", target, "PyYAML==6.0.3"),
                check=True,
            )
        except (OSError, subprocess.CalledProcessError) as error:
            raise RuntimeError("Cannot install the pinned workflow YAML parser") from error
        invalidate_caches()


def yaml_data(source):
    if target := os.environ.get("SPRY_CI_YAML_TARGET"):
        install_pinned_yaml(target)
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


def suite_condition(suite):
    ref = "fromJSON(needs.verification-scope.outputs.suites)"
    return f"contains({ref}, '*') || contains({ref}, '{suite}')"


def selection_expression(suite):
    return "${{ " + suite_condition(suite) + " }}"


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
    actual = steps[0].get("env", {}) if len(steps) == 1 else {}
    if len(workers) == 1 and actual.get("PRODUCT_SELECTED") == selection_expression(workers[0].removesuffix("-product")):
        env["PRODUCT_SELECTED"] = actual["PRODUCT_SELECTED"]
    if workers == ["build", "install"] and actual.get("INSTALL_SELECTED") == selection_expression("sdk"):
        env["INSTALL_SELECTED"] = actual["INSTALL_SELECTED"]
        command = command.replace(success, 'test "$BUILD" = success').replace(skipped, 'test "$BUILD" = skipped')
        command += (
            '\ncase "$INSTALL_SELECTED" in\n'
            '  true) test "$INSTALL" = success ;;\n'
            '  false) test "$INSTALL" = skipped ;;\n'
            '  *) exit 1 ;;\n'
            'esac'
        )
    return (not job.keys() - {"name", "if", "needs", "runs-on", "timeout-minutes", "steps"}
            and job.get("if") == "always()" and job.get("needs") == ["verification-scope", *workers]
            and len(steps) == 1 and not steps[0].keys() - {"name", "env", "run"}
            and steps[0].get("env") == env
            and steps[0].get("run", "").strip() == command)


def validate_result_gates(document, workflow=None, *, hosted_workers=()):
    jobs = document.get("jobs", {})
    for worker in jobs:
        if worker.endswith("-product") and worker not in hosted_workers:
            gate = worker.removesuffix("-product")
            if not result_gate(jobs.get(gate, {}), [worker]):
                raise ValueError(f"Invalid required result gate for {worker}: {gate}")
            selected = jobs[gate]["steps"][0]["env"]["PRODUCT_SELECTED"]
            if selected == selection_expression(gate) and jobs[worker].get("if") != suite_condition(gate):
                raise ValueError(f"Suite selection mismatch for {worker}: {gate}")
    if workflow == ".github/workflows/sdk-ci.yml":
        if not result_gate(jobs.get("required", {}), ["build", "install"]):
            raise ValueError("Invalid SDK qualification result gate")
        sdk = jobs["required"]["steps"][0]["env"].get("INSTALL_SELECTED")
        if sdk and (jobs["install"].get("needs") != ["verification-scope", "build"] or jobs["install"].get("if") != suite_condition("sdk")):
            raise ValueError("SDK installation selection mismatch")


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


def load_suites(revision):
    policy = json.loads(git("show", f"{revision}:{SUITES}"))
    required = {"suites", "review_only", "release_branches"}
    if (not isinstance(policy, dict) or not required <= policy.keys()
            or policy.keys() - required - {"affected_main_push", "hosted", "hosted_workflows"}
            or type(policy.get("affected_main_push", False)) is not bool):
        raise ValueError("Invalid hosted verification policy")
    suites = policy["suites"]
    patterns = [policy["review_only"], policy["release_branches"]]
    if not isinstance(suites, dict) or not suites:
        raise ValueError("Missing hosted verification suites")
    for name, inputs in suites.items():
        if not re.fullmatch(r"[a-z][a-z0-9-]*", name) or not inputs:
            raise ValueError("Invalid hosted verification suite")
        patterns.append(inputs)
    for inputs in patterns:
        if not isinstance(inputs, list) or any(
            not isinstance(pattern, str) or not pattern for pattern in inputs
        ):
            raise ValueError("Invalid hosted verification paths")
    return policy


def suites_covering(path, policy):
    return {
        suite for suite, inputs in policy["suites"].items()
        if any(fnmatchcase(path, pattern) for pattern in inputs)
    }


def review_only_path(path, policy):
    return any(fnmatchcase(path, pattern) for pattern in policy["review_only"])


def affected_suites(paths, controls, policy):
    selected = set()
    for path in sorted(paths):
        matches = suites_covering(path, policy)
        if matches:
            selected.update(matches)
        elif path not in controls and not review_only_path(path, policy):
            print(f"No hosted test owner for {path}; select full verification.")
            return FULL
    return selected


def policy_changes_with_product(paths, before, policy):
    if not paths:
        return False
    try:
        base_policy = load_suites(before)
    except SELECTION_ERRORS + (TypeError, AttributeError):
        return True
    return any(
        not path.lower().endswith(".md")
        or not review_only_path(path, rules)
        or suites_covering(path, rules)
        for path in paths for rules in (base_policy, policy)
    )


def github_selection():
    event = os.environ["GITHUB_EVENT_NAME"]
    if event not in {"pull_request", "push"}:
        return set(), True, set(), FULL
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
    paths = changes(before, head)
    controls, product, scripts = classify(paths, before, head)
    workflow_ref = os.environ.get("GITHUB_WORKFLOW_REF", "")
    workflow = workflow_ref.split("/", 2)[-1].split("@", 1)[0]
    if not SUITES.is_file():
        selected = FULL if paths and (product or (workflow and workflow_needs_product(workflow, controls, scripts, before, head))) else set()
        return controls, bool(selected), scripts, selected

    policy = load_suites(head)
    branch = (os.environ.get("GITHUB_BASE_REF") if event == "pull_request"
              else os.environ.get("GITHUB_REF", payload.get("ref", "")).removeprefix("refs/heads/"))
    main_release = event == "push" and branch == "main" and not policy.get("affected_main_push")
    if event == "push" and (branch in policy["release_branches"] or main_release):
        return controls, True, scripts, FULL

    selected = affected_suites(paths, controls, policy)
    release_checkout_inputs = {
        "packages/sdk-typescript/README.md",
        "packages/sdk-typescript/CHANGELOG.md",
        "packages/sdk-typescript/RELEASING.md",
        "tools/release.mjs",
    }
    if event == "push" and branch == "main" and paths & release_checkout_inputs:
        selected.add("sdk")
    if str(SUITES) in paths and policy_changes_with_product(
        paths - controls - {"AGENTS.md", "CLAUDE.md"}, before, policy,
    ):
        print("Hosted test ownership and product inputs changed together; select full verification.")
        selected = FULL
    if workflow and controls and workflow_needs_product(workflow, controls, scripts, before, head):
        selected = FULL
    return controls, bool(selected), scripts, selected


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
        controls, product, scripts, suites = github_selection()
    except SELECTION_ERRORS:
        print("Git comparison unavailable. Select product verification.")
        controls, product, scripts, suites = set(), True, set(), FULL

    workflow = any(
        path.startswith((".github/workflows/", ".github/actions/")) or path in LINT_CONFIG
        for path in controls
    )
    if str(SUITES) in controls and SUITES.is_file():
        workflow |= "hosted" in json.loads(SUITES.read_text())
    Path(args[0]).write_text(json.dumps({"controls": sorted(controls), "scripts": sorted(scripts)}))
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        for key, selected in (("product", product), ("checks", bool(controls)), ("workflows", workflow)):
            print(f"{key}={str(selected).lower()}", file=output)
        print(f"suites={json.dumps(sorted(suites))}", file=output)
    print(f"Selected hosted suites: {sorted(suites)}; check-definition paths: {len(controls)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SELECTION_ERRORS:
        sys.exit(1)
