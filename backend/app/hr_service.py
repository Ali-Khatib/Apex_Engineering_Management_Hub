"""Database-facing People / HR logic: loads rows, applies the pure rules in hr.py,
enforces who may see and change what, and writes history.

Permission model (existing roles only):
  admin         View everything, start/approve/complete/reopen/cancel cases, see restricted
                fields, review candidates, edit checklist templates.
  case owner    Sees and works the cases they own: edits tasks, assigns task owners and due
                dates, starts a ready case, requests final review. No approvals, no restricted
                fields, no candidate submissions.
  manager       Sees the cases of people who report to them (as set on the user). Read-only
                unless they are also the case owner or a task owner.
  task owner    Sees the case header and only their own tasks. Nothing else.
  anyone else   Gets 404 for a direct URL and is left out of lists and counts.
Being a reviewer or QA contact on engineering work gives no access here.
"""
from datetime import date, datetime, timedelta
from fastapi import HTTPException
from sqlalchemy import select, func, or_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from . import models as m, hr
from .config import JWT_SECRET
from .services import audit, notify

now = lambda: datetime.utcnow()


def bad(msg, status=422): raise HTTPException(status, msg)
def fields(errors: dict): raise HTTPException(422, {"message": "Please correct the highlighted fields.", "fields": errors})


def uname(u: m.User | None) -> str:
    return f"{u.first_name} {u.last_name}".strip() if u else ""


def uref(db: Session, uid: int | None):
    u = db.get(m.User, uid) if uid else None
    return {"id": u.id, "name": uname(u)} if u else None


# ------------------------------------------------------------------- templates
def seed_hr(db: Session):
    """Insert the default checklists if absent. Idempotent; never overwrites an edited template."""
    for kind, rows in hr.DEFAULT_TEMPLATES.items():
        if not db.scalar(select(m.HrTemplate).where(m.HrTemplate.kind == kind)):
            db.add(m.HrTemplate(kind=kind, name=f"{kind.capitalize()} checklist", tasks=hr.clean_template_tasks(rows), version=1))
    db.commit()


def template(db: Session, kind: str) -> m.HrTemplate:
    t = db.scalar(select(m.HrTemplate).where(m.HrTemplate.kind == kind))
    if not t:
        seed_hr(db); t = db.scalar(select(m.HrTemplate).where(m.HrTemplate.kind == kind))
    return t


# ----------------------------------------------------------------- row helpers
def td(t: m.HrTask) -> dict:
    return {"id": t.id, "position": t.position, "key": t.key, "title": t.title, "instructions": t.instructions, "category": t.category,
            "required": t.required, "owner_id": t.owner_id, "due_date": t.due_date, "status": t.status, "version": t.version,
            "integration": t.integration, "confirmation": t.confirmation, "evidence_note": t.evidence_note,
            "blocked_reason": t.blocked_reason, "skip_reason": t.skip_reason, "system_key": t.system_key}


def hd(h: m.HrHandoverItem) -> dict:
    return {"id": h.id, "type": "blocker" if h.blocker_id else "component", "component_id": h.component_id, "blocker_id": h.blocker_id,
            "role": h.role, "status": h.status}


def case_tasks(db: Session, cid: int) -> list[m.HrTask]:
    return list(db.scalars(select(m.HrTask).where(m.HrTask.case_id == cid).order_by(m.HrTask.position, m.HrTask.id)))


def case_handover(db: Session, cid: int) -> list[m.HrHandoverItem]:
    return list(db.scalars(select(m.HrHandoverItem).where(m.HrHandoverItem.case_id == cid).order_by(m.HrHandoverItem.id)))


def get_case(db: Session, cid: int) -> m.HrCase:
    c = db.get(m.HrCase, cid)
    if not c: bad("Case not found", 404)
    return c


def access_for(user: m.User, c: m.HrCase, tasks: list[m.HrTask]) -> str | None:
    return hr.case_access(is_admin=user.role == "admin", uid=user.id, owner_id=c.owner_id, manager_id=c.manager_id,
                          task_owner_ids={t.owner_id for t in tasks if t.owner_id})


def person_manager_id(db: Session, uid: int | None) -> int | None:
    u = db.get(m.User, uid) if uid else None
    return u.manager_id if u else None


def visible_cases(db: Session, user: m.User) -> list[tuple[m.HrCase, str, list[m.HrTask]]]:
    """Every case this user may see, with their access level and the tasks they may see."""
    cases = list(db.scalars(select(m.HrCase).order_by(m.HrCase.id.desc())))
    by_case: dict[int, list[m.HrTask]] = {}
    for t in db.scalars(select(m.HrTask).where(m.HrTask.case_id.in_([c.id for c in cases]) if cases else False)):
        by_case.setdefault(t.case_id, []).append(t)
    out = []
    for c in cases:
        ts = sorted(by_case.get(c.id, []), key=lambda t: (t.position, t.id))
        lvl = access_for(user, c, ts)
        # A person's manager (set on the user record) sees their case too.
        if lvl is None and user.id == person_manager_id(db, c.person_user_id): lvl = "full"
        if lvl: out.append((c, lvl, ts if lvl == "full" else [t for t in ts if t.owner_id == user.id]))
    return out


