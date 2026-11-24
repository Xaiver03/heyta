# -*- coding: utf-8 -*-
"""Chrome 渲染 helper：HTML/SVG -> PDF / PNG"""
import os, subprocess, shutil

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

def chrome_pdf(html_path, out_pdf, width_mm=None, height_mm=None):
    os.makedirs(os.path.dirname(out_pdf), exist_ok=True)
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
           "--no-sandbox", f"--print-to-pdf={out_pdf}", "file://"+os.path.abspath(html_path)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    ok = os.path.exists(out_pdf) and os.path.getsize(out_pdf) > 800
    return ok, r.stderr[-400:]

def chrome_png(html_path, out_png, w, h, scale=2):
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    tmp = out_png + ".tmp.png"
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
           "--no-sandbox", f"--force-device-scale-factor={scale}",
           f"--window-size={w},{h}", f"--screenshot={tmp}",
           "file://"+os.path.abspath(html_path)]
    subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if os.path.exists(tmp):
        shutil.move(tmp, out_png)
        return os.path.getsize(out_png) > 800
    return False

def svg_to_png_via_chrome(svg_path, out_png, w, h, scale=2, bg="transparent"):
    """把 svg 包进 html 再截图"""
    tmpdir = os.path.dirname(os.path.abspath(out_png))
    os.makedirs(tmpdir, exist_ok=True)
    wrap = os.path.join(tmpdir, "_wrap_"+os.path.basename(out_png)+".html")
    with open(wrap, "w", encoding="utf-8") as f:
        f.write(f'<!doctype html><html><head><meta charset="utf-8"><style>html,body{{margin:0;padding:0;'
                f'background:{bg};}} img{{display:block;width:{w}px;height:{h}px}}</style></head>'
                f'<body><img src="file://{os.path.abspath(svg_path)}"></body></html>')
    return chrome_png(wrap, out_png, w, h, scale)
