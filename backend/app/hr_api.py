"""HTTP surface for People / HR. Staff routes live under /api/hr and need an HQ sign-in.
Candidate routes live under /api/candidate and use a separate session header, never an HQ token.
Every handler asks hr_service for access, so a direct URL, a list, a count and a mutation all share one rule."""
from datetime import date
from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from . import models as m, hr, hr_service as hs, hr_candidates as hc, hr_integrations
from .db import get_db
from .security import current_user, require_admin

router = APIRouter(prefix="/api/hr")
candidate_router = APIRouter(prefix="/api/candidate")


class NewPerson(BaseModel):
    name: str; email: str; role_title: str = ""

class CaseIn(BaseModel):
    kind: str
    person_user_id: int | None = None
    candidate_id: int | None = None
    new_person: NewPerson | None = None
    owner_id: int
    manager_id: int | None = None
    anchor_date: date | None = None
    role_title: str = ""
    department: str = ""
    reason_category: str = ""
    restricted_notes: str = ""
    task_owners: dict[str, int] = {}

class ActionIn(BaseModel):
    action: str; version: int | None = None; reason: str = ""; request_id: str | None = None

class TaskIn(BaseModel):
    version: int | None = None; request_id: str | None = None
    status: str | None = None; owner_id: int | None = None; due_date: date | None = None
    evidence_note: str | None = None; blocked_reason: str | None = None; skip_reason: str | None = None

class TaskNew(BaseModel):
    title: str; instructions: str = ""; category: str = "Additional"; required: bool = False
    owner_id: int | None = None; due_date: date | None = None; integration: str = "none"

class ReassignIn(BaseModel):
    to_user_id: int | None = None; note: str = ""; request_id: str | None = None

class ItemIn(BaseModel):
    reason: str = ""; request_id: str | None = None

class TemplateIn(BaseModel):
    tasks: list[dict]; version: int | None = None

class CandidateIn(BaseModel):
    name: str = ""; email: str = ""; role_title: str = ""
    assessment_title: str = ""; assessment_brief: str = ""; assessment_instructions: str = ""
    assessment_hours: int = hr.ASSESSMENT_HOURS

class CandidateAct(BaseModel):
    action: str; version: int | None = None; reason: str = ""; hours: int | None = None; request_id: str | None = None


# ------------------------------------------------------------------- overview
@router.get("/overview")
def overview(db: Session = Depends(get_db), user=Depends(current_user)):
    return hs.overview(db, user)


@router.get("/lifecycle")
def lifecycle(db: Session = Depends(get_db), user=Depends(current_user)):
    """Only people who are not simply active are listed, and only those this user may see."""
    return hs.people_lifecycle(db, user)


@router.get("/people/{uid}")
def person(uid: int, db: Session = Depends(get_db), user=Depends(current_user)):
    return hs.person_context(db, user, uid)


@router.get("/integrations")
def integrations(user=Depends(current_user)):
    return {"items": hr_integrations.integration_status(), "note": "No external system is connected. Steps that depend on one are confirmed by hand."}


# ---------------------------------------------------------------------- cases
@router.get("/cases")
def cases(kind: str | None = None, stage: str | None = "active", owner_id: int | None = None, department: str | None = None, q: str | None = None,
          overdue: bool = False, blocked: bool = False, sort: str = "newest", page: int = Query(1, ge=1), per: int = Query(20, ge=1, le=100),
          db: Session = Depends(get_db), user=Depends(current_user)):
    if kind and kind not in hr.KINDS: hs.bad("kind must be onboarding or offboarding")
    if stage and stage not in ("active", "all") and stage not in hr.STAGES: hs.bad("Unknown stage")
    return hs.list_cases(db, user, {"kind": kind, "stage": stage, "owner_id": owner_id, "department": department, "q": q, "overdue": overdue, "blocked": blocked}, page, per, sort)


