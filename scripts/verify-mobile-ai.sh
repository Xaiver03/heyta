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
PREFS_DB="${HEYTA_PREFS_DB:-/tmp/heyta-device-prefs.sqlite}"   # 与 PHONE_DB 同一个旋钮家族
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
  local rid=$1 want=${2:-} i pass ctrl cx cy ck src y lo hi
  lo=$SAFE_TOP
  hi=$SAFE_BOTTOM
  # 🔴 两趟（rig31/32 现量的方向局限）：第 1 趟按原方向滚到底；第 2 趟摘焦点、回到顶部，
  #   让"控件在视口上方"那一档也有一次机会。第 2 趟开始前先 blur_focus —— 带着焦点的
  #   反向手势会被输入框当文本拖拽吞掉（rig21 的受控 A/B）。
  for pass in 1 2; do
    if [ "$pass" = 2 ]; then
      echo "   ↻ 第 1 趟没把 testID=$rid 滚进安全带 ⇒ 摘焦点回到顶部，换方向再走一趟" >&2
      blur_focus
      scroll_to_top
    fi
    for i in 1 2 3 4 5; do
      dump
    # 🔴 点的是**带 checked / clickable 的那一枚**（容器不可点时往下找一层），
    #    见 rid_control 的注释：`ai-gate-enabled` 这一枚连点 5 次都打在标签文字上，
    #    报出来的却是"总开关点不动"。
    ctrl=$(rid_control "$rid")
    if [ -n "$ctrl" ]; then
      read -r cx cy ck src <<<"$ctrl"
      y=$cy
      if [ "$y" -ge "$lo" ] && [ "$y" -le "$hi" ]; then break 2; fi
      # 在树里但贴着屏边 —— 这不是"没找到"，是"还没滚到位"，两句话要分开说。
      echo "   ↻ testID=$rid 的可点节点（${src}）中心 y=$y 在安全带 [$lo,$hi] 外（贴系统栏），先滚进中段（第 ${i} 次）" >&2
      # 🔴 手势方向由**读数**决定，不由习惯决定（rig32 现量）：这一枚在安全带**上方**时，
      #   `swipe 1900→900`（往下滚）只会让它更靠上，五发滚满永远进不了带子，
      #   而打印出来的那句是「界面形状或 testID 变了」—— 那是假归因。
      #   第 5 步第二发的 `tool-input` 就是这么红的：结果卡渲染在下面，输入框在上面。
      if [ "$y" -lt "$lo" ]; then
        $ADB shell input swipe 540 900 540 1900 300
      else
        $ADB shell input swipe 540 1900 540 900 300
      fi
    else
      # 压根不在树里：先按原方向找（它多半在下方），两趟都试过才说"没有"。
      $ADB shell input swipe 540 1900 540 900 300
    fi
      ctrl=""
      sleep 1.5
    done
    # 🔴 这一格必须排在**两趟都走完**之后：写在 pass 循环里面时，第 1 趟没找到就
    #   `return 1` 退出了函数，换方向那一趟永远不会执行 —— 读数看着像"两种方向都试过"。
  done
  if [ -z "$ctrl" ]; then
    # 两种方向都滚遍了（第 2 趟先摘焦点回到顶部）还是没拿到可点节点。
    #   这里不写"界面形状或 testID 变了"：那句会把"这一档没渲染"与"载体不在那一屏"
    #   冒充成同一件事（traps #330b 的同一形状，而 #331 是它的第三种面目）。
    echo "   ❌ testID=$rid 往下滚满、再摘焦点回到顶部往上滚满，两趟都没有一枚落在安全带 [$lo,$hi] 里的可点节点" >&2
    echo "      ⇒ 要么这一档按设计没渲染（条件渲染的控件），要么载体根本不在那一屏 —— 两种都不记成产品缺陷" >&2
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
# 🔴 存在性判据的前置：那一行此刻在不在**裁切窗口**里。
# 为什么必须有这一层（2026-10-06 现量，一趟滚到底的逐帧 bounds 读数 `tmp/arm-profile-bounds.sh`）：
#   「我的」顶部那一帧里 `profile-entry-habits` 的矩形是 **[42,2283][1038,2166]**（y1>y2，被
#   容器底沿 2166 裁成退化），而它下面的 assistant/trash/export/close-account **整枚不在树里**；
#   一次下滑之后 assistant=1236-1351、trash=1383-1498、export=1530-1645、close-account=1677-1792
#   同时完整出现。⇒ `has_rid` 的那个 0 有两种读法："这一行没渲染"与"这一行在裁切线以外"，
#   而第 5 步要的恰恰是前者。rig15 就是拿后者当成了产品缺陷（`❌ 配好端点后「我的」里仍没有…`）。
# 用法：`reveal_rid <testID>` 先把它滚进窗口（退化成"看得见"），返回 1 才说明真没有。
# 🔴 rig31 现量的新形状（第 4 步的 ai-endpoint-label、第 5 步第二发的 tool-input 都栽在这）：
#   reveal_rid 的手势只有一种方向（1900→900 = **往下**滚），于是"控件在视口上方"和
#   "控件根本不存在"两种事实被读成同一句「滚不出来 / 界面形状或 testID 变了」。
#   这次是端点表单里加了能力 chip 那一行，内容整体变高：滚动停靠点落到了 chip 以下，
#   而「名称」那一格在**上面** —— 往下滚满 5 发永远够不到它。
#   ⇒ 失败出口必须先排除"方向局限"这一档，再说"没有"。这一档也顺带把 scroll_to_top
#   那五发反向手势复用掉，不在两处再抄第二套手势（同一个判断写两遍就是漂移的起点）。
reveal_rid_top_fallback() {  # <testID> → 0=在视口上方，回到顶部后取到 / 1=回到顶部也没有
  local rid=$1
  blur_focus
  scroll_to_top
  dump
  if [ -n "$(rid_center "$rid")" ]; then
    echo "   · testID=$rid 在**视口上方**（往下滚永远够不到）⇒ 摘焦点回到顶部后取到" >&2
    return 0
  fi
  return 1
}

# 把整页从顶走到底，逐帧查一组 testID，返回**命中**的那些。
# 🔴 为什么要有它：一条"没有 X"的判据必须能出示它把多少帧、哪些档查过了，
#    否则"没观测到"和"没观测"在输出上长得一模一样（AGENTS §7 元规则 1）。
#    reveal_rid 是"找到为止"，够不到时报的是载体失败；这里要的是"走遍全书"。
scan_rids() {  # <testID...> → stdout: 命中的 testID（空格分隔）；没走遍全书时追加哨兵 SCAN-CAP
  local pending="$1" hit="" still="" r ref now stuck=0 frames=0
  blur_focus
  scroll_to_top
  while :; do
    frames=$((frames + 1))
    dump
    still=""
    for r in $pending; do
      if [ -n "$(rid_center "$r")" ]; then hit="$hit $r"; else still="$still $r"; fi
    done
    pending="$still"
    if [ -z "$(printf '%s' "$pending" | tr -d ' ')" ]; then break; fi
    if [ "$frames" -ge 12 ]; then
      echo "   ⓘ 走满 12 帧上限，还没查到：$pending —— 这一格按「载体走不完」记，不记成「界面上没有」" >&2
      hit="$hit SCAN-CAP"
      break
    fi
    ref=$(scroll_anchor_bounds)
    $ADB shell input swipe 540 1900 540 900 300 >/dev/null 2>&1
    sleep 1.2
    dump
    now=$(scroll_anchor_bounds)
    if [ -n "$ref" ] && [ "$ref" = "$now" ]; then
      stuck=$((stuck + 1))
      # 第一次不动先摘焦点（焦点挂在输入框上时长 swipe 会被它吞掉，见 reveal_rid 那段现量），
      # 摘过还是不动才认"到底了"。
      if [ "$stuck" = 2 ]; then blur_focus; continue; fi
      if [ "$stuck" -ge 3 ]; then break; fi
    else
      stuck=0
    fi
  done
  echo "   · 整页走了 ${frames} 帧、逐帧查过五档；未命中：${pending:-（无）}" >&2
  printf '%s\n' "$hit"
}

