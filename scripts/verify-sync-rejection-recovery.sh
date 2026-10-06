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
# 同步队列的自愈验收：**一条永远传不上去的 op 不得废掉一台设备**
# ==================================================================
#
# 🔴 为什么必须有这个脚本
#
# 原来 `SyncClient.upload()` 在服务端拒绝任何一条 op 时**直接 throw**，
# 而那个 throw 发生在 `download()` **之前**。后果是一条链：
#
#   同批里被拒的那条永远留在待上传队列
#     → 每次同步都在上传段 throw
#     → `download()` 一次都不执行
#     → **这台设备再也拉不到任何远端数据**，而界面只显示一句"同步失败"
#
# 实测（本脚本第 3 步就是它的复现）：本地队列里混进一条 `clientId` 属于
# **别的设备**的 op 之后，连续两次同步都是 `error`、待上传数恒为 1、
# 设备再没下载过任何东西。用户看到的是"同步一直失败"，
# 而真正发生的事是"这台设备**单向**聋了"。
#
# ── 这个脚本验的是什么
#
#   ① 队列**收敛**：永久拒绝的 op 被移出队列（pending → 0），不再无限重传；
#   ② 数据**不丢**：那条 op 仍然在库里的（`rejected`，不是 deleted）——
#      op-log 是事实来源，删了就没法解释本机曾经是什么值；
#   ③ 状态**不撒谎**：上报的是 `upload-rejected`（结构化）+ `retryable:false`，
#      不是 `unexpected`。`rejected` 也**不等于** `uploaded` ——
#      标成 uploaded 会让"待上传数"和"已同步"同时说假话；
#   ④ 🔴 **下载照常**：被拒的**同一次**同步里，设备仍然必须拉到另一台设备
#      刚写的数据。这一条才是"设备不会变聋"的正面证据 ——
#      ①②③ 全过而 ④ 不过，等于只是把错误显示得好看了点。
#   ⑤ 自愈：下一次同步必须是 `synced`，不带任何错误。
#
# ── 复现手段（这一点必须说清楚，否则"它过了"没有意义）
#
# 真实的坏 op 是**别的设备残留进本机队列**的历史数据（见 `verify-mobile-ios.sh`
# 里那条 `other-device-x-…` 的记录）。本项目没有"故意造一条坏 op"的用户入口，
# 所以这里**直接往 node-host 的真 SQLite 库里插一条** —— 那正是真实故障的形状：
# `source='local'`（在待上传队列里）、`clientId` 不是本机、且没有 serverSeq。
#
# ⚠️ 插入时必须带 `seq`（= `pk0`）：store 的 keyPath 是 `seq`，缺了它
# `put` 会报"缺少主键"，于是 `markRejected` 写不进去 —— 那会让这次运行
# 看起来像"修了但还卡着"，而实际上只是探针自己不合格。
#
# 用法：
#   pnpm verify:sync-recovery
#
# 前置：服务端以 TEST_MODE 跑在 127.0.0.1:3000（建号要用 `/api/test/create-user`）。

set -u
export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1

# 🔴 顺序：**先建号再 source 共享库**（库在 source 时就把凭据读成常量了）。
. "$(dirname "$0")/lib/mobile-e2e-fresh-account.sh"
heyta_e2e_ensure_account || exit 1
. "$(dirname "$0")/lib/mobile-e2e.sh"

# 本脚本只跟 node-host 说话（宿主侧 127.0.0.1），不碰模拟器。
SERVER="$HOST_SERVER"
DEVICE_DB=/tmp/heyta-rejection-device.sqlite
PEER_DB=/tmp/heyta-rejection-peer.sqlite
LAPTOP_DB="$DEVICE_DB"

TITLE_GOOD="rej-good-$(date +%H%M%S)"
TITLE_PEER="rej-peer-$(date +%H%M%S)"
BAD_ID="bad-foreign-$(date +%s)-1"
BAD_CLIENT="some-other-device-client"

echo ""
echo "=== 同步队列自愈验收（真服务端 + 真 SQLite，零 mock）==="
echo "  服务端: $SERVER   库: $E2E_DB"
echo "  账号:   $EMAIL"
echo "  被注入的坏 op: ${BAD_ID}（clientId=${BAD_CLIENT}）"

rm -f "$DEVICE_DB" "$PEER_DB"

