"""Carry scoped verification using authenticated GitHub Actions job records."""

from base64 import b64encode
from fnmatch import fnmatchcase
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.parse import urlencode

from scope import FULL, affected_suites, changes, classify, git, load_suites
from updates import OID, SUITE, SuiteResult, decide, snapshot


WORKFLOW = ".github/workflows/ci.yml"
WORKFLOW_PATH = re.compile(r"\.github/workflows/[A-Za-z0-9_.-]+\.ya?ml")
DEFAULT_WORKFLOWS = {WORKFLOW: {"gate": "verify", "name": "Verify"}}
ROUTED_EVENTS = {"pull_request", "push"}
CANDIDATE = ".github/workflows/ci-candidate.yml"
CONTROLS = (CANDIDATE, ".github/actions/verification-scope/action.yml",
            ".github/ci/suites.json", ".github/ci/scope.py", ".github/ci/verify.py",
            ".github/ci/updates.py", ".github/ci/github_updates.py")
RUN_JOB = re.compile(r"Suite ([a-z][a-z0-9-]*) ([0-9a-f]{64})")
SHARED_JOB = re.compile(r"Suites ([a-z][a-z0-9-]*)")
MARKER = re.compile(
    r"Candidate / Tested ([0-9a-f]{40}|[0-9a-f]{64}) for (\d+) "
    r"\[([a-z,0-9-]*)\] \[([a-z,0-9-]*)\] ([0-9a-f]{64})"
)
ACTIVE = {"queued", "in_progress", "waiting", "pending", "requested"}
EXECUTE_STEP = "Execute selected suite"
TESTED_HEAD = 'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"'
REUSE_STEP = "Record matching runner inputs"
MISMATCH_STEP = "Record different runner inputs"


def api(path, **query):
    url = f"repos/{os.environ['GITHUB_REPOSITORY']}/{path}"
    if query:
        url += "?" + urlencode(query)
    raw = subprocess.check_output(("gh", "api", url), timeout=25)
    return json.loads(raw)


def environment_key():
    description = [
        os.environ["ImageOS"],
        os.environ["RUNNER_ARCH"],
        git("--version").decode().strip(),
        subprocess.check_output(("bash", "--version"), timeout=5).decode().splitlines()[0],
        subprocess.check_output(("getconf", "GNU_LIBC_VERSION"), timeout=5).decode().strip(),
    ]
    return sha256(json.dumps(description).encode()).hexdigest()


def verify_environment(expected):
    matches = environment_key() == expected
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        print(f"matches={json.dumps(matches)}", file=output)
    if not matches:
        print("Running live verification with different tools. This result is ineligible for carry-forward.")


def hosted_suites(policy, workflow=WORKFLOW):
    hosted = policy.get("hosted")
    if not isinstance(hosted, dict) or hosted.keys() != policy["suites"].keys():
        raise ValueError("Register an execution job and runtime for every hosted suite")
    profiles = policy.get("hosted_workflows", DEFAULT_WORKFLOWS)
    if not isinstance(profiles, dict) or not profiles:
        raise ValueError("Register the required result of each hosted workflow")
    for path, profile in profiles.items():
        if (not isinstance(path, str) or not WORKFLOW_PATH.fullmatch(path) or path == CANDIDATE
                or not isinstance(profile, dict) or not {"gate", "name"} <= profile.keys()
                or profile.keys() - {"gate", "name", "events"}
                or not isinstance(profile["gate"], str) or not SUITE.fullmatch(profile["gate"])
                or profile["gate"] in {"verification-scope", "tested-candidate"}
                or not isinstance(profile["name"], str) or not profile["name"].strip()):
            raise ValueError(f"Invalid hosted workflow registration for {path}")
        if "events" in profile:
            events = profile["events"]
            if (not isinstance(events, list) or not events
                    or not all(isinstance(event, str) and event in ROUTED_EVENTS for event in events)
                    or len(events) != len(set(events))):
                raise ValueError(f"Invalid hosted workflow events for {path}")
    owned = {}
    registered = set()
    for suite, definition in hosted.items():
        if (not SUITE.fullmatch(suite) or not isinstance(definition, dict)
                or not {"job", "runtime"} <= definition.keys() or definition.keys() - {"job", "runtime", "workflow", "fresh"}
                or not isinstance(definition["job"], str) or not SUITE.fullmatch(definition["job"])
                or definition["job"] in {"verification-scope", "tested-candidate"}
                or not isinstance(definition["runtime"], list) or not definition["runtime"]
                or not all(isinstance(value, str) and value.strip() for value in definition["runtime"])):
            raise ValueError(f"Invalid hosted execution definition for {suite}")
        if type(definition.get("fresh", False)) is not bool:
            raise ValueError(f"Invalid hosted freshness requirement for {suite}")
        owner = definition.get("workflow", WORKFLOW)
        if not isinstance(owner, str) or owner not in profiles or definition["job"] == profiles[owner]["gate"]:
            raise ValueError(f"Invalid hosted workflow owner for {suite}")
        registered.add(owner)
        if owner == workflow:
            owned[suite] = definition
    if registered != profiles.keys() or workflow not in profiles:
        raise ValueError(f"Hosted workflow registrations and suite ownership disagree for {workflow}")
    return owned


