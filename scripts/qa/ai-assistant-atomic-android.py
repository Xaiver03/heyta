#!/usr/bin/env python3
"""Installed Android journey for the assistant's atomic write tools.

This is deliberately a QA-only probe.  It drives the installed release APK
with UIAutomator/adb, starts a deterministic OpenAI-compatible fixture on the
host, and reads the emulator's SQLite op-log as a read-only oracle.  The
fixture config is written only to the QA emulator's device-prefs database: the
release APK currently has no mobile control for declaring endpoint
capabilities, so the probe records that fixture boundary in its report.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EVIDENCE = ROOT / "apps" / "mobile" / "evidence" / "ux-round6" / "tool-journey-android"
APK = ROOT / "apps" / "mobile" / "android" / "app" / "build" / "outputs" / "apk" / "release" / "app-release.apk"
PACKAGE = "com.heyta"
ACTIVITY = f"{PACKAGE}/com.heytamobile.MainActivity"
DB = f"/data/data/{PACKAGE}/databases/heyta.sqlite"
PREF_DB = f"/data/data/{PACKAGE}/databases/heyta-device-prefs.sqlite"
PORT = 4319


class ProbeError(RuntimeError):
    pass


class Fixture:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.server = ThreadingHTTPServer(("0.0.0.0", PORT), self._handler())
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, _format: str, *_args: object) -> None:
                return

            def _headers(self, status: int = 200) -> None:
                self.send_response(status)
                self.send_header("access-control-allow-origin", "*")
                self.send_header("access-control-allow-headers", "*")
                self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
                self.send_header("content-type", "application/json")
                self.end_headers()

            def do_OPTIONS(self) -> None:  # noqa: N802
                self._headers(204)

            def do_GET(self) -> None:  # noqa: N802
                if (self.path or "").startswith("/__requests"):
                    self._headers()
                    self.wfile.write(json.dumps({"count": len(fixture.calls), "calls": fixture.calls}).encode())
                    return
                self._headers(404)
                self.wfile.write(b'{"error":"not found"}')

            def do_POST(self) -> None:  # noqa: N802
                size = int(self.headers.get("content-length", "0"))
                raw = self.rfile.read(size)
                try:
                    body = json.loads(raw.decode())
                except (UnicodeDecodeError, json.JSONDecodeError):
                    self._headers(400)
                    self.wfile.write(b'{"error":"invalid json"}')
                    return
                messages = body.get("messages", []) if isinstance(body, dict) else []
                user = "\n".join(str(m.get("content", "")) for m in messages if isinstance(m, dict) and m.get("role") == "user")
                has_tool_result = any(isinstance(m, dict) and m.get("role") == "tool" for m in messages)
                call: dict[str, Any] = {"hasToolResult": has_tool_result, "toolStep": sum(1 for m in messages if isinstance(m, dict) and m.get("role") == "tool")}
                matches = re.findall(r"QA_TOOL:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)", user)
                match = matches[-1] if matches else None
                if match is not None:
                    name, encoded = match
                    try:
                        arguments = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).decode()
                        json.loads(arguments)
                    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
                        self._headers(400)
                        self.wfile.write(json.dumps({"error": f"bad fixture arguments: {error}"}).encode())
                        return
                    call.update({"name": name, "arguments": json.loads(arguments)})
                    function = {"name": name, "arguments": arguments}
                else:
                    call.update({"name": "list_tasks", "arguments": {}})
                    function = {"name": "list_tasks", "arguments": "{}"}
                fixture.calls.append(call)
                if has_tool_result:
                    message = {"role": "assistant", "content": f"已收到第 {call['toolStep']} 条工具结果。"}
                else:
                    message = {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [{"id": "android-qa", "type": "function", "function": function}],
                    }
                self._headers()
                self.wfile.write(json.dumps({"id": "android-qa", "object": "chat.completion", "model": body.get("model", "qa"), "choices": [{"index": 0, "message": message, "finish_reason": "tool_calls" if not has_tool_result else "stop"}]}).encode())

        return Handler

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", default=os.environ.get("ANDROID_SERIAL", "emulator-5554"))
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--evidence-dir", type=Path, default=Path(os.environ.get("HEYTA_ANDROID_AI_EVIDENCE", DEFAULT_EVIDENCE)))
    return parser.parse_args()


class Probe:
    def __init__(self, args: argparse.Namespace) -> None:
        self.serial = args.serial
        self.timeout = args.timeout
        self.out = args.evidence_dir
        self.out.mkdir(parents=True, exist_ok=True)
        self.steps: list[dict[str, Any]] = []

    def adb(self, *args: str, check: bool = True, timeout: int = 45) -> str:
        result = subprocess.run(["adb", "-s", self.serial, *args], capture_output=True, text=True, timeout=timeout)
        if check and result.returncode != 0:
            detail = (result.stderr or result.stdout).strip()[:500]
            raise ProbeError(f"adb {' '.join(args)} failed ({result.returncode}): {detail}")
        return result.stdout

    def shell(self, command: str, *, check: bool = True) -> str:
        return self.adb("shell", command, check=check)

    def tree(self) -> ET.Element:
        for _ in range(6):
            result = subprocess.run(["adb", "-s", self.serial, "shell", "uiautomator", "dump", "/sdcard/heyta-ai.xml"], capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                try:
                    return ET.fromstring(self.adb("exec-out", "cat", "/sdcard/heyta-ai.xml"))
                except ET.ParseError:
                    pass
            time.sleep(0.4)
        raise ProbeError("uiautomator dump failed")

    @staticmethod
    def label(node: ET.Element) -> str:
        return node.get("content-desc") or node.get("text") or ""

    @staticmethod
    def visible(node: ET.Element) -> bool:
        return node.get("visible-to-user", "true") == "true"

    @staticmethod
    def bounds(node: ET.Element) -> tuple[int, int, int, int]:
        values = [int(value) for value in re.findall(r"\d+", node.get("bounds", ""))]
        if len(values) != 4:
            raise ProbeError(f"invalid bounds: {node.attrib}")
        return tuple(values)  # type: ignore[return-value]

    def nodes(self) -> list[ET.Element]:
        return [node for node in self.tree().iter("node") if self.visible(node)]

    def find(self, *, resource: str | None = None, label: str | None = None, clickable: bool | None = None) -> list[ET.Element]:
        result = []
        for node in self.nodes():
            if resource is not None and resource not in node.get("resource-id", ""):
                continue
            if label is not None and self.label(node) != label:
                continue
            if clickable is not None and (node.get("clickable") == "true") != clickable:
                continue
            result.append(node)
        return result

    def wait(self, predicate: Callable[[list[ET.Element]], Any], description: str) -> Any:
        deadline = time.monotonic() + self.timeout
        latest: list[ET.Element] = []
        while time.monotonic() < deadline:
            latest = self.nodes()
            value = predicate(latest)
            if isinstance(value, ET.Element) or value:
                return value
            time.sleep(0.35)
        labels = [self.label(node) for node in latest if self.label(node)]
        raise ProbeError(f"timed out waiting for {description}; visible={labels[:80]!r}")

    def wait_resource(self, resource: str, *, clickable: bool | None = None) -> ET.Element:
        def candidate(nodes: list[ET.Element]) -> ET.Element | None:
            for node in nodes:
                if resource not in node.get("resource-id", ""):
                    continue
                if clickable is not None and (node.get("clickable") == "true") != clickable:
                    continue
                left, top, right, bottom = self.bounds(node)
                if right > left and bottom > top and bottom > 210 and top < 2400:
                    return node
            return None

        return self.wait(candidate, f"resource {resource}")

    def current_resource(self, resource: str, *, clickable: bool | None = None) -> ET.Element | None:
        for node in self.nodes():
            if resource not in node.get("resource-id", ""):
                continue
            if clickable is not None and (node.get("clickable") == "true") != clickable:
                continue
            left, top, right, bottom = self.bounds(node)
            if right > left and bottom > top and bottom > 210 and top < 2400:
                return node
        return None

    def wait_label(self, label: str, *, clickable: bool | None = None) -> ET.Element:
        return self.wait(lambda nodes: next((node for node in nodes if self.label(node) == label and (clickable is None or (node.get("clickable") == "true") == clickable)), None), f"label {label}")

    def tap(self, node: ET.Element) -> None:
        left, top, right, bottom = self.bounds(node)
        self.shell(f"input tap {(left + right) // 2} {(top + bottom) // 2}")

    def tap_resource(self, resource: str) -> None:
        self.tap(self.wait_resource(resource, clickable=True))

    def tap_label(self, label: str) -> None:
        self.tap(self.wait_label(label, clickable=True))

    def select_tab(self, label: str) -> None:
        """Select a root tab and wait for its accessibility selected state."""
        for _ in range(3):
            selected = next(
                (
                    node
                    for node in self.nodes()
                    if self.label(node) == label
                    and node.get("clickable") == "true"
                    and node.get("selected") == "true"
                ),
                None,
            )
            if selected is not None:
                return
            self.tap_label(label)
            time.sleep(0.35)
        self.wait(
            lambda nodes: next(
                (
                    node
                    for node in nodes
                    if self.label(node) == label
                    and node.get("clickable") == "true"
                    and node.get("selected") == "true"
                ),
                None,
            ),
            f"selected tab {label}",
        )

    def swipe(self, y1: int, y2: int) -> None:
        self.shell(f"input swipe 540 {y1} 540 {y2} 450")

    def type_ascii(self, text: str) -> None:
        # Keep the command quoted at the device shell.  `%s` is Android's
        # documented space escape; all journey text is otherwise ASCII.
        if "'" in text:
            raise ProbeError("fixture text unexpectedly contains apostrophe")
        escaped = text.replace(" ", "%s")
        self.shell(f"input text '{escaped}'")

    def fill_resource(self, resource: str, text: str) -> None:
        field = self.wait_resource(resource)
        self.tap(field)
        self.shell("input keyevent 123")
        self.shell("input keyevent --longpress 67")
        self.type_ascii(text)

    def screenshot(self, name: str) -> None:
        if "_" in name:
            raise ProbeError(f"first-use/evidence screenshot names may not contain underscores: {name}")
        data = subprocess.run(["adb", "-s", self.serial, "exec-out", "screencap", "-p"], capture_output=True, timeout=30).stdout
        if not data:
            raise ProbeError(f"empty screenshot: {name}")
        (self.out / f"{name}.png").write_bytes(data)

    def record(self, name: str, **details: Any) -> None:
        self.steps.append({"name": name, "status": "passed", "at": time.time(), **details})
        self.screenshot(name)

    def sql(self, statement: str) -> str:
        return self.shell(f"sqlite3 {DB} {json.dumps(statement)}").strip()

    def op_snapshot(self) -> dict[str, Any]:
        count_text = self.sql("select count(*) from ops;")
        last = self.sql("select data from ops order by ix1_0 desc limit 1;") if count_text != "0" else ""
        parsed: Any = None
        if last:
            try:
                parsed = json.loads(last)
            except json.JSONDecodeError:
                parsed = last
        return {"opCount": int(count_text or "0"), "last": parsed}

    def patch_fixture(self) -> None:
        settings = {
            "routing": {
                "enabled": True,
                "allowRemote": False,
                "endpoints": [{"id": "android-qa", "label": "Android QA fixture", "endpoint": f"http://localhost:{PORT}/v1", "model": "android-qa", "capabilities": ["tool_calling"]}],
                "routes": {"tool-calling": [{"endpointId": "android-qa"}]},
            },
            "localApi": {"enabled": False, "bindAddress": "127.0.0.1", "port": 47119},
            "consents": [],
            "memoryEnabled": False,
            "assistantTier": "read-and-propose",
            "health": {"version": 1, "entries": []},
        }
        encoded = base64.b64encode(json.dumps(settings, ensure_ascii=False, separators=(",", ":")).encode()).decode()
        self.shell(f"echo {encoded} | base64 -d > /data/local/tmp/heyta-ai-settings.json")
        statement = f"insert or replace into device_pref(key,value) values('heyta.ai.settings',cast(readfile('/data/local/tmp/heyta-ai-settings.json') as text));"
        self.adb("shell", f"sqlite3 {PREF_DB} {json.dumps(statement)}")
        self.shell("rm -f /data/local/tmp/heyta-ai-settings.json")
        self.adb("reverse", f"tcp:{PORT}", f"tcp:{PORT}")

    def launch(self) -> None:
        self.shell(f"am force-stop {PACKAGE}")
        self.adb("shell", "am", "start", "-W", "-n", ACTIVITY)
        time.sleep(1.5)

    def first_use(self) -> None:
        self.wait_label("同意并联网", clickable=True)
        self.record("first-use-before")
        self.tap_label("同意并联网")
        self.wait_label("先离线使用", clickable=True)
        self.record("first-use-after-consent")
        self.tap_label("先离线使用")
        self.wait_label("任务", clickable=True)

    def create_task(self, title: str) -> str:
        print(f"[qa] create {title}", flush=True)
        self.tap_label("新建任务")
        field = self.wait_resource("capture-input")
        self.tap(field)
        self.type_ascii(title)
        self.tap(self.wait_label("添加", clickable=True))
        row = self.wait(lambda nodes: next((node for node in nodes if node.get("resource-id", "").find("task-row-") >= 0 and self.label(node) == f"打开任务：{title}"), None), f"task row {title}")
        resource = row.get("resource-id", "")
        marker = "task-row-"
        return resource[resource.rfind(marker) + len(marker):]

    def open_assistant(self) -> None:
        print("[qa] open assistant", flush=True)
        self.tap_label("我的")
        self.wait_resource("profile-entry-settings", clickable=True)
        for _ in range(5):
            if self.current_resource("profile-entry-assistant", clickable=True) is not None:
                break
            self.swipe(1850, 600)
        self.wait_resource("profile-entry-assistant", clickable=True)
        self.tap_resource("profile-entry-assistant")
        self.wait_resource("assistant-screen")
        self.wait_resource("ai-assistant-input")

    def send_tool(self, name: str, arguments: dict[str, Any]) -> None:
        print(f"[qa] send {name}", flush=True)
        payload = base64.urlsafe_b64encode(json.dumps(arguments, separators=(",", ":")).encode()).decode().rstrip("=")
        self.fill_resource("ai-assistant-input", f"QA_TOOL:{name}:{payload}")
        self.tap_resource("ai-assistant-send-button")
        # Remote tool calls show an explicit egress disclosure before the
        # proposal.  Local/direct routes may go straight to the proposal, so
        # accept either state and only tap the disclosure when it is present.
        def disclosure_or_proposal(nodes: list[ET.Element]) -> ET.Element | None:
            for node in nodes:
                resource = node.get("resource-id", "")
                if "assistant-disclosure-send" in resource or "assistant-confirm-proposal" in resource:
                    if node.get("clickable") == "true":
                        return node
            return None

        first = self.wait(disclosure_or_proposal, "assistant disclosure or proposal")
        if "assistant-disclosure-send" in first.get("resource-id", ""):
            self.tap(first)
        self.wait_resource("assistant-confirm-proposal", clickable=True)

    def confirm_tool(self, name: str, before: dict[str, Any], expected_text: str, forbidden_text: str | None = None) -> dict[str, Any]:
        labels = [self.label(node) for node in self.nodes()]
        if not any(expected_text in label for label in labels):
            raise ProbeError(f"proposal for {name} did not contain {expected_text!r}; labels={labels[-60:]!r}")
        if forbidden_text is not None and any(forbidden_text in label for label in labels):
            raise ProbeError(f"proposal for {name} contained forbidden raw value {forbidden_text!r}")
        self.record(f"{name}-proposal", before=before, expectedText=expected_text)
        if self.op_snapshot()["opCount"] != before["opCount"]:
            raise ProbeError(f"proposal {name} changed op-log before confirmation")
        self.tap_resource("assistant-confirm-proposal")
        self.wait_label("已执行")
        deadline = time.monotonic() + self.timeout
        after = self.op_snapshot()
        while time.monotonic() < deadline and after["opCount"] < before["opCount"] + 1:
            time.sleep(0.35)
            after = self.op_snapshot()
        if after["opCount"] != before["opCount"] + 1:
            raise ProbeError(f"{name} expected exactly one op, before={before}, after={after}")
        self.record(f"{name}-confirmed", after=after)
        return after

    def run(self) -> dict[str, Any]:
        print("[qa] clean/start", flush=True)
        # A clean installed-state run is required for first-use evidence and a
        # deterministic op baseline.  This only clears the QA emulator.
        self.shell(f"pm clear {PACKAGE}")
        self.launch()
        self.first_use()
        print("[qa] patch fixture", flush=True)
        self.patch_fixture()
        self.launch()
        self.wait_label("任务", clickable=True)
        stamp = str(int(time.time()))
        task_a = f"AndroidAtomicA{stamp}"
        task_b = f"AndroidAtomicB{stamp}"
        task_c = f"AndroidAtomicC{stamp}"
        task_a_id = self.create_task(task_a)
        task_b_id = self.create_task(task_b)
        task_c_id = self.create_task(task_c)
        self.record("capture-created", taskA=task_a, taskB=task_b, taskC=task_c, taskAId=task_a_id, taskBId=task_b_id, taskCId=task_c_id)
        self.open_assistant()
        before = self.op_snapshot()
        self.send_tool("append_task_checklist", {"taskId": task_a_id, "items": ["Check login"]})
        after_checklist = self.confirm_tool("append-checklist", before, "Check login")
        self.send_tool("set_task_priorities", {"entries": [{"taskId": task_a_id, "priority": "high"}, {"taskId": task_b_id, "priority": "low"}]})
        after_priority = self.confirm_tool("batch-priority", after_checklist, "高")
        self.send_tool("set_task_estimate", {"taskId": task_a_id, "minutes": 999})
        after_estimate = self.confirm_tool("estimate-normalized", after_priority, "480", "999")

        # Draft survives a root-tab round trip while the assistant stack stays mounted.
        draft_payload = base64.urlsafe_b64encode(json.dumps({"taskId": task_c_id, "fields": {"title": "AndroidAtomicCUpdated", "priority": "medium"}}, separators=(",", ":")).encode()).decode().rstrip("=")
        draft = f"QA_TOOL:update_task:{draft_payload}"
        self.fill_resource("ai-assistant-input", draft)
        # The focused composer may still have the IME open; dismiss it before
        # tapping a bottom-tab target below the resized assistant viewport.
        self.shell("input keyevent 4")
        # The assistant is a pushed profile route.  Pop it first; changing the
        # root tab underneath a pushed route leaves the assistant visible and
        # makes the tab switch look successful only in accessibility state.
        self.tap_label("返回")
        self.wait_resource("profile-entry-settings", clickable=True)
        self.select_tab("任务")
        self.select_tab("我的")
        self.wait_resource("profile-entry-settings", clickable=True)
        for _ in range(5):
            if self.current_resource("profile-entry-assistant", clickable=True) is not None:
                break
            self.swipe(1850, 600)
        self.wait_resource("profile-entry-assistant", clickable=True)
        self.tap_resource("profile-entry-assistant")
        self.wait_resource("assistant-screen")
        field = self.wait_resource("ai-assistant-input")
        if draft not in self.label(field) and field.get("text", "") != draft:
            raise ProbeError("assistant draft did not survive switching bottom tabs")
        before_update = after_estimate
        self.tap_resource("ai-assistant-send-button")
        def proposal_or_auto(nodes: list[ET.Element]) -> ET.Element | bool | None:
            for node in nodes:
                if "assistant-confirm-proposal" in node.get("resource-id", "") and node.get("clickable") == "true":
                    return node
            if self.op_snapshot()["opCount"] == before_update["opCount"] + 1:
                return True
            return None

        update_outcome = self.wait(proposal_or_auto, "multi-field update proposal or execution")
        if isinstance(update_outcome, ET.Element):
            after_update = self.confirm_tool("multi-field-update", before_update, "更新")
        else:
            after_update = self.op_snapshot()
            if after_update["opCount"] != before_update["opCount"] + 1:
                raise ProbeError(f"multi-field-update expected exactly one op, before={before_update}, after={after_update}")
            self.record("multi-field-update-auto", after=after_update)

        self.send_tool("complete_task", {"taskIds": [task_a_id, task_b_id]})
        after_complete = self.confirm_tool("batch-complete", after_update, "2")
        self.record("journey-finished", final=after_complete)
        return {"status": "passed", "serial": self.serial, "steps": self.steps, "fixtureCalls": fixture.calls if (fixture := getattr(self, "fixture", None)) is not None else []}


def artifact() -> dict[str, Any]:
    data = APK.read_bytes()
    signer = "/opt/homebrew/share/android-commandlinetools/build-tools/36.0.0/apksigner"
    result = subprocess.run([signer, "verify", "--print-certs", str(APK)], capture_output=True, text=True, timeout=30)
    digest = re.search(r"Signer #1 certificate SHA-256 digest: ([0-9a-f]+)", result.stdout)
    subject = re.search(r"Signer #1 certificate DN: (.+)", result.stdout)
    return {"path": str(APK), "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "apksignerExitCode": result.returncode, "certificateSha256": digest.group(1) if digest else None, "certificateSubject": subject.group(1).strip() if subject else None}


def main() -> int:
    args = parse_args()
    probe = Probe(args)
    fixture = Fixture()
    probe.fixture = fixture  # type: ignore[attr-defined]
    report = args.evidence_dir / "journey.json"
    try:
        fixture.start()
        result = probe.run()
        result["apk"] = artifact()
        report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"status": "passed", "report": str(report)}, ensure_ascii=False))
        return 0
    except Exception as error:
        try:
            probe.screenshot("failure")
        except Exception:
            pass
        failure = {"status": "failed", "serial": args.serial, "error": str(error), "steps": probe.steps, "fixtureCalls": fixture.calls, "apk": artifact()}
        report.write_text(json.dumps(failure, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"status": "failed", "report": str(report), "error": str(error)}, ensure_ascii=False))
        return 1
    finally:
        fixture.stop()


if __name__ == "__main__":
    raise SystemExit(main())
