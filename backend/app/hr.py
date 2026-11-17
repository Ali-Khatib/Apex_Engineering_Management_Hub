"""HR rules for Apex HQ: onboarding, offboarding, candidate review.

Pure functions only. No framework, database or clock imports: callers pass in
plain values (and `now` where time matters), so every rule here is testable on
its own. The service and API layers load rows, call these, and store results.

Honesty rules this module encodes
---------------------------------
* A task bound to an external system (VPN, ERP, Slack, Calendar, contract) can
  only be completed with a recorded confirmation, and the confirmation is
  labelled `manually_confirmed`. Nothing here ever produces `confirmed`; only a
  real integration adapter may, and none is configured.
* Required approvals, required tasks and unresolved engineering handover block
  completion. Skipping a required task needs an admin and a written reason.
* Lifecycle status is derived from cases. It is a different axis from login
  access: finishing offboarding does not deactivate an account.
"""
import hashlib
import hmac
import re
import secrets
from datetime import date, datetime, timedelta
from urllib.parse import urlparse

# ----------------------------------------------------------------- vocabulary
KINDS = ("onboarding", "offboarding")
STAGES = ("awaiting_approval", "ready", "in_progress", "final_review", "completed", "cancelled")
ACTIVE_STAGES = ("awaiting_approval", "ready", "in_progress", "final_review")
TERMINAL_STAGES = ("completed", "cancelled")

STAGE_LABEL = {
    "awaiting_approval": "Awaiting approval", "ready": "Ready to start", "in_progress": "In progress",
    "final_review": "In final review", "completed": "Completed", "cancelled": "Cancelled",
}

TASK_STATUSES = ("not_started", "in_progress", "completed", "blocked", "not_applicable")
# What an external-system task can honestly say about itself.
CONFIRMATIONS = ("not_applicable", "pending", "manually_confirmed", "confirmed", "failed", "not_configured")
INTEGRATIONS = ("none", "erp", "vpn", "slack", "calendar", "contract")
SATISFIED_CONFIRMATIONS = ("manually_confirmed", "confirmed")

HANDOVER_ROLES = ("owner", "reviewer", "qa", "blocker")
HANDOVER_STATUSES = ("pending", "reassigned", "accepted", "exception")
HANDOVER_RESOLVED = ("reassigned", "accepted", "exception")
# Work that has finished is history; a departure does not touch it.
HISTORICAL_COMPONENT_STATUSES = ("done", "deployed")

MIN_REASON = 5
MIN_SKIP_REASON = 10

