#!/usr/bin/env python3
"""生产者缝对账：只读 **HEAD 的字节**，排"消费者已入库、生产者留在工作树"这一类缺陷。

为什么要有这枚装置（B129 那次真实事故的形状）：
仓库里所有门禁都跑在**共享工作树**上 —— 生产者和消费者在同一棵树里就是齐的，于是
"已入库的代码引用了一枚只活在未提交 diff 里的成员"这一类缺陷，在唯一跑得动的载体上**永远不会现形**，
只在干净检出（CI、别的机器、下一位克隆的人）上炸。2026-10-10 05:5x 实测到一例本线自己的：
HEAD 已跟踪的 `packages/app-host/src/inbound-{key,secret}-store.ts` 有 24 处访问
`META_KEYS.INBOUND_*`，而这三枚成员的生产者 `packages/storage/src/stores.ts` 只活在未提交 diff ⇒
`@heyta/app-host` 在干净检出上编不过，而 `pnpm check` 在本机一路绿灯。

它判的是 HEAD，不是工作树：逐枚 `git show HEAD:<path>` 取字节。唯一读磁盘的地方是自测臂 3，
它读工作树那一代**只是为了扮演"生产者真入库了"**，不进正常判卷路径。

它查两维，都是"消费者已入库、生产者不在 HEAD"这一类，只是缺的东西形状不同：
① **成员缝** —— 已入库代码引用了某枚跨包具名绑定的成员，而那成员在生产包的 HEAD 源码里不存在（B129）。
② **模块缝** —— 已入库代码 import/`new URL()` 了一枚 HEAD 里根本没有的文件（B130：
   `inbound-process.ts` 引的 `./task-batch-actions.js` 从未被任何提交带进仓库）。
第一版只写了①。②是它自己照出来的：加了独立分母那一档（R7）之后，同一趟运行里就跳出一枚
`new URL('../fixtures/…')` 和两枚**跨行 import** —— 那意味着第一版不只漏了模块这一维，
连①里"跨包成员访问"都少算了 22 处（改成整句解析后：成员访问 105→127、命中 81→103）。

分档，且**只有机械可判的那几档判红**（照本仓 `mps-safety-assessment-prep` 硬规则 15 的分档纪律）：
  命中  成员在那枚生产包的 HEAD 源码里逐字出现 / 相对路径在 HEAD 解析得开 ⇒ 不判
  盲区  命名空间导入（`import * as ns`）、下标访问、生产包在 HEAD 没有任何 .ts ⇒ 只数不判
  登记  在 KNOWN_SEAMS / KNOWN_MODULE_SEAMS 里挂了 BLOCKED 号的已知缝 ⇒ 大声列出，不判红
  新缝  以上三档都不沾 ⇒ **判红**

规矩：
  R1 在册可寻：EXTRA_SCOPE 逐枚、以及两本登记档指向的消费者文件，都必须在 HEAD 跟踪得到。
     挡"清单里指向的文件被删了，装置安静地不执行还照样打印通过"。
  R2 新成员缝判红。  R5 新模块缝判红。
  R3 成员分母自洽：命中 + 盲区 + 登记 + 新缝 + 停用 == 独立取一次的成员访问总数。
  R4 / R6 登记不许过期：成员缝（R4）与模块缝（R6）若已在 HEAD 闭合，必须响亮报"请删登记并回写台账"（退 3）。
  R7 尺自己瞎了：源码里带代码后缀的相对路径，既不被整句解析抓到、又没逐枚登记进 REL_NOT_AN_IMPORT ⇒ 判红。
     这一档不是为了产品，是为了**这把尺不会悄悄变成只看得见旧写法** —— 跨行 import 就是这么被抓出来的。

盲区说在前头（它是**粗筛**，不是 typechecker）：命中档只要求那枚标识符在生产包的 HEAD 源码里逐字出现，
所以"名字出现在注释里 / 是另一枚对象的同名成员"会被算成命中（假绿方向）。精确那一腿是 B129 里
写明的 tsc 两臂还原（HEAD 那代生产者 → rc=2 + TS2339；工作树那代 → rc=0），这枚装置负责的是
**每次入库后都能一条命令重跑的那一遍粗筛**。

自测八臂，两个方向都要有：臂 1 注入一枚不存在的成员访问（R2）、臂 2 清单里放一枚 HEAD 没有的 path（R1）、
臂 3 把生产包换成含那三枚键的那一代（R4 必须说登记已过期，不许闷着变绿）、臂 4 静止对照不判红、
臂 5 **起子进程跑真 CLI 取退出码**：静止 rc=0，把登记档里那枚生产包名换成不存在的那枚后 rc=1、
臂 6 注入一枚指向不存在文件的相对 import（R5）、臂 7 把那枚登记过的生产者"入库"（R6 必须顶出来）、
臂 8 注入一枚带代码后缀却不是导入的相对路径（R7）。
只测"能红"会把判据写成永远红，只测"能绿"会把它写成永远绿；"退出码"这个词只在臂 5 出现 ——
其余各臂走的是进程内 scan()，它们判的是规矩命中，不是 rc。
"""
import argparse
import os
import posixpath
import re
import subprocess
import sys

