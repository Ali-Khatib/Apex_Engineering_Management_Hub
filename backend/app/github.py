"""GitHub integration: signed webhooks, REST sync (GitHub App/installation token or PAT), demo simulator.
GitHub stays the source of truth: we store a normalized activity mirror, never code."""
import hashlib, hmac, random, uuid
from datetime import datetime
import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session
from . import models as m
from .config import GITHUB_WEBHOOK_SECRET, GITHUB_TOKEN, GITHUB_API
from .events import publish
from .services import notify, admin_ids

def verify_signature(body: bytes, header: str) -> bool:
    if not header.startswith("sha256="):
        return False
    mac = hmac.new(GITHUB_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest("sha256=" + mac, header)

def sign(body: bytes) -> str:
    return "sha256=" + hmac.new(GITHUB_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()

def _upsert(db, repo, kind, ref_id, **f):
    e = db.scalar(select(m.GitHubEvent).where(m.GitHubEvent.repo_id == repo.id, m.GitHubEvent.kind == kind, m.GitHubEvent.ref_id == ref_id))
    if e is None:
        e = m.GitHubEvent(repo_id=repo.id, kind=kind, ref_id=ref_id); db.add(e)
    for k, v in f.items(): setattr(e, k, v)
    e.created_at = datetime.utcnow()
    return e

def _owners(db, repo):
    comps = db.scalars(select(m.Component).where(m.Component.repo_id == repo.id)).all()
    return comps, [c.owner_id for c in comps if c.owner_id]

def process_event(db: Session, event: str, p: dict, delivery_id: str | None = None) -> dict:
    full = (p.get("repository") or {}).get("full_name")
    repo = db.scalar(select(m.Repository).where(m.Repository.full_name == full))
    if not repo:
        return {"ignored": f"unknown repository {full}"}
    if delivery_id and db.scalar(select(m.GitHubEvent).where(m.GitHubEvent.delivery_id == delivery_id)):
        return {"ignored": "duplicate delivery"}
    comps, owners = _owners(db, repo)
    n = 0
    if event == "push":
        for c in (p.get("commits") or [])[:10]:
            _upsert(db, repo, "push", c["id"][:7], title=c["message"].split("\n")[0][:300], state="pushed",
                    author=(c.get("author") or {}).get("name", ""), url=c.get("url", ""), delivery_id=delivery_id if n == 0 else None); n += 1
    elif event == "pull_request":
        pr = p["pull_request"]; state = "merged" if pr.get("merged") else pr["state"]
        _upsert(db, repo, "pull_request", str(pr["number"]), title=pr["title"][:300], state=state,
                author=pr["user"]["login"], url=pr["html_url"], delivery_id=delivery_id, payload={"action": p.get("action")}); n = 1
        notify(db, owners, f"PR #{pr['number']} {state}: {pr['title'][:80]}", comps[0].id if comps else None)
    elif event == "pull_request_review":
        r, pr = p["review"], p["pull_request"]
        _upsert(db, repo, "review", f"{pr['number']}-{r['id']}", title=f"Review on #{pr['number']}: {pr['title'][:80]}",
                state=r["state"].lower(), author=r["user"]["login"], url=r["html_url"], delivery_id=delivery_id); n = 1
    elif event in ("issue_comment", "pull_request_review_comment"):
        c = p["comment"]; num = (p.get("issue") or p.get("pull_request") or {}).get("number", "")
        _upsert(db, repo, "pr_comment", str(c["id"]), title=f"#{num}: {c['body'][:200]}", state="commented",
                author=c["user"]["login"], url=c["html_url"], delivery_id=delivery_id); n = 1
    elif event == "issues":
        i = p["issue"]
        _upsert(db, repo, "issue", str(i["number"]), title=i["title"][:300], state=i["state"],
                author=i["user"]["login"], url=i["html_url"], delivery_id=delivery_id); n = 1
    elif event == "workflow_run":
        w = p["workflow_run"]; state = w.get("conclusion") or w["status"]
        _upsert(db, repo, "workflow", str(w["id"]), title=f"{w['name']} @ {w['head_branch']}", state=state,
                author=(w.get("actor") or {}).get("login", ""), url=w["html_url"], delivery_id=delivery_id); n = 1
        if state == "failure":
            notify(db, owners + admin_ids(db), f"CI failed on {full}: {w['name']}", comps[0].id if comps else None)
    else:
        return {"ignored": f"event {event} not tracked"}
    repo.last_synced = datetime.utcnow()
    db.commit()
    publish("github", {"repo_id": repo.id, "kind": event, "component_ids": [c.id for c in comps]})
    return {"stored": n}

# ---------- REST sync (GitHub App installation token or PAT in GITHUB_TOKEN) ----------
def sync_repo(db: Session, repo: m.Repository) -> dict:
    if not GITHUB_TOKEN:
        return {"skipped": "GITHUB_TOKEN not configured; webhooks and the simulator still work"}
    h = {"Authorization": f"Bearer {GITHUB_TOKEN}", "Accept": "application/vnd.github+json"}
    base = f"{GITHUB_API}/repos/{repo.full_name}"
    stored = 0
    with httpx.Client(timeout=20, headers=h) as c:
        info = c.get(base); info.raise_for_status()
        repo.description = info.json().get("description") or repo.description
        repo.default_branch = info.json().get("default_branch", "main")
        for cm in c.get(f"{base}/commits", params={"per_page": 10}).json():
            _upsert(db, repo, "push", cm["sha"][:7], title=cm["commit"]["message"].split("\n")[0][:300], state="pushed",
                    author=cm["commit"]["author"]["name"], url=cm["html_url"]); stored += 1
        for pr in c.get(f"{base}/pulls", params={"state": "all", "per_page": 15}).json():
            _upsert(db, repo, "pull_request", str(pr["number"]), title=pr["title"], state="merged" if pr.get("merged_at") else pr["state"],
                    author=pr["user"]["login"], url=pr["html_url"]); stored += 1
        for i in c.get(f"{base}/issues", params={"state": "all", "per_page": 15}).json():
            if "pull_request" not in i:
                _upsert(db, repo, "issue", str(i["number"]), title=i["title"], state=i["state"], author=i["user"]["login"], url=i["html_url"]); stored += 1
        runs = c.get(f"{base}/actions/runs", params={"per_page": 10}).json().get("workflow_runs", [])
        for w in runs:
            _upsert(db, repo, "workflow", str(w["id"]), title=f"{w['name']} @ {w['head_branch']}", state=w.get("conclusion") or w["status"],
                    author=(w.get("actor") or {}).get("login", ""), url=w["html_url"]); stored += 1
        rd = c.get(f"{base}/readme", headers={**h, "Accept": "application/vnd.github.raw+json"})
        if rd.status_code == 200: repo.docs_md = rd.text
    repo.last_synced = datetime.utcnow(); db.commit()
    publish("github", {"repo_id": repo.id, "kind": "sync"})
    return {"stored": stored}

# ---------- demo simulator: emits real webhook-shaped payloads through process_event ----------
_DEVS = ["amna-k", "bilal-r", "sara-m", "hamza-t", "noor-a"]
def simulate(db: Session, repo: m.Repository, scenario: str | None = None) -> dict:
    scenario = scenario or random.choice(["push", "pr_opened", "pr_merged", "review", "ci_success", "ci_failure", "issue"])
    r = {"full_name": repo.full_name}; dev = random.choice(_DEVS); num = random.randint(100, 999); sha = uuid.uuid4().hex
    html = f"{repo.url}/pull/{num}"
    pr = {"number": num, "title": random.choice(["Add tenant-scoped repository adapter", "Harden idempotency handling", "Wire audit hook", "Fix schema validation edge case", "Add fixtures for failure scenario"]),
          "state": "open", "merged": False, "html_url": html, "user": {"login": dev}}
    delivery = uuid.uuid4().hex
    if scenario == "push":
        return process_event(db, "push", {"repository": r, "commits": [{"id": sha, "message": random.choice(["feat: implement contract validator\n\nbody", "fix: reject expired grants", "test: cover duplicate writes"]), "author": {"name": dev}, "url": f"{repo.url}/commit/{sha}"}]}, delivery)
    if scenario == "pr_opened": return process_event(db, "pull_request", {"action": "opened", "repository": r, "pull_request": pr}, delivery)
    if scenario == "pr_merged": return process_event(db, "pull_request", {"action": "closed", "repository": r, "pull_request": {**pr, "state": "closed", "merged": True}}, delivery)
    if scenario == "review": return process_event(db, "pull_request_review", {"repository": r, "pull_request": pr, "review": {"id": num, "state": random.choice(["APPROVED", "CHANGES_REQUESTED"]), "user": {"login": "reviewer-z"}, "html_url": html}}, delivery)
    if scenario in ("ci_success", "ci_failure"):
        return process_event(db, "workflow_run", {"repository": r, "workflow_run": {"id": num, "name": "CI", "head_branch": "main", "status": "completed", "conclusion": "success" if scenario == "ci_success" else "failure", "html_url": f"{repo.url}/actions/runs/{num}", "actor": {"login": dev}}}, delivery)
    return process_event(db, "issues", {"repository": r, "issue": {"number": num, "title": "Clarify error contract for expired access", "state": "open", "html_url": f"{repo.url}/issues/{num}", "user": {"login": dev}}}, delivery)
