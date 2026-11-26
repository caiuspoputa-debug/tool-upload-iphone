"""Identity, sessions and encrypted OAuth grants; never the client database."""
import base64
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import secrets
import sqlite3
import time

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa


class Store:
    def __init__(self, directory, secret, admins):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / "accounts.sqlite3"
        self.cipher = Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))
        with self.db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS users(email TEXT PRIMARY KEY, sub TEXT UNIQUE, enabled INTEGER NOT NULL DEFAULT 1);
                CREATE TABLE IF NOT EXISTS sessions(sid TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS drive(email TEXT PRIMARY KEY, grant TEXT NOT NULL, busy_until INTEGER DEFAULT 0,
                    last_backup TEXT, file_id TEXT, local_hash TEXT);
            """)
            for email in admins:
                db.execute("INSERT INTO users(email) VALUES(?) ON CONFLICT(email) DO UPDATE SET enabled=1", (email,))
        key_path = self.directory / "offline-signing.pem"
        if not key_path.exists():
            key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            # Create exclusively so an existing signing key is never replaced.
            try:
                with key_path.open("xb") as handle:
                    handle.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
            except FileExistsError:
                pass
        self.signing_key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
        try:
            key_path.chmod(0o600)
            self.path.chmod(0o600)
        except OSError:
            pass

    @contextmanager
    def db(self):
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def allowed(self, email):
        with self.db() as db:
            row = db.execute("SELECT * FROM users WHERE email=? AND enabled=1", (email,)).fetchone()
            return dict(row) if row else None

    def bind_identity(self, email, sub):
        with self.db() as db:
            row = db.execute("SELECT sub FROM users WHERE email=? AND enabled=1", (email,)).fetchone()
            if not row or row["sub"] not in (None, sub):
                return False
            try:
                db.execute("UPDATE users SET sub=? WHERE email=?", (sub, email))
                return True
            except sqlite3.IntegrityError:
                return False

    def start_session(self, email):
        sid = secrets.token_urlsafe(32)
        with self.db() as db:
            db.execute("DELETE FROM sessions WHERE expires<?", (int(time.time()),))
            db.execute("INSERT INTO sessions VALUES(?,?,?)", (hashlib.sha256(sid.encode()).hexdigest(), email, int(time.time()) + 30 * 86400))
        return sid

    def user_for_session(self, sid):
        if not isinstance(sid, str):
            return None
        with self.db() as db:
            row = db.execute("SELECT u.email,u.sub FROM sessions s JOIN users u ON u.email=s.email WHERE s.sid=? AND s.expires>? AND u.enabled=1", (hashlib.sha256(sid.encode()).hexdigest(), int(time.time()))).fetchone()
            return dict(row) if row else None

    def end_session(self, sid):
        if sid:
            with self.db() as db:
                db.execute("DELETE FROM sessions WHERE sid=?", (hashlib.sha256(sid.encode()).hexdigest(),))

    def set_user(self, email, enabled):
        with self.db() as db:
            db.execute("INSERT INTO users(email,enabled) VALUES(?,?) ON CONFLICT(email) DO UPDATE SET enabled=excluded.enabled", (email, int(enabled)))
            if not enabled:
                db.execute("DELETE FROM sessions WHERE email=?", (email,))

    def users(self):
        with self.db() as db:
            return [dict(row) for row in db.execute("SELECT email,enabled FROM users ORDER BY email")]

    def grant(self, email):
        with self.db() as db:
            row = db.execute("SELECT * FROM drive WHERE email=?", (email,)).fetchone()
        if not row:
            return None
        result = dict(row)
        try:
            result["token"] = json.loads(self.cipher.decrypt(result.pop("grant").encode()))
        except (InvalidToken, ValueError):
            # A rotated server secret requires a new explicit Google grant.
            # Keep the old encrypted row intact until that grant is supplied.
            return None
        return result

    def save_grant(self, email, token):
        encrypted = self.cipher.encrypt(json.dumps(token).encode()).decode()
        with self.db() as db:
            db.execute("INSERT INTO drive(email,grant) VALUES(?,?) ON CONFLICT(email) DO UPDATE SET grant=excluded.grant", (email, encrypted))

    def forget_grant(self, email):
        with self.db() as db:
            db.execute("DELETE FROM drive WHERE email=?", (email,))

    def acquire_drive(self, email):
        now = int(time.time())
        with self.db() as db:
            return db.execute("UPDATE drive SET busy_until=? WHERE email=? AND busy_until<?", (now + 300, email, now)).rowcount == 1

    def release_drive(self, email):
        with self.db() as db:
            db.execute("UPDATE drive SET busy_until=0 WHERE email=?", (email,))

    def record_backup(self, email, file_id, at, local_hash):
        with self.db() as db:
            db.execute("UPDATE drive SET file_id=?,last_backup=?,local_hash=? WHERE email=?", (file_id, at, local_hash, email))

    @staticmethod
    def b64(data):
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    def public_jwk(self):
        key = self.signing_key.public_key().public_numbers()
        enc = lambda n: self.b64(n.to_bytes((n.bit_length() + 7) // 8, "big"))
        return {"kty": "RSA", "n": enc(key.n), "e": enc(key.e), "alg": "RS256", "ext": True}

    def lease(self, user, origin, days=7):
        payload = {"sub": user["sub"], "email": user["email"], "aud": origin, "iat": int(time.time()), "exp": int(time.time()) + days * 86400}
        prefix = self.b64(b'{"alg":"RS256","typ":"JWT"}') + "." + self.b64(json.dumps(payload, separators=(",", ":")).encode())
        signature = self.signing_key.sign(prefix.encode(), padding.PKCS1v15(), hashes.SHA256())
        return prefix + "." + self.b64(signature)
