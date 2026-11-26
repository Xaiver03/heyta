# -*- coding: utf-8 -*-
"""把 4:5 数字版图鉴（1200×1500）另出一版 **A4 印刷版**。

原版按设计稿尺寸出，供屏幕浏览；交印厂要的是 A4。这里不重排版：
把同一份 HTML 的内容按比例缩到 A4 版心内（zoom），再按 A4 纸型打印。
两版并存，互不替换。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render

WD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(WD, "02-badges/badge-catalogue.html")
OUT = os.path.join(WD, "02-badges/badge-catalogue-A4.pdf")
TMP = os.path.join(WD, "02-badges/_catalogue_a4.html")

# 版心：A4 210×297mm，四周 8mm 边距 → 194×281mm ≈ 733×1062px(96dpi)
ZOOM = 733 / 1200.0

def main() -> int:
    html = open(SRC, encoding="utf-8").read()
    override = f"""<style>
@page{{size:210mm 297mm;margin:8mm}}
html,body{{margin:0;padding:0;width:auto;background:#fff}}
body{{zoom:{ZOOM:.4f}}}
.sheet{{padding:0}}
</style></head>"""
    html = html.replace("</head>", override, 1)
    open(TMP, "w", encoding="utf-8").write(html)
    ok, err = render.chrome_pdf(TMP, OUT)
    os.remove(TMP)
    if not ok:
        print("渲染失败：", err)
        return 1
    print("写出", os.path.relpath(OUT, WD), os.path.getsize(OUT), "bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
