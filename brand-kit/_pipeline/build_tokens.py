# -*- coding: utf-8 -*-
"""heyta 品牌 token -> 00-brand-foundation/brand-tokens.json + brand-tokens.css
色值全部取自 packages/design-system/src/tokens.css（主蓝 blue-600 #2563eb）。
"""
import json, os
WD=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # brand-kit
OUT=os.path.join(WD,"00-brand-foundation")
os.makedirs(OUT,exist_ok=True)

T = {
  "brand": "heyta",
  "wordmark": "hey.",
  "product": "本地优先、可自托管的任务管理应用",
  "tagline": {"zh":"把事情，交还给今天。", "en":"Keep today in your hands."},
  "personality": ["清晰","克制","可靠"],
  "colors": {
    "blue": {"50":"#eff6ff","100":"#dbeafe","200":"#bfdbfe","300":"#93c5fd","400":"#60a5fa",
             "500":"#3b82f6","600":"#2563eb","700":"#1d4ed8","800":"#1e40af","900":"#1e3a8a"},
    "slate": {"white":"#FFFFFF","50":"#f8fafc","100":"#f1f5f9","200":"#e2e8f0","300":"#cbd5e1",
              "400":"#94a3b8","500":"#64748b","600":"#475569","700":"#334155","800":"#1e293b",
              "900":"#0f172a","950":"#020617"},
    "feedback": {"success":"#059669","warning":"#d97706","danger":"#dc2626","info":"#0284c7",
                 "success-soft":"#ecfdf5","warning-soft":"#fffbeb","danger-soft":"#fef2f2","info-soft":"#eff6ff"},
    "surface": {"paper":"#ffffff","sunken":"#f8fafc","ink":"#0f172a"}
  },
  "semantic": {
    "primary":"#2563eb","on-primary":"#ffffff","primary-hover":"#1d4ed8",
    "foreground":"#0f172a","foreground-muted":"#475569","border":"#e2e8f0"
  },
  "typography": {
    "sans": "'PingFang SC','Hiragino Sans GB','Noto Sans CJK SC',sans-serif",
    "mono": "'SF Mono','JetBrains Mono',ui-monospace,monospace"
  },
  "milestone": {"checkIns":"#2563eb","focusHours":"#4f46e5","tasks":"#059669","activeDays":"#d97706"}
}
json.dump(T, open(os.path.join(OUT,"brand-tokens.json"),"w",encoding="utf-8"), ensure_ascii=False, indent=2)

lines=["/* heyta brand tokens —— 取自 packages/design-system/src/tokens.css */",":root{"]
for fam in ("blue","slate"):
    for k,v in T["colors"][fam].items(): lines.append(f"  --hk-{fam}-{k}: {v};")
for k,v in T["colors"]["feedback"].items(): lines.append(f"  --hk-feedback-{k}: {v};")
for k,v in T["semantic"].items(): lines.append(f"  --hk-{k}: {v};")
for k,v in T["milestone"].items(): lines.append(f"  --hk-milestone-{k}: {v};")
lines.append("}")
open(os.path.join(OUT,"brand-tokens.css"),"w",encoding="utf-8").write("\n".join(lines)+"\n")
print("tokens written")
