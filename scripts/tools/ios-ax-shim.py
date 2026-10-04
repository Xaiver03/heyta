#!/usr/bin/env python3
"""
idb 版的 iOS 无障碍查询/操作 shim。
=====================================

## 为什么有这个东西

`scripts/verify-mobile-ios.sh` 原先用自研的 `tools/axpress.swift`（下称 AXPRESS），
它走的是**宿主**的无障碍树：拿 Simulator.app 窗口的矩形，在那块区域里找控件。

这条路有两个致命前提：

  1. `Simulator.app` 这个 **GUI 必须开着**（脚本第 0 步 `pgrep -x Simulator` 就是在查它）；
  2. 那个窗口必须**可见且没被盖住** —— 脚本自己的注释里记着，目标窗口被另一个项目的
     Simulator 窗口整块盖住，`mac clickin` 的遮挡闸直接拒绝（`遮挡=BLOCK`）。

而"为了让它能点就把窗口拽到前台"是**被明确叫停**的（等于跟用户抢前台）。
于是这个脚本**在当前环境下不可能通过**。

`idb` 走的是**另一条路**：它通过 companion 直接和模拟器通信，**从设备内部**取无障碍树、
发点击。坐标是**设备坐标**，所以**窗口遮挡彻底不再是问题**，也不需要任何窗口存在。

## 这个 shim 干什么

**保持 AXPRESS 的命令行契约不变**，只把底层换成 idb。
这样 `verify-mobile-ios.sh` 里那 15 个调用点**一行都不用改** ——
移植的风险被限制在这一个文件里。

契约（与原 AXPRESS 一致，值是**字符串**，因为调用方用 `jget` 取值后做字符串比较）：

  ax <标签|-> [--pressable] [--field] [--role R] [--wait N] \\
     (--list | --press | --set <值>) --json

  --list  → {"found":"True|False", "x":..,"y":..,"width":..,"height":..,
             "enabled":"True|False", "detail":".."}
  --press → {"result":"success"}        失败时 found=False / result=<原因>
  --set   → {"detail":"<回读值>"}

## 🔴 一条必须记住的设计约束

原脚本的注释里反复强调：**"设进去 AX 属性"不等于"输入真的进了应用"**。
本 shim 的 `--set` 用 `idb ui set-value`，它**同样只动无障碍值**。
所以 **`--set` 之后必须继续断言「添加」按钮的 enabled 由 false → true**（脚本第 3 步的 L3）
—— 那个 enabled 是 RN 根据输入内容算出来的，只有它变了才证明应用真的收到了文字。

**去掉那条 L3 断言，本 shim 的 `--set` 就会变成一个漂亮的假绿。**

## 🔴 三个"看起来能用、实际不能用"的动作（都实测过，别再试一遍）
##
## ⚠️⚠️ 2026-10-02 实测更新（iPhone Duo 折叠屏 / iOS 27.1，逻辑屏 466×678）：
##   下面第 1 条"滚动没有可用的办法"**已经被推翻**，但推翻它的方式很讲究，
##   每一层都得自己踩过才知道：
##
##   - 不带 `--duration` 的 swipe：**真的一点都不滚**（这条仍然成立）。
##     第 5 轮验收的灾难正是它造的：swipe 起点 y=618 落在**底部标签栏里**
##     （Duo 屏高 678，tab 行在 y=580..644），手势被「专注」tab 吃掉，
##     **整个认证页被切走** —— 四个字段"不在树上"、全部被容错分支跳过。
##   - `--duration` 的单位是**秒**（浮点），不是毫秒。`--duration 300`
##     = 300 秒的慢动作拖拽 —— 这才是"挂死 60 秒只挪 30px"的真因
##     （那次起点还落在别的控件上）。`--duration 0.3` = 快速甩动（带惯性，
##     过冲 2~3 倍，0.5 秒返回）；`--duration 1.0` = **直接操纵**（无惯性，
##     滚动距离 ≈ 拖拽距离，1.2 秒返回，实测 100px 拖拽滚动 90px）。
##   - swipe 起点**必须落在死区**（不在任何可交互控件上）：起点落在
##     TextField 上 = 聚焦它并弹键盘（页面重排、下半屏元素从树上消失）；
##     落在 tab 上 = 切页。⇒ `--scroll-into-view` 在动作前用**树本身**
##     找死区（叶子节点碰撞检测），而不是猜坐标。
##
## 1. **滚动 —— 现在有可用的办法**：`--scroll-into-view`（见下）。
##    底层是 `ui swipe x y0 x y1 --duration 1.0`（直接操纵、小步多段、每步复测）。
##    `idb ui scroll down` 仍然不能用的结论**没变**。
##
## 2. **`idb ui set-value` 对滚出屏幕的元素不生效，而且不报错。**（没变）
##    另加实测：marker 形式（`ui set-value <label> --match-key AXLabel`）对
##    屏外元素稳定报 "the element had moved by the time the write reached it"，
##    重试 4 次全败 —— 别用它替代滚动。
##
## 3. **`idb ui text` 抛异常**（老已知）—— 但 2026-10-02 实测它在
##    **聚焦的 secure 输入框**上是唯一可靠的写入方式：`set-value` 对
##    `secureTextEntry` 框 rc=0 却不进 RN 状态（`--secure` 分支见调用方）。
##    `ui text` 需要 `--udid`（多 companion 时缺它会静默打到别的设备上）。
"""

