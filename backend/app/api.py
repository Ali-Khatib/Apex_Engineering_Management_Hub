import json
from collections import Counter, defaultdict
from datetime import date, datetime
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.orm import Session
from . import models as m, serializers as s, github as gh
from .db import get_db
from .security import current_user, require_admin, verify_password, hash_password, make_token, _user_from_token
from .services import audit, notify, admin_ids, open_blockers
from .events import stream, publish
from .config import ALLOW_SIMULATED_GITHUB, ORG_LINKS

router = APIRouter(prefix="/api")
STATUSES = ["proposed", "in_progress", "in_review", "blocked", "done", "deployed"]
PRIORITIES = ["P0", "P1", "P2", "P3"]

def _comp(db, cid) -> m.Component:
    c = db.get(m.Component, cid)
    if not c: raise HTTPException(404, "Component not found")
    return c

def _bcounts(db):
    rows = db.execute(select(m.Blocker.component_id, func.count()).where(m.Blocker.resolved == False).group_by(m.Blocker.component_id)).all()  # noqa
    return {cid: n for cid, n in rows}

def _can_edit(user, c): return user.role == "admin" or c.owner_id == user.id

# ---------------- auth / identity ----------------
class Login(BaseModel): email: str; password: str
@router.post("/auth/login")
def login(b: Login, db: Session = Depends(get_db)):
    u = db.scalar(select(m.User).where(m.User.email == b.email.lower().strip()))
    if not u or not verify_password(b.password, u.password_hash): raise HTTPException(401, "Invalid credentials")
    return {"token": make_token(u), "user": s.user_out(u)}

@router.get("/config")
def config(_=Depends(current_user)): return {"links": ORG_LINKS}

@router.get("/me")
def me(u: m.User = Depends(current_user)): return s.user_out(u)

class NewUser(BaseModel):
    first_name: str; last_name: str; email: str; role: str = "member"; password: str = "ChangeMe123!"
    title: str = ""; onboarding_notes: str = ""
class UserPatch(BaseModel):
    first_name: str | None = None; last_name: str | None = None; role: str | None = None; title: str | None = None; onboarding_notes: str | None = None

@router.get("/users")
def users(db: Session = Depends(get_db), _=Depends(current_user)):
    return [s.user_out(u) for u in db.scalars(select(m.User).order_by(m.User.first_name))]

@router.post("/users", status_code=201)
def create_user(b: NewUser, db: Session = Depends(get_db), admin=Depends(require_admin)):
    if b.role not in ("admin", "member"): raise HTTPException(422, "role must be admin|member")
    if db.scalar(select(m.User).where(m.User.email == b.email.lower())): raise HTTPException(409, "Email already registered")
    u = m.User(first_name=b.first_name, last_name=b.last_name, email=b.email.lower(), role=b.role, title=b.title,
               onboarding_notes=b.onboarding_notes, password_hash=hash_password(b.password))
    db.add(u); audit(db, admin, "user.create", u.email); db.commit(); return s.user_out(u)

@router.patch("/users/{uid}")
def patch_user(uid: int, b: UserPatch, db: Session = Depends(get_db), admin=Depends(require_admin)):
    u = db.get(m.User, uid)
    if not u: raise HTTPException(404, "User not found")
    data = b.model_dump(exclude_none=True)
    if data.get("role") and data["role"] not in ("admin", "member"): raise HTTPException(422, "role must be admin|member")
    if u.id == admin.id and data.get("role") == "member": raise HTTPException(409, "Admins cannot demote themselves")
    for k, v in data.items(): setattr(u, k, v)
    audit(db, admin, "user.update", f"{u.email}: {data}"); db.commit(); return s.user_out(u)

# ---------------- components ----------------
@router.get("/components")
def list_components(category: str | None = None, status: str | None = None, owner_id: int | None = None, priority: str | None = None,
                    unassigned: bool = False, at_risk: bool = False, ready_for_review: bool = False, q: str | None = None,
                    db: Session = Depends(get_db), _=Depends(current_user)):
    stmt = select(m.Component).order_by(m.Component.category, m.Component.code)
    if category: stmt = stmt.where(m.Component.category == category)
    if status: stmt = stmt.where(m.Component.status == status)
    if owner_id: stmt = stmt.where(m.Component.owner_id == owner_id)
    if priority: stmt = stmt.where(m.Component.priority == priority)
    if unassigned: stmt = stmt.where(m.Component.owner_id.is_(None))
    if q: stmt = stmt.where(or_(m.Component.name.ilike(f"%{q}%"), m.Component.code.ilike(f"%{q}%")))
    bc = _bcounts(db)
    out = [s.component_out(c, bc.get(c.id, 0)) for c in db.scalars(stmt).unique()]
    if at_risk: out = [c for c in out if c["at_risk"]]
    if ready_for_review: out = [c for c in out if c["ready_for_review"]]
    return out

