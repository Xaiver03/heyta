#!/bin/bash

# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 对脚本是按字节偏移
#    增量读取的：运行中被编辑，后半段就从错位字节开始解析，炸出假语法错误。
#    入口先把整份脚本拷成同目录隐藏快照再 exec 副本 —— 之后对源文件的任何
#    编辑都影响不到本次运行；$0 的 dirname 不变，lib/tools 定位照旧。
#    快照名 .原名.snap.PID（进 .gitignore）；trap 尽力清理，被 kill -9 留下的
#    由下一次运行按 mmin +240 顺带扫掉。
case "$(basename "$0")" in
  .*.snap.*) ;; # 已是快照：正常往下跑
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    find "$_snap_dir" -maxdepth 1 -name ".$(basename "$0").snap.*" -mmin +240 -delete 2>/dev/null || true
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" > "$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac
trap 'rm -f -- "$0"' EXIT
#
# 移动端「AI 助手」真机验收（真模拟器 + 真服务端 + 确定性假端点，零 mock 产品代码）
# ============================================================================
#
# 🔴 为什么必须有这个脚本
#
# 助手的五个能力在**代码层**已经接到移动端（`check:ai-coverage` 报 mobile 5/5），
# 而那条门禁核的是「入口被 import 且那文件被渲染」。它结构上答不出另一件事：
# **点进去以后，界面上真的走得完吗**。这批缺陷里最难归的正是「零件都在、没人接线」
# 那一类（AGENTS §7 反复出现）：类型检查绿、构建绿、门禁绿，界面上就是没有这个功能。
# `verify:mobile-*` 里覆盖助手的那条**恰好 0 个**（现量：
# `grep -rlE "assistant|助手" scripts/verify-mobile-*.sh | wc -l`），所以本脚本补的是
# **载体本身**，不是又一份单测。
#
# ── 🔴 锚点通道：定位按 resource-id，断言按文字 ─────────────────────────
#
# 第一版整篇按 content-desc 找按钮，写完对着源码逐条复核，查出两种错：
#
#   1. **有一枚按钮根本不存在**。旧稿填完端点表单去点「保存」—— `AiSettingsSection`
#      里没有「保存」：三个字段常驻，提交动作就是「添加自定义端点」那一次点击。
#      而旧稿那一行写成「取不到坐标就不点」，于是「存端点」从未发生，后面每一步
#      都在对一个没配好的界面打分，症状恰好是"找不到入口"——会被归因成界面变了
#      （§7 第 46 条：没复现 ≠ 路径没执行）。
#   2. **同一个 label 在树里出现多次**。「授权」是五个功能块各一枚（同一屏），
#      「拆解任务」在设置页和助手页各有一套，「发送」既是披露步的 ai-send 也是
#      工具档的 tool-start-assistant（§7 第 236 条：重复 AX 名必须带 occurrence 传递）。
#
# 所以本脚本的分工：**要点的按 testID（uiautomator 的 resource-id）定位，要证的按文字断言**。
# 理由不是省事 —— `testID` 在源码里、能静态对账；而"某个 label 最终落在哪个节点上"
# 取决于 kit 的哪个组件给它写了 accessibilityLabel，换一次组件就漂。
# lib 里 `configure_sync_credentials` 早就是走 `resource-id="profile-entry-settings"`
# 这条稳定锚点（那里的注释写明"不走文字"），本脚本沿用同一条通道，不另造第三种。
#
# ⚠️ `enabled` / `checked` / `selected` 也读：uiautomator 把 RN 的 `accessibilityState`
#    落在这些属性上。「那枚按钮在树里」和「那枚按钮点得动」是两件事，
#    「点过了开关」和「开关现在开着」也是两件事（记忆：exists ≠ 可点）。
#
# 验的是七条链，每条都要能红：
#
#   1. **入口由本机配置决定进不进树**（`aiEntryVisible = isAiConfiguredOnThisDevice(…)`）：
#      配端点**之前** `profile-entry-assistant` 不在树里，配好之后在。一缺一现成对，
#      单测一侧那种"关掉的模块不进 DOM"承诺在设备上也要有读数。
#   2. **明文 + 非回环存不进去**（`validateEndpointUrl` 的 `plaintext-remote`）：
#      断言**两句** —— 那句校验话在屏上，**且端点行数没有增加**。只看文案的话，
#      "报了错但照样落库"是最难看的一种假绿。
#   3. **规则先跑、命中即零外发**（Goal-1 的设备级形状）：「list all tasks」这句
#      本机规则就能答，判据不是界面写了什么，而是**假端点 `/__requests` 计数一次没动**。
#      这一段跑在**还没同意联网**那一档，所以它同时被隐私层与规则短路两层守着。
#   4. **授权入口按地址类别出现/消失**（Goal-7a 的 `classifyDestination` 维度在界面上的对应物）：
#      「拆解任务」路由 chip 指向**非回环**时 `ai-consent-breakdown` **出现**；
#      换回**回环**假端点时同一枚**消失**。再加一支对照：同一屏里选中 chip 仍是回环的
#      那一档**不该**有授权入口 —— 只测"出现"挡不住"永远出现"。
#   5. **未授权时闸门在 socket 之前**：披露步给 consentLead 那句，硬点「发送」之后
#      假端点计数**仍然不动**，且失败句是 `egressNotAuthorized` 那一句。
#      用 192.0.2.1 这条**永不路由**地址的理由写在下面「端点为什么只能用回环」。
#   6. **只产出提案**：出提案卡后**不点确认** ⇒ 手机本地库**恰好 0 条新 op**。
#      这条必须是设备级：单测能证明 confirm 之前没调 `host.submit`，
#      证明不了界面上那个确认按钮之外没有别的路径把提案写下去。
#   7. **确认才写、写多少条可数、且到得了另一台设备**：点「写入备注」⇒ 恰好 +1 条
#      `TASK/UPD`，载荷键集合就是 `note`（多带一个键违反"一个意图一个 op"，§3.4）；
#      再由笔记本（node-host 真 SQLite）解密读到 source=remote。⚠️ 服务端只存密文，
#      那里**只数条数**（§7 第 52 条）。
#
# 🔴 端点为什么只能用回环（这不是偷懒，是被自己的规则钉住的）
#
# `packages/ai/src/routing.ts` 的 `validateEndpointUrl`：回环允许明文 http，
# **远端必须 https**（理由写在那段注释里：AI 这条路走明文 http 会让端到端加密的承诺自相矛盾）。
# 所以本 rig 不能给模拟器配 `http://10.0.2.2:4399/v1` —— 那条存进去就会被拒（第 2 链正好利用它）。
# 可达的假端点只有**设备回环**：`adb reverse tcp:<port> tcp:<port>` 把设备的
# 127.0.0.1:<port> 接到宿主机同一端口，`e2e/stub-provider.mjs` 保持它默认的
# **127.0.0.1 绑定**（不改共享夹具、不在局域网里开洞）。
# 而"非回环"那一档不需要可达也能验：闸门判的是**URL 字面量的地址类别**，
# 明确写在 `supply.ts` 文件头的前提 1（不做 DNS 解析，"宁可多问一次"）。
# 因此第 5 链用一个**永不路由**的 TEST-NET-1 地址（192.0.2.0/24，RFC 5737）：
# 它能被存进配置（https），却不可能有真服务器 —— 于是"授权前一个字节都不发"
# 判据没有第二种解释方式。
#
# ⚠️ 三条已知边界（不假装做了）：
#   · **托管档不在本脚本里**：境内白名单、计量、售卖那三层是服务端判据，
#     设备这层只验"自己的端点"这两条路（回环 / 非回环）。
#   · **iOS 侧不在本脚本里**：这是 adb 载体；iOS 需要另一条 idb 载体（台账 W13）。
#   · **多轮对话的会话实体**（ASSISTANT_TURN）目前**只有 node-host 在写**
#     （`check:reachability` 断言 C 只回答"有没有宿主接了"）⇒ 移动端那一半是 W15，
#     本脚本不替它主张任何读数。
#
set -u
export PATH="/opt/homebrew/bin:$PATH"

. "$(dirname "$0")/lib/mobile-e2e-fresh-account.sh"
. "$(dirname "$0")/lib/mobile-e2e.sh"
. "$(dirname "$0")/lib/wait-for-quiet-host.sh"
. "$(dirname "$0")/lib/apk-freshness.sh"

# ── 本 rig 自己的旋钮（都在 source 之后定，lib 会覆盖同名全局）────────────
STUB_PORT="${HEYTA_AI_STUB_PORT:-4399}"
STUB_HOST_URL="http://127.0.0.1:${STUB_PORT}"
# 设备看到的"本机端点"：adb reverse 把设备 127.0.0.1:STUB_PORT 接到宿主机。
DEVICE_LOOPBACK_URL="http://127.0.0.1:${STUB_PORT}/v1"
# RFC 5737 TEST-NET-1：永不路由。它能被存进配置（https）但不可能有真服务器。
DEVICE_REMOTE_URL="https://192.0.2.1/v1"
# 明文 + 非回环：这条**必须存不进去**（validateEndpointUrl 的 plaintext-remote）。
DEVICE_PLAINTEXT_REMOTE_URL="http://192.0.2.1:${STUB_PORT}/v1"

# 🔴 端点名一律 ASCII，两个理由都承重：
#   ① §7 第 43 条：`adb shell input text` 发不了非 ASCII（实测抛 NullPointerException，
#      而退出码仍可能是 0）；
#   ② 这些名字**会**变成界面上的 chip 与行标题，但它们不是词条 —— 混进 needle 集合
#      会被 `check:verify-script-copy` 报成"缺失词条"（假缺陷；本仓实测报过两条）。
EP_LOOPBACK="stub-loopback"
EP_REMOTE="stub-remote"
EP_PLAINTEXT="stub-plaintext"

LAPTOP_DB="/tmp/heyta-ai-laptop.sqlite"
PHONE_DB="/tmp/heyta-ai-phone.sqlite"
EVIDENCE="$HEYTA_REPO_ROOT/apps/mobile/evidence"
STUB_LOG="/tmp/heyta-ai-stub.log"
STUB_PIDFILE="/tmp/heyta-ai-stub.pid"

