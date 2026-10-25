#!/usr/bin/env python3
"""协作旅程装置的**锚点解析器**：从一次 AX 快照里挑出"可以按"的那一枚节点。

为什么它存在（2026-10-25 第 22 跑实测）：
  RN 的行在 iOS AX 树上把标签合成成「标题, 标题」（`profile-entry-settings` 那一枚
  逐字是 `设置, 设置`），而共享 shim 的 `--exact` 是**整串相等**才算命中 ⇒ 精确按压
  恒取空；装置随即退到"预检用子串命中的那枚节点的中心坐标"去点 —— 子串命中在
  「设置」这种短词上会抓到**别的行**（第 22 跑抓到过「AI 设置」组头所在的那一行，
  于是"走不到自托管表单"被报成了产品缺陷）。
  同一条形状在第 17 跑（「共享清单」）、第 14 跑（「我的」）都出现过。

判据的形状：
  · want 以 `id:` 开头 ⇒ 按 `AXUniqueId` 逐字相等取（RN 的 testID 在 iOS 落进这里）；
  · 否则命中条件 = 标签逐字等于 want，**或** want 是标签按 `,` 切分后的**整段**
    （`"设置, 设置"` 段 == 「设置」）。子串一律不算命中 —— 「我的」不许抓到
    「让 AI 记住我的偏好」。
  · 只认 shim 同一套「可点」定义（type ∈ PRESSABLE_TYPES / traits 含 Button /
    有 custom_actions），所以 `StaticText` 的标题不会冒充按钮。
  · 中心在屏幕外 ⇒ 回 `offscreen`（调用方先滚进可见区再重取，**不许按**：
    idb 的 tap 对屏外坐标是空操作且不报错，2026-10-02 实测）。
  · 同名多枚 ⇒ 回 `ambig` 并把候选标签都带出来，调用方必须改用 `id:` 锚点，
    而不是"取第一枚"。

自检（这条判据自己能不能红）：`python3 scripts/tools/ios-collab-anchor.py --selftest`
"""
import json
import sys
import unicodedata

PRESSABLE_TYPES = {
    "Button", "GenericElement", "Cell", "Link", "Toggle", "Switch", "MenuItem",
}
TAB_BAR_GUARD_PX = 0  # 屏内判定只看 frame，不看 tab 栏（tab 自己也是合法目标）


def flatten(data):
    roots = data if isinstance(data, list) else [data]
    out = []

    def walk(n):
        if not isinstance(n, dict):
            return
        out.append(n)
        for c in (n.get("children") or []):
            walk(c)

    for r in roots:
        walk(r)
    return out


def is_pressable(n):
    t = n.get("type") or ""
    if t == "Application":
        return False
    if t in PRESSABLE_TYPES:
        return True
    if "Button" in (n.get("traits") or []):
        return True
    return bool(n.get("custom_actions"))


def label_of(n):
    return unicodedata.normalize("NFKC", (n.get("AXLabel") or n.get("title") or "")).strip()


def strict_match(label_text, want):
    """逐字相等，或 want 是标签按 `,` 切分后的整段。子串不算。"""
    if label_text == want:
        return True
    return any(seg.strip() == want for seg in label_text.split(","))


