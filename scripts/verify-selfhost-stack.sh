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
#
# ## 🔴 迁移这一环判的是 D-3，而且是**两条腿**
#
# 本脚本**始终带上** `docker-compose.migrate-once.yml`（对外文档第一屏写的那条
# "compose 自己就够"的入口），并且夹具里**不设** `RUN_MIGRATIONS_ON_STARTUP`
# —— 于是容器里读到的是 `docker-compose.yml:50` 那个默认 `false`。
# 两条合起来才证明"空库起来的那套能用的界面，迁移是被**那个一次性服务**做掉的"：
#
#   · 腿一：一次性容器**退出码 0**，且库里「已成功应用」的**不同迁移名数**等于磁盘上的
#     迁移目录数（阈值从被约束的常量推导，不是"大于 0"—— 后者在只建了基线表时也能绿）；
#   · 腿二：应用容器自己的 `RUN_MIGRATIONS_ON_STARTUP` 当场读出来是 `false`；
#   · 腿三：没有一条迁移处在「既没 finished_at 也没 rolled_back_at」的悬挂态。
#     ⚠️ 刻意**不**断言"`finished_at IS NULL` 的行数为 0"：`migrate-deploy.sh` 对
#     CONCURRENTLY 走"回滚标记 + 带外恢复"，恢复成功后同一个名字**留两行**（一条痕迹、
#     一条结果）。本机现量：42 个目录 / 42 个已应用名 / 5 条回滚痕迹 / 悬挂 0 / 重复完成 0。
#     按行数判会把一次**正确**的部署判成失败。
#
# 只留腿一就是假绿：那种写法下迁移可能来自应用自己启动那一段（旧脚本正是这样，
# 它偷偷设 `RUN_MIGRATIONS_ON_STARTUP=true`），于是这条命令验的**从来不是** D-3，
# 而是"启动即迁移能不能用"—— 而那是默认档刻意不承诺的语义。

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

# 🔴 两份 compose 文件写成**一个数组**，因为"带不带 override"就是这条验收的判据本体。
# 各段自己拼 `-f a -f b` 的写法，漂起来的方向是某个调用忘了带 override ——
# 那次跑的就不是对外文档里那条入口，而输出照样全绿。
COMPOSE_FILES=(-f "$REPO_ROOT/server/docker-compose.yml" -f "$REPO_ROOT/server/docker-compose.migrate-once.yml")
compose() {
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" "$@"
}

for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --keep) KEEP=1 ;;
    *) echo "未知参数：${arg}（支持 --no-build / --keep）" >&2; exit 2 ;;
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
    die "容器 $name 正在被另一个 compose 项目用着（project=${owner}）。
   这条验收不能共用别人的实例（判据会量到别人的库）。
   要么先停掉那一套，要么换 HEYTA_SELFHOST_PORT 并改掉 server/docker-compose.yml 里的 container_name。"
  fi
done

