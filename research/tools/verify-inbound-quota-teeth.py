#!/usr/bin/env python3
"""反向验证：AC-1 那句「额度耗尽拒绝且**不产生业务效果**」的判据，摘掉裁决必须转红。

为什么需要它：这一枚拒绝此前在**三层测试里都没有尺**（`verify-inbound-ad-metering-teeth`
那次普查记录的形状：单测把 `consumeManagedAiRequest` 打成"永远放行"、真 HTTP 集成档里
一个 `QUOTA` 码都没有、真库档从没传过 `limit`）。补了用例之后，"用例存在"仍然不等于
"用例有牙" —— 唯一能回答"生产代码把裁决删掉时这套测试会不会红"的办法，是把裁决真的摘掉跑一次。

跑法：
    python3 research/tools/verify-inbound-quota-teeth.py              # 全部臂
    python3 research/tools/verify-inbound-quota-teeth.py --self-test  # 只测这台装置自己

七臂各对应一句能红的话（不是"多写几臂显得严格"）：
  1 额度裁决整句摘掉        → "拒绝且不落账行、计数器不抬" 那两条断言
  2 used/limit 不往上传      → 界面那句"本月 300 次用完了"的数从哪来
  3 类型化拒绝退化成 Error   → 路由 `instanceof` 认不出 ⇒ 402 变 409（宿主会空转重试一整期）
  4 已有行短路失效           → 同一枚 attempt 的重放会二次收费
  5 路由的 402 收口摘掉      → 终态被说成可重试
  6 额度判定挪到 managed 之前 → 本机/自带端点被托管额度挡住（ADR-0010 的隐私立场）
  7 **静止对照**（inert）：改一处对行为没有影响的字节，整套必须仍然全绿 ——
    它排除"装置永远红"（vitest 起不来、路径写错、解析器读不到 × 行，都会永远红）。
  另：**失配臂**只在 `--self-test` 里：给一枚源码里不存在的模式，装置必须**响亮拒绝**而不是
    跳过。否则将来有人把那几句裁决改写成别的形状，这台装置会在"一臂都没变异成功"下报绿。

🔴 它写**两枚**文件：`server/src/automation/ai-metering.ts` 与 `server/src/api.ts`
（`server/src/entitlement.ts` 只读不改 —— 402 的收口那一句由第 5 臂在调用点摘掉就够，
动两处会让"哪一处是承重的"读不出来）。两枚都在任务白名单里。
每臂改前把**当前工作树字节**留在内存，另存 `.mut-bak` 在**仓库外**（不污染
`git status --porcelain`）。`api.ts` 此刻带着并行那条线未提交的 hunk，所以：
· 开局快照 = 工作树字节，**不是** `git show HEAD:` —— 还原的是"我进来时看到的那份"，
  并行那条线的未提交改动不会被我还掉（仓规：变异还原只从 `.mut-bak`，不从 git）；
· 还原前先核"当前字节 == 我写进去的那份变异字节"，**不一致就绝不覆盖**（那说明别人
  在这段窗口里写过）：先把意外字节另存到仓库外、再落回开局那份、并以 exit 3 大声报出三枚哈希。
任何一臂没能还原成开局那枚哈希就 exit 3 并把还原命令打在屏幕上 —— 共享检出里绝不留变异。
"""
import argparse
import hashlib
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
METERING = os.path.join(REPO, 'server', 'src', 'automation', 'ai-metering.ts')
API = os.path.join(REPO, 'server', 'src', 'api.ts')
SERVER = os.path.join(REPO, 'server')
BACKUP = '/private/tmp/heyta-inbound-quota-teeth'
SPECS = [
    'tests/automation-ai-metering.pglite.spec.ts',
    'tests/inbound-ai-quota-route.spec.ts',
    'tests/automation-ai-metering.spec.ts',
]

RED = re.compile(r'^\s+×\s+(.+?)\s+[\d.]+(?:ms|s)\s*$', re.M)