class CompIn(BaseModel):
    code: str; name: str; category: str; layer: str = ""; description: str = ""; spec_md: str = ""; docs_md: str = ""
    architecture_md: str = ""; acceptance_criteria: str = ""; status: str = "proposed"; priority: str = "P2"
    due_date: date | None = None; owner_id: int | None = None; repo_id: int | None = None; milestone_id: int | None = None
    links: dict = {}
class CompPatch(BaseModel):
    name: str | None = None; category: str | None = None; layer: str | None = None; description: str | None = None; spec_md: str | None = None
    docs_md: str | None = None; architecture_md: str | None = None; acceptance_criteria: str | None = None; status: str | None = None
    priority: str | None = None; due_date: date | None = None; owner_id: int | None = None; repo_id: int | None = None
    milestone_id: int | None = None; links: dict | None = None

def _validate(db, d):
    if d.get("status") and d["status"] not in STATUSES: raise HTTPException(422, f"status must be one of {STATUSES}")
    if d.get("priority") and d["priority"] not in PRIORITIES: raise HTTPException(422, f"priority must be one of {PRIORITIES}")
    if d.get("owner_id") and not db.get(m.User, d["owner_id"]): raise HTTPException(422, "owner not found")
    if d.get("repo_id") and not db.get(m.Repository, d["repo_id"]): raise HTTPException(422, "repository not found")

@router.post("/components", status_code=201)
def create_component(b: CompIn, db: Session = Depends(get_db), admin=Depends(require_admin)):
    d = b.model_dump(); _validate(db, d)
    if db.scalar(select(m.Component).where(m.Component.code == b.code)): raise HTTPException(409, "Component code already exists")
    c = m.Component(**d); db.add(c); db.flush()
    audit(db, admin, "component.create", f"{c.code} {c.name}", c.id)
    if c.owner_id: notify(db, [c.owner_id], f"You were assigned {c.code} · {c.name}", c.id, exclude=admin.id)
    db.commit(); publish("component", {"id": c.id}); return s.component_out(c, 0, True)

@router.get("/components/{cid}")
def get_component(cid: int, db: Session = Depends(get_db), _=Depends(current_user)):
    c = _comp(db, cid)
    ids = lambda col, other: db.scalars(select(m.Component).where(m.Component.id.in_(select(col).where(other == cid)))).unique().all()
    deps = ids(m.Dependency.depends_on_id, m.Dependency.component_id)
    dependents = ids(m.Dependency.component_id, m.Dependency.depends_on_id)
    bl = db.scalars(select(m.Blocker).where(m.Blocker.component_id == cid).order_by(m.Blocker.created_at.desc())).all()
    events = []
    if c.repo_id:
        events = db.scalars(select(m.GitHubEvent).where(m.GitHubEvent.repo_id == c.repo_id).order_by(m.GitHubEvent.created_at.desc()).limit(40)).all()
    d = s.component_out(c, sum(1 for b in bl if not b.resolved), True)
    d.update({
        "dependencies": [{"id": x.id, "code": x.code, "name": x.name, "status": x.status} for x in deps],
        "dependents": [{"id": x.id, "code": x.code, "name": x.name, "status": x.status} for x in dependents],
        "blockers": [{"id": b.id, "description": b.description, "resolved": b.resolved, "created_at": b.created_at} for b in bl],
        "checklist": [{"id": i.id, "text": i.text, "done": i.done} for i in db.scalars(select(m.ChecklistItem).where(m.ChecklistItem.component_id == cid).order_by(m.ChecklistItem.id))],
        "comments": [s.comment_out(x) for x in db.scalars(select(m.Comment).where(m.Comment.component_id == cid).order_by(m.Comment.created_at))],
        "acceptances": [s.acceptance_out(x) for x in db.scalars(select(m.Acceptance).where(m.Acceptance.component_id == cid).order_by(m.Acceptance.created_at.desc()))],
        "github": [s.event_out(e) for e in events],
        "ci": next((e.state for e in events if e.kind == "workflow"), None),
        "history": [s.audit_out(a) for a in db.scalars(select(m.AuditLog).where(m.AuditLog.component_id == cid).order_by(m.AuditLog.created_at.desc()).limit(30))],
    })
    return d

