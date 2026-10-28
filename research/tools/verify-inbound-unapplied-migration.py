#!/usr/bin/env python3
"""实测 ADR-0077 §6 那条部署顺序断言：迁移没 apply 时，读面到底是"读成 NULL"还是响亮地死。

来历：这一格原先由两枚**仓库外**的文件带（`~/.heyta-evidence/inbound-hosted-extraction-20261027/probe-unapplied-{migration.py,client.cjs}`），
而 ADR §6 按"复现"引它 —— 同一枚"只活在这台机器上"的缺陷，本线已为 AC 电池（10-17）与变异臂台架（10-28 晚）各修过一次。
这枚文件把它搬进被跟踪目录：两档的**形状**照抄，客户端 .cjs 内联成临时文件（跑完随临时目录销毁，仓库里不留第二枚件）。
`--root` 的默认值改成"从本文件位置推仓库根"，不再写死某个人机器上的绝对路径。

跑法：
    python3 research/tools/verify-inbound-unapplied-migration.py                # 两档跑完 + 自判
    python3 research/tools/verify-inbound-unapplied-migration.py --print-shape  # 只打印两档的关键形状，便于贴台账

它自己带三道**会拒跑**的闸（不是注释）：
 1. 分母闸：迁移清单里找不到 `SKIP` 那一枚 ⇒ rc=2。分母不对，两档的差别就不存在，"读回同一个形状"会被读成结论。
 2. 缺件闸：这台机器找不到 `initdb` ⇒ rc=2（探针没跑 ≠ 没有这件事）。
 3. 🔴 形状闸（自判，写死的预期）：**没 apply 那一档里那一列必须不存在、且两头发 create 都必须报 `P2022`；
    补上那一枚之后那一列必须在**。任何一项不符 ⇒ rc=1 并点名是哪一项。
    为什么必须有它：前身只是把读数**印出来**给人看，读的人一旦不在场，"跑完了"就退化成"结论成立"。
    而这一格**没有常驻的替代物**可依赖：仓里唯一碰到 `hostedExtraction` 的常驻用例是
    `server/tests/inbound-automation.routes.spec.ts`，它用假 store，压根不碰真库 ——
    "真 Prisma + 真 Postgres 在两档下各报什么"只有本探针证得到，所以它必须自带判决。

它只读不写仓库：被跟踪的那份一个字不改，客户端从 `--root` 那棵树读。一次性 Postgres 是私有 initdb + 空闲端口，
建的库也属于本探针、随临时目录销毁，不碰任何在册库。读数落 `<root>/.run-logs/…`（gitignore 内）。
"""

from __future__ import annotations

import argparse
import getpass
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import quote

DB_NAME = 'heyta_unapplied_probe'
SKIP = '20261027000000_add_hosted_inbound_extraction'
COLUMN = "column_name='hosted_extraction'"

# 内联的一次性客户端：只打印稳定原因码与错误首行，不打印任何用户内容。
CLIENT = r"""
const { createRequire } = require('node:module');
const label = process.argv[2] || 'probe';
const applied = process.argv[3] === 'applied';
const req = createRequire(process.env.HEYTA_SERVER_PKG);
const { PrismaClient } = req('@prisma/client');
const prisma = new PrismaClient();
const firstLine = (text) => String(text || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
async function attempt(name, fn) {
  try {
    const value = await fn();
    console.log(`${label} · ${name} ⇒ OK ${JSON.stringify(value)}`);
    return { ok: true, value };
  } catch (error) {
    console.log(`${label} · ${name} ⇒ ${error?.code || error?.name || 'ERR'} | ${firstLine(error?.message)}`);
    return { ok: false };
  }
}
(async () => {
  let userId = 999999;
  if (applied) {
    const created = await attempt('先造一枚探针用户（给写面用）', () => prisma.user.create({
      data: { email: 'probe-unapplied@invalid.local' }, select: { id: true },
    }).then((u) => u.id));
    if (created.ok) userId = created.value;
  }
  await attempt('读面 findFirst（每一发 webhook 都要按它判走哪条腿）',
    () => prisma.automationRule.findFirst({ where: { id: 'probe-does-not-exist' } }).then((r) => r === null ? 'null' : 'row'));
  await attempt('读面 count（规则列表那一屏）', () => prisma.automationRule.count());
  await attempt('写面 create 不带 hostedExtraction（旧形状）', () => prisma.automationRule.create({
    data: { id: 'probe-write-1', userId, keyId: 'k1', allowedFields: ['title'], parseVersion: 1, maxItems: 50 },
  }).then((r) => r.id));
  await attempt('写面 create 带 hostedExtraction:true（面板上那个开关）', () => prisma.automationRule.create({
    data: { id: 'probe-write-2', userId, keyId: 'k1', allowedFields: ['title'], parseVersion: 1, maxItems: 50, hostedExtraction: true },
  }).then((r) => r.id));
  if (applied) {
    // 那一列存在之前的旧行长什么样：用裸 SQL 插一行、故意不写 hosted_extraction，再从读面取回来。
    await attempt('裸 SQL 插一枚"旧行"（不写 hosted_extraction）', () => prisma.$executeRaw`
      INSERT INTO automation_rules (id, user_id, key_id) VALUES ('probe-legacy-1', ${userId}, 'k1')`);
    await attempt('旧行经读面回来：hostedExtraction 原值 / === true 的结果', () => prisma.automationRule
      .findFirst({ where: { id: 'probe-legacy-1' } })
      .then((r) => ({ raw: r?.hostedExtraction ?? 'null-or-undefined', asOpensThisLeg: r?.hostedExtraction === true })));
  }
  await prisma.$disconnect();
})();
"""


