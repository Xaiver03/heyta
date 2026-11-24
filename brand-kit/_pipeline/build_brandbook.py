# -*- coding: utf-8 -*-
"""heyta 品牌手册 -> 00-brand-foundation/brand-book.pdf + _preview/page-XX.png"""
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render
import read_tokens as RT
import read_copy as RC
WD=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(WD,"00-brand-foundation"); PRE=os.path.join(OUT,"_preview")
LOGOD=os.path.join(WD,"01-logo"); BADGE=os.path.join(WD,"02-badges")
os.makedirs(PRE,exist_ok=True)
def f(p): return "file://"+os.path.abspath(p)
WM_WHITE=f(os.path.join(LOGOD,"wordmark-white.svg")); WM_BLUE=f(os.path.join(LOGOD,"wordmark-primary.svg"))
WM_INK=f(os.path.join(LOGOD,"wordmark-ink.svg"))
ICON=f(os.path.join(LOGOD,"app-icon.svg")); LOCK=f(os.path.join(LOGOD,"lockup-horizontal.svg"))
def ms(kind,thr): return f(os.path.join(BADGE,"milestones",f"{kind}-{thr}.png"))
def stat(n): return f(os.path.join(BADGE,"status",n+".svg"))
FONT="'PingFang SC','Hiragino Sans GB','Noto Sans CJK SC',sans-serif"
CSS=f"""*{{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;margin:0;padding:0}}
@page{{size:A4;margin:0}} html,body{{font-family:{FONT};color:#0f172a}}
.page{{width:210mm;height:297mm;position:relative;overflow:hidden;page-break-after:always;background:#fff}}
.page:last-child{{page-break-after:auto}}
.dark{{background:radial-gradient(120% 90% at 80% 0%,#1e40af,#2563eb 55%,#1e293b);color:#fff}}
.ph{{position:absolute;top:13mm;left:18mm;right:18mm;display:flex;justify-content:space-between;align-items:center;font-size:9px;letter-spacing:2px;color:#94a3b8;border-bottom:1px solid #e2e8f0;padding-bottom:6px}}
.ph img{{height:8mm}} .dark .ph{{border-color:#ffffff2e;color:#93c5fd}}
.pf{{position:absolute;bottom:10mm;left:18mm;right:18mm;display:flex;justify-content:space-between;font-size:8.5px;letter-spacing:1.5px;color:#94a3b8}}
.eyebrow{{font-size:10px;letter-spacing:4px;color:#2563eb;text-transform:uppercase}}
h1,h2,h3,p{{margin:0}}
.card{{border:1px solid #e2e8f0;border-radius:12px;padding:6mm;background:#fff}}
"""
# 🔴 手册里出现的**每一个**结构色都归一到 tokens.css 的取值：
#    手写十六进制会在色阶调整后静默留下旧色，而印刷品没人会去比对。
_STRUCT_COLORS = {
    "#0f172a": "slate-900",
    "#1e293b": "slate-800",
    "#334155": "slate-700",
    "#475569": "slate-600",
    "#64748b": "slate-500",
    "#94a3b8": "slate-400",
    "#cbd5e1": "slate-300",
    "#e2e8f0": "slate-200",
    "#f1f5f9": "slate-100",
    "#f8fafc": "slate-50",
    "#2563eb": "blue-600",
    "#1e40af": "blue-700",
    "#1d4ed8": "blue-700",
    "#60a5fa": "blue-400",
    "#93c5fd": "blue-300",
    "#bfdbfe": "blue-200",
    "#dbeafe": "blue-100",
    "#eff6ff": "blue-50",
    "#3b82f6": "blue-500",
    "#1e3a8a": "blue-900",
}

def _normalize(html_text: str) -> str:
    out = html_text
    for hexv, name in _STRUCT_COLORS.items():
        real = RT.token(name)
        if real is None:
            continue
        out = out.replace(hexv, real)
    return out

def doc(body): return _normalize(f"<!doctype html><html lang='zh'><head><meta charset='utf-8'><style>{CSS}</style></head><body>{body}</body></html>")
def head(label,dark=False): return f'<div class="ph"><img src="{WM_WHITE if dark else WM_BLUE}"><span>{label}</span></div>'
def foot(l,r="heyta · Brand Guidelines"): return f'<div class="pf"><span>{l}</span><span>{r}</span></div>'

