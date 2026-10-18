#!/usr/bin/env python3
"""装机态四枚 Android 组件**填入非空真实数据**的设备腿（r114，2026-10-16 01:3x）。

台账 912 那行的后半句：「其它模板填入非空真实数据」。r112 那趟四枚都是空态
（「今天没有任务」／「还没有习惯」／「没有进行中的专注」／四象限 0/0），
所以这一趟走**应用自己的界面**造数据，再逐枚绑组件取亮/暗两档。

🔴 为什么坚持走 UI 而不是往 app 存储里写文件：快照的内容是
`materializedState(host) + currentFocusState()` 经 `planWidgetPublish` 算出来、
再由应用侧密封（`apps/mobile/src/widgets/publish-source.ts`）。手写文件会绕开整条管线，
那种图不能叫"装机态非空数据"。

跑法：
    python3 widget-data-leg.py emulator-5554 .            # 造数据 + 绑定 + 两档取图 + 清理
    python3 widget-data-leg.py emulator-5554 . capture    # 只重做绑定与取图（数据已在）
    python3 widget-data-leg.py emulator-5554 . cleanup    # 只把本趟造的数据删掉

四枚各判两件事（两件事一起成立才算数）：
  ① 绑的**就是那枚** provider —— 只读 `dumpsys appwidget` 的 `Widgets:` 段（`Providers:` 段把四枚全列出来）；
  ② 卡内**真的出现了本趟造的那条数据**（按标题/习惯名逐枚对），并且 r112 那批空态串**不在**卡内。
"""
import json
import os
import re
import subprocess
import sys
import time

SERIAL = sys.argv[1] if len(sys.argv) > 1 else "emulator-5554"
OUT = (sys.argv[2] if len(sys.argv) > 2 else ".").rstrip("/")
PHASES = set((sys.argv[3] if len(sys.argv) > 3 else "all").split(","))
PHASE = "all" if "all" in PHASES else ",".join(sorted(PHASES))

PREFIX = os.environ.get("LEG_PREFIX", "L114")  # 换一趟就改这个环境变量，别改标题形状
# 🔴 标题里**不许有 `-` 与 `!`**：这台模拟器（`system_locales=zh-Hans-CN`）上 `input text`
#    会把它们打成全角 `－` `！`，而且**与 IME 开关无关** ——
#    现量三档 A/B（关 IME + 冷启动 / 开 IME + 冷启动 / 再关一次 + 冷启动）打的都是
#    `x-y!z` → `x－！yz`。所以优先级也不走快速添加的 `!1`，改成详情里点「标记为重要」；
#    紧急那一半由「截止日期=今天」推（界面自己那行 hint 就写着"紧急程度由截止时间推导"）。
TASKS = [
    {"title": f"{PREFIX}UrgentImportant", "due_today": True, "important": True},
    {"title": f"{PREFIX}Urgent", "due_today": True},
    {"title": f"{PREFIX}Important", "important": True},
    {"title": f"{PREFIX}Plain"},
]
HABIT = f"{PREFIX}Habit"
# 今日专注排第一：那一档的快照只在专注轮活着期间是 active，轮次跑完会写库并重新发布 ⇒
# 越靠后取图越可能被"已完成"顶掉。另外三枚不依赖这个窗口。
WIDGETS = ["今日专注", "今天的任务", "四象限", "今日习惯"]
PROVIDER = {
    "今日习惯": "HabitsWidgetProvider",
    "今日专注": "FocusWidgetProvider",
    "今天的任务": "TodayWidgetProvider",
    "四象限": "QuadrantWidgetProvider",
}
EMPTY_MARKS = ["今天没有任务", "还没有习惯", "没有进行中的专注", "0/0"]
LONGPRESS = (540, 1300)
# simult 档要**依次**试：桌面被前一枚组件占住后，固定点会长按到组件身上（弹的是组件菜单）。
LONGPRESS_POINTS = [(540, 1300), (980, 380), (120, 2140)]
DROP = (540, 700)
# 同屏档的候选落点（桌面 6 列 × 5 行，热区在第 4 行）：一枚放不下就换下一格
DROP_POINTS = [(540, 700), (540, 1150), (540, 380), (540, 1600)]
FAV = "content://com.google.android.apps.nexuslauncher.settings/favorites"
LAUNCHER = "com.google.android.apps.nexuslauncher"
# 组件类名按 manifest 的 `namespace`（com.heytamobile）解析，applicationId 是 com.heyta：
# `android:name=".widget.TodayWidgetProvider"` ⇒ com.heytamobile.widget.TodayWidgetProvider
WIDGET_COMPONENT = "com.heyta/com.heytamobile.widget.TodayWidgetProvider"
log = []


def note(msg):
    print(msg, flush=True)
    log.append(msg)


def adb(*args, check=True):
    r = subprocess.run(("adb", "-s", SERIAL, "shell", *args), capture_output=True)
    if check and r.returncode:
        raise SystemExit(f"FAILED adb shell {args[:3]}: {r.stderr.decode('utf-8', 'replace')}")
    return r.stdout.decode("utf-8", "replace")


def adb_out(*args):
    r = subprocess.run(("adb", "-s", SERIAL, *args), capture_output=True)
    return r.stdout


def shot(name):
    open(f"{OUT}/{name}", "wb").write(adb_out("exec-out", "screencap", "-p"))
    return name


def nodes_of(xml):
    out = []
    for m in re.finditer(r"<node ([^>]*?)(/?)>", xml):
        a = m.group(1)

        def g(k):
            mm = re.search(k + r'="([^"]*)"', a)
            return mm.group(1) if mm else ""

        b = re.findall(r"\d+", g("bounds"))
        out.append({"text": g("text"), "desc": g("content-desc"), "cls": g("class"),
                    "rid": g("resource-id"), "clk": g("clickable"), "lc": g("long-clickable"),
                    "b": tuple(map(int, b)) if len(b) == 4 else None})
    return out


def dump(tag, check=True):
    """🔴 `uiautomator dump` 在"取不到 idle 态"时打的是 **ERROR: could not get idle state.**
    而**退出码仍是 0**（现量：专注环在转的时候 `rc=0` + 那行 ERROR），
    所以只看 rc 会拿到上一枚同名文件的陈旧内容 —— 本腿第一版就是被这一条骗成"专注没起来"。
    这里显式认那行字，并把失败如实报出来。"""
    out = adb("uiautomator", "dump", f"/sdcard/{tag}.xml", check=check)
    if "ERROR" in out or "could not get idle state" in out:
        return []
    xml = adb("cat", f"/sdcard/{tag}.xml", check=False)
    if "<node" not in xml:
        # 另一种失败形状：dump 那一步既没报 ERROR 也没落盘（现量：点完「继续」环开始动之后）
        return []
    with open(f"{OUT}/{tag}.xml", "w", encoding="utf-8") as fh:
        fh.write(xml)
    return nodes_of(xml)


def pick(ns, text=None, desc=None, rid=None, clickable=None, contains=False):
    hit = []
    for n in ns:
        if clickable is not None and (n["clk"] == "true") != bool(clickable):
            continue
        if text is not None:
            if contains and text not in n["text"]:
                continue
            if not contains and n["text"] != text:
                continue
        if desc is not None and n["desc"] != desc:
            continue
        if rid is not None and not n["rid"].endswith(rid):
            continue
        hit.append(n)
    return hit


def scroll_find(label, tag, tries=8, clickable_only=False):
    """按文字/aria 找一枚**中心在可视带里**的节点，找不到就滚一下再找。
    「我的」里那一行「习惯」不是 clickable 的（`verify-mobile-habits.sh` 也是按文字点的），
    所以这一枚允许 `clickable_only=False`。"""
    for i in range(tries):
        ns = dump(tag)
        hit = find_control(ns, label) if clickable_only else [
            n for n in ns if (n["text"] == label or n["desc"] == label) and n["b"]]
        for n in hit:
            x, y = center(n)
            if 200 <= y <= 2100:
                return n, i
        adb("input", "swipe", "540", "1700", "540", "800", "600")
        time.sleep(1.2)
    return None, tries


