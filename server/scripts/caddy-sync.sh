#!/usr/bin/env bash
#
# heyta 的 Caddy 站点片段 ↔ 线上 `/etc/caddy/sites.d/` 的同步与漂移检测。
#
# ## 为什么要有这一份（而不是继续用 `nginx-sync.sh`）
#
# `nginx-sync.sh` 存在的理由逐字适用于这里：让「线上到底有哪些 location」变成一个
# **可 diff 的事实**。但本域名 2026-10-24 起不由 nginx 服务 ——
# `ssh finlaw 'ss -ltnp | grep :443'` 现量是 `caddy-edge`，`nginx.service` 是 masked，
# 于是 `/etc/nginx/sites-available/*` 与仓库里那份 `.conf` 一起变成**死配置**。
# 这一课 ADR-0054 §落地动作 3 记过一次，2026-10-25 上线 `/admin` 时又踩了一遍
# （照计划里那句"最后跑 nginx-sync --apply"执行，配置写进了一个没人读的文件）。
# 那一次改的是**线上**，仓库里查不到 —— 正是 `nginx-sync.sh` 文件头写的那族事故。
#
# ## 三档
#
#   --check  只比对，不改任何东西。有漂移时退出码 1。（默认）
#   --pull   把线上现状抓回仓库副本（直接在服务器上改完之后用）。
#   --apply  把仓库副本装到线上：逐片备份、整份 Caddyfile 校验过才 reload，
#            校验不过**全部还原**（宁可线上保持旧配置，也不要半生效的站点）。
#
# ## 🔴 只碰 heyta 自己那几片
#
# `sites.d/` 是**多个产品共用**的目录（`00-heyta.caddy` 文件头第 0 条就写着
# "改这一片前先读这三条；整文件覆盖会打掉别人的站"）。所以这里既不像 nginx 那份
# 那样"一份文件整体覆盖"，也不许按名字撞运气：射程由 `PATTERN` 定死，
# 射程外的文件名**一个字节都不写**。
#
# ## 🔴 校验必须用 `$CADDY_BIN`，不是 PATH 上那枚 `caddy`
#
# 2026-10-25 实测：PATH 上的 `caddy` 没编进 `rate_limit` 模块，会在**别人的那片**
# `21-originxspace.caddy` 上报 `unrecognized directive: rate_limit` —— 一份好配置
# 被量成坏的。要量的是服务这个站的那枚二进制（`caddy-edge`，见
# `systemctl cat caddy-edge` 的 ExecStart）。
#
# 需要能 `ssh finlaw`（见部署手册）。远端写操作走 `sudo -n`（免密）。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SSH_HOST="${HEYTA_CADDY_SSH_HOST:-finlaw}"
REMOTE_DIR="${HEYTA_CADDY_REMOTE_DIR:-/etc/caddy/sites.d}"
LOCAL_DIR="${HEYTA_CADDY_LOCAL_DIR:-$REPO_ROOT/server/deploy/caddy/sites.d}"
CADDY_BIN="${HEYTA_CADDY_BIN:-/usr/local/bin/caddy-edge}"
CADDY_SERVICE="${HEYTA_CADDY_SERVICE:-caddy-edge}"
CADDYFILE="${HEYTA_CADDY_FILE:-/etc/caddy/Caddyfile}"
# heyta 拥有的那几片：`00-heyta.caddy`、`01-heyta-api.caddy`、`02-heyta-legacy.caddy`。
# 备份文件（`*.caddy.bak-*`）不匹配 `*.caddy`，因此既不参与比对，也不会被 Caddy import。
PATTERN='*heyta*.caddy'

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)
mode="${1:---check}"

die() { printf '❌ %s\n' "$1" >&2; exit 1; }
info() { printf '· %s\n' "$1"; }
ssh_r() { ssh "${SSH_OPTS[@]}" "$SSH_HOST" "$@"; }

[ -d "$LOCAL_DIR" ] || die "仓库副本目录不存在：$LOCAL_DIR"

# ── 两侧的清单 ───────────────────────────────────────────────────────────────
# 🔴 空清单**不是**"一致"：REMOTE_DIR 打错一个字母会得到两边都为空、于是恒绿的判据
# （这一族在 §7 记过：空读数先归因搜法，再归因对象）。
remote_list="$(ssh_r "sudo -n sh -c 'ls $REMOTE_DIR/$PATTERN 2>/dev/null || true'" | sed 's#.*/##' | sort -u)"
[ -n "$remote_list" ] || die "远端一枚都没匹配到：$SSH_HOST:$REMOTE_DIR/$PATTERN —— 拒绝据此判定'无漂移'"

local_list="$(find "$LOCAL_DIR" -maxdepth 1 -name "$PATTERN" -exec basename {} \; | sort -u)"
[ -n "$local_list" ] || die "仓库副本一枚都没匹配到：$LOCAL_DIR/$PATTERN"

all_names="$(printf '%s\n%s\n' "$remote_list" "$local_list" | grep -v '^$' | sort -u)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 把远端每一片抓到临时目录（只读，不给远端留中间产物）。
for name in $all_names; do
  case "$name" in
    $PATTERN) ;;
    *) die "射程外的文件名：${name}（PATTERN=${PATTERN} 之外一律不碰）" ;;
  esac
  # 下面所有循环都按空白切词（`for name in $all_names`），带空格的名字会把一片
  # 切成两片 —— 与其在错误的路径上备份/写入，不如在这里拒绝。
  case "$name" in
    *[[:space:]]*) die "文件名带空白：'$name' —— 这个脚本按空白切词，拒绝处理" ;;
  esac
  if ssh_r "sudo -n test -f '$REMOTE_DIR/$name'"; then
    ssh_r "sudo -n cat '$REMOTE_DIR/$name'" > "$tmp/$name" \
      || die "读取远端失败：$SSH_HOST:$REMOTE_DIR/$name"
    [ -s "$tmp/$name" ] || die "远端文件是空的：$SSH_HOST:$REMOTE_DIR/$name —— 拒绝据此比对"
  fi