import argparse
import json
import subprocess
import sys
import time


def companion_args(companion):
    """Use TCP for a host:port companion, otherwise use a binary path.

    The bundled idb companion currently fails while creating Unix sockets on
    Xcode 27's iOS 27 runtimes, but the same companion serves the gRPC API over
    TCP. Keep the old path contract for existing scripts and make the transport
    choice explicit from the caller.
    """
    if ':' in companion and not companion.startswith('/'):
        return ["--companion", companion]
    return ["--companion-path", companion]


def dump_nodes(idb, companion, udid, attempts=3):
    """拉一次无障碍树，拍平成节点列表。失败返回空列表（调用方据此判 found=False）。

    🔴 **空树必须先重试再下结论**（2026-10-02 第 6 轮实测）：companion 的
    axbridge 会**间歇性**返回空树（`guest reader failed: Broken pipe`），
    症状是"字段上一瞬还在、下一瞬全没了" —— 不重试的话，set-value 的回读、
    滚动定位、type-text 全部跟着误报，而真伪差一秒。重试 3 次 × 0.5 秒
    只给真故障（应用死了/系统弹窗盖住）多付 1 秒。
    """
    for i in range(attempts):
        nodes = _dump_nodes_once(idb, companion, udid)
        if nodes:
            return nodes
        if i + 1 < attempts:
            time.sleep(0.5)
    return []


def _dump_nodes_once(idb, companion, udid):
    try:
        r = subprocess.run(
            [idb, *companion_args(companion), "ui", "describe-all", "--udid", udid],
            capture_output=True, text=True, timeout=45,
        )
    except (subprocess.TimeoutExpired, OSError):
        return []
    if r.returncode != 0:
        return []
    try:
        data = json.loads(r.stdout)
    except (json.JSONDecodeError, ValueError):
        return []
    roots = data if isinstance(data, list) else [data]
    out = []

    def walk(n):
        if not isinstance(n, dict):
            return
        out.append(n)
        for c in (n.get("children") or []):
            walk(c)

    for rt in roots:
        walk(rt)
    return out


def _traits(n):
    return n.get("traits") or []


PRESSABLE_TYPES = {
    "Button", "GenericElement", "Cell", "Link", "Toggle", "Switch", "MenuItem",
}


def is_pressable(n):
    """
    可点击吗。

    🔴 **不要按 `role` 过滤** —— 本仓库踩过：AX 的 role 不稳定，同一个按钮在不同
    状态下 role 会变，症状是"找不到按钮"。

    🔴 **必须包含 `GenericElement`**：RN 的**底部 tab**就是这么渲染的
    （实测「任务/日历/专注/我的」都是 `GenericElement`，traits 里没有 `Button`）。
    第一版只认 `Button`，结果脚本第 1 步那句 `ax "任务" --pressable --press` 直接
    `found=False` —— 而报出来的是"读不到 App 内容"，方向全偏到工具链上。

    🔴 **刻意不要求 `enabled=True`**：脚本第 3 步要断言「添加」按钮的
    **禁用态**（`enabled=False`）。在这里把禁用元素过滤掉，那条断言就会变成
    `found=False` —— 一个把"禁用"和"不存在"混为一谈的假红。

    另：排除 `Application` 根节点，它不是点击目标。
    """
    if (n.get("type") or "") == "Application":
        return False
    if (n.get("type") or "") in PRESSABLE_TYPES:
        return True
    if "Button" in _traits(n):
        return True
    return bool(n.get("custom_actions"))


def is_field(n):
    """是文本输入控件吗。role_description / type 在不同 RN 版本上写法不一，放宽匹配。"""
    hay = ((n.get("type") or "") + " " + (n.get("role_description") or "")).lower()
    hay = hay.replace("_", "").replace(" ", "")
    return "textfield" in hay or "searchfield" in hay


def label_of(n):
    return (n.get("AXLabel") or n.get("title") or "").strip()


def find(nodes, label, want_pressable, want_field, role, exact_only=False, occurrence=0):
    """
    先找**精确标签**，找不到再退化成子串匹配。

    🔴 子串匹配会撞车：仓库注释里记着，面板打开时「新建任务」同时是**底部 FAB**
    和**面板标题**，子串匹配会打到标题（370x23）上，却打出一句"按钮可见"——
    一个误导性的绿。所以**精确优先**是刻意的，不是随手写的。
    `exact_only`（--exact）把退化也关掉：当"精确打不中"本身就是判据时
    （composer_open / 关闭确认），子串退化会把撞车元素当成命中 —— 恒真判据
    比没有判据更糟（§7 元规则 2）。
    """
    pool = nodes
    if want_field:
        pool = [n for n in pool if is_field(n)]
    elif want_pressable:
        pool = [n for n in pool if is_pressable(n)]
    if role:
        pool = [n for n in pool if (n.get("role") or n.get("type") or "") == role]

    if label and label != "-":
        exact = [n for n in pool if label_of(n) == label]
        if exact:
            return exact[occurrence] if occurrence < len(exact) else None
        if exact_only:
            return None
        sub = [n for n in pool if label in label_of(n)]
        if sub:
            return sub[occurrence] if occurrence < len(sub) else None
        return None

    # 标签是 `-`：只要有一个符合类别约束的就行（原 AXPRESS 的 `-` 语义）
    return pool[occurrence] if occurrence < len(pool) else None


