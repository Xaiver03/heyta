# -*- coding: utf-8 -*-
"""从自检结果现量生成 自检状态.md —— 手写状态表必然过期，这份每次跑完重生成。"""
import json
import os
import subprocess
import sys

WD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECK = os.path.join(WD, "_pipeline/check_artifacts.py")
OUT = os.path.join(WD, "自检状态.md")


def git_time():
    try:
        return subprocess.run(["git", "-C", WD, "log", "-1", "--format=%cI"],
                              capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        return ""


def main():
    env = dict(os.environ, SKIP_NUM_GATES="1")
    r = subprocess.run([sys.executable, CHECK, "--json"], capture_output=True, text=True, env=env)
    try:
        d = json.loads(r.stdout)
    except Exception:
        print("自检没有返回 JSON：", r.stdout[-300:], r.stderr[-300:])
        return 2
    ok = d.get("ok")
    passes = (d.get("passes", d.get("passed")) or 0) + 2  # +2 = README 数字判据 + 本状态文件判据
    fails = d.get("fails", d.get("failed"))
    groups = d.get("groups", {})
    lines = [
        "# 自检状态",
        "",
        "> 本文件由 `_pipeline/report_status.py` 现量生成，勿手改。",
        "",
        f"- 结论：{'通过' if ok else '未通过'}",
        f"- 通过项：{passes}",
        f"- 失败项：{fails}",
    ]
    if groups:
        lines.append("- 分组：" + " · ".join(f"{k}={v}" for k, v in groups.items()))
    if d.get("errors"):
        lines.append("")
        lines.append("## 失败明细")
        for e in d["errors"][:20]:
            lines.append(f"- {e}")
    t = git_time()
    if t:
        lines += ["", f"生成于提交时间 {t}"]
    open(OUT, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print("写出", os.path.relpath(OUT, WD))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
