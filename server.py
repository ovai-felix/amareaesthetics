#!/usr/bin/env python3
"""Amare Aesthetics local server.

Serves the website and a small JSON API for logins and bookings.
Standard library only, so there's nothing to install.

    python3 server.py               # http://localhost:8000
    python3 server.py --port 8080

Data lives in data/amare.db (SQLite). The first time the server starts with
an empty database it loads demo accounts from data/seed.json, creating that
file from data/seed.template.json (with random passwords) if it's missing.
"""
import argparse
import hashlib
import hmac
import json
import os
import posixpath
import re
import secrets
import sqlite3
import threading
import time
from datetime import date, datetime, timedelta
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
DB_PATH = os.path.join(DATA_DIR, "amare.db")
SEED_PATH = os.path.join(DATA_DIR, "seed.json")
SEED_TEMPLATE_PATH = os.path.join(DATA_DIR, "seed.template.json")
CONFIG_PATH = os.path.join(ROOT, "assets", "js", "booking-config.js")

SESSION_COOKIE = "amare_session"
SESSION_DAYS = 7
PBKDF2_ROUNDS = 310_000
MAX_BODY = 64 * 1024
ROLES = ("client", "provider", "admin")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^\d{2}:\d{2}$")

# Files and folders that must never be served as static content
BLOCKED_PREFIXES = ("/data", "/server.py", "/.omc")


# ---------------------------------------------------------------- config
_config_cache = {"mtime": None, "data": None}


def load_config():
    """Read the JSON object inside booking-config.js (reloaded when the file changes)."""
    mtime = os.path.getmtime(CONFIG_PATH)
    if _config_cache["mtime"] != mtime:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            text = f.read()
        assign = text.index("=", text.index("window.AMARE_BOOKING"))
        body = text[text.index("{", assign):text.rindex("}") + 1]
        lines = [ln for ln in body.splitlines() if not ln.strip().startswith("//")]
        _config_cache["data"] = json.loads("\n".join(lines))
        _config_cache["mtime"] = mtime
    return _config_cache["data"]


def by_id(items, item_id):
    return next((x for x in items if x["id"] == item_id), None)


def to_min(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


# ---------------------------------------------------------------- database
def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('client','provider','admin')),
  provider_id TEXT,
  pw_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  service_id TEXT NOT NULL,
  service TEXT NOT NULL,
  duration INTEGER NOT NULL,
  provider_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  first TEXT NOT NULL,
  last TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  phone TEXT NOT NULL,
  returning_client INTEGER NOT NULL DEFAULT 0,
  sms INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','completed','cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bookings_provider_date ON bookings(provider_id, date);
CREATE INDEX IF NOT EXISTS bookings_email ON bookings(email);
"""


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${salt.hex()}${digest.hex()}"


def check_password(password, stored):
    try:
        _, rounds, salt, digest = stored.split("$")
        test = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(test.hex(), digest)
    except (ValueError, TypeError):
        return False


# Used to spend the same time on unknown emails as on wrong passwords
_DUMMY_HASH = hash_password(secrets.token_hex(8))


def now_iso():
    return datetime.now().isoformat(timespec="seconds")


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    with db() as conn:
        conn.executescript(SCHEMA)
        empty = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
    if empty and not os.path.exists(SEED_PATH) and os.path.exists(SEED_TEMPLATE_PATH):
        write_seed_from_template()
    if empty and os.path.exists(SEED_PATH):
        seed()


def write_seed_from_template():
    """Create data/seed.json (git-ignored) with a fresh random password for each demo account."""
    with open(SEED_TEMPLATE_PATH, encoding="utf-8") as f:
        data = json.load(f)
    for u in data.get("users", []):
        u["password"] = f"Amare-{u['role']}-{secrets.token_hex(4)}"
    data["_readme"] = ("DEMO accounts for local testing only, generated from seed.template.json. "
                       "Delete data/amare.db (and this file for new passwords) to re-seed. Never use these on a live site.")
    with open(SEED_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"Created demo logins in {os.path.relpath(SEED_PATH, ROOT)} (passwords are in that file)")


def seed():
    with open(SEED_PATH, encoding="utf-8") as f:
        data = json.load(f)
    cfg = load_config()
    with db() as conn:
        for u in data.get("users", []):
            conn.execute(
                "INSERT OR IGNORE INTO users (email, name, phone, role, provider_id, pw_hash, created_at) VALUES (?,?,?,?,?,?,?)",
                (u["email"], u["name"], u.get("phone", ""), u["role"], u.get("provider_id"), hash_password(u["password"]), now_iso()),
            )
        # Sample appointments on upcoming days each provider actually works
        for b in data.get("sample_bookings", []):
            p = by_id(cfg["providers"], b["provider_id"])
            s = by_id(cfg["services"], b["service_id"])
            if not p or not s:
                continue
            d = date.today() + timedelta(days=b.get("days_from_today", 1))
            while (d.isoweekday() % 7) not in p["days"] or d.isoformat() in cfg["closedDates"]:
                d += timedelta(days=1)
            client = conn.execute("SELECT id, name, email, phone FROM users WHERE email = ?", (b["client_email"],)).fetchone()
            first, _, last = (client["name"] if client else b.get("name", "Sample Client")).partition(" ")
            conn.execute(
                """INSERT INTO bookings (id, user_id, service_id, service, duration, provider_id, provider, date, time,
                   first, last, email, phone, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (new_booking_id(), client["id"] if client else None, s["id"], s["name"], s["duration"], p["id"], p["name"],
                 d.isoformat(), b["time"], first, last or "-", b["client_email"], client["phone"] if client else "",
                 b.get("status", "booked"), now_iso(), now_iso()),
            )
    print(f"Seeded demo accounts from {os.path.relpath(SEED_PATH, ROOT)}")