def scroll_find_control(label, tag, tries=6):
    """详情窗格是可滚的：「标记为重要」在折叠线以下时**整枚不在可视区**。
    🔴 到达判据用"中心在可视带内"，不是"在树里"——被裁掉的节点照样带 content-desc，
    按它点就是一次静默空点（本账在同族那一格踩过两次）。"""
    for i in range(tries):
        ns = dump(tag)
        hit = find_control(ns, label)
        if hit:
            x, y = center(hit[0])
            if 200 <= y <= 2100:
                return hit[0], i
        adb("input", "swipe", "540", "1700", "540", "800", "600")
        time.sleep(1.2)
    return None, tries


def find_control(ns, label):
    """可点的那一枚可能是 Button(desc=标签) 而**可见文字住在里面的 TextView**上
    （「今天」「标记为重要」都是这一形）—— 只按 text 找会命中 clk=false 的那行字，点它什么都不发生。"""
    return pick(ns, desc=label, clickable=True) or pick(ns, text=label, clickable=True)


def center(n):
    x1, y1, x2, y2 = n["b"]
    return ((x1 + x2) // 2, (y1 + y2) // 2)


def tap(n):
    x, y = center(n)
    adb("input", "tap", str(x), str(y))
    return x, y


def wait_for(pred, what, tries=10, delay=1.5):
    for _ in range(tries):
        ns = dump("probe", check=False)
        got = pred(ns)
        if got:
            return got
        time.sleep(delay)
    raise SystemExit(f"等不到：{what}")


def focus_owner():
    """**只取 `mCurrentFocus` 那一行**。
    🔴 第一版返回整份 `dumpsys window`：那里面列着**所有**窗口，桌面的包名永远在场，
    于是任何"前台是不是桌面"的判断都会**恒真** —— 一条永远通过的判据比没有判据更糟
    （AGENTS §7 元规则第二条）。读不到那一行就返回空串，让调用方响亮失败。"""
    out = adb("dumpsys", "window", check=False)
    for line in out.splitlines():
        if line.strip().startswith("mCurrentFocus="):
            return line.strip()
    return ""


def launch_app(fresh=True):
    """fresh=True 先 force-stop：上一趟崩在详情窗格里时，界面会**停在一张开着的 sheet 上**，
    那里既没有「新建任务」也没有底部 tab —— 照旧往下点就会 Index Error（run2 就是这么死的）。
    🔴 capture 阶段**不能** fresh：专注那一轮的 `focus.active` 只在内存里，杀掉进程再起来
    下一次发布会把它读成 idle，今日专注那枚卡就退回空态了。"""
    if fresh:
        adb("am", "force-stop", "com.heyta", check=False)
        time.sleep(1)
    for i in range(4):
        adb("am", "start", "-W", "-n", "com.heyta/com.heytamobile.MainActivity", check=False)
        time.sleep(3)
        if "com.heyta" in re.sub(r"\s+", " ", focus_owner().split("mCurrentFocus")[1][:120]):
            return True
        note(f"  第 {i + 1} 次拉起后前台不是 com.heyta，再看一眼")
    return False


def clear_and_type(value):
    """CTRL+A + DEL 再输入；读完回校，不对就重来一次（`input text` 高负载会静默丢字）。"""
    for _ in range(2):
        adb("input", "keycombination", "113", "29")
        time.sleep(0.5)
        adb("input", "keyevent", "67")
        time.sleep(0.7)
        adb("input", "text", value.replace(" ", "%s"))
        time.sleep(1)
        ns = dump("probe", check=False)
        box = [n for n in ns if n["cls"].endswith("EditText") and n["rid"].endswith("capture-input")]
        if box and box[0]["text"] == value:
            return box[0]["text"]
    raise SystemExit(f"输入框回读不等于要写的值（期望 {value!r}）")


def dismiss_gates():
    ns = dump("gates")
    for label in ("只用本机", "先离线使用"):
        hit = pick(ns, desc=label, clickable=True) or pick(ns, text=label, clickable=True)
        if hit:
            tap(hit[0])
            time.sleep(2)
            ns = dump("gates")


def todo_count(ns):
    """清单顶部那句「N 项待办，M 项已完成」—— 这是**独立于逐行**的一把尺。"""
    for n in ns:
        m = re.match(r"(\d+) 项待办", n["text"] or "")
        if m:
            return int(m.group(1))
    return None


def delete_prefix_rows():
    """删掉**所有**标题里带本趟前缀的行（含上一趟打歪成 `L114－urgent－important ！1` 的那些）。
    🔴 必须按前缀整族删，不能只删本趟要建的那几个名字 —— 上一趟留下的行会一起进组件卡，
    那一张图就不是"本趟造的数"了。
    🔴 而且**必须滚着删**：r115 第一次跑照出这一枚只删"当前一屏可见的那几行"，
    于是 r114 那趟的清理只删掉了 4 行、清单顶部仍写着「8 项待办」——
    残留的同族行会一起进组件卡，那才是这条判据要防的事。"""
    start = todo_count(dump("pre-clean-top"))
    deleted = 0
    idle = 0
    for i in range(60):
        ns = dump(f"pre-clean-{i}")
        hit = [n for n in ns if n["desc"].startswith("删除任务：") and PREFIX in n["desc"]]
        if hit:
            idle = 0
            tap(hit[0])
            time.sleep(1.5)
            btn = find_control(dump(f"confirm-{i}"), "删除")
            if btn:
                tap(btn[0])
                time.sleep(1.5)
            # 🔴 计数要记在**点了那一行**上，不是记在"确认按钮找到了"上：
            #    这枚控件在很多形状下是**直接删**（没有确认框），r115 现量过一次 ——
            #    当时这里写成"只有找到确认框才 +1"，于是删掉 4 行却报 0，
            #    是旁边那把「N 项待办」的尺（8 → 4）把这条报出来的。
            deleted += 1
            continue
        seen = {n["desc"] for n in ns if n["desc"].startswith("删除任务：")}
        adb("input", "swipe", "540", "1700", "540", "700", "600")
        time.sleep(1.2)
        after = dump(f"pre-clean-s{i}")
        if {n["desc"] for n in after if n["desc"].startswith("删除任务：")} == seen:
            idle += 1
            if idle >= 3:
                break
        else:
            idle = 0
    for _ in range(4):
        adb("input", "swipe", "540", "700", "540", "1700", "400")
        time.sleep(0.8)
    left = todo_count(dump("pre-clean-end"))
    note(f"  整族删掉 {deleted} 行；清单顶部「N 项待办」{start} → {left}")
    if deleted and start is not None and left is not None and start - deleted != left:
        note(f"  ⚠️ 两把尺对不上：删了 {deleted} 行但总数只少了 {start - left} —— "
             "要么有一行没真删掉，要么顶部那句数的不是同一件事")
    return deleted


def create_task(spec):
    title = spec["title"]
    ns = dump("before-add")
    fab = pick(ns, desc="新建任务", clickable=True)
    if not fab:
        tap(pick(dump("tab"), desc="任务", clickable=True)[0])
        time.sleep(2)
        fab = pick(dump("fab"), desc="新建任务", clickable=True)
    if not fab:
        raise SystemExit("找不到「新建任务」入口，当前界面标签="
                         + str([n["text"] for n in dump("stuck") if n["text"]][:12]))
    tap(fab[0])
    time.sleep(1.5)
    field = pick(dump("panel"), rid="capture-input")[0]
    tap(field)
    time.sleep(1)
    clear_and_type(title)
    tap(pick(dump("typed"), rid="capture-submit")[0])
    time.sleep(2)
    wait_for(lambda x: pick(x, desc=f"打开任务：{title}"), f"任务 {title} 出现在清单里")
    note(f"  建好 {title}")


def edit_task(spec):
    """进详情：需要的话把截止设成今天、勾上重要，然后返回。"""
    title = spec["title"]
    # 🔴 单次 `dump` + `[0]` 是这枚装置的旧伤：dump 失败时返回空列表 ⇒ 抛 IndexError，
    #    报出来的栈完全看不出"其实那一屏没读到"（现量：r115 第一次跑就死在这里）。
    #    换成有界的 `wait_for`，等不到就报**它等不到什么**。
    node, steps = scroll_find(f"打开任务：{title}", "open-scroll")
    if node is None:
        raise SystemExit(f"滚了 {steps} 次仍找不到「打开任务：{title}」——"
                         "清单里那一行不在可视区之外，或它根本没建成")
    if steps:
        note(f"  （滚了 {steps} 下才到「{title}」）")
    tap(node)
    time.sleep(2)
    touched = []
    if spec.get("due_today"):
        chip, steps = scroll_find_control("今天", "sheet")
        if not chip:
            raise SystemExit(f"{title}：详情里没有可点的「今天」快捷（截止设不上，这一趟的读数会缺）")
        tap(chip)
        time.sleep(1.5)
        touched.append("due=today")
    if spec.get("important"):
        btn, steps = scroll_find_control("标记为重要", "sheet2")
        if not btn:
            raise SystemExit(f"{title}：滚 {steps} 次仍找不到「标记为重要」")
        tap(btn)
        time.sleep(1.5)
        touched.append("important")
    after = dump("sheet-after")
    shown = [n["text"] for n in after if n["text"] and len(n["text"]) <= 24]
    note(f"  改过 {title}: {','.join(touched) or '（没改）'}；回读片段={shown[:8]}")
    adb("input", "keyevent", "4")
    time.sleep(1.5)


def seed_tasks():
    delete_prefix_rows()
    for spec in TASKS:
        create_task(spec)
    for spec in TASKS:
        if spec.get("due_today") or spec.get("important"):
            edit_task(spec)
    ns = dump("seeded-list")
    note("  清单回读：" + str(sorted(n["desc"] for n in ns if n["desc"].startswith("打开任务："))))


def go_tab(desc):
    tap(pick(dump("tabprobe"), desc=desc, clickable=True)[0])
    time.sleep(2)


def seed_habit():
    go_tab("我的")
    row, steps = scroll_find("习惯", "profile")
    if not row:
        raise SystemExit(f"「我的」里滚 {steps} 次也没找到「习惯」入口")
    tap(row)
    time.sleep(3)
    field = pick(dump("habit-new"), desc="新习惯名称")
    if not field:
        raise SystemExit("习惯屏里没有「新习惯名称」输入框")
    tap(field[0])
    time.sleep(1)
    for _ in range(2):
        adb("input", "keycombination", "113", "29")
        time.sleep(0.4)
        adb("input", "keyevent", "67")
        time.sleep(0.6)
        adb("input", "text", HABIT)
        time.sleep(1)
        box = [n for n in dump("habit-typed") if n["cls"].endswith("EditText")]
        if any(b["text"] == HABIT for b in box):
            break
    else:
        raise SystemExit(f"习惯名回读不等于 {HABIT!r}")
    tap(pick(dump("habit-add"), desc="添加习惯", clickable=True)[0])
    time.sleep(3)
    rows = wait_for(lambda x: [n for n in x if n["rid"].startswith("habit-row-")], "习惯清单里出现一行")
    rid = rows[0]["rid"]
    note(f"  建好习惯 {HABIT}（行 {rid}）")
    tap(rows[0])
    time.sleep(2)
    chk = pick(dump("habit-detail"), rid="habit-checkin-")
    if chk:
        tap(chk[0])
        time.sleep(2)
        note("  已点 habit-checkin-<id>（今天这一格打卡）")
    else:
        note("  ⚠️ 详情里没有 habit-checkin-<id>，打卡这半步没做（不影响『习惯非空』，影响的是『今天已完成』那一档）")
    adb("input", "keyevent", "4")
    time.sleep(1.5)


def has_text(ns, label):
    """标签**在不在树上**（不要求可点）：相位标签「已暂停」住的是一枚 `clickable=false` 的
    TextView，用 `find_control` 找它永远找不到 —— 本腿第一次跑就被这条判成"开始没生效"。"""
    return any(n["text"] == label or n["desc"] == label for n in ns)


# 一轮专注"活着"的读数形状：running 与 paused 两档在 `selectFocus` 里都是 active
# （`active = phase !== 'idle'`），所以四种标签/按钮任意读到一种都算非空。
LIVE_FOCUS = ("专注中", "暂停", "已暂停", "继续")


def start_focus():
    """专注这一档不能靠无障碍树读 —— 进度环一直在动，`uiautomator dump` 取不到 idle。
    所以判据是**"读到 idle 之外的形状"**，且**最后由组件卡自己裁决**（capture/simult 档
    在桌面上读「专注中」那一条）。"""
    go_tab("专注")
    ns = dump("focus-tab")
    btn = find_control(ns, "开始专注") or find_control(ns, "暂停") or find_control(ns, "继续")
    if not btn:
        raise SystemExit("专注页既没有「开始专注」也没有「暂停/继续」："
                          + str([n["text"] for n in ns if n["text"]][:10]))
    resumed = False
    if find_control(ns, "继续") or has_text(ns, "已暂停"):
        note("  这一轮停在「已暂停」（主按钮=继续）。`selectFocus` 的 active = phase !== 'idle'，"
             "暂停档同样算 active ⇒ 不再强推 running，照这一档取图并如实记下档位")
        resumed = True
    if resumed:
        shot("focus-paused.png")
        return
    tap(btn[0])
    time.sleep(3)
    shot("focus-running.png")
    ns2 = dump("focus-while-running", check=False)
    if ns2:
        read = [x for x in LIVE_FOCUS if has_text(ns2, x) or find_control(ns2, x)]
        if not read:
            raise SystemExit("点完「开始专注」四档形状一种都没读到（专注中/暂停/已暂停/继续）："
                              + str([n["text"] for n in ns2 if n["text"]][:12]))
        note(f"  专注这一档活着：读到 {read}（running/paused 两档都算 active）")
    else:
        note("  ⚠️ 运行中无障碍树读不到（进度环在动，dump 取不到 idle）—— 按 running 处理")


def widget_ids():
    txt = adb("content", "query", "--uri", FAV, "--projection", "_id:itemType:title")
    return {int(m.group(1)) for m in re.finditer(r"_id=(\d+), itemType=4", txt)}


def bound_provider():
    txt = adb("dumpsys", "appwidget")
    seg = re.search(r"^Widgets:\n(.*?)(?=^\S|\Z)", txt, re.M | re.S)
    body = seg.group(1) if seg else ""
    ids = re.findall(r"^\s*\[\d+\] id=(\d+)", body, re.M)
    cmps = re.findall(r"com\.heyta/([\w.$]+)", body)
    host = re.search(r"widgets\.size=(\d+)", txt)
    return (int(host.group(1)) if host else -1), sorted(set(cmps)), ids


def open_group(lp=None):
    """🔴 `lp=None` 时**逐个试** LONGPRESS_POINTS：simult 档往桌面上放了组件之后，
    固定的长按点会落在**组件自己身上**（那时弹的是组件菜单，没有「微件」那一项）。"""
    points = [lp] if lp else LONGPRESS_POINTS
    for (x, y) in points:
        adb("input", "keyevent", "KEYCODE_HOME")
        time.sleep(1.2)
        adb("input", "swipe", str(x), str(y), str(x), str(y), "1500")
        time.sleep(2)
        ns = dump("home-menu")
        hit = [n for n in ns if n["text"] in ("微件", "Widgets")]
        if hit:
            break
        note(f"  长按 ({x},{y}) 没出「微件」菜单（可能被已放下的组件占了），换下一个点")
    else:
        raise SystemExit(f"{len(points)} 个长按点都没出「微件」菜单")
    tap(hit[0])
    time.sleep(2.5)
    ns = dump("picker")
    if not any(n["text"] == "heyta" for n in ns):
        box = [n for n in ns if n["cls"].endswith("EditText")]
        if not box:
            raise SystemExit("微件面板里既没有 heyta 也没有搜索框")
        tap(box[0])
        time.sleep(1.5)
        adb("input", "text", "heyta")
        time.sleep(2.5)
        ns = dump("picker-searched")
    if not ns:
        raise SystemExit("搜 heyta 之后读不到面板（无障碍树取不到 idle？）")
    head = [n for n in ns if n["text"] == "heyta" and n["cls"].endswith("TextView")]
    if not head:
        raise SystemExit("搜 heyta 之后没有分组标题")
    tap(head[0])
    time.sleep(2)
    ns = dump("picker-expanded")
    cells = [n for n in ns if n["lc"] == "true" and n["cls"].endswith("FrameLayout") and n["b"]]
    if len(cells) < 2:
        tap(head[0])
        time.sleep(2)
        ns = dump("picker-expanded-2")
        cells = [n for n in ns if n["lc"] == "true" and n["cls"].endswith("FrameLayout") and n["b"]]
    if not cells:
        raise SystemExit("展开后找不到可长按的预览格")
    return ns, cells


def cell_of(name, ns, cells):
    caps = [n for n in ns if n["cls"].endswith("TextView") and n["text"] == name and n["b"]]
    best = None
    for cap in caps:
        tx1, ty1, tx2, _ = cap["b"]
        cand = [c for c in cells if c["b"][3] <= ty1 and c["b"][0] <= tx2 and c["b"][2] >= tx1]
        if not cand:
            continue
        owner = max(cand, key=lambda c: c["b"][3])
        if ty1 - owner["b"][3] > 200:
            continue
        if best is None or ty1 < best[0]:
            best = (ty1, center(owner))
    if not best:
        raise SystemExit(f"{name} 的预览格没配上（说明行找不到归属的格子）")
    return best[1]


def card_texts(name):
    """桌面那一屏的无障碍树里，属于本趟数据的那几条文字。"""
    ns = dump(f"card-{name}")
    marks = [n["text"] for n in ns if n["text"] and (PREFIX in n["text"] or n["text"] in
             ("专注中",) or re.match(r"^[1-9]\d*/\d+$", n["text"]))]
    empties = [n["text"] for n in ns if n["text"] in EMPTY_MARKS]
    return marks, empties


def capture():
    cases = []
    for name in WIDGETS:
        before = widget_ids()
        ns, cells = open_group()
        cx, cy = cell_of(name, ns, cells)
        note(f"[{name}] 预览格中心=({cx},{cy}) 落点={DROP}")
        adb("input", "draganddrop", str(cx), str(cy), str(DROP[0]), str(DROP[1]), "2500")
        time.sleep(4)
        size, cmps, ids = bound_provider()
        new = sorted(widget_ids() - before)
        ok = len(cmps) == 1 and cmps[0].endswith(PROVIDER[name]) and len(ids) == 1
        marks, empties = card_texts(name)
        note(f"[{name}] host widgets.size={size} provider={cmps} 新表行={new} 命中={marks} 空态残留={empties}")
        if not ok:
            raise SystemExit(f"{name} 没绑上或绑到了别的 provider（{cmps}）")
        light = shot(f"{name}-data-light.png")
        adb("cmd", "uimode", "night", "yes")
        time.sleep(4)
        dark = shot(f"{name}-data-dark.png")
        adb("cmd", "uimode", "night", "no")
        time.sleep(3)
        cases.append({"name": name, "provider": PROVIDER[name], "new_fav_ids": new,
                      "data_marks": marks, "empty_leftovers": empties,
                      "light": light, "dark": dark})
        for fav_id in new:
            adb("content", "delete", "--uri", FAV, "--where", f"_id={fav_id}")
        adb("am", "force-stop", LAUNCHER)
        time.sleep(4)
    return cases


def page_marks(ns):
    """这一屏桌面树里属于本趟的读数（命中文字 + 空态串）。

    ⚠️ 同屏档里**一页可能有两枚卡**，那时无障碍树分不出"这行字属于哪一枚"
    —— 逐枚归属由 capture 档（每次桌面只有一枚）负责，本档只判"四枚同时在场、
    且在场期间每枚都画出了本趟的数"。
    """
    marks = [n["text"] for n in ns if n["text"] and (PREFIX in n["text"] or n["text"] == "专注中"
             or re.match(r"^[1-9]\d*/\d+$", n["text"]))]
    empties = [n["text"] for n in ns if n["text"] in EMPTY_MARKS]
    return marks, empties


def swipe_next():
    adb("input", "swipe", "950", "1200", "150", "1200", "300")
    time.sleep(2.2)


def walk_pages(tier, max_pages=8):
    """从第 0 页逐页 dump + 截图；某一页的文字集合与上一页**完全相同** ⇒ 已经翻到头被弹回。

    🔴 起手 force-stop 启动器：一是把桌面复位到第 0 页，二是让它重读那张 favorites 表
    （r112 那档收掉实例走的就是同一张表， force-stop 后组件不会掉绑定）。
    """
    adb("am", "force-stop", LAUNCHER, check=False)
    time.sleep(3)
    adb("input", "keyevent", "KEYCODE_HOME")
    time.sleep(2.5)
    pages, prev = [], None
    for i in range(max_pages):
        ns = dump(f"simult-p{i}-{tier}")
        if not ns:
            note(f"[{tier} p{i}] ⚠️ 读不到无障碍树（dump 取不到 idle），这一页没有读数")
            break
        marks, empties = page_marks(ns)
        png = shot(f"四枚同屏-p{i}-{tier}.png")
        note(f"[{tier} p{i}] 命中={marks} 空态残留={empties} 图={png}")
        pages.append({"page": i, "marks": marks, "empty_leftovers": empties, "png": png})
        sig = frozenset(n["text"] for n in ns if n["text"])
        if prev is not None and sig == prev:
            note(f"[{tier}] 第 {i} 页与上一页文字集合相同 ⇒ 到头被弹回，停止翻页")
            break
        prev = sig
        swipe_next()
    return pages


def bind_all():
    """四枚**都放着不删**。判据是 dumpsys 的 `Widgets:` 段同时挂着四个不同 provider。"""
    placed = {}
    for name in WIDGETS:
        for (dx, dy) in DROP_POINTS:
            before = widget_ids()
            ns, cells = open_group()
            cx, cy = cell_of(name, ns, cells)
            adb("input", "draganddrop", str(cx), str(cy), str(dx), str(dy), "2500")
            time.sleep(4)
            new = sorted(widget_ids() - before)
            if new:
                placed[name] = new
                note(f"[{name}] 落点=({dx},{dy}) 新表行={new}")
                break
            note(f"[{name}] 落点=({dx},{dy}) 被拒（favorites 表没新增行）")
        else:
            raise SystemExit(f"{name} 在 {DROP_POINTS} 四个落点上都没放下")
    size, cmps, ids = bound_provider()
    missing = [n for n in WIDGETS if not any(c.endswith(PROVIDER[n]) for c in cmps)]
    note(f"[同屏] host widgets.size={size} 绑到的 provider={cmps} ids={ids} 缺={missing}")
    if missing or len(ids) != 4:
        raise SystemExit(f"四枚没有同时在场（size={size}，缺={missing}）")
    return placed


def simult():
    placed = bind_all()
    light = walk_pages("light")
    adb("cmd", "uimode", "night", "yes")
    time.sleep(4)
    dark = walk_pages("dark")
    adb("cmd", "uimode", "night", "no")
    time.sleep(3)
    need = [t["title"] for t in TASKS] + [HABIT, "专注中"]
    out = {}
    for tier, pages in (("light", light), ("dark", dark)):
        seen = {m for p in pages for m in p["marks"]}
        miss = [x for x in need if not any(x in m for m in seen)]
        resid = [(p["page"], e) for p in pages for e in p["empty_leftovers"]]
        note(f"[{tier}] 本趟数据缺={miss} 空态残留={resid} 走了 {len(pages)} 页")
        out[tier] = {"pages": pages, "missing": miss, "empty_leftovers": resid}
    if out["light"]["missing"] or out["dark"]["missing"]:
        raise SystemExit("同屏档：有一档没读到本趟的全部数据")
    if out["light"]["empty_leftovers"] or out["dark"]["empty_leftovers"]:
        raise SystemExit("同屏档：桌面残留里还有空态串")
    for fav_id in [i for v in placed.values() for i in v]:
        adb("content", "delete", "--uri", FAV, "--where", f"_id={fav_id}")
    adb("am", "force-stop", LAUNCHER)
    time.sleep(4)
    return {"placed": placed, "tiers": out}


def bind_one(name):
    """绑一枚并**留着不删**（点卡片那一档要它一直在桌面上）。"""
    for (dx, dy) in DROP_POINTS:
        before = widget_ids()
        ns, cells = open_group()
        cx, cy = cell_of(name, ns, cells)
        adb("input", "draganddrop", str(cx), str(cy), str(dx), str(dy), "2500")
        time.sleep(4)
        new = sorted(widget_ids() - before)
        if not new:
            note(f"[{name}] 落点=({dx},{dy}) 被拒（favorites 表没新增行）")
            continue
        size, cmps, ids = bound_provider()
        if not any(c.endswith(PROVIDER[name]) for c in cmps):
            raise SystemExit(f"{name} 绑到了别的 provider：{cmps}")
        note(f"[{name}] 绑住 落点=({dx},{dy}) 新表行={new} host widgets.size={size} provider={cmps}")
        return new
    raise SystemExit(f"{name} 在 {DROP_POINTS} 四个落点上都没放下")


def card_rows(tag):
    ns = dump(tag)
    return [(n["text"], n["b"]) for n in ns if n["text"] and PREFIX in n["text"]]


def tap_row(rows, title, tag, soft=False):
    """点那一行**最左边 25px**（`○`/`✓` 那枚符号住在那儿）。
    ⚠️ 点标题会走另一条意图（打开应用），那一档要量的正是这两条分不分得开。
    `soft=True` 用于**明知那一屏可能没有行**的档（被杀后组件不渲染行 —— 那本身就是读数，
    不该让它把后面的腿一起带走；run3 就是死在这儿）。"""
    hit = next(((t, b) for t, b in rows if t.endswith(title)), None)
    if not hit:
        if soft:
            note(f"  {tag}：这一屏没有以「{title}」结尾的行：{[t for t, _ in rows]} —— 按空点处理")
            return None
        raise SystemExit(f"{tag}：这一屏没有以「{title}」结尾的行：{[t for t, _ in rows]}")
    x = hit[1][0] + 25
    y = (hit[1][1] + hit[1][3]) // 2
    adb("input", "tap", str(x), str(y))
    note(f"  点了 ({x},{y}) ← 行 {hit[0]!r} bounds={hit[1]}")
    return {"x": x, "y": y, "row": hit[0], "bounds": list(hit[1])}


def poll_rows(tag, tries, first=3):
    """每次读数**换 tag**（同一条腿被 #439 咬过：同名文件读到的是上一屏）。
    读数节奏：第一次等 3s，之后每 5s 一次，共 `tries` 次。"""
    rows, waited = [], 0
    for i in range(tries):
        step = first if i == 0 else 5
        time.sleep(step)
        waited += step
        rows = card_rows(f"{tag}-{i}")
        if any(t.startswith("✓") for t, _ in rows):
            note(f"  [{tag}] 约 {waited}s 时出现 ✓：{[t for t, _ in rows]}")
            return waited, rows
    note(f"  [{tag}] {tries} 次读数（累计约 {waited}s）都没出现 ✓：{[t for t, _ in rows]}")
    return None, rows


def click_leg():
    """装机态上**真的用手指点卡片那一行**，量两条：
    ① 应用进程活着时，点一下多久回写（卡上 `○`→`✓`）；
    ② 应用被 `am force-stop` 之后点同一枚控件，队列是不是**留着等应用起来**再排空。
    """
    res = {}
    fav = bind_one("今天的任务")
    res["fav_ids"] = fav
    adb("input", "keyevent", "KEYCODE_HOME")
    time.sleep(2)
    before = card_rows("click-before")
    note(f"[点卡片] 未点：{[t for t, _ in before]}")
    res["before"] = [t for t, _ in before]

    # ① 进程活着（seed 刚跑完，按 HOME 只是退到桌面）
    ps = adb("ps", "-A")
    res["app_alive_before"] = "com.heyta" in ps
    note(f"  点之前 com.heyta 进程在不在：{res['app_alive_before']}")
    tap = tap_row(before, TASKS[0]["title"], "①活着")
    tick, rows = poll_rows("click-alive", 5)
    res["alive"] = {"tap": tap, "tick": tick, "rows": [t for t, _ in rows]}
    shot("click-alive-after.png")

    # ② 进程被杀掉
    adb("am", "force-stop", "com.heyta")
    time.sleep(2)
    res["app_alive_before2"] = "com.heyta" in adb("ps", "-A")
    note(f"  force-stop 之后 com.heyta 进程在不在：{res['app_alive_before2']}")
    rows2 = card_rows("click-killed-before")
    tap2 = tap_row(rows2, TASKS[1]["title"], "②已杀", soft=True)
    tick2, rows3 = poll_rows("click-killed", 3) if tap2 else (None, rows2)
    res["killed"] = {"tap": tap2, "tick": tick2, "rows": [t for t, _ in rows3]}
    shot("click-killed-after.png")

    # ③ 把应用叫起来，看那条排不排空
    launch_app(fresh=False)
    time.sleep(6)
    adb("input", "keyevent", "KEYCODE_HOME")
    time.sleep(3)
    rows4 = card_rows("click-woken")
    res["woken"] = [t for t, _ in rows4]
    note(f"  应用起来之后：{res['woken']}")
    shot("click-woken-after.png")

    # ④ 应用自己的清单是不是也认这两条已完成
    launch_app(fresh=False)
    dismiss_gates()
    go_tab("任务")
    time.sleep(2)
    ns = dump("click-applist")
    res["applist_rows"] = [n["desc"] or n["text"] for n in ns if (n["desc"] or n["text"]).startswith("打开任务")]
    note(f"  应用清单里那几条：{res['applist_rows']}")
    shot("click-applist.png")
    for fav_id in fav:
        adb("content", "delete", "--uri", FAV, "--where", f"_id={fav_id}")
    adb("am", "force-stop", LAUNCHER)
    time.sleep(3)
    res["widget_left"] = bound_provider()
    note(f"[点卡片] 收掉本趟实例之后残留 {res['widget_left']}")
    return res


def killed_leg():
    """②那一半单独跑的一趟（run3 死在这儿：`force-stop` 之后组件不再渲染行，
    `tap_row` 找不到行就把后面三条读数一起带走了）。量三件事：
    a) 进程被杀后，**已经绑好的那枚实例**在桌面上渲染成什么（图 + 无障碍树两把尺）；
    b) 拿①那一屏记下的行坐标**原地空点**一次 —— 被杀状态下会不会有 `✓` 冒出来
       （=意图是不是被框架留着等应用起来排空）；
    c) 把应用叫起来之后组件多久恢复读数，以及 b) 那一次点**到底生没生效**
       （恢复后那一行还是 `○` ⇒ 丢了；已经是 `✓` ⇒ 排过队）。
    """
    res = {}
    size, cmps, ids = bound_provider()
    note(f"[已杀腿] 起点：host widgets.size={size} provider={cmps} 实例 id={ids}")
    if size < 1 or not any("TodayWidgetProvider" in c for c in cmps):
        raise SystemExit("[已杀腿] 桌面上没有本线的「今天的任务」实例，这一趟没有对象")
    adb("input", "keyevent", "KEYCODE_HOME")
    time.sleep(2)
    alive_rows = card_rows("killed-start")
    note(f"  杀之前读到的行：{[t for t, _ in alive_rows]}（进程在不在：{'com.heyta' in adb('ps', '-A')}）")
    if alive_rows:
        src = alive_rows
    else:
        # 这一趟单独跑时进程已经是死的（run3 收尾就把它杀了），① 那屏的 dump 是唯一坐标来源
        prev = f"{OUT}/click-alive-0.xml"
        if not os.path.exists(prev):
            raise SystemExit("[已杀腿] 既没读到当前行，也没有 ① 那屏的 click-alive-0.xml 可当坐标来源")
        src = [(n["text"], n["b"]) for n in nodes_of(open(prev, encoding="utf-8").read())
               if n["text"] and n["text"].startswith("○") and PREFIX in n["text"]]
        note(f"  桌面上读不到行 ⇒ 用 ① 那屏的坐标：{[t for t, _ in src]}")
    target = next(((t, b) for t, b in src if t.endswith(TASKS[1]["title"])), src[0])
    x, y = target[1][0] + 25, (target[1][1] + target[1][3]) // 2
    res["tap_point"] = {"row": target[0], "bounds": list(target[1]), "x": x, "y": y}

    t0 = time.strftime("%H:%M:%S")
    adb("am", "force-stop", "com.heyta")
    time.sleep(3)
    adb("input", "keyevent", "KEYCODE_HOME")
    time.sleep(2)
    rows_a = card_rows("killed-a")
    res["blank"] = {"t0": t0, "proc": "com.heyta" in adb("ps", "-A"),
                    "rows": [t for t, _ in rows_a], "host": bound_provider()[0]}
    note(f"  {t0} force-stop 之后（进程在={res['blank']['proc']}，实例仍在={res['blank']['host']}）"
         f"组件读到 {len(rows_a)} 行：{[t for t, _ in rows_a]}")
    shot("killed-a-blank.png")

    adb("input", "tap", str(x), str(y))
    note(f"  原地空点 ({x},{y}) ← 杀之前那一行 {target[0]!r}")
    time.sleep(6)
    rows_b = card_rows("killed-b")
    res["blind_tap"] = {"rows": [t for t, _ in rows_b]}
    note(f"  空点 6s 后读到 {len(rows_b)} 行：{[t for t, _ in rows_b]}")
    shot("killed-b-after-tap.png")

    launch_app(fresh=False)
    adb("input", "keyevent", "KEYCODE_HOME")
    waited, rows_c = 0, []
    for i in range(12):
        time.sleep(3)
        waited += 3
        rows_c = card_rows(f"killed-c-{i}")
        if rows_c:
            break
    t1 = time.strftime("%H:%M:%S")
    res["restore"] = {"seconds": waited if rows_c else None, "t1": t1,
                      "rows": [t for t, _ in rows_c]}
    note(f"  应用起来之后 {t1}：等了约 {waited}s，组件恢复成 {len(rows_c)} 行：{[t for t, _ in rows_c]}")
    shot("killed-c-restored.png")
    res["blind_tap_effect"] = ("已生效（恢复时那一行已是 ✓）" if any(t.endswith(TASKS[1]["title"]) and t.startswith("✓")
                                  for t, _ in rows_c) else
                                  "未生效（恢复时那一行仍是 ○ 或整族没读到）")
    note(f"  b) 那一次空点的结果：{res['blind_tap_effect']}")

    if rows_c:
        tap3 = tap_row(rows_c, TASKS[1]["title"], "③恢复后再点", soft=True)
        tick3, rows_d = poll_rows("killed-alive", 5) if tap3 else (None, rows_c)
        res["after_restore_click"] = {"tap": tap3, "tick": tick3, "rows": [t for t, _ in rows_d]}
        shot("killed-d-second-click.png")
    return res


def find_any(ns, rids=(), texts=()):
    """rid 优先 —— **文本会随语言换，resource-id 不会**。这是语言档能走通的关键。"""
    for r in rids:
        hit = [n for n in ns if n["rid"].endswith(r) and n["b"]]
        if hit:
            return hit[0], f"rid:{r}"
    for t in texts:
        hit = [n for n in ns if (n["text"] == t or n["desc"] == t) and n["b"]]
        if hit:
            return hit[0], f"text:{t}"
    return None, None


def to_main_screen(tries=5, tag="main"):
    """把应用带回**有底部 tab 的那一屏**。🔴 不能只 `am start` 就算数：
    这枚壳会把"上一次停在哪个面"恢复回来 —— 实测 run2 起来直接落在「常规」设置页，
    那里既没有底部 tab 也没有「我的」，于是任何按 tab 词判的探针都恒读成"两个都没有"。"""
    for i in range(tries):
        ns = dump(f"{tag}-{i}")
        if any(n["text"] in ("我的", "Profile") or n["desc"] in ("我的", "Profile") for n in ns):
            return ns
        adb("input", "keyevent", "KEYCODE_BACK")
        time.sleep(1.5)
    raise SystemExit(f"退 {tries} 次也没回到有底部 tab 的那一屏："
                     f"{[n['text'] for n in dump(tag + '-end') if n['text']][:10]}")


def current_app_language(tag="lang-cur"):
    """应用当前显示的语言 —— **必须在应用的主屏上读**（底部那排 tab 是唯一稳定的探针）。
    🔴 第一版在语言页上读"有没有『我的』"，那页根本没有底部 tab，
    于是恒读成"两个都没有"⇒ 每次都被判成"读不清当前语言"而退（本目录 run1 就是它）。"""
    launch_app(fresh=False)
    dismiss_gates()
    ns = to_main_screen(tag=tag)
    blob = " | ".join(n["text"] + "#" + n["desc"] for n in ns)
    zh, en = "我的" in blob, "Profile" in blob
    if zh and not en:
        return "zh"
    if en and not zh:
        return "en"
    raise SystemExit(f"读不出应用语言（zh={zh} en={en}）：屏上文字={[n['text'] for n in ns if n['text']][:12]}")


def goto_language_page():
    """走到应用**自己的**语言开关那一格。🔴 全程不碰系统语言
    （台账那一格明写"不通过改变整个系统语言规避"）。
    导航沿用 `scripts/qa/profile-settings-android.py` 那条已验过的路，按 rid 走 ——
    文本会随语言换，rid 不会。⚠️ 「语言」不是独立一页，它是「常规」页里的一节，
    两枚芯片（`中文` / `English`，都是 clickable 且 desc 就是语言名）就在这一页上。"""
    launch_app(fresh=False)
    dismiss_gates()
    tab, how = find_any(to_main_screen(tag="lang-tab"), (), (("我的", "Profile")))
    if not tab:
        raise SystemExit("[语言腿] 底部没有「我的/Profile」那一枚（to_main_screen 已经响亮失败，不该走到这）")
    tap(tab)
    time.sleep(2)
    for rid, words, tag in (("profile-entry-settings", ("设置", "Settings"), "lang-profile"),
                            ("settings-section-general", ("常规", "General"), "lang-dir")):
        node, how = find_any(dump(tag), (rid,), words)
        if not node:
            raise SystemExit(f"走不到语言那一格（停在 {tag}）：rid={rid} 与 {words} 都没命中，"
                             f"屏上文字={[n['text'] for n in dump(tag + '-miss') if n['text']][:10]}")
        note(f"  {tag} → {how}")
        tap(node)
        time.sleep(2)
    ns = dump("lang-page")
    row = [n for n in ns if n["text"] == "语言" or n["text"] == "Language"]
    if row:
        tap(row[0])
        time.sleep(2)
        ns = dump("lang-page2")
    return ns


def set_language(target):
    """target: 'en' / 'zh'。**已经是目标语言就什么都不点** ——
    这枚开关是持久的（界面上那句原话：「这台设备会记住你的选择，重开应用仍然用它」），
    而 `中文` 与 `English` 两枚**同时在场**，按文本点会把它切回去。"""
    cur = current_app_language()
    ns = goto_language_page()
    want = "English" if target == "en" else "中文"
    if cur == target:
        note(f"  已经是 {target}（开关持久）⇒ 不点，避免把它切回去")
        adb("input", "keyevent", "KEYCODE_HOME")
        time.sleep(2)
        return {"from": cur, "tapped": None}
    node, how = find_any(ns, (), (want,))
    if not node:
        raise SystemExit(f"语言那一格上没有「{want}」那枚芯片：{[n['desc'] or n['text'] for n in ns if n['desc'] or n['text']][:12]}")
    tap(node)
    time.sleep(4)
    after = current_app_language("lang-after-switch")
    note(f"  点了 {how} ⇒ 应用语言现在读成 {after}")
    adb("input", "keyevent", "KEYCODE_HOME")
    time.sleep(3)
    if after != target:
        raise SystemExit(f"点了「{want}」之后应用语言读成 {after}，不是 {target}")
    return {"from": cur, "tapped": how}


def card_area_texts(tag):
    """桌面那一屏上**落在组件矩形里**的文字（组件住在 x≈346-981、y<1100；
    图标与 dock 都在这个矩形之外）。返回逐字文本，不做任何"是不是中文"的判断 ——
    判语言由 `has_cjk` 那一枚单独给。
    🔴 先验前台是桌面：这枚矩形是**坐标过滤**，任何一屏上只要文字落进这个框就会被当成卡。
    run3 的起点读数读回 `['注册 / 登录', '0']` —— 那是应用的登录页，不是卡，
    而它当时正好好在 `current_app_language` 把应用拉到前台之后。"""
    require_launcher(tag)
    ns = dump(tag)
    out = []
    for n in ns:
        if not (n["text"] and n["b"]):
            continue
        x1, y1, x2, y2 = n["b"]
        if x1 >= 300 and y2 <= 1200:
            out.append(n["text"])
    return out


def require_launcher(tag):
    owner = focus_owner()
    if LAUNCHER not in owner:
        raise SystemExit(f"{tag}: 前台不是桌面（{owner.strip()[:140]}）—— "
                         f"读卡之前必须先 HOME，否则读到的是应用自己那一屏")


def has_cjk(items):
    """真 CJK。🔴 第一版写的是 `[㐀-]`（`-` 紧挨 `]` 是**字面连字符**），
    于是它匹配的是日期里的 `-`，把英文态那句 `2026-10-16 · 0/0` 报成"仍带汉字"。"""
    return [s for s in items if re.search(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", s)]


def widget_update_broadcast(tag):
    """只给 provider 发显式 `APPWIDGET_UPDATE` —— RN/JS 那一层不参与。
    `-f 32` = `FLAG_INCLUDE_STOPPED_PACKAGES`：force-stop 之后包在 stopped 态，
    不带这一位广播会被**静默丢弃**，那就会把"装置没送达"读成"产品不会自己重画"。"""
    out = adb("am", "broadcast", "-n", WIDGET_COMPONENT,
              "-a", "android.appwidget.action.APPWIDGET_UPDATE", "-f", "32")
    tail = [l for l in out.splitlines() if l.strip()]
    note(f"  {tag} 广播回执：{tail[-1] if tail else '(无输出)'}")
    return out


def wake_leg(tag):
    """**组件独立唤醒**那一半：先把卡片打成占位（force-stop 的已知形状，见陷阱 #443），
    再只叫 provider 一次。读回来的卡如果是**有内容且语言正确**，那张卡就是它自己画的 ——
    因为底是空的，不存在"上一帧残留"这种解释。"""
    res = {}
    adb("am", "force-stop", "com.heyta")
    time.sleep(3)
    adb("input", "keyevent", "KEYCODE_HOME")
    time.sleep(2)
    res["proc_before"] = "com.heyta" in adb("ps", "-A")
    res["blank"] = card_area_texts(f"wake-{tag}-blank")
    note(f"  [{tag}] force-stop 后：进程在={res['proc_before']} 卡上={res['blank']}")
    res["broadcast"] = widget_update_broadcast(f"wake-{tag}")
    time.sleep(6)
    res["proc_after"] = "com.heyta" in adb("ps", "-A")
    adb("input", "keyevent", "KEYCODE_HOME")
    time.sleep(2)
    res["after"] = card_area_texts(f"wake-{tag}-after")
    res["after_cjk"] = has_cjk(res["after"])
    res["focus_after"] = focus_owner().strip()[:120]
    note(f"  [{tag}] 广播后：进程被拉起={res['proc_after']} 卡上={res['after']}（前台={res['focus_after']}）")
    shot(f"wake-{tag}-after.png")
    return res


def lang_leg():
    """装机态上**应用内切中英文**，量那一枚已绑好的组件跟着不跟着换，
    以及三种"之后"是否一致：**立刻**、**冷启动之后**、**组件独立唤醒之后**（=RN 层不参与，
    只叫 provider）。用的是空态卡（本趟不造数据）—— 空态那句才是本地化串，有数据时卡上全是用户自己写的标题。"""
    res = {}
    size, cmps, aw_ids = bound_provider()
    if any("TodayWidgetProvider" in c for c in cmps):
        ids = sorted(widget_ids())
        note(f"[语言腿] 复用桌面上已绑好的那枚：fav 行={ids}（appwidget id={aw_ids}）")
    else:
        ids = bind_one("今天的任务")
    res["fav_ids"] = ids
    res["start_language"] = current_app_language("lang-start-app")
    adb("input", "keyevent", "KEYCODE_HOME")
    time.sleep(2)
    zh_texts = card_area_texts("lang-card-zh")
    res["card_zh"] = zh_texts
    note(f"[语言腿] 起点：应用语言={res['start_language']} 组件卡上读到={zh_texts}")
    shot("lang-card-1-zh.png")

    res["switch_en"] = set_language("en")
    time.sleep(2)
    en_texts = card_area_texts("lang-card-en")
    res["card_en"] = en_texts
    res["en_has_cjk"] = has_cjk(en_texts)
    note(f"  切到英文之后组件卡上读到={en_texts}")
    if res["en_has_cjk"]:
        note(f"  ⚠️ 英文态卡上仍带汉字的行={res['en_has_cjk']}")
    shot("lang-card-2-en.png")
    res["wake_en"] = wake_leg("en")

    res["switch_back"] = set_language("zh")
    time.sleep(2)
    back = card_area_texts("lang-card-back")
    res["card_back_zh"] = back
    note(f"  切回中文之后卡上={back}")
    shot("lang-card-4-back-zh.png")
    res["wake_zh"] = wake_leg("zh")
    res["restored"] = current_app_language("lang-end-app")
    note(f"  收尾：应用语言读成 {res['restored']}（共享载体必须留回中文）")
    for fav_id in ids:
        adb("content", "delete", "--uri", FAV, "--where", f"_id={fav_id}")
    adb("am", "force-stop", LAUNCHER)
    time.sleep(3)
    res["widget_left"] = bound_provider()
    note(f"  收掉本趟那枚实例之后残留 {res['widget_left']}")
    return res


def cleanup():
    """把本趟造的数据删掉 —— 这台模拟器是共享的，别的设备腿会按名字数自己的记录。"""
    done = {"tasks": [], "habit": False, "focus": None}
    launch_app()
    dismiss_gates()
    go_tab("任务")
    done["tasks"] = delete_prefix_rows()
    go_tab("我的")
    hit, _ = scroll_find("习惯", "clean-profile")
    if hit:
        tap(hit)
        time.sleep(3)
        row = [n for n in dump("clean-habits") if n["rid"].startswith("habit-row-")]
        if row:
            tap(row[0])
            time.sleep(2)
            dele = find_control(dump("clean-habit-detail"), f"删除习惯「{HABIT}」")
            if dele:
                tap(dele[0])
                time.sleep(1.5)
                conf = pick(dump("clean-habit-confirm"), text="删除", clickable=True)
                if conf:
                    tap(conf[0])
                    time.sleep(2)
                done["habit"] = True
    go_tab("专注")
    stop = find_control(dump("clean-focus"), "放弃这一轮")
    if stop:
        tap(stop[0])
        time.sleep(2)
        done["focus"] = "aborted"
    else:
        done["focus"] = "not-running"
    return done


def preflight():
    devs = subprocess.run(("adb", "devices"), capture_output=True, text=True).stdout
    if SERIAL not in devs:
        raise SystemExit(f"{SERIAL} 不在 adb devices 里")
    other = subprocess.run("ps -eo pid,command", shell=True, capture_output=True, text=True).stdout
    # 🔴 排除自己这一族：`nohup python3 widget-data-leg.py …` 的**包装 shell**（zsh -c 那一行）
    #    命令行里也带着脚本名，按 pid 排不干净（pid 是父的父）。所以按名字整族摘掉，
    #    只留下**别的**腿 —— 这枚守卫要拦的是别人，不是自己。
    hits = [l for l in other.splitlines()
            if re.search(r"verify-mobile|profile-settings-android|tasks-ux-android", l)
            and "widget-data-leg.py" not in l]
    if hits:
        raise SystemExit("这台模拟器上有别的设备腿在跑，本趟不起：\n" + "\n".join(hits[:4]))
    pkg = adb("dumpsys", "package", "com.heyta")
    info = {
        "versionName": re.search(r"versionName=(\S+)", pkg).group(1),
        "lastUpdateTime": re.search(r"lastUpdateTime=(.+?)\s*$", pkg, re.M).group(1),
        "release": adb("getprop", "ro.build.version.release").strip(),
        "system_locales": adb("settings", "get", "system", "system_locales").strip(),
        "head": subprocess.run("git rev-parse HEAD", shell=True, capture_output=True, text=True).stdout.strip(),
    }
    note(f"被测包 {info['versionName']} / lastUpdateTime={info['lastUpdateTime']} / HEAD={info['head'][:8]}")
    ime = adb("ime", "list", "-s").split()
    for m in ime:
        adb("ime", "disable", m, check=False)
    adb("settings", "put", "secure", "show_ime_with_hard_keyboard", "0")
    info["imes_disabled"] = ime
    return info


def restore_ime(info):
    for m in info.get("imes_disabled", []):
        adb("ime", "enable", m, check=False)
    adb("settings", "put", "secure", "show_ime_with_hard_keyboard", "1")


info = preflight()
try:
    if "all" in PHASES or "seed" in PHASES:
        if not launch_app():
            raise SystemExit("拉不起 com.heyta 到前台")
        dismiss_gates()
        seed_tasks()
        seed_habit()
    if "all" in PHASES or "focus" in PHASES:
        if not launch_app(fresh=False):
            raise SystemExit("拉不起 com.heyta 到前台")
        start_focus()
    if "all" in PHASES or "capture" in PHASES:
        # 不起 fresh（见 launch_app 那段理由），只把焦点交回桌面
        adb("input", "keyevent", "KEYCODE_HOME")
        time.sleep(2)
        cases = capture()
    else:
        cases = []
    if "click" in PHASES:
        adb("input", "keyevent", "KEYCODE_HOME")
        time.sleep(2)
        clicked = click_leg()
        with open(f"{OUT}/click.json", "w", encoding="utf-8") as fh:
            json.dump({"serial": SERIAL, "device": info, "log": log, **clicked}, fh,
                      ensure_ascii=False, indent=2)
    if "killed" in PHASES:
        adb("input", "keyevent", "KEYCODE_HOME")
        time.sleep(2)
        killed = killed_leg()
        with open(f"{OUT}/killed.json", "w", encoding="utf-8") as fh:
            json.dump({"serial": SERIAL, "device": info, "log": log, **killed}, fh,
                      ensure_ascii=False, indent=2)
    if "lang" in PHASES:
        adb("input", "keyevent", "KEYCODE_HOME")
        time.sleep(2)
        lang = lang_leg()
        with open(f"{OUT}/lang.json", "w", encoding="utf-8") as fh:
            json.dump({"serial": SERIAL, "device": info, "log": log, **lang}, fh,
                      ensure_ascii=False, indent=2)
    if "bind" in PHASES:
        adb("input", "keyevent", "KEYCODE_HOME")
        time.sleep(2)
        size, cmps, _aw = bound_provider()
        if any("TodayWidgetProvider" in c for c in cmps):
            note(f"[绑卡] 桌面上已有 Today 实例，不重复绑：{bound_provider()}")
        else:
            ids = bind_one("今天的任务")
            note(f"[绑卡] 新绑一枚 Today：fav 行={ids} 现在={bound_provider()}")
    if "readcard" in PHASES:
        # 只读：把桌面上落在组件矩形里的文字打出来 + 存一份 JSON。
        # 用在"登录 → 造数据 → 退出登录"这类**跨趟**的读数之间，
        # 每一档用 CARD_TAG 区分，免得后一档覆盖前一档（陷阱 #275 那一族）。
        tag = os.environ.get("CARD_TAG", "now")
        adb("input", "keyevent", "KEYCODE_HOME")
        time.sleep(2)
        texts = card_area_texts(f"card-{tag}")
        size, cmps, aw_ids = bound_provider()
        payload = {"serial": SERIAL, "device": info, "log": log, "tag": tag,
                   "card_texts": texts, "card_cjk": has_cjk(texts),
                   "bound": {"size": size, "providers": cmps, "appwidget_ids": aw_ids}}
        with open(f"{OUT}/card-{tag}.json", "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        note(f"[读卡 {tag}] 卡上文字={texts} 在场实例={size} {cmps}")
        shot(f"card-{tag}.png")
    if "simult" in PHASES:
        adb("input", "keyevent", "KEYCODE_HOME")
        time.sleep(2)
        res = simult()
        with open(f"{OUT}/simult.json", "w", encoding="utf-8") as fh:
            json.dump({"serial": SERIAL, "device": info, "log": log, **res}, fh,
                      ensure_ascii=False, indent=2)
        note(f"[同屏] 结束：{len(res['placed'])} 枚实例已收掉，残留 {bound_provider()}")
    if "cleanup" in PHASES:
        done = cleanup()
        note(f"清理结果 {done}")
except SystemExit as e:
    restore_ime(info)
    raise
finally:
    if "seed" in PHASES:
        restore_ime(info)

if "all" in PHASES or "capture" in PHASES:
    prev = []
    try:
        prev = json.load(open(f"{OUT}/matrix.json"))["cases"]
    except Exception:
        pass
    merged = {c["name"]: c for c in prev}
    merged.update({c["name"]: c for c in cases})
    order = [n for n in WIDGETS if n in merged]
    with open(f"{OUT}/matrix.json", "w", encoding="utf-8") as fh:
        json.dump({"serial": SERIAL, "phase": PHASE, "seed": {"tasks": [t["title"] for t in TASKS],
                                                              "habit": HABIT, "focus": "started"},
                   "cases": [merged[n] for n in order], "device": info, "log": log},
                  fh, ensure_ascii=False, indent=2)
note(f"SIZE AFTER ALL: {bound_provider()}")