# ------------------------------------------------------------- default template
# Drafted as proposed defaults for Apex admins to review and edit. They are not
# a statement of an existing Apex policy. `owner` says who a task starts with:
# case_owner | manager | admin | person (the person themselves, onboarding only).
DEFAULT_TEMPLATES = {
    "onboarding": [
        {"key": "pre_joining", "title": "Collect pre-joining information", "category": "Pre-joining", "required": True,
         "integration": "none", "owner": "case_owner", "offset_days": -7,
         "instructions": "Confirm the details the person must provide before day one. Ask only for what is needed."},
        {"key": "agreement", "title": "Agreement signed and filed", "category": "Agreements and documents", "required": True,
         "integration": "contract", "owner": "case_owner", "offset_days": -3,
         "instructions": "Confirm the signed agreement is filed. Record where, in the evidence note. Contract signing is not connected to HQ, so this is a manual confirmation."},
        {"key": "equipment", "title": "Prepare and hand over equipment", "category": "Equipment", "required": False,
         "integration": "none", "owner": "case_owner", "offset_days": -1,
         "instructions": "List what was issued. Mark not applicable, with a reason, if the person uses their own."},
        {"key": "access_vpn", "title": "VPN access confirmed", "category": "Required access", "required": True,
         "integration": "vpn", "owner": "admin", "offset_days": 0,
         "instructions": "Confirm the device is registered and online. HQ has no VPN integration, so an authorised person confirms this by hand."},
        {"key": "access_erp", "title": "ERP account created and first login confirmed", "category": "Required access", "required": True,
         "integration": "erp", "owner": "admin", "offset_days": 1,
         "instructions": "Confirm the account exists with the approved roles and the person has signed in. Manual confirmation."},
        {"key": "access_slack", "title": "Slack workspace and channels", "category": "Required access", "required": True,
         "integration": "slack", "owner": "admin", "offset_days": 1,
         "instructions": "Confirm the person joined the workspace and the agreed channels. Manual confirmation."},
        {"key": "access_calendar", "title": "Recurring meetings added", "category": "Required access", "required": False,
         "integration": "calendar", "owner": "manager", "offset_days": 2,
         "instructions": "Confirm the person received the recurring meeting invitations. Manual confirmation."},
        {"key": "team_intro", "title": "Team introduction", "category": "Team introduction", "required": True,
         "integration": "none", "owner": "manager", "offset_days": 1,
         "instructions": "Introduce the person to their team and explain who to ask for what."},
        {"key": "orientation", "title": "Engineering orientation", "category": "Engineering orientation", "required": True,
         "integration": "none", "owner": "manager", "offset_days": 3,
         "instructions": "Walk through how HQ is used: components, owners, reviewers, blockers and the Engineering Constitution."},
        {"key": "first_ownership", "title": "Initial ownership or work assignment", "category": "Initial work", "required": True,
         "integration": "none", "owner": "manager", "offset_days": 5,
         "instructions": "Assign the person's first component or task in HQ and name their reviewer."},
        {"key": "final_review", "title": "Final readiness review", "category": "Final review", "required": True,
         "integration": "none", "owner": "case_owner", "offset_days": 7,
         "instructions": "Confirm every required step above is genuinely done before the case is completed."},
    ],
    "offboarding": [
        {"key": "knowledge_transfer", "title": "Knowledge transfer and documentation", "category": "Knowledge transfer", "required": True,
         "integration": "none", "owner": "manager", "offset_days": -10,
         "instructions": "Make sure what only this person knows is written down or handed to a named colleague."},
        {"key": "handover", "title": "Engineering handover", "category": "Reassignment", "required": True,
         "integration": "none", "owner": "manager", "offset_days": -5, "system": "handover",
         "instructions": "Reassign the components, reviews and blockers listed under Engineering handover. This step completes itself when every item is resolved."},
        {"key": "equipment_return", "title": "Equipment returned", "category": "Equipment return", "required": True,
         "integration": "none", "owner": "case_owner", "offset_days": 0,
         "instructions": "Record what was returned. Mark not applicable, with a reason, if nothing was issued."},
        {"key": "revoke_vpn", "title": "VPN access removal confirmed", "category": "Access removal", "required": True,
         "integration": "vpn", "owner": "admin", "offset_days": 0,
         "instructions": "Confirm the device is removed. HQ does not revoke access. An authorised person confirms it was done elsewhere."},
        {"key": "revoke_erp", "title": "ERP access removal confirmed", "category": "Access removal", "required": True,
         "integration": "erp", "owner": "admin", "offset_days": 0,
         "instructions": "Confirm the account is disabled. Manual confirmation. An HQ account is deactivated separately on the Directory page."},
        {"key": "revoke_slack", "title": "Slack access removal confirmed", "category": "Access removal", "required": True,
         "integration": "slack", "owner": "admin", "offset_days": 0,
         "instructions": "Confirm the person was removed from the workspace. Manual confirmation."},
        {"key": "manager_review", "title": "Final manager review", "category": "Final review", "required": True,
         "integration": "none", "owner": "manager", "offset_days": 0,
         "instructions": "Confirm knowledge transfer and handover are complete from the team's side."},
    ],
}

TEMPLATE_OWNERS = ("case_owner", "manager", "admin", "person")


def validate_template_tasks(kind: str, tasks) -> list[str]:
    errs: list[str] = []
    if kind not in KINDS:
        return ["kind must be onboarding or offboarding"]
    if not isinstance(tasks, list) or not tasks:
        return ["a checklist needs at least one task"]
    if len(tasks) > 60:
        errs.append("a checklist may have at most 60 tasks")
    seen: set[str] = set()
    for i, t in enumerate(tasks, 1):
        if not isinstance(t, dict):
            errs.append(f"task {i} must be an object"); continue
        k = t.get("key")
        if not isinstance(k, str) or not re.match(r"^[a-z][a-z0-9_]{1,39}$", k):
            errs.append(f"task {i}: key must be lowercase letters, digits and underscores"); continue
        if k in seen: errs.append(f"task key '{k}' is used twice")
        seen.add(k)
        if not isinstance(t.get("title"), str) or not t["title"].strip() or len(t["title"]) > 200:
            errs.append(f"task '{k}': title is required, at most 200 characters")
        if len(str(t.get("instructions", ""))) > 1000: errs.append(f"task '{k}': instructions are too long")
        if t.get("integration", "none") not in INTEGRATIONS: errs.append(f"task '{k}': unknown integration")
        if t.get("owner", "case_owner") not in TEMPLATE_OWNERS: errs.append(f"task '{k}': unknown owner role")
        off = t.get("offset_days", 0)
        if not isinstance(off, int) or isinstance(off, bool) or not -90 <= off <= 365: errs.append(f"task '{k}': offset_days must be a whole number from -90 to 365")
        if not isinstance(t.get("required", True), bool): errs.append(f"task '{k}': required must be true or false")
    if kind == "offboarding" and not any(t.get("system") == "handover" for t in tasks if isinstance(t, dict)):
        errs.append("an offboarding checklist must keep the Engineering handover step")
    return errs


