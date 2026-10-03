#!/bin/bash
#
# 移动端验收：准备一个**全新账号**，并把凭据写进约定位置。
# ========================================================
#
# 🔴 为什么必须每轮换号，而不是复用同一个号的凭据文件
#
# 这个问题花了整整一轮才查清，根因不在被测代码里，而在**测试账号的历史累积**上：
#
#   `packages/sync-core/src/vector-clock.ts` 里 `MAX_VECTOR_CLOCK_SIZE = 20`。
#   每跑一轮验收都会产生**两个新的 clientId**（手机装一次包、笔记本建一次库），
#   于是同一个账号的 client 数每轮 +2。跑到第 11 轮就越过 20。
#
#   越过之后，每个向量时钟都被裁剪到 20 条，**丢掉计数最低的那一条**。
#   被裁过的时钟不再支配服务端 head —— 服务端于是把该设备写的**每一条** op
#   都判成 `CONFLICT_CONCURRENT` 并拒绝。表现是：
#
#     笔记本：`sync` → `{ok:false, kind:'conflict'}`，op 永远停在 pending
#     服务端：这个 client 的 op **一条都没有**
#     手机第 5 步：报"手机没有报冲突"（极具误导性 —— 看起来像手机的锅）
#
#   实测证据（`task-muhddy41-2-tuiah6ba`）：把笔记本那条 op 的时钟与服务端 head
#   逐键对比，**只差一个键** `muh8hc5b-1-buuvk168: 1`（服务端 seq 1），
#   而本地库里那条 op **在**（`seq=1`，本地 seq 1..43 无缺口）
#   —— 所以不是下载漏了，是**并入时钟时被裁剪掉了**。
#
#   "以前全绿、现在必红"因此不是代码退步，是账号越过了阈值。
#   一个会随运行次数漂移的验收台架本身就是缺陷：修法是每轮开新号，
#   并**显式断言账号的 client 数还没逼近上限** —— 让这类前提失败时自己说出来。
#
# 用法（由验收脚本 source，通常不用手动跑）：
#   . scripts/lib/mobile-e2e-fresh-account.sh
#   heyta_e2e_fresh_account            # 建号并写凭据文件
#
# 环境变量：
#   SERVER              默认 http://127.0.0.1:${PORT:-3000} —— 🔴 端口跟着 `PORT` 走，理由见下
#   HEYTA_E2E_KEEP_ACCOUNT=1   复用已有凭据文件，不建新号（排查用）

# 🔴 这一行的默认值以前写死 `:3000`，而六个验收脚本（auth/autosync/calendar/conflict/
#    focus/repeat）都是在 `. lib/mobile-e2e.sh`（它才从 `PORT` 推 `SERVER`）**之前**
#    source 本文件 —— 于是那一刻 `SERVER` 必然是空的，默认值就赢了：
#    `PORT=3200` 换了端口，设备侧连 3200、**建号却打到 3000**。实测症状是一句
#    "❌ 建号失败（http://127.0.0.1:3000/api/test/create-user）… 需要服务端以 TEST_MODE 运行"，
#    而真相只是"3000 上根本没有我们的服务端"。这正是 `mobile-e2e.sh:83` 那段注释
#    警告过的形状（去连 3000 上别人的进程），只是当时只修了 `SERVER` 那一半。
#    显式给 `SERVER` 时行为不变（`verify-mobile-ios.sh` 在 `mobile-e2e.sh` **之后**才 source 本文件，
#    它拿到的仍是那个已经推导过的 `SERVER`）。
HEYTA_E2E_SERVER="${SERVER:-http://127.0.0.1:${PORT:-3000}}"
HEYTA_E2E_TOKEN_FILE="${HEYTA_E2E_TOKEN_FILE:-/tmp/heyta_mobile_token.txt}"
HEYTA_E2E_EMAIL_FILE="${HEYTA_E2E_EMAIL_FILE:-/tmp/heyta_mobile_email.txt}"
HEYTA_E2E_E2EE_FILE="${HEYTA_E2E_E2EE_FILE:-/tmp/heyta_mobile_e2ee.txt}"
# 跨平台契约：与 `MAX_VECTOR_CLOCK_SIZE` 同值。这里**故意再写一遍字面量**而不去
# import —— shell 里 import 不了 TS，而这个数字一旦在两边漂移，
# 这道断言就会变成恒真，那比没有断言更糟。改动时两处一起改。
HEYTA_E2E_CLOCK_LIMIT=20