def candidate_snapshot(commit, context, environment, *, push_base=None, workflow=WORKFLOW):
    policy = load_suites(commit)
    runtime = {suite: [*definition["runtime"], environment]
               for suite, definition in hosted_suites(policy, workflow).items()}
    return snapshot(commit, {suite: policy["suites"][suite] for suite in runtime}, context=context,
                    common_inputs=(workflow, *CONTROLS), execution_identity=runtime, push_base=push_base)


def unchanged_controls(base, tested, workflow=WORKFLOW):
    return not git("diff", "--name-only", base, tested, "--", workflow, *CONTROLS,
                   ".github/ci", ".github/actions/verification-scope")


def checked_parent(test, base_index):
    return git("rev-parse", f"{test}^{base_index}").decode().strip()


def acquire_commit(oid):
    if not OID.fullmatch(oid):
        return False
    if subprocess.run(("git", "cat-file", "-e", oid + "^{commit}"),
                      capture_output=True).returncode == 0:
        return True
    token = b64encode(("x-access-token:" + os.environ["GH_TOKEN"]).encode()).decode()
    env = dict(os.environ, GIT_CONFIG_COUNT="1",
               GIT_CONFIG_KEY_0=f"http.{os.environ['GITHUB_SERVER_URL']}/.extraheader",
               GIT_CONFIG_VALUE_0="AUTHORIZATION: basic " + token)
    return subprocess.run(("git", "fetch", "--no-tags", "--no-write-fetch-head",
                           os.environ["GITHUB_SERVER_URL"] + "/" + os.environ["GITHUB_REPOSITORY"] + ".git",
                           oid), env=env, timeout=30, capture_output=True).returncode == 0


def shared_jobs(hosted):
    jobs = {}
    for suite, definition in hosted.items():
        jobs.setdefault(definition["job"], []).append(suite)
    return {job: suites for job, suites in jobs.items() if len(suites) > 1}


def actual_state(job, step_name=None):
    steps = job.get("steps", ())
    if any(step["name"] == MISMATCH_STEP and step["conclusion"] == "success" for step in steps):
        return None
    if step_name:
        executed = [step["conclusion"] for step in steps if step["name"] == step_name]
        if executed == ["success"]:
            checks = [step["conclusion"] for step in steps if step["name"] == REUSE_STEP]
            return "success" if checks == ["success"] else None
        if executed == ["failure"] or executed == ["timed_out"]:
            return "failure"
        if executed == ["cancelled"]:
            return "cancelled"
    status, conclusion = job.get("status"), job.get("conclusion")
    if status in ACTIVE:
        return "in_progress"
    if status != "completed":
        return None
    if not step_name and conclusion == "success":
        executed = [step["conclusion"] for step in steps if step["name"] == EXECUTE_STEP]
        if executed == ["success"]:
            checks = [step["conclusion"] for step in steps if step["name"] == REUSE_STEP]
            return "success" if checks == ["success"] else None
    if conclusion == "cancelled":
        return "cancelled"
    if conclusion != "skipped":
        return "failure"
    return None


