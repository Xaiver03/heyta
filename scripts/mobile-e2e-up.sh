#!/bin/bash
#
# 移动端零 mock E2E：把本地栈**一条命令**拉起来。
# =============================================
#
# 🔴 为什么需要这个脚本
#
# 2026-09-26 实测：`scripts/verify-mobile-conflict.sh` 有整整一轮**没被重跑过**，
# 原因是"要重跑先得起服务端 + 建号"，而**没人记得要起哪几样**。
# 当时代价是：换过 APK 之后，那条 35/35 的结论**是不是还成立**没人知道
# —— 而"测试全绿 ≠ 这是当前产物"正是本仓库最贵的一条教训。
#
# **"重跑要重新摸索"就是它长期不再被重跑的原因。** 所以把它固化下来。
#
# 用法：
#   bash scripts/mobile-e2e-up.sh          # 起栈（幂等：已在跑就复用）
#   bash scripts/mobile-e2e-down.sh        # 停栈
#
# 起来之后：
#   bash scripts/verify-mobile-conflict.sh
#
# 环境变量：
#   PORT               默认 3000
#   HEYTA_E2E_DB       默认 heyta_mobile_smoke
#   HEYTA_E2E_KEEP_ACCOUNT=1   复用现有账号，不建新号（排查用）
#   HEYTA_E2E_NO_SERVER=1      只建号，不碰服务端（服务端另开时用）
#
# ⚠️ 这个栈是**本地验收**用的，它开着 `TEST_MODE`（`/api/test/*` 会挂载）。
#    绝不要拿它对外暴露，也绝不要把 TEST_MODE 加进生产 compose 的白名单。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 🔴 `/opt/homebrew/bin` 必须在 PATH 上：`psql` 在那里。
#    少了它，`heyta_e2e_assert_client_budget` 会红 —— 那是**故意的**，
#    因为"查不到 client 数"不等于"client 数正常"。
export PATH="/opt/homebrew/bin:$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"

PORT="${PORT:-3000}"
HEYTA_E2E_DB="${HEYTA_E2E_DB:-heyta_mobile_smoke}"
HOST_SERVER="http://127.0.0.1:${PORT}"
SERVER="$HOST_SERVER"
export SERVER

PIDFILE="/tmp/heyta-e2e-server.pid"
LOGFILE="/tmp/heyta-e2e-server.log"

# 🔴 **浏览器壳（`apps/web`）与 API 不同源时，同步会被浏览器直接拦下。**
#
# `apps/web` 的同步设置里填的是服务端地址，而它自己跑在 vite 的端口上 ——
# 那是**跨域**请求。服务端默认只放行上游那个域名
# （`server/src/config.ts` 的 `DEFAULT_CORS_ORIGINS =
# ['https://app.super-productivity.com']`，是随 super-sync-server 一起继承来的）。
# 于是自建栈上 Web 端同步的表现是：
#
#   状态条变成「离线 · 改动已排队，联网后自动重试」
#   而服务端日志里**一条请求都没有**（预检就没通过）
#
# —— 看起来像网络问题，实际上请求根本没发出去。这个默认值对**同源部署**
# （服务端自己 `@fastify/static` 托管 Web 产物，见 `server.ts`）没有影响，
# 所以生产上多半遇不到；但本地验收是 vite 独立端口，必然遇到。
#
# 这里显式放行本地验收用的 Web 端口（4328，见
# `e2e/playwright.multi-end.config.ts`）。⚠️ 设了 `CORS_ORIGINS` 就会**替换**
# 默认那条，正好也把那个上游域名从这个本地栈上摘掉。
CORS_ORIGINS="${CORS_ORIGINS:-http://127.0.0.1:4328}"

fail() {
  echo "   ❌ $*" >&2
  exit 1
}

echo "════ 移动端 E2E 栈 ════"

# ── 1. 服务端 ────────────────────────────────────────────────────────────────
if [ "${HEYTA_E2E_NO_SERVER:-0}" = "1" ]; then
  echo "   ⏭  跳过服务端（HEYTA_E2E_NO_SERVER=1）"
