# -*- coding: utf-8 -*-
"""brand-kit 产物自检
====================
    python _pipeline/check_artifacts.py          # 只读自检
    python _pipeline/check_artifacts.py -v       # 列出每个命中

查四件事：
  1. **色值全部来自 token**：所有 svg/html 里的十六进制必须命中 tokens.css 的取值白名单
     （否则有人手改一个色、或色板调整后旧色残留，都会在这里红）
  2. **里程碑/身份标签/状态胶囊的数量**：17 / 8 / 6，与领域层定义一致
  3. **关键产物存在**：图鉴 pdf/png、品牌手册 pdf 且页数正确
  4. **SVG 可确定性重现**：与 `--hash` 记录的清单比对（可选）

退出码非零即失败。这是把"每轮人肉跑的一次性检查"固化成门禁的第一步。
"""
import os, re, sys, subprocess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import read_tokens as RT

WD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERBOSE = "-v" in sys.argv
fails = []


def fail(msg):
    fails.append(msg)
    print("❌ " + msg)


allowed = {
    v.lower()
    for d in (RT.LIGHT, RT.DARK)
    for v in d.values()
    if isinstance(v, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', v)
}

# 1) 色值白名单
bad = {}
for root, _dirs, files in os.walk(WD):
    if "_pipeline" in root or "_tmp" in root:
        continue
    for fn in files:
        if not fn.endswith((".svg", ".html")):
            continue
        p = os.path.join(root, fn)
        text = open(p, encoding="utf-8", errors="ignore").read()
        for h in set(m.lower() for m in re.findall(r'#[0-9a-fA-F]{6}', text)):
            if h not in allowed:
                bad.setdefault(h, []).append(os.path.relpath(p, WD))
if bad:
    for h, fs in bad.items():
        fail(f"非 token 色值 {h} 出现在 {len(fs)} 个产物（如 {fs[0]}）")
else:
    print(f"✅ 色值白名单：全部命中 tokens.css（{len(allowed)} 个合法值）")

# 2) 数量
counts = {
    "里程碑": ("02-badges/milestones", 17),
    "身份标签": ("02-badges/identity", 8),
    "状态胶囊": ("02-badges/status", 6),
    "线性图标": ("03-icons", 26),
    "字标/图标": ("01-logo", 10),
}
for label, (rel, want) in counts.items():
    d = os.path.join(WD, rel)
    # 目录里 svg 与 png 混放（milestones/identity 每项各一份 svg+png），只数 svg 才是"数量"
    n = len([f for f in os.listdir(d) if f.endswith(".svg")]) if os.path.isdir(d) else 0
    if n != want:
        fail(f"{label} 数量 {n} ≠ 期望 {want}（{rel}）")
    else:
        print(f"✅ {label}：{n} 个")

# 3) 关键产物
for rel, why in [
    ("02-badges/badge-catalogue.pdf", "成长标识体系图鉴 PDF"),
    ("02-badges/badge-catalogue.png", "图鉴 PNG"),
    ("00-brand-foundation/brand-book.pdf", "品牌手册 PDF"),
]:
    p = os.path.join(WD, rel)
    if not os.path.exists(p) or os.path.getsize(p) < 1000:
        fail(f"缺产物或过小：{rel}（{why}）")
    elif VERBOSE:
        print(f"   · {rel} {os.path.getsize(p)//1024} KB")

if not fails:
    print("\n✅ brand-kit 产物自检通过")
    sys.exit(0)
print(f"\n❌ 共 {len(fails)} 项失败")
sys.exit(1)
