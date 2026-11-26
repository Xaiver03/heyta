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
import stance as ST

WD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERBOSE = "-v" in sys.argv
QUIET = "--quiet" in sys.argv or "-q" in sys.argv
JSON_OUT = "--json" in sys.argv
LIST = "--list" in sys.argv
if LIST:
    GROUPS = {
        "读 token / 代码（产品事实源）": [
            (1, "色值白名单"), (7, "语义色亮/暗成对"), (8, "里程碑四维 ΔE"),
            (9, "门槛/id 对齐领域层"), (12, "brand-tokens.json 色值"),
            (14, "brand-tokens.css↔json"), (19, "状态胶囊=产品状态"),
            (21, "身份标签门槛值"), (23, "胶囊文字对比度"),
            (25, "分类色槽门槛"), (26, "徽章英文名=产品文案"),
            (27, "色卡三条立场"), (29, "分享文本无标识"), (30, "手册 FAQ 依据"),
            (41, "ΔE 实测值=现算"),
        ],
        "读产物（看图/看文件）": [
            (2, "数量"), (3, "关键产物存在"), (4, "PDF 字体/页数"),
            (5, "index 链接可达"), (13, "图鉴标题数量"), (15, "logo 集合"),
            (16, "svg↔png 配对"), (17, "图库双射"), (18, "图标进总览"),
            (20, "本地引用可达"), (22, "里程碑数字/维度名"),
            (24, "图库去重"), (28, "图库分类"),
        ],
        "读文档（散文/清单）": [
            (6, "i18n 词条齐备"), (10, "禁串（自造文案）"), (11, "产品清单门槛数字"),
            (42, "docs 引用可达"),
        ],
    }
    print("brand-kit 自检判据（按「失败时该找谁」分组）")
    print("（另有 8 处构建期断言：产物不符时脚本直接不产出文件）")
    for gname, items in GROUPS.items():
        print(f"\n[{gname}]")
        for n, desc in items:
            print(f"  {n:>2}  {desc}")
    print("\n[构建期断言（不在本脚本里跑，由生成器自己把关）]")
    for _g in ("05-posters 恰好 3 张×(pdf+png)",
               "02-badges 四子目录 = 生成清单",
               "09-social = 3 个 / 10-templates = 2 个",
               "06-brochure = 4 个 / 08-merch = 2 个",
               "手册目录页码与正文对上（2+len(toc)+1）",
               "手册「上手」步骤编号 01..N 连续",
               "领域层新身份标签必须有中文名",
               "里程碑 MAP 取不到即 SystemExit"):
        print(f"    - {_g}")
    sys.exit(0)
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


REMEDIES = []  # 按失败类别收集"该跑哪条命令"，出口处汇总


def _remedy_for(msg: str) -> str | None:
    """把失败信息映射成一条能直接跑的命令。判据不告诉人怎么修，等于只报丧。"""
    checks = [
        (("brand-tokens", "色值白名单", "色槽", "对比度"), "python brand-kit/_pipeline/build_tokens.py"),
        (("01-logo", "字标", "字形"), "python brand-kit/_pipeline/build_logo.py"),
        (("里程碑", "身份标签", "状态胶囊", "图鉴"), "python brand-kit/_pipeline/build_badges_v2.py"),
        (("PDF", "页数", "字体"), "python brand-kit/_pipeline/build_brandbook.py && python brand-kit/_pipeline/build_docs.py"),
        (("index.html", "social", "templates", "海报", "本地引用"), "python brand-kit/_pipeline/build_docs.py"),
        (("04-imagery",), "（04-imagery 是原图，改名/换图后需同步 _manifest_main.json 并重跑 build_index.py）"),
        (("i18n 词条", "英文维度名"), "（先修 packages/i18n 对应 key，再重跑 build_docs.py / build_badges_v2.py）"),
        (("产品清单", "禁串", "自造文案"), "（改文档或改脚本里的文案来源，见产品清单 §11.6b）"),
    ]
    for keys, cmd in checks:
        if any(k in msg for k in keys):
            return cmd
    return None


def fail(msg):
    fails.append(msg)
    r = _remedy_for(msg)
    if r and r not in REMEDIES:
        REMEDIES.append(r)
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
        "merch-sheet.pdf": 1,  # 曾经是 2 页 —— 那是 Letter 版式溢出，改 A4 后 1 页
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

