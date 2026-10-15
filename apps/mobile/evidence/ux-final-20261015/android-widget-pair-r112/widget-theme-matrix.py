#!/usr/bin/env python3
"""当前安装态 APK 上，把四枚 heyta 系统小组件逐枚绑到桌面，各取亮/暗两张装机图，再收掉。

为什么一枚一枚来：模拟器的桌面格子是 6 列 × 5 行，图标行占掉第 4 行，首屏只剩
`cellY=1..3`；一枚 3×2 的组件占掉 `cellX=0..2 / cellY=1..2` 之后，剩下的连续格子放不下
第二枚 —— Launcher 对被拒的落点**什么都不做**（不自动挪页），所以逐个绑定 + 逐个收掉
是唯一能在当前包上把四枚都过一遍明暗的形状。

收掉用的是启动器自己的表（`adb root` 后 `content delete` 那行 `itemType=4` 的记录）
再 force-stop 让桌面重读 —— 这跟用户在桌面上长按→移除改的是同一张表。
🔴 只删本脚本这一趟新绑的那枚 `_id`，别的行（日期、图标、别人的东西）一律不碰。

用法：python3 widget-theme-matrix.py <serial> <out-dir> [name ...]
  name ∈ {今日习惯, 今日专注, 今天的任务, 四象限}（默认四枚全跑）
"""
import json
import re
import subprocess
import sys
import time

SERIAL = sys.argv[1]
OUT = sys.argv[2].rstrip("/")
WANT = sys.argv[3:] or ["今日习惯", "今日专注", "今天的任务", "四象限"]
PROVIDER = {
    "今日习惯": "HabitsWidgetProvider",
    "今日专注": "FocusWidgetProvider",
    "今天的任务": "TodayWidgetProvider",
    "四象限": "QuadrantWidgetProvider",
}
LONGPRESS = (540, 1300)
DROP = (540, 700)
FAV = "content://com.google.android.apps.nexuslauncher.settings/favorites"


def adb(*args, check=True):
    r = subprocess.run(("adb", "-s", SERIAL, "shell", *args), capture_output=True)
    if check and r.returncode:
        raise SystemExit(f"FAILED adb shell {args[:3]}: {r.stderr.decode('utf-8', 'replace')}")
    return r.stdout.decode("utf-8", "replace")


def shot(name):
    p = subprocess.run(("adb", "-s", SERIAL, "exec-out", "screencap", "-p"), capture_output=True)
    open(f"{OUT}/{name}", "wb").write(p.stdout)
    return name


def dump(tag):
    adb("uiautomator", "dump", f"/sdcard/{tag}.xml")
    xml = adb("cat", f"/sdcard/{tag}.xml")
    open(f"{OUT}/{tag}.xml", "w").write(xml)
    return xml


def nodes(xml):
    out = []
    for m in re.finditer(r"<node ([^>]*?)(/?)>", xml):
        a = m.group(1)

        def g(k):
            mm = re.search(k + r'="([^"]*)"', a)
            return mm.group(1) if mm else ""

        b = re.findall(r"\d+", g("bounds"))
        out.append({"text": g("text"), "desc": g("content-desc"), "cls": g("class"),
                    "lc": g("long-clickable"), "b": tuple(map(int, b)) if len(b) == 4 else None})
    return out


def widget_ids():
    txt = adb("content", "query", "--uri", FAV, "--projection", "_id:itemType:title")
    return {int(m.group(1)) for m in re.finditer(r"_id=(\d+), itemType=4", txt)}


def bound_provider():
    """只读 dumpsys 的 `Widgets:` 段（已绑定实例），不是 `Providers:` 段 ——
    后者把四枚 Provider 全列出来，拿它判"绑的是哪一枚"会永远为真。"""
    txt = adb("dumpsys", "appwidget")
    seg = re.search(r"^Widgets:\n(.*?)(?=^\S|\Z)", txt, re.M | re.S)
    body = seg.group(1) if seg else ""
    ids = re.findall(r"^\s*\[\d+\] id=(\d+)", body, re.M)
    cmps = re.findall(r"provider=ProviderId\{[^}]*\}?\s*\n?\s*.*?com\.heyta/([\w.$]+)", body)
    host = re.search(r"pkg:com.google.android.apps.nexuslauncher\}\s*\n\s*callbacks=\S+\s*\n\s*widgets\.size=(\d+)", txt)
    return (int(host.group(1)) if host else -1), sorted(set(cmps)), ids


