#!/usr/bin/env python3
"""反向验证：入站接收层那几句"坏了没人会知道"的判据，摘掉裁决必须转红。

为什么需要它：AC-2 的「并发限额」「持久化失败不返回 accepted」「插入竞态」三句，
此前在**测试侧**没有任何尺（全仓 grep `InboundQueueLimitError|QUEUE_EVENTS_LIMIT|
QUEUE_BYTES_LIMIT` 命中 0 处）。补了用例之后，"用例存在"仍然不等于"用例有牙" ——
唯一能回答"生产代码把裁决删掉时这套测试会不会红"的办法，是把裁决真的摘掉跑一次。

跑法：
    python3 research/tools/verify-inbound-queue-teeth.py              # 全部臂
    python3 research/tools/verify-inbound-queue-teeth.py --self-test  # 只测这台装置自己

两枚控制臂的理由（仓规：只测"能红"会把判据写成永远红）：
  · **静止臂**（inert）：改一处对行为没有影响的字节，整套必须仍然全绿 ——
    它排除"装置永远红"（vitest 起不来、路径写错、解析器读不到 × 行，都会永远红）。
  · **失配臂**（只在 `--self-test` 里）：给一枚源码里不存在的模式，装置必须
    **响亮拒绝**而不是跳过。否则将来有人把那两句裁决改写成别的形状，
    这台装置会在"一臂都没变异成功"的状态下报绿。

它只写 `server/src/automation/inbound.routes.ts` 一枚文件；改前把原始字节留在内存，
另存一份 `.mut-bak` 在**仓库外**（不污染 `git status --porcelain`），每臂跑完立即还原并核
sha256。任何一臂没能还原成开局那枚哈希就 exit 3 并把还原命令打在屏幕上 —— 共享检出里
绝不留变异。
"""
import argparse
import hashlib
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TARGET = os.path.join(REPO, 'server', 'src', 'automation', 'inbound.routes.ts')
SERVER = os.path.join(REPO, 'server')
SPEC = 'tests/inbound-automation.routes.spec.ts'
BACKUP = os.path.join('/private/tmp/heyta-inbound-queue-teeth', 'inbound.routes.ts.mut-bak')

RED = re.compile(r'^\s+×\s+(.+?)\s+[\d.]+(?:ms|s)\s*$', re.M)

# (名字, 被摘掉的裁决原文, 换上的等价物, 期望转红的用例名子串 | None=期望保持全绿)
ARMS = [
    ('队列条数上限',
     "if (events >= MAX_QUEUE_EVENTS) throw new InboundQueueLimitError('events');",
     "if (events >= MAX_QUEUE_EVENTS) Logger.warn('mutant: queue event cap not enforced');",
     'accepts up to the queue event cap'),
    ('队列字节上限',
     "if (!Number.isSafeInteger(bytes) || bytes + Buffer.byteLength(payloadCiphertext, 'utf8') > MAX_QUEUE_BYTES) throw new InboundQueueLimitError('bytes');",
     "if (!Number.isSafeInteger(bytes) || bytes + Buffer.byteLength(payloadCiphertext, 'utf8') > MAX_QUEUE_BYTES) Logger.warn('mutant: queue byte cap not enforced');",
     'counts the sealed envelope against the byte cap'),
    ('写失败仍报 accepted',
     "return reply.status(500).send({ error: 'Inbound event could not be accepted' });",
     "return reply.status(202).send({ error: 'Inbound event could not be accepted' });",
     'does not report accepted when the enqueue write itself fails'),
    ('插入竞态不重读赢家（直接漏 500）',
     "if ((error as { code?: string }).code !== 'P2002') throw error;",
     "if (true) throw error;",
     're-reads the winner on an insert race'),
    ('插入竞态不比内容（赢家照单收下）',
     "if (winner.dedupeDigest !== digest || winner.contentType !== contentType) {",
     "if (winner.dedupeDigest === digest && winner.contentType === contentType) {",
     're-reads the winner on an insert race'),
    ('静止对照：注释改动不许让任何用例变红',
     "const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;",
     "const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // inert",
     None),
]


def sha256(path):
    with open(path, 'rb') as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def run_suite():
    """返回 (rc, 转红的用例名列表)。读的是 vitest 自己的 × 行，不读汇总数字。"""
    env = dict(os.environ, NO_COLOR='1')
    proc = subprocess.run(
        ['npx', '--no-install', 'vitest', 'run', '--maxWorkers=1', SPEC],
        cwd=SERVER, env=env, capture_output=True, text=True,
    )
    return proc.returncode, RED.findall(proc.stdout + proc.stderr)


def apply(original, pattern, replacement):
    hits = original.count(pattern)
    if hits != 1:
        return f'PATTERN_MISS(命中 {hits} 处，要求恰好 1 处)'
    with open(TARGET, 'w', encoding='utf-8') as handle:
        handle.write(original.replace(pattern, replacement))
    return None


def restore(original, before):
    with open(TARGET, 'w', encoding='utf-8') as handle:
        handle.write(original)
    after = sha256(TARGET)
    if after != before:
        print(f'RESTORE_FAILED 开局 {before} 现量 {after}')
        print(f'  手工还原：cp {BACKUP} {TARGET}')
        return 3
    return 0


def run_arms(arms, label):
    original = open(TARGET, encoding='utf-8').read()
    before = sha256(TARGET)
    os.makedirs(os.path.dirname(BACKUP), exist_ok=True)
    with open(BACKUP, 'w', encoding='utf-8') as handle:
        handle.write(original)
    print(f'{label}　目标={os.path.relpath(TARGET, REPO)}　开局 sha256={before[:16]}　备份={BACKUP}')

    verdicts, failures = [], 0
    try:
        for name, pattern, mutant, expect_red in arms:
            miss = apply(original, pattern, mutant)
            if miss:
                # 失配 = 裁决换了形状，这台装置不再能证明有牙；必须算一臂不成立。
                print(f'  {name}: {miss}')
                verdicts.append((name, 'PATTERN_MISS'))
                failures += 1
                continue
            rc, red = run_suite()
            restored = restore(original, before)
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
        restore(original, before)

    print(f'臂数={len(verdicts)}　不成立={failures}　末次 sha256={sha256(TARGET)[:16]}（须等于开局那枚）')
    return 1 if failures else 0


def self_test():
    """失配臂：模式在源码里不存在时，装置必须报 PATTERN_MISS 并非零退出。"""
    bogus = [('不存在的裁决（负面对照）',
              "if (events >= MAX_QUEUE_EVENTS + 999999) throw new InboundQueueLimitError('nope');",
              "if (false) throw new InboundQueueLimitError('nope');",
              're-reads the winner on an insert race')]
    code = run_arms(bogus, '自测：失配必须响亮拒绝')
    # 期望：非零退出（PATTERN_MISS 记成一臂不成立），而且**没有**动过源码。
    if code == 0:
        print('SELF_TEST_FAILED: 失配臂居然报绿 —— 这台装置会在没变异任何东西时报"有牙"')
        return 1
    print('SELF_TEST=OK（失配臂被拒；真臂的绿只有在模式确实命中时才算数）')
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
