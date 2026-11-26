"""Install, preview or verify a pinned Spry CI starter."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


LOCK = ".github/ci/template-lock.json"
MANAGED = {
    ".github/actions/verification-scope/action.yml": ".github/actions/verification-scope/action.yml",
    ".github/workflows/ci-candidate.yml": ".github/workflows/ci-candidate.yml",
    **{f".github/ci/{name}": f".github/ci/{name}" for name in (
        "scope.py", "updates.py", "github_updates.py", "verify.py", "test_scope.py", "test_verify.py",
    )},
    ".github/ci/template_sync.py": "templates/ci/sync.py",
}
ADAPTERS = {
    ".github/ci/suites.json": "templates/ci/suites.example.json",
    ".github/workflows/ci.yml": "templates/ci/workflow.example.yml",
}
OID = re.compile(r"[a-f0-9]{40}")
DIGEST = re.compile(r"[a-f0-9]{64}")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def checkout_path(repo, name):
    target = repo
    components = name.split("/")
    for index, component in enumerate(components):
        target /= component
        if target.is_symlink():
            raise ValueError(f"Refusing linked path: {name}")
        if index < len(components) - 1 and target.exists() and not target.is_dir():
            raise ValueError(f"Not a directory: {target}")
    return target


def read_lock(repo, *, allow_older=False):
    target = checkout_path(repo, LOCK)
    if not target.exists():
        return None
    return decode_lock(target.read_bytes(), allow_older=allow_older)


def decode_lock(data, *, allow_older=False):
    lock = json.loads(data)
    files = lock["files"]
    overrides = lock["overrides"]
    if (not OID.fullmatch(lock["revision"])
            or not all(name == ".github/workflows/ci-candidate.yml" or re.fullmatch(
                r"\.github/(?:ci/[a-z0-9][a-z0-9_.-]*|actions/verification-scope/action\.yml)", name)
                for name in files)
            or (not allow_older and files.keys() != MANAGED.keys())
            or ".github/ci/suites.json" not in lock["adapters"]
            or not any(name.startswith(".github/workflows/") for name in lock["adapters"])
            or not all(name == ".github/ci/suites.json"
                       or re.fullmatch(r"\.github/workflows/[a-zA-Z0-9_.-]+\.ya?ml", name)
                       for name in lock["adapters"])
            or not overrides.keys() <= files.keys()
            or not all(DIGEST.fullmatch(value) for value in files.values())):
        raise ValueError(f"Invalid template pin: {LOCK}")
    for name, metadata in overrides.items():
        if (not metadata["owner"].strip() or not metadata["reason"].strip()
                or not DIGEST.fullmatch(metadata["sha256"])):
            raise ValueError(f"Invalid override: {name}")
    return lock


def drift_paths(repo, lock):
    bad = [name for name in lock["adapters"] if not checkout_path(repo, name).is_file()]
    for name, expected in lock["files"].items():
        path = checkout_path(repo, name)
        override = lock["overrides"].get(name)
        if override:
            expected = override["sha256"]
        if not path.is_file() or digest(path.read_bytes()) != expected:
            bad.append(name)
    return sorted(bad)


def git(repo, *args):
    return subprocess.check_output(("git", "-C", str(repo), *args), stderr=subprocess.PIPE)


def resolve_commit(source, revision):
    commit = git(source, "rev-parse", "--verify", "--end-of-options", revision + "^{commit}").decode().strip()
    if not OID.fullmatch(commit):
        raise ValueError("Expected an immutable Git commit")
    return commit


def template_files(source, revision):
    commit = resolve_commit(source, revision)
    return commit, {
        target: git(source, "show", f"{commit}:{file}")
        for target, file in (MANAGED | ADAPTERS).items()
    }


def legacy_files(source, revision):
    commit = resolve_commit(source, revision)
    files = set(git(source, "ls-tree", "-r", "-z", "--name-only", commit).decode().split("\0"))
    return {
        target: git(source, "show", f"{commit}:{file}")
        for target, file in MANAGED.items()
        if file in files
    }


def plan(repo, revision, content, legacy):
    current = read_lock(repo, allow_older=True)
    overrides = current["overrides"] if current else {}
    conflicts = []
    if current:
        conflicts.extend(current["files"].keys() - MANAGED.keys())
        for name in drift_paths(repo, current):
            target = checkout_path(repo, name)
            if (name in current["adapters"] or name not in content or name in overrides or not target.is_file()
                    or target.read_bytes() != content[name]):
                conflicts.append(name)
    writes = {}
    for name in MANAGED:
        target = checkout_path(repo, name)
        if name in overrides:
            continue
        if target.exists():
            if not target.is_file():
                conflicts.append(name)
                continue
            data = target.read_bytes()
            if data == content[name]:
                continue
            if (current is None and data != legacy.get(name)
                    or current is not None and name not in current["files"]):
                conflicts.append(name)
                continue
        writes[name] = content[name]
    workflows = checkout_path(repo, ".github/workflows")
    adapters = {".github/ci/suites.json"}
    if workflows.is_dir():
        adapters.update(
            f".github/workflows/{path.name}"
            for path in workflows.iterdir()
            if path.suffix in {".yml", ".yaml"} and path.is_file()
            and f".github/workflows/{path.name}" not in MANAGED
        )
    if len(adapters) == 1:
        adapters.add(".github/workflows/ci.yml")
    if current is None:
        seeded_ci = (".github/workflows/ci.yml" in adapters
                     and not checkout_path(repo, ".github/workflows/ci.yml").exists())
        for name in adapters & ADAPTERS.keys():
            target = checkout_path(repo, name)
            if not target.exists():
                if name == ".github/ci/suites.json" and not seeded_ci:
                    policy = json.loads(content[name])
                    del policy["hosted"]
                    writes[name] = (json.dumps(policy, indent=2) + "\n").encode()
                else:
                    writes[name] = content[name]
            elif not target.is_file():
                conflicts.append(name)
    for name in adapters:
        checkout_path(repo, name)
    lock = {
        "revision": revision,
        "files": {name: digest(content[name]) for name in MANAGED},
        "adapters": sorted(adapters),
        "overrides": overrides,
    }
    if current != lock:
        writes[LOCK] = (json.dumps(lock, indent=2) + "\n").encode()
    state = "drift" if conflicts else "bootstrap" if current is None else "update" if writes else "current"
    return {
        "status": state,
        "from": current["revision"] if current else None,
        "to": revision,
        "changes": list(writes),
        "conflicts": sorted(set(conflicts)),
        "overrides": sorted(overrides),
    }, writes


def apply_writes(repo, writes):
    for name, data in writes.items():
        target = checkout_path(repo, name)
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor, staged = tempfile.mkstemp(prefix=".spry-ci-", dir=target.parent)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(data)
            os.chmod(staged, 0o644)
            os.replace(staged, target)
        finally:
            Path(staged).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("check", "preview", "apply", "fleet"))
    parser.add_argument("--repo", type=Path, action="append")
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--revision")
    parser.add_argument("--from-revision", help="Known central baseline for an unpinned checkout")
    parser.add_argument("--organization", help="GitHub organization for a read-only fleet report")
    args = parser.parse_args()
    repositories = args.repo or [Path.cwd()]
    if args.mode == "apply" and len(repositories) != 1:
        parser.error("Apply updates one reviewable repository at a time")
    if args.mode != "check" and not args.revision:
        parser.error("Preview, apply and fleet require a template revision")
    if args.mode == "fleet" and (not args.organization or args.repo):
        parser.error("Fleet requires --organization and uses each repository's default branch")
    if args.mode != "fleet" and args.organization:
        parser.error("--organization is only used by fleet")
    if args.mode == "check" and args.from_revision:
        parser.error("Offline check cannot use a baseline revision")
    content = template_files(args.source, args.revision) if args.mode != "check" else None
    legacy = legacy_files(args.source, args.from_revision) if args.from_revision else {}
    if args.mode == "fleet":
        try:
            from fleet import report
        except ModuleNotFoundError as error:
            if error.name != "fleet":
                raise
            raise ValueError("Run fleet from the Platform Dev template checkout") from error
        return report(args.organization, args.source, *content, legacy)
    failed = False
    for repo in repositories:
        repo = repo.resolve(strict=True)
        root = git(repo, "rev-parse", "--show-toplevel").decode().rstrip("\n")
        if Path(root).resolve() != repo:
            raise ValueError(f"Expected a Git checkout root: {repo}")
        if args.mode == "check":
            lock = read_lock(repo)
            if lock is None:
                raise ValueError(f"Missing template pin: {LOCK}")
            conflicts = drift_paths(repo, lock)
            print(json.dumps({"repo": str(repo), "revision": lock["revision"],
                              "status": "drift" if conflicts else "current", "conflicts": conflicts}))
            failed |= bool(conflicts)
            continue
        report, writes = plan(repo, *content, legacy)
        print(json.dumps({"repo": str(repo), **report}))
        failed |= bool(report["conflicts"])
        if args.mode == "apply" and not failed:
            apply_writes(repo, writes)
    return int(failed)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError, AttributeError, subprocess.CalledProcessError) as error:
        print(f"CI template: {error}", file=sys.stderr)
        sys.exit(1)