# 种子与断言输入的 needle 一律 ASCII；**断言用的界面文案**才用中文，逐字取自
# packages/i18n 的 zh-CN 表（`check:verify-script-copy` 就是拿那张表对账这些串）。
TASK_TITLE="ai-e2e-$(date +%H%M%S)-seed"
NOTE_MARK="ai-e2e-$(date +%H%M%S)-laptop"

# ── resource-id 锚点（见文件头「锚点通道」）───────────────────────────
# 一次 dump 之内对同一棵树取值，读不到打印空串（**不打印 0，不猜坐标**）。
rid_attr() {  # <testID> <attribute>
  HEYTA_RID="$1" HEYTA_ATTR="$2" python3 - <<'PY'
import os, re, sys
try:
    s = open(os.environ["UI_XML"]).read()
except OSError:
    sys.exit(0)
rid, attr = os.environ["HEYTA_RID"], os.environ["HEYTA_ATTR"]
for m in re.finditer(r"<node\b[^>]*>", s):
    tag = m.group(0)
    if 'resource-id="%s"' % rid in tag:
        d = re.search(r'\b%s="([^"]*)"' % re.escape(attr), tag)
        print(d.group(1) if d else "")
        sys.exit(0)
PY
}
rid_center() {  # <testID> → "x y"；不在树里或有尺寸却为空则空串
  HEYTA_RID="$1" python3 - <<'PY'
import os, re, sys
try:
    s = open(os.environ["UI_XML"]).read()
except OSError:
    sys.exit(0)
rid = os.environ["HEYTA_RID"]
for m in re.finditer(r"<node\b[^>]*>", s):
    tag = m.group(0)
    if 'resource-id="%s"' % rid not in tag:
        continue
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
    if not b:
        continue
    x1, y1, x2, y2 = (int(g) for g in b.groups())
    if x2 <= x1 or y2 <= y1:
        continue
    print((x1 + x2) // 2, (y1 + y2) // 2)
    sys.exit(0)
PY
}
# 滚到某个 resource-id 可见并点它。点之前**必须**证明它 enabled ——
# RN 的 disabled Button 在树里照样存在，点了是静默无操作。
# 🔴 安全带的上下界**从设备的 inset 现取**，不拿屏幕高度的四分之一拍：
#    `overrideNonDecorFrame=[0,0][1080,2337]` = 去掉系统导航条后可用区的下沿，
#    `overrideConfigInsets=[0,63][0,63]` 的第一个 63 = 状态栏高度（可点区要避开它）。
#    为什么不能用"中间一半"这种比例：实测 `ai-endpoint-label` 中心 y=2112、url y=2335
#    都**点得动并输入成功**（`tmp/probe-form.xml` 里两格的 text 就是我打进去的值），
#    而按 [H/4,3H/4]=[600,1800] 会把它们判成"贴着边、先滚进来"，
#    滚到内容到底之后仍然出不来带 ⇒ 报成"端点表单里滚不出那一格"（rig13 实测）。
#    真正点不动的那一枚在 y=2373 —— 恰好落在 2337 之外（rig11 实测）。
DECOR=$($ADB shell dumpsys window displays 2>/dev/null | tr -d '\r' | grep -m1 'ROTATION_0=')
SAFE_TOP=$(printf '%s' "$DECOR" | grep -oE 'overrideConfigInsets=\[0,[0-9]+\]' | grep -oE '[0-9]+' | head -1)
SAFE_BOTTOM=$(printf '%s' "$DECOR" | grep -oE 'overrideNonDecorFrame=\[0,0\]\[[0-9]+,[0-9]+\]' | grep -oE '[0-9]+' | tail -1)
for v in SAFE_TOP SAFE_BOTTOM; do
  got=${!v}
  case "$got" in
    ''|*[!0-9]*)
      echo "   ❌ 取不到 $v（dumpsys 的 ROTATION_0 那行没给出可点区）—— 安全带没有边界，载体不成立" >&2
      exit 3;;
  esac
done

