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
