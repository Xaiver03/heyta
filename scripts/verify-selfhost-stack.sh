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
# 自托管整套验收：一条命令 = 打镜像 → 起栈 → 真浏览器走三条判据 → 拆栈。
# ============================================================================
#
# 用法：
#   pnpm verify:selfhost-stack          # 完整跑（含 docker build）
#   pnpm verify:selfhost-stack --no-build      # 复用已有镜像（改判据时用）
#   pnpm verify:selfhost-stack --keep          # 跑完不拆栈，留给人打开浏览器看
#                                              # 🔴 此时**也保留**那份一次性凭据文件
#                                              # （下面打印的拆栈命令要用它的 --env-file）
#
# ## 判据分了两处，是有意为之
#
# 「文档里那条入口命令对不对」这件事**不在这份脚本里判** —— 它在
# `scripts/check-selfhost-entry-command.mjs`（纯文件系统，`pnpm check` 一定会跑到，
# 没有 docker 的机器也在判）。本脚本只是**调用**它。原先那段抄在这里，而这份脚本
# 要 docker ⇒ 没有 docker 的环境上等于没有判据。
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
# ## 🔴 迁移这一环判的是 D-3，而且是**四条腿**
#
# 本脚本**始终带上对外文档第一屏那条入口的同一套文件**（`docker-compose.yml` +
# `.build.yml` + `.migrate-once.yml`，由 R7 钉住；见下面 `COMPOSE_FILES` 那段），并且
# 夹具里**不设** `RUN_MIGRATIONS_ON_STARTUP`
# —— 于是容器里读到的是 `docker-compose.yml:50` 那个默认 `false`。
# 这几条合起来才证明"空库起来的那套能用的界面，迁移是被**那个一次性服务**做掉的"：
#
#   · 腿一：一次性容器**退出码 0**，且库里「已成功应用」的**不同迁移名数**等于磁盘上的
#     迁移目录数（阈值从被约束的常量推导，不是"大于 0"—— 后者在只建了基线表时也能绿）；
#   · 腿二：应用容器自己的 `RUN_MIGRATIONS_ON_STARTUP` 当场读出来是 `false`；
#   · 腿三：没有一条迁移处在「既没 finished_at 也没 rolled_back_at」的悬挂态。
#     ⚠️ 刻意**不**断言"`finished_at IS NULL` 的行数为 0"：`migrate-deploy.sh` 对
#     CONCURRENTLY 走"回滚标记 + 带外恢复"，恢复成功后同一个名字**留两行**（一条痕迹、
#     一条结果）。本机现量：42 个目录 / 42 个已应用名 / 5 条回滚痕迹 / 悬挂 0 / 重复完成 0。
#     按行数判会把一次**正确**的部署判成失败。
#   · 腿四：应用容器当场带着 `MIGRATE_RECOVERY_BUILD_LOCAL=true` —— 它证明这套栈拿到的是
#     外人照文档起的那一支（那条 flag 决定迁移失败时打印的带外恢复命令里有没有
#     `-f docker-compose.build.yml`）。2026-10-04 之前脚本只带两份文件，这一支**从来没被跑过**。
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

# 🔴 三份 compose 文件写成**一个数组**，因为"带不带 override"就是这条验收的判据本体。
# 各段自己拼 `-f a -f b` 的写法，漂起来的方向是某个调用忘了带 override ——
# 那次跑的就不是对外文档里那条入口，而输出照样全绿。
#
# 这里的集合**必须与文档 §4 那条主命令同一套文件**，由 `check:selfhost-entry-command.mjs`
# 的 R7 判（判据只有一个所有者，脚本里不留第二份期望值）。2026-10-04 之前这里是两份，
# 当时的理由「因为脚本自己 docker build」已被否证 —— `docker compose config` 实测带不带
# `docker-compose.build.yml` 都解析成同一个 `image:`，而 compose 没有 `--build` 不会因为
# 存在 `build:` 段去重建 ⇒ 省掉它的收益是 0，代价是应用容器少了它注入的
# `MIGRATE_RECOVERY_BUILD_LOCAL=true`（`migrate-deploy.sh` 那条带外恢复命令的开关）。
# 记录在 `docs/research/self-host-distribution-audit.md` §8.28。
COMPOSE_FILES=(-f "$REPO_ROOT/server/docker-compose.yml" -f "$REPO_ROOT/server/docker-compose.build.yml" -f "$REPO_ROOT/server/docker-compose.migrate-once.yml")
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
  # 快照副本（bootstrap 那行 trap 会被下面 `trap 'cleanup; …' EXIT` 整个替换掉 ——
  # bash 的 EXIT trap 只有一个。不在这里带上，每跑一次就往 scripts/ 里留一个
  # .verify-selfhost-stack.sh.snap.PID；.gitignore 挡得住提交，挡不住堆盘）。
  rm -f -- "$0"
  if [ "$KEEP" = "1" ]; then
    # 🔴 `--keep` 时**不能**删这份凭据文件。它打印的那条"手工拆栈"命令里带
    # `--env-file "$ENV_FILE"`，而 `down` 要读同一份 env 才算得出这套资源 ——
    # 文件被 trap 删掉之后，照着输出执行得到的是 env file not found，
    # 那一栈就留在机器上了（"探针把取证路径自己删了"的形状：提示与清理必须同口径）。
    # 它里面是一次性随机凭据，所以这里把路径**打出来**，拆完由人顺手 rm。
    log "   一次性凭据文件**保留**（上面那条拆栈命令的 --env-file 就是它）：${ENV_FILE}"
    return 0
  fi
  rm -f "$ENV_FILE"
}
# 🔴 必须把 cleanup 与快照删除**串在同一条** trap 里（见上面 cleanup 的第一行）。
trap 'cleanup; rm -f -- "$0"' EXIT

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
    ${NODE_IMAGE:+--build-arg NODE_IMAGE=$NODE_IMAGE} \
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

