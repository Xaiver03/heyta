#!/usr/bin/env python3
"""P-12 本轮新判据的"能不能失败"实测。

每臂：备份目标文件 → 打一刀变异 → 跑那三份 spec → 记录红集 → 逐字节回写 → 复验一致。
不用 git checkout：这些文件里有未提交的改动，checkout 会把它连同变异一起丢掉。

臂 0 是阳性对照（不打变异，必须 0 红）；臂数由本脚本自己打印，不抄进任何文档。
"""
import io
import os
import re
import shutil
import subprocess
import sys

# 仓库根由本文件的位置推出来（搬家以后仍然可跑），不写死本机路径
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SERVER = os.path.join(REPO, "server")
RIG = os.path.join(REPO, "tmp", "p12-readings")  # 每臂的日志落在这里（仓库内，不在 /tmp）
BACKUPS = os.path.join(RIG, "mutation-backups")
SPECS = [
    "tests/restore-script.spec.ts",
    "tests/backup-script.spec.ts",
    "tests/account-tombstone.pglite.spec.ts",
]
RESTORE_SH = os.path.join(SERVER, "scripts/restore.sh")
BACKUP_SH = os.path.join(SERVER, "scripts/backup.sh")
FIX_RESTORE = os.path.join(SERVER, "tests/fixtures/fake-docker.sh")
FIX_BACKUP = os.path.join(SERVER, "tests/fixtures/fake-docker-backup.sh")
TARGETS = [RESTORE_SH, BACKUP_SH, FIX_RESTORE, FIX_BACKUP]

# 每臂：(说明, 文件, 原串, 变异串)
ARMS = [
    ("阳性对照：不打任何变异", None, None, None),
    ("账本形状检查被中和 ⇒ 坏行也能进闸", RESTORE_SH, "{ bad = 1 }", "{ bad = 0 }"),
    ("零注销知识的拒绝被摘掉 ⇒ tombstones=0 又变成通过", RESTORE_SH,
     '[ "$TOMBSTONE_COUNT" = "0" ] && [ "$ALLOW_EMPTY_TOMBSTONES" != "1" ]',
     '[ "$TOMBSTONE_COUNT" = "never" ]'),
    ("探针没读到数被当成 0 ⇒ 闸没跑也报通过", RESTORE_SH,
     'echo "RESTORE=GATE_INPUT_MISSING"\n    exit 3',
     'echo "RESTORE=OK_GATE_SILENTLY_SKIPPED"\n    exit 0'),
    ("两源并集不去重 ⇒ 主键冲突停在半路", RESTORE_SH,
     'awk -F, \'!seen[$1]++\' "$TOMBSTONE_LIVE" "$LEDGER_CSV"',
     'cat "$TOMBSTONE_LIVE" "$LEDGER_CSV"'),
    ("账本产物不落地 ⇒ 恢复侧没有闸的输入", BACKUP_SH,
     'mv "$LEDGER_TMP" "$LEDGER_FILE"',
     'rm -f "$LEDGER_TMP"'),
    ("活库没有墓碑表时照样出货 ⇒ 一份注定恢复不了的备份", BACKUP_SH,
     'echo "BACKUP=NO_TOMBSTONE_TABLE"\n  echo "    The live database has no account_tombstones, so there is no closure ledger to back up."\n  echo "    A restore would then have no gate input to carry forward. Nothing was uploaded."\n  exit 1',
     'echo "BACKUP=TOMBSTONE_TABLE_SEEMS_FINE"'),
    ("夹具的带走臂被写坏 ⇒ 症状是静默读空，不是臂报错", FIX_RESTORE,
     "  *STDOUT*)", "  *THIS_ARM_CANNOT_MATCH*)"),
    ("留存清扫不认账本后缀 ⇒ 那一份记录永不过期", BACKUP_SH,
     '-name "supersync_tombstones_*.csv*"', "-name \"supersync_tombstones_NEVER_MATCHES*\""),
]


def read(path):
    return io.open(path, encoding="utf-8").read()


# —— 独占：这把闸改的是**活文件**，别的会话在这半分钟里跑到同一族用例就会读到假红 ——
# 用的是本机既有那把测试锁的同一约定（首行 pid，活着=持有），所以别人照旧规则就会让我。
LOCK = "/tmp/tfa-test.lock"


