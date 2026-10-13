"""Real packaged-tool acceptance; adapted from the pinned upstream release smoke.

Legacy metadata fixtures exercise upgrades without making Git City a metadata writer.
"""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def run(args, cwd, env=None, expected_code=0):
    result = subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=True, timeout=120)
    if result.returncode != expected_code:
        raise RuntimeError(f"{args} exited {result.returncode}\n{result.stdout}\n{result.stderr}")
    return result.stdout.strip()


def smoke(binary, version, root):
    env = dict(os.environ)
    env.update({
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": str(root / "gitconfig"),
        "XDG_CACHE_HOME": str(root / "cache"),
        "GIT_REHEARSE_CACHE_DIR": str(root / "rehearsals"),
        "GIT_TERMINAL_PROMPT": "0",
    })
    repo = root / "repo"
    repo.mkdir()

    def git(*args):
        return run(["git", *args], repo, env)

    def rehearse(*args, expected_code=0):
        return json.loads(run([str(binary), "--json", *args], repo, env, expected_code))

    observed_version = run([str(binary), "--version"], repo, env)
    if observed_version != f"git-rehearse {version}":
        raise RuntimeError(f"Unexpected binary version: {observed_version}")
    git("init", "-b", "main")
    git("config", "user.name", "Release test")
    git("config", "user.email", "release-test@example.invalid")
    git("config", "commit.gpgsign", "false")
    (repo / "file.txt").write_bytes(b"before\n")
    git("add", "file.txt")
    git("commit", "-m", "Initial")
    before = git("rev-parse", "HEAD")
    git("checkout", "-b", "feature")
    (repo / "file.txt").write_bytes(b"after\n")
    git("commit", "-am", "Feature")
    expected = git("rev-parse", "HEAD")
    git("checkout", "main")
    preview = rehearse("--keep", "merge", "--ff-only", "feature")
    if not preview["can_apply"] or preview["decision"] != "kept":
        raise RuntimeError(f"Rehearsal was not retained and applicable: {preview}")
    reviewed = run(["git", "rev-parse", "HEAD"], Path(preview["sandbox"]), env)
    if reviewed != expected or git("rev-parse", "HEAD") != before:
        raise RuntimeError("Rehearsal changed the original or produced the wrong commit")
    if (repo / "file.txt").read_bytes() != b"before\n" or git("status", "--porcelain"):
        raise RuntimeError("Rehearsal changed original files or index")
    revision = preview.get("result_revision")
    endpoints = preview.get("result_endpoints")
    if not isinstance(revision, str) or not revision.startswith("rr1:"):
        raise RuntimeError("Packaged tool did not expose a conditional Apply revision")
    if not isinstance(endpoints, dict) or endpoints.get("version") != 1:
        raise RuntimeError("Packaged tool did not expose authoritative endpoint descriptors")
    if endpoints["results"]["HEAD"] != reviewed or endpoints["pre_state"]["HEAD"] != before:
        raise RuntimeError("Public endpoints do not describe the reviewed result")
    # Same-schema upgrades keep a still-applicable open rehearsal and optional data.
    metadata = Path(preview["storage"]["metadata"])
    current = json.loads(metadata.read_bytes())
    current["future_annotation"] = {"saved": ["keep", 42]}
    metadata.write_text(json.dumps(current))
    for _ in range(2):
        reopened = rehearse("show", preview["id"])
        if not reopened["can_apply"] or json.loads(metadata.read_bytes())["future_annotation"] != current["future_annotation"]:
            raise RuntimeError("Open rehearsal did not survive compatible upgrade")
        if reopened.get("result_revision") != revision or reopened.get("result_endpoints") != endpoints:
            raise RuntimeError("Compatible reads changed the reviewed identity")
    protected = (git("show-ref"), git("rev-parse", "HEAD"),
                 (repo / ".git" / "index").read_bytes(),
                 (repo / "file.txt").read_bytes(), metadata.read_bytes())
    wrong_revision = "rr1:" + "0" * (len(revision) - len("rr1:"))
    refused = rehearse("apply", preview["id"], "--expected-result-revision", wrong_revision,
                       expected_code=4)
    if refused.get("kind") != "refused":
        raise RuntimeError("Mismatched result revision was not refused")
    observed = (git("show-ref"), git("rev-parse", "HEAD"),
                (repo / ".git" / "index").read_bytes(),
                (repo / "file.txt").read_bytes(), metadata.read_bytes())
    if observed != protected:
        raise RuntimeError("Conditional Apply refusal changed original or retained state")
    rehearse("apply", preview["id"], "--expected-result-revision", revision)
    if git("rev-parse", "HEAD") != reviewed:
        raise RuntimeError("Apply did not transplant the reviewed commit")
    if (repo / "file.txt").read_bytes() != b"after\n" or git("status", "--porcelain"):
        raise RuntimeError("Apply left unexpected files or index")
    # Build a real stopped merge and retain a user's edited resolution.
    git("checkout", "-b", "conflicting")
    (repo / "file.txt").write_bytes(b"other branch\n")
    git("commit", "-am", "Other branch")
    git("checkout", "main")
    (repo / "file.txt").write_bytes(b"main branch\n")
    git("commit", "-am", "Main branch")
    stopped = rehearse("--keep", "merge", "conflicting", expected_code=2)
    protected_head = git("rev-parse", "HEAD")
    protected_index = (repo / ".git" / "index").read_bytes()
    migration_smoke(stopped, rehearse)
    rehearse("apply", stopped["id"], "--expected-result-revision", revision, expected_code=4)
    if git("rev-parse", "HEAD") != protected_head or (repo / ".git" / "index").read_bytes() != protected_index:
        raise RuntimeError("Incompatible metadata changed the original repository")
    if (repo / "file.txt").read_bytes() != b"main branch\n":
        raise RuntimeError("Incompatible metadata changed original work")
    return {"version": observed_version, "git": git("--version"),
            "rehearsal_apply": "passed", "retained_metadata_migration": "passed",
            "authoritative_endpoints": "passed", "conditional_apply": "passed",
            "conditional_refusal_preserves_state": "passed"}