def clean_template_tasks(tasks) -> list[dict]:
    out = []
    for t in tasks:
        d = {"key": t["key"], "title": t["title"].strip(), "instructions": str(t.get("instructions", "")).strip(),
             "category": str(t.get("category", "General")).strip()[:80] or "General", "required": bool(t.get("required", True)),
             "integration": t.get("integration", "none"), "owner": t.get("owner", "case_owner"), "offset_days": int(t.get("offset_days", 0))}
        if t.get("system") == "handover": d["system"] = "handover"
        out.append(d)
    return out


def build_tasks(template_tasks: list[dict], anchor: date | None, owners: dict) -> list[dict]:
    """Turn template rows into task dicts. `owners` maps owner role -> user id.

    A due date is the anchor date plus the task's offset. Without an anchor date
    the task has no due date; it is never invented.
    """
    out = []
    for pos, t in enumerate(template_tasks):
        integration = t.get("integration", "none")
        out.append({
            "position": pos, "key": t["key"], "title": t["title"], "instructions": t.get("instructions", ""),
            "category": t.get("category", "General"), "required": bool(t.get("required", True)),
            "owner_id": owners.get(t.get("owner", "case_owner")),
            "due_date": (anchor + timedelta(days=int(t.get("offset_days", 0)))) if anchor else None,
            "status": "not_started", "integration": integration,
            # An integration-bound task starts out honestly: not configured.
            "confirmation": "not_configured" if integration != "none" else "not_applicable",
            "system_key": t.get("system"),
        })
    return out


# --------------------------------------------------------------- case lifecycle
# (kind, stage, action) -> next stage. Anything else is an invalid transition.
TRANSITIONS = {
    ("onboarding", "awaiting_approval", "approve"): "ready",
    ("onboarding", "awaiting_approval", "reject"): "cancelled",
    ("onboarding", "ready", "start"): "in_progress",
    ("onboarding", "in_progress", "complete"): "completed",
    ("offboarding", "in_progress", "request_review"): "final_review",
    ("offboarding", "final_review", "return"): "in_progress",
    ("offboarding", "final_review", "complete"): "completed",
    ("onboarding", "completed", "reopen"): "in_progress",
    ("offboarding", "completed", "reopen"): "in_progress",
}
for _k in KINDS:
    for _s in ACTIVE_STAGES:
        TRANSITIONS[(_k, _s, "cancel")] = "cancelled"

# Who may perform an action. "admin" means a user with the admin role; "owner"
# means the case owner or, for task actions, an assigned task owner.
ACTION_AUTHORITY = {
    "approve": "admin", "reject": "admin", "start": "owner", "complete": "admin", "request_review": "owner",
    "return": "admin", "cancel": "admin", "reopen": "admin",
}
ACTION_LABEL = {
    "approve": "Approve onboarding", "reject": "Reject onboarding", "start": "Start onboarding", "complete": "Complete case",
    "request_review": "Request final review", "return": "Return to in progress", "cancel": "Cancel case", "reopen": "Reopen case",
}
REASON_REQUIRED = ("reject", "cancel", "reopen", "return")


def next_stage(kind: str, stage: str, action: str) -> str | None:
    return TRANSITIONS.get((kind, stage, action))


def available_actions(kind: str, stage: str) -> list[str]:
    return [a for (k, s, a) in TRANSITIONS if k == kind and s == stage]