def load_for(db: Session, user: m.User, cid: int, need: str = "limited") -> tuple[m.HrCase, str, list[m.HrTask]]:
    """Fetch one case or answer 404, which is also what a stranger gets: its existence is not disclosed."""
    c = get_case(db, cid) if db.get(m.HrCase, cid) else None
    if not c: bad("Case not found", 404)
    all_tasks = case_tasks(db, cid)
    lvl = access_for(user, c, all_tasks)
    if lvl is None and user.id == person_manager_id(db, c.person_user_id): lvl = "full"
    if lvl is None or (need == "full" and lvl != "full"): bad("Case not found", 404)
    return c, lvl, (all_tasks if lvl == "full" else [t for t in all_tasks if t.owner_id == user.id])


def event(db: Session, actor, action: str, *, case: m.HrCase | None = None, candidate: m.HrCandidate | None = None,
          from_stage=None, to_stage=None, detail="", sensitive=False, request_id=None):
    db.add(m.HrEvent(case_id=case.id if case else None, candidate_id=candidate.id if candidate else None,
                     actor_id=getattr(actor, "id", None), action=action, from_stage=from_stage, to_stage=to_stage,
                     detail=detail, sensitive=sensitive, request_id=request_id))


def seen_request(db: Session, *, case_id=None, candidate_id=None, request_id: str | None) -> bool:
    if not request_id: return False
    q = select(m.HrEvent.id).where(m.HrEvent.request_id == request_id)
    q = q.where(m.HrEvent.case_id == case_id) if case_id else q.where(m.HrEvent.candidate_id == candidate_id)
    return db.scalar(q) is not None


def commit(db: Session):
    """A duplicate request id trips a unique constraint; turn that into a clear 409 instead of a 500."""
    try: db.commit()
    except IntegrityError:
        db.rollback(); bad("This change was already applied, or the record changed at the same moment. Refresh and check before retrying.", 409)


def check_version(current: int, sent) -> None:
    if sent is None or int(sent) != current: bad("This record changed since you opened it. Refresh and try again.", 409)


# ---------------------------------------------------------------------- output
def _ev(e: m.HrEvent, admin: bool) -> dict:
    return {"id": e.id, "action": e.action, "actor": uname(e.actor) or "System", "from_stage": e.from_stage, "to_stage": e.to_stage,
            "detail": "" if (e.sensitive and not admin) else e.detail, "restricted": bool(e.sensitive and not admin), "created_at": hr.iso(e.created_at)}


def task_out(db: Session, t: m.HrTask, user: m.User, c: m.HrCase, lvl: str, today: date) -> dict:
    d = td(t)
    is_admin = user.role == "admin"
    mine = t.owner_id == user.id
    editable = c.stage in hr.EDITABLE_TASK_STAGES and (is_admin or user.id == c.owner_id or mine) and t.system_key != "handover"
    return {"id": t.id, "key": t.key, "title": t.title, "instructions": t.instructions, "category": t.category, "required": t.required,
            "owner": uref(db, t.owner_id), "due_date": t.due_date.isoformat() if t.due_date else None, "status": t.status, "version": t.version,
            "integration": t.integration, "confirmation": t.confirmation, "confirmed_by": uref(db, t.confirmed_by_id)["name"] if t.confirmed_by_id else None,
            "confirmed_at": hr.iso(t.confirmed_at), "evidence_note": t.evidence_note, "blocked_reason": t.blocked_reason, "skip_reason": t.skip_reason,
            "completed_by": uref(db, t.completed_by_id)["name"] if t.completed_by_id else None, "completed_at": hr.iso(t.completed_at),
            "system_key": t.system_key, "overdue": hr.is_overdue(d, today), "mine": mine, "editable": editable,
            "can_manage": is_admin or user.id == c.owner_id}


def case_summary(db: Session, c: m.HrCase, lvl: str, tasks: list[m.HrTask], handover: list[m.HrHandoverItem], today: date) -> dict:
    tds = [td(t) for t in tasks]
    nxt = hr.next_task(tds) if lvl == "full" else None
    return {"id": c.id, "kind": c.kind, "stage": c.stage, "stage_label": hr.STAGE_LABEL[c.stage], "version": c.version,
            "person": {"user_id": c.person_user_id, "candidate_id": c.candidate_id, "name": c.display_name},
            "role_title": c.role_title, "department": c.department, "manager": uref(db, c.manager_id) if lvl == "full" else None,
            "owner": uref(db, c.owner_id), "anchor_date": c.anchor_date.isoformat() if c.anchor_date else None,
            "progress": hr.progress(tds) if lvl == "full" else None,
            "next_action": ({"task_id": nxt["id"], "title": nxt["title"], "owner": uref(db, nxt["owner_id"]),
                             "due_date": nxt["due_date"].isoformat() if nxt["due_date"] else None, "blocked": nxt["status"] == "blocked"} if nxt else None),
            "overdue": sum(1 for t in tds if hr.is_overdue(t, today)), "blocked": sum(1 for t in tds if t["status"] == "blocked"),
            "pending_handover": sum(1 for h in handover if h.status == "pending") if lvl == "full" and c.kind == "offboarding" else 0,
            "access": lvl, "created_at": hr.iso(c.created_at)}