REPO = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()

# 本线的落点：路径含 inbound / automation 的这些目录，逐枚自动进册（新入库的文件不用改这里）
SCOPE_PREFIXES = (
    "packages/app-host/", "packages/inbound-core/", "packages/shared-schema/src/",
    "packages/domain/tests/", "packages/sync-client/tests/", "server/src/", "server/tests/",
)
SCOPE_NAME = re.compile(r"inbound|automation", re.I)

# 路径名不含关键词、但确实是本线已入库的落点 —— 它们也要在册，否则缝就从这儿漏出去
EXTRA_SCOPE = [
    "server/src/api.ts",
    "server/src/entitlement.ts",
    "packages/app-host/src/index.ts",
]

# 已知且已登记的缝：(生产包, 成员) -> BLOCKED 号。登记不是放行，R4 会盯着它过期。
KNOWN_SEAMS = {
    ("packages/storage", "INBOUND_RECIPIENT_KEY"): "B129",
    ("packages/storage", "INBOUND_WORKER_CREDENTIAL"): "B129",
    ("packages/storage", "INBOUND_COMMIT_JOURNAL"): "B129",
}

MEMBER_STOP = {"prototype", "constructor"}
# 整句解析（跨行也算）。仓里普遍写成 `import {\n a, b,\n} from './x.js'`，按行锚定的正则抓不到 ——
# 那不只是漏一枚模块：跨包**成员访问**会整批看不见，于是"命中/新缝"两档同时少计，红就永远不红。
IMP = re.compile(r"(?<![\w$.])(?:import|export)\b(?P<clause>[^;]{0,4000}?)\bfrom\s*['\"](?P<spec>[^'\"]+)['\"](?![\w])")
REL_SIDE_EFFECT = re.compile(r"(?<![\w$.])import\s+['\"](?P<spec>\.{1,2}/[^'\"]+)['\"]")
REL_DYNAMIC = re.compile(r"import\(\s*['\"](?P<spec>\.{1,2}/[^'\"]+)['\"]\s*\)")
# `new URL('../fixtures/x.json', import.meta.url)` 是运行时要读的文件：干净检出上缺它和缺模块一样致命
NEW_URL = re.compile(r"new\s+URL\(\s*['\"](?P<spec>\.{1,2}/[^'\"]+)['\"]")
# 独立分母：源码里**任何**被引起来的相对路径（不经过上面几档）
REL_ANY = re.compile(r"['\"](?P<spec>\.{1,2}/[^'\"]+)['\"]")
CODE_EXT = (".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".css", ".json")
# 逐枚登记"相对路径是真的、但它不是导入语句"的那些（成本是刻意的：要么补一档，要么写清为什么不算）
REL_NOT_AN_IMPORT = {}


def _in_line_comment(src, pos):
    """命中的关键字之前、同一行里有没有 `//` —— 挡住"注释里提了一句路径"被读成导入。"""
    return "//" in src[src.rfind("\n", 0, pos) + 1:pos]


def iter_refs(src):
    """逐条给出 (kind, clause, spec)：kind ∈ {from, side, dyn, url}，clause 只有 from 那档有内容。"""
    for m in IMP.finditer(src):
        if not _in_line_comment(src, m.start()):
            yield "from", m.group("clause"), m.group("spec")
    for rx, kind in ((REL_SIDE_EFFECT, "side"), (REL_DYNAMIC, "dyn"), (NEW_URL, "url")):
        for m in rx.finditer(src):
            if not _in_line_comment(src, m.start()):
                yield kind, "", m.group("spec")

# 已知且已登记的**模块**缝：(消费者文件, 相对 spec) -> BLOCKED 号。登记不是放行，R6 会盯着它过期。
KNOWN_MODULE_SEAMS = {
    ("packages/app-host/src/inbound-process.ts", "./task-batch-actions.js"): "B130",
}

# 只给自测臂用的旋钮：假装这些路径在 HEAD 已被跟踪（= "生产者那一代入库了"）
EXTRA_TRACKED = []


def resolve_rel(consumer, spec, tracked_set):
    """把相对 spec 解析成 HEAD 里的真实路径；解析不出来 = HEAD 缺这枚模块。
    仓里的规矩是相对导入带 `.js` 而真文件是 `.ts`，所以要按 Node 的解析顺序试一遍候选。"""
    base = posixpath.normpath(posixpath.join(posixpath.dirname(consumer), spec))
    if base in tracked_set:
        return base
    stem = re.sub(r"\.(jsx?|mjs|cjs)$", "", base)
    for cand in (stem + ".ts", stem + ".tsx", stem + ".d.ts", base + ".json", base + ".css",
                 stem + "/index.ts", stem + "/index.tsx"):
        if cand in tracked_set:
            return cand
    return None


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, cwd=REPO)


