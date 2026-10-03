#!/bin/bash
# 自托管整套验收：一条命令 = 打镜像 → 起栈 → 真浏览器走三条判据 → 拆栈。
# ============================================================================
#
# 用法：
#   pnpm verify:selfhost-stack          # 完整跑（含 docker build）
#   pnpm verify:selfhost-stack --no-build      # 复用已有镜像（改判据时用）
#   pnpm verify:selfhost-stack --keep          # 跑完不拆栈，留给人打开浏览器看
#
# ## 它判的那句话
#
# 「外人一条 `docker compose` 起全套、打开浏览器就能用」。
# 依据：`docs/research/self-host-distribution-audit.md` 台阶 1。
#
# ## 🔴 为什么"打镜像"必须在这条命令里
#
# 门禁绿 ≠ 打得出包，打得出包 ≠ 装上了当前产物（AGENTS §6.1 的两条红线）。
# 本套件的判据全部作用在**镜像里的产物**上，所以它自己负责把镜像打出来，
# 而不是"假设你已经 build 过了"——那种假设的失败形态是"验了旧界面还报绿"。
#
# ## 与别的验收的边界
#
# 只起 `postgres` 与 `supersync` 两个服务：**不起 caddy**（它的 :80 在这台机器上
# 归宿主 nginx，`deploy.sh` 曾因这个以"启动失败"收尾 —— 那不是应用故障，
# 见 docs/runbooks/deployment.md §3.12）。Caddy 那一段由
# `e2e/live-site/` 在真域名上判，两件事各有载体。
#
# ## 为什么这台栈用**一次性凭据**且刻意不复用 .env
#
# `server/.env` 是**别人机器的生产配置**（含真 JWT_SECRET 与真数据库口令）。
# 拿它起一套会验收到"生产库的 schema 状态"上去，而这条命令要判的是
# "从空库起一条 compose 能不能用" —— 那必须是**新库**。
# 同理这里的凭据是随机值且**不进任何仓库**：它们只活在这条命令的临时文件里。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROJECT=heyta-selfhost-verify
IMAGE=supersync:selfhost-verify
# ⚠️ 用**完整模板**而不是 `mktemp -t 前缀`：BSD mktemp 的 `-t` 会把模板里的 `XXXXXX`
# 原样留在名字中间，而这条脚本后面靠这个文件把凭据喂进容器 —— 名字奇怪不要紧，
# 写不进去才要紧（所以下面有"必须非空且含键"的判据）。
ENV_FILE="$(mktemp "${TMPDIR:-/tmp}/heyta-selfhost-env.XXXXXX")"
PORT="${HEYTA_SELFHOST_PORT:-1900}"
BASE="http://127.0.0.1:${PORT}/app/"
BUILD=1
KEEP=0

for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --keep) KEEP=1 ;;
    *) echo "未知参数：$arg（支持 --no-build / --keep）" >&2; exit 2 ;;
  esac
done

cleanup() {
  rm -f "$ENV_FILE"
}
trap cleanup EXIT

