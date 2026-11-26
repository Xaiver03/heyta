# -*- coding: utf-8 -*-
"""heyta brand-kit 索引：index.html + manifest.json（扫描真实文件生成，可校验）"""
import os, json, time, sys, re, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import read_tokens as RT
WD=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def rel(p): return os.path.relpath(p,WD)
def card(img,title,sub,href):
    return f'<a class="c" href="{href}"><div class="im"><img src="{img}"></div><div class="t">{title}</div><div class="s">{sub}</div></a>'

# ── 卡片副标题里的数字也必须是**现量的**，不能手抄 ────────────────────
import re as _re, subprocess as _sp


def _count_milestones():
    f = os.path.join(os.path.dirname(WD), "packages/domain/src/milestones.ts")
    src = open(f, encoding="utf-8").read()
    return sum(len(_re.findall(r"\d+", ths)) for _k, ths in
               _re.findall(r"\{\s*kind:\s*'\w+',\s*thresholds:\s*\[([^\]]+)\]", src) and
               [(k, t) for k, t in _re.findall(r"\{\s*kind:\s*'(\w+)',\s*thresholds:\s*\[([^\]]+)\]", src)])


def _count_dir(rel_dir, ext=".svg"):
    d = os.path.join(WD, rel_dir)
    if not os.path.isdir(d):
        raise SystemExit(f"索引要统计的目录不存在：{rel_dir}（副标题会静默印成 0）")
    return len([f for f in os.listdir(d) if f.endswith(ext)])


def _pdf_pages(rel_pdf):
    p = os.path.join(WD, rel_pdf)
    try:
        out = _sp.run(["pdfinfo", p], capture_output=True, text=True, timeout=20).stdout
        m = _re.search(r"^Pages:\s+(\d+)", out, _re.M)
        return int(m.group(1)) if m else None
    except Exception:
        return None


_N_MS = _count_milestones()
_N_TAGS = _count_dir("02-badges/identity")
# 分类"色槽"数是 token 里的 color.category-1..8，不是目录里的文件数（目录只有一张色卡）
_N_CAT = len([k for k in RT.LIGHT if re.fullmatch(r"--ht-color-category-\d+", k)])
_N_ICONS = _count_dir("03-icons")
try:
    import json as _json2
    _mf_img = _json2.load(open(os.path.join(WD, "04-imagery/_manifest_main.json"), encoding="utf-8"))
    _N_IMG = len(_mf_img if isinstance(_mf_img, list) else _mf_img.get("items", []))
except Exception:
    _N_IMG = 0
_BOOK_PAGES = _pdf_pages("00-brand-foundation/brand-book.pdf")
_MANUAL_PAGES = _pdf_pages("07-product-manual/heyta_product-manual.pdf")

cards=[]
def add(img,title,sub,href):
    """加一张卡。缺图**不许静默跳过** —— 静默的代价实测过一次：
    宣传册改名后这里仍指旧文件名，于是「宣传折页」那张卡悄悄从索引里消失了，
    而索引照样生成成功。产品预览图（`_preview/`）允许缺席，其余必须是硬错。"""
    if os.path.exists(os.path.join(WD,img)):
        cards.append(card(img,title,sub,href))
    elif "/_preview/" in img or img.startswith("00-brand-foundation/_preview"):
        pass
    else:
        raise SystemExit(f"索引要引用的图不存在：{img}（改名/删文件后要同步这里）")
