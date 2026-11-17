"""Candidate assessments: invitation link + one-time code, deadline, text/repository submission, receipt, review.

Ported from the standalone HR portal, which delegated all of this to an external service. Here HQ owns it.
Codes and tokens are stored as keyed hashes. Every timestamp comes from the server clock. Uploads are not accepted.
Email delivery is not configured: the invitation link and code are shown once to the admin, who shares them.
"""
from datetime import datetime, timedelta
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from . import models as m, hr
from .config import JWT_SECRET
from .hr_service import bad, fields, event, seen_request, commit, check_version, uname

now = lambda: datetime.utcnow()
GENERIC = "That link or code is not valid, or it has expired. Ask the person who invited you for a new one."
H = lambda v: hr.hash_secret(v, JWT_SECRET)


def get_candidate(db: Session, cid: int) -> m.HrCandidate:
    c = db.get(m.HrCandidate, cid)
    if not c: bad("Candidate not found", 404)
    return c


def _issue(db: Session, cand: m.HrCandidate, actor) -> dict:
    """Revoke any live access, then issue a fresh link and code. The secrets are returned once and never stored in the clear."""
    for a in db.scalars(select(m.HrCandidateAccess).where(m.HrCandidateAccess.candidate_id == cand.id, m.HrCandidateAccess.revoked == False)):  # noqa: E712
        a.revoked = True
    token, code = hr.new_token(), hr.new_code()
    db.add(m.HrCandidateAccess(candidate_id=cand.id, invitation_hash=H(token), code_hash=H(code), code_expires_at=now() + hr.CODE_TTL, issued_by_id=getattr(actor, "id", None)))
    return {"invitation_path": f"/#candidate={token}", "code": code, "code_valid_minutes": int(hr.CODE_TTL.total_seconds() // 60),
            "delivery": "Email delivery is not configured. Share the link and the code with the candidate yourself. They are shown only once."}


def create_candidate(db: Session, actor: m.User, b: dict) -> tuple[m.HrCandidate, dict]:
    errs: dict[str, str] = {}
    def t(k, label, n, req=True):
        try: return hr.clean_text(b.get(k), label, n, req)
        except ValueError as e: errs[k] = str(e); return ""
    name = t("name", "Name", 160); email = t("email", "Email", 200).lower(); role = t("role_title", "Role", 160, False)
    title = t("assessment_title", "Assessment title", 200); brief = t("assessment_brief", "Assessment brief", 10000)
    instr = t("assessment_instructions", "Instructions", 10000, False)
    if email and not hr.EMAIL_RE.match(email): errs["email"] = "Enter a valid email address."
    hours = b.get("assessment_hours", hr.ASSESSMENT_HOURS)
    if hr.check_extension_hours(hours): errs["assessment_hours"] = hr.check_extension_hours(hours)[0]
    if email and not errs.get("email") and db.scalar(select(m.HrCandidate.id).where(m.HrCandidate.email == email, m.HrCandidate.stage.in_(("invited", "assessment_open", "submitted")))):
        errs["email"] = "This person already has an open invitation."
    if errs: fields(errs)
    cand = m.HrCandidate(name=name, email=email, role_title=role, assessment_title=title, assessment_brief=brief, assessment_instructions=instr,
                         assessment_hours=hours, stage="invited", version=1, created_by_id=actor.id)
    db.add(cand); db.flush()
    secrets_out = _issue(db, cand, actor)
    event(db, actor, "candidate.invite", candidate=cand, to_stage="invited", detail=f"Invited for {title}")
    commit(db)
    return cand, secrets_out


def _sub(db, cid): return db.scalar(select(m.HrSubmission).where(m.HrSubmission.candidate_id == cid))


def candidate_out(db: Session, cand: m.HrCandidate, *, detail=False) -> dict:
    sub = _sub(db, cand.id); n = now()
    view = hr.candidate_stage_view(cand.stage, cand.deadline_at, bool(sub), n)
    d = {"id": cand.id, "name": cand.name, "email": cand.email, "role_title": cand.role_title, "stage": cand.stage, "view": view,
         "stage_label": "Assessment window ended" if view == "expired" else hr.CANDIDATE_LABEL[cand.stage], "version": cand.version,
         "assessment_title": cand.assessment_title, "assessment_hours": cand.assessment_hours,
         "first_sign_in_at": hr.iso(cand.first_sign_in_at), "deadline_at": hr.iso(cand.deadline_at), "submitted": bool(sub),
         "received_at": hr.iso(sub.received_at) if sub else None, "created_at": hr.iso(cand.created_at),
         "onboarding_case_id": db.scalar(select(m.HrCase.id).where(m.HrCase.candidate_id == cand.id, m.HrCase.kind == "onboarding").order_by(m.HrCase.id.desc()).limit(1))}
    if detail:
        d.update({"assessment_brief": cand.assessment_brief, "assessment_instructions": cand.assessment_instructions, "decision_reason": cand.decision_reason,
                  "decided_by": uname(db.get(m.User, cand.decided_by_id)) if cand.decided_by_id else None, "decided_at": hr.iso(cand.decided_at),
                  "submission": ({"notes": sub.notes, "repository_url": sub.repository_url, "linkedin_url": sub.linkedin_url, "receipt_id": sub.receipt_id,
                                  "checksum": sub.checksum, "received_at": hr.iso(sub.received_at)} if sub else None),
                  "actions": [{"action": a, "label": hr.CANDIDATE_ACTION_LABEL[a],
                               "enabled": not hr.candidate_action_problems(a, cand.stage, expired=view == "expired", has_submission=bool(sub), reason="x" * 5, last_issue=None, now=n),
                               "needs_reason": a in ("approve", "reject", "cancel", "extend")} for a in hr.CANDIDATE_ACTIONS if cand.stage in hr.CANDIDATE_ACTIONS[a]],
                  "events": [{"id": e.id, "action": e.action, "actor": uname(e.actor) or "Candidate", "detail": e.detail, "created_at": hr.iso(e.created_at), "from_stage": e.from_stage, "to_stage": e.to_stage}
                             for e in db.scalars(select(m.HrEvent).where(m.HrEvent.candidate_id == cand.id).order_by(m.HrEvent.id.desc()).limit(100))]})
    return d


def act(db: Session, actor: m.User, cand: m.HrCandidate, b: dict) -> tuple[m.HrCandidate, dict | None]:
    action = b.get("action"); rid = b.get("request_id"); reason = (b.get("reason") or "").strip()
    if seen_request(db, candidate_id=cand.id, request_id=rid): return cand, None
    check_version(cand.version, b.get("version"))
    sub = _sub(db, cand.id); n = now()
    expired = hr.candidate_stage_view(cand.stage, cand.deadline_at, bool(sub), n) == "expired"
    last = db.scalar(select(m.HrCandidateAccess.issued_at).where(m.HrCandidateAccess.candidate_id == cand.id).order_by(m.HrCandidateAccess.id.desc()).limit(1))
    errs = hr.candidate_action_problems(action, cand.stage, expired=expired and action != "extend", has_submission=bool(sub), reason=reason, last_issue=last, now=n)
    if action == "extend": errs += hr.check_extension_hours(b.get("hours"))
    if errs: raise HTTPException(409 if "not allowed" in errs[0] else 422, {"message": errs[0], "problems": errs})
    old = cand.stage; out = None
    if action == "approve": cand.stage = "approved"
    elif action == "reject": cand.stage = "rejected"
    elif action == "cancel": cand.stage = "cancelled"
    if action in ("approve", "reject", "cancel"):
        cand.decided_by_id, cand.decided_at, cand.decision_reason = actor.id, n, reason
        for a in db.scalars(select(m.HrCandidateAccess).where(m.HrCandidateAccess.candidate_id == cand.id)): a.revoked = True
        for s in db.scalars(select(m.HrCandidateSession).where(m.HrCandidateSession.candidate_id == cand.id)): s.revoked = True
    if action == "extend":
        cand.deadline_at = hr.extend_deadline(cand.deadline_at, n, b["hours"])
        if cand.stage == "invited": cand.deadline_at = None   # clock has not started; the window still opens at first sign-in
    if action == "reissue": out = _issue(db, cand, actor)
    cand.version += 1
    event(db, actor, f"candidate.{action}", candidate=cand, from_stage=old, to_stage=cand.stage, detail=reason or (f"{b.get('hours')} hours" if action == "extend" else ""), sensitive=bool(reason), request_id=rid)
    commit(db)
    return cand, out


# ---------------------------------------------------------------- public side
def _live_access(db: Session, token: str) -> m.HrCandidateAccess | None:
    return db.scalar(select(m.HrCandidateAccess).where(m.HrCandidateAccess.invitation_hash == H(token), m.HrCandidateAccess.revoked == False))  # noqa: E712


def invitation_info(db: Session, token: str) -> dict:
    a = _live_access(db, token)
    cand = db.get(m.HrCandidate, a.candidate_id) if a else None
    if not cand or cand.stage in hr.CANDIDATE_TERMINAL: bad(GENERIC, 404)
    return {"assessment_title": cand.assessment_title, "needs_code": True}


def verify(db: Session, token: str, code: str) -> dict:
    a = _live_access(db, token)
    cand = db.get(m.HrCandidate, a.candidate_id) if a else None
    if not a or not cand or cand.stage in hr.CANDIDATE_TERMINAL: bad(GENERIC, 400)
    n = now()
    if a.used_at or n >= a.code_expires_at or a.failed_attempts >= hr.MAX_CODE_ATTEMPTS: bad(GENERIC, 400)
    if not hr.same_secret(a.code_hash, H((code or "").strip())):
        a.failed_attempts += 1
        if a.failed_attempts >= hr.MAX_CODE_ATTEMPTS: a.revoked = True
        db.commit(); bad(GENERIC, 400)
    a.used_at = n
    if cand.first_sign_in_at is None:
        cand.first_sign_in_at = n; cand.deadline_at = hr.deadline_from(n, cand.assessment_hours)
        cand.stage = "assessment_open"; cand.version += 1
        event(db, None, "candidate.sign_in", candidate=cand, from_stage="invited", to_stage="assessment_open", detail=f"Window of {cand.assessment_hours} hours started")
    token_out = hr.new_token()
    db.add(m.HrCandidateSession(candidate_id=cand.id, token_hash=H(token_out), expires_at=n + hr.SESSION_TTL))
    db.commit()
    return {"session": token_out, "expires_in_minutes": int(hr.SESSION_TTL.total_seconds() // 60)}


def session_candidate(db: Session, token: str) -> m.HrCandidate:
    s = db.scalar(select(m.HrCandidateSession).where(m.HrCandidateSession.token_hash == H(token or ""), m.HrCandidateSession.revoked == False))  # noqa: E712
    if not s or now() >= s.expires_at: bad("Your session has ended. Ask for a new code.", 401)
    cand = db.get(m.HrCandidate, s.candidate_id)
    if not cand or cand.stage in ("rejected", "cancelled"): bad("This invitation is no longer active.", 401)
    return cand


def my_view(db: Session, cand: m.HrCandidate) -> dict:
    sub = _sub(db, cand.id); n = now()
    view = hr.candidate_stage_view(cand.stage, cand.deadline_at, bool(sub), n)
    return {"name": cand.name, "assessment_title": cand.assessment_title, "brief": cand.assessment_brief, "instructions": cand.assessment_instructions,
            "deadline_at": hr.iso(cand.deadline_at), "server_time": hr.iso(n), "state": view, "can_submit": view == "assessment_open",
            "receipt": ({"receipt_id": sub.receipt_id, "received_at": hr.iso(sub.received_at), "checksum": sub.checksum} if sub else None),
            "note": "Your deadline is measured by the server clock, not your device."}


def submit(db: Session, cand: m.HrCandidate, b: dict) -> dict:
    sub = _sub(db, cand.id); op = (b.get("operation_id") or "").strip()[:80]
    if not op: bad("operation_id is required")
    if sub:   # idempotent: the same operation returns the same receipt, a different one is refused
        if sub.operation_id == op: return {"receipt_id": sub.receipt_id, "received_at": hr.iso(sub.received_at), "checksum": sub.checksum, "repeat": True}
        bad("You have already submitted. A submission cannot be changed.", 409)
    if cand.stage != "assessment_open": bad("This assessment is not open for submissions.", 409)
    n = now()
    if cand.deadline_at and n >= cand.deadline_at: bad("The assessment window has ended.", 410)
    errs = hr.validate_submission(b.get("notes"), b.get("repository_url"), b.get("linkedin_url"))
    if errs: fields({{"repositoryUrl": "repository_url", "linkedinUrl": "linkedin_url"}.get(k, k): v for k, v in errs.items()})
    notes, repo, li = (b.get("notes") or "").strip(), (b.get("repository_url") or "").strip(), (b.get("linkedin_url") or "").strip()
    chk = hr.submission_checksum(notes, repo, li)
    s = m.HrSubmission(candidate_id=cand.id, operation_id=op, notes=notes, repository_url=repo, linkedin_url=li, checksum=chk, receipt_id=hr.receipt_id(cand.id, chk), received_at=n)
    db.add(s); cand.stage = "submitted"; cand.version += 1
    if li and not cand.linkedin_url: cand.linkedin_url = li
    event(db, None, "candidate.submit", candidate=cand, from_stage="assessment_open", to_stage="submitted", detail=f"Receipt {s.receipt_id}")
    commit(db)
    return {"receipt_id": s.receipt_id, "received_at": hr.iso(n), "checksum": chk, "repeat": False}
