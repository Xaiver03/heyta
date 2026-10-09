#!/usr/bin/env python3
"""反向验证：AC-1 票据那一半的**线协议形状**有牙吗 —— 摘掉裁决/码/脱敏，用例必须转红。

为什么要它：`server/tests/inbound-ticket-rejection-route.spec.ts` 入库前现量过——
`git grep -l 'ENTITLEMENT_TICKET_REJECTED' HEAD -- server/tests` 回 **0 个文件**，
`ticketCode` 只在一份被 `DATABASE_URL` 门控的集成档里断过（默认 `pnpm -r test` 一跑都不跑）。
补了那 15 条之后，"用例存在"仍然不等于"用例有牙"：唯一能回答"生产代码把这一格删掉时
这套测试会不会红"的办法，是把那一格真的删掉跑一次。

七臂各对应一句能红的话（不是多写几臂显得严格）：
  1 402 换成 409            → 终态被说成可重试（宿主会对着一枚永远不合法的票退避重试）
  2 响应装配丢 ticketCode    → 界面说不出"是过期了还是要重新绑定"，前者该自愈、后者必须找人
  3 预检那一路不带上游码      → `precheckOnly` 分支回的形状缺字段（两条路各写一遍就会有一处漏）
  4 消费那一路不带上游码      → 同一格在另一条分支上漏
  5 审计丢码                → 运营者只看到"有人被拒"，查不到是哪一枚码
  6 把票据正文写进响应        → 违背"响应只回码、不回显票据/主体/账号"那条披露
  7 关闭规则也要票（`when` 失效）→ "管理/关闭规则不要求付费"这句承诺
  8 **静止对照**（inert）：只改一个对行为无影响的字节，全套必须仍然全绿 ——
    它排除"装置永远红"（vitest 起不来、路径写错、解析器读不到 × 行，都会永远红）。
另两臂只在 `--self-test`：失配必须被拒（PATTERN_MISS），而且**并行写入保险丝真的会触发**。
保险丝在本仓库的第一版里是恒等自比、永不触发的（`restore` 拿同一个文件算两次同一个哈希），
所以那一臂不是装饰：它证明"别人在我变异窗口里写过"这件事今天有人会喊。

🔴 写两枚文件：`server/src/entitlement.ts`（工作树 == HEAD，无并行改动）与
`server/src/api.ts`（**带着并行那条线未提交的 hunk** —— BLOCKED.md B124 登记的就是这一格）。
开局快照取**工作树字节**而不是 `git show HEAD:`：还原的是"我进来时看到的那份"，
并行那条线的未提交改动不会被我还掉（仓规：变异还原只从 `.mut-bak`，不从 git）。
每臂还原前先核"当前字节 == 我写进去的那份变异字节"，不一致就把意外字节另存到仓库外、
大声报出两枚哈希，再落回开局那份。任何一臂没能还原成开局哈希就 exit 3 并打出还原命令。

跑法：
    python3 research/tools/verify-inbound-ticket-teeth.py              # 全部臂
    python3 research/tools/verify-inbound-ticket-teeth.py --self-test  # 只测这台装置自己
"""
import argparse
import hashlib
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENTITLEMENT = os.path.join(REPO, 'server', 'src', 'entitlement.ts')
API = os.path.join(REPO, 'server', 'src', 'api.ts')
SERVER = os.path.join(REPO, 'server')
BACKUP = '/private/tmp/heyta-inbound-ticket-teeth'
SPECS = [
    'tests/inbound-ticket-rejection-route.spec.ts',
    'tests/automation-entitlement-ticket.spec.ts',
    'tests/automation-entitlement-issuer.spec.ts',
    'tests/inbound-entitlement-write-tx.spec.ts',
    'tests/inbound-ai-quota-route.spec.ts',
]

RED = re.compile(r'^\s+×\s+(.+?)\s+[\d.]+(?:ms|s)\s*$', re.M)

REPLY_402 = "  return reply.status(402).send(automationRejectionBody(decision.reason, decision.code));"
LEAK_402 = ("  return reply.status(402).send({ ...automationRejectionBody(decision.reason, decision.code), "
            "ticket: String((req.headers as Record<string, string>)['x-heyta-entitlement-ticket'] ?? '') });")

