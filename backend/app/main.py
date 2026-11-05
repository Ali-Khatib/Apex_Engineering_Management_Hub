import asyncio, os
from contextlib import asynccontextmanager
from pathlib import Path
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from .db import SessionLocal
from .api import router
from .config import STATIC_DIR, DESIGNS_DIR, IS_PRODUCTION
from .events import set_loop
from .seed import seed

@asynccontextmanager
async def lifespan(app):
    set_loop(asyncio.get_running_loop())
    # Migrations run on startup everywhere except production. A production
    # database is only migrated on purpose: either run `alembic upgrade head`
    # by hand after a verified backup, or set APEX_AUTO_MIGRATE=1 for that
    # deploy. Otherwise a routine restart could change a live schema.
    if not IS_PRODUCTION or os.getenv("APEX_AUTO_MIGRATE") == "1":
        backend_dir = Path(__file__).resolve().parents[1]
        alembic_config = Config(str(backend_dir / "alembic.ini"))
        alembic_config.set_main_option("script_location", str(backend_dir / "alembic"))
        command.upgrade(alembic_config, "head")
    with SessionLocal() as db: seed(db)
    yield

app = FastAPI(title="Apex Engineering Management Platform", version="0.1-mvp", lifespan=lifespan)
app.include_router(router)

@app.get("/api/health")
def health(): return {"ok": True}

_dist = os.path.join(STATIC_DIR, "app")
app.mount("/diagrams", StaticFiles(directory=DESIGNS_DIR, check_dir=False), name="diagrams")
if os.path.isdir(_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(_dist, "assets")), name="assets")
    @app.get("/{path:path}")
    def spa(path: str):
        f = os.path.join(_dist, path)
        return FileResponse(f if path and os.path.isfile(f) else os.path.join(_dist, "index.html"))