def worker_scopes(job, groups, selected):
    if match := RUN_JOB.fullmatch(job["name"]):
        suite, fingerprint = match.groups()
        if (selected is None or suite in selected) and not any(suite in members for members in groups.values()):
            yield suite, fingerprint, None
    if match := SHARED_JOB.fullmatch(job["name"]):
        for suite in groups.get(match[1], ()):
            if suite in (selected or ()):
                yield suite, None, f"{EXECUTE_STEP}: {suite}"


def observed_jobs(run, jobs, candidate, groups=None, selected=None):
    for job in jobs:
        if job.get("run_id") != run["id"]:
            continue
        for suite, recorded, step in worker_scopes(job, groups or {}, selected):
            fingerprint = candidate.inputs.get(suite)
            if not fingerprint or (recorded is not None and recorded != fingerprint):
                continue
            if state := actual_state(job, step):
                yield SuiteResult(suite, fingerprint, candidate.context, run["id"],
                                  run["run_number"], job["run_attempt"], job["id"], state)


def authenticated_revision(run, attempt, number):
    if attempt != run["run_attempt"] or not run.get("referenced_workflows"):
        record = api(f"actions/runs/{run['id']}/attempts/{attempt}")
        if (record["id"], record["run_attempt"], record["head_sha"]) != (
                run["id"], attempt, run["head_sha"]):
            return None
    else:
        record = run
    path = f"{os.environ['GITHUB_REPOSITORY']}/{CANDIDATE}"
    ref = f"refs/pull/{number}/merge"
    revisions = {
        workflow["sha"] for workflow in record.get("referenced_workflows") or []
        if ((workflow["path"] in {path, f"{path}@{workflow['sha']}"} and workflow.get("ref") == ref)
            or (workflow["path"] == f"{path}@{ref}" and workflow.get("ref", ref) == ref))
    }
    return revisions.pop() if len(revisions) == 1 else None


def marker_attempts(records, number):
    markers = {}
    for job in records:
        if not (match := MARKER.fullmatch(job["name"])) or int(match[2]) != number:
            continue
        markers.setdefault(job["run_attempt"], set()).add(match.groups())
    return {attempt: values.pop() for attempt, values in markers.items() if len(values) == 1}


def selected_marker(value):
    return set(filter(None, value.split(",")))


def earlier_attempt_results(run, number, attempt, candidate, environment, groups=None):
    jobs = api(f"actions/runs/{run['id']}/jobs", filter="all", per_page=100)["jobs"]
    accepted = {
        number_at_run: selected_marker(marker[3]) for number_at_run, marker in marker_attempts(jobs, number).items()
        if number_at_run < attempt and marker[0] == candidate.tested and marker[4] == environment
        and authenticated_revision(run, number_at_run, number) == candidate.tested
    }
    for number_at_run, selected in accepted.items():
        yield from observed_jobs(run, (job for job in jobs if job["run_attempt"] == number_at_run),
                                 candidate, groups, selected)