# ── 辅助 ────────────────────────────────────────────────────

# 从 sync 的 JSON 里取一个字段（点号路径）。
sync_field() {  # <json> <jq-lite 路径如 status.kind>
  printf '%s' "$1" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
cur=d
for part in '$2'.split('.'):
    if not isinstance(cur,dict) or part not in cur: print(''); raise SystemExit
    cur=cur[part]
print(cur)
" 2>/dev/null
}

# 本机库里有多少条处于某上传状态。
count_status() {  # <pending|uploaded|rejected>
  sqlite3 "$LAPTOP_DB" "SELECT count(*) FROM ops WHERE ix1_0='$1';" 2>/dev/null
}

# 本机库里有这个标题吗（从 op 载荷里读 —— 不依赖界面）。
has_title() {  # <标题>
  sqlite3 "$LAPTOP_DB" \
    "SELECT count(*) FROM ops WHERE json_extract(data,'\$.op.payload.title')='$1';" 2>/dev/null
}

# ── 第 0 步：前置 ───────────────────────────────────────────

step "0. 前置条件"
HEALTH=$(curl -s --noproxy '*' "$SERVER/health" 2>/dev/null)
if printf '%s' "$HEALTH" | grep -q '"status":"ok"'; then
  ok "服务端健康：$HEALTH"
else
  echo "   ❌ 服务端没起来或不是 TEST_MODE：$HEALTH"
  echo "      先跑 bash scripts/mobile-e2e-up.sh"
  exit 3
fi
heyta_e2e_assert_client_budget || bad "账号 client 数已逼近向量时钟上限（后续断言不可信）"

# ── 第 1 步：基线 ───────────────────────────────────────────

step "1. 基线：一台正常设备能建任务并同步"
LT_ADD=$(laptop add "$TITLE_GOOD")
if printf '%s' "$LT_ADD" | grep -q '"ok":true'; then
  ok "设备建了「${TITLE_GOOD}」"
else
  bad "建任务失败：$LT_ADD"
fi
BASE_SYNC=$(laptop sync)
if [ "$(sync_field "$BASE_SYNC" status.kind)" = "synced" ]; then
  ok "基线同步是 synced（还没有坏 op，链路本身是通的）"
else
  # 基线就不通的话，后面任何"修好了"的结论都不成立 —— 直接停。
  bad "基线同步不是 synced：$BASE_SYNC"
  summary "同步队列自愈" "基线不成立，本轮结论无效"
fi

# ── 第 2 步：注入一条**永远传不上去**的 op ──────────────────

step "2. 往真队列里注入一条 clientId 属于别的设备的 op（复现真实故障形状）"
NEXT_PK=$(sqlite3 "$DEVICE_DB" "SELECT COALESCE(MAX(CAST(pk0 AS INTEGER)),0)+1 FROM ops;")
NOW_MS=$(python3 -c "import time;print(int(time.time()*1000))")
# ⚠️ 必须带 seq（= pk0），理由见文件头。
sqlite3 "$DEVICE_DB" "INSERT INTO ops (pk0,ix0_0,ix1_0,ix2_0,ix2_1,ix4_0,data) VALUES ( \
  $NEXT_PK,'$BAD_ID','pending','TASK','task-foreign-bad','applied', \
  '{\"op\":{\"id\":\"$BAD_ID\",\"opType\":\"CRT\",\"actionType\":\"CRT_TASK\", \
  \"entityType\":\"TASK\",\"entityId\":\"task-foreign-bad\", \
  \"payload\":{\"title\":\"$BAD_ID-title\"}, \
  \"clientId\":\"$BAD_CLIENT\",\"vectorClock\":{\"$BAD_CLIENT\":1}, \
  \"timestamp\":$NOW_MS,\"schemaVersion\":1}, \
  \"source\":\"local\",\"applyStatus\":\"applied\",\"uploadStatus\":\"pending\",\"seq\":$NEXT_PK}');" 2>/dev/null

if [ "$(count_status pending)" -ge 1 ]; then
  ok "坏 op 已进入待上传队列（pending=$(count_status pending)）"
else
  echo "   ❌ 注入没成功 —— 复现手段失效，本轮结论无效"
  exit 3
fi

# ── 第 3 步：另一台设备写入（这样"下载有没有跑"才可观测）────