def new_booking_id():
    return "AM-" + secrets.token_hex(4).upper()


# ---------------------------------------------------------------- login rate limiting
_failures = {}
_failures_lock = threading.Lock()
MAX_FAILURES, WINDOW = 5, 15 * 60


def too_many_failures(key):
    with _failures_lock:
        recent = [t for t in _failures.get(key, []) if time.time() - t < WINDOW]
        _failures[key] = recent
        return len(recent) >= MAX_FAILURES


def record_failure(key):
    with _failures_lock:
        _failures.setdefault(key, []).append(time.time())


def clear_failures(key):
    with _failures_lock:
        _failures.pop(key, None)


# ---------------------------------------------------------------- booking rules
class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def validate_slot(conn, cfg, service, provider, day, start, exclude_id=None):
    """Raise ApiError unless provider can take service at day/start."""
    if day in cfg["closedDates"]:
        raise ApiError(409, "The studio is closed that day.")
    d = date.fromisoformat(day)
    if (d.isoweekday() % 7) not in provider["days"]:
        raise ApiError(409, "That provider isn't working that day.")
    m, dur = to_min(start), service["duration"]
    if m < to_min(provider["start"]) or m + dur > to_min(provider["end"]) or (m - to_min(provider["start"])) % cfg["slotMinutes"]:
        raise ApiError(409, "That time is outside the provider's hours.")
    start_dt = datetime.combine(d, datetime.min.time()) + timedelta(minutes=m)
    if start_dt < datetime.now() + timedelta(hours=cfg["minNoticeHours"]):
        raise ApiError(409, "That time is too soon to book online. Please call us.")
    if d > date.today() + timedelta(days=cfg["daysAhead"]):
        raise ApiError(409, "That date is too far ahead to book.")
    rows = conn.execute(
        "SELECT id, time, duration FROM bookings WHERE provider_id = ? AND date = ? AND status != 'cancelled'",
        (provider["id"], day),
    ).fetchall()
    for r in rows:
        if r["id"] != exclude_id and m < to_min(r["time"]) + r["duration"] and to_min(r["time"]) < m + dur:
            raise ApiError(409, "Sorry, that time was just taken. Please choose another.")


def booking_json(r, role):
    out = {
        "id": r["id"], "serviceId": r["service_id"], "service": r["service"], "duration": r["duration"],
        "providerId": r["provider_id"], "provider": r["provider"], "date": r["date"], "time": r["time"],
        "status": r["status"], "createdAt": r["created_at"],
    }
    # Clients only ever see their own bookings; staff see client contact details.
    out["client"] = {"first": r["first"], "last": r["last"], "email": r["email"], "phone": r["phone"],
                     "returning": bool(r["returning_client"]), "sms": bool(r["sms"])}
    if role in ("provider", "admin"):
        out["client"]["notes"] = r["notes"]
    return out