# 建号并把三份凭据落盘。成功返回 0。
heyta_e2e_fresh_account() {
  local stamp email password e2ee resp token
  stamp=$(date +%s)
  email="mobile-e2e-${stamp}@example.com"
  password="mobile-e2e-password"
  e2ee="mobile-e2e-e2ee-pass"

  resp=$(curl -s -X POST "$HEYTA_E2E_SERVER/api/test/create-user" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}" 2>/dev/null)

  token=$(printf '%s' "$resp" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    print(''); raise SystemExit
t=d.get('token') or d.get('accessToken') or (d.get('data') or {}).get('token')
print(t or '')
" 2>/dev/null)

  if [ -z "$token" ]; then
    echo "   ❌ 建号失败（$HEYTA_E2E_SERVER/api/test/create-user）"
    echo "      响应：$(printf '%s' "$resp" | head -c 300)"
    echo "      ⚠️ 需要服务端以 TEST_MODE 运行 —— 该路由只在 TEST_MODE 下挂载。"
    return 1
  fi

  printf '%s' "$token" > "$HEYTA_E2E_TOKEN_FILE"
  printf '%s' "$email" > "$HEYTA_E2E_EMAIL_FILE"
  printf '%s' "$e2ee"  > "$HEYTA_E2E_E2EE_FILE"

  echo "   ✅ 全新账号：${email}（令牌 ${#token} 字符）"
  return 0
}

# 若尚未建号则建号；`HEYTA_E2E_KEEP_ACCOUNT=1` 时直接用现有文件。
heyta_e2e_ensure_account() {
  if [ "${HEYTA_E2E_KEEP_ACCOUNT:-0}" = "1" ] && [ -s "$HEYTA_E2E_TOKEN_FILE" ]; then
    echo "   ⏭  复用现有账号：$(cat "$HEYTA_E2E_EMAIL_FILE" 2>/dev/null)"
    return 0
  fi
  heyta_e2e_fresh_account
}

# 断言该账号的 client 数还没逼近 `MAX_VECTOR_CLOCK_SIZE`。
#
# 🔴 这是**前置条件断言**，不是业务断言：一旦它红了，后面所有关于冲突、
# 收敛的断言都不可信 —— 被裁过的时钟会让服务端拒绝该设备的每一条写入。
# 有了它，这类失败会在**第 0 步**自己说出来，而不是伪装成"手机没有报冲突"。
heyta_e2e_assert_client_budget() {
  local email count
  email=$(cat "$HEYTA_E2E_EMAIL_FILE" 2>/dev/null)
  if [ -z "$email" ]; then
    echo "   ⚠️ 读不到账号邮箱，跳过 client 预算检查"
    return 0
  fi
  count=$(psql -h 127.0.0.1 -p 5432 -U rocalight -d heyta_mobile_smoke -tAc \
    "SELECT count(DISTINCT o.client_id) FROM operations o
       JOIN users u ON u.id = o.user_id WHERE u.email = '$email';" 2>/dev/null | tr -d ' ')

  # 🔴 **查不到不等于通过。** 若 `psql` 不在 PATH 上或连不上，`count` 会是空串，
  # 若把它当 0 就会**在没验证任何东西的情况下印 ✅** —— 那是一条恒真的检查。
  # 本脚本后面的第 10 步本来就要用 psql，所以这里直接判为失败更诚实。
  if ! printf '%s' "$count" | grep -Eq '^[0-9]+$'; then
    echo "   ❌ 查不到该账号的 client 数（psql 不可用或连不上？）—— 这道前置检查**没有被验证**"
    echo "      得到的是：'$count'"
    return 1
  fi

  if [ "$count" -lt "$HEYTA_E2E_CLOCK_LIMIT" ]; then
    echo "   ✅ 账号 client 数 $count < ${HEYTA_E2E_CLOCK_LIMIT}（向量时钟不会被裁剪）"
    return 0
  fi
  echo "   ❌ 账号 client 数 $count ≥ $HEYTA_E2E_CLOCK_LIMIT —— 向量时钟会被裁剪，"
  echo "      本设备的每一条写入都会被服务端判成 CONFLICT_CONCURRENT 而永远进不去。"
  echo "      这不是被测代码的缺陷，是这个账号跑太多次了。删掉凭据文件重跑以换新号。"
  return 1
}