def frame_of(n):
    f = n.get("frame") or {}
    return (
        int(f.get("x", 0)), int(f.get("y", 0)),
        int(f.get("width", 0)), int(f.get("height", 0)),
    )


def center(n):
    x, y, w, h = frame_of(n)
    return x + w // 2, y + h // 2


def bool_str(v):
    return "True" if v else "False"


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False))


# ============================================================================
# 键盘遮挡 —— 一类**静默**失败
# ============================================================================
# 🔴 实测（iPhone 17 Pro 模拟器 / iOS 26.5）踩到的真实事故：
#
#   脚本在「我的」页填完三个输入框，然后 `--press "立即同步"`。
#   shim 取按钮中心 (201, 589) 发了一次 tap —— 而**软键盘正盖在那里**
#   （键盘首行 y=590，上面的 AutoFill「Passwords」条 y=539..583）。
#   于是那次 tap 落在了键盘上，同步**一次都没跑**。
#
#   而 shim 报的是 `result=success`（tap 这个系统调用确实成功了），
#   服务端则一条 Upload 都收不到 —— 排查方向被整体带到"客户端只拉不推"
#   这个**假根因**上，并写进了文档。
#
# 教训与前几轮同形：**"命令退出码 0" ≠ "点到了那个元素"**。
# 所以这里不再靠"调用成功"判定，而是显式判断**目标是否被键盘盖住**：
# 盖住就报 `tap-blocked-by-keyboard`，让调用方先收键盘 —— 绝不假装点到了。

# iOS 软键盘的按键节点带这个 trait（实测 'q'/'shift'/'return' 都有）。
# 这是**结构性**标记，不是靠标签猜的（`AXLabel` 随语言/输入法变）。
KEYBOARD_TRAIT = "KeyboardKey"

# AutoFill / 候选栏在按键行**上方**，且**它带不带 KeyboardKey 不稳定**：
#
#   实测 A（英文键盘，聚焦「端到端加密口令」）：候选/自动填充条「Passwords」
#     在 y=539..583，traits 里**没有** KeyboardKey；按键行从 y=590 起。
#     → min(KeyboardKey) 比键盘真实上沿**低 51px**。
#   实测 B（中文拼音候选栏）：候选条在 y=538..583，traits 里**有** KeyboardKey。
#     → min(KeyboardKey) 就是键盘真实上沿。
#
# 所以**不能**一律减一个固定值 —— 那会在 B 这种情形下多减一次，
# 把明明够得着的按钮判成"被挡住"（我自己先踩了一次：`添加` 中心 y=484，
# 减去 60 得 478，于是被误判挡住，整个第 4 步红掉）。
#
# 正确做法：先取 min(KeyboardKey) 作为基准，再**只在真的存在**一条紧贴在
# 它上沿之上、且接近全宽的横条（那就是候选/自动填充条）时，才把上沿抬高。
KEYBOARD_ACCESSORY_HEIGHT = 56
# 横条至少要占屏宽的这个比例，才认作候选/自动填充条（而不是某个普通控件）。
KEYBOARD_ACCESSORY_MIN_WIDTH_RATIO = 0.5


def screen_size(nodes):
    """设备逻辑分辨率 (宽, 高)。取自 `Application` 节点的 frame。

    找不到时返回 (None, None) —— **不要猜一个默认值**：猜错会让
    "元素是否在屏幕内"整条判据静默失效，而它正是"点得到 vs 点不到"的依据。
    """
    for n in nodes:
        if (n.get("type") or "") == "Application":
            _x, _y, w, h = frame_of(n)
            return w, h
    return None, None


def screen_width(nodes):
    return screen_size(nodes)[0]


def screen_height(nodes):
    return screen_size(nodes)[1]


def is_enabled(n):
    """节点是否启用。

    🔴 缺 `enabled` 键时**视为启用**：RN 不给静态文本标这个键，
    而"没标"不等于"禁用" —— 反过来判会让所有静态文本被当成不可点。
    """
    return n.get("enabled", True) is not False


def keyboard_top(nodes):
    """
    软键盘的**上边缘** y；没有键盘时返回 None。

    🔴 返回 None 与"返回一个很大的数"意义完全不同：前者是"没有键盘"，
    后者是"键盘占满屏幕"。混用会让"没键盘"的设备永远点不动。
    """
    key_tops = [
        frame_of(n)[1] for n in nodes if KEYBOARD_TRAIT in _traits(n)
    ]
    if not key_tops:
        return None
    top = min(key_tops)

    # 候选/自动填充条：贴在按键区上沿之上、接近全宽的一条横条。
    width = screen_width(nodes)
    min_width = None if width is None else width * KEYBOARD_ACCESSORY_MIN_WIDTH_RATIO
    for n in nodes:
        _x, y, w, _h = frame_of(n)
        if y >= top or top - y > KEYBOARD_ACCESSORY_HEIGHT:
            continue
        if min_width is not None and w < min_width:
            continue
        top = y
    return top


# ============================================================================
# 滚动 —— 2026-10-02 实测重建（背景见文件头第 1 条）
# ============================================================================
# 🔴 **swipe 的起点决定手势的归属**：落在 tab 上 = 切页（第 5 轮的灾难），
#    落在 TextField 上 = 聚焦 + 弹键盘（页面重排、树上元素消失）。
#    所以起点必须从**树本身**找死区，不能猜坐标。

