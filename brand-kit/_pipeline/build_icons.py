# -*- coding: utf-8 -*-
"""heyta icon set -> brand-kit/03-icons（线性图标, 24 网格, 墨色）+ icon-sheet.html/png"""
import os, subprocess, sys
WD=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(WD,"03-icons"); os.makedirs(OUT,exist_ok=True)
INK="#0f172a"; BLUE="#2563eb"
G={}
G["book"]='<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'
G["bookmark"]='<path d="M6 3h12v18l-6-4-6 4z"/>'
G["clock"]='<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
G["calendar"]='<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/>'
G["check"]='<circle cx="12" cy="12" r="9"/><path d="M8 12l2.8 2.8L16 9"/>'
G["list"]='<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'
G["inbox"]='<path d="M3 12h5l2 3h4l2-3h5"/><path d="M4 5h16l1 12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
G["tag"]='<path d="M3 11l8-8h8v8l-8 8z"/><circle cx="16" cy="8" r="1.4" fill="CUR" stroke="none"/>'
G["search"]='<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'
G["settings"]='<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>'
G["share"]='<circle cx="6" cy="12" r="2.3"/><circle cx="18" cy="6" r="2.3"/><circle cx="18" cy="18" r="2.3"/><path d="M8.1 10.9l7.8-3.7M8.1 13.1l7.8 3.7"/>'
G["heart"]='<path d="M12 20s-7-4.4-9-8.8A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 9 4.2C19 15.6 12 20 12 20z"/>'
G["bell"]='<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'
G["star"]='<path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.4 6.2 20.5l1.1-6.5-4.7-4.6 6.5-.95z"/>'
G["plus"]='<path d="M12 5v14M5 12h14"/>'
G["trash"]='<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'
G["edit"]='<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'
G["filter"]='<path d="M3 5h18l-7 8v6l-4 2v-8z"/>'
G["folder"]='<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
G["flag"]='<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'
G["target"]='<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="CUR" stroke="none"/>'
G["sun"]='<circle cx="12" cy="12" r="4.4"/><path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7"/>'
G["moon"]='<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'
G["repeat"]='<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'
G["arrow-right"]='<path d="M5 12h14M13 6l6 6-6 6"/>'
G["home"]='<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'
for name,inner in G.items():
    svg=(f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" role="img" aria-label="{name}">'
         f'<g fill="none" stroke="{INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{inner.replace("CUR",INK)}</g></svg>')
    open(os.path.join(OUT,f"{name}.svg"),"w",encoding="utf-8").write(svg)

# icon sheet
cells="".join(f'<div class="ic"><img src="{n}.svg"><div class="nm">{n}</div></div>' for n in G)
sheet=f"""<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
@page{{size:1200px 900px;margin:0}} *{{box-sizing:border-box}}
body{{margin:0;font-family:'PingFang SC','Hiragino Sans GB',sans-serif;background:#fff;width:1200px;color:#0f172a}}
.sheet{{padding:56px 64px}}
.eyebrow{{color:#2563eb;font-weight:700;letter-spacing:.16em;font-size:13px;text-transform:uppercase}}
h1{{font-size:40px;margin:6px 0 4px;font-weight:800}} .lead{{color:#475569;font-size:15px;margin-bottom:26px}}
.grid{{display:grid;grid-template-columns:repeat(8,1fr);gap:18px}}
.ic{{border:1px solid #E2E8F0;border-radius:14px;padding:18px 8px 12px;text-align:center;background:#fff}}
.ic img{{width:34px;height:34px}} .nm{{margin-top:8px;font-size:11px;color:#64748B;font-family:'SF Mono',monospace}}
.foot{{margin-top:24px;color:#94A3B8;font-size:12px;display:flex;justify-content:space-between}}
</style></head><body><div class="sheet">
<div class="eyebrow">heyta · Brand Assets</div>
<h1>图标集 Icon Set</h1>
<div class="lead">线性图标，24 网格、1.8px 描边、圆帽圆角；语义命名，随主题取语义色。</div>
<div class="grid">{cells}</div>
<div class="foot"><span>heyta Design System · brand-kit/03-icons</span><span>{len(G)} icons</span></div>
</div></body></html>"""
open(os.path.join(OUT,"icon-sheet.html"),"w",encoding="utf-8").write(sheet)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
subprocess.run([CHROME,"--headless=new","--disable-gpu","--hide-scrollbars","--force-device-scale-factor=2",
                "--window-size=1200,900",f"--screenshot={os.path.join(OUT,'icon-sheet.png')}",
                f"file://{os.path.join(OUT,'icon-sheet.html')}"],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
print("icons:", len(G))