if [ "$BUILD" = "1" ]; then
  log "==> 打镜像（${IMAGE}，VCS_REF=$(git rev-parse --short HEAD)）"
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
# 🔴 heredoc 用的是**不带引号的 EOF**（要靠 $IMAGE 和 $(rand) 展开），所以正文里
# **一个反引号都不能有**：那会被当命令替换执行。实测形态 ——
# 上一版在正文注释里写了 `server/docker-compose.yml` 和 `docker-compose.yml:50`，
# 于是每次跑都印出 `Permission denied` 与 `command not found` 两行假错误，
# 而**写入是成功的** ⇒ 我当天把第一行误判成"沙箱夹层的产物"，还把它写进了下面的注释。
# 那条误判已就地撤回。判据只看文件内容（真的那两条在下面）。
write_env_file() {
  cat >"$ENV_FILE" <<EOF
SUPERSYNC_IMAGE=$IMAGE
POSTGRES_PASSWORD=$(rand 24)
JWT_SECRET=$(rand 40)
PASSWORD_PEPPER=$(rand 40)
PUBLIC_URL=https://selfhost.verify.invalid
NODE_ENV=production
DOMAIN=selfhost.verify.invalid
# REQUIRE_EMAIL_VERIFICATION=false：这条验收判的就是"没配 SMTP 的那台实例"，
# 所以显式关掉邮箱验证；它同时也是 compose 里那条 SMTP 转发行有没有生效的载体。
# 这里刻意**不设** RUN_MIGRATIONS_ON_STARTUP，让它落回默认 false —— 于是"界面可用"
# 只可能由一次性迁移服务造成（两条腿见文件头）。
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
  "$REPO_ROOT"/*) die "凭据文件的目标路径在仓库里（${ENV_FILE}）—— 拒绝写入工作树。" ;;
esac
grep -q '^POSTGRES_PASSWORD=.\+' "$ENV_FILE" || die "凭据文件里没有非空的 POSTGRES_PASSWORD（${ENV_FILE}）。"
grep -q '^JWT_SECRET=.\+' "$ENV_FILE" || die "凭据文件里没有非空的 JWT_SECRET（${ENV_FILE}）。"

log "==> 起栈（project=${PROJECT}，端口 127.0.0.1:${PORT}）"

# ── 服务图对账：override 加了一个服务，默认那张图**一个都没多** ──────────
# 这两条是本步骤的红线（"不得改默认服务图"）。放在 `up` **之前**：
# 图要是已经被改坏，栈照样起得来、界面照样能用 —— 那时候所有行为判据都会绿，
# 而"默认档不许有迁移服务"这句话已经没人守了。
services_of() {
  # `config --services` 走的是 compose 自己的解析器（不是正则猜），
  # 排序后逐字比对 ⇒ 少一个、多一个、名字漂了都能抓到。
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" "$@" config --services 2>/dev/null | LC_ALL=C sort | tr '\n' ' '
}
DEFAULT_SERVICES="$(services_of -f "$REPO_ROOT/server/docker-compose.yml")"
[ "$DEFAULT_SERVICES" = "caddy postgres supersync " ] || {
  printf '默认服务图实测：%s\n' "$DEFAULT_SERVICES" >&2
  die "默认服务图应当**恰好**是 caddy / postgres / supersync 三个。多出来的那一个就是「启动时谁迁移」的第二个所有者 —— 它会和 deploy.sh 的 migrator 互踩（RUN_MIGRATIONS_ON_STARTUP=false 防的正是这件事）。"
}
OVERRIDE_SERVICES="$(services_of "${COMPOSE_FILES[@]}")"
[ "$OVERRIDE_SERVICES" = "caddy postgres supersync supersync-migrate " ] || {
  printf '带 override 的服务图实测：%s\n' "$OVERRIDE_SERVICES" >&2
  die "override 应当只加 supersync-migrate 这一个服务。"
}
log "    服务图对账：默认 3 个（未动） · 带 override 4 个（+supersync-migrate）"

# ── 对外文档那条入口命令的对账 ─────────────────────────────────────
# 为什么要这一条：文档 §4 印的就是"一条 compose 起全套"，而这条脚本量的是
# 自己那套（先 `docker build` 出私有 tag、再用 SUPERSYNC_IMAGE 指过去）。
# 两者**本来就该不一样** —— 脚本手里有镜像，陌生人手里没有。
# 但"不一样"的方向漂起来是无声的：2026-10-03 实测，文档少带了
# `docker-compose.build.yml`，于是陌生人照抄得到的是
# `pull access denied for supersync … may require 'docker login'`
# （我们根本没有仓库，那句提示把人引向"去找登录凭据"）。
# 所以这里把文档那一行的 -f 集合钉成期望值，漂了就红。
GUIDE="$REPO_ROOT/docs/runbooks/self-host.md"
README="$REPO_ROOT/server/README.md"
# 🔴 同一条命令现在有**两份抄件**（中文指南 + server/README）。抄件的漂法是固定的：
# 改一处、忘另一处，而两边看起来都自洽。所以这里逐份量，任何一份漂了就红。
DOC_LINES=""
for doc in "$GUIDE" "$README"; do
  # 续行（行尾反斜杠）先折回来，否则第二条 -f 会掉到下一行去。
  # ⚠️ 这里**必须用 awk**，不能用 `tr '\n' X | sed 's/\\X//'`：BSD sed 的 BRE 不解释
  # `\036` 这类八进制转义，它会把那三个字符当字面量去找 ⇒ **折叠静默失败**，
  # 于是判据只读到第一条物理行、报"文档少了 migrate-once override"（2026-10-03 实测，
  # 探针自己坏了、文档是好的）。
  line="$(awk '{ if ($0 ~ /\\$/) { sub(/\\$/,""); printf "%s ", $0 } else { print } }' "$doc" \
    | grep -m1 '^docker compose -f docker-compose\.yml' || true)"
  [ -n "$line" ] || die "${doc#$REPO_ROOT/} 里找不到以 'docker compose -f docker-compose.yml' 开头的那条入口命令 —— 它被改名、换行或删掉了，而这条判据将变成空转。"
  # 🔴 折行之后要先压空格：续行是缩进的（两个前导空格），压完才 `-f x.yml` 的形状统一。
  # 不压的实测后果不是漏判整条，而是**只漏掉续行上那一个 -f**（看起来像"文档少了 override"，
  # 其实是探针自己没把行读全）。
  line="$(printf '%s\n' "$line" | tr -s ' ')"
  DOC_LINES="${DOC_LINES}${line}
"
done
DOC_ENTRY_FILES="$(printf '%s' "$DOC_LINES" | grep -o -- '-f [A-Za-z0-9._-]*\.yml' | sed 's/^-f //' | LC_ALL=C sort -u | tr '\n' ' ')"
EXPECTED_DOC_FILES="docker-compose.build.yml docker-compose.migrate-once.yml docker-compose.yml "
[ "$DOC_ENTRY_FILES" = "$EXPECTED_DOC_FILES" ] || {
  printf '两份文档里那条命令实际带的文件：%s\n' "$DOC_ENTRY_FILES" >&2
  printf '应当带的：%s\n' "$EXPECTED_DOC_FILES" >&2
  die "入口命令少了 build override ⇒ 照抄的人没有镜像可拉（默认 image 是 supersync:local，而我们不发布镜像）。"
}
# 两份必须**逐字相同**（只比集合会把"一份带 --build、一份不带"读成绿）。
[ "$(printf '%s' "$DOC_LINES" | LC_ALL=C sort -u | wc -l | tr -d ' ')" = "1" ] ||
  die "中文指南与 server/README 里那条入口命令已经漂开（各自的内容见上一段）。"
case "$DOC_LINES" in
  *--build*) ;;
  *) die "入口命令没有 --build：镜像不会由这条命令自己产出，第一次跑仍然起不来。" ;;
esac
# 脚本自己那两套也要钉住（它和文档不同是**有理由的**，理由变了就要改这里，不能漂）。
SCRIPT_ENTRY_FILES="$(printf '%s\n' "${COMPOSE_FILES[@]}" | sed 's#.*/##' | LC_ALL=C sort | tr '\n' ' ')"
[ "$SCRIPT_ENTRY_FILES" = "docker-compose.migrate-once.yml docker-compose.yml " ] ||
  die "本脚本带的 compose 文件集合变了（现在是 ${SCRIPT_ENTRY_FILES}）。它和文档 §4 的差集应当恰好是 docker-compose.build.yml —— 因为脚本自己 docker build。"
log "    入口命令对账：文档 3 份（含 build override + --build） · 本脚本 2 份（自己打镜像）"

cd server
# 🔴 先把这一套的**卷**清掉。实测形态：上一轮的 postgres 数据卷还在，
# 而 `POSTGRES_PASSWORD` 是每次随机生成的 —— 官方镜像看到非空数据目录就**跳过初始化**，
# 于是库里的口令是上一轮那个，新口令永远对不上，容器 P1000 之后无限重启。
# 这条命令判的是"从空库起一条 compose 能不能用"，复用别人的旧库连题都不是。
compose down -v --remove-orphans >/dev/null 2>&1 || true
compose up -d postgres supersync >/tmp/heyta-selfhost-up.log 2>&1 || {
  tail -20 /tmp/heyta-selfhost-up.log
  [ "$KEEP" = "1" ] || compose down -v >/dev/null 2>&1
  die "compose 起栈失败（/tmp/heyta-selfhost-up.log）"
}
cd "$REPO_ROOT"

down_stack() {
  [ "$KEEP" = "1" ] && return 0
  log "==> 拆栈"
  compose down -v --remove-orphans >/dev/null 2>&1 || true
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

# ── D-3：迁移是**那个一次性服务**做的，不是应用自己启动时做的 ────────────
# 三条各管一段，缺任何一条这个结论都不成立：
#   1 一次性容器退出码 0（它真跑完了，不是还在跑、也不是失败后被 restart 策略留着）；
#   2 应用容器自己读到的 RUN_MIGRATIONS_ON_STARTUP 当场是 false（排除"迁移来自应用"）；
#   3 库里已 applied 的迁移数 **等于** 磁盘上的迁移目录数（阈值从被约束的常量推导，
#     不是"大于 0" —— 后者在只建了基线表、一条迁移都没跑的时候也能绿）。
# ⚠️ 这里用 `supersync`/`supersync` 是因为**上面那份夹具没设** POSTGRES_USER/POSTGRES_DB，
# 于是走 `docker-compose.yml` 的默认值；换夹具要同步换这里的两个名字。
MIG_PS="$(compose ps -a --format '{{.Service}}|{{.State}}|{{.ExitCode}}' supersync-migrate 2>/dev/null | head -1)"
case "$MIG_PS" in
  'supersync-migrate|exited|0') ;;
  *) die "一次性迁移容器不是「exited 且退出码 0」，实测读到的是「${MIG_PS:-查不到这个服务}」。
     没跑完 ⇒ 这台实例跑在未迁移的表结构上；还在跑 ⇒ 顺序没被 service_completed_successfully 挡住。" ;;