def lock_holder():
    try:
        first = io.open(LOCK, encoding="utf-8").readline().strip()
    except OSError:
        return None
    if not first.isdigit() or first in ("0", "1"):
        return None
    try:
        os.kill(int(first), 0)  # 存在性，不是信号权限（traps: kill -0 对别人的活进程回 EPERM）
    except ProcessLookupError:
        return None
    except PermissionError:
        return int(first)
    return int(first)


def acquire_lock():
    held = lock_holder()
    if held and held != os.getpid():
        print(f"RESULT=ENV_INVALID reason=测试锁被 pid={held} 持有（这把闸改活文件，不绕锁）")
        return False
    io.open(LOCK, "w", encoding="utf-8").write(f"{os.getpid()}\n")
    return True


def release_lock():
    try:
        if lock_holder() == os.getpid():
            os.remove(LOCK)
    except OSError:
        pass


def snap():
    os.makedirs(BACKUPS, exist_ok=True)
    for f in TARGETS:
        shutil.copyfile(f, os.path.join(BACKUPS, os.path.basename(f)))


def restore():
    for f in TARGETS:
        shutil.copyfile(os.path.join(BACKUPS, os.path.basename(f)), f)


def verify_restored():
    bad = []
    for f in TARGETS:
        a = os.path.join(BACKUPS, os.path.basename(f))
        if read(a) != read(f):
            bad.append(f)
    return bad


def run_suite(tag):
    log = os.path.join(RIG, f"p12-mut-{tag}.log")
    with io.open(log, "w", encoding="utf-8") as fh:
        env = dict(os.environ, NO_COLOR="1")
        r = subprocess.run(["pnpm", "exec", "vitest", "run", *SPECS], cwd=SERVER,
                           stdout=fh, stderr=subprocess.STDOUT, env=env)
    text = read(log)
    # 🔴 内存/并发闸门拒绝启动**不是测试红**：它退 1、日志里没有汇总行。
    #    把它读成"这一臂没红"会把环境无效写成"判据没牙"（同一族形状的第三次）。
    if "内存闸门" in text or "拒绝启动" in text:
        print(f"GATE_REFUSED={tag} log={log}")
        sys.exit(3)
    if "Test Files" not in text:
        print(f"SUITEDIDNOTRUN={tag} log={log}")
        sys.exit(3)
    return log, r.returncode


def redset(log):
    text = read(log)
    # vitest 的行首可能带 ANSI/制表符；NO_COLOR=1 已经在上面给了（traps #163）
    names = re.findall(r"^\s*[×x]\s+(.+?)(?:\s+\d+ms)?$", text, re.M)
    return sorted(n.strip() for n in names if n.strip())


def main():
    if not acquire_lock():
        return 3
    try:
        return run_arms()
    finally:
        release_lock()


def run_arms():
    if not read(RESTORE_SH) or not read(BACKUP_SH):
        print("RESULT=FAIL reason=读不到被测脚本")
        return 1
    snap()
    print(f"ARMS_TOTAL={len(ARMS)}")
    base_reds = None
    survived = []
    for idx, (desc, path, old, new) in enumerate(ARMS):
        tag = f"arm{idx}"
        if path is not None:
            text = read(path)
            n = text.count(old)
            if n == 0:
                print(f"ARM={tag} INVALID=变异串不在文件里 :: {desc}")
                return 1
            io.open(path, "w", encoding="utf-8").write(text.replace(old, new))
        log, rc = run_suite(tag)
        reds = redset(log)
        print(f"ARM={tag} rc={rc} red={len(reds)} :: {desc}")
        for r in reds:
            print(f"   RED: {r}")
        if idx == 0:
            base_reds = reds
            if reds:
                print("   基线就有红 ⇒ 后面每一臂的红都要与这份红集比对才算数")
        elif not reds or reds == base_reds:
            survived.append(idx)
        restore()  # 🔴 每一臂都要先回写再校验 —— 忘了这一句，下一臂就打在上一臂的变异上
        bad = verify_restored()
        if bad:
            print(f"RESULT=FAIL reason=回写后字节不一致 :: {bad}")
            return 1
    print(f"BASELINE_RED={len(base_reds or [])}")
    print(f"ARMS_SURVIVING={len(survived)} {survived}")
    if survived:
        print("RESULT=FAIL reason=有臂没红（判据没牙或这一刀没进产物）")
        return 1
    print("RESULT=OK artifacts=" + RIG)
    return 0


if __name__ == "__main__":
    sys.exit(main())
