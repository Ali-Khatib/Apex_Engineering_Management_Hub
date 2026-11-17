"""Pure-logic tests for People / HR: templates, transitions, tasks, handover,
visibility and the candidate assessment rules. No database or web framework."""
from datetime import date, datetime, timedelta
import pytest
from app import hr

NOW = datetime(2026, 11, 17, 12, 0, 0)
TODAY = NOW.date()


def tasks_for(kind="onboarding", anchor=date(2026, 12, 1)):
    return hr.build_tasks(hr.DEFAULT_TEMPLATES[kind], anchor, {"case_owner": 1, "manager": 2, "admin": 3})


def as_done(ts, **over):
    out = []
    for t in ts:
        t = dict(t)
        t["status"] = "completed"
        if t["integration"] != "none": t["confirmation"] = "manually_confirmed"
        out.append({**t, **over})
    return out


# ------------------------------------------------------------------ templates
def test_default_templates_are_valid_and_cover_the_agreed_categories():
    for kind, rows in hr.DEFAULT_TEMPLATES.items():
        assert hr.validate_template_tasks(kind, rows) == []
    cats = {t["category"] for t in hr.DEFAULT_TEMPLATES["onboarding"]}
    assert {"Pre-joining", "Agreements and documents", "Equipment", "Required access", "Team introduction",
            "Engineering orientation", "Initial work", "Final review"} <= cats
    off = {t["category"] for t in hr.DEFAULT_TEMPLATES["offboarding"]}
    assert {"Knowledge transfer", "Reassignment", "Equipment return", "Access removal", "Final review"} <= off


def test_template_validation_rejects_bad_rows_and_a_missing_handover_step():
    rows = hr.clean_template_tasks(hr.DEFAULT_TEMPLATES["offboarding"])
    assert hr.validate_template_tasks("offboarding", [r for r in rows if r.get("system") != "handover"])
    assert hr.validate_template_tasks("onboarding", [])
    bad = [{"key": "Bad Key", "title": "x"}, {"key": "ok_one", "title": ""}, {"key": "ok_one", "title": "t", "integration": "teleport", "offset_days": 9999}]
    errs = hr.validate_template_tasks("onboarding", bad)
    assert len(errs) >= 4
    assert hr.validate_template_tasks("training", rows)


def test_build_tasks_applies_owners_offsets_and_honest_integration_state():
    ts = tasks_for()
    by = {t["key"]: t for t in ts}
    assert by["pre_joining"]["due_date"] == date(2026, 11, 24) and by["pre_joining"]["owner_id"] == 1
    assert by["team_intro"]["owner_id"] == 2 and by["access_vpn"]["owner_id"] == 3
    assert all(t["status"] == "not_started" for t in ts)
    assert by["access_vpn"]["confirmation"] == "not_configured"          # never starts as confirmed
    assert by["pre_joining"]["confirmation"] == "not_applicable"
    assert all(t["due_date"] is None for t in hr.build_tasks(hr.DEFAULT_TEMPLATES["onboarding"], None, {}))   # no invented dates


# ---------------------------------------------------------------- transitions
def check(kind, stage, action, ts=None, admin=True, owner=False, reason="a good reason", case=None, handover=()):
    return hr.check_transition(kind, stage, action, is_admin=admin, is_owner=owner, reason=reason,
                               case=case or {"approved_at": NOW}, tasks=ts if ts is not None else [], handover=list(handover))


def test_approval_cannot_be_skipped_or_done_by_a_non_admin():
    ts = tasks_for()
    new, errs = check("onboarding", "awaiting_approval", "start", ts)
    assert new is None and "not allowed" in errs[0]                      # cannot start before approval
    assert check("onboarding", "awaiting_approval", "approve", ts, admin=False, owner=True)[0] is None
    assert check("onboarding", "awaiting_approval", "approve", ts)[0] == "ready"
    assert check("onboarding", "ready", "start", ts, admin=False, owner=True)[0] == "in_progress"
    assert check("onboarding", "ready", "start", ts, admin=False, owner=False)[0] is None


def test_completion_needs_every_required_task_and_no_blocked_task():
    ts = tasks_for()
    new, errs = check("onboarding", "in_progress", "complete", ts)
    assert new is None and any("not finished" in e for e in errs)
    done = as_done(ts)
    assert check("onboarding", "in_progress", "complete", done)[0] == "completed"
    done[3] = {**done[3], "status": "blocked", "blocked_reason": "waiting on IT"}
    new, errs = check("onboarding", "in_progress", "complete", done)
    assert new is None and any("blocked" in e and "waiting on IT" in e for e in errs)