def handover_out(db: Session, h: m.HrHandoverItem) -> dict:
    comp = h.component
    return {"id": h.id, "type": "blocker" if h.blocker_id else "component", "role": h.role, "status": h.status,
            "component": {"id": comp.id, "code": comp.code, "name": comp.name, "status": comp.status} if comp else None,
            "blocker": (lambda b: {"id": b.id, "title": b.title or b.description[:80]} if b else None)(db.get(m.Blocker, h.blocker_id) if h.blocker_id else None),
            "from": uref(db, h.from_user_id), "to": uref(db, h.to_user_id), "exception_reason": h.exception_reason,
            "decided_by": uname(db.get(m.User, h.decided_by_id)) if h.decided_by_id else None, "decided_at": hr.iso(h.decided_at),
            "accepted_by": uname(db.get(m.User, h.accepted_by_id)) if h.accepted_by_id else None, "accepted_at": hr.iso(h.accepted_at)}


def allowed_actions(c: m.HrCase, user: m.User, tasks: list[m.HrTask], handover: list[m.HrHandoverItem]) -> list[dict]:
    is_admin = user.role == "admin"; is_owner = user.id == c.owner_id
    out = []
    for a in hr.available_actions(c.kind, c.stage):
        new, errs = hr.check_transition(c.kind, c.stage, a, is_admin=is_admin, is_owner=is_owner, reason="x" * 10,
                                        case=_case_facts(c), tasks=[td(t) for t in tasks], handover=[hd(h) for h in handover])
        out.append({"action": a, "label": hr.ACTION_LABEL[a], "enabled": not errs, "why": errs[:4], "needs_reason": a in hr.REASON_REQUIRED, "to": new})
    return out


def _case_facts(c: m.HrCase) -> dict:
    return {"approved_at": c.approved_at}


def case_detail(db: Session, c: m.HrCase, lvl: str, visible_tasks: list[m.HrTask], user: m.User) -> dict:
    today = now().date(); is_admin = user.role == "admin"
    all_tasks = case_tasks(db, c.id) if lvl == "full" else visible_tasks
    ho = case_handover(db, c.id) if lvl == "full" else []
    out = case_summary(db, c, lvl, all_tasks, ho, today)
    out["tasks"] = [task_out(db, t, user, c, lvl, today) for t in all_tasks]
    out["status_text"] = hr.status_text(c.kind, c.stage, [td(t) for t in all_tasks], [hd(h) for h in ho], bool(c.approved_at)) if lvl == "full" else \
        "You are responsible for the tasks listed here. Only these are shown to you."
    out["limited"] = lvl != "full"
    if lvl == "full":
        out["actions"] = allowed_actions(c, user, all_tasks, ho)
        out["blockers_to_complete"] = hr.completion_blockers(c.kind, c.stage, _case_facts(c), [td(t) for t in all_tasks], [hd(h) for h in ho])
        out["approval"] = {"approved": bool(c.approved_at), "by": uname(db.get(m.User, c.approved_by_id)) if c.approved_by_id else None, "at": hr.iso(c.approved_at)}
        out["handover"] = {"items": [handover_out(db, h) for h in ho],
                           "pending": sum(1 for h in ho if h.status == "pending"), "reassigned": sum(1 for h in ho if h.status == "reassigned"),
                           "accepted": sum(1 for h in ho if h.status == "accepted"), "exceptions": sum(1 for h in ho if h.status == "exception")} if c.kind == "offboarding" else None
        evs = db.scalars(select(m.HrEvent).where(m.HrEvent.case_id == c.id).order_by(m.HrEvent.id.desc()).limit(200))
        out["events"] = [_ev(e, is_admin) for e in evs]
        out["can_edit"] = is_admin or user.id == c.owner_id
        out["can_reassign"] = is_admin or user.id == c.owner_id or user.id == c.manager_id
        out["can_manage"] = is_admin
        out["person_account"] = ({"active": db.get(m.User, c.person_user_id).is_active} if c.person_user_id and db.get(m.User, c.person_user_id) else None)
        if is_admin:
            out["restricted"] = {"reason_category": c.reason_category, "notes": c.restricted_notes, "closed_reason": c.closed_reason}
            if c.candidate_id: out["candidate"] = candidate_brief(db, db.get(m.HrCandidate, c.candidate_id))
    return out


def candidate_brief(db: Session, cand: m.HrCandidate | None) -> dict | None:
    if not cand: return None
    return {"id": cand.id, "name": cand.name, "stage": cand.stage, "stage_label": hr.CANDIDATE_LABEL[cand.stage], "route": f"cand-{cand.id}"}


# ------------------------------------------------------------------ list/overview
def case_matches(c: m.HrCase, ts: list[m.HrTask], f: dict, today: date) -> bool:
    if f.get("kind") and c.kind != f["kind"]: return False
    st = f.get("stage")
    if st == "active" and c.stage not in hr.ACTIVE_STAGES: return False
    if st and st not in ("active", "all") and c.stage != st: return False
    if f.get("owner_id") and c.owner_id != f["owner_id"]: return False
    if f.get("department") and c.department.lower() != f["department"].lower(): return False
    q = (f.get("q") or "").strip().lower()
    if q and q not in f"{c.display_name} {c.role_title} {c.department}".lower(): return False
    tds = [td(t) for t in ts]
    if f.get("overdue") and not any(hr.is_overdue(t, today) for t in tds): return False
    if f.get("blocked") and not any(t["status"] == "blocked" for t in tds): return False
    return True