else
  # 幂等：已经在跑就复用。**不要**盲目再起一个 —— 第二个会因端口占用退出，
  # 而脚本若把"进程起来了"当成"服务端可用"，就会在真正跑 E2E 时才炸。
  HEALTH="$(curl -s --noproxy '*' -m 4 "${HOST_SERVER}/health" 2>/dev/null)"
  if [ -n "$HEALTH" ]; then
    echo "   ⏭  服务端已在运行：$HEALTH"
  else
    # 数据库连接串：优先用 server/.env 里的 POSTGRES_*，没有则退回本地默认。
    # ⚠️ 只读键值，不打印口令。
    # 🔴 **本机 postgres 的用户是 OS 用户，不是 `server/.env` 里的 `POSTGRES_USER`。**
    #
    # 实测踩过：`.env` 里写的是 `POSTGRES_USER=supersync` —— 那是**容器化部署**
    # （docker compose 里那个 postgres 容器）的凭据。本机 homebrew postgres
    # 是另一套，owner 是 `rocalight`，`supersync` 这个角色**根本不存在**。
    #
    # 后果很隐蔽：如果这里照抄 `.env`，脚本会报"连不上库"，
    # 而人很容易去怀疑"库没建/没迁移"，实际只是**拿错了身份**。
    # 所以这里**默认用 OS 用户**，要改就显式给 `HEYTA_E2E_DB_USER`。
    PG_USER="${HEYTA_E2E_DB_USER:-$(whoami)}"
    PG_DB="${HEYTA_E2E_DB}"
    # homebrew postgres 默认对本地 trust，不需要口令；要口令时显式给
    # `HEYTA_E2E_DB_PASSWORD`（同样**不**从 .env 读，理由同上）。
    if [ -n "${HEYTA_E2E_DB_PASSWORD:-}" ]; then
      DATABASE_URL="postgresql://${PG_USER}:${HEYTA_E2E_DB_PASSWORD}@127.0.0.1:5432/${PG_DB}"
    else
      DATABASE_URL="postgresql://${PG_USER}@127.0.0.1:5432/${PG_DB}"
    fi

    [ -f "$ROOT/server/dist/src/index.js" ] || fail "server/dist/src/index.js 不存在 —— 先 \`pnpm -r build\`"
    # 先探一次库，把"库连不上"和"服务端起不来"分开报 —— 否则只会看到服务端超时。
    psql -h 127.0.0.1 -p 5432 -U "$PG_USER" -d "$PG_DB" -tAc 'select 1' >/dev/null 2>&1 \
      || fail "连不上 Postgres 库 ${PG_DB}（用户 ${PG_USER}）。库要先存在且已迁移。"

    # 必须前台跑在子 shell 里再由外层转入后台 —— 直接 `... &` 也要 `nohup` 才不会被 SIGHUP。
    # TEST_MODE 三件套缺一不可：config.ts 在 NODE_ENV=production 时会**抛错拒绝启动**。
    (
      cd "$ROOT/server" || exit 1
      NODE_ENV=development PORT="$PORT" DATABASE_URL="$DATABASE_URL" \
      TEST_MODE=true TEST_MODE_CONFIRM=yes-i-understand-the-risks \
      CORS_ORIGINS="$CORS_ORIGINS" \
      nohup node dist/src/index.js >"$LOGFILE" 2>&1 &
      echo $! >"$PIDFILE"
    )

    # 等 /health。**必须设上限并判失败** —— 无限等会把"起不来"变成"卡住"。
    READY=0
    for _ in $(seq 1 30); do
      sleep 2
      if curl -s --noproxy '*' -m 4 "${HOST_SERVER}/health" 2>/dev/null | grep -q '"status":"ok"'; then
        READY=1
        break
      fi
    done

    if [ "$READY" != "1" ]; then
      echo "   —— 服务端日志尾部 ——" >&2
      tail -20 "$LOGFILE" 2>/dev/null | sed 's/^/      /' >&2
      fail "服务端 60 秒内没有就绪（${HOST_SERVER}/health）"
    fi
    echo "   ✅ 服务端已启动（pid $(cat "$PIDFILE" 2>/dev/null)）：$(curl -s --noproxy '*' -m 4 "${HOST_SERVER}/health")"
  fi
fi

# ── 2. 全新账号 ──────────────────────────────────────────────────────────────
# 🔴 必须每轮换号：`MAX_VECTOR_CLOCK_SIZE = 20`，每跑一轮新增两个 clientId。
#    同一个号跑到第 11 轮就越过阈值 → 向量时钟被裁剪 → 服务端把该设备的
#    **每一条**写入判成 CONFLICT_CONCURRENT → 症状是"手机没有报冲突"（极具误导性）。
# shellcheck source=lib/mobile-e2e-fresh-account.sh
. "$ROOT/scripts/lib/mobile-e2e-fresh-account.sh"

heyta_e2e_ensure_account || fail "建号失败（服务端是否以 TEST_MODE 运行？）"

# 前置条件断言：它红了，后面所有冲突/收敛断言都不可信。
heyta_e2e_assert_client_budget || fail "账号 client 预算不足 —— 换号后重跑"

echo ""
echo "   ✅ 栈就绪。下一步："
echo "      bash scripts/verify-mobile-conflict.sh"
