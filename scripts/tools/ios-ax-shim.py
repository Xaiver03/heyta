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

1. **滚动 —— 目前没有可用的办法。** 这直接决定了 iOS 验收**只能覆盖首屏可见内容**；
   需要滚动才能到达的东西，请到 Android 侧验（`adb shell input swipe` 是好的）
   或者把元素挪进首屏。

   - `idb ui swipe X1 Y1 X2 Y2 --duration D`：**会滚，但只滚一点点然后挂死。**
     实测 `ui swipe 201 750 201 150 --duration 800`：60 秒后仍未返回（rc=124），
     内容只移动了 **30px**（600px 的行程）。不传 `--duration` 时能返回，
     但**一点都没滚**。
   - `idb ui scroll down`（不带目标）：`describe-all` 的 y **完全不动**。
     它先做一次坐标探针，报 `the point is empty` 或 `found no element`，
     然后什么都不做 —— **退出码还可能是 1**。
     ⚠️ 我第一次"测出它有效"（y 862→542）是**假的**：那次变化的真正来源是
     被 `timeout` 杀掉的 `ui swipe` 在 companion 侧继续跑完。**先有机制猜想、
     再去找证据，就会把巧合读成因果**（AGENTS.md §7 第 38 条同族）。
   - `idb ui scroll down <坐标>` / `<标记>`：坐标点落在**空白 View** 上时
     报 `the point is empty`；落在 `TextInput` 上时报
     `the element had moved by the time the write reached it`。都不滚。

2. **`idb ui set-value` 对滚出屏幕的元素不生效，而且不报错。**
   元素在 y=1357（屏高 874）时 `--set` 返回 `{"detail": "<placeholder>"}` ——
   回读是**占位符**，即写入没发生。回读是唯一能发现这件事的判据，别把
   "命令返回成功"当成"写进去了"。

3. **`idb ui text` 抛异常**（老已知）。
"""

import argparse
import json
import subprocess
import sys
import time


def dump_nodes(idb, companion, udid):
    """拉一次无障碍树，拍平成节点列表。失败返回空列表（调用方据此判 found=False）。"""
    try:
        r = subprocess.run(
            [idb, "--companion-path", companion, "ui", "describe-all", "--udid", udid],
            capture_output=True, text=True, timeout=60,
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


def find(nodes, label, want_pressable, want_field, role):
    """
    先找**精确标签**，找不到再退化成子串匹配。

    🔴 子串匹配会撞车：仓库注释里记着，面板打开时「新建任务」同时是**底部 FAB**
    和**面板标题**，子串匹配会打到标题（370x23）上，却打出一句"按钮可见"——
    一个误导性的绿。所以**精确优先**是刻意的，不是随手写的。
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
            return exact[0]
        sub = [n for n in pool if label in label_of(n)]
        if sub:
            return sub[0]
        return None

    # 标签是 `-`：只要有一个符合类别约束的就行（原 AXPRESS 的 `-` 语义）
    return pool[0] if pool else None


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


def locate(args):
    """
    带重试地找元素（对应原 `--wait N`）。

    🔴 注意这里返回的是 **(节点, 完整节点列表)**：`--set` 之后要重新拉一次树做回读，
    不能复用找元素时那一次的快照 —— 否则回读的是**设值之前**的值，那是个假绿。
    """
    deadline = time.time() + max(args.wait, 0)
    while True:
        nodes = dump_nodes(args.idb, args.companion, args.udid)
        n = find(nodes, args.label, args.pressable, args.field, args.role)
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
    p.add_argument("--role")
    p.add_argument("--wait", type=int, default=0)
    p.add_argument("--list", action="store_true")
    p.add_argument("--press", action="store_true")
    p.add_argument("--set", dest="set_value")
    p.add_argument("--keyboard", action="store_true")
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

    if args.tap is not None:
        try:
            tx, ty = int(args.tap[0]), int(args.tap[1])
        except ValueError:
            emit({"result": "bad-coordinates"})
            return 0
        try:
            r = subprocess.run(
                [args.idb, "--companion-path", args.companion, "ui", "tap",
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
                [args.idb, "--companion-path", args.companion, "ui", "tap",
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
                [args.idb, "--companion-path", args.companion, "ui", "set-value",
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
        # 🔴 回读必须锚定**同一个字段**（比 frame），不能取"第一个非空的字段"。
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
