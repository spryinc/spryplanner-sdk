"""Carry successful definition validation for matching GitHub candidates."""

from fnmatch import fnmatchcase
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import sys

from github_updates import acquire_commit, api, authenticated_revision, checked_parent
from github_updates import environment_key, workflow_path, WORKFLOW_PATH
from scope import CONTRACTS, changes, classify, git, load_suites, yaml_data


STEP = "Record successful definition validation"
NO_PROOF = (OSError, subprocess.SubprocessError, KeyError, TypeError, ValueError)


def validation_key(selection, tested, workflow):
    selected = json.loads(Path(selection).read_bytes())
    controls = set(selected["controls"])
    if CONTRACTS.is_file():
        contracts = json.loads(CONTRACTS.read_bytes())
        if any(commands and (path in controls or str(CONTRACTS) in controls)
               for path, commands in contracts.items()):
            return None
    inputs = [tested, workflow, selected, os.environ["ImageVersion"], environment_key()]
    return sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()


def reusable_validation(tested, current_attempt, key):
    if (current_attempt <= 1 or not key or not os.environ.get("GH_TOKEN")
            or os.environ.get("GITHUB_JOB") != "verification-scope"):
        return None
    repo = os.environ["GITHUB_REPOSITORY"]
    repo_id = int(os.environ["GITHUB_REPOSITORY_ID"])
    prefix = repo + "/"
    workflow_ref = os.environ["GITHUB_WORKFLOW_REF"]
    path, _, ref = workflow_ref.removeprefix(prefix).partition("@")
    if not workflow_ref.startswith(prefix) or not WORKFLOW_PATH.fullmatch(path):
        return None
    event = os.environ["GITHUB_EVENT_NAME"]
    payload = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_bytes())
    pr = payload.get("pull_request")
    if event == "pull_request":
        if not pr or pr["head"]["repo"]["id"] != repo_id or ref != f"refs/pull/{pr['number']}/merge":
            return None
        head = pr["head"]["sha"]
    elif event == "push" and ref == os.environ["GITHUB_REF"]:
        head = tested
    else:
        return None
    selector = yaml_data(git("show", f"{tested}:{path}"))["jobs"]["verification-scope"]
    job_name = selector.get("name", "verification-scope")
    if "${{" in job_name:
        return None
    run_id = int(os.environ["GITHUB_RUN_ID"])
    run = api(f"actions/runs/{run_id}")
    if (run["id"], run["repository"]["id"], run["event"], run["head_sha"],
            run["path"].split("@", 1)[0], run["run_attempt"]) != (
            run_id, repo_id, event, head, path, current_attempt):
        return None
    jobs = api(f"actions/runs/{run_id}/jobs", filter="all", per_page=100)["jobs"]
    results, failed_selectors, seen = [], set(), set()
    for job in jobs:
        attempt = job["run_attempt"]
        if (job["run_id"] != run_id or job["name"] != job_name
                or not 0 < attempt < current_attempt):
            continue
        if attempt in seen:
            return None
        seen.add(attempt)
        if job["conclusion"] != "success":
            failed_selectors.add(attempt)
        for step in job.get("steps", ()):
            name = step["name"]
            if name == f"{STEP} {key}" and step["conclusion"] != "skipped":
                results.append((job, step))
    latest = max((job["run_attempt"] for job, _ in results), default=0)
    observations = [(job, step) for job, step in results if job["run_attempt"] == latest]
    if len(observations) != 1 or any(attempt > latest for attempt in failed_selectors):
        return None
    job, step = observations[0]
    if job["conclusion"] != "success" or step["conclusion"] != "success":
        return None
    if pr and authenticated_revision(run, latest, pr["number"]) != tested:
        return None
    return latest, job["id"]


def review_only_delta(previous, tested):
    changed = changes(previous, tested)
    if classify(changed, previous, tested)[0]:
        return False
    policy = load_suites(tested)
    for filename in changed:
        if (not filename.lower().endswith(".md")
                or not any(fnmatchcase(filename, pattern) for pattern in policy["review_only"])
                or any(fnmatchcase(filename, item) for paths in policy["suites"].values() for item in paths)):
            return False
    return True


