"""Environment for the API tests: a scratch SQLite database, migrated at startup.

This runs before any test module imports the app, so every module shares one
throwaway database and nothing touches a real one.
"""
import os, tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/t.db")
os.environ.setdefault("ALLOW_SIMULATED_GITHUB", "1")
os.environ["APEX_AUTO_MIGRATE"] = "1"  # scratch SQLite only
