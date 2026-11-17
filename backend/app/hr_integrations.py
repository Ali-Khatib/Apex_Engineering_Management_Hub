"""Boundary for external systems (ERP, VPN, Slack, Calendar, contracts).

None is connected. Every adapter reports `not_configured`, so a checklist task bound to one stays a human task
with a manual confirmation. Nothing here makes a network call or claims a result it did not get.
To connect one later, implement `Adapter.check` and `.perform`, register it in ADAPTERS, and document the
credentials it needs. A real action must stay off in development and test.
"""
from . import hr


class Adapter:
    name = ""
    def status(self) -> dict: return {"system": self.name, "state": "not_configured", "detail": "No connection is set up. Confirm this step by hand."}


ADAPTERS = {k: type("A", (Adapter,), {"name": k})() for k in hr.INTEGRATIONS if k != "none"}


def integration_status() -> list[dict]:
    return [a.status() for a in ADAPTERS.values()]