def make_blob_reader(overrides):
    cache = {}

    def blob(path):
        if path in overrides:
            return overrides[path]
        if path not in cache:
            r = git("show", "HEAD:" + path)
            cache[path] = r.stdout if r.returncode == 0 else None
        return cache[path]
    return blob


def pkg_of(path):
    parts = path.split("/")
    if path.startswith("packages/") and len(parts) >= 2:
        return "/".join(parts[:2])
    if path.startswith("server/"):
        return "server"
    return None


def import_bindings(clause):
    """从 import 子句里取出本地绑定名（含默认导入、具名导入、`* as ns`）。"""
    out = {"named": [], "namespace": None}
    m = re.search(r"\*\s+as\s+([\w$]+)", clause)
    if m:
        out["namespace"] = m.group(1)
    brace = re.search(r"\{(?P<inner>[^}]*)\}", clause)
    if brace:
        for n in brace.group("inner").split(","):
            n = n.strip()
            if not n:
                continue
            n = re.sub(r"^type\s+", "", n).strip()
            out["named"].append(n.split(" as ")[-1].strip())
        head = clause[:brace.start()]
    else:
        head = clause
    if out["namespace"]:
        head = re.sub(r"\*\s+as\s+[\w$]+", "", head)
    for n in re.findall(r"\b[A-Za-z_$][\w$]*\b", head):
        if n not in ("import", "type", "from", "as") and n != out["namespace"]:
            out["named"].append(n)
    return out


