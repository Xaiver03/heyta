# -*- coding: utf-8 -*-
"""heyta 05-posters / 06-brochure / 07-product-manual / 08-merch / 09-social / 10-templates"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render
import read_tokens as RT
import read_copy as RC
WD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # brand-kit
OUT_ROOT = WD
LOGOD=os.path.join(WD,"01-logo"); IMG=os.path.join(WD,"04-imagery")
def f(p): return "file://"+os.path.abspath(p)
WM_B=f(os.path.join(LOGOD,"wordmark-primary.svg")); WM_W=f(os.path.join(LOGOD,"wordmark-white.svg"))
WM_INK=f(os.path.join(LOGOD,"wordmark-ink.svg")); ICON=f(os.path.join(LOGOD,"app-icon.svg"))
LOCK=f(os.path.join(LOGOD,"lockup-horizontal.svg"))
def ms(kind,thr): return f(os.path.join(WD,"02-badges","milestones",f"{kind}-{thr}.png"))
def stat(n): return f(os.path.join(WD,"02-badges","status",n+".svg"))
FONT="'PingFang SC','Hiragino Sans GB','Noto Sans CJK SC',sans-serif"
BLUE="#2563eb"; DEEP="#1e40af"; INK="#0f172a"; SL="#475569"; SL8="#94a3b8"; BD="#e2e8f0"; SUN="#f8fafc"
def doc(body,size_css): 
    return f"<!doctype html><html lang='zh'><head><meta charset='utf-8'><style>*{{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;margin:0;padding:0}}html,body{{font-family:{FONT};color:{INK}}}{size_css}</style></head><body>{body}</body></html>"
def wr(name,html):
    p=os.path.join(os.path.dirname(os.path.abspath(__file__)),"_tmp_"+name); open(p,"w",encoding="utf-8").write(RT.normalize(html)); return p

# ---------------- 05 posters (A3) ----------------
A3="@page{size:297mm 420mm;margin:0}.page{width:297mm;height:420mm;position:relative;overflow:hidden}"
def poster1():
    b=f'''<div class="page" style="background:radial-gradient(120% 90% at 80% 0%,#1e40af,#2563eb 52%,#0f172a);color:#fff">
      <img src="{ICON}" style="position:absolute;right:-40mm;bottom:-40mm;width:220mm;opacity:.10">
      <div style="position:absolute;left:24mm;top:22mm"><img src="{WM_W}" style="height:24mm"></div>
      <div style="position:absolute;left:24mm;top:120mm;right:24mm">
        <div style="font-size:13px;letter-spacing:6px;color:#bfdbfe">{RC.t("landing.hero.eyebrow")}</div>
        <h1 style="font-size:66pt;font-weight:800;line-height:1.18;margin-top:12mm;letter-spacing:-1px">{RC.hero()["lead"]}<br>{RC.hero()["emphasis"]}</h1>
        <p style="margin-top:12mm;font-size:16pt;line-height:1.9;color:#dbeafe;max-width:210mm">数据先落本地，端到端加密同步为可选通道。<br>清楚知道任务在哪里、下一步做什么、做完如何回来。</p>
      </div>
      <div style="position:absolute;left:24mm;right:24mm;bottom:16mm;display:flex;justify-content:space-between;font-size:10px;letter-spacing:2px;color:#93c5fd"><span>heyta · 2026</span><span>清晰 · 克制 · 可靠</span><span>hey.</span></div>
    </div>'''
    return doc(b,A3)
def poster2():
    feats=[("01","本地优先","数据先落本地，离线可用，云端只是同步通道。"),("02","可选端到端加密","默认服务端可读，需要时再开 E2EE。"),("03","跨端一致","Web / 桌面 / iOS / Android 同一套任务。")]
    rows="".join(f'''<div style="display:flex;gap:8mm;align-items:flex-start;padding:8mm 0;border-bottom:1px solid #e2e8f0"><div style="font-size:30px;font-weight:800;color:{BLUE};width:22mm">{n}</div><div><div style="font-size:17pt;font-weight:700">{t}</div><div style="font-size:12pt;color:{SL};margin-top:3mm;line-height:1.8">{d}</div></div></div>''' for n,t,d in feats)
    b=f'''<div class="page" style="background:#fff">
      <div style="position:absolute;left:24mm;top:22mm"><img src="{WM_B}" style="height:20mm"></div>
      <div style="position:absolute;left:24mm;top:80mm;right:24mm">
        <div style="font-size:13px;letter-spacing:6px;color:{BLUE}">{RC.t("landing.hero.eyebrow")}</div>
        <h1 style="font-size:52pt;font-weight:800;margin-top:8mm;letter-spacing:-1px;line-height:1.2">{RC.tagline_html()}</h1>
        <div style="margin-top:14mm">{rows}</div>
      </div>
      <div style="position:absolute;left:24mm;right:24mm;bottom:16mm;display:flex;justify-content:space-between;font-size:10px;color:{SL8}"><span>heyta · 核心能力</span><span>hey.</span></div>
    </div>'''
    return doc(b,A3)
def poster3():
    # 状态胶囊清单**从产物目录现读**，不在这里写第二份 key 列表 ——
    # 写死过一次，结果产品里删掉「进行中」后这里仍引用 status/doing.svg，海报上出现空白胶囊。
    _order = ["todo", "done", "overdue", "archived", "high"]
    _have = [f[:-4] for f in os.listdir(os.path.join(OUT_ROOT, "02-badges/status")) if f.endswith(".svg")]
    _seq = [k for k in _order if k in _have] + sorted(k for k in _have if k not in _order)
    pills="".join(f'<img src="{stat(n)}" style="height:26px;margin:0 6px 8px 0">' for n in _seq)
    mcards="".join(f'<div style="text-align:center"><img src="{ms(k,t)}" style="width:42mm"><div style="font-size:11px;color:{SL};margin-top:3mm">{l}</div></div>' for k,t,l in [("checkIns",200,"累计打卡 200 次"),("focusHours",50,"累计专注 50 小时"),("tasks",1000,"累计完成 1000 件"),("activeDays",100,"使用 100 天")])
    b=f'''<div class="page" style="background:radial-gradient(120% 90% at 50% 108%,#dbeafe,#fff 60%)">
      <div style="position:absolute;left:24mm;top:22mm"><img src="{WM_B}" style="height:20mm"></div>
      <div style="position:absolute;left:24mm;top:78mm;right:24mm">
        <div style="font-size:13px;letter-spacing:6px;color:{BLUE}">GROWTH · 克制地记录成长</div>
        <h1 style="font-size:50pt;font-weight:800;margin-top:8mm;line-height:1.22;letter-spacing:-1px">把每一次积累，<br>做成看得见的刻度</h1>
        <p style="margin-top:8mm;font-size:12.5pt;color:{SL};line-height:1.9">累计制里程碑 · 只增不减 · 不作排行榜、不做断签惩罚——只为你自己的成长回望。</p>
        <div style="display:flex;justify-content:space-between;margin-top:18mm">{mcards}</div>
        <div style="position:absolute;left:24mm;right:24mm;top:272mm">
          <div style="font-size:12px;letter-spacing:4px;color:{BLUE};margin-bottom:5mm">状态胶囊 · STATUS PILLS</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">{pills}</div>
          <p style="margin-top:7mm;font-size:10.5pt;color:{SL};line-height:1.9;max-width:210mm">状态胶囊传达任务状态，里程碑记录累计成长。只传达信息、不承担主要操作；不作排行榜、不做断签惩罚。</p>
        </div>
      </div>
      <div style="position:absolute;left:24mm;right:24mm;bottom:16mm;display:flex;justify-content:space-between;font-size:10px;color:{SL8}"><span>heyta · 成长里程碑</span><span>hey.</span></div>
    </div>'''
    return doc(b,A3)

# ---------------- 06 brochure (A4 landscape trifold) ----------------
BR="@page{size:297mm 210mm;margin:0}.page{width:297mm;height:210mm;display:flex;position:relative;overflow:hidden}.panel{width:99mm;height:210mm;padding:14mm 10mm;position:relative;overflow:hidden}.fold{position:absolute;top:0;bottom:0;width:1px;border-left:1px dashed #0f172a18;z-index:3}"
def brochure_front():
    b=f'''<div class="page">
      <div class="panel" style="background:radial-gradient(120% 90% at 30% 110%,#1e40af,#2563eb 55%,#0f172a);color:#fff">
        <img src="{WM_W}" style="height:16mm">
        <h1 style="position:absolute;left:10mm;right:10mm;top:80mm;font-size:30pt;font-weight:800;line-height:1.28;letter-spacing:-.5px">{RC.tagline_html()}</h1>
        <p style="position:absolute;left:10mm;right:10mm;top:150mm;font-size:10.5pt;color:#dbeafe;line-height:1.9">本地优先、可自托管的任务管理应用</p>
        <div style="position:absolute;left:10mm;bottom:12mm"><img src="{WM_W}" style="height:11mm"></div>
        <div class="fold" style="left:99mm"></div><div class="fold" style="left:198mm"></div>
      </div>
      <div class="panel">
        <div style="font-size:10px;letter-spacing:4px;color:{BLUE}">WHAT IS HEYTA</div>
        <h2 style="font-size:22pt;font-weight:800;margin-top:8mm">是什么</h2>
        <p style="margin-top:7mm;font-size:10.5px;line-height:2;color:{SL}">heyta 是一款本地优先、可自托管的任务管理应用，对标滴答清单。数据先落本地，端到端加密同步为可选通道。首要结果是：用户理解任务在哪里、下一步做什么、操作后如何回来。</p>
        <div style="margin-top:9mm;display:flex;flex-direction:column;gap:5mm">
          <div style="display:flex;gap:4mm;align-items:center"><div style="width:9mm;height:9mm;border-radius:9px;background:{BLUE}1a;color:{BLUE};display:flex;align-items:center;justify-content:center;font-weight:800">本</div><div style="font-size:10px;color:{SL}">本地优先 · 离线可用</div></div>
          <div style="display:flex;gap:4mm;align-items:center"><div style="width:9mm;height:9mm;border-radius:9px;background:{BLUE}1a;color:{BLUE};display:flex;align-items:center;justify-content:center;font-weight:800">密</div><div style="font-size:10px;color:{SL}">端到端加密 · 可选</div></div>
          <div style="display:flex;gap:4mm;align-items:center"><div style="width:9mm;height:9mm;border-radius:9px;background:{BLUE}1a;color:{BLUE};display:flex;align-items:center;justify-content:center;font-weight:800">跨</div><div style="font-size:10px;color:{SL}">四端一致 · 同一套任务</div></div>
        </div>
        <div class="fold" style="left:99mm"></div>
      </div>
      <div class="panel" style="background:{SUN}">
        <div style="font-size:10px;letter-spacing:4px;color:{BLUE}">GET STARTED</div>
        <h2 style="font-size:22pt;font-weight:800;margin-top:8mm">开始使用</h2>
        <p style="margin-top:8mm;font-size:10.5px;line-height:2.1;color:{SL}">官网下载 Web / 桌面 / iOS / Android 版本。<br>无需账号即可本地使用；需要跨端时再开启同步。</p>
        <div style="margin-top:10mm">{qr_block()}</div>
        <div class="fold" style="left:99mm"></div>
      </div>'''
    return doc(b,BR)
def brochure_back():
    caps=[("任务与清单","收集、安排、完成；今天要做的事一条条清晰。"),("日历与视图","时间、清单、看板多视角，随时回到现场。"),("专注与回顾","把注意力放回当下，按周回望成长。")]
    c="".join(f'<div><div style="font-size:13pt;font-weight:700">{t}</div><div style="font-size:9.5px;color:{SL};margin-top:2mm;line-height:1.7">{d}</div></div>' for t,d in caps)
    b=f'''<div class="page">
      <div class="panel">
        <div style="font-size:10px;letter-spacing:4px;color:{BLUE}">CAPABILITIES</div>
        <h2 style="font-size:22pt;font-weight:800;margin-top:8mm">核心能力</h2>
        <div style="margin-top:8mm;display:flex;flex-direction:column;gap:7mm">{c}</div>
        <div class="fold" style="left:99mm"></div>
      </div>
      <div class="panel" style="background:{SUN}">
        <div style="font-size:10px;letter-spacing:4px;color:{BLUE}">PRINCIPLES</div>
        <h2 style="font-size:22pt;font-weight:800;margin-top:8mm">设计原则</h2>
        <p style="margin-top:7mm;font-size:10.5px;line-height:2;color:{SL}">· 按用户意图划分目的地：执行任务 / 回顾成长 / 修改配置。<br>· 每份资料只有一个编辑位置，其他入口深链过去。<br>· 本地使用不依赖账号，账号与同步分开表达。<br>· 不做装饰性徽章墙、排行榜与断签惩罚。</p>
        <div class="fold" style="left:99mm"></div>
      </div>
      <div class="panel" style="background:radial-gradient(120% 90% at 30% 110%,#1e40af,#2563eb 55%,#0f172a);color:#fff">
        <img src="{WM_W}" style="height:14mm">
        <h2 style="position:absolute;left:10mm;right:10mm;top:78mm;font-size:24pt;font-weight:800;line-height:1.3">清晰 · 克制 · 可靠</h2>
        <p style="position:absolute;left:10mm;right:10mm;top:150mm;font-size:9.5pt;color:#dbeafe;line-height:1.9">heyta · 本地优先任务管理<br>hey. · 2026</p>
        <div class="fold" style="left:99mm"></div>
      </div>'''
    return doc(b,BR)

# ---------------- 07 product manual (A4 multi-page) ----------------
A4="@page{size:A4;margin:0}.page{width:210mm;height:297mm;position:relative;overflow:hidden;page-break-after:always;background:#fff}.page:last-child{page-break-after:auto}"
def ph(label): return f'<div style="position:absolute;top:13mm;left:18mm;right:18mm;display:flex;justify-content:space-between;align-items:center;font-size:9px;letter-spacing:2px;color:{SL8};border-bottom:1px solid {BD};padding-bottom:6px"><img src="{WM_B}" style="height:8mm"><span>{label}</span></div>'
def pf(l,r="heyta · Product Manual"): return f'<div style="position:absolute;bottom:10mm;left:18mm;right:18mm;display:flex;justify-content:space-between;font-size:8.5px;letter-spacing:1.5px;color:{SL8}"><span>{l}</span><span>{r}</span></div>'
def manual():
    pages=[]
    pages.append(f'''<div class="page" style="background:radial-gradient(120% 90% at 80% 0%,#1e40af,#2563eb 55%,#0f172a);color:#fff">
      <img src="{WM_W}" style="position:absolute;left:18mm;top:24mm;height:22mm">
      <div style="position:absolute;left:18mm;top:110mm;right:18mm"><div style="font-size:11px;letter-spacing:5px;color:#bfdbfe">PRODUCT MANUAL · 产品手册</div>
      <h1 style="font-size:44pt;font-weight:800;margin-top:8mm;letter-spacing:-1px">{RC.tagline_html()}</h1>
      <p style="margin-top:8mm;font-size:12pt;color:#dbeafe;line-height:1.9">heyta 产品手册 · 2026</p></div>
      <div style="position:absolute;left:18mm;right:18mm;bottom:16mm;display:flex;justify-content:space-between;font-size:9px;color:#93c5fd"><span>heyta</span><span>hey.</span></div></div>''')
    toc=["产品定位","设计原则","功能总览","数据与隐私","跨端使用","上手与迁移","常见问题"]
    rows="".join(f'<div style="display:flex;justify-content:space-between;border-bottom:1px solid {BD};padding:14px 0;font-size:12pt"><span><b style="color:{BLUE};margin-right:12px">{i+1:02d}</b>{t}</span><span style="color:{SL8}">P{i+3:02d}</span></div>' for i,t in enumerate(toc))
    pages.append(f'<div class="page">{ph("目录 · CONTENTS")}<div style="position:absolute;left:18mm;right:18mm;top:52mm"><h2 style="font-size:24pt;font-weight:800">目录</h2><div style="margin-top:12mm">{rows}</div></div>{pf("目录")}</div>')
    pages.append(f'''<div class="page">{ph("产品定位")}<div style="position:absolute;left:18mm;right:18mm;top:48mm"><div style="font-size:10px;letter-spacing:4px;color:{BLUE}">POSITIONING</div><h2 style="font-size:28pt;font-weight:800;margin-top:6mm">本地优先、可自托管的任务管理</h2><p style="margin-top:9mm;font-size:12pt;line-height:2;color:{SL}">heyta 面向需要每日收集、安排与完成个人任务的人，包含选择自托管与本地离线工作的用户。主工作流是任务执行，账户管理与统计回顾属低频活动。</p><p style="margin-top:6mm;font-size:12pt;line-height:2;color:{SL}">数据先落本地，云端只是同步通道，不是事实源。端到端加密是可选能力，不是默认值。</p></div>{pf("产品定位")}</div>''')
    prin=[("按意图划分目的地","执行任务、回顾成长、修改配置，各自清晰。"),("单一编辑位置","每份资料只有一个编辑处，其他入口深链过去。"),("本地不依赖账号","本地使用不需要账号，账号与同步分开表达。"),("克制，不制造焦虑","不做装饰性徽章墙、排行榜与断签惩罚。")]
    pr="".join(f'<div style="display:flex;gap:6mm;padding:8mm 0;border-bottom:1px solid {BD}"><div style="font-size:15pt;font-weight:800;color:{BLUE};width:10mm">{i+1}</div><div><div style="font-size:14pt;font-weight:700">{t}</div><div style="font-size:11px;color:{SL};margin-top:2mm;line-height:1.8">{d}</div></div></div>' for i,(t,d) in enumerate(prin))
    pages.append(f'<div class="page">{ph("设计原则")}<div style="position:absolute;left:18mm;right:18mm;top:46mm"><div style="font-size:10px;letter-spacing:4px;color:{BLUE}">PRINCIPLES</div><h2 style="font-size:28pt;font-weight:800;margin-top:6mm">四条设计原则</h2><div style="margin-top:8mm">{pr}</div></div>{pf("设计原则")}</div>')
    feat=[("任务与清单","收集、安排、完成；支持子任务、标签、优先级与提醒。"),("日历与多视图","时间、清单、看板多视角，按用户意图组织。"),("专注","把注意力放回当下，专注计时与休息节奏。"),("回顾","按周/月回望完成情况，克制的统计而非压力。"),("搜索与筛选","快速找回任务；筛选条件可保存。"),("离线与同步","离线可用，联网后按 op-log 同步，冲突确定性合并。")]
    fr="".join(f'<div class="card" style="border:1px solid {BD};border-radius:12px;padding:6mm"><div style="font-size:13pt;font-weight:700">{t}</div><div style="font-size:10.5px;color:{SL};margin-top:3mm;line-height:1.8">{d}</div></div>' for t,d in feat)
    pages.append(f'<div class="page">{ph("功能总览")}<div style="position:absolute;left:18mm;right:18mm;top:46mm"><div style="font-size:10px;letter-spacing:4px;color:{BLUE}">FEATURES</div><h2 style="font-size:28pt;font-weight:800;margin-top:6mm">功能总览</h2><div style="display:grid;grid-template-columns:1fr 1fr;gap:6mm;margin-top:10mm">{fr}</div></div>{pf("功能总览")}</div>')
    pages.append(f'''<div class="page">{ph("数据与隐私")}<div style="position:absolute;left:18mm;right:18mm;top:46mm"><div style="font-size:10px;letter-spacing:4px;color:{BLUE}">DATA & PRIVACY</div><h2 style="font-size:28pt;font-weight:800;margin-top:6mm">数据在你手里</h2><p style="margin-top:8mm;font-size:12pt;line-height:2;color:{SL}">· 本地优先：数据先落本地（SQLite / IndexedDB），离线可用。<br>· 同步模型：op-log（事件溯源），向量时钟判并发，LWW + clientId 确定性打破平局。<br>· 加密：默认服务端可读（便于找回）；用户可显式开启端到端加密。<br>· 自托管：可自行部署服务器，数据不出自己的边界。</p></div>{pf("数据与隐私")}</div>''')
    pages.append(f'''<div class="page">{ph("跨端使用")}<div style="position:absolute;left:18mm;right:18mm;top:46mm"><div style="font-size:10px;letter-spacing:4px;color:{BLUE}">CROSS-PLATFORM</div><h2 style="font-size:28pt;font-weight:800;margin-top:6mm">四端一致</h2><div style="display:grid;grid-template-columns:1fr 1fr;gap:6mm;margin-top:10mm">{"".join(f'<div class="card" style="border:1px solid {BD};border-radius:12px;padding:8mm;text-align:center"><div style="font-size:16pt;font-weight:800;color:{BLUE}">{p}</div></div>' for p in ["Web","桌面端","iOS","Android"])}</div><p style="margin-top:10mm;font-size:11.5px;line-height:2;color:{SL}">同一套任务与同一套同步；界面差异只来自平台，而非业务逻辑。桌面壳加载的就是 Web 构建产物。</p></div>{pf("跨端使用")}</div>''')
    steps=[("01","安装","从官网下载对应端安装包。"),("02","本地开始","无需账号，先把今天的事收进来。"),("03","需要时同步","在多端登录同一账号，开启同步。"),("04","迁移","可从其他任务工具导入任务与清单。")]
    st="".join(f'<div style="display:flex;gap:6mm;padding:7mm 0;border-bottom:1px solid {BD}"><div style="font-size:22px;font-weight:800;color:{BLUE};width:20mm">{n}</div><div><div style="font-size:14pt;font-weight:700">{t}</div><div style="font-size:11px;color:{SL};margin-top:2mm">{d}</div></div></div>' for n,t,d in steps)
    pages.append(f'<div class="page">{ph("上手与迁移")}<div style="position:absolute;left:18mm;right:18mm;top:46mm"><div style="font-size:10px;letter-spacing:4px;color:{BLUE}">GETTING STARTED</div><h2 style="font-size:28pt;font-weight:800;margin-top:6mm">四步上手</h2><div style="margin-top:8mm">{st}</div></div>{pf("上手与迁移")}</div>')
    faq=[("数据在哪？","默认在本地；开启同步后才会上传。"),("必须登录吗？","不。本地使用不需要账号。"),("加密是默认的吗？","不是。默认服务端可读，可显式开启 E2EE。"),("能自托管吗？","可以，自行部署服务器即可。")]
    fq="".join(f'<div style="padding:7mm 0;border-bottom:1px solid {BD}"><div style="font-size:12.5pt;font-weight:700">{q}</div><div style="font-size:11px;color:{SL};margin-top:2mm;line-height:1.8">{a}</div></div>' for q,a in faq)
    pages.append(f'<div class="page">{ph("常见问题")}<div style="position:absolute;left:18mm;right:18mm;top:46mm"><div style="font-size:10px;letter-spacing:4px;color:{BLUE}">FAQ</div><h2 style="font-size:28pt;font-weight:800;margin-top:6mm">常见问题</h2><div style="margin-top:8mm">{fq}</div></div>{pf("常见问题")}</div>')
    pages.append(f'''<div class="page" style="background:radial-gradient(120% 90% at 80% 0%,#1e40af,#2563eb 55%,#0f172a);color:#fff"><img src="{WM_W}" style="position:absolute;left:18mm;top:24mm;height:20mm"><div style="position:absolute;left:18mm;right:18mm;top:120mm"><h1 style="font-size:30pt;font-weight:800;line-height:1.3">{RC.tagline_html()}</h1><p style="margin-top:8mm;font-size:11pt;color:#dbeafe;line-height:2">heyta · 本地优先任务管理 · 2026</p></div><div style="position:absolute;left:18mm;right:18mm;bottom:16mm;display:flex;justify-content:space-between;font-size:9px;color:#93c5fd"><span>PRODUCT MANUAL</span><span>hey.</span></div></div>''')
    # 🔴 目录页码是**假设**「封面=1、目录=2、正文从 3 起、按 toc 顺序各占一页」算出来的
    #    （`P{i+3:02d}`）。这个假设一旦被插入一页打破，目录就会静静地指错页。
    #    所以在出口处把它变成断言：页数必须刚好对上，且每一页真的属于它那一节。
    if len(pages) != 2 + len(toc) + 1:  # 封面 + 目录 + 各节 + 封底
        raise SystemExit(
            f"手册页数 {len(pages)} ≠ 2+{len(toc)}+1 —— 目录页码（P03 起）会指错页，先修目录算法"
        )
    for i, title in enumerate(toc):
        if title not in pages[2 + i]:
            raise SystemExit(
                f"目录第 {i+1} 节写「{title}」，但第 {3+i} 页里没有这个标题 —— 目录与正文错位"
            )
    return doc("".join(pages),A4)

# ---------------- 09 social ----------------

# ── 站点域名：从 landing 的唯一事实源读，不在这里写第二个 ──────────────
def _site_origin():
    import re as _re, base64 as _b64
    p = os.path.join(os.path.dirname(WD), "apps/landing/src/site/origin.ts")
    if not os.path.exists(p):
        return None
    m = _re.search(r"DEFAULT_SITE_ORIGIN\s*=\s*'([^']+)'", open(p, encoding="utf-8").read())
    return m.group(1) if m else None


def qr_block():
    """官网二维码。有 segno 就画真二维码（内联 SVG），没有就退回域名文字。

    两者都**不留空白虚线框** —— 一份发出去的宣传册里放一个"扫码"空框，
    比没有二维码更糟：它看着像成品，实际什么都没指向。
    """
    origin = _site_origin()
    if not origin:
        return ""
    try:
        import segno  # 可选依赖：有就画真码
        import io as _io
        buf = _io.BytesIO()
        segno.make(origin, error="m").save(buf, kind="svg", scale=1, border=0)
        b64 = _b64.b64encode(buf.getvalue()).decode()
        return (f'<div style="width:36mm;height:36mm"><img src="data:image/svg+xml;base64,{b64}" '
                f'style="width:36mm;height:36mm" alt="{origin}"></div>'
                f'<div style="font-size:7.5pt;color:{SL8};margin-top:3mm">{origin.replace("https://","")}</div>')
    except Exception:
        shown = origin.replace("https://", "")
        return (f'<div style="font-size:11pt;font-weight:600;letter-spacing:.02em;color:{BLUE}">{shown}</div>'
                f'<div style="font-size:7.5pt;color:{SL8};margin-top:2mm">访问官网下载</div>')

def og_card(lang: str = "zh"):
    """OG 卡：文案全部来自 i18n，脚本里不留字面句子。

    此前这里写死了两句中文：一句在 i18n 里其实是 lead + emphasis 两段拼起来的，
    另一句在 i18n 里根本不存在（是编的）。现在小字取 `landing.hero.eyebrow`
    （站点上就是这个角色），主标取 `tagline_html(lang)`，两种语言都能出。
    """
    b=f'''<div style="width:1200px;height:630px;position:relative;overflow:hidden;background:radial-gradient(120% 120% at 85% 0%,#1e40af,#2563eb 52%,#0f172a)">
      <img src="{ICON}" style="position:absolute;right:-40px;bottom:-60px;width:420px;opacity:.12">
      <img src="{WM_W}" style="position:absolute;left:72px;top:64px;height:76px">
      <div style="position:absolute;left:72px;top:270px"><div style="font-size:22px;letter-spacing:6px;color:#bfdbfe">{RC.t("landing.hero.eyebrow", lang)}</div>
      <h1 style="font-size:{80 if lang=="zh" else 60}px;font-weight:800;color:#fff;margin-top:16px;letter-spacing:-1px">{RC.tagline_html(lang)}</h1></div>
    </div>'''
    return f"<!doctype html><html><head><meta charset='utf-8'><style>*{{margin:0;padding:0}}body{{font-family:{FONT}}}</style></head><body>{b}</body></html>"
def social_post(lang: str = "zh"):
    # 同样：eyebrow 与主标都取自 i18n 的同一个 key，不再自造短句
    b=f'''<div style="width:1080px;height:1080px;position:relative;overflow:hidden;background:{SUN}">
      <img src="{WM_B}" style="position:absolute;left:80px;top:80px;height:70px">
      <div style="position:absolute;left:80px;right:80px;top:560px"><div style="font-size:26px;letter-spacing:6px;color:{BLUE}">{RC.t("landing.hero.eyebrow", lang)}</div>
      <h1 style="font-size:{76 if lang=="zh" else 58}px;font-weight:800;line-height:1.25;margin-top:20px;letter-spacing:-1px">{RC.tagline_html(lang)}</h1></div>
    </div>'''
    return f"<!doctype html><html><head><meta charset='utf-8'><style>*{{margin:0;padding:0}}body{{font-family:{FONT}}}</style></head><body>{b}</body></html>"

# ---------------- 08 merch (A4 sheet, vector mockups) ----------------
def merch_sheet():
    def nb(c,label):
        return f'''<div style="text-align:center"><div style="width:150px;height:200px;border-radius:6px 10px 10px 6px;background:{c};box-shadow:0 10px 24px #0f172a22;position:relative;margin:0 auto"><div style="position:absolute;left:18px;top:34px"><img src="{WM_W}" style="height:26px"></div><div style="position:absolute;left:14px;top:0;bottom:0;width:6px;background:#ffffff22"></div></div><div style="font-size:12px;color:{SL};margin-top:10px">{label}</div></div>'''
    def mug():
        return f'''<div style="text-align:center"><div style="position:relative;margin:0 auto;width:150px;height:150px"><div style="width:120px;height:130px;border-radius:10px 10px 16px 16px;background:#fff;border:1px solid {BD};box-shadow:0 10px 24px #0f172a18;margin-left:6px"></div><div style="position:absolute;right:-14px;top:34px;width:44px;height:60px;border:12px solid #fff;border-left:0;border-radius:0 30px 30px 0;filter:drop-shadow(0 2px 2px #0f172a12)"></div><div style="position:absolute;left:24px;bottom:24px"><img src="{WM_B}" style="height:16px"></div></div><div style="font-size:12px;color:{SL};margin-top:10px">马克杯 · Ceramic Mug</div></div>'''
    def tote():
        return f'''<div style="text-align:center"><div style="width:150px;height:180px;margin:0 auto;position:relative"><div style="position:absolute;left:20px;top:0;width:110px;height:170px;background:#f1f5f9;border:1px solid {BD};border-radius:4px"></div><div style="position:absolute;left:44px;top:-22px;width:62px;height:44px;border:6px solid #e2e8f0;border-bottom:0;border-radius:16px 16px 0 0"></div><div style="position:absolute;left:44px;top:60px"><img src="{WM_B}" style="height:22px"></div></div><div style="font-size:12px;color:{SL};margin-top:10px">帆布袋 · Canvas Tote</div></div>'''
    def sticker():
        return f'''<div style="text-align:center"><div style="width:130px;height:130px;border-radius:50%;background:{BLUE};margin:0 auto;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px #2563eb44"><img src="{WM_W}" style="height:34px"></div><div style="font-size:12px;color:{SL};margin-top:10px">圆形贴纸 · Sticker</div></div>'''
    b=f'''<div style="width:794px;height:1123px;background:#fff;position:relative;padding:64px 60px">
      <img src="{WM_B}" style="height:40px"><div style="font-size:13px;letter-spacing:4px;color:{BLUE};margin-top:24px">MERCH · 品牌周边</div>
      <h1 style="font-size:40px;font-weight:800;margin-top:8px;letter-spacing:-.5px">把 heyta，带到桌面</h1>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px 30px;margin-top:56px;align-items:end">
        {nb(BLUE,"笔记本 · 蓝")}{nb("#334155","笔记本 · 石板灰")}{mug()}{tote()}
      </div>
      <div style="display:flex;justify-content:center;margin-top:56px">{sticker()}</div>
      <div style="position:absolute;left:60px;right:60px;bottom:44px;border-top:1px solid {BD};padding-top:14px;display:flex;justify-content:space-between;font-size:11px;color:{SL8}"><span>heyta · Brand Merch</span><span>hey.</span></div>
    </div>'''
    return f"<!doctype html><html><head><meta charset='utf-8'><style>*{{margin:0;padding:0}}body{{font-family:{FONT}}}</style></head><body>{b}</body></html>"

# ---------------- 10 templates (slide 16:9 + release card) ----------------
def slide_tpl():
    b=f'''<div style="width:1920px;height:1080px;background:#fff;position:relative;padding:120px">
      <img src="{WM_B}" style="position:absolute;right:120px;bottom:100px;height:56px;opacity:.9">
      <div style="position:absolute;left:120px;top:120px;width:8px;height:120px;background:{BLUE}"></div>
      <div style="position:absolute;left:160px;top:150px;font-size:30px;letter-spacing:6px;color:{BLUE}">SECTION TITLE</div>
      <h1 style="position:absolute;left:160px;top:300px;font-size:110px;font-weight:800;letter-spacing:-2px;line-height:1.1">在这里写标题</h1>
      <p style="position:absolute;left:160px;top:620px;font-size:38px;color:{SL};max-width:1300px;line-height:1.7">副标题或一句说明。保持克制：一页只说一件事，留足空白。</p>
    </div>'''
    return f"<!doctype html><html><head><meta charset='utf-8'><style>*{{margin:0;padding:0}}body{{font-family:{FONT}}}</style></head><body>{b}</body></html>"
def release_card():
    # 模板：标题与条目都写成「待填」结构，**不印虚构的功能条目** ——
    # 在模板里写死「新增专注回顾」这类具体改动，等于对外宣称一个不存在的功能。
    b=f'''<div style="width:1080px;height:1350px;background:radial-gradient(120% 90% at 80% 0%,#1e40af,#2563eb 55%,#0f172a);position:relative;padding:90px;color:#fff">
      <img src="{WM_W}" style="height:56px">
      <div style="margin-top:120px;font-size:24px;letter-spacing:6px;color:#bfdbfe">RELEASE NOTES · 更新日志</div>
      <h1 style="font-size:64px;font-weight:800;margin-top:20px">vX.Y　一句话概括这次更新</h1>
      <div style="margin-top:56px;font-size:28px;line-height:2.1;color:{RT.token("blue-100")}">· 新功能：一句话说明<br>· 改进：原来怎样，现在怎样<br>· 修复：修掉了什么问题<br>· 破坏性变更：需要用户做什么（没有就删掉这行）</div>
      <div style="position:absolute;left:90px;bottom:80px;font-size:22px;color:#93c5fd">heyta · hey.</div>
    </div>'''
    return f"<!doctype html><html><head><meta charset='utf-8'><style>*{{margin:0;padding:0}}body{{font-family:{FONT}}}</style></head><body>{b}</body></html>"

def run():
    # posters
    P=os.path.join(WD,"05-posters"); os.makedirs(P,exist_ok=True)
    # 输出后立刻核对目录：只许有这三张（各 pdf+png）。改名时旧文件必须一起删，
    # 否则目录里会同时存在新旧两版海报，图鉴里也会出现两张一样的卡。
    posters = [("01_品牌主视觉",poster1),("02_核心能力",poster2),("03_成长里程碑",poster3)]
    want = {f"{n}.{ext}" for n, _ in posters for ext in ("pdf","png")}
    have = {f for f in os.listdir(P) if not f.startswith(".")}
    if have != want:
        raise SystemExit(f"05-posters 内容与预期不符：多余 {sorted(have-want)} / 缺失 {sorted(want-have)}")
    for name,fn in posters:
        h=wr(name+".html",fn()); render.chrome_pdf(h,os.path.join(P,name+".pdf")); render.chrome_png(h,os.path.join(P,name+".png"),1123,1587,2); print("poster",name)
    # brochure
    B=os.path.join(WD,"06-brochure"); os.makedirs(B,exist_ok=True)
    h=wr("bro_front.html",brochure_front()); render.chrome_pdf(h,os.path.join(B,"heyta_brochure_front.pdf")); render.chrome_png(h,os.path.join(B,"heyta_brochure_front.png"),1123,794,2)
    h=wr("bro_back.html",brochure_back()); render.chrome_pdf(h,os.path.join(B,"heyta_brochure_back.pdf")); render.chrome_png(h,os.path.join(B,"heyta_brochure_back.png"),1123,794,2); print("brochure")
    # manual
    M=os.path.join(WD,"07-product-manual"); os.makedirs(M,exist_ok=True)
    h=wr("manual.html",manual()); render.chrome_pdf(h,os.path.join(M,"heyta_product-manual.pdf")); print("manual")
    # social
    S=os.path.join(WD,"09-social"); os.makedirs(S,exist_ok=True)
    for lang, suffix in (("zh",""),("en","-en")):
        h=wr(f"og{suffix}.html",og_card(lang))
        render.chrome_png(h,os.path.join(S,f"og-card{suffix}_1200x630.png"),1200,630,2)
    h=wr("post.html",social_post()); render.chrome_png(h,os.path.join(S,"post_1080x1080.png"),1080,1080,2); print("social")
    # 09-social / 10-templates 也逐一对上，防止改名残留（posters 已单独断言）
    for _dir, _want in (
        (S, {"og-card_1200x630.png", "og-card-en_1200x630.png", "post_1080x1080.png"}),
        (os.path.join(WD, "10-templates"), {"release-card_1080x1350.png", "slide-16x9.png"}),
    ):
        _have = {f for f in os.listdir(_dir) if not f.startswith(".") and not f.startswith("_")}
        if _have != _want:
            raise SystemExit(f"{os.path.basename(_dir)} 内容与预期不符：多余 {sorted(_have-_want)} / 缺失 {sorted(_want-_have)}")
    # merch
    G=os.path.join(WD,"08-merch"); os.makedirs(G,exist_ok=True)
    h=wr("merch.html",merch_sheet()); render.chrome_png(h,os.path.join(G,"merch-sheet.png"),794,1123,2)
    render.chrome_pdf(h,os.path.join(G,"merch-sheet.pdf")); print("merch")
    # 06-brochure / 08-merch 也必须恰好是这些文件（改名字段时旧文件要一起删）
    for _dir, _want in (
        (B, {"heyta_brochure_front.pdf", "heyta_brochure_front.png",
             "heyta_brochure_back.pdf", "heyta_brochure_back.png"}),
        (G, {"merch-sheet.pdf", "merch-sheet.png"}),
    ):
        _have = {f for f in os.listdir(_dir) if not f.startswith(".") and not f.startswith("_")}
        if _have != _want:
            raise SystemExit(f"{os.path.basename(_dir)} 内容与预期不符：多余 {sorted(_have-_want)} / 缺失 {sorted(_want-_have)}")
    # templates
    T=os.path.join(WD,"10-templates"); os.makedirs(T,exist_ok=True)
    h=wr("slide.html",slide_tpl()); render.chrome_png(h,os.path.join(T,"slide-16x9.png"),1920,1080,1)
    h=wr("release.html",release_card()); render.chrome_png(h,os.path.join(T,"release-card_1080x1350.png"),1080,1350,2); print("templates")

if __name__=="__main__": run()