# 🔴 **这一趟验的是哪个架构的产物**必须落在日志里，否则"整套验收过了"会被读成
#    "要发布的那枚过了"。`docker build` 不带 `--platform` ⇒ 镜像架构 = 构建机架构；
#    而发布 workflow 钉的是 `linux/amd64`
#    （`.github/workflows/heyta-server-image.yml` 的 `platforms`）。
#    2026-10-04 现量：本机这枚是 `linux/arm64`，它里面的平台二进制包与快照/许可证门禁
#    按 `linux/x64/musl` 预测的那批**不是同一批**（`@node-rs/argon2-linux-arm64-musl`
#    谁都没扫过 —— 审计文档 §8.38 / G-53）。
IMAGE_ARCH=$(docker image inspect "$IMAGE" --format '{{.Os}}/{{.Architecture}}' 2>/dev/null || echo '读不到')
case "$IMAGE_ARCH" in
  linux/amd64)
    log "    被验的镜像：${IMAGE_ARCH}（与发布 workflow 钉的那枚同架构）"
    ;;
  *)
    log "    被验的镜像：${IMAGE_ARCH} —— 🔴 不等于发布 workflow 钉的 linux/amd64。"
    log "      这趟证明的是「外人在自己机器上 build 出来的那一枚能跑」（M 系列自建者正是这种），"
    log "      它**不构成**对 amd64 发布物的运行证据；两者的平台二进制包不是同一批。"
    ;;
esac

# ── 镜像内那棵依赖树：对到许可证门禁的扫描集上 ─────────────────────
# 为什么放在这里而不是 pnpm check 里：这条判据的输入**必须是刚构建出来的那枚镜像**。
# check:image-license 那条链上跑的读的是预测快照（不联网、不 docker 也能跑），
# 而审计 §8.38/§8.43 量到预测与真树之间确实有差 —— 差的那一截只有构建之后才看得见。
# 🔴 不许用 npm ci --dry-run 代替它：那条命令对 file: 依赖一个字节都不碰（§8.43）。
log "==> 镜像内依赖树 × 许可证门禁扫描集（真产物载体）"
IMAGE_TREE_JSON="$(mktemp -t heyta-image-tree.XXXXXX.json)"
set +e
docker run --rm -i --entrypoint node "$IMAGE" --input-type=commonjs - \
  < "$REPO_ROOT/research/tools/dump-installed-tree.js" > "$IMAGE_TREE_JSON"
TREE_RC=$?
set -e
if [ "$TREE_RC" != "0" ] || [ ! -s "$IMAGE_TREE_JSON" ]; then
  rm -f "$IMAGE_TREE_JSON"
  die "在镜像里枚举已装依赖树失败（rc=${TREE_RC}）—— 没有输入，这条对账不能算过"
fi
set +e
node "$REPO_ROOT/research/tools/check-image-license-coverage.mjs" \
  --installed-tree "$IMAGE_TREE_JSON"
COVER_RC=$?
set -e
rm -f "$IMAGE_TREE_JSON"
if [ "$COVER_RC" != "0" ]; then
  die "镜像里装的树对不上许可证门禁 —— 上面逐条点名了是哪几条、为什么"
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