def test_completed_task_on_an_external_system_without_confirmation_blocks_completion():
    done = as_done(tasks_for())
    for t in done:
        if t["key"] == "access_vpn": t["confirmation"] = "pending"
    new, errs = check("onboarding", "in_progress", "complete", done)
    assert new is None and any("without a confirmation" in e for e in errs)


def test_optional_tasks_do_not_hold_a_case_back_and_a_skip_needs_a_reason():
    done = as_done(tasks_for())
    for t in done:
        if not t["required"]: t["status"] = "not_started"
    assert check("onboarding", "in_progress", "complete", done)[0] == "completed"
    skipped = [dict(t) for t in done]
    skipped[0].update(status="not_applicable", skip_reason="")
    assert check("onboarding", "in_progress", "complete", skipped)[0] is None
    skipped[0]["skip_reason"] = "Agreed with the manager in writing"
    assert check("onboarding", "in_progress", "complete", skipped)[0] == "completed"


def test_cancel_reopen_and_return_need_a_reason_and_an_admin():
    assert check("onboarding", "in_progress", "cancel", reason="no")[0] is None
    assert check("onboarding", "in_progress", "cancel", reason="Offer withdrawn")[0] == "cancelled"
    assert check("onboarding", "completed", "reopen", reason="Found a gap")[0] == "in_progress"
    assert check("onboarding", "completed", "reopen", reason="Found a gap", admin=False, owner=True)[0] is None
    assert check("onboarding", "cancelled", "reopen")[0] is None          # a cancelled case is closed
    assert check("onboarding", "completed", "cancel")[0] is None


def test_offboarding_goes_through_final_review_and_handover_blocks_it():
    done = as_done(tasks_for("offboarding"))
    pending = [{"status": "pending"}, {"status": "reassigned"}]
    new, errs = check("offboarding", "in_progress", "request_review", done, admin=False, owner=True, handover=pending)
    assert new is None and any("1 engineering handover item" in e for e in errs)
    resolved = [{"status": "reassigned"}, {"status": "exception"}, {"status": "accepted"}]
    assert check("offboarding", "in_progress", "request_review", done, admin=False, owner=True, handover=resolved)[0] == "final_review"
    assert check("offboarding", "final_review", "complete", done, handover=resolved)[0] == "completed"
    assert check("offboarding", "final_review", "complete", done, admin=False, owner=True, handover=resolved)[0] is None
    assert check("offboarding", "in_progress", "complete", done, handover=resolved)[0] is None   # final review cannot be skipped


# ---------------------------------------------------------------------- tasks
def one(**kw):
    t = {"status": "not_started", "required": True, "integration": "none", "evidence_note": "", "system_key": None}
    t.update(kw); return t


def chg(task, change, **kw):
    base = dict(is_admin=False, is_case_owner=False, is_task_owner=True, stage="in_progress")
    base.update(kw)
    return hr.check_task_change(task, change, **base)


def test_task_state_model_rejects_impossible_moves():
    assert chg(one(), {"status": "completed"}) == []
    assert chg(one(status="completed"), {"status": "blocked", "blocked_reason": "later on"}) != []
    assert chg(one(status="blocked"), {"status": "completed"}) != []          # unblock first
    assert chg(one(status="completed"), {"status": "in_progress"}) != []       # a task owner cannot reopen it
    assert chg(one(status="completed"), {"status": "in_progress"}, is_case_owner=True) == []


def test_blocked_and_skipped_tasks_demand_an_explanation_and_skipping_a_required_one_an_admin():
    assert chg(one(), {"status": "blocked"}) != []
    assert chg(one(), {"status": "blocked", "blocked_reason": "Waiting for laptop"}) == []
    assert chg(one(required=False), {"status": "not_applicable", "skip_reason": "ok"}) != []
    assert chg(one(required=False), {"status": "not_applicable", "skip_reason": "Uses own laptop"}) == []
    assert any("admin" in e for e in chg(one(), {"status": "not_applicable", "skip_reason": "Not needed for this role"}))
    assert chg(one(), {"status": "not_applicable", "skip_reason": "Not needed for this role"}, is_admin=True) == []


def test_external_system_task_cannot_be_completed_without_evidence_and_is_never_marked_confirmed():
    t = one(integration="vpn", confirmation="not_configured")
    assert chg(t, {"status": "completed"}) != []
    ok = {"status": "completed", "evidence_note": "Confirmed by D. Admin on the VPN console"}
    assert chg(t, ok) == []
    out = hr.apply_task_change(t, ok, actor_id=7, now=NOW)
    assert out["confirmation"] == "manually_confirmed" and out["confirmed_by_id"] == 7 and out["completed_by_id"] == 7
    assert out["confirmation"] != "confirmed"
    back = hr.apply_task_change({**t, "status": "completed", "confirmation": "manually_confirmed"}, {"status": "in_progress"}, actor_id=7, now=NOW)
    assert back["confirmation"] == "not_configured" and back["completed_at"] is None       # reopening withdraws the confirmation


