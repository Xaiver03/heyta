#!/usr/bin/env python3
"""链上每一道红的正文里有没有本线自己的文件 —— 把"其余都归别线"从聚合主张变成逐道判据。

为什么需要它：这条线两次把链的红按"整串都不是本线的"上报，两次都被逐枚复量推翻
（B201 那张表补出四枚本线自造的；2026-10-17 又量出第 21 道的断言 G 里点名本线设置件四处）。
"归别线"这句话此前没有任何一把尺能回答，所以它只能靠人记得去读每道原文。

判据（会红的那一条）：本线文件集合（由 `git log --grep` + `diff-tree` 现量出来，不是手抄名单）
里的任一路径出现在任一道红的正文里 ⇒ rc=1 并逐道打印。⚠️ 这是**筛查**不是终审：
命中的那一枚完全可能是别人的红恰好引用了我的文件，所以每一枚命中都要人来归层；
它保证的是"没人能在没读过命中的情况下说出『其余都归别线』"。

分母三条各自会红（缺任何一条，"没命中"就可能是尺瞎了）：
`RED=` 自报数 vs 解析到的红道数、总步数、本线文件集合为空。

🔴 **这把尺的边界（必读，否则 rc=0 会被当成"本线零枚红"）**：它看的是**红道正文里引用了本线的路径**。
本线自造的红有一种它看不见 —— "我动了 workspace 包与 lockfile，于是许可证渲染件过期了"
（B201 的 043／045 两枚就是这种：正文点名的是渲染器与镜像合同件，不是我这枚改动）。
所以 **rc=0 只说"没有引用型命中"，不说"本线没有红"**；B201 那张表仍是本线自造红的权威清单，
这把尺是它前面的筛子，不是它的替代。

跑法：
  python3 research/tools/verify-inbound-chain-ownership.py --log <链装置的同名日志>
  python3 research/tools/verify-inbound-chain-ownership.py --self-test
臂清单与臂数由 self_test() 自己在末尾打印。
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys

SUBJECT = '自动收集'
KEYWORDS = ('自动收集', '入站', 'inbound')
DOC_PREFIXES = ('docs/', 'PROGRESS.md', 'BLOCKED.md')
STEP_RE = re.compile(r'STEP=\s*(\d+)/(\d+)\s+RC=\s*(\S+)\s+SEC=\s*[\d.]+\s+CMD=(.*)')
RED_RE = re.compile(r'RED=(\d+)(?:\s+steps=\[([0-9,\s]*)\])?')


def _log_rows(repo: str, since: str, extra: list[str]) -> list[tuple[str, str]]:
    out = subprocess.run(['git', '-C', repo, 'log', f'--since={since}', '--format=%H%x09%s'] + extra,
                         capture_output=True, text=True).stdout.splitlines()
    return [tuple(r.split('\t', 1)) for r in out if r.strip()]


def line_commits(repo: str, since: str) -> list[str]:
    """主题行含关键字的那几笔 —— 本线归属的凭据。"""
    return [sha for sha, subj in _log_rows(repo, since, []) if any(k in subj for k in KEYWORDS)]


def owned_paths(repo: str, since: str, subject: str) -> tuple[set[str], int]:
    """本线笔实际带过的非文档件 —— **只认主题行含关键字的那几笔**。

    ⚠️ 不用 `git log --grep`：它匹配的是整条提交信息，别线那笔只要正文里提了一句"自动收集"，
    它带过的文件就被算进本线归属集（2026-10-17 实测：`255d3d7e` 是产品体验线的件，
    就这么把 `ListsSection.tsx` 与 `packages/ui/src/index.ts` 递了进来，第 6、23 道因此假命中）。
    这条噪声有专门的臂兜（臂 6），不是靠人记得。
    """
    shas = line_commits(repo, since)
    paths: set[str] = set()
    for sha in shas:
        t = subprocess.run(['git', '-C', repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', sha],
                           capture_output=True, text=True).stdout.split()
        paths.update(p for p in t if not p.startswith(DOC_PREFIXES))
    return paths, len(shas)


def mentioned_only_commits(repo: str, since: str, subject: str) -> list[tuple[str, str]]:
    """`--grep` 会算成本线笔、但主题行其实不含关键字的那几笔（= 正文提及）。"""
    return [row for row in _log_rows(repo, since, [f'--grep={subject}'])
            if not any(k in row[1] for k in KEYWORDS)]



def parse_log(text: str) -> tuple[list[tuple[int, str, str, str]], int | None]:
    """返回 [(道号, rc, 命令, 正文)] 与装置自报的 RED= 数。"""
    steps: list[tuple[int, str, str, str]] = []
    total: int | None = None
    current: list | None = None
    for line in text.splitlines():
        m = STEP_RE.match(line)
        if m:
            if current is not None:
                steps.append((current[0], current[1], current[2], '\n'.join(current[3])))
            total = int(m.group(2))
            current = [int(m.group(1)), m.group(3).strip(), m.group(4).strip(), []]
        elif current is not None:
            current[3].append(line)
    if current is not None:
        steps.append((current[0], current[1], current[2], '\n'.join(current[3])))
    declared = None
    rm = RED_RE.search(text)
    if rm:
        declared = int(rm.group(1))
    return steps, declared


def _path_token_re(p: str) -> re.Pattern:
    """整段路径当一个 token 匹配 —— 裸子串会让 `README.md` 命中 `docs/adr/README.md` 那种相邻件。"""
    esc = re.escape(p)
    return re.compile(rf'(?<![A-Za-z0-9._/\-]){esc}(?![A-Za-z0-9._/\-])')


def _distinctive(basename: str) -> bool:
    """按名匹配只对**独特文件名**启用：`package.json` 这类通用名会命中正文里别的同名件（实测 1、45 道就这么假命中过）。"""
    return '-' in basename or len(basename) >= 24


def scan(steps: list[tuple[int, str, str, str]], own: set[str]) -> list[tuple[int, str, list[str]]]:
    """整段路径 + **独特 basename** 两种形状都算命中。

    只比整路径会漏判：不少门禁打印的是文件名而不是全路径（051 打的是
    `inbound-dual-host-fault-windows.integration.spec.ts`）。basename 只在它**只对应一枚在册件**
    且名字独特时才用，否则同名撞车会把别人的红算到我头上。
    """
    pats = [(p, _path_token_re(p)) for p in sorted(own)]
    by_base: dict[str, list[str]] = {}
    for p in own:
        by_base.setdefault(p.rsplit('/', 1)[-1], []).append(p)
    base_pats = [(ps[0], _path_token_re(b)) for b, ps in sorted(by_base.items())
                 if len(ps) == 1 and _distinctive(b)]
    hits = []
    for n, rc, cmd, body in steps:
        if rc == '0':
            continue
        found = [p for p, rx in pats if rx.search(body)]
        found += [f'{p}（按名匹配）' for p, rx in base_pats if rx.search(body) and p not in found]
        if found:
            hits.append((n, cmd, sorted(found)))
    return sorted(hits)





def check(steps: list[tuple[int, str, str, str]], declared: int | None, own: set[str]) -> int:
    if not steps:
        print('🔴 解析到 0 道 —— 尺瞎了（日志形状不认，"没命中"不是结论）')
        return 1
    if not own:
        print('🔴 本线非文档件集合为空 —— 无法判归属（尺瞎了）')
        return 1
    reds = [s for s in steps if s[1] != '0']
    problems = []
    if declared is None:
        problems.append('日志里没有 RED= 自报数，分母无从对账')
    elif declared != len(reds):
        problems.append(f'RED= 自报 {declared}，解析到 {len(reds)} 道')
    hits = scan(reds, own)
    print(f'读数　总步={len(steps)}　红道={len(reds)}　本线非文档件={len(own)}　有本线路径的红道={len(hits)}')
    for n, cmd, found in hits:
        print(f'　· 第 {n} 道 {cmd} 正文点名：{"、".join(found[:6])}'
              + (f'（另有 {len(found) - 6} 枚）' if len(found) > 6 else ''))
    for p in problems:
        print(f'🔴 分母不符：{p}')
    if hits:
        print('🔴 结论：链上至少一道路的红正文里有本线自己的文件 —— 逐枚归层之前不许说"其余都归别线"')
        return 1
    if problems:
        return 1
    print('结论：本线文件没有出现在任何一道红的正文里（成立）')
    return 0


def self_test(repo: str, since: str) -> int:
    own, _ = owned_paths(repo, since, SUBJECT)
    if not own:
        print('🔴 归属集为空，臂没法测')
        return 1
    probe = sorted(own)[0]
    other = 'apps/mobile/src/screens/TotallyNotMine.tsx'
    ok = True

    def expect(name: str, body: str, want_rc: int) -> None:
        nonlocal ok
        steps, declared = parse_log(body)
        got = check(steps, declared, own)
        good = (got == want_rc)
        ok = ok and good
        print(f'{"✅" if good else "🔴"} 臂 {name}：期望 rc={want_rc} 实得 rc={got}')

    head = 'CHAIN total_steps=2\n'
    expect('阳性对照（红的正文点名本线件必须红）',
           head + f'STEP=  1/2 RC=  1 SEC=  1.0 CMD=pnpm check:x\n   ✗ {probe}:12 违例\n'
           + 'STEP=  2/2 RC=  0 SEC=  1.0 CMD=pnpm check:y\nRED=1\n', 1)
    expect('阴性（红的正文只点别线件不许红）',
           head + f'STEP=  1/2 RC=  1 SEC=  1.0 CMD=pnpm check:x\n   ✗ {other}:3 违例\n'
           + 'STEP=  2/2 RC=  0 SEC=  1.0 CMD=pnpm check:y\nRED=1\n', 0)
    expect('分母不符（自报数与解析数不等必须红）',
           head + f'STEP=  1/2 RC=  1 SEC=  1.0 CMD=pnpm check:x\n   ✗ {other}\n'
           + 'STEP=  2/2 RC=  0 SEC=  1.0 CMD=pnpm check:y\nRED=7\n', 1)
    expect('尺瞎了（一道都解析不到必须红）', 'CHAIN 什么都没写\n', 1)
    expect('绿道不算（本线件出现在绿道正文里不该红）',
           head + f'STEP=  1/2 RC=  0 SEC=  1.0 CMD=pnpm check:x\n   ok {probe}\n'
           + 'STEP=  2/2 RC=  0 SEC=  1.0 CMD=pnpm check:y\nRED=0\n', 0)

    expect('按名引用也算命中（门禁只打文件名时不许漏判）',
           head + f'STEP=  1/2 RC=  1 SEC=  1.0 CMD=pnpm check:x\n   ✗ {probe.split("/")[-1]}:7 违例\n'
           + 'STEP=  2/2 RC=  0 SEC=  1.0 CMD=pnpm check:y\nRED=1\n', 1)

    # 臂 6：归属凭据换成"主题行含关键字"之后，**正文提及那几笔独有的件必须不在归属集里**。
    # 这一臂测的是分类器本身：谁要是把 owned_paths 改回 `git log --grep`，orphan 立刻落进
    # 归属集，这臂就红 —— 而不是靠下一个人记得 --grep 会多算。
    subj_shas = set(line_commits(repo, since))
    mentioned = [sha for sha, _ in mentioned_only_commits(repo, since, SUBJECT)]
    subj_paths = _paths_of(repo, sorted(subj_shas))
    orphan = _paths_of(repo, mentioned) - subj_paths
    good6 = bool(mentioned) and bool(orphan) and orphan.isdisjoint(own)
    ok = ok and good6
    print(f'{"✅" if good6 else "🔴"} 臂 6 归属凭据：正文提及的笔={len(mentioned)}（它们独有的件 {len(orphan)} 枚，'
          f'一枚都不在归属集里=成立则绿；若有人改用 --grep 归类，这枚必红）')

    # 臂 8：通用名不许按名匹配（实测第 1、45 道就是这样被 `package.json` 假命中过）。
    good8 = (not _distinctive('package.json')) and (not _distinctive('index.ts')) \
        and _distinctive('inbound-dual-host-fault-windows.integration.spec.ts')
    ok = ok and good8
    print(f'{"✅" if good8 else "🔴"} 臂 8 通用名不按名匹配（package.json／index.ts 否，独特名是）')
    print(f'self_test arms=8 failed={0 if ok else 1}')
    return 0 if ok else 1


def _paths_of(repo: str, shas: list[str]) -> set[str]:
    paths: set[str] = set()
    for sha in shas:
        t = subprocess.run(['git', '-C', repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', sha],
                           capture_output=True, text=True).stdout.split()
        paths.update(p for p in t if not p.startswith(DOC_PREFIXES))
    return paths



def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--log', help='链装置的聚合日志（含 STEP=/RC=/CMD= 与 RED= 那行）')
    ap.add_argument('--since', default='2026-10-09 16:52')
    ap.add_argument('--repo', default='.')
    ap.add_argument('--self-test', action='store_true')
    a = ap.parse_args()
    if a.self_test:
        return self_test(a.repo, a.since)
    if not a.log:
        print('🔴 要 --log 或 --self-test')
        return 2
    with open(a.log, encoding='utf-8', errors='replace') as fh:
        text = fh.read()
    own, ncommits = owned_paths(a.repo, a.since, SUBJECT)
    print(f'读数　归属=主题行含 {"／".join(KEYWORDS)} 的那几笔（--since="{a.since}"）：本线笔={ncommits}　非文档件={len(own)}')
    steps, declared = parse_log(text)
    return check(steps, declared, own)


if __name__ == '__main__':
    sys.exit(main())
