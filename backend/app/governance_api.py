"""HTTP surface for templates, the Engineering Constitution, component specs,
AI Build Contracts and compliance reviews."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from . import models as m, governance as g, governance_service as gs
from .db import get_db
from .security import current_user, require_admin
from .services import audit, notify, admin_ids
from .events import publish

router = APIRouter(prefix="/api")

# Sections an owner may not edit. They define what "done" means and what the
# builder must never do, so the person being judged does not write them.
ADMIN_ONLY_SECTIONS = {"purpose", "acceptance_criteria", "guardrails", "ai_instructions"}


def _comp(db, cid) -> m.Component:
    c = db.get(m.Component, cid)
    if not c: raise HTTPException(404, "Component not found")
    return c


def _bad(errors: list[str]):
    raise HTTPException(422, {"message": "Invalid", "errors": errors})


# ------------------------------------------------------------ constitution
class ConstitutionIn(BaseModel):
    rules: list[dict]; note: str = ""

@router.get("/constitution")
def get_constitution(db: Session = Depends(get_db), _=Depends(current_user)):
    cur = gs.latest_constitution(db)
    hist = db.scalars(select(m.ConstitutionVersion).order_by(m.ConstitutionVersion.version.desc())).all()
    return {**cur, "history": [{"version": v.version, "note": v.note, "created_at": v.created_at, "rules": len(v.rules)} for v in hist]}

@router.get("/constitution/{version}")
def get_constitution_version(version: int, db: Session = Depends(get_db), _=Depends(current_user)):
    v = db.scalar(select(m.ConstitutionVersion).where(m.ConstitutionVersion.version == version))
    if not v: raise HTTPException(404, "Version not found")
    return {"version": v.version, "rules": v.rules, "note": v.note, "created_at": v.created_at}

@router.put("/constitution")
def put_constitution(b: ConstitutionIn, db: Session = Depends(get_db), admin=Depends(require_admin)):
    """Publishes a new version. Old versions are kept. Dropping a rule needs a written reason."""
    errs = g.validate_constitution_rules(b.rules)
    if errs: _bad(errs)
    cur = gs.latest_constitution(db)
    rules = g.next_constitution(cur["rules"], b.rules)
    gone = g.removed_rules(cur["rules"], rules)
    if gone and len(b.note.strip()) < 10: _bad([f"Removing {', '.join(gone)} needs a note of at least 10 characters explaining why"])
    if rules == cur["rules"]: raise HTTPException(409, "No change to publish")
    v = m.ConstitutionVersion(version=cur["version"] + 1, rules=rules, note=b.note.strip(), created_by_id=admin.id)
    db.add(v); audit(db, admin, "constitution.publish", f"v{v.version}" + (f"; removed {', '.join(gone)}" if gone else "")); db.commit()
    return {"version": v.version, "rules": v.rules, "note": v.note, "created_at": v.created_at}


# --------------------------------------------------------------- templates
class TemplateIn(BaseModel):
    name: str; description: str = ""; sections: list[dict]; is_default: bool = False
class TemplatePatch(BaseModel):
    description: str | None = None; sections: list[dict] | None = None; note: str = ""
    is_default: bool | None = None; is_active: bool | None = None

def _tpl_out(db, t, with_versions=False):
    d = gs.template_dict(db, t)
    if with_versions:
        d["versions"] = [{"version": v.version, "note": v.note, "created_at": v.created_at}
                         for v in db.scalars(select(m.ComponentTemplateVersion).where(m.ComponentTemplateVersion.template_id == t.id).order_by(m.ComponentTemplateVersion.version.desc()))]
    return d

@router.get("/templates")
def list_templates(db: Session = Depends(get_db), _=Depends(current_user)):
    return [_tpl_out(db, t) for t in db.scalars(select(m.ComponentTemplate).order_by(m.ComponentTemplate.name))]

@router.get("/templates/{tid}")
def get_template(tid: int, db: Session = Depends(get_db), _=Depends(current_user)):
    t = db.get(m.ComponentTemplate, tid)
    if not t: raise HTTPException(404, "Template not found")
    return _tpl_out(db, t, True)

@router.post("/templates", status_code=201)
def create_template(b: TemplateIn, db: Session = Depends(get_db), admin=Depends(require_admin)):
    name = b.name.strip()
    if not name or len(name) > 120: _bad(["name is required and at most 120 characters"])
    errs = g.validate_sections(b.sections)
    if errs: _bad(errs)
    if db.scalar(select(m.ComponentTemplate).where(m.ComponentTemplate.name == name)): raise HTTPException(409, "A template with this name exists")
    if b.is_default: db.query(m.ComponentTemplate).update({"is_default": False})
    t = m.ComponentTemplate(name=name, description=b.description, is_default=b.is_default, current_version=1, created_by_id=admin.id)
    db.add(t); db.flush()
    db.add(m.ComponentTemplateVersion(template_id=t.id, version=1, sections=g.clean_sections(b.sections), note="Created", created_by_id=admin.id))
    audit(db, admin, "template.create", name); db.commit(); return _tpl_out(db, t, True)

@router.patch("/templates/{tid}")
def update_template(tid: int, b: TemplatePatch, db: Session = Depends(get_db), admin=Depends(require_admin)):
    """Changing sections appends a new version; components keep the version they were written against."""
    t = db.get(m.ComponentTemplate, tid)
    if not t: raise HTTPException(404, "Template not found")
    if b.description is not None: t.description = b.description
    if b.is_active is False and t.is_default: raise HTTPException(409, "The default template cannot be archived")
    if b.is_active is not None: t.is_active = b.is_active
    if b.is_default:
        db.query(m.ComponentTemplate).update({"is_default": False}); t.is_default = True
    if b.sections is not None:
        errs = g.validate_sections(b.sections)
        if errs: _bad(errs)
        t.current_version += 1
        db.add(m.ComponentTemplateVersion(template_id=t.id, version=t.current_version, sections=g.clean_sections(b.sections),
                                          note=b.note.strip(), created_by_id=admin.id))
    audit(db, admin, "template.update", f"{t.name} v{t.current_version}"); db.commit(); return _tpl_out(db, t, True)


# ----------------------------------------------------------- component spec
class SpecIn(BaseModel):
    sections: dict[str, str] = {}
    template_id: int | None = None

def _spec_out(db, c):
    tpl = gs.component_template(db, c); vals = gs.component_values(db, c, tpl)
    deps, dependents = gs.relations(db, c); sp = gs.spec_row(db, c.id)
    out = []
    for s in tpl["sections"]:
        k = s["key"]
        row = {**s, "storage": "derived" if k in g.DERIVED_SECTIONS else "component" if k in g.LEGACY_COLUMNS else "spec",
               "admin_only": k in ADMIN_ONLY_SECTIONS}
        if k in g.DERIVED_SECTIONS: row["items"] = deps
        else: row["content"] = vals.get(k, "")
        out.append(row)
    missing = [s["key"] for s in tpl["sections"] if s.get("required") and s["key"] not in g.DERIVED_SECTIONS and not str(vals.get(s["key"], "")).strip()]
    return {"component": {"id": c.id, "code": c.code, "name": c.name},
            "template": {"id": tpl["id"], "name": tpl["name"], "version": tpl["version"],
                         "latest_version": gs.template_dict(db, db.get(m.ComponentTemplate, tpl["id"]))["version"]},
            "sections": out, "dependents": dependents, "missing_required": missing,
            "updated_at": sp.updated_at if sp else None}

@router.get("/components/{cid}/spec")
def get_spec(cid: int, db: Session = Depends(get_db), _=Depends(current_user)):
    return _spec_out(db, _comp(db, cid))

@router.put("/components/{cid}/spec")
def put_spec(cid: int, b: SpecIn, db: Session = Depends(get_db), user=Depends(current_user)):
    c = _comp(db, cid)
    if user.role != "admin" and c.owner_id != user.id: raise HTTPException(403, "Owner or admin only")
    sp = gs.spec_row(db, cid)
    if b.template_id is not None:
        if user.role != "admin": raise HTTPException(403, "Only admins can change a component's template")
        t = db.get(m.ComponentTemplate, b.template_id)
        if not t or not t.is_active: raise HTTPException(422, "Template not found or archived")
        if not sp: sp = m.ComponentSpec(component_id=cid, data={}); db.add(sp)
        sp.template_id, sp.template_version = t.id, t.current_version; db.flush()
    tpl = gs.component_template(db, c)
    allowed = {s["key"] for s in tpl["sections"] if s["key"] not in g.DERIVED_SECTIONS}
    unknown = sorted(set(b.sections) - allowed)
    if unknown: _bad([f"Unknown or read-only sections: {', '.join(unknown)}"])
    locked = sorted(set(b.sections) & ADMIN_ONLY_SECTIONS) if user.role != "admin" else []
    if locked: raise HTTPException(403, f"Only admins can edit: {', '.join(locked)}")
    for k, v in b.sections.items():
        if len(v) > 20000: _bad([f"{k} is longer than 20000 characters"])
    if not sp: sp = m.ComponentSpec(component_id=cid, data={}); db.add(sp)
    data = dict(sp.data or {}); edited = []
    for k, v in b.sections.items():
        cur = getattr(c, g.LEGACY_COLUMNS[k]) if k in g.LEGACY_COLUMNS else data.get(k, "")
        if (cur or "") == v: continue
        if k in g.LEGACY_COLUMNS: setattr(c, g.LEGACY_COLUMNS[k], v)
        else: data[k] = v
        edited.append(k)
    sp.data = data; sp.updated_by_id = user.id
    if edited: audit(db, user, "spec.update", "sections: " + ", ".join(edited), c.id)  # names only, never content
    db.commit(); publish("component", {"id": cid}); return _spec_out(db, c)


# ----------------------------------------------------------- build contract
@router.get("/components/{cid}/build-contract")
def get_contract(cid: int, format: str = "json", db: Session = Depends(get_db), _=Depends(current_user)):
    """The context an AI builder receives for this component.

    `trusted` is written by the server: the current Constitution and platform
    policy. `untrusted` is the component's own content, passed as data.
    """
    contract = gs.build_contract(db, _comp(db, cid))
    contract["context_errors"] = g.validate_contract(contract)
    if format == "prompt": contract["prompt"] = g.render_prompt(contract)
    elif format != "json": raise HTTPException(422, "format must be json or prompt")
    return contract


# ------------------------------------------------------ compliance reviews
def _review_out(r: m.ComplianceReview, db=None):
    return {"id": r.id, "component_id": r.component_id, "status": r.status, "contract_hash": r.contract_hash,
            "constitution_version": r.constitution_version, "checks": r.checks, "criteria": r.criteria,
            "created_at": r.created_at, "decided_at": r.decided_at, "decision_note": r.decision_note,
            "created_by": r.created_by_id, "decided_by": r.decided_by_id,
            "advisory": r.status == "advisory"}

def _can_judge(user, c):
    """The component's reviewer or an admin, and never the owner."""
    if c.owner_id == user.id: raise HTTPException(403, "The component owner cannot review their own work")
    if user.role != "admin" and c.reviewer_id != user.id: raise HTTPException(403, "Assigned reviewer or admin only")

