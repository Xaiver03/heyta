#!/usr/bin/env python3
"""把「台账点名的取证原件，盘上到底还在不在」从一句散文变成一枚能红的尺。

为什么需要：本线的证据件住在 `~/.heyta-evidence/…`——**仓外、本机、不受 git 管**。台账与交接书写了几十处
「原件 `<那条路径>`」，而仓里那两把文档尺（`pnpm check:docs`、`verify-inbound-doc-tables.py`）只看得到仓内路径，
**仓外那一层一根都查不到** ⇒ 一份被清走的原件在文档里永远"看起来还在"。

2026-10-20 01:3x 首量：本线 5 份台账里抽出 314 枚点名（**这一行的数会随台账追加漂** ⇒ 现量看输出的第一行
`点名总数=…　逐字=…　花括号=…　通配=…　目录=…　命令落点=…　截断=…`，六档相加须等于总数），
其中一枚存在声称（`gate-0458.txt`，10-18 04:5x 那趟合批日志）
盘上已回读不到。那条的**读数本身**已被同日更晚的同命令重跑取代 ⇒ 结论没丢，丢的只是回证件，
所以逐枚登记进 `KNOWN_DEAD`（带出处与"为什么不重取"），**新增一枚缺失就红**。
登记判据的键是 **(台账, 点名)** 不是裸路径 ⇒ 同一路径在两份台账各点名一次，两处都要登记；
结论行分开口径打「点名=%d 处（去重后 %d 枚路径）」，就是为了让"登记吞掉没登记的那处"当场看得见（臂8 / 臂8b）。

六档（R2：每枚点名落进恰好一档，六档相加＝总数）：
  逐字 / 花括号展开 / 目录 / 通配　→ **验盘**：不存在就红（通配要 `glob` 至少命中一枚，目录要求路径在盘上）。
  命令落点（串里带 `$`，或前面那串是 `>`、`>>`、`--ev` 这类输出重定向）→ **不验**：那是给人重跑的命令目标，不是存在声称。
  截断/前缀（含 `…`，或以 `-`、`_` 收尾——文档写的是路径前缀再接中文说明）→ **不验**，但可逐枚打印，不许静默。

规矩：
  R1 分母非空：抽到 0 枚就是抽取瞎了，红。
  R2 六档相加＝抽取总数：差一枚说明有点名没进任何一档。
  R3 命令落点那一形**不许进存在判定**（否则每条"给人重跑的命令"都被报成死指针）。
  R4 验盘四档缺失 ⇒ 红且逐枚点名。

臂（`--self-test`，只在临时目录造样本，不碰仓、不碰真证据目录）：
  臂1 逐字指向不存在的文件 ⇒ 红且点名它。
  臂2 同一形状改成刚造出来的文件 ⇒ 绿（证明臂1 的红来自"缺失"而不是"抽法"）。
  臂3 通配零命中 ⇒ 红；臂3b 同档改成有命中 ⇒ 绿。
  臂4 花括号展开里缺的那一枚仍要被点名。
  臂5 带 `$` 的命令落点 ⇒ 不验（绿）。
  臂6 不带 `$`、但前面是 `>` 重定向的输出落点 ⇒ 不验（绿）。
  臂7 目录档缺失 ⇒ 红。
  臂8 同一路径两份台账各点名一次、两处都登记 ⇒ 绿，且结论行必须同时打「点名=2 处」和「去重后 1 枚路径」
      （只比 rc 的话，这一臂证明不了打印层的口径；8b 才是要害）。
  臂8b 同一路径只登记一份 ⇒ 另一份必须红并点名它（证明登记表按 (台账, 点名) 吞，不按裸路径吞）。
"""
import argparse
import glob
import io
import os
import re
import sys
import tempfile

DEFAULT_PATTERN = r'~/\.heyta-evidence/[^\s`、，。）】>|"' + "'" + r'<>]*'
CUT = '.,;:!?)】>"\'<`'
CTX = 12

KNOWN_DEAD = [
    ("PROGRESS.md", "~/.heyta-evidence/inb-t7-1017-0902/gate-0458.txt",
     "10-18 04:5x 那趟三枚文档门的合批日志；完成条件 2 后来在 10-20 00:35 与交付 tip 各重跑过一次（读数不依赖原件）"),
]

REDIRECT = re.compile(r'(?:>>?\s*(?:~/[^\s`]*)?|--ev\s*)$')
KINDS = ("逐字", "花括号展开", "通配", "目录", "命令落点", "截断/前缀")
VERIFIED = ("逐字", "花括号展开", "通配", "目录")


