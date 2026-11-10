import hashlib, hmac, os, time
import jwt
from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session
from .config import JWT_SECRET
from .db import get_db
from .models import User

def hash_password(pw: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 120_000)
    return salt.hex() + "$" + dk.hex()

def verify_password(pw: str, stored: str) -> bool:
    salt_hex, dk_hex = stored.split("$")
    return hmac.compare_digest(hash_password(pw, bytes.fromhex(salt_hex)).split("$")[1], dk_hex)

def make_token(user: User, ttl=60 * 60 * 12) -> str:
    return jwt.encode({"sub": str(user.id), "role": user.role, "exp": int(time.time()) + ttl}, JWT_SECRET, algorithm="HS256")

def _user_from_token(token: str, db: Session) -> User:
    try:
        data = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")
    u = db.get(User, int(data["sub"]))
    if not u:
        raise HTTPException(401, "Unknown user")
    if not u.is_active:
        raise HTTPException(401, "Account is deactivated")
    return u

def current_user(authorization: str = Header(default=""), db: Session = Depends(get_db)) -> User:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    return _user_from_token(authorization[7:], db)

def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Admin role required")
    return user