reveal_rid() {  # <testID> [最多滚几次=6] → 0=滚出来了 / 1=滚不出来
  local rid=$1 max=${2:-6} i ref now stuck=0 blurred=0
  for i in 1 2 3 4 5 6 7 8; do
    [ "$i" -gt "$max" ] && break
    dump
    if [ -n "$(rid_center "$rid")" ]; then
      [ "$i" -gt 1 ] && echo "   · testID=$rid 第 ${i} 帧滚进窗口（此前它在裁切线以外，不在树里）" >&2
      return 0
    fi
    # 🔴 rig21 现量：焦点挂在 `ai-endpoint-model` 上时，一条 1900→900 的 swipe 会被输入框
    #   当文本拖拽吞掉（受控 A/B：同一条手势前后 `ai-feature-capture` 的矩形逐字节相同）。
    #   旧写法滚满 6 次然后报"滚不出来"，读起来像"产品没渲染那两行"——
    #   而 `AiSettingsSection.tsx:381` 是 `FEATURE_ORDER.map(...)`，五档全都渲染。
    #   所以要分开三件事：**画面没动**（手势被吞）/ **画面动了但还没到**（继续滚）/
    #   **滚遍了也没有**（那才是可达性失败）。
    ref=$(scroll_anchor_bounds)
    $ADB shell input swipe 540 1900 540 900 300 >/dev/null 2>&1
    sleep 1.5
    dump
    now=$(scroll_anchor_bounds)
    if [ -n "$ref" ] && [ "$ref" = "$now" ]; then
      stuck=$((stuck + 1))
      if [ "$stuck" -ge 2 ] && [ "$blurred" = 0 ]; then
        echo "   ↻ 连 ${stuck} 发 swipe 参照锚没动（$ref）—— 焦点多半挂在输入框上，先摘焦点" >&2
        blur_focus; blurred=1; stuck=1
      elif [ "$stuck" -ge 3 ]; then
        # 画面不动有两种：滚到列表底了（目标在上方 ⇒ 换方向才有救）/ 这一屏真的滚不动。
        reveal_rid_top_fallback "$rid" && return 0
        echo "   ❌ 摘过焦点、往下滚满又回到顶部再找一次，testID=$rid 还是不在树里 ⇒ 载体够不到（不把这一句记成产品缺陷）" >&2
        return 1
      fi
    else
      stuck=0
    fi
  done
  dump
  [ -n "$(rid_center "$rid")" ] && return 0
  # 往下滚满了还没见到 ⇒ 换方向再判一次，别让"在上方"冒充"不存在"。
  reveal_rid_top_fallback "$rid" && return 0
  echo "   ❌ testID=$rid 往下滚满又回到顶部再找一次仍不在树里 ⇒ 界面形状或 testID 变了" >&2
  return 1
}
# 判断"这一发手势到底让画面动了没有"的参照锚。
# 🔴 rig23 现量：第一版取"树里第一枚有 resource-id 的节点"，那是 `android:id/content`
#   [0,0][1080,2400] —— **整棵树的根，永远不会动**。于是每一发 swipe 都读成"画面一格没动"，
#   而同一趟里 `ai-feature-breakdown` 确实被滚出来了（滚动真的发生过）。
#   一条自己坏掉的判据比没有判据更糟：它把四格本来能成的绑定拦死，还把原因写成"载体够不到"。
#   ⇒ 参照锚必须是**会随列表位移的内容节点**：带 text/content-desc、非 `android:` 系统 id、
#   矩形非退化。
scroll_anchor_bounds() {
  python3 - <<'PYA'
import os, re, sys
try:
    s = open(os.environ["UI_XML"]).read()
except OSError:
    sys.exit(0)
for m in re.finditer(r'<node\b[^>]*?>', s):
    d = dict(re.findall(r'(\w[\w-]*)="([^"]*)"', m.group(0)))
    rid = d.get('resource-id', '')
    if rid.startswith('android:') or not (d.get('text') or d.get('content-desc')):
        continue
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', m.group(0))
    if not b:
        continue
    x1, y1, x2, y2 = (int(g) for g in b.groups())
    if x2 <= x1 or y2 <= y1:
        continue
    print(rid, x1, y1, x2, y2)
    break
PYA
}
# 兼容旧调用名（同一枚 picker）。
any_anchor_bounds() { scroll_anchor_bounds; }
# 把焦点从输入框上摘下来（RN 的 `keyboardShouldPersistTaps` 默认 `never`：
# 第一次点输入框之外的地方只负责收起焦点，不会落到别的控件上）。
# 点的是标题栏那条空白带（y=300 在 sheet 标题区，不在任何控件的矩形里）。
blur_focus() {
  local i n
  for i in 1 2 3; do
    dump
    # 🔴 `grep -c` 数的是**行数**，而 uiautomator 的产物是**一整行** ⇒ 恒等于 1（有焦点也报 1、
    #    没焦点报 0 只是恰好）。要 occurrences 只能用 `grep -o | wc -l`。
    n=$(grep -o 'focused="true"' "$UI_XML" 2>/dev/null | wc -l | tr -d ' ')
    [ "${n:-0}" = 0 ] && return 0
    $ADB shell input tap 540 300 >/dev/null 2>&1
    sleep 1
  done
  dump
  n=$(grep -o 'focused="true"' "$UI_XML" 2>/dev/null | wc -l | tr -d ' ')
  [ "${n:-0}" != 0 ] && echo "   ⚠️ 点了三次仍有 ${n} 枚 focused —— 只报读数，不替它编一个「已失焦」" >&2
  return 0
}
# 🔴 **反向**存在性判据不能只用上面那条：把目标滚进窗口这件事，本身证明不了"目标那一带被渲染过"。
# 要的是**两枚邻锚同时**有非退化矩形 —— 它们之间那一格这一秒确实在窗口里，缺席才读得出"没渲染"。
# 现量：滚1 那一帧 habits=942-1057 与 trash=1383-1498 同帧成立，而 assistant 的位置就在两者中间。
# 滚不到那样的帧 ⇒ **响亮地失败**，不许把"载体够不到"记成"产品没渲染"，也不许记成"缺席判据通过"。
reveal_between() {  # <上锚> <下锚> [最多滚几次=6] → 0=两锚同帧可见 / 1=没有那样的帧
  local up=$1 lo2=$2 max=${3:-6} i
  for i in 1 2 3 4 5 6 7 8; do
    [ "$i" -gt "$max" ] && break
    dump
    if [ -n "$(rid_center "$up")" ] && [ -n "$(rid_center "$lo2")" ]; then
      echo "   · 邻锚同帧成立：$up 与 $lo2 都在窗口里（第 ${i} 帧）—— 它们之间那一格的缺席才是"没渲染"" >&2
      return 0
    fi
    $ADB shell input swipe 540 1900 540 900 300 >/dev/null 2>&1
    sleep 1.5
  done
  echo "   ❌ 滚了 ${max} 次都凑不出「$up 与 $lo2 同帧可见」——「$up/$lo2 之间那一格不在树里」这句话无从判定，不拿它当通过也不当失败" >&2
  return 1
}
# 滚回列表顶部（后面的步骤要从顶部那一带点第一枚锚点）。
scroll_to_top() {
  local i
  for i in 1 2 3 4 5; do
    $ADB shell input swipe 540 900 540 1900 300 >/dev/null 2>&1
    sleep 1
  done
}
# 挂在 `content-desc` 上的那一类（chip / 按钮）用的 reveal：同一条裁切道理，
# 只是取锚点换成 `has_desc_sub`。有界等待 + 滚动都在这条里，返回 1 才是"滚遍也没有"。
reveal_desc() {  # <content-desc 片段> [最多滚几次=5] → 0=屏上出现了 / 1=滚过也没有
  # 🔴 Chip / 按钮这一类的可辨识名挂在 `content-desc` 上，而 `reveal_sub` 走的是 `has_sub`
  #   （只匹配 `text="…"`）⇒ 拿它去找一枚 chip 会**滚满五次然后报"没有"**，
  #   读起来像产品没渲染那一行。rig22 现量：端点行已经 0→1（存进去了），chip 却命中 0。
  local want=$1 max=${2:-5} i ref now
  for i in 1 2 3 4 5 6; do
    [ "$i" -gt "$max" ] && break
    dump
    if [ "$(has_desc_sub "$want")" = "1" ]; then
      [ "$i" -gt 1 ] && echo "   · 「$want」第 ${i} 帧才出现在屏上（前几帧它在裁切线以外）" >&2
      return 0
    fi
    ref=$(any_anchor_bounds)
    $ADB shell input swipe 540 1900 540 900 300 >/dev/null 2>&1
    sleep 1.5
    dump
    now=$(any_anchor_bounds)
    if [ -n "$ref" ] && [ "$ref" = "$now" ]; then
      echo "   ↻ 这一发 swipe 画面一格没动（焦点多半挂在输入框上），先摘焦点再继续滚" >&2
      blur_focus
    fi
  done
  dump
  [ "$(has_desc_sub "$want")" = "1" ]
}
reveal_sub() {  # <文本片段> [最多滚几次=5] → 0=屏上出现了 / 1=滚过也没有
  local want=$1 max=${2:-5} i
  for i in 1 2 3 4 5 6; do
    [ "$i" -gt "$max" ] && break
    dump
    if [ "$(has_sub "$want")" = "1" ]; then
      [ "$i" -gt 1 ] && echo "   · 「$want」第 ${i} 帧才出现在屏上（前几帧它在裁切线以外）" >&2
      return 0
    fi
    $ADB shell input swipe 540 1900 540 900 300 >/dev/null 2>&1
    sleep 1.5
  done
  dump
  [ "$(has_sub "$want")" = "1" ]
}
# 🔴 助手那一档是 ProfileScreen 盖上来的一层，**底部标签不在树里**
#   （rig16 现量：第 6 步三次 `点了「我的」但标记「立即同步」没出现` ⇒ 整轮中止）。
#   所以离开助手面必须走它自己的出口（testID=assistant-back），不能指望 tab。
leave_assistant() {
  dump
  if [ -z "$(rid_center assistant-back)" ]; then
    return 0          # 没开着助手层 ⇒ 不用收（这条不报错，它是"顺手收一层"）
  fi
  tap_rid assistant-back || { echo "   ❌ 助手层的返回键（testID=assistant-back）点不动" >&2; return 1; }
  scroll_to_top
  return 0
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
# 🔴 块内要找**真正能点的那一枚**：`xy_in_rid` 按 content-desc 命中的往往是标签文字自己。
# 现量（2026-10-06 rig20）：`ui/kit.tsx` 的 `Chip` 写的是
# `Pressable(accessibilityRole=button, accessibilityLabel=label)`，
# 而 AX 树上带 `content-desc="stub-loopback"` 的那一枚是 **clickable=false**
# —— 点它退出码 0、什么都不发生，读起来像"路由没绑上"，其实是指落在了不会响的那一层。
# 与 #324-2 同一条（"这一下送到谁"），只是这次发生在**块内**而不是块上。
# 取"包含该标签矩形、且面积最小的 clickable 祖先"；找不到就退回标签自己并如实说明。
xy_clickable_in_rid() {  # <块 testID> <content-desc> -> "<x> <y> <src>"（或 BLOCK-ABSENT）
  HEYTA_BLOCK="$1" HEYTA_DESC="$2" python3 - <<'PYPY'
import os, re, sys
try:
    s = open(os.environ["UI_XML"]).read()
except OSError:
    sys.exit(0)
block, desc = os.environ["HEYTA_BLOCK"], os.environ["HEYTA_DESC"]

def box(tag):
    m = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
    return [int(g) for g in m.groups()] if m else None

nodes = []
for m in re.finditer(r'<node\b[^>]*?>', s):
    d = dict(re.findall(r'(\w[\w-]*)="([^"]*)"', m.group(0)))
    b = box(m.group(0))
    if not b or b[2] <= b[0] or b[3] <= b[1]:
        continue
    nodes.append((d, b))

host = next((n for n in nodes if n[0].get('resource-id') == block), None)
if host is None:
    print('BLOCK-ABSENT')
    sys.exit(0)
bx = host[1]
hit = None
for n in nodes:
    if n is host:
        continue
    if n[0].get('content-desc') != desc and n[0].get('text') != desc:
        continue
    if bx[0] <= n[1][0] and n[1][2] <= bx[2] + 1 and bx[1] <= n[1][1] and n[1][3] <= bx[3] + 1:
        hit = n
        break
if hit is None:
    sys.exit(0)
hx = hit[1]
anc = [n for n in nodes
       if n[1][0] <= hx[0] and hx[2] <= n[1][2] + 1
       and n[1][1] <= hx[1] and hx[3] <= n[1][3] + 1
       and (n[0].get('clickable') == 'true' or n[0].get('checkable') == 'true')]
if anc:
    pick = min(anc, key=lambda n: (n[1][2] - n[1][0]) * (n[1][3] - n[1][1]))
    print((pick[1][0] + pick[1][2]) // 2, (pick[1][1] + pick[1][3]) // 2, 'clickable-ancestor')
else:
    print((hx[0] + hx[2]) // 2, (hx[1] + hx[3]) // 2, 'label-self-no-clickable-ancestor')
PYPY
}

tap_in_rid() {  # <块 testID> <content-desc>
  local block=$1 desc=$2 i out src cx cy
  for i in 1 2 3 4 5; do
    dump
    out=$(xy_clickable_in_rid "$block" "$desc")
    if [ "$out" = "BLOCK-ABSENT" ]; then
      # 块本身不在这一秒的树里 —— 与"块里没有那枚 chip"是两句话，不许混着报
      echo "   ↻ 块 $block 还没进窗口（第 ${i} 帧），先滚进来" >&2
    elif [ -n "$out" ]; then
      read -r cx cy src <<<"$out"
      echo "   · 点 $block 里的「$desc」→ 落在 [${src}] @ ${cx},${cy}" >&2
      $ADB shell input tap "$cx" "$cy" >/dev/null 2>&1
      sleep 1
      if [ "$src" = "label-self-no-clickable-ancestor" ]; then
        echo "   ❌ $block 里的「$desc」找不到可点祖先（只有 clickable=false 的标签层）—— 这一下会落空" >&2
        return 1
      fi
      return 0
    fi
    $ADB shell input swipe 540 1900 540 1100 250
    sleep 1.5
  done
  echo "   ❌ 滚了 5 次，块 $block 里找不到 content-desc=$desc 的节点" >&2
  return 1
}

# 🔴 建完端点**还不够**：必须把它绑进各功能的 routes。
#   `resolveRoute` 吃的是 `config.routes[feature]`（`packages/app-host/src/ai-route-target.ts`
#   → `packages/ai/src/routing.ts`），端点只躺在 `endpoints[]` 里时那一档的候选集是空的 ⇒
#   `resolveAiRoute().target` 为 undefined ⇒ 助手屏的六枚按钮（`tool-start-single` /
#   `tool-start-assistant` / `breakdown-start` / …）**全部 enabled=false**。
#   rig18 现量：输入框里已经躺着文字，`tool-start-assistant` 仍 disabled ——
#   那不是产品坏了，是这一发配置步骤在载体里从来没做过。
#   ⚠️ 点完必须**读回 selected**：`tap_in_rid` 只证明"手指落下去了"，不证明"路由真的写进去了"
#   （AGENTS §7 元规则二：点了没回读 = 把探针的故障留给下一条判据去猜）。
bind_route() {  # <功能名> <端点标签>
  local f=$1 label=$2 block="ai-feature-$1" sel
  reveal_rid "$block" || { echo "   ❌ 逐功能块 $block 滚不出来" >&2; return 1; }
  tap_in_rid "$block" "$label" || return 1
  # ⚠️ 这里**不拿 `selected` 当判据**，只把读数打印出来：rig20 现量整棵 AX 树
  #   `selected="true"` 命中 **0** 枚，而 `ui/kit.tsx` 的 Chip 明明写了
  #   `accessibilityState={{ selected }}` ⇒ 选中态在 Android 无障碍树上读不到
  #   （产品侧的可访问性缺口，已登记进计划；载体不能替它编一个读数）。
  #   绑定到底有没有生效，判据放在**被绑那一侧**：第 5 步的按钮必须 enabled。
  sel=$(xy_in_rid "$block" "$label" selected | awk '{print $3}')
  echo "   ↷ 现量：$block 里「$label」的 selected=${sel:-读不出}（Android 读不到选中态，理由见上）" >&2
  return 0
}

# 🔴 绑定到底有没有写进去，**不拿 AX 的 selected 判**（rig20 现量：整棵树 `selected="true"`
#   命中 0，而 Chip 明明写了 accessibilityState={{selected}} —— 选中态在 Android 无障碍上读不到，
#   已登记成产品侧可访问性缺口）。改成从设备库里读回那份 JSON：
#   表 `device_pref`、键 `heyta.ai.settings`（apps/mobile/src/ai/settings-store.ts:41），
#   值里就是 `routes[feature]` 与 `consents` —— **在被写那一侧读**，而不是看手指落没落。
# 🔴 `device_pref` **不在** op-log 那枚库里（现量：`/data/data/com.heyta/databases/` 下有两枚
#   —— `heyta.sqlite`(73,728B) 与 `heyta-device-prefs.sqlite`(12,288B)）。第一版拿 `$PHONE_DB`
#   （op-log 那份）去 `SELECT … FROM device_pref`，读出 `BAD:DatabaseError`，
#   那条"绑定要从库里回读"的判据于是把**探针开错文件**报成了"绑定无从判定"（traps #328 的第四种面目：
#   尺子自己坏了）。取现量：adb -s <dev> shell ls -la /data/data/com.heyta/databases/
pull_prefs_db() {
  rm -f "$PREFS_DB" 2>/dev/null
  $ADB root >/dev/null 2>&1 || true
  sleep 1
  # 🔴 通道顺序有因：这台装机是**不可调试的 Release 产物**，`run-as` 只回一行
  #   "run-as: package not debuggable"（42 字节），而 `exec-out … > 文件` 的退出码属于**重定向**，
  #   于是那行报错被当成库文件写进去，判据读出「不是数据库」—— 那是探针挑了条走不通的通道，
  #   不是设备里没有库（traps #328 的第四种面目：尺子自己坏了）。
  #   root + `adb pull` 在这台模拟器上拿得到真库（现量 12,288B、头部 `SQLite format 3`）；
  #   run-as 只留作可调试装机的兜底，且**必须验过魔数才算数**。
  $ADB pull "/data/data/$PKG/databases/heyta-device-prefs.sqlite" "$PREFS_DB" >/dev/null 2>&1 || true
  if ! head -c 16 "$PREFS_DB" 2>/dev/null | grep -q 'SQLite format 3'; then
    $ADB exec-out run-as "$PKG" cat "databases/heyta-device-prefs.sqlite" > "$PREFS_DB" 2>/dev/null || true
  fi
  $ADB unroot >/dev/null 2>&1 || true
  # 🔴 这对 root/unroot 会重启 adbd ⇒ **每一枚 adb reverse 被清掉**（A/B 见 ensure_tunnel 头）。
  #   这里补回来；补没补上**不在这里判**，由发送前那一句 tunnel_or_environment_fail 判 ——
  #   隧道是"用到那一刻的断言"，不是库回读的副产品。
  ensure_tunnel >/dev/null 2>&1 || true
}

# 🔴 存进去没有，只能由**被写那一侧**回答（同 routes_reading 的理由）。
#   旧写法用 `endpoint_rows()`（数屏上 `ai-endpoint-*` 的行）做前后对比 —— 那是**滚动位置的函数**：
#   rig26 现量第 4 步 "行数 0→1" 就是这么来的（add_endpoint 头上新加的 scroll_to_top 把已存的那一
#   行从折叠区外滚进了安全带），读起来像"明文端点落库了"那种隐私缺陷，实际是探针自己移动了尺。
endpoint_store_count() {  # → 端点条数（整数）；读不到库打印 NOFILE / BAD:* 并以 1 退出
  pull_prefs_db
  if [ ! -s "$PREFS_DB" ] || [ "$(wc -c < "$PREFS_DB")" -lt 512 ]; then printf 'NOFILE'; return 1; fi
  head -c 16 "$PREFS_DB" | grep -q 'SQLite format 3' || { printf 'BAD:not-a-db'; return 1; }
  HEYTA_DB="$PREFS_DB" python3 - <<'PYE'
import json, os, sqlite3, sys
try:
    row = sqlite3.connect(f"file:{os.environ['HEYTA_DB']}?mode=ro", uri=True).execute(
        "SELECT value FROM device_pref WHERE key='heyta.ai.settings'").fetchone()
except sqlite3.Error as e:
    print(f"BAD:{type(e).__name__}"); sys.exit(0)
if not row:
    print("BAD:no-row"); sys.exit(0)
try:
    v = json.loads(row[0])
except json.JSONDecodeError:
    print("BAD:json"); sys.exit(0)
print(len((v.get('routing') or {}).get('endpoints') or []))
PYE
}

endpoint_caps() {  # → 库里的能力声明读数（只读回、不判定；读不到打 NOFILE/BAD:*）
  pull_prefs_db
  if [ ! -s "$PREFS_DB" ] || [ "$(wc -c < "$PREFS_DB")" -lt 512 ]; then printf 'NOFILE'; return 1; fi
  head -c 16 "$PREFS_DB" | grep -q 'SQLite format 3' || { printf 'BAD:not-a-db'; return 1; }
  HEYTA_DB="$PREFS_DB" python3 - <<'PYC'
import json, os, sqlite3
try:
    row = sqlite3.connect(f"file:{os.environ['HEYTA_DB']}?mode=ro", uri=True).execute(
        "SELECT value FROM device_pref WHERE key='heyta.ai.settings'").fetchone()
    eps = (json.loads(row[0]).get('routing') or {}).get('endpoints') or [] if row else []
except Exception as e:
    print(f"BAD:{type(e).__name__}"); raise SystemExit(0)
print(' '.join(f"{e.get('label','?')}=[{','.join(e.get('capabilities') or ['<baseline>'])}]" for e in eps) or 'BAD:no-endpoint')
PYC
}

routes_reading() {  # → 每档一行 "feature=<绑定端点数>/<同意数>"；读不到库打 NOFILE、解析不了打 BAD
  pull_prefs_db
  if [ ! -s "$PREFS_DB" ] || [ "$(wc -c < "$PREFS_DB")" -lt 512 ]; then printf 'NOFILE'; return 1; fi
  # 头部一验：不是 SQLite 文件就直说（42 字节的 run-as 报错文本会被 sqlite 当成"打不开"）
  head -c 16 "$PREFS_DB" | grep -q 'SQLite format 3' || { printf 'BAD:not-a-db'; return 1; }
  HEYTA_DB="$PREFS_DB" python3 - <<'PYR'
import json, os, re, sqlite3, sys
db = os.environ["HEYTA_DB"]
try:
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    row = con.execute("SELECT value FROM device_pref WHERE key='heyta.ai.settings'").fetchone()
except sqlite3.Error as e:
    print(f"BAD:{type(e).__name__}")
    sys.exit(0)
if not row:
    print("BAD:no-row")
    sys.exit(0)
try:
    v = json.loads(row[0])
except json.JSONDecodeError:
    print("BAD:json")
    sys.exit(0)
routing = v.get("routing") or {}
routes = routing.get("routes") or {}
consents = v.get("consents") or []
feats = ["capture", "breakdown", "prioritize", "duration-estimate", "tool-calling"]
granted = {c.get("feature") for c in consents if isinstance(c, dict) and c.get("granted") is not False}
for f in feats:
    print(f"{f}={len(routes.get(f) or [])}/{1 if f in granted else 0}", end=" ")
print()
PYR
}

bind_all_routes() {  # <端点标签> —— 五档逐条绑，没绑上的要指名是哪一档
  local label=$1 f MISSING=""
  # 🔴 建完端点那一发把焦点留在 `ai-endpoint-model` 上（rig21 现量 `focused="true"`），
  #   而带着焦点的长距离 swipe 会被输入框当文本拖拽吞掉（受控 A/B：同一条手势前后
  #   参照锚逐字节相同）。不先摘焦点，后三档一律"滚不出来"——那是载体的手势没送达，
  #   不是产品没渲染（`AiSettingsSection.tsx:381` 是 `FEATURE_ORDER.map`，五档全渲染）。
  blur_focus
  scroll_to_top
  # 这一串必须与 `AiSettingsSection.tsx` 的 FEATURE_ORDER 同序同值；
  # 取现量：grep -A 6 "const FEATURE_ORDER = \[" apps/mobile/src/ai/AiSettingsSection.tsx
  for f in capture breakdown prioritize duration-estimate tool-calling; do
    bind_route "$f" "$label" || MISSING="$MISSING $f"
  done
  if [ -n "$MISSING" ]; then
    echo "   ❌ 这些档没绑上端点:$MISSING" >&2
    return 1
  fi
  # 🔴 回读，不接受"点了就行"：五档每档的 routes 里必须有 ≥1 枚端点。
  local read line miss2
  read=$(routes_reading)
  echo "   · 设备库回读（routes/同意，键 heyta.ai.settings）：${read:-读不出}" >&2
  if [ -z "$read" ] || [ "$read" = "NOFILE" ] || printf '%s' "$read" | grep -q '^BAD\| BAD'; then
    echo "   ❌ 库回读没拿到（$read）—— 绑定这件事就无从判定，不拿"点过了"当已通过" >&2
    return 1
  fi
  miss2=""
  local n
  for line in $read; do
    n=${line#*=}; n=${n%%/*}
    # 🔴 判"≥1 枚"而不是"以 1 开头"：绑第二枚端点之后那格会读成 2，用前缀匹配就把正常状态判成红
    case "$n" in (''|*[!0-9]) miss2="$miss2 $line(读不出)" ;; *) [ "$n" -ge 1 ] || miss2="$miss2 $line" ;; esac
  done
  if [ -n "$miss2" ]; then
    echo "   ❌ 库里这些档仍然没绑上（点到了 ≠ 写进去了）:$miss2" >&2
    return 1
  fi
  echo "   · 五档在库里各有 ≥1 枚端点（这条判据读的是被写那一侧，不是手指）" >&2
  # 🔴 端点绑上 ≠ 同意给了 —— 但"这一档到底要不要同意"是**产品判的**，期望值必须从它推。
  #   `requiresEgressConsent(classifyDestination({mode:'own', endpoint}))`（packages/ai/src/supply.ts）
  #   对**字面量已定性的回环**返回 destination='none'（127.0.0.0/8 = endpoint-address.ts:227、
  #   localhost = :280、::1 = :257），而 `ai-consent-<feature>` 罩在 `{needs ? …}` 里
  #   （apps/mobile/src/ai/AiSettingsSection.tsx:441）⇒ **这一档按设计不渲染授权入口**。
  #   rig28~34 现量：这一趟配的是回环 stub，载体却无条件逐档 reveal 那枚按钮，五档全报
  #   "滚不出来" —— 白花五轮滚动，还打出五条读起来像"载体坏了"的 ❌。
  #   一条恒不成立的判据比没有判据更糟（traps #333 的同族第二种面目）。
  #   ⇒ 期望值由这一趟**真的配了哪个端点**推，两档各有判据（只留一支就是恒绿的那一半）：
  #     回环   ⇒ 走完整页，五档都不许出现同意行；出现即红（在"没出境"的档位上索取授权）
  #     非回环 ⇒ 五档都必须出现且点得动；不出现即红（授权入口消失了）
  #   正向对照不另造：后面把路由换到**非回环**那一段（`ai-consent-breakdown 在树里`）就是
  #   "会出现"那一支的现量读数 —— 同一枚 build、同一个页面，只有目的地不同。
  local cf NEEDS_CONSENT ep_host consent_hit MISSC="" cap=0
  if [ -z "${2:-}" ]; then
    echo "   ❌ 调用方没把端点 URL 交给 bind_all_routes ⇒ 推不出这一档该不该有授权入口" >&2
    echo "      期望值不许猜（猜成「该有」就退回 rig28~34 那条恒不成立的判据）" >&2
    return 1
  fi
  ep_host=$(printf '%s' "$2" | sed -E 's#^[A-Za-z][A-Za-z0-9+.-]*://##; s#/.*$##; s#:[0-9]+$##; s#^\[##; s#\]$##')
  case "$ep_host" in
    127.[0-9]* | localhost | ::1) NEEDS_CONSENT=0 ;;
    *) NEEDS_CONSENT=1 ;;
  esac
  echo "   · 目的地期望：endpoint 字面量 host=$ep_host ⇒ requiresEgressConsent=$( [ "$NEEDS_CONSENT" = 1 ] && echo true || echo false )" >&2
  if [ "$NEEDS_CONSENT" = 0 ]; then
    consent_hit=$(scan_rids "ai-consent-capture ai-consent-breakdown ai-consent-prioritize ai-consent-duration-estimate ai-consent-tool-calling")
    cap=0
    case " $consent_hit " in
      *" SCAN-CAP "*) cap=1; consent_hit=$(printf '%s' "$consent_hit" | sed 's/ *SCAN-CAP//') ;;
    esac
    if [ -n "$(printf '%s' "$consent_hit" | tr -d ' \n')" ]; then
      echo "   ❌ 目的地是 'none'（回环字面量 $2）却渲染了逐功能授权入口：$consent_hit" >&2
      echo "      红的是「明文没离开本机也向用户索取授权」：classifyDestination 放宽了，或 needs 那层条件没了" >&2
      return 1
    fi
    if [ "$cap" = 1 ]; then
      echo "   ⓘ 未取证：载体没走完整页（SCAN-CAP）⇒ 只能说「扫过的帧里没有」，不能说「界面上没有」" >&2
    else
      ok "回环端点下界面不索取逐功能授权（走完整页、五档逐帧查过）—— 与 destination='none' 同一口径"
    fi
  else
    for cf in capture breakdown prioritize duration-estimate tool-calling; do
      reveal_rid "ai-consent-$cf" || { MISSC="$MISSC $cf(滚不出来)"; continue; }
      tap_rid "ai-consent-$cf" || MISSC="$MISSC $cf(点不动)"
    done
    if [ -n "$MISSC" ]; then
      echo "   ❌ 非回环端点下这些档没有可点的授权入口：$MISSC" >&2
      echo "      目的地需要授权而界面上没有入口 ⇒ 这一档永远无法被点亮，那是产品的洞" >&2
      return 1
    fi
    ok "非回环端点下五档都出现了逐功能授权入口并已点下"
  fi
  # 库里那一半：回环档**预期全 0**（没有授权可给），非回环档预期各 ≥1。
  local readc linec cc missc2=""
  readc=$(routes_reading)
  for linec in $readc; do
    cc=${linec#*/}
    case "$cc" in (''|*[!0-9]) missc2="$missc2 $linec(读不出)" ;; *) [ "$cc" -ge 1 ] || missc2="$missc2 $linec" ;; esac
  done
  if [ "$NEEDS_CONSENT" = 0 ]; then
    echo "   · 库里五档同意数与界面一致（回环那一档没有授权可给）：$readc" >&2
  elif [ -n "$missc2" ]; then
    echo "   ❌ 点了授权而库里仍是 0：$missc2（$readc）⇒ 写路径没落地，不是「点过了」就算过" >&2
    return 1
  else
    echo "   · 五档逐功能同意在库里各有 ≥1 条（回读：$readc）" >&2
  fi
  return 0
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
STUB_PID=$!
echo "$STUB_PID" > "$STUB_PIDFILE"
STUB_READY=0
for _ in $(seq 1 20); do
  if curl -s --noproxy '*' -m 2 "${STUB_HOST_URL}/__requests" | grep -q '"count"'; then STUB_READY=1; break; fi
  sleep 1
done
if [ "$STUB_READY" -ne 1 ]; then
  echo "   ❌ 假端点 20 秒内没起来（日志 tail：）"; tail -5 "$STUB_LOG"
  summary "移动端 AI 助手真机验收" "载体坏了" 1
fi
# 🔴 "有人答"不等于"答的是本轮这一枚"。rig39 现量的正是这一格：4399 上坐着的是**上一轮泄漏的**
#   假端点（pid=98095，01:24 起），本轮那枚一 listen 就 EADDRINUSE 退出（那句崩溃就在
#   $STUB_LOG 里，而 readiness 循环只看"有没有带 count 的 JSON"，于是**借用了别人的桩**照常开跑）。
#   借用的代价不是一句不整洁：每一次 /__reset 清的是别人的计数、"绑定仍是 127.0.0.1"说的是别人的
#   进程，而第 14 步只 kill 自己那枚**已经死了的** pid ⇒ 泄漏逐轮累积，每一轮继承上一轮的桩
#   （traps #340）。判据形状：端口上的监听者必须逐字等于本轮 spawn 的 pid。
#   ⚠️ 这里用 lsof 而不 kill：别人的进程**不由本脚本动手**，只把 pid 与启动时刻如实交出来。
STUB_OWNER=$(lsof -nP -tiTCP:"${STUB_PORT}" -sTCP:LISTEN 2>/dev/null | tr -d '\r' | head -1)
if [ "${STUB_OWNER:-无}" != "$STUB_PID" ]; then
  echo "   ❌ ${STUB_PORT} 上的监听者不是本轮起的假端点（端口 owner=${STUB_OWNER:-无}，本轮 pid=${STUB_PID}）"
  if [ "${STUB_OWNER:-无}" != "无" ]; then
    echo "      占着端口的那一枚（**不动它**，等它的owner收或换端口）："
    ps -o lstart=,command= -p "$STUB_OWNER" 2>/dev/null | head -1 | cut -c1-150
  fi
  tail -3 "$STUB_LOG" 2>/dev/null
  summary "移动端 AI 助手真机验收" "假端点端口坐着上一轮遗留的进程 —— 不借用别人的桩，环境不成立" 3
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
# 🔴 隧道不是"起跑前的一次性前置"，是**用到那一刻的断言**。
#   成因（rig39 现量，A/B 做过）：`adb root` 与 `adb unroot` 都会**重启 adbd**，
#   而重启会把该设备上**全部 `adb reverse` 转发清掉** ——
#     root 前：`reverse --list` = `host-20 tcp:4399 tcp:4399`
#     root 后：`reverse --list` = 空
#   而 `pull_prefs_db` / `pull_phone_db` 各含一对 root+unroot（读设备库那几条判据要用），
#   于是第一次库回读（第 3 步）就把后面每一发 AI 请求依赖的通道拆了。
#   后果不只是第 9 步红：第 5/7/8 步那几条「假端点计数 0→0」在**通道断了**与
#   **闸门拦住了**两种状态下读数一模一样 —— 判据失去区分力，读起来却像隐私闸门成立。
#   所以这里把"补隧道 + 正向对照"收成**一个函数**（同一判断不许写三遍，§3.2 那条教训），
#   在每一次真发请求之前调用它，而不是只在起跑时证明一次。
ensure_tunnel() {  # → 0 可达（成功时**不打印**，靠空输出判别）；非 0 时把原因打到 stdout
  $ADB reverse "tcp:${STUB_PORT}" "tcp:${STUB_PORT}" >/dev/null 2>&1 || { printf 'reverse-failed'; return 1; }
  local p0 p1
  p0=$(stub_probe_hits) || { printf 'reach-unreadable'; return 1; }
  $ADB shell "(printf 'GET /__probe HTTP/1.0\r\n\r\n'; sleep 2) | toybox nc -w 4 127.0.0.1 ${STUB_PORT} >/dev/null 2>&1; true" >/dev/null 2>&1
  p1=$(stub_probe_hits) || { printf 'reach-unreadable'; return 1; }
  # 只认"涨了"。旁边有人 curl 别的诊断路径不会顶 probeHits（stub 只数命中 /__probe 的请求），
  # 所以"没涨"只剩一种解释：设备发不出去。
  if [ "$p1" -le "$p0" ]; then printf 'probe-not-counted(%s→%s)' "$p0" "$p1"; return 1; fi
  return 0
}
# 🔴 `summary` 必须在**父 shell** 里调用才退得了整趟：`$(ensure_tunnel)` 是子 shell，
#   把退出写进子 shell 等于没退出（这一族已经踩过一次，见 scan_rids 的 SCAN-CAP 注释）。
#   所以判别形状是"成功时空输出"，调用方拿字符串后自己决定退不退。
tunnel_or_environment_fail() {  # <这一步的名字>
  TUNNEL_WHY=$(ensure_tunnel)
  if [ -n "$TUNNEL_WHY" ]; then
    echo "   ❌ 设备够不到假端点（${1}：${TUNNEL_WHY}）—— 探针的通道断了，**不记为产品失败**"
    summary "移动端 AI 助手真机验收" "设备够不到假端点（${1}）—— 环境不成立，不是产品失败" 3
  fi
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
#
# 🔴 补隧道 + 这一发对照**只有 `ensure_tunnel` 一份实现**（同一判断写两遍就会漂移，
#    §3.2 那条教训的第三种面目）；起跑这一处与每一步发送前那几处走的是同一条。
if ! $ADB shell 'which nc' 2>/dev/null | tr -d '\r' | grep -q nc; then
  echo "   ❌ 设备镜像里没有 nc —— 正向对照无法建立，载体不成立（不是产品失败）"
  summary "移动端 AI 助手真机验收" "探针二进制缺失" 3
fi
TUNNEL_WHY=$(ensure_tunnel)
if [ -n "$TUNNEL_WHY" ]; then
  echo "   ❌ 设备里发出的 /__probe 没被假端点数到（${TUNNEL_WHY}）—— 设备够不到假端点，环境不成立，不是产品失败"
  summary "移动端 AI 助手真机验收" "设备够不到假端点（起跑前置）" 3
fi
echo "   ✅ 转发表：$($ADB reverse --list | tr -d '\r')"
echo "   ✅ 设备内回环可达（/__probe 正向对照 +1，实现见 ensure_tunnel）"

step "0. 全新安装 + 隐私门（先选「只用本机」）"
$ADB shell pm clear "$PKG" >/dev/null 2>&1 || true
$ADB shell am force-stop "$PKG" >/dev/null 2>&1 || true
# 🔴 adb 的输出必须留在判据里（2026-10-06 05:50 实测）：这一行原来写成
#   `$ADB install -r -g … >/dev/null 2>&1 || echo 装不上`，于是换打包机带来的那次失败
#   只剩「装不上」三个字。真原因是
#   `INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.heyta signatures do not
#   match newer version; ignoring!` —— Android 的 release 变体在没有发布键时挂的是
#   **打包机自己的 debug keystore**（`build.gradle` 那条回退），本机打出来的 APK 与
#   windows-pc 打出来的那颗键不同 ⇒ 同包名跨键**不能 `-r` 覆盖安装**。
#   载体坏掉的那一步要自带原因，否则下一轮还得重新手动复现一次才知道它为什么坏。
#   修法分两层：① 先把输出接进变量；② 认出这一种失败就卸掉重装（这一步本来就写着
#   「全新安装」，`pm clear` 已经把数据清了，卸载不多丢任何状态），重装仍失败才判红。
INSTALL_OUT=$($ADB install -r -g "$APK" 2>&1)
if [ $? -ne 0 ]; then
  case "$INSTALL_OUT" in
    *INSTALL_FAILED_UPDATE_INCOMPATIBLE*)
      echo "   ⓘ 已装的那枚与本轮产物不是同一颗签名键（换了打包机 = 换了 debug keystore）⇒ 卸载后重装"
      UN_OUT=$($ADB uninstall "$PKG" 2>&1); echo "      uninstall：${UN_OUT}"
      INSTALL_OUT=$($ADB install -g "$APK" 2>&1)
      if [ $? -ne 0 ]; then
        echo "   ❌ 卸载后仍装不上 $APK"
        echo "      adb 原文：${INSTALL_OUT}"
        summary "移动端 AI 助手真机验收" "载体坏了" 1
      fi
      ok "换键后全新安装成功（本轮产物是这一台打出来的）"
      ;;
    *)
      echo "   ❌ 装不上 $APK"
      echo "      adb 原文：${INSTALL_OUT}"
      summary "移动端 AI 助手真机验收" "载体坏了" 1
      ;;
  esac