@router.get("/components/{cid}/compliance-reviews")
def list_reviews(cid: int, db: Session = Depends(get_db), _=Depends(current_user)):
    _comp(db, cid)
    rs = db.scalars(select(m.ComplianceReview).where(m.ComplianceReview.component_id == cid).order_by(m.ComplianceReview.created_at.desc(), m.ComplianceReview.id.desc())).all()
    cur = gs.build_contract(db, _comp(db, cid))["content_hash"]
    return [{**_review_out(r), "current": r.contract_hash == cur} for r in rs]

@router.post("/components/{cid}/compliance-reviews", status_code=201)
def run_review(cid: int, db: Session = Depends(get_db), user=Depends(current_user)):
    """Evaluate the component against its contract. The result is advisory until a reviewer approves it."""
    c = _comp(db, cid)
    if user.role != "admin" and user.id not in (c.owner_id, c.reviewer_id): raise HTTPException(403, "Owner, reviewer or admin only")
    contract = gs.build_contract(db, c)
    criteria = g.new_criteria(contract["untrusted"]["acceptance_criteria"])
    checks = g.evaluate_compliance(gs.compliance_facts(db, c, contract, criteria))
    r = m.ComplianceReview(component_id=cid, contract_hash=contract["content_hash"], constitution_version=contract["trusted"]["constitution"]["version"],
                           status="advisory", checks=checks, criteria=criteria, created_by_id=user.id)
    db.add(r); audit(db, user, "compliance.run", f"contract {contract['content_hash'][:12]}", cid)
    if c.reviewer_id: notify(db, [c.reviewer_id], f"{c.code}: compliance review ready for your verdicts", cid, exclude=user.id)
    db.commit(); return {**_review_out(r), "current": True}