# 21) 身份标签徽章上印的「≥N」必须等于领域层的 threshold
#     上一组只对了 id 集合；门槛改了却没重建徽章时，**徽章上印的数字就是错的**，
#     而 id 集合完全正常。这里直接读产物 SVG 里的文字。
TAGS_TS = os.path.join(ROOT, "packages/domain/src/identity-tags.ts")
TAG_DIR = os.path.join(WD, "02-badges/identity")
if os.path.exists(TAGS_TS) and os.path.isdir(TAG_DIR):
    src = open(TAGS_TS, encoding="utf-8").read()
    pairs = re.findall(r"\{\s*id:\s*'([\w-]+)',\s*kind:\s*'\w+',\s*threshold:\s*(\d+)\s*\}", src)
    if not pairs:
        fail("身份标签：从 identity-tags.ts 取不到 id/threshold 对 —— 上游结构变了")
    else:
        wrong = []
        for tid, thr in pairs:
            f = os.path.join(TAG_DIR, tid + ".svg")
            if not os.path.exists(f):
                continue  # 由第 15/19 组负责缺文件
            m = re.search(r"≥(\d+)", open(f, encoding="utf-8").read())
            if not m:
                wrong.append(f"{tid}: 徽章上找不到 ≥N")
            elif m.group(1) != thr:
                wrong.append(f"{tid}: 徽章印 ≥{m.group(1)}，领域层是 ≥{thr}")
        if wrong:
            fail(f"身份标签门槛与领域层不符：{wrong[:4]}")
        else:
            emit(f"✅ 身份标签徽章上的门槛 = 领域层（{len(pairs)} 个）")

# 22) 里程碑徽章上印的数字 = 领域层门槛；图鉴里的维度中文名 = KINDS 的 cn
#     文件名里的 threshold 已由第 9 组盯住，但**图上印的**是另一件事：
#     一次只改画法不改文件名，文件名全对、图上数字全错。
MS_DIR = os.path.join(WD, "02-badges/milestones")
if os.path.exists(DOMAIN_MILESTONES) and os.path.isdir(MS_DIR):
    src = open(DOMAIN_MILESTONES, encoding="utf-8").read()
    pairs = []
    for kind, ths in re.findall(r"\{\s*kind:\s*'(\w+)',\s*thresholds:\s*\[([^\]]+)\]", src):
        for t in re.findall(r"\d+", ths):
            pairs.append((kind, t))
    bad_nums = []
    for kind, thr in pairs:
        f = os.path.join(MS_DIR, f"{kind}-{thr}.svg")
        if not os.path.exists(f):
            continue  # 第 9/15 组负责缺文件
        nums = re.findall(r">(\d{1,5})<", open(f, encoding="utf-8").read())
        if thr not in nums:
            bad_nums.append(f"{kind}-{thr}.svg 里找不到印着 {thr} 的文字（找到 {nums[:3]}）")
    if bad_nums:
        fail(f"里程碑徽章上的数字与门槛不符：{bad_nums[:3]}")
    else:
        emit(f"✅ 里程碑徽章上印的数字 = 领域层门槛（{len(pairs)} 枚）")

# 22b) 图鉴里每个维度的中文名必须出现（与 KINDS 的 cn 一致）
if os.path.exists(CATALOGUE):
    cat = open(CATALOGUE, encoding="utf-8").read()
    kk = open(os.path.join(WD, "_pipeline/build_badges_v2.py"), encoding="utf-8").read()
    cns = re.findall(r'cn="([^"]+)"', kk)
    missing_cn = [c for c in set(cns) if c not in cat]
    if not cns:
        fail("build_badges_v2.py 里找不到 KINDS 的 cn 标签")
    elif missing_cn:
        fail(f"图鉴里缺这些维度中文名：{missing_cn}")
    else:
        emit(f"✅ 图鉴收录全部维度中文名（{len(set(cns))} 个）")

# 23) 状态胶囊的**文字色对背景**必须 ≥ 4.5:1（它是字，不是图形）
#     胶囊文案是 13px 小字，按 WCAG 1.4.3 要 4.5:1；品牌物料印出来也一样要能读。
def _lum(h):
    def _c(v):
        x = v / 255
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    r, g, b = [_c(v) for v in RT.hex_rgb(h)]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(a, b):
    la, lb = _lum(a), _lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


BB_SRC = os.path.join(WD, "_pipeline/build_badges_v2.py")
if os.path.exists(BB_SRC):
    bb = open(BB_SRC, encoding="utf-8").read()
    tones = re.findall(
        r'"(\w+)":\s*dict\(bg=RT\.token\("([\w-]+)"\),\s*fg=RT\.token\("([\w-]+)"\)', bb)
    if not tones:
        fail("状态胶囊：从 build_badges_v2.py 解析不到 TONES 的 bg/fg")
    else:
        low = []
        for name, bg_tok, fg_tok in tones:
            c = _contrast(RT.token(fg_tok), RT.token(bg_tok))
            if c < 4.5:
                low.append(f"{name}: {c:.2f}")
        if low:
            fail(f"状态胶囊文字对比度 < 4.5:1：{low}")
        else:
            emit(f"✅ 状态胶囊文字对比度均 ≥4.5:1（{len(tones)} 种色调）")

# 24) 同一张图不许被登记两次（重复引用会让图鉴出现两张一样的卡）
if os.path.exists(IMG_MANIFEST):
    import json as _j2
    mf2 = _j2.load(open(IMG_MANIFEST, encoding="utf-8"))
    paths2 = [it["path"] for it in (mf2 if isinstance(mf2, list) else mf2.get("items", []))
              if isinstance(it, dict) and it.get("path")]
    dup = {p for p in paths2 if paths2.count(p) > 1}
    if dup:
        fail(f"04-imagery manifest 有重复登记：{sorted(dup)}")
    else:
        emit(f"✅ 04-imagery manifest 无重复登记（{len(paths2)} 条唯一）")