fi
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

# 🔴 通道顺序照 pull_prefs_db 那条已验证的形状，**不能**先跑 run-as：
#   这台装机是不可调试的 Release 产物，`run-as` 只回一行 "run-as: package not debuggable"，
#   而 `exec-out … > 文件 || adb pull` 里那个退出码属于**重定向**（恒 0）⇒ 兜底那支永不执行，
#   于是那行报错文本被当成库文件写进去，`db_count` 读出 BAD。
#   rig38 现量：第 9 步「手机库读不出（BAD）」—— 那是**探针挑了条走不通的通道**（traps #328
#   的第四种面目），不是设备里没有库（同一时刻 `ls` 得到 heyta.sqlite 73,728B）。
pull_phone_db() {
  rm -f "$PHONE_DB" 2>/dev/null
  $ADB root >/dev/null 2>&1 || true
  sleep 1
  $ADB pull "/data/data/$PKG/databases/heyta.sqlite" "$PHONE_DB" >/dev/null 2>&1 || true
  if ! head -c 16 "$PHONE_DB" 2>/dev/null | grep -q 'SQLite format 3'; then
    # 只有验过魔数才算数；不行就清掉，别让上一支的报错文本冒充库文件
    rm -f "$PHONE_DB" 2>/dev/null
    $ADB exec-out run-as "$PKG" cat "databases/heyta.sqlite" > "$PHONE_DB" 2>/dev/null || true
    head -c 16 "$PHONE_DB" 2>/dev/null | grep -q 'SQLite format 3' || rm -f "$PHONE_DB" 2>/dev/null
  fi
  $ADB unroot >/dev/null 2>&1 || true
  # 同 pull_prefs_db：这一对 root/unroot 拆掉了 adb reverse，补回来（判据在发送前那句）。
  ensure_tunnel >/dev/null 2>&1 || true
}
db_count() {  # <sqlite 文件> <SQL>
  if [ ! -s "$1" ]; then printf 'NOFILE'; return 1; fi
  # 头部一验：不是 SQLite 就把**读到的是什么**说清楚（42 字节的 run-as 报错文本
  # 与半个下载中的库，在"查询失败"这一格里长得一模一样）
  head -c 16 "$1" 2>/dev/null | grep -q 'SQLite format 3' || {
    printf 'BAD:not-a-db(%sB)' "$(wc -c < "$1" | tr -d ' ')"; return 1; }
  out=$(sqlite3 "$1" "$2" 2>/dev/null | tr -d '\r')
  if ! printf '%s' "$out" | grep -qE '^[0-9-]+$'; then
    printf 'BAD:%s' "$(sqlite3 "$1" "$2" 2>&1 | head -1 | tr -d '\r' | tr -d ':')" ; return 1
  fi
  printf '%s' "$out"
}
# 端点**行数**：已存的每枚端点渲染成一行 `ai-endpoint-<id>`。
# 🔴 必须把表单自己的五枚 testID 剔掉（label/url/model/key/add 也以 ai-endpoint- 开头），
#    否则这个数永远 ≥5、增加一枚根本读不出来 —— 第 4 链的"行数没增加"就是假判据。
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
  # 🔴 先收助手层：它是盖在「我的」上的一层，立着的时候**底部标签不在树里**
  #   （rig16 现量：第 6 步三次 `点了「我的」但标记「立即同步」没出现` ⇒ 整轮中止，
  #    而上一个屏正是第 5 步留下的助手结果卡）。
  leave_assistant || summary "移动端 AI 助手真机验收" "助手层收不掉" 1
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
  # 🔴 第二枚端点是在**逐功能列表已经滚到底**之后加的（rig24：`ai-endpoint-label` 滚 5 次取不到）。
  #   `reveal_rid` 只往下滚，而这一格此刻在**上方** —— "目标在上面够不到"与"没渲染"是两句话。
  #   先摘焦点再回到顶部（同一个理由见 bind_all_routes 头上那段）。
  blur_focus
  scroll_to_top
  # 🔴 声明能力：移动侧此前**没有这一格**，建出来的端点只拿基线 structured_output，
  #   于是 tool-calling（要 tool_calling）与 breakdown（要 long_context）在手机上永远进不了候选，
  #   助手面就表现为"发送按钮恒灰"。三档都勾上，第 5 步才量得到真东西。
  #   ⚠️ 这一格需要**当前源码的 APK**（`check:*-freshness` 会挡旧产物），所以这一发在旧包上必然报
  #   "滚不出来" —— 那是产物过期，不是产品坏了；判据不为此降级。
  local cap
  for cap in structured_output long_context tool_calling; do
    reveal_rid "ai-endpoint-cap-$cap" || { echo "   ❌ 能力格子 ai-endpoint-cap-$cap 不在屏上（旧 APK 没有这一格？）" >&2; return 1; }
    tap_rid "ai-endpoint-cap-$cap" || { echo "   ❌ 能力格子 ai-endpoint-cap-$cap 点不动" >&2; return 1; }
  done
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
# 🔴 第二层：同一句话在**对的屏**上也有两种读法 —— "没渲染"与"在裁切线以外"
#    （见 reveal_rid 的现量）。所以这里必须先把"助手的两枚邻锚凑到同一帧"做出来，
#    缺席才有判决力；凑不出那样的帧 ⇒ 载体响亮失败，不记产品红、也不记通过。
goto_me_page || summary "移动端 AI 助手真机验收" "载体回不到「我的」页" 1
reveal_between profile-entry-habits profile-entry-trash \
  || summary "移动端 AI 助手真机验收" "载体滚不出邻锚同帧（反向判据无从判定）" 1