class Verdict(BaseModel): index: int; verdict: str; note: str = ""
class VerdictsIn(BaseModel): verdicts: list[Verdict]

@router.patch("/compliance-reviews/{rid}/criteria")
def set_verdicts(rid: int, b: VerdictsIn, db: Session = Depends(get_db), user=Depends(current_user)):
    r = db.get(m.ComplianceReview, rid)
    if not r: raise HTTPException(404, "Review not found")
    c = _comp(db, r.component_id); _can_judge(user, c)
    if r.status != "advisory": raise HTTPException(409, "This review has already been decided")
    crit = [dict(x) for x in r.criteria]
    for v in b.verdicts:
        if not 0 <= v.index < len(crit): raise HTTPException(422, f"No criterion at index {v.index}")
        if v.verdict not in g.CRITERION_VERDICTS: raise HTTPException(422, f"verdict must be one of {list(g.CRITERION_VERDICTS)}")
        crit[v.index]["verdict"] = v.verdict; crit[v.index]["note"] = v.note[:500]
    r.criteria = crit; r.checks = g.refresh_acceptance_check(r.checks, crit)
    audit(db, user, "compliance.verdicts", f"{len(b.verdicts)} criteria", c.id); db.commit()
    return _review_out(r)

class DecisionIn(BaseModel): decision: str; note: str = ""

