# -*- coding: utf-8 -*-
"""heyta logo system -> brand-kit/01-logo
字标 "hey." 精确取自 apps/landing/src/components/BrandMark.tsx 的 stroke path；
图标 "h" 精确取自 packages/design-system/src/brand-mark.ts 的三条圆角矩形。
PNG 用 rsvg-convert（纯矢量字形，无字体依赖）。
"""
import os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import read_tokens as RT
from PIL import Image
WD=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(WD,"01-logo"); TMP=os.path.join(os.path.dirname(os.path.abspath(__file__)),"_tmp")
os.makedirs(OUT,exist_ok=True); os.makedirs(TMP,exist_ok=True)

BLUE=RT.token("blue-600"); BLUE_DEEP=RT.token("blue-700")
INK=RT.token("slate-900"); WHITE="#ffffff"

# ── 几何：**从源码读**，不在本文件写第二份 ─────────────────────────────
# 字标「hey.」的唯一事实源是 apps/landing/src/components/BrandMark.tsx；
# 「h」图标的唯一事实源是 packages/design-system/src/brand-mark.ts。
# 手抄一份的代价是：源码改了字标，品牌套件会**静默**继续输出旧字形，
# 而两边看起来都"正常"。所以这里用正则抽取，取不到就**报错停下**。
def n(v):
    """数值转字符串：整数值不带 .0，保持输出稳定（重构前后逐字节可比）。"""
    f = float(v)
    return str(int(f)) if f == int(f) else ("%g" % f)

_ROOT = os.path.dirname(WD)

def _pick(text, pattern, why):
    m = re.search(pattern, text)
    if m is None:
        raise SystemExit(f"✗ 取不到{why} —— 上游几何变了而 build_logo.py 没跟上，请先修这里。")
    return m

_mark = open(os.path.join(_ROOT, "apps/landing/src/components/BrandMark.tsx"), encoding="utf-8").read()
HEY_D = _pick(_mark, r'\bd="([^"]+)"', "字标 path d").group(1)
WM_STROKE = _pick(_mark, r'strokeWidth=\{([0-9.]+)\}', "字标描边宽度").group(1)
WM_VB = _pick(_mark, r'viewBox="([^"]+)"', "字标 viewBox").group(1)
DOT = (
    float(_pick(_mark, r'<circle cx=\{([0-9.]+)\}', "句点 cx").group(1)),
    float(_pick(_mark, r'cy=\{([0-9.]+)\}', "句点 cy").group(1)),
    float(_pick(_mark, r'\br=\{([0-9.]+)\}', "句点半径").group(1)),
)

_icon = open(os.path.join(_ROOT, "packages/design-system/src/brand-mark.ts"), encoding="utf-8").read()
_bars = _pick(_icon, r"GLYPH_BARS\s*=\s*\[([\s\S]*?)\]", "GLYPH_BARS").group(1)
RECTS = [
    tuple(float(v) for v in m)
    for m in re.findall(r"\{\s*x:\s*([\d.]+),\s*y:\s*([\d.]+),\s*width:\s*([\d.]+),\s*height:\s*([\d.]+)", _bars)
]
if len(RECTS) != 3:
    raise SystemExit(f"✗ GLYPH_BARS 解析出 {len(RECTS)} 条（应为 3）—— 上游结构变了。")
GLYPH_RADIUS = float(_pick(_icon, r"GLYPH_RADIUS\s*=\s*([\d.]+)", "GLYPH_RADIUS").group(1))
MARK_RADIUS = float(_pick(_icon, r"BRAND_MARK_RADIUS\s*=\s*([\d.]+)", "BRAND_MARK_RADIUS").group(1))
MARK_CANVAS = float(_pick(_icon, r"BRAND_MARK_CANVAS\s*=\s*([\d.]+)", "BRAND_MARK_CANVAS").group(1))
def wordmark(fill, w=None, h=None, vb=None):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb or WM_VB}" width="{w or 262}" height="{h or 144}" role="img" aria-label="heyta">'
            f'<path d="{HEY_D}" fill="none" stroke="{fill}" stroke-width="{WM_STROKE}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="{n(DOT[0])}" cy="{n(DOT[1])}" r="{n(DOT[2])}" fill="{fill}"/></svg>')

