#!/usr/bin/env bash
# 出口探针：用 mihomo **自己的账本**证明"这一趟门禁的字节没有经过代理"
# ======================================================================
#
# ⚠️ 这一枚探针被重写/修过**三次**，三次都是仪器自己的毛病。三次都值得留着，
#    因为它们恰好是 §7 元规则 1（"先怀疑探针"）的三种面目：
#
#    v1 —— 判"容器里连不上 github.com ⇒ 那条路是关的"。
#          前提被实测否证：这台机器现在直连 `https://github.com/` 是 **200 / 0.09 s**
#          （宿主 5/5、容器 1/1，2026-10-06 复测）。ci-and-runner.md §4.3 记的
#          "直连超时"是 09-26 的读数，现在只对**批量传输**成立（codeload 109 KB/s 且超时）。
#          ⇒ 那一版是一条**永远红**的判据，而红的原因与"有没有走代理"无关。
#    v2 —— python 里 `(x or "").[:19]` 是语法错，`marker_bytes` 返回空串，
#          A 与 B 都"没记到" ⇒ 判成 BLIND。落点是对的（仪器坏了不许落回"通过"），
#          但把"仪器坏了"报成了"对照不成立"，读起来像网络的问题。
#    v3 —— 采样时机错了：请求跑完再 `sleep 2` 去看账本。而 `/connections`
#          **只列活跃连接**，请求一结束记录就没了 ⇒ 挂了代理的 B 也是 0 条 ⇒ 永远 BLIND。
#          现在改成"后台起请求 → 窗口内反复采 → 再等它结束"。
#
# 判据形状（这一版）：
#   A) 容器内**不挂代理**打一次只有本项目会打的 URL（本仓库自己的 pnpm-lock.yaml，
#      限速拖到 14 秒，好让采样窗口覆盖得到它）；
#   B) 同一发请求**显式挂上 mihomo** —— 阳性对照。
#
#   A 在账本里出现 ⇒ 字节确实经过代理 ⇒ 🔴 EGRESS=FAIL
#   B 在账本里不出现 ⇒ 仪器瞎了，A 的"没出现"什么都证明不了 ⇒ 🟠 EGRESS=INCONCLUSIVE + exit 2
#   A 没有、B 有   ⇒ ✅ "零代理字节"是**被测出来的**，不是被声明出来的
#
# 代价：B 那一次约 280 KB 走代理（整套方案里**唯一**一处刻意花额度的动作）。
# 它买的是"其余每一个字节都没花额度"这句话可以复现。
#
# 用法（由 gate-ssh.mjs 在 finlaw 上执行；需要能读 mihomo 控制器与 docker）：
#   bash scripts/ci/egress-probe.sh <载体镜像> [代理 URL] [mihomo 控制器]
# 退出码：0=成立 / 1=有代理残留或国内源不通 / 2=对照看不见（结论无效）/ 3=控制器读不到
set -uo pipefail

IMAGE="${1:-heyta-gate:local}"
PROXY="${2:-http://172.17.0.1:7890}"
CTRL="${3:-http://172.17.0.1:9090}"
# 只有本项目的 CI 会打的 URL：仓库自己的 lockfile。别的进程在这个窗口里打它的概率≈0。
MARKER="https://raw.githubusercontent.com/Xaiver03/heyta/HEAD/pnpm-lock.yaml"
MARKER_HOST=$(printf '%s' "$MARKER" | awk -F/ '{print $3}')
TMPA=$(mktemp); TMPB=$(mktemp); trap 'rm -f "$TMPA" "$TMPB"' EXIT