def run(cmd: list[str], env: dict[str, str], log, cwd: Path | None = None, check: bool = True) -> int:
    completed = subprocess.run([str(c) for c in cmd], cwd=str(cwd) if cwd else None, env=env,
                               stdout=log, stderr=subprocess.STDOUT, text=True)
    if check and completed.returncode != 0:
        log.write(f'\n🔴 这一步失败 rc={completed.returncode}: {cmd}\n')
        raise SystemExit(completed.returncode)
    return completed.returncode


def column_count(pg: Path, url: str, env: dict[str, str], log) -> int:
    out = subprocess.run([str(pg / 'psql'), url, '-At', '-c',
                          f'SELECT count(*) FROM information_schema.columns WHERE table_name=\'automation_rules\' AND {COLUMN}'],
                         env=env, capture_output=True, text=True)
    log.write(f'column_probe rc={out.returncode} stdout={out.stdout.strip()} stderr={out.stderr.strip()}\n')
    match = re.search(r'\d+', out.stdout)
    return int(match.group(0)) if match else -1


ANSI = re.compile(r'\x1b\[[0-9;]*m')


def p2022_count(client_out: str) -> int:
    """这一次客户端输出里报 `P2022`（列/表不存在）的发数（读面也可能一起报，那是**更响**，不是不符）。"""
    return len(re.findall(r'⇒\s*P2022', ANSI.sub('', client_out)))