add("02-badges/badge-catalogue.png","成长标识体系图鉴",f"{_N_MS} 里程碑 · {_N_TAGS} 身份标签 · {_N_CAT} 分类色槽","02-badges/badge-catalogue.pdf")
add("00-brand-foundation/_preview/page-01.png","品牌手册 Brand Book",(f"{_BOOK_PAGES} 页 · 标识/色彩/字体/成长" if _BOOK_PAGES else "标识/色彩/字体/成长"),"00-brand-foundation/brand-book.pdf")
add("01-logo/lockup-horizontal@1x.png","字标 + 图标锁版","「hey.」+「h」","01-logo/lockup-horizontal.svg")
add("03-icons/icon-sheet.png","图标集 Icon Set",f"线性 {_N_ICONS} 枚","03-icons/icon-sheet.html")
add("04-imagery/contact-sheet.png","04 位图素材",f"本地 MOSS-Image · {_N_IMG} 张 · 背景/插画/周边","04-imagery/_manifest_main.json")
add("05-posters/01_品牌主视觉.png","品牌主视觉海报","A3 · PDF/PNG","05-posters/01_品牌主视觉.pdf")
add("05-posters/02_核心能力.png","核心能力海报","A3 · PDF/PNG","05-posters/02_核心能力.pdf")
add("05-posters/03_成长里程碑.png","成长里程碑海报","A3 · PDF/PNG","05-posters/03_成长里程碑.pdf")
add("06-brochure/heyta_brochure_front.png","宣传折页","A4 三折 · 正反面","06-brochure/heyta_brochure_front.pdf")
add("07-product-manual/heyta_product-manual_cover.png","产品手册",(f"{_MANUAL_PAGES} 页 PDF" if _MANUAL_PAGES else "PDF"),"07-product-manual/heyta_product-manual.pdf")
add("08-merch/merch-sheet.png","品牌周边","笔记本/马克杯/帆布包/贴纸","08-merch/merch-sheet.pdf")
add("09-social/og-card_1200x630.png","社交 OG 卡片","1200×630","09-social/og-card_1200x630.png")
add("09-social/post_1080x1080.png","社交方图","1080×1080","09-social/post_1080x1080.png")
add("10-templates/slide-16x9.png","幻灯片模板","16:9","10-templates/slide-16x9.png")
add("10-templates/release-card_1080x1350.png","更新日志卡","1080×1350","10-templates/release-card_1080x1350.png")
add("00-brand-foundation/_preview/page-04.png","色彩系统","主蓝 × slate","00-brand-foundation/brand-tokens.css")
add("02-badges/category/分类色卡.png","活动分类色卡","8 色槽 · 用户赋义","02-badges/category/分类色卡.png")
# manifest
files=[]
for root,dirs,fs in os.walk(WD):
    dirs[:]=[d for d in dirs if d not in ("_pipeline",".git","node_modules") and not d.startswith("_tmp")]
    for fn in fs:
        if fn.startswith("."): continue
        p=os.path.join(root,fn); files.append({"path":rel(p),"size":os.path.getsize(p)})
def _stamp():
    """生成时间取**最后一次提交的时间**，不用 `time.now()`。
    用墙上时钟会让每次重建的 index.html / manifest.json 字节都不同 —— 于是"产物有没有变"
    这件事永远无法用 sha 判断，也没法做幂等性检查。"""
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%cI", "--", "."],
                             cwd=WD, capture_output=True, text=True, timeout=15).stdout.strip()
        return out or "unknown"
    except Exception:
        return "unknown"


man={"brand":"heyta","generated_at":_stamp(),
     "dirs":{d:sum(1 for f in files if f["path"].startswith(d+"/")) for d in
             ["00-brand-foundation","01-logo","02-badges","03-icons","04-imagery","05-posters","06-brochure","07-product-manual","08-merch","09-social","10-templates"]},
     "count":len(files),"files":files}
json.dump(man,open(os.path.join(WD,"manifest.json"),"w",encoding="utf-8"),ensure_ascii=False,indent=2)

h=f"""<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>heyta · brand-kit</title><style>
*{{box-sizing:border-box}}body{{margin:0;font-family:'PingFang SC','Hiragino Sans GB',sans-serif;background:#f8fafc;color:#0f172a}}
header{{padding:48px 44px 26px;background:linear-gradient(120deg,#1e40af,#2563eb 60%,#0f172a);color:#fff}}
header .wm{{height:34px}} h1{{margin:14px 0 0;font-size:26px;font-weight:800;letter-spacing:-.5px}}
.sub{{color:#bfdbfe;margin-top:8px;font-size:14px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:22px;padding:34px 44px 70px}}
.c{{display:block;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;text-decoration:none;color:inherit;transition:.15s}}
.c:hover{{transform:translateY(-3px);box-shadow:0 14px 30px #0f172a1a}}
.im{{height:200px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;overflow:hidden}}
.im img{{width:100%;height:100%;object-fit:cover}}
.t{{padding:14px 16px 2px;font-size:16px;font-weight:700}} .s{{padding:0 16px 16px;font-size:12px;color:#64748b}}
footer{{padding:22px 44px;color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0}}
</style></head><body>
<header><img class="wm" src="01-logo/wordmark-white.svg" alt="hey.">
<h1>heyta · brand-kit</h1><div class="sub">本地优先任务管理 · 品牌资产套件 · {man['count']} files · {man['generated_at']}</div></header>
<div class="grid">{''.join(cards)}</div>
<footer>生成管线照 litopia12/brand-kit 的结构 · 字标/图标/色值取自 heyta 设计系统真源 · 成长体系取自仓库已实现的激励与成长体系</footer>
</body></html>"""
open(os.path.join(WD,"index.html"),"w",encoding="utf-8").write(RT.normalize(h))
print("index:", man["count"], "files; cards:", len(cards), man["dirs"])
