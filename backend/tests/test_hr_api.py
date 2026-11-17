"""People / HR behaviour over HTTP. Needs the backend dependencies and uses the seeded demo users.
No external system is contacted; every integration is not_configured."""
import uuid
import pytest
from datetime import date, timedelta
from fastapi.testclient import TestClient
from app.main import app

def login(c, email, pw):
    r = c.post("/api/auth/login", json={"email": email, "password": pw}); assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}

@pytest.fixture(scope="module")
def c():
    with TestClient(app) as client:
        yield client

@pytest.fixture(scope="module")
def H(c):
    return {"A": login(c, "admin@apexai.demo", "Admin123!"), "R": login(c, "reviewer@apexai.demo", "Admin123!"),
            "M": login(c, "amna@apexai.demo", "Member123!"), "B": login(c, "bilal@apexai.demo", "Member123!")}

@pytest.fixture(scope="module")
def U(c, H):
    return {u["email"]: u["id"] for u in c.get("/api/users", headers=H["A"]).json()}

rid = lambda: uuid.uuid4().hex
soon = lambda n=7: (date.today() + timedelta(days=n)).isoformat()

def start(c, H, kind, person, owner, **kw):
    return c.post("/api/hr/cases", json={"kind": kind, "person_user_id": person, "owner_id": owner, "anchor_date": soon(), **kw}, headers=H["A"])

def task(case, key):
    return next(t for t in case["tasks"] if t["key"] == key)


# --------------------------------------------------------------- access
def test_everything_requires_sign_in(c):
    assert c.get("/api/hr/overview").status_code == 401
    assert c.get("/api/hr/cases").status_code == 401

def test_only_admin_can_start_a_case(c, H, U):
    r = c.post("/api/hr/cases", json={"kind": "onboarding", "person_user_id": U["bilal@apexai.demo"], "owner_id": U["amna@apexai.demo"], "anchor_date": soon()}, headers=H["M"])
    assert r.status_code == 403

def test_stranger_gets_404_not_403_and_is_left_out_of_lists(c, H, U):
    r = start(c, H, "onboarding", U["bilal@apexai.demo"], U["amna@apexai.demo"]); assert r.status_code == 201, r.text
    cid = r.json()["id"]
    assert c.get(f"/api/hr/cases/{cid}", headers=H["R"]).status_code == 404                   # reviewer role in engineering gives nothing here
    assert cid not in [x["id"] for x in c.get("/api/hr/cases?stage=all", headers=H["R"]).json()["items"]]
    assert c.post(f"/api/hr/cases/{cid}/actions", json={"action": "approve", "version": 1}, headers=H["R"]).status_code == 404
    assert c.get(f"/api/hr/cases/{cid}", headers=H["M"]).status_code == 200                    # the case owner
    counts = c.get("/api/hr/overview", headers=H["R"]).json()["counts"]
    assert counts["onboarding"] == 0                                                          # counts are scoped too

def test_duplicate_active_case_is_refused(c, H, U):
    r = start(c, H, "onboarding", U["bilal@apexai.demo"], U["amna@apexai.demo"])
    assert r.status_code == 409 and "already has an active" in r.text


# --------------------------------------------------------- onboarding rules
def test_task_cannot_finish_before_approval_and_owner_cannot_approve(c, H, U):
    cid = start(c, H, "onboarding", U["reviewer@apexai.demo"], U["amna@apexai.demo"]).json()["id"]
    case = c.get(f"/api/hr/cases/{cid}", headers=H["M"]).json()
    t = case["tasks"][0]
    r = c.patch(f"/api/hr/cases/{cid}/tasks/{t['id']}", json={"status": "completed", "version": t["version"], "request_id": rid()}, headers=H["M"])
    assert r.status_code in (409, 422, 403)
    r = c.post(f"/api/hr/cases/{cid}/actions", json={"action": "approve", "version": case["version"], "request_id": rid()}, headers=H["M"])
    assert r.status_code == 403
    r = c.post(f"/api/hr/cases/{cid}/actions", json={"action": "approve", "version": case["version"], "request_id": rid()}, headers=H["A"])
    assert r.status_code == 200 and r.json()["stage"] == "ready"

def test_stale_version_conflicts_and_request_id_makes_retry_safe(c, H, U):
    case = c.get("/api/hr/cases?kind=onboarding&stage=ready", headers=H["A"]).json()["items"]
    if not case: pytest.skip("needs an approved case from the previous test")
    cid = case[0]["id"]; d = c.get(f"/api/hr/cases/{cid}", headers=H["A"]).json()
    t = d["tasks"][0]; req = rid()
    body = {"status": "in_progress", "version": t["version"], "request_id": req}
    assert c.patch(f"/api/hr/cases/{cid}/tasks/{t['id']}", json=body, headers=H["A"]).status_code == 200
    assert c.patch(f"/api/hr/cases/{cid}/tasks/{t['id']}", json=body, headers=H["A"]).status_code == 200      # same request id: no-op
    stale = {"status": "blocked", "blocked_reason": "waiting", "version": t["version"], "request_id": rid()}
    assert c.patch(f"/api/hr/cases/{cid}/tasks/{t['id']}", json=stale, headers=H["A"]).status_code == 409

def test_external_step_is_never_reported_as_confirmed(c, H):
    ids = [x["id"] for x in c.get("/api/hr/cases?kind=onboarding&stage=active", headers=H["A"]).json()["items"]]
    d = c.get(f"/api/hr/cases/{ids[0]}", headers=H["A"]).json()
    ext = [t for t in d["tasks"] if t["integration"] != "none"]
    assert ext and all(t["confirmation"] in ("not_configured", "pending", "manually_confirmed") for t in ext)
    assert all(i["state"] == "not_configured" for i in c.get("/api/hr/integrations", headers=H["A"]).json()["items"])


