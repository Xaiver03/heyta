#!/usr/bin/env python3
"""#104 语义层的变异读数：注销销毁的到底是【哪一个适配器实例】。

臂 0 是阳性对照（不变异 ⇒ 必须 0 红）；其余每臂摘掉一条承重条件，各自必须把自己的那条判据打红。
判据住在 apps/web/tests/local-destroy-live-adapter.spec.ts（那份不 mock lib/oplog.js，
因为「单例有没有被清」只能从真模块的模块态里读）。

用法：python3 research/tools/mutation-rigs/w104-live-adapter-arms.py [臂号...]
退出码：0 = 每臂都红且还原干净；1 = 有臂存活；2 = 前置不成立（锁被占 / 闸门拒跑 / 锚点不唯一）。

⚠️ 本文件里的中文一律不用 ASCII 双引号包裹子句（用「」或方括号）——上一版这么写，
   Write 之后里层的引号变成 ASCII 引号，Python 直接 SyntaxError。
"""

from __future__ import annotations

import os
import pathlib
import re
import shutil
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[3]
DESTRUCTION = ROOT / "apps/web/src/lib/local-data-destruction.ts"
OPLOG = ROOT / "apps/web/src/lib/oplog.ts"
SPEC = ROOT / "apps/web/tests/local-destroy-live-adapter.spec.ts"
BACKUP = ROOT / "tmp/w104-mutation-backups"
LOGS = ROOT / "tmp/p12-readings"
LOCK = pathlib.Path("/tmp/tfa-test.lock")

CLEAR_BLOCK = (
    "  db = undefined;\n"
    "  engine = undefined;\n"
    "  opLogStore = undefined;\n"
    "  initPromise = undefined;\n"
)

# 每臂：(名字, 文件, 原文, 替身)
ARMS = [
    ("基线（不变异）", None, None, None),
    (
        "销毁的不是活的那个实例（回落到「新建一个去删」）",
        DESTRUCTION,
        "const liveReport = await destroyLiveStorage();",
        "const liveReport: undefined = undefined;",
    ),
    (
        "销毁了实例但没清单例（重新登录会被那个死实例挡住）",
        OPLOG,
        CLEAR_BLOCK,
        "",
    ),
]


def acquire_lock() -> None:
    """和别人共用一个独占锁：约定是第一行 pid。持有者还活着就【不绕】，直接判环境无效。"""
    if LOCK.exists():
        try:
            holder = int(LOCK.read_text().splitlines()[0].strip())
        except (ValueError, IndexError):
            holder = None
        if holder is not None and holder != os.getpid():
            alive = subprocess.run(["ps", "-p", str(holder)], capture_output=True).returncode == 0
            if alive:
                print(f"LOCK=HELD_BY holder={holder} verdict=REFUSE")
                print("RESULT=ENV_INVALID reason=独占锁被另一个还活着的进程持有")
                sys.exit(2)
    LOCK.write_text(f"{os.getpid()}\n")


def release_lock() -> None:
    if LOCK.exists() and LOCK.read_text().splitlines()[0].strip() == str(os.getpid()):
        LOCK.unlink()


def run_suite(tag: str) -> tuple[int, list[str]]:
    log = LOGS / f"w104-{tag}.log"
    env = {**os.environ, "NO_COLOR": "1"}
    proc = subprocess.run(
        ["pnpm", "exec", "vitest", "run", "tests/local-destroy-live-adapter.spec.ts"],
        cwd=str(ROOT / "apps/web"),
        capture_output=True,
        text=True,
        env=env,
    )
    out = proc.stdout + proc.stderr
    log.write_text(out, encoding="utf8")
    if "内存闸门" in out or "拒绝启动" in out:
        print(f"ARM={tag} verdict=ENV_INVALID reason=负载或并发闸门拒跑（不绕闸门，也不把拒跑读成没有红）")
        sys.exit(2)
    if "Test Files" not in out:
        print(f"ARM={tag} verdict=ENV_INVALID reason=日志里没有 Test Files 汇总行（套件根本没跑起来）")
        print(out[-500:])
        sys.exit(2)
    return proc.returncode, re.findall(r"^\s+× (.+)$", out, re.M)


def main() -> int:
    LOGS.mkdir(parents=True, exist_ok=True)
    BACKUP.mkdir(parents=True, exist_ok=True)
    for f in (DESTRUCTION, OPLOG, SPEC):
        shutil.copy2(f, BACKUP / f.name)

    only = {int(a) for a in sys.argv[1:]}
    acquire_lock()
    surviving: list[str] = []
    rc_base = 0
    try:
        for idx, (name, path, old, new) in enumerate(ARMS):
            if only and idx not in only:
                continue
            if path is not None:
                text = path.read_text(encoding="utf8")
                if text.count(old) != 1:
                    print(f"ARM={idx} verdict=PREFLIGHT_FAIL reason=锚点在 {path.name} 里不是唯一命中")
                    return 2
                path.write_text(text.replace(old, new), encoding="utf8")
            rc, reds = run_suite(f"arm{idx}")
            if idx == 0:
                rc_base = rc
                print(f"ARM=arm0 rc={rc} red={len(reds)} :: {name}")
                if rc != 0:
                    print("BASELINE_NOT_GREEN=1 —— 基线不绿时任何「变异红了」都不算证据")
                    surviving.append(name)
            elif rc == 0:
                print(f"ARM=arm{idx} rc={rc} red=0 :: {name} ⇒ 存活（这条条件没有判据在守）")
                surviving.append(name)
            else:
                print(f"ARM=arm{idx} rc={rc} red={len(reds)} :: {name}")
                for r in reds:
                    print(f"   RED: {r}")
            if path is not None:
                shutil.copy2(BACKUP / path.name, path)
        print(f"ARMS_SURVIVING={len(surviving)} {surviving}")
        return rc_base if not surviving else 1
    finally:
        for f in (DESTRUCTION, OPLOG, SPEC):
            if f.read_bytes() != (BACKUP / f.name).read_bytes():
                shutil.copy2(BACKUP / f.name, f)
                print(f"RESTORE=forced file={f.name}")
        release_lock()


def report() -> None:
    print(f"ARMS_TOTAL={len(ARMS)}")
    for f in (DESTRUCTION, OPLOG):
        same = f.read_bytes() == (BACKUP / f.name).read_bytes()
        print(f"BYTE_CHECK {f.name}={'same' if same else 'DIFF'}")


if __name__ == "__main__":
    code = main()
    report()
    print(f"EXIT={code}")
    print("RESULT=" + ("OK" if code == 0 else ("FAIL" if code == 1 else "ENV_INVALID")))
    sys.exit(code)