def migration_smoke(preview, rehearse):
    metadata = Path(preview["storage"]["metadata"])
    backup = metadata.with_name("meta.json.bak")
    edited = Path(preview["sandbox"]) / "file.txt"
    edited.write_bytes(b"saved conflict resolution\n")
    legacy = json.loads(metadata.read_bytes())
    legacy["schema"] = 1
    legacy.pop("carry", None)
    legacy.pop("origin", None)
    legacy["optional_annotation"] = {"notes": [1, None, True]}
    original = (json.dumps(legacy, indent=2) + "\n").encode()
    metadata.write_bytes(original)
    backup.mkdir()
    failure = rehearse("show", preview["id"], expected_code=4)
    if "cannot preserve original metadata" not in failure["message"] or metadata.read_bytes() != original:
        raise RuntimeError("Failed backup did not protect original metadata")
    backup.rmdir()
    for _ in range(2):
        protected = rehearse("show", preview["id"])
        if protected["can_apply"]:
            raise RuntimeError("Legacy originless rehearsal must remain protected")
        migrated = json.loads(metadata.read_bytes())
        if migrated["schema"] != 3 or migrated["optional_annotation"] != legacy["optional_annotation"]:
            raise RuntimeError("Migration lost optional metadata")
        if backup.read_bytes() != original or edited.read_bytes() != b"saved conflict resolution\n":
            raise RuntimeError("Migration lost original metadata or saved sandbox edits")
    # Simulate retry after the original was preserved but migration did not commit.
    metadata.write_bytes(original)
    rehearse("show", preview["id"])
    if backup.read_bytes() != original:
        raise RuntimeError("Retry replaced the original backup")
    incompatible = b'{"schema":999,"id":"preserve-me"}\n'
    metadata.write_bytes(incompatible)
    rehearse("show", preview["id"], expected_code=4)
    if metadata.read_bytes() != incompatible or backup.read_bytes() != original or not edited.exists():
        raise RuntimeError("Incompatible metadata was rewritten or removed")


if __name__ == "__main__":
    binary = Path(sys.argv[1]).resolve()
    toolchain = json.loads(
        (Path(__file__).resolve().parent.parent / "rehearse-toolchain.json").read_text()
    )
    with tempfile.TemporaryDirectory(prefix="git-city-package-smoke-") as directory:
        evidence = smoke(binary, toolchain["version"], Path(directory))
        print(json.dumps(evidence, indent=2))