def cover():
    return f'''<div class="page dark">
      <div style="position:absolute;left:18mm;top:22mm"><img src="{WM_WHITE}" style="height:22mm"></div>
      <div style="position:absolute;left:18mm;top:110mm;right:18mm">
        <div class="eyebrow" style="color:#bfdbfe">BRAND GUIDELINES · 品牌手册</div>
        <h1 style="font-size:52pt;margin-top:8mm;font-weight:800;letter-spacing:-1px">清晰·克制·可靠</h1>
        <p style="margin-top:8mm;font-size:13pt;line-height:1.9;color:#dbeafe">heyta · 本地优先、可自托管的任务管理应用<br>视觉识别系统（VI）基础规范 · 2026</p>
      </div>
      <div style="position:absolute;right:-30mm;bottom:-40mm;width:150mm;height:150mm;border-radius:50%;background:radial-gradient(circle,#60a5fa55,transparent 62%)"></div>
      <div class="pf" style="color:#bfdbfe"><span>heyta · 2026</span><span>hey.</span></div></div>'''

def p_intro():
    return f'''<div class="page">{head("品牌定位")}
      <div style="position:absolute;left:18mm;right:18mm;top:44mm">
        <div class="eyebrow">POSITIONING</div>
        <h2 style="font-size:30pt;margin-top:6mm;font-weight:800">今天该做什么，一眼看见</h2>
        <p style="margin-top:8mm;font-size:12pt;line-height:2;color:#334155">heyta 是一款本地优先、可自托管的任务管理应用，对标滴答清单。数据先落本地，端到端加密同步为可选通道。首要结果是：用户清楚地知道任务在哪里、下一步做什么、操作之后如何回来。</p>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6mm;margin-top:12mm">
          <div class="card"><div class="eyebrow">个性</div><h3 style="font-size:15pt;margin-top:4mm">清晰 · 克制 · 可靠</h3></div>
          <div class="card"><div class="eyebrow">语言</div><h3 style="font-size:15pt;margin-top:4mm">直接、安静、不打扰</h3></div>
          <div class="card"><div class="eyebrow">基底</div><h3 style="font-size:15pt;margin-top:4mm">蓝白 + 冷石板灰</h3></div>
        </div>
        <div style="margin-top:14mm;border-left:3px solid #2563eb;padding-left:6mm;color:#475569;font-size:11.5pt;line-height:1.9">克制：不做装饰性徽章墙、排行榜与断签惩罚；不把弹层叠弹层。视觉服务于任务的清晰，而不是制造焦虑。</div>
      </div>{foot("品牌定位")}</div>'''

def p_logo():
    return f'''<div class="page">{head("标识规范")}
      <div style="position:absolute;left:18mm;right:18mm;top:40mm">
        <div class="eyebrow">LOGO USAGE</div>
        <h2 style="font-size:26pt;margin-top:5mm;font-weight:800">字标「hey.」与「h」图标</h2>
        <p style="margin-top:5mm;font-size:11px;color:#64748b;line-height:1.8">字标为定制笔画（含品牌句点），图标为圆角方底 + 白色「h」三道字形，二者几何唯一、各端同源。</p>
        <div style="margin-top:8mm;height:40mm;border:1px dashed #e2e8f0;border-radius:12px;display:flex;align-items:center;justify-content:center;background:#f8fafc"><img src="{WM_BLUE}" style="height:16mm"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6mm;margin-top:7mm">
          <div class="card" style="display:flex;align-items:center;justify-content:center;height:34mm;background:#0f172a;border:0"><img src="{WM_WHITE}" style="height:12mm"></div>
          <div class="card" style="display:flex;align-items:center;justify-content:center;height:34mm"><img src="{LOCK}" style="height:14mm"></div>
        </div>
        <div style="margin-top:7mm;font-size:10.5px;line-height:1.9;color:#475569">深色底用反白字标；浅色底用品牌蓝字标。安全空间 ≥ 字标高度 1/2；最小宽度 24mm。<br>禁止：拉伸、改色、加描边阴影、旋转、置复杂底图之上。</div>
      </div>{foot("标识规范")}</div>'''

def sw(colors):
    return "".join(f'<div style="flex:1"><div style="height:20mm;background:{c};border-radius:6px 6px 0 0"></div><div style="font-size:7.5px;color:#94a3b8;text-align:center;padding:3px 0">{c}</div></div>' for c in colors)
