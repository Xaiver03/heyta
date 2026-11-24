# -*- coding: utf-8 -*-
"""heyta logo system -> brand-kit/01-logo
字标 "hey." 精确取自 apps/landing/src/components/BrandMark.tsx 的 stroke path；
图标 "h" 精确取自 packages/design-system/src/brand-mark.ts 的三条圆角矩形。
PNG 用 rsvg-convert（纯矢量字形，无字体依赖）。
"""
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
WD=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(WD,"01-logo"); TMP=os.path.join(os.path.dirname(os.path.abspath(__file__)),"_tmp")
os.makedirs(OUT,exist_ok=True); os.makedirs(TMP,exist_ok=True)

BLUE="#2563eb"; BLUE_DEEP="#1d4ed8"; INK="#0f172a"; WHITE="#ffffff"

# "hey." 字标 —— 原样来自 BrandMark.tsx
HEY_D = "M32 22V100 M32 81a19 19 0 0 1 38 0V100 M99 81h38a19 19 0 1 0-12.5 17.85 M166 62l19 34 M204 62l-19 34 M185 96q0 26-18 26"
DOT = (230,92,8)
def wordmark(fill, w=None, h=None, vb="0 0 262 144"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w or 262}" height="{h or 144}" role="img" aria-label="heyta">'
            f'<path d="{HEY_D}" fill="none" stroke="{fill}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="{DOT[0]}" cy="{DOT[1]}" r="{DOT[2]}" fill="{fill}"/></svg>')

# 图标 "h"（brand-mark.ts）
RECTS=[(140,120,52,272),(320,228,52,164),(140,228,232,48)]
def icon_svg(bg,fg,rx=112,size=512):
    rects="".join(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="22" fill="{fg}"/>' for x,y,w,h in RECTS)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 512 512" role="img" aria-label="heyta icon">'
            f'<rect width="512" height="512" rx="{rx}" fill="{bg}"/>{rects}</svg>')

# 组合锁版：图标 + 字标
def lockup_horizontal():
    IS=200; GAP=54; WMH=96
    # 字标比例 262x144
    wm_w = WMH*262/144
    W = IS+GAP+wm_w+20; H=IS
    ix=0; iy=0; wx=IS+GAP; wy=(H-WMH)/2
    rects="".join(f'<rect x="{x*IS/512:.2f}" y="{y*IS/512:.2f}" width="{w*IS/512:.2f}" height="{h*IS/512:.2f}" rx="{22*IS/512:.2f}" fill="{WHITE}"/>' for x,y,w,h in RECTS)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H}" width="{W:.0f}" height="{H}" role="img" aria-label="heyta">'
            f'<rect x="0" y="0" width="{IS}" height="{IS}" rx="{IS*112/512:.1f}" fill="{BLUE}"/>{rects}'
            f'<g transform="translate({wx:.1f} {wy:.1f}) scale({WMH/144:.5f})">{wordmark(BLUE).split(">",1)[1].rsplit("</svg>",1)[0]}</g></svg>')

def lockup_vertical():
    IS=200; GAP=44; WMH=80
    wm_w=WMH*262/144
    W=max(IS,wm_w)+40; H=IS+GAP+WMH+20
    ox=(W-IS)/2
    rects="".join(f'<rect x="{ox+x*IS/512:.2f}" y="{y*IS/512:.2f}" width="{w*IS/512:.2f}" height="{h*IS/512:.2f}" rx="{22*IS/512:.2f}" fill="{WHITE}"/>' for x,y,w,h in RECTS)
    wx=(W-wm_w)/2; wy=IS+GAP
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" width="{W:.0f}" height="{H:.0f}" role="img" aria-label="heyta">'
            f'<rect x="{ox:.1f}" y="0" width="{IS}" height="{IS}" rx="{IS*112/512:.1f}" fill="{BLUE}"/>{rects}'
            f'<g transform="translate({wx:.1f} {wy:.1f}) scale({WMH/144:.5f})">{wordmark(BLUE).split(">",1)[1].rsplit("</svg>",1)[0]}</g></svg>')

files={
 "wordmark-primary.svg": wordmark(BLUE),
 "wordmark-deep.svg": wordmark(BLUE_DEEP),
 "wordmark-ink.svg": wordmark(INK),
 "wordmark-white.svg": wordmark(WHITE),
 "app-icon.svg": icon_svg(BLUE,WHITE),
 "icon-brand.svg": icon_svg(BLUE,WHITE),
 "icon-mono-ink.svg": icon_svg(INK,WHITE),
 "icon-mono-white.svg": icon_svg(WHITE,BLUE),
 "lockup-horizontal.svg": lockup_horizontal(),
 "lockup-vertical.svg": lockup_vertical(),
}
for n,c in files.items(): open(os.path.join(OUT,n),"w",encoding="utf-8").write(c)

exports={
 "wordmark-primary.svg":[("wordmark-primary@1x.png",760),("wordmark-primary@2x.png",1520)],
 "wordmark-white.svg":[("wordmark-white@1x.png",760)],
 "wordmark-ink.svg":[("wordmark-ink@1x.png",760)],
 "app-icon.svg":[("app-icon-512.png",512),("app-icon-1024.png",1024),("app-icon-180.png",180),("app-icon-32.png",32)],
 "icon-brand.svg":[("icon-brand-512.png",512)],
 "lockup-horizontal.svg":[("lockup-horizontal@1x.png",1600)],
 "lockup-vertical.svg":[("lockup-vertical@1x.png",800)],
}
for s,outs in exports.items():
    for on,w in outs:
        subprocess.run(["rsvg-convert","-w",str(w),"-o",os.path.join(OUT,on),os.path.join(OUT,s)],check=True)
print("logo:", sorted(p.name for p in __import__("pathlib").Path(OUT).glob("*.svg")))
