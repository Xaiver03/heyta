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


# 设置目录那一屏的五枚分组标题，按语态各成一组。
# 🔴 两组不许合并成一枚元组：`check:locator-labels` 会把一枚元组里**每一枚中文 × 每一枚英文**
# 交叉配回词条键（一个组=一枚标签的两种语态），合写会让「常规」去配 "Sync and privacy" 而红。
# 英文那一侧逐字取自 `packages/i18n/src/locales/en.ts` 上与中文同键的值
# （mobile.settings.section.general/.sync/.ai/.data/.security），不是照屏面猜的。
# ⚠️ `check:locator-labels` 对这一枚脚本披露的"1 组候选整片只有一种语态"就是 `zh` 那一组：
# 门把每一枚元组当一个组，两档分开写才会红在配对上 —— 这条披露是**形状**，不是欠项。
DIRECTORY_GROUPS = {
    "zh": ("常规", "同步与隐私", "AI 与集成", "数据管理", "账号安全"),
    "en": ("General", "Sync and privacy", "AI and integrations", "Data management", "Account security"),
}


def present(nodes: list[dict[str, Any]], candidates: Iterable[str], *, pressable: bool = False) -> str | None:
    for candidate in candidates:
        node = AX.find(nodes, candidate, pressable, False, None, False, 0)
        if node is not None:
            return AX.label_of(node) or candidate
    return None


def require_appearance(udid: str, evidence_dir: str) -> str:
    """`--evidence-dir` 的末级名声称明暗档时，先跟设备当前档比，不符就拒写。

    实现只有一份，住在 `ai-face-ios.py`（#472 第二半），`account-face-ios.py` 也是这么复用的 ——
    抄一份等于把它的坑复制一份。但在**本模块导入时**不能载入 ai-face：它自己一导入就去载
    `heyta_profile_settings_ios`，两边在模块顶层互载会撞上"对方还没定义到我要的那一枚属性"，
    所以这一枚放在调用时才载入（`sys.modules` 命中就复用，不重复执行）。
    """
    key = "heyta_ai_face_ios"
    if (cached := sys.modules.get(key)) is not None:
        return cached.require_appearance(udid, evidence_dir)
    spec = importlib.util.spec_from_file_location(key, ROOT / "scripts" / "qa" / "ai-face-ios.py")
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load ai-face-ios for the appearance gate: {ROOT / 'scripts/qa/ai-face-ios.py'}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[key] = module
    spec.loader.exec_module(module)
    return module.require_appearance(udid, evidence_dir)


