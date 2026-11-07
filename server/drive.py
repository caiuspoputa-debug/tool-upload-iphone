"""One visible, app-created Drive backup per authorized Google account."""
import hashlib
import json
import re
import time
from urllib.parse import quote, urlsplit

import requests

from .business_validation import validate_state

SCOPE = "https://www.googleapis.com/auth/drive.file"
NAME = "Agenda-Frizerie-backup.json"
MARKER = "agendaFrizerieBackup"
MAX_BYTES = 30 * 1024 * 1024


class DriveError(Exception):
    def __init__(self, message, status=502, code="drive_error"):
        super().__init__(message)
        self.status, self.code = status, code


def checked_backup(text):
    if not isinstance(text, str) or len(text.encode("utf-8")) > MAX_BYTES:
        raise DriveError("Backupul depășește limita sau nu este valid.", 400, "invalid_backup")
    try:
        raw = json.loads(text, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        state = validate_state(raw)
        # Validation returns business fields only, never OAuth/session metadata.
        return json.dumps(state, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    except (ValueError, TypeError, KeyError, RecursionError):
        raise DriveError("Backup invalid. Datele din Drive nu au fost înlocuite.", 400, "invalid_backup") from None


class Drive:
    def __init__(self, store, client_id, client_secret, http=requests):
        self.store, self.client_id, self.client_secret, self.http = store, client_id, client_secret, http

    def token(self, email):
        grant = self.store.grant(email)
        if not grant:
            raise DriveError("Conectează Google Drive din Setări.", 409, "drive_disconnected")
        token = grant["token"]
        if float(token.get("expires_at", 0)) > time.time() + 60:
            return token["access_token"]
        refresh = token.get("refresh_token")
        if not refresh:
            raise DriveError("Google cere reconectare pentru backup.", 409, "reconnect_required")
        try:
            response = self.http.post("https://oauth2.googleapis.com/token", data={"grant_type": "refresh_token", "refresh_token": refresh, "client_id": self.client_id, "client_secret": self.client_secret}, timeout=15)
            if response.status_code != 200:
                raise DriveError("Google cere reconectare pentru backup.", 409, "reconnect_required")
            fresh = response.json()
            if not isinstance(fresh.get("access_token"), str):
                raise DriveError("Răspuns Google nevalid.")
            token = {"access_token": fresh["access_token"], "refresh_token": fresh.get("refresh_token", refresh), "expires_at": time.time() + float(fresh.get("expires_in", 3600))}
            self.store.save_grant(email, token)
            return token["access_token"]
        except requests.RequestException:
            raise DriveError("Google nu răspunde. Copia anterioară este păstrată.") from None

    def request(self, email, method, url, **kwargs):
        headers = {"Authorization": "Bearer " + self.token(email), **kwargs.pop("headers", {})}
        try:
            response = self.http.request(method, url, headers=headers, timeout=45, allow_redirects=False, **kwargs)
        except requests.RequestException:
            raise DriveError("Transferul către Google a eșuat. Reîncearcă fără să ștergi copia existentă.") from None
        if response.status_code == 401:
            grant = self.store.grant(email)
            if grant:
                token = grant["token"]
                token["expires_at"] = 0
                self.store.save_grant(email, token)
            raise DriveError("Google cere reconectare sau reîncercare.", 409, "reconnect_required")
        if response.status_code == 403:
            raise DriveError("Google a refuzat backupul. Verifică autorizarea și spațiul disponibil.", 409, "drive_refused")
        if response.status_code not in (200, 201):
            raise DriveError("Google nu a confirmat operația. Copia existentă nu a fost ștearsă.")
        return response

    def remote(self, email):
        result = self.request(email, "GET", "https://www.googleapis.com/drive/v3/files", params={"q": "trashed=false and appProperties has { key='" + MARKER + "' and value='v1' }", "spaces": "drive", "fields": "files(id,name,modifiedTime,md5Checksum,size,version),nextPageToken", "pageSize": 2}).json()
        files = result.get("files", [])
        if len(files) > 1 or result.get("nextPageToken"):
            raise DriveError("Există mai multe copii în Drive. Verifică-le înainte de înlocuire.", 409, "multiple_backups")
        if files and (not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", str(files[0].get("id", ""))) or not files[0].get("md5Checksum")):
            raise DriveError("Metadatele backupului nu pot fi verificate.")
        return files[0] if files else None

    def status(self, email):
        if not self.store.grant(email):
            return {"connected": False, "hasBackup": False}
        remote = self.remote(email)
        return {"connected": True, "hasBackup": bool(remote), "md5": remote.get("md5Checksum") if remote else None, "modifiedAt": remote.get("modifiedTime") if remote else None}

    def backup(self, email, text, expected_md5):
        content = checked_backup(text)
        local_hash = hashlib.sha256(text.encode()).hexdigest()
        checksum = hashlib.md5(content, usedforsecurity=False).hexdigest()
        if not self.store.acquire_drive(email):
            raise DriveError("Un alt backup este în curs. Reîncearcă.", 409, "backup_busy")
        try:
            remote = self.remote(email)
            # Recover an upload whose successful acknowledgement was lost.
            if remote and remote["md5Checksum"] == checksum:
                self.store.record_backup(email, remote["id"], remote.get("modifiedTime"), local_hash)
                return {"md5": checksum, "localHash": local_hash, "modifiedAt": remote.get("modifiedTime")}
            if remote and expected_md5 != remote["md5Checksum"]:
                raise DriveError("Copia din Drive diferă. Restaurează sau confirmă înlocuirea ei din Setări.", 409, "remote_changed")
            if not remote and expected_md5:
                raise DriveError("Copia anterioară nu mai există în Drive. Verifică înainte de a crea alta.", 409, "remote_changed")
            metadata = {"name": NAME, "mimeType": "application/json", "appProperties": {MARKER: "v1"}}
            if remote:
                method, suffix = "PATCH", "/" + quote(remote["id"], safe="")
            else:
                method, suffix = "POST", ""
                metadata["parents"] = ["root"]
            initiation = self.request(email, method, "https://www.googleapis.com/upload/drive/v3/files" + suffix, params={"uploadType": "resumable", "fields": "id,modifiedTime,md5Checksum"}, headers={"X-Upload-Content-Type": "application/json", "X-Upload-Content-Length": str(len(content))}, json=metadata)
            upload = initiation.headers.get("Location", "")
            location = urlsplit(upload)
            if location.scheme != "https" or location.netloc != "www.googleapis.com" or not location.path.startswith("/upload/drive/"):
                raise DriveError("Adresa de transfer primită de la Google nu este validă.")
            result = self.request(email, "PUT", upload, headers={"Content-Type": "application/json", "Content-Length": str(len(content))}, data=content).json()
            if result.get("md5Checksum") != checksum or not result.get("id"):
                raise DriveError("Google nu a confirmat integritatea backupului. Reîncearcă.")
            self.store.record_backup(email, result["id"], result.get("modifiedTime"), local_hash)
            return {"md5": checksum, "localHash": local_hash, "modifiedAt": result.get("modifiedTime")}
        finally:
            self.store.release_drive(email)

    def restore(self, email):
        remote = self.remote(email)
        if not remote:
            raise DriveError("Nu există un backup al acestei aplicații în contul Google conectat.", 404, "backup_missing")
        if int(remote.get("size", 0)) > MAX_BYTES:
            raise DriveError("Backupul depășește limita acceptată.", 400)
        response = self.request(email, "GET", "https://www.googleapis.com/drive/v3/files/" + quote(remote["id"], safe=""), params={"alt": "media"}, stream=True)
        chunks, size = [], 0
        try:
            for chunk in response.iter_content(65536):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise DriveError("Backupul depășește limita acceptată.", 400)
                chunks.append(chunk)
        finally:
            response.close()
        content = b"".join(chunks)
        if hashlib.md5(content, usedforsecurity=False).hexdigest() != remote["md5Checksum"]:
            raise DriveError("Backupul s-a schimbat în timpul descărcării. Reîncearcă.", 409, "remote_changed")
        try:
            text = content.decode("utf-8")
            checked_backup(text)
        except UnicodeError:
            raise DriveError("Backupul Google nu este valid.", 400) from None
        return {"backupJson": text, "md5": remote["md5Checksum"], "modifiedAt": remote.get("modifiedTime")}