if [ "$(has_rid profile-entry-assistant)" = "1" ]; then
  bad "还没配端点，「AI 助手」那一格就已经在树里 —— 未配置的功能不该进 DOM，那这条反向判据也就守不住任何东西"
else
  ok "未配置时「AI 助手」入口整行不在 AX 树里（邻锚同帧已证：不是裁切线以外）"
fi
scroll_to_top   # 第 3 步要从顶部那一带点「设置」，别把滚到底的状态留给它

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
ROWS_BEFORE=$(endpoint_store_count)
add_endpoint "$EP_LOOPBACK" "$DEVICE_LOOPBACK_URL" \
  || { echo "   ❌ 回环假端点没存进去"; screen_txt; summary "移动端 AI 助手真机验收" "载体坏了" 1; }
ROWS_AFTER=$(endpoint_store_count)
# 🔴 两件事不许并成一句（rig22 现量：`行 0→1` 已经写进去了，而单帧 `has_desc` 命中 0）：
#   ① **存没存进去** —— 数的是配置里的端点行（这一格当时就成立了）；
#   ② **界面读不读得到那枚 chip** —— chip 挂在 `content-desc` 上，可能在裁切窗口以外，
#      而且刚点完「添加自定义端点」，焦点还赖在模型输入框上，长 swipe 会被它吞掉（见 reveal_desc）。
#   把 ① 和 ② 合成"端点没落进去"，症状与真没保存一模一样，而修法完全不同。
blur_focus
CHIP=1
[ "$(has_desc "$EP_LOOPBACK")" = "1" ] || { reveal_desc "$EP_LOOPBACK" && CHIP=1 || CHIP=0; }
dump
if [ "$CHIP" = "1" ] && [ "$ROWS_AFTER" -gt "$ROWS_BEFORE" ]; then
  ok "回环假端点已落进配置（端点行 ${ROWS_BEFORE}→${ROWS_AFTER}，chip 在树里）"