@router.patch("/components/{cid}")
def patch_component(cid: int, b: CompPatch, db: Session = Depends(get_db), user=Depends(current_user)):
    c = _comp(db, cid); data = b.model_dump(exclude_unset=True); _validate(db, data)
    if user.role != "admin":
        # members: owner may only move status (never to deployed) and update docs/spec text
        allowed = {"status", "docs_md", "spec_md", "architecture_md"}
        if c.owner_id != user.id or set(data) - allowed: raise HTTPException(403, "Only admins can edit this; owners may edit status and docs")
        if data.get("status") == "deployed": raise HTTPException(403, "Only admins can mark deployed")
    if data.get("status") == "deployed" and not c.gate_ready_for_deploy: raise HTTPException(409, "Cannot deploy: ready_for_deploy gate not set")
    changes = []
    for k, v in data.items():
        if getattr(c, k) != v: changes.append(f"{k}: {getattr(c, k)!r:.40} → {v!r:.40}" if k not in ("docs_md", "spec_md", "architecture_md") else f"{k} edited"); setattr(c, k, v)
    if "owner_id" in data and data["owner_id"]: notify(db, [data["owner_id"]], f"You were assigned {c.code} · {c.name}", c.id, exclude=user.id)
    if changes: audit(db, user, "component.update", "; ".join(changes), c.id)
    db.commit(); publish("component", {"id": c.id}); return s.component_out(c, len(open_blockers(db, c.id)), True)

