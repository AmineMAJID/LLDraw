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
    python3 server.py --help     # aide et options

Sans port explicite, si 8080 est occupé ou refusé par le système
(cas fréquent sous Windows : WinError 10013), le serveur bascule
automatiquement sur 8081, 8082… au lieu de planter. Avec un port
explicite, un diagnostic lisible remplace la traceback.

Aucune dépendance externe (bibliothèque standard Python uniquement).
"""

import json
import os
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Répertoire de ce fichier (on sert depuis là où se trouve le script)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
STATE_FILE = os.path.join(DATA_DIR, "state.json")

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

    def _safe_send_json(self, obj, status=200):
        # Le navigateur a pu raccrocher avant notre réponse (ses propres
        # timeouts client) : l'écriture échoue alors (BrokenPipe sous
        # Linux/Mac, ConnectionAbortedError/WinError 10053 sous Windows).
        # Sans gravité : on encaisse silencieusement au lieu de cracher une
        # traceback dans la console.
        try:
            self._send_json(obj, status)
        except OSError:
            pass

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


class Server(ThreadingHTTPServer):
    # Autorise le redémarrage immédiat (pas d'erreur « address already in
    # use » à cause d'une socket en TIME_WAIT) et ne bloque pas l'arrêt
    # sur des requêtes en cours.
    allow_reuse_address = True
    daemon_threads = True


def _print_usage():
    print(
        "Usage :\n"
        "  python server.py [PORT] [--host HOST] [--port PORT]\n"
        "\n"
        "Exemples :\n"
        "  python server.py             # http://localhost:8080\n"
        "  python server.py 9000        # autre port (si 8080 est bloqué)\n"
        "  python server.py --host 127.0.0.1 9000   # local uniquement\n"
        "\n"
        "Le port peut aussi venir de la variable d'environnement PORT\n"
        "(imposée par les hébergeurs PaaS — Render, Fly.io, Railway…),\n"
        "et l'hôte de HOST. L'argument explicite prime toujours.\n"
        "Sans port explicite, le serveur essaie 8080 puis les ports\n"
        "suivants (8081, 8082…) jusqu'à en trouver un libre."
    )


def _parse_args(argv):
    """Lit host/port depuis l'env puis la ligne de commande.

    Renvoie (host, port, port_explicite, host_explicite).
    """
    host = os.environ.get("HOST", os.environ.get("LLDRAW_HOST", "0.0.0.0"))
    host_explicite = "HOST" in os.environ or "LLDRAW_HOST" in os.environ
    try:
        port = int(os.environ.get("PORT", "8080"))
        port_explicite = "PORT" in os.environ
    except ValueError:
        print(f"Variable PORT invalide ignorée : {os.environ.get('PORT')!r}")
        port = 8080
        port_explicite = False

    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg in ("-h", "--help"):
            _print_usage()
            sys.exit(0)
        elif arg == "--host" and i + 1 < len(argv):
            i += 1
            host = argv[i]
            host_explicite = True
        elif arg.startswith("--host="):
            host = arg.split("=", 1)[1]
            host_explicite = True
        elif arg in ("-p", "--port") and i + 1 < len(argv):
            i += 1
            try:
                port = int(argv[i])
                port_explicite = True
            except ValueError:
                print(f"Port invalide ignoré : {argv[i]!r}")
        elif arg.startswith("--port="):
            try:
                port = int(arg.split("=", 1)[1])
                port_explicite = True
            except ValueError:
                print(f"Port invalide ignoré : {arg!r}")
        elif arg.startswith("-"):
            print(f"Option inconnue ignorée : {arg} (voir --help)")
        else:
            try:
                port = int(arg)
                port_explicite = True
            except ValueError:
                print(f"Argument invalide ignoré : {arg!r} (voir --help)")
        i += 1

    if not 1 <= port <= 65535:
        print(f"Port {port} hors limites (1-65535), retour à 8080.")
        port = 8080
        port_explicite = False
    return host, port, port_explicite, host_explicite


def _classify_bind_error(err):
    """'permission' | 'in_use' | 'other' selon l'erreur de bind."""
    winerror = getattr(err, "winerror", None)
    errno = getattr(err, "errno", None)
    if winerror == 10013 or errno == 13:
        return "permission"
    if winerror == 10048 or errno in (48, 98):
        return "in_use"
    msg = str(err).lower()
    if "already in use" in msg or "déjà" in msg:
        return "in_use"
    if "permission" in msg or "accès" in msg or "denied" in msg:
        return "permission"
    return "other"