# 25) 八个分类色槽：与 `tests/category-colors.spec.ts` 同一组门槛（Python 独立复算）
#     TS spec 的门槛：对比度 ≥3、正常 ΔE ≥25、红色盲 ≥14、绿色盲 ≥13。
CAT_MIN = {"contrast": 3.0, "normal": 25.0, "protan": 14.0, "deutan": 13.0}
_cat = [RT.token(f"color-category-{i}") for i in range(1, 9)]
if all(_cat):
    _surf = RT.token("color-surface")
    _worst_contrast = min(_contrast(h, _surf) for h in _cat)
    _m = {
        "normal": RT.worst_pair_delta(_cat)[0],
        "protan": RT.worst_pair_delta(_cat, RT.PROTANOPIA)[0],
        "deutan": RT.worst_pair_delta(_cat, RT.DEUTERANOPIA)[0],
    }
    _bad = []
    if _worst_contrast < CAT_MIN["contrast"]:
        _bad.append(f"对比度 {_worst_contrast:.2f} < {CAT_MIN['contrast']}")
    for k, v in _m.items():
        if v < CAT_MIN[k]:
            _bad.append(f"{k} ΔE {v:.1f} < {CAT_MIN[k]}")
    if _bad:
        fail(f"分类色槽不满足 spec 门槛：{_bad}")
    else:
        emit(f"✅ 分类色槽满足 spec 门槛（对比 {_worst_contrast:.1f}；ΔE 正常 {_m['normal']:.0f} / 红 {_m['protan']:.0f} / 绿 {_m['deutan']:.0f}）")
else:
    fail("分类色槽：取不全 color.category-1..8")

# 26) 徽章上的英文维度名必须是 i18n 里 name / unit 的可识别缩写
#     物料写死 "FOCUS HRS"，产品改叫 "Deep work" 时就悄悄不一致了。
EN_LOCALE = os.path.join(ROOT, "packages/i18n/src/locales/en.ts")
if os.path.exists(EN_LOCALE) and os.path.exists(BB_SRC):
    en = open(EN_LOCALE, encoding="utf-8").read()
    _kinds_block = bb[bb.find("KINDS={"): bb.find("MILESTONES") if "MILESTONES" in bb else len(bb)]
    latins = dict(re.findall(r'"(\w+)":\s*dict\([^}]*?latin="([^"]+)"', _kinds_block, re.S))
    if not latins:
        fail("徽章英文维度名：从 build_badges_v2.py 的 KINDS 里解析不到 latin")
    alias = {"HRS": "hours", "HR": "hours"}  # 允许的缩写
    bad_latin = []
    for kind, latin in latins.items():
        m1 = re.search(rf"'web\.growth\.kind\.{kind}'\s*:\s*'([^']+)'", en)
        m2 = re.search(rf"'web\.growth\.kind\.{kind}\.unit'\s*:\s*'([^']+)'", en)
        if not m1:
            bad_latin.append(f"{kind}: en i18n 里没有 kind 名")
            continue
        words = (m1.group(1) + " " + (m2.group(1) if m2 else "")).lower()
        parts = [alias.get(t, t).lower() for t in re.split(r"[\s-]+", latin)]
        if not all(t in words for t in parts):
            bad_latin.append(f"{kind}: 徽章写 {latin}，产品叫 {m1.group(1)!r}"
                             + (f" / 单位 {m2.group(1)!r}" if m2 else ""))
    if bad_latin:
        fail(f"徽章英文维度名与产品文案不一致：{bad_latin}")
    else:
        emit(f"✅ 徽章英文维度名 = 产品文案的缩写（{len(latins)} 个）")

# 27) 色卡上的三条立场必须与代码一致（"颜色由用户赋义 / 存槽位不存 hex / 永不自动上色"）
AC_FILE = os.path.join(ROOT, "packages/domain/src/activity-categories.ts")
_scan_root = os.environ.get("BRAND_KIT_PKG_ROOT", os.path.join(ROOT, "packages"))
if os.path.exists(AC_FILE):
    ac = open(AC_FILE, encoding="utf-8").read()
    probs = []
    if "type CategorySlot" not in ac:
        probs.append("没有 CategorySlot 类型 —— 色卡说「存槽位不存 hex」失去依据")
    if not re.search(r"color\?:\s*CategorySlot", ac + open(
            os.path.join(ROOT, "packages/domain/src/entities.ts"), encoding="utf-8").read()):
        probs.append("实体上没有 color?: CategorySlot 字段")
    # 扫"自动上色"：这些命名一旦出现，就与「永不自动上色」冲突
    _auto_hits = []
    for _r, _d, _fs in os.walk(_scan_root):
        if "node_modules" in _r:
            continue
        for _f in _fs:
            if not _f.endswith((".ts", ".tsx")):
                continue
            _t = open(os.path.join(_r, _f), encoding="utf-8", errors="ignore").read()
            for _pat in ("autoColor", "assignColor", "pickColor", "nextFreeSlot"):
                if _pat in _t:
                    _auto_hits.append(f"{os.path.relpath(os.path.join(_r, _f), ROOT)}:{_pat}")
    if _auto_hits:
        probs.append(f"发现自动上色逻辑（与「永不自动上色」冲突）：{_auto_hits[:3]}")
    if probs:
        fail(f"分类色槽的立场与代码不符：{probs}")
    else:
        emit("✅ 色卡三条立场与代码一致（CategorySlot 存在 / 无自动上色逻辑）")