def test_handover_step_cannot_be_ticked_by_hand_and_stranger_cannot_edit():
    assert chg(one(system_key="handover"), {"status": "completed"}) != []
    assert chg(one(), {"status": "completed"}, is_task_owner=False) == ["You cannot change this task."]
    assert chg(one(), {"owner_id": 5}) != []                                   # a task owner cannot reassign it
    assert chg(one(), {"owner_id": 5, "due_date": date(2026, 12, 2)}, is_case_owner=True) == []


def test_task_progress_is_locked_outside_ready_and_in_progress():
    assert chg(one(), {"status": "completed"}, stage="awaiting_approval") != []
    assert chg(one(), {"status": "completed"}, stage="completed") != []
    assert chg(one(), {"status": "completed"}, stage="ready") == []


def test_progress_overdue_next_task_and_status_text():
    ts = tasks_for()
    assert hr.progress(ts) == {"done": 0, "total": 9, "percent": 0}
    ts[0]["status"] = "completed"
    assert hr.progress(ts)["done"] == 1
    assert hr.is_overdue({"due_date": date(2026, 11, 1), "status": "not_started"}, TODAY)
    assert not hr.is_overdue({"due_date": date(2026, 11, 1), "status": "completed"}, TODAY)
    assert not hr.is_overdue({"due_date": None, "status": "not_started"}, TODAY)
    ts[3].update(status="blocked", blocked_reason="x")
    assert hr.next_task(ts)["key"] == ts[3]["key"]                             # blocked work surfaces first
    assert "blocked" in hr.status_text("onboarding", "in_progress", ts, [], True)
    assert "Waiting for an admin" in hr.status_text("onboarding", "awaiting_approval", ts, [], False)
    assert hr.next_task(as_done(ts)) is None


# ------------------------------------------------------------------- handover
def item(role="owner", cid=1, status="pending", t="component", bid=None):
    return {"type": t, "component_id": cid, "role": role, "status": status, "blocker_id": bid}


def test_sync_adds_new_holdings_and_reopens_drift_but_never_deletes():
    existing = [item("owner", 1, "reassigned"), item("reviewer", 2, "pending")]
    live = [item("owner", 1), item("qa", 3)]                  # reviewer on 2 is no longer held; owner on 1 drifted back
    r = hr.sync_handover(existing, live)
    assert [hr.handover_key(x) for x in r["add"]] == [("component", 3, "qa", None)]
    assert [x["component_id"] for x in r["reopen"]] == [1]
    assert hr.sync_handover(existing, [])["add"] == []


def test_reassignment_applies_the_existing_owner_reviewer_qa_rules():
    cur = {"owner_id": 10, "reviewer_id": 11, "qa_id": 12}
    assert hr.check_reassignment("owner", from_user=10, to_user=13, to_active=True, current=cur) == []
    assert any("someone other" in e for e in hr.check_reassignment("owner", from_user=10, to_user=10, to_active=True, current=cur))
    assert any("deactivated" in e for e in hr.check_reassignment("owner", from_user=10, to_user=13, to_active=False, current=cur))
    assert any("Reviewer must be different" in e for e in hr.check_reassignment("owner", from_user=10, to_user=11, to_active=True, current=cur))
    assert any("QA contact" in e for e in hr.check_reassignment("owner", from_user=10, to_user=12, to_active=True, current=cur))
    assert hr.check_reassignment("blocker", from_user=10, to_user=11, to_active=True, current=cur) == []
    assert hr.check_reassignment("owner", from_user=10, to_user=None, to_active=True, current=cur)


# --------------------------------------------------------- lifecycle & access
def test_lifecycle_status_is_derived_and_is_not_login_access():
    c = lambda i, k, s: {"id": i, "kind": k, "stage": s}
    assert hr.lifecycle_status([]) == "active"
    assert hr.lifecycle_status([c(1, "onboarding", "in_progress")]) == "onboarding"
    assert hr.lifecycle_status([c(1, "onboarding", "completed"), c(2, "offboarding", "in_progress")]) == "offboarding"
    assert hr.lifecycle_status([c(1, "onboarding", "completed"), c(2, "offboarding", "completed")]) == "departed"
    assert hr.lifecycle_status([c(5, "offboarding", "completed"), c(6, "onboarding", "completed")]) == "active"   # came back
    assert hr.lifecycle_status([c(1, "offboarding", "cancelled")]) == "active"
    assert "access" not in hr.LIFECYCLE_LABEL["offboarding"].lower()