def user_json(u):
    return {"id": u["id"], "email": u["email"], "name": u["name"], "phone": u["phone"], "role": u["role"],
            "providerId": u["provider_id"], "active": bool(u["active"]), "createdAt": u["created_at"]}


# ---------------------------------------------------------------- HTTP handler
class Handler(SimpleHTTPRequestHandler):
    server_version = "Amare/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # ----- static files
    def send_head(self):
        # Decode and normalize first so /%64ata or /x/../DATA can't slip past the checks
        # (macOS filenames are case-insensitive, hence lower()).
        path = posixpath.normpath(unquote(urlparse(self.path).path)).lower()
        if path.startswith(BLOCKED_PREFIXES) or any(seg.startswith(".") for seg in path.split("/") if seg) \
                or path.endswith((".py", ".db", ".sqlite", ".db-journal", ".db-wal")):
            self.send_error(HTTPStatus.NOT_FOUND)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        if urlparse(self.path).path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Keep the console quiet: log API calls and errors, not every image request.
        status = str(args[1]) if len(args) > 1 else ""
        if "/api/" in getattr(self, "path", "") or not status.isdigit() or int(status) >= 400:
            super().log_message(fmt, *args)

    # ----- routing
    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.api("GET")
        return super().do_GET()

    def do_HEAD(self):
        if self.path.startswith("/api/"):
            return self.json_response(405, {"error": "Method not allowed"})
        return super().do_HEAD()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self.api("POST")
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def api(self, method):
        url = urlparse(self.path)
        self.query = {k: v[0] for k, v in parse_qs(url.query).items()}
        routes = {
            ("GET", "/api/health"): self.health,
            ("GET", "/api/me"): self.me,
            ("POST", "/api/login"): self.login,
            ("POST", "/api/logout"): self.logout,
            ("POST", "/api/register"): self.register,
            ("POST", "/api/profile"): self.update_profile,
            ("POST", "/api/password"): self.change_password,
            ("GET", "/api/busy"): self.busy,
            ("GET", "/api/bookings"): self.list_bookings,
            ("POST", "/api/bookings"): self.create_booking,
            ("GET", "/api/users"): self.list_users,
            ("POST", "/api/users"): self.create_user,
            ("GET", "/api/stats"): self.stats,
        }
        handler = routes.get((method, url.path))
        params = {}
        if not handler:
            m = re.fullmatch(r"/api/bookings/(AM-[0-9A-F]{8})/(cancel|complete)", url.path)
            if m and method == "POST":
                handler, params = self.update_booking, {"booking_id": m.group(1), "action": m.group(2)}
            m = re.fullmatch(r"/api/users/(\d+)/(activate|deactivate|reset-password)", url.path)
            if m and method == "POST":
                handler, params = self.update_user, {"user_id": int(m.group(1)), "action": m.group(2)}
        if not handler:
            return self.json_response(404, {"error": "Not found"})
        try:
            if method == "POST":
                # JSON-only POSTs: browsers can't send these cross-site without CORS, which blocks CSRF.
                if "application/json" not in (self.headers.get("Content-Type") or ""):
                    raise ApiError(415, "Expected application/json")
                self.body = self.read_json()
            with db() as conn:
                self.conn = conn
                self.user = self.current_user()
                handler(**params)
        except ApiError as e:
            self.json_response(e.status, {"error": e.message})
        except Exception as e:  # pragma: no cover
            self.log_error("API error: %r", e)
            self.json_response(500, {"error": "Something went wrong. Please try again."})

    # ----- helpers
    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError(413, "Request too large")
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            raise ApiError(400, "Invalid JSON")
        if not isinstance(data, dict):
            raise ApiError(400, "Invalid JSON")
        return data

    def json_response(self, status, payload, cookie=None):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def field(self, name, max_len=200, required=True):
        v = self.body.get(name, "")
        v = v.strip() if isinstance(v, str) else ""
        if required and not v:
            raise ApiError(400, f"Missing {name}.")
        return v[:max_len]

    def session_token(self):
        cookie = SimpleCookie(self.headers.get("Cookie") or "")
        return cookie[SESSION_COOKIE].value if SESSION_COOKIE in cookie else None

    def current_user(self):
        token = self.session_token()
        if not token:
            return None
        row = self.conn.execute(
            """SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1""",
            (hashlib.sha256(token.encode()).hexdigest(), time.time()),
        ).fetchone()
        return row

    def require(self, *roles):
        if not self.user:
            raise ApiError(401, "Please sign in.")
        if roles and self.user["role"] not in roles:
            raise ApiError(403, "You don't have access to that.")
        return self.user

    def cookie_header(self, token, max_age):
        secure = "; Secure" if os.environ.get("AMARE_SECURE_COOKIES") == "1" else ""
        return f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}"

    def start_session(self, user_id):
        token = secrets.token_urlsafe(32)
        self.conn.execute("DELETE FROM sessions WHERE expires_at < ?", (time.time(),))
        self.conn.execute("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)",
                          (hashlib.sha256(token.encode()).hexdigest(), user_id, time.time() + SESSION_DAYS * 86400))
        return self.cookie_header(token, SESSION_DAYS * 86400)

    # ----- endpoints: auth
    def health(self):
        self.json_response(200, {"ok": True})

    def me(self):
        self.json_response(200, {"user": user_json(self.user) if self.user else None})

    def login(self):
        email = self.field("email").lower()
        password = self.body.get("password") or ""
        portal = self.body.get("portal", "client")
        key = f"{email}|{self.client_address[0]}"
        if too_many_failures(key):
            raise ApiError(429, "Too many attempts. Please wait 15 minutes and try again.")
        u = self.conn.execute("SELECT * FROM users WHERE email = ? AND active = 1", (email,)).fetchone()
        ok = check_password(password, u["pw_hash"] if u else _DUMMY_HASH) and u is not None
        if not ok:
            record_failure(key)
            raise ApiError(401, "Incorrect email or password.")
        # Each login page is for its own persona.
        if portal == "client" and u["role"] != "client":
            raise ApiError(403, "This is a staff account. Please use Provider & Staff Login.")
        if portal == "staff" and u["role"] == "client":
            raise ApiError(403, "This is a client account. Please use the client Login page.")
        clear_failures(key)
        cookie = self.start_session(u["id"])
        self.json_response(200, {"user": user_json(u)}, cookie)

    def logout(self):
        token = self.session_token()
        if token:
            self.conn.execute("DELETE FROM sessions WHERE token_hash = ?", (hashlib.sha256(token.encode()).hexdigest(),))
        self.json_response(200, {"ok": True}, self.cookie_header("", 0))

    def register(self):
        name = self.field("name", 120)
        email = self.field("email", 200).lower()
        phone = self.field("phone", 40, required=False)
        password = self.body.get("password") or ""
        if not EMAIL_RE.match(email):
            raise ApiError(400, "Please enter a valid email.")
        if len(password) < 8:
            raise ApiError(400, "Password must be at least 8 characters.")
        if self.conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
            raise ApiError(409, "An account with that email already exists. Try signing in.")
        cur = self.conn.execute(
            "INSERT INTO users (email, name, phone, role, pw_hash, created_at) VALUES (?,?,?,?,?,?)",
            (email, name, phone, "client", hash_password(password), now_iso()),
        )
        u = self.conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
        cookie = self.start_session(u["id"])
        self.json_response(201, {"user": user_json(u)}, cookie)

    def update_profile(self):
        u = self.require()
        name = self.field("name", 120)
        phone = self.field("phone", 40, required=False)
        self.conn.execute("UPDATE users SET name = ?, phone = ? WHERE id = ?", (name, phone, u["id"]))
        u = self.conn.execute("SELECT * FROM users WHERE id = ?", (u["id"],)).fetchone()
        self.json_response(200, {"user": user_json(u)})

    def change_password(self):
        u = self.require()
        if not check_password(self.body.get("current") or "", u["pw_hash"]):
            raise ApiError(400, "Your current password is incorrect.")
        new = self.body.get("new") or ""
        if len(new) < 8:
            raise ApiError(400, "New password must be at least 8 characters.")
        self.conn.execute("UPDATE users SET pw_hash = ? WHERE id = ?", (hash_password(new), u["id"]))
        # Sign out other sessions
        token_hash = hashlib.sha256((self.session_token() or "").encode()).hexdigest()
        self.conn.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", (u["id"], token_hash))
        self.json_response(200, {"ok": True})

    # ----- endpoints: bookings
    def busy(self):
        """Booked time ranges (no client details) so the booking page can hide taken slots."""
        start, end = self.query.get("from", ""), self.query.get("to", "")
        if not (DATE_RE.match(start) and DATE_RE.match(end)):
            raise ApiError(400, "from and to dates are required.")
        rows = self.conn.execute(
            "SELECT provider_id, date, time, duration FROM bookings WHERE date BETWEEN ? AND ? AND status != 'cancelled'",
            (start, end),
        ).fetchall()
        self.json_response(200, {"busy": [{"providerId": r["provider_id"], "date": r["date"], "time": r["time"],
                                            "duration": r["duration"]} for r in rows]})

    def create_booking(self):
        cfg = load_config()
        service = by_id(cfg["services"], self.body.get("serviceId"))
        provider = by_id(cfg["providers"], self.body.get("providerId"))
        day, start = self.body.get("date", ""), self.body.get("time", "")
        if not service or not provider or not DATE_RE.match(day) or not TIME_RE.match(start):
            raise ApiError(400, "Please choose a service, provider, date and time.")
        if "*" not in provider["services"] and service["id"] not in provider["services"]:
            raise ApiError(400, "That provider doesn't offer this service.")
        client = self.body.get("client") or {}
        if not isinstance(client, dict):
            raise ApiError(400, "Invalid client details.")
        first, last = str(client.get("first", "")).strip()[:80], str(client.get("last", "")).strip()[:80]
        email, phone = str(client.get("email", "")).strip().lower()[:200], str(client.get("phone", "")).strip()[:40]
        if not first or not last or not EMAIL_RE.match(email) or len(re.sub(r"\D", "", phone)) < 10:
            raise ApiError(400, "Please complete your name, email and phone.")
        if not client.get("policy"):
            raise ApiError(400, "Please agree to the cancellation policy.")
        user_id = self.user["id"] if self.user and self.user["role"] == "client" else None
        # Lock the database for the check-then-insert so two people can't take the same slot.
        self.conn.execute("BEGIN IMMEDIATE")
        validate_slot(self.conn, cfg, service, provider, day, start)
        bid = new_booking_id()
        self.conn.execute(
            """INSERT INTO bookings (id, user_id, service_id, service, duration, provider_id, provider, date, time,
               first, last, email, phone, returning_client, sms, notes, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (bid, user_id, service["id"], service["name"], service["duration"], provider["id"], provider["name"], day, start,
             first, last, email, phone, 1 if client.get("returning") == "yes" else 0, 1 if client.get("sms") else 0,
             str(client.get("notes", "")).strip()[:1000], now_iso(), now_iso()),
        )
        row = self.conn.execute("SELECT * FROM bookings WHERE id = ?", (bid,)).fetchone()
        self.json_response(201, {"booking": booking_json(row, "client")})

    def list_bookings(self):
        u = self.require()
        sql, args = "SELECT * FROM bookings WHERE 1=1", []
        if u["role"] == "client":
            sql += " AND (user_id = ? OR email = ?)"
            args += [u["id"], u["email"]]
        elif u["role"] == "provider":
            sql += " AND provider_id = ?"
            args.append(u["provider_id"] or "")
        elif self.query.get("provider"):
            sql += " AND provider_id = ?"
            args.append(self.query["provider"])
        for key, op in (("from", ">="), ("to", "<=")):
            if DATE_RE.match(self.query.get(key, "")):
                sql += f" AND date {op} ?"
                args.append(self.query[key])
        if self.query.get("status") in ("booked", "completed", "cancelled"):
            sql += " AND status = ?"
            args.append(self.query["status"])
        q = self.query.get("q", "").strip()
        if q and u["role"] != "client":
            sql += " AND (first || ' ' || last LIKE ? OR email LIKE ? OR phone LIKE ? OR id LIKE ?)"
            args += [f"%{q}%"] * 4
        sql += " ORDER BY date, time LIMIT 500"
        rows = self.conn.execute(sql, args).fetchall()
        self.json_response(200, {"bookings": [booking_json(r, u["role"]) for r in rows]})

    def update_booking(self, booking_id, action):
        u = self.require()
        b = self.conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,)).fetchone()
        allowed = b and (
            u["role"] == "admin"
            or (u["role"] == "provider" and b["provider_id"] == u["provider_id"])
            or (u["role"] == "client" and action == "cancel" and (b["user_id"] == u["id"] or b["email"].lower() == u["email"].lower()))
        )
        if not allowed:
            raise ApiError(404, "Booking not found.")
        if b["status"] != "booked":
            raise ApiError(409, f"This appointment is already {b['status']}.")
        if u["role"] == "client":
            cutoff = load_config().get("cancelCutoffHours", 24)
            start = datetime.fromisoformat(f"{b['date']}T{b['time']}")
            if start - datetime.now() < timedelta(hours=cutoff):
                raise ApiError(409, f"Appointments within {cutoff} hours can't be cancelled online. Please call us.")
        status = "cancelled" if action == "cancel" else "completed"
        self.conn.execute("UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?", (status, now_iso(), booking_id))
        row = self.conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,)).fetchone()
        self.json_response(200, {"booking": booking_json(row, u["role"])})

    # ----- endpoints: admin
    def stats(self):
        self.require("admin")
        today = date.today().isoformat()
        week = (date.today() + timedelta(days=7)).isoformat()
        one = lambda sql, *a: self.conn.execute(sql, a).fetchone()[0]
        self.json_response(200, {
            "today": one("SELECT COUNT(*) FROM bookings WHERE date = ? AND status != 'cancelled'", today),
            "next7": one("SELECT COUNT(*) FROM bookings WHERE date BETWEEN ? AND ? AND status = 'booked'", today, week),
            "clients": one("SELECT COUNT(*) FROM users WHERE role = 'client'"),
            "cancelled30": one("SELECT COUNT(*) FROM bookings WHERE status = 'cancelled' AND updated_at >= ?",
                               (datetime.now() - timedelta(days=30)).isoformat()),
        })

    def list_users(self):
        self.require("admin")
        role = self.query.get("role")
        sql, args = "SELECT * FROM users", []
        if role in ROLES:
            sql += " WHERE role = ?"
            args.append(role)
        rows = self.conn.execute(sql + " ORDER BY role, name", args).fetchall()
        self.json_response(200, {"users": [user_json(r) for r in rows]})

    def create_user(self):
        self.require("admin")
        name = self.field("name", 120)
        email = self.field("email", 200).lower()
        role = self.body.get("role")
        provider_id = self.body.get("providerId") or None
        password = self.body.get("password") or ""
        if role not in ROLES:
            raise ApiError(400, "Choose a role.")
        if not EMAIL_RE.match(email):
            raise ApiError(400, "Please enter a valid email.")
        if len(password) < 8:
            raise ApiError(400, "Temporary password must be at least 8 characters.")
        if role == "provider" and not by_id(load_config()["providers"], provider_id or ""):
            raise ApiError(400, "Link the provider account to a provider in booking-config.js.")
        if role != "provider":
            provider_id = None
        if self.conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
            raise ApiError(409, "A user with that email already exists.")
        cur = self.conn.execute(
            "INSERT INTO users (email, name, phone, role, provider_id, pw_hash, created_at) VALUES (?,?,?,?,?,?,?)",
            (email, name, self.field("phone", 40, required=False), role, provider_id, hash_password(password), now_iso()),
        )
        u = self.conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
        self.json_response(201, {"user": user_json(u)})

    def update_user(self, user_id, action):
        admin = self.require("admin")
        target = self.conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not target:
            raise ApiError(404, "User not found.")
        if target["id"] == admin["id"] and action == "deactivate":
            raise ApiError(400, "You can't deactivate your own account.")
        if action == "reset-password":
            password = self.body.get("password") or ""
            if len(password) < 8:
                raise ApiError(400, "Temporary password must be at least 8 characters.")
            self.conn.execute("UPDATE users SET pw_hash = ? WHERE id = ?", (hash_password(password), user_id))
            self.conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        else:
            self.conn.execute("UPDATE users SET active = ? WHERE id = ?", (1 if action == "activate" else 0, user_id))
            if action == "deactivate":
                self.conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        u = self.conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        self.json_response(200, {"user": user_json(u)})


def main():
    ap = argparse.ArgumentParser(description="Amare Aesthetics local server")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to allow other devices on your network")
    args = ap.parse_args()
    load_config()  # fail fast if booking-config.js isn't valid JSON
    init_db()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Amare Aesthetics running at http://localhost:{args.port}  (Ctrl+C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
