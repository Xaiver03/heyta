#!/usr/bin/env python3
"""从 `idb ui describe-all` 的 JSON 里，按**精确标签**找一个元素并算出它的中心点。

为什么需要这个文件
==================

`idb ui tap <标签>` / `describe <标签>` 是**子串匹配**，而这在 heyta 的界面上会撞车。
实测：marker 传「访问令牌」，命中的是那段**说明文字**——

    明文连接（本机/局域网）。任务内容是端到端加密的，但**访问令牌**会以明文经过网络…

而真正的输入框就在下面几行。子串匹配挑中了先出现的那个，于是"点令牌输入框"
会点到一段静态文字上，**不报错、界面没反应**，看起来像"点了没生效"。

所以定位一律走这里：自己解析 `describe-all` 的结果，**精确比标签**，
并按角色 / 是否可输入把候选收窄。

用法
====

    idb-find.py <dump.json> field <标签>        # 找该标签的输入框，输出 "x y"
    idb-find.py <dump.json> label <标签>        # 找该标签的任意元素（优先可点的），输出 "x y"
    idb-find.py <dump.json> value <标签>        # 输出该标签输入框的当前值
    idb-find.py <dump.json> enabled <标签>      # 该元素是否可用，输出 "true"/"false"
    idb-find.py <dump.json> has <文本>          # 界面里有没有出现这个文本（精确标签或值）
    idb-find.py <dump.json> texts              # 列出所有可见文本，每行一条

退出码：0 = 找到；1 = 没找到；2 = 用法/读不出 JSON。
🔴 1 与 2 必须分得开 —— "界面上没有"和"探针自己坏了"要能区分（AGENTS §7 第 35 条）。
"""

import json
import sys


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"读不出 dump JSON: {e}", file=sys.stderr)
        sys.exit(2)
    if isinstance(data, dict):
        data = [data]
    return [e for e in data if isinstance(e, dict)]


def label_of(e):
    return (e.get("AXLabel") or "").strip()


def center(e):
    f = e.get("frame") or {}
    return f.get("x"), f.get("y"), f.get("width"), f.get("height")


def is_field(e):
    # idb 把输入框报成 AXTextField / AXSecureTextField；SecureTextField 的值是掩码
    return (e.get("role") or "") in ("AXTextField", "AXSecureTextField")


def flat_label_row(e):
    """输入框上方的**标题**（AXStaticText）与输入框本身同标签。

    所以「找标签完全相等的元素」会拿到两个：标题和框。要框就得加角色约束。
    """
    return (e.get("role") or "") == "AXStaticText" and not (e.get("AXValue") or "")


def main():
    if len(sys.argv) < 3:
        print(__doc__.strip(), file=sys.stderr)
        sys.exit(2)
    dump, mode = sys.argv[1], sys.argv[2]
    els = load(dump)

    if mode == "texts":
        for e in els:
            t = label_of(e)
            v = (e.get("AXValue") or "").strip()
            if t:
                print(t)
            if v and v != t:
                print(v)
        sys.exit(0)

    if len(sys.argv) < 4:
        print("缺标签参数", file=sys.stderr)
        sys.exit(2)
    want = sys.argv[3].strip()

    if mode == "field":
        # **精确相等**，且必须是输入框
        hits = [e for e in els if label_of(e) == want and is_field(e)]
        if not hits:
            sys.exit(1)
        x, y, w, h = center(hits[0])
        if None in (x, y, w, h) or w <= 0 or h <= 0:
            sys.exit(1)
        print(f"{int(x + w / 2)} {int(y + h / 2)}")
        sys.exit(0)

    if mode == "value":
        hits = [e for e in els if label_of(e) == want and is_field(e)]
        if not hits:
            sys.exit(1)
        print(hits[0].get("AXValue") or "")
        sys.exit(0)

    if mode == "label":
        # 精确相等优先；有多个时优先"可点的"（有 frame 且尺寸够触摸目标）
        hits = [e for e in els if label_of(e) == want]
        if not hits:
            sys.exit(1)
        ok = [e for e in hits if (e.get("frame") or {}).get("height", 0) >= 30]
        pick = (ok or hits)[0]
        x, y, w, h = center(pick)
        if None in (x, y, w, h) or w <= 0 or h <= 0:
            sys.exit(1)
        print(f"{int(x + w / 2)} {int(y + h / 2)}")
        sys.exit(0)

    if mode == "enabled":
        # 只认**精确标签**，并且优先取尺寸够触摸目标的那个（按钮本体，不是它上方的标题）。
        # 🔴 enabled 必须是机器可读的：拿它当"凭据有没有真的进去"的判据，
        #    比"按钮在不在"强 —— idle 的按钮**一直都在**，只是按不动。
        hits = [e for e in els if label_of(e) == want]
        if not hits:
            sys.exit(1)
        ok = [e for e in hits if (e.get("frame") or {}).get("height", 0) >= 30]
        pick = (ok or hits)[0]
        print("true" if pick.get("enabled") else "false")
        sys.exit(0)

    if mode == "has":
        for e in els:
            if label_of(e) == want:
                sys.exit(0)
            v = (e.get("AXValue") or "").strip()
            if v == want or (want and want in v):
                sys.exit(0)
        sys.exit(1)

    print(f"未知模式: {mode}", file=sys.stderr)
    sys.exit(2)


if __name__ == "__main__":
    main()
