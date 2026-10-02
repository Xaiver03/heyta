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
# 移动端**自动同步**验收（真模拟器 + 真服务端，零 mock）
# ======================================================
#
# 🔴 为什么必须有这个脚本
#
# 在自动同步之前，全应用**只有一个**地方会调 `syncNow()`：
# `ProfileScreen` 里那个「立即同步」按钮。
#
# 也就是：**用户建完一条任务，它不会自己出去。** 要让它到另一台设备，
# 用户得自己想到"去我的页点一下同步"，而这件事：
#
#   · **不报错**（本地写入一切正常，任务就在列表里）；
#   · **界面看不出异常**（没有转圈、没有告警）；
#   · 单元测试**证明不了**（`sync/store.ts` 的逻辑本身是对的，
#     缺的是"没人调它"——而"没人调"是接线，不是逻辑）。
#
# 所以这个脚本的核心不是"同步能不能成功"（那已经有别的验收覆盖了），
# 而是这一句：**一次同步按钮都没点，另一台设备也必须收到。**
#
# ═════════════════════════════════════════════════════════════════════════
# 判据怎么做到"能失败"
#
# 两条**独立**的证据，故意用不同的机制：
#
#   (a) **服务端日志**：手机在**没有点任何按钮**的情况下发出了请求。
#       快（约 1 分钟内就有结论），而且它直接测"自动同步有没有触发"：
#       把 `startAutoSync()` 拿掉、或把 `emitLocalWrite()` 拿掉，这一条立刻变红。
#
#   (b) **另一台设备真的读到了这条任务**：手机 → 服务端 → 笔记本（真 SQLite）。
#       慢（首次同步含纯 JS Argon2id 派生，实测 30–300 秒），但它是**全链路**证据。
#
# 🔴 只有 (b) 的话，失败要等 900 秒，而"没触发"和"派生太慢"在日志里长得一样；
#    只有 (a) 的话，证明不了数据真的走完了全程。两条都要。
# ═════════════════════════════════════════════════════════════════════════
#
# ⚠️ 这个脚本里**不存在**任何对「立即同步」按钮的点击。这是它成立的前提 ——
#    加了那一下，整个验收就退化成"按钮还能用"，而那一件事早就有人测了。
#
# 用法：
#   bash scripts/verify-mobile-autosync.sh
#
# 前置：模拟器在跑、Postgres 在 5432、服务端在 3000（**TEST_MODE**）。
#       账号每轮新建并写入 /tmp/heyta_mobile_{token,email,e2ee}.txt。


# ── 先准备账号，再加载共享库（顺序不能反，理由见 verify-mobile-conflict.sh）──
. "$(dirname "$0")/lib/mobile-e2e-fresh-account.sh"
heyta_e2e_ensure_account || exit 1
. "$(dirname "$0")/lib/mobile-e2e.sh"

TITLE="autosync-e2e-$(date +%H%M%S)"
# 服务端日志：判据 (a) 的证据来源。默认是本地 e2e 服务端那份。
SERVER_LOG="${HEYTA_SERVER_LOG:-/tmp/heyta-e2e-server.log}"
# 判据 (b) 的等待轮数（每轮 5 秒）。可用环境变量缩短 —— 变异测试要用它。
LAPTOP_ROUNDS="${HEYTA_AUTOSYNC_LAPTOP_ROUNDS:-180}"

echo ""
echo "=== 移动端自动同步验收（真实模拟器 + 真服务端，零 mock）==="
echo "  设备: emulator-5554   服务端: $SERVER   库: heyta_mobile_smoke"
echo "  账号: $EMAIL"
echo "  任务: $TITLE"
echo "  🔴 本轮**不会**点击任何同步按钮 —— 这是本验收的全部意义"

if [ "${#TOKEN}" -lt 100 ]; then
  echo "❌ 令牌看起来不对（长度 ${#TOKEN}）—— 先跑建号脚本"; exit 1
fi
if [ ! -f "$SERVER_LOG" ]; then
  echo "⚠️  找不到服务端日志 $SERVER_LOG —— 判据 (a) 会被跳过（判据 (b) 仍然有效）"
fi

rm -f "$LAPTOP_DB"

step "0. 装包并启动"
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
# 全新初态：上一次跑到一半会在 SQLite 里留下待上传 op，
# 它们会让"这次到底是谁触发的"变得含混。
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
launch_app; sleep 12
dismiss_welcome_if_present   # 首次启动的欢迎页会盖住主界面（规范 §3.1）——先离开它
[ -n "$($ADB shell pidof $PKG 2>/dev/null | tr -d '\r')" ] && ok "应用已启动" || bad "应用没起来"

heyta_e2e_assert_client_budget || bad "账号 client 数已逼近向量时钟上限（后续断言不可信）"

step "1. 配置同步凭据（只填表单，**不点同步**）"
configure_sync_credentials

# 🔴 记录基线：这一步之后，直到本脚本结束都不该有人碰同步按钮。
LOG_BASE=0
[ -f "$SERVER_LOG" ] && LOG_BASE=$(wc -l < "$SERVER_LOG" | tr -d ' ')

