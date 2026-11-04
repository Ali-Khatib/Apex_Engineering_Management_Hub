"""Seeds the demo from the real Apex component design library (design_manifest.json, 127 entries)."""
import json, random, re, zlib
from datetime import date, datetime, timedelta
from sqlalchemy import select
from sqlalchemy.orm import Session
from . import models as m
from .config import SEED_MANIFEST
from .security import hash_password

USERS = [  # (first, last, email, role, title)
    ("Admin", "Demo", "admin@apexai.demo", "admin", "Engineering Manager"),
    ("Reviewer", "Demo", "reviewer@apexai.demo", "admin", "Security & QA Reviewer"),
    ("Amna", "Khan", "amna@apexai.demo", "member", "Platform Engineer"),
    ("Bilal", "Raza", "bilal@apexai.demo", "member", "AI Engineer"),
    ("Sara", "Malik", "sara@apexai.demo", "member", "Backend Engineer"),
    ("Hamza", "Tariq", "hamza@apexai.demo", "member", "Frontend Engineer"),
    ("Noor", "Ahmed", "noor@apexai.demo", "member", "DevOps Engineer"),
]
REPOS = {
    "apexai/platform-core": "Core services: workflow, rules, case/task, scheduler, event bus.",
    "apexai/ai-services": "Model gateway, RAG, document AI, evaluation, guardrails.",
    "apexai/security-governance": "Identity, tenant isolation, secrets, audit, privacy.",
    "apexai/experience-shells": "Web/mobile shells, admin console, Arabic/English UX.",
    "apexai/app-factory": "Frappe app factory, manifests, templates, release pipeline.",
}
REPO_BY_LAYER = {"PL01": "apexai/experience-shells", "PL02": "apexai/platform-core", "PL03": "apexai/ai-services", "PL04": "apexai/platform-core",
                 "PL05": "apexai/security-governance", "PL06": "apexai/platform-core", "PL07": "apexai/platform-core", "PL08": "apexai/app-factory"}
PRIO = {"P0": "P0", "Now": "P0", "P1": "P1", "Architecture decision": "P1", "Next": "P2", "Gated": "P2", "Later": "P3", "Not selected": "P3"}

def _spec(x):
    li = lambda a: "\n".join(f"- `{i}`" for i in a)
    return (f"## Operation\n**{x['op']}**\n\n### Inputs\n{li(x['inputs'])}\n\n### Outputs\n{li(x['outputs'])}\n\n### Logical entities\n{li(x['entities'])}\n\n"
            f"### Constraints\n{x['constraints']}\n\n### Trigger\n{x['trigger']}\n\n### Success metric\n{x['metric']}\n")

def _docs(x):
    return (f"# {x['id']} · {x['name']}\n\n{x['purpose']}\n\n**Users:** {x['users']}  \n**SP mapping:** {x['mapping']}\n\n"
            f"## Implementation sequence\n1. Confirm source scope and reuse boundary; review overlaps before creating a repository.\n"
            f"2. Freeze the smallest contract for *{x['op']}* with one consumer.\n3. Implement adapter, validator and handler with tenant-scoped records.\n"
            f"4. Connect dependencies ({', '.join(x['deps']) or 'none'}) via versioned interfaces; use isolated fixtures until each passes contract checks.\n"
            f"5. Exercise the critical failure case, then publish evidence, QA report and rollback notes.\n")