# 图标 "h"：RECTS / GLYPH_RADIUS / MARK_RADIUS 已在文件头从 brand-mark.ts 读出
def icon_svg(bg,fg,rx=None,size=512):
    rects="".join(f'<rect x="{n(x)}" y="{n(y)}" width="{n(w)}" height="{n(h)}" rx="{n(GLYPH_RADIUS)}" fill="{fg}"/>' for x,y,w,h in RECTS)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 512 512" role="img" aria-label="heyta icon">'
            f'<rect width="512" height="512" rx="{n(rx if rx is not None else MARK_RADIUS)}" fill="{bg}"/>{rects}</svg>')

# 组合锁版：图标 + 字标
def lockup_horizontal():
    IS=200; GAP=54; WMH=96
    # 字标比例 262x144
    wm_w = WMH*262/144
    W = IS+GAP+wm_w+20; H=IS
    ix=0; iy=0; wx=IS+GAP; wy=(H-WMH)/2
    rects="".join(f'<rect x="{x*IS/MARK_CANVAS:.2f}" y="{y*IS/MARK_CANVAS:.2f}" width="{w*IS/MARK_CANVAS:.2f}" height="{h*IS/MARK_CANVAS:.2f}" rx="{GLYPH_RADIUS*IS/MARK_CANVAS:.2f}" fill="{WHITE}"/>' for x,y,w,h in RECTS)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H}" width="{W:.0f}" height="{H}" role="img" aria-label="heyta">'
            f'<rect x="0" y="0" width="{IS}" height="{IS}" rx="{IS*MARK_RADIUS/MARK_CANVAS:.1f}" fill="{BLUE}"/>{rects}'
            f'<g transform="translate({wx:.1f} {wy:.1f}) scale({WMH/144:.5f})">{wordmark(BLUE).split(">",1)[1].rsplit("</svg>",1)[0]}</g></svg>')

def lockup_vertical():
    IS=200; GAP=44; WMH=80
    wm_w=WMH*262/144
    W=max(IS,wm_w)+40; H=IS+GAP+WMH+20
    ox=(W-IS)/2
    rects="".join(f'<rect x="{ox+x*IS/MARK_CANVAS:.2f}" y="{y*IS/MARK_CANVAS:.2f}" width="{w*IS/MARK_CANVAS:.2f}" height="{h*IS/MARK_CANVAS:.2f}" rx="{GLYPH_RADIUS*IS/MARK_CANVAS:.2f}" fill="{WHITE}"/>' for x,y,w,h in RECTS)
    wx=(W-wm_w)/2; wy=IS+GAP
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" width="{W:.0f}" height="{H:.0f}" role="img" aria-label="heyta">'
            f'<rect x="{ox:.1f}" y="0" width="{IS}" height="{IS}" rx="{IS*MARK_RADIUS/MARK_CANVAS:.1f}" fill="{BLUE}"/>{rects}'
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
 "wordmark-deep.svg":[("wordmark-deep@1x.png",760)],
 "app-icon.svg":[("app-icon-512.png",512),("app-icon-1024.png",1024),("app-icon-180.png",180),("app-icon-32.png",32)],
 "icon-brand.svg":[("icon-brand-512.png",512)],
 "lockup-horizontal.svg":[("lockup-horizontal@1x.png",1600)],
 "lockup-vertical.svg":[("lockup-vertical@1x.png",800)],
}
for s,outs in exports.items():
    for on,w in outs:
        subprocess.run(["rsvg-convert","-w",str(w),"-o",os.path.join(OUT,on),os.path.join(OUT,s)],check=True)
print("logo:", sorted(p.name for p in __import__("pathlib").Path(OUT).glob("*.svg")))