def p_color():
    # 🔴 样张即事实源：从 tokens.css 读真实色阶，不手写第二份。
    blue=[RT.token(f"blue-{n}") for n in (50,100,200,300,400,500,600,700,800,900)]
    slate=[RT.token(f"slate-{n}") for n in (50,100,200,300,400,500,600,700,800,950)]
    return f'''<div class="page">{head("色彩系统")}
      <div style="position:absolute;left:18mm;right:18mm;top:42mm">
        <div class="eyebrow">COLOR SYSTEM</div>
        <h2 style="font-size:26pt;margin-top:5mm;font-weight:800">主蓝 × 冷石板灰</h2>
        <p style="margin-top:5mm;font-size:11px;color:#64748b">主色取自设计系统 token：主蓝 #2563eb（blue-600），中性为偏冷的 slate 石板灰。</p>
        <div style="margin-top:8mm"><div style="font-size:10px;color:#94a3b8;margin-bottom:2mm">主蓝 · Blue</div><div style="display:flex;gap:3px">{sw(blue)}</div></div>
        <div style="margin-top:6mm"><div style="font-size:10px;color:#94a3b8;margin-bottom:2mm">中性 · Slate</div><div style="display:flex;gap:3px">{sw(slate)}</div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4mm;margin-top:10mm">
          <div class="card"><div style="height:12mm;border-radius:6px;background:#059669"></div><p style="font-size:9px;color:#64748b;margin-top:2mm">成功 #059669</p></div>
          <div class="card"><div style="height:12mm;border-radius:6px;background:#d97706"></div><p style="font-size:9px;color:#64748b;margin-top:2mm">警告 #d97706</p></div>
          <div class="card"><div style="height:12mm;border-radius:6px;background:#dc2626"></div><p style="font-size:9px;color:#64748b;margin-top:2mm">危险 #dc2626</p></div>
          <div class="card"><div style="height:12mm;border-radius:6px;background:#0284c7"></div><p style="font-size:9px;color:#64748b;margin-top:2mm">信息 #0284c7</p></div>
        </div>
      </div>{foot("色彩系统")}</div>'''

def p_type():
    return f'''<div class="page">{head("字体系统")}
      <div style="position:absolute;left:18mm;right:18mm;top:42mm">
        <div class="eyebrow">TYPOGRAPHY</div>
        <h2 style="font-size:26pt;margin-top:5mm;font-weight:800">字体层级</h2>
        <div style="margin-top:8mm;border-bottom:1px solid #e2e8f0;padding-bottom:6mm"><div style="font-size:9px;color:#94a3b8">品牌字标 · hey.</div><img src="{WM_INK}" style="height:16mm;margin-top:3mm"></div>
        <div style="margin-top:6mm;border-bottom:1px solid #e2e8f0;padding-bottom:6mm"><div style="font-size:9px;color:#94a3b8">标题 · 苹方 粗</div><div style="font-weight:800;font-size:24pt;margin-top:2mm">今天该做什么，一眼看见</div></div>
        <div style="margin-top:6mm;border-bottom:1px solid #e2e8f0;padding-bottom:6mm"><div style="font-size:9px;color:#94a3b8">正文 · 苹方常规</div><div style="font-size:11.5pt;line-height:1.9;color:#334155;margin-top:2mm">今天要做的事，一条一条，落在眼前。一二三四五六七八九十 ABCDEFG 0123456789。</div></div>
        <p style="margin-top:6mm;font-size:10px;color:#94a3b8">中文正文推荐苹方 / 思源黑体；数字与英文推荐 SF Pro。</p>
      </div>{foot("字体系统")}</div>'''

def p_badges():
    def cell(kind,thr,label):
        return f'<div style="text-align:center"><img src="{ms(kind,thr)}" style="width:24mm"><div style="font-size:9px;color:#64748b;margin-top:2mm">{label}</div></div>'
    dims="".join(cell(k,t,l) for k,t,l in [("checkIns",200,"打卡 200 次"),("focusHours",50,"专注 50 小时"),("tasks",1000,"完成 1000 件"),("activeDays",100,"使用 100 天")])
    tags="".join(f'<img src="{os.path.join(BADGE,"identity",i+".svg")}" style="height:40px">' for i in ["started","routine","steady","checkin-hundred"])
    # 🔴 八槽色读自 tokens.css 的 `color.category-1..8`，不手写。
    cats="".join(f'<div style="flex:1"><div style="height:12mm;border-radius:6px;background:{RT.token(f"color-category-{n}")}"></div><div style="font-size:7.5px;color:#94a3b8;text-align:center;padding-top:2px">{n}</div></div>'
                 for n in range(1, 9))
    return f'''<div class="page">{head("成长标识体系")}
      <div style="position:absolute;left:18mm;right:18mm;top:40mm">
        <div class="eyebrow">GROWTH &amp; MILESTONES</div>
        <h2 style="font-size:26pt;margin-top:5mm;font-weight:800">里程碑 × 身份标签 × 分类色槽</h2>
        <p style="margin-top:5mm;font-size:10.5px;color:#64748b;line-height:1.9">17 个累计制里程碑（打卡/专注/完成/使用天数四维，<b>只增不减、无稀有度</b>）、8 个身份标签、8 个活动分类色槽。完整图鉴见 <b>02-badges/badge-catalogue.pdf</b>。</p>
        <div style="font-size:9px;color:#94a3b8;letter-spacing:3px;margin-top:9mm">里程碑 · MILESTONES</div>
        <div style="display:flex;justify-content:space-between;margin-top:4mm">{dims}</div>
        <div style="font-size:9px;color:#94a3b8;letter-spacing:3px;margin-top:9mm">身份标签 · IDENTITY TAGS</div>
        <div style="display:flex;gap:4mm;margin-top:4mm;flex-wrap:wrap">{tags}</div>
        <div style="font-size:9px;color:#94a3b8;letter-spacing:3px;margin-top:9mm">活动分类色槽 · CATEGORY SLOTS</div>
        <div style="display:flex;gap:3px;margin-top:4mm">{cats}</div>
        <p style="margin-top:6mm;font-size:9.5px;color:#64748b;line-height:1.8">颜色由用户赋义，App 不判断某活动"健康/不健康"、不自动上色。<br><b>不做</b>：稀有度收藏、徽章墙、排行榜、断签惩罚、货币经济。</p>
      </div>{foot("成长标识体系")}</div>'''