def seed(db: Session):
    if db.scalar(select(m.User).limit(1)): return
    rnd = random.Random(7); today = date.today()
    users = []
    for f, l, e, r, t in USERS:
        u = m.User(first_name=f, last_name=l, email=e, role=r, title=t, password_hash=hash_password("Admin123!" if r == "admin" else "Member123!"),
                   onboarding_notes="" if r == "admin" else "Read the Company Vision and Best Practices pages, request repo access, pair with your reviewer on the first component handoff.")
        db.add(u); users.append(u)
    db.flush(); members = [u for u in users if u.role == "member"]; admins = [u for u in users if u.role == "admin"]
    repos = {}
    for name, desc in REPOS.items():
        r = m.Repository(full_name=name, url=f"https://github.com/{name}", description=desc, docs_md=f"# {name.split('/')[1]}\n\n{desc}\n\n## Conventions\n- Trunk-based, short-lived branches\n- PRs require one review and green CI\n- Docs live next to the code in `/docs`\n", last_synced=datetime.utcnow())
        db.add(r); repos[name] = r
    db.flush()
    ms = [m.Milestone(name=n, description=d, target_date=today + timedelta(days=k)) for n, d, k in [
        ("M1 · Proof workflow foundation", "P0 security, audit, identity and runtime foundations.", 21),
        ("M2 · Core platform services", "Workflow, data and integration services for the proof app.", 49),
        ("M3 · AI & experience layer", "AI services and bilingual UX for the first in-house app.", 84),
        ("M4 · Release & operate", "Pipelines, SLA monitoring and tenant operations.", 126)]]
    db.add_all(ms); db.flush()
    try: sp_links = {x["title"].split("_")[0]: x["url"] for x in json.load(open(SEED_MANIFEST.replace("design_manifest", "original_SP_links")))}
    except Exception: sp_links = {}
    manifest = json.load(open(SEED_MANIFEST)); byid = {}
    for x in manifest:
        cat = x["layer"] if x["group"] == "Catalog" else x["group"]
        prio = PRIO.get(x["priority"], "P2"); h = zlib.crc32(x["id"].encode()) % 100
        if x["priority"] in ("Not selected", "Later"): status, owner = "proposed", None
        else:
            status = "proposed" if h < 30 else "in_progress" if h < 58 else "in_review" if h < 70 else "blocked" if h < 78 else "done" if h < 92 else "deployed"
            owner = None if (h % 7 == 0 and status == "proposed") else members[h % len(members)]
        if status == "proposed" and owner is None and prio in ("P0",): owner = members[h % len(members)]
        layer_key = x["layer"][:4] if x["group"] == "Catalog" else None
        repo = repos[REPO_BY_LAYER.get(layer_key, "apexai/app-factory" if x["group"] == "App generation" else "apexai/platform-core")] if status != "proposed" or prio in ("P0", "P1") else None
        due = today + timedelta(days=rnd.randint(-12, 110)) if x["priority"] not in ("Not selected", "Later") else None
        if status in ("done", "deployed"): due = today - timedelta(days=rnd.randint(1, 30))
        links = {"sheets": x["source"]}
        sp = re.search(r"SP-(\d+)", x["mapping"])
        if sp and f"SP-{sp.group(1)}" in sp_links: links["drive"] = sp_links[f"SP-{sp.group(1)}"]
        if repo: links["github"] = repo.url
        c = m.Component(code=x["id"], name=x["name"], category=cat, layer=x["layer"], description=x["purpose"], spec_md=_spec(x), docs_md=_docs(x),
                        architecture_md=f"Design pack: `{x['folder']}` — eight views (context, building blocks, contracts, primary flow, data model, deployment, dependencies, lifecycle). Proposed, not yet reviewed.",
                        acceptance_criteria=x["acceptance"] or x["test"], status=status, priority=prio, due_date=due, owner=owner, repo=repo,
                        milestone_id=ms[0 if prio == "P0" else 1 if prio == "P1" else 2 if prio == "P2" else 3].id, links=links)
        c.links["folder"] = x["folder"]
        c.gate_checks_passed = status in ("in_review", "done", "deployed"); c.gate_qa_accepted = status in ("done", "deployed"); c.gate_ready_for_deploy = status == "deployed"
        c.review_requested = status == "in_review"
        db.add(c); byid[x["id"]] = (c, x)
    db.flush()
    for cid, (c, x) in byid.items():
        for d in x["deps"]:
            if d in byid and d != cid: db.add(m.Dependency(component_id=c.id, depends_on_id=byid[d][0].id))
        if c.status in ("in_progress", "in_review", "blocked"):
            for t in ["Contract schema frozen and reviewed", "Fixtures + failure case documented", "Operations notes and rollback written", "Reviewer briefed"]:
                db.add(m.ChecklistItem(component_id=c.id, text=t, done=rnd.random() < (0.8 if c.status == "in_review" else 0.4)))
        if c.status == "blocked":
            db.add(m.Blocker(component_id=c.id, description=rnd.choice(["Waiting on dependency contract to be published", "Security approver not yet selected", "Unclear tenant data tier — needs classification"]), raised_by_id=c.owner_id))
        if c.status in ("done", "deployed"):
            db.add(m.Acceptance(component_id=c.id, reviewer_id=admins[1].id, decision="accepted", evidence="Independent QA run on exact build; failure scenario verified.", evidence_url="https://github.com/apexai/platform-core/actions"))
    for code, text in [("C078", "Scoped support views need the grant expiry check before anything else. Can we agree the error contract this week?"), ("C027", "Dead-letter replay record format — reuse C060 schema registry entry?")]:
        if code in byid and byid[code][0].owner_id is None: byid[code][0].owner = members[0]; byid[code][0].status = "in_progress"
        db.add(m.Comment(component_id=byid[code][0].id, author_id=admins[0].id, body=text))
    # kb
    kb = [("vision", "vision", "Company Vision", "# Company Vision\n\nApex AI Arabia builds a reusable platform of AI, workflow and governance components, composed into client apps by an internal app factory.\n\n## Principles\n- Reuse mapped SP / catalog capability before a new build\n- Tenant isolation, audit and bilingual (Arabic/English) support are defaults, not add-ons\n- Readiness is evidenced: checks, QA acceptance and deployment readiness are separate gates"),
          ("objectives", "vision", "Platform Objectives", "# Platform Objectives\n\n1. Select a proof workflow and compose the smallest set of components for it.\n2. Reconcile overlaps (C/SP, PN/ADD, P/catalog) before assignment.\n3. Ship with exact-build evidence, independent QA, rollback and documentation.\n4. Keep one place for who owns what, what is blocked, and what is ready."),
          ("structure", "vision", "Engineering Structure", "# Engineering Structure\n\n- **Eight platform layers** (PL01 Experience … PL08 Developer Platform & Release)\n- **Component packs:** C001–C085 catalog, A21–A48 additions, P-01–P-06 app generation\n- **Roles:** Admin (plan, assign, approve) · Member (build, comment, hand off)\n- Reviewers must not accept their own component."),
          ("contacts", "vision", "People & Points of Contact", "# Points of Contact\n\n| Area | Contact |\n|---|---|\n| Architecture, sequencing, reuse | Engineering Manager (Admin) |\n| Security approval | Security & QA Reviewer |\n| Onboarding | Your component owner / pairing buddy |\n\nSee the **Team** page for live assignments."),
          ("coding-standards", "practices", "Coding Standards", "# Coding Standards\n\n- Python 3.12 / TypeScript strict; formatters and linters enforced in CI\n- Public contracts are versioned JSON Schemas; no breaking change without a new version\n- Every handler is tenant-scoped; idempotency keys on external writes\n- No secrets in code; use the secrets service"),
          ("guidelines", "practices", "Engineering Guidelines", "# Engineering Guidelines\n\n- Smallest viable contract first, agreed with one consumer\n- Isolated fixtures until real dependencies pass contract checks\n- Break dependency cycles through published interfaces\n- Record blockers the day they appear"),
          ("workflows", "practices", "Development Workflows", "# Development Workflows\n\n1. Component assigned → owner reads docs/spec/acceptance\n2. Short-lived branch → PR → review → merge (GitHub activity appears here automatically)\n3. Owner sets **Checks passed**, requests review\n4. Reviewer records decision **with evidence** → **QA accepted**\n5. Admin sets **Ready for deployment**\n\nCI green does **not** equal ready."),
          ("documentation", "practices", "Documentation Practices", "# Documentation Practices\n\n- Markdown beside the code; component page mirrors the essentials\n- Each page has an owner and last-updated date\n- Architecture changes update the eight-view design pack\n- Handoff checklist completed before review")]
    for slug, sec, title, body in kb: db.add(m.KBPage(slug=slug, section=sec, title=title, body_md=body, owner_id=admins[0].id))
    # backdated GitHub activity
    for r in repos.values():
        for i, (kind, title, state) in enumerate([("push", "feat: contract validator", "pushed"), ("pull_request", "Add tenant-scoped repository adapter", "open"), ("workflow", "CI @ main", "success"),
                                                  ("pull_request", "Harden idempotency handling", "merged"), ("review", "Review on #214: Harden idempotency handling", "approved"), ("issue", "Clarify error contract for expired access", "open"),
                                                  ("workflow", "CI @ feature/audit-hook", "failure" if r.full_name.endswith("services") else "success")]):
            db.add(m.GitHubEvent(repo_id=r.id, kind=kind, ref_id=f"seed{i}", title=title, state=state, author=rnd.choice(["amna-k", "bilal-r", "sara-m", "hamza-t"]),
                                 url=r.url, created_at=datetime.utcnow() - timedelta(hours=6 * (len(REPOS) - i) + i)))
    db.add(m.AuditLog(actor_id=admins[0].id, action="seed", detail="Demo data loaded from Apex Component Designs 2026-10-20"))
    db.commit()
