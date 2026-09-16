#!/usr/bin/env python3
"""
LLDraw — serveur minimal avec persistance JSON.

Il fait deux choses :
  1. Sert les fichiers statiques (index.html, app.js, styles.css, assets/...).
  2. Expose une mini-API pour sauvegarder / charger l'état de l'application
     dans un fichier JSON sur le disque : data/state.json.

Ainsi les workspaces (racks, devices, ports, câbles…) sont enregistrés
« à vie » côté serveur : ils ne disparaissent pas quand on change de
navigateur, d'ordinateur ou qu'on vide le cache du navigateur.

Lancement :
    python3 server.py            # http://localhost:8080
    python3 server.py 9000       # sur un autre port

Aucune dépendance externe (bibliothèque standard Python uniquement).
"""

import json
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Répertoire de ce fichier (on sert depuis là où se trouve le script)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
STATE_FILE = os.path.join(DATA_DIR, "state.json")

# Clé API IA facultative côté serveur : si elle est définie, le proxy
# /api/ai l'utilise quand le navigateur n'envoie aucune clé.
AI_ENV_KEY = "LLDRAW_AI_KEY"

# Écriture sérialisée (plusieurs requêtes peuvent arriver en parallèle)
_lock = threading.Lock()

# Types MIME habituels (le module en connaît déjà beaucoup, on complète)
EXTRA_MIME = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
}


# ----------------------------------------------------------------
# Proxy IA — POST /api/ai
# ----------------------------------------------------------------
# Le navigateur envoie { provider, endpoint, apiKey?, body } ; le
# serveur transmet la requête au fournisseur d'IA (OpenAI-compatible
# ou Anthropic) et renvoie la réponse EN CONTINU (SSE), sans mise en
# tampon. Intérêts :
#   • la clé peut rester côté serveur (variable d'environnement
#     LLDRAW_AI_KEY) — le champ apiKey du navigateur devient facultatif ;
#   • pas de problème CORS ;
#   • fonctionne avec n'importe quel fournisseur supporté par le client.
# Garde-fou SSRF : https exigé, sauf pour Ollama/local en http ; les
# adresses privées, loopback (hors localhost) et link-local (métadonnées
# cloud 169.254.x) sont refusées ; les redirections ne sont pas suivies.

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}
_PRIVATE_HOST_RE = re.compile(
    r"^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|"
    r"metadata(\.|$)|.*\.internal$|.*\.local$)"
)


def ai_endpoint_allowed(url):
    """Valide l'URL du fournisseur (anti-SSRF basique)."""
    try:
        p = urllib.parse.urlparse(url)
    except ValueError:
        return False
    host = (p.hostname or "").lower()
    if not host:
        return False
    if p.scheme == "http":
        # http toléré uniquement pour un fournisseur local (Ollama, LM Studio…)
        return host in _LOCAL_HOSTS
    if p.scheme != "https":
        return False
    if host in _LOCAL_HOSTS:
        return True
    return not _PRIVATE_HOST_RE.match(host)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_ai_opener = urllib.request.build_opener(_NoRedirect)


def _ai_upstream_headers(provider, api_key):
    h = {"Content-Type": "application/json", "Accept": "*/*"}
    if provider == "anthropic":
        h["x-api-key"] = api_key
        h["anthropic-version"] = "2023-06-01"
    else:  # famille OpenAI-compatible
        h["Authorization"] = "Bearer " + api_key
    return h


def load_state():
    """Lit l'état depuis le fichier JSON. Renvoie {} si absent/invalide."""
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except (ValueError, OSError):
        # Fichier corrompu : on ne l'écrase pas, on repart à vide.
        return {}