def read_history(current, run, payload, head_repo, scopes, *, groups=None, path=WORKFLOW, delay=time.sleep):
    groups = groups or {}
    pr = payload.get("number", 0)
    action = payload.get("action")
    preceding = payload.get("before") if action == "synchronize" else None
    workflow = run["workflow_id"]
    previous, obligations = None, set()
    trusted = current.context.endswith("/internal") and unchanged_controls(current.base, current.tested, path)
    if pr:
        branches = {run["head_branch"]: pr}
    elif trusted:
        linked = api(f"commits/{current.tested}/pulls", per_page=10)
        branches = {item["head"]["ref"]: item["number"] for item in linked
                    if item["merged_at"] and item["merge_commit_sha"] == current.tested
                    and item["head"]["repo"] and item["head"]["repo"]["id"] == head_repo}
    else:
        branches = {}
    ordered = []
    for branch, number in branches.items():
        history = api(f"actions/workflows/{workflow}/runs", per_page=30,
                      event="pull_request", branch=branch)
        ordered.extend((old, number) for old in history["workflow_runs"])
    observations = []
    matched = set()
    for earlier, number in sorted(ordered, key=lambda item: item[0]["run_number"], reverse=True):
        if ((not preceding or previous is not None) and (scopes | obligations) <= matched):
            break
        if (earlier["run_number"] >= run["run_number"]
                or earlier["workflow_id"] != workflow
                or earlier["path"].split("@", 1)[0] != path
                or not earlier.get("head_repository")
                or earlier["head_repository"]["id"] != head_repo
                or not any(item["number"] == number for item in earlier["pull_requests"])):
            continue
        is_previous = bool(pr and earlier["head_sha"] == preceding and previous is None)
        if not trusted and not is_previous:
            continue
        for poll in range(4):
            records = api(f"actions/runs/{earlier['id']}/jobs", filter="all", per_page=100)["jobs"]
            markers = marker_attempts(records, number)
            latest_marker = markers.get(earlier["run_attempt"])
            if latest_marker:
                expected = selected_marker(latest_marker[3])
                present = {suite for job in records
                           if job["run_attempt"] == earlier["run_attempt"]
                           for suite, _, _ in worker_scopes(job, groups, expected)}
                if expected <= present:
                    break
            if not is_previous or earlier["status"] not in ACTIVE or poll == 3:
                break
            delay(5)
        for attempt, (tested, _, required, expected, environment) in sorted(markers.items(), reverse=True):
            selected = selected_marker(expected)
            jobs = [job for job in records if job["run_attempt"] == attempt]
            possible = any(suite in current.inputs and (recorded is None or current.inputs[suite] == recorded)
                           for job in jobs for suite, recorded, _ in worker_scopes(job, groups, selected))
            if not (is_previous and previous is None) and not possible:
                continue
            if authenticated_revision(earlier, attempt, number) != tested:
                continue
            if not acquire_commit(tested) or checked_parent(tested, 2) != earlier["head_sha"]:
                continue
            if not unchanged_controls(current.tested, tested, path):
                continue
            old = candidate_snapshot(tested, current.context, environment, workflow=path)
            if is_previous and previous is None:
                previous = old
                obligations = selected_marker(required)
            if trusted and unchanged_controls(current.base, old.tested, path):
                for record in observed_jobs(earlier, jobs, old, groups, selected):
                    if current.inputs.get(record.scope) == record.fingerprint:
                        observations.append(record)
                        matched.add(record.scope)
    return previous, obligations, observations