step "3. 另一台设备写入一条任务，并确认它上了服务端"
PEER_ADD=$(LAPTOP_DB="$PEER_DB" laptop add "$TITLE_PEER")
LAPTOP_DB="$DEVICE_DB"
if printf '%s' "$PEER_ADD" | grep -q '"ok":true'; then
  ok "对端建了「${TITLE_PEER}」"
else
  bad "对端建任务失败：$PEER_ADD"
fi
PEER_SYNC=$(LAPTOP_DB="$PEER_DB" laptop sync)
LAPTOP_DB="$DEVICE_DB"
if [ "$(sync_field "$PEER_SYNC" status.kind)" = "synced" ]; then
  ok "对端同步成功（服务端上现在有一条本机从没见过的新数据）"
else
  bad "对端同步失败：$PEER_SYNC"
fi
if [ "$(count_status "uploaded")" -ge 1 ] && [ "$(has_title "$TITLE_PEER")" -eq 0 ]; then
  ok "本机此刻**还没有**「${TITLE_PEER}」（它只能靠这次同步下载下来）"
else
  bad "前置状态不对：本机不该已经有对端那条"
fi

# ── 第 4 步：被拒的同一次同步里，下载必须照常 ────────────────

step "4. 本机同步：被拒 + **仍然下载**（这一步才是「设备没变聋」的正面证据）"
JAM_SYNC=$(laptop sync)
REASON=$(sync_field "$JAM_SYNC" status.reason)
KIND=$(sync_field "$JAM_SYNC" status.kind)
RETRYABLE=$(sync_field "$JAM_SYNC" status.retryable)

if [ "$KIND" = "error" ] && [ "$REASON" = "upload-rejected" ]; then
  ok "上报为结构化的 upload-rejected（不是 unexpected 那种含糊的「出错了」）"
else
  bad "上报原因不对：kind=$KIND reason=$REASON"
fi
if [ "$RETRYABLE" = "False" ]; then
  ok "retryable=false —— 永久拒绝不该劝用户重试"
else
  bad "retryable 应为 False（永久拒绝重试无用），实际 $RETRYABLE"
fi
if printf '%s' "$JAM_SYNC" | grep -q "$BAD_ID"; then
  ok "报错里点名了是哪一条 op（用户/开发者能查得到）"
else
  bad "报错里没有点名被拒的 op：$JAM_SYNC"
fi

# 🔴 这一条是本脚本的核心。
if [ "$(has_title "$TITLE_PEER")" -ge 1 ]; then
  ok "🔴 被拒的同一次同步里**拉到了对端的「${TITLE_PEER}」** —— 上传出错没有阻断下载"
else
  bad "没拉到对端那条 —— **这台设备变聋了**（下载被上传的失败挡住了）"
fi

# ── 第 5 步：队列收敛，且数据没被删 ─────────────────────────

step "5. 队列收敛 + 数据不丢"
if [ "$(count_status pending)" -eq 0 ]; then
  ok "pending=0 —— 坏 op 不再无限重传"
else
  bad "pending 仍为 $(count_status pending) —— 还会每次同步都被拒"
fi
if [ "$(count_status rejected)" -eq 1 ]; then
  ok "rejected=1 —— 拒绝态**可观测**（并进 uploaded 的话这一条就不存在了）"
else
  bad "rejected 应为 1，实际 $(count_status rejected)"
fi
if [ "$(sqlite3 "$DEVICE_DB" "SELECT count(*) FROM ops WHERE ix0_0='$BAD_ID';" 2>/dev/null)" -eq 1 ]; then
  ok "被拒那条 op **仍在库里**（移出队列 ≠ 删除事实）"
else
  bad "被拒那条 op 不见了 —— 事实来源被清理了"
fi

# ── 第 6 步：自愈 ───────────────────────────────────────────

step "6. 自愈：下一次同步必须是干净的 synced"
HEAL_SYNC=$(laptop sync)
HEAL_KIND=$(sync_field "$HEAL_SYNC" status.kind)
if [ "$HEAL_KIND" = "synced" ]; then
  ok "第二次同步是 synced —— 设备自愈了（修复前它会**永久**停在 error）"
else
  bad "仍然不是 synced：$HEAL_SYNC"
fi

summary "同步队列自愈" "坏 op 不再废掉设备"