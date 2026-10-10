#!/usr/bin/env python3
"""双宿主故障窗口：真 PostgreSQL + 真 Fastify HTTP + **两枚各自独立的真 SQLite 文件宿主**，
逐条跑 `docs/plans/inbound-automation.md` 那张「AC-3 的故障注入窗口」清单。

为什么这件事必须有一个装置，而不是一条 `vitest` 命令：
窗口清单住在计划里，跑没跑全**只有计划那一侧知道**。本装置把分母**从计划现量**
（读那张编号列表，不在这里写死 13），再和套件自己打印的 `WINDOW=<n> RESULT=PASS|SKIP` 逐号对账：
  · 计划里有、套件没报的那一格 = 缺证据，红；
  · 套件报了、计划里没有的那一格 = 窗口号写错或清单被改过，红；
  · 一格 SKIP = 红（本仓库的规矩：`describe.skipIf(!DATABASE_URL)` 那种"环境没配就安静通过"
    在这里必须响亮地失败，因为它会把"没跑"说成"跑过了"）；
  · `Tests ... 0 passed` 或找不到汇总行 = 红（0/0 是最安静的假绿）。
它打印 `Windows: n/n` 作为自报读数。

它判的不是工作树的字节，是**产物**：套件通过 `@heyta/app-host` 包入口（= `dist/`）拿宿主实现，
所以跑之前先构建那一棵依赖，再当场做一次**字节对账**（产物必须不比源码旧）。
理由是本仓库踩过三次的那条（AGENTS §7 第 27 条）：只改 `packages/` 时构建产物可能还是上一代，
于是"绿"测的是旧代码。这一腿走 `pnpm --filter @heyta/app-host build -- --config.viteTest.` 之外的
tsup 配置不可靠，所以直接用 `mtime` 比 —— 与 `reinstall-all.sh` 那条 sha256 对账不同，这里要挡的
不是"远端与本地不一致"，而是"产物比源码旧"。

自测五臂（两个方向都要有，只测能红会把判据写成永远红）：
  臂 1 静止对照：分母对得上、PASS 齐 ⇒ 判绿（rc=0）；
  臂 2 注入缺失：把某一格的 PASS 从采集结果里抽掉 ⇒ 必须红，且要点名那一格；
  臂 3 注入 0/0：汇总行里没有 passed 数 ⇒ 必须红；
  臂 4 注入重复报号：同一格报两遍 ⇒ 必须非零退出（否则分母对账可以随便伪造）；
  臂 5 注入"尺瞎了"：喂一份"主表 1..10 读不到、只剩追加那三格"的计划文本 ⇒ 必须非零退出。
臂 5 不是假设：本装置第一版就瞎在这一处（正则少了 MULTILINE，`^` 只匹配整串开头），
而前四臂当时**全绿** —— 分母悄悄少 10 格不会让任何窗口变红，只会让"跑全了"变成假话。
退出码：0 全绿 / 1 有窗口缺证据或判红 / 2 装置自身前置不成立（PG 起不来、构建没产出、
产物比源码旧、分母现量为 0 或不连续、vitest 没跑起来）或自测有臂不成立。
"""
import argparse
import getpass
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote

SPEC = 'tests/integration/inbound-dual-host-fault-windows.integration.spec.ts'
CHILD = 'server/tests/integration/inbound-dual-host-child.mjs'
PLAN = 'docs/plans/inbound-automation.md'
WINDOW_REPORT = re.compile(r'^WINDOW=(\d+) RESULT=(PASS|SKIP)(?:\s+(.*))?$')
# 计划里那张清单的编号行：`1. 队列已落盘、…` / `11. 提交许可与…`
# 🔴 必须带 re.M：`^` 不带 MULTILINE 只匹配整串的开头，实测过一次"主表 1..10 一条没读到、
# 只读到追加那三格"，而分母变小不会让任何一格变红 —— 它只会让"跑全了"变成假话。
PLAN_ITEM = re.compile(r'^\s*(\d+)\.\s+\S', re.M)


