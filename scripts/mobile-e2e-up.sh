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

# 🔴 这两枚**原来写死**，而写死的名字是跨树共享的：主检出与任何 worktree 载体跑的是同一个
#    `/tmp/heyta-e2e-server.{pid,log}`。17:5x 现量的后果：载体那一趟起栈失败之后，
#    pidfile 里是一枚**死 pid**（95105 alive=no），而此刻 :3000 上真正的监听者（70256）
#    **没有被任何地方记下** ⇒ 主人跑 `mobile-e2e-down.sh` 会"成功退出而什么都没停"；
#    同一枚 logfile 被后起的那一棵覆盖 ⇒ 前一棵的服务端日志（判据读数）没了。
#    默认值**逐字不变**（现有调用方零改动），要隔离就显式传这两个变量 ——
#    载体链那么做，并把路径打进自己的日志，留下"这棵起过栈、怎么停"的线索。
PIDFILE="${HEYTA_E2E_PIDFILE:-/tmp/heyta-e2e-server.pid}"
LOGFILE="${HEYTA_E2E_LOGFILE:-/tmp/heyta-e2e-server.log}"

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

# 复用「已在运行的服务端」之前，先认证它是谁、跑的是哪一版代码。
#
# 🔴 为什么必须有这一条：`/health` 只回答「这个端口上有一个服务端」，回答不了
# 「它是不是本 ROOT 起的」「它是不是当前源码编的」。2026-10-04 实测到的形状是：
# 一棵检出的脚本复用到了另一棵检出 02:59 起的 dist，而那棵树有 3 个源文件比它自己的
# dist 新 —— 于是整轮设备验收的**服务端半侧**验的是旧代码，而所有判据都绿。
# 这就是「测试全绿 ≠ 这是当前产物」在服务端这一侧的面目。
#
# 默认**拒绝**认证不了的占用者。确要跨 ROOT 复用（故意连一台已经起好的栈）：
#   HEYTA_E2E_ALLOW_FOREIGN_SERVER=1
# 放行时脚本会大字打印「本轮服务端侧判据只能证明那台机器现在的行为」——
# 这个口子是给人看的，不是用来让红变成绿的。
#
# 成功时把认证结论打到 stdout（调用方捕获后原样打印），失败时把**原因**打到 stdout
# 并退 1。原因必须写清楚，否则下一次还是只会看到「认证不通过」四个字再去怀疑探针。
certify_server_occupant() {
  local pids n pid cwd srv_root stale srv_sha root_sha bad=""
  pids="$(lsof -nP -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null)"
  n="$(printf '%s\n' "$pids" | grep -c .)"
  if [ "$n" != "1" ]; then
    echo "读不到 :${PORT} 上唯一的监听 pid（实测 ${n} 枚：$(printf '%s' "$pids" | tr '\n' ' ')）—— 不能把「/health 有响应」当成「那是我们的服务端」"
    return 1
  fi
  pid="$pids"
  # `-a` 不能省：不带它时 `-p` 与 `-d` 是**并集**，读到的 cwd 可能是别人进程的。
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
  case "$cwd" in
    */server) srv_root="${cwd%/server}" ;;
    *) echo "pid ${pid} 的 cwd 不是一棵检出的 server/（实测：${cwd:-读不到}）—— 无从核对它跑的是哪份代码"; return 1 ;;
  esac
  if [ ! -f "$srv_root/server/dist/src/index.js" ]; then
    echo "pid ${pid} 的 ROOT（${srv_root}）里没有 server/dist/src/index.js —— 起它的那份产物已经不在了"; return 1
  fi
  stale="$(find "$srv_root/server/src" -name '*.ts' -newer "$srv_root/server/dist/src/index.js" 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$stale" != "0" ]; then
    bad="它的 dist 比自己的源码旧（${stale} 个 .ts 更新）"
  fi
  # 🔴 只比产物是不够的：进程可以在 dist 重建**之前**就起来了，于是"dist 不比源码旧"照样成立，
  # 而那个进程跑的仍然是重建前的代码（实测 :3000 那枚 —— 进程 01:26 起、dist 02:59 编）。
  # 所以还要证第三件事：**进程比它自己的 dist 新**，即它是那份产物起来的。
  local et dist_s start_s d h m rest s
  et="$(ps -o etime= -p "$pid" 2>/dev/null | tr -d ' ')"
  dist_s="$(stat -f '%m' "$srv_root/server/dist/src/index.js" 2>/dev/null)"
  case "$et" in
    *-*) d="${et%%-*}"; et="${et#*-}" ;;
    *) d="" ;;
  esac
  case "$et" in
    *:*:*) h="${et%%:*}"; rest="${et#*:}"; m="${rest%%:*}"; rest="${rest#*:}" ;;
    *::*)  h="0";  rest="${et#*::}"; m="${rest%%:*}"; rest="${rest#*:}" ;;
    *)     h="0";  m="${et%%:*}";     rest="${et#*:}" ;;
  esac
  # 秒位可能带百分号（macOS 在 <1s 时打 `0:05.31`），取整数部分。
  s="${rest%%[!0-9]*}"
  if [ -z "$et" ] || [ -z "$dist_s" ]; then
    bad="${bad:+${bad}；}读不到进程运行时长或 dist 的 mtime —— 无法证明那个进程是这份产物起来的"
  else
    # `10#` 是刻意的：`08`/`09` 直接进算术会被当八进制报错，而 `${h#0}` 在 h=0 时把值掏空。
    start_s=$(( $(date +%s) - 10#${d:-0} * 86400 - 10#${h:-0} * 3600 - 10#${m:-0} * 60 - 10#${s:-0} ))
    if [ "$start_s" -lt "$dist_s" ]; then
      bad="${bad:+${bad}；}那个进程比它自己的 dist 旧（进程比那次构建早 $(( (dist_s - start_s) / 60 )) 分钟）"
    fi
  fi
  srv_sha="$(git -C "$srv_root" rev-parse HEAD 2>/dev/null)"
  root_sha="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)"
  if [ -n "$root_sha" ] && [ "$srv_sha" != "$root_sha" ]; then
    bad="${bad:+${bad}；}它的 ROOT HEAD ${srv_sha:-读不到} ≠ 本 ROOT HEAD ${root_sha}"
  fi
  if [ -n "$bad" ]; then
    echo "pid ${pid}（ROOT ${srv_root}）：${bad}"
    return 1
  fi
  echo "pid ${pid}，ROOT ${srv_root}，HEAD ${srv_sha}，dist 不比自己的源码旧"
  return 0
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
    CERT="$(certify_server_occupant)"
    CERT_RC=$?
    if [ "$CERT_RC" = "0" ]; then
      echo "   ⏭  服务端已在运行，且认证通过（${CERT}）：$HEALTH"
    elif [ "${HEYTA_E2E_ALLOW_FOREIGN_SERVER:-0}" = "1" ]; then
      echo "   ⚠️  服务端已在运行但**认证不通过**（${CERT}）"
      echo "       HEYTA_E2E_ALLOW_FOREIGN_SERVER=1 ⇒ 放行。本轮服务端侧的全部判据只能证明"
      echo "       「那台机器现在的行为」，不能证明「本 ROOT 源码的行为」—— 结论要这么写。"
    else
      fail "端口 ${PORT} 上的占用者认证不通过：${CERT}
   别为了让脚本跑下去就放行 —— 那正是「判据全绿而验的是旧代码」的形状。
   出路按顺序：① 把本 ROOT 的栈起在一枚空端口（PORT=<空端口> bash scripts/mobile-e2e-up.sh，
   调用方跟着同一个 PORT）；② 让那台服务端的主人先重建再重启它
   （pnpm --filter @heyta/server build —— 只重建 dist 不够，跑着的进程不会换代码）；
   ③ 确要跨 ROOT 复用就显式 HEYTA_E2E_ALLOW_FOREIGN_SERVER=1，
   并在汇报里写明服务端侧判据证明的是那台机器现在的行为。"
    fi
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

    # 🔴 两处启动自检缺了就**拒绝起来**：`JWT_SECRET`（`server/src/auth.ts`）与
    #    `PASSWORD_PEPPER`（`server/src/password/hash.ts`，`MIN_PEPPER_LENGTH = 32`），
    #    而它们只写在 `server/.env` 里 —— 那个文件被 gitignore，**干净检出（隔离 worktree /
    #    新克隆）上没有**（`git worktree add` 不会带过来）。缺了它们，上面那句
    #    "服务端 60 秒内没有就绪"看起来像产品坏了，实际是**验收载体依赖了一份不进仓库的配置**。
    #    04:1x 实测：本脚本在 `heyta-wt-trash-e2e` 载体上就是这么红的，日志尾部是
    #    `Error: JWT_SECRET environment variable is required`，而那次超时是它的下游读数。
    #    同一件事在 `scripts/lib/auth-journey-server.mjs:233-236` 的 `secretFallback` 早有解，
    #    这里照它的语义来，不另建第二套规则：**env 与 `server/.env` 两边都没有**才现生成一枚
    #    一次性值；任一边有就**一个字节都不覆盖**（主检出两边都声明 ⇒ 走原路，行为逐字不变）。
    #    为什么是现生成而不是把主检出的 `.env` 拷过来：那里面是真凭据，而这个栈不需要复用它们
    #    （库是本轮的、令牌与口令散列随进程一起死，它们不承担生产密钥的任何义务）。
    #    ⚠️ 不能写成 `JWT_SECRET="${JWT_SECRET:-}"` 再传进子 shell：dotenv 见"已定义"就不覆盖，
    #    空串会让带 `.env` 的那棵检出**也**崩在这两句自检上 —— 于是这次修会把主检出的起栈弄坏。
    #    所以只在真的缺失时才 export。
    declared_in_server_dotenv() { # $1=变量名
      [ -f "$ROOT/server/.env" ] && grep -qE "^[[:space:]]*${1}=" "$ROOT/server/.env"
    }
    new_one_time_secret() {
      node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'
    }
    # 必须前台跑在子 shell 里再由外层转入后台 —— 直接 `... &` 也要 `nohup` 才不会被 SIGHUP。
    # TEST_MODE 三件套缺一不可：config.ts 在 NODE_ENV=production 时会**抛错拒绝启动**。
    (
      cd "$ROOT/server" || exit 1
      FALLBACKS=""
      if [ -z "${JWT_SECRET:-}" ] && ! declared_in_server_dotenv JWT_SECRET; then
        JWT_SECRET="$(new_one_time_secret)"; export JWT_SECRET; FALLBACKS="JWT_SECRET"
      fi
      if [ -z "${PASSWORD_PEPPER:-}" ] && ! declared_in_server_dotenv PASSWORD_PEPPER; then
        PASSWORD_PEPPER="$(new_one_time_secret)"; export PASSWORD_PEPPER
        FALLBACKS="${FALLBACKS:+${FALLBACKS} }PASSWORD_PEPPER"
      fi
      if [ -n "$FALLBACKS" ]; then
        echo "   一次性密钥回退：${FALLBACKS}（本检出没有 server/.env ⇒ 现生成，随进程死，不落盘）"
      fi
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
