from sqlalchemy.orm import Session
from sqlalchemy import select
from . import models as m
from .events import publish

def audit(db: Session, actor, action: str, detail: str = "", component_id: int | None = None):
    db.add(m.AuditLog(actor_id=getattr(actor, "id", None), component_id=component_id, action=action, detail=detail))
    publish("audit", {"action": action, "component_id": component_id})

def notify(db: Session, user_ids, message: str, component_id: int | None = None, exclude: int | None = None):
    for uid in set(user_ids):
        if uid and uid != exclude:
            db.add(m.Notification(user_id=uid, component_id=component_id, message=message))
            publish("notification", {"user_id": uid, "message": message, "component_id": component_id})

def admin_ids(db: Session):
    return [u.id for u in db.scalars(select(m.User).where(m.User.role == "admin"))]

def open_blockers(db: Session, cid: int):
    return list(db.scalars(select(m.Blocker).where(m.Blocker.component_id == cid, m.Blocker.resolved == False)))  # noqa

def is_at_risk(db_blockers: int, c: m.Component, today) -> bool:
    overdue = c.due_date is not None and c.due_date < today and c.status not in ("done", "deployed")
    return bool(db_blockers) or overdue or c.status == "blocked"