@router.post("/compliance-reviews/{rid}/decision")
def decide(rid: int, b: DecisionIn, db: Session = Depends(get_db), user=Depends(current_user)):
    r = db.get(m.ComplianceReview, rid)
    if not r: raise HTTPException(404, "Review not found")
    c = _comp(db, r.component_id); _can_judge(user, c)
    if b.decision not in ("approve", "reject"): raise HTTPException(422, "decision must be approve or reject")
    if r.status != "advisory": raise HTTPException(409, "This review has already been decided")
    if b.decision == "approve":
        if gs.build_contract(db, c)["content_hash"] != r.contract_hash:
            raise HTTPException(409, "The specification or Constitution changed after this review. Run a new review.")
        why = g.can_approve(r.checks, r.criteria)
        if why: raise HTTPException(409, {"message": "Cannot approve yet", "reasons": why})
    elif len(b.note.strip()) < 5: _bad(["A rejection needs a note"])
    r.status = "approved" if b.decision == "approve" else "rejected"
    r.decided_by_id, r.decided_at, r.decision_note = user.id, datetime.utcnow(), b.note.strip()
    audit(db, user, f"compliance.{r.status}", b.note.strip()[:120], c.id)
    notify(db, [c.owner_id], f"{c.code}: compliance review {r.status} by {user.first_name}", c.id, exclude=user.id)
    db.commit(); publish("component", {"id": c.id}); return _review_out(r)
