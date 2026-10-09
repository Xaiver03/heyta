#!/usr/bin/env python3
"""
变异验证：`server/src/account/credential-sweep.ts` 的每一条判据都要能红（工单 W8 / D3）。

跑法（仓库根）：
    python3 research/tools/mutate-credential-sweep.py
    python3 research/tools/mutate-credential-sweep.py --list

每一臂做三件事：备份 → 改一处实现 → 跑 `server/tests/credential-sweep.spec.ts` → 还原。
判"红"的标准是**vitest 非零退出**，并在报文里点名那一臂该抓住的判据编号（J-S1…J-S6），
这样"红了但红在别处"不会被当成通过。

为什么值得单独一份：这一族清扫是政策里那两句**唯一**的执行者 ——
"过期即失效的一次性令牌"与"会话行的留存上界"。清扫不命中，症状不是报错，
而是一句对外承诺没有东西兑现（同 `check:legal-*` 那一族的理由）。
"""

from __future__ import annotations

import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "server" / "src" / "account" / "credential-sweep.ts"
SPEC = "tests/credential-sweep.spec.ts"
BAK_ROOT = ROOT / "research" / "tools" / ".mut-credential-sweep-bak"

ARMS: list[dict[str, object]] = [
    {
        "name": "cs-1-pair-swap",
        "claim": "J-S2（四对令牌/有效期必须成对写回）",
        "old": "clearExpiredColumn('loginToken', 'loginTokenExpiresAt', nowMs)",
        "new": "clearExpiredColumn('loginToken', 'verificationTokenExpiresAt', nowMs)",
        "count": 1,
    },
    {
        "name": "cs-2-drop-not-null",
        "claim": "J-S2（where 恰是 {not:null, lt:now} —— 少了 not:null 就会去动从未签发的那一列）",
        "old": "where: { [expiresColumn]: { not: null, lt: BigInt(nowMs) } },",
        "new": "where: { [expiresColumn]: { lt: BigInt(nowMs) } },",
        "count": 1,
    },
    {
        "name": "cs-3-either-side",
        "claim": "J-S3（只过期一侧时不许删整张换绑请求）",
        "old": "      AND: [\n",
        "new": "      OR: [\n",
        "count": 1,
    },
    {
        "name": "cs-4-ignore-new-side",
        "claim": "J-S3（新邮箱那一侧还在等的时候，old 过期不构成删除理由）",
        "old": """        {
          OR: [
            { newExpiresAt: null },
            { newExpiresAt: { lt: BigInt(nowMs) } },
            { newToken: null },
          ],
        },
""",
        "new": "",
        "count": 1,
    },
    {
        "name": "cs-5-no-session-sweep",
        "claim": "J-S5（会话行的留存上界真的被拿去删，而不是只算不删）",
        "old": "  const sessions = await deleteSessionsOlderThan(nowMs - SESSION_ROW_RETENTION_MS);",
        "new": "  const sessions = 0;\n  void SESSION_ROW_RETENTION_MS;",
        "count": 1,
    },
    {
        "name": "cs-6-clear-data-swapped",
        "claim": "J-S2（置空的是令牌**与**有效期两列，只清其一等于令牌还活着）",
        "old": "data: { [tokenColumn]: null, [expiresColumn]: null },",
        "new": "data: { [tokenColumn]: null },",
        "count": 1,
    },
    {
        "name": "cs-7-sessions-unreported",
        "claim": "J-S6（报告里必须带上会话那一格，且 0 也要带）",
        "old": "    sessions,",
        "new": "    sessions: 0,",
        "count": 1,
    },
]


def run_spec() -> tuple[int, str]:
    proc = subprocess.run(
        ["npx", "vitest", "run", SPEC],
        cwd=ROOT / "server",
        capture_output=True,
        text=True,
        env={**dict(__import__("os").environ), "NO_COLOR": "1"},
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def main(argv: list[str]) -> int:
    if "--list" in argv:
        for arm in ARMS:
            print(f"{arm['name']}: {arm['claim']}")
        print(f"共 {len(ARMS)} 臂")
        return 0

    text = SRC.read_text(encoding="utf-8")
    for arm in ARMS:
        if text.count(str(arm["old"])) != int(arm["count"]):
            print(f"🔴 起跑前就找不到夹具：{arm['name']}（旧片段命中 {text.count(str(arm['old']))} 处）")
            return 2

    BAK_ROOT.mkdir(parents=True, exist_ok=True)
    baseline = BAK_ROOT / "credential-sweep.ts.orig"
    shutil.copyfile(SRC, baseline)

    failed: list[str] = []
    try:
        code, out = run_spec()
        print(f"基线（未变异）：rc={code} —— 必须为 0 才说明下面那些红是被变异打出来的")
        if code != 0:
            print(out[-1500:])
            return 2

        for arm in ARMS:
            name, claim = str(arm["name"]), str(arm["claim"])
            mutated = text.replace(str(arm["old"]), str(arm["new"]), int(arm["count"]))
            assert mutated != text, name
            SRC.write_text(mutated, encoding="utf-8")
            try:
                code, out = run_spec()
            finally:
                shutil.copyfile(baseline, SRC)
            tail = "\n".join(
                line for line in out.splitlines() if re.search(r"(FAIL|✕|AssertionError|Tests )", line)
            )[:900]
            ok = code != 0
            print(f"{name} ⇒ {'红' if ok else '存活（判据没有牙）'}：{claim}")
            if ok:
                print("\n".join(f"    {line}" for line in tail.splitlines()[:6]))
            else:
                failed.append(name)
    finally:
        shutil.copyfile(baseline, SRC)
        print(f"已还原 {SRC.relative_to(ROOT)}（对照 sha 前 8 位：{reldigest()}）")

    print(f"ARMS={len(ARMS)} SURVIVED={len(failed)}" + (f" → {', '.join(failed)}" if failed else ""))
    return 0 if not failed else 1


def reldigest() -> str:
    import hashlib

    return hashlib.sha256(SRC.read_bytes()).hexdigest()[:8]


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
