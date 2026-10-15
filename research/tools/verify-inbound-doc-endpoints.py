#!/usr/bin/env python3
"""把 AC-7 那句「端点与权限真实」从散文变成一枚**能红的尺**。

为什么要它：2026-10-15 14:3x 第一次手量这份契约时抓到两处真错 —— 对外协议文档里三枚端点**少了挂载前缀 `/api`**
（自托管运维照文档粘地址就是 404），以及一枚漂到别段代码上的 `path:行` 锚点。当时只改了那三处，
**没有任何东西阻止第四处出现**：`docs-link-check` 判的是链接与章节号，`verify-inbound-doc-tables` 判的是表格形状，
两把都不看端点字符串。本装置补的就是这一格。

判据（可达集合从**代码**算，不hard-code 任何前缀）：
  S1 挂载前缀：`server/src/server.ts` 里 `register(apiRoutes, { prefix: '…' })` 与
     `register(inboundAutomationRoutes, { prefix: '…' })` 各解出自己那一档 ⇒ 可达 URL = 前缀 + 注册字面。
     某个放路由的文件解不到归属前缀 ⇒ 拒绝（rc=2），因为那意味着 S1 的分母自己塌了。
  S2 文档里每一枚 `METHOD /…automation…` 都要落在可达集合里。参数名两侧都归一成 `:param`
     （文档写 `<ruleId>`、代码写 `:ruleId` 是同一枚路由；文档没有义务抄代码里的形参名）。
  S3 **对外件**（`docs/reference/` 那两份 = 运维与外部对接读的契约）只允许可达 URL；写成注册字面（少前缀）就红。
  S4 **内部件**（本计划与调研件）允许出现注册字面 —— 台账有"原句不删"的规矩，14:3x 那一节正是靠引用旧错句
     来说明改了什么。这些逐条打印成 `·` 清单（不判红），但**代码里根本没有的路径一律红**（打错字或路由被删）。
  S5 一枚端点的路径可达、但文档写的 HTTP 方法没注册 ⇒ 红（"权限/方法写错"这一类）。

自测六臂（两个方向都要有）：
  臂 1 静止对照：真仓库 ⇒ rc=0。
  臂 2 注入"对外件少了前缀"：临时副本里把一枚可达端点改成注册字面 ⇒ 必须 rc=1，输出里点名那份文档与那枚裸路径。
  臂 3 对照臂（同一份文件补回前缀）：必须 rc=0 —— 证明臂 2 的红来自**前缀**，不是"这枚端点装置根本不认识"。
  臂 4 前缀真从代码读：临时副本把 `server.ts` 的 `/api` 改成 `/gateway`、文档不动 ⇒ 必须 rc=1。
  臂 5 内部件的假路径：把一枚可达端点尾部加一个 `z` ⇒ 必须 rc=1；同一份不动 ⇒ 必须 rc=0（S4 那一半有牙）。
  臂 6 方法红：临时副本里把某枚可达端点的方法改成没注册过的 ⇒ 必须 rc=1（S5 的存在理由）。
退出码：0 成立 / 1 有端点不可达或方法不符 / 2 前置不成立（读不到代码或文档、前缀解不出来）。
臂数由 `self_test()` 自己在末尾打印，文档里不抄第二份（仓规）。
"""
import argparse
import re
import sys
import tempfile
from pathlib import Path

