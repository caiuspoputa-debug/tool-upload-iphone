"""Private hosting, Google OIDC, owner allowlist and same-account Drive backups."""
from datetime import timedelta
from functools import wraps
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import time
from urllib.parse import urlsplit

from authlib.integrations.base_client.errors import OAuthError
from authlib.integrations.flask_client import OAuth
from cryptography.fernet import InvalidToken
from flask import Flask, abort, g, jsonify, redirect, request, send_from_directory, session
from werkzeug.exceptions import HTTPException

from .drive import Drive, DriveError, SCOPE, MAX_BYTES
from .store import Store

WEB_ROOT = Path(__file__).resolve().parents[1] / "docs"
PUBLIC_PATHS = {"/login", "/privacy", "/auth/google", "/auth/google/callback", "/auth/google/drive-callback", "/healthz"}


def email_value(value):
    if not isinstance(value, str) or not re.fullmatch(r"[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}", value):
        raise ValueError("Adresă de e-mail invalidă.")
    return value.lower().strip()


def create_app(settings=None):
    app = Flask(__name__, static_folder=None)
    app.config.update(
        SECRET_KEY=os.environ.get("APP_SECRET", ""),
        GOOGLE_CLIENT_ID=os.environ.get("GOOGLE_CLIENT_ID", ""),
        GOOGLE_CLIENT_SECRET=os.environ.get("GOOGLE_CLIENT_SECRET", ""),
        PRIVATE_ORIGIN=os.environ.get("PRIVATE_ORIGIN", ""),
        ADMIN_EMAILS=os.environ.get("ADMIN_EMAILS", ""),
        DATA_DIRECTORY=os.environ.get("DATA_DIRECTORY", "/data"),
        SESSION_COOKIE_NAME="__Host-agenda-session",
        SESSION_COOKIE_SECURE=True,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_PATH="/",
        PERMANENT_SESSION_LIFETIME=timedelta(days=30),
        MAX_CONTENT_LENGTH=2 * MAX_BYTES + 1024 * 1024,
    )
    if settings:
        app.config.update(settings)
    origin = app.config["PRIVATE_ORIGIN"].rstrip("/")
    parsed = urlsplit(origin)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password) and not app.testing:
        raise ValueError("PRIVATE_ORIGIN trebuie să fie o origine HTTPS validă, fără cale.")
    if len(app.config["SECRET_KEY"]) < 32 or not app.config["GOOGLE_CLIENT_ID"] or not app.config["GOOGLE_CLIENT_SECRET"]:
        raise ValueError("Configurează APP_SECRET și credențialele OAuth Google pe server. Aplicația rămâne închisă fără ele.")
    admins = {email_value(value.strip()) for value in app.config["ADMIN_EMAILS"].split(",") if value.strip()}
    if not admins:
        raise ValueError("Configurează cel puțin o adresă ADMIN_EMAILS.")
    store = Store(app.config["DATA_DIRECTORY"], app.config["SECRET_KEY"], admins)
    oauth = OAuth(app)
    google = oauth.register("google", client_id=app.config["GOOGLE_CLIENT_ID"], client_secret=app.config["GOOGLE_CLIENT_SECRET"], server_metadata_url="https://accounts.google.com/.well-known/openid-configuration", client_kwargs={"scope": "openid email", "code_challenge_method": "S256", "timeout": 20})
    drive = Drive(store, app.config["GOOGLE_CLIENT_ID"], app.config["GOOGLE_CLIENT_SECRET"])
    app.extensions.update(agenda_store=store, agenda_google=google, agenda_drive=drive)

    @app.before_request
    def protect():
        if request.path in PUBLIC_PATHS:
            return None
        g.user = store.user_for_session(session.get("sid"))
        if not g.user:
            if request.path.startswith("/api/"):
                return jsonify(error="Autentifică-te cu un cont Google aprobat.", code="login_required"), 401
            return redirect("/login")
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            csrf = request.headers.get("X-CSRF-Token", "")
            if request.headers.get("Origin") != origin or not csrf or not hmac.compare_digest(csrf, session.get("csrf", "")):
                return jsonify(error="Cerere nevalidă. Reîncarcă aplicația.", code="csrf_failed"), 403
        return None

    @app.after_request
    def headers(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"
        if parsed.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        return response

    @app.errorhandler(Exception)
    def failure(error):
        if isinstance(error, DriveError):
            return jsonify(error=str(error), code=error.code), error.status
        if isinstance(error, HTTPException):
            return jsonify(error="Cererea nu poate fi procesată.", code="request_error"), error.code
        if isinstance(error, (OAuthError, InvalidToken, ValueError)):
            return jsonify(error="Autorizarea sau configurația nu este validă. Încearcă din nou ori contactează administratorul.", code="authorization_failed"), 400
        app.logger.error("Operație eșuată; detaliile sensibile nu sunt înregistrate.")
        return jsonify(error="Operația nu a reușit. Datele locale sunt păstrate.", code="server_error"), 500

    def admin_required(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if g.user["email"] not in admins:
                abort(403)
            return fn(*args, **kwargs)
        return wrapped

    @app.get("/healthz")
    def health():
        return jsonify(status="ok")

    @app.get("/privacy")
    def privacy():
        return '''<!doctype html><html lang="ro"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agenda Frizerie · Confidențialitate</title><body style="font:17px/1.6 system-ui;max-width:680px;margin:8vh auto;padding:24px"><h1>Date și confidențialitate</h1><p>Agenda păstrează local clienții, programările, rapoartele și setările. Autentificarea Google transmite serverului identitatea verificată și adresa de e-mail, folosite pentru lista de acces aprobată de administrator.</p><p>Google Drive este opțional. La autorizarea lui, aplicația cere acces doar la fișierele create sau deschise cu această aplicație. Backupul curent este transmis prin server către contul Google conectat. Serverul procesează temporar conținutul în memorie; nu păstrează baza de clienți într-o bază de date proprie.</p><p>Serverul păstrează lista de persoane autorizate, sesiunile și autorizația Google Drive criptată. Găzduirea și Google pot procesa metadatele conexiunii. Nu sunt incluse servicii de publicitate sau analitice.</p><p>Poți opri backupul din Setări, deconecta Drive și retrage permisiunea din contul Google. Fișierul existent din Drive nu este șters prin deconectare. Datele locale pot fi șterse din setările browserului; exportă o copie înainte. Pentru întrebări sau retragerea accesului, contactează persoana care ți-a acordat accesul.</p><p>O copie autorizată pentru offline poate funcționa maximum șapte zile de la ultima verificare online. Retragerea accesului se verifică la reconectare; nu șterge de la distanță baza locală.</p><a href="/login">Înapoi la autentificare</a></body></html>'''

    @app.get("/login")
    def login_page():
        return '''<!doctype html><html lang="ro"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agenda Frizerie · Acces privat</title><body style="font:17px/1.5 system-ui;max-width:480px;margin:12vh auto;padding:24px;background:#faf7f2;color:#252025"><h1>Agenda Frizerie</h1><p>Acces privat, doar pentru persoanele aprobate de administrator.</p><p><a href="/auth/google" style="display:block;padding:14px;background:#79536e;color:white;text-align:center;border-radius:10px">Continuă cu Google</a></p><p>Folosește propriul cont Google. Nu transmite parola administratorului. Conectarea la Google Drive pentru backup se face separat, din Setări.</p></body></html>'''

    @app.get("/auth/google")
    def google_login():
        return google.authorize_redirect(origin + "/auth/google/callback", nonce=secrets.token_urlsafe(32), prompt="select_account", max_age=0)

    def verified_identity(token):
        # Authlib validates issuer, audience, signature, state and nonce before
        # exposing userinfo from the ID token. Never trust browser-supplied email.
        info = token.get("userinfo")
        if not info or info.get("email_verified") is not True or not isinstance(info.get("sub"), str) or not 1 <= len(info["sub"]) <= 200:
            raise ValueError("Unverified Google identity")
        return email_value(info.get("email")), info["sub"]

    @app.get("/auth/google/callback")
    def google_callback():
        token = google.authorize_access_token()
        email, sub = verified_identity(token)
        if not store.bind_identity(email, sub):
            return "Contul Google nu este autorizat. Cere acces administratorului.", 403
        store.end_session(session.get("sid"))
        session.clear()
        session.permanent = True
        session["sid"] = store.start_session(email)
        session["csrf"] = secrets.token_urlsafe(32)
        return redirect("/")

    @app.get("/api/session")
    def current_session():
        return jsonify(user={**g.user, "isAdmin": g.user["email"] in admins}, csrf=session["csrf"], offlineLease=store.lease(g.user, origin))

    @app.get("/auth-key.js")
    def auth_key():
        return app.response_class("window.SalonAuthKey=" + json.dumps(store.public_jwk()) + ";", mimetype="text/javascript")

    @app.post("/api/logout")
    def logout():
        store.end_session(session.get("sid"))
        session.clear()
        return jsonify(ok=True)

    @app.get("/api/access")
    @admin_required
    def access_list():
        return jsonify(users=[{**user, "isAdmin": user["email"] in admins} for user in store.users()])

    @app.post("/api/access")
    @admin_required
    def access_change():
        data = request.get_json()
        email = email_value(data.get("email"))
        enabled = data.get("enabled")
        if type(enabled) is not bool or email in admins:
            abort(400)
        store.set_user(email, enabled)
        return jsonify(ok=True)

    @app.post("/api/drive/connect")
    def drive_connect():
        response = google.authorize_redirect(origin + "/auth/google/drive-callback", nonce=secrets.token_urlsafe(32), scope="openid email " + SCOPE, access_type="offline", prompt="consent", include_granted_scopes="true", login_hint=g.user["email"])
        return jsonify(url=response.location)

    @app.get("/auth/google/drive-callback")
    def drive_callback():
        user = store.user_for_session(session.get("sid"))
        if not user:
            return redirect("/login")
        token = google.authorize_access_token()
        email, sub = verified_identity(token)
        if email != user["email"] or sub != user["sub"] or SCOPE not in token.get("scope", "").split():
            return "Google Drive trebuie autorizat în același cont Google folosit la conectare.", 403
        previous = store.grant(email)
        refresh = token.get("refresh_token") or (previous["token"].get("refresh_token") if previous else None)
        if not refresh:
            return "Google nu a acordat acces pentru backup ulterior. Reconectează din Setări.", 400
        store.save_grant(email, {"access_token": token["access_token"], "refresh_token": refresh, "expires_at": token.get("expires_at", time.time() + token.get("expires_in", 3600))})
        return redirect("/?drive=connected")

    @app.get("/api/drive/status")
    def drive_status():
        return jsonify(drive.status(g.user["email"]))

    @app.post("/api/drive/disconnect")
    def drive_disconnect():
        # Removes the server's OAuth grant, never the user's existing Drive file.
        grant = store.grant(g.user["email"])
        revoked = False
        if grant:
            try:
                result = drive.http.post("https://oauth2.googleapis.com/revoke", data={"token": grant["token"].get("refresh_token") or grant["token"].get("access_token")}, timeout=15)
                revoked = result.status_code == 200
            except Exception:
                pass
        store.forget_grant(g.user["email"])
        return jsonify(ok=True, permissionRevoked=revoked)

    @app.post("/api/drive/backup")
    def drive_backup():
        data = request.get_json()
        return jsonify(drive.backup(g.user["email"], data.get("backupJson"), data.get("expectedMd5")))

    @app.post("/api/drive/restore")
    def drive_restore():
        return jsonify(drive.restore(g.user["email"]))

    @app.get("/")
    def index():
        return send_from_directory(WEB_ROOT, "index.html")

    @app.get("/<path:name>")
    def asset(name):
        if name.startswith(".") or ".." in name.split("/") or "\\" in name:
            abort(404)
        target = WEB_ROOT / name
        if target.suffix not in {".html", ".js", ".css", ".png", ".webmanifest"} or ("/" in name and not name.startswith("icons/")):
            abort(404)
        response = send_from_directory(WEB_ROOT, name)
        if name == "sw.js":
            response.headers["Service-Worker-Allowed"] = "/"
        if name.endswith(".js"):
            response.mimetype = "text/javascript"
        if name.endswith(".webmanifest"):
            response.mimetype = "application/manifest+json"
        return response

    return app
