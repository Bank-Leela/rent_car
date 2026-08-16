#!/usr/bin/env python3
"""Minimal Chrome DevTools Protocol client over raw WebSocket (stdlib only).

Why this exists: the previous harness drove Chrome with `--headless=new
--screenshot --virtual-time-budget=N`. Virtual time advances without pausing for
the network, so every scripted click fired into server HTML that React had not
hydrated yet — a dead button and a working one looked identical, and no server
action ever ran. Real interaction testing needs to wait on real conditions, which
needs CDP.

A reverse proxy that injected the dev auth cookie could not relay Turbopack's
HMR WebSocket upgrade, and without that socket the dev runtime never streams the
flight payload — so the page stayed at server HTML forever. Point straight at the
dev server and set the cookie over CDP instead.

Usage:
  python3 scripts/devtools/cdp.py <url> [--cookie name=value] [--wait-hydrated]
      [--eval-file F] [--shot OUT.png] [--w N] [--h N] [--console]

  # click something and read the result back
  python3 scripts/devtools/cdp.py 'http://localhost:3000/admin/schedule?date=2026-09-01' \
      --cookie dev_user_id=seed-user-admin --wait-hydrated --eval-file /tmp/click.js

The eval file is JS evaluated (as an async IIFE's body, so `await` is allowed)
after navigation; its returned value is printed as JSON. `--wait-hydrated` polls
for React's internal props keys, so a click is never dispatched into server HTML
that React has not adopted yet. Always pass it before asserting on interaction.
"""
import base64
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