OUTWARD = [
    'docs/reference/inbound-automation-protocol.md',
    'docs/reference/pricing-and-entitlements.md',
]
INTERNAL = [
    'docs/plans/inbound-automation.md',
    'docs/research/inbound-automation-review.md',
]
# 路由字面所在文件 → 它在 server.ts 里由哪一次 register 挂上去
ROUTED_FILES = {
    'server/src/api.ts': 'apiRoutes',
    'server/src/automation/inbound.routes.ts': 'inboundAutomationRoutes',
}
DOC_TOKEN = re.compile(r'\b((?:GET|POST|PUT|DELETE|PATCH)(?:/(?:GET|POST|PUT|DELETE|PATCH))*)\s+(/[A-Za-z0-9_./:<>-]*automation[A-Za-z0-9_./:<>-]*)')
REGISTER_CALL = re.compile(r"register\(\s*(\w+)\s*,\s*\{([^}]*)\}")
PREFIX_KV = re.compile(r"prefix:\s*'([^']+)'")
ROUTE_LITERAL = re.compile(r"'(/[A-Za-z0-9_./:-]+)'")
METHOD_CALL = re.compile(r"\.(get|post|put|delete|patch)\s*[<(]")


def normalize(path: str) -> str:
    """两侧都归一：`<ruleId>` 与 `:ruleId` 都成 `:param`（文档写尖括号、代码写冒号是同一枚路由），
    并去掉尾部裸斜杠。参数**名字**不参与比较 —— 文档没有义务抄代码里的形参名。"""
    out = re.sub(r'<[^>/]+>', ':param', path)
    out = re.sub(r':[^/]+', ':param', out)
    return out.rstrip('/') or '/'


def mount_prefixes(server_ts: str) -> dict[str, str]:
    out = {}
    for name, body in REGISTER_CALL.findall(server_ts):
        found = PREFIX_KV.search(body)
        if found:
            out[name] = found.group(1)
    return out


def routes_in(source: str) -> set[tuple[str, str]]:
    """把 `fastify.post<…>(` / `.get('…')` 与紧随其后的那条路径字面配成 (METHOD, /path)。"""
    pairs: set[tuple[str, str]] = set()
    for m in METHOD_CALL.finditer(source):
        tail = source[m.end():m.end() + 240]
        lit = ROUTE_LITERAL.search(tail)
        if not lit:
            continue
        path = lit.group(1)
        if not path.startswith('/automation'):
            continue
        pairs.add((m.group(1).upper(), normalize(path)))
    return pairs


def collect(repo: Path):
    server_ts = (repo / 'server/src/server.ts').read_text(encoding='utf-8')
    prefixes = mount_prefixes(server_ts)
    reachable: set[tuple[str, str]] = set()
    literals: set[str] = set()
    used: dict[str, str] = {}
    for rel, reg_name in ROUTED_FILES.items():
        prefix = prefixes.get(reg_name)
        if prefix is None:
            return None, None, None, f'{rel} 的路由由 {reg_name} 挂载，但在 server.ts 解不到它的 prefix ⇒ 分母塌了'
        used[rel] = prefix
        src = (repo / rel).read_text(encoding='utf-8')
        for method, path in routes_in(src):
            reachable.add((method, prefix + path))
            literals.add(path)
    return reachable, literals, used, None