# 底部标签栏不再从常数推导：它随设备而变（Duo 678 屏 tab 行在 y=580..644，
# 17 Pro 874 屏在 y≈776 起）。树里"贴着屏幕底缘的一排可点元素"就是它。
TAB_BAR_PROBE_COUNT = 5


def interactive_kind(n):
    """这个节点是否会把 touch 吃掉（点它不会变成滚动）。"""
    t = n.get("type") or ""
    if t in ("TextField", "Button", "Link", "Switch", "Toggle", "Slider", "SearchField"):
        return True
    if "Button" in _traits(n):
        return True
    if n.get("custom_actions"):
        return True
    return False


def leaf_nodes(nodes):
    """只保留**叶子**节点：容器（ScrollView/Application/Cell）的 frame
    罩着整屏，按它们做碰撞检测会把所有候选起点全部否掉。"""
    ids = set()
    def walk(n):
        if not isinstance(n, dict):
            return
        kids = n.get("children") or []
        if kids:
            for c in kids:
                walk(c)
        else:
            ids.add(id(n))
    for rt in nodes:
        walk(rt)
    return [n for n in nodes if id(n) in ids]


def tab_bar_top(nodes):
    """底部标签栏的上缘 y；认不出时返回 None。

    结构性判据：一排（≥3 个）**横向相接、整体贴着屏幕底缘且在屏内**的窄可点叶子。
    🔴 两个反例都实测过，别放宽：
      · 内容坐标在折叠线以下的元素（y > 屏高）同样满足"底边贴屏"——
        必须要求**整个 frame 在屏内**；
      · 「清单名称」这种全宽输入框 w=432 —— 标签是**窄**的，按屏宽 1/3 过滤。
    """
    h = screen_height(nodes)
    if h is None:
        return None
    w_screen = screen_width(nodes)
    bottom_band_top = h - 110
    cand = []
    for n in leaf_nodes(nodes):
        if not (is_pressable(n) or interactive_kind(n)):
            continue
        x, y, w, hh = frame_of(n)
        if hh <= 0 or w <= 0:
            continue
        # 日期网格最后一行也可能贴近屏幕底缘，但它的按钮高 44；真实底部
        # Tab 的触控行约 64 高。没有这个结构条件时，滚动起点会被错误地
        # 限制在日期网格上方，导致详情页后续字段永远滚不进来。
        if hh < 50:
            continue
        if w_screen and w > w_screen / 3:
            continue
        if not (bottom_band_top <= y and y + hh <= h + 2):
            continue
        cand.append((x, y, w, hh))
    if len(cand) < 3:
        return None
    cand.sort(key=lambda f: f[0])
    # 相邻元素必须横向相接且**同一排**（y 对齐），否则不是标签栏
    row = [cand[0]]
    for f in cand[1:]:
        if f[0] - (row[-1][0] + row[-1][2]) < 30 and abs(f[1] - row[-1][1]) < 20:
            row.append(f)
    if len(row) < 3:
        return None
    return min(f[1] for f in row)


def find_dead_zone(nodes, width, no_go_y, y_from=None, y_to=None):
    """找一个**不在任何交互叶子内**的 swipe 起点 candidate (x, y)。

    候选顺序：先水平中线，再左右留边。扫描带 [y_to, y_from] 由调用方按
    **拖拽方向**给：
      · 向上拖（看下面的内容）：起点要贴近底部（no_go 上方一点），
        上方留出整段行程；
      · 向下拖（看上面的内容）：起点要贴近顶部，下方留出整段行程。
    全找不到时返回 (None, None)（调用方报原因）。
    """
    leaves = [n for n in leaf_nodes(nodes) if interactive_kind(n)]

    def free(x, y):
        for n in leaves:
            nx, ny, nw, nh = frame_of(n)
            if nw <= 0 or nh <= 0:
                continue
            if nx - 6 <= x <= nx + nw + 6 and ny - 6 <= y <= ny + nh + 6:
                return False
        return True

    hi = no_go_y if y_from is None else y_from
    lo = 170 if y_to is None else y_to
    if width is not None:
        cx = width // 2
        # 边缘 10px 可能仍落入 RN 控件的碰撞保护边界（例如日期网格
        # x=16..78 会把 x=10 也视为占用）；用 2px 留给真正的空白区。
        xs = [cx, 2, (width - 2) if width > 4 else cx]
    else:
        xs = [200]
    for x in xs:
        y = hi
        while y > lo:
            if free(x, y):
                return x, y
            y -= 15
    return None, None


def idb_swipe(idb, companion, udid, x0, y0, x1, y1, duration):
    """发一条带 --duration（**秒**）的 swipe。返回 (rc, err)。"""
    try:
        r = subprocess.run(
            [idb, *companion_args(companion), "ui", "swipe",
             str(x0), str(y0), str(x1), str(y1),
             "--duration", str(duration), "--udid", udid],
            capture_output=True, text=True, timeout=30,
        )
        return r.returncode, (r.stderr or "").strip()[:120]
    except (subprocess.TimeoutExpired, OSError) as e:
        return -1, str(e)[:120]