# (名字, 目标文件, 被摘掉的原文, 换上的等价物, 期望转红的用例名子串 | None=期望保持全绿)
ARMS = [
    ('终态被说成可重试（402 改成 409）',
     ENTITLEMENT, REPLY_402,
     "  return reply.status(409).send(automationRejectionBody(decision.reason, decision.code));",
     '坏签名：402 + TICKET_INVALID，且 nonce 没被烧掉'),
    ('响应装配不再带 ticketCode',
     ENTITLEMENT, "  ...(code === undefined ? {} : { ticketCode: code }),",
     "  ...(false ? { ticketCode: code } : {}),",
     '错主体：绑定行记的主体与票据不符 ⇒ 402 且 ticketCode 是 SUBJECT_CONFLICT'),
    ('预检那一路把上游拒绝码丢掉（两条分支各写一遍就会有一处漏）',
     ENTITLEMENT,
     "decision = inspected.ok ? { allowed: true } : { allowed: false, reason: 'ENTITLEMENT_TICKET_REJECTED', code: inspected.code };",
     "decision = inspected.ok ? { allowed: true } : { allowed: false, reason: 'ENTITLEMENT_TICKET_REJECTED' };",
     '预检档（worker/register）：坏签名回 402 + TICKET_INVALID，且闸门根本不开事务'),
    ('消费那一路把上游拒绝码丢掉',
     ENTITLEMENT,
     "if (error instanceof AutomationEntitlementError) return { allowed: false, reason: 'ENTITLEMENT_TICKET_REJECTED', code: error.code };",
     "if (error instanceof AutomationEntitlementError) return { allowed: false, reason: 'ENTITLEMENT_TICKET_REJECTED' };",
     '重放：nonce 已存在 ⇒ 402 + TICKET_USED（这一枚确实要撞唯一约束）'),
    ('审计里丢码（运营者只看到"有人被拒"）',
     ENTITLEMENT, "    ...(decision.code === undefined ? {} : { ticketCode: decision.code }),",
     "    ...(false ? { ticketCode: decision.code } : {}),",
     '拒绝里不回显票据正文、官方主体、本地账号 UUID 与 nonce（响应与审计两侧都查）'),
    ('把票据正文写进响应（违背"只回码不回显"那一格）',
     ENTITLEMENT, REPLY_402, LEAK_402,
     '拒绝里不回显票据正文、官方主体、本地账号 UUID 与 nonce（响应与审计两侧都查）'),
    ('关闭规则也要票（`when` 那半判据失效）',
     API, "when: (req) => (req.body as { enabled?: unknown } | undefined)?.enabled === true,",
     "when: () => true,",
     '关闭规则不带票也不许被权益挡住（"管理/关闭规则不要求付费"这一句在线层有尺）'),
    ('静止对照：注释改动不许让任何用例变红',
     ENTITLEMENT, "  | 'ENTITLEMENT_TICKET_REJECTED';",
     "  | 'ENTITLEMENT_TICKET_REJECTED'; // inert",
     None),
]


def sha256(path):
    with open(path, 'rb') as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def run_suite():
    """返回 (rc, 转红的用例名列表)。读的是 vitest 自己的 × 行，不读汇总数字。"""
    env = dict(os.environ, NO_COLOR='1')
    proc = subprocess.run(
        ['npx', '--no-install', 'vitest', 'run', '--maxWorkers=1', *SPECS],
        cwd=SERVER, env=env, capture_output=True, text=True,
    )
    return proc.returncode, RED.findall(proc.stdout + proc.stderr)


class Targets:
    """两枚目标的开局字节 / 哈希 / 仓库外备份，以及"只还原我改过的那一枚"的核对。"""

    def __init__(self, paths):
        self.paths = paths
        self.original = {}
        self.mutated = {}
        self.before = {}
        for path in paths:
            with open(path, encoding='utf-8') as handle:
                self.original[path] = handle.read()
            self.before[path] = sha256(path)
            os.makedirs(BACKUP, exist_ok=True)
            with open(os.path.join(BACKUP, os.path.basename(path) + '.mut-bak'), 'w', encoding='utf-8') as handle:
                handle.write(self.original[path])

    def apply(self, path, pattern, replacement):
        """命中恰好一次才写入；否则返回一句 PATTERN_MISS 让调用方记成一臂不成立。"""
        hits = self.original[path].count(pattern)
        if hits != 1:
            return f'PATTERN_MISS(命中 {hits} 处，要求恰好 1 处)'
        mutated = self.original[path].replace(pattern, replacement)
        with open(path, 'w', encoding='utf-8') as handle:
            handle.write(mutated)
        # 记下"本臂写进去的那份字节"，restore 才有可比的东西（不记就是恒等自比、永不触发）。
        self.mutated[path] = hashlib.sha256(mutated.encode('utf-8')).hexdigest()
        return None

    def restore(self, path, final=False):
        current = sha256(path)
        expected = self.mutated.pop(path, None)
        if expected is not None and current != expected:
            saved = os.path.join(BACKUP, f'{os.path.basename(path)}.unexpected-{current[:12]}.save')
            with open(path, encoding='utf-8') as handle:
                data = handle.read()
            with open(saved, 'w', encoding='utf-8') as handle:
                handle.write(data)
            print(f'RESTORE_GUARD {os.path.basename(path)} 当前 {current[:16]} != 本臂写入 {expected[:16]}')
            print(f'  ⇒ 窗口里有别的写入者；意外字节已另存 {saved}（没丢东西），随后落回开局那份')
        if final and current == self.before[path]:
            return 0
        with open(path, 'w', encoding='utf-8') as handle:
            handle.write(self.original[path])
        after = sha256(path)
        if after != self.before[path]:
            print(f'RESTORE_FAILED {os.path.basename(path)} 开局 {self.before[path][:16]} 现量 {after[:16]}')
            print(f'  手工还原：cp {os.path.join(BACKUP, os.path.basename(path) + ".mut-bak")} {path}')
            return 3
        return 0


