#!/usr/bin/env python3
"""对账：这条线**开工以后**每一笔带过的路径，是否全在 Goal 白名单里。

为什么需要它：任务书完成条件第 2 条写的是"`git status --porcelain` 里非白名单路径的条目数与开工快照相同"。
这一条在共享检出上量的不是本线的动作（并行会话每时每刻在改自己的文件，那个数一定漂）——
已在 B102 登记。真正能回答"我有没有越界"的是**逐笔**对账：每一笔提交实际带过哪些路径。

跑法：
    python3 research/tools/verify-inbound-commit-scope.py                 # 默认：本机 2026-10-09 16:52 之后
    python3 research/tools/verify-inbound-commit-scope.py --since '<git 日期>'
    python3 research/tools/verify-inbound-commit-scope.py --self-test

臂的清单与**臂数**由 `self_test()` 自己在末尾打印，这里不抄（仓规：文档里不许抄臂数）。
每臂的存在理由都一样：`越界=0` 这一句有两种读法 —— "分类器看了、里面没有越界"，和
"根本没枚举到东西"。臂就是把后一种读法逐一排除掉：只有阳性对照的那一臂会红，
其余每一臂都在测"默认那一条能不能永远绿"。

白名单是照任务书正文抄进来的**死表**，不是从别处推的。任务书换了地界就改这里；
改这张表本身属于"判卷口径"，要负责人点头。
"""
import argparse
import re
import subprocess
import sys

KICKOFF = '2026-10-09 16:52'   # 本机时间，PROGRESS.md 开工回执第 4 条（任务 0 复跑那一段）
SUBJECT = '自动收集'

WHITELIST = [
    r'^server/src/automation/',
    r'^server/src/entitlement\.ts$',
    r'^server/src/api\.ts$',
    r'^server/prisma/schema\.prisma$',
    r'^server/prisma/migrations/',
    r'^server/tests/',
    r'^packages/inbound-core/',
    r'^packages/shared-schema/src/inbound-',
    r'^packages/app-host/package\.json$',
    r'^packages/app-host/src/index\.ts$',
    r'^packages/app-host/src/inbound-',
    r'^packages/app-host/tests/inbound-',
    r'^packages/domain/tests/inbound-',
    r'^packages/sync-client/tests/inbound-',
    r'^apps/web/src/features/settings/(InboundAutomationSettings\.tsx|inbound-automation\.css|inbound-runtime\.ts)$',
    r'^apps/web/tests/inbound-',
    r'^apps/mobile/src/inbound/',
    r'^e2e/playwright\.inbound\.config\.ts$',
    r'^e2e/tests/inbound-automation\.spec\.ts$',
    r'^docs/plans/inbound-automation\.md$',
    r'^docs/reference/inbound-automation-protocol\.md$',
    r'^docs/reference/pricing-and-entitlements\.md$',
    r'^docs/research/inbound-automation-review\.md$',
    r'^docs/research/evidence/inbound-automation-review/',
    r'^research/tools/verify-inbound-[^/]+\.py$',
    r'^PROGRESS\.md$',
    r'^BLOCKED\.md$',
]


def in_bounds(path: str) -> bool:
    return any(re.match(pattern, path) for pattern in WHITELIST)


def commits_since(since: str) -> list[tuple[str, str, str]]:
    out = subprocess.run(['git', 'log', f'--since={since}', '--format=%H\t%ad\t%s',
                          '--date=format:%m-%d %H:%M', f'--grep={SUBJECT}'],
                         capture_output=True, text=True).stdout.strip()
    rows = []
    for line in out.splitlines():
        if not line:
            continue
        sha, date, subject = line.split('\t', 2)
        rows.append((sha, date, subject))
    return rows


def touched(sha: str) -> list[str]:
    return subprocess.run(['git', 'diff-tree', '--no-commit-id', '--name-only', '-r', sha],
                          capture_output=True, text=True).stdout.split()


def report(since: str) -> int:
    rows = commits_since(since)
    if not rows:
        print(f'REFUSE: 窗口 `{since}` 之后一枚提交都没枚举到 —— 空分母不许报"越界 0"')
        return 1
    paths: dict[str, list[str]] = {}
    for sha, _, _ in rows:
        for path in touched(sha):
            paths.setdefault(path, []).append(sha[:8])
    oob = {p: c for p, c in paths.items() if not in_bounds(p)}
    print(f'窗口起 {since}　本线笔数={len(rows)}　涉及路径={len(paths)}　越界={len(oob)}')
    for path, shas in sorted(oob.items()):
        print(f'  OOB {path} {shas}')
    return 1 if oob else 0


KNOWN_OUT_OF_BOUNDS = {
    'packages/shared-schema/src/index.ts',
    'packages/shared-schema/tests/supersync-http-contract.spec.ts',
    'pnpm-lock.yaml',
}