def list_cases(db: Session, user: m.User, f: dict, page: int, per: int, sort: str) -> dict:
    today = now().date()
    rows = [(c, l, ts) for c, l, ts in visible_cases(db, user) if case_matches(c, ts, f, today)]
    ho_by: dict[int, list] = {}
    ids = [c.id for c, _, _ in rows if c.kind == "offboarding"]
    if ids:
        for h in db.scalars(select(m.HrHandoverItem).where(m.HrHandoverItem.case_id.in_(ids))): ho_by.setdefault(h.case_id, []).append(h)
    summ = [case_summary(db, c, l, ts, ho_by.get(c.id, []), today) for c, l, ts in rows]
    key = {"date": lambda s: (s["anchor_date"] or "9999", s["id"]), "name": lambda s: s["person"]["name"].lower(),
           "progress": lambda s: (s["progress"] or {"percent": 0})["percent"], "newest": lambda s: -s["id"]}.get(sort, lambda s: -s["id"])
    summ.sort(key=key)
    total = len(summ); start = (page - 1) * per
    return {"items": summ[start:start + per], "total": total, "page": page, "per": per}


def overview(db: Session, user: m.User) -> dict:
    today = now().date(); is_admin = user.role == "admin"
    vis = visible_cases(db, user)
    active = [(c, l, ts) for c, l, ts in vis if c.stage in hr.ACTIVE_STAGES]
    attention: list[dict] = []
    overdue = 0; blocked = 0
    for c, l, ts in active:
        route = ("onb-" if c.kind == "onboarding" else "off-") + str(c.id)
        if c.stage == "awaiting_approval" and is_admin:
            attention.append({"rank": 1, "what": "Approve onboarding", "person": c.display_name, "owner": uref(db, c.owner_id),
                              "due": c.anchor_date.isoformat() if c.anchor_date else None, "reason": "Waiting for approval. No task can be finished until then.", "route": route})
        if c.stage == "final_review" and is_admin:
            attention.append({"rank": 1, "what": "Do the final review", "person": c.display_name, "owner": uref(db, c.owner_id),
                              "due": c.anchor_date.isoformat() if c.anchor_date else None, "reason": "All required work is done. Waiting for an admin to complete the case.", "route": route})
        for t in ts:
            d = td(t)
            if t.status == "blocked":
                blocked += 1
                attention.append({"rank": 2, "what": t.title, "person": c.display_name, "owner": uref(db, t.owner_id), "due": t.due_date.isoformat() if t.due_date else None,
                                  "reason": f"Blocked: {t.blocked_reason or 'no reason recorded'}", "route": route})
            elif hr.is_overdue(d, today):
                overdue += 1
                attention.append({"rank": 3, "what": t.title, "person": c.display_name, "owner": uref(db, t.owner_id), "due": t.due_date.isoformat(),
                                  "reason": f"Overdue since {t.due_date.isoformat()}", "route": route})
        if c.kind == "offboarding" and l == "full" and c.anchor_date and (c.anchor_date - today).days <= 7:
            pend = db.scalar(select(func.count()).select_from(m.HrHandoverItem).where(m.HrHandoverItem.case_id == c.id, m.HrHandoverItem.status == "pending")) or 0
            if pend:
                attention.append({"rank": 2, "what": "Resolve engineering handover", "person": c.display_name, "owner": uref(db, c.owner_id), "due": c.anchor_date.isoformat(),
                                  "reason": f"{pend} item{'s' if pend != 1 else ''} still held by the person leaving. Last day is {c.anchor_date.isoformat()}.", "route": route})
    cands = {"awaiting_review": 0, "open": 0}
    if is_admin:
        for cd in db.scalars(select(m.HrCandidate).where(m.HrCandidate.stage.in_(("invited", "assessment_open", "submitted")))):
            if cd.stage == "submitted":
                cands["awaiting_review"] += 1
                attention.append({"rank": 1, "what": "Review candidate submission", "person": cd.name, "owner": None, "due": None,
                                  "reason": "The assessment was submitted and is waiting for a decision.", "route": f"cand-{cd.id}"})
            else:
                cands["open"] += 1
                if cd.deadline_at and cd.deadline_at <= now() and not db.scalar(select(m.HrSubmission.id).where(m.HrSubmission.candidate_id == cd.id)):
                    attention.append({"rank": 2, "what": "Assessment window ended", "person": cd.name, "owner": None, "due": hr.iso(cd.deadline_at)[:10],
                                      "reason": "No submission arrived. Extend the deadline or close the invitation.", "route": f"cand-{cd.id}"})
    attention.sort(key=lambda a: (a["rank"], a["due"] or "9999"))
    return {"counts": {"onboarding": sum(1 for c, _, _ in active if c.kind == "onboarding"), "offboarding": sum(1 for c, _, _ in active if c.kind == "offboarding"),
                       "awaiting_approval": sum(1 for c, _, _ in active if c.stage in ("awaiting_approval", "final_review")),
                       "overdue_tasks": overdue, "blocked_tasks": blocked, "candidates_awaiting_review": cands["awaiting_review"], "candidates_open": cands["open"]},
            "attention": attention[:25], "attention_total": len(attention),
            "can": {"start": is_admin, "review_candidates": is_admin}, "scope": "all" if is_admin else "yours"}


# ------------------------------------------------------------------- start a case
def _active_case_for(db: Session, kind: str, user_ids: set, cand_ids: set) -> m.HrCase | None:
    conds = []
    if user_ids: conds.append(m.HrCase.person_user_id.in_(user_ids))
    if cand_ids: conds.append(m.HrCase.candidate_id.in_(cand_ids))
    if not conds: return None
    return db.scalar(select(m.HrCase).where(m.HrCase.kind == kind, m.HrCase.stage.in_(hr.ACTIVE_STAGES), or_(*conds)).limit(1))


