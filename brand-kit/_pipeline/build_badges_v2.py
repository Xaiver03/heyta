#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""heyta 成长标识体系 -> brand-kit/02-badges（v2，按产品清单重建）"""
import os, sys, subprocess, html
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render
import read_tokens as RT
WD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(WD, "02-badges")
for d in ("milestones","identity","status","category","_preview"):
    os.makedirs(os.path.join(OUT,d), exist_ok=True)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FONT="'PingFang SC','Hiragino Sans GB','Noto Sans CJK SC',sans-serif"
def esc(s): return html.escape(s,quote=True)
ICONS={
 "repeat":'<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
 "clock":'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 "check":'<circle cx="12" cy="12" r="9"/><path d="M8 12l2.8 2.8L16 9"/>',
 "calendar":'<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/>',
}
# 🔴 四个维度色**不在本文件写死**：从 packages/design-system/src/tokens.css 读，
#    那是唯一事实源。VI 手册里的色值必须与运行时一致，否则手册会先于代码腐烂。
KINDS={
 "checkIns":  dict(color=RT.token("color-milestone-checkin"), icon="repeat",  latin="CHECK-INS", cn="累计打卡"),
 "focusHours":dict(color=RT.token("color-milestone-focus"),   icon="clock",   latin="FOCUS HRS", cn="累计专注"),
 "tasks":     dict(color=RT.token("color-milestone-tasks"),   icon="check",   latin="TASKS",     cn="累计完成"),
 "activeDays":dict(color=RT.token("color-milestone-days"),    icon="calendar",latin="DAYS",      cn="使用天数"),
}
MILESTONES=[]
for k,thr in [("checkIns",[10,50,200,500,1000]),("focusHours",[10,50,200,1000]),
              ("tasks",[50,200,1000,5000]),("activeDays",[7,30,100,365])]:
    for t in thr: MILESTONES.append(dict(kind=k,threshold=t))
IDENTITY=[
 ("started","已启程","activeDays",7),("routine","有节奏","activeDays",30),("steady","稳住","activeDays",100),
 ("checkin-hundred","打卡百次","checkIns",100),("deep-fifty","深潜五十时","focusHours",50),
 ("deep-two-hundred","深耕两百时","focusHours",200),("finisher-five-hundred","完成五百事","tasks",500),
 ("streak-thirty","连续三十天","streakDays",30),
]
TONES={
 "neutral":dict(bg="#F1F5F9",fg="#475569",dot="#64748B",bd="#E2E8F0"),
 "info":dict(bg="#EFF6FF",fg="#1D4ED8",dot="#3B82F6",bd="#BFDBFE"),
 "success":dict(bg="#ECFDF5",fg="#047857",dot="#10B981",bd="#A7F3D0"),
 "warning":dict(bg="#FFFBEB",fg="#B45309",dot="#F59E0B",bd="#FDE68A"),
 "danger":dict(bg="#FEF2F2",fg="#B91C1C",dot="#EF4444",bd="#FECACA"),
 "accent":dict(bg="#EFF6FF",fg="#1E40AF",dot="#2563EB",bd="#BFDBFE"),
}
STATUS=[("todo","待办","info"),("doing","进行中","success"),("done","已完成","success"),
        ("overdue","已逾期","danger"),("archived","已归档","neutral"),("high","高优先级","accent")]
# 8 个分类色槽同样读自 tokens.css（亮色主题）。这套值受
# `tests/category-colors.spec.ts` 约束：色盲可辨 + 与 surface ≥3:1，**不要照着"好看"替换**。
CATEGORY=[(f"category-{i}", RT.token(f"color-category-{i}")) for i in range(1, 9)]

def milestone_svg(m):
    k=KINDS[m["kind"]]; c=k["color"]; num=m["threshold"]; lab=k["latin"]; icon=ICONS[k["icon"]]
    S=240; cx=S/2; num_fs=54 if num<10000 else 44
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}" role="img" aria-label="heyta milestone {m["kind"]} {num}">
  <circle cx="{cx}" cy="{cx}" r="112" fill="{c}" fill-opacity="0.10"/>
  <circle cx="{cx}" cy="{cx}" r="112" fill="none" stroke="{c}" stroke-width="3"/>
  <circle cx="{cx}" cy="{cx}" r="98" fill="none" stroke="{c}" stroke-opacity="0.18" stroke-width="1.5"/>
  <g transform="translate({cx-28} 46) scale(2.33)" fill="none" stroke="{c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{icon}</g>
  <text x="{cx}" y="166" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="{num_fs}" font-weight="800" fill="{c}">{num}</text>
  <text x="{cx}" y="200" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700" letter-spacing="2" fill="#475569">{lab}</text>
