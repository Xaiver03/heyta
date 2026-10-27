"""端到端：合成手写笔画 → potrace 矢量化 → 编译 TTF → 用 Pillow 渲回来对照。"""
import math, re, subprocess
from PIL import Image, ImageDraw, ImageFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path

W, H, BASE_PX, STROKE = 900, 1100, 780, 38
img = Image.new("L", (W, H), 255)
d = ImageDraw.Draw(img)

def stroke(points, w=STROKE):
    d.line(points, fill=0, width=w, joint="curve")
    for p in (points[0], points[-1]):
        d.ellipse([p[0]-w/2, p[1]-w/2, p[0]+w/2, p[1]+w/2], fill=0)

R, CY = 150, 300 + 150
arc = [(300 + R*(1-math.cos(t)), CY + R*math.sin(t)) for t in (i*math.pi/90 for i in range(0, 91))]
stroke(arc)
stroke([(300, 300), (300, BASE_PX)])
stroke([(450, CY), (450, BASE_PX)])
img.save("stroke.pgm")

subprocess.run(["potrace", "--svg", "-o", "stroke.svg", "--turdsize", "4", "stroke.pgm"], check=True)
svg = open("stroke.svg").read()
dpath = re.search(r'<path[^>]*\sd="([^"]+)"', svg).group(1)
tx, ty, sx, sy = 0.0, 0.0, 1.0, 1.0
tm = re.search(r'transform="translate\(([-\d.]+)[ ,]+([-\d.]+)\)\s*scale\(([-\d.]+)[ ,]+([-\d.]+)\)"', svg)
if tm:
    tx, ty, sx, sy = (float(v) for v in tm.groups())
print(f"potrace transform: translate({tx},{ty}) scale({sx},{sy})")

rec = RecordingPen(); parse_path(dpath, rec)
px = RecordingPen(); rec.replay(TransformPen(px, (sx, 0, 0, sy, tx, ty)))   # → 像素, y 向下
bp = BoundsPen(None); px.replay(bp)
x0, y0, x1, y1 = bp.bounds
print(f"bounds(px, y-down): ({x0:.1f},{y0:.1f})-({x1:.1f},{y1:.1f})")

UPM, XHEIGHT, LSB, RSB = 1000, 520, 50, 50
sc = XHEIGHT / (y1 - y0)
adv = round((x1 - x0) * sc + LSB + RSB)

tg = TTGlyphPen(None)
pen = Cu2QuPen(tg, max_err=1.0)   # potrace 给三次曲线，TTF 要二次曲线
px.replay(TransformPen(pen, (sc, 0, 0, -sc, LSB - x0 * sc, BASE_PX * sc)))
glyphs = {".notdef": TTGlyphPen(None).glyph(), "n": tg.glyph(), "space": TTGlyphPen(None).glyph()}
fb = FontBuilder(UPM, isTTF=True)
fb.setupGlyphOrder(list(glyphs))
fb.setupCharacterMap({0x6E: "n", 0x20: "space"})
fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics({".notdef": (600, 0), "n": (adv, LSB), "space": (260, 0)})
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupNameTable({"familyName": "TraceDemo", "styleName": "Regular",
                   "psName": "TraceDemo-Regular", "fullName": "TraceDemo Regular"})
fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200, sxHeight=XHEIGHT)
fb.setupPost()
fb.save("TraceDemo.ttf")
print(f"advance={adv} units  glyph_height={round((y1-y0)*sc)}  stroke={round(STROKE*sc)}")

out = Image.new("L", (W, H), 255)
ImageDraw.Draw(out).text((60, BASE_PX), "nnn", font=ImageFont.truetype("TraceDemo.ttf", 460), fill=0, anchor="ls")
combo = Image.new("L", (W*2 + 40, H), 200)
combo.paste(img, (0, 0)); combo.paste(out, (W + 40, 0))
combo.convert("RGB").resize((combo.width//2, combo.height//2)).save("compare.png")
print("wrote compare.png")