def _live_holdings(db: Session, uid: int) -> list[dict]:
    """Engineering work still assigned to this person. Finished work is history and is left alone."""
    out = []
    comps = db.scalars(select(m.Component).where(or_(m.Component.owner_id == uid, m.Component.reviewer_id == uid, m.Component.qa_id == uid))).unique().all()
    for c in comps:
        if c.status in hr.HISTORICAL_COMPONENT_STATUSES: continue
        for role, col in (("owner", c.owner_id), ("reviewer", c.reviewer_id), ("qa", c.qa_id)):
            if col == uid: out.append({"type": "component", "component_id": c.id, "role": role, "blocker_id": None})
    for b in db.scalars(select(m.Blocker).where(m.Blocker.responsible_id == uid, m.Blocker.resolved == False)):  # noqa: E712
        comp = db.get(m.Component, b.component_id)
        if comp and comp.status not in hr.HISTORICAL_COMPONENT_STATUSES:
            out.append({"type": "blocker", "component_id": b.component_id, "role": "blocker", "blocker_id": b.id})
    return out


def sync_handover(db: Session, c: m.HrCase, actor) -> dict:
    existing = case_handover(db, c.id)
    live = _live_holdings(db, c.person_user_id)
    diff = hr.sync_handover([hd(h) for h in existing], live)
    for l in diff["add"]:
        db.add(m.HrHandoverItem(case_id=c.id, component_id=l["component_id"], blocker_id=l["blocker_id"], role=l["role"], from_user_id=c.person_user_id, status="pending"))
    by_key = {hr.handover_key(hd(h)): h for h in existing}
    for r in diff["reopen"]:
        h = by_key[hr.handover_key(r)]; h.status = "pending"; h.accepted_by_id = None; h.accepted_at = None
    if diff["add"] or diff["reopen"]:
        event(db, actor, "handover.sync", case=c, detail=f"{len(diff['add'])} new item(s), {len(diff['reopen'])} reopened because the work is still held by the person leaving")
    db.flush()
    refresh_system_tasks(db, c)
    return {"added": len(diff["add"]), "reopened": len(diff["reopen"])}


def refresh_system_tasks(db: Session, c: m.HrCase):
    """The handover step completes itself from the handover items, so it can never be ticked by hand."""
    items = case_handover(db, c.id)
    for t in case_tasks(db, c.id):
        if t.system_key != "handover": continue
        resolved = all(h.status in hr.HANDOVER_RESOLVED for h in items)
        new = "completed" if resolved else ("in_progress" if any(h.status in hr.HANDOVER_RESOLVED for h in items) else ("blocked" if t.status == "blocked" else "not_started"))
        if new != t.status:
            t.status = new; t.version += 1
            t.completed_at = now() if new == "completed" else None
            t.completed_by_id = None


def _resolve_people(db: Session, b: dict):
    owner = db.get(m.User, b.get("owner_id")) if b.get("owner_id") else None
    if not owner or not owner.is_active: bad("Choose an active case owner.")
    mgr = db.get(m.User, b.get("manager_id")) if b.get("manager_id") else None
    if b.get("manager_id") and (not mgr or not mgr.is_active): bad("The manager must be an active account.")
    return owner, mgr