# 28) 04-imagery：每条 manifest 的 sub 必须等于它所在子目录，且子目录在白名单内
if os.path.exists(IMG_MANIFEST):
    import json as _j3
    mf3 = _j3.load(open(IMG_MANIFEST, encoding="utf-8"))
    _rows3 = mf3 if isinstance(mf3, list) else mf3.get("items", [])
    _allowed_sub = {"background", "illustration", "merch"}
    _bad_sub = []
    for it in _rows3:
        if not isinstance(it, dict) or "path" not in it:
            continue
        sub = it.get("sub")
        folder = os.path.basename(os.path.dirname(it["path"]))
        if sub not in _allowed_sub:
            _bad_sub.append(f"{it['path']}: sub={sub!r} 不在白名单")
        elif sub != folder:
            _bad_sub.append(f"{it['path']}: sub={sub!r} 与目录 {folder!r} 不一致")
    if _bad_sub:
        fail(f"04-imagery 的分类与目录不一致：{_bad_sub[:4]}")
    else:
        emit(f"✅ 04-imagery 分类与目录一致（{len(_rows3)} 条）")

# 29) 分享文本"不带任何标识"这条隐私承诺，要在实现里立得住
#     物料与界面都写着「它不含你的账号、设备或任何标识」。这句一旦不成立，
#     是用户真的会外发的数据里带了自己的 id —— 代价比排版错误高一个量级。
SHARE_FILE = os.environ.get(
    "BRAND_KIT_SHARE_FILE",
    os.path.join(ROOT, "packages/app-host/src/share-summary.ts"),
)
if os.path.exists(SHARE_FILE):
    raw = open(SHARE_FILE, encoding="utf-8").read()
    # 去掉块注释与行注释，只看真正的代码
    code = re.sub(r"/\*[\s\S]*?\*/", "", raw)
    code = re.sub(r"//[^\n]*", "", code)
    forbidden = ["accountId", "userId", "clientId", "deviceId", "email",
                 "hostname", "userName", "deviceName", "installationId"]
    hit = [f for f in forbidden if re.search(rf"\b{f}\b", code)]
    keys = re.findall(r"'(web\.growth\.summary\.[\w.]+)'", code)
    probs = []
    if hit:
        probs.append(f"实现里出现身份/设备字段：{hit}")
    if len(set(keys)) != 4:
        probs.append(f"小结词条应为 4 条，实际 {sorted(set(keys))}")
    if probs:
        fail(f"分享文本可能携带标识：{probs}")
    else:
        emit("✅ 分享文本不带账号/设备字段（只用 4 条小结词条 + 数值/日期）")


# 30) 手册 FAQ 的四条答案必须各有依据（承诺类文案，写错要赔信任）
#     数据在哪 / 必须登录吗 / 加密默认吗 / 能自托管吗
FAQ_EVID = {
    "数据本地优先·无默认服务器": (
        os.path.join(ROOT, "packages/app-host/src/admin-client.ts"),
        [r"baseUrl\.trim\(\) === ''", r"unconfigured"],
    ),
    "无需账号（有离线入口）": (
        os.path.join(ROOT, "packages/i18n/src/locales/zh-CN.ts"),
        [r"'mobile\.welcome\.offline':\s*'先离线使用'"],
    ),
    "加密非默认·可显式开启": (
        os.environ.get("BRAND_KIT_ADR_0081",
                       os.path.join(ROOT, "docs/adr/0081-encryption-is-opt-in-not-default.md")),
        [r"默认 `readable`", r"显式开启"],
    ),
    "可自托管": (os.path.join(ROOT, "server/Dockerfile"), None),
}
_faq_bad = []
for label, (path, pats) in FAQ_EVID.items():
    if not os.path.exists(path):
        _faq_bad.append(f"{label}：找不到依据文件 {os.path.relpath(path, ROOT)}")
        continue
    if pats:
        txt = open(path, encoding="utf-8").read()
        miss = [pt for pt in pats if not re.search(pt, txt)]
        if miss:
            _faq_bad.append(f"{label}：{os.path.relpath(path, ROOT)} 里找不到 {miss}")
if _faq_bad:
    fail(f"手册 FAQ 有答案失去依据：{_faq_bad}")
else:
    emit(f"✅ 手册 FAQ 四条答案各有依据（{len(FAQ_EVID)} 条）")