class Probe:
    def __init__(self, args: argparse.Namespace) -> None:
        self.idb = args.idb
        self.companion = args.companion
        self.udid = args.udid
        self.timeout = args.timeout
        self.evidence_dir = Path(args.evidence_dir)
        self.language = getattr(args, "language", "zh")
        self.appearance = ""
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

    def assert_directory_language(self, language: str) -> list[dict[str, Any]]:
        """要求 `--language` 声明的那一档**整组五枚分组标题**都在场。

        这一条同时守两件事（以前只守了前一件）：
        1. IA —— 五枚分组标题少一枚就红；
        2. 🔴 语态 —— 期望档整组读不到就红。原先这里是写死的**中文**候选（注释说"单语才 fail-closed，
           语言不对不能伪装成 IA 通过"），后果是**英文档整条旅程在设置目录那一步就断**，
           个人资料/设置面因此从来没有装机态英文读数。fail-closed 的性质由"整组齐"继承，
           不再由"只认中文"继承。

        失败文本里回读**哪一档整组在场**，就是给 #488 那句"判语言档只许看 AX 树里的标签，不许看系统域"
        留一条现成的对照：`AppleLanguages` 说什么不算，这一行说屏幕是什么才算。
        """
        wanted = tuple(DIRECTORY_GROUPS[language])
        deadline = time.monotonic() + self.timeout
        last: list[dict[str, Any]] = []
        while True:
            last = self.tree()
            if all(present(last, (label,)) is not None for label in wanted):
                break
            if time.monotonic() > deadline:
                missing = [label for label in wanted if present(last, (label,)) is None]
                complete = [lang for lang, group in DIRECTORY_GROUPS.items()
                            if all(present(last, (label,)) is not None for label in group)]
                raise JourneyError(
                    f"settings directory is missing {language!r} group labels {missing!r}; "
                    f"languages whose whole group IS visible on screen={complete!r} "
                    f"(if that is not {language!r}, the in-app switch is not where --language says — trap #488); "
                    f"visible labels={labels(last)[:80]!r}"
                )
            time.sleep(0.35)
        also = [lang for lang, group in DIRECTORY_GROUPS.items()
                if lang != language and all(present(last, (label,)) is not None for label in group)]
        self.record("settings directory", "passed", language=language,
                    expected=list(wanted), otherLanguageAlsoComplete=also, labels=labels(last)[:100])
        return last

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
        # 🔴 每一枚候选都要单独试滚：`AX.scroll_into_view` 只吃**一枚**标签，
        # 以前这里传死 `wanted[0]`（中文那枚），所以英文屏上「清单」根本不在树里，
        # 量具回 `found=False / scrollRc=element-left-tree` —— 那是**装置的病**，不是界面的病
        # （2026-10-19 英文档实测：旅程 22 步全绿，只有这一步红）。
        wanted = tuple(candidates)
        last_result: dict[str, Any] = {}
        for target in wanted:
            result = AX.scroll_into_view(self.idb, self.companion, self.udid, target, True, False, None)
            if result.get("visible") == "True":
                self.wait_for(wanted, pressable=True)
                self.record(name, "passed", target=[target], tried=list(wanted), result=result)
                return
            last_result = result
        self.record(name, "failed", target=list(wanted), result=last_result)
        raise JourneyError(f"could not scroll {wanted!r} into view: {last_result}")


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
    # 这一枚声明的是**界面应该处于的应用内语态**：与 AX 树里整组分组标题不符就红（陷阱 #488）。
    # help 写英文是因为 `check:locator-labels` 把**单行**中文字符串当一枚界面定位标签来查真源。
    parser.add_argument("--language", choices=("zh", "en"), default="zh", help="in-app UI language this run expects")

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
        # 2026-10-19: 这两处 `then` 原来只有中文，于是**引导还没走完的英文首屏**会死在这里，
        # 连后面那枚语态断言都读不到。到达判据的 fail-closed 现在由整组分组标题那一步守。
        probe.tap(
            "choose local-only privacy",
            T("只用本机", "This device only"),
            ("先离线使用", "Use offline for now"),
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
            any_of(T("任务", "Tasks"), T("我的", "Profile")),
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
    # 🔴 这一格以前写死中文候选，理由是那枚注释说的"语言不对不能伪装成 IA 通过"。
    # 现在的形状：`--language` 声明哪档，就要求**那一档的五枚分组标题整组在场**，
    # 整组不齐就红 —— fail-closed 保住了，而英文档第一次能走到这一步之后（陷阱 #488：
    # 语态只认 AX 树里的标签，不认系统域 `AppleLanguages`）。
    probe.assert_directory_language(probe.language)
    probe.screenshot("settings-directory")

    probe.tap("open general", ("常规", "General"), ("语言", "Language"))
    probe.screenshot("general")
    probe.tap("general back to directory", ("返回", "Back"), ("常规", "General"))

    # `隐私同意` / `Privacy consent` 是 common.privacy.settings.title 的两种语态。
    # 2026-10-19 之前这里的 `then` 槽只有中文，注释写的是"单语 fail-closed"；那件事现在
    # 由上面那一整组分组标题的语态断言来守（期望语态整组不齐就红），所以这一格可以双语，
    # 而 fail-closed 不降级。
    probe.tap("open sync and privacy", ("同步与隐私", "Sync and privacy"), ("隐私同意", "Privacy consent"))
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
    # `absent` 也是断言槽，所以它必须**两种语态都在**：只写中文时，英文屏上那行
    # 「Organize and capture」根本不会被禁 —— 这一格以前是**空的判据**（永远不咬），
    # 而它当时安全的前提是"英文档走不到这一行"。那个前提上面已经取消了，所以这里补齐。
    probe.tap("open lists", ("清单", "Lists"), ("清单", "Lists"), absent=("整理与记录", "Organize and capture"))
    probe.tap("lists back to profile", ("返回", "Back"), ("我的", "Profile"))


def main() -> int:
    args = parse_args()
    if not args.udid:
        print("--udid is required (or set IOS_UDID)", file=sys.stderr)
        return 2
    # 档名与设备当前档不符就拒写，写之前、一行旅程都不走（见 `require_appearance`）。
    appearance = require_appearance(args.udid, args.evidence_dir)
    # 起跳点自己造：这一枚以前不重启 app，所以**上一趟红在设置模态里**时，手就留在「设置」那一屏，
    # 下一趟量到的不是首页（2026-10-19 实测：反臂那趟红在语态断言上，紧接着的正常趟就死在首屏等待）。
    # `ai-face-ios.py` 与 `account-face-ios.py` 都有这一步，三面里只有这一面漏了。
    subprocess.run(["xcrun", "simctl", "terminate", args.udid, "com.heyta"], capture_output=True, text=True)
    time.sleep(1.0)
    launched = subprocess.run(["xcrun", "simctl", "launch", args.udid, "com.heyta"],
                              capture_output=True, text=True)
    if launched.returncode != 0:
        print(f"could not launch com.heyta: {(launched.stderr or launched.stdout).strip()[:200]}", file=sys.stderr)
        return 1
    time.sleep(4.0)
    probe = Probe(args)
    probe.appearance = appearance
    started_at = time.time()
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
                    # #486 那一件事的同一格：读数要能说"这一趟什么时候开始/结束"，
                    # 否则两趟落在同一个目录里时无法判断哪一份是先写的。
                    "startedAt": started_at,
                    "finishedAt": time.time(),
                    "language": probe.language,
                    "appearance": probe.appearance,
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
