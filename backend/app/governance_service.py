"""Database-facing helpers for governance: load what the pure rules in
governance.py need, and apply the completion gate."""
from sqlalchemy import select
from sqlalchemy.orm import Session
from . import models as m, governance as g
from .config import REQUIRE_COMPLIANCE_REVIEW


def seed_governance(db: Session):
    """Insert the first Constitution and the default template if absent. Idempotent."""
    if not db.scalar(select(m.ConstitutionVersion).limit(1)):
        db.add(m.ConstitutionVersion(version=1, rules=g.constitution_rules(), note="Initial Apex Engineering Constitution, with AI slop blockers"))
    if not db.scalar(select(m.ComponentTemplate).limit(1)):
        t = m.ComponentTemplate(name=g.DEFAULT_TEMPLATE_NAME, is_default=True, current_version=1,
                                description="The standard specification every component is written against.")
        db.add(t); db.flush()
        db.add(m.ComponentTemplateVersion(template_id=t.id, version=1, sections=g.DEFAULT_SECTIONS, note="Initial version"))
    db.commit()
    upgrade_defaults(db)


def upgrade_defaults(db: Session):
    """Bring a database seeded before the AI slop work up to the current defaults.

    Only an untouched default is upgraded: the in-force Constitution must still
    be version 1 with exactly the original fourteen rules, and the default
    template must still be version 1 with exactly the original ten sections.
    Anything an admin has already changed is left alone. Each upgrade is a new
    version, so the history shows it and the old version stays readable.
    """
    cur = db.scalar(select(m.ConstitutionVersion).order_by(m.ConstitutionVersion.version.desc()).limit(1))
    if cur and cur.version == 1 and [r.get("text") for r in cur.rules] == g.CONSTITUTION_V1:
        db.add(m.ConstitutionVersion(version=2, rules=g.constitution_rules(), note="Added the company-wide AI slop blockers (R15 to R26)"))
    t = db.scalar(select(m.ComponentTemplate).where(m.ComponentTemplate.is_default == True))  # noqa
    if t and t.current_version == 1:
        v = db.scalar(select(m.ComponentTemplateVersion).where(m.ComponentTemplateVersion.template_id == t.id, m.ComponentTemplateVersion.version == 1))
        if v and [s.get("key") for s in v.sections] == g.LEGACY_DEFAULT_KEYS and not any(s.get("boilerplate") for s in v.sections):
            db.add(m.ComponentTemplateVersion(template_id=t.id, version=2, sections=g.DEFAULT_SECTIONS,
                                              note="Added Component AI baseline and Component AI slop defender, with baseline text"))
            t.current_version = 2
    db.commit()


def latest_constitution(db: Session) -> dict:
    c = db.scalar(select(m.ConstitutionVersion).order_by(m.ConstitutionVersion.version.desc()).limit(1))
    return {"version": c.version, "rules": c.rules, "note": c.note, "created_at": c.created_at} if c else {"version": 0, "rules": [], "note": ""}


def template_dict(db: Session, t: m.ComponentTemplate, version: int | None = None) -> dict:
    v = db.scalar(select(m.ComponentTemplateVersion).where(m.ComponentTemplateVersion.template_id == t.id,
                                                          m.ComponentTemplateVersion.version == (version or t.current_version)))
    return {"id": t.id, "name": t.name, "description": t.description, "is_default": t.is_default, "is_active": t.is_active,
            "version": v.version if v else t.current_version, "sections": v.sections if v else g.DEFAULT_SECTIONS}


def default_template(db: Session) -> m.ComponentTemplate | None:
    return db.scalar(select(m.ComponentTemplate).where(m.ComponentTemplate.is_default == True)) or db.scalar(select(m.ComponentTemplate).limit(1))  # noqa


def spec_row(db: Session, cid: int) -> m.ComponentSpec | None:
    return db.scalar(select(m.ComponentSpec).where(m.ComponentSpec.component_id == cid))


def component_template(db: Session, c: m.Component) -> dict | None:
    """The template (at its pinned version) this component is written against."""
    sp = spec_row(db, c.id)
    t = db.get(m.ComponentTemplate, sp.template_id) if sp and sp.template_id else default_template(db)
    if not t: return None
    return template_dict(db, t, sp.template_version if sp and sp.template_id else None)


def component_values(db: Session, c: m.Component, template: dict | None) -> dict:
    sp = spec_row(db, c.id)
    legacy = {col: getattr(c, col) for col in g.LEGACY_COLUMNS.values()}
    return g.section_values((template or {}).get("sections") or g.DEFAULT_SECTIONS, legacy, sp.data if sp else {})


def _brief(c: m.Component) -> dict:
    return {"code": c.code, "name": c.name, "status": c.status}


def relations(db: Session, c: m.Component):
    comps = lambda col, other: db.scalars(select(m.Component).where(m.Component.id.in_(select(col).where(other == c.id)))).unique().all()
    return ([_brief(x) for x in comps(m.Dependency.depends_on_id, m.Dependency.component_id)],
            [_brief(x) for x in comps(m.Dependency.component_id, m.Dependency.depends_on_id)])


def build_contract(db: Session, c: m.Component) -> dict:
    tpl = component_template(db, c)
    deps, dependents = relations(db, c)
    return g.assemble_contract(
        constitution=latest_constitution(db), template=tpl,
        component={"code": c.code, "name": c.name, "category": c.category, "status": c.status},
        values=component_values(db, c, tpl), dependencies=deps, dependents=dependents)


def compliance_facts(db: Session, c: m.Component, contract: dict, criteria: list[dict]) -> dict:
    values = {s["key"]: s["content"] for s in contract["untrusted"]["sections"]}
    events = []
    if c.repo_id:
        events = db.scalars(select(m.GitHubEvent).where(m.GitHubEvent.repo_id == c.repo_id, m.GitHubEvent.kind == "workflow")
                            .order_by(m.GitHubEvent.created_at.desc()).limit(1)).all()
    ob = db.scalars(select(m.Blocker).where(m.Blocker.component_id == c.id, m.Blocker.resolved == False)).all()  # noqa
    return {"missing_sections": contract["missing_required_sections"],
            "documented": {k for k, v in values.items() if str(v).strip()},
            "dependencies": contract["untrusted"]["dependencies"], "checks_passed": c.gate_checks_passed,
            "ci": events[0].state if events else None, "qa_accepted": c.gate_qa_accepted,
            "open_blockers": len(ob), "criteria": criteria}


def completion_blocked(db: Session, c: m.Component) -> str | None:
    """Reason a component may not be marked done or deployed, or None.

    Only applies when APEX_REQUIRE_COMPLIANCE_REVIEW=1. The approval must be of
    the current contract: editing the specification after approval needs a new
    review.
    """
    if not REQUIRE_COMPLIANCE_REVIEW: return None
    h = build_contract(db, c)["content_hash"]
    ok = db.scalar(select(m.ComplianceReview).where(m.ComplianceReview.component_id == c.id, m.ComplianceReview.status == "approved",
                                                    m.ComplianceReview.contract_hash == h).limit(1))
    return None if ok else "Completion requires a human-approved compliance review of the current Build Contract"