def p_apply():
    return f'''<div class="page">{head("应用示例")}
      <div style="position:absolute;left:18mm;right:18mm;top:42mm">
        <div class="eyebrow">APPLICATIONS</div>
        <h2 style="font-size:26pt;margin-top:5mm;font-weight:800">品牌应用</h2>
        <p style="margin-top:5mm;font-size:10.5px;color:#64748b">标识、色彩与徽章延展到海报、手册、周边与社交卡片，形成统一语言。</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6mm;margin-top:9mm">
          <div class="card" style="height:52mm;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#1e40af,#2563eb)"><img src="{WM_WHITE}" style="height:12mm"></div>
          <div class="card" style="height:52mm;display:flex;align-items:center;justify-content:center;background:#f8fafc;border:1px solid #e2e8f0"><img src="{ICON}" style="height:26mm"></div>
          <div class="card" style="height:52mm;display:flex;align-items:center;justify-content:center;background:#f8fafc;border:1px solid #e2e8f0"><img src="{ms("checkIns",200)}" style="height:26mm"></div>
          <div class="card" style="height:52mm;display:flex;align-items:center;justify-content:center;background:#0f172a"><img src="{WM_WHITE}" style="height:12mm"></div>
        </div>
      </div>{foot("应用示例")}</div>'''

def p_back():
    return f'''<div class="page dark">
      <div style="position:absolute;left:18mm;top:24mm"><img src="{WM_WHITE}" style="height:20mm"></div>
      <div style="position:absolute;left:18mm;right:18mm;top:120mm">
        <h1 style="font-size:30pt;font-weight:800;letter-spacing:-0.5px">今天该做什么，一眼看见</h1>
        <p style="margin-top:8mm;font-size:11pt;line-height:2;color:#dbeafe">本手册为 heyta 视觉识别系统的基础规范。<br>标识、色彩、字体与徽章的使用请遵循本册约定。</p>
        <div style="margin-top:14mm;font-size:10pt;color:#bfdbfe;line-height:2">heyta · 本地优先任务管理 · 2026</div>
      </div>
      <div class="pf" style="color:#93c5fd"><span>BRAND GUIDELINES</span><span>hey.</span></div></div>'''

body=cover()+p_intro()+p_logo()+p_color()+p_type()+p_badges()+p_apply()+p_back()
p=os.path.join(os.path.dirname(os.path.abspath(__file__)),"_tmp_brandbook.html"); os.makedirs(os.path.dirname(p),exist_ok=True)
open(p,"w",encoding="utf-8").write(doc(body))
pdf=os.path.join(OUT,"brand-book.pdf")
render.chrome_pdf(p,pdf)
# previews
for i in range(1,9):
    subprocess.run(["pdftoppm","-png","-r","80","-f",str(i),"-l",str(i),pdf,os.path.join(PRE,f"p{i:02d}")],check=True)
# pdftoppm outputs pXX-1.png etc; normalize names
import glob
for fpath in sorted(glob.glob(os.path.join(PRE,"p[0-9][0-9]-*.png"))):
    base=os.path.basename(fpath); num=base.split("-")[0]
    os.replace(fpath, os.path.join(PRE,f"page-{num[1:]}.png"))
print("brand book pages:8")