# (名字, 目标文件, 被摘掉的裁决原文, 换上的等价物, 期望转红的用例名子串 | None=期望保持全绿)
ARMS = [
    ('额度裁决整句摘掉（超额照单收下）',
     METERING,
     "if (!quota.allowed) throw new AutomationAiMeteringDeniedError({ reason: quota.reason, used: quota.used, limit: quota.limit });",
     "if (false) throw new AutomationAiMeteringDeniedError({ reason: quota.reason, used: quota.used, limit: quota.limit });",
     '额度用尽时预留被拒，且既不落账行也不把计数器抬过上限'),
    ('拒绝时把 used/limit 抹成 0（界面说不出用了多少）',
     METERING,
     "throw new AutomationAiMeteringDeniedError({ reason: quota.reason, used: quota.used, limit: quota.limit });",
     "throw new AutomationAiMeteringDeniedError({ reason: quota.reason, used: 0, limit: 0 });",
     '额度用尽时预留被拒，且既不落账行也不把计数器抬过上限'),
    ('类型化拒绝退化成普通 Error（路由认不出 ⇒ 402 变 409）',
     METERING,
     "throw new AutomationAiMeteringDeniedError({ reason: quota.reason, used: quota.used, limit: quota.limit });",
     "throw new Error('Automation AI metering denied');",
     '额度用尽回 402 + QUOTA_EXCEEDED，把 used/limit 给宿主，且不写账行'),
    ('已有行短路失效（同一枚重放二次收费）',
     METERING,
     "if (existing.length > 0) {",
     "if (false) {",
     '同一枚尝试的重放不因额度耗尽被拒（断链重试不能二次收费）'),
    ('路由的 402 收口摘掉（终态被说成可重试）',
     API,
     "if (error instanceof AutomationAiMeteringDeniedError) return replyAutomationMeteringRejection(req, reply, error.denial);",
     "if (false) return replyAutomationMeteringRejection(req, reply, error.denial);",
     '额度用尽回 402 + QUOTA_EXCEEDED，把 used/limit 给宿主，且不写账行'),
    ('额度判定挪到 managed 分支之前（本机/自带端点也被拦）',
     METERING,
     "if (billingSource === 'managed') {",
     "if (true) {",
     '额度耗尽挡不住本机与自带端点（隐私立场不由托管额度裁决）'),
    ('静止对照：注释改动不许让任何用例变红',
     METERING,
     "export const AUTOMATION_AI_ATTEMPT_STATES = ['reserved', 'sent', 'consumed', 'released', 'unknown'] as const;",
     "export const AUTOMATION_AI_ATTEMPT_STATES = ['reserved', 'sent', 'consumed', 'released', 'unknown'] as const; // inert",
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
    """两枚目标的开局字节 / 哈希 / 外部备份，以及"只还原我改过的那一枚"的核对。"""

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
        # 🔴 记下"我这臂写进去的那份字节"的哈希，`restore` 才有可比的东西。
        # 以前这里不记，于是那根保险丝拿同一个文件算两次同一个哈希再自比 —— 恒等、永不触发。
        self.mutated[path] = hashlib.sha256(mutated.encode('utf-8')).hexdigest()
        return None

    def restore(self, path, final=False):
        """还原并核三件事：还原后 == 开局哈希；还原前工作树 == 我写进去的那份变异字节。

        第二件事是并行那条线的保险丝：不一致说明窗口里别人写过，那**不能当成我的变异覆盖掉**，
        先把意外字节另存到仓库外，再落回开局那份，并大声报出两枚哈希。
        """
        current = sha256(path)
        expected = self.mutated.pop(path, None)  # pop 而不是 get：收尾那一遍不该再拿上一臂的哈希当预期
        if expected is not None and current != expected:
            saved = os.path.join(BACKUP, f'{os.path.basename(path)}.unexpected-{current[:12]}.save')
            with open(path, encoding='utf-8') as handle:
                data = handle.read()
            with open(saved, 'w', encoding='utf-8') as handle:
                handle.write(data)
            print(f'RESTORE_GUARD {os.path.basename(path)} 当前 {current[:16]} != 本臂写入 {expected[:16]}')
            print(f'  ⇒ 窗口里有别的写入者；意外字节已另存 {saved}（没丢东西），随后落回开局那份')
        if final and current == self.before[path]:
            return 0  # 收尾那一遍：已经是开局那份，不必再写一次
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
                # 失配 = 裁决换了形状，这台装置不再能证明有牙；必须算一臂不成立。
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
    """保险丝臂：窗口里出现别的写入者时，`restore` 必须**报出** RESTORE_GUARD。

    为什么要有这一臂：那根保险丝自己曾经坏过一整轮 —— 它把同一个文件的同一个哈希算两次再自比，
    恒等、永不触发。"能红的判据"要有人证明它真会红，否则修好它和没修好长得一样。
    """
    import contextlib
    import io
    _, path, pattern, mutant, _ = ARMS[-1]  # 静止臂：只改对行为没有影响的字节，够用来测保险丝
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
    """两臂负面对照：失配必须被拒、保险丝必须会触发。"""
    bogus = [('不存在的裁决（负面对照）',
              METERING,
              "if (!quota.allowed) throw new AutomationAiMeteringDeniedError({ reason: 'NOPE_NOT_A_REASON' });",
              "if (false) throw new Error('nope');",
              '额度用尽时预留被拒，且既不落账行也不把计数器抬过上限')]
    code = run_arms(bogus, '自测一：失配必须响亮拒绝')
    # 期望：非零退出（PATTERN_MISS 记成一臂不成立），而且**没有**动过源码。
    if code == 0:
        print('SELF_TEST_FAILED: 失配臂居然报绿 —— 这台装置会在没变异任何东西时报"有牙"')
        return 1
    if sha256(METERING) != sha256(os.path.join(BACKUP, 'ai-metering.ts.mut-bak')):
        print('SELF_TEST_FAILED: 失配臂居然写了源码')
        return 1
    print('  失配臂：被拒（真臂的绿只有在模式确实命中时才算数）')
    fuse = fuse_test()
    if fuse:
        return fuse
    print('SELF_TEST=OK（失配臂被拒 + 保险丝会触发）')
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-test', action='store_true', help='只跑失配负面对照')
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    return run_arms(ARMS, '全部臂')


if __name__ == '__main__':
    sys.exit(main())
