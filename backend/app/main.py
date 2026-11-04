import asyncio, os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from .db import Base, engine, SessionLocal
from .api import router
from .config import STATIC_DIR, DESIGNS_DIR
from .events import set_loop
from .seed import seed

@asynccontextmanager
async def lifespan(app):
    set_loop(asyncio.get_running_loop())
    Base.metadata.create_all(engine)
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