# 数一遍**当前活跃**连接里命中 MARKER 主机的那几条（条数 字节数）。
# ⚠️ 控制器地址由参数传进来，python 里不重写一遍字面量 —— 同一件事写两处就是抄件，
#    它的漂移方式恰好是"改了上面那行、python 还在读旧端口"，症状是永远 BLIND。
marker_now() {
  curl -sS --max-time 5 "$CTRL/connections" 2>/dev/null | python3 -c '
import json, sys
host = sys.argv[1]
try:
    d = json.loads(sys.stdin.read() or "{}")
except Exception as e:
    print("ERR", e); raise SystemExit
n = b = 0
for c in (d.get("connections") or []):
    m = c.get("metadata") or {}
    if (m.get("host") or "").endswith(host):
        n += 1
        b += int(c.get("download", 0)) + int(c.get("upload", 0))
print(n, b)
' "$MARKER_HOST" 2>/dev/null || echo "ERR pipe"
}

# 在一段窗口里反复采，取"看到最多条数"的那一次（连接数会随时间涨落）
sample_window() { # $1 = 秒数
  local end=$((SECONDS + $1)) bn=0 bb=0 n b
  while [ "$SECONDS" -lt "$end" ]; do
    read -r n b <<<"$(marker_now)"
    case "$n" in ''|*[!0-9]*) n=0 ;; esac
    case "$b" in ''|*[!0-9]*) b=0 ;; esac
    if [ "$n" -gt "$bn" ]; then bn=$n; bb=$b; fi
    sleep 1
  done
  printf '%s %s' "$bn" "$bb"
}

FAIL=0

# ── 0) 容器里不许有**非空**的代理变量 ───────────────────────────────────────────
# ⚠️ 判的是"值非空"，不是"变量存在"：`-e http_proxy=` 会让 Docker 把一个**空值**变量
#    放进容器，那是这条路**刻意做的加固**（空值盖掉镜像层可能带进来的值，比"不存在"更强）。
#    第一版按"存在"判，于是自己的加固动作被判成违规，当场 `PROXY_ENV=FAIL` 六个全空值。
RESID=$(docker run --rm --entrypoint sh "$IMAGE" -c \
  'env | grep -iE "^(http|https|all)_proxy=" | grep -vE "^(http|https|all)_proxy(_)?=$" || true')
if [ -n "$RESID" ]; then
  printf 'PROXY_ENV=FAIL %s\n' "$(printf '%s' "$RESID" | tr '\n' ' ')"; FAIL=1
else
  printf 'PROXY_ENV=OK (六个 proxy 变量要么不存在、要么显式空值)\n'
fi

# ── 1) 容器内不许带 git 的 proxy 配置 ──────────────────────────────────────────
#    宿主 ubuntu 用户 `git config --global http.proxy` = mihomo（实测）。它不在任何
#    环境变量里，清 shell 变量拦不住它 —— 一次 `git ls-remote https://github.com`
#    在"看起来没代理"的 shell 里照样成功。
GP=$(docker run --rm --entrypoint sh "$IMAGE" -c 'git config --get http.proxy 2>/dev/null || true')
if [ -n "$GP" ]; then printf 'GIT_PROXY=FAIL http.proxy=%s\n' "$GP"; FAIL=1
else printf 'GIT_PROXY=OK (容器里没有 http.proxy)\n'; fi

# ── 2) 门禁需要的源必须直连通 ──────────────────────────────────────────────────
for u in https://registry.npmmirror.com/ https://registry.npmjs.org/; do
  c=$(docker run --rm --entrypoint sh "$IMAGE" -c "curl -sS -o /dev/null -m 10 -w '%{http_code}' '$u'" 2>/dev/null || true)
  if [ "$c" = "200" ]; then printf 'SOURCE %s=OK\n' "$u"
  else printf 'SOURCE %s=FAIL http=%s\n' "$u" "${c:-000}"; FAIL=1; fi
done

# ── 3+4) A 与 B：账本必须**在请求进行中**被采到 ────────────────────────────────
req() { # $1 = 额外 curl 参数（"-x <proxy>" 或空）；stdout 落到 $2
  # 🔴 `-4` 是**承重的**，不是风格：`raw.githubusercontent.com` 在这台机器上解析到的
  #    是 **AAAA**（`2606:50c0:8003::154`），而容器没有 IPv6 出口 ⇒ 不加 `-4` 时
  #    A 那一次是 **0 字节 / 无 HTTP 码**（curl rc 28 连不上），于是"账本零记录"
  #    根本不构成证据 —— 那一趟什么都没发出去。加了 `-4` 才拿到
  #    `bytes=217579 code=200 ip=185.199.111.133`，才谈得上"这 217 KB 没进账本"。
  docker run --rm --entrypoint sh "$IMAGE" -c \
    "curl -4 -sS $1 --limit-rate 30k -m 14 -o /dev/null -w '%{size_download} %{http_code}' '$MARKER' 2>/dev/null || echo 'x timeout'" > "$2"
}