# ------------------------------------------------------------- offboarding
def test_offboarding_handover_blocks_completion_until_resolved(c, H, U):
    comps = c.get("/api/components", headers=H["A"]).json()
    mine = [x for x in comps if x["owner"] and x["owner"]["id"] == U["bilal@apexai.demo"] and x["status"] not in ("done", "deployed")]
    if not mine: pytest.skip("seed has no open component owned by this person")
    r = c.post("/api/hr/cases", json={"kind": "offboarding", "person_user_id": U["bilal@apexai.demo"], "owner_id": U["amna@apexai.demo"], "anchor_date": soon(3),
                                      "reason_category": "resignation", "restricted_notes": "private"}, headers=H["A"])
    assert r.status_code == 201, r.text
    d = r.json(); cid = d["id"]
    assert d["handover"]["pending"] >= 1
    assert "restricted" not in c.get(f"/api/hr/cases/{cid}", headers=H["M"]).json()                      # case owner is not an admin
    assert "restricted" in c.get(f"/api/hr/cases/{cid}", headers=H["A"]).json()
    complete = next(a for a in d["actions"] if a["action"] == "complete") if any(a["action"] == "complete" for a in d["actions"]) else None
    assert complete is None or not complete["enabled"]
    item = d["handover"]["items"][0]
    assert c.post(f"/api/hr/cases/{cid}/handover/{item['id']}/reassign", json={"to_user_id": U["bilal@apexai.demo"], "request_id": rid()}, headers=H["A"]).status_code == 422
    ok = c.post(f"/api/hr/cases/{cid}/handover/{item['id']}/reassign", json={"to_user_id": U["reviewer@apexai.demo"], "request_id": rid()}, headers=H["A"])
    assert ok.status_code == 200 and ok.json()["handover"]["reassigned"] >= 1
    ex = c.post(f"/api/hr/cases/{cid}/handover/{d['handover']['items'][-1]['id']}/exception", json={"reason": "short"}, headers=H["A"])
    assert ex.status_code == 422                                                                          # an exception needs a real reason
    assert c.post(f"/api/hr/cases/{cid}/handover/{item['id']}/exception", json={"reason": "long enough reason"}, headers=H["M"]).status_code in (403, 404)

def test_hr_data_never_reaches_the_general_audit_feed(c, H):
    feed = c.get("/api/audit", headers=H["M"]).json()
    text = str(feed).lower()
    assert "private" not in text and "resignation" not in text


# -------------------------------------------------------------- candidates
def test_candidate_flow_and_secrets(c, H):
    mail = f"cand-{rid()[:6]}@example.test"
    r = c.post("/api/hr/candidates", json={"name": "Test Candidate", "email": mail, "assessment_title": "Build a thing", "assessment_brief": "Do the thing.", "assessment_hours": 48}, headers=H["A"])
    assert r.status_code == 201, r.text
    cand, access = r.json()["candidate"], r.json()["access"]
    assert c.post("/api/hr/candidates", json={"name": "x", "email": mail, "assessment_title": "t", "assessment_brief": "b"}, headers=H["A"]).status_code == 422
    assert c.get("/api/hr/candidates", headers=H["M"]).status_code == 403
    token = access["invitation_path"].split("=", 1)[1]
    assert c.post("/api/candidate/verify", json={"invitation": token, "code": "00000000"}).status_code == 400
    v = c.post("/api/candidate/verify", json={"invitation": token, "code": access["code"]}); assert v.status_code == 200, v.text
    S = {"X-Candidate-Session": v.json()["session"]}
    me = c.get("/api/candidate/me", headers=S).json()
    assert me["can_submit"] and me["deadline_at"].endswith("Z")
    assert c.post("/api/candidate/verify", json={"invitation": token, "code": access["code"]}).status_code == 400     # one-time
    assert c.get("/api/hr/overview", headers=S).status_code == 401                                                    # a candidate session is not an HQ token
    bad = c.post("/api/candidate/submit", json={"operation_id": "op1", "repository_url": "http://evil.example/x"}, headers=S)
    assert bad.status_code == 422
    sub = {"operation_id": "op1", "notes": "done", "repository_url": "https://github.com/owner/repo"}
    a = c.post("/api/candidate/submit", json=sub, headers=S); assert a.status_code == 200
    b = c.post("/api/candidate/submit", json=sub, headers=S); assert b.json()["receipt_id"] == a.json()["receipt_id"]
    assert c.post("/api/candidate/submit", json={**sub, "operation_id": "op2"}, headers=S).status_code == 409
    d = c.get(f"/api/hr/candidates/{cand['id']}", headers=H["A"]).json()
    assert d["stage"] == "submitted" and "code_hash" not in str(d)
    ap = c.post(f"/api/hr/candidates/{cand['id']}/actions", json={"action": "approve", "reason": "Strong work", "version": d["version"], "request_id": rid()}, headers=H["A"])
    assert ap.status_code == 200 and ap.json()["candidate"]["stage"] == "approved"
    on = c.post("/api/hr/cases", json={"kind": "onboarding", "candidate_id": cand["id"], "owner_id": 1, "anchor_date": soon()}, headers=H["A"])
    assert on.status_code in (201, 422)
    if on.status_code == 201: assert on.json()["stage"] == "ready"                                                    # the approval carries over