def check(repo: Path) -> int:
    missing_files = [p for p in [f'server/src/server.ts', *ROUTED_FILES, *OUTWARD, *INTERNAL] if not (repo / p).is_file()]
    if missing_files:
        print('REFUSE: 读不到 ' + ', '.join(missing_files))
        return 2
    reachable, literals, used, refuse = collect(repo)
    if refuse:
        print(f'REFUSE: {refuse}')
        return 2

    bad: list[str] = []
    bare_internal: list[str] = []
    tokens = 0
    reachable_paths = {p for _m, p in reachable}
    literal_paths = {normalize(l) for l in literals}
    for kind, docs in (('对外', OUTWARD), ('内部', INTERNAL)):
        for rel in docs:
            for lineno, line in enumerate((repo / rel).read_text(encoding='utf-8').splitlines(), 1):
                for methods, raw in DOC_TOKEN.findall(line):
                    path = normalize(raw)
                    for method in methods.split('/'):
                        tokens += 1
                        where = f'{kind} `{rel}:{lineno}`'
                        if (method, path) in reachable:
                            continue
                        if path in reachable_paths:
                            bad.append(f'{where} {method} {raw} ⇒ 该路径只注册了 '
                                       f'{sorted(m for m, p in reachable if p == path)} 这些方法')
                        elif kind == '内部' and path in literal_paths:
                            bare_internal.append(f'{where} {method} {raw}')
                        elif kind == '对外' and path in literal_paths:
                            bad.append(f'{where} {method} {raw} ⇒ 对外件写了注册字面、少挂载前缀'
                                       f'（可达 URL 应以 {sorted(set(used.values()))[0]} 开头）')
                        else:
                            bad.append(f'{where} {method} {raw} ⇒ 代码里没有这枚路由')

    prefixes_txt = ' '.join(sorted(set(used.values())))
    print(f'件数=文档 {len(OUTWARD)} 对外 + {len(INTERNAL)} 内部　可达端点={len(reachable)}　注册字面={len(literals)}　前缀={prefixes_txt}')
    print(f'端点引用={tokens}　不成立={len(bad)}　内部件的注册字面(不计红)={len(bare_internal)}')
    for b in bad:
        print('  🔴 ' + b)
    for b in bare_internal:
        print('  · ' + b)
    if bad:
        print(f'结论：{len(bad)} 处端点在当前代码上不可达或方法写错（AC-7 那句"端点与权限真实"红）')
        return 1
    print('结论：文档里每一枚端点都落在按挂载前缀算出的可达集合上，方法也对得上（成立）')
    return 0