def scroll_into_view(idb, companion, udid, label, want_pressable, want_field, role, occurrence=0):
    """
    把 label 指向的元素**真的滚进可见区**。返回 emit 用的 dict。

    判据（每一步都复测，不信任"我发出了手势"）：
      · 可见 = 元素中心 y < app_h - 120（留出底部标签栏）。
      · 元素中途从树上消失 ≠ "不用滚"：先往回滚一屏（向下拖）再找，
        找不到如实报 found=False —— **调用方据此判红**（第 5 轮的教训：
        "不在树上就跳过"把切页伪装成了"已设好"）。
    """
    out = {"found": "False", "x": "0", "y": "0", "width": "0", "height": "0",
           "visible": "False", "scrollRc": "", "swipes": "0", "detail": ""}
    nodes = dump_nodes(idb, companion, udid)
    if not nodes:
        out["scrollRc"] = "tree-empty"
        return out
    w, h = screen_size(nodes)
    vis_limit = (h - 120) if h else 700
    if h:
        # 无底部 Tab 的详情页仍需从屏底空白区起手；h-100 会把起点放在
        # 日期网格最后一行之上，手势落不到 ScrollView 的可拖拽区域。
        no_go = tab_bar_top(nodes) or (h - 80)
    else:
        no_go = 700

    def locate_now():
        # 🔴 返回 (node, nodes)：nodes 为 None = **树读空了**（区别于"树上没有这个
        #    元素"）。树空时**绝不能**做恢复滚动 —— 第 6 轮实测，恢复拖拽用的
        #    死区是上一棵树的（甚至完全没有叶子数据可查），起点可能落在键盘
        #    或控件上，把页面搅乱之后一串后续写入全部误报。
        for _ in range(5):
            ns = dump_nodes(idb, companion, udid)
            if ns:
                return find(ns, label, want_pressable, want_field, role, False, occurrence), ns
            time.sleep(1)
        return None, None

    node, nodes = locate_now()
    if node is None and nodes is None:
        out["scrollRc"] = "tree-empty-repeated"
        return out
    swipes = 0
    recoveries = 0
    while node is not None and swipes < 10:
        x, y, ww, hh = frame_of(node)
        if hh > 0 and (y + hh // 2) < vis_limit and y + hh > 0:
            out.update({"found": "True", "x": str(x), "y": str(y),
                        "width": str(ww), "height": str(hh),
                        "visible": "True", "swipes": str(swipes)})
            return out
        if y + hh <= 0:
            # 元素在视口上方（被滚过头了）：向下拖，让它落回 y≈140 处。
            # 起点必须在**上部**找（那里才有向下的行程），行程不够就分段。
            dist = max(140 - y, 80)
            sx, sy = find_dead_zone(nodes, w, no_go, y_from=min(no_go - 60, 170 + 200), y_to=170)
            if sx is None:
                out["scrollRc"] = "no-dead-zone"
                return out
            step = min(dist, no_go - 20 - sy)
            if step < 60:
                out["scrollRc"] = "no-room-to-drag-down"
                return out
            rc, err = idb_swipe(idb, companion, udid, sx, sy, sx, sy + step, 1.0)
            swipes += 1
            out["scrollRc"] = f"swipe rc={rc} {err}" if rc != 0 else ""
            time.sleep(1.4)
            node, nodes = locate_now()
            continue
        if y + hh // 2 >= vis_limit:
            # 元素在折叠线以下：向上滚（拖拽距离 = 超出量 + 余量，直接操纵无惯性）。
            # 起点在**底部**找（那里才有向上的行程）。
            # A short 60–90px drag can be accepted by idb/HID yet ignored by
            # RN ScrollView when the node is only just below the fold. Keep a
            # real gesture distance even for that edge case; otherwise the AX
            # tree is healthy but every retry sees the same y coordinate.
            dist = max((y + hh // 2) - vis_limit + 60, 180)
            dist = min(dist, max(y - 40, 60))
            # Leave a larger bottom margin. On iOS 27 a swipe beginning at
            # h-95 can be accepted by HID but land in the ScrollView's
            # non-scrolling tail; the same gesture from ~h-170 scrolls.
            sx, sy = find_dead_zone(nodes, w, no_go, y_from=no_go - 80, y_to=max(no_go - 300, 200))
            if sx is None:
                out["scrollRc"] = "no-dead-zone"
                return out
            step = min(dist, sy - 80)
            if step < 40:
                out["scrollRc"] = "no-room-to-drag-up"
                return out
            y1 = sy - step
            rc, err = idb_swipe(idb, companion, udid, sx, sy, sx, y1, 1.0)
            swipes += 1
            out["scrollRc"] = f"swipe rc={rc} {err}" if rc != 0 else ""
            time.sleep(1.4)
            node, nodes = locate_now()
            continue
        # y < vis_limit 但中心在折叠线上方？不可能到这——防御性兜底
        break

    if node is None:
        if nodes is None:
            # 树连续 5 次读空 —— 这不是"元素被滚走了"，是桥的问题。
            # **绝不做恢复滚动**（死区选点用的会是坏数据），如实上报给调用方重试。
            out["scrollRc"] = "tree-empty-repeated"
            return out
        # 树健康但元素不在：可能被滚过头了 —— 向下拖一屏再找。
        while recoveries < 2:
            recoveries += 1
            sx, sy = find_dead_zone(nodes, w, no_go, y_from=min(no_go - 60, 370), y_to=170)
            if sx is None:
                out["scrollRc"] = "no-dead-zone"
                return out
            step = min((h or 600) // 2, no_go - 20 - sy)
            if step < 60:
                out["scrollRc"] = "no-room-to-drag-down"
                return out
            rc, err = idb_swipe(idb, companion, udid, sx, sy, sx, sy + step, 1.0)
            time.sleep(1.4)
            node, nodes = locate_now()
            if node is not None:
                out["scrollRc"] = f"recovered-after-{recoveries}"
                return scroll_into_view(idb, companion, udid, label, want_pressable, want_field, role, occurrence)
            if nodes is None:
                # 恢复拖拽之后树读空了：停手，绝不能拿着坏数据再拖一次。
                out["scrollRc"] = "tree-empty-repeated"
                return out
        out["scrollRc"] = out.get("scrollRc") or "element-left-tree"
        return out

    x, y, ww, hh = frame_of(node)
    out.update({"found": "True", "x": str(x), "y": str(y),
                "width": str(ww), "height": str(hh),
                "visible": "False", "swipes": str(swipes)})
    return out


RETURN_KEY_LABELS = ("换行", "return", "Return", "done", "Done", "go", "Go",
                     "next", "Next", "search", "Search", "搜索", "send", "Send",
                     "发送", "下一步", "完成")


def type_text(idb, companion, udid, label, want_pressable, want_field, role, value, occurrence=0):
    """
    **聚焦输入框 + 模拟键盘输入**。返回 emit 用的 dict。

    🔴 为什么它必须存在（2026-10-02 实测）：`set-value` 对 **secure 输入框**
    rc=0、AXValue 也回读成掩码，但 **RN 的 onChangeText 没有被触发** ——
    界面上是一串圆点，表单状态里却还是空字符串（症状：状态栏报
    "还没设置端到端加密口令"）。`ui text` 走的是 HID 键盘事件，
    实测能把口令真正写进表单状态。它要求目标已聚焦，所以这里先 tap。
    """
    out = {"found": "False", "typedRc": "", "detail": ""}
    # 🔴 先滚进可见区：tap 对屏外坐标是空操作（不报错）—— 2026-10-02 实测。
    vis = scroll_into_view(idb, companion, udid, label, want_pressable, want_field, role, occurrence)
    if vis.get("visible") != "True":
        out["typedRc"] = f"not-visible ({vis.get('found')}/{vis.get('scrollRc')})"
        return out
    node, nodes = locate(argparse.Namespace(
        label=label, pressable=want_pressable, field=want_field, role=role,
        wait=3, exact=False, occurrence=occurrence,
        idb=idb, companion=companion, udid=udid))
    if node is None:
        out["typedRc"] = "not-found"
        return out
    cx, cy = center(node)
    try:
        subprocess.run(
            [idb, *companion_args(companion), "ui", "tap",
             str(cx), str(cy), "--udid", udid],
            capture_output=True, text=True, timeout=30)
    except (subprocess.TimeoutExpired, OSError) as e:
        out["typedRc"] = f"tap-failed {str(e)[:80]}"
        return out
    # 等键盘真的弹出来（最多 6 秒）—— 没键盘 = 没聚焦 = 打字会打飞
    kb_up = False
    for _ in range(6):
        time.sleep(1)
        if keyboard_top(dump_nodes(idb, companion, udid)) is not None:
            kb_up = True
            break
    if not kb_up:
        out["typedRc"] = "keyboard-did-not-appear"
        return out
    try:
        r = subprocess.run(
            [idb, *companion_args(companion), "ui", "text", value, "--udid", udid],
            capture_output=True, text=True, timeout=60)
        out["typedRc"] = str(r.returncode)
        if r.returncode != 0:
            out["typedRc"] += " " + (r.stderr or "").strip()[:100]
    except (subprocess.TimeoutExpired, OSError) as e:
        out["typedRc"] = f"text-failed {str(e)[:80]}"
        return out
    time.sleep(0.8)
    # 普通 TextInput 先在键盘仍显示时回读；点击 return/完成可能触发
    # onSubmitEditing（任务 Composer 会因此被提交并关闭）。只有字段因 secure
    # 聚焦从 AX 树隐藏时，才收键盘后重读。
    fresh = dump_nodes(idb, companion, udid)
    tx, ty, tw, th = frame_of(node)
    back = None
    for n in fresh:
        if is_field(n) and frame_of(n) == (tx, ty, tw, th):
            back = n.get("AXValue")
            break
    if back is None:
        dismiss_keyboard(idb, companion, udid)
        fresh = dump_nodes(idb, companion, udid)
        for n in fresh:
            if is_field(n) and frame_of(n) == (tx, ty, tw, th):
                back = n.get("AXValue")
                break
    if back is None:
        for n in fresh:
            if is_field(n) and label_of(n) == label_of(node):
                back = n.get("AXValue")
                break
    out["found"] = "True"
    out["detail"] = "" if back is None else str(back)
    return out


def dismiss_keyboard(idb, companion, udid):
    """
    收起软键盘。返回 emit 用的 dict。

    🔴 2026-10-02 实测的两个坑，都修在这一个动作里：
      1. 键盘的 return 键标签**随输入法语言变**（中文 = 「换行」，英文 =
         'return'）——按单一标签找会静默 no-op，然后调用方拿着"已收起"的
         假设继续跑。所以这里**按 KeyboardKey trait 结构性匹配**一组候选标签。
      2. `--keyboard` 的 present 判据要用收键后的**复测**收尾：键盘收起是
         一段动画，敲完立刻查会读到中间态。
    """
    for _attempt in range(3):
        nodes = dump_nodes(idb, companion, udid)
        if keyboard_top(nodes) is None:
            return {"present": "False", "key": ""}
        key = None
        for lbl in RETURN_KEY_LABELS:
            for n in nodes:
                if KEYBOARD_TRAIT not in _traits(n):
                    continue
                if label_of(n) == lbl and is_pressable(n):
                    key = n
                    break
            if key is not None:
                break
        if key is None:
            # 兜底：键盘右下角的键（return/done 几乎总在那里）
            keys = [n for n in nodes if KEYBOARD_TRAIT in _traits(n) and is_pressable(n)]
            if not keys:
                return {"present": "True", "key": "no-key-found"}
            key = max(keys, key=lambda n: (frame_of(n)[0] + frame_of(n)[2], frame_of(n)[1] + frame_of(n)[3]))
        kx, ky = center(key)
        try:
            subprocess.run(
                [idb, *companion_args(companion), "ui", "tap",
                 str(kx), str(ky), "--udid", udid],
                capture_output=True, text=True, timeout=30,
            )
        except (subprocess.TimeoutExpired, OSError):
            pass
        time.sleep(1.6)
        if keyboard_top(dump_nodes(idb, companion, udid)) is None:
            return {"present": "False", "key": label_of(key)}
    return {"present": "True", "key": "still-present"}


def locate(args):
    """
    带重试地找元素（对应原 `--wait N`）。

    🔴 注意这里返回的是 **(节点, 完整节点列表)**：`--set` 之后要重新拉一次树做回读，
    不能复用找元素时那一次的快照 —— 否则回读的是**设值之前**的值，那是个假绿。
    """
    deadline = time.time() + max(args.wait, 0)
    while True:
        nodes = dump_nodes(args.idb, args.companion, args.udid)
        n = find(nodes, args.label, args.pressable, args.field, args.role, args.exact, args.occurrence)
        if n is not None:
            return n, nodes
        if time.time() >= deadline:
            return None, nodes
        time.sleep(1)


def main():
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("label", nargs="?")
    p.add_argument("--udid", required=True)
    p.add_argument("--idb", required=True)
    p.add_argument("--companion", required=True)
    p.add_argument("--pressable", action="store_true")
    p.add_argument("--field", action="store_true")
    # 🔴 只做精确匹配、关掉子串退化（2026-10-02 加）：主界面排序 chip
    #    「排序：按添加时间」会被「添加」的子串匹配命中，composer_open 因此
    #    恒真（"按了取消还开着"的假卡住，verify 两轮红在同一处）。
    #    撞车的通用形态：探针的 label 是某真实元素 label 的**子串**。
    p.add_argument("--exact", action="store_true")
    p.add_argument("--occurrence", type=int, default=0,
                   help="同名 AX 节点按树顺序选择第几个（从 0 开始）")
    p.add_argument("--role")
    p.add_argument("--wait", type=int, default=0)
    p.add_argument("--list", action="store_true")
    p.add_argument("--press", action="store_true")
    p.add_argument("--set", dest="set_value")
    p.add_argument("--keyboard", action="store_true")
    # 🔴 2026-10-02 新增的三个动作（实现见上）：
    #   --scroll-into-view  把元素真的滚进可见区（死区起点 + 直接操纵 + 每步复测）
    #   --dismiss-keyboard  按 KeyboardKey trait 收软键盘（标签随输入法语言变）
    #   --type-text         聚焦 + HID 键盘输入（secure 框唯一实测能进 RN 状态的路）
    p.add_argument("--scroll-into-view", dest="scroll_into_view", action="store_true")
    p.add_argument("--dismiss-keyboard", dest="dismiss_keyboard", action="store_true")
    p.add_argument("--type-text", dest="type_text", metavar="VALUE")
    p.add_argument("--tap", nargs=2, metavar=("X", "Y"))
    p.add_argument("--json", action="store_true")
    args = p.parse_args()

    # ── 不依赖 label 的两个动作：收键盘前先问状态、以及"点空白处" ──────────
    if args.keyboard:
        nodes = dump_nodes(args.idb, args.companion, args.udid)
        kt = keyboard_top(nodes)
        emit({"present": bool_str(kt is not None),
              "top": str(int(kt)) if kt is not None else "-1"})
        return 0

    if args.dismiss_keyboard:
        emit(dismiss_keyboard(args.idb, args.companion, args.udid))
        return 0

    if args.scroll_into_view:
        emit(scroll_into_view(args.idb, args.companion, args.udid,
                              args.label, args.pressable, args.field, args.role,
                              args.occurrence))
        return 0

    if args.type_text is not None:
        emit(type_text(args.idb, args.companion, args.udid,
                       args.label, args.pressable, args.field, args.role,
                       args.type_text, args.occurrence))
        return 0

    if args.tap is not None:
        try:
            tx, ty = int(args.tap[0]), int(args.tap[1])
        except ValueError:
            emit({"result": "bad-coordinates"})
            return 0
        try:
            r = subprocess.run(
                [args.idb, *companion_args(args.companion), "ui", "tap",
                 str(tx), str(ty), "--udid", args.udid],
                capture_output=True, text=True, timeout=60,
            )
            ok = r.returncode == 0
        except (subprocess.TimeoutExpired, OSError):
            ok = False
        emit({"result": "success" if ok else "tap-failed"})
        return 0

    node, nodes = locate(args)

    if node is None:
        # found=False 是**给调用方断言用的**，不是"工具坏了"。
        # 原 AXPRESS 也是这个语义：查询失败不影响退出码，由调用方判。
        if args.press:
            emit({"result": "not-found"})
        else:
            emit({"found": "False", "x": "0", "y": "0",
                  "width": "0", "height": "0", "enabled": "False", "detail": ""})
        return 0

    x, y, w, h = frame_of(node)

    if args.press:
        cx, cy = center(node)
        # 🔴 点击之前先问一句"这个点真的能到达吗" —— 见上面「键盘遮挡」那段。
        kt = keyboard_top(nodes)
        if kt is not None and cy >= kt:
            emit({"result": "tap-blocked-by-keyboard",
                  "keyboardTop": str(int(kt)), "cy": str(int(cy))})
            return 0
        try:
            r = subprocess.run(
                [args.idb, *companion_args(args.companion), "ui", "tap",
                 str(cx), str(cy), "--udid", args.udid],
                capture_output=True, text=True, timeout=60,
            )
            ok = r.returncode == 0
        except (subprocess.TimeoutExpired, OSError):
            ok = False
        emit({"result": "success" if ok else "tap-failed"})
        return 0

    if args.set_value is not None:
        # 🔴 `set-value` 的 target 是 **"x y" 坐标或标记字符串**，不是 `--marker-type/--marker`。
        #    第一版用了那两个**根本不存在的 flag**，加上把 stderr 吞了，
        #    于是它**一次都没真正执行过**，却被当成"设值成功"。
        #
        # 🔴 也**不要**改成 `tap` + `idb ui text`：实测 `idb ui text` 在本机
        #    **抛异常**（Exception thrown in main），字符一个都没进去。
        #
        # ✅ 实测可用且**真的进了应用**的形式就是下面这句：
        #      idb ui set-value <x> <y> --value <文本>
        #    证据：设了文字之后「添加」按钮 `enabled` 由 false 变 **true** ——
        #    那个 enabled 是 RN 根据输入内容算出来的，只有应用真收到了才会变。
        cx, cy = center(node)
        # 🔴 **必须留下 idb 自己的退出码与 stderr。**
        #
        # 实测（2026-09-29）：同一条 `set-value` **有时 rc=0、有时 rc=1**，
        # 而 rc=1 时值**根本没变**。第一版把 `capture_output=True` 的结果**丢掉**、
        # 异常也 `pass` 掉 —— 于是"工具跑失败了"与"写进去了但回读方式不对"
        # 在调用方看来**完全一样**（都是 `detail=""`）。
        #
        # ⚠️ 这是本仓那条"**工具返回成功不等于生效**"的**反面**，而且更坏：
        #    **工具返回失败，而没有任何人看**。
        set_rc = None
        set_err = ""
        try:
            r = subprocess.run(
                [args.idb, *companion_args(args.companion), "ui", "set-value",
                 str(cx), str(cy), "--value", args.set_value, "--udid", args.udid],
                capture_output=True, text=True, timeout=60,
            )
            set_rc = r.returncode
            set_err = (r.stderr or "").strip()[:200]
        except subprocess.TimeoutExpired:
            set_rc = -1
            set_err = "timeout"
        except OSError as e:
            set_rc = -2
            set_err = str(e)[:200]
        # 回读必须**重新拉树**，否则读到的是设值前的旧值。
        time.sleep(0.6)
        # 🔴 先在键盘仍显示时按原坐标回读。普通 TextInput 可以直接读到值；
        #    这条路径不能先点击键盘的 return/完成，因为任务 Composer 的
        #    onSubmitEditing 会把收键盘误当成提交并关闭面板。只有 secure 框因聚焦
        #    从 AX 树隐藏时，才退回到收键盘后重读。
        #    实测踩到：「我的」页上「服务器地址」本来就有内容，于是填空「访问令牌」之后
        #    回读拿到的是**服务器地址的值**（http://127.0.0.1:3000）——
        #    脚本于是报"填写访问令牌失败"，而真因是**我读错了框**。
        fresh = dump_nodes(args.idb, args.companion, args.udid)
        tx, ty, tw, th = frame_of(node)
        back = None
        for n in fresh:
            if not is_field(n):
                continue
            if frame_of(n) == (tx, ty, tw, th):
                back = n.get("AXValue")
                break
        if back is None:
            kb = dismiss_keyboard(args.idb, args.companion, args.udid)
            if kb.get("present") == "True":
                time.sleep(0.5)
            fresh = dump_nodes(args.idb, args.companion, args.udid)
            for n in fresh:
                if is_field(n) and frame_of(n) == (tx, ty, tw, th):
                    back = n.get("AXValue")
                    break
        if back is None:  # 兜底：frame 变了（布局移动）时退回按标签找
            for n in fresh:
                if is_field(n) and label_of(n) == label_of(node):
                    back = n.get("AXValue")
                    break
        emit({
            "detail": "" if back is None else str(back),
            # 调用方据此区分"工具失败了"与"写进去了" —— 见上面的说明。
            "setRc": "" if set_rc is None else str(set_rc),
            "setErr": set_err,
        })
        return 0

    # 默认就是 --list
    emit({
        "found": "True",
        "x": str(x), "y": str(y),
        "width": str(w), "height": str(h),
        "enabled": bool_str(node.get("enabled")),
        "detail": "" if node.get("AXValue") is None else str(node.get("AXValue")),
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