else
  if [ "$ROWS_AFTER" -gt "$ROWS_BEFORE" ]; then
    bad "端点**存进去了**（行 ${ROWS_BEFORE}→${ROWS_AFTER}）但界面滚遍也读不到那枚 chip —— 这是渲染/可达性问题，不是保存失败"
  else
    bad "端点没存进去（行 ${ROWS_BEFORE}→${ROWS_AFTER}），chip 命中=$(has_desc "$EP_LOOPBACK") —— 先修保存那一步"
  fi
  screen_txt
  summary "移动端 AI 助手真机验收" "端点存不进" 1
fi
# ④ 🔴 端点存进去 ≠ 路由绑上了（见 bind_route 头上那段现量）：不绑，助手面六枚按钮全 disabled，
#    第 5 步往后每一条判据都没有输入。
bind_all_routes "$EP_LOOPBACK" "$DEVICE_LOOPBACK_URL" \
  || { echo "   ❌ 回环端点没能绑进五档路由 —— 助手面的按钮会一直 disabled，那不是产品闸门" >&2; screen_txt; summary "移动端 AI 助手真机验收" "载体没把路由绑上" 1; }

step "4. 明文 + 非回环端点**存不进去**（validateEndpointUrl 的 plaintext-remote）"
ROWS_BEFORE2=$(endpoint_store_count)
add_endpoint "$EP_PLAINTEXT" "$DEVICE_PLAINTEXT_REMOTE_URL"
sleep 1
dump
ERR_SHOWN=$(has_sub "远端端点必须是 https")
ROWS_AFTER2=$(endpoint_store_count)
# 🔴 两次读数里任何一次不是整数 = **载体没读到库**，这不是产品判据，不许拿它推出"存进去了"。
case "$ROWS_BEFORE2$ROWS_AFTER2" in
  *[!0-9]*)
    bad "端点条数读不出来（前=${ROWS_BEFORE2} 后=${ROWS_AFTER2}）⇒ 本步判据**没有读数**，是载体读库失败，不是明文端点落库；先修 pull_prefs_db"
    screen_txt
    summary "移动端 AI 助手真机验收" "载体读库失败" 1
    ;;