done

# 一片的差异描述（缺失也算差异，不许静默跳过）。
diff_of() {
  local name="$1"
  local local_path="$LOCAL_DIR/$name" remote_path="$tmp/$name"
  if [ ! -f "$remote_path" ]; then
    printf '线上没有这一片，而仓库里有（--apply 会新建它）\n'
    return 1
  fi
  if [ ! -f "$local_path" ]; then
    printf '仓库里没有这一片，而线上有（--pull 会把它收进仓库）\n'
    return 1
  fi
  if ! diff -u "$local_path" "$remote_path" > "$tmp/$name.diff"; then
    cat "$tmp/$name.diff"
    return 1
  fi
  return 0
}

drift=''
for name in $all_names; do
  if ! diff_of "$name" > "$tmp/$name.out" 2>&1; then
    drift="$drift $name"
  fi
done

case "$mode" in
  --check)
    if [ -z "$drift" ]; then
      echo "✅ 无漂移：$SSH_HOST:$REMOTE_DIR 与 $LOCAL_DIR 逐字节一致（$(printf '%s\n' $all_names | wc -l | tr -d ' ') 片）"
      exit 0
    fi
    printf '🔴 检测到漂移的片：%s\n' "$drift"
    for name in $drift; do
      printf '\n──── %s（- 仓库 / + 线上）────\n' "$name"
      cat "$tmp/$name.out"
    done
    printf '\n线上改了、仓库没跟上，或反之。\n'
    printf '  · 若线上是对的 → 跑 %s --pull 并提交\n' "$0"
    printf '  · 若仓库是对的 → 跑 %s --apply（会用仓库副本整体覆盖线上那几片）\n' "$0"
    exit 1
    ;;

  --pull)
    if [ -z "$drift" ]; then
      echo "✅ 本来就一致，无需 pull"
      exit 0
    fi
    for name in $drift; do
      [ -f "$tmp/$name" ] || continue # 线上没有这一片 ⇒ 没有可抓回来的东西
      cp "$tmp/$name" "$LOCAL_DIR/$name"
      info "已抓回 $name"
    done
    git -C "$REPO_ROOT" --no-pager diff --stat -- "server/deploy/caddy/sites.d/" || true
    printf '\n⚠️  现在**必须提交**，否则下次 --check 还会报同样的漂移。\n'
    ;;

  --apply)
    if [ -z "$drift" ]; then
      echo "✅ 本来就一致，无需 apply"
      exit 0
    fi
    ts="$(date -u +%Y%m%dT%H%M%SZ)"
    writes=''
    for name in $drift; do
      printf '──── 即将用仓库副本覆盖线上：%s（- 线上 / + 仓库）────\n' "$name"
      diff -u "$tmp/$name" "$LOCAL_DIR/$name" 2>/dev/null || true
      if ssh_r "sudo -n test -f '$REMOTE_DIR/$name'"; then
        ssh_r "sudo -n cp -a '$REMOTE_DIR/$name' '$REMOTE_DIR/$name.bak-$ts'"
        info "已备份 $name → $name.bak-$ts"
      fi
      ssh_r "sudo -n tee '$REMOTE_DIR/$name' > /dev/null" < "$LOCAL_DIR/$name"
      writes="$writes $name"
      info "已写入 $REMOTE_DIR/$name"
    done

    # 校验的是**整份** Caddyfile（sites.d 是被 import 进去的，单片自洽不等于整体自洽）。
    # 🔴 校验过但 reload 没成功时也要**还原**：那时磁盘上是新配置、内存里跑的还是旧的，
    # 于是"下一次重启"会静默换成一份没人验过生效的配置 —— 比当场红更难归因。
    restore_all() {
      for n in $writes; do
        if [ -f "$tmp/$n" ] && ssh_r "sudo -n test -f '$REMOTE_DIR/$n.bak-$ts'"; then
          ssh_r "sudo -n cp -a '$REMOTE_DIR/$n.bak-$ts' '$REMOTE_DIR/$n'"
          info "已还原 $n"
        else
          ssh_r "sudo -n rm -f '$REMOTE_DIR/$n'"
          info "已撤掉新建的 $n"
        fi
      done
    }

    if ! ssh_r "sudo -n $CADDY_BIN validate --config '$CADDYFILE' --adapter caddyfile"; then
      restore_all
      die "校验不通过 —— 已全部还原，线上仍是旧配置，且**没有** reload"
    fi
    info "校验通过（${CADDY_BIN}）"

    if ! ssh_r "sudo -n systemctl reload $CADDY_SERVICE"; then
      restore_all
      die "reload 失败 —— 已还原那几片（磁盘上现在仍是**在跑的那份**配置）。
  先看服务在不在：ssh ${SSH_HOST} systemctl status ${CADDY_SERVICE}
  再确认是谁在服务 443：ssh ${SSH_HOST} 'ss -ltnp | grep :443'
  备份留在：${REMOTE_DIR}/*.bak-${ts}"
    fi
    echo "✅ 已 reload。线上那几片现在就是仓库副本。"
    ;;

  *)
    die "未知参数：${mode}（可用：--check / --pull / --apply）"
    ;;
esac
