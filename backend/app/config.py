import os

# APEX_ENV decides which safety rails are on. Anything other than "production"
# is treated as a development environment.
APEX_ENV = os.getenv("APEX_ENV", "development")
IS_PRODUCTION = APEX_ENV.lower() == "production"

# Fabricated GitHub activity. Off unless switched on explicitly, and it cannot
# be switched on in production at all: a demo that invents commits and CI runs
# must never be reachable from a surface where somebody could read it as real.
ALLOW_SIMULATED_GITHUB = (
    os.getenv("ALLOW_SIMULATED_GITHUB", "0") == "1" and not IS_PRODUCTION
)

# When on, a component cannot move to done or deployed unless a human reviewer
# has approved a compliance review of its current Build Contract. Off by default
# so existing workflows keep working until a team chooses to require it.
REQUIRE_COMPLIANCE_REVIEW = os.getenv("APEX_REQUIRE_COMPLIANCE_REVIEW", "0") == "1"

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./apex_erp.db")


def _secret(name: str, dev_default: str) -> str:
    """A weak default is fine on a laptop and unacceptable in production.

    The MVP shipped 'dev-only-change-me' and 'demo-webhook-secret' as silent
    fallbacks, so a deployment that forgot to set them would run with a secret
    that is published in the source. In production the variable is required.
    """
    v = os.getenv(name)
    if v:
        return v
    if IS_PRODUCTION:
        raise RuntimeError(f"{name} must be set when APEX_ENV=production")
    return dev_default


JWT_SECRET = _secret("JWT_SECRET", "dev-only-change-me")
GITHUB_WEBHOOK_SECRET = _secret("GITHUB_WEBHOOK_SECRET", "demo-webhook-secret")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")  # optional: enables live REST sync
GITHUB_API = "https://api.github.com"
DESIGNS_DIR = os.getenv("DESIGNS_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "designs"))
SEED_MANIFEST = os.getenv("SEED_MANIFEST", os.path.join(DESIGNS_DIR, "design_manifest.json"))
STATIC_DIR = os.getenv("STATIC_DIR", os.path.join(os.path.dirname(__file__), "..", "static"))
ORG_LINKS = {k: v for k, v in {
    "GitHub": os.getenv("GITHUB_ORG_URL", "https://github.com/apexai"),
    "ERPNext": os.getenv("ERPNEXT_URL", ""),
    "Slack": os.getenv("SLACK_URL", ""),
    "Google Drive": os.getenv("DRIVE_URL", ""),
    "Google Sheets": os.getenv("SHEETS_URL", "https://docs.google.com/spreadsheets/d/1Dek6LQeTXUVe1QMjD3Wi2fWnjRSvW4VcZNyR2gdHO3k/edit"),
}.items() if v}