esac
APP_STARTUP_MIGRATE="$(docker exec supersync-server printenv RUN_MIGRATIONS_ON_STARTUP 2>/dev/null || echo '<读不到>')"
if [ "$APP_STARTUP_MIGRATE" != "false" ]; then
  printf '   应用容器里的 RUN_MIGRATIONS_ON_STARTUP 实测 = %s\n' "$APP_STARTUP_MIGRATE" >&2
  die "这条验收只在「迁移由一次性服务完成」时才有意义。应用自己启动即迁移 ⇒ 判到的是另一条语义（那正是默认档刻意不承诺的），而界面照样能用、上面两条照样全绿。"
fi
MIGRATION_DIRS=$(find server/prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
psql_t() { compose exec -T postgres psql -U supersync -d supersync -tA -c "$1" 2>/dev/null | tr -d '[:space:]'; }
APPLIED="$(psql_t 'SELECT count(DISTINCT migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL')"
INFLIGHT="$(psql_t 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL')"
DUPDONE="$(psql_t 'SELECT count(*) FROM (SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL GROUP BY migration_name HAVING count(*) > 1) t')"
TRACE="$(psql_t 'SELECT count(*) FROM _prisma_migrations WHERE rolled_back_at IS NOT NULL')"
# 🔴 四个读数都必须是数字。`2>/dev/null` 会把"连不上库/表不存在"变成空串，
# 而空串走 `${X:-1}` 会被读成「有 1 条悬挂」—— 那是把**探针坏了**报成**产品缺陷**。
for pair in "已应用名数=$APPLIED" "悬挂数=$INFLIGHT" "重复完成数=$DUPDONE" "回滚痕迹数=$TRACE"; do
  case "${pair#*=}" in
    ''|*[!0-9]*)
      printf '   读数：%s\n' "$pair" >&2
      die "迁移台账读不出数字（上面那对键值就是原样读数）。探针够不着的时候报「有 N 条悬挂」是假红 —— 先修读法。"
      ;;
  esac