@router.delete("/components/{cid}", status_code=204)
def delete_component(cid: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    c = _comp(db, cid); audit(db, admin, "component.delete", f"{c.code} {c.name}")
    db.query(m.Dependency).filter(or_(m.Dependency.component_id == cid, m.Dependency.depends_on_id == cid)).delete()
    for M in (m.Comment, m.Acceptance, m.Blocker, m.ChecklistItem): db.query(M).filter(M.component_id == cid).delete()
    db.delete(c); db.commit(); publish("component", {"id": cid})

# ---------------- comments, acceptance, gates, blockers, checklist ----------------
class CommentIn(BaseModel): body: str; parent_id: int | None = None
@router.post("/components/{cid}/comments", status_code=201)
def add_comment(cid: int, b: CommentIn, db: Session = Depends(get_db), user=Depends(current_user)):
    c = _comp(db, cid)
    if not b.body.strip(): raise HTTPException(422, "Empty comment")
    cm = m.Comment(component_id=cid, author_id=user.id, body=b.body.strip(), parent_id=b.parent_id); db.add(cm)
    notify(db, [c.owner_id], f"{user.first_name} commented on {c.code}", cid, exclude=user.id)
    audit(db, user, "comment.add", b.body[:80], cid); db.commit(); publish("component", {"id": cid}); return s.comment_out(cm)

class AcceptIn(BaseModel): decision: str; evidence: str = ""; evidence_url: str = ""
@router.post("/components/{cid}/acceptances", status_code=201)
def accept(cid: int, b: AcceptIn, db: Session = Depends(get_db), user=Depends(current_user)):
    c = _comp(db, cid)
    if b.decision not in ("accepted", "rejected", "changes_requested"): raise HTTPException(422, "invalid decision")
    if c.owner_id == user.id and user.role != "admin": raise HTTPException(403, "Owners cannot accept their own component")
    if b.decision == "accepted" and not (b.evidence.strip() or b.evidence_url.strip()): raise HTTPException(422, "Acceptance requires evidence (text or link)")
    a = m.Acceptance(component_id=cid, reviewer_id=user.id, **b.model_dump()); db.add(a)
    c.gate_qa_accepted = b.decision == "accepted"
    if b.decision == "accepted":
        c.review_requested = False
        if c.status == "in_review": c.status = "done"
    else:
        c.gate_ready_for_deploy = False
        if c.status in ("in_review", "done"): c.status = "in_progress"
    audit(db, user, f"acceptance.{b.decision}", b.evidence[:120], cid)
    notify(db, [c.owner_id], f"{c.code}: review {b.decision.replace('_', ' ')} by {user.first_name}", cid, exclude=user.id)
    db.commit(); publish("component", {"id": cid}); return s.acceptance_out(a)

class GateIn(BaseModel): gate: str; value: bool
@router.post("/components/{cid}/gates")
def set_gate(cid: int, b: GateIn, db: Session = Depends(get_db), user=Depends(current_user)):
    c = _comp(db, cid)
    if b.gate == "checks_passed":
        if not _can_edit(user, c): raise HTTPException(403, "Owner or admin only")
        c.gate_checks_passed = b.value
        if not b.value: c.gate_ready_for_deploy = False
    elif b.gate == "ready_for_deploy":
        if user.role != "admin": raise HTTPException(403, "Admin only")
        if b.value and not (c.gate_checks_passed and c.gate_qa_accepted): raise HTTPException(409, "Requires checks_passed and qa_accepted")
        c.gate_ready_for_deploy = b.value
    elif b.gate == "qa_accepted":
        raise HTTPException(409, "qa_accepted is only set by recording an acceptance decision with evidence")
    else: raise HTTPException(422, "unknown gate")
    audit(db, user, f"gate.{b.gate}", str(b.value), cid); db.commit(); publish("component", {"id": cid}); return s.component_out(c, 0, True)["gates"]

@router.post("/components/{cid}/request-review")
def request_review(cid: int, db: Session = Depends(get_db), user=Depends(current_user)):
    c = _comp(db, cid)
    if not _can_edit(user, c): raise HTTPException(403, "Owner or admin only")
    if open_blockers(db, cid): raise HTTPException(409, "Resolve open blockers before requesting review")
    c.review_requested = True; c.status = "in_review"
    audit(db, user, "review.requested", "", cid); notify(db, admin_ids(db), f"{c.code} ready for review", cid, exclude=user.id)
    db.commit(); publish("component", {"id": cid}); return {"ok": True}

class BlockerIn(BaseModel): description: str
@router.post("/components/{cid}/blockers", status_code=201)
def add_blocker(cid: int, b: BlockerIn, db: Session = Depends(get_db), user=Depends(current_user)):
    c = _comp(db, cid); bl = m.Blocker(component_id=cid, description=b.description, raised_by_id=user.id); db.add(bl)
    audit(db, user, "blocker.raised", b.description[:120], cid); notify(db, admin_ids(db) + [c.owner_id], f"Blocker on {c.code}: {b.description[:80]}", cid, exclude=user.id)
    db.commit(); publish("component", {"id": cid}); return {"id": bl.id}

@router.post("/blockers/{bid}/resolve")
def resolve_blocker(bid: int, db: Session = Depends(get_db), user=Depends(current_user)):
    bl = db.get(m.Blocker, bid)
    if not bl: raise HTTPException(404, "Blocker not found")
    c = _comp(db, bl.component_id)
    if not _can_edit(user, c): raise HTTPException(403, "Owner or admin only")
    bl.resolved = True; bl.resolved_at = datetime.utcnow(); audit(db, user, "blocker.resolved", bl.description[:120], c.id)
    db.commit(); publish("component", {"id": c.id}); return {"ok": True}

class ChecklistIn(BaseModel): text: str
@router.post("/components/{cid}/checklist", status_code=201)
def add_check(cid: int, b: ChecklistIn, db: Session = Depends(get_db), user=Depends(current_user)):
    c = _comp(db, cid)
    if not _can_edit(user, c): raise HTTPException(403, "Owner or admin only")
    i = m.ChecklistItem(component_id=cid, text=b.text); db.add(i); db.commit(); return {"id": i.id}

@router.post("/checklist/{iid}/toggle")
def toggle_check(iid: int, db: Session = Depends(get_db), user=Depends(current_user)):
    i = db.get(m.ChecklistItem, iid)
    if not i: raise HTTPException(404, "Item not found")
    c = _comp(db, i.component_id)
    if not _can_edit(user, c): raise HTTPException(403, "Owner or admin only")
    i.done = not i.done; audit(db, user, "handoff.toggle", f"{i.text} → {i.done}", c.id); db.commit(); return {"done": i.done}

# ---------------- dashboard ----------------
@router.get("/portfolio")
def portfolio(db: Session = Depends(get_db), _=Depends(current_user)):
    bc = _bcounts(db); comps = [s.component_out(c, bc.get(c.id, 0)) for c in db.scalars(select(m.Component)).unique()]
    by = lambda key: dict(Counter(key(c) for c in comps))
    owners = defaultdict(lambda: {"total": 0, "at_risk": 0, "done": 0})
    for c in comps:
        k = f"{c['owner']['first_name']} {c['owner']['last_name']}" if c["owner"] else "Unassigned"
        owners[k]["total"] += 1; owners[k]["at_risk"] += c["at_risk"]; owners[k]["done"] += c["status"] in ("done", "deployed")
    due = defaultdict(int)
    for c in comps:
        if c["due_date"]: due[str(c["due_date"])[:7]] += 1
    return {"total": len(comps), "by_status": by(lambda c: c["status"]), "by_priority": by(lambda c: c["priority"]), "by_category": by(lambda c: c["category"]),
            "by_owner": owners, "by_due_month": dict(sorted(due.items())), "unassigned": sum(c["unassigned"] for c in comps),
            "at_risk": sum(c["at_risk"] for c in comps), "ready_for_review": sum(c["ready_for_review"] for c in comps),
            "gates": {"checks_passed": sum(c["gates"]["checks_passed"] for c in comps), "qa_accepted": sum(c["gates"]["qa_accepted"] for c in comps),
                      "ready_for_deploy": sum(c["gates"]["ready_for_deploy"] for c in comps)}}

@router.get("/categories")
def categories(db: Session = Depends(get_db), _=Depends(current_user)):
    return [r[0] for r in db.execute(select(m.Component.category).distinct().order_by(m.Component.category))]

# ---------------- dependency graph + planning ----------------
def _has_path(db, src: int, dst: int) -> bool:
    adj = defaultdict(list)
    for d in db.scalars(select(m.Dependency)): adj[d.component_id].append(d.depends_on_id)
    seen, stack = set(), [src]
    while stack:
        n = stack.pop()
        if n == dst: return True
        if n in seen: continue
        seen.add(n); stack.extend(adj[n])
    return False

def _cycles(nodes, edges):
    """Strongly connected components with >1 node = dependency cycles (Tarjan)."""
    adj = defaultdict(list)
    for e in edges: adj[e.component_id].append(e.depends_on_id)
    idx, low, st, on, out, n = {}, {}, [], set(), [], [0]
    def visit(v):
        idx[v] = low[v] = n[0]; n[0] += 1; st.append(v); on.add(v)
        for w in adj[v]:
            if w not in idx: visit(w); low[v] = min(low[v], low[w])
            elif w in on: low[v] = min(low[v], idx[w])
        if low[v] == idx[v]:
            comp = []
            while True:
                w = st.pop(); on.discard(w); comp.append(w)
                if w == v: break
            if len(comp) > 1: out.append(sorted(comp))
    import sys; sys.setrecursionlimit(max(sys.getrecursionlimit(), 5000))
    for c in nodes:
        if c.id not in idx: visit(c.id)
    return sorted(out, key=len, reverse=True)

@router.get("/graph")
def graph(db: Session = Depends(get_db), _=Depends(current_user)):
    bc = _bcounts(db); comps = db.scalars(select(m.Component)).unique().all(); eds = db.scalars(select(m.Dependency)).all()
    return {"cycles": _cycles(comps, eds), "nodes": [{"id": c.id, "code": c.code, "name": c.name, "status": c.status, "category": c.category, "priority": c.priority,
                       "blocked": bool(bc.get(c.id)) or c.status == "blocked"} for c in comps],
            "edges": [{"id": d.id, "from": d.component_id, "to": d.depends_on_id} for d in db.scalars(select(m.Dependency))]}  # from depends on to

class DepIn(BaseModel): component_id: int; depends_on_id: int
@router.post("/dependencies", status_code=201)
def add_dep(b: DepIn, db: Session = Depends(get_db), admin=Depends(require_admin)):
    if b.component_id == b.depends_on_id: raise HTTPException(422, "A component cannot depend on itself")
    a, z = _comp(db, b.component_id), _comp(db, b.depends_on_id)
    if db.scalar(select(m.Dependency).where(m.Dependency.component_id == a.id, m.Dependency.depends_on_id == z.id)): raise HTTPException(409, "Dependency exists")
    if _has_path(db, z.id, a.id): raise HTTPException(409, f"Would create a cycle: {z.code} already depends (transitively) on {a.code}")
    d = m.Dependency(component_id=a.id, depends_on_id=z.id); db.add(d); audit(db, admin, "dependency.add", f"{a.code} → {z.code}", a.id)
    db.commit(); publish("graph", {}); return {"id": d.id}

@router.delete("/dependencies/{did}", status_code=204)
def del_dep(did: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    d = db.get(m.Dependency, did)
    if not d: raise HTTPException(404, "Dependency not found")
    audit(db, admin, "dependency.remove", f"{d.component_id} → {d.depends_on_id}", d.component_id); db.delete(d); db.commit(); publish("graph", {})

class MilestoneIn(BaseModel): name: str; description: str = ""; target_date: date | None = None
@router.get("/milestones")
def milestones(db: Session = Depends(get_db), _=Depends(current_user)):
    out = []
    for ms in db.scalars(select(m.Milestone).order_by(m.Milestone.target_date)):
        cs = db.scalars(select(m.Component).where(m.Component.milestone_id == ms.id)).unique().all()
        done = sum(c.status in ("done", "deployed") for c in cs)
        out.append({"id": ms.id, "name": ms.name, "description": ms.description, "target_date": ms.target_date, "total": len(cs), "done": done,
                    "components": [{"id": c.id, "code": c.code, "name": c.name, "status": c.status} for c in cs]})
    return out
@router.post("/milestones", status_code=201)
def new_milestone(b: MilestoneIn, db: Session = Depends(get_db), admin=Depends(require_admin)):
    ms = m.Milestone(**b.model_dump()); db.add(ms); audit(db, admin, "milestone.create", b.name); db.commit(); return {"id": ms.id}
@router.patch("/milestones/{mid}")
def edit_milestone(mid: int, b: MilestoneIn, db: Session = Depends(get_db), admin=Depends(require_admin)):
    ms = db.get(m.Milestone, mid)
    if not ms: raise HTTPException(404, "Milestone not found")
    for k, v in b.model_dump().items(): setattr(ms, k, v)
    db.commit(); return {"ok": True}

# ---------------- GitHub ----------------
@router.get("/repos")
def repos(db: Session = Depends(get_db), _=Depends(current_user)):
    out = []
    for r in db.scalars(select(m.Repository).order_by(m.Repository.full_name)):
        last = db.scalar(select(m.GitHubEvent).where(m.GitHubEvent.repo_id == r.id, m.GitHubEvent.kind == "workflow").order_by(m.GitHubEvent.created_at.desc()))
        d = s.repo_out(r); d["ci"] = last.state if last else None
        d["open_prs"] = db.scalar(select(func.count()).select_from(m.GitHubEvent).where(m.GitHubEvent.repo_id == r.id, m.GitHubEvent.kind == "pull_request", m.GitHubEvent.state == "open"))
        d["open_issues"] = db.scalar(select(func.count()).select_from(m.GitHubEvent).where(m.GitHubEvent.repo_id == r.id, m.GitHubEvent.kind == "issue", m.GitHubEvent.state == "open"))
        d["components"] = [c.code for c in db.scalars(select(m.Component).where(m.Component.repo_id == r.id)).unique()]
        out.append(d)
    return out

class RepoIn(BaseModel): full_name: str; description: str = ""; default_branch: str = "main"
@router.post("/repos", status_code=201)
def add_repo(b: RepoIn, db: Session = Depends(get_db), admin=Depends(require_admin)):
    if db.scalar(select(m.Repository).where(m.Repository.full_name == b.full_name)): raise HTTPException(409, "Repository already registered")
    r = m.Repository(full_name=b.full_name, url=f"https://github.com/{b.full_name}", description=b.description, default_branch=b.default_branch)
    db.add(r); audit(db, admin, "repo.register", b.full_name); db.commit(); return s.repo_out(r)

@router.get("/repos/{rid}")
def repo_detail(rid: int, db: Session = Depends(get_db), _=Depends(current_user)):
    r = db.get(m.Repository, rid)
    if not r: raise HTTPException(404, "Repository not found")
    ev = db.scalars(select(m.GitHubEvent).where(m.GitHubEvent.repo_id == rid).order_by(m.GitHubEvent.created_at.desc()).limit(60)).all()
    return {**s.repo_out(r), "docs_md": r.docs_md, "events": [s.event_out(e) for e in ev]}

@router.post("/repos/{rid}/sync")
def repo_sync(rid: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    r = db.get(m.Repository, rid)
    if not r: raise HTTPException(404, "Repository not found")
    try: return gh.sync_repo(db, r)
    except Exception as e: raise HTTPException(502, f"GitHub sync failed: {e}")

@router.post("/repos/{rid}/simulate")
def repo_simulate(rid: int, scenario: str | None = None, db: Session = Depends(get_db), _=Depends(require_admin)):
    """Fabricated GitHub activity, for local demos only.

    This writes invented commits, pull requests and CI runs into the same
    tables that real webhook deliveries write to, which means anything reading
    those tables cannot tell the two apart. It is therefore refused unless
    ALLOW_SIMULATED_GITHUB=1 is set, and it is refused in production
    unconditionally. 404 rather than 403 so the route does not advertise that
    it exists.
    """
    if not ALLOW_SIMULATED_GITHUB:
        raise HTTPException(404, "Not found")
    r = db.get(m.Repository, rid)
    if not r: raise HTTPException(404, "Repository not found")
    out = gh.simulate(db, r, scenario)
    out["simulated"] = True  # so a caller can never mistake it for real activity
    return out

@router.post("/github/webhook")
async def webhook(request: Request, db: Session = Depends(get_db)):
    body = await request.body()
    if not gh.verify_signature(body, request.headers.get("X-Hub-Signature-256", "")): raise HTTPException(401, "Bad signature")
    return gh.process_event(db, request.headers.get("X-GitHub-Event", ""), json.loads(body), request.headers.get("X-GitHub-Delivery"))

# ---------------- knowledge base ----------------
@router.get("/kb")
def kb_list(db: Session = Depends(get_db), _=Depends(current_user)):
    return [{"slug": p.slug, "section": p.section, "title": p.title, "updated_at": p.updated_at, "owner": s.user_out(p.owner)} for p in db.scalars(select(m.KBPage).order_by(m.KBPage.section, m.KBPage.id))]
@router.get("/kb/{slug}")
def kb_get(slug: str, db: Session = Depends(get_db), _=Depends(current_user)):
    p = db.scalar(select(m.KBPage).where(m.KBPage.slug == slug))
    if not p: raise HTTPException(404, "Page not found")
    return {"slug": p.slug, "section": p.section, "title": p.title, "body_md": p.body_md, "updated_at": p.updated_at, "owner": s.user_out(p.owner)}
class KBIn(BaseModel): title: str; body_md: str; owner_id: int | None = None
@router.put("/kb/{slug}")
def kb_put(slug: str, b: KBIn, db: Session = Depends(get_db), admin=Depends(require_admin)):
    p = db.scalar(select(m.KBPage).where(m.KBPage.slug == slug))
    if not p: raise HTTPException(404, "Page not found")
    p.title, p.body_md = b.title, b.body_md
    if b.owner_id: p.owner_id = b.owner_id
    audit(db, admin, "kb.update", slug); db.commit(); return {"ok": True}

# ---------------- audit / notifications / realtime ----------------
@router.get("/audit")
def audit_feed(limit: int = Query(50, le=200), db: Session = Depends(get_db), _=Depends(current_user)):
    return [s.audit_out(a) for a in db.scalars(select(m.AuditLog).order_by(m.AuditLog.created_at.desc()).limit(limit))]
@router.get("/notifications")
def notifications(db: Session = Depends(get_db), user=Depends(current_user)):
    ns = db.scalars(select(m.Notification).where(m.Notification.user_id == user.id).order_by(m.Notification.created_at.desc()).limit(40)).all()
    return [{"id": n.id, "message": n.message, "component_id": n.component_id, "read": n.read, "created_at": n.created_at} for n in ns]
@router.post("/notifications/read")
def read_all(db: Session = Depends(get_db), user=Depends(current_user)):
    db.query(m.Notification).filter(m.Notification.user_id == user.id).update({"read": True}); db.commit(); return {"ok": True}

@router.get("/events")
async def events(token: str, db: Session = Depends(get_db)):
    _user_from_token(token, db)  # EventSource cannot send headers, so the JWT rides in the query string
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