def task_is_satisfied(t: dict) -> bool:
    if t["status"] == "completed": return True
    return t["status"] == "not_applicable" and bool((t.get("skip_reason") or "").strip())


def completion_blockers(kind: str, stage: str, case: dict, tasks: list[dict], handover: list[dict]) -> list[str]:
    """Why a case cannot be completed (or sent to final review) right now."""
    out: list[str] = []
    if kind == "onboarding" and not case.get("approved_at"):
        out.append("The case has not been approved.")
    open_req = [t for t in tasks if t["required"] and not task_is_satisfied(t)]
    for t in open_req:
        if t["status"] == "blocked":
            out.append(f"Required task is blocked: {t['title']} ({t.get('blocked_reason') or 'no reason recorded'}).")
        else:
            out.append(f"Required task is not finished: {t['title']}.")
    for t in tasks:
        if t["status"] == "completed" and t.get("integration", "none") != "none" and t.get("confirmation") not in SATISFIED_CONFIRMATIONS:
            out.append(f"{t['title']} is marked complete without a confirmation.")
    if kind == "offboarding":
        pending = [h for h in handover if h["status"] == "pending"]
        if pending:
            out.append(f"{len(pending)} engineering handover item{'s' if len(pending) != 1 else ''} still need a replacement or a recorded exception.")
    return out


def check_transition(kind: str, stage: str, action: str, *, is_admin: bool, is_owner: bool, reason: str,
                     case: dict, tasks: list[dict], handover: list[dict]) -> tuple[str | None, list[str]]:
    """Return (new_stage, problems). Problems are safe to show to the actor."""
    new = next_stage(kind, stage, action)
    if new is None:
        return None, [f"'{ACTION_LABEL.get(action, action)}' is not allowed while the case is {STAGE_LABEL.get(stage, stage).lower()}."]
    auth = ACTION_AUTHORITY.get(action, "admin")
    if not (is_admin or (auth == "owner" and is_owner)):
        return None, ["Only an admin can do this." if auth == "admin" else "Only the case owner or an admin can do this."]
    errs: list[str] = []
    if action in REASON_REQUIRED and len((reason or "").strip()) < MIN_REASON:
        errs.append(f"A reason of at least {MIN_REASON} characters is required.")
    if action == "complete" or action == "request_review":
        errs += completion_blockers(kind, stage, case, tasks, handover)
    return (None, errs) if errs else (new, [])


# ----------------------------------------------------------------------- tasks
_TASK_MOVES = {
    "not_started": ("in_progress", "completed", "blocked", "not_applicable"),
    "in_progress": ("not_started", "completed", "blocked", "not_applicable"),
    "blocked": ("in_progress", "not_started", "not_applicable"),
    "completed": ("in_progress",),
    "not_applicable": ("not_started",),
}
EDITABLE_TASK_STAGES = ("ready", "in_progress")


def check_task_change(task: dict, change: dict, *, is_admin: bool, is_case_owner: bool, is_task_owner: bool,
                      stage: str, has_handover_open: bool = False) -> list[str]:
    """Validate one task update. `change` holds only the fields being changed."""
    errs: list[str] = []
    if not (is_admin or is_case_owner or is_task_owner):
        return ["You cannot change this task."]
    managing = {"owner_id", "due_date"} & set(change)
    if managing and not (is_admin or is_case_owner):
        errs.append("Only the case owner or an admin can change who owns a task or when it is due.")
    if "status" in change or "evidence_note" in change:
        if stage not in EDITABLE_TASK_STAGES and not (is_admin and stage == "final_review"):
            errs.append("Task progress can only change while the case is ready or in progress.")
    new = change.get("status")
    if new is not None:
        if new not in TASK_STATUSES: return ["Unknown task status."]
        if new != task["status"]:
            if new not in _TASK_MOVES[task["status"]]:
                errs.append(f"A task cannot move from {task['status'].replace('_', ' ')} to {new.replace('_', ' ')}.")
            if task.get("system_key") == "handover" and new in ("completed", "not_applicable"):
                errs.append("This step completes itself when every handover item is resolved.")
            if new == "completed":
                if task.get("integration", "none") != "none" and len((change.get("evidence_note") or task.get("evidence_note") or "").strip()) < MIN_REASON:
                    errs.append("This step depends on another system HQ is not connected to. Record who confirmed it and how, in the evidence note.")
            if new == "blocked" and len((change.get("blocked_reason") or "").strip()) < MIN_REASON:
                errs.append("Say what is blocking this task (at least 5 characters).")
            if new == "not_applicable":
                need = MIN_SKIP_REASON if task["required"] else MIN_REASON
                if len((change.get("skip_reason") or "").strip()) < need:
                    errs.append(f"Say why this task does not apply (at least {need} characters).")
                if task["required"] and not is_admin:
                    errs.append("Only an admin can skip a required task.")
            if task["status"] == "completed" and new == "in_progress" and not (is_admin or is_case_owner):
                errs.append("Only the case owner or an admin can reopen a finished task.")
            if task["status"] == "not_applicable" and new == "not_started" and not is_admin:
                errs.append("Only an admin can bring back a task that was skipped.")
    return errs