def find_cites(text, pattern):
    """返回 [(点名, 前面 CTX 个字符)]。前一串用来分「命令落点」与「已存在的原件」：
    同一个路径形状在 `cmd > ~/ev/x.txt` 里是命令目标，在「原件 `~/ev/x.txt`」里才是存在声称。"""
    out = []
    for m in re.finditer(pattern, text):
        s = m.group(0).split()[0].rstrip(CUT)
        if s:
            out.append((s, text[max(0, m.start() - CTX):m.start()]))
    return out


def _expand_all(p):
    m = re.search(r'\{([^{}]*)\}', p)
    if not m:
        return [p]
    res = []
    for x in m.group(1).split(","):
        res.extend(_expand_all(p[:m.start()] + x + p[m.end():]))
    return res


def classify(c, ctx=""):
    if "$" in c or REDIRECT.search(ctx or ""):
        return "命令落点", []
    if "{" in c and "}" in c:
        return "花括号展开", [os.path.expanduser(x) for x in _expand_all(c)]
    if "*" in c or "?" in c:
        return "通配", [os.path.expanduser(c)]
    if c.endswith("/"):
        return "目录", [os.path.expanduser(c)]
    if "…" in c or c.endswith(("-", "_")):
        return "截断/前缀", []
    return "逐字", [os.path.expanduser(c)]


def audit(docs, root, pattern, known_dead):
    buckets = {k: [] for k in KINDS}
    raw = []
    for d in docs:
        path = os.path.join(root, d)
        if not os.path.isfile(path):
            return 1, ["❌ 台账文件不在：%s" % d], buckets
        for c, ctx in find_cites(io.open(path, encoding="utf-8").read(), pattern):
            raw.append((d, c, ctx))
    for d, c, ctx in raw:
        kind, musts = classify(c, ctx)
        buckets[kind].append((d, c, musts))
    lines = ["点名总数=%d　逐字=%d　花括号=%d　通配=%d　目录=%d　命令落点=%d　截断=%d"
             % (len(raw), len(buckets["逐字"]), len(buckets["花括号展开"]), len(buckets["通配"]),
                len(buckets["目录"]), len(buckets["命令落点"]), len(buckets["截断/前缀"]))]
    if not raw:
        return 1, lines + ["❌ R1 分母为 0：抽取没拿到任何点名 ⇒ 这把尺现在是瞎的"], buckets
    s = sum(len(v) for v in buckets.values())
    if s != len(raw):
        return 1, lines + ["❌ R2 六档相加=%d ≠ 总数=%d ⇒ 有点名根本没进任何一档" % (s, len(raw))], buckets
    dead = 0
    dead_paths = set()
    bad = []
    for key in VERIFIED:
        for d, c, musts in buckets[key]:
            for p in musts:
                missing = (not glob.glob(p)) if key == "通配" else (not os.path.exists(p))
                if not missing:
                    continue
                if (d, c) in known_dead:
                    dead += 1
                    dead_paths.add(c)
                    lines.append("  ⚪ 已登记死%s：%s　←出自 %s"
                                 % ("通配" if key == "通配" else "指针", c, os.path.basename(d)))
                    continue
                bad.append((d, c, p + ("（通配零命中）" if key == "通配" else "")))
    for d, c, _ in buckets["命令落点"]:
        lines.append("  ⚪ 命令落点（R3 不验盘）：%s　←出自 %s" % (c, os.path.basename(d)))
    for d, c, _ in buckets["截断/前缀"]:
        lines.append("  ⚪ 截断/前缀（不验盘）：%s　←出自 %s" % (c, os.path.basename(d)))
    if bad:
        lines.append("❌ R4 盘上回读不到的新点名=%d 枚：" % len(bad))
        for d, c, why in bad:
            lines.append("   MISS %-40s %s　(%s)" % (os.path.basename(d), c, why))
        return 1, lines, buckets
    lines.append("结论：验盘四档全部在盘上（通配均至少命中一枚）；已登记死指针点名=%d 处（去重后 %d 枚路径）；不验盘=%d 枚（命令落点 %d、截断 %d）（成立）"
                 % (dead, len(dead_paths), len(buckets["命令落点"]) + len(buckets["截断/前缀"]),
                    len(buckets["命令落点"]), len(buckets["截断/前缀"])))
    return 0, lines, buckets