</svg>'''

def identity_svg(t):
    tid,cn,kind,thr=t; c=KINDS[kind]["color"] if kind in KINDS else "#7c3aed"; W=250;H=54
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="heyta identity {esc(cn)}">
  <rect x="1" y="1" width="{W-2}" height="{H-2}" rx="{H/2}" fill="{c}" fill-opacity="0.10" stroke="{c}" stroke-opacity="0.5"/>
  <circle cx="28" cy="{H/2}" r="9" fill="{c}"/>
  <path d="M24 {H/2} l2.6 2.6 4.4-4.8" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="46" y="{H/2}" dominant-baseline="central" font-family="{FONT}" font-size="18" font-weight="700" fill="{c}">{esc(cn)}</text>
  <text x="{W-16}" y="{H/2}" text-anchor="end" dominant-baseline="central" font-family="{FONT}" font-size="12" fill="#94a3b8">≥{thr}</text>
</svg>'''

def status_svg(label,tone):
    t=TONES[tone]; fs=13; h=26; dot=6; padx=11; gap=6
    tw=sum(fs if ord(ch)>127 else fs*0.56 for ch in label); w=round(padx*2+dot+gap+tw)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'<rect x="0.5" y="0.5" width="{w-1}" height="{h-1}" rx="{h/2}" fill="{t["bg"]}" stroke="{t["bd"]}"/>'
            f'<circle cx="{padx+dot/2}" cy="{h/2}" r="{dot/2}" fill="{t["dot"]}"/>'
            f'<text x="{padx+dot+gap}" y="{h/2}" dominant-baseline="central" font-family="{FONT}" font-size="{fs}" font-weight="600" fill="{t["fg"]}">{esc(label)}</text></svg>')

def run():
    from pathlib import Path
    old=os.path.join(OUT,"achievement")
    if os.path.isdir(old):
        for fn in os.listdir(old): os.remove(os.path.join(old,fn))
    for sub in ("milestones","identity","status"):
        for fn in Path(os.path.join(OUT,sub)).glob("*"): fn.unlink()
    for m in MILESTONES:
        name=f'{m["kind"]}-{m["threshold"]}'
        open(os.path.join(OUT,"milestones",name+".svg"),"w",encoding="utf-8").write(milestone_svg(m))
        subprocess.run(["rsvg-convert","-w","240","-o",os.path.join(OUT,"milestones",name+".png"),os.path.join(OUT,"milestones",name+".svg")],check=True)
    for t in IDENTITY:
        open(os.path.join(OUT,"identity",t[0]+".svg"),"w",encoding="utf-8").write(identity_svg(t))
        render.svg_to_png_via_chrome(os.path.join(OUT,"identity",t[0]+".svg"), os.path.join(OUT,"identity",t[0]+".png"),250,54,3)
    for key,label,tone in STATUS:
        open(os.path.join(OUT,"status",key+".svg"),"w",encoding="utf-8").write(status_svg(label,tone))
    def ms_block(kind):
        k=KINDS[kind]; items=[m for m in MILESTONES if m["kind"]==kind]
        cells="".join(f'<div class="mcell"><img src="milestones/{m["kind"]}-{m["threshold"]}.png"></div>' for m in items)
        return f'<div class="mrow"><div class="mlabel"><b style="color:{k["color"]}">{k["cn"]}</b><span>{k["latin"]}</span></div><div class="mcells">{cells}</div></div>'
    idcells="".join(f'<img class="chipimg" src="identity/{t[0]}.svg">' for t in IDENTITY)
    cats="".join(f'<div class="cat"><div class="sw" style="background:{h}"></div><code>{slug}</code><span>{h}</span></div>' for slug,h in CATEGORY)
    stats="".join(f'<img src="status/{k}.svg" style="height:26px;margin:0 8px 8px 0">' for k,_,_ in STATUS)
    cat=f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