def save_state(data):
    """Écrit l'état de façon atomique (fichier temporaire + renommage)."""
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with _lock:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, STATE_FILE)  # remplacement atomique


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def guess_type(self, path):
        for ext, mime in EXTRA_MIME.items():
            if path.endswith(ext):
                return mime
        return super().guess_type(path)

    def log_message(self, fmt, *args):
        # Logs discrets : une ligne par requête API/erreur seulement
        if "api/" in (self.path or ""):
            super().log_message(fmt, *args)

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] == "/api/state":
            self._send_json(load_state())
            return
        super().do_GET()

    def do_PUT(self):
        if self.path.split("?")[0] == "/api/state":
            try:
                length = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(length) if length else b""
                data = json.loads(raw.decode("utf-8"))
                if not isinstance(data, dict):
                    raise ValueError("Le corps doit être un objet JSON")
            except (ValueError, UnicodeDecodeError) as e:
                self._send_json({"ok": False, "error": str(e)}, status=400)
                return
            try:
                save_state(data)
            except OSError as e:
                self._send_json({"ok": False, "error": str(e)}, status=500)
                return
            self._send_json({"ok": True})
            return
        self.send_error(404)

    # ---- Proxy IA (voir ai_endpoint_allowed plus haut) ----
    def do_POST(self):
        if self.path.split("?")[0] != "/api/ai":
            self.send_error(405)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            req = json.loads(raw.decode("utf-8"))
            if not isinstance(req, dict):
                raise ValueError("corps invalide")
        except (ValueError, UnicodeDecodeError) as e:
            self._send_json({"ok": False, "error": f"Requête invalide : {e}"}, status=400)
            return

        endpoint = str(req.get("endpoint") or "")
        provider = str(req.get("provider") or "openai")
        body = req.get("body")
        if not isinstance(body, dict):
            self._send_json({"ok": False, "error": "body manquant (objet attendu)"}, status=400)
            return
        if not ai_endpoint_allowed(endpoint):
            self._send_json({"ok": False, "error": f"Endpoint refusé par le serveur (https requis, hôtes privés/métadonnées bloqués) : {endpoint[:120]}"}, status=400)
            return

        # Clé : variable d'environnement du serveur en priorité, sinon celle du navigateur
        api_key = os.environ.get(AI_ENV_KEY, "").strip() or str(req.get("apiKey") or "").strip()
        if not api_key:
            self._send_json({"ok": False, "error": "Aucune clé API : renseignez-la dans les réglages 🤖 ou définissez la variable d'environnement LLDRAW_AI_KEY du serveur."}, status=400)
            return

        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        upstream = urllib.request.Request(
            endpoint, data=data, method="POST",
            headers=_ai_upstream_headers(provider, api_key)
        )
        try:
            resp = _ai_opener.open(upstream, timeout=600)
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read(2000).decode("utf-8", "replace")
            except Exception:
                pass
            self._send_json({"ok": False, "error": f"HTTP {e.code} du fournisseur", "detail": detail[:800]}, status=502)
            return
        except Exception as e:
            self._send_json({"ok": False, "error": f"Connexion au fournisseur impossible : {e}"}, status=502)
            return

        streaming = bool(body.get("stream")) and "event-stream" in (resp.headers.get("Content-Type") or "")
        try:
            self.send_response(200)
            self.send_header("Content-Type", resp.headers.get("Content-Type") or "application/json")
            self.send_header("Cache-Control", "no-store")
            if streaming:
                self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            if streaming:
                # Recopie du flux SSE au fil de l'eau (pas de mise en tampon)
                while True:
                    try:
                        chunk = resp.read1(8192)
                    except AttributeError:
                        chunk = resp.read(8192)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
            else:
                self.wfile.write(resp.read())
        except (BrokenPipeError, ConnectionResetError):
            pass  # le navigateur a interrompu le flux (bouton ⏹)
        finally:
            resp.close()


def main():
    import sys
    # PORT imposé par l'hébergeur (Render, Fly.io, Railway…) le cas échéant ;
    # l'argument explicite prime pour un lancement local (python server.py 9000)
    try:
        port = int(os.environ.get("PORT", "8080"))
    except ValueError:
        port = 8080
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass

    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(STATE_FILE):
        save_state({})

    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"LLDraw — serveur démarré sur http://localhost:{port}")
    print(f"Sauvegarde des workspaces : {STATE_FILE}")
    if os.environ.get(AI_ENV_KEY, "").strip():
        print(f"Assistant IA : clé détectée dans l'environnement ({AI_ENV_KEY}) — proxy /api/ai prêt")
    else:
        print(f"Assistant IA : proxy /api/ai actif (clé fournie par le navigateur, ou définir {AI_ENV_KEY})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt du serveur.")
        server.server_close()


if __name__ == "__main__":
    main()