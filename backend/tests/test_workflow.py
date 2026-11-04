import json, os, tempfile
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/t.db"
from fastapi.testclient import TestClient
from app.main import app
from app import github as gh

def login(c, email, pw):
    r = c.post("/api/auth/login", json={"email": email, "password": pw}); assert r.status_code == 200
    return {"Authorization": "Bearer " + r.json()["token"]}

def test_end_to_end():
    with TestClient(app) as c:
        A = login(c, "admin@apexai.demo", "Admin123!"); R = login(c, "reviewer@apexai.demo", "Admin123!"); M = login(c, "amna@apexai.demo", "Member123!")
        assert c.post("/api/auth/login", json={"email": "admin@apexai.demo", "password": "x"}).status_code == 401
        assert len(c.get("/api/components", headers=A).json()) == 127
        # RBAC
        body = {"code": "T-1", "name": "Demo Component", "category": "Demo"}
        assert c.post("/api/components", json=body, headers=M).status_code == 403
        users = {u["email"]: u for u in c.get("/api/users", headers=A).json()}
        repo = c.get("/api/repos", headers=A).json()[0]
        # 1-2 admin creates, assigns owner, priority
        comp = c.post("/api/components", json={**body, "owner_id": users["amna@apexai.demo"]["id"], "priority": "P0", "repo_id": repo["id"], "acceptance_criteria": "works"}, headers=A)
        assert comp.status_code == 201; cid = comp.json()["id"]
        assert c.post("/api/components", json=body, headers=A).status_code == 409
        assert any("assigned" in n["message"] for n in c.get("/api/notifications", headers=M).json())
        # 3 engineer views details
        d = c.get(f"/api/components/{cid}", headers=M).json(); assert d["owner"]["first_name"] == "Amna" and d["acceptance_criteria"] == "works"
        # 4 GitHub activity arrives via SIGNED webhook
        payload = json.dumps({"repository": {"full_name": repo["full_name"]}, "commits": [{"id": "abcdef1234", "message": "feat: x\n\nbody", "author": {"name": "amna-k"}, "url": "u"}]}).encode()
        h = {"X-GitHub-Event": "push", "X-GitHub-Delivery": "d-1", "X-Hub-Signature-256": gh.sign(payload), "Content-Type": "application/json"}
        assert c.post("/api/github/webhook", content=payload, headers={**h, "X-Hub-Signature-256": "sha256=bad"}).status_code == 401
        assert c.post("/api/github/webhook", content=payload, headers=h).json() == {"stored": 1}
        assert c.post("/api/github/webhook", content=payload, headers=h).json() == {"ignored": "duplicate delivery"}
        assert c.get(f"/api/components/{cid}", headers=M).json()["github"][0]["title"] == "feat: x"
        # 5 comments (any user)
        assert c.post(f"/api/components/{cid}/comments", json={"body": "hello"}, headers=M).status_code == 201
        # 7 gates independent of CI: CI success does not set any gate
        gh.simulate.__wrapped__ if hasattr(gh.simulate, "__wrapped__") else None
        c.post(f"/api/repos/{repo['id']}/simulate?scenario=ci_success", headers=A)
        g = c.get(f"/api/components/{cid}", headers=M).json(); assert g["ci"] == "success" and not any(g["gates"].values())
        # blockers gate review
        b = c.post(f"/api/components/{cid}/blockers", json={"description": "dep"}, headers=M).json()["id"]
        assert c.post(f"/api/components/{cid}/request-review", headers=M).status_code == 409
        assert c.post(f"/api/blockers/{b}/resolve", headers=M).status_code == 200
        assert c.post(f"/api/components/{cid}/request-review", headers=M).status_code == 200
        # 6 reviewer records decision; owner cannot self-accept; evidence required
        assert c.post(f"/api/components/{cid}/acceptances", json={"decision": "accepted", "evidence": "x"}, headers=M).status_code == 403
        assert c.post(f"/api/components/{cid}/acceptances", json={"decision": "accepted"}, headers=R).status_code == 422
        assert c.post(f"/api/components/{cid}/gates", json={"gate": "ready_for_deploy", "value": True}, headers=A).status_code == 409
        assert c.post(f"/api/components/{cid}/gates", json={"gate": "checks_passed", "value": True}, headers=M).status_code == 200
        assert c.post(f"/api/components/{cid}/acceptances", json={"decision": "accepted", "evidence": "QA run ok"}, headers=R).status_code == 201
        assert c.post(f"/api/components/{cid}/gates", json={"gate": "ready_for_deploy", "value": True}, headers=M).status_code == 403
        assert c.post(f"/api/components/{cid}/gates", json={"gate": "ready_for_deploy", "value": True}, headers=A).status_code == 200
        assert c.patch(f"/api/components/{cid}", json={"status": "deployed"}, headers=A).status_code == 200
        # 8 dashboard
        p = c.get("/api/portfolio", headers=M).json(); assert p["total"] == 128 and p["gates"]["ready_for_deploy"] >= 1
        assert c.get("/api/components?unassigned=true", headers=M).status_code == 200
        # audit trail captured
        assert {"component.create", "acceptance.accepted", "gate.ready_for_deploy"} <= {h["action"] for h in c.get(f"/api/components/{cid}", headers=M).json()["history"]}

def test_dependency_cycles_and_rbac():
    with TestClient(app) as c:
        A = login(c, "admin@apexai.demo", "Admin123!"); M = login(c, "bilal@apexai.demo", "Member123!")
        g = c.get("/api/graph", headers=A).json(); e = g["edges"][0]
        assert c.post("/api/dependencies", json={"component_id": e["to"], "depends_on_id": e["from"]}, headers=A).status_code == 409  # direct cycle
        assert c.post("/api/dependencies", json={"component_id": e["from"], "depends_on_id": e["from"]}, headers=A).status_code == 422
        assert c.post("/api/dependencies", json={"component_id": e["from"], "depends_on_id": e["to"]}, headers=A).status_code == 409  # exists
        assert c.delete(f"/api/dependencies/{e['id']}", headers=M).status_code == 403
        assert c.delete(f"/api/dependencies/{e['id']}", headers=A).status_code == 204
        assert c.get("/api/kb/vision", headers=M).status_code == 200
        assert c.put("/api/kb/vision", json={"title": "t", "body_md": "b"}, headers=M).status_code == 403
        assert c.get("/api/components").status_code == 401