esac
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
# 🔴 但**不能直接 goto_me_page**：设置是浮层，浮层开着的时候底部标签根本不在树里
#   （rig14 现量：`↻ 「我的」不在树里` 三连 ⇒ 未跑完就中止，11 项通过却拿不到后面的读数）。
#   先 `leave_settings`（收键盘 → BACK 收浮层 → 兜住前台），再由它的正面锚点收尾。
leave_settings || summary "移动端 AI 助手真机验收" "载体回不到「我的」页" 1
# 🔴 先把它滚进窗口再断言（rig15 现量：顶部那一帧它本就够不到裁切线，
#   `has_rid` 的 0 当时被读成了"产品没渲染这一行"，而手工逐帧滚到底证明 assistant=1236-1351 完整出现）。
reveal_rid profile-entry-assistant || {
  bad "配好端点后「我的」里滚到底也没有「AI 助手」这一格（testID=profile-entry-assistant）"
  screen_txt
  summary "移动端 AI 助手真机验收" "入口没出现" 1
}
if [ "$(has_rid profile-entry-assistant)" = "1" ]; then
  ok "配好端点后「AI 助手」这一格进了树（与第 2 步的缺席对照成对）"
else
  bad "reveal_rid 说滚出来了，has_rid 却说没有 —— 两把尺读的不是同一帧或同一谓词，载体自坏"
  screen_txt
  summary "移动端 AI 助手真机验收" "载体两把尺不一致" 1
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
tap_rid tool-input || { echo "   🔴 工具档里滚不出输入框 testID=tool-input"; screen_txt; summary "移动端 AI 助手真机验收" "载体锚点失效" 1; }
# 🔴 带标签发（标签 = 这枚输入框的 content-desc）：`clear_and_type` 只有拿到标签才会
#    **读回并补齐**。rig18 现量：不带标签发 "list all tasks"，框里只剩 `list`
#    —— 空格在 adb→device shell 那一跳被当成语界，`input text` 退 0、一声不响
#    （`%s` 才对，见 lib 里 `_adb_text` 那段 A/B）。
# 🔴 这一句**不叫 RULE_PROMPT**：规则表 12 条的谓词头全是中文，任何纯 ASCII 句子都命中不了
#   （现量与三条注入通道的分母见下面 5d 那段）。它是"第一发用来走发送链路的句子"。
#   名字要是还留着 RULE_，门禁判据 ⑬ 会当场红 —— 那是刻意的：名字也是一种承诺。
SEND_PROMPT="list all tasks"
clear_and_type "$SEND_PROMPT" "想让它怎么帮你" \
  || { echo "   🔴 助手输入框读不回「$SEND_PROMPT」（发进去的内容与期望不符）—— 这是输入通道坏了，不是产品没答" >&2; screen_txt; restore_ime; summary "移动端 AI 助手真机验收" "载体输入通道坏了" 1; }
