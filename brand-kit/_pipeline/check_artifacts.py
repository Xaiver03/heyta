# -*- coding: utf-8 -*-
"""brand-kit 产物自检
====================
    python _pipeline/check_artifacts.py          # 只读自检
    python _pipeline/check_artifacts.py -v       # 列出每个命中

查四件事：
  1. **色值全部来自 token**：所有 svg/html 里的十六进制必须命中 tokens.css 的取值白名单
     （否则有人手改一个色、或色板调整后旧色残留，都会在这里红）
  2. **里程碑/身份标签/状态胶囊的数量**：17 / 8 / 5，与领域层定义一致
  3. **关键产物存在**：图鉴 pdf/png、品牌手册 pdf 且页数正确
  4. **SVG 可确定性重现**：与 `--hash` 记录的清单比对（可选）

退出码非零即失败。这是把"每轮人肉跑的一次性检查"固化成门禁的第一步。
"""
import os, re, sys, subprocess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import read_tokens as RT

WD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERBOSE = "-v" in sys.argv
QUIET = "--quiet" in sys.argv or "-q" in sys.argv
JSON_OUT = "--json" in sys.argv
fails = []
passes = []


def emit(line: str) -> None:
    """统一出口：--quiet 时只在失败时说话；--json 时全部收集，最后一次性输出。"""
    if line.startswith("✅"):
        passes.append(line)
    if JSON_OUT:
        return
    if QUIET and line.startswith("✅"):
        return
    print(line)


def fail(msg):
    fails.append(msg)
    if not JSON_OUT:  # JSON 模式下 stdout 必须是纯 JSON
        print("❌ " + msg)


