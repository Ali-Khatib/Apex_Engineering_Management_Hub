"""Validation for user profile fields.

Pure functions with no framework imports, so the rules can be tested on their
own. Every function returns the cleaned value or raises ValueError with a
message that is safe to show to the person who typed it.
"""
import re
from urllib.parse import urlparse

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^\+?[0-9 ()\-]{7,25}$")
VPN_RE = re.compile(r"^[A-Za-z0-9._@\-]{3,80}$")
GITHUB_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")

# Fields only an admin, or the person themselves, may read. They never appear in
# list endpoints, in the user objects embedded in components, or on any page
# another member can open.
PRIVATE_FIELDS = ("phone", "vpn_id", "linkedin_url")


def text(value, label: str, max_len: int, required: bool = True) -> str:
    v = (value or "").strip()
    if required and not v:
        raise ValueError(f"{label} is required")
    if len(v) > max_len:
        raise ValueError(f"{label} must be at most {max_len} characters")
    return v


def email(value) -> str:
    v = text(value, "Email", 200).lower()
    if not EMAIL_RE.match(v):
        raise ValueError("Email is not a valid address")
    return v


def phone(value, required: bool = True) -> str:
    v = text(value, "Phone", 25, required)
    if v and (not PHONE_RE.match(v) or sum(c.isdigit() for c in v) < 7):
        raise ValueError("Phone must be 7 to 25 digits, spaces, dashes or brackets, with an optional leading +")
    return v


def _https_url(value, label: str, required: bool, host_suffix: str | None = None) -> str:
    v = text(value, label, 400, required)
    if not v:
        return v
    p = urlparse(v)
    if p.scheme != "https" or not p.hostname or "." not in p.hostname:
        raise ValueError(f"{label} must be an https:// address")
    if p.username or p.password:
        raise ValueError(f"{label} must not contain credentials")
    host = p.hostname.lower()
    if host_suffix and not (host == host_suffix or host.endswith("." + host_suffix)):
        raise ValueError(f"{label} must be on {host_suffix}")
    return v


def linkedin_url(value, required: bool = True) -> str:
    return _https_url(value, "LinkedIn URL", required, "linkedin.com")


def website_url(value) -> str:
    return _https_url(value, "Website URL", False)


def vpn_id(value, required: bool = True) -> str:
    v = text(value, "VPN ID", 80, required)
    if v and not VPN_RE.match(v):
        raise ValueError("VPN ID must be 3 to 80 letters, digits or . _ @ -")
    return v


def github_id(value) -> str:
    v = text(value, "GitHub ID", 39, False)
    if v and not GITHUB_RE.match(v):
        raise ValueError("GitHub ID may only contain letters, digits and single hyphens")
    return v


# Fields that must be present when a user is created.
REQUIRED_ON_CREATE = ("first_name", "last_name", "designation", "department", "email", "phone", "linkedin_url", "vpn_id")


def clean_profile(data: dict, creating: bool) -> dict:
    """Validate the profile fields present in `data`.

    On create every required field must be present. On update only the fields
    sent are checked, but a required field may not be blanked out. Returns the
    cleaned values keyed by their API names; the caller maps `designation` to
    the stored `title` column.
    """
    out: dict = {}
    errors: dict[str, str] = {}
    if creating:
        for k in REQUIRED_ON_CREATE:
            if not str(data.get(k) or "").strip():
                errors[k] = "This field is required"
    rules = {
        "first_name": lambda v: text(v, "First name", 80),
        "last_name": lambda v: text(v, "Last name", 80),
        "designation": lambda v: text(v, "Designation", 120),
        "department": lambda v: text(v, "Department", 120),
        "email": email,
        "phone": phone,
        "linkedin_url": linkedin_url,
        "vpn_id": vpn_id,
        "github_id": github_id,
        "website_url": website_url,
    }
    for k, fn in rules.items():
        if k not in data or k in errors:
            continue
        try:
            out[k] = fn(data[k])
        except ValueError as e:
            errors[k] = str(e)
    if errors:
        raise ProfileError(errors)
    return out


class ProfileError(ValueError):
    def __init__(self, errors: dict[str, str]):
        self.errors = errors
        super().__init__("; ".join(f"{k}: {v}" for k, v in errors.items()))
