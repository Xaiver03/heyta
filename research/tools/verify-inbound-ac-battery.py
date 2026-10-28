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
- ⚠️ `AC6-browser` 那腿会**重写**取证 png（提交态取证件）。分母不手抄：`evidence_dirs()` 跟着那条命令的
  config 的 `testMatch` 找到 spec，再读 spec 自己写的证据目录 ⇒ 现在派生出 **3 枚**（`inbound-recovery/`、
  `panel-layout/`、`date-consistency/`；现量 `python3 research/tools/verify-inbound-ac-battery.py --self-test` 的臂 8 会打印派生清单）。
  本电池因此自报副作用：跑前跑后各数一次、并打印逐枚差异条数（`PNG_BEFORE/PNG_AFTER/PNG_DIFF_LINES`），
  差异逐枚点名（`PNG_CHANGED=<仓内相对路径>`）、分母自报（`PNG_DENOM=… 派生自 spec 的 N 枚证据目录`），
  跑完那一刻还打**两枚不同的脏数**：`EVIDENCE_DIRTY=` 只数派生证据目录里的脏条目，
  `CARRIER_DIRTY=` 数整棵载具的 `git status --porcelain` 条目（含未跟踪）。
  ⚠️ 这两枚此前合成一行、写成 `EVIDENCE_DIRTY` 却按整棵树计数 —— 10-19 12:31 那趟摘掉 `App.tsx` 一行做反向证据时
  量出 `PNG_DIFF_LINES=3` 而 `EVIDENCE_DIRTY=4`，差的那一枚正是 `App.tsx`，**不是证据件**：一个名字两件事，
  读的人会把"清单与脏数对上"当成两把独立的交叉验证，而那其实是包含关系的两端。分开设名就是这个原因。
  🔴 **B236 那一格**：分母原先手抄成只盖 `inbound-recovery/` 一枚、且按**裸文件名**做键，于是那条腿写在
  `panel-layout/` 里的图这条尺看不见（10-19 10:2x 现量 `PNG_DIFF_LINES=4` 而当时那枚脏数=6），
  而两枚目录里若出现同名文件会被并成一格。三半分别由臂 8（派生打空/指错）、臂 9（并格）、臂 10（点名）、
  臂 11（脏数按目录筛）兜住。⚠️ 那句"4 与 6 的差就是并格"**不是已证的归因**：那批跑在合成一行的旧装置上，
  差值既可能来自没抄进去的目录，也可能来自非证据件的脏条目 —— 要分辨就得同时看 `PNG_CHANGED` 点名与两枚脏数（今天才有）。
- 默认只对 `<root>` 只读；日志一律落 `<root>/.run-logs/…`（`.gitignore` 里那条），不进提交。
- `--root` 指到别的检出（例如隔离载具）时，读的是**那棵树的工作树**，不是 HEAD。
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import os
import re
import shutil
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
    # 上一腿在 10-27 那趟被剔出电池，于是 AC-6 那枚 fixture 缺键的缺陷一直藏到 10-28 才自己红出来。
    # 这腿补的是**同类**：线协议谓词加了必填键而规则 fixture 没跟上（不靠浏览器腿复活也能判）。
    ("AC6-rule-fixture-parity", ".", "node scripts/check-inbound-rule-fixture-parity.mjs"),
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

SUMMARY_RE = re.compile(r"Test Files|^ *Tests |臂数|读数|结论|已勾|passed|failed|Results:")
# 命令串里出现的仓内路径前缀：臂 A3 拿它们回查文件在不在（改名必红）。
PATH_TOKEN_RE = re.compile(r"(?:tests|research/tools|scripts|apps/[a-z-]+|packages/[a-z-]+|e2e)/[A-Za-z0-9_./*-]+")
# 副作用清单的分母（B236）：**从浏览器腿那条命令选中的 spec 源码里派生，不手抄一份目录清单**。
# 手抄的那份会窄 —— 10-19 那趟实测 `PNG_DIFF_LINES=4` 而 `EVIDENCE_DIRTY=6`，差的两枚就写在没抄进去的目录里。
# ⚠️ 边界：spec 若改成用变量拼证据路径，这里的正则就打空 ⇒ 臂 8 红（派生集合为空或指向不存在的目录）。
SPEC_EVIDENCE_DIR_RE = re.compile(r"""['"]\.\./((?:[A-Za-z0-9_.-]+/)*evidence/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*)['"]""")