def scan(overrides=None):
    overrides = overrides or {}
    blob = make_blob_reader(overrides)
    tracked = git("ls-tree", "-r", "HEAD", "--name-only").stdout.splitlines()

    reds = []
    in_scope = [p for p in tracked if p.startswith(SCOPE_PREFIXES) and SCOPE_NAME.search(p)]
    for p in EXTRA_SCOPE:
        if p in tracked:
            in_scope.append(p)
        else:
            reds.append(("R1", f"在册清单指向一枚 HEAD 不存在的文件：{p}（它被删了还是改名了？"
                               f"这一档不修，装置就只对越来越少的文件负责）"))
    in_scope = sorted(set(in_scope))
    tracked_set = set(tracked) | set(EXTRA_TRACKED)

    ts_by_pkg = {}
    for p in tracked:
        if p.endswith((".ts", ".tsx")):
            k = pkg_of(p)
            if k:
                ts_by_pkg.setdefault(k, []).append(p)
    ov_pkgs = {pkg_of(p) for p in overrides if pkg_of(p)}
    grep_cache = {}

    def member_in_pkg(target, member):
        """那枚成员在生产包的 HEAD 源码里逐字出现吗（词边界）。
        被覆盖的那一枚包退回整包拼接（自测臂 3 要看的是"生产者换成另一代"），其余一律一次 `git grep` ——
        这决定装置是几秒还是几十秒，一条要人重跑的尺不能是后者。"""
        if target in ov_pkgs:
            text = "\n".join(blob(p) or "" for p in ts_by_pkg.get(target, []))
            return re.search(r"\b" + re.escape(member) + r"\b", text) is not None
        key = (target, member)
        if key not in grep_cache:
            r = git("grep", "-l", "-w", "-e", member, "HEAD", "--", target)
            if r.returncode > 1:
                raise RuntimeError(f"git grep 本身失败 rc={r.returncode}：{r.stderr.strip()[:120]}"
                                   f"（探针坏与对象缺在输出上长得一样，这里不许当成'成员不存在'）")
            grep_cache[key] = r.returncode == 0
        return grep_cache[key]

    hit = known = news = blind_producer = ns_blind = access_total = 0
    known_hits = []
    new_detail = []
    for f in in_scope:
        src = blob(f) or ""
        own = pkg_of(f)
        bindings = {}
        ns_set = set()
        for m in IMP.finditer(src):
            spec = m.group("spec")
            if not spec.startswith("@heyta/"):
                continue
            target = "packages/" + spec.split("/")[1]
            if target == own:
                continue
            b = import_bindings(m.group("clause"))
            if b["namespace"]:
                ns_set.add(b["namespace"])
            for n in b["named"]:
                if n:
                    bindings[n] = target

        # 分母独立取一次：每个具名绑定在这份源码里的 `绑定.成员` 访问数（不经过下面那套分档）
        for bind in bindings:
            access_total += len(re.findall(r"(?<![\w$.])" + re.escape(bind) + r"\s*\.\s*[A-Za-z_$][\w$]*", src))
        for ns in ns_set:
            ns_blind += len(re.findall(r"(?<![\w$.])" + re.escape(ns) + r"\s*\.\s*[A-Za-z_$][\w$]*", src))

        for bind, target in bindings.items():
            if not ts_by_pkg.get(target):
                blind_producer += len(re.findall(
                    r"(?<![\w$.])" + re.escape(bind) + r"\s*\.\s*[A-Za-z_$][\w$]*", src))
                continue          # 生产包在 HEAD 没有任何 .ts ⇒ 本仓不代证，整枚绑定进盲区
            for mm in re.finditer(r"(?<![\w$.])" + re.escape(bind) + r"\s*\.\s*([A-Za-z_$][\w$]*)", src):
                member = mm.group(1)
                if member in MEMBER_STOP:
                    continue
                total_key = (target, member)
                if member_in_pkg(target, member):
                    hit += 1
                    if total_key in KNOWN_SEAMS:
                        known_hits.append((total_key, KNOWN_SEAMS[total_key]))
                elif total_key in KNOWN_SEAMS:
                    known += 1
                else:
                    news += 1
                    new_detail.append((f, bind, member, target))

    # 模块缝：已入库的源码 import 了一枚 HEAD 里根本不存在的文件（干净检出上是 TS2307 / module not found）。
    # 第一版只查跨包**成员**，漏了这一整档：`inbound-process.ts:8` 引的 `./task-batch-actions.js` 从未被任何提交带进仓库。
    mod_ok = mod_known = mod_new = mod_blind = 0
    mod_known_hits = []
    mod_new_detail = []
    mod_blind_detail = []
    for f in in_scope:
        if not f.endswith((".ts", ".tsx")):
            continue
        src = blob(f) or ""
        structured = {spec for _kind, _clause, spec in iter_refs(src) if spec.startswith(".")}
        for spec in sorted(structured):
            if resolve_rel(f, spec, tracked_set):
                mod_ok += 1
            elif (f, spec) in KNOWN_MODULE_SEAMS:
                mod_known += 1
            else:
                mod_new += 1
                mod_new_detail.append((f, spec))
        # 独立分母：源码里任何被引起来的相对路径。剩下的那些若带代码后缀，就是"看着是导入而四档都没抓到" ⇒ 尺瞎了（R7）
        for spec in sorted({m.group("spec") for m in REL_ANY.finditer(src)} - structured):
            if spec.endswith(CODE_EXT) and (f, spec) not in REL_NOT_AN_IMPORT:
                mod_blind_detail.append((f, spec))
            else:
                mod_blind += 1

    for (consumer, spec), bid in sorted(KNOWN_MODULE_SEAMS.items()):
        if consumer not in tracked_set:
            reds.append(("R1", f"模块缝登记指向一枚 HEAD 已不存在的消费者：{consumer}（{bid}）"
                               f"⇒ 去 BLOCKED.md 撤登记"))
        elif resolve_rel(consumer, spec, tracked_set):
            reds.append(("R6", f"登记的模块缝已闭合：{consumer} 的 `{spec}`（{bid}）现在在 HEAD 解析得开"
                               f"⇒ 撤登记并回写台账，留着它下一位会按旧状态行动"))

    for f, spec in mod_new_detail:
        reds.append(("R5", f"模块缝：HEAD 的 {f} import 了 `{spec}`，而这枚文件在任何提交里都不存在"
                           f"⇒ 消费者已入库、生产者从未入库（干净检出上整个包解析不了，本机门禁全绿）"))
    for f, spec in mod_blind_detail:
        reds.append(("R7", f"尺瞎了：{f} 里有带代码后缀的相对路径 `{spec}`，看着是导入却不被四档正则抓到"
                           f"⇒ 要么补一档（改这枚装置），要么逐枚登记进 REL_NOT_AN_IMPORT 并写清它为什么不是导入"))

    for (target, member), bid in known_hits:
        reds.append(("R4", f"登记的缝已闭合：{target} 里的 `{member}`（{bid}）现在在 HEAD 找得到了"
                           f"⇒ 去 BLOCKED.md 撤掉这条登记并回写台账，留着它下一位会按旧状态行动"))
    for f, bind, member, target in new_detail:
        reds.append(("R2", f"新缝：{f} 里 `{bind}.{member}` 的生产者 {target} 在 HEAD 找不到该成员"
                           f"⇒ 消费者已入库、生产者还在工作树（干净检出编不过，本机门禁全绿）"))
    # 命中/登记/新缝/盲区四档相加要等于独立取的分母（不相等 = 有访问没进任何一档）
    skipped_stop = 0
    for f in in_scope:
        src = blob(f) or ""
        for bind in bindings_all(src, pkg_of(f)):
            for mm in re.finditer(r"(?<![\w$.])" + re.escape(bind) + r"\s*\.\s*([A-Za-z_$][\w$]*)", src):
                if mm.group(1) in MEMBER_STOP:
                    skipped_stop += 1
    if hit + known + news + blind_producer + skipped_stop != access_total:
        reds.append(("R3", f"分母自洽破：四档 {hit}+{known}+{news}+{blind_producer} 加停用 {skipped_stop} "
                          f"≠ 独立取到的访问数 {access_total} ⇒ 有访问根本没进任何一档"))
    stats = dict(files=len(in_scope), hit=hit, blind=blind_producer + ns_blind, ns=ns_blind,
                 known=known, new=news, stop=skipped_stop, total=access_total,
                 mod_ok=mod_ok, mod_known=mod_known, mod_new=mod_new, mod_blind=mod_blind,
                 mod_blind_detail=len(mod_blind_detail))
    return reds, stats