# 31) 反例清单：物料里出现的"不做 X"必须都在 stance.py 的名单内
#     同一条立场曾在四处用四种句式写着（不作排行榜 / 没有排行榜 / 稀有度收藏、徽章墙…）。
#     这条判据不禁止重复表述，只禁止"某人悄悄新增一条反例主张"而不登记。
_suspect = {"积分", "等级", "抽奖", "成就点", "金币", "会员等级"}
_found_bad = []
for _r, _d, _fs in os.walk(WD):
    _rel = os.path.relpath(_r, WD)
    if "_pipeline" in _rel or not _rel[:2].isdigit():
        continue
    for _f in _fs:
        if not _f.endswith((".html", ".svg")):
            continue
        _t = open(os.path.join(_r, _f), encoding="utf-8", errors="ignore").read()
        for _w in _suspect:
            if _w in _t:
                _found_bad.append(f"{_rel}/{_f}:{_w}")
if _found_bad:
    fail(f"物料里出现未登记的反例主张：{_found_bad[:4]}（先改 _pipeline/stance.py 的 ANTI_FEATURES）")
else:
    emit(f"✅ 反例主张都在 stance.py 名单内（{len(ST.ANTI_FEATURES)} 条）")

# 32) index.html 必须包含全部应有卡片（缺卡曾静默发生过）
INDEX_HTML = os.path.join(WD, "index.html")
if os.path.exists(INDEX_HTML):
    idx = open(INDEX_HTML, encoding="utf-8").read()
    REQUIRED_TITLES = [
        "成长标识体系图鉴", "品牌手册", "字标 + 图标锁版", "图标集", "04 位图素材",
        "品牌主视觉海报", "核心能力海报", "成长里程碑海报", "宣传折页", "产品手册",
        "品牌周边", "社交 OG 卡片", "社交方图", "幻灯片模板", "更新日志卡",
        "色彩系统", "活动分类色卡",
    ]
    miss_titles = [t for t in REQUIRED_TITLES if t not in idx]
    if miss_titles:
        fail(f"index.html 缺卡片：{miss_titles}（多半是配图路径改名后没同步 build_index.py）")
    else:
        emit(f"✅ index.html 含全部 {len(REQUIRED_TITLES)} 张卡片")

# 33) index 卡片副标题里的数字必须等于现量值
if os.path.exists(INDEX_HTML):
    src_ms2 = open(DOMAIN_MILESTONES, encoding="utf-8").read() if os.path.exists(DOMAIN_MILESTONES) else ""
    n_ms2 = sum(len(re.findall(r"\d+", t)) for _k, t in
                re.findall(r"\{\s*kind:\s*'\w+',\s*thresholds:\s*\[([^\]]+)\]", src_ms2)) \
        if False else sum(len(re.findall(r"\d+", t)) for _k, t in
                          re.findall(r"\{\s*kind:\s*'(\w+)',\s*thresholds:\s*\[([^\]]+)\]", src_ms2))
    n_tags2 = len([f for f in os.listdir(os.path.join(WD, "02-badges/identity")) if f.endswith(".svg")])
    n_cat2 = len([k for k in RT.LIGHT if re.fullmatch(r"--ht-color-category-\d+", k)])
    n_icons2 = len([f for f in os.listdir(os.path.join(WD, "03-icons")) if f.endswith(".svg")])
    expect_sub = f"{n_ms2} 里程碑 · {n_tags2} 身份标签 · {n_cat2} 分类色槽"
    if expect_sub not in idx:
        fail(f"index 图鉴副标题不是现量值：应为「{expect_sub}」")
    if f"线性 {n_icons2} 枚" not in idx:
        fail(f"index 图标集副标题应为「线性 {n_icons2} 枚」")
    if f"{n_ms2} 里程碑 · {n_tags2} 身份标签 · {n_cat2} 分类色槽" in idx and f"线性 {n_icons2} 枚" in idx:
        emit(f"✅ index 副标题数字为现量值（{expect_sub}；线性 {n_icons2} 枚）")

# 34) 反例名单必须与文档里的激励体系红线对得上（三条：只与自己比 / 不发行货币 / 不制造愧疚）
REDLINE_DOC = os.environ.get(
    "BRAND_KIT_REDLINE_DOC",
    os.path.join(ROOT, "docs/plans/habits-alignment.md"),
)
if os.path.exists(REDLINE_DOC):
    rd = open(REDLINE_DOC, encoding="utf-8").read()
    need = ["只与自己的过去比", "不发行货币", "颜色由用户赋义"]
    miss_rd = [t for t in need if t not in rd]
    # 名单侧要有对应项（排行榜↔只与自己比；货币经济↔不发行货币）
    anti = set(getattr(ST, "ANTI_FEATURES", []))
    need_anti = {"排行榜", "货币经济"}
    miss_anti = sorted(need_anti - anti)
    if miss_rd or miss_anti:
        fail(f"反例名单与红线文档不一致：文档缺 {miss_rd} / 名单缺 {miss_anti}")
    else:
        emit(f"✅ 反例名单与激励体系三条红线对得上（{len(need)} 条）")