req "" "$TMPA" &
PA=$!
RB_A=$(sample_window 15)
wait "$PA" 2>/dev/null
S_A=$(cat "$TMPA")
printf 'A_NO_PROXY bytes/code=%s   mihomo_matched=%s\n' "$S_A" "$RB_A"

req "-x $PROXY" "$TMPB" &
PB=$!
RB_B=$(sample_window 15)
wait "$PB" 2>/dev/null
S_B=$(cat "$TMPB")
printf 'B_VIA_PROXY bytes/code=%s   mihomo_matched=%s\n' "$S_B" "$RB_B"

read -r NA BA <<< "$RB_A"
read -r NB BB <<< "$RB_B"
# 数值兜底：控制器读不到 / python 抛错时这里是空串或非数字 ⇒ 一律当 0，也就是"没记到"，
# 从而走 BLIND / INCONCLUSIVE 那一支，**绝不**走"通过"那一支。
case "$NA" in ''|*[!0-9]*) NA=0 ;; esac
case "$NB" in ''|*[!0-9]*) NB=0 ;; esac
case "$BA" in ''|*[!0-9]*) BA=0 ;; esac
case "$BB" in ''|*[!0-9]*) BB=0 ;; esac

if [ "$NB" -eq 0 ]; then
  # 阳性对照没出现 ⇒ 账本看不见这类连接（控制器版本/规则/端口/采集窗口的问题）。
  # A 的"没出现"因此什么都不是 —— 这不是"好消息"，这是**仪器作废**。
  printf 'CONTROL=BLIND 挂上代理那一次在账本里也没有记录（控制器 %s）⇒ 仪器够不着，A 项无意义\n' "$CTRL"
  echo 'EGRESS=INCONCLUSIVE'; exit 2
fi
printf 'CONTROL=OK 挂代理那一次账本记到 %s 条 / %s 字节 ⇒ 仪器看得见这类连接\n' "$NB" "$BB"

# 🔴 A 那一次必须**真的把字节发出去了**，否则"账本零记录"什么都不是。
#    这一条是给 IPv6 那个洞上锁的：不加 `-4` 时 A 是 0 字节 / 无 HTTP 码 ——
#    什么都没发出去，自然也没有任何一条记录，而那一版会把它读成"没走代理，通过"。
A_BYTES=$(printf '%s' "$S_A" | awk '{print $1}')
case "$A_BYTES" in ''|*[!0-9]*) A_BYTES=0 ;; esac
if [ "$A_BYTES" -lt 100000 ]; then
  printf 'A_TRANSFER=TOO_LITTLE bytes=%s（下限 100000）⇒ 请求根本没发出去，零记录不是证据\n' "$A_BYTES"
  echo 'EGRESS=INCONCLUSIVE'; exit 2
fi
printf 'A_TRANSFER=OK bytes=%s 直连发出去了（%s）\n' "$A_BYTES" "$MARKER_HOST"

if [ "$NA" -gt 0 ]; then
  printf 'LEAK=FOUND 不挂代理那一次**也**被记到 %s 条 / %s 字节 ⇒ 字节确实经过 mihomo\n' "$NA" "$BA"
  FAIL=1
else
  printf 'LEAK=NONE %s 字节直连发出去了，而账本里零记录 ⇒ 门禁字节不经代理（实测，非声明）\n' "$A_BYTES"
fi

if [ "$FAIL" = "1" ]; then echo "EGRESS=FAIL"; exit 1; fi
echo "EGRESS=OK"