def bindings_all(src, own):
    """与主循环同一套取绑定规则（只取跨包的具名绑定），给分母复核用。"""
    out = set()
    for m in IMP.finditer(src):
        spec = m.group("spec")
        if not spec.startswith("@heyta/"):
            continue
        if "packages/" + spec.split("/")[1] == own:
            continue
        for n in import_bindings(m.group("clause"))["named"]:
            if n:
                out.add(n)
    return out


def run_arm(overrides, label, expect_rule, extra_scope_missing=None, extra_tracked=None):
    """臂 1-4 走的是进程内 scan()：注入只存在于内存，不落盘、不碰工作树。
    **"rc"这个词不出现在这里** —— 真退出码那一腿由下面臂 5 用子进程跑 CLI 证明。"""
    ov = dict(overrides or {})
    global EXTRA_SCOPE, EXTRA_TRACKED
    if extra_scope_missing:
        keep = EXTRA_SCOPE
        EXTRA_SCOPE = keep + [extra_scope_missing]
    if extra_tracked:
        EXTRA_TRACKED = list(extra_tracked)
    try:
        reds, stats = scan(ov)
    finally:
        if extra_scope_missing:
            EXTRA_SCOPE = keep
        if extra_tracked:
            EXTRA_TRACKED = []
    fired = next((rule for rule, _ in reds if rule == expect_rule), None)
    if fired:
        return f"成立（scan 判红，命中 {expect_rule}）　{next(m for r, m in reds if r == expect_rule)[:64]} …"
    return f"**不成立**（{label} 要 {expect_rule} 会红，实际红={[r for r, _ in reds]}）"