def center_of(n):
    f = n.get("frame") or {}
    return (int(f.get("x", 0) or 0) + int(f.get("width", 0) or 0) // 2,
            int(f.get("y", 0) or 0) + int(f.get("height", 0) or 0) // 2)


def resolve(nodes, want, screen_w, screen_h):
    """⇒ (state, cx, cy, detail, enabled)。state ∈ hit|offscreen|none|ambig|bad-tree

    `enabled` 带出来是给**忙态探针**用的（第 22 跑同一类缺陷的第二处）：
    「按钮变灰过 = onPress 落上了」这一判据原本也走子串匹配，
    于是它可能读的是另一枚控件的 enabled。⇒ 命中条件与按压通道必须同一把尺。
    """
    if want.startswith("id:"):
        # `id:` 通道：按 AXUniqueId 逐字相等取，不看标签（RN 的合成标签在这条路上不参与）。
        want_id = want[3:]
        cands = [n for n in nodes if is_pressable(n) and (n.get("AXUniqueId") or "") == want_id]
    else:
        cands = [n for n in nodes if is_pressable(n) and strict_match(label_of(n), want)]
    if not cands:
        return ("none", -1, -1, "", "")
    if len(cands) > 1:
        return ("ambig", -1, -1, "|".join(label_of(n)[:28] for n in cands), "")
    node = cands[0]
    cx, cy = center_of(node)
    enabled = "" if node.get("enabled") is None else str(node.get("enabled")).lower()
    if not (0 <= cx < screen_w and 0 <= cy < screen_h):
        return ("offscreen", cx, cy, label_of(node), enabled)
    return ("hit", cx, cy, label_of(node), enabled)


def main(argv):
    if argv[1:2] == ["--selftest"]:
        return selftest()
    if len(argv) < 5:
        print("用法: ios-collab-anchor.py <dump.json> <want> <screen_w> <screen_h>")
        return 2
    try:
        nodes = flatten(json.load(open(argv[1], encoding="utf-8")))
    except Exception:  # noqa: BLE001 - 读不出树是装置问题，必须与"没有这枚节点"分开报
        print("bad-tree -1 -1 ''")
        return 2
    state, cx, cy, detail, enabled = resolve(nodes, argv[2], int(argv[3]), int(argv[4]))
    print(f"{state} {cx} {cy} {detail} {enabled}")
    return {"hit": 0, "offscreen": 1, "none": 1, "ambig": 3, "bad-tree": 2}[state]


def selftest():
    """喂真机现量的三种形状：合成名命中、子串不许命中、屏外不许按、同名多枚要响。"""
    fails = []

    def check(name, got, want):
        if got != want:
            fails.append(f"{name}: 得到 {got}，期望 {want}")

    tree = flatten([
        {"AXLabel": "heyta", "type": "Application", "frame": {"x": 0, "y": 0, "width": 402, "height": 874},
         "children": [
             {"AXLabel": "我的", "type": "StaticText", "traits": ["StaticText"],
              "frame": {"x": 16, "y": 80, "width": 370, "height": 20}},
             {"AXLabel": "设置, 设置", "type": "Button", "enabled": True,
              "AXUniqueId": "profile-entry-settings",
              "frame": {"x": 16, "y": 343, "width": 370, "height": 44}},
             {"AXLabel": "让 AI 记住我的偏好", "type": "Switch", "traits": ["Button"],
              "frame": {"x": 32, "y": 309, "width": 44, "height": 44}},
             {"AXLabel": "AI 设置", "type": "StaticText", "traits": ["StaticText"],
              "frame": {"x": 40, "y": 142, "width": 346, "height": 23}},
             {"AXLabel": "我的", "type": "GenericElement", "traits": ["Selected"],
              "frame": {"x": 321, "y": 776, "width": 80, "height": 64}},
         ]},
    ])
    # ① 合成名「设置, 设置」必须命中，且命中的是按钮那一枚
    st, cx, cy, _, en = resolve(tree, "设置", 402, 874)
    check("合成名精确命中", (st, cx, cy), ("hit", 201, 365))
    check("enabled 跟着带出来", en, "true")
    # ⑧ 忙态那一档要读得到 false：按钮 disabled 时 `enabled=false` 就是"onPress 落上了"的读数
    busy = [{"AXLabel": "创建钥匙, 创建钥匙", "type": "Button", "enabled": False,
             "frame": {"x": 10, "y": 10, "width": 40, "height": 40}}]
    check("变灰的按钮读得出 enabled=false", resolve(busy, "创建钥匙", 402, 874)[4], "false")
    # ② 「我的」：StaticText 标题不算，底部 tab（GenericElement）才算
    st, cx, cy, _, _ = resolve(tree, "我的", 402, 874)
    check("只认可以点的同名节点", (st, cx, cy), ("hit", 361, 808))
    # ③ 🔴 短词不许靠子串抓到别的行：这台机上「我的」也出现在
    #    「让 AI 记住我的偏好」里，把它换成 want=「记住我」时必须落空
    st, _, _, _, _ = resolve(tree, "记住我", 402, 874)
    check("子串不算命中", st, "none")
    # ④ 组头「AI 设置」不是按钮 ⇒ 按「AI 设置」应当落空（第 22 跑就是被它带偏的）
    st, _, _, _, _ = resolve(tree, "AI 设置", 402, 874)
    check("组头不算可点目标", st, "none")
    # ⑤ 屏外（滚动残留的负 y）必须回 offscreen，绝不按
    off = [{"AXLabel": "同步与隐私", "type": "GenericElement", "traits": ["Button"],
            "frame": {"x": 16, "y": -425, "width": 370, "height": 44}}]
    st, _, _, _, _ = resolve(off, "同步与隐私", 402, 874)
    check("屏外不许按", st, "offscreen")
    # ⑥ 同名两枚 ⇒ 响亮报 ambig，让调用方改 id: 锚点，而不是"取第一枚"
    two = [{"AXLabel": "加入", "type": "Button", "frame": {"x": 10, "y": 10, "width": 40, "height": 40}},
           {"AXLabel": "加入", "type": "Button", "frame": {"x": 10, "y": 100, "width": 40, "height": 40}}]
    st, _, _, _, _ = resolve(two, "加入", 402, 874)
    check("同名多枚要响", st, "ambig")
    # ⑦ 对照臂（这条判据到底有没有牙齿）：把命中条件换成"子串"，第③条就必须命中。
    #    对照臂不红 ⇒ 说明 fixture 根本没区分两种规则，自检是空转。
    global strict_match
    original = strict_match
    try:
        strict_match = lambda text, want: want in text  # noqa: E731 变异臂：只用于对照
        loose = resolve(tree, "记住我", 402, 874)[0]
    finally:
        strict_match = original
    if loose != "hit":
        fails.append(f"对照臂没红：子串规则下「记住我」仍然不落进按钮（得到 {loose}）⇒ fixture 失去区分度")

    # ⑨ id 通道：命中的是 AXUniqueId，与合成标签无关；同名两枚同样要响
    byid = [{"AXLabel": "同步与隐私, 同步与隐私", "type": "GenericElement", "enabled": True,
             "AXUniqueId": "settings-section-sync",
             "frame": {"x": 16, "y": 311, "width": 370, "height": 44}}]
    check("id 通道命中", resolve(byid, "id:settings-section-sync", 402, 874)[:3],
          ("hit", 201, 333))
    # 同一枚节点两条通道都要能取到（否则调用方换通道会悄悄换目标）
    check("标签通道命中同一枚", resolve(byid, "同步与隐私", 402, 874)[:3], ("hit", 201, 333))
    twoid = byid + [dict(byid[0], frame={"x": 16, "y": 400, "width": 370, "height": 44})]
    check("id 同名两枚要响", resolve(twoid, "id:settings-section-sync", 402, 874)[0], "ambig")

    if fails:
        print("锚点解析器自检 失败：")
        for f in fails:
            print("   ❌ " + f)
        return 1
    print("锚点解析器自检 12/12 通过")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