tap_rid() {  # <testID> [期望 checked]
  local rid=$1 want=${2:-} i ctrl cx cy ck src y lo hi
  lo=$SAFE_TOP
  hi=$SAFE_BOTTOM
  for i in 1 2 3 4 5; do
    dump
    # 🔴 点的是**带 checked / clickable 的那一枚**（容器不可点时往下找一层），
    #    见 rid_control 的注释：`ai-gate-enabled` 这一枚连点 5 次都打在标签文字上，
    #    报出来的却是"总开关点不动"。
    ctrl=$(rid_control "$rid")
    if [ -n "$ctrl" ]; then
      read -r cx cy ck src <<<"$ctrl"
      y=$cy
      if [ "$y" -ge "$lo" ] && [ "$y" -le "$hi" ]; then break; fi
      # 在树里但贴着屏边 —— 这不是"没找到"，是"还没滚到位"，两句话要分开说。
      echo "   ↻ testID=$rid 的可点节点（${src}）中心 y=$y 在安全带 [$lo,$hi] 外（贴系统栏），先滚进中段（第 ${i} 次）" >&2
    fi
    ctrl=""
    $ADB shell input swipe 540 1900 540 900 300
    sleep 1.5
  done
  if [ -z "$ctrl" ]; then
    echo "   ❌ testID=$rid 滚了 5 次仍没有一枚落在安全带 [$lo,$hi] 里的可点节点 —— 界面形状或 testID 变了" >&2
    return 1
  fi
  if [ "$(rid_attr "$rid" enabled)" = "false" ]; then
    echo "   ❌ testID=$rid 在树里但 disabled —— 点了不会有任何事发生，先补齐它的前置条件" >&2
    return 1
  fi
  echo "   · 点 testID=$rid → 落在 [${src}] @ ${cx},${cy}" >&2
  $ADB shell input tap "$cx" "$cy" >/dev/null 2>&1
  sleep 1
  if [ -n "$want" ]; then
    dump
    got=$(gate_state "$rid")
    if [ "$got" != "$want" ]; then
      echo "   ❌ testID=$rid 点完之后 checked=${got:-读不出}，期望 $want（读的是 [${src}] 那一枚，不是容器）" >&2
      return 1
    fi
  fi
  return 0
}
# 状态一律从**带 checked 的那一枚**读：容器（ViewGroup）上的 checked 恒 false，
# 拿它当判据等于写一条永远不可能成立的断言。
gate_state() {  # <testID> → true / false / 空
  local ctrl ck
  ctrl=$(rid_control "$1")
  [ -z "$ctrl" ] && return 0
  read -r _ _ ck _ <<<"$ctrl"
  printf '%s' "$ck"
}
has_rid() {  # <testID> → 1/0
  dump
  [ -n "$(rid_center "$1")" ] && echo 1 || echo 0
}
# 🔴 在一个块（testID）的矩形里找出**真正能点、能读状态的那一枚节点**。
# 为什么必须有这一层（2026-10-06 实测，`ai-gate-enabled`）：
#   `GateRow` 是 `<View testID="ai-gate-enabled">` 包着 `<Checkbox>`（AiSettingsSection.tsx:526），
#   所以 testID 落在一枚 **clickable=false、checkable=false、没有 checked 语义** 的 ViewGroup 上：
#     · `tap_rid` 点它的中心 = 点在**标签文字**上 ⇒ 静默无事发生；
#     · `rid_attr ai-gate-enabled checked` 读的是那枚容器的 checked ⇒ **恒为 false**，
#       于是"开关没开"是一条**永远不可能成立**的判据，症状却写成"产品坏了"
#       （§7 元规则二：一条判据能不能失败，只由现量与变异回答）。
#   同一矩形里真正的那枚是 `android.widget.CheckBox` [87,638][202,754]，
#   clickable=true、checkable=true、checked 跟着 on 走。
# 打印四段：`<x> <y> <checked> <来源>`，来源是 `self` 或 `child:<class>:<content-desc>` ——
# 让读数自己交代"点的是谁"，别把容器的静默无操作冒充成控件的行为。
rid_control() {  # <testID>
  HEYTA_RID="$1" python3 - <<'PY'
import os, re, sys
try:
    s = open(os.environ["UI_XML"]).read()
except OSError:
    sys.exit(0)
rid = os.environ["HEYTA_RID"]
nodes = []
for m in re.finditer(r"<node\b[^>]*>", s):
    d = dict(re.findall(r'(\w[\w-]*)="([^"]*)"', m.group(0)))
    # 🔴 这里搜的是**属性值**（`d['bounds']` 已经是 `[x1,y1][x2,y2]`），所以模式里不许带
    #    `bounds="` 那层前缀 —— 带上就是永不相等：整棵树被读成 0 枚节点，rid_control 恒空，
    #    于是 tap_rid 每一枚都报「滚了 5 次仍没有落在安全带里的可点节点」。
    #    （`rid_center` 那份是在**原始标签文本**上搜，那里带前缀才对 —— 两处不是同一把尺。）
    b = re.search(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', d.get('bounds', ''))
    if not b:
        continue
    d['_b'] = [int(g) for g in b.groups()]
    nodes.append(d)
host = next((n for n in nodes if n.get('resource-id') == rid), None)
if host is None:
    sys.exit(0)


def emit(n, src):
    x1, y1, x2, y2 = n['_b']
    if x2 <= x1 or y2 <= y1:
        return
    print((x1 + x2) // 2, (y1 + y2) // 2, n.get('checked', ''), src)


if host.get('clickable') == 'true' or host.get('checkable') == 'true':
    emit(host, 'self')
    sys.exit(0)
x1, y1, x2, y2 = host['_b']
inside = [
    n for n in nodes
    if n is not host
    and (n.get('clickable') == 'true' or n.get('checkable') == 'true')
    and x1 <= n['_b'][0] and n['_b'][2] <= x2 + 1
    and y1 <= n['_b'][1] and n['_b'][3] <= y2 + 1
]
# checkable 优先：一行里既有整行按钮又有勾选框时，状态只有勾选框有。
for n in sorted(inside, key=lambda n: n.get('checkable') != 'true'):
    emit(n, 'child:%s:%s' % (n.get('class', '?').split('.')[-1], n.get('content-desc', '') or n.get('text', '')))
    break
PY
}

# 在某个块（resource-id）的矩形里找 content-desc 完全相等的节点，打印 "<x y> <attr>"。
# 用来消歧「五个功能块各有一枚同名 chip」那种重复锚点（§7 第 236 条）。
xy_in_rid() {  # <块 testID> <content-desc> [attribute]
  HEYTA_BLOCK="$1" HEYTA_DESC="$2" HEYTA_ATTR="${3:-}" python3 - <<'PY'
import os, re, sys
try:
    s = open(os.environ["UI_XML"]).read()
except OSError:
    sys.exit(0)
block, desc, attr = os.environ["HEYTA_BLOCK"], os.environ["HEYTA_DESC"], os.environ["HEYTA_ATTR"]
box = None
for m in re.finditer(r"<node\b[^>]*>", s):
    tag = m.group(0)
    if 'resource-id="%s"' % block in tag:
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
        if b:
            box = [int(g) for g in b.groups()]
        break
if box is None:
    sys.exit(0)
for m in re.finditer(r"<node\b[^>]*>", s):
    tag = m.group(0)
    d = re.search(r'content-desc="([^"]*)"', tag)
    if not d or d.group(1) != desc:
        continue
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
    if not b:
        continue
    x1, y1, x2, y2 = (int(g) for g in b.groups())
    if box[0] <= x1 and x2 <= box[2] and box[1] <= y1 and y2 <= box[3]:
        a = ""
        if attr:
            aa = re.search(r'\b%s="([^"]*)"' % re.escape(attr), tag)
            a = aa.group(1) if aa else ""
        print("%d %d %s" % ((x1 + x2) // 2, (y1 + y2) // 2, a))
        sys.exit(0)
PY
}
tap_in_rid() {  # <块 testID> <content-desc>
  local block=$1 desc=$2 i out
  for i in 1 2 3 4 5; do
    dump
    out=$(xy_in_rid "$block" "$desc")
    if [ -n "$out" ]; then
      set -- $out
      $ADB shell input tap "$1" "$2" >/dev/null 2>&1
      sleep 1
      return 0
    fi
    $ADB shell input swipe 540 1900 540 1100 250
    sleep 1.5
  done
  echo "   ❌ 块 $block 里没有 content-desc=$desc 的节点（滚了 5 次）" >&2
  return 1
}

# ── 截图证据（与 verify-mobile-notes 同一条判据）────────────────────
# 🔴 判红的那条是「拍的那一刻前台是不是我们」，不是像素统计：主蓝阈值是从 mac
#    共享 UI 推的，手机界面有 14 张人看过的真图命中 0；而 contentRatio 在编辑屏
#    只剩 0.8pp 余量（现量与论证见 notes 的同名注释）。两个像素读数照打不判红。
SHOT_FOCUS=""
shot_evidence() {
  local rel="$1" focus
  mkdir -p "$EVIDENCE"
  focus=$($ADB shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | tr -d '\r')
  $ADB exec-out screencap -p > "$EVIDENCE/$rel" 2>/dev/null
  # 读不到要落成**明确哨兵**，不能落空串：空串让第 13 步的 case 走进「别的 App」那一支，
  # 把"探针没读到"报成"前台是别人"（notes 里那枚夹具照出来的真缺陷）。
  SHOT_FOCUS="${SHOT_FOCUS}${rel}=${focus:-FOCUS-UNKNOWN}
"
  printf '   • 截图 %s 那一刻的前台：%s\n' "$rel" "${focus:-FOCUS-UNKNOWN（dumpsys 没读到）}" >&2
}

step "预检：设备、并发、负载、APK 新鲜度"
BUSY="$(another_mobile_e2e_running)"
if [ -n "$BUSY" ]; then
  echo "   ❌ 另一条移动端验收在跑：$BUSY"
  echo "      同一台模拟器的安装目录与界面状态不能并行覆盖（AGENTS §8 第 9 条）。本轮不作数。"
  exit 3
fi
if ! adb devices | grep -q "^$E2E_SERIAL"$'\t'"device"; then
  echo "   ❌ 模拟器 $E2E_SERIAL 不在 adb devices 的 device 列表里 —— 环境不成立，不是产品失败"
  exit 3
fi
wait_for_quiet_host || exit 3
heyta_apk_freshness_guard "$APK" "verify-mobile-ai" || exit 3

HEALTH=$(curl -s --noproxy '*' -m 5 "${HOST_SERVER}/health" 2>/dev/null)
if ! printf '%s' "$HEALTH" | grep -q '"status":"ok"'; then
  echo "   ❌ 服务端没在 ${HOST_SERVER}（/health 返回：${HEALTH:-空}）—— 环境未就绪，**不是产品失败**"
  echo "      起栈：bash scripts/mobile-e2e-up.sh"
  exit 3
fi
echo "   ✅ 服务端在 ${HOST_SERVER}；设备 ${E2E_SERIAL}；库 $E2E_DB"

# 🔴 起跑时间戳取在**任何破坏性动作之前**（下面的 pm clear / install -r 都算）：
#    第 13 步的截图归属判据要靠它区分"本轮拍的"和"上一趟留下的"。
RUN_STARTED=$(date +%s)

step "假端点：确定性、只绑回环、可数请求"
rm -f "$LAPTOP_DB" "$PHONE_DB" "$STUB_PIDFILE"
# `e2e/stub-provider.mjs` 默认 STUB_PORT=4319（那是 Playwright 那套的端口），
# 这里必须换号 —— 与本仓 e2e 的 4318/4319/4320 撞上时，症状是「另一套的门禁红」，
# 而不是「本 rig 配错了」（§7 第 87 条同族）。
STUB_PORT="$STUB_PORT" nohup "$NODE" "$HEYTA_REPO_ROOT/e2e/stub-provider.mjs" >"$STUB_LOG" 2>&1 &
echo $! > "$STUB_PIDFILE"
STUB_READY=0
for _ in $(seq 1 20); do
  if curl -s --noproxy '*' -m 2 "${STUB_HOST_URL}/__requests" | grep -q '"count"'; then STUB_READY=1; break; fi
  sleep 1
done
if [ "$STUB_READY" -ne 1 ]; then
  echo "   ❌ 假端点 20 秒内没起来（日志 tail：）"; tail -5 "$STUB_LOG"
  summary "移动端 AI 助手真机验收" "载体坏了" 1
fi
# 🔴 反假绿：计数读不出来时**不许**按 0 处理。后面每一条「零外发」判据都读这个数 ——
#    把读不出当成 0，等于"每一条零外发自动成立"（§7 元规则 2）。
stub_count() {
  raw=$(curl -s --noproxy '*' -m 5 "${STUB_HOST_URL}/__requests" | python3 -c 'import sys,json
try:
  print(int(json.load(sys.stdin)["count"]))
except Exception:
  print("BAD")')
  if ! printf '%s' "$raw" | grep -qE '^[0-9]+$'; then
    echo "   ❌ 假端点计数读不出（返回：${raw}）—— 这一条判据没有输入，本轮不作数" >&2
    printf 'BAD'
    return 1
  fi
  printf '%s' "$raw"
}
stub_reset() { curl -s --noproxy '*' -m 5 "${STUB_HOST_URL}/__reset" >/dev/null; }
# 设备侧正向对照的读回口（同 stub_count 的反假绿纪律：读不出不许按 0 处理）。
stub_probe_hits() {
  raw=$(curl -s --noproxy '*' -m 5 "${STUB_HOST_URL}/__reach" | python3 -c 'import sys,json
try:
  print(int(json.load(sys.stdin)["probeHits"]))
except Exception:
  print("BAD")')
  if ! printf '%s' "$raw" | grep -qE '^[0-9]+$'; then
    echo "   ❌ /__reach 的 probeHits 读不出（返回：${raw}）—— 正向对照没有输入，本轮不作数" >&2
    printf 'BAD'
    return 1
  fi
  printf '%s' "$raw"
}
feature_lines() {
  curl -s --noproxy '*' -m 5 "${STUB_HOST_URL}/__requests" | python3 -c 'import sys,json
try:
    d = json.load(sys.stdin)
    print(" ".join(sorted({c["feature"] for c in d["calls"]})))
except Exception as exc:
    print("READ-FAIL:%s" % exc)
'
}
C0=$(stub_count) || summary "移动端 AI 助手真机验收" "假端点计数读不出" 1
echo "   ✅ 假端点在 ${STUB_HOST_URL}（当前计数 ${C0}，绑定仍是 127.0.0.1）"

step "设备侧端口转发：adb reverse（假端点不改绑定）"
$ADB reverse "tcp:${STUB_PORT}" "tcp:${STUB_PORT}" || {
  echo "   ❌ adb reverse 失败 —— 环境不成立"; summary "移动端 AI 助手真机验收" "载体坏了" 3; }
echo "   ✅ 转发表：$($ADB reverse --list | tr -d '\r')"
# 正向对照：从**设备里**打一次假端点。这一条证明"通了"，
# 否则后面每一条「计数没动」都有两种解释（没通 / 真的没发）。
#
# 🔴 这一条以前用的是 `adb shell curl …/__requests`，而**模拟器镜像里没有 curl**
#    （实测 `which curl` 空、只有 /system/bin/toybox）：那个变量恒为空串，于是每一轮
#    都在起跑前判成"设备够不到假端点 ⇒ 环境不成立"并 exit 3 —— 坏的是探针，不是环境。
#    换成的形状：设备只负责把 `GET /__probe` 这一行**发出去**（toybox nc），
#    由宿主机读回 `/__reach` 的 probeHits 来证明它到了。不依赖设备能不能把响应打回来。
#    probeHits 只数命中 /__probe 的请求，旁边的 curl 轮询不会把它顶上去，
#    所以"没涨"只剩一种解释（发不出去）。
#
#    ⚠️ 第二个坑（实测过才写成形状）：`printf … | toybox nc` **连得上但一个字节都不发**。
#    toybox nc 在 stdin 立刻 EOF 时不冲写缓冲（`-q SECS` 就是为它存在的选项）。
#    所以发送侧必须把 stdin 按住两秒：`(printf … ; sleep 2) | toybox nc -w 4 …`。
#    A/B 读数：管道直发 probeHits 0→0；按住 stdin 后 0→1 且响应字节也回来了。
if ! $ADB shell 'which nc' 2>/dev/null | tr -d '\r' | grep -q nc; then
  echo "   ❌ 设备镜像里没有 nc —— 正向对照无法建立，载体不成立（不是产品失败）"
  summary "移动端 AI 助手真机验收" "探针二进制缺失" 3
fi
P0=$(stub_probe_hits) || summary "移动端 AI 助手真机验收" "reach 计数读不出" 1
$ADB shell "(printf 'GET /__probe HTTP/1.0\r\n\r\n'; sleep 2) | toybox nc -w 4 127.0.0.1 ${STUB_PORT} >/dev/null 2>&1; true" >/dev/null 2>&1
P1=$(stub_probe_hits) || summary "移动端 AI 助手真机验收" "reach 计数读不出" 1
if [ "$P1" -le "$P0" ]; then
  echo "   ❌ 设备里发出的 /__probe 没被假端点数到（${P0} → ${P1}）—— 设备够不到假端点，环境不成立，不是产品失败"
  summary "移动端 AI 助手真机验收" "设备够不到假端点" 3
fi
echo "   ✅ 设备内回环可达（/__probe 计数 ${P0} → ${P1}）"

step "0. 全新安装 + 隐私门（先选「只用本机」）"
$ADB shell pm clear "$PKG" >/dev/null 2>&1 || true
$ADB shell am force-stop "$PKG" >/dev/null 2>&1 || true
$ADB install -r -g "$APK" >/dev/null 2>&1 || { echo "   ❌ 装不上 $APK"; summary "移动端 AI 助手真机验收" "载体坏了" 1; }
# 🔴 顺序（2026-10-06 实测出来的形状，别再换回去）：
#   1) 先 settle_foreground —— 刚 `pm clear` + 装完，进程还没起，此时 dump 到的是 launcher；
#   2) 再一次性交给 `dismiss_welcome_if_present`：它内部**先**处理隐私面板、**后**点欢迎页。
#   原先这里写成"先 dismiss_welcome（那时 App 根本没起）→ 再单独处理隐私门"，于是：
#     · 第一次调用点不到任何东西（树里只有 launcher）；
#     · 隐私面板是盖住整屏的 RN Modal，它立着的时候**欢迎页节点不在树里**（共享库
#       `scripts/lib/mobile-e2e.sh` handle_privacy_consent 的注释写明了这一点）；
#     · 隐私门被第二次的显式调用点掉后，**没有任何人再回去点欢迎页** ⇒
#       第 1 步起每一条界面锚点都取空，而脚本先打印了一句 `✅ 本轮从「只用本机」起`。
#   那次读数是"载体停在欢迎页"，不是"产品坏了" —— 界面实测完全正常（欢迎页 →
#   「先离线使用」→ 任务面 / 「我的」页 / `profile-entry-settings` 全都在树里）。
#   隐私层（blanket fetch 闸门）关着时**连回环 AI 端点也不该发出去**，第 5 步的规则短路
#   正好跑在这一档上 ⇒ 起始档仍是「只用本机」，只是改由旋钮交给共享库那一次调用。
settle_foreground
CONSENT_GATE_PREFERRED="只用本机"
dismiss_welcome_if_present || { echo "   ❌ 首启的两层门（隐私面板 / 欢迎页）没处理干净"; summary "移动端 AI 助手真机验收" "载体坏了" 1; }
CONSENT_GATE_PREFERRED=""
dump
if [ "$CONSENT_GATE_SEEN" = "1" ]; then
  PRIVACY_STEP_RAN=1
  # 🔴 打印的是**实际点掉的标签**，不是脚本"想要"的那个（写死「只用本机」会在收下
  #    备选按钮时照样报 ✅）。
  echo "   ✅ 隐私门已选「${CONSENT_GATE_CHOSEN}」"
else
  PRIVACY_STEP_RAN=0
  echo "   ↷ 这一版没弹隐私门（设备已有态）—— 「只用本机」那一层对照记为**未取证**，不记为通过"
fi
# 响亮失败：还停在欢迎页就别让第 1 步去猜。
if [ "$(has_desc "先离线使用")" = "1" ] || [ "$(has_text "先离线使用")" = "1" ]; then
  echo "   ❌ 处理完两层门之后界面仍停在欢迎页（「先离线使用」还在树里）—— 后面的锚点全都取空"
  screen_txt
  summary "移动端 AI 助手真机验收" "载体停在欢迎页" 1
fi

step "1. 凭据 + 一条种子任务（后面每条判据的输入）"
require_screen
configure_sync_credentials
# 🔴 这里原本紧跟一句**裸的** `input keyevent 4`（BACK），目的是收起设置浮层。
#    2026-10-06 实测它的另一种落点：浮层已经自己收起时，BACK 会**直接把应用退到桌面**
#    ⇒ 后面三次 `tap_tab "我的"` 全在 launcher 上找标签，症状是"进不到任务面"，
#    读起来像界面坏了，其实是载体自己按出门去了（§7 元规则一：先怀疑探针）。
#    换成的形状：收键盘 → BACK 一次 → `settle_foreground` **兜住前台**（不在应用里就
#    重新拉起，凭据已落盘所以重挂不丢状态）→ 再按标签走。
disable_ime
$ADB shell input keyevent 4 >/dev/null 2>&1 || true
settle_foreground
dump
if [ -z "$(xy_desc "我的")" ]; then
  echo "   ❌ 前台里没有「我的」标签 —— 不是标记问题，是界面里根本没有它"
  screen_txt
  summary "移动端 AI 助手真机验收" "载体回不到主界面" 1
fi
# 🔴 这里原先排的是「切到『我的』」→ `settle_for "打开任务"` → 再切『任务』，两处都对不上：
#    · `打开任务：{title}`（`mobile.tasks.a11y.open`）是**任务行**的无障碍名前缀，
#      而这一趟是 `pm clear` 之后的全新装机，此刻**还没有任何任务行**（种子任务要到下面才建）
#      ⇒ 这条 `settle_for` 在自己设计的顺序里永远不可能满足，报出来的"进不到任务面"
#        读起来像界面坏了，其实是等一个当时不存在的东西（§7 元规则 2：先问它什么时候该成立）；
#    · 而且它排在"切到『我的』"之后 —— 就算有任务行，那一屏也不是任务面。
#    任务面的锚点就是那枚 FAB（content-desc 逐字 `新建任务`，第 470 行本来就在校验它）。
tap_tab "任务" "新建任务" || { echo "   ❌ 回不到任务 tab"; screen_txt; summary "移动端 AI 助手真机验收" "载体坏了" 1; }
settle_foreground
disable_ime
dump
FAB_XY=$(xy_desc "新建任务")
if [ -z "$FAB_XY" ]; then
  echo "   ❌ 找不到「新建任务」入口（content-desc）—— 界面形状变了，本脚本的锚点要跟着改"
  screen_txt
  summary "移动端 AI 助手真机验收" "载体锚点失效" 1
fi
$ADB shell input tap ${FAB_XY% *} ${FAB_XY#* } >/dev/null 2>&1
sleep 1
dump
EDIT_XY=$(xy_edit_any)
[ -n "$EDIT_XY" ] || { echo "   ❌ 新建面板里没有输入框"; summary "移动端 AI 助手真机验收" "载体坏了" 1; }
$ADB shell input tap ${EDIT_XY% *} ${EDIT_XY#* } >/dev/null 2>&1
clear_and_type "$TASK_TITLE"
# 🔴 输入之后**先回读标题**，再点提交 —— 这两件事必须分开断言。
#    `clear_and_type` 不带标签时只保证"发了"，不保证"到了"（它自己的注释写着：
#    没有标签就没法读回，只能返回 0）。不读这一步，"任务没建出来"就有两种成因
#    （没输进去 / 没提交成功）而脚本只报后者 —— 那是把探针的故障记成产品故障。
dump
if [ "$(has_text "$TASK_TITLE")" != "1" ]; then
  bad "标题没输进新建面板（「${TASK_TITLE}」不在树里）—— 这是探针/输入通道的问题，不是提交失败"
  screen_txt
  restore_ime
  summary "移动端 AI 助手真机验收" "载体输入通道坏了" 1
fi
ok "标题已进面板（${TASK_TITLE}）"
# 🔴 这里原本排了一句 `input keyevent 4`（BACK），意图是"收起键盘让「添加」露出来"。
#    实测两重错：① 上面第 454/472 行已经 `disable_ime`（并置
#    `show_ime_with_hard_keyboard=0`），键盘根本不弹，没什么可收；② 这一句会把**新建面板 itself**
#    收掉 ⇒ 下一句 `xy_text "添加"` 取空，落进下面那条 ENTER 兜底分支，在一个已经关掉的
#    面板上按 66 —— 症状是"种子任务没建出来"，读起来像产品写不进去，其实是探针把自己
#    的面板按走了（2026-10-06 实测；同一款 BACK 在第 448 行那段注释里已经犯过一次）。
dump
SAVE_XY=$(xy_text "添加")
[ -n "$SAVE_XY" ] || SAVE_XY=$(xy_desc "添加")
if [ -z "$SAVE_XY" ]; then
  # 🔴 原先这里是"取不到坐标就退回按 ENTER"，于是**锚点坏了**和**没提交成功**
  #    共用同一句结论，而后者会指向产品。按同形状跑通的 `verify-mobile-autosync.sh`
  #    走：找不到「添加」就响亮报锚点失效，不猜。
  bad "新建面板里没有「添加」提交锚点（content-desc/text 都没命中）—— 界面形状变了，锚点要跟着改"
  screen_txt
  restore_ime
  summary "移动端 AI 助手真机验收" "载体锚点失效" 1
fi
$ADB shell input tap ${SAVE_XY% *} ${SAVE_XY#* } >/dev/null 2>&1
sleep 2
dump
if [ "$(has_sub "$TASK_TITLE")" = "1" ]; then ok "种子任务在界面上（${TASK_TITLE}）"; else bad "种子任务没建出来 —— 后面每条判据都没有输入"; fi
restore_ime

pull_phone_db() {
  $ADB root >/dev/null 2>&1 || true
  sleep 1
  $ADB exec-out run-as "$PKG" cat "databases/heyta.sqlite" > "$PHONE_DB" 2>/dev/null || \
    $ADB pull "/data/data/$PKG/databases/heyta.sqlite" "$PHONE_DB" >/dev/null 2>&1 || true
  $ADB unroot >/dev/null 2>&1 || true
}
db_count() {  # <sqlite 文件> <SQL>
  if [ ! -s "$1" ]; then printf 'NOFILE'; return 1; fi
  out=$(sqlite3 "$1" "$2" 2>/dev/null | tr -d '\r')
  if ! printf '%s' "$out" | grep -qE '^[0-9-]+$'; then printf 'BAD'; return 1; fi
  printf '%s' "$out"
}
# 端点**行数**：已存的每枚端点渲染成一行 `ai-endpoint-<id>`。
# 🔴 必须把表单自己的五枚 testID 剔掉（label/url/model/key/add 也以 ai-endpoint- 开头），
#    否则这个数永远 ≥5、增加一枚根本读不出来 —— 第 4 链的"行数没增加"就是假判据。
endpoint_rows() {
  dump
  HEYTA_UI="$UI_XML" python3 - <<'PY'
import os, re
s = open(os.environ["HEYTA_UI"]).read()
FORM = {"label", "url", "model", "key", "add"}
ids = {m.split("ai-endpoint-")[1].rstrip('"') for m in re.findall(r'resource-id="(ai-endpoint-[^"]+)"', s)}
print(len(ids - FORM))
PY
}
edit_value_by_rid() {  # <testID> → 该输入框当前文本（读不到打印空串）
  HEYTA_RID="$1" python3 - <<'PY'
import os, re, sys
try:
    s = open(os.environ["UI_XML"]).read()
except OSError:
    sys.exit(0)
rid = os.environ["HEYTA_RID"]
for m in re.finditer(r"<node\b[^>]*>", s):
    tag = m.group(0)
    if 'resource-id="%s"' % rid in tag:
        d = re.search(r'\btext="([^"]*)"', tag)
        print(d.group(1) if d else "")
        sys.exit(0)
PY
}

# 🔴 到「我的」页，并且**证明真的到了那一页**才返回。
#    为什么必须有"证明"这一半：本脚本有两类反向判据（「AI 助手」那一格**不在**树里），
#    它们在任何别的屏上都恒成立 —— 2026-10-06 实测第 2 步就是报在 launcher/「分类」屏上
#    拿到了一句 `✅ 未配置时「AI 助手」入口整行不在 AX 树里`。一句在错屏上取的绿，
#    比一句红更坏：它后面所有"这一格该出现/该消失"的对照都作废（§7 元规则 2）。
#    正面锚点用 `profile-entry-settings`（「我的 → 设置」那一格，与 lib 里
#    `configure_sync_credentials` 用的是同一枚 testID）。
goto_me_page() {
  settle_foreground
  tap_tab "我的" "立即同步" || return 1
  dump
  if [ "$(has_rid profile-entry-settings)" != "1" ]; then
    echo "   ❌ 自称切到了「我的」，但那一页的正面锚点 profile-entry-settings 不在树里 —— 读的是别的屏"
    screen_txt
    return 1
  fi
  return 0
}

open_ai_settings() {
  goto_me_page || { echo "   ❌ 到不了「我的」页，后面没有屏可点"; return 1; }
  # 🔴 这一段的锚点原先写的是 `xy_desc "设置"`，2026-10-06 实测**恒取空**：
  #    那一格的 content-desc 实际是「设置, 同步凭据、桌面小组件与语言」——
  #    行组件把 label 和 hint 用「, 」拼成 accessibilityLabel（现量：
  #    `adb shell uiautomator dump` 里那枚节点的 content-desc），
  #    而 `xy_desc` 是**精确等值**（`/tmp/_xy.py` 的 `desc == want`）⇒ 一次都点不到，
  #    报出来的却是「设置里没有『AI 设置』区块」—— 那是**根本没进设置页**，
  #    不是区块没了（同一份 dump 里 testID=ai-settings-section 与 desc「AI 设置」都在）。
  #    ⇒ 改用 testID 走：desc 锚点不在 `check:mobile-ai-anchors` 的对账面内，
  #      rid 锚点在（它比的是源码里的 testID 声明）。
  #    同屏其余各格同理都是「label, hint」形状：
  #    通知 / 账号与安全 / 我的成长 / 习惯 / 倒数纪念日。
  tap_rid profile-entry-settings || { echo "   ❌ 点不到「我的 → 设置」那一格（testID=profile-entry-settings）"; screen_txt; return 1; }
  sleep 2
  # 「AI 设置」区块在设置页**下方**，是内联区块不是可点的入口 ——
  # 原先这里还去点了一次标题（点了什么也不会发生）。要的是"滚到它进树"。
  local i
  for i in 1 2 3 4 5; do
    dump
    [ -n "$(rid_center ai-settings-section)" ] && return 0
    $ADB shell input swipe 540 1900 540 900 300
    sleep 1.5
  done
  echo "   ❌ AI 设置区块没打开（滚了 5 次，testID=ai-settings-section 仍不在树里）"; screen_txt
  return 1
}

# 🔴 点一枚 content-desc **恰好等于** <desc> 的节点；取空即响亮失败。
#    这五处原先写的是 `[ -n "$XY" ] && $ADB shell input tap …`（"取不到就不点"）：
#    锚点坏了与「这一档本来就没渲染」共用同一条后续读数，于是症状变成"下一步的元素找不到"，
#    归因被推给产品 —— 而 §7 元规则一要求先把探针的故障认出来。
#    另一处同类：助手屏的任务格是 `Chip label={task.title}`（AssistantScreen.tsx:484，
#    `kit.tsx:1048` 把它写成 accessibilityLabel），所以锚点**就是任务标题本身**，
#    不是任务列表那一行的「打开任务：{title}」（那是 `TasksScreen.tsx:822`，另一个屏）。
tap_desc() {  # <content-desc>
  local xy
  dump
  xy=$(xy_desc "$1")
  if [ -z "$xy" ]; then
    echo "   ❌ 屏上没有 content-desc 恰好等于「$1」的节点 —— 界面形状或锚点变了，不退回「取不到就不点」" >&2
    screen_txt
    return 1
  fi
  echo "   · 点 desc「$1」 @ $xy" >&2
  $ADB shell input tap ${xy% *} ${xy#* } >/dev/null 2>&1
  sleep 1
  return 0
}

# 从「AI 设置」浮层回到「我的」页。
# 🔴 三步各司其职，不许收成一句裸 BACK（第 545 行那段实测过它的另一种落点：
#    浮层已自己收起时 BACK 会把应用退到桌面，随后每一句找标签的都打在 launcher 上）：
#    ① 收键盘 ② BACK 收浮层（不拦它的失败）③ settle_foreground 兜住前台
#    —— 最后由 goto_me_page 的正面锚点收尾，取不到就返回 1，不带着「⚠️ 继续」往下走。
leave_settings() {
  disable_ime
  $ADB shell input keyevent 4 >/dev/null 2>&1 || true
  sleep 1
  settle_foreground
  goto_me_page
}

# 填一枚自定义端点并**提交**（提交就是「添加自定义端点」那一次点击；没有「保存」）。
add_endpoint() {  # <名称> <地址>
  local name=$1 url=$2 pair rid val got
  disable_ime
  for pair in "ai-endpoint-label|$name" "ai-endpoint-url|$url" "ai-endpoint-model|stub-model"; do
    rid=${pair%%|*}; val=${pair#*|}
    # 🔴 原先这里只 `dump` 一次取坐标、取不到就报「界面形状变了，锚点要跟着改」。
    #    现量（rig12，tmp/probe-form.xml）：label 在 y=[2050,2174]、url 在 y=[2271,2400]（贴屏底），
    #    model 在**折叠线以下、根本没进那一秒的树** ⇒ 那句红字把"还没滚到位"写成了"锚点坏了"，
    #    而 `check:mobile-ai-anchors` 刚证明这枚 testID 在源码里存在（AiSettingsSection.tsx:352）。
    #    改走 `tap_rid`：它负责"滚进安全带再点"，并且已经把
    #    "不在树里"和"在树里但贴着边"分成两句话（同一枚开关在第 3 步刚用过这条路）。
    tap_rid "$rid" || { echo "   ❌ 端点表单里滚不出 testID=$rid 那一格"; restore_ime; return 1; }
    clear_and_type "$val"
    sleep 1
  done
  restore_ime
  # 🔴 提交前把两个关键值**回读**一遍：`clear_and_type` 第一步是 CTRL+A + DEL，
  #    焦点不在目标框时清的是**别的字段**（lib 的 configure_sync_credentials 里同款事故，
  #    当时每一步局部断言都还是 ✅）。
  dump
  for pair in "ai-endpoint-label|$name" "ai-endpoint-url|$url"; do
    rid=${pair%%|*}; val=${pair#*|}
    got=$(edit_value_by_rid "$rid")
    if [ "$got" != "$val" ]; then
      echo "   ❌ 提交前回读 testID=$rid 得到「${got}」，期望「${val}」—— 不许带着错值点提交"
      return 1
    fi
  done
  tap_rid ai-endpoint-add || return 1
  sleep 1
}

step "2. 配端点之前：入口整行不在树里（aiEntryVisible 的反向那一半）"
# 🔴 反向判据必须先站对屏（见 goto_me_page 的注释）：「不在树里」这句话
#    在别的屏上一样成立，不验正面锚点就是"一句恒绿的判据"。
goto_me_page || summary "移动端 AI 助手真机验收" "载体回不到「我的」页" 1
if [ "$(has_rid profile-entry-assistant)" = "1" ]; then
  bad "还没配端点，「AI 助手」那一格就已经在树里 —— 未配置的功能不该进 DOM，那这条反向判据也就守不住任何东西"
else
  ok "未配置时「AI 助手」入口整行不在 AX 树里"
fi

step "3. 开总开关 + 配一枚回环假端点（仍处「只用本机」）"
open_ai_settings || summary "移动端 AI 助手真机验收" "载体锚点失效" 1
# ① 总开关：按 checked 判定，不按「点过了」判定。
# 🔴 两处自坏（2026-10-06 实测，读数 `tmp/ai11-rig.log`）：
#   · 原先读的是 `rid_attr ai-gate-enabled checked` = **容器**的 checked ⇒ 恒 false，
#     于是"开关没开"是一条永远不可能被否证的判据；同一时刻手工 dump 里那枚
#     `android.widget.CheckBox` 明明是 `checked=true`（点击真的生效了，红的是探针）。
#   · 点击之后**没有重新 dump**就读 ⇒ 读的是点击前那份树。
#   现量：`· 点 testID=ai-gate-enabled → 落在 [child:CheckBox:启用 AI 功能] @ 144,683`
#   紧接 `❌ …点击后 checked=false` —— 两句不可能同时为真，除非读的是容器/旧树。
dump; BEFORE=$(gate_state ai-gate-enabled)
if [ "$BEFORE" = "true" ]; then
  ok "「启用 AI 功能」本来就开着（点击前 checked=true）—— 这一趟**不去点它**，点了会把它关掉"
  AFTER=true
else
  tap_rid ai-gate-enabled || summary "移动端 AI 助手真机验收" "总开关点不动" 1
  dump
  AFTER=$(gate_state ai-gate-enabled)
  if [ "$AFTER" = "true" ]; then
    ok "「启用 AI 功能」开起来了（checked ${BEFORE:-空}→${AFTER}；那一枚是哪一层由上面 tap_rid 打的 [ … ] 说）"
  else
    bad "「启用 AI 功能」点击后 checked=${AFTER:-读不出}（点击前 ${BEFORE:-空}）—— 开关没开，后面每一步都没有输入"
    summary "移动端 AI 助手真机验收" "总开关没开" 1
  fi
fi
# ② 允许远程端点：第 7/8 步要用非回环地址，这枚不开就永远走不到出境闸门。
tap_rid ai-gate-remote || echo "   ↷ 「允许远程端点」没点到（可能本来已开）—— 以第 7 步的实际闸门读数为准"
# ③ 端点：名称/地址/模型 + 一次提交。
ROWS_BEFORE=$(endpoint_rows)
add_endpoint "$EP_LOOPBACK" "$DEVICE_LOOPBACK_URL" \
  || { echo "   ❌ 回环假端点没存进去"; screen_txt; summary "移动端 AI 助手真机验收" "载体坏了" 1; }
ROWS_AFTER=$(endpoint_rows)
dump
if [ "$(has_desc "$EP_LOOPBACK")" = "1" ] && [ "$ROWS_AFTER" -gt "$ROWS_BEFORE" ]; then
  ok "回环假端点已落进配置（端点行 ${ROWS_BEFORE}→${ROWS_AFTER}，chip 在树里）"
else
  bad "回环假端点没落进去：chip 命中=$(has_desc "$EP_LOOPBACK")，行 ${ROWS_BEFORE}→${ROWS_AFTER}"
  screen_txt
  summary "移动端 AI 助手真机验收" "端点存不进" 1
fi

step "4. 明文 + 非回环端点**存不进去**（validateEndpointUrl 的 plaintext-remote）"
ROWS_BEFORE2=$(endpoint_rows)
add_endpoint "$EP_PLAINTEXT" "$DEVICE_PLAINTEXT_REMOTE_URL"
sleep 1
dump
ERR_SHOWN=$(has_sub "远端端点必须是 https")
ROWS_AFTER2=$(endpoint_rows)
if [ "$ERR_SHOWN" = "1" ] && [ "$ROWS_AFTER2" = "$ROWS_BEFORE2" ]; then
  ok "明文非回环被当面拒绝：那句校验话在屏上，且端点行数没增加（${ROWS_BEFORE2}→${ROWS_AFTER2}）"
elif [ "$ERR_SHOWN" != "1" ]; then
  bad "没看到那句校验话 —— 要么规则换了措辞（要同步改本脚本），要么根本没校验"
  screen_txt
else
  bad "🔴 报了错**却仍然存进去了**（行数 ${ROWS_BEFORE2}→${ROWS_AFTER2}）：明文远端一旦落库，端到端加密的承诺就自相矛盾"
fi

step "5. 只用本机时：规则句命中且零外发（Goal-1 的设备级判据）"
# 第 3/4 步整段停在「AI 设置」屏上，而「AI 助手」那一格在「我的」页 ——
# 原先这里直接 dump，等于在设置屏上找「我的」页的格子（恒红），
# 而第 2 步那句反向判据又在任意错屏上恒绿。两头都要靠 goto_me_page 钉住屏。
goto_me_page || summary "移动端 AI 助手真机验收" "载体回不到「我的」页" 1
if [ "$(has_rid profile-entry-assistant)" = "1" ]; then
  ok "配好端点后「AI 助手」这一格进了树（与第 2 步的缺席对照成对）"
else
  bad "配好端点后「我的」里仍没有「AI 助手」这一格（testID=profile-entry-assistant）"
  screen_txt
  summary "移动端 AI 助手真机验收" "入口没出现" 1
fi
tap_rid profile-entry-assistant || summary "移动端 AI 助手真机验收" "入口点不动" 1
dump
[ -n "$(rid_center assistant-screen)" ] || { echo "   ❌ 助手屏没打开（testID=assistant-screen）"; screen_txt; summary "移动端 AI 助手真机验收" "载体坏了" 1; }
MISSING=""
for CHIP in "一句话捕获" "拆解任务" "优先级建议" "预估耗时" "AI 工具调用"; do
  [ "$(has_desc "$CHIP")" = "1" ] || MISSING="$MISSING $CHIP"
done
if [ -z "$MISSING" ]; then ok "助手屏五档 chips 全在（check:ai-coverage 在设备上的对应物）"; else bad "缺 chips:$MISSING"; fi
if [ "$(has_sub "AI 只给建议")" = "1" ]; then
  ok "「只给建议」那句常驻脚注在屏上（它是唯一对用户承诺「确认前不写」的文案）"
else
  bad "常驻脚注没出现"
fi
shot_evidence "android-ai-1-assistant.png"
# 走多步循环那一档：Goal-1 的短路补在 loop 上，不在单步面板。
tap_desc "AI 工具调用" || summary "移动端 AI 助手真机验收" "载体锚点失效" 1
dump
disable_ime
# 🔴 同一枚"只 dump 一次、取不到就报锚点坏了"的形状（见 add_endpoint 那段现量）：
#    输入框在面板下方时它**根本没进那一秒的树**，红字却说"界面形状变了"。
tap_rid tool-input || { echo "   ❌ 工具档里滚不出输入框 testID=tool-input"; screen_txt; summary "移动端 AI 助手真机验收" "载体锚点失效" 1; }
clear_and_type "list all tasks"
restore_ime
stub_reset; RB=$(stub_count) || summary "移动端 AI 助手真机验收" "假端点计数读不出" 1
dump
XY=$(rid_center tool-start-assistant)
[ -n "$XY" ] || { echo "   ❌ 找不到 testID=tool-start-assistant（多步循环那颗发送）"; screen_txt; summary "移动端 AI 助手真机验收" "载体锚点失效" 1; }
$ADB shell input tap $XY >/dev/null 2>&1
sleep 4
dump
RULE_HIT=$(has_sub "本机规则命中")
RC1=$(stub_count) || summary "移动端 AI 助手真机验收" "假端点计数读不出" 1
if [ "$RULE_HIT" = "1" ] && [ "$RC1" = "$RB" ]; then
  ok "「list all tasks」走本机规则（那句「本机规则命中 —— 没有联网」在屏上），假端点计数 ${RB}→${RC1} 一次没动"
elif [ "$RULE_HIT" != "1" ]; then
  bad "界面没有「本机规则命中」那行：规则短路在设备上没成立（或措辞变了）"
  echo "      端点收到过的功能：$(feature_lines)"
else
  bad "🔴 规则命中却仍然外发了：计数 ${RB}→${RC1}"
fi

step "6. 同意联网，但逐功能授权一律不给"
open_ai_settings || summary "移动端 AI 助手真机验收" "载体锚点失效" 1
# 隐私同意在设置**第一段**（合规位置，理由写在 SettingsScreen 的注释里）：
# 决定过 ⇒ 只有「重新作出选择」或「撤回同意」两枚，前者把同一张面板再开一次。
dump
XY=$(xy_desc "重新作出选择"); [ -n "$XY" ] || XY=$(xy_desc "同意并联网")
if [ -n "$XY" ]; then
  $ADB shell input tap ${XY% *} ${XY#* } >/dev/null 2>&1
  sleep 2
  handle_privacy_consent "同意并联网" "只用本机" \
    && echo "   ✅ 隐私层已切到「同意并联网」（功能级授权仍逐条手动）" \
    || echo "   ↷ 面板没接住 —— 可能已是联网态。**这句不是 ✅**：到底联网与否由第 7/8 步的计数与披露读数裁决，不由这里自称"
else
  echo "   ❌ 设置里既没有「重新作出选择」也没有「同意并联网」—— 隐私区块形状变了，锚点要跟着改"
  screen_txt
  bad "隐私开关锚点失效"
fi

step "7. 非回环 https 端点：授权入口按地址类别出现，未授权时零外发（Goal-7a 的真机对应物）"
add_endpoint "$EP_REMOTE" "$DEVICE_REMOTE_URL" \
  || { echo "   ❌ 非回环端点没存进去"; screen_txt; summary "移动端 AI 助手真机验收" "载体坏了" 1; }
open_ai_settings || summary "移动端 AI 助手真机验收" "载体锚点失效" 1
# ① 只在「拆解任务」那一块里点 chip（五块同名，块外定位会选错档）。
tap_in_rid ai-feature-breakdown "$EP_REMOTE" \
  || { echo "   ❌ 拆解任务块里没有 $EP_REMOTE 那枚 chip"; screen_txt; summary "移动端 AI 助手真机验收" "载体锚点失效" 1; }
dump
if [ "$(has_rid ai-consent-breakdown)" = "1" ]; then
  ok "路由指向非回环地址时，「拆解任务」这一档出现逐功能授权入口（ai-consent-breakdown 在树里）"
else
  bad "🔴 路由指向 192.0.2.1（非回环）却**没有**出现授权入口 —— 地址类别维度在设备上没生效"
  screen_txt
fi
# ② 对照：读「一句话捕获」块里**当前选中的是哪一枚**，再判它该不该有授权入口。
#    不写死"capture 一定是回环"—— 加端点时默认路由怎么长，本脚本不替它假设。
dump
CAP_SEL=""
for cand in "$EP_LOOPBACK" "$EP_REMOTE"; do
  hit=$(xy_in_rid ai-feature-capture "$cand" selected)
  [ -n "$hit" ] && CAP_SEL=$cand && break
done
CAP_CONSENT=$(has_rid ai-consent-capture)
echo "   ↷ 现量：一句话捕获选中的目的地=${CAP_SEL:-读不出}，授权入口=${CAP_CONSENT}"
case "$CAP_SEL" in
  "$EP_LOOPBACK")
    if [ "$CAP_CONSENT" = "0" ]; then
      ok "对照成立：目的地是回环的那一档**没有**索取授权（挡的是「授权面永远显示」）"
    else
      bad "回环目的地也弹出了授权入口 —— 授权面被放宽到了所有目的地，不只是非回环"
    fi ;;
  "$EP_REMOTE")
    if [ "$CAP_CONSENT" = "1" ]; then
      ok "对照成立（这一趟 capture 也被路由到了非回环）：需要授权的那一档出现了入口"
    else
      bad "🔴 capture 指向非回环却没有授权入口 —— 地址类别判定对不同的档不一致"
    fi ;;
  *) bad "读不出一句话捕获当前选中的目的地 —— 这一支对照没有输入，记为未取证而不是通过" ;;
esac
# ③ 不点授权，直接进助手走一次拆解。
leave_settings || summary "移动端 AI 助手真机验收" "载体回不到「我的」页" 1
tap_rid profile-entry-assistant || summary "移动端 AI 助手真机验收" "入口点不动" 1
tap_desc "拆解任务" || summary "移动端 AI 助手真机验收" "载体锚点失效" 1
# 🔴 那条种子任务没选中就不往下：`breakdown-start` 在没有输入时是 disabled，
#    于是「探针选不中那枚 chip」与「产品上的闸门」报出来是同一条 disabled 读数。
tap_desc "$TASK_TITLE" || summary "移动端 AI 助手真机验收" "拆解没有输入（种子任务没选中）" 1
stub_reset; G0=$(stub_count) || summary "移动端 AI 助手真机验收" "假端点计数读不出" 1
# 🔴 前置条件要在**被测那一侧**读到：disabled 就是"路由或任务选择没接上"，
#    这一格由 tap_rid 自己那句话说清，这里只负责不让后面的读数替它打分。
tap_rid breakdown-start || summary "移动端 AI 助手真机验收" "「AI 拆解」点不到（不存在／贴边／未启用，理由见上一行）" 1
sleep 3
dump
CONSENT_LINE=$(has_sub "需要你批准后内容才会离开本机")
SEND_PRESENT=0; [ -n "$(rid_center ai-send)" ] && SEND_PRESENT=1
G1=$(stub_count) || summary "移动端 AI 助手真机验收" "假端点计数读不出" 1
if [ "$CONSENT_LINE" = "1" ] && [ "$SEND_PRESENT" = "1" ] && [ "$G1" = "$G0" ]; then
  ok "未授权时披露步就索取批准（consentLead 那句在），且此刻假端点计数 ${G0}→${G1} 一次没动"
else
  bad "未授权这一步不成立：consentLead=$CONSENT_LINE 发送键=$SEND_PRESENT 计数 ${G0}→${G1}"
  echo "      命中的功能：$(feature_lines)"; screen_txt
fi
# ④ 硬点一次发送：闸门必须在 socket 之前，而不是发出去再判。
#    🔴 原先这里把坐标直接喂给 `input tap`：rid_center 取空 ⇒ 零参数 ⇒ 一声不响，
#       而下一句读的是「有没有那句拦截说明」，于是一枚没点到的发送键会报成"闸门放行了"。
tap_rid ai-send || summary "移动端 AI 助手真机验收" "发送键点不动" 1
sleep 5
dump
BLOCKED_LINE=$(has_sub "该功能需要你先批准内容离开本机")
G2=$(stub_count) || summary "移动端 AI 助手真机验收" "假端点计数读不出" 1
if [ "$BLOCKED_LINE" = "1" ] && [ "$G2" = "$G1" ]; then
  ok "点发送之后仍然零外发（计数 ${G1}→${G2}），界面给的是 egressNotAuthorized 那一句"
else
  bad "🔴 未授权却动了网络，或者没有那条拦截说明：批准句=$BLOCKED_LINE 计数 ${G1}→${G2}（收到过：$(feature_lines)）"
fi
shot_evidence "android-ai-2-egress-blocked.png"

step "8. 授权之后：披露点名目的地与字段，那条不可达地址的失败必须可见"
open_ai_settings || summary "移动端 AI 助手真机验收" "载体锚点失效" 1
# 🔴 「那一格在不在树里」与「点不点得动」是两种状态，原先它们共用一句 ⚠️ 继续往下：
#    不在 = 此前已授权（合法状态），在却点不动 = 载体坏了（必须停）。分开说。
if [ "$(has_rid ai-consent-breakdown)" = "1" ]; then
  tap_rid ai-consent-breakdown || summary "移动端 AI 助手真机验收" "逐功能授权入口点不动" 1
  echo "   ✅ 逐功能授权已点下（ai-consent-breakdown 曾在树里）"
else
  echo "   ↷ 那一档已经没有授权入口（此前已授权过）—— 直接看披露步的读数"
fi
leave_settings || summary "移动端 AI 助手真机验收" "载体回不到「我的」页" 1
tap_rid profile-entry-assistant || summary "移动端 AI 助手真机验收" "入口点不动" 1
tap_desc "拆解任务" || summary "移动端 AI 助手真机验收" "载体锚点失效" 1
tap_desc "$TASK_TITLE" || summary "移动端 AI 助手真机验收" "拆解没有输入（种子任务没选中）" 1
# 🔴 这两处原先是 `$ADB shell input tap $(rid_center breakdown-start)`：坐标取空时
#    `input tap` 只收到零个参数 ⇒ 一声不响，随后那句读披露元素的判据就在**没点过的屏**上打分。
# 同上：这一枚在面板底部，**没滚到位时不在树里**；tap_rid 负责滚进安全带再点，
# 并且"不在树里 / 贴着边 / disabled"三种成因各说各的话（disabled 它也会响亮拒绝）。
tap_rid breakdown-start || summary "移动端 AI 助手真机验收" "「AI 拆解」点不到（不存在／贴边／未启用，理由见上一行）" 1
sleep 3
dump
D_TO=$(has_sub "将发往："); D_FL=$(has_sub "将发送这些字段："); D_RM=$(has_sub "数据会离开设备")
if [ "$D_TO" = "1" ] && [ "$D_FL" = "1" ]; then
  ok "披露步元素齐：目的地行 + 字段清单（逐字段披露是红线，不是形容词）"
  if [ "$D_RM" = "1" ]; then
    ok "非回环目的地的性质行写成「数据会离开设备」"
  else
    bad "缺「数据会离开设备」那行（性质判定换档位时这句必须跟着变）"
  fi
else
  bad "披露步缺元素：将发往=$D_TO 字段清单=$D_FL"; screen_txt
fi
shot_evidence "android-ai-3-disclosure.png"
stub_reset; U0=$(stub_count) || summary "移动端 AI 助手真机验收" "假端点计数读不出" 1
tap_rid ai-send || summary "移动端 AI 助手真机验收" "发送键点不动" 1
sleep 8
dump
if [ "$(has_sub "连不上端点")" = "1" ] || [ "$(has_sub "技术详情")" = "1" ]; then
  ok "授权后真去发那条地址，失败被原样报出来（既没静默退回本机，也没静默成功）"
else
  bad "那条不可达地址既没报失败也没成功 —— 两种都要查：卡在中间态，或者悄悄发去了别处"
  echo "      这一趟假端点收到：$(feature_lines)"; screen_txt
fi
U1=$(stub_count) || true
if [ "$U1" = "$U0" ]; then
  ok "打 192.0.2.1 那一趟没有落到假端点（计数 ${U0}→${U1}）"
else
  bad "🔴 TEST-NET 地址的请求落到了假端点（${U0}→${U1}）—— 说明有第二条路径把地址改写成了可达端点"
fi

step "9. 换回回环路由：出提案卡，不点确认 ⇒ 手机库恰好 0 条新 op"
open_ai_settings || summary "移动端 AI 助手真机验收" "载体锚点失效" 1
tap_in_rid ai-feature-breakdown "$EP_LOOPBACK" || { echo "   ❌ 换不回回环路由"; summary "移动端 AI 助手真机验收" "载体锚点失效" 1; }
dump
if [ "$(has_rid ai-consent-breakdown)" = "0" ]; then
  ok "路由换回回环后，那一档的授权入口**消失**（与第 7 步的「出现」成对）"
else
  bad "回环端点仍然索取授权 —— 地址类别维度没跟着路由变"
fi
leave_settings || summary "移动端 AI 助手真机验收" "载体回不到「我的」页" 1
pull_phone_db
OPS_BEFORE=$(db_count "$PHONE_DB" "select count(*) from ops")
case "$OPS_BEFORE" in ''|BAD|NOFILE)
  echo "   ❌ 手机库读不出（${OPS_BEFORE}）—— 第 9/10 步没有基线；这是探针没读到，不记为产品失败"
  summary "移动端 AI 助手真机验收" "读不出手机库" 3;; esac
echo "   ↷ 提案前基线：手机库 $OPS_BEFORE 条 op"
tap_rid profile-entry-assistant || summary "移动端 AI 助手真机验收" "入口点不动" 1
tap_desc "拆解任务" || summary "移动端 AI 助手真机验收" "载体锚点失效" 1
tap_desc "$TASK_TITLE" || summary "移动端 AI 助手真机验收" "拆解没有输入（种子任务没选中）" 1
stub_reset; S0=$(stub_count) || summary "移动端 AI 助手真机验收" "假端点计数读不出" 1
# 同上：这一枚在面板底部，**没滚到位时不在树里**；tap_rid 负责滚进安全带再点，
# 并且"不在树里 / 贴着边 / disabled"三种成因各说各的话（disabled 它也会响亮拒绝）。
tap_rid breakdown-start || summary "移动端 AI 助手真机验收" "「AI 拆解」点不到（不存在／贴边／未启用，理由见上一行）" 1
sleep 3
dump
# 回环这一档**可以**没有披露步（本机目的地不该问），所以这里保留"在不在"的分支；
# 但既然进了这一支，坐标就必须取到 —— 原先两句都靠同一个空值，空值时一声不响。
if [ -n "$(rid_center ai-send)" ]; then
  tap_rid ai-send || summary "移动端 AI 助手真机验收" "发送键点不动" 1
  sleep 6
else
  echo "   ↷ 回环这一趟没有单独披露步（本机目的地不该问）—— 直接看提案"
fi
dump
if [ "$(has_sub "拆解结果")" = "1" ]; then
  ok "提案卡出来（「拆解结果（N 项）」那句在屏上）"
else
  bad "没有提案卡"; screen_txt
fi
shot_evidence "android-ai-4-proposal.png"
pull_phone_db
OPS_NOCONFIRM=$(db_count "$PHONE_DB" "select count(*) from ops")
S1=$(stub_count) || true
if [ "$OPS_NOCONFIRM" = "$OPS_BEFORE" ]; then
  ok "只看了提案、没点确认 ⇒ 手机库条数不变（${OPS_BEFORE}→${OPS_NOCONFIRM}）—— 这是「只产出提案」的设备级判据"
else
  bad "🔴 没点确认就写了 $((OPS_NOCONFIRM-OPS_BEFORE)) 条 op —— 提案与写入的边界破了"
fi
echo "   ↷ 这一段假端点计数 ${S0}→${S1}（回环那一次拆解应恰好 +1）"

step "10. 点「写入备注」⇒ 恰好 +1 条 TASK/UPD 且载荷键集合是 note"
UPD_BEFORE=$(db_count "$PHONE_DB" "select count(*) from ops where json_extract(data,'\$.op.entityType')='TASK' and json_extract(data,'\$.op.opType')='UPD'")
[ -n "$(rid_center breakdown-apply)" ] || { echo "   ❌ 没有 testID=breakdown-apply（确认那一半没有输入）"; screen_txt; summary "移动端 AI 助手真机验收" "载体锚点失效" 1; }
# 🔴 这一点要是没送到，下面"恰好 +1"与"载荷只有 note"两条都在**没写入的库**上打分 ——
#    它们会一起红，而红字把归因推给产品。守卫要压住后续判据（探针坏了就报"未取证"）。
if tap_rid breakdown-apply; then
  APPLIED=1
else
  APPLIED=0
  bad "「写入备注」点不动 —— 第 10 步后面两条判据记为**未取证**，不给它们打分"
fi
sleep 4
pull_phone_db
UPD_AFTER=$(db_count "$PHONE_DB" "select count(*) from ops where json_extract(data,'\$.op.entityType')='TASK' and json_extract(data,'\$.op.opType')='UPD'")
if [ "$APPLIED" = "0" ]; then
  echo "   ↷ TASK/UPD 计数与载荷键集合这一格未取证（确认那一下没送到）"
elif [ "$UPD_AFTER" = "$((UPD_BEFORE+1))" ]; then
  ok "确认后恰好 +1 条 TASK/UPD（${UPD_BEFORE}→${UPD_AFTER}）"
else
  bad "确认后 TASK/UPD 从 $UPD_BEFORE 变成 ${UPD_AFTER}（期望恰好 +1）"
fi
if [ "$APPLIED" = "1" ]; then
  PAYLOAD_KEYS=$(sqlite3 "$PHONE_DB" "select json_extract(data,'\$.op.payload') from ops where json_extract(data,'\$.op.entityType')='TASK' and json_extract(data,'\$.op.opType')='UPD' order by json_extract(data,'\$.seq') desc limit 1" 2>/dev/null)
fi
printf '%s' "${PAYLOAD_KEYS:-}" > /tmp/heyta-ai-upd-payload.json
KEYSET=$(python3 - "${PAYLOAD_KEYS:-}" <<'PY'
import json, sys
raw = sys.argv[1]
if not raw:
    print("NO-PAYLOAD-READ")
    sys.exit(0)
try:
    print(sorted(json.loads(raw).keys()))
except Exception as exc:
    print("PARSE-FAIL:%s" % exc)
PY
)
if [ "$APPLIED" = "0" ]; then
  : # 上面已经打了"未取证"，这两格不给它们打分
elif [ "$KEYSET" = "['note']" ]; then
  ok "UPD 载荷的键集合就是 note 这一项（多一个键就违反「一个意图一个 op」）"
else
  bad "UPD 载荷键集合是 ${KEYSET}，不是 note 一项"
fi
dump
if [ "$APPLIED" = "0" ]; then
  :
elif [ "$(has_sub "已写入备注")" = "1" ]; then ok "写完有回执那句"; else bad "写完没有回执（用户看不出这件事发生了）"; fi

step "11. 出得去：手机同步出去（服务端只存密文 ⇒ 只数条数）"
goto_me_page || summary "移动端 AI 助手真机验收" "载体回不到「我的」页" 1
ensure_phone_sync
S=$(phone_sync) && ok "手机同步出去（${S}s）" || bad "手机同步没完成 —— 第 12 步的下载判据没有上游"

step "12. 进得来：笔记本（另一台设备）解密后读到远端 op"
laptop_ok add "$NOTE_MARK" >/dev/null || bad "笔记本建种子任务失败"
LT_SYNC=$(laptop sync)
if printf '%s' "$LT_SYNC" | grep -q '"ok":true'; then
  LT_REMOTE=$(db_count "$LAPTOP_DB" "select count(*) from ops where json_extract(data,'\$.source')='remote'")
  if printf '%s' "$LT_REMOTE" | grep -qE '^[1-9][0-9]*$'; then
    ok "笔记本读到 $LT_REMOTE 条 source=remote 的 op（跨设备那半成立）"
  else
    bad "🔴 笔记本一条 remote op 都没收到（${LT_REMOTE}）—— 同一次同步里手机侧却报成功，这是「只推不拉」那一族"
    echo "      原始返回：$(printf '%s' "$LT_SYNC" | head -c 300)"
  fi
else
  bad "笔记本同步本身没成功，读不到不算产品的账"
  printf '%s\n' "$LT_SYNC" | head -3
fi

step "13. 取证对账：截图必须属于本轮，且拍的那一刻前台是本应用"
FAIL=0
printf '%s' "$SHOT_FOCUS" | while IFS= read -r line; do
  [ -n "$line" ] || continue
  rel=${line%%=*}; focus=${line#*=}
  printf 'CHECK\t%s\t%s\n' "$rel" "$focus"
done > /tmp/heyta-ai-shots.tsv
while IFS=$'\t' read -r rel focus; do
  [ -n "$rel" ] || continue
  png="$EVIDENCE/$rel"
  if [ ! -s "$png" ]; then echo "   ❌ $rel 没落盘"; FAIL=1; continue; fi
  if [ "$(find "$png" -newermt "@$RUN_STARTED" 2>/dev/null | wc -l | tr -d ' ')" = "0" ]; then
    echo "   ❌ $rel 比本轮起跑时间还旧 —— 它属于上一趟（§7 第 27 条那一族：产物在、结论也对，只是不属于这一轮）"
    FAIL=1
  fi
  case "$focus" in
    *com.heyta*) : ;;
    FOCUS-UNKNOWN) echo "   ❌ $rel 拍的时候 dumpsys 没读到前台 —— 这条判据没有输入"; FAIL=1 ;;
    *) echo "   ❌ $rel 拍的时候前台不是 heyta：$focus"; FAIL=1 ;;
  esac
done < /tmp/heyta-ai-shots.tsv
if [ "$FAIL" = "0" ] && [ -s /tmp/heyta-ai-shots.tsv ]; then
  ok "截图齐且归属本轮：$(wc -l < /tmp/heyta-ai-shots.tsv | tr -d ' ') 张，拍的时候前台都是 heyta"
else
  bad "截图取证对账没过（或这一趟一张都没拍）"
fi
echo "   ↷ 图在这里，**人要打开看**（AGENTS §6.2 规定一）：$EVIDENCE/android-ai-*.png"

step "14. 收尾对账：不能留下 adb 反向代理与假端点进程"
$ADB reverse --remove "tcp:${STUB_PORT}" >/dev/null 2>&1 || true
if [ -f "$STUB_PIDFILE" ]; then
  SP=$(head -1 "$STUB_PIDFILE" | tr -dc '0-9')
  if [ -n "$SP" ] && ps -p "$SP" >/dev/null 2>&1; then
    kill -TERM "$SP" 2>/dev/null || true
    echo "   ✅ 关掉本轮起的假端点 pid=${SP}（只关这个，它是本脚本自己 spawn 的）"
  fi
  rm -f "$STUB_PIDFILE"
fi
summary "移动端 AI 助手真机验收"