step "2. 建一条任务 —— 这是本轮**唯一**的写入动作"
$ADB shell input tap 135 2253; sleep 3   # 「任务」
dump
XY=$(xy_desc "新建任务")
if [ -z "$XY" ]; then bad "找不到新建按钮"; else
  $ADB shell input tap $XY; sleep 2.5
  dump
  XY=$(xy_edit_any)
  if [ -z "$XY" ]; then bad "新建面板里找不到输入框"; else
    $ADB shell input tap $XY; sleep 1
    # ⚠️ 标题必须 ASCII：`adb shell input text` 对非 ASCII 直接抛异常（见脚本头陷阱）。
    $ADB shell input text "$TITLE"; sleep 1.5
    dump
    [ "$(has_text "$TITLE")" = "1" ] && ok "标题已输入" || { bad "标题没输进去"; screen_txt; }
    dump
    XY=$(xy_text "添加")
    if [ -z "$XY" ]; then bad "找不到「添加」"; screen_txt; else
      $ADB shell input tap $XY; sleep 3
    fi
  fi
fi
dump
[ "$(has_text "$TITLE")" = "1" ] && ok "任务已创建：$TITLE" || { bad "任务没创建"; screen_txt; }

step "3. 判据 (a)：没点按钮，服务端也该收到请求"
#
# 🔴 这一条是**最快**能证伪"自动同步根本没接线"的判据：
#    写入 → 2 秒防抖 → `syncNow()`。所以创建任务后一两分钟内，
#    服务端日志一定会多出该账号的请求行（哪怕同步因为派生慢还没跑完）。
#
# 等 120 秒（24 轮 × 5 秒）足够看到**请求**；看不到就说明压根没触发。
# 🔴 只数**真正的同步请求行**，不数 `wc -l`：日志里混着大量
#    `prisma:query ...`，按行数会读到查询日志就以为"同步触发了"。
#    （这跟"验证产物不验证退出码"是同一条：要数的是**信号**，不是**流量**。）
#
# ⚠️ 判据成立的前提：此刻**没有别人**在打服务端 —— 笔记本的第一次同步在
#    第 4 步才开始。所以这段时间里的请求行只可能来自手机。
SAW_REQUEST=0
FIRST_AT=0
if [ "$LOG_BASE" -gt 0 ]; then
  for i in $(seq 1 24); do
    sleep 5
    NEW_REQ=$(sed -n "$((LOG_BASE + 1)),\$p" "$SERVER_LOG" \
      | grep -cE "\[user:[0-9]+\] (Upload|Download)" | tr -d ' ')
    if [ "${NEW_REQ:-0}" -gt 0 ]; then
      SAW_REQUEST=1; FIRST_AT=$((i * 5))
      echo "     第 $i 轮（约 $((i * 5)) 秒）看到 $NEW_REQ 条同步请求行"
      break
    fi
  done
  # 只回显**属于本次**的新增行，避免把上一轮的日志当成本次证据。
  sed -n "$((LOG_BASE + 1)),\$p" "$SERVER_LOG" \
    | grep -E "\[user:[0-9]+\)?\]? (Upload|Download)" | head -5 | sed 's/^/     /'
  if [ "$SAW_REQUEST" = "1" ]; then
    ok "服务端在**没有点任何同步按钮**的情况下收到了请求（自动同步确实触发了）"
  else
    bad "创建任务后 120 秒内服务端**一条请求都没有** —— 自动同步没有触发"
  fi
else
  echo "     ⏭  跳过（没有服务端日志）"
fi

step "4. 判据 (b)：另一台设备读得到这条任务（全链路）"
# ⚠️ 不用 `set -e`：本脚本靠 `bad` 计数而非提前退出。
#    这里也不能写 `set +e ... set -e` —— 收尾那句会把 `-e` **打开**，
#    后面任何一条非零返回（比如 `has_sub` 没匹配到）都会让脚本静默终止。
LAPTOP_OUT=$(wait_laptop_has "$TITLE" "$LAPTOP_ROUNDS"); LAPTOP_RC=$?
case "$LAPTOP_RC" in
  0)
    ok "另一台设备（node-host 真 SQLite）在第 $LAPTOP_OUT 轮读到了「${TITLE}」—— 全程没点过同步按钮"
    ;;
  2)
    # 🔴 "探针自己坏了" 必须和"真的没同步"分开报，否则排查方向会整体跑偏
    #    （见 `wait_laptop_has` 的三态返回码注释）。
    bad "笔记本**探针自己**坏了，判据 (b) 无效（不是产品缺陷）：最后一条输出：$LAPTOP_OUT"
    ;;
  *)
    bad "笔记本 $((LAPTOP_ROUNDS * 5)) 秒内没读到「${TITLE}」—— 数据没有走完全程"
    ;;
esac

step "5. 手机上「待上传」应已归零（队列真的排空了）"
$ADB shell input tap 945 2253; sleep 3   # 「我的」
dump
if [ "$(has_text "已全部上传")" = "1" ]; then
  ok "待上传队列已排空（不是「拉下来了但没推上去」）"
elif has_sub "项"; then
  # 有「N 项」= 队列里还有东西。把那一行原文一起报出来，便于定位。
  PENDING_TXT=$(grep -oE 'text="[^"]*项"' /tmp/ui.xml | head -1)
  bad "待上传没有归零 —— 写入没全部推出去（${PENDING_TXT}）"
else
  bad "读不到待上传状态"; screen_txt
fi

summary "移动端自动同步：不点任何同步按钮，写入也必须出去"
