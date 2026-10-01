#!/usr/bin/env python3
"""读 `uiautomator dump` 的**矩形**，而不只是中心点。

为什么必须有它（`/tmp/_xy.py` 不够用的地方）：
`_xy.py` 返回"点哪里"，而 R5 / R1 / R2 这几条判据问的是
**"这个盒子完整吗"** —— 一个中心点合法、但 `bottom` 越过屏幕底边的节点，
按坐标点下去打的是屏幕外，而 `_xy.py` 会愉快地给出坐标。

⚠️ 一条实测过的陷阱（`scripts/lib/mobile-e2e.sh` 里 `xy_edit_sane` 的注释记着）：
ScrollView 折叠线以下的节点**仍在无障碍树里**，但 `bounds` 可能是
`top > bottom`（负高度）。所以"在树里"从来不等于"看得见、点得到"，
必须读矩形。

用法（都读 `/tmp/ui.xml`）：

    ui-bounds.py desc <文本>          # content-desc 精确匹配
    ui-bounds.py text <文本>          # text 精确匹配
    ui-bounds.py sub <子串>           # text 或 content-desc 含子串
    ui-bounds.py clickable-below <y>  # 所有 clickable 且 top >= y 的节点

输出一行一个节点：`left,top,right,bottom<TAB>标签`
"""
import re
import sys

XML = "/tmp/ui.xml"


def nodes():
    with open(XML, encoding="utf-8", errors="replace") as fh:
        body = fh.read()
    for chunk in re.finditer(r"<node\b[^>]*>", body):
        tag = chunk.group(0)

        def attr(name):
            m = re.search(r'\b%s="([^"]*)"' % name, tag)
            return m.group(1) if m else ""

        bounds = re.match(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]", attr("bounds"))
        if bounds is None:
            continue
        label = attr("content-desc") or attr("text")
        yield {
            "l": int(bounds.group(1)),
            "t": int(bounds.group(2)),
            "r": int(bounds.group(3)),
            "b": int(bounds.group(4)),
            "label": label,
            "clickable": attr("clickable") == "true",
            "scrollable": attr("scrollable") == "true",
            "class": attr("class"),
        }


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    mode = sys.argv[1]
    want = sys.argv[2] if len(sys.argv) > 2 else ""

    for n in nodes():
        if mode == "desc" and n["label"] != want:
            continue
        if mode == "text" and n["label"] != want:
            continue
        if mode == "sub" and want not in n["label"]:
            continue
        if mode == "clickable-below":
            if not n["clickable"] or n["t"] < int(want):
                continue
        if mode == "scrollable":
            if not n["scrollable"]:
                continue
        print("%d,%d,%d,%d\t%s" % (n["l"], n["t"], n["r"], n["b"], n["label"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