@router.post("/cases", status_code=201)
def start_case(b: CaseIn, db: Session = Depends(get_db), admin=Depends(require_admin)):
    c = hs.start_case(db, admin, b.model_dump())
    _, lvl, ts = hs.load_for(db, admin, c.id)
    return hs.case_detail(db, c, lvl, ts, admin)


@router.get("/cases/{cid}")
def case(cid: int, db: Session = Depends(get_db), user=Depends(current_user)):
    c, lvl, ts = hs.load_for(db, user, cid)
    return hs.case_detail(db, c, lvl, ts, user)


@router.post("/cases/{cid}/actions")
def case_action(cid: int, b: ActionIn, db: Session = Depends(get_db), user=Depends(current_user)):
    c, lvl, _ = hs.load_for(db, user, cid, need="full")
    hs.transition(db, user, c, b.action, b.version, b.reason, b.request_id)
    c, lvl, ts = hs.load_for(db, user, cid)
    return hs.case_detail(db, c, lvl, ts, user)


@router.patch("/cases/{cid}/tasks/{tid}")
def patch_task(cid: int, tid: int, b: TaskIn, db: Session = Depends(get_db), user=Depends(current_user)):
    c, lvl, ts = hs.load_for(db, user, cid)
    t = next((x for x in ts if x.id == tid), None)
    if not t: hs.bad("Task not found", 404)         # a task owner cannot reach a task that is not theirs
    hs.update_task(db, user, c, t, b.model_dump(exclude_unset=True))
    c, lvl, ts = hs.load_for(db, user, cid)
    return hs.case_detail(db, c, lvl, ts, user)


@router.post("/cases/{cid}/tasks", status_code=201)
def new_task(cid: int, b: TaskNew, db: Session = Depends(get_db), user=Depends(current_user)):
    c, _, _ = hs.load_for(db, user, cid, need="full")
    if not (user.role == "admin" or user.id == c.owner_id): hs.bad("Only an admin or the case owner can add tasks.", 403)
    hs.add_task(db, user, c, b.model_dump())
    c, lvl, ts = hs.load_for(db, user, cid)
    return hs.case_detail(db, c, lvl, ts, user)


@router.post("/cases/{cid}/handover/sync")
def handover_sync(cid: int, db: Session = Depends(get_db), user=Depends(current_user)):
    c, _, _ = hs.load_for(db, user, cid, need="full")
    if c.kind != "offboarding": hs.bad("Only an offboarding case has a handover.", 409)
    if not (user.role == "admin" or user.id == c.owner_id or user.id == c.manager_id): hs.bad("You cannot change this handover.", 403)
    res = hs.sync_handover(db, c, user); hs.commit(db)
    c, lvl, ts = hs.load_for(db, user, cid)
    return {**res, "case": hs.case_detail(db, c, lvl, ts, user)}


def _can_handle(user, c):
    if not (user.role == "admin" or user.id == c.owner_id or user.id == c.manager_id): hs.bad("You cannot change this handover.", 403)


@router.post("/cases/{cid}/handover/{hid}/reassign")
def handover_reassign(cid: int, hid: int, b: ReassignIn, db: Session = Depends(get_db), user=Depends(current_user)):
    c, _, _ = hs.load_for(db, user, cid, need="full"); _can_handle(user, c)
    hs.reassign(db, user, c, hid, b.to_user_id, b.note, b.request_id)
    c, lvl, ts = hs.load_for(db, user, cid)
    return hs.case_detail(db, c, lvl, ts, user)


@router.post("/cases/{cid}/handover/{hid}/accept")
def handover_accept(cid: int, hid: int, b: ItemIn, db: Session = Depends(get_db), user=Depends(current_user)):
    c = hs.get_case(db, cid)
    item = db.get(m.HrHandoverItem, hid)
    full = hs.access_for(user, c, hs.case_tasks(db, cid)) == "full"
    # The new owner may have no access to the case itself. They may accept only their own item.
    if not item or item.case_id != cid or not (full or item.to_user_id == user.id): hs.bad("Case not found", 404)
    hs.accept_item(db, user, c, hid, b.request_id)
    if not full: return {"ok": True}
    c, lvl, ts = hs.load_for(db, user, cid)
    return hs.case_detail(db, c, lvl, ts, user)