def start_case(db: Session, actor: m.User, b: dict) -> m.HrCase:
    kind = b.get("kind")
    if kind not in hr.KINDS: bad("kind must be onboarding or offboarding")
    errs: dict[str, str] = {}
    anchor = b.get("anchor_date")
    if not isinstance(anchor, date):
        errs["anchor_date"] = "Enter the planned start date." if kind == "onboarding" else "Enter the last working date."
    elif kind == "onboarding" and anchor < now().date() - timedelta(days=365): errs["anchor_date"] = "That start date is more than a year ago."
    owner, mgr = _resolve_people(db, b)
    cand = None; person = None; name = ""
    if kind == "offboarding":
        person = db.get(m.User, b.get("person_user_id")) if b.get("person_user_id") else None
        if not person: errs["person_user_id"] = "Choose the person who is leaving."
        else: name = uname(person)
        if person and owner.id == person.id: errs["owner_id"] = "The person leaving cannot own their own offboarding."
        if person and mgr and mgr.id == person.id: errs["manager_id"] = "The person leaving cannot be their own manager."
    else:
        if b.get("person_user_id"):
            person = db.get(m.User, b["person_user_id"])
            if not person: errs["person_user_id"] = "Person not found."
            else: name = uname(person)
        elif b.get("candidate_id"):
            cand = db.get(m.HrCandidate, b["candidate_id"])
            if not cand: errs["candidate_id"] = "Candidate not found."
            elif cand.stage != "approved": errs["candidate_id"] = "Only an approved candidate can be onboarded."
            else: name = cand.name; person = db.get(m.User, cand.user_id) if cand.user_id else None
        elif b.get("new_person"):
            np = b["new_person"]
            try:
                nm = hr.clean_text(np.get("name"), "Name", 160); em = hr.clean_text(np.get("email"), "Email", 200).lower()
                if not hr.EMAIL_RE.match(em): raise ValueError("Email is not a valid address")
            except ValueError as e:
                errs["new_person"] = str(e); nm = em = ""
            if not errs.get("new_person"):
                if db.scalar(select(m.User).where(m.User.email == em)): errs["new_person"] = "That email already belongs to a user. Choose them from the list instead."
                elif db.scalar(select(m.HrCandidate).where(m.HrCandidate.email == em, m.HrCandidate.stage.not_in(hr.CANDIDATE_TERMINAL[1:]))):
                    errs["new_person"] = "A candidate with that email already exists. Choose them from the candidate list."
                else:
                    cand = m.HrCandidate(name=nm, email=em, role_title=(np.get("role_title") or "").strip()[:160], stage="approved", version=1,
                                         decided_by_id=actor.id, decided_at=now(), decision_reason="Added directly. No assessment.", created_by_id=actor.id)
                    name = nm
        else: errs["person_user_id"] = "Choose a person, a candidate, or enter a new person."
        if person and owner.id == person.id: errs["owner_id"] = "Choose someone other than the new person as case owner."
    if errs: fields(errs)
    uids = {person.id} if person else set(); cids = {cand.id} if cand and cand.id else set()
    if person: cids |= {x for x in db.scalars(select(m.HrCandidate.id).where(m.HrCandidate.user_id == person.id))}
    if cand and cand.user_id: uids.add(cand.user_id)
    dup = _active_case_for(db, kind, uids, cids)
    if dup: raise HTTPException(409, {"message": f"{name} already has an active {kind} case. Finish or cancel it before starting another.", "case_id": dup.id})
    if cand is not None and cand.id is None: db.add(cand); db.flush(); event(db, actor, "candidate.create", candidate=cand, detail="Added directly with no assessment")
    tpl = template(db, kind)
    manager_id = mgr.id if mgr else (person.manager_id if person and person.manager_id else None)
    owners = {"case_owner": owner.id, "manager": manager_id or owner.id, "admin": actor.id, "person": person.id if (person and kind == "onboarding") else owner.id}
    c = m.HrCase(kind=kind, person_user_id=person.id if person else None, candidate_id=cand.id if cand else None, display_name=name,
                 role_title=(b.get("role_title") or (cand.role_title if cand else "") or (person.title if person else "") or "").strip()[:160],
                 department=(b.get("department") or (person.department if person else "") or "").strip()[:120], manager_id=manager_id, owner_id=owner.id,
                 anchor_date=anchor, stage="awaiting_approval" if kind == "onboarding" else "in_progress", template_version=tpl.version,
                 reason_category=(b.get("reason_category") or "").strip()[:80], restricted_notes=(b.get("restricted_notes") or "").strip()[:4000], created_by_id=actor.id)
    if kind == "onboarding" and cand is not None and cand.stage == "approved" and cand.decided_at:
        # An approved candidate already passed an approval. Carry it over rather than asking twice.
        c.stage = "ready"; c.approved_by_id = cand.decided_by_id; c.approved_at = cand.decided_at
    db.add(c); db.flush()
    overrides = b.get("task_owners") or {}
    for t in hr.build_tasks(tpl.tasks, anchor, owners):
        ov = overrides.get(t["key"])
        if ov:
            u = db.get(m.User, ov)
            if not u or not u.is_active: bad(f"Task owner for '{t['title']}' must be an active account.")
            t["owner_id"] = u.id
        db.add(m.HrTask(case_id=c.id, **t))
    event(db, actor, "case.start", case=c, to_stage=c.stage, detail=f"{kind} case started" + (" from an approved candidate" if cand else ""))
    db.flush()
    if kind == "offboarding": sync_handover(db, c, actor)
    notify(db, [owner.id], f"You own the {kind} case for {name}", None, exclude=actor.id)
    commit(db)
    return c


# ----------------------------------------------------------------- transitions
def transition(db: Session, user: m.User, c: m.HrCase, action: str, version, reason: str, request_id: str | None) -> m.HrCase:
    if seen_request(db, case_id=c.id, request_id=request_id): return c
    check_version(c.version, version)
    if c.kind == "offboarding": sync_handover(db, c, user)
    tasks = case_tasks(db, c.id); ho = case_handover(db, c.id)
    new, errs = hr.check_transition(c.kind, c.stage, action, is_admin=user.role == "admin", is_owner=user.id == c.owner_id,
                                    reason=reason, case=_case_facts(c), tasks=[td(t) for t in tasks], handover=[hd(h) for h in ho])
    if new is None:
        raise HTTPException(409 if "not allowed" in errs[0] else 403 if errs[0].startswith("Only") else 422, {"message": errs[0], "problems": errs})
    old = c.stage; c.stage = new; c.version += 1
    reason = (reason or "").strip()
    if action == "approve": c.approved_by_id, c.approved_at = user.id, now()
    if action == "complete": c.completed_by_id, c.completed_at = user.id, now()
    if action in ("cancel", "reject"): c.closed_reason = reason
    if action == "reopen": c.completed_by_id = c.completed_at = None
    event(db, user, f"case.{action}", case=c, from_stage=old, to_stage=new, detail=reason, sensitive=bool(reason) and c.kind == "offboarding", request_id=request_id)
    if action in ("approve", "reject", "complete", "cancel") and c.owner_id and c.owner_id != user.id:
        notify(db, [c.owner_id], f"{hr.ACTION_LABEL[action]}: {c.display_name}", None, exclude=user.id)
    commit(db)
    return c