log() { printf '%s\n' "$*"; }
die() { printf '\n❌ %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "需要 docker（这条验收的量程就是容器）。"
docker info >/dev/null 2>&1 || die "docker 守护进程不可用 —— 先起 Docker（或 OrbStack）。"

# 🔴 compose 文件里 `container_name` 是**写死的**（supersync-server / supersync-postgres），
# 换 `-p` 也躲不开重名。所以别的栈在跑时必须响亮地失败，
# 绝不能"复用它"——那等于拿别人的库当自己的夹具（AGENTS §7 第 83 条同一族）。
for name in supersync-server supersync-postgres; do
  if [ -n "$(docker ps -q --filter "name=^${name}$" 2>/dev/null)" ]; then
    owner="$(docker inspect "$name" --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null || true)"
    [ "$owner" = "$PROJECT" ] && continue
    die "容器 $name 正在被另一个 compose 项目用着（project=$owner）。
   这条验收不能共用别人的实例（判据会量到别人的库）。
   要么先停掉那一套，要么换 HEYTA_SELFHOST_PORT 并改掉 server/docker-compose.yml 里的 container_name。"
  fi
done

if [ "$BUILD" = "1" ]; then
  log "==> 打镜像（$IMAGE，VCS_REF=$(git rev-parse --short HEAD)）"
  # 构建上下文 = 仓库根（与 docker-compose.build.yml 的 context: .. 一致）。
  DOCKER_BUILDKIT=1 docker build -f server/Dockerfile \
    --build-arg VCS_REF="$(git rev-parse HEAD)" \
    ${APK_MIRROR:+--build-arg APK_MIRROR=$APK_MIRROR} \
    ${NPM_REGISTRY:+--build-arg NPM_REGISTRY=$NPM_REGISTRY} \
    -t "$IMAGE" . >/tmp/heyta-selfhost-image.log 2>&1 || {
      tail -30 /tmp/heyta-selfhost-image.log
      die "镜像构建失败（完整日志 /tmp/heyta-selfhost-image.log）"
    }
  log "    镜像 OK"
else
  docker image inspect "$IMAGE" >/dev/null 2>&1 || die "--no-build 但本地没有 $IMAGE"
fi

# ── 一次性凭据：够长、只在这条命令的进程里存在 ─────────────────────
rand() { head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c "$1"; }
write_env_file() {
  cat >"$ENV_FILE" <<EOF
SUPERSYNC_IMAGE=$IMAGE
POSTGRES_PASSWORD=$(rand 24)
JWT_SECRET=$(rand 40)
PASSWORD_PEPPER=$(rand 40)
PUBLIC_URL=https://selfhost.verify.invalid
NODE_ENV=production
DOMAIN=selfhost.verify.invalid
# 这条验收判的就是"没配 SMTP 的那台实例"，所以显式关掉邮箱验证 ——
# 同时它也是 `server/docker-compose.yml` 里那条转发行**有没有生效**的载体。
RUN_MIGRATIONS_ON_STARTUP=true
REQUIRE_EMAIL_VERIFICATION=false
EOF
}
write_env_file

# 🔴 写完必须验它真的写进去了。判据不是仪式：这一份文件是**唯一**把凭据送进容器的方式，
# 它为空 ⇒ `POSTGRES_PASSWORD` 是空的 ⇒ 容器 `P1000` 认证失败并无限重启，
# 而"等 /health"那一段只会把这件事读成"环境没起来"，读不出"我的夹具根本没喂进去"。
# ⚠️ 本机实测（2026-10-03）：在这个 CLI 的沙箱里跑 heredoc 重定向时，stderr 会印一行
# `...: Permission denied` 并**跟着一个与本仓库无关的路径**（当天印的是 `server/docker-compose.yml`），
# 而写入其实成功了 —— 别被那行带走，判据只看文件内容。
[ -s "$ENV_FILE" ] || die "一次性凭据文件没写出来（$ENV_FILE 为空或不存在）—— 后面的栈一定起不来。"
case "$ENV_FILE" in
  "$REPO_ROOT"/*) die "凭据文件的目标路径在仓库里（$ENV_FILE）—— 拒绝写入工作树。" ;;
esac
grep -q '^POSTGRES_PASSWORD=.\+' "$ENV_FILE" || die "凭据文件里没有非空的 POSTGRES_PASSWORD（$ENV_FILE）。"
grep -q '^JWT_SECRET=.\+' "$ENV_FILE" || die "凭据文件里没有非空的 JWT_SECRET（$ENV_FILE）。"

log "==> 起栈（project=$PROJECT，端口 127.0.0.1:$PORT）"
cd server
# 🔴 先把这一套的**卷**清掉。实测形态：上一轮的 postgres 数据卷还在，
# 而 `POSTGRES_PASSWORD` 是每次随机生成的 —— 官方镜像看到非空数据目录就**跳过初始化**，
# 于是库里的口令是上一轮那个，新口令永远对不上，容器 P1000 之后无限重启。
# 这条命令判的是"从空库起一条 compose 能不能用"，复用别人的旧库连题都不是。
docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.yml \
  down -v --remove-orphans >/dev/null 2>&1 || true
docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.yml \
  up -d postgres supersync >/tmp/heyta-selfhost-up.log 2>&1 || {
    tail -20 /tmp/heyta-selfhost-up.log
    [ "$KEEP" = "1" ] || docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.yml down -v >/dev/null 2>&1
    die "compose 起栈失败（/tmp/heyta-selfhost-up.log）"
  }
cd "$REPO_ROOT"

down_stack() {
  [ "$KEEP" = "1" ] && return 0
  log "==> 拆栈"
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.yml down -v --remove-orphans >/dev/null 2>&1 || true
}

# ── 等健康：迁移要跑完（含 CONCURRENTLY 的带外恢复），最长 240s ────
log "==> 等 /health"
healthy=0
for _ in $(seq 1 80); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 3
done
if [ "$healthy" != "1" ]; then
  docker logs --tail 40 supersync-server 2>&1 || true
  down_stack
  die "服务端在 240s 内没有起来（上面是它的日志）"
fi

# 🔴 前置判据：**这台实例真的有界面**。
# 少了这一条，"打开 /app/ 是 404" 会被算成"界面用例失败"，
# 而真实原因是产物没进容器 —— 两者的修法完全不同（AGENTS §7 元规则 1：先怀疑探针）。
# 🔴 先把日志取进变量，再用 shell 自己的模式匹配 —— **不要**写成
# `docker logs ... | grep -q ...`：本脚本开了 `pipefail`，而 `grep -q` 一命中就关管道，
# `docker logs` 收到 SIGPIPE 退出 141，于是**命中了也算失败**。
# 实测复现（本机 bash 3.2，阳性对照）：`yes hello | head -200000 | grep -q hello` ⇒ rc **141**。
# 那天这条前置就是因此报"这台实例没有界面"，而同一份日志的尾巴里明明印着那一行。
SERVER_LOGS="$(docker logs supersync-server 2>&1 || true)"
case "$SERVER_LOGS" in
  *'[web-app] 共享 UI 挂在'*) ;;
  *)
    printf '%s\n' "$SERVER_LOGS" | tail -40 >&2
    die "服务端日志里没有「共享 UI 挂在 /app/」—— 这台实例没有界面，用例没有可判的对象"
    ;;
esac
log "    界面挂载确认：$(printf '%s\n' "$SERVER_LOGS" | grep '\[web-app\]' | tail -1)"

log "==> 真浏览器三条判据（$BASE）"
cd e2e
[ -d node_modules/@playwright/test ] || die "e2e 的依赖没装：先 cd e2e && pnpm install（它自己一份 lockfile）"
set +e
HEYTA_SELFHOST_BASE="$BASE" npx playwright test --config playwright.selfhost.config.ts
RC=$?
set -e
cd "$REPO_ROOT"

log ""
log "截图落在 e2e/selfhost-stack-results/ —— 按 §6.2 规定一，**人必须打开看**："
ls -1 e2e/selfhost-stack-results/*.png 2>/dev/null | sed 's/^/  /' || log "  （没有截图 = 有用例在截图前就失败了）"

if [ "$KEEP" = "1" ]; then
  log ""
  log "⚠️ 栈留着没拆（--keep）：$BASE 现在可以直接用浏览器打开。"
  log "   拆掉：cd server && docker compose -p $PROJECT --env-file $ENV_FILE -f docker-compose.yml down -v"
else
  down_stack
fi

[ "$RC" = "0" ] && log "✅ 自托管整套：三条判据全过" || log "❌ 自托管整套：Playwright 退出码 $RC"
exit "$RC"