@router.post("/cases/{cid}/handover/{hid}/exception")
def handover_exception(cid: int, hid: int, b: ItemIn, db: Session = Depends(get_db), admin=Depends(require_admin)):
    c, _, _ = hs.load_for(db, admin, cid, need="full")
    hs.record_exception(db, admin, c, hid, b.reason, b.request_id)
    c, lvl, ts = hs.load_for(db, admin, cid)
    return hs.case_detail(db, c, lvl, ts, admin)


# ------------------------------------------------------------------- templates
@router.get("/templates")
def templates(db: Session = Depends(get_db), user=Depends(current_user)):
    return {t.kind: {"name": t.name, "tasks": t.tasks, "version": t.version} for t in (hs.template(db, k) for k in hr.KINDS)}


@router.put("/templates/{kind}")
def save_template(kind: str, b: TemplateIn, db: Session = Depends(get_db), admin=Depends(require_admin)):
    errs = hr.validate_template_tasks(kind, b.tasks)
    if errs: raise hs.HTTPException(422, {"message": errs[0], "problems": errs})
    t = hs.template(db, kind)
    hs.check_version(t.version, b.version)
    t.tasks = hr.clean_template_tasks(b.tasks); t.version += 1; t.updated_by_id = admin.id
    hs.commit(db)
    return {"name": t.name, "tasks": t.tasks, "version": t.version, "note": "Cases already started keep the checklist they were started with."}


# ------------------------------------------------------------------ candidates
@router.get("/candidates")
def candidates(stage: str | None = None, q: str | None = None, db: Session = Depends(get_db), admin=Depends(require_admin)):
    rows = [hc.candidate_out(db, c) for c in db.scalars(select(m.HrCandidate).order_by(m.HrCandidate.id.desc()))]
    if stage: rows = [r for r in rows if r["stage"] == stage or r["view"] == stage]
    if q: rows = [r for r in rows if q.lower() in f"{r['name']} {r['email']}".lower()]
    return {"items": rows, "total": len(rows)}


@router.post("/candidates", status_code=201)
def invite(b: CandidateIn, db: Session = Depends(get_db), admin=Depends(require_admin)):
    cand, secrets = hc.create_candidate(db, admin, b.model_dump())
    return {"candidate": hc.candidate_out(db, cand, detail=True), "access": secrets}


@router.get("/candidates/{cid}")
def candidate(cid: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    return hc.candidate_out(db, hc.get_candidate(db, cid), detail=True)


@router.post("/candidates/{cid}/actions")
def candidate_action(cid: int, b: CandidateAct, db: Session = Depends(get_db), admin=Depends(require_admin)):
    cand, access = hc.act(db, admin, hc.get_candidate(db, cid), b.model_dump())
    return {"candidate": hc.candidate_out(db, cand, detail=True), "access": access}


# --------------------------------------------------------------- candidate side
class VerifyIn(BaseModel):
    invitation: str; code: str

class SubmitIn(BaseModel):
    operation_id: str; notes: str = ""; repository_url: str = ""; linkedin_url: str = ""


@candidate_router.get("/invitation")
def invitation(token: str, db: Session = Depends(get_db)):
    return hc.invitation_info(db, token)


@candidate_router.post("/verify")
def verify(b: VerifyIn, db: Session = Depends(get_db)):
    return hc.verify(db, b.invitation, b.code)


@candidate_router.get("/me")
def me(db: Session = Depends(get_db), x_candidate_session: str = Header(default="")):
    return hc.my_view(db, hc.session_candidate(db, x_candidate_session))


@candidate_router.post("/submit")
def submit(b: SubmitIn, db: Session = Depends(get_db), x_candidate_session: str = Header(default="")):
    return hc.submit(db, hc.session_candidate(db, x_candidate_session), b.model_dump())