def route(selected):
    payload = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    tested = os.environ["GITHUB_SHA"]
    if git("rev-parse", "HEAD").decode().strip() != tested:
        raise ValueError("Workflow and checkout must match the routed candidate")
    prefix = os.environ["GITHUB_REPOSITORY"] + "/"
    workflow_ref = os.environ["GITHUB_WORKFLOW_REF"]
    path = workflow_ref.removeprefix(prefix).split("@", 1)[0]
    if not workflow_ref.startswith(prefix) or not WORKFLOW_PATH.fullmatch(path):
        raise ValueError("Expected the current repository's workflow reference")
    policy = load_suites(tested)
    hosted = hosted_suites(policy, path)
    profile = policy.get("hosted_workflows", DEFAULT_WORKFLOWS)[path]
    event = os.environ["GITHUB_EVENT_NAME"]
    if event not in profile.get("events", ROUTED_EVENTS):
        raise ValueError("Unexpected event for scoped GitHub verification")
    pr = payload.get("pull_request")
    repo = int(os.environ["GITHUB_REPOSITORY_ID"])
    head_repo = pr["head"]["repo"]["id"] if pr else repo
    same_repo = head_repo == repo
    if same_repo:
        run = api(f"actions/runs/{int(os.environ['GITHUB_RUN_ID'])}")
        if run["repository"]["id"] != repo or run["path"].split("@", 1)[0] != path:
            raise ValueError("Unexpected GitHub repository or workflow")
        context = f"{repo}/{run['workflow_id']}/internal"
    else:
        context = f"{repo}/1/fork"
    push = event == "push"
    environment = environment_key()
    current = candidate_snapshot(tested, context, environment, workflow=path,
                                 push_base=payload["before"] if push else None)
    groups = shared_jobs(hosted)
    if selected == ["*"]:
        paths = changes(current.base, current.tested)
        controls, _, _ = classify(paths, current.base, current.tested)
        if affected_suites(paths, controls, policy) == FULL:
            raise ValueError("Register the unowned inputs before qualifying a scoped result")
    if selected != ["*"] and not set(selected) <= policy["suites"].keys():
        raise ValueError("Unknown selected suite")
    scopes = set(current.inputs) if selected == ["*"] else set(selected) & current.inputs.keys()
    update = payload.get("action") == "synchronize"
    fresh = {suite for suite, definition in hosted.items() if definition.get("fresh")}
    historical = scopes - fresh
    previous, obligations, observations = read_history(current, run, payload, head_repo, historical, groups=groups, path=path) if (
        same_repo and (historical or update)) else (None, set(), [])
    attempt = int(os.environ.get("GITHUB_RUN_ATTEMPT", "1"))
    if same_repo and not push and attempt > 1:
        observations.extend(earlier_attempt_results(run, int(payload["number"]), attempt, current, environment, groups))
    observations = [proof for proof in observations if proof.scope not in fresh]
    retry = (scopes | set(obligations)) & fresh
    if update and previous is None and same_repo and payload.get("before"):
        before = payload["before"]
        if OID.fullmatch(before) and acquire_commit(before):
            # An edit to the execution definition itself qualifies the affected worker.
            if not unchanged_controls(before, current.head, path):
                retry |= scopes
    decision = decide(current, cumulative=scopes, previous=previous, update=update,
                      prior_obligations=obligations, observations=observations, retry=retry)
    if same_repo and attempt > 1 and decision.unresolved:
        decision = decide(current, cumulative=scopes, previous=previous, update=update,
                          prior_obligations=obligations, observations=observations,
                          retry=retry | set(decision.unresolved))
    wait = []
    for suite, proof in decision.wait.items():
        job = hosted[suite]["job"]
        record = {"job": proof.job_id, "run": proof.run_id, "attempt": proof.attempt,
                  "name": f"Suite {suite} {proof.fingerprint}"}
        if job in groups:
            record.update(name=f"Suites {job}", step=f"{EXECUTE_STEP}: {suite}")
        wait.append(record)
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        required = ",".join(decision.required)
        execute = ",".join(decision.execute)
        print(f"marker=Tested {current.tested} for {int(payload.get('number', 0))} "
              f"[{required}] [{execute}] {environment}", file=output)
        print(f"environment={environment}", file=output)
        for key, value in {"unresolved": list(decision.unresolved), "wait": wait}.items():
            print(f"{key}={json.dumps(value, separators=(',', ':'))}", file=output)
        for suite, fingerprint in current.inputs.items():
            name = suite.replace("-", "_")
            print(f"run_{name}={json.dumps(suite in decision.execute)}", file=output)
            print(f"key_{name}={fingerprint}", file=output)
        for job, suites in groups.items():
            selected_group = any(suite in decision.execute for suite in suites)
            print(f"group_{job.replace('-', '_')}={json.dumps(selected_group)}", file=output)
    print(f"Execute {decision.execute}; carry {[(scope, proof.job_id) for scope, proof in decision.carry.items()]}; "
          f"wait {list(decision.wait)}; unresolved {decision.unresolved}.")


def wait_for_results(records, *, timeout=600, delay=time.sleep):
    deadline = time.monotonic() + timeout
    while records:
        pending = []
        jobs = {job_id: api(f"actions/jobs/{job_id}") for job_id in {int(proof["job"]) for proof in records}}
        for proof in records:
            job = jobs[proof["job"]]
            if (job["id"], job["run_id"], job["run_attempt"], job["name"]) != (
                    proof["job"], proof["run"], proof["attempt"], proof["name"]):
                raise ValueError("Earlier job identity changed")
            state = actual_state(job, proof.get("step"))
            if state == "in_progress":
                pending.append(proof)
            elif state != "success":
                raise ValueError(f"Earlier job {job['id']} did not finish successfully")
        if pending:
            if time.monotonic() >= deadline:
                raise ValueError("Timed out waiting for existing verification jobs")
            delay(15)
        records = pending


