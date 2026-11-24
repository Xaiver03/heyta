# -*- coding: utf-8 -*-
"""heyta brand-kit 索引：index.html + manifest.json（扫描真实文件生成，可校验）"""
import os, json, time, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import read_tokens as RT
WD=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def rel(p): return os.path.relpath(p,WD)
def card(img,title,sub,href):
    return f'<a class="c" href="{href}"><div class="im"><img src="{img}"></div><div class="t">{title}</div><div class="s">{sub}</div></a>'
cards=[]
def add(img,title,sub,href):
    if os.path.exists(os.path.join(WD,img)): cards.append(card(img,title,sub,href))
add("02-badges/badge-catalogue.png","成长标识体系图鉴","17 里程碑 · 8 身份标签 · 8 分类色槽","02-badges/badge-catalogue.pdf")
add("00-brand-foundation/_preview/page-01.png","品牌手册 Brand Book","8 页 · 标识/色彩/字体/成长","00-brand-foundation/brand-book.pdf")
add("01-logo/lockup-horizontal@1x.png","字标 + 图标锁版","「hey.」+「h」","01-logo/lockup-horizontal.svg")
add("03-icons/icon-sheet.png","图标集 Icon Set","线性 26 枚","03-icons/icon-sheet.html")
add("04-imagery/contact-sheet.png","04 位图素材","本地 MOSS-Image · 背景/插画/周边","04-imagery/contact-sheet.png")
add("05-posters/01_品牌主视觉.png","品牌主视觉海报","A3 · PDF/PNG","05-posters/01_品牌主视觉.pdf")
add("05-posters/02_核心能力.png","核心能力海报","A3 · PDF/PNG","05-posters/02_核心能力.pdf")
add("05-posters/03_成长里程碑.png","成长里程碑海报","A3 · PDF/PNG","05-posters/03_成长里程碑.pdf")
add("06-brochure/brochure_front.png","宣传折页","A4 三折 · 正反面","06-brochure/heyta_brochure_front.pdf")
add("07-product-manual/heyta_product-manual_cover.png","产品手册","10 页 PDF","07-product-manual/heyta_product-manual.pdf")
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
man={"brand":"heyta","generated_at":time.strftime("%Y-%m-%d %H:%M:%S"),
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
