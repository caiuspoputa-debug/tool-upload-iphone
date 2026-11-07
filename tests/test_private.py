import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import requests

from server.app import create_app
from server.drive import Drive, DriveError, checked_backup, SCOPE
from server.business_validation import default_workspace

ORIGIN = "https://agenda.example.test"
ADMIN = "owner@example.test"
USER = "barber@example.test"


def agenda(name="Client test"):
    return {"version": 1, "demo": False, "settings": {"slotMinutes": 60, "theme": "light", "bookingEndIsLastStart": True, "schedulePolicy": "daily-10-18-v1", "workspace": default_workspace(), "schedule": [{"day": n, "closed": False, "start": "10:00", "end": "18:00", "breakStart": "", "breakEnd": ""} for n in range(7)], "overrides": []}, "clients": [{"id": "c1", "name": name, "phone": "+40722123456", "notes": "", "archived": False}], "services": [], "appointments": []}


class Response:
    def __init__(self, value=None, status=200, headers=None, content=None):
        self.value, self.status_code, self.headers = value or {}, status, headers or {}
        self.content = content

    def json(self):
        return self.value

    def iter_content(self, _size):
        yield self.content

    def close(self):
        pass


class FakeDriveHTTP:
    def __init__(self):
        self.files, self.calls, self.pending = {}, [], {}
        self.fail_upload, self.lost_ack, self.bad_refresh = False, False, False

    def metadata(self, key):
        data = self.files.get(key)
        return {"id": "file_1", "md5Checksum": hashlib.md5(data, usedforsecurity=False).hexdigest(), "size": str(len(data)), "modifiedTime": "2026-10-31T12:00:00Z"} if data else None

    def post(self, _url, **_kwargs):
        return Response({"access_token": "renewed", "expires_in": 3600}, status=400 if self.bad_refresh else 200)

    def request(self, method, url, headers, **kwargs):
        key = headers["Authorization"]
        self.calls.append((method, url, key))
        if method == "GET" and url.endswith("/files"):
            meta = self.metadata(key)
            return Response({"files": [meta] if meta else []})
        if method == "GET" and url.endswith("/file_1"):
            return Response(content=self.files[key])
        if method in ("POST", "PATCH") and "/upload/drive/v3/files" in url:
            self.pending[key] = True
            return Response(headers={"Location": "https://www.googleapis.com/upload/drive/v3/files?upload_id=fake"})
        if method == "PUT":
            if self.fail_upload:
                raise requests.ConnectionError()
            self.files[key] = kwargs["data"]
            if self.lost_ack:
                raise requests.ConnectionError()
            return Response(self.metadata(key))
        raise AssertionError((method, url))


class PrivateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app({"TESTING": True, "SECRET_KEY": "unit-test-secret-only-" * 3, "GOOGLE_CLIENT_ID": "test-client", "GOOGLE_CLIENT_SECRET": "test-secret", "PRIVATE_ORIGIN": ORIGIN, "ADMIN_EMAILS": ADMIN, "DATA_DIRECTORY": self.temp.name})
        self.client = self.app.test_client()
        self.store = self.app.extensions["agenda_store"]
        self.google = self.app.extensions["agenda_google"]

    def tearDown(self):
        self.temp.cleanup()

    def login(self, email=ADMIN, verified=True, sub=None):
        token = {"userinfo": {"email": email, "email_verified": verified, "sub": sub or email.replace("@", "_")}}
        with patch.object(self.google, "authorize_access_token", return_value=token):
            return self.client.get("/auth/google/callback", base_url=ORIGIN)

    def csrf(self):
        return self.client.get("/api/session", base_url=ORIGIN).json["csrf"]

    def post(self, path, value, csrf=True, origin=ORIGIN):
        headers = {"Origin": origin}
        if csrf:
            headers["X-CSRF-Token"] = self.csrf()
        return self.client.post(path, json=value, headers=headers, base_url=ORIGIN)

    def test_unapproved_or_unverified_identity_never_receives_private_assets(self):
        self.assertEqual(self.login(USER).status_code, 403)
        self.assertEqual(self.login(ADMIN, False).status_code, 400)
        for path in ["/", "/app.js", "/sw.js", "/auth-key.js", "/manifest.webmanifest", "/icons/icon-192.png"]:
            response = self.client.get(path, base_url=ORIGIN)
            self.assertEqual(response.status_code, 302, path)
            self.assertEqual(response.location, "/login")
        self.assertEqual(self.client.get("/api/session", base_url=ORIGIN).status_code, 401)

    def test_google_callback_without_valid_state_fails_closed(self):
        response = self.client.get("/auth/google/callback?code=not-real", base_url=ORIGIN)
        self.assertEqual(response.status_code, 400)
        self.assertIsNone(self.store.user_for_session("not-real"))

    def test_google_authorization_uses_state_nonce_and_pkce(self):
        from urllib.parse import urlsplit, parse_qs
        metadata = {"authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth", "token_endpoint": "https://oauth2.googleapis.com/token", "issuer": "https://accounts.google.com"}
        with patch.object(self.google, "load_server_metadata", return_value=metadata):
            response = self.client.get("/auth/google", base_url=ORIGIN)
        self.assertEqual(response.status_code, 302)
        parsed = urlsplit(response.location)
        self.assertEqual(parsed.netloc, "accounts.google.com")
        values = parse_qs(parsed.query)
        self.assertTrue(values.get("state"))
        self.assertTrue(values.get("nonce"))
        self.assertTrue(values.get("code_challenge"))
        self.assertEqual(values.get("code_challenge_method"), ["S256"])

    def test_approved_login_cookie_and_offline_signature(self):
        response = self.login()
        self.assertEqual(response.status_code, 302)
        cookie = response.headers["Set-Cookie"]
        for flag in ["Secure", "HttpOnly", "SameSite=Lax", "Path=/"]:
            self.assertIn(flag, cookie)
        value = self.client.get("/api/session", base_url=ORIGIN).json
        self.assertTrue(value["user"]["isAdmin"])
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding
        import base64
        parts = value["offlineLease"].split(".")
        decode = lambda text: base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
        self.store.signing_key.public_key().verify(decode(parts[2]), (parts[0] + "." + parts[1]).encode(), padding.PKCS1v15(), hashes.SHA256())
        payload = json.loads(decode(parts[1]))
        self.assertEqual(payload["aud"], ORIGIN)
        self.assertEqual(payload["exp"] - payload["iat"], 7 * 86400)
        with self.client.get("/app.js", base_url=ORIGIN) as response:
            self.assertEqual(response.status_code, 200)

    def test_access_management_requires_admin_and_csrf(self):
        self.login()
        self.assertEqual(self.post("/api/access", {"email": USER, "enabled": True}, csrf=False).status_code, 403)
        self.assertEqual(self.post("/api/access", {"email": USER, "enabled": True}, origin="https://evil.test").status_code, 403)
        self.assertEqual(self.post("/api/access", {"email": USER, "enabled": True}).status_code, 200)
        self.assertEqual(self.post("/api/access", {"email": ADMIN, "enabled": False}).status_code, 400)
        self.login(USER)
        self.assertEqual(self.client.get("/api/access", base_url=ORIGIN).status_code, 403)
        self.assertEqual(self.post("/api/access", {"email": "other@example.test", "enabled": True}).status_code, 403)

    def test_revoke_invalidates_sessions_without_deleting_local_data(self):
        self.store.set_user(USER, True)
        self.login(USER)
        self.assertEqual(self.client.get("/api/session", base_url=ORIGIN).status_code, 200)
        self.store.set_user(USER, False)
        self.assertEqual(self.client.get("/api/session", base_url=ORIGIN).status_code, 401)
        self.assertEqual(self.client.get("/app.js", base_url=ORIGIN).status_code, 302)

    def test_google_subject_cannot_be_rebound_silently(self):
        self.login(sub="first-subject")
        self.assertEqual(self.login(sub="different-subject").status_code, 403)

    def test_drive_callback_rejects_other_account_and_missing_scope(self):
        self.login()
        for token in [{"userinfo": {"email": USER, "email_verified": True, "sub": "wrong"}, "scope": SCOPE}, {"userinfo": {"email": ADMIN, "email_verified": True, "sub": ADMIN.replace("@", "_")}, "scope": "openid email"}]:
            with patch.object(self.google, "authorize_access_token", return_value=token):
                self.assertEqual(self.client.get("/auth/google/drive-callback", base_url=ORIGIN).status_code, 403)
            self.assertIsNone(self.store.grant(ADMIN))

    def test_drive_grant_is_encrypted_and_never_sent_to_browser(self):
        self.login()
        token = {"userinfo": {"email": ADMIN, "email_verified": True, "sub": ADMIN.replace("@", "_")}, "scope": "openid email " + SCOPE, "access_token": "PRIVATE-ACCESS-VALUE", "refresh_token": "PRIVATE-REFRESH-VALUE", "expires_at": time.time() + 3600}
        with patch.object(self.google, "authorize_access_token", return_value=token):
            self.assertEqual(self.client.get("/auth/google/drive-callback", base_url=ORIGIN).status_code, 302)
        self.assertEqual(self.store.grant(ADMIN)["token"]["refresh_token"], token["refresh_token"])
        self.assertNotIn(token["refresh_token"].encode(), self.store.path.read_bytes())
        self.assertNotIn(token["access_token"].encode(), self.client.get("/api/session", base_url=ORIGIN).data)

    def test_rotated_secret_allows_explicit_reconnect_without_silent_reset(self):
        from server.store import Store
        self.store.save_grant(ADMIN, {"access_token": "old-access", "refresh_token": "old-refresh", "expires_at": 0})
        with self.store.db() as db:
            before = db.execute("SELECT grant FROM drive WHERE email=?", (ADMIN,)).fetchone()[0]
        rotated = Store(self.temp.name, "different-private-server-secret-" * 3, {ADMIN})
        self.assertIsNone(rotated.grant(ADMIN))
        with rotated.db() as db:
            self.assertEqual(db.execute("SELECT grant FROM drive WHERE email=?", (ADMIN,)).fetchone()[0], before)
        rotated.save_grant(ADMIN, {"access_token": "new-access", "refresh_token": "new-refresh", "expires_at": 0})
        self.assertEqual(rotated.grant(ADMIN)["token"]["refresh_token"], "new-refresh")

    def test_private_configuration_paths_are_never_served(self):
        self.login()
        for path in ["/.env", "/server/app.py", "/requirements.txt", "/data/accounts.sqlite3", "/%2e%2e/.env"]:
            self.assertEqual(self.client.get(path, base_url=ORIGIN).status_code, 404, path)


