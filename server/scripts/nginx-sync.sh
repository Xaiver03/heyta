#!/usr/bin/env bash
#
# 生产 nginx 站点文件 ↔ 仓库副本 的同步与漂移检测。
#
# 背景（详见 server/deploy/nginx/README.md）：这个域名一天之内踩了三次
# 「HTTP 200，但内容是别的页面」——`/health`、`/terms.html`、`/*.js`
# 都没有 location，于是掉进 `location /` 的 SPA 兜底，返回落地页。
# 三次修改**全都只发生在服务器上**，仓库里查不到，所以没人能 diff。
#
# 这个脚本存在的唯一目的：让「线上到底有哪些 location」变成一个可 diff 的事实。
#
#   --check  只比对，不改任何东西。有漂移时退出码 1。（默认）
#   --pull   把线上现状抓回仓库副本（你直接在服务器上改完之后用）。
#   --apply  把仓库副本装到线上：先备份、先 `nginx -t`、通过才 reload。
#
# 需要能 `ssh finlaw`（见部署手册）。远端写操作走 `sudo -n`（免密）。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SSH_HOST="${HEYTA_NGINX_SSH_HOST:-finlaw}"
REMOTE_PATH="${HEYTA_NGINX_REMOTE_PATH:-/etc/nginx/sites-available/heyta.finlaw.cloud}"
# 仓库里带 `.conf` 后缀（编辑器与语法高亮认它），线上文件不带。名字故意不同，
# 所以这里显式映射，而不是靠 basename 撞运气。
LOCAL_NAME="${HEYTA_NGINX_LOCAL_NAME:-$(basename "$REMOTE_PATH").conf}"
LOCAL_PATH="$REPO_ROOT/server/deploy/nginx/$LOCAL_NAME"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)

mode="${1:---check}"

die() { printf '❌ %s\n' "$1" >&2; exit 1; }
info() { printf '· %s\n' "$1"; }

[ -f "$LOCAL_PATH" ] || die "仓库副本不存在：$LOCAL_PATH"

# 抓线上现状到临时文件。用 `sudo -n cat` 而不是 `sudo cp`：
# 只读一条文件，不给远端留任何中间产物。
fetch_remote() {
  local out="$1"
  if ! ssh "${SSH_OPTS[@]}" "$SSH_HOST" "sudo -n cat '$REMOTE_PATH'" > "$out"; then
    die "读取远端失败：$SSH_HOST:$REMOTE_PATH（检查 ssh 与 sudo -n 是否可用）"
  fi
  [ -s "$out" ] || die "远端文件是空的：$SSH_HOST:$REMOTE_PATH —— 拒绝据此比对"
}

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
fetch_remote "$tmp"

case "$mode" in
  --check)
    if diff -u "$LOCAL_PATH" "$tmp" > /dev/null; then
      echo "✅ 无漂移：$SSH_HOST:$REMOTE_PATH 与 server/deploy/nginx/$LOCAL_NAME 逐字节一致"
      exit 0
    fi
    printf '🔴 检测到漂移 —— 线上与仓库副本不一致（- 仓库 / + 线上）：\n\n'
    # `|| true`：diff 有差异时退出码为 1，别让 set -e 提前把它变成"脚本失败"
    diff -u "$LOCAL_PATH" "$tmp" || true
    printf '\n线上改了、仓库没跟上，或反之。\n'
    printf '  · 若线上是对的 → 跑 %s --pull 并提交\n' "$0"
    printf '  · 若仓库是对的 → 跑 %s --apply（会用仓库副本整体覆盖线上）\n' "$0"
    exit 1
    ;;

  --pull)
    if diff -u "$LOCAL_PATH" "$tmp" > /dev/null; then
      echo "✅ 本来就一致，无需 pull"
      exit 0
    fi
    cp "$tmp" "$LOCAL_PATH"
    info "已把线上现状写回 server/deploy/nginx/$LOCAL_NAME"
    git -C "$REPO_ROOT" --no-pager diff --stat -- "server/deploy/nginx/$LOCAL_NAME" || true
    printf '\n⚠️  现在**必须提交**，否则下次 --check 还会报同样的漂移。\n'
    ;;

  --apply)
    if diff -u "$LOCAL_PATH" "$tmp" > /dev/null; then
      echo "✅ 本来就一致，无需 apply"
      exit 0
    fi
    # 先打出"将要覆盖什么"。如果仓库副本是旧的，它会连带把线上今天的修复一起回滚掉 ——
    # 脚本只备份，不替你判断。
    printf '即将用仓库副本覆盖线上（- 线上 / + 仓库）：\n\n'
    diff -u "$tmp" "$LOCAL_PATH" || true
    printf '\n'

    ts="$(date -u +%Y%m%dT%H%M%SZ)"
    ssh "${SSH_OPTS[@]}" "$SSH_HOST" \
      "sudo -n cp -a '$REMOTE_PATH' '$REMOTE_PATH.bak-$ts'"
    info "已备份 → $REMOTE_PATH.bak-$ts"

    ssh "${SSH_OPTS[@]}" "$SSH_HOST" "sudo -n tee '$REMOTE_PATH' > /dev/null" < "$LOCAL_PATH"
    info "已写入 $REMOTE_PATH"

    # 校验不过就**不** reload：宁可线上保持旧配置，也不要半生效的站点文件。
    if ssh "${SSH_OPTS[@]}" "$SSH_HOST" 'sudo -n nginx -t'; then
      ssh "${SSH_OPTS[@]}" "$SSH_HOST" 'sudo -n systemctl reload nginx'
      echo "✅ 已 reload。线上现在就是仓库副本。"
    else
      die "nginx -t 不通过 —— **没有** reload，线上仍是旧配置（备份也还在，可回滚）"
    fi
    ;;

  *)
    die "未知参数：$mode（可用：--check / --pull / --apply）"
    ;;
esac