def suite_paths(suite):
    inputs = load_suites("HEAD")["suites"][suite]
    for raw in git("ls-files", "-z", "--").split(b"\0"):
        if raw and any(fnmatchcase(os.fsdecode(raw), pattern) for pattern in inputs):
            sys.stdout.buffer.write(raw + b"\0")


def validate_hosted_gate(document, policy, path=WORKFLOW):
    jobs = document["jobs"]
    scope = "verification-scope"
    marker = "tested-candidate"
    workers = hosted_suites(policy, path)
    profile = policy.get("hosted_workflows", DEFAULT_WORKFLOWS)[path]
    registered_events = profile.get("events")
    triggers = document.get("on", ())
    triggers = {triggers} if isinstance(triggers, str) else set(triggers)
    if triggers - ROUTED_EVENTS and not registered_events:
        raise ValueError("Declare the events that use hosted verification")
    route_condition = None
    gate_condition = "always()"
    if registered_events:
        if set(registered_events) != triggers & ROUTED_EVENTS:
            raise ValueError("Hosted verification must cover every PR and push trigger")
        route_condition = " || ".join(f"github.event_name == '{event}'" for event in sorted(registered_events))
        gate_condition += f" && ({route_condition})"
    groups = shared_jobs(workers)
    gate = jobs.get(profile["gate"], {})
    result = lambda job: "${{ needs." + job + ".result }}"
    output = lambda name: "${{ needs." + scope + ".outputs." + name + " }}"
    inputs = {"SCOPE": result(scope), "MARKER": result(marker), "UNRESOLVED": output("unresolved")}
    expected_outputs = ["marker", "environment", "unresolved", "wait"]
    pairs = []
    worker_jobs = {}
    for group in groups:
        expected_outputs.append("group_" + group.replace("-", "_"))
    for suite, definition in workers.items():
        job = definition["job"]
        name = suite.replace("-", "_")
        selected, fingerprint = "run_" + name, "key_" + name
        expected_outputs.extend((selected, fingerprint))
        worker_jobs.setdefault(job, (selected, f"Suite {suite} {output(fingerprint)}", name.upper()))
    for job, (selected, job_name, label) in worker_jobs.items():
        if job in groups:
            selected = "group_" + job.replace("-", "_")
            job_name, label = f"Suites {job}", selected.upper()
        if f"{label}_SELECTED" in inputs:
            raise ValueError(f"Duplicate verification gate label for {job}")
        pairs.append(f'"${label}_SELECTED:${label}_RESULT"')
        inputs[f"{label}_SELECTED"] = output(selected)
        inputs[f"{label}_RESULT"] = result(job)
        if (jobs.get(job, {}).get("needs") != [scope, marker]
                or "continue-on-error" in jobs[job]
                or jobs[job].get("name") != job_name
                or jobs[job].get("if") != f"needs.{scope}.outputs.{selected} == 'true'"
                or sum(other.get("name") == job_name for other in jobs.values()) != 1):
            raise ValueError(f"Inconsistent scoped worker {job}")
        steps = jobs[job].get("steps", [])
        matching = [{
            "id": "runner", "name": "Match registered runner inputs",
            "env": {"EXPECTED": output("environment")},
            "run": 'python3 -B .github/ci/github_updates.py environment "$EXPECTED"',
        }, {
            "name": REUSE_STEP, "if": "steps.runner.outputs.matches == 'true'", "run": "true",
        }, {
            "name": MISMATCH_STEP, "if": "steps.runner.outputs.matches == 'false'", "run": "true",
        }]
        if (not steps or not is_candidate_checkout(steps[0]) or steps[1:4] != matching
                or any("continue-on-error" in step for step in steps)):
            raise ValueError(f"Invalid execution or environment proof for {job}")
        executions = [(index, step) for index, step in enumerate(steps)
                      if step.get("name", "").startswith(EXECUTE_STEP)]
        if job in groups:
            ready = [index for index, step in enumerate(steps) if step == {"id": "ready", "run": "true"}]
            registered = {
                f"{EXECUTE_STEP}: {suite}": "!cancelled() && steps.ready.outcome == 'success' && "
                + f"needs.{scope}.outputs.run_{suite.replace('-', '_')} == 'true'"
                for suite in groups[job]
            }
        else:
            ready, registered = [3], {EXECUTE_STEP: None}
        if (len(ready) != 1 or len(executions) != len(registered)
                or {step["name"] for _, step in executions} != registered.keys()
                or any(index <= ready[0] or step.get("shell") != "bash"
                       or step.get("if") != registered[step["name"]]
                       or not step.get("run", "").startswith(TESTED_HEAD + "\n")
                       or not step["run"][len(TESTED_HEAD):].strip()
                       for index, step in executions)):
            raise ValueError(f"Invalid suite execution wiring for {job}")
    scoped = jobs.get(scope, {})
    scope_steps = scoped.get("steps", [])
    if (scoped.get("if") != route_condition
            or scoped.get("outputs") != {name: "${{ steps.route.outputs." + name + " }}"
                                 for name in expected_outputs}
            or len(scope_steps) != 3 or not is_candidate_checkout(scope_steps[0], full=True)
            or scope_steps[1].get("uses") != "./.github/actions/verification-scope"
            or scope_steps[1].get("id") != "scope" or scope_steps[1].get("with") != {"validate": "true"}
            or scope_steps[2].get("id") != "route" or "if" in scope_steps[2]
            or scope_steps[2].get("env", {}).get("SELECTED") != "${{ steps.scope.outputs.suites }}"
            or scope_steps[2].get("run") != 'python3 -B .github/ci/github_updates.py route "$SELECTED"'
            or jobs.get(marker) != {"name": "Candidate", "needs": scope, "uses": f"./{CANDIDATE}",
                                    "with": {"marker": output("marker")}}):
        raise ValueError("Invalid scoped decision or candidate workflow wiring")
    steps = gate.get("steps", [])
    status = """test "$SCOPE" = success && test "$MARKER" = success || exit 1
test "$UNRESOLVED" = '[]' || { printf 'Unresolved verification: %s\\n' "$UNRESOLVED"; exit 1; }
pairs=(""" + " ".join(pairs) + """)
for pair in "${pairs[@]}"; do
  case "$pair" in
    true:success|false:skipped) ;;
    *) exit 1 ;;
  esac
done"""
    waiting = f"needs.{scope}.outputs.wait != '[]'"
    if (gate.get("name") != profile["name"] or gate.get("if") != gate_condition
            or gate.get("needs") != [scope, marker, *worker_jobs]
            or gate.keys() - {"name", "if", "needs", "permissions", "runs-on", "timeout-minutes", "steps"}
            or len(steps) != 3 or steps[0].get("env") != inputs
            or steps[0].keys() != {"name", "env", "run"} or steps[0].get("run", "").strip() != status
            or steps[1].get("if") != waiting
            or not re.fullmatch(r"actions/checkout@[a-f0-9]{40}", steps[1].get("uses", ""))
            or steps[1].get("with") != {"persist-credentials": "false"}
            or steps[1].keys() != {"uses", "if", "with"}
            or steps[2] != {
                "name": "Await previously started verification", "if": waiting,
                "env": {"GH_TOKEN": "${{ github.token }}", "WAIT": output("wait")},
                "run": 'python3 -B .github/ci/github_updates.py wait "$WAIT"',
            }):
        raise ValueError("Invalid scoped Verify result gate")
    return set(worker_jobs)


def is_candidate_checkout(step, *, full=False):
    inputs = {"persist-credentials": "false"}
    if full:
        inputs["fetch-depth"] = "0"
    return (step.keys() == {"uses", "with"} and step["with"] == inputs
            and re.fullmatch(r"actions/checkout@[a-f0-9]{40}", step["uses"]))


if __name__ == "__main__":
    try:
        operation, value = sys.argv[1:]
        operations = {"route": route, "wait": wait_for_results, "suite-paths": suite_paths,
                      "environment": verify_environment}
        operations[operation](value if operation == "environment" else json.loads(value))
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        sys.exit(f"Scoped GitHub verification: {error}")