def run_arms(arms, label):
    paths = sorted({arm[1] for arm in arms})
    state = Targets(paths)
    print(f'{label}　目标={len(paths)} 枚：' + '、'.join(os.path.relpath(p, REPO) for p in paths))
    for path in paths:
        print(f'  {os.path.relpath(path, REPO)}　开局 sha256={state.before[path][:16]}　备份={os.path.join(BACKUP, os.path.basename(path) + ".mut-bak")}')

    verdicts, failures = [], 0
    try:
        for name, path, pattern, mutant, expect_red in arms:
            miss = state.apply(path, pattern, mutant)
            if miss:
                print(f'  {name}: {miss}')
                verdicts.append((name, 'PATTERN_MISS'))
                failures += 1
                continue
            rc, red = run_suite()
            restored = state.restore(path)
            if restored:
                return restored
            if expect_red is None:
                holds = rc == 0 and not red
                note = f'rc={rc} 红={len(red)}（静止臂要求 rc=0 且 0 红）'
            else:
                holds = rc != 0 and any(expect_red in t for t in red)
                note = f'rc={rc} 命中用例={expect_red in " / ".join(red)}'
            print(f'  {name}: {"成立" if holds else "不成立"}　{note}')
            verdicts.append((name, '成立' if holds else '不成立'))
            failures += 0 if holds else 1
    finally:
        for path in paths:
            if state.restore(path, final=True):
                return 3

    for path in paths:
        print(f'  末次 sha256 {os.path.relpath(path, REPO)} = {sha256(path)[:16]}（须等于开局那枚）')
    print(f'臂数={len(verdicts)}　不成立={failures}')
    return 1 if failures else 0


def fuse_test():
    """保险丝臂：窗口里出现别的写入者时，`restore` 必须报 RESTORE_GUARD（这条判据得能红）。"""
    import contextlib
    import io
    _, path, pattern, mutant, _ = ARMS[-1]  # 静止臂：只改对行为无影响的字节，够用来测保险丝
    state = Targets([path])
    if state.apply(path, pattern, mutant):
        print('FUSE_TEST_FAILED: 静止臂没命中，这台装置连保险丝都没法自测')
        return 1
    with open(path, 'a', encoding='utf-8') as handle:  # 模拟并行那条线在我变异期间写了这个文件
        handle.write('\n// 外来写入（保险丝自测模拟）\n')
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        state.restore(path)
    text = buf.getvalue()
    if 'RESTORE_GUARD' not in text or sha256(path) != state.before[path]:
        print('FUSE_TEST_FAILED: 别人在窗口里写过，保险丝却没说 —— 这条判据永远不会触发')
        print(text or '（restore 什么都没报）')
        return 1
    print('  保险丝臂：成立（RESTORE_GUARD 报了，且落回开局那份 ' + sha256(path)[:16] + '）')
    return 0


def self_test():
    bogus = [('不存在的裁决（负面对照）',
              ENTITLEMENT,
              "  return reply.status(402).send(automationRejectionBody('NOPE_NOT_A_REASON', undefined));",
              "  return reply.status(409).send(automationRejectionBody('NOPE_NOT_A_REASON', undefined));",
              '坏签名：402 + TICKET_INVALID，且 nonce 没被烧掉')]
    code = run_arms(bogus, '自测一：失配必须响亮拒绝')
    if code == 0:
        print('SELF_TEST_FAILED: 失配臂居然报绿 —— 这台装置会在没变异任何东西时报"有牙"')
        return 1
    if sha256(ENTITLEMENT) != sha256(os.path.join(BACKUP, 'entitlement.ts.mut-bak')):
        print('SELF_TEST_FAILED: 失配臂居然写了源码')
        return 1
    print('  失配臂：被拒（真臂的绿只有在模式确实命中时才算数）')
    if fuse_test():
        return 1
    print('SELF_TEST=OK（失配臂被拒 + 保险丝会触发）')
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-test', action='store_true', help='只跑两臂负面对照')
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    return run_arms(ARMS, '全部臂')


if __name__ == '__main__':
    sys.exit(main())
