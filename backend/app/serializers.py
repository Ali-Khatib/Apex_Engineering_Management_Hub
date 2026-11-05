from datetime import date
from . import models as m

def user_out(u):
    if not u: return None
    return {"id": u.id, "first_name": u.first_name, "last_name": u.last_name, "email": u.email, "role": u.role,
            "title": u.title, "onboarding_notes": u.onboarding_notes}

def repo_out(r):
    if not r: return None
    return {"id": r.id, "full_name": r.full_name, "url": r.url, "description": r.description,
            "default_branch": r.default_branch, "last_synced": r.last_synced}

def component_out(c, blockers=0, detail=False):
    today = date.today()
    at_risk = bool(blockers) or (c.due_date is not None and c.due_date < today and c.status not in ("done", "deployed")) or c.status == "blocked"
    d = {"id": c.id, "code": c.code, "name": c.name, "category": c.category, "layer": c.layer, "status": c.status,
         "priority": c.priority, "due_date": c.due_date, "owner": user_out(c.owner),
         "reviewer": user_out(c.reviewer), "qa": user_out(c.qa), "repo": repo_out(c.repo),
         "milestone_id": c.milestone_id, "open_blockers": blockers, "at_risk": at_risk,
         "unassigned": c.owner_id is None, "review_requested": c.review_requested,
         "gates": {"checks_passed": c.gate_checks_passed, "qa_accepted": c.gate_qa_accepted, "ready_for_deploy": c.gate_ready_for_deploy},
         "ready_for_review": c.status == "in_review" or c.review_requested, "description": c.description}
    if detail:
        d.update({"spec_md": c.spec_md, "docs_md": c.docs_md, "architecture_md": c.architecture_md,
                  "acceptance_criteria": c.acceptance_criteria, "links": c.links or {}, "updated_at": c.updated_at})
    return d

def event_out(e):
    return {"id": e.id, "repo_id": e.repo_id, "kind": e.kind, "ref_id": e.ref_id, "title": e.title, "state": e.state,
            "author": e.author, "url": e.url, "created_at": e.created_at}

def comment_out(c):
    return {"id": c.id, "body": c.body, "parent_id": c.parent_id, "created_at": c.created_at, "author": user_out(c.author)}

def acceptance_out(a):
    return {"id": a.id, "decision": a.decision, "evidence": a.evidence, "evidence_url": a.evidence_url,
            "created_at": a.created_at, "reviewer": user_out(a.reviewer)}

def blocker_out(b):
    return {
        "id": b.id, "component_id": b.component_id, "component_code": b.component.code,
        "title": b.title, "description": b.description, "category": b.category,
        "severity": b.severity, "responsible_id": b.responsible_id,
        "raised_by": user_out(b.raised_by), "next_action": b.next_action,
        "target_date": b.target_date, "slack": b.slack, "resolved": b.resolved,
        "created_at": b.created_at, "resolved_at": b.resolved_at,
    }

def audit_out(a):
    return {"id": a.id, "action": a.action, "detail": a.detail, "created_at": a.created_at,
            "component_id": a.component_id, "actor": user_out(a.actor)}
