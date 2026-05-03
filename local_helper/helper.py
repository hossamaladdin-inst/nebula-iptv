#!/usr/bin/env python3
"""
Comet IPTV — localhost HTTP helper.

Runs as a tiny background service on http://127.0.0.1:9123. The browser
extension POSTs a stream URL to /start; the helper spawns ffmpeg to
transcode AC-3/DTS audio into AAC inside a local HLS playlist served on
http://127.0.0.1:9123/streams/<id>/index.m3u8 and returns that URL.
The browser plays it via hls.js — smooth, hardware-decoded, no download.

Why this instead of Chrome native messaging?
  Comet (Perplexity's browser) silently refuses to launch user-level
  native messaging hosts on macOS, so we sidestep that whole machinery
  with a plain loopback HTTP service.

API:
  GET  /health       → { ok: true, version: 1, ffmpeg: "..." }
  POST /start        body { url: "..." }   → { id, hls_url }
  POST /stop/<id>                          → { stopped: true }
  GET  /streams/<id>/index.m3u8            HLS playlist
  GET  /streams/<id>/segXXXXX.ts           HLS segments
"""
import os
import sys
import json
import time
import shutil
import socket
import signal
import tempfile
import threading
import subprocess
import secrets
import atexit
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 9123
ROOT_TMP = tempfile.mkdtemp(prefix="comet-iptv-helper-")
streams = {}            # id -> Stream
streams_lock = threading.Lock()


def find_ffmpeg():
    for p in (shutil.which("ffmpeg"), "/opt/homebrew/bin/ffmpeg",
              "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"):
        if p and os.path.exists(p):
            return p
    return None


FFMPEG = find_ffmpeg()
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")