def create_p2022(client_out: str) -> int:
    """只数那两头发**写面 create** 的行 —— 形状闸钉的是这两枚，不能拿总数冒充。"""
    clean = ANSI.sub('', client_out)
    return len([line for line in clean.splitlines() if '写面 create' in line and 'P2022' in line])


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--pg-bin', default=None)
    parser.add_argument('--root', default=str(Path(__file__).resolve().parents[2]))
    parser.add_argument('--print-shape', action='store_true')
    parser.add_argument('--help', action='store_true')
    args = parser.parse_args()
    if args.help:
        print(__doc__)
        return 0

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f'🔴 分母闸之外：找不到仓库根 {root} —— 探针没跑，不许读成"没有这件事"')
        return 2
    found = shutil.which('initdb')
    if not found:
        print('🔴 这台机器上找不到 initdb —— 探针没跑，不许读成"没有这件事"')
        return 2
    migrations = sorted((root / 'server/prisma/migrations').glob('*/migration.sql'))
    if not any(SKIP in str(m) for m in migrations):
        print(f'🔴 分母闸：迁移清单里没有 {SKIP} ⇒ 两档的差别不存在，探针作废（不读成"结论成立"）')
        return 2
    pg = Path(args.pg_bin or str(Path(found).parent))
    logs = root / '.run-logs'
    logs.mkdir(exist_ok=True)
    log_path = logs / f'inb-unapplied-{time.strftime("%m%d-%H%M")}.txt'

    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    url = f'postgresql://{quote(getpass.getuser())}@127.0.0.1:{port}/{DB_NAME}'
    env = {**os.environ, 'DATABASE_URL': url, 'NO_COLOR': '1',
           'HEYTA_SERVER_PKG': str(root / 'server' / 'package.json')}

    shape: dict[str, object] = {}
    with tempfile.TemporaryDirectory(prefix='heyta-unapplied-probe-') as temporary:
        base = Path(temporary)
        data = base / 'data'
        client = base / 'probe-client.cjs'
        client.write_text(CLIENT, encoding='utf-8')
        with log_path.open('w', encoding='utf-8') as log:
            log.write(f'root={root}\nport={port}\ndb={DB_NAME}\nmigrations_total={len(migrations)}\nskip={SKIP}\n')
            run([pg / 'initdb', '-D', data, '-A', 'trust', '--no-locale', '--encoding=UTF8'], env, log)
            run([pg / 'pg_ctl', '-D', data, '-l', base / 'postgres.log', '-o',
                 f'-h 127.0.0.1 -p {port} -k {base} -c shared_buffers=16MB -c work_mem=1MB '
                 f'-c maintenance_work_mem=16MB -c max_connections=32', '-w', 'start'], env, log)
            try:
                run([pg / 'createdb', '-h', '127.0.0.1', '-p', port, DB_NAME], env, log)
                # 会话时区钉成 UTC：生产的 Postgres 本来就是 UTC，载体要等于生产。
                run([pg / 'psql', url, '-v', 'ON_ERROR_STOP=1', '-c',
                     f"ALTER DATABASE {DB_NAME} SET timezone='UTC'"], env, log)

                def apply(migration: Path) -> None:
                    sql = migration.read_text()
                    transaction = [] if 'CONCURRENTLY' in sql.upper() else ['--single-transaction']
                    run([pg / 'psql', url, '-v', 'ON_ERROR_STOP=1', *transaction, '-f', migration], env, log)

                missing = [m for m in migrations if SKIP not in str(m)]
                for migration in missing:
                    apply(migration)
                log.write(f'\n=== 档一：没 apply（已应用 {len(missing)} 枚，跳过 {SKIP}） ===\n')
                shape['column_before'] = column_count(pg, url, env, log)
                one = subprocess.run(['node', str(client), '没apply'], env=env, cwd=str(root / 'server'),
                                     capture_output=True, text=True)
                log.write(one.stdout + one.stderr)
                shape['p2022_before'] = p2022_count(one.stdout + one.stderr)
                shape['create_p2022_before'] = create_p2022(one.stdout + one.stderr)

                apply(next(m for m in migrations if SKIP in str(m)))
                log.write('\n=== 档二：补上那一枚之后 ===\n')
                shape['column_after'] = column_count(pg, url, env, log)
                two = subprocess.run(['node', str(client), 'apply之后', 'applied'], env=env, cwd=str(root / 'server'),
                                     capture_output=True, text=True)
                log.write(two.stdout + two.stderr)
                shape['p2022_after'] = p2022_count(two.stdout + two.stderr)
                shape['legacy_line'] = ('asOpensThisLeg' in two.stdout and '"raw":"null' in two.stdout.replace(' ', ''))
            finally:
                run([pg / 'pg_ctl', '-D', data, '-m', 'fast', 'stop'], env, log, check=False)
                log.write('\n--- 载体已停、随临时目录销毁；那枚库是本探针自己建的，没动任何在册库 ---\n')

    print(f'读数原件 {log_path}')
    for key, value in shape.items():
        print(f'{key}={value}')
    bad = []
    if shape.get('column_before') != 0:
        bad.append(f"档一那一列本该不存在，实读 column_before={shape.get('column_before')}")
    if shape.get('create_p2022_before') != 2:
        bad.append(f"档一两头发写面 create 本该各报一次 P2022，实读 create_p2022_before={shape.get('create_p2022_before')}"
                   f"（总 P2022 数={shape.get('p2022_before')}，读面一起报只算更响，不算不符）")
    if shape.get('column_after') != 1:
        bad.append(f"档二本该有那一列，实读 column_after={shape.get('column_after')}")
    if shape.get('p2022_after') != 0:
        bad.append(f"档二不该再有 P2022（列已在），实读 p2022_after={shape.get('p2022_after')}")
    if not shape.get('legacy_line'):
        bad.append('档二没读到"旧行经读面回来是 null、`=== true` 为 false"那一行（第二档的客户端少跑了或输出形状变了）')
    if bad:
        print('🔴 形状闸不成立（探针跑了，但读到的不是 §6 那两句话的形状）：')
        for line in bad:
            print(f'   · {line}')
        return 1
    print('✅ 形状闸成立：没 apply ⇒ 那一列不存在 + 两头发 create 都 P2022（**响亮地死**，不是安静退回设备档）；'
          '补上之后 ⇒ 列在、旧行经读面回来是 null ⇒ `=== true` 为 false ⇒ 归设备')
    return 0


if __name__ == '__main__':
    sys.exit(main())