def evidence_dirs(root: Path) -> list[str]:
    """`AC6-browser` 那条命令会写进哪些证据目录 —— 跟着 config 的 testMatch 找 spec，再读 spec 自己写的路径。"""
    cmd = next(c for t, _, c in LEGS if t == "AC6-browser")
    cfg = re.search(r"--config\s+(\S+)", cmd)
    if not cfg:
        return []
    cfg_path = root / "e2e" / cfg.group(1)
    if not cfg_path.is_file():
        return []
    tm = re.search(r"testMatch:\s*/([^/]+)/", cfg_path.read_text(encoding="utf-8"))
    specs = [p for p in sorted((root / "e2e" / "tests").glob("*.spec.ts")) if tm and re.search(tm.group(1), p.name)]
    dirs: set[str] = set()
    for p in specs:
        dirs.update(SPEC_EVIDENCE_DIR_RE.findall(p.read_text(encoding="utf-8")))
    return sorted(dirs)


def repo_root() -> Path:
    """跟着脚本自己往上找 .git —— 不用 `git rev-parse`，那一枚跟着 cwd 走。"""
    d = Path(__file__).resolve().parent
    while d != d.parent:
        if (d / ".git").exists():
            return d
        d = d.parent
    raise SystemExit("verify-inbound-ac-battery: 找不到仓库根（脚本不在被跟踪的仓库里？）")


def png_manifest(root: Path, dirs: list[str] | None = None) -> dict[str, str]:
    """按**仓内相对路径**做键 —— 用裸文件名会把两枚目录里的同名图并成一格（B236）。
    `dirs` 默认从 spec 派生；臂 8/9/10 传自己造的清单进来，才能在那棵临时树上造失。"""
    out: dict[str, str] = {}
    for d in evidence_dirs(root) if dirs is None else dirs:
        for p in sorted(glob.glob(str(root / d / "*.png"))):
            f = Path(p)
            if f.is_file():
                out[str(f.relative_to(root))] = hashlib.md5(f.read_bytes()).hexdigest()
    return out


def dirty_paths(porcelain: list[str]) -> list[str]:
    """从 `git status --porcelain` 的行里取出路径：重命名取 `->` 右边，未跟踪与已改都算一枚，带引号的去掉引号。"""
    out: list[str] = []
    for line in porcelain:
        if not line.strip():
            continue
        p = line[3:]
        if "->" in p:
            p = p.split("->")[-1]
        out.append(p.strip().strip('"'))
    return out