restore_ime
stub_reset; RB=$(stub_count) || summary "移动端 AI 助手真机验收" "假端点计数读不出" 1
# 🔴 原先这里写的是裸 `$ADB shell input tap $XY`（取 rid_center 的中心）—— 那是 #324-4
#   的同一条：`tool-start-assistant` 是 `<Button testID=…>`，点它**只是走进披露步**
#   （phase: input → disclose），真正的发送在 `ai-tool-send` 上（AssistantScreen.tsx:1216
#   `send()` 只由 DisclosureStep 的 onSend 触发）。rig16 现量：那句红同时打出
#   `端点收到过的功能：`（空）——**不是因为零外发成立，是因为压根没发**。
#   两半都要修：① 走 tap_rid 并确认披露步真的出现；② 补一次"披露步的发送"。
# 🔴 绑定生效的**正面判据**（也就是第 3 步那五发点击真正的读回口）：
#   `disabled = text.trim()==='' || props.route.target===undefined`
#   —— 框里已有文字（上面逐字读回过），所以 enabled=true 只可能来自"路由真的绑上了"。
dump
if [ "$(rid_attr tool-start-assistant enabled)" != "true" ]; then
  bad "输入框里有文字、按钮却还是 disabled ⇒ 这一档的候选集是空的；两种成因用库回读分辨——\n      现量 routes/同意：$(routes_reading)\n      （rig25 库回读已把「点击没写进去」这一条**排除**：五档 routes 各 1 枚、enabled/allowRemote 都 True。剩下三个候选：这一档的逐功能同意没给（consents=0）／这一枚端点没声明**工具能力**（stub-model 零能力声明，而能力按 ADR-0010 是显式声明、不做推断）／助手档位 assistantTier 把这一档挡在外面。载体不替产品选一个，也不许读成「产品闸门正常工作」——那条闸门另有判据）"
  screen_txt
  summary "移动端 AI 助手真机验收" "路由没绑上" 1
fi
ok "五档路由绑定生效：tool-start-assistant 的 enabled=true（disabled 的另一半条件已由读回的输入框满足）"
# 🔴 这一趟的第一个发送点之前证一次通道（后面的 ai-tool-send 属同一趟，不再重复）。
tunnel_or_environment_fail "第 5 步进披露前"
tap_rid tool-start-assistant || summary "移动端 AI 助手真机验收" "载体锚点失效" 1
dump
if [ -z "$(rid_center ai-tool-send)" ]; then
  bad "点完「发送（多轮）」之后披露步没出现（testID=ai-tool-send 不在树里）—— 那一档的相位机换了，后面的判据没有输入"
  screen_txt
  summary "移动端 AI 助手真机验收" "披露步没出现" 1
fi
ok "点「发送（多轮）」后进的是披露步（ai-tool-send 在树里）—— 请求还没出去，用户先看披露"
# 🔴 发送前重新证明通道（第 5 步之后已经做过好几次库回读 = 好几次 root/unroot）。
#    这一发**预期被本机闸门拦下**、永远到不了端点，所以"计数没动"这条判据只有在一个
#    仍然通得了的通道上才有力；通道断了时它也会读到 0→0，而那句话就不再是隐私闸门的证据。
tunnel_or_environment_fail "第 5 步发送前"
tap_rid ai-tool-send || summary "移动端 AI 助手真机验收" "披露步的发送点不动" 1
sleep 4
dump

# ── 5c 只用本机档：一次发送都到不了端点，而界面把原因与去处都说清楚了 ──────
# 🔴 这一段是重写过的，原来那两条判据在**当前档位下恒不成立**（一条永远不可能通过的判据
#   比没有判据更糟 —— §7 元规则二）：
#   · 旧 5a「规则表选不到的一句必须真的走出去（计数要涨）」：第 0 步选的隐私档是「只用本机」，
#     而这一档下 `packages/app-host/src/privacy-consent.ts` 的 blanket 闸门在任何 fetch 之前就
#     返回 `PRIVACY_CONSENT_BLOCKED_MARKER`（= 屏上那句 privacy-consent-not-granted），
#     所以计数**永远不会**涨。rig33 现量：`通过 16 项 / 失败 0 项` 之后整趟在第二发
#     `tap_rid tool-input` 上中止 —— 因为发送失败后进的是 FailureStep，那一屏压根没有输入框
#     （`AssistantScreen.tsx` 的 `if (phase === 'failed') return <FailureStep/>` 是整屏 return），
#     而载体以为"发完就能接着打第二句"。
#   · 旧 5b 的 `else bad "这一腿没有读数…"`：ASCII 句子命中不了规则表（谓词头全中文），
#     所以那个 else 分支同样是恒红。
# 现在这一腿判三件**在这一档真的可观察**的事，第四件如实登记成未覆盖。
reveal_sub "privacy-consent-not-granted"
BLOCKED=$(has_sub "privacy-consent-not-granted")
NAMED=$(has_sub "127.0.0.1")
RC1=$(stub_count) || summary "移动端 AI 助手真机验收" "假端点计数读不出" 1
if [ "$BLOCKED" = "1" ]; then
  ok "只用本机档：发送在本机闸门处被拦下，界面给出拒绝原文（privacy-consent-not-granted）—— 不是静默失败"
else
  bad "🔴 点完披露步的发送之后，屏上没有本机闸门的拒绝原文 —— 要么闸门换了措辞（判据要跟着改），要么这一档根本没拦"
  screen_txt
fi
if [ "$NAMED" = "1" ]; then
  ok "那句拒绝点名了它本来要去哪个端点（含 127.0.0.1 的 URL）⇒ 下面那条「计数没动」不是「压根没走传输边界」"
else
  bad "拒绝话里没点名端点地址 ⇒ 「请求被拦在客户端」这一半无从判定"
  screen_txt
fi
if [ "$RC1" = "$RB" ]; then
  ok "假端点计数 ${RB}→${RC1} 一次没动（只用本机档：任何一次 AI 发送都不会打到端点）"
else
  bad "🔴 只用本机档下端点却收到了请求（${RB}→${RC1}）—— 隐私闸门被绕过，这是安全级失败"
  echo "      端点收到过的功能：$(feature_lines)"
fi
if [ -n "$(xy_desc "重试")" ]; then
  ok "失败面给出「重试」—— 不确定态可重试，不是把用户钉死在一屏"
else
  bad "失败面没有「重试」那一步：投递失败后用户没有可执行动作"
  screen_txt
fi