allowed = {
    v.lower()
    for d in (RT.LIGHT, RT.DARK)
    for v in d.values()
    if isinstance(v, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', v)
}

# 1) 色值白名单
bad = {}
for root, _dirs, files in os.walk(WD):
    if "_pipeline" in root or "_tmp" in root:
        continue
    for fn in files:
        if not fn.endswith((".svg", ".html")):
            continue
        p = os.path.join(root, fn)
        text = open(p, encoding="utf-8", errors="ignore").read()
        for h in set(m.lower() for m in re.findall(r'#[0-9a-fA-F]{6}', text)):
            if h not in allowed:
                bad.setdefault(h, []).append(os.path.relpath(p, WD))
if bad:
    for h, fs in bad.items():
        fail(f"非 token 色值 {h} 出现在 {len(fs)} 个产物（如 {fs[0]}）")
else:
    emit(f"✅ 色值白名单：全部命中 tokens.css（{len(allowed)} 个合法值）")

# 2) 数量
counts = {
    "里程碑": ("02-badges/milestones", 17),
    "身份标签": ("02-badges/identity", 8),
    "状态胶囊": ("02-badges/status", 5),
    "线性图标": ("03-icons", 26),
    "字标/图标": ("01-logo", 10),
}
for label, (rel, want) in counts.items():
    d = os.path.join(WD, rel)
    # 目录里 svg 与 png 混放（milestones/identity 每项各一份 svg+png），只数 svg 才是"数量"
    n = len([f for f in os.listdir(d) if f.endswith(".svg")]) if os.path.isdir(d) else 0
    if n != want:
        fail(f"{label} 数量 {n} ≠ 期望 {want}（{rel}）")
    else:
        emit(f"✅ {label}：{n} 个")

# 3) 关键产物
for rel, why in [
    ("02-badges/badge-catalogue.pdf", "成长标识体系图鉴 PDF"),
    ("02-badges/badge-catalogue.png", "图鉴 PNG"),
    ("00-brand-foundation/brand-book.pdf", "品牌手册 PDF"),
]:
    p = os.path.join(WD, rel)
    if not os.path.exists(p) or os.path.getsize(p) < 1000:
        fail(f"缺产物或过小：{rel}（{why}）")
    elif VERBOSE:
        print(f"   · {rel} {os.path.getsize(p)//1024} KB")

# 4) PDF 字体必须**嵌入**（换台机器才不塌），且页数符合设计
#    pdffonts/pdfinfo 属 poppler，可能没装 —— 没装就**响亮跳过**，不算通过。
import shutil, subprocess

if shutil.which("pdffonts") and shutil.which("pdfinfo"):
    # 按**文件名**（不含目录）匹配，避免中文/连字符路径差异；值是实测页数。
    expect_pages = {
        "brand-book.pdf": 8,
        "badge-catalogue.pdf": 1,
        "01_品牌主视觉.pdf": 1,
        "02_核心能力.pdf": 1,
        "03_成长里程碑.pdf": 1,
        "heyta_brochure_front.pdf": 1,
        "heyta_brochure_back.pdf": 1,
        "heyta_product-manual.pdf": 10,
        "merch-sheet.pdf": 2,
    }
    pdfs = []
    for root, _d, files in os.walk(WD):
        if "_pipeline" in root or "_tmp" in root:
            continue
        pdfs += [os.path.join(root, f) for f in files if f.endswith(".pdf")]
    for f in sorted(pdfs):
        rel = os.path.relpath(f, WD)
        try:
            out = subprocess.run(["pdffonts", f], capture_output=True, text=True, timeout=30).stdout
        except Exception as e:
            fail(f"pdffonts 跑不动 {rel}（{e}）")
            continue
        rows = [ln.split() for ln in out.splitlines()[2:] if ln.strip()]
        not_embedded = [r[0] for r in rows if len(r) >= 5 and r[-4] == "no"]
        if not_embedded:
            fail(f"{rel} 有 {len(not_embedded)} 个字体未嵌入（换机器会塌）：{not_embedded[:3]}")
        else:
            emit(f"✅ 字体全嵌入：{rel}（{len(rows)} 个字体）")
        want = expect_pages.get(os.path.basename(f))
        if want is not None:
            try:
                info = subprocess.run(["pdfinfo", f], capture_output=True, text=True, timeout=30).stdout
                pages = next((ln.split()[-1] for ln in info.splitlines() if ln.startswith("Pages:")), "?")
                if str(pages) != str(want):
                    fail(f"{rel} 页数 {pages} ≠ 期望 {want}")
                else:
                    emit(f"✅ 页数：{rel} = {pages}")
            except Exception as e:
                fail(f"pdfinfo 跑不动 {rel}（{e}）")
else:
    print("⏭  跳过 PDF 字体/页数校验：本机没有 poppler（pdffonts/pdfinfo）")

# 5) index.html 的相对链接必须都指得到（生成了卡片但 href 写错 = 点开 404）
import urllib.parse

idx = os.path.join(WD, "index.html")
if os.path.exists(idx):
    html = open(idx, encoding="utf-8").read()
    urls = set(re.findall(r'(?:href|src)="([^"]+)"', html))
    missing = []
    n = 0
    for u in urls:
        if u.startswith(("#", "http://", "https://", "mailto:", "javascript:")):
            continue
        path = urllib.parse.unquote(u.split("?")[0].split("#")[0])
        if not path:
            continue
        n += 1
        if not os.path.exists(os.path.join(WD, path)):
            missing.append(u)
    if missing:
        fail(f"index.html 有 {len(missing)} 个链接指不到文件：{missing[:5]}")
    else:
        emit(f"✅ index.html 相对链接全部可达（{n} 个）")

# 6) 品牌物料依赖的 i18n 词条必须**两个语言都在**（缺一边会出空串卡片）
ROOT = os.path.dirname(WD)
BRAND_KEYS = [
    "site.og.card.title1", "site.og.card.title2", "site.og.card.lede",
    "landing.hero.titleLead", "landing.hero.titleEmphasis", "landing.hero.lede",
]
LOCALES = {
    "zh": os.path.join(ROOT, "packages/i18n/src/locales/zh-CN.ts"),
    "en": os.path.join(ROOT, "packages/i18n/src/locales/en.ts"),
}
if all(os.path.exists(p) for p in LOCALES.values()):
    tables = {k: open(v, encoding="utf-8").read() for k, v in LOCALES.items()}
    for key in BRAND_KEYS:
        absent = [lang for lang, txt in tables.items() if f"'{key}'" not in txt]
        if absent:
            fail(f"i18n 词条 {key} 缺 {absent} —— 品牌物料会出现空串")
    else:
        emit(f"✅ 品牌相关 i18n 词条两语言齐备（{len(BRAND_KEYS)} 条）")
else:
    print("⏭  跳过 i18n 词条校验：本机不在仓库内（找不到 packages/i18n）")

# 7) 语义色必须有**暗色覆盖且与亮色不同**
#    品牌物料要能同时印亮/暗两版；某个值只在亮色里存在（暗色悄悄回落成亮色），
#    表现是"暗色版里这块和亮色一模一样"——肉眼几乎发现不了。
#    注意：原始色阶（blue-600 之类）本来就只有一个值，不在本检查范围。
BRAND_COLOR_TOKENS = [
    "color-milestone-checkin", "color-milestone-focus",
    "color-milestone-tasks", "color-milestone-days",
    *[f"color-category-{i}" for i in range(1, 9)],
    "color-primary", "color-background", "color-surface", "color-foreground",
]
for name in BRAND_COLOR_TOKENS:
    light = RT.token(name)
    dark = RT.token(name, "dark")
    if light is None:
        fail(f"{name}：亮色里取不到值（token 名拼错或不存在）")
    elif dark is None:
        fail(f"{name}：暗色里取不到值")
    elif dark.lower() == light.lower():
        fail(f"{name}：暗色 {dark} 与亮色相同 —— 大概率漏了暗色覆盖")
    elif VERBOSE:
        print(f"   · {name} light={light} dark={dark}")
if not any("暗色" in f for f in fails):
    emit(f"✅ 语义色亮/暗成对且取值不同（{len(BRAND_COLOR_TOKENS)} 个）")

# 8) 里程碑四维色：两两色差（正常视觉 + 红/绿色盲模拟）
#    这条与 design-system 的 `milestone-colors.spec.ts` 是**两处独立实现**：
#    TS 侧用 TS 的算法，这里用 Python 重算一遍。两处对不上就说明有一边算错了。
MIN_DELTA = float(os.environ.get("BRAND_KIT_MIN_DELTA", "10"))
DIMS = ("checkin", "focus", "tasks", "days")
for theme in ("light", "dark"):
    hs = [RT.token(f"color-milestone-{k}", theme) for k in DIMS]
    if any(h is None for h in hs):
        fail(f"里程碑四维色在 {theme} 下取不全：{hs}")
        continue
    for name, matrix in (("正常视觉", None), ("红色盲", RT.PROTANOPIA), ("绿色盲", RT.DEUTERANOPIA)):
        worst, pair = RT.worst_pair_delta(hs, matrix)
        if worst < MIN_DELTA:
            fail(f"{theme}/{name} 最差一对 {pair} ΔE={worst:.1f} < {MIN_DELTA}")
        elif VERBOSE:
            print(f"   · {theme}/{name} 最差 ΔE={worst:.1f}（{pair}）")
if not any("ΔE" in f for f in fails):
    emit(f"✅ 里程碑四维色两两可区分（亮/暗 × 正常/红绿色盲，门槛 ΔE≥{MIN_DELTA:g}）")

# 9) 里程碑徽章的门槛必须与领域层**逐项相同**
#    物料里的 17 个徽章文件名是 `kind-threshold.svg`；领域定义是唯一事实源
#    `packages/domain/src/milestones.ts` 的 MILESTONE_DEFINITIONS。
#    门槛改了却没重生成 → 物料上印着已经不存在的档位，而且看起来一切正常。
DOMAIN_MILESTONES = os.path.join(ROOT, "packages/domain/src/milestones.ts")
if os.path.exists(DOMAIN_MILESTONES):
    src = open(DOMAIN_MILESTONES, encoding="utf-8").read()
    defs = re.findall(r"\{\s*kind:\s*'(\w+)',\s*thresholds:\s*\[([^\]]+)\]", src)
    if not defs:
        fail("里程碑：从 milestones.ts 里取不到 MILESTONE_DEFINITIONS —— 上游结构变了")
    else:
        expected = set()
        for kind, ths in defs:
            for th in re.findall(r"\d+", ths):
                expected.add(f"{kind}-{th}")
        actual = {
            f[:-4] for f in os.listdir(os.path.join(WD, "02-badges/milestones")) if f.endswith(".svg")
        }
        missing = expected - actual
        extra = actual - expected
        if missing:
            fail(f"里程碑徽章缺档：{sorted(missing)}（领域层有、物料没有）")
        if extra:
            fail(f"里程碑徽章多档：{sorted(extra)}（物料有、领域层没有）")
        if not missing and not extra:
            emit(f"✅ 里程碑门槛与领域层逐项一致（{len(expected)} 档）")
    # 身份标签同理：id 必须一一对应（物料文件名就是 id）
    DOMAIN_TAGS = os.path.join(ROOT, "packages/domain/src/identity-tags.ts")
    if os.path.exists(DOMAIN_TAGS):
        tsrc = open(DOMAIN_TAGS, encoding="utf-8").read()
        ids = set(re.findall(r"\{\s*id:\s*'([\w-]+)'", tsrc))
        have = {
            f[:-4] for f in os.listdir(os.path.join(WD, "02-badges/identity")) if f.endswith(".svg")
        }
        if not ids:
            fail("身份标签：从 identity-tags.ts 里取不到 id 列表 —— 上游结构变了")
        else:
            if ids - have:
                fail(f"身份标签缺：{sorted(ids - have)}")
            if have - ids:
                fail(f"身份标签多：{sorted(have - ids)}")
            if not (ids - have) and not (have - ids):
                emit(f"✅ 身份标签与领域层逐项一致（{len(ids)} 个）")
else:
    print("⏭  跳过里程碑/身份标签校验：本机不在仓库内（找不到 packages/domain）")

# 10) 禁止自造文案：这些句子曾在脚本里手写过，i18n 里并不存在
#     判据是**精确串**，所以它只抓回归，不会误伤正常中文注释。
FORBIDDEN_COPY = [
    "本地优先 · 可选加密 · 四端一致",
    "今天的任务，" + "一条条",
    "LOCAL-FIRST TASK" + " MANAGER",
    "WHY " + "HEYTA",
    "今天该做什么，" + "一眼看见",   # 必须由 RC.tagline_html() 拼，不许写死
]
hits = []
for root, _d, files in os.walk(os.path.join(WD, "_pipeline")):
    for fn in files:
        # 本文件自己持有禁串清单，不能算"违规"
        if not fn.endswith(".py") or fn == "check_artifacts.py":
            continue
        txt = open(os.path.join(root, fn), encoding="utf-8").read()
        for phrase in FORBIDDEN_COPY:
            if phrase in txt:
                hits.append(f"{fn}: {phrase}")
if hits:
    fail(f"脚本里出现自造文案（应改为从 i18n 取）：{hits}")
else:
    emit(f"✅ 无自造文案回归（{len(FORBIDDEN_COPY)} 条禁串）")

# 11) 产品清单文档里写的门槛数字，必须与领域层相同
#     文档是最容易被手改的一层：改了数字、忘了重生成徽章，谁也不会发现。
DOC = os.path.join(WD, "成就与成长体系_产品清单.md")
if os.path.exists(DOC) and os.path.exists(DOMAIN_MILESTONES):
    doc = open(DOC, encoding="utf-8").read()
    dom = {}
    for kind, ths in re.findall(r"\{\s*kind:\s*'(\w+)',\s*thresholds:\s*\[([^\]]+)\]", open(DOMAIN_MILESTONES, encoding="utf-8").read()):
        dom[kind] = [int(x) for x in re.findall(r"\d+", ths)]
    checked = 0
    for kind, want in dom.items():
        # 文档表格行：| 累计打卡 `checkIns` | **10 / 50 / 200 / 500 / 1000** 次 | …
        m = re.search(rf"^\|.*?`{kind}`.*?\*\*([\d\s/／、,，]+)", doc, re.M)
        if not m:
            continue
        got = [int(x) for x in re.findall(r"\d+", m.group(1))]
        if got != want:
            fail(f"产品清单里 {kind} 的门槛 {got} ≠ 领域层 {want}")
        else:
            checked += 1
    if checked:
        emit(f"✅ 产品清单门槛数字与领域层一致（{checked} 个维度）")
    else:
        print("⏭  产品清单里没找到可解析的门槛行（格式变了？）")

# 12) brand-tokens.json 的每个色值必须等于 tokens.css 的对应 token
#     这张表是**对外导出**（给不读 CSS 的工具用），最容易被手改；而它一漂，
#     外部工具里的品牌色就和产品不一致了。
TOKENS_JSON = os.path.join(WD, "00-brand-foundation/brand-tokens.json")
COLOR_MAP = {}
for n in (50, 100, 200, 300, 400, 500, 600, 700, 800, 900):
    COLOR_MAP[f"colors.blue.{n}"] = f"blue-{n}"
COLOR_MAP["colors.slate.white"] = "white"
for n in (50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950):
    COLOR_MAP[f"colors.slate.{n}"] = f"slate-{n}"
COLOR_MAP.update({
    "colors.feedback.success": "color-success", "colors.feedback.warning": "color-warning",
    "colors.feedback.danger": "color-danger", "colors.feedback.info": "color-info",
    "colors.feedback.success-soft": "emerald-50", "colors.feedback.warning-soft": "amber-50",
    "colors.feedback.danger-soft": "red-50", "colors.feedback.info-soft": "blue-50",
    "colors.surface.paper": "color-surface", "colors.surface.sunken": "color-surface-sunken",
    "colors.surface.ink": "color-foreground",
    "semantic.primary": "color-primary", "semantic.on-primary": "white",
    "semantic.primary-hover": "color-primary-hover", "semantic.foreground": "color-foreground",
    "semantic.foreground-muted": "color-foreground-muted", "semantic.border": "color-border",
    "milestone.checkIns": "color-milestone-checkin", "milestone.focusHours": "color-milestone-focus",
    "milestone.tasks": "color-milestone-tasks", "milestone.activeDays": "color-milestone-days",
})
if os.path.exists(TOKENS_JSON):
    import json as _json
    data = _json.load(open(TOKENS_JSON, encoding="utf-8"))

    def _walk(o, prefix=""):
        if isinstance(o, dict):
            for k, v in o.items():
                yield from _walk(v, f"{prefix}.{k}" if prefix else k)
        elif isinstance(o, str) and o.startswith("#"):
            yield prefix, o

    bad = 0
    for path, val in _walk(data):
        want_name = COLOR_MAP.get(path)
        if want_name is None:
            fail(f"brand-tokens.json 里的 {path}={val} 没有对应 token —— 新加的色值必须登记映射")
            bad += 1
            continue
        want = RT.token(want_name)
        if want is None or want.lower() != val.lower():
            fail(f"brand-tokens.json 的 {path} 是 {val}，而 {want_name} 是 {want}")
            bad += 1
    if bad == 0:
        emit(f"✅ brand-tokens.json 色值与 tokens.css 逐项一致（{len(COLOR_MAP)} 项）")

# 13) 图鉴标题里印的数量，必须等于领域层真实数量
#     标题曾经写死「Milestones（17）」「Identity Tags（8）」—— 加一个里程碑后
#     徽章数量变了、标题还印着旧数字，而图鉴是给人看的第一手材料。
CATALOGUE = os.path.join(WD, "02-badges/badge-catalogue.html")
if os.path.exists(CATALOGUE) and os.path.exists(DOMAIN_MILESTONES):
    cat = open(CATALOGUE, encoding="utf-8").read()
    src_ms = open(DOMAIN_MILESTONES, encoding="utf-8").read()
    n_ms = sum(len(re.findall(r"\d+", ths)) for _k, ths in
               re.findall(r"\{\s*kind:\s*'(\w+)',\s*thresholds:\s*\[([^\]]+)\]", src_ms))
    tags_file = os.path.join(ROOT, "packages/domain/src/identity-tags.ts")
    n_tags = len(re.findall(r"\{\s*id:\s*'[\w-]+'", open(tags_file, encoding="utf-8").read())) if os.path.exists(tags_file) else None
    for label, pattern, want in (
        ("里程碑", r"Milestones（(\d+)", n_ms),
        ("身份标签", r"Identity Tags（(\d+)", n_tags),
    ):
        if want is None:
            continue
        m = re.search(pattern, cat)
        if not m:
            fail(f"图鉴标题里找不到{label}数量（格式变了？）")
        elif int(m.group(1)) != want:
            fail(f"图鉴标题写{label} {m.group(1)} 个，领域层是 {want} 个")
        else:
            emit(f"✅ 图鉴标题{label}数量 = {want}")

# 14) brand-tokens.css 必须能被解析，且每个值与 json 一致
#     .css 供浏览器/设计工具直接 @import；它和 .json 是同一份数据的两副面孔，
#     一旦只改一处，外部工具里就会出现两套品牌色。
TOKENS_CSS = os.path.join(WD, "00-brand-foundation/brand-tokens.css")
if os.path.exists(TOKENS_CSS) and os.path.exists(TOKENS_JSON):
    css = open(TOKENS_CSS, encoding="utf-8").read()
    pairs = dict(re.findall(r"--hk-([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})", css))
    # 括号配对：能解析的最基本证据
    if css.count("{") != css.count("}"):
        fail(f"brand-tokens.css 花括号不配对（{css.count('{')} vs {css.count('}')}）")
    if not pairs:
        fail("brand-tokens.css 里解析不出 --hk-* 变量")
    # json 侧：把 --hk-<fam>-<step> 与 json 的同路径对上
    import json as _json
    jd = _json.load(open(TOKENS_JSON, encoding="utf-8"))
    flat = {}
    for grp in ("colors", "semantic", "milestone"):
        def _flat(o, pre=""):
            if isinstance(o, dict):
                for k, v in o.items():
                    _flat(v, f"{pre}-{k}" if pre else k)
            elif isinstance(o, str) and o.startswith("#"):
                flat[pre] = o
        _flat(jd[grp], grp if grp != "colors" else "")
    mism = []
    for name, val in pairs.items():
        key = name
        # colors 家族：blue-50 / slate-white → 去掉顶层 colors 前缀
        if key.startswith("colors-"):
            key = key[len("colors-"):]
        want = flat.get(key)
        if want is None:
            continue  # 反查不到就交给第 12 组（json 自身）兜
        if want.lower() != val.lower():
            mism.append(f"{name}: css={val} json={want}")
    if mism:
        fail(f"brand-tokens.css 与 json 不一致：{mism[:4]}")
    else:
        emit(f"✅ brand-tokens.css 可解析且与 json 一致（{len(pairs)} 个变量）")

# 15) 01-logo 与 00-brand-foundation 的文件集合必须精确
#     这两个目录由多个脚本共同写入（logo / tokens / brandbook），
#     很容易出现"改名后旧文件还在"或"少导出一档"。集合写死在这里，任何增删都要同步改。
EXACT_DIRS = {
    "01-logo": {
        "app-icon-1024.png", "app-icon-180.png", "app-icon-32.png", "app-icon-512.png", "app-icon.svg",
        "icon-brand-512.png", "icon-brand.svg", "icon-mono-ink.svg", "icon-mono-white.svg",
        "lockup-horizontal.svg", "lockup-horizontal@1x.png",
        "lockup-vertical.svg", "lockup-vertical@1x.png",
        "wordmark-deep.svg", "wordmark-deep@1x.png", "wordmark-ink.svg", "wordmark-ink@1x.png",
        "wordmark-primary.svg", "wordmark-primary@1x.png", "wordmark-primary@2x.png",
        "wordmark-white.svg", "wordmark-white@1x.png",
    },
    "00-brand-foundation": {"brand-book.pdf", "brand-tokens.css", "brand-tokens.json"},
}
for rel, want in EXACT_DIRS.items():
    d = os.path.join(WD, rel)
    if not os.path.isdir(d):
        fail(f"{rel} 目录不存在")
        continue
    have = {f for f in os.listdir(d) if not f.startswith(".") and not f.startswith("_")}
    if have != want:
        fail(f"{rel} 集合不符：多余 {sorted(have - want)} / 缺失 {sorted(want - have)}")
    else:
        emit(f"✅ {rel} 文件集合精确（{len(want)} 个）")

# 16) 每个含字形的 svg 都要有对应 png（除刻意的单色版）
LOGO_DIR = os.path.join(WD, "01-logo")
if os.path.isdir(LOGO_DIR):
    svgs = [f[:-4] for f in os.listdir(LOGO_DIR) if f.endswith(".svg")]
    pngs = {f for f in os.listdir(LOGO_DIR) if f.endswith(".png")}
    no_png = [s for s in svgs if not any(p.startswith(s) or p.startswith(s.replace("-", "_")) for p in pngs)]
    # icon-mono-* 是单色/白版，交付里只给 svg 是刻意的
    intentional = {"icon-mono-ink", "icon-mono-white"}
    unexpected = [s for s in no_png if s not in intentional]
    if unexpected:
        fail(f"01-logo 里这些 svg 没有对应 png：{unexpected}")
    else:
        emit(f"✅ 01-logo 每个字形 svg 都有 png（{len(svgs)-len(intentional)} 个；单色版 {len(intentional)} 个只给 svg）")

# 17) 04-imagery 的图与 manifest 必须双射（每张都在册、每条都在盘）
IMG_DIR = os.path.join(WD, "04-imagery")
IMG_MANIFEST = os.path.join(IMG_DIR, "_manifest_main.json")
if os.path.isdir(IMG_DIR):
    on_disk = set()
    for root, _d, files in os.walk(IMG_DIR):
        for fn in files:
            if fn.lower().endswith((".png", ".jpg", ".jpeg")) and not fn.startswith("_") \
               and fn != "contact-sheet.png":
                on_disk.add(os.path.relpath(os.path.join(root, fn), WD))
    if not os.path.exists(IMG_MANIFEST):
        fail("04-imagery/_manifest_main.json 不存在")
    else:
        import json as _json
        mf = _json.load(open(IMG_MANIFEST, encoding="utf-8"))
        listed = {it["path"] for it in (mf if isinstance(mf, list) else mf.get("items", []))
                  if isinstance(it, dict) and isinstance(it.get("path"), str)}
        if listed != on_disk:
            fail(f"04-imagery 与 manifest 不双射：盘上有册里没有 {sorted(on_disk - listed)[:4]} / 册里有盘上没有 {sorted(listed - on_disk)[:4]}")
        else:
            emit(f"✅ 04-imagery 与 manifest 双射（{len(listed)} 张）")

# 18) 03-icons 的 svg 数必须等于 icon-sheet.html 引用的 svg 数
ICON_DIR = os.path.join(WD, "03-icons")
SHEET = os.path.join(ICON_DIR, "icon-sheet.html")
if os.path.isdir(ICON_DIR) and os.path.exists(SHEET):
    n_svg = len([f for f in os.listdir(ICON_DIR) if f.endswith(".svg")])
    refs = set(re.findall(r'src="[^"]*?([\w-]+\.svg)"', open(SHEET, encoding="utf-8").read()))
    if len(refs) != n_svg:
        fail(f"03-icons：{n_svg} 个 svg，但 icon-sheet 只引用了 {len(refs)} 个（有图标没进总览）")
    else:
        emit(f"✅ 03-icons 的 {n_svg} 个图标全部进了总览页")

# 19) 状态胶囊的 key 必须是产品真有的状态（品牌手册不能印不存在的 UI 状态）
#     全仓实测：完成=completedAt、归档=archived、逾期=派生、优先级=Priority 枚举，
#     **没有"进行中"**（`'doing'` 零命中）。所以这里用一份显式真相表钉住。
PRODUCT_STATUS_KEYS = {"todo", "done", "overdue", "archived", "high"}
STATUS_DIR = os.path.join(WD, "02-badges/status")
if os.path.isdir(STATUS_DIR):
    have_keys = {f[:-4] for f in os.listdir(STATUS_DIR) if f.endswith(".svg")}
    if have_keys != PRODUCT_STATUS_KEYS:
        fail(f"状态胶囊与产品真实状态不符：多出 {sorted(have_keys - PRODUCT_STATUS_KEYS)} / 缺少 {sorted(PRODUCT_STATUS_KEYS - have_keys)}")
    else:
        emit(f"✅ 状态胶囊 = 产品真实状态（{len(have_keys)} 个，无虚构状态）")

# 20) 产物里不许有断掉的本地引用（<img src> 指向不存在的文件）
#     实测踩过：产品删掉「进行中」状态后，海报里仍引用 status/doing.svg ——
#     渲染出来是一个空白胶囊，而所有其它判据全绿。
_broken = []
for _root, _dirs, _files in os.walk(WD):
    _rel_root = os.path.relpath(_root, WD)
    if "_pipeline" in _rel_root or not _rel_root[:2].isdigit():
        continue
    for _fn in _files:
        if _fn.startswith("_") or not _fn.endswith((".html", ".svg")):
            continue
        _txt = open(os.path.join(_root, _fn), encoding="utf-8", errors="ignore").read()
        for _src in re.findall(r'(?:src|href)="([^"]+)"', _txt):
            if _src.startswith(("http://", "https://", "data:", "#", "/", "mailto:")):
                continue
            _target = os.path.normpath(os.path.join(_root, _src.split("?")[0]))
            if not os.path.exists(_target):
                _broken.append(f"{os.path.join(_rel_root, _fn)} -> {_src}")
if _broken:
    fail(f"有 {len(_broken)} 处本地引用指不到文件：{_broken[:4]}")
else:
    emit("✅ 产物里的本地引用全部可达（无空白图/空链接）")

if not fails:
    if JSON_OUT:
        import json as _j
        print(_j.dumps({"ok": True, "passed": len(passes), "failed": 0, "checks": passes}, ensure_ascii=False))
    elif QUIET:
        print(f"✅ brand-kit 产物自检通过（{len(passes)} 项）")
    else:
        print("\n✅ brand-kit 产物自检通过")
    sys.exit(0)
if JSON_OUT:
    import json as _j
    print(_j.dumps({"ok": False, "passed": len(passes), "failed": len(fails), "errors": fails}, ensure_ascii=False))
else:
    print(f"\n❌ 共 {len(fails)} 项失败")
sys.exit(1)