class DriveTests(unittest.TestCase):
    tearDown = PrivateTests.tearDown
    def setUp(self):
        PrivateTests.setUp(self)
        self.http = FakeDriveHTTP()
        self.drive = Drive(self.store, "client", "secret", self.http)
        for email in [ADMIN, USER]:
            self.store.save_grant(email, {"access_token": email, "refresh_token": "refresh-" + email, "expires_at": time.time() + 3600})

    def test_single_file_update_restore_and_account_isolation(self):
        first = self.drive.backup(ADMIN, json.dumps(agenda()), None)
        second = self.drive.backup(ADMIN, json.dumps(agenda("Changed")), first["md5"])
        self.assertNotEqual(first["md5"], second["md5"])
        self.assertEqual(len(self.http.files), 1)
        self.assertTrue(any(method == "PATCH" for method, _, _ in self.http.calls))
        self.assertFalse(any(method == "DELETE" for method, _, _ in self.http.calls))
        self.assertEqual(json.loads(self.drive.restore(ADMIN)["backupJson"])["clients"][0]["name"], "Changed")
        self.assertFalse(self.drive.status(USER)["hasBackup"])

    def test_failed_upload_preserves_previous_file(self):
        first = self.drive.backup(ADMIN, json.dumps(agenda()), None)
        before = self.http.files.copy()
        self.http.fail_upload = True
        with self.assertRaises(DriveError):
            self.drive.backup(ADMIN, json.dumps(agenda("New")), first["md5"])
        self.assertEqual(self.http.files, before)

    def test_lost_ack_retry_recovers_without_duplicate_file(self):
        self.http.lost_ack = True
        with self.assertRaises(DriveError):
            self.drive.backup(ADMIN, json.dumps(agenda()), None)
        self.http.lost_ack = False
        calls = len(self.http.calls)
        self.drive.backup(ADMIN, json.dumps(agenda()), None)
        self.assertEqual(len(self.http.calls), calls + 1)
        self.assertEqual(len(self.http.files), 1)

    def test_existing_backup_and_stale_device_require_matching_baseline(self):
        first = self.drive.backup(ADMIN, json.dumps(agenda()), None)
        for expected in [None, "outdated"]:
            with self.assertRaises(DriveError) as caught:
                self.drive.backup(ADMIN, json.dumps(agenda("Empty phone")), expected)
            self.assertEqual(caught.exception.code, "remote_changed")
        self.assertEqual(self.drive.status(ADMIN)["md5"], first["md5"])

    def test_invalid_backup_never_modifies_remote_file(self):
        self.drive.backup(ADMIN, json.dumps(agenda()), None)
        before = self.http.files.copy()
        for text in ["broken", '{"version":99}', json.dumps({**agenda(), "version": True})]:
            with self.assertRaises(DriveError):
                self.drive.backup(ADMIN, text, None)
        self.assertEqual(self.http.files, before)

    def test_expired_refresh_requires_reconnect_without_deleting_backup(self):
        self.drive.backup(ADMIN, json.dumps(agenda()), None)
        self.store.save_grant(ADMIN, {"access_token": "old", "expires_at": 0, "refresh_token": "expired"})
        self.http.bad_refresh = True
        with self.assertRaises(DriveError) as caught:
            self.drive.status(ADMIN)
        self.assertEqual(caught.exception.code, "reconnect_required")
        self.assertEqual(len(self.http.files), 1)

    def test_backup_lock_prevents_interleaving(self):
        self.assertTrue(self.store.acquire_drive(ADMIN))
        with self.assertRaises(DriveError) as caught:
            self.drive.backup(ADMIN, json.dumps(agenda()), None)
        self.assertEqual(caught.exception.code, "backup_busy")
        self.store.release_drive(ADMIN)
        self.drive.backup(ADMIN, json.dumps(agenda()), None)


if __name__ == "__main__":
    unittest.main()