@page{{size:1200px 1500px;margin:0}} *{{box-sizing:border-box}} html,body{{margin:0;padding:0}}
body{{width:1200px;font-family:{FONT};background:#fff;color:#0f172a}} .sheet{{padding:60px 72px}}
.eyebrow{{color:#2563eb;font-weight:700;letter-spacing:.16em;font-size:13px;text-transform:uppercase}}
h1{{font-size:46px;font-weight:800;margin:8px 0 6px;letter-spacing:-.5px}}
.lead{{color:#475569;font-size:16px;line-height:1.75;max-width:1000px;margin-bottom:22px}}
h2{{font-size:22px;font-weight:800;margin:30px 0 13px;padding-bottom:9px;border-bottom:2px solid #e2e8f0}}
.mrow{{display:flex;align-items:center;gap:22px;padding:10px 0;border-bottom:1px dashed #eef2f6}}
.mlabel{{width:128px;flex:none}} .mlabel b{{display:block;font-size:16px}} .mlabel span{{font-size:10px;color:#94a3b8;letter-spacing:1px}}
.mcells{{display:flex;gap:10px;flex-wrap:wrap;align-items:center}}
.mcell{{text-align:center}} .mcell img{{width:74px;height:74px;display:block}} .mnum{{font-size:11px;color:#64748b;font-weight:700;margin-top:-4px}}
.chips{{display:flex;flex-wrap:wrap;gap:10px}} .chipimg{{height:44px}}
.cats{{display:grid;grid-template-columns:repeat(8,1fr);gap:12px}}
.cat{{text-align:center}} .sw{{height:50px;border-radius:8px}} .cat code{{display:block;font-size:10px;color:#64748b;margin-top:6px}} .cat span{{font-size:9px;color:#94a3b8}}
.note{{margin-top:24px;font-size:13px;line-height:1.8;color:#475569;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;padding:16px 20px}}
.foot{{margin-top:22px;display:flex;justify-content:space-between;color:#94a3b8;font-size:12px}}
</style></head><body><div class="sheet">
<div class="eyebrow">heyta · Brand Assets</div>
<h1>成长标识体系 Growth &amp; Milestone System</h1>
<div class="lead">依据 heyta 已实现的「激励与成长体系」：<b>17 个里程碑</b>（打卡/专注/完成/使用天数四维，<b>只增不减、无稀有度</b>）、<b>8 个身份标签</b>、<b>8 个活动分类色槽</b>与少量任务状态胶囊。没有稀有度收藏、没有排行榜、没有货币。</div>
<h2>里程碑 · Milestones（17，累计制，只增不减）</h2>
{ms_block("checkIns")}{ms_block("focusHours")}{ms_block("tasks")}{ms_block("activeDays")}
<h2>身份标签 · Identity Tags（8，可隐藏/可关闭）</h2>
<div class="chips">{idcells}</div>
<h2>活动分类色槽 · Category Slots（颜色由用户赋义，App 不判健康）</h2>
<div class="cats">{cats}</div>
<h2>任务状态胶囊 · Status Pills（UI 元件，不算成就）</h2>
<div>{stats}</div>
<div class="note"><b>口径：</b>里程碑阈值对齐 <code>packages/domain/src/milestones.ts</code>，身份标签对齐 <code>identity-tags.ts</code>。四维语义色（读自 <code>tokens.css</code>）：打卡 <b>{KINDS["checkIns"]["color"]}</b> · 专注 <b>{KINDS["focusHours"]["color"]}</b> · 完成 <b>{KINDS["tasks"]["color"]}</b> · 天数 <b>{KINDS["activeDays"]["color"]}</b>。<br>
<b>分类色槽</b>同样读自 <code>color.category-1..8</code>，那套值受 <code>tests/category-colors.spec.ts</code> 约束（色盲可辨 + ≥3:1），<b>不要按好看替换</b>。<br>
<b>不做：</b>稀有度（common/rare/epic/legendary）、收藏徽章墙、排行榜、断签惩罚、货币经济。</div>
<div class="foot"><span>heyta Design System · brand-kit/02-badges</span><span>Growth &amp; Milestone System v1.0</span></div>
</div></body></html>"""
    open(os.path.join(OUT,"badge-catalogue.html"),"w",encoding="utf-8").write(cat)
    swatches="".join(f'<div style="flex:1;text-align:center"><div style="height:120px;border-radius:10px;background:{h}"></div><div style="font-size:12px;color:#64748b;margin-top:8px">{slug}</div><div style="font-size:11px;color:#94a3b8">{h}</div></div>' for slug,h in CATEGORY)
    card=f"""<!doctype html><html><head><meta charset="utf-8"><style>
@page{{size:1200px 420px;margin:0}}*{{margin:0;padding:0;box-sizing:border-box}}
body{{width:1200px;font-family:{FONT};background:#fff;padding:40px 56px}}
.t{{font-size:16px;font-weight:800;margin-bottom:6px}} .s{{font-size:12px;color:#94a3b8;margin-bottom:22px}} .row{{display:flex;gap:14px}}
</style></head><body>
<div class="t">活动分类色槽 · Category Slots</div>
<div class="s">颜色由用户赋义，App 永不判断某活动"健康/不健康"、永不自动上色。</div>
<div class="row">{swatches}</div></body></html>"""
    open(os.path.join(OUT,"category","_cards.html"),"w",encoding="utf-8").write(card)
    render.chrome_png(os.path.join(OUT,"category","_cards.html"), os.path.join(OUT,"category","分类色卡.png"),1200,420,2)
    subprocess.run([CHROME,"--headless=new","--disable-gpu","--hide-scrollbars","--force-device-scale-factor=2",
                    "--window-size=1200,1500",f"--screenshot={os.path.join(OUT,'badge-catalogue.png')}",
                    f"file://{os.path.join(OUT,'badge-catalogue.html')}"],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run([CHROME,"--headless=new","--disable-gpu","--no-pdf-header-footer",
                    f"--print-to-pdf={os.path.join(OUT,'badge-catalogue.pdf')}",
                    f"file://{os.path.join(OUT,'badge-catalogue.html')}"],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    import shutil; shutil.copyfile(os.path.join(OUT,"badge-catalogue.png"),os.path.join(OUT,"_preview","page-1.png"))
    print("milestones:",len(MILESTONES),"identity:",len(IDENTITY),"status:",len(STATUS),"category:",len(CATEGORY))
if __name__=="__main__": run()