def planned_windows(root: Path, text: str | None = None) -> list[int]:
    """现量分母：读计划里 AC-3 那张窗口清单的编号，不在装置里写死条数。

    只取「故障注入窗口」那一节之内的编号行，别的编号列表（实施顺序 1..7 那种）不算，
    否则分母会变成"两个清单的并集"，而那正是对不上还看不出来的形状。
    `text` 只给自测臂用（造一份"主表读不到"的计划文本），正常路径不传。
    """
    text = (root / PLAN).read_text() if text is None else text
    head = text.find('### AC-3 的十个故障注入窗口')
    if head < 0:
        raise SystemExit('R0 分母现量不成：计划里找不到「AC-3 的十个故障注入窗口」那一节')
    tail = text.find('\n## ', head + 1)
    section = text[head: tail if tail > 0 else len(text)]
    numbers = {int(m.group(1)) for m in PLAN_ITEM.finditer(section)}
    # 窗口 11/12/13 是后来追加在「第二轮复审」那一节的（见同文那段"新增故障窗口"），
    # 主表只写"原十个窗口全部保留" ⇒ 分母要把那一行里点名的编号并进主表，
    # 但**只并那一行**，别的段落不算（那一节还有 1..7 的实施顺序列表，混进来分母就虚高）。
    for line in text.splitlines():
        if line.startswith('新增故障窗口：'):
            numbers |= {int(n) for n in re.findall(r'(\d+)\.\s', line)}
    if not numbers:
        raise SystemExit('R0 分母现量不成：窗口清单读出 0 格（那一节被改了形，尺瞎了）')
    # 🔴 分母必须是从 1 开始的**连续**编号。这张表的编号是 1..N 递增、只增不改（同本仓库
    # 陷阱号/节号的纪律），所以"缺了中间某一格"或"从 11 开始"只有一个解释：**解析没读到**，
    # 而不是清单真的少了那一格。少了不会让任何窗口变红 —— 它只让"跑全了"变成假话，
    # 所以这一条必须自己响。（2026-10-10 本装置第一版就是这样瞎的：MULTILINE 漏了，
    # 主表 1..10 一条没读到，只剩追加那三格，而四臂全绿。）
    expected = set(range(1, max(numbers) + 1))
    if numbers != expected:
        raise SystemExit(f'R0 分母现量不成：读到 {sorted(numbers)}，缺 {sorted(expected - numbers)} '
                         '⇒ 窗口编号本该从 1 连续，缺号只可能是解析没读到（尺瞎了），不是清单少了格')
    return sorted(numbers)


def collect_windows(lines: list[str]) -> dict[int, tuple[str, str]]:
    reported: dict[int, tuple[str, str]] = {}
    for line in lines:
        match = WINDOW_REPORT.match(line.strip())
        if match is None:
            continue
        number = int(match.group(1))
        if number in reported:
            raise SystemExit(f'R4 同一格报了两遍：WINDOW={number}（窗口号必须唯一，否则分母对账是假的）')
        reported[number] = (match.group(2), (match.group(3) or '').strip())
    return reported


def vitest_summary(lines: list[str]) -> tuple[int, int]:
    """从 vitest 汇总行取 (passed, skipped)。找不到汇总行按 0/0 处理 —— 上面会拒。"""
    passed = skipped = 0
    for line in lines:
        if 'Tests' not in line:
            continue
        p = re.search(r'(\d+) passed', line)
        s = re.search(r'(\d+) skipped', line)
        passed = int(p.group(1)) if p else 0
        skipped = int(s.group(1)) if s else 0
    return passed, skipped


def freshness(root: Path) -> tuple[Path, list[Path]]:
    """返回 (app-host 产物, 比它新的源码)。产物比源码旧 ⇒ 这一趟测的是上一代代码。"""
    produced = root / 'packages/app-host/dist/index.js'
    if not produced.exists():
        raise SystemExit('R2 前置不成立：packages/app-host/dist/index.js 不存在（先构建）')
    newest = [path for path in root.glob('packages/*/src/**/*.ts')
              if path.is_file() and path.stat().st_mtime > produced.stat().st_mtime]
    return produced, sorted(newest)


def build_hosts(root: Path, log) -> None:
    log.write('--- build @heyta/app-host (+ deps) ---\n')
    log.flush()
    subprocess.run(['pnpm', '--filter', '@heyta/app-host...', 'build'], cwd=root,
                   stdout=log, stderr=subprocess.STDOUT, check=True)


