#!/usr/bin/env python3
"""AC-1～AC-8 逐格尺的**串行电池**：把判卷文档那几行表格里登记的命令一次跑完，逐条取 rc。

来历：10-17 那一整串读数原先只活在**这台机器上、仓库外**的一枚 bash 台架里
（`~/.heyta-window-rigs/heyta-inb-ac-recheck-1017.sh`）。台账引用它当"复跑装置"，
而克隆这份仓库的人拿不到那枚文件 ⇒ 那句话的真实射程只是"这台机器上的我"。
本体把它搬进被跟踪目录，命令串逐字照抄，不改判卷口径。

跑法：
    python3 research/tools/verify-inbound-ac-battery.py --list          # 只列清单（末行 legs=N 是现量条数）
    python3 research/tools/verify-inbound-ac-battery.py                  # 全串（串行，几十分钟量级）
    python3 research/tools/verify-inbound-ac-battery.py --only AC8-ac-ticks,AC7-migrations
    python3 research/tools/verify-inbound-ac-battery.py --quiet-gate      # 开火前等安静门
    python3 research/tools/verify-inbound-ac-battery.py --self-test       # 只测这把尺有没有牙

边界（连同读数一起读，别只读 rc）：
- 🔴 **AC-5 那格文档里挂着范围尺**，它 rc=1 的红因在别线那枚借用「自动收集」标题的提交上（B205 追记），
  按"尺在别人名下"记录，不当本线红。所以本电池的 **rc 非 0 条数 ≠ 本线红数**。
- ⚠️ `AC6-browser` 那腿会**重写** `apps/web/evidence/inbound-recovery/*.png`（提交态取证件）。
  本电池因此自报副作用：跑前跑后各数一次、并打印逐枚差异条数（`PNG_BEFORE/PNG_AFTER/PNG_DIFF_LINES`），
  还打印跑完那一刻的载具脏条目数（`EVIDENCE_DIRTY`）。看见一片 ` M` 而不知道是谁写的，就是没这条读数。
- 默认只对 `<root>` 只读；日志一律落 `<root>/.run-logs/…`（`.gitignore` 里那条），不进提交。
- `--root` 指到别的检出（例如隔离载具）时，读的是**那棵树的工作树**，不是 HEAD。
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import os
import re
import subprocess
import sys
import time
from pathlib import Path

# (标签, 相对 root 的工作目录, 交给 sh -c 的整条命令) —— 逐字来自 10-17 那趟真跑过的台架。
LEGS: list[tuple[str, str, str]] = [
    ("AC1-offline11", "server", "npx --no-install vitest run --maxWorkers=1 tests/automation-entitlement-ticket.spec.ts tests/automation-drafts.spec.ts tests/inbound-automation.routes.spec.ts tests/inbound-entitlement-write-tx.spec.ts tests/inbound-worker-identity.spec.ts tests/automation-entitlement-issuer.spec.ts tests/automation-commit-proof.spec.ts tests/automation-events.spec.ts tests/automation-rules.spec.ts tests/automation-sender-credentials.spec.ts tests/automation-ai-metering.spec.ts"),
    ("AC1-entitlement3", "server", "npx --no-install vitest run --maxWorkers=1 tests/entitlement.spec.ts tests/entitlement-gate.routes.spec.ts tests/entitlement-across.spec.ts"),
    ("AC1-quota-http", "server", "npx --no-install vitest run --maxWorkers=1 tests/inbound-ai-quota-route.spec.ts"),
    ("AC1-pglite", "server", "npx --no-install vitest run --maxWorkers=1 tests/automation-ai-metering.pglite.spec.ts"),
    ("AC1-worker-identity", ".", "python3 research/tools/verify-inbound-worker-identity.py"),
    ("AC1-cjs-order", ".", "python3 research/tools/verify-inbound-cjs-require-order.py"),
    ("AC2-inbound-core", "packages/inbound-core", "npx --no-install vitest run --maxWorkers=1"),
    ("AC2-queue-teeth", ".", "python3 research/tools/verify-inbound-queue-teeth.py"),
    ("AC3-dual-host", ".", "python3 research/tools/verify-inbound-dual-host.py"),
    ("AC3-sync-authz", "packages/sync-client", "npx --no-install vitest run --maxWorkers=1 tests/inbound-authorization.spec.ts"),
    ("AC4-local-date", "packages/domain", "npx --no-install vitest run --maxWorkers=1 tests/inbound-local-date.spec.ts"),
    ("AC4-app-host", "packages/app-host", "npx --no-install vitest run --maxWorkers=1 tests/inbound-*.spec.ts"),
    ("AC4-egress-wire", "packages/app-host", "npx --no-install vitest run --maxWorkers=1 tests/inbound-egress-wire.spec.ts"),
    ("AC5-shared-schema", "packages/shared-schema", "npx --no-install vitest run --maxWorkers=1 tests/task-batch-contract.spec.ts"),
    ("AC5-op-log", "packages/op-log", "npx --no-install vitest run --maxWorkers=1 tests/task-batch.spec.ts"),
    ("AC5-batch-actions", "packages/app-host", "npx --no-install vitest run --maxWorkers=1 tests/task-batch-actions.spec.ts"),
    ("AC6-web-specs", "apps/web", "npx --no-install vitest run tests/inbound-*.spec.tsx tests/inbound-upload-authorization.spec.ts"),
    ("AC6-browser", "e2e", "npx --no-install playwright test --config playwright.inbound.config.ts"),
    ("AC7-doc-tables", ".", "python3 research/tools/verify-inbound-doc-tables.py"),
    ("AC7-doc-endpoints", ".", "python3 research/tools/verify-inbound-doc-endpoints.py"),
    ("AC7-migrations", ".", "node scripts/check-migrations.mjs"),
    ("AC7-license", ".", "node research/tools/license-inventory.mjs"),
    ("AC7-docs-voice", ".", "node scripts/check-docs-voice.mjs"),
    ("AC7-link", ".", "node research/tools/docs-link-check.mjs"),
    ("AC8-matrix", ".", "python3 research/tools/verify-inbound-ac8-matrix.py"),
    ("AC8-producer-seam", ".", "python3 research/tools/verify-inbound-producer-seam.py"),
    ("AC8-ac-ticks", ".", "python3 research/tools/verify-inbound-ac-ticks.py"),
    ("SCOPE-commit-scope", ".", "python3 research/tools/verify-inbound-commit-scope.py"),
]

# 判卷文档里那几格：**分母从文档取，不写死**（与 server/tests/inbound-lane-rigs-consumers.spec.ts
# 的分母自检同一约定）—— 文档新添一格而名单里没它的腿，臂 7 就红；腿挂着一格而文档里已没有它，也红。
JUDGING_DOC = "docs/plans/inbound-automation.md"
AC_IN_DOC_RE = re.compile(r"^- \[.\] \*\*AC-(\d+)\b", re.MULTILINE)

SUMMARY_RE = re.compile(r"Test Files|^ *Tests |臂数|读数|结论|已勾|passed|failed")
# 命令串里出现的仓内路径前缀：臂 A3 拿它们回查文件在不在（改名必红）。
PATH_TOKEN_RE = re.compile(r"(?:tests|research/tools|scripts|apps/[a-z-]+|packages/[a-z-]+|e2e)/[A-Za-z0-9_./*-]+")
EVIDENCE_GLOB = "apps/web/evidence/inbound-recovery/*.png"


def repo_root() -> Path:
    """跟着脚本自己往上找 .git —— 不用 `git rev-parse`，那一枚跟着 cwd 走。"""
    d = Path(__file__).resolve().parent
    while d != d.parent:
        if (d / ".git").exists():
            return d
        d = d.parent
    raise SystemExit("verify-inbound-ac-battery: 找不到仓库根（脚本不在被跟踪的仓库里？）")


def png_manifest(root: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for p in sorted(glob.glob(str(root / EVIDENCE_GLOB))):
        f = Path(p)
        if f.is_file():
            out[f.name] = hashlib.md5(f.read_bytes()).hexdigest()
    return out


def run_leg(root: Path, ev: Path, tag: str, rel_dir: str, cmd: str) -> int:
    workdir = root if rel_dir == "." else root / rel_dir
    log = ev / f"{tag}.log"
    started = time.time()
    with log.open("w", encoding="utf-8") as fh:
        rc = subprocess.call(cmd, shell=True, cwd=str(workdir), env={**os.environ, "NO_COLOR": "1"},
                             stdout=fh, stderr=subprocess.STDOUT)
    text = log.read_text(encoding="utf-8", errors="replace").splitlines()
    hits = summary_tail(text)
    # 摘要针打空≠这腿没跑。判据一直是 rc，但读数行留空会被读成"无事发生"，所以显式标出来。
    summary = "~".join(hits)[:240] if hits else f"(摘要针未命中，读数见 {tag}.log；判据是 rc)"
    append_rc(ev, f"{time.strftime('%F %T')} {tag} rc={rc} sec={time.time() - started:.0f} :: {summary}")
    print(f"{tag} rc={rc} :: {summary}", flush=True)
    return rc


def summary_tail(lines: list[str]) -> list[str]:
    hits = [line.strip() for line in lines if SUMMARY_RE.search(line)]
    return hits[-2:]


def append_rc(ev: Path, line: str) -> None:
    with (ev / "rc.txt").open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def quiet_gate(root: Path) -> bool:
    lib = root / "scripts/lib/wait-for-quiet-host.sh"
    if not lib.is_file():
        print(f"QUIET_GATE=NO_LIB {lib}", flush=True)
        return False
    rc = subprocess.call(["bash", "-c", f'source "{lib}" && wait_for_quiet_host'], cwd=str(root))
    print(f"QUIET_GATE rc={rc}", flush=True)
    return rc == 0


def battery(root: Path, ev: Path, legs: list[tuple[str, str, str]]) -> int:
    ev.mkdir(parents=True, exist_ok=True)
    before = png_manifest(root)
    dirty = subprocess.run(["git", "-C", str(root), "status", "--porcelain"], capture_output=True, text=True)
    n_dirty = len([x for x in dirty.stdout.splitlines() if x])
    append_rc(ev, f"{time.strftime('%F %T')} CARRIER_HEAD={subprocess.run(['git', '-C', str(root), 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()} dirty={n_dirty}")
    append_rc(ev, f"{time.strftime('%F %T')} PNG_BEFORE={len(before)} 枚")
    rcs: dict[str, int] = {}
    for tag, rel_dir, cmd in legs:
        rcs[tag] = run_leg(root, ev, tag, rel_dir, cmd)
    after = png_manifest(root)
    diff = sum(1 for name in set(before) | set(after) if before.get(name) != after.get(name))
    dirty2 = subprocess.run(["git", "-C", str(root), "status", "--porcelain"], capture_output=True, text=True)
    append_rc(ev, f"{time.strftime('%F %T')} PNG_AFTER={len(after)} 枚")
    append_rc(ev, f"{time.strftime('%F %T')} PNG_DIFF_LINES={diff}")
    append_rc(ev, f"{time.strftime('%F %T')} EVIDENCE_DIRTY={len([x for x in dirty2.stdout.splitlines() if x])}")
    append_rc(ev, f"{time.strftime('%F %T')} legs={len(legs)} rc0={sum(1 for v in rcs.values() if v == 0)} rc_nonzero={sum(1 for v in rcs.values() if v != 0)}")
    print(f"legs={len(legs)} rc0={sum(1 for v in rcs.values() if v == 0)} rc_nonzero={sum(1 for v in rcs.values() if v != 0)}", flush=True)
    for tag, code in rcs.items():
        if code != 0:
            print(f"  非 0：{tag} rc={code}（读 rc.txt 与 {ev}/{tag}.log；边界见文件头）", flush=True)
    return 0 if all(v == 0 for v in rcs.values()) else 1


def self_test(root: Path) -> int:
    failed: list[str] = []
    arms = 0

    def check(name: str, ok: bool, why: str = "") -> None:
        nonlocal arms
        arms += 1
        print(f"{'✅' if ok else '❌'} 臂 {name}{'' if ok else '（' + why + '）'}", flush=True)
        if not ok:
            failed.append(name)

    tags = [t for t, _, _ in LEGS]
    check("1 标签唯一", len(set(tags)) == len(tags), f"{len(tags)} 枚里唯一名只有 {len(set(tags))} 枚")

    missing_dir = [t for t, d, _ in LEGS if not (root if d == "." else root / d).is_dir()]
    check("2 每条腿的工作目录在场", not missing_dir, str(missing_dir))

    ghosts: list[str] = []
    for tag, rel_dir, cmd in LEGS:
        # 路径针按**这条腿的工作目录**解析：命令就在那儿跑（cwd=workdir），
        # 按仓根解析会把 server/tests/… 这种合法相对路径全报成幽灵。
        workdir = root if rel_dir == "." else root / rel_dir
        for token in PATH_TOKEN_RE.findall(cmd):
            if "*" in token:
                if not glob.glob(str(workdir / token)):
                    ghosts.append(f"{tag}:{token}")
            elif not (workdir / token).exists():
                ghosts.append(f"{tag}:{token}")
    check("3 命令里的仓内路径解析得到（改名必红）", not ghosts, str(ghosts[:6]))

    probe = ["false"]
    rc = subprocess.call(probe, shell=True, cwd=str(root))
    check("4 一条注定失败的腿真会非 0", rc != 0, "装置退化成什么都不判也回 0")

    ev = Path(root / ".run-logs" / f"inb-ac-battery-selftest-{time.strftime('%H%M%S')}")
    fake = [("FAKE-echo", ".", 'echo "Test Files  1 passed (1)"')]
    brc = battery(root, ev, fake)
    line = (ev / "rc.txt").read_text(encoding="utf-8") if (ev / "rc.txt").exists() else ""
    check("5 端到端：假腿能跑通且摘要针真取到读数", brc == 0 and "Test Files" in line and "legs=1 rc0=1 rc_nonzero=0" in line,
          f"brc={brc} 摘要针打空就会把'没判'读成'判过'")
    needles = ("PNG_BEFORE", "PNG_AFTER", "PNG_DIFF_LINES", "EVIDENCE_DIRTY")
    missing = [n for n in needles if n not in line]
    check("6 副作用自报四行齐（浏览器腿会重写取证图）", not missing, str(missing))
    doc = root / JUDGING_DOC
    if not doc.is_file():
        check("7 每格都有腿挂着（分母取自判卷文档）", False, f"{JUDGING_DOC} 不在场，分母取不到就不能当已判")
    else:
        fam_doc = {f"AC{n}" for n in AC_IN_DOC_RE.findall(doc.read_text(encoding="utf-8"))}
        fam_leg = {t.split("-")[0] for t in tags if t.startswith("AC")}
        per = {f: sum(1 for t in tags if t.startswith(f + "-")) for f in sorted(fam_leg)}
        no_leg = sorted(fam_doc - fam_leg)
        dead = sorted(fam_leg - fam_doc)
        check("7 每格都有腿挂着（分母取自判卷文档）", not no_leg and not dead,
              f"没腿的一格={no_leg}，文档里已没有却还挂着腿的一格={dead}；每格腿数={per}")
        print("  每格腿数 " + " ".join(f"{f}={per[f]}" for f in sorted(per)), flush=True)
    for p in ev.glob("*"):
        if p.is_file():
            p.unlink()
    ev.rmdir()

    # 一条臂都没跑过的尺不算量过：否则"把 check 全删掉"这种失法会留下 arms=0 failed=0 的假绿。
    if arms == 0:
        print("❌ 一把臂都没跑的尺（arms=0）不算量过", flush=True)
        failed.append("0 臂都没跑")

    print(f"self_test arms={arms} failed={len(failed)}", flush=True)
    return 0 if not failed else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="AC-1～AC-8 逐格尺的串行电池")
    ap.add_argument("--root", default=None, help="指到别的检出（默认＝本脚本所在仓库根）")
    ap.add_argument("--ev", default=None, help="日志落点，默认 <root>/.run-logs/inb-ac-battery-<时刻>")
    ap.add_argument("--only", default=None, help="逗号分隔的标签子集")
    ap.add_argument("--list", action="store_true", help="只打印这若干条命令，不开火")
    ap.add_argument("--quiet-gate", action="store_true", help="开火前等安静门（10-17 那趟就是开着它跑的）")
    ap.add_argument("--self-test", action="store_true", help="只测这把尺有没有牙")
    args = ap.parse_args()

    root = Path(args.root).resolve() if args.root else repo_root()

    if args.self_test:
        return self_test(root)

    legs = LEGS
    if args.only:
        wanted = [w.strip() for w in args.only.split(",") if w.strip()]
        legs = [leg for leg in LEGS if leg[0] in wanted]
        unknown = set(wanted) - {leg[0] for leg in legs}
        if unknown:
            print(f"❌ --only 里这些标签不在册：{sorted(unknown)}", flush=True)
            return 2

    if args.list:
        for tag, rel_dir, cmd in legs:
            print(f"{tag}\t{rel_dir}\t{cmd}")
        print(f"legs={len(legs)}")
        return 0

    ev = Path(args.ev) if args.ev else root / ".run-logs" / f"inb-ac-battery-{time.strftime('%m%d-%H%M')}"
    if args.quiet_gate and not quiet_gate(root):
        print("GATE=FAIL（本轮不开火）", flush=True)
        return 3
    print(f"EV={ev}", flush=True)
    return battery(root, ev, legs)


if __name__ == "__main__":
    sys.exit(main())
