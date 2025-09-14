import os
import socket
import sys
from collections import defaultdict

# --- Optional: load .env if present, but do NOT crash if malformed ---
try:
    from dotenv import load_dotenv
    if os.path.exists(".env"):
        load_dotenv(override=True, verbose=False)
except Exception:
    pass  # .env loading is optional

from flask import Flask, request, send_from_directory
from flask_socketio import SocketIO, join_room, leave_room, emit

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*")  # e.g. "https://imhububba.com,https://*.vercel.app"

app = Flask(__name__, static_folder="static")
socketio = SocketIO(app, cors_allowed_origins=ALLOWED_ORIGINS, async_mode="eventlet")

room_members = defaultdict(set)

# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------
@app.route("/")
def root():
    """
    Serve the main UI from static/index.html when someone visits '/'
    """
    idx = os.path.join(app.static_folder or "static", "index.html")
    if os.path.exists(idx):
        return send_from_directory("static", "index.html")
    return "OK", 200

@app.route("/static/<path:path>")
def static_files(path):
    return send_from_directory("static", path)

# -----------------------------------------------------------------------------
# Socket.IO handlers
# -----------------------------------------------------------------------------
@socketio.on("connect")
def on_connect():
    print(f"[+] socket connected {request.sid}")

@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    print(f"[-] socket disconnected {sid}")
    for room, members in list(room_members.items()):
        if sid in members:
            members.remove(sid)
            socketio.emit("peer-left", {"sid": sid}, room=room)
            if not members:
                room_members.pop(room, None)

@socketio.on("join")
def on_join(data):
    sid = request.sid
    room = (data or {}).get("room")
    if not room:
        emit("error", {"message": "Room name required"})
        return
    join_room(room)
    room_members[room].add(sid)
    others = [other for other in room_members[room] if other != sid]
    emit("peers", {"peers": others, "you": sid}, to=sid)
    print(f"[room:{room}] {sid} joined; now {len(room_members[room])} member(s)")

@socketio.on("leave")
def on_leave(data):
    sid = request.sid
    room = (data or {}).get("room")
    if not room:
        return
    if sid in room_members[room]:
        room_members[room].remove(sid)
    leave_room(room)
    socketio.emit("peer-left", {"sid": sid}, room=room)
    print(f"[room:{room}] {sid} left; now {len(room_members[room])} member(s)")

@socketio.on("signal")
def on_signal(data):
    """
    Relay signaling messages to a specific peer:
    { "to": "<socket_id>", "from": "<socket_id>", "type": "offer|answer|candidate", "payload": {...} }
    """
    target = (data or {}).get("to")
    if not target:
        return
    socketio.emit("signal", data, to=target)

# -----------------------------------------------------------------------------
# Port selection helpers
# -----------------------------------------------------------------------------
def is_port_free(host: str, port: int) -> bool:
    """Return True if (host, port) can be bound."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False

def find_open_port(start_port: int, host: str = "0.0.0.0", max_increments: int = 100) -> int:
    """Find the first open port at or above start_port."""
    for offset in range(0, max_increments + 1):
        candidate = start_port + offset
        if is_port_free(host, candidate):
            return candidate
    raise RuntimeError(f"No free port found from {start_port} to {start_port + max_increments}")

def parse_cli_port(default_port: int) -> int:
    """Allow `python server.py --port 5050` or `-p 5050`."""
    argv = sys.argv[1:]
    for i, arg in enumerate(argv):
        if arg in ("--port", "-p"):
            if i + 1 < len(argv):
                try:
                    return int(argv[i + 1])
                except ValueError:
                    pass
    return default_port

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")

    # Priority: CLI --port > PORT env > 5000
    base_port = parse_cli_port(int(os.getenv("PORT", "5000")))

    # Find the next open port starting from base_port
    chosen_port = find_open_port(base_port, host=host, max_increments=100)

    # Show a helpful banner
    print("=" * 70)
    print("Hububba PB Backend (Flask-SocketIO)")
    print(f" CORS allowed origins: {ALLOWED_ORIGINS}")
    print(f" Host: {host}")
    print(f" Requested start port: {base_port}")
    print(f" -> Using open port:   {chosen_port}")
    print(f" Open http://localhost:{chosen_port}  (or ws://localhost:{chosen_port}/socket.io/ )")
    print("=" * 70)

    socketio.run(app, host=host, port=chosen_port)