def reusable_previous_validation(selection, tested, key):
    if (not key or not os.environ.get("GH_TOKEN")
            or os.environ.get("GITHUB_JOB") != "verification-scope"
            or os.environ.get("GITHUB_EVENT_NAME") != "pull_request"):
        return None
    payload = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_bytes())
    if payload.get("action") != "synchronize":
        return None
    pr = payload["pull_request"]
    number, head, branch = pr["number"], pr["head"]["sha"], pr["head"]["ref"]
    repo_id = int(os.environ["GITHUB_REPOSITORY_ID"])
    workflow, workflow_ref = workflow_path(), os.environ["GITHUB_WORKFLOW_REF"]
    if (pr["head"]["repo"]["id"] != repo_id or workflow_ref.split("@", 1)[1] != f"refs/pull/{number}/merge"
            or checked_parent(tested, 2) != head):
        return None
    run_id = int(os.environ["GITHUB_RUN_ID"])
    run = api(f"actions/runs/{run_id}")
    if ((run["id"], run["repository"]["id"], run["head_sha"], run["event"], run["path"].split("@", 1)[0])
            != (run_id, repo_id, head, "pull_request", workflow)):
        return None
    job_name = yaml_data(git("show", f"{tested}:{workflow}"))["jobs"]["verification-scope"].get(
        "name", "verification-scope",
    )
    if "${{" in job_name:
        return None
    records = api(f"actions/workflows/{run['workflow_id']}/runs", per_page=8,
                  branch=branch, event="pull_request")["workflow_runs"]
    for earlier in sorted(records, key=lambda item: item["run_number"], reverse=True):
        if (earlier["run_number"] >= run["run_number"] or earlier["head_sha"] == head
                or earlier["repository"]["id"] != repo_id
                or (earlier.get("head_repository") or {}).get("id") != repo_id
                or earlier["workflow_id"] != run["workflow_id"] or earlier["path"].split("@", 1)[0] != workflow
                or earlier["event"] != "pull_request"
                or not any(item["number"] == number for item in earlier["pull_requests"])):
            continue
        # Only ancestor updates are eligible, including an unchanged tested tree.
        ancestry = subprocess.run(("git", "merge-base", "--is-ancestor", earlier["head_sha"], head),
                                  capture_output=True)
        if ancestry.returncode == 1:
            continue
        attempt = earlier["run_attempt"]
        if ancestry.returncode or type(attempt) is not int or attempt < 1:
            return None
        old = authenticated_revision(earlier, attempt, number)
        if not old or not acquire_commit(old) or checked_parent(old, 2) != earlier["head_sha"]:
            return None
        if not review_only_delta(old, tested):
            continue
        jobs = api(f"actions/runs/{earlier['id']}/attempts/{attempt}/jobs", per_page=100)["jobs"]
        selectors = [job for job in jobs if job["run_attempt"] == attempt
                     and job["run_id"] == earlier["id"] and job["name"] == job_name]
        if len(selectors) != 1 or selectors[0]["conclusion"] != "success":
            return None
        old_key = validation_key(selection, old, workflow_ref)
        steps = [step["conclusion"] for step in selectors[0].get("steps", ())
                 if step["name"] == f"{STEP} {old_key}"]
        if steps == ["success"]:
            return attempt, selectors[0]["id"]
        if steps and steps != ["skipped"]:
            return None
    return None


def main(selection):
    key, proof = "", None
    tested = git("rev-parse", "HEAD").decode().strip()
    if tested != os.environ["GITHUB_SHA"]:
        raise ValueError("Definition validation must use the current GitHub checkout")
    try:
        key = validation_key(selection, tested, os.environ["GITHUB_WORKFLOW_REF"])
        proof = reusable_validation(tested, int(os.environ["GITHUB_RUN_ATTEMPT"]), key)
        if proof is None:
            proof = reusable_previous_validation(selection, tested, key)
    except NO_PROOF:
        print("Prior check-definition evidence unavailable. Run the selected validation.")
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        print(f"key={key or ''}", file=output)
        print(f"execute={json.dumps(proof is None)}", file=output)
    if proof:
        print(f"Carried check-definition validation from attempt {proof[0]}, job {proof[1]}.")


if __name__ == "__main__":
    main(sys.argv[1])