# ── 对外文档那条入口命令的对账（判据的**唯一所有者**是那份 .mjs）────────
# 为什么要抽出去：这段判断原先只活在本文件里，而本文件**要 docker、要起栈** ⇒
# 没有 docker 的机器与 CI 上等于没有判据 —— 漂了没人红，直到某个外人照抄踩坑。
# 2026-10-03 实测漂的就是这个方向：文档少带了 `docker-compose.build.yml`，
# 于是陌生人照抄得到 `pull access denied for supersync … may require 'docker login'`
# （我们根本没有仓库，那句提示把人引向"去找登录凭据"）。
# 这里**只调用、不再抄一份**：同一个判断抄两遍就是下一次漂移的起点（AGENTS §3.5）。
log "==> 入口命令抄件对账（纯文件系统）"
node "$REPO_ROOT/scripts/check-selfhost-entry-command.mjs" ||
  die "文档/README 里那条入口命令已经漂了 —— 上面点名了哪个文件哪一行。停在起栈之前是有意的：照抄会失败的那条命令，起起来的栈证明不了它自己对外可用。"
# 🔴 原来这里还有一段 `[ "$SCRIPT_ENTRY_FILES" = "…两份…" ] || die`，2026-10-04 删掉：
# 它把**当时的形状**当期望值写死在脚本里，那不是判据而是快照 —— 脚本再漂一次只要漂成
# 同一个值它就跟着认账，而期望值的真源是文档那条主命令。这件事的判据归
# `check-selfhost-entry-command.mjs` 的 R7（它自己读 `COMPOSE_FILES` 数组、从对外主命令
# 导出不许有第二份）。下面只**打印**实测集合，打印不判定。
# ⚠️ 计算集合时要把 `-f` 这些开关滤掉：`${COMPOSE_FILES[@]}` 里 `-f` 与路径成对存，
# 原先那句 `sed 's#.*/##'` 把两个 `-f` 也数进去 ⇒ 排序后得到「-f -f …yml …yml」，
# 与期望值**永不相等** —— 那条判断在 HEAD 版里是**每次跑都红**（实测单拎出来 exit 1），
# 症状却长得像"脚本自己漂了"。判据坏在"永不相等"这一档，比没有判据更误导人。
SCRIPT_ENTRY_LIST=""
for entry in "${COMPOSE_FILES[@]}"; do
  case "$entry" in
    *.yml) SCRIPT_ENTRY_LIST="${SCRIPT_ENTRY_LIST}$(basename "$entry")
" ;;
  esac
done
SCRIPT_ENTRY_FILES="$(printf '%s' "$SCRIPT_ENTRY_LIST" | LC_ALL=C sort -u | tr '\n' ' ')"
log "    入口命令对账：抄件全部在位（判据见 scripts/check-selfhost-entry-command.mjs） · 本脚本带的文件：${SCRIPT_ENTRY_FILES}"

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
# 四条各管一段，缺任何一条这个结论都不成立：
#   1 一次性容器退出码 0（它真跑完了，不是还在跑、也不是失败后被 restart 策略留着）；
#   2 应用容器自己读到的 RUN_MIGRATIONS_ON_STARTUP 当场是 false（排除"迁移来自应用"）；
#   3 库里已 applied 的迁移数 **等于** 磁盘上的迁移目录数（阈值从被约束的常量推导，
#     不是"大于 0" —— 后者在只建了基线表、一条迁移都没跑的时候也能绿）。
#   4 应用容器当场带着 MIGRATE_RECOVERY_BUILD_LOCAL=true（它跑的确实是文档那条入口那一支，
#     不是脚本自己凑出来的另一支）。
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
# 🔴 腿四（2026-10-04 加）：应用容器必须带着 `MIGRATE_RECOVERY_BUILD_LOCAL=true`。
# 它是 `server/scripts/migrate-deploy.sh:239` 那个分支的**唯一开关** —— 决定 CONCURRENTLY
# 迁移失败后打印给运维的那条带外恢复命令里，有没有 `-f docker-compose.build.yml`。
# 外人照文档那条入口（带 build override）拿到的就是**这一支**；2026-10-04 之前本脚本
# 只带两份文件，跑的是**另一支**，于是"栈全绿"对那一支不构成任何证据。
# 这里判的是容器里**当场读到的值**，不是 compose 解析结果 —— 解析对了但镜像/文件被换掉，
# 也只有这一条会现形。
APP_RECOVERY_FLAG="$(docker exec supersync-server printenv MIGRATE_RECOVERY_BUILD_LOCAL 2>/dev/null || echo '<没有这个变量>')"
if [ "$APP_RECOVERY_FLAG" != "true" ]; then
  printf '   应用容器里的 MIGRATE_RECOVERY_BUILD_LOCAL 实测 = %s\n' "$APP_RECOVERY_FLAG" >&2
  die "应用容器没带上这个 flag ⇒ 本脚本验的那套**不是**外人照文档起的那套（少带了 docker-compose.build.yml），迁移失败时运维拿到的恢复命令会缺 -f docker-compose.build.yml。"
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
log "    D-3 对账：一次性容器 exited(0) · 应用侧 RUN_MIGRATIONS_ON_STARTUP=false · 带外恢复 flag=true（与文档那条入口同一支）· 已应用 ${APPLIED}/${MIGRATION_DIRS} · 悬挂 0 · 重复完成 0 · 回滚痕迹 ${TRACE} 条（设计内）"


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
# 🔴 起跑时刻要先落到变量里，**再**跑用例 —— 后面那条新鲜度判据要比的就是这个数。
# （顺序反了就是"拿同一棵树量两次"：判据永远绿。）
BROWSER_T0=$(date +%s)
cd e2e
[ -d node_modules/@playwright/test ] || die "e2e 的依赖没装：先 cd e2e && pnpm install（它自己一份 lockfile）"
set +e
HEYTA_SELFHOST_BASE="$BASE" npx playwright test --config playwright.selfhost.config.ts
RC=$?
set -e
cd "$REPO_ROOT"

