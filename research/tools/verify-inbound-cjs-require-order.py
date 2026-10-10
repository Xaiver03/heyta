#!/usr/bin/env python3
"""CJS 产物 require 顺序尺：**判的是编译产物**，源码只用来给指针。

为什么这一类必须有尺（2026-10-11 现量，不是假设）：
`server/src/automation/entitlement-ticket.ts` 在 HEAD 上把 `import { AUTOMATION_…_MS } from '@heyta/inbound-core'`
写在 `export const MAX_TICKET_SECONDS = AUTOMATION_…_MS / 1000;` **下面** 16 行。
- typecheck 绿：ESM 语义下 import 会提升；
- 单测绿：vitest 走 ESM 转译，同样提升；
- `pnpm check` 那十几道门禁里没有一道 require 过编译产物。
而 `server` 的 tsconfig 是 `"module": "commonjs"` ⇒ tsc 的产物**按源码顺序**落 `require`，
加载期那一行先跑到模块绑定 ⇒ `ReferenceError: Cannot access 'inbound_core_1' before initialization`，
`node dist/src/api.js` 起不来。"全绿"与"产物一加载就崩"能同时成立，这一格就只靠尺，不靠记性。

为什么判产物而不判源码 —— 本尺第一版就是判源码，当场假红：
`server/src/shares/share.routes.ts` 在那枚 import 之前用了 `Prisma`，但那是**类型位**用法
（`Prisma.TransactionClient`），tsc 把这枚导入整个擦掉 —— 现量：产物里
`grep -c 'require("@prisma/client")'` = **0**，根本没有那次 require，也就没有 TDZ。
按源码判就会拿别线的文件报假红。所以：**判决读产物**（模块绑定的 require 行 vs 深度 0 的首次引用行），
**指针读源码**（同路径 .ts 的行号）。

判据：
  R1 命中：产物里某枚模块绑定（`const x_1 = require("…")` / `var x_2 = require("…")`）的 require 行
     **晚于** 该绑定在花括号深度 0（= 模块加载期执行）被引用的行 ⇒ 判红，产物与源码两处行号都点名。
  R2 分母自洽：`有产物 + 无产物(未编译) == 该包在册 .ts(src) 数`，不等就红（路径写错、后缀漏了都会静默少扫）。
  R3 每枚 CJS 包至少扫到 1 枚产物 ⇒ 否则红（"零命中=全绿"是这台尺最危险的假绿）。
  R4 深度 > 0（函数/类/对象字面量体内）的引用**不算**：那要等到调用期，那时 require 早已执行完。
     `export { … } from` 那类行自带自己的 require，也不算早用。
  R5 判决只覆盖 tsconfig 里 `module: commonjs` 的包；ESM 产物里 import 会提升，那一类形状不成立。

自测（`--self-test`，**臂数由它自己打印，本文件不写这个数**）：静止 + 分母；在**真产物文本**上把 require 行挪到
首次引用之后 ⇒ 必须红并点名；指针臂（红格上给人看的两处行号必须映射得到）；合成正反两形；两条阴性对照
（函数体内、只剩 export-from）证明 R4 不是装饰；最后一臂用子进程跑 CLI 证真退出码（进程内 scan() 里没有 rc 这个词）。
退出码：0 干净 / 1 有 R1 或 R2/R3 不成立 / 2 装置自身前置不成立（没有 CJS 包、编译没产出、自测有臂不成立）。
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ROOTS = ['server', 'packages', 'apps']
BINDING_REQ = re.compile(r'^\s*(?:const|var|let)\s+(?P<bind>[A-Za-z_$][\w$]*)\s*=\s*require\(["\'](?P<spec>[^"\']+)["\']\)')
EXPORT_FROM = re.compile(r'^\s*export\s*\{')
COMMENTISH = re.compile(r'^\s*(//|/\*|\*)')
IMPORT_START = re.compile(r'^import\b')


def run(cmd, cwd=None):
    return subprocess.run(cmd, cwd=str(cwd or REPO), capture_output=True, text=True)


def head_text(rel):
    """HEAD 那一份的**原始字节**（空行不丢 —— 行号是这枚尺的读数，丢了就全错）。"""
    p = run(['git', 'show', f'HEAD:{rel}'])
    return p.stdout if p.returncode == 0 else None


def cjs_packages():
    """[(包目录相对路径, tsconfig 相对路径)] —— 判 module 是不是 commonjs，读 **HEAD** 的那份 tsconfig。"""
    out = []
    for root in ROOTS:
        base = REPO / root
        if not base.is_dir():
            continue
        dirs = [base] if root == 'server' else [d for d in sorted(base.iterdir()) if d.is_dir()]
        for d in dirs:
            rel_cfg = d.relative_to(REPO).as_posix() + '/tsconfig.json'
            text = head_text(rel_cfg)
            if text is None:
                continue
            if re.search(r'"module"\s*:\s*"commonjs"', text):
                out.append((d.relative_to(REPO).as_posix(), rel_cfg))
    return out


def tracked_ts(pkg):
    p = run(['git', 'ls-files', '--', f'{pkg}/src'])
    return sorted(x for x in p.stdout.splitlines() if x.endswith('.ts') and not x.endswith('.d.ts'))


def emit(pkg, cfg, outdir, src_root=None):
    # cfg 已经是"相对那棵树根"的那枚路径，所以 cwd 必须是那棵树的根。
    # 🔴 编译的必须是 **HEAD 的字节**：共享检出里工作树坐着别线在飞的改动，
    # 拿工作树编译会得到"当前恰好没这个形状"的假绿（本尺第一版就栽在这里）。
    root = Path(src_root) if src_root else REPO
    p = run(['npx', '--no-install', 'tsc', '-p', cfg, '--outDir', str(outdir)], cwd=root)
    return p.returncode, p.stdout + p.stderr


def materialize_head(pkg, tmp):
    """把 HEAD 里那枚包整棵铺到 tmp（`git archive` 不落工作树、不碰索引），再把 node_modules 软回来。"""
    a = subprocess.run(['git', '-C', str(REPO), 'archive', 'HEAD', pkg], capture_output=True)
    if a.returncode != 0 or not a.stdout:
        return False, f'git archive HEAD {pkg} 失败/空'
    t = subprocess.run(['tar', '-x', '-C', str(tmp)], input=a.stdout, capture_output=True)
    if t.returncode != 0:
        return False, f'解包失败：{t.stderr.decode("utf-8", "replace")[:200]}'
    for src, dst in ((REPO / 'node_modules', Path(tmp) / 'node_modules'),
                     (REPO / pkg / 'node_modules', Path(tmp) / pkg / 'node_modules')):
        if src.is_dir() and not dst.exists():
            dst.symlink_to(src)
    return True, ''


def _clean(line):
    line = re.sub(r'(["\'`])(?:\\.|(?!\1).)*\1', '""', line)
    line = re.sub(r'//.*$', '', line)
    return line


def scan_text(text):
    """产物文本上"模块绑定在 require 之前于深度 0 被引用"。返回 [{bind, spec, require_line, use_line}]"""
    lines = text.split('\n')
    req_at = {}
    for idx, ln in enumerate(lines, start=1):
        if COMMENTISH.match(ln):
            continue
        m = BINDING_REQ.match(ln)
        if m and m.group('bind') not in req_at:
            req_at[m.group('bind')] = (idx, m.group('spec'))
    best = {}
    depth = 0
    for idx, raw in enumerate(lines, start=1):
        ln = _clean(raw)
        if COMMENTISH.match(ln):
            depth += ln.count('{') - ln.count('}')
            if depth < 0:
                depth = 0
            continue
        binding_line = bool(BINDING_REQ.match(ln))
        stripped = ln.strip()
        for bind, (rline, spec) in req_at.items():
            if rline <= idx or (bind in best and best[bind]['use_line'] <= idx):
                continue
            if binding_line or EXPORT_FROM.match(stripped) or not stripped:
                continue
            # 🔴 深度要按**匹配点之前**的那一截算：`function f() { return core_1.K; }` 整行在深度 0 开始，
            #    可那个 token 其实躺在函数体里（调用期才执行）。按整行深度判就会把它当成加载期使用 —— 假红。
            for m in re.finditer(r'(?<![\w$.])' + re.escape(bind) + r'(?![\w$])', ln):
                local = depth + ln[:m.start()].count('{') - ln[:m.start()].count('}')
                if local == 0:
                    best[bind] = {'bind': bind, 'spec': spec, 'require_line': rline, 'use_line': idx}
                    break
        depth += ln.count('{') - ln.count('}')
        if depth < 0:
            depth = 0
    return list(best.values())


def parse_source_imports(lines):
    """返回 [{start, end, spec, names, type_only}]，覆盖单行与多行两种形状；空行不丢，行号才准。"""
    out, i = [], 0
    while i < len(lines):
        if IMPORT_START.match(lines[i].strip()) or re.match(r'^export\s.*\bfrom\b', lines[i].strip()):
            j = i
            while j < len(lines) and not re.search(r"from\s*['\"]", lines[j]):
                j += 1
            joined = '\n'.join(lines[i:j + 1])
            m = re.search(r"from\s*['\"]([^'\"]+)['\"]", joined)
            spec = m.group(1) if m else None
            is_type_import = bool(re.match(r'^import\s+type\b', lines[i].strip()))
            names = []
            body = re.search(r"\{([^}]*)\}", joined, re.S)
            if body:
                for part in body.group(1).split(','):
                    part = part.strip()
                    if not part or part.startswith('type '):
                        continue
                    names.append(re.split(r'\s+as\s+', part)[-1].strip())
            else:
                ns = re.match(r"^import\s+(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s*,|\s*$)", lines[i].strip())
                if ns and ns.group(1) != 'type':
                    names.append(ns.group(1))
            if spec:
                out.append({'start': i + 1, 'end': j + 1, 'spec': spec, 'names': names,
                            'type_only': is_type_import or not names})
            i = j + 1
            continue
        i += 1
    return out


def source_pointer(rel_ts, spec):
    """给指针：该模块串在源码里的 import 起始行，与它任一值绑定在深度 0 的最早使用行。"""
    p = run(['git', 'show', f'HEAD:{rel_ts}'])
    if p.returncode != 0:
        return None, None
    lines = p.stdout.split('\n')
    imports = parse_source_imports(lines)
    target = next((x for x in imports if x['spec'] == spec), None)
    if target is None or target['type_only']:
        return None, None
    use = None
    depth = 0
    for idx, raw in enumerate(lines, start=1):
        ln = _clean(raw)
        in_import = target['start'] <= idx <= target['end']
        # 🔴 只排除 `export { … } from '…'` 那类转发行；`export const X = …` 是**加载期的使用**，
        #    把它当声明排除掉，指针就永远指不到真凶那一行（本尺第一版就瞎在这里）。
        is_forward = bool(re.match(r'^export\s*(?:type\s*)?\{', ln.strip()))
        if depth == 0 and not in_import and not IMPORT_START.match(ln.strip()) and not is_forward and ln.strip():
            for n in target['names']:
                if use is not None:
                    break
                for m in re.finditer(r'(?<![\w$.])' + re.escape(n) + r'(?![\w$])', ln):
                    local = depth + ln[:m.start()].count('{') - ln[:m.start()].count('}')
                    if local == 0:
                        use = idx
                        break
        depth += ln.count('{') - ln.count('}')
        if depth < 0:
            depth = 0
    return use, target['start']


def scan(outdir):
    """outdir = 一棵临时树的根；HEAD 的包铺进 outdir/tree，产物进 outdir/dist。"""
    stats = {'pkgs': 0, 'tracked': 0, 'with_artifact': 0, 'no_artifact': 0, 'artifacts': 0}
    hits = []
    tree = Path(outdir) / 'tree'
    tree.mkdir(exist_ok=True)
    dist = Path(outdir) / 'dist'
    for pkg, cfg in cjs_packages():
        stats['pkgs'] += 1
        ok, why = materialize_head(pkg, tree)
        if not ok:
            return hits, stats, f'物化 HEAD 的 {pkg} 失败 ⇒ 判决此刻没有依据：{why}'
        rc, log = emit(pkg, cfg, dist, src_root=tree)
        if not dist.is_dir() or not any(True for _ in dist.rglob('*.js')):
            return hits, stats, f'编译 {pkg}（HEAD 的字节）没产出任何 .js（tsc rc={rc}）：{log[-300:]}'
        before = stats['with_artifact']
        for rel in tracked_ts(pkg):
            stats['tracked'] += 1
            js = dist / Path(rel).relative_to(pkg).with_suffix('.js')
            if not js.is_file():
                stats['no_artifact'] += 1
                continue
            stats['with_artifact'] += 1
            for h in scan_text(js.read_text(encoding='utf-8')):
                use, imp = source_pointer(rel, h['spec'])
                hits.append({'pkg': pkg, 'js': js.relative_to(dist).as_posix(), 'rel': rel,
                             'spec': h['spec'], 'js_use': h['use_line'], 'js_req': h['require_line'],
                             'src_use': use, 'src_req': imp, 'bind': h['bind']})
            stats['artifacts'] += 1
        if stats['with_artifact'] == before:
            return hits, stats, f'R3 不成立：{pkg} 一枚产物都没扫到'
    return hits, stats, None


def report(hits, stats, fatal, label=''):
    print(f'读数{label}　CJS 包={stats["pkgs"]}　在册 .ts={stats["tracked"]}　有产物={stats["with_artifact"]}　'
          f'无产物(未编译)={stats["no_artifact"]}　扫过的产物={stats["artifacts"]}　命中={len(hits)}')
    if fatal:
        print(f'结论：装置前置不成立 —— {fatal}')
        return 2
    if stats['with_artifact'] + stats['no_artifact'] != stats['tracked']:
        print('结论：R2 分母自洽不成立 ⇒ 本尺此刻不能判绿')
        return 2
    if not hits:
        print('结论：模块加载期引用的跨包 require 全部排在引用之前（"产物一加载就崩"这一类没有）')
        return 0
    for h in sorted(hits, key=lambda x: x['rel']):
        ptr = (f'源码 {h["rel"]}:{"?" if h["src_use"] is None else h["src_use"]} 是加载期引用、'
               f':{"?" if h["src_req"] is None else h["src_req"]} 才是那行 import'
               if h['src_use'] else f'源码指针未映射（{h["rel"]} —— 该行号是给人去核对的，别当成产物与源码不同步的结论）')
        print(f'🔴 {h["js"]}:{h["js_use"]}（绑定 {h["bind"]}，来自 {h["spec"]}）早于 :{h["js_req"]} 的 require ⇒ 一加载就 TDZ　{ptr}')
    return 1


FIXTURE_LATE = ('"use strict";\nexports.X = core_1.K / 1000;\n'
                'const core_1 = require("@heyta/inbound-core");\n')
FIXTURE_OK = ('"use strict";\nconst core_1 = require("@heyta/inbound-core");\n'
              'exports.X = core_1.K / 1000;\n')
FIXTURE_IN_FUNC = ('"use strict";\nfunction f() { return core_1.K; }\n'
                   'const core_1 = require("@heyta/inbound-core");\n')
FIXTURE_EXPORT_FROM = ('"use strict";\nvar core_2 = require("@heyta/inbound-core");\n'
                       'Object.defineProperty(exports, "K", { enumerable: true, get: function () { return core_2.K; } });\n'
                       'const core_1 = require("@heyta/inbound-core");\n'
                       'exports.Y = core_1.J;\n')


def self_test():
    bad = []
    n = 0

    def arm(label, cond, detail=''):
        nonlocal n
        n += 1
        print(f'{"✔" if cond else "🔴"} 臂 {n} {label}{"" if cond else " —— " + detail}')
        if not cond:
            bad.append(label)

    outdir = tempfile.mkdtemp(prefix='heyta-cjs-selftest-')
    try:
        hits, stats, fatal = scan(outdir)
        arm('静止：真编译 + R2/R3 分母自洽',
            fatal is None and stats['artifacts'] > 0 and
            stats['with_artifact'] + stats['no_artifact'] == stats['tracked'], f'{stats} fatal={fatal}')

        real = next(iter((Path(outdir) / 'dist').rglob('entitlement-ticket.js')), None)
        if real is None:
            arm('前置：产物里找得到那枚真文件', False, 'entitlement-ticket.js 不在产物里')
        else:
            text = real.read_text(encoding='utf-8')
            req_line = next((ln for ln in text.split('\n')
                             if BINDING_REQ.match(ln) and 'inbound-core' in ln), None)
            if not req_line:
                arm('把真产物的 require 挪到首次引用之后必须红并点名', False, '产物里没有那枚绑定')
            else:
                body = [ln for ln in text.split('\n') if ln != req_line]
                use_idx = max(i for i, ln in enumerate(body) if 'inbound_core_1.' in ln)
                mutated = '\n'.join(body[:use_idx + 1] + [req_line] + body[use_idx + 1:])
                found = scan_text(mutated)
                arm('把真产物的 require 挪到首次引用之后必须红并点名该绑定',
                    bool(found) and any(h['bind'].startswith('inbound_core') for h in found), str(found)[:200])

        # 指针臂：判决之外，红格上给人看的两处行号必须映射得到 —— 本尺第一版在这一点上是瞎的
        # （`export const X = …` 被当成"声明"排除，指针永远指不到真凶那一行，而判决那一半仍然正确，
        #  所以静止臂与变异臂都全绿、没人发现）。
        use, imp = source_pointer('server/src/automation/entitlement-ticket.ts', '@heyta/inbound-core')
        arm('指针臂：真文件的加载期使用行与那行 import 都映射得到',
            use is not None and imp is not None, f'use={use} imp={imp}')

        arm('合成"引用早于 require"必须红', len(scan_text(FIXTURE_LATE)) == 1, str(scan_text(FIXTURE_LATE))[:160])
        arm('合成"require 在引用之前"必须不红', scan_text(FIXTURE_OK) == [], str(scan_text(FIXTURE_OK))[:160])
        arm('阴性 R4：引用只在函数体内（调用期）必须不红', scan_text(FIXTURE_IN_FUNC) == [],
            str(scan_text(FIXTURE_IN_FUNC))[:160])
        arm('阴性 R4：export-from 自带 require、它自己那条 getter 不算早用',
            scan_text(FIXTURE_EXPORT_FROM) == [], str(scan_text(FIXTURE_EXPORT_FROM))[:200])
    finally:
        shutil.rmtree(outdir, ignore_errors=True)

    # 真退出码那一腿走子进程（进程内 scan() 里没有 rc 这个词）：
    # 用上面那次静止 scan 的结果算"应有的码"，不重编译第二遍。
    expect = 2 if fatal else (0 if not hits else 1)
    p = run([sys.executable, str(Path(__file__))])
    n += 1
    ok = p.returncode == expect
    print(f'{"✔" if ok else "🔴"} 臂 {n} 子进程退出码 == 静止命中应有的那个码（期望 {expect}，命中 {len(hits)} 处，实得 {p.returncode}）')
    if not ok:
        bad.append('臂 rc')

    print(f'臂数={n}　不成立={len(bad)}')
    return 0 if not bad else 2


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--self-test', action='store_true', help='六臂反向验证')
    ap.add_argument('--outdir', help='产物输出目录（默认 mktemp，跑完删除）')
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    keep = bool(args.outdir)
    outdir = args.outdir or tempfile.mkdtemp(prefix='heyta-cjs-order-')
    try:
        hits, stats, fatal = scan(outdir)
    finally:
        if not keep:
            shutil.rmtree(outdir, ignore_errors=True)
    return report(hits, stats, fatal)


if __name__ == '__main__':
    sys.exit(main())