class WS:
    """Just enough RFC6455 for CDP: text frames, client-masked, no extensions."""

    def __init__(self, url):
        m = re.match(r"ws://([^:/]+):(\d+)(/.*)", url)
        host, port, path = m.group(1), int(m.group(2)), m.group(3)
        self.sock = socket.create_connection((host, port), timeout=60)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            (
                f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(4096)
        if b"101" not in buf.split(b"\r\n")[0]:
            raise RuntimeError("ws handshake failed: " + buf[:200].decode("latin1"))
        self.buf = buf.split(b"\r\n\r\n", 1)[1]

    def send(self, text):
        payload = text.encode()
        n = len(payload)
        hdr = b"\x81"
        if n < 126:
            hdr += struct.pack("!B", 0x80 | n)
        elif n < 65536:
            hdr += struct.pack("!BH", 0x80 | 126, n)
        else:
            hdr += struct.pack("!BQ", 0x80 | 127, n)
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(hdr + mask + masked)

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError("ws closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self):
        while True:
            b0, b1 = self._read(2)
            opcode, ln = b0 & 0x0F, b1 & 0x7F
            if ln == 126:
                ln = struct.unpack("!H", self._read(2))[0]
            elif ln == 127:
                ln = struct.unpack("!Q", self._read(8))[0]
            data = self._read(ln)
            if opcode == 0x9:  # ping
                self.sock.sendall(b"\x8a" + struct.pack("!B", 0x80 | len(data)) + os.urandom(4) + data)
                continue
            if opcode in (0x1, 0x2):
                return data.decode("utf-8", "replace")
            if opcode == 0x8:
                raise RuntimeError("ws close frame")


class Browser:
    def __init__(self, width=1280, height=1600, port=9333):
        self.profile = tempfile.mkdtemp(prefix="cdp-prof-")
        self.proc = subprocess.Popen(
            [
                CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
                "--no-default-browser-check", "--hide-scrollbars",
                "--force-device-scale-factor=1",
                f"--remote-debugging-port={port}",
                f"--user-data-dir={self.profile}",
                f"--window-size={width},{height}",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        ws_url = None
        for _ in range(120):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2) as r:
                    tabs = json.load(r)
                cand = [t for t in tabs if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
                if cand:
                    ws_url = cand[0]["webSocketDebuggerUrl"]
                    break
            except Exception:
                pass
            time.sleep(0.25)
        if not ws_url:
            raise RuntimeError("could not reach Chrome DevTools")
        self.ws = WS(ws_url)
        self.id = 0
        self.events = []

    def call(self, method, params=None, timeout=90):
        self.id += 1
        mid = self.id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
            self.events.append(msg)
        raise TimeoutError(method)

    def evaluate(self, expr, timeout=90):
        r = self.call(
            "Runtime.evaluate",
            {"expression": f"(async () => {{ {expr} }})()", "awaitPromise": True,
             "returnByValue": True, "userGesture": True},
            timeout=timeout,
        )
        if r.get("exceptionDetails"):
            raise RuntimeError(json.dumps(r["exceptionDetails"])[:600])
        return r.get("result", {}).get("value")

    def emulate(self, width, height, mobile=False, dsf=1):
        """Force a real viewport size.

        Chrome headless on macOS refuses to make its WINDOW narrower than about
        500 px, so `--window-size=375,…` silently renders at ~500 and every
        "mobile" screenshot taken that way is a lie. Device-metrics override is
        applied at the page level and honours any width.
        """
        self.call("Emulation.setDeviceMetricsOverride", {
            "width": int(width), "height": int(height),
            "deviceScaleFactor": dsf, "mobile": bool(mobile),
        })

    def goto(self, url):
        self.call("Page.enable")
        self.call("Runtime.enable")
        self.call("Page.navigate", {"url": url})
        # Real-time wait for the load event rather than a virtual-time budget.
        deadline = time.time() + 60
        while time.time() < deadline:
            try:
                if self.evaluate("return document.readyState;", timeout=10) == "complete":
                    return
            except Exception:
                pass
            time.sleep(0.3)
        raise TimeoutError("load")

    def wait_hydrated(self, timeout=60):
        """React attaches __reactProps$/__reactFiber$ keys once it adopts the DOM."""
        js = (
            "const els = document.querySelectorAll('button,[role=button],a');"
            "for (const e of els) for (const k in e) if (k.startsWith('__react')) return true;"
            "return false;"
        )
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.evaluate(f"{js}", timeout=15):
                return True
            time.sleep(0.4)
        return False

    def shot_viewport(self, out):
        """Just what is on screen. A full-page capture of a long board is
        thousands of pixels tall, and cropping it afterwards centres on the
        middle — so judging the top of a page needs this."""
        r = self.call("Page.captureScreenshot", {"format": "png"})
        with open(out, "wb") as f:
            f.write(base64.b64decode(r["data"]))
        return out

    def shot(self, out):
        m = self.call("Page.getLayoutMetrics")
        h = int(m["cssContentSize"]["height"])
        w = int(m["cssContentSize"]["width"])
        r = self.call("Page.captureScreenshot", {
            "format": "png",
            "clip": {"x": 0, "y": 0, "width": w, "height": min(h, 12000), "scale": 1},
            "captureBeyondViewport": True,
        })
        with open(out, "wb") as f:
            f.write(base64.b64decode(r["data"]))
        return out

    def close(self):
        try:
            self.proc.terminate()
            self.proc.wait(timeout=10)
        except Exception:
            self.proc.kill()
        shutil.rmtree(self.profile, ignore_errors=True)


def main():
    a = sys.argv[1:]
    url = a[0]

    def flag(name, default=None):
        return a[a.index(name) + 1] if name in a else default

    b = Browser(width=int(flag("--w", 1280)), height=int(flag("--h", 1600)))
    try:
        if "--console" in a:
            b.call("Runtime.enable")
            b.call("Log.enable")
        # Setting the dev auth cookie here removes the reverse proxy entirely.
        # The proxy could not relay Turbopack's HMR WebSocket upgrade, and the
        # dev runtime never streams the flight payload without it — so nothing
        # hydrated and no client interaction was testable.
        ck = flag("--cookie")
        if ck:
            name, _, val = ck.partition("=")
            b.call("Network.enable")
            b.call("Network.setCookie", {
                "name": name, "value": val, "domain": "localhost", "path": "/",
            })
        em = flag("--emulate")
        if em:
            w, _, h = em.partition("x")
            b.emulate(int(w), int(h or 800), mobile=int(w) < 640)
        b.goto(url)
        out = {"url": url}
        if "--wait-hydrated" in a:
            out["hydrated"] = b.wait_hydrated()
        # Real Tab presses, not synthetic KeyboardEvents. `:focus-visible` only
        # matches when Chrome's last-interaction modality is the keyboard, and an
        # untrusted dispatchEvent() never sets it — so a focus ring can only be
        # verified through Input.dispatchKeyEvent.
        n = flag("--tab")
        if n:
            for _ in range(int(n)):
                for ty in ("rawKeyDown", "keyUp"):
                    b.call("Input.dispatchKeyEvent", {
                        "type": ty, "key": "Tab", "code": "Tab",
                        "windowsVirtualKeyCode": 9, "nativeVirtualKeyCode": 9,
                    })
        f = flag("--eval-file")
        if f:
            out["result"] = b.evaluate(open(f, encoding="utf-8").read())
        s = flag("--shot")
        if s:
            out["shot"] = b.shot_viewport(s) if "--viewport" in a else b.shot(s)
        if "--console" in a:
            msgs = []
            for e in b.events:
                m = e.get("method")
                p = e.get("params", {})
                if m == "Runtime.exceptionThrown":
                    d = p.get("exceptionDetails", {})
                    msgs.append("EXCEPTION " + (d.get("text", "") + " " +
                                str((d.get("exception") or {}).get("description", "")))[:400])
                elif m == "Log.entryAdded":
                    en = p.get("entry", {})
                    if en.get("level") in ("error", "warning"):
                        msgs.append(f"{en['level'].upper()} {en.get('text','')[:300]} {en.get('url','')[-70:]}")
                elif m == "Runtime.consoleAPICalled" and p.get("type") in ("error", "warning"):
                    msgs.append("CONSOLE " + " ".join(
                        str(x.get("value", x.get("description", "")))[:200] for x in p.get("args", [])))
            out["console"] = msgs[:25]
        print(json.dumps(out, ensure_ascii=False, indent=2))
    finally:
        b.close()


if __name__ == "__main__":
    main()