def test_case_access_gives_nothing_for_being_an_engineering_reviewer():
    f = lambda **k: hr.case_access(**{"is_admin": False, "uid": 9, "owner_id": 1, "manager_id": 2, "task_owner_ids": set(), **k})
    assert f() is None
    assert f(is_admin=True) == "full" and f(uid=1) == "full" and f(uid=2) == "full"
    assert f(task_owner_ids={9}) == "limited"


# ----------------------------------------------------------------- candidates
def test_codes_and_tokens_are_random_keyed_and_compared_safely():
    assert len({hr.new_code() for _ in range(50)}) > 40 and all(len(hr.new_code()) == 8 and hr.new_code().isdigit() for _ in range(20))
    assert len(hr.new_token()) >= 40
    h = hr.hash_secret("12345678", "key-a")
    assert h != "12345678" and h == hr.hash_secret("12345678", "key-a") and h != hr.hash_secret("12345678", "key-b")
    assert hr.same_secret(h, h) and not hr.same_secret(h, hr.hash_secret("12345679", "key-a"))


def test_deadline_is_server_computed_and_extension_adds_from_the_later_time():
    start = datetime(2026, 11, 17, 9, 0)
    dl = hr.deadline_from(start)
    assert dl == start + timedelta(hours=48)
    assert hr.extend_deadline(dl, start + timedelta(hours=10), 24) == dl + timedelta(hours=24)        # still open: add to the deadline
    assert hr.extend_deadline(dl, dl + timedelta(hours=5), 24) == dl + timedelta(hours=29)            # expired: add from now
    assert hr.check_extension_hours(24) == [] and hr.check_extension_hours(0) and hr.check_extension_hours(169) and hr.check_extension_hours("5") and hr.check_extension_hours(True)


def test_candidate_stage_view_derives_expiry_only_without_a_submission():
    dl = datetime(2026, 11, 20)
    assert hr.candidate_stage_view("assessment_open", dl, False, dl + timedelta(seconds=1)) == "expired"
    assert hr.candidate_stage_view("assessment_open", dl, True, dl + timedelta(days=1)) == "assessment_open"
    assert hr.candidate_stage_view("assessment_open", dl, False, dl - timedelta(seconds=1)) == "assessment_open"
    assert hr.candidate_stage_view("submitted", dl, True, dl + timedelta(days=9)) == "submitted"


def test_candidate_actions_follow_the_stage_and_need_reasons():
    p = lambda a, s, **k: hr.candidate_action_problems(a, s, expired=k.pop("expired", False), has_submission=k.pop("sub", False), reason=k.pop("reason", "good reason"), **k)
    assert p("approve", "submitted", sub=True) == []
    assert p("approve", "assessment_open") != []                       # nothing to approve yet
    assert p("approve", "submitted", reason="") != []
    assert p("extend", "assessment_open") == [] and p("extend", "submitted", sub=True) != [] and p("extend", "assessment_open", sub=True) != []
    assert p("reissue", "assessment_open", reason="") == []             # a new code needs no reason
    assert p("reissue", "assessment_open", expired=True) != []
    assert p("reissue", "assessment_open", last_issue=NOW - timedelta(seconds=10), now=NOW) != []
    assert p("reissue", "assessment_open", last_issue=NOW - timedelta(seconds=61), now=NOW) == []
    for term in hr.CANDIDATE_TERMINAL: assert p("reject", term) != [] and p("cancel", term) != []
    assert p("teleport", "invited") != []


def test_submission_validation_allows_notes_or_a_github_repository_only():
    ok = hr.validate_submission
    assert ok("My notes", "", "") == {} and ok("", "https://github.com/apex/thing", "") == {}
    assert ok("", "", "")["notes"]
    assert ok("n", "http://github.com/a/b", "")["repositoryUrl"]
    assert ok("n", "https://evil.example/a/b", "")["repositoryUrl"]
    assert ok("n", "https://github.com.evil.example/a/b", "")["repositoryUrl"]
    assert ok("n", "https://user:pw@github.com/a/b", "")["repositoryUrl"]
    assert ok("n", "https://github.com/onlyowner", "")["repositoryUrl"]
    assert ok("n", "", "https://www.linkedin.com/in/someone") == {}
    assert ok("n", "", "https://linkedin.com.evil.example/in/x")["linkedinUrl"]
    assert ok("x" * 10001, "", "")["notes"]


def test_receipt_checksum_is_stable_and_changes_with_content():
    a = hr.submission_checksum("notes", "https://github.com/a/b", "")
    assert a == hr.submission_checksum(" notes ", "https://github.com/a/b ", "") and a != hr.submission_checksum("notes!", "https://github.com/a/b", "")
    assert hr.receipt_id(7, a).startswith("RCPT-00007-")


def test_iso_marks_server_time_as_utc():
    assert hr.iso(datetime(2026, 11, 17, 12, 0, 0, 123)) == "2026-11-17T12:00:00Z" and hr.iso(None) is None