def open_group():
    adb("input", "keyevent", "KEYCODE_HOME")
    time.sleep(1.2)
    x, y = LONGPRESS
    adb("input", "swipe", str(x), str(y), str(x), str(y), "1500")
    time.sleep(2)
    ns = nodes(dump("home-menu"))
    hit = [n for n in ns if n["text"] in ("微件", "Widgets")]
    if not hit:
        raise SystemExit("长按桌面没出「微件」菜单（落点可能被已有组件占了？）")
    b = hit[0]["b"]
    adb("input", "tap", str((b[0] + b[2]) // 2), str((b[1] + b[3]) // 2))
    time.sleep(2.5)
    xml = dump("picker")
    if not any(n["text"] == "heyta" for n in nodes(xml)):
        box = [n for n in nodes(xml) if n["cls"] == "android.widget.EditText"]
        if not box:
            raise SystemExit("微件面板里既没有 heyta 也没有搜索框")
        b = box[0]["b"]
        adb("input", "tap", str((b[0] + b[2]) // 2), str((b[1] + b[3]) // 2))
        time.sleep(1.5)
        adb("input", "text", "heyta")
        time.sleep(2.5)
        xml = dump("picker-searched")
    ns = nodes(xml)
    head = [n for n in ns if n["text"] == "heyta" and n["cls"] == "android.widget.TextView"]
    if not head:
        raise SystemExit("搜 heyta 之后没有分组标题")
    b = head[0]["b"]
    adb("input", "tap", str((b[0] + b[2]) // 2), str((b[1] + b[3]) // 2))
    time.sleep(2)
    xml = dump("picker-expanded")
    cells = [n for n in nodes(xml) if n["lc"] == "true" and n["cls"] == "android.widget.FrameLayout" and n["b"]]
    if len(cells) < 2:
        adb("input", "tap", str((b[0] + b[2]) // 2), str((b[1] + b[3]) // 2))
        time.sleep(2)
        xml = dump("picker-expanded-2")
        cells = [n for n in nodes(xml) if n["lc"] == "true" and n["cls"] == "android.widget.FrameLayout" and n["b"]]
    if not cells:
        raise SystemExit("展开后找不到可长按的预览格")
    return cells


def cell_of(name):
    """格 → 说明文字配对：一枚说明行归给它**上方同列、底边最接近它**的那格。
    早先按「下方任意文字」配，结果第一格把下面两行的说明都抢走了 —— 拖错了组件。"""
    xml = open(f"{OUT}/picker-expanded.xml").read()
    if not xml.strip():
        xml = open(f"{OUT}/picker-expanded-2.xml").read()
    ns = nodes(xml)
    cells = [n for n in ns if n["lc"] == "true" and n["cls"] == "android.widget.FrameLayout" and n["b"]]
    caps = [n for n in ns if n["cls"] == "android.widget.TextView" and n["text"] == name and n["b"]]
    best = None
    for cap in caps:
        tx1, ty1, tx2, _ty2 = cap["b"]
        cand = [c for c in cells
                if c["b"][3] <= ty1 and c["b"][0] <= tx2 and c["b"][2] >= tx1]
        if not cand:
            continue
        owner = max(cand, key=lambda c: c["b"][3])
        if ty1 - owner["b"][3] > 200:
            continue
        x1, y1, x2, y2 = owner["b"]
        if best is None or ty1 < best[0]:
            best = (ty1, ((x1 + x2) // 2, (y1 + y2) // 2))
    if not best:
        raise SystemExit(f"{name} 的预览格没配上（说明行找不到归属的格子）")
    return best[1]


result = []
for name in WANT:
    before = widget_ids()
    open_group()
    cx, cy = cell_of(name)
    print(f"[{name}] 预览格中心=({cx},{cy}) 落点={DROP}")
    adb("input", "draganddrop", str(cx), str(cy), str(DROP[0]), str(DROP[1]), "2500")
    time.sleep(3)
    size, cmps, ids = bound_provider()
    new = sorted(widget_ids() - before)
    ok = len(cmps) == 1 and cmps[0].endswith(PROVIDER[name]) and len(ids) == 1
    print(f"[{name}] host widgets.size={size} 已绑定={ids} provider={cmps} 新表行={new} 期望只有={PROVIDER[name]} -> {'对上了' if ok else '没对上'}")
    if not ok:
        dump(f"after-failed-{name}")
        raise SystemExit(f"{name} 没绑上或绑到了别的 provider")
    light = shot(f"{name}-light.png")
    adb("cmd", "uimode", "night", "yes")
    time.sleep(4)
    dark = shot(f"{name}-dark.png")
    adb("cmd", "uimode", "night", "no")
    time.sleep(3)
    result.append({"name": name, "provider": PROVIDER[name], "host_size_after": size,
                   "new_fav_ids": new, "light": light, "dark": dark,
                   "uimode_at_capture": "no→yes→no"})
    for fav_id in new:
        adb("content", "delete", "--uri", FAV, "--where", f"_id={fav_id}")
    adb("am", "force-stop", "com.google.android.apps.nexuslauncher")
    time.sleep(4)
    print(f"[{name}] 已收掉 {new}，桌面重读后的 widget 行={sorted(widget_ids())}")

# 按名字合并：原先整份覆盖，第二趟会把前两枚的记录吃掉（本目录那 8 张图就是这么差点对不上账）
prev = []
try:
    prev = json.load(open(f"{OUT}/matrix.json"))["cases"]
except Exception:
    pass
merged = {c["name"]: c for c in prev}
merged.update({c["name"]: c for c in result})
order = [n for n in ["今日习惯", "今日专注", "今天的任务", "四象限"] if n in merged]
open(f"{OUT}/matrix.json", "w").write(json.dumps(
    {"serial": SERIAL, "want": WANT, "cases": [merged[n] for n in order],
     "device_locale": adb("settings", "get", "system", "system_locales").strip(),
     "release": adb("getprop", "ro.build.version.release").strip(),
     "apk": adb("dumpsys", "package", "com.heyta").split("versionName=")[1].split()[0],
     "lastUpdateTime": re.search(r"lastUpdateTime=(\S+)", adb("dumpsys", "package", "com.heyta")).group(1)},
    ensure_ascii=False, indent=2))
print("SIZE AFTER ALL:", bound_provider())