done
[ "${APPLIED}" = "${MIGRATION_DIRS}" ] || {
  printf '   迁移目录 %s 个 · 库里"已成功应用"的不同迁移名 %s 个\n' "$MIGRATION_DIRS" "${APPLIED:-读不到}" >&2
  die "已成功应用的迁移**名字数**必须等于磁盘上的迁移目录数。少了就是「起来却跑在未迁移表结构上」这个缺陷本身 —— 那条缺陷以前只能靠 README 里一句话，现在有数了。"
}
# ⚠️ 这里**不**断言 `finished_at IS NULL` 的行数为 0 —— 实测那种写法会把一次**正确**的
# 部署判成失败。`scripts/migrate-deploy.sh` 对 CONCURRENTLY 迁移走"先原生试、失败就回滚
# 标记再带外恢复"，恢复成功后同一个迁移名留下**两行**：一行 rolled_back_at 有值（痕迹）、
# 一行 finished_at 有值（结果）。本机现量：42 个目录 / 42 个已应用名字 / 5 条回滚痕迹
# （20260512、20260514、20260514000002、20260828000001、20260829000000 —— 全是 CONCURRENTLY 那几条）。
# 真正"没跑完"的形状是 **既没有 finished_at 也没有 rolled_back_at**（PENDING / IN_PROGRESS），
# 那才是要拦的一条，而且它有牙：漏跑一条迁移 ⇒ 下面 INFLIGHT 或 APPLIED 必然不匹配。
[ "${INFLIGHT:-1}" = "0" ] || die "有 ${INFLIGHT} 条迁移处在「既没完成也没回滚」的状态（PENDING/IN_PROGRESS）= 迁移被打断在中间，这台实例的 schema 不是干净状态。"
[ "${DUPDONE:-1}" = "0" ] || die "有 ${DUPDONE} 个迁移名出现了**两条**已完成的行 —— 台账写脏了，APPLIED 那个数就不再是证据（两条同一名字 + 一条漏跑，计数照样相等）。"
log "    D-3 对账：一次性容器 exited(0) · 应用侧 RUN_MIGRATIONS_ON_STARTUP=false · 已应用 ${APPLIED}/${MIGRATION_DIRS} · 悬挂 0 · 重复完成 0 · 带外恢复痕迹 ${TRACE} 条（设计内）"


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

log "==> 真浏览器三条判据（${BASE}）"
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
  log "   拆掉：docker compose -p $PROJECT --env-file $ENV_FILE ${COMPOSE_FILES[*]} down -v"
else
  down_stack
fi

[ "$RC" = "0" ] && log "✅ 自托管整套：三条判据全过" || log "❌ 自托管整套：Playwright 退出码 $RC"
exit "$RC"