def self_test() -> int:
    import io
    import shutil
    from contextlib import redirect_stdout

    repo = Path('.')
    failed: list[str] = []
    arms = 0

    def run(r: Path) -> int:
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = check(r)
        return rc, buf.getvalue()

    counter = {'n': 0}

    def make_repo(d: Path, mutate=None) -> Path:
        counter['n'] += 1
        r = d / f'repo{counter["n"]}'
        for rel in ['server/src/server.ts', *ROUTED_FILES, *OUTWARD, *INTERNAL]:
            src = repo / rel
            if not src.is_file():
                continue
            dst = r / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
        if mutate:
            mutate(r)
        return r

    # 臂 1 静止对照
    arms += 1
    rc1, _ = run(repo)
    print(f'臂 1 静止对照（真仓库）⇒ rc={rc1}（要求 0）：' + ('成立' if rc1 == 0 else '不成立'))
    if rc1 != 0:
        failed.append('臂 1')

    with tempfile.TemporaryDirectory(prefix='heyta-inb-endpoints-') as td:
        d = Path(td)

        proto = 'docs/reference/inbound-automation-protocol.md'
        probe_method, probe_path = None, None
        for methods, raw in DOC_TOKEN.findall((repo / proto).read_text(encoding='utf-8')):
            if raw.startswith('/api/'):
                probe_method, probe_path = methods.split('/')[0], raw
                break
        if not probe_path:
            print('臂 2..6 不成立：对外件里找不到一枚带前缀的端点可以拿来做变异')
            failed += ['臂 2', '臂 3', '臂 4', '臂 5', '臂 6']
        else:
            bare = probe_path[len('/api'):]

            # 臂 2 对外件少了前缀 ⇒ 红，且要点名
            arms += 1
            def drop_prefix(r: Path):
                p = r / proto
                p.write_text(p.read_text(encoding='utf-8').replace(f'{probe_method} {probe_path}', f'{probe_method} {bare}', 1), encoding='utf-8')
            r2 = make_repo(d, drop_prefix)
            rc2, out2 = run(r2)
            ok = rc2 == 1 and bare in out2 and proto in out2
            print(f'臂 2 对外件把 {probe_method} {probe_path} 改成 {bare} ⇒ rc={rc2}（要求 1）、点名该枚（文件+裸路径都在输出里）={ok}：'
                  + ('成立' if ok else '不成立'))
            if not ok:
                failed.append('臂 2')

            # 臂 3 同一份补回前缀 ⇒ 不许红
            arms += 1
            def add_prefix(r: Path):
                p = r / proto
                p.write_text(p.read_text(encoding='utf-8').replace(f'{probe_method} {bare}', f'{probe_method} {probe_path}', 1), encoding='utf-8')
            r3 = make_repo(d, lambda r: (drop_prefix(r), add_prefix(r)))
            rc3, _ = run(r3)
            print(f'臂 3 同一段再把前缀补回去 ⇒ rc={rc3}（要求 0）：' + ('成立' if rc3 == 0 else '不成立'))
            if rc3 != 0:
                failed.append('臂 3')

            # 臂 4 前缀只从代码读：改 server.ts，文档不动 ⇒ 必须红
            arms += 1
            def rename_prefix(r: Path):
                p = r / 'server/src/server.ts'
                t = p.read_text(encoding='utf-8')
                n = t.count("prefix: '/api'")
                assert n > 0, '注入没生效：server.ts 里找不到 prefix: /api'
                p.write_text(t.replace("prefix: '/api'", "prefix: '/gateway'"), encoding='utf-8')
            r4 = make_repo(d, rename_prefix)
            rc4, _ = run(r4)
            print(f'臂 4 只把挂载前缀改成 /gateway（文档不动，共 {1} 枚端点受影响）⇒ rc={rc4}（要求 1）：'
                  + ('成立' if rc4 == 1 else '不成立'))
            if rc4 != 1:
                failed.append('臂 4')

            # 臂 5 内部件的"代码里根本没有的路由"必须红；同一份不动必须绿
            arms += 1
            plan = 'docs/plans/inbound-automation.md'
            hit = None
            for line in (repo / plan).read_text(encoding='utf-8').splitlines():
                for methods, raw in DOC_TOKEN.findall(line):
                    if raw.startswith('/api/') and ' ' + raw not in ('',):
                        hit = (methods.split('/')[0], raw)
                        break
                if hit:
                    break
            if hit is None:
                print('臂 5 不成立：内部件里找不到一枚带前缀的端点可以做"路径不存在"的变异')
                failed.append('臂 5')
            else:
                m5, p5 = hit
                ghost = p5 + 'z'

                def make_ghost(r: Path):
                    p = r / plan
                    t = p.read_text(encoding='utf-8')
                    n = t.replace(f'{m5} {p5}', f'{m5} {ghost}', 1)
                    assert n != t, '注入没生效：那枚端点没被改成不存在的路径'
                    p.write_text(n, encoding='utf-8')
                rc5a, _ = run(make_repo(d))
                rc5b, out5b = run(make_repo(d, make_ghost))
                ok = rc5a == 0 and rc5b == 1 and ghost in out5b
                print(f'臂 5 内部件把 {m5} {p5} 写成 {ghost}：不动 rc={rc5a}（要求 0）／注入 rc={rc5b}（要求 1）：'
                      + ('成立' if ok else '不成立'))
                if not ok:
                    failed.append('臂 5')

                # 臂 6 方法写错 ⇒ 红（S5）
                arms += 1
                def wrong_method(r: Path):
                    p = r / proto
                    p.write_text(p.read_text(encoding='utf-8').replace(f'{probe_method} {probe_path}', f'DELETE {probe_path}', 1), encoding='utf-8')
                r6 = make_repo(d, wrong_method)
                rc6, out6 = run(r6)
                ok = rc6 == 1 and '方法' in out6
                print(f'臂 6 把 {probe_path} 的方法写成 DELETE ⇒ rc={rc6}（要求 1）：' + ('成立' if ok else '不成立'))
                if not ok:
                    failed.append('臂 6')

    print(f'臂数={arms}，不成立={len(failed)}' + ("" if not failed else " → " + ", ".join(failed)))
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default='.')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    return self_test() if args.self_test else check(Path(args.repo))


if __name__ == '__main__':
    sys.exit(main())