def apply_task_change(task: dict, change: dict, *, actor_id: int, now: datetime) -> dict:
    """Return the task fields to store after a validated change."""
    out = dict(change)
    new = change.get("status")
    if new is not None and new != task["status"]:
        out.pop("confirm", None)
        if new == "completed":
            out.update(completed_by_id=actor_id, completed_at=now, blocked_reason="", skip_reason="")
            if task.get("integration", "none") != "none":
                # A person confirmed it by hand. This is never "confirmed" (that needs a real integration).
                out.update(confirmation="manually_confirmed", confirmed_by_id=actor_id, confirmed_at=now)
        else:
            if task["status"] == "completed":
                out.update(completed_by_id=None, completed_at=None)
                if task.get("integration", "none") != "none":
                    out.update(confirmation="not_configured", confirmed_by_id=None, confirmed_at=None)
            if new != "blocked": out.setdefault("blocked_reason", "")
            if new != "not_applicable": out.setdefault("skip_reason", "")
    return out


def is_overdue(task: dict, today: date) -> bool:
    return bool(task.get("due_date")) and task["due_date"] < today and task["status"] not in ("completed", "not_applicable")


def progress(tasks: list[dict]) -> dict:
    """Required tasks drive progress; optional ones never hold a case back."""
    req = [t for t in tasks if t["required"]]
    done = sum(1 for t in req if task_is_satisfied(t))
    return {"done": done, "total": len(req), "percent": round(100 * done / len(req)) if req else 0}


def next_task(tasks: list[dict]) -> dict | None:
    """The next required task that is not finished: blocked first, then earliest due, then template order."""
    open_ = [t for t in tasks if t["required"] and not task_is_satisfied(t)]
    if not open_: return None
    far = date.max
    return sorted(open_, key=lambda t: (t["status"] != "blocked", t.get("due_date") or far, t.get("position", 0)))[0]


def status_text(kind: str, stage: str, tasks: list[dict], handover: list[dict], approved: bool) -> str:
    """A plain-language reading of where the case stands."""
    pr = progress(tasks)
    blocked = [t for t in tasks if t["status"] == "blocked"]
    if stage == "awaiting_approval":
        return "Waiting for an admin to approve. No task can be finished until then."
    if stage == "ready":
        return "Approved. Work has not started. Starting it, or finishing the first task, begins the case."
    if stage == "completed":
        return "Every required step was finished and the case was completed."
    if stage == "cancelled":
        return "This case was cancelled and no further work is expected."
    if stage == "final_review":
        return "All required work is done. An admin is doing the final review before completion."
    if blocked:
        return f"{len(blocked)} task{'s are' if len(blocked) != 1 else ' is'} blocked. {pr['done']} of {pr['total']} required tasks are finished."
    if kind == "offboarding":
        pend = sum(1 for h in handover if h["status"] == "pending")
        if pend: return f"{pend} engineering handover item{'s' if pend != 1 else ''} still need a replacement. {pr['done']} of {pr['total']} required tasks are finished."
    return f"{pr['done']} of {pr['total']} required tasks are finished."


# ------------------------------------------------------------------- handover
def handover_key(it: dict) -> tuple:
    return (it["type"], it["component_id"], it["role"], it.get("blocker_id"))


def sync_handover(existing: list[dict], live: list[dict]) -> dict:
    """Compare stored handover items with what the person holds right now.

    `existing` are stored items; `live` are items currently assigned to the
    departing person. Returns {"add": [...], "reopen": [...], "unchanged": n}.
    New holdings are added as pending. A reassigned item whose assignment has
    drifted back to the departing person is reopened. Nothing is ever deleted,
    so the record of what was handed over stays.
    """
    have = {handover_key(e): e for e in existing}
    add = [l for l in live if handover_key(l) not in have]
    reopen = [have[handover_key(l)] for l in live
              if handover_key(l) in have and have[handover_key(l)]["status"] in ("reassigned", "accepted")]
    return {"add": add, "reopen": reopen}


