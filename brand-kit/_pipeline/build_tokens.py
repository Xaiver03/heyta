# -*- coding: utf-8 -*-
"""heyta 品牌 token -> 00-brand-foundation/brand-tokens.json + brand-tokens.css
色值全部取自 packages/design-system/src/tokens.css（主蓝 blue-600 #2563eb）。
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import read_copy as RC
import read_tokens as RT
WD=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # brand-kit
OUT=os.path.join(WD,"00-brand-foundation")
os.makedirs(OUT,exist_ok=True)

T = {
  "brand": "heyta",
  "wordmark": "hey.",
  "product": "本地优先、可自托管的任务管理应用",
  "tagline": {"zh": RC.tagline_html("zh") + "。", "en": RC.tagline_html("en")},
  "personality": ["清晰","克制","可靠"],
  # 色值一律由 tokens.css 派生，本表不写字面量（否则就是第二个事实源）。
  "colors": {
    "blue": {str(n): RT.token(f"blue-{n}") for n in (50,100,200,300,400,500,600,700,800,900)},
    "slate": {**{"white": RT.token("white")},
              **{str(n): RT.token(f"slate-{n}") for n in (50,100,200,300,400,500,600,700,800,900,950)}},
    "feedback": {"success": RT.token("color-success"), "warning": RT.token("color-warning"),
                 "danger": RT.token("color-danger"), "info": RT.token("color-info"),
                 "success-soft": RT.token("emerald-50"), "warning-soft": RT.token("amber-50"),
                 "danger-soft": RT.token("red-50"), "info-soft": RT.token("blue-50")},
    "surface": {"paper": RT.token("color-surface"), "sunken": RT.token("color-surface-sunken"),
                "ink": RT.token("color-foreground")}
  },
  "semantic": {
    "primary": RT.token("color-primary"), "on-primary": RT.token("white"),
    "primary-hover": RT.token("color-primary-hover"),
    "foreground": RT.token("color-foreground"), "foreground-muted": RT.token("color-foreground-muted"),
    "border": RT.token("color-border")
  },
  "typography": {
    "sans": "'PingFang SC','Hiragino Sans GB','Noto Sans CJK SC',sans-serif",
    "mono": "'SF Mono','JetBrains Mono',ui-monospace,monospace"
  },
  "milestone": {"checkIns": RT.token("color-milestone-checkin"), "focusHours": RT.token("color-milestone-focus"),
               "tasks": RT.token("color-milestone-tasks"), "activeDays": RT.token("color-milestone-days")}
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