class Stream:
    def __init__(self, url):
        self.url    = url
        self.id     = secrets.token_hex(8)
        self.dir    = os.path.join(ROOT_TMP, self.id)
        self.proc   = None
        self.error  = None
        os.makedirs(self.dir, exist_ok=True)

    def start(self):
        if not FFMPEG:
            raise RuntimeError("ffmpeg not found in PATH (brew install ffmpeg)")

        # Some IPTV CDNs (e.g. av.anghami.us) rate-limit; the same URL flips
        # between 200 and 406 depending on recent traffic. Retry the spawn a
        # few times with backoff so transient 4xx blips don't bubble up to
        # the user.
        last_err = None
        for attempt in range(1, 4):
            try:
                self._spawn_ffmpeg()
                return
            except RuntimeError as e:
                last_err = e
                msg = str(e)
                # Only retry on transient HTTP-level failures. If ffmpeg
                # crashed for some other reason there's no point retrying.
                if "HTTP error" in msg or "4XX" in msg or "5XX" in msg or "Server returned" in msg:
                    delay = attempt * 1.5
                    print(f"[stream {self.id}] attempt {attempt} hit transient error; retrying in {delay}s",
                          file=sys.stderr, flush=True)
                    time.sleep(delay)
                    continue
                raise
        raise last_err

    def _spawn_ffmpeg(self):
        playlist = os.path.join(self.dir, "index.m3u8")
        seg_pat  = os.path.join(self.dir, "seg%05d.ts")
        # Wipe any leftover state from a previous failed attempt.
        for f in os.listdir(self.dir):
            try: os.remove(os.path.join(self.dir, f))
            except Exception: pass

        cmd = [
            FFMPEG, "-hide_banner", "-loglevel", "warning",
            # `-re` makes ffmpeg read input at the native frame rate, so it
            # produces HLS segments only ~as fast as they're played. Without
            # this, ffmpeg buffers the entire stream on disk in minutes.
            "-re",
            # Auto-retry on connection drops mid-stream.
            "-reconnect", "1",
            "-reconnect_streamed", "1",
            "-reconnect_on_http_error", "4xx,5xx",
            "-reconnect_delay_max", "3",
            "-user_agent", UA,
            "-seekable", "0",
            "-multiple_requests", "0",
            "-icy", "0",
            "-fflags", "+genpts+igndts",
            "-i", self.url,
            "-map", "0:v:0?", "-map", "0:a:0?",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k", "-ac", "2",
            "-f", "hls",
            "-hls_time", "2",
            # Keep ~24 s of segments on disk; older ones are auto-deleted.
            "-hls_list_size", "12",
            "-hls_flags", "independent_segments+program_date_time+delete_segments+append_list",
            "-hls_segment_filename", seg_pat,
            playlist,
        ]
        self.proc = subprocess.Popen(
            cmd, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

        deadline = time.time() + 30
        while time.time() < deadline:
            if self.proc.poll() is not None:
                err = self.proc.stderr.read().decode("utf-8", "ignore")[-600:]
                raise RuntimeError(f"ffmpeg exited early: {err}")
            try:
                with open(playlist) as f:
                    if "#EXTINF" in f.read():
                        return
            except FileNotFoundError:
                pass
            time.sleep(0.15)
        raise RuntimeError("ffmpeg produced no playlist within 30s")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.terminate()
                self.proc.wait(timeout=2)
            except Exception:
                try: self.proc.kill()
                except Exception: pass
        try: shutil.rmtree(self.dir, ignore_errors=True)
        except Exception: pass


def cleanup_all():
    with streams_lock:
        for s in list(streams.values()):
            try: s.stop()
            except Exception: pass
        streams.clear()
    try: shutil.rmtree(ROOT_TMP, ignore_errors=True)
    except Exception: pass


atexit.register(cleanup_all)
for sig in (signal.SIGTERM, signal.SIGINT):
    try: signal.signal(sig, lambda *_: (cleanup_all(), os._exit(0)))
    except Exception: pass


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Cache-Control", "no-cache")

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path, ctype):
        try:
            with open(path, "rb") as f:
                data = f.read()
        except FileNotFoundError:
            self.send_response(404); self._cors(); self.end_headers(); return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "version": 1, "ffmpeg": FFMPEG or None})
            return
        if self.path.startswith("/streams/"):
            parts = self.path.split("/")
            if len(parts) >= 4:
                sid = parts[2]
                fname = "/".join(parts[3:]).split("?", 1)[0]
                with streams_lock:
                    s = streams.get(sid)
                if not s:
                    self.send_response(404); self._cors(); self.end_headers(); return
                fpath = os.path.join(s.dir, fname)
                ctype = ("application/x-mpegurl" if fname.endswith(".m3u8")
                         else "video/mp2t" if fname.endswith(".ts")
                         else "application/octet-stream")
                self._file(fpath, ctype); return
        self.send_response(404); self._cors(); self.end_headers()

    def do_POST(self):
        if self.path == "/start":
            length = int(self.headers.get("Content-Length", "0"))
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            except Exception:
                self._json(400, {"error": "bad JSON"}); return
            url = body.get("url")
            if not url:
                self._json(400, {"error": "missing url"}); return
            try:
                s = Stream(url)
                s.start()
                with streams_lock:
                    streams[s.id] = s
                self._json(200, {
                    "id": s.id,
                    "hls_url": f"http://127.0.0.1:{PORT}/streams/{s.id}/index.m3u8",
                })
            except Exception as e:
                self._json(500, {"error": str(e)})
            return
        if self.path.startswith("/stop/"):
            sid = self.path[len("/stop/"):]
            with streams_lock:
                s = streams.pop(sid, None)
            if s: s.stop()
            self._json(200, {"stopped": bool(s)})
            return
        self.send_response(404); self._cors(); self.end_headers()


def main():
    if not FFMPEG:
        print("ERROR: ffmpeg not found. Install with: brew install ffmpeg", file=sys.stderr)
        sys.exit(1)
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError as e:
        if "Address already in use" in str(e):
            print(f"Helper already running on 127.0.0.1:{PORT} — exit and re-run.", file=sys.stderr)
        else:
            print(f"Bind failed: {e}", file=sys.stderr)
        sys.exit(1)
    print(f"Comet IPTV helper listening on http://127.0.0.1:{PORT}", flush=True)
    print(f"  ffmpeg: {FFMPEG}", flush=True)
    try:
        srv.serve_forever()
    finally:
        cleanup_all()


if __name__ == "__main__":
    main()
