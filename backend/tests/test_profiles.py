import pytest
from app import profiles as p

GOOD = dict(first_name="Layla", last_name="Haddad", designation="Engineer", department="Platform",
            email="Layla.Haddad@Example.com", phone="+962 79 123 4567", linkedin_url="https://www.linkedin.com/in/layla",
            vpn_id="lhaddad.vpn")

def test_valid_profile_is_cleaned():
    out = p.clean_profile({**GOOD, "github_id": "layla-h", "website_url": "https://layla.dev"}, True)
    assert out["email"] == "layla.haddad@example.com"
    assert out["github_id"] == "layla-h"

@pytest.mark.parametrize("field", p.REQUIRED_ON_CREATE)
def test_every_required_field_is_required_on_create(field):
    d = {k: v for k, v in GOOD.items() if k != field}
    with pytest.raises(p.ProfileError) as e:
        p.clean_profile(d, True)
    assert field in e.value.errors

def test_optional_fields_may_be_absent():
    assert "github_id" not in p.clean_profile(GOOD, True)

@pytest.mark.parametrize("field,value", [
    ("email", "not-an-email"), ("email", "a@b"), ("phone", "12"), ("phone", "abc defg hij"),
    ("linkedin_url", "http://linkedin.com/in/x"), ("linkedin_url", "https://evil.example/in/x"),
    ("linkedin_url", "https://notlinkedin.com/in/x"), ("linkedin_url", "javascript:alert(1)"),
    ("linkedin_url", "https://user:pw@linkedin.com/in/x"), ("vpn_id", "a b"), ("vpn_id", "x"),
    ("github_id", "-bad"), ("github_id", "has space"), ("website_url", "ftp://x.com"), ("website_url", "https://nodot"),
])
def test_invalid_values_are_rejected(field, value):
    with pytest.raises(p.ProfileError) as e:
        p.clean_profile({**GOOD, field: value}, True)
    assert field in e.value.errors

def test_update_checks_only_what_is_sent_but_cannot_blank_required_fields():
    assert p.clean_profile({"department": "QA"}, False) == {"department": "QA"}
    with pytest.raises(p.ProfileError):
        p.clean_profile({"department": "  "}, False)

def test_subdomain_of_linkedin_is_accepted():
    assert p.linkedin_url("https://ae.linkedin.com/in/x")