def check_reassignment(role: str, *, from_user: int, to_user: int | None, to_active: bool, current: dict) -> list[str]:
    """Same assignment rules HQ already applies to components, plus handover-specific ones."""
    if to_user is None: return ["Choose who takes this over."]
    errs: list[str] = []
    if to_user == from_user: errs.append("The replacement must be someone other than the person leaving.")
    if not to_active: errs.append("The replacement is a deactivated account.")
    if role in ("owner", "reviewer", "qa"):
        owner = to_user if role == "owner" else current.get("owner_id")
        reviewer = to_user if role == "reviewer" else current.get("reviewer_id")
        qa = to_user if role == "qa" else current.get("qa_id")
        if owner is not None and owner == reviewer: errs.append("Reviewer must be different from the component owner.")
        if owner is not None and owner == qa: errs.append("QA contact must be different from the component owner.")
    return errs


# ------------------------------------------------------------ lifecycle status
def lifecycle_status(cases: list[dict]) -> str:
    """active | onboarding | offboarding | departed, from a person's cases.

    This is NOT login access. A departed person's account stays as it is until
    an admin deactivates it on the Directory page.
    """
    act = [c for c in cases if c["stage"] in ACTIVE_STAGES]
    if any(c["kind"] == "offboarding" for c in act): return "offboarding"
    if any(c["kind"] == "onboarding" for c in act): return "onboarding"
    done_off = [c for c in cases if c["kind"] == "offboarding" and c["stage"] == "completed"]
    done_on = [c for c in cases if c["kind"] == "onboarding" and c["stage"] == "completed"]
    if done_off and (not done_on or max(c["id"] for c in done_off) > max(c["id"] for c in done_on)): return "departed"
    return "active"


LIFECYCLE_LABEL = {"active": "Active", "onboarding": "Onboarding in progress", "offboarding": "Offboarding in progress",
                   "departed": "Offboarding completed"}


# ----------------------------------------------------------------- visibility
def case_access(*, is_admin: bool, uid: int, owner_id: int | None, manager_id: int | None, task_owner_ids: set[int]) -> str | None:
    """full | limited | None. Reviewer status in engineering gives no access here."""
    if is_admin or uid == owner_id or uid == manager_id: return "full"
    if uid in task_owner_ids: return "limited"
    return None


# ------------------------------------------------------------------- candidates
CANDIDATE_STAGES = ("invited", "assessment_open", "submitted", "approved", "rejected", "cancelled")
CANDIDATE_TERMINAL = ("approved", "rejected", "cancelled")
CANDIDATE_LABEL = {"invited": "Invited", "assessment_open": "Assessment open", "submitted": "Submitted, awaiting review",
                   "approved": "Approved", "rejected": "Rejected", "cancelled": "Cancelled"}
ASSESSMENT_HOURS = 48
CODE_TTL = timedelta(minutes=15)
SESSION_TTL = timedelta(hours=2)
REISSUE_COOLDOWN = timedelta(seconds=60)
MAX_CODE_ATTEMPTS = 5
MAX_EXTENSION_HOURS = 168

CANDIDATE_ACTIONS = {
    # action -> stages it is allowed from
    "approve": ("submitted",),
    "reject": ("invited", "assessment_open", "submitted"),
    "cancel": ("invited", "assessment_open", "submitted"),
    "extend": ("invited", "assessment_open"),
    "reissue": ("invited", "assessment_open"),
}
CANDIDATE_ACTION_LABEL = {"approve": "Approve candidate", "reject": "Reject candidate", "cancel": "Cancel invitation",
                          "extend": "Extend deadline", "reissue": "Issue a new access code"}


def new_code() -> str:
    return f"{secrets.randbelow(10**8):08d}"


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_secret(value: str, key: str) -> str:
    """Keyed hash for codes and tokens. They are never stored in the clear."""
    return hmac.new(key.encode(), value.encode(), hashlib.sha256).hexdigest()


def same_secret(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)