# ----------------------------------------------------------------------- tasks
def update_task(db: Session, user: m.User, c: m.HrCase, t: m.HrTask, b: dict) -> m.HrTask:
    rid = b.get("request_id")
    if seen_request(db, case_id=c.id, request_id=rid): return t
    check_version(t.version, b.get("version"))
    change = {k: b[k] for k in ("status", "owner_id", "due_date", "evidence_note", "blocked_reason", "skip_reason") if k in b}
    if "owner_id" in change and change["owner_id"] is not None:
        u = db.get(m.User, change["owner_id"])
        if not u or not u.is_active: bad("The task owner must be an active account.")
    errs = hr.check_task_change(td(t), change, is_admin=user.role == "admin", is_case_owner=user.id == c.owner_id,
                                is_task_owner=t.owner_id == user.id, stage=c.stage)
    if errs: raise HTTPException(403 if errs[0].startswith(("You cannot", "Only")) else 422, {"message": errs[0], "problems": errs})
    stored = hr.apply_task_change(td(t), change, actor_id=user.id, now=now())
    old_status = t.status
    for k, v in stored.items(): setattr(t, k, v)
    t.version += 1
    if c.stage == "ready" and "status" in change and change["status"] in ("in_progress", "completed"):
        c.stage = "in_progress"; c.version += 1                      # work has begun
        event(db, user, "case.start", case=c, from_stage="ready", to_stage="in_progress", detail="Started by the first task update")
    bits = [f"{t.title}: {old_status.replace('_', ' ')} → {t.status.replace('_', ' ')}"] if t.status != old_status else [f"{t.title}: updated"]
    why = stored.get("blocked_reason") or stored.get("skip_reason") or ""
    detail = "; ".join(bits) + (f". {why[:200]}" if why and t.status in ("blocked", "not_applicable") else "")
    event(db, user, "task.update", case=c, detail=detail, sensitive=t.status == "not_applicable" and c.kind == "offboarding", request_id=rid)
    commit(db)
    return t


def add_task(db: Session, user: m.User, c: m.HrCase, b: dict) -> m.HrTask:
    if c.stage not in hr.ACTIVE_STAGES: bad("Tasks can only be added to an open case.", 409)
    try: title = hr.clean_text(b.get("title"), "Title", 200)
    except ValueError as e: fields({"title": str(e)})
    integ = b.get("integration", "none")
    if integ not in hr.INTEGRATIONS: fields({"integration": "Unknown system."})
    owner = db.get(m.User, b["owner_id"]) if b.get("owner_id") else None
    if b.get("owner_id") and (not owner or not owner.is_active): fields({"owner_id": "Choose an active account."})
    n = max([t.position for t in case_tasks(db, c.id)] + [-1]) + 1
    t = m.HrTask(case_id=c.id, position=n, key=f"custom_{n}", title=title, instructions=(b.get("instructions") or "").strip()[:1000],
                 category=(b.get("category") or "Additional").strip()[:80], required=bool(b.get("required", False)), owner_id=owner.id if owner else c.owner_id,
                 due_date=b.get("due_date"), integration=integ, confirmation="not_configured" if integ != "none" else "not_applicable")
    db.add(t); event(db, user, "task.add", case=c, detail=f"Added task: {title}"); commit(db)
    return t


# ----------------------------------------------------------------------- handover
def _item(db: Session, c: m.HrCase, hid: int) -> m.HrHandoverItem:
    h = db.get(m.HrHandoverItem, hid)
    if not h or h.case_id != c.id: bad("Handover item not found", 404)
    return h


def reassign(db: Session, user: m.User, c: m.HrCase, hid: int, to_user_id, note: str, request_id) -> m.HrHandoverItem:
    if seen_request(db, case_id=c.id, request_id=request_id): return _item(db, c, hid)
    if c.kind != "offboarding" or c.stage not in ("in_progress", "final_review"): bad("Handover can only change while an offboarding case is in progress.", 409)
    h = _item(db, c, hid); comp = db.get(m.Component, h.component_id)
    if comp.status in hr.HISTORICAL_COMPONENT_STATUSES: bad("This work is finished. Finished work keeps its history and is not reassigned.", 409)
    to = db.get(m.User, to_user_id) if to_user_id else None
    cur = {"owner_id": comp.owner_id, "reviewer_id": comp.reviewer_id, "qa_id": comp.qa_id}
    if h.blocker_id:
        b = db.get(m.Blocker, h.blocker_id)
        if b.resolved: bad("This blocker is already resolved.", 409)
        held = b.responsible_id == h.from_user_id
    else:
        held = cur.get(h.role + "_id") == h.from_user_id
    if not held: bad("The person leaving no longer holds this. Refresh the handover list.", 409)
    errs = hr.check_reassignment(h.role, from_user=h.from_user_id, to_user=to.id if to else None, to_active=bool(to and to.is_active), current=cur)
    if errs: bad(errs[0])
    old_name = uname(db.get(m.User, h.from_user_id))
    if h.blocker_id: b.responsible_id = to.id
    else: setattr(comp, h.role + "_id", to.id)
    h.to_user_id, h.status, h.decided_by_id, h.decided_at = to.id, "reassigned", user.id, now()
    h.accepted_by_id = h.accepted_at = None
    label = {"owner": "owner", "reviewer": "reviewer", "qa": "QA contact", "blocker": "blocker responsibility"}[h.role]
    # Component history is visible to every member, so it states the change and not the reason for it.
    audit(db, user, "component.update", f"reassigned {label}: {old_name} → {uname(to)}", comp.id)
    notify(db, [to.id], f"You are now {label} for {comp.code} · {comp.name}", comp.id, exclude=user.id)
    event(db, user, "handover.reassign", case=c, detail=f"{comp.code} {label} → {uname(to)}" + (f". Note: {(note or '').strip()[:200]}" if (note or "").strip() else ""), request_id=request_id)
    db.flush(); refresh_system_tasks(db, c); commit(db)
    return h