def evidence_dirty_count(porcelain: list[str], dirs: list[str]) -> int:
    """只数落在派生证据目录里的脏条目。整棵树的脏数另有一行（`CARRIER_DIRTY`），两件事不许合成一个名字。"""
    return sum(1 for p in dirty_paths(porcelain)
               if any(p == d or p.startswith(d.rstrip("/") + "/") for d in dirs))


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
    dirs = evidence_dirs(root)
    before = png_manifest(root, dirs)
    dirty = subprocess.run(["git", "-C", str(root), "status", "--porcelain"], capture_output=True, text=True)
    n_dirty = len([x for x in dirty.stdout.splitlines() if x])
    append_rc(ev, f"{time.strftime('%F %T')} CARRIER_HEAD={subprocess.run(['git', '-C', str(root), 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()} dirty={n_dirty}")
    append_rc(ev, f"{time.strftime('%F %T')} PNG_BEFORE={len(before)} 枚")
    append_rc(ev, f"{time.strftime('%F %T')} PNG_DENOM={len(before)} 枚（派生自 spec 的 {len(dirs)} 枚证据目录：{' ; '.join(dirs) or '〈派生打空〉'}）")
    rcs: dict[str, int] = {}
    for tag, rel_dir, cmd in legs:
        rcs[tag] = run_leg(root, ev, tag, rel_dir, cmd)
    after = png_manifest(root, dirs)
    changed = sorted(name for name in set(before) | set(after) if before.get(name) != after.get(name))
    diff = len(changed)
    dirty2 = subprocess.run(["git", "-C", str(root), "status", "--porcelain"], capture_output=True, text=True)
    dirty_lines = [x for x in dirty2.stdout.splitlines() if x]
    ev_dirty = evidence_dirty_count(dirty_lines, dirs)
    append_rc(ev, f"{time.strftime('%F %T')} PNG_AFTER={len(after)} 枚")
    append_rc(ev, f"{time.strftime('%F %T')} PNG_DIFF_LINES={diff}")
    for name in changed[:40]:
        append_rc(ev, f"{time.strftime('%F %T')} PNG_CHANGED={name}")
    append_rc(ev, f"{time.strftime('%F %T')} EVIDENCE_DIRTY={ev_dirty} 枚（只数派生证据目录里的脏条目）")
    append_rc(ev, f"{time.strftime('%F %T')} CARRIER_DIRTY={len(dirty_lines)} 枚（整棵载具 git status --porcelain，含未跟踪）")
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
    needles = ("PNG_BEFORE", "PNG_AFTER", "PNG_DIFF_LINES", "EVIDENCE_DIRTY", "CARRIER_DIRTY")
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

    # 🔴 臂 8/9/10 兜的是 B236 那几半失法：分母窄（少一枚 spec 实际会写的目录）、按裸文件名做键、
    # 以及差异点名点不全。分母现在是**从 spec 派生**的，所以臂 8 判"派生本身有没有打空/指错"，
    # 臂 9/10 在临时树上造失（不碰仓里的证据件），跑完即删。
    derived = evidence_dirs(root)
    gone = [d for d in derived if not (root / d).is_dir()]
    check("8 副作用分母从 spec 派生得出且每枚目录真在场", bool(derived) and not gone,
          f"派生={derived or '〈打空：spec 里证据路径的写法变了，得改 SPEC_EVIDENCE_DIR_RE〉'} 不在场={gone}")
    print("  派生的证据目录 " + " ; ".join(derived), flush=True)
    sd = root / ".run-logs" / f"png-denom-selftest-{time.strftime('%H%M%S')}"
    try:
        probe_dirs = ["apps/web/evidence/probe-a", "docs/research/evidence/probe-b"]
        for d in probe_dirs:
            (sd / d).mkdir(parents=True, exist_ok=True)
            (sd / d / "probe.png").write_bytes(b"\x89PNG-" + d.encode() + b"-a")
        man = png_manifest(sd, probe_dirs)
        shape = "键法坏（没有一枚键带目录前缀 ⇒ 裸文件名会把两枚目录并成一格）" if man and not any("/" in k for k in man) else ""
        check("9 两枚目录里的同名图不许并成一格（按裸名做键就会并）", len(man) == 2 and not shape,
              f"keys={sorted(man)}{'; ' + shape if shape else ''}")
        target = str(Path(probe_dirs[-1]) / "probe.png")
        (sd / target).write_bytes(b"\x89PNG-" + probe_dirs[-1].encode() + b"-B")
        after = png_manifest(sd, probe_dirs)
        moved = sorted(k for k in set(man) | set(after) if man.get(k) != after.get(k))
        check("10 差异点名要点到被改的那一枚全路径", moved == [target], f"moved={moved}")
    finally:
        shutil.rmtree(sd, ignore_errors=True)

    # 臂 11：脏数那两行各数各的 —— 整棵树的脏条目里混着非证据件时，EVIDENCE_DIRTY 不许把它们算进去
    #（10-19 12:31 那趟摘掉 App.tsx 做反向证据，旧装置把两件事写成一个名字，读数就成了 3 对 4）。
    fake_dirty = [
        " M apps/web/evidence/probe-a/probe.png",
        " M apps/web/src/App.tsx",
        "?? docs/research/evidence/probe-b/new.png",
        "R  apps/web/evidence/probe-a/old.png -> apps/web/evidence/probe-a/renamed.png",
    ]
    got_ev = evidence_dirty_count(fake_dirty, probe_dirs)
    got_all = len(dirty_paths(fake_dirty))
    check("11 脏数分两行：只数派生证据目录那一枚不许把非证据件算进来", got_ev == 3 and got_all == 4,
          f"EVIDENCE_DIRTY={got_ev}（该 3：一枚改、一枚未跟踪、一枚改名后在证据目录里）CARRIER_DIRTY={got_all}（该 4）")

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
