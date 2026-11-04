"""In-process pub/sub feeding Server-Sent Events. Swap for Redis pub/sub when running >1 worker."""
import asyncio, json
_subs: set[asyncio.Queue] = set()
_loop: asyncio.AbstractEventLoop | None = None

def set_loop(loop): 
    global _loop; _loop = loop

def publish(kind: str, data: dict):
    msg = json.dumps({"type": kind, **data})
    def _put():
        for q in list(_subs):
            try: q.put_nowait(msg)
            except asyncio.QueueFull: pass
    if _loop and _loop.is_running():
        _loop.call_soon_threadsafe(_put)

async def stream():
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    _subs.add(q)
    try:
        yield "retry: 3000\n\n"
        while True:
            try:
                msg = await asyncio.wait_for(q.get(), timeout=15)
                yield f"data: {msg}\n\n"
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
    finally:
        _subs.discard(q)
