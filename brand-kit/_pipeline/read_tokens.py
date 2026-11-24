# -*- coding: utf-8 -*-
"""从 packages/design-system/src/tokens.css 读取真实色值 —— 唯一事实源。
tokens.css 有多个 :root 块（原始色阶 / 语义色 / 尺 / 动效 …），必须**合并**解析，
否则 var(--ht-blue-600) 这类跨块引用会解析成 None。"""
import re, os

WD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # brand-kit
CSS = os.path.join(os.path.dirname(WD), "packages/design-system/src/tokens.css")
_src = open(CSS, encoding="utf-8").read()

def _all_blocks():
    out = []
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', _src):
        raw_sel = m.group(1)
        sel = raw_sel.strip().split('\n')[-1].strip()
        decl = {}
        for d in re.finditer(r'(--ht-[a-z0-9-]+)\s*:\s*([^;]+);', m.group(2)):
            decl[d.group(1)] = d.group(2).strip()
        if decl:
            out.append((sel, decl))
    return out

_BLOCKS = _all_blocks()

# 亮色 = 所有以 :root 开头且不带 [ 的块，按出现顺序合并（后者覆盖前者）
LIGHT = {}
for sel, decl in _BLOCKS:
    if sel == ':root':
        LIGHT.update(decl)
# 暗色 = [data-theme='dark'] 基础块（不含 preset 组合块）
DARK = {}
for sel, decl in _BLOCKS:
    if sel.startswith("[data-theme='dark']") and 'preset' not in sel:
        DARK.update(decl)

def _resolve(name, decl, depth=0):
    v = decl.get(name)
    if v is None or depth > 8:
        return v
    m = re.fullmatch(r'var\(\s*(--ht-[a-z0-9-]+)\s*\)', v)
    if m:
        # 先在同块里找，再回到亮色全集（暗色块只写覆盖，其余继承亮色）
        if m.group(1) in decl:
            return _resolve(m.group(1), decl, depth + 1)
        if m.group(1) in LIGHT:
            return _resolve(m.group(1), LIGHT, depth + 1)
        return None
    return v

def token(name, theme="light"):
    """name 形如 'color-category-1' 或 'blue-600'（不带 --ht- 前缀）。"""
    key = "--ht-" + name
    if theme == "dark" and key in DARK:
        v = _resolve(key, DARK)
        if v and v.startswith('#'):
            return v
    return _resolve(key, LIGHT)

# ---------------- 对比度（WCAG 2.x 相对亮度） ----------------
def _srgb(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def luminance(hex6):
    h = hex6.lstrip('#')
    r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    return 0.2126 * _srgb(r) + 0.7152 * _srgb(g) + 0.0722 * _srgb(b)
def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

CATEGORY = [f"color-category-{i}" for i in range(1, 9)]

if __name__ == "__main__":
    for theme in ("light", "dark"):
        surf = token("color-surface", theme)
        print(f"[{theme}] surface={surf}")
        for c in CATEGORY:
            v = token(c, theme)
            r = contrast(v, surf) if v else 0
            flag = "OK" if r >= 3.0 else "LOW"
            print(f"  {c:20s} {v}  contrast {r:.2f}  {flag}")
        p = token("color-primary", theme)
        print(f"  primary={p} contrast {contrast(p, surf):.2f}")

# ---------------- 把生成物里的手抄色值归一到 token 取值 ----------------
import re as _re

def _reverse_map() -> dict[str, str]:
    """十六进制值 → token 名（亮色优先，同值优先语义名而不是原始色阶）。"""
    out: dict[str, str] = {}
    for k, v in LIGHT.items():
        if not isinstance(v, str) or not _re.fullmatch(r'#[0-9a-fA-F]{6}', v):
            continue
        name = k.replace('--ht-', '')
        prev = out.get(v.lower())
        # 语义名（color-*）优先于原始色阶，便于人读；其余保持先到先得
        if prev is None or (name.startswith('color-') and not prev.startswith('color-')):
            out[v.lower()] = name
    for k, v in DARK.items():
        if isinstance(v, str) and _re.fullmatch(r'#[0-9a-fA-F]{6}', v):
            out.setdefault(v.lower(), k.replace('--ht-', ''))
    return out

_REV = None

def normalize(text: str) -> str:
    """把文本里所有"等于某个 token 取值"的十六进制改写为 tokens.css 里的**当前**取值。

    为什么不是"直接换成 var()"：SVG/印刷/邮件渲染不了 CSS 变量，只能写字面量；
    但字面量必须由 token 派生，否则色板一调整，旧色就静默留在产物里。
    """
    global _REV
    if _REV is None:
        _REV = _reverse_map()
    def repl(m):
        raw = m.group(0)
        name = _REV.get(raw.lower())
        if name is None:
            return raw
        cur = token(name)
        return cur if cur else raw
    return _re.sub(r'#[0-9a-fA-F]{6}', repl, text)

# ---------------- 色差（CIE76）与二色觉模拟（Viénot 1999） ----------------
def hex_rgb(hex6: str):
    h = hex6.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

def _srgb_lin(c: float) -> float:
    v = c / 255.0
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

def _lin_srgb(v: float) -> int:
    c = max(0.0, min(1.0, v))
    return round((c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055) * 255)

def rgb_lab(rgb):
    r, g, b = (_srgb_lin(c) for c in rgb)
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    y = r * 0.2126 + g * 0.7152 + b * 0.0722
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    x, y, z = f(x), f(y), f(z)
    return (116 * y - 16, 500 * (x - y), 200 * (y - z))

def delta_e76(hex_a: str, hex_b: str) -> float:
    la, lb = rgb_lab(hex_rgb(hex_a)), rgb_lab(hex_rgb(hex_b))
    return sum((p - q) ** 2 for p, q in zip(la, lb)) ** 0.5

PROTANOPIA = ((0.11238, 0.88762, 0.0), (0.11238, 0.88762, 0.0), (0.00401, -0.00401, 1.0))
DEUTERANOPIA = ((0.29275, 0.70725, 0.0), (0.29275, 0.70725, 0.0), (-0.02234, 0.02234, 1.0))

def simulate(hex6: str, matrix) -> str:
    """线性 RGB 上乘矩阵再转回 sRGB —— 直接在 sRGB 上乘会系统性偏亮。"""
    lin = [_srgb_lin(c) for c in hex_rgb(hex6)]
    out = [_lin_srgb(sum(matrix[r][c] * lin[c] for c in range(3))) for r in range(3)]
    return "#%02x%02x%02x" % tuple(out)

def worst_pair_delta(hexes, matrix=None) -> tuple[float, str]:
    """返回（最差一对的 ΔE，描述）。matrix 给了就先做色盲模拟。"""
    vals = [simulate(h, matrix) if matrix else h for h in hexes]
    worst = (float("inf"), "")
    for i in range(len(vals)):
        for j in range(i + 1, len(vals)):
            d = delta_e76(vals[i], vals[j])
            if d < worst[0]:
                worst = (d, f"{hexes[i]}↔{hexes[j]}")
    return worst