def _finish_self_test(lines):
    print("自测　" + f"臂数={len(lines)}")
    for label, res in lines:
        print("  " + label + "：" + res)
    bad = [l for l, r in lines if r.startswith("**不成立**")]
    if bad:
        print("结论：自测有臂不成立 ⇒ 那档判据是装饰")
        return 2
    print("结论：全部臂成立")
    return 0


def self_test():
    lines = []
    # 臂 1：注入一枚新成员访问（R2 必须红在那枚成员上）
    target = "packages/app-host/src/inbound-secret-store.ts"
    base = git("show", "HEAD:" + target).stdout
    fake = "FAKE_MEMBER_NOT_ANYWHERE_9127"
    ov = {target: base + f"\nvoid META_KEYS.{fake};\n"}
    lines.append(("臂 1 往已入库的消费者里塞一枚不存在的成员访问 ⇒ 该红", run_arm(ov, "臂1", "R2")))

    # 臂 2：在册清单指向 HEAD 不存在的文件（R1 必须红）
    lines.append(("臂 2 清单里放一枚 HEAD 没有的 path ⇒ 该红",
                  run_arm(None, "臂2", "R1", extra_scope_missing="packages/definitely-not-here/nope.ts")))

    # 臂 3：把生产者换成含那三枚键的工作树版本 ⇒ R4 必须报"登记的缝已闭合"
    real = os.path.join(REPO, "packages/storage/src/stores.ts")
    with open(real, encoding="utf-8") as fh:
        worktree = fh.read()
    lines.append(("臂 3 生产包里那三枚键真的入库了 ⇒ R4 必须说登记已过期（不许闷着变绿）",
                  run_arm({"packages/storage/src/stores.ts": worktree}, "臂3", "R4")))

    # 臂 4：静止对照（进程内 scan）—— 必须保持绿
    reds, stats = scan()
    if reds:
        lines.append(("臂 4 静止对照（scan 不判红）⇒ 必须绿",
                      f"**不成立**（原样跑就有红：{[r for r, _ in reds]}）"))
    else:
        lines.append(("臂 4 静止对照（scan 不判红）⇒ 必须绿",
                      f"成立　登记缝 {stats['known']} 枚仍在册、新缝 {stats['new']}、"
                      f"盲区 {stats['blind']}、命中 {stats['hit']}、分母 {stats['total']}"))

    # 臂 5：真退出码两条腿 —— 直接起子进程跑 CLI：静止必须 rc=0，把登记档拆掉后必须 rc=1
    #        （这一臂排除"装置永远绿"与"退出码被包装吞掉"两件事；§7 那条"管道后 $? 是 tail 的"同款陷阱）
    import tempfile
    src_path = os.path.abspath(__file__)
    with open(src_path, encoding="utf-8") as fh:
        here = fh.read()
    green = subprocess.run([sys.executable, src_path, "--quiet"], capture_output=True, text=True)
    rc_green = green.returncode
    stripped = here.replace('("packages/storage", "INBOUND_', '("packages/NOWHERE", "INBOUND_')
    if stripped == here:
        lines.append(("臂 5 子进程跑真 CLI：静止 rc=0 且把登记档拆掉后 rc=1 ⇒ 两个方向都要成立",
                      "**不成立**（注入没落进那份副本：源码里找不到 `(\"packages/storage\", \"INBOUND_` —— "
                      "登记档改了形，这一臂就悄悄变成只测绿的那一腿）"))
        return _finish_self_test(lines)
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as tmp:
        tmp.write(stripped)
        tmp_path = tmp.name
    try:
        red = subprocess.run([sys.executable, tmp_path, "--quiet"], capture_output=True, text=True)
        rc_red = red.returncode
    finally:
        os.unlink(tmp_path)
    if rc_green == 0 and rc_red == 1:
        lines.append(("臂 5 子进程跑真 CLI：静止 rc=0 且把登记档拆掉后 rc=1 ⇒ 两个方向都要成立",
                      f"成立　green rc={rc_green}　red rc={rc_red}（把登记的生产包名换成不存在的那枚之后，"
                      f"那 24 处访问判成新缝）"))
    else:
        lines.append(("臂 5 子进程跑真 CLI：静止 rc=0 且把登记档拆掉后 rc=1 ⇒ 两个方向都要成立",
                      f"**不成立**（green rc={rc_green} 要 0，red rc={rc_red} 要 1）"))

    # 臂 6：注入一枚指向不存在文件的相对导入 ⇒ R5（模块缝）必须红
    mod_target = "packages/app-host/src/inbound-runner.ts"
    mod_base = git("show", "HEAD:" + mod_target).stdout
    lines.append(("臂 6 注入一枚 `import … from './definitely-missing-….js'` ⇒ 该红（R5 模块缝）",
                  run_arm({mod_target: mod_base + "\nimport { nope } from './definitely-missing-9127.js';\n"},
                          "臂6", "R5")))

    # 臂 7：把 B130 那枚生产者"入库" ⇒ R6 必须说登记已过期，不许闷着变绿
    lines.append(("臂 7 登记过的生产者真的进 HEAD ⇒ R6 必须说模块缝已闭合",
                  run_arm(None, "臂7", "R6",
                          extra_tracked=["packages/app-host/src/task-batch-actions.ts"])))

    # 臂 8：注入一枚"带代码后缀、但不是导入语句"的相对路径 ⇒ R7 必须红（这一档挡的是尺自己瞎了）
    lines.append(("臂 8 注入一枚 `const legacy = './weird-9127.js'` ⇒ 该红（R7 尺瞎了）",
                  run_arm({mod_target: mod_base + "\nconst legacy9127 = './weird-9127.js';\n"},
                          "臂8", "R7")))

    return _finish_self_test(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    reds, stats = scan()
    if not args.quiet:
        for rule, msg in reds:
            print(f"RED　{rule} {msg}")
    print(f"读数　在册文件={stats['files']}　跨包成员访问={stats['total']}　"
          f"命中={stats['hit']}　盲区(生产包无 .ts)={stats['blind']}　盲区(命名空间)={stats['ns']}　"
          f"停用={stats['stop']}　登记缝={stats['known']}　新缝={stats['new']}")
    print(f"读数　相对导入={stats['mod_ok'] + stats['mod_known'] + stats['mod_new']}　"
          f"模块在 HEAD={stats['mod_ok']}　登记模块缝={stats['mod_known']}　新模块缝={stats['mod_new']}　"
          f"非导入的相对串={stats['mod_blind']}　尺瞎了={stats['mod_blind_detail']}")
    if any(r in ("R4", "R6") for r, _ in reds):
        print("结论：登记的缝已闭合 ⇒ 撤登记、回写台账（退 3）")
        return 3
    if reds:
        print(f"结论：{len([r for r, _ in reds if r not in ('R4', 'R6')])} 条红")
        return 1
    print("结论：已入库的消费者不再依赖任何未入库的生产者（ KNOWN_SEAMS 那几枚除外，见上面登记档）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