def deadline_from(first_sign_in: datetime, hours: int = ASSESSMENT_HOURS) -> datetime:
    return first_sign_in + timedelta(hours=hours)


def extend_deadline(current: datetime | None, now: datetime, hours: int) -> datetime:
    """Add hours to the later of now and the current deadline."""
    base = max(now, current) if current else now
    return base + timedelta(hours=hours)


def check_extension_hours(hours) -> list[str]:
    if not isinstance(hours, int) or isinstance(hours, bool) or not 1 <= hours <= MAX_EXTENSION_HOURS:
        return [f"Hours must be a whole number from 1 to {MAX_EXTENSION_HOURS}."]
    return []


def candidate_stage_view(stage: str, deadline: datetime | None, has_submission: bool, now: datetime) -> str:
    """The stage shown to staff. Expiry is derived from the server clock."""
    if stage == "assessment_open" and deadline and now >= deadline and not has_submission: return "expired"
    return stage


def candidate_action_problems(action: str, stage: str, *, expired: bool, has_submission: bool, reason: str = "",
                              last_issue: datetime | None = None, now: datetime | None = None) -> list[str]:
    if action not in CANDIDATE_ACTIONS: return ["Unknown action."]
    if stage not in CANDIDATE_ACTIONS[action]:
        return [f"'{CANDIDATE_ACTION_LABEL[action]}' is not allowed while the candidate is {CANDIDATE_LABEL.get(stage, stage).lower()}."]
    errs: list[str] = []
    if action in ("approve", "reject", "cancel", "extend") and len((reason or "").strip()) < MIN_REASON:
        errs.append(f"A reason of at least {MIN_REASON} characters is required.")
    if action == "extend" and has_submission: errs.append("This candidate has already submitted.")
    if action == "reissue":
        if expired: errs.append("The assessment window has ended. Extend the deadline first.")
        if last_issue and now and now - last_issue < REISSUE_COOLDOWN:
            errs.append("Wait at least 60 seconds between access codes.")
    return errs


_NOTES_MAX = 10000
_GITHUB = re.compile(r"^[A-Za-z0-9._-]+$")


def validate_submission(notes, repository_url, linkedin_url) -> dict[str, str]:
    """Field -> problem. Empty dict means valid. Text and repository links only."""
    errs: dict[str, str] = {}
    notes = (notes or "").strip(); repo = (repository_url or "").strip(); li = (linkedin_url or "").strip()
    if not notes and not repo: errs["notes"] = "Add implementation notes or a GitHub repository."
    if len(notes) > _NOTES_MAX: errs["notes"] = f"Notes may be at most {_NOTES_MAX} characters."
    if repo:
        p = urlparse(repo)
        parts = [x for x in p.path.split("/") if x]
        if p.scheme != "https" or (p.hostname or "").lower() not in ("github.com", "www.github.com") or p.username or p.password \
                or len(parts) < 2 or not all(_GITHUB.match(x) for x in parts[:2]):
            errs["repositoryUrl"] = "Use an https://github.com/owner/repository link."
    if li:
        p = urlparse(li); host = (p.hostname or "").lower()
        if p.scheme != "https" or not (host == "linkedin.com" or host.endswith(".linkedin.com")) or p.username or p.password:
            errs["linkedinUrl"] = "Use an https:// LinkedIn link."
    if len(repo) > 500: errs["repositoryUrl"] = "Link is too long."
    if len(li) > 500: errs["linkedinUrl"] = "Link is too long."
    return errs


def submission_checksum(notes: str, repository_url: str, linkedin_url: str) -> str:
    body = "\n".join(["apex.submission/1", (notes or "").strip(), (repository_url or "").strip(), (linkedin_url or "").strip()])
    return hashlib.sha256(body.encode()).hexdigest()


def receipt_id(candidate_id: int, checksum: str) -> str:
    return f"RCPT-{candidate_id:05d}-{checksum[:10].upper()}"


# ------------------------------------------------------------------- generic
def iso(dt: datetime | None) -> str | None:
    """Server timestamps are UTC. Say so, so a browser never reads them as local time."""
    return None if dt is None else dt.replace(microsecond=0).isoformat() + "Z"


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def clean_text(value, label: str, max_len: int, required: bool = True) -> str:
    v = (value or "").strip()
    if required and not v: raise ValueError(f"{label} is required")
    if len(v) > max_len: raise ValueError(f"{label} must be at most {max_len} characters")
    return v