# 35) 宣传册正面必须印着官网域名（二维码块不许静默消失）
BRO_PDF = os.path.join(WD, "06-brochure/heyta_brochure_front.pdf")
import shutil as _sh
if os.path.exists(BRO_PDF) and _sh.which("pdftotext"):
    txt = subprocess.run(["pdftotext", "-f", "1", "-l", "3", BRO_PDF, "-"],
                         capture_output=True, text=True, timeout=40).stdout
    if "waytofuture" not in txt and "heyta." not in txt:
        fail("宣传册正面缺官网域名 —— 二维码块可能已静默消失")
    else:
        emit("✅ 宣传册正面印着官网域名（二维码块在位）")

# 36) 同一份物料的两副载体必须是同一个版面（PNG 比例 ≈ PDF 页面比例）
def _pdf_ratio(rel_pdf):
    try:
        out = subprocess.run(["pdfinfo", os.path.join(WD, rel_pdf)],
                             capture_output=True, text=True, timeout=20).stdout
        m = re.search(r"Page size:\s+([\d.]+) x ([\d.]+) pts", out)
        return (float(m.group(1)) / float(m.group(2))) if m else None
    except Exception:
        return None


def _png_ratio(rel_png):
    try:
        from PIL import Image
        im = Image.open(os.path.join(WD, rel_png))
        return im.size[0] / im.size[1]
    except Exception:
        return None


LAYOUT_PAIRS = [
    ("06-brochure/heyta_brochure_front.png", "06-brochure/heyta_brochure_front.pdf"),
    ("06-brochure/heyta_brochure_back.png", "06-brochure/heyta_brochure_back.pdf"),
    ("08-merch/merch-sheet.png", "08-merch/merch-sheet.pdf"),
]
if _sh.which("pdfinfo"):
    mism = []
    for png, pdf in LAYOUT_PAIRS:
        a, b = _png_ratio(png), _pdf_ratio(pdf)
        if a is None or b is None:
            continue
        if abs(a - b) / b > 0.02:  # 允许 2% 误差（像素取整）
            mism.append(f"{png} 比例 {a:.3f} vs {pdf} {b:.3f}")
    if mism:
        fail(f"同一物料的 PNG 与 PDF 版面不一致：{mism}")
    else:
        emit(f"✅ PNG 与 PDF 版面一致（{len(LAYOUT_PAIRS)} 组比例相同）")
else:
    print("⏭  跳过 PNG/PDF 版面比对：本机没有 pdfinfo")

# 37) 每份 PDF 的纸型必须与设计一致（A4 / A3 / 图鉴 4:5 数字版）
#     实测踩过：`08-merch` 没包 @page，Chrome 按默认 Letter 出纸并溢出成两页，
#     而我一度把"2 页"当成规格写进了期望。纸型这类错不会报错，只会印出来才发现。
SIZE_EXPECT = {
    # 文件: (宽pt, 高pt, 说明)
    "00-brand-foundation/brand-book.pdf": (594.96, 841.92, "A4 竖"),
    "05-posters/01_品牌主视觉.pdf": (841.92, 1191.12, "A3 竖"),
    "05-posters/02_核心能力.pdf": (841.92, 1191.12, "A3 竖"),
    "05-posters/03_成长里程碑.pdf": (841.92, 1191.12, "A3 竖"),
    "06-brochure/heyta_brochure_front.pdf": (841.92, 594.96, "A4 横"),
    "06-brochure/heyta_brochure_back.pdf": (841.92, 594.96, "A4 横"),
    "07-product-manual/heyta_product_manual.pdf": (594.96, 841.92, "A4 竖"),
    "08-merch/merch-sheet.pdf": (594.96, 841.92, "A4 竖"),
    # 图鉴是 4:5 **数字版**（1200×1500），PDF 只作浏览、不作印刷件 —— 见 README
    "02-badges/badge-catalogue.pdf": (900.0, 1125.12, "4:5 数字版"),
}
if _sh.which("pdfinfo"):
    bad_size = []
    for rel, (w, h, label) in SIZE_EXPECT.items():
        f = os.path.join(WD, rel)
        if not os.path.exists(f):
            continue
        out = subprocess.run(["pdfinfo", f], capture_output=True, text=True, timeout=20).stdout
        m = re.search(r"Page size:\s+([\d.]+) x ([\d.]+) pts", out)
        if not m:
            bad_size.append(f"{rel}: 读不到页面尺寸")
            continue
        gw, gh = float(m.group(1)), float(m.group(2))
        if abs(gw - w) > 2 or abs(gh - h) > 2:
            bad_size.append(f"{rel}: 实际 {gw}×{gh}pt，应为 {label} {w}×{h}pt")
    if bad_size:
        fail(f"PDF 纸型不符：{bad_size}")
    else:
        emit(f"✅ {len(SIZE_EXPECT)} 份 PDF 纸型符合设计（A4×5 / A3×3 / 图鉴 4:5 数字版）")