# ── 5d 规则命中那一格：**设备侧未覆盖**（登记，不判红、不判绿）──────────────
# 🔴 为什么这一格在这台载体上拿不到读数，三条注入通道逐个试过（不是只试一条就写"做不到"）：
#   ① `input text "列出所有任务"` 与 `input keyboard text …` 都抛
#      `java.lang.NullPointerException: Attempt to get length of null array`（#43 复测）；
#   ② 这台模拟器**没有中文输入法**：`ime list -s -a` 现量只有
#      `com.google.android.inputmethod.latin/.LatinIME` 与 google tts 的 voice IME；
#   ③ `cmd clipboard` 不可用（现量回「No shell function」一类的空实现）。
#   而规则表 `DEFAULT_TOOL_SELECTION_RULES` 每一条的**谓词头全是中文**
#   （列出/列一下/看看/看一下/查看/有哪些…），只有尾部留着 todo / anniversary / countdown
#   这类 ASCII —— 也就是说**不存在任何一句纯 ASCII 的话能被这张表选中**。
#   ⇒ 于是旧稿那句被叫做 RULE_PROMPT 的 "list all tasks" 从来就不是"规则句"，
#     它只是一句 ASCII 普通句子；拿它断言「本机规则命中」是载体自己写错的对象，
#     不是产品没做这条短路（这条短路在 app-host 的 loop 里，ai-e2e 那侧有变异读数）。
# 闭合这一格需要什么，写在这里而不是留给下一个人猜：
#   · 给规则表补 ASCII 别名（并配正反样本）后重打 Android 产物；或
#   · 走 iOS 那条能输中文的通道（现量：iOS 侧助手零设备读数，同样待验证）。
echo "   ⓘ 设备侧未覆盖：「本机规则命中 ⇒ 零外发」这一格在本载体上不可达（ASCII 句子命中不了全中文谓词的规则表）" >&2
echo "     已证的是 5c：只用本机档下任何一次发送都到不了端点；**不许**把 5c 的计数没动读成规则短路的证据。" >&2

# 发完停在失败面 ⇒ 先退出助手屏再走第 6 步（探针留下的状态就是后续判据的输入，#83.1）
if [ -n "$(rid_center assistant-back)" ]; then
  tap_rid assistant-back || summary "移动端 AI 助手真机验收" "载体锚点失效" 1
fi

step "6. 同意联网，但逐功能授权一律不给"
open_ai_settings || summary "移动端 AI 助手真机验收" "载体锚点失效" 1
# 隐私同意在设置**第一段**（合规位置，理由写在 SettingsScreen 的注释里）。
# 🔴 那一格的两枚按钮是**互斥**的，由产品的状态机决定（SettingsScreen.tsx:330 那个三元）：
#   `consentRecord === null`（没决定过 / 刚撤回）⇒ 只有「重新作出选择」
#   `consentRecord !== null`（已同意 **或** 已明确选只用本机）⇒ 只有「撤回同意」
#   rig34/rig35 现量：第 0 步把这一档选成「只用本机」⇒ 走到这里时界面上只有「撤回同意」，
#   而载体找的是「重新作出选择」/「同意并联网」⇒ 两次都取空，报「隐私开关锚点失效」，
#   读起来像合规区块被摘掉了。这是 traps #335 的同一条：**期望值要由产品自己的状态机推**。
#   ⇒ 先到未决定态（点撤回），再走「重新作出选择」把同一张面板开起来；两态各有读数。
blur_focus
scroll_to_top
dump
if [ "$(has_sub 撤回同意)" = "1" ]; then
  echo "   · 现量：区块在「已决定」态（只有「撤回同意」）⇒ 先撤回，回到未决定态才有「重新作出选择」" >&2
  tap_in_rid privacy-consent-section 撤回同意 || tap_desc 撤回同意 \
    || { screen_txt; bad "「撤回同意」在树里却点不动（两锚：块内 clickable 祖先 / content-desc）"; }
  sleep 1.5
  blur_focus; scroll_to_top; dump
fi
XY=$(xy_clickable_in_rid privacy-consent-section 重新作出选择)
[ -n "$XY" ] || XY=$(xy_desc "重新作出选择")
[ -n "$XY" ] || XY=$(xy_desc "同意并联网")
if [ -n "$XY" ]; then
  $ADB shell input tap ${XY% *} ${XY#* } >/dev/null 2>&1
  sleep 2
  handle_privacy_consent "同意并联网" "只用本机" \
    && echo "   ✅ 隐私层已切到「同意并联网」（功能级授权仍逐条手动）" \
    || echo "   ↷ 面板没接住 —— 可能已是联网态。**这句不是 ✅**：到底联网与否由第 7/8 步的计数与披露读数裁决，不由这里自称"
else
  echo "   ❌ 走过「撤回同意」之后，设置里仍然既没有「重新作出选择」也没有「同意并联网」"
  echo "      两枚锚点分别是 consentRecord 的 null / 非 null 两支（SettingsScreen.tsx:330），"
  echo "      两支都取空 ⇒ 要么那一格换了措辞（词条对账会先红），要么区块本身没了"
  screen_txt
  bad "隐私开关锚点失效"
fi

step "7. 非回环 https 端点：授权入口按地址类别出现，未授权时零外发（Goal-7a 的真机对应物）"
# 🔴 必须**先回设置面**再存端点。rig36 现量：这一格原先 add_endpoint 排在
#   open_ai_settings 之前，而第 6 步刚把设置面**收掉**了 ——
#   「重新作出选择」在 `SettingsScreen.tsx:197` 是 `onClose()` 再开同意面板
#   （RN 的 Modal 各开一个原生窗口，"不叠两层"是产品写死的裁决，不是巧合），
#   于是 add_endpoint 落在「我的」页上：表单四格一枚都不在树里，
#   报出来的却是「非回环端点没存进去」+ 一句"旧 APK 没有这一格？"。
#   探针留下的状态就是后续判据的输入（#83.1），而"产品主动收了面"这一档
#   要写在这里，否则下一个人会以为是自己没滚到。
open_ai_settings || summary "移动端 AI 助手真机验收" "载体锚点失效" 1
add_endpoint "$EP_REMOTE" "$DEVICE_REMOTE_URL" \
  || { echo "   ❌ 非回环端点没存进去"; screen_txt; summary "移动端 AI 助手真机验收" "载体坏了" 1; }
# 🔴 存完之后不能直接 open_ai_settings：那一枚入口住在「我的」上，而设置面此刻**还开着**
#   （端点表单是内联在设置面里的），Modal 立着的时候底部标签不在树里
#   （同一件事见 open_ai_settings 头上 leave_assistant 那段）。
#   rig37 现量：三次「我的」不在树里 ⇒ 中止，读起来像导航坏了。
#   ⇒ 先退出设置面回到「我的」，再按正规路径进来（退面不会丢掉刚存的端点：
#     提交发生在点「添加自定义端点」那一刻，不在关闭里）。
leave_settings || summary "移动端 AI 助手真机验收" "载体回不到「我的」页" 1
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
# 🔴 本步第一发之前证一次通道：这一档要的正是"未授权 ⇒ 一次都没落到端点"，
#    而通道断了也读成"一次都没落到端点"。
tunnel_or_environment_fail "第 7 步第一发前"
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
#    🔴 发送前重新证明通道：这一档要的正是"没落到端点"，而通道断了也读成"没落到端点"。
tunnel_or_environment_fail "第 7 步发送前"
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
# 🔴 本步第一发之前证一次通道（"失败必须可见"与"通道断了"在界面上是同一句话）。
tunnel_or_environment_fail "第 8 步第一发前"
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
# 🔴 这一档的判据是「那条不可达地址的失败必须可见」。"可见"与"通道断了"在界面上是**同一句话**
#    （都落到那句连不上端点），所以先把同一刻的通道证一次：设备此刻够得到假端点，
#    它报的连不上才只能指 192.0.2.1 那一趟。
tunnel_or_environment_fail "第 8 步发送前"
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
# 🔴 「AI 拆解」这一发**就是**真正的发送（回环那一档可以没有披露步），所以通道要在它之前证。
# 同上：这一枚在面板底部，**没滚到位时不在树里**；tap_rid 负责滚进安全带再点，
# 并且"不在树里 / 贴着边 / disabled"三种成因各说各的话（disabled 它也会响亮拒绝）。
tunnel_or_environment_fail "第 9 步发送前"
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
# 🔴 提案卡是后面两条判据的**分母**（rig39 现量：屏上是那句"连不上端点"，
#   而下一行照样打了 ✅「只看了提案、没点确认 ⇒ 手机库条数不变」——
#   压根没有提案可看，"没写库"就只是"什么都没发生"的另一个名字，traps #335 的同族）。
PROPOSAL=0
if [ "$(has_sub "拆解结果")" = "1" ]; then
  PROPOSAL=1
  ok "提案卡出来（「拆解结果（N 项）」那句在屏上）"
else
  bad "没有提案卡"; screen_txt
fi
shot_evidence "android-ai-4-proposal.png"
pull_phone_db
OPS_NOCONFIRM=$(db_count "$PHONE_DB" "select count(*) from ops")
S1=$(stub_count) || true
if [ "$PROPOSAL" = "0" ]; then
  echo "   ↷ 「不点确认不写库」这一格**未取证**：没有提案可看，比较条数没有输入（不给它打分）"
elif [ "$OPS_NOCONFIRM" = "$OPS_BEFORE" ]; then
  ok "只看了提案、没点确认 ⇒ 手机库条数不变（${OPS_BEFORE}→${OPS_NOCONFIRM}）—— 这是「只产出提案」的设备级判据"
else
  bad "🔴 没点确认就写了 $((OPS_NOCONFIRM-OPS_BEFORE)) 条 op —— 提案与写入的边界破了"
fi
# 🔴 计数期望值从"这一趟该发出去一次"推导（S0→S0+1），不是打个 ↷ 让人自己看：
#    提案卡出现而假端点一次没被打到，说明那张卡不是这一发送回来的（缓存／上一趟残留）。
if [ "$PROPOSAL" = "0" ]; then
  echo "   ↷ 假端点计数 ${S0}→${S1} 不作判据（没有提案可比）"
elif [ "$S1" = "$((S0+1))" ]; then
  ok "回环这一趟确实打到了假端点（计数 ${S0}→${S1}，恰好 +1）—— 上面那条「没点确认不写库」有分母"
else
  bad "提案卡出现而假端点计数 ${S0}→${S1}（期望恰好 +1）—— 那张卡不是这一发送回来的，判据没有输入"
fi

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