# 只属于本线的路径（别的线不会去动它们）。用来**反查归属过滤本身有没有漏**：
# 笔的归属是按提交信息里的主题词取的，而本机 git user 对所有并行会话同值，作者字段区分不了。
# 若我自己某一笔没带那个词，report() 会静悄悄少算一笔 —— 那一笔真越界也不会报出来（假绿）。
# ⇒ 凡动了下面这些路径的笔，都必须落在被计入的那一堆里。
LINE_EXCLUSIVE = [
    'packages/inbound-core/',
    'docs/plans/inbound-automation.md',
    'docs/reference/inbound-automation-protocol.md',
    'docs/research/inbound-automation-review.md',
    'docs/research/evidence/inbound-automation-review/',
    'research/tools/verify-inbound-',
    'packages/shared-schema/src/inbound-',
    'packages/app-host/src/inbound-',
    'packages/app-host/tests/inbound-',
    'packages/domain/tests/inbound-',
    'packages/sync-client/tests/inbound-',
    'apps/web/tests/inbound-',
    'apps/mobile/src/inbound/',
    'e2e/tests/inbound-automation.spec.ts',
    'e2e/playwright.inbound.config.ts',
]


def is_line_exclusive(path: str) -> bool:
    return any(path.startswith(prefix) for prefix in LINE_EXCLUSIVE)


def commits_all(since: str) -> list[tuple[str, str, str]]:
    """窗口内**全部**提交（不带 --grep）—— 用来和按主题词计入的那一堆做差。"""
    out = subprocess.run(['git', 'log', f'--since={since}', '--format=%H\t%ad\t%s',
                          '--date=format:%m-%d %H:%M'], capture_output=True, text=True).stdout.strip()
    rows = []
    for line in out.splitlines():
        if line:
            sha, date, subject = line.split('\t', 2)
            rows.append((sha, date, subject))
    return rows


def attribution_check(since: str) -> tuple[list[str], int]:
    """返回（动了独占路径却没被主题词计入的提交, 被计入且含独占路径的笔数）。"""
    matched = {sha for sha, _, _ in commits_since(since)}
    escapes, matched_exclusive = [], 0
    for sha, _, _ in commits_all(since):
        hit = [p for p in touched(sha) if is_line_exclusive(p)]
        if not hit:
            continue
        if sha in matched:
            matched_exclusive += 1
        else:
            escapes.append(f'{sha[:8]}→{hit[0]}')
    return escapes, matched_exclusive


def self_test() -> int:
    arms = 0
    # 臂 1：阳性对照 —— 开工前那一批分组提交里有**已知命名的**三枚越界，把它们纳进窗口就必须逐枚报出来。
    # 这里要的是"这三枚都在报出的集合里"，不是"报了点什么" —— 后者换一条别的路径也算过，臂就没在测它声称的东西。
    rows = commits_since('2026-10-09 12:00')
    paths = {p for sha, _, _ in rows for p in touched(sha)}
    found = {p for p in paths if not in_bounds(p)}
    arms += 1
    missing = sorted(KNOWN_OUT_OF_BOUNDS - found)
    verdict = "全部命中（OK）" if not missing else "缺 " + ", ".join(missing) + " —— 这枚分类器没有牙"
    print(f"ARM-1 阳性对照：窗口内越界 {len(found)} 枚，已知三枚{verdict}")
    if missing:
        return 1
    # 臂 2：空窗口必须**响亮地拒绝**，而且要走真入口 report()，不是在外面自己判一次"有没有行"。
    arms += 1
    rc_empty = report('2099-01-01 00:00')
    print(f'ARM-2 空分母：report() rc={rc_empty} ⇒ '
          f'{"拒绝（OK）" if rc_empty == 1 else "放行 —— 这一臂不成立（没枚举到东西也报干净）"}')
    if rc_empty != 1:
        return 1
    # 臂 3：归属过滤的反查。两半缺一不可 ——
    #   a) 分母自检：被计入的那些笔里**必须真的有**独占路径，否则"漏网 = 0"是空集给的，不是过滤器给的；
    #   b) 判决：动了独占路径却没被计入的笔必须为 0。
    arms += 1
    escapes, matched_exclusive = attribution_check(KICKOFF)
    if matched_exclusive == 0:
        print("ARM-3 归属反查：计入的笔里独占路径 0 份 ⇒ 这一臂没有分母，不成立")
        return 1
    print(f"ARM-3 归属反查：计入的笔中含独占路径 {matched_exclusive} 笔（分母非空，OK）；"
          f"动了独占路径却没被计入 = {len(escapes)} ⇒ "
          + ("0（OK）" if not escapes else "漏网 " + ", ".join(escapes[:5])))
    if escapes:
        return 1
    print(f'臂数={arms}，全部成立=True')
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--since', default=KICKOFF)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    return self_test() if args.self_test else report(args.since)


if __name__ == '__main__':
    sys.exit(main())