def _print_bind_help(port, err, kind):
    print(f"❌ Impossible de démarrer le serveur sur le port {port}.")
    print(f"   Cause : {err}")
    print()
    if kind == "in_use":
        print("   Ce port est déjà utilisé par un autre programme.")
    elif kind == "permission":
        print(
            "   Windows refuse l'accès à ce port (WinError 10013) : il est\n"
            "   soit réservé par le système (Hyper-V / winnat…), soit filtré\n"
            "   par un pare-feu / antivirus."
        )
    print()
    print("   Solutions :")
    print("   1. Le plus simple — utilisez un autre port :")
    print("        python server.py 9000")
    print()
    print("   2. Trouvez le programme qui occupe le port :")
    print(f"        netstat -ano | findstr :{port}      (Windows)")
    print('        tasklist /FI "PID eq <PID>"          (puis fermez-le)')
    print(f"        lsof -i :{port}  ou  ss -ltnp       (Linux/Mac)")
    print()
    print("   3. Si le port est « exclu » par Windows (Hyper-V / winnat) :")
    print("        netsh interface ipv4 show excludedportrange protocol=tcp")
    print(f"      Si {port} est dans la liste, prenez un port hors liste")
    print("      (ex. 9000) ou réinitialisez la plage :")
    print("        net stop winnat   puis   net start winnat")
    print()
    print("   4. Pare-feu / antivirus : autorisez Python, ou lancez en")
    print("      local uniquement (pas d'accès depuis le réseau) :")
    print(f"        python server.py --host 127.0.0.1 {port}")


def _listen(host, port, port_explicite, host_explicite):
    """Ouvre la socket d'écoute, avec repli automatique de port.

    Sans port explicite, essaie port, port+1, … (+20) jusqu'à trouver
    un port libre. Si l'écoute sur 0.0.0.0 est refusée (permission),
    retente en local (127.0.0.1) avant d'abandonner.
    Renvoie (serveur, hôte_retenu, port_retenu) ou quitte (sys.exit 1).
    """
    repli_hote = not host_explicite and host == "0.0.0.0"
    ports = [port] if port_explicite else [port + i for i in range(21)]
    last_err = None
    for candidat in ports:
        if candidat > 65535:
            break
        hotes = ["0.0.0.0", "127.0.0.1"] if repli_hote else [host]
        for h in hotes:
            try:
                server = Server((h, candidat), Handler)
                return server, h, candidat
            except OSError as e:
                last_err = e
                kind = _classify_bind_error(e)
                # Inutile de retenter 127.0.0.1 si le port est déjà pris :
                # il le sera aussi en local — on passe au port suivant.
                if h == "0.0.0.0" and repli_hote and kind == "permission":
                    continue
                break
    # Tout a échoué : diagnostic lisible au lieu d'une traceback.
    _print_bind_help(port, last_err, _classify_bind_error(last_err))
    sys.exit(1)


def main():
    # PORT imposé par l'hébergeur (Render, Fly.io, Railway…) le cas échéant ;
    # l'argument explicite prime pour un lancement local (python server.py 9000)
    host, port, port_explicite, host_explicite = _parse_args(sys.argv[1:])

    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(STATE_FILE):
        save_state({})

    server, bound_host, bound_port = _listen(host, port, port_explicite, host_explicite)
    if bound_port != port:
        print(f"⚠️  Port {port} indisponible, repli automatique sur {bound_port}.")
    if bound_host == "127.0.0.1" and host == "0.0.0.0":
        print("⚠️  Écoute sur 0.0.0.0 refusée : serveur accessible uniquement")
        print("   depuis cet ordinateur (http://localhost). Pour un accès")
        print("   réseau, relancez avec un port libre : python server.py 9000")
    print(f"LLDraw — serveur démarré sur http://localhost:{bound_port}")
    if bound_host == "0.0.0.0":
        print(f"   (accessible aussi depuis le réseau sur le port {bound_port})")
    print(f"Sauvegarde des workspaces : {STATE_FILE}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt du serveur.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()