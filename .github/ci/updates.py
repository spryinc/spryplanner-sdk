"""Select fresh verification and carry matching results for a tested Git tree."""

from collections.abc import Mapping
from dataclasses import dataclass
from fnmatch import fnmatchcase
from hashlib import sha256
import json
import os
import re
from types import MappingProxyType

from scope import git


SUITE = re.compile(r"[a-z][a-z0-9-]*")
OID = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
FINGERPRINT = re.compile(r"[0-9a-f]{64}")
CONTEXT = re.compile(r"[1-9][0-9]*/[1-9][0-9]*/[a-z][a-z0-9-]*")


@dataclass(frozen=True)
class ScopeSnapshot:
    """The tested commit, its comparison endpoints and each suite's inputs."""

    tested: str
    base: str
    head: str
    context: str
    inputs: Mapping[str, str]

    def __post_init__(self):
        if not all(OID.fullmatch(oid) for oid in (self.tested, self.base, self.head)):
            raise ValueError("Expected complete Git object IDs")
        if not CONTEXT.fullmatch(self.context):
            raise ValueError("Expected repository, workflow and trust boundary identity")
        inputs = dict(self.inputs)
        if not inputs or not all(
            SUITE.fullmatch(suite) and FINGERPRINT.fullmatch(value)
            for suite, value in inputs.items()
        ):
            raise ValueError("Expected one input fingerprint per registered suite")
        object.__setattr__(self, "inputs", MappingProxyType(inputs))


@dataclass(frozen=True)
class SuiteResult:
    """A job observation already authenticated by the calling CI adapter."""

    scope: str
    fingerprint: str
    context: str
    run_id: int
    run_number: int
    attempt: int
    job_id: int
    state: str

    def __post_init__(self):
        if (not SUITE.fullmatch(self.scope) or not FINGERPRINT.fullmatch(self.fingerprint)
                or not CONTEXT.fullmatch(self.context)
                or any(type(number) is not int or number < 1
                       for number in (self.run_id, self.run_number, self.attempt, self.job_id))
                or self.state not in {"success", "failure", "cancelled", "in_progress"}):
            raise ValueError("Invalid verification job observation")


@dataclass(frozen=True)
class VerificationDecision:
    required: tuple[str, ...]
    execute: tuple[str, ...]
    carry: dict[str, SuiteResult]
    wait: dict[str, SuiteResult]
    unresolved: tuple[str, ...]


def snapshot(tested, suites, *, context, common_inputs, execution_identity, push_base=None):
    """Fingerprint the checked-out merge or an actual push candidate."""
    if (not OID.fullmatch(tested) or not suites or not common_inputs
            or suites.keys() != execution_identity.keys()):
        raise ValueError("Expected a tested commit and explicit source and execution inputs")
    if push_base is None:
        parents = git("rev-list", "--parents", "-n", "1", tested).decode().split()
        if len(parents) != 3 or parents[0] != tested:
            raise ValueError("Expected the actual two-parent CI merge commit")
        base, head = parents[1:]
    else:
        if not OID.fullmatch(push_base):
            raise ValueError("Expected the full push comparison base")
        if any(git("cat-file", "-t", oid).strip() != b"commit" for oid in (push_base, tested)):
            raise ValueError("Push verification requires actual commits")
        base, head = push_base, tested
    selected = {suite: [] for suite in suites}
    for entry in git("ls-tree", "-r", "-z", "--full-tree", tested).split(b"\0"):
        if not entry:
            continue
        metadata, raw_path = entry.split(b"\t", 1)
        name = os.fsdecode(raw_path)
        common = any(fnmatchcase(name, pattern) for pattern in common_inputs)
        for suite, paths in suites.items():
            if common or any(fnmatchcase(name, pattern) for pattern in paths):
                selected[suite].append((name, metadata.decode()))
    fingerprints = {}
    for suite, paths in suites.items():
        identity = execution_identity[suite]
        if not paths or not identity or not selected[suite]:
            raise ValueError(f"Incomplete verification inputs for {suite}")
        encoded = json.dumps(
            [1, suite, sorted(common_inputs), sorted(paths), identity, selected[suite]],
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode()
        fingerprints[suite] = sha256(encoded).hexdigest()
    return ScopeSnapshot(tested, base, head, context, fingerprints)


def decide(
    current,
    *,
    cumulative,
    previous=None,
    update=False,
    prior_obligations=(),
    observations=(),
    retry=(),
):
    """Keep the required result separate from the work eligible on this event."""
    cumulative, prior_obligations, retry = map(set, (cumulative, prior_obligations, retry))
    if not (cumulative | prior_obligations | retry) <= current.inputs.keys():
        raise ValueError("Unknown verification obligation")
    if not update and (previous is not None or prior_obligations):
        raise ValueError("A previous candidate requires an update")
    if previous is not None and current.context != previous.context:
        raise ValueError("Previous candidate crosses a verification trust boundary")
    changed = set()
    if previous is not None:
        changed = {
            suite for suite, identity in current.inputs.items()
            if identity != previous.inputs.get(suite)
        }
    required = cumulative | prior_obligations | retry
    eligible = (changed if update else cumulative) | retry
    latest = {}
    conflicts = set()
    for record in observations:
        if (record.context != current.context or record.scope not in required
                or record.fingerprint != current.inputs[record.scope]):
            continue
        existing = latest.get(record.scope)
        order = (record.run_number, record.attempt)
        if existing is None or order > (existing.run_number, existing.attempt):
            latest[record.scope] = record
            conflicts.discard(record.scope)
        elif order == (existing.run_number, existing.attempt) and record != existing:
            conflicts.add(record.scope)
    if conflicts:
        raise ValueError(f"Conflicting latest job observations for {', '.join(sorted(conflicts))}")
    carry, wait, execute, unresolved = {}, {}, [], []
    for suite in sorted(required):
        result = latest.get(suite)
        if result and result.state == "in_progress":
            wait[suite] = result
        elif result and result.state == "success" and suite not in retry:
            carry[suite] = result
        elif suite in eligible:
            execute.append(suite)
        else:
            unresolved.append(suite)
    return VerificationDecision(tuple(sorted(required)), tuple(execute), carry, wait, tuple(unresolved))