def run_spec(root: Path, pg: Path, log, extra_env: dict[str, str]) -> tuple[int, list[str]]:
    """起一次性 PG、逐枚应用真迁移、跑套件；返回 (vitest rc, 采集到的输出行)。"""
    passed_env = {**os.environ, 'NO_COLOR': '1', **extra_env}
    with tempfile.TemporaryDirectory(prefix='heyta-inbound-dual-host-') as temporary:
        base = Path(temporary)
        data = base / 'data'
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        passed_env['DATABASE_URL'] = f'postgresql://{quote(getpass.getuser())}@127.0.0.1:{port}/heyta_dual_host'
        passed_env['HEYTA_DUAL_HOST_DB_DIR'] = str(base / 'hosts')

        def run(command, cwd=None):
            subprocess.run(command, cwd=cwd, env=passed_env, stdout=log,
                           stderr=subprocess.STDOUT, check=True)

        started = False
        try:
            run([str(pg / 'initdb'), '-D', str(data), '-A', 'trust', '--no-locale', '--encoding=UTF8'])
            run([str(pg / 'pg_ctl'), '-D', str(data), '-l', str(base / 'postgres.log'),
                 '-o', f'-h 127.0.0.1 -p {port} -k {base} -c shared_buffers=16MB -c work_mem=1MB '
                       f'-c maintenance_work_mem=16MB -c max_connections=32', '-w', 'start'])
            started = True
            run([str(pg / 'createdb'), '-h', '127.0.0.1', '-p', str(port), 'heyta_dual_host'])
            # 🔴 把这库的会话时区钉成 UTC。`automation_events.*_expires_at` 是
            # `timestamp without time zone`，Prisma 按 UTC 分量写入，而计量与租约的判定
            # 拿它和 `clock_timestamp()` 比 —— 会话时区不是 UTC 时那一步会差一个时区，
            # 刚发的租约当场读成"已过期"（本机 initdb 出来是 Asia/Shanghai，实测差 8 小时）。
            # 这不是放宽判据：生产的 Postgres 本来就是 UTC 会话，这里只是让载体等于生产。
            run([str(pg / 'psql'), passed_env['DATABASE_URL'], '-v', 'ON_ERROR_STOP=1',
                 '-c', "ALTER DATABASE heyta_dual_host SET timezone='UTC'"])
            applied = 0
            for migration in sorted((root / 'server/prisma/migrations').glob('*/migration.sql')):
                sql = migration.read_text()
                # SET LOCAL 和它的 DDL 必须留在同一个事务里；CONCURRENTLY 那类必须拆到事务外。
                transaction = [] if 'CONCURRENTLY' in sql.upper() else ['--single-transaction']
                run([str(pg / 'psql'), passed_env['DATABASE_URL'], '-v', 'ON_ERROR_STOP=1',
                     *transaction, '-f', str(migration)])
                applied += 1
            log.write(f'--- migrations applied: {applied} ---\n')
            command = ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts',
                       '--maxWorkers=1', SPEC]
            completed = subprocess.run(command, cwd=root / 'server', env=passed_env,
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            lines = completed.stdout.splitlines()
            log.write('--- vitest stdout ---\n' + completed.stdout + '\n')
            server_log = base / 'postgres.log'
            if server_log.exists():
                log.write('\n--- Disposable PostgreSQL server log ---\n' + server_log.read_text())
            return completed.returncode, lines
        finally:
            if started:
                subprocess.run([str(pg / 'pg_ctl'), '-D', str(data), '-m', 'fast', '-w', 'stop'],
                               env=passed_env, stdout=log, stderr=subprocess.STDOUT, check=False)


def grade(lines: list[str], planned: list[int]) -> tuple[list[str], int]:
    """把采集到的输出行按判据打分，返回 (要打印的行, 退出码)。0 绿 / 1 红。"""
    out: list[str] = []
    reported = collect_windows(lines)
    passed, skipped = vitest_summary(lines)
    rc_of_vitest = None
    for line in lines:
        marker = re.search(r'^VITEST_RC=(\d+)$', line.strip())
        if marker:
            rc_of_vitest = int(marker.group(1))
    red = False
    if not reported:
        out.append('R1 一格都没报：套件没打印任何 WINDOW= 行 ⇒ "跑了"和"没跑"在这里长得一样，判红。')
        red = True
    if passed == 0:
        out.append(f'R2 用例汇总 passed=0（skipped={skipped}）⇒ 0/0 不算证据，判红。')
        red = True
    if skipped > 0:
        out.append(f'R3 有 {skipped} 条被跳过：本装置不接受"环境没配就安静通过"。')
        red = True
    missing = [n for n in planned if n not in reported]
    extra = sorted(set(reported) - set(planned))
    if missing:
        out.append(f'R4 计划列了 {len(planned)} 格，套件没报这几格：{missing} ⇒ 覆盖不全，判红。')
        red = True
    if extra:
        out.append(f'R5 套件报了计划里没有的窗口号：{extra} ⇒ 号写错了，还是清单被改过没回写？判红。')
        red = True
    skipped_cells = sorted(n for n, (result, _) in reported.items() if result == 'SKIP')
    if skipped_cells:
        out.append(f'R6 这些格是 SKIP 的：{skipped_cells}（SKIP 在这里等于没跑）。')
        red = True
    for number in planned:
        if number not in reported:
            continue
        result, note = reported[number]
        flag = 'PASS' if result == 'PASS' else 'RED '
        out.append(f'  WINDOW={number:<3} {flag} {note[:120]}')
        if result != 'PASS':
            red = True
    if rc_of_vitest is None:
        out.append('R7 套件没回传 VITEST_RC ⇒ 判卷走的是进程内的读数，不是真退出码那一条腿。')
        red = True
    elif rc_of_vitest != 0 and not red:
        out.append(f'R7 vitest rc={rc_of_vitest} 而窗口全绿 ⇒ 有用例失败没进窗口报表（断言在窗口之外红了）。')
        red = True
    return out, (1 if red else 0)


def self_test(root: Path, planned: list[int]) -> int:
    """五臂：静止对照绿、抽一格红、0/0 红、重复报号红、**尺瞎了红**。"""
    lines = ['[InboundDualHost] Windows: %d/%d' % (len(planned), len(planned))]
    for number in planned:
        lines.append(f'WINDOW={number} RESULT=PASS synthetic')
    lines.append(' Tests  %d passed (unit tests)' % len(planned))
    lines.append('VITEST_RC=0')
    static_out, static_rc = grade(lines, planned)
    print('臂 1 静止对照：期望 rc=0 —— 实得 rc=%d' % static_rc)
    for line in static_out:
        print('   ' + line)
    if static_rc != 0:
        print('  ⇒ **不成立**：判据把静止态判红了，说明它不是"能绿"的那一条腿。')
        return 2
    dropped = planned[-1]
    mutated = [line for line in lines if not line.startswith(f'WINDOW={dropped} ')]
    mut_out, mut_rc = grade(mutated, planned)
    named = any(f'没报这几格' in line and str(dropped) in line for line in mut_out)
    print('臂 2 注入缺失（抽掉 WINDOW=%d 那一行）：期望 rc=1 且点名该格 —— 实得 rc=%d，点名=%s'
          % (dropped, mut_rc, named))
    for line in mut_out:
        print('   ' + line)
    if mut_rc != 1 or not named:
        print('  ⇒ **不成立**：抽掉一格还能判绿，这条尺没有牙。')
        return 2
    zero_lines = [f'WINDOW={n} RESULT=PASS x' for n in planned] + ['Tests  no tests']
    zero_out, zero_rc = grade(zero_lines, planned)
    print('臂 3 注入 0/0（汇总行没有 passed 数）：期望 rc=1 —— 实得 rc=%d' % zero_rc)
    for line in zero_out:
        print('   ' + line)
    if zero_rc != 1:
        print('  ⇒ **不成立**：0/0 判不出红，"套件里一条用例都没有"会被读成通过。')
        return 2
    dup_lines = lines + [f'WINDOW={planned[0]} RESULT=PASS again']
    try:
        grade(dup_lines, planned)
    except SystemExit as error:
        print('臂 4 注入重复报号：期望非零退出 —— 实得 SystemExit(%s)' % error)
    else:
        print('臂 4 注入重复报号：**不成立**（同一格报两遍没被拒）')
        return 2
    # 臂 5 = 挡"尺瞎了"：造一份"主表 1..10 读不到、只剩追加那三格"的计划文本。
    # 这正是本装置第一版的真实形状（MULTILINE 漏了），而它当时四臂全绿 ——
    # 分母变小不会让任何窗口变红，所以这一臂必须有，否则"跑全了"这句话没人守。
    blind = '### AC-3 的十个故障注入窗口\n\n11. 提交许可与暂停/撤销两种相反事务顺序\n\n## 下一节\n'
    try:
        planned_windows(root, blind)
    except SystemExit as error:
        print('臂 5 注入"主表读不到"的计划文本：期望非零退出 —— 实得 SystemExit(%s)' % str(error)[:150])
    else:
        print('臂 5 注入"主表读不到"的计划文本：**不成立**（分母悄悄少了 10 格还照样开工）')
        return 2
    real = planned_windows(root)
    if real != planned:
        print(f'臂 5 附查：自测用的分母与现量不一致 —— planned={planned} 现量={real}')
        return 2
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', help='Directory containing initdb/pg_ctl/psql/createdb')
    parser.add_argument('--log', default='/tmp/heyta-inbound-dual-host.log')
    parser.add_argument('--self-test', action='store_true', help='两臂反向验证，不碰数据库')
    parser.add_argument('--only', help='逗号分隔的窗口号，经 HEYTA_DUAL_HOST_ONLY 传给套件（只用于排障，不算验收）')
    parser.add_argument('--no-build', action='store_true', help='跳过构建（仅当已确认产物不比源码旧）')
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    planned = planned_windows(root)
    print('Planned windows (现量自 %s): %s' % (PLAN, planned))

    if args.self_test:
        return self_test(root, planned)

    found = shutil.which('initdb')
    if not args.pg_bin and not found:
        parser.error('PostgreSQL tools not on PATH; provide --pg-bin')
    pg = Path(args.pg_bin or str(Path(found).parent))
    if not (root / CHILD).exists():
        raise SystemExit(f'R2 前置不成立：子进程夹具 {CHILD} 不存在（真进程终止那几格没载体）')

    with open(args.log, 'w') as log:
        if not args.no_build:
            try:
                build_hosts(root, log)
            except subprocess.CalledProcessError as error:
                print(f'R2 前置不成立：@heyta/app-host 构建失败 rc={error.returncode}（读数见 {args.log}）')
                return 2
        produced, stale = freshness(root)
        if stale:
            print(f'R2 前置不成立：产物比源码旧 —— {produced} 旧于 {len(stale)} 枚源码文件，'
                  f'前几枚：{[str(p.relative_to(root)) for p in stale[:4]]}')
            print('   这一趟会测到上一代代码（AGENTS §7 第 27 条那个形状），所以不跑。')
            return 2
        extra_env: dict[str, str] = {}
        if args.only:
            # 排障旋钮走**环境变量**，不往 vitest 的命令行里塞未知参数（那会变成一个
            # 与"套件真跑不起来"长得一样的失败形状，归因会糊）。
            extra_env['HEYTA_DUAL_HOST_ONLY'] = args.only
            print('注意：--only 是排障旋钮，跑出来的不是全量证据（未选的格报 SKIP，装置按 SKIP 判红）。')
        try:
            vitest_rc, lines = run_spec(root, pg, log, extra_env)
        except subprocess.CalledProcessError as error:
            print(f'R2 前置不成立：一次性 PostgreSQL 或迁移没跑起来 rc={error.returncode}（读数见 {args.log}）')
            return 2
        lines = lines + [f'VITEST_RC={vitest_rc}']
        rows, code = grade(lines, planned)
        reported = collect_windows([line for line in lines if line.strip().startswith('WINDOW=')])
        print('\n'.join(rows))
        print('Windows: %d/%d' % (sum(1 for n in planned if reported.get(n, ('RED',))[0] == 'PASS'), len(planned)))
        print(f'Results: {Path(args.log).resolve()}')
        return code


if __name__ == '__main__':
    sys.exit(main())