log ""
log "截图落在 e2e/selfhost-stack-results/ —— 按 §6.2 规定一，**人必须打开看**："
# 🔴 「文件存在」不是证据。内存闸门拒绝启动时，Playwright 一条用例都没跑，
#    而这个目录里还躺着**上一批**那四张同名同尺寸的图（2026-10-04 实测：
#    这一趟 03:41 起跑，四张图全是 Oct 3 14:32 的）—— 任何人 `ls` 一次就会把它们
#    当成这次的界面证据。所以判据是「mtime 晚于本次起跑」，不是「有这四张」。
SHOTS=$(node --input-type=commonjs -e '
const fs = require("fs"), path = require("path");
const t0 = Number(process.argv[1]), dir = process.argv[2];
const want = ["s1-app-loaded.png", "s2-signed-in.png", "s3-device-a-synced.png", "s3-device-b-recovered.png"];
let fresh = 0;
for (const n of want) {
  let st = null;
  try { st = fs.statSync(path.join(dir, n)); } catch (e) { /* 文件不存在 */ }
  const m = st ? Math.floor(st.mtimeMs / 1000) : null;
  const ok = st !== null && m >= t0;
  if (ok) fresh += 1;
  console.log("  " + n + "  mtime=" + (m === null ? "不存在" : new Date(m * 1000).toISOString()) +
    "  bytes=" + (st ? st.size : "-") + "  " + (ok ? "本次的" : "不是本次的"));
}
console.log("FRESH=" + fresh + "/" + String(want.length));
if (fresh !== want.length) process.exit(1);
' "$BROWSER_T0" "e2e/selfhost-stack-results")
SHOT_RC=$?
printf '%s\n' "$SHOTS"
# 🔴 先算进变量再插值：bash 3.2 解析不了 `"… $(date -r "$X" '…') …"` 这种**双引号里套
#    双引号**的写法（`syntax error near unexpected token ')'`，2026-10-04 实测）。
BROWSER_T0_HUMAN=$(date -r "$BROWSER_T0" '+%Y-%m-%dT%H:%M:%S')
log "   （起跑时刻 ${BROWSER_T0_HUMAN} —— 只有标「本次的」那几张才算这一趟的证据）"

if [ "$RC" = "0" ] && [ "$SHOT_RC" != "0" ]; then
  die "Playwright 退出码 0，但四张截图里**没有一张是本次的**（见上面那张 mtime 表）。
   「退出码 0」+「截图是旧的」这个组合只有一种解释：用例没走到截图那一步就返回了 0 ——
   也就是**没有证据**。这一趟不算闭合。"
fi

if [ "$KEEP" = "1" ]; then
  log ""
  log "⚠️ 栈留着没拆（--keep）：${BASE} 现在可以直接用浏览器打开。"
  # 🔴 这条命令里的 `--env-file` **必须真的能用**。以前 trap 无条件 `rm -f "$ENV_FILE"`，
  # 于是 --keep 打印出来的是一条**照着执行拆不掉**的假提示（`down` 读不到那份 env，
  # 栈就留在机器上了）。现在 cleanup 在 --keep 时保留它并把路径打出来。
  log "   拆掉（整条可以直接粘贴执行）："
  log "   docker compose -p ${PROJECT} --env-file ${ENV_FILE} ${COMPOSE_FILES[*]} down -v"
  log "   拆完顺手 rm 掉上面那份一次性凭据文件（随机凭据，别留在 /tmp）"
else
  down_stack
fi

[ "$RC" = "0" ] && log "✅ 自托管整套：三条判据全过" || log "❌ 自托管整套：Playwright 退出码 $RC"
exit "$RC"