def accept_item(db: Session, user: m.User, c: m.HrCase, hid: int, request_id) -> m.HrHandoverItem:
    if seen_request(db, case_id=c.id, request_id=request_id): return _item(db, c, hid)
    h = _item(db, c, hid)
    if h.status != "reassigned": bad("Only a reassigned item can be accepted.", 409)
    if not (user.role == "admin" or user.id == h.to_user_id or user.id == c.owner_id): bad("Only the new owner, the case owner or an admin can accept this.", 403)
    h.status, h.accepted_by_id, h.accepted_at = "accepted", user.id, now()
    event(db, user, "handover.accept", case=c, detail=f"{db.get(m.Component, h.component_id).code} {h.role} accepted", request_id=request_id)
    db.flush(); refresh_system_tasks(db, c); commit(db)
    return h


def record_exception(db: Session, user: m.User, c: m.HrCase, hid: int, reason: str, request_id) -> m.HrHandoverItem:
    if seen_request(db, case_id=c.id, request_id=request_id): return _item(db, c, hid)
    if user.role != "admin": bad("Only an admin can record an exception.", 403)
    if len((reason or "").strip()) < hr.MIN_SKIP_REASON: bad(f"Say why this is being left as it is (at least {hr.MIN_SKIP_REASON} characters).")
    if c.stage not in ("in_progress", "final_review"): bad("Handover can only change while an offboarding case is in progress.", 409)
    h = _item(db, c, hid)
    if h.status == "exception": return h
    h.status, h.exception_reason, h.decided_by_id, h.decided_at = "exception", reason.strip(), user.id, now()
    event(db, user, "handover.exception", case=c, detail=f"{db.get(m.Component, h.component_id).code} {h.role}: {reason.strip()}", sensitive=True, request_id=request_id)
    db.flush(); refresh_system_tasks(db, c); commit(db)
    return h


# ----------------------------------------------------------------------- people
def person_context(db: Session, user: m.User, uid: int) -> dict:
    target = db.get(m.User, uid)
    if not target: bad("Person not found", 404)
    mine = [(c, l, ts) for c, l, ts in visible_cases(db, user) if c.person_user_id == uid or (c.candidate_id and db.scalar(select(m.HrCandidate.user_id).where(m.HrCandidate.id == c.candidate_id)) == uid)]
    full = [(c, l) for c, l, _ in mine if l == "full"]
    if user.role != "admin" and not full and user.id != uid: bad("Person not found", 404)
    eng = {"owner": [], "reviewer": [], "qa": []}
    for c in db.scalars(select(m.Component).where(or_(m.Component.owner_id == uid, m.Component.reviewer_id == uid, m.Component.qa_id == uid))).unique().all():
        for role, col in (("owner", c.owner_id), ("reviewer", c.reviewer_id), ("qa", c.qa_id)):
            if col == uid: eng[role].append({"id": c.id, "code": c.code, "name": c.name, "status": c.status, "historical": c.status in hr.HISTORICAL_COMPONENT_STATUSES})
    blockers = db.scalar(select(func.count()).select_from(m.Blocker).where(m.Blocker.responsible_id == uid, m.Blocker.resolved == False)) or 0  # noqa: E712
    cs = [{"id": c.id, "kind": c.kind, "stage": c.stage} for c, _ in full]
    seen = user.role == "admin" or bool(full)
    return {"user_id": uid, "lifecycle": hr.lifecycle_status(cs) if seen else None, "lifecycle_label": hr.LIFECYCLE_LABEL[hr.lifecycle_status(cs)] if seen else None,
            "cases": [{"id": c.id, "kind": c.kind, "stage": c.stage, "stage_label": hr.STAGE_LABEL[c.stage], "route": ("onb-" if c.kind == "onboarding" else "off-") + str(c.id)} for c, _ in full],
            "engineering": {**eng, "open_blockers": blockers}, "manager": uref(db, target.manager_id),
            "account": {"active": target.is_active, "note": "Account access is separate from lifecycle status. Offboarding does not disable it."}}


def people_lifecycle(db: Session, user: m.User) -> list[dict]:
    by: dict[int, list] = {}
    cand_user = {c.id: c.user_id for c in db.scalars(select(m.HrCandidate)) if c.user_id}
    for c, l, _ in visible_cases(db, user):
        uid = c.person_user_id or cand_user.get(c.candidate_id)
        if uid and l == "full": by.setdefault(uid, []).append({"id": c.id, "kind": c.kind, "stage": c.stage})
    return [{"user_id": uid, "lifecycle": hr.lifecycle_status(cs), "lifecycle_label": hr.LIFECYCLE_LABEL[hr.lifecycle_status(cs)]} for uid, cs in by.items()
            if hr.lifecycle_status(cs) != "active"]