def self_test():
    fails = []
    with tempfile.TemporaryDirectory() as td:
        home = os.path.join(td, "ev")
        os.makedirs(home)
        ok_path = os.path.join(home, "exists.txt")
        io.open(ok_path, "w", encoding="utf-8").write("x")
        io.open(os.path.join(home, "hit-1.log"), "w", encoding="utf-8").write("x")

        def wdoc(name, content):
            io.open(os.path.join(td, name), "w", encoding="utf-8").write(content)

        wdoc("m.md", "原件 `%s`\n" % os.path.join(home, "nope.txt"))
        wdoc("ok.md", "原件 `%s`\n" % ok_path)
        wdoc("g0.md", "原件 `%s`\n" % os.path.join(home, "zzz-*.log"))
        wdoc("g1.md", "原件 `%s`\n" % os.path.join(home, "hit-*.log"))
        wdoc("br.md", "原件 `%s`\n" % os.path.join(home, "{exists.txt,absent.txt}"))
        wdoc("cmd.md", "命令：`cmd > %s/x-$STAMP.txt`\n" % home)
        wdoc("cmd2.md", "命令：`cmd > %s/never-written.txt`\n" % home)
        wdoc("dir.md", "原件目录 `%s/nope-dir/`\n" % home)
        gone = os.path.join(home, "nope2.txt")
        wdoc("d1.md", "原件 `%s`\n" % gone)
        wdoc("d2.md", "另处又点名一次 `%s`\n" % gone)
        pat = re.escape(home) + r'[^\s`、，。）】>|"' + "'" + r'<>]*'

        def run(name):
            return audit([name], td, pat, set())

        def run_known(names, known):
            return audit(names, td, pat, {(n, gone) for n in known})

        rc_m, lines_m, _ = run("m.md")
        rc_br, lines_br, _ = run("br.md")
        checks = [
            ("臂1 逐字缺失必须红且点名那一枚", rc_m == 1 and any("nope.txt" in l for l in lines_m)),
            ("臂2 同形状改成在册文件必须绿", run("ok.md")[0] == 0),
            ("臂3 通配零命中必须红", run("g0.md")[0] == 1),
            ("臂3b 通配有命中必须绿", run("g1.md")[0] == 0),
            ("臂4 花括号缺的那枚仍要点名", rc_br == 1 and any("absent.txt" in l for l in lines_br)),
            ("臂5 带 $ 的命令落点不许验盘", run("cmd.md")[0] == 0),
            ("臂6 重定向落点（不带 $）不许验盘", run("cmd2.md")[0] == 0),
            ("臂7 目录档缺失必须红", run("dir.md")[0] == 1),
            ("臂8 同一枚路径两文档各点名一次且都已登记 ⇒ 绿，且读数分开写「处」与「去重后枚」",
             (lambda r: r[0] == 0 and any("点名=2 处" in l and "去重后 1 枚路径" in l for l in r[1]))
             (run_known(["d1.md", "d2.md"], {"d1.md", "d2.md"}))),
            ("臂8b 只登记其中一份 ⇒ 另一份仍要红（登记不许按路径吞掉没登记的那处点名）",
             (lambda r: r[0] == 1 and any("d2.md" in l and "nope2.txt" in l for l in r[1]))
             (run_known(["d1.md", "d2.md"], {"d1.md"}))),
        ]
        for name, ok in checks:
            print("  %s %s" % ("✓" if ok else "🔴", name))
            if not ok:
                fails.append(name)
    print("SELF_TEST %s" % ("ARM_FAIL:" + ",".join(fails) if fails else "OK"))
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--docs", default="docs/plans/inbound-automation-handoff.md,docs/plans/inbound-automation.md,"
                                      "PROGRESS.md,BLOCKED.md,docs/reference/environment-traps.md")
    ap.add_argument("--pattern", default=DEFAULT_PATTERN)
    ap.add_argument("--list-unverified", action="store_true", help="把不验盘那两档逐枚打出来")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        return self_test()
    docs = [x.strip() for x in a.docs.split(",") if x.strip()]
    known = set((d, c) for d, c, _ in KNOWN_DEAD)
    rc, lines, buckets = audit(docs, a.root, a.pattern, known)
    for l in lines:
        hide = (l.startswith("  ⚪ 命令落点") or l.startswith("  ⚪ 截断"))
        if hide and not a.list_unverified:
            continue
        print(l)
    if not a.list_unverified:
        n = len(buckets["命令落点"]) + len(buckets["截断/前缀"])
        if n:
            print("  （另有 %d 枚不验盘的点名没逐枚打印；要看全加 --list-unverified）" % n)
    print("台账=%s" % ",".join(os.path.basename(d) for d in docs))
    return rc


if __name__ == "__main__":
    sys.exit(main())
