#!/usr/bin/env python3
"""Offline iOS acceptance journey for Profile -> Settings IA.

This probe deliberately stays at the accessibility-tree layer.  It does not
sign in, enter credentials, change settings, export data, or delete anything.
Every tap is followed by a fresh AX-tree assertion; an idb exit code alone is
never treated as a product assertion.

The existing ``ios-ax-shim.py`` owns AX-tree retries and device geometry.  This
file only composes that vocabulary into the product journey so the journey can
be rerun after a fresh install without taking over the Simulator window.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[2]
SHIM_PATH = ROOT / "scripts" / "tools" / "ios-ax-shim.py"
DEFAULT_EVIDENCE = ROOT / "apps" / "mobile" / "evidence" / "profile-center"


def load_shim():
    spec = importlib.util.spec_from_file_location("heyta_ios_ax_shim", SHIM_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load AX shim: {SHIM_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


AX = load_shim()


class JourneyError(RuntimeError):
    pass


def labels(nodes: Iterable[dict[str, Any]]) -> list[str]:
    return [value for node in nodes if (value := AX.label_of(node))]


def T(zh: str, en: str) -> tuple[str, str]:
    """One on-screen label in both languages it can render in (same i18n key)."""
    return (zh, en)


def any_of(*pairs: tuple[str, str]) -> list[str]:
    # A launch state has several possible labels, but `check:locator-labels`
    # judges every Chinese x English combination inside one group against the
    # 词条真源, so labels of different keys cannot share a group: 一个组 = 一枚标签的两种语态.
    return [label for pair in pairs for label in pair]


def present(nodes: list[dict[str, Any]], candidates: Iterable[str], *, pressable: bool = False) -> str | None:
    for candidate in candidates:
        node = AX.find(nodes, candidate, pressable, False, None, False, 0)
        if node is not None:
            return AX.label_of(node) or candidate
    return None


class Probe:
    def __init__(self, args: argparse.Namespace) -> None:
        self.idb = args.idb
        self.companion = args.companion
        self.udid = args.udid
        self.timeout = args.timeout
        self.evidence_dir = Path(args.evidence_dir)
        self.steps: list[dict[str, Any]] = []

    def tree(self) -> list[dict[str, Any]]:
        return AX.dump_nodes(self.idb, self.companion, self.udid, attempts=3)

    def wait_for(
        self,
        candidates: Iterable[str],
        *,
        pressable: bool = False,
        absent: Iterable[str] = (),
    ) -> tuple[dict[str, Any], list[dict[str, Any]], str]:
        wanted = tuple(candidates)
        forbidden = tuple(absent)
        deadline = time.monotonic() + self.timeout
        last: list[dict[str, Any]] = []
        while time.monotonic() <= deadline:
            last = self.tree()
            if forbidden and any(present(last, (item,)) is not None for item in forbidden):
                time.sleep(0.25)
                continue
            for candidate in wanted:
                node = AX.find(last, candidate, pressable, False, None, False, 0)
                if node is not None:
                    return node, last, AX.label_of(node) or candidate
            time.sleep(0.35)
        visible = labels(last)
        raise JourneyError(
            f"timed out waiting for {wanted!r}; pressable={pressable}; "
            f"visible labels={visible[:80]!r}"
        )

    def wait_for_any_label(self, candidates: Iterable[str]) -> list[dict[str, Any]]:
        """Wait for one of the launch states without requiring a fixed first tap."""
        wanted = tuple(candidates)
        deadline = time.monotonic() + self.timeout
        last: list[dict[str, Any]] = []
        while time.monotonic() <= deadline:
            last = self.tree()
            if any(present(last, (candidate,)) is not None for candidate in wanted):
                return last
            time.sleep(0.35)
        raise JourneyError(f"timed out waiting for a launch state {wanted!r}; visible labels={labels(last)[:80]!r}")

    def wait_for_all(self, candidates: Iterable[str]) -> list[dict[str, Any]]:
        wanted = tuple(candidates)
        deadline = time.monotonic() + self.timeout
        last: list[dict[str, Any]] = []
        while time.monotonic() <= deadline:
            last = self.tree()
            if all(present(last, (candidate,)) is not None for candidate in wanted):
                return last
            time.sleep(0.35)
        missing = [candidate for candidate in wanted if present(last, (candidate,)) is None]
        raise JourneyError(f"timed out waiting for all labels {missing!r}; visible labels={labels(last)[:80]!r}")

    def record(self, name: str, status: str, **details: Any) -> None:
        self.steps.append({"name": name, "status": status, "at": time.time(), **details})

    def assert_visible(self, name: str, candidates: Iterable[str]) -> list[dict[str, Any]]:
        tree = self.wait_for_all(candidates)
        self.record(name, "passed", expected=list(candidates), labels=labels(tree)[:100])
        return tree

    def tap(self, name: str, candidates: Iterable[str], then: Iterable[str], *, absent: Iterable[str] = ()) -> None:
        wanted = tuple(candidates)
        node, before, matched = self.wait_for(wanted, pressable=True)
        # AX can expose the destination before a native Modal transition finishes.
        time.sleep(0.5)
        node, before, matched = self.wait_for(wanted, pressable=True)
        x, y = AX.center(node)
        try:
            result = subprocess.run(
                [self.idb, *AX.companion_args(self.companion), "ui", "tap", str(x), str(y), "--udid", self.udid],
                capture_output=True,
                text=True,
                timeout=60,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            self.record(name, "failed", target=matched, error=f"tap transport: {exc}")
            raise JourneyError(f"tap transport failed for {matched!r}: {exc}") from exc
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()[:300]
            self.record(name, "failed", target=matched, error=f"tap rc={result.returncode}: {detail}")
            raise JourneyError(f"tap returned rc={result.returncode} for {matched!r}: {detail}")
        # The tap command's success is not the assertion.  wait_for performs a
        # new describe-all and requires the destination state to be present.
        _, after, destination = self.wait_for(then, absent=absent)
        self.record(
            name,
            "passed",
            target=matched,
            targetFrame=list(AX.frame_of(node)),
            beforeLabels=labels(before)[:100],
            destination=destination,
            afterLabels=labels(after)[:100],
        )

    def screenshot(self, name: str) -> None:
        self.evidence_dir.mkdir(parents=True, exist_ok=True)
        path = self.evidence_dir / f"{name}.png"
        result = subprocess.run(
            [self.idb, *AX.companion_args(self.companion), "screenshot", "--udid", self.udid, str(path)],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0 or not path.exists() or path.stat().st_size == 0:
            # simctl is a read-only screenshot fallback; it does not depend on
            # Simulator.app being visible or in the foreground.
            fallback = subprocess.run(
                ["xcrun", "simctl", "io", self.udid, "screenshot", str(path)],
                capture_output=True,
                text=True,
                timeout=60,
            )
            if fallback.returncode != 0 or not path.exists() or path.stat().st_size == 0:
                detail = (result.stderr or fallback.stderr or result.stdout or "").strip()[:300]
                self.record(name + " screenshot", "failed", path=str(path), error=detail)
                raise JourneyError(f"could not capture {name} screenshot: {detail}")
        self.record(name + " screenshot", "passed", path=str(path), bytes=path.stat().st_size)

    def scroll_to(self, name: str, candidates: Iterable[str]) -> None:
        wanted = tuple(candidates)
        result = AX.scroll_into_view(self.idb, self.companion, self.udid, wanted[0], True, False, None)
        if result.get("visible") != "True":
            self.record(name, "failed", target=list(wanted), result=result)
            raise JourneyError(f"could not scroll {wanted!r} into view: {result}")
        self.wait_for(wanted, pressable=True)
        self.record(name, "passed", target=list(wanted), result=result)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--udid", default=os.environ.get("IOS_UDID", ""))
    parser.add_argument(
        "--idb",
        default=os.environ.get("IDB_BIN", str(Path.home() / ".heyta-tools/idb/venv/bin/idb")),
    )
    parser.add_argument(
        "--companion",
        default=os.environ.get("IDB_COMPANION", str(Path.home() / ".heyta-tools/idb/idb_companion")),
    )
    parser.add_argument("--timeout", type=float, default=8.0)
    parser.add_argument(
        "--evidence-dir",
        default=os.environ.get("HEYTA_PROFILE_EVIDENCE_DIR", str(DEFAULT_EVIDENCE)),
        help="directory for screenshots and settings-ia-journey.json",
    )
    return parser.parse_args()


def run(probe: Probe) -> None:
    # Fresh install journey is privacy sheet -> welcome -> app.  The probe is
    # also rerunnable on an existing home screen, so inspect the current AX
    # state before deciding whether either onboarding tap is needed.
    # Each English candidate is read from packages/i18n/src/locales/en.ts under
    # the same key its Chinese twin lives on (mobile.tab.tasks / .profile,
    # common.privacy.consent.localOnly, mobile.welcome.offline) — not guessed
    # from the screen name.  Chinese stays first so a zh device behaves exactly
    # as before.
    launch_tree = probe.wait_for_any_label(
        any_of(
            T("只用本机", "This device only"),
            T("先离线使用", "Use offline for now"),
            T("任务", "Tasks"),
            T("我的", "Profile"),
        )
    )
    if present(launch_tree, T("只用本机", "This device only"), pressable=True) is not None:
        # This label is sourced from common.privacy.consent.localOnly.  It is
        # the privacy sheet action, not the later welcome-page offline action.
        probe.tap(
            "choose local-only privacy",
            T("只用本机", "This device only"),
            ("先离线使用",),
        )
        launch_tree = probe.wait_for_any_label(
            any_of(
                T("先离线使用", "Use offline for now"),
                T("任务", "Tasks"),
                T("我的", "Profile"),
            )
        )

    if present(launch_tree, T("先离线使用", "Use offline for now"), pressable=True) is not None:
        probe.tap(
            "choose offline",
            T("先离线使用", "Use offline for now"),
            ("任务", "我的"),
        )
    else:
        # 「引导已经走完」和「这两枚中文定位符没命中（例如界面不是中文）」在两棵 AX 树上长得
        # 一模一样，所以以前这一支无条件记 `passed` —— 那是把探针没走到被测路径当成验收通过。
        # 能区分两者的可观测形状只有一个：真走完引导的那棵树里必然读得到首页标签。
        onboarded = (
            present(
                launch_tree,
                any_of(T("任务", "Tasks"), T("我的", "Profile")),
                pressable=True,
            )
            is not None
        )
        probe.record(
            "onboarding already complete",
            "passed" if onboarded else "home-labels-absent",
            labels=labels(launch_tree)[:100],
        )
        if not onboarded:
            raise JourneyError(
                "onboarding labels were not found and the home tab is not visible either; "
                f"visible labels={labels(launch_tree)[:80]!r}"
            )

    # The screenshot is intentionally taken only after the Profile tab is
    # active; a fresh install otherwise captures the default Tasks tab.
    probe.tap(
        "open profile tab",
        ("我的", "Profile"),
        ("设置, 个人资料、偏好、同步与安全", "设置", "Settings"),
    )
    probe.screenshot("my")
    probe.tap(
        "open settings directory",
        ("设置, 个人资料、偏好、同步与安全", "设置", "Settings"),
        ("常规", "General"),
    )
    # The current acceptance fixture is zh-CN.  English candidates remain on
    # individual taps for diagnostics, while the group assertion is explicitly
    # Chinese so a locale mismatch cannot masquerade as a passed IA check.
    probe.assert_visible("settings directory", ("常规", "同步与隐私", "AI 与集成", "数据管理", "账号安全"))
    probe.screenshot("settings-directory")

    probe.tap("open general", ("常规", "General"), ("语言", "Language"))
    probe.screenshot("general")
    probe.tap("general back to directory", ("返回", "Back"), ("常规", "General"))

    # `隐私同意` is the current Chinese value of common.privacy.settings.title.
    # The `then` slot stays Chinese-only on purpose: it is the arrival assertion,
    # and a one-language assertion fails closed ("语言不对" cannot masquerade as
    # "IA 通过") — see the settings-directory comment above.
    probe.tap("open sync and privacy", ("同步与隐私", "Sync and privacy"), ("隐私同意",))
    probe.screenshot("sync")
    probe.tap("sync back to directory", ("返回", "Back"), ("同步与隐私", "Sync and privacy"))

    # 移动端那一屏**没有**「导出数据」这个标题 —— `导出数据`/`Export data` 是
    # `web.export.title`；移动端的入口与页头都是 `mobile.export.entry`/`.title`
    # =「备份与迁移」/「Backup & migration」。原先两处都按 web 那一列定位，
    # 于是这一步在中英文两种语态下都永远打不中（与 Android 那条脚本同一件事）。
    probe.tap("open data management", ("数据管理", "Data management", "Data"), ("备份与迁移", "Backup & migration"))
    probe.tap(
        "open export screen",
        ("备份与迁移", "Backup & migration"),
        ("返回", "Back"),
        absent=("数据管理", "Data management", "Data"),
    )
    probe.tap("export back to data group", ("返回", "Back"), ("数据管理", "Data management", "Data"))
    probe.tap("data group back to directory", ("返回", "Back"), ("常规", "General"))
    probe.tap("close settings to profile", ("关闭", "Close"), ("我的", "Profile"), absent=("偏好与账号", "Preferences and account"))

    probe.tap("open full growth", ("查看完整成长", "View full growth"), ("我的成长", "My growth"))
    probe.screenshot("growth")
    probe.tap("growth back to profile", ("返回", "Back"), ("我的", "Profile"))

    probe.scroll_to("scroll lists entry", ("清单", "Lists"))
    # `absent` is an assertion slot too, so it stays Chinese-only here.  Note the
    # asymmetry for whoever resolves the pair/OR 口径: a one-language `then` fails
    # closed, while a one-language `absent` on an English screen would be vacuous
    # (the forbidden header reads "Organize and capture" there, so the check could
    # never fire).  Today the script cannot reach this line in English because the
    # `then` slots above it fail first — that premise is what keeps this safe.
    probe.tap("open lists", ("清单", "Lists"), ("清单", "Lists"), absent=("整理与记录",))
    probe.tap("lists back to profile", ("返回", "Back"), ("我的", "Profile"))


def main() -> int:
    args = parse_args()
    if not args.udid:
        print("--udid is required (or set IOS_UDID)", file=sys.stderr)
        return 2
    probe = Probe(args)
    report_path = Path(args.evidence_dir) / "settings-ia-journey.json"
    status = "failed"
    error: str | None = None
    try:
        run(probe)
        status = "passed"
    except (JourneyError, OSError, subprocess.SubprocessError) as exc:
        status = "failed"
        error = str(exc)
        probe.steps.append({"name": "journey", "status": "failed", "error": error, "at": time.time()})
    finally:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(
                {
                    "status": status,
                    "udid": args.udid,
                    "idb": args.idb,
                    "companion": args.companion,
                    "journey": "offline-profile-settings-ia",
                    "steps": probe.steps,
                    "error": error,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    print(json.dumps({"status": status, "report": str(report_path), "error": error}, ensure_ascii=False))
    return 0 if status == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