# 38) 手册预览图数量 = 手册页数（_preview 少一页 = 索引里看到的册子缺页）
PREVIEW_DIR = os.path.join(WD, "00-brand-foundation/_preview")
BOOK_PDF = os.path.join(WD, "00-brand-foundation/brand-book.pdf")
if os.path.isdir(PREVIEW_DIR) and os.path.exists(BOOK_PDF) and _sh.which("pdfinfo"):
    n_prev = len([f for f in os.listdir(PREVIEW_DIR) if f.startswith("page-") and f.endswith(".png")])
    out = subprocess.run(["pdfinfo", BOOK_PDF], capture_output=True, text=True, timeout=20).stdout
    m = re.search(r"^Pages:\s+(\d+)", out, re.M)
    n_pages = int(m.group(1)) if m else None
    if n_pages is None:
        fail("品牌手册读不到页数")
    elif n_prev != n_pages:
        fail(f"手册预览图 {n_prev} 张 ≠ 手册 {n_pages} 页")
    else:
        emit(f"✅ 手册预览图 = 手册页数（{n_pages} 页）")

# 39) 01-logo 每张 PNG 的像素尺寸必须与"档位"相符
#     @1x 是 760 宽、@2x 是 1520 宽、app-icon 必须是正方形且边长等于名字里的数字。
#     导错档位（例如把 @2x 存成了 @1x）在文件管理器里看不出来。
LOGO_SIZE = {
    "app-icon-32.png": (32, 32), "app-icon-180.png": (180, 180),
    "app-icon-512.png": (512, 512), "app-icon-1024.png": (1024, 1024),
    "icon-brand-512.png": (512, 512),
    "wordmark-primary@1x.png": (760, 418), "wordmark-primary@2x.png": (1520, 836),
    "wordmark-ink@1x.png": (760, 418), "wordmark-deep@1x.png": (760, 418),
    "wordmark-white@1x.png": (760, 418),
    "lockup-horizontal@1x.png": (1600, 713), "lockup-vertical@1x.png": (800, 1147),
}
try:
    from PIL import Image as _Img
    bad_dim = []
    for name, want in LOGO_SIZE.items():
        f = os.path.join(LOGO_DIR, name)
        if not os.path.exists(f):
            continue
        got = _Img.open(f).size
        if got != want:
            bad_dim.append(f"{name}: {got} ≠ {want}")
    if bad_dim:
        fail(f"01-logo 位图档位不符：{bad_dim}")
    else:
        emit(f"✅ 01-logo 位图档位正确（{len(LOGO_SIZE)} 张：1x=760 / 2x=1520 / 图标正方）")
except ImportError:
    print("⏭  跳过位图尺寸校验：本机没有 Pillow")

# 40) 26 枚线性图标必须同一套网格（24×24），否则并排摆放时机身大小不齐
if os.path.isdir(os.path.join(WD, "03-icons")):
    _icons = [f for f in os.listdir(os.path.join(WD, "03-icons")) if f.endswith(".svg")]
    _vb = set()
    for _f in _icons:
        _t = open(os.path.join(WD, "03-icons", _f), encoding="utf-8").read()
        _m = re.search(r'viewBox="([^"]+)"', _t)
        if _m:
            _vb.add(_m.group(1))
    if _vb != {"0 0 24 24"}:
        fail(f"03-icons 网格不统一：{sorted(_vb)}（应全为 0 0 24 24）")
    else:
        emit(f"✅ 03-icons 全部使用 24×24 网格（{len(_icons)} 枚）")

# 41) 产品清单里写的"实测最差 ΔE"必须等于现算值；且暗色 token 必须解析成 hex
#     文档里的数字是给人看的结论，最容易随调色漂掉。这里把四个数逐一回算比对。
DOC_LIST = os.environ.get("BRAND_KIT_DOC_LIST",
                          os.path.join(WD, "成就与成长体系_产品清单.md"))
_dims41 = ("checkin", "focus", "tasks", "days")
_calc = {}
_hex_ok = True
for _theme in ("light", "dark"):
    _hs41 = [RT.token(f"color-milestone-{k}", _theme) for k in _dims41]
    for _h in _hs41:
        if not (isinstance(_h, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", _h)):
            _hex_ok = False
    _calc[_theme] = {
        "normal": RT.worst_pair_delta(_hs41)[0],
        "protan": RT.worst_pair_delta(_hs41, RT.PROTANOPIA)[0],
        "deutan": RT.worst_pair_delta(_hs41, RT.DEUTERANOPIA)[0],
    }
if not _hex_ok:
    fail("里程碑暗色 token 未解析为 hex（可能是 var() 原样泄漏）")
elif os.path.exists(DOC_LIST):
    _doc = open(DOC_LIST, encoding="utf-8").read()
    _want = [
        ("亮 正常", f"{_calc['light']['normal']:.1f}"),
        ("暗 正常", f"{_calc['dark']['normal']:.1f}"),
        ("protan", f"{min(_calc['light']['protan'], _calc['dark']['protan']):.1f}"),
        ("deutan", f"{min(_calc['light']['deutan'], _calc['dark']['deutan']):.1f}"),
    ]
    _miss = [f"{label}={val}" for label, val in _want if val not in _doc]
    if _miss:
        fail(f"产品清单里的 ΔE 实测值与现算不符：缺 {_miss}")
    else:
        emit("✅ 产品清单的 ΔE 实测值与现算一致（45.7 / 57.6 / 12.6 / 12.1 这一组）")

# 42) 文档里的 `docs/....md §N` 引用必须真实存在（文件在、章节也在）
#     物料文档引用产品文档是双向闭环的一环；被引用的文件搬去 archive/ 后，
#     引用还留在原地就成了死链，而没有任何东西会发现。
_doc_ref_bad = []
_doc_refs = set()
for _r, _d, _fs in os.walk(WD):
    if "_pipeline" in _r:
        continue
    for _f in _fs:
        if not _f.endswith(".md"):
            continue
        _txt = open(os.path.join(_r, _f), encoding="utf-8").read()
        for _m in re.finditer(r"(docs/[A-Za-z0-9_./-]+\.md)`?\s*(?:§\s*([0-9]+(?:\.[0-9]+)?))?", _txt):
            _doc_refs.add((os.path.relpath(os.path.join(_r, _f), WD), _m.group(1), _m.group(2)))
for _src, _target, _sec in sorted(_doc_refs, key=lambda t: tuple(str(x) for x in t)):
    _path = os.path.join(ROOT, _target)
    if not os.path.exists(_path):
        _doc_ref_bad.append(f"{_src} → {_target}（文件不存在）")
        continue
    if _sec:
        _body = open(_path, encoding="utf-8").read()
        _pat = rf"^#{{1,4}}\s*{re.escape(_sec)}[.\s]|^\|\s*{re.escape(_sec)}\s*\|"
        if not re.search(_pat, _body, re.M):
            _doc_ref_bad.append(f"{_src} → {_target} §{_sec}（章节不存在）")
if _doc_ref_bad:
    fail(f"文档引用失效：{_doc_ref_bad[:4]}")
else:
    emit(f"✅ 文档里的 docs 引用全部可达（{len(_doc_refs)} 处，含章节号）")

# 43) 二维码分支必须真的产出二维码（有 segno 时），否则退回文字
#     这段代码曾长期恒抛异常→恒走文字兜底：宣传册上印的是域名而不是可扫的码，
#     而所有判据都是绿的（因为域名文字也在）。只有直接调用才看得见。
_qr_ok = True
try:
    import sys as _sys
    _sys.path.insert(0, os.path.join(WD, "_pipeline"))
    import build_docs as _BD
    _qr_html = _BD.qr_block()
    try:
        import segno as _segno  # noqa: F401
        _has_segno = True
    except Exception:
        _has_segno = False
    if _has_segno and "data:image/svg+xml" not in _qr_html:
        _qr_ok = False
        fail("有 segno 但 qr_block 未产出二维码（可能又落回文字兜底）")
    elif not _qr_html.strip():
        _qr_ok = False
        fail("qr_block 返回空 —— 宣传册的二维码位置会空着")
    else:
        emit("✅ 二维码分支可用（{}）".format("真二维码" if _has_segno else "域名文字兜底"))
except Exception as _e:
    fail(f"无法验证二维码分支：{_e}")

# 44) 04-imagery 是素材库：索引里必须有 1 张总览卡，且副标题张数等于登记数
if os.path.exists(IMG_MANIFEST) and os.path.exists(INDEX_HTML):
    import json as _j4
    _mf4 = _j4.load(open(IMG_MANIFEST, encoding="utf-8"))
    _rows4 = _mf4 if isinstance(_mf4, list) else _mf4.get("items", [])
    _idx4 = open(INDEX_HTML, encoding="utf-8").read()
    _want4 = f"本地 MOSS-Image · {len(_rows4)} 张"
    if "04 位图素材" not in _idx4:
        fail("索引缺「04 位图素材」卡")
    elif _want4 not in _idx4:
        fail(f"索引 04 卡副标题不是现量值（应为「{_want4}」）")
    elif not os.path.exists(os.path.join(WD, "04-imagery/contact-sheet.png")):
        fail("04-imagery 缺总览图 contact-sheet.png")
    else:
        emit(f"✅ 04-imagery 素材库：{len(_rows4)} 张登记、总览图在位、副标题为现量值")

if not fails:
    if JSON_OUT:
        import json as _j
        print(_j.dumps({"ok": True, "passed": len(passes), "failed": 0,
                        "checks": passes, "remedies": [],
                        "groups": {"read_code": 14, "read_artifact": 13, "read_doc": 3,
                                   "build_time_assertions": 8}}, ensure_ascii=False))
    elif QUIET:
        print(f"✅ brand-kit 产物自检通过（{len(passes)} 项）")
    else:
        print("\n✅ brand-kit 产物自检通过")
    sys.exit(0)
if JSON_OUT:
    import json as _j
    print(_j.dumps({"ok": False, "passed": len(passes), "failed": len(fails),
                    "errors": fails, "remedies": REMEDIES}, ensure_ascii=False))
else:
    print(f"\n❌ 共 {len(fails)} 项失败")
    if REMEDIES:
        print("\n修：")
        for r in REMEDIES:
            print("   " + r)
sys.exit(1)
