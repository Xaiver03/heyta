#!/usr/bin/env bash
# 出口探针：用 mihomo **自己的账本**证明"这一趟门禁的字节没有经过代理"
# ======================================================================
#
# ⚠️ 这一枚探针被重写过一次，原因值得留着（它正是"先怀疑探针"那条元规则的实例）：
#
#   第一版判的是"容器里连不上 github.com ⇒ 那条路是关的"。实测**否证**了它的前提：
#   这台机器现在直连 `https://github.com/` 是 **200 / 0.09 s**（宿主 5/5 次、容器 1/1 次，
#   2026-10-06 复测）。ci-and-runner.md §4.3 记的"直连超时"是 2026-09-26 的读数，
#   现在只对**批量传输**成立（`codeload` 实测 109 KB/s 且 20 s 超时）。
#   ⇒ 那版探针会得到一条**永远红**的判据，而且红的原因与"有没有走代理"毫无关系。
#
# 所以这一版判的是**路由**，载体是 mihomo 的 `/connections`（它给每条连接记字节，
# 也记目标域名 —— 这就是唯一能"归因到 heyta"的那件仪器）：
#
#   A) 容器内**不挂代理**打一次 GitHub 上只有本项目会打的 URL（本仓库的 pnpm-lock.yaml，
#      限速拖到十几秒，好让采样来得及看见它）；
#   B) 同样那一次**显式挂上 mihomo** —— 这是阳性对照。
#
#   A 在 mihomo 的账本里出现 ⇒ 字节确实走了代理 ⇒ 🔴 FAIL。
#   B 在账本里**不**出现     ⇒ 仪器是瞎的，A 的"没出现"什么都证明不了 ⇒ 🟠 INCONCLUSIVE。
#   A 没有、B 有            ⇒ ✅ 这一条"零代理字节"是被测出来的，不是被声明出来的。
#
# 代价：B 那一次会真的走代理（约 250 KB，限速后仍是那一档）。它买的是"其余 100% 可信"。
# 需要 `--limit-rate` 而不是"读多大算多大"：连接活得太短，`/connections` 就看不见它 ——
# 那不是"没走代理"，那是**探针够不着**（§7 元规则 1）。
#
# 用法（由 gate-ssh.mjs 在 finlaw 上执行，需要能读 mihomo 控制器）：
#   bash scripts/ci/egress-probe.sh <载体镜像> [代理 URL] [mihomo 控制器]
# 退出码：0=成立 / 1=有代理残留或国内源不通 / 2=阳性对照不成立（结论无效）/ 3=仪器读不到
set -uo pipefail

IMAGE="${1:-heyta-gate:local}"
PROXY="${2:-http://172.17.0.1:7890}"
CTRL="${3:-http://172.17.0.1:9090}"
# 只有本项目的 CI 会打的 URL：仓库自己的 lockfile。别的进程在这个窗口里打它的概率≈0。
MARKER="https://raw.githubusercontent.com/Xaiver03/heyta/HEAD/pnpm-lock.yaml"

snap() { curl -sS --max-time 5 "$CTRL/connections" 2>/dev/null || true; }
# 统计某个时间窗内 mihomo 账本里命中 MARKER 主机的连接字节。
# ⚠️ 控制器地址走参数传进去，不在 python 里再写一遍字面量 —— 同一件事写两处就是抄件，
#    而抄件的漂移方式恰好是"改了上面那行、python 还在读旧端口"，症状是永远 BLIND。
marker_bytes() { # $1 = 窗口起点(epoch sec)
  python3 - "$1" "$MARKER" "$CTRL" <<'PY'
import json, sys, subprocess, time
since = float(sys.argv[1])
host = sys.argv[2].split('/')[2]
ctrl = sys.argv[3]
try:
    raw = subprocess.run(["curl", "-sS", "--max-time", "5", ctrl + "/connections"],
                         capture_output=True, text=True, timeout=15).stdout
    d = json.loads(raw or "{}")
except Exception as e:
    print("ERR", e); raise SystemExit
n = b = 0
for c in (d.get("connections") or []):
    m = c.get("metadata") or {}
    if (m.get("host") or "").endswith(host):
        st = (m.get("start") or "").[:19]
        try:
            t = time.mktime(time.strptime(st, "%Y-%m-%dT%H:%M:%S"))
        except Exception:
            t = since + 1
        if t >= since - 2:
            n += 1; b += c.get("download", 0) + c.get("upload", 0)
print(n, b)
PY
}

FAIL=0; INCONCLUSIVE=0

# ── 0) 容器里不许有**非空**的代理变量 ───────────────────────────────────────────
# ⚠️ 判的是"值非空"，不是"变量存在"：`-e http_proxy=` 会让 Docker 把一个**空值**变量
#    放进容器（这是这条路刻意做的动作 —— 空值等于"不用代理"，比"变量不存在"更明确，
#    因为它盖掉了镜像层可能带进来的值）。第一版按"存在"判，于是**自己的加固动作被读成违规**，
#    当场报红：PROXY_ENV=FAIL https_proxy= HTTP_PROXY= …（六个全空值）。
RESID=$(docker run --rm --entrypoint sh "$IMAGE" -c \
  'env | grep -iE "^(http|https|all)_proxy=" | grep -vE "^(http|https|all)_proxy(_)?=$" || true')
if [ -n "$RESID" ]; then
  printf 'PROXY_ENV=FAIL %s\n' "$(printf '%s' "$RESID" | tr '\n' ' ')"
  FAIL=1
else
  printf 'PROXY_ENV=OK (六个 proxy 变量要么不存在、要么显式空值)\n'
fi

# ── 1) 容器内不许带 git 的 proxy 配置 ──────────────────────────────────────────
#    宿主 ubuntu 用户 `git config --global http.proxy` = mihomo（实测）。它不在任何
#    环境变量里，清 shell 变量拦不住它 —— 一次 `git ls-remote https://github.com`
#    在"看起来没代理"的 shell 里照样成功。
GP=$(docker run --rm --entrypoint sh "$IMAGE" -c 'git config --get http.proxy 2>/dev/null || true')
if [ -n "$GP" ]; then
  printf 'GIT_PROXY=FAIL http.proxy=%s\n' "$GP"; FAIL=1
else
  printf 'GIT_PROXY=OK (容器里没有 http.proxy)\n'
fi

# ── 2) 门禁需要的源必须直连通 ──────────────────────────────────────────────────
for u in https://registry.npmmirror.com/ https://registry.npmjs.org/; do
  c=$(docker run --rm --entrypoint sh "$IMAGE" -c "curl -sS -o /dev/null -m 10 -w '%{http_code}' '$u'" 2>/dev/null || true)
  if [ "$c" = "200" ]; then printf 'SOURCE %s=OK\n' "$u"
  else printf 'SOURCE %s=FAIL http=%s\n' "$u" "${c:-000}"; FAIL=1; fi
done

# ── 3) A：不挂代理打 MARKER（限速把连接拖住，让账本来得及看见）─────────────────
# ⚠️ 为什么要 `--limit-rate 20k -m 14` 而不是"下完算完"：`/connections` 只列**活跃**连接，
#    一次 361 KB 的快请求在两次采样之间就结束了 —— 那时"账本里没有"是**探针够不着**，
#    不是"没走代理"。把连接拖到 14 秒，采样窗口才覆盖得到它。
#    代价：B 那一次约 280 KB 走代理。整套方案里只有这一处花额度，而它买的是
#    "其余每一个字节都没花额度"这句话可以被复现。
T0=$(date +%s)
S_A=$(docker run --rm --entrypoint sh "$IMAGE" -c \
  "curl -sS --limit-rate 20k -m 14 -o /dev/null -w '%{size_download} %{http_code}' '$MARKER' 2>/dev/null || echo '0 timeout'")
sleep 2
RB_A=$(marker_bytes "$T0")
printf 'A_NO_PROXY bytes/code=%s   mihomo_matched=%s\n' "$S_A" "$RB_A"

# ── 4) B：显式挂代理打同一个 MARKER（阳性对照）─────────────────────────────────
T1=$(date +%s)
S_B=$(docker run --rm --entrypoint sh "$IMAGE" -c \
  "curl -sS -x '$PROXY' --limit-rate 20k -m 14 -o /dev/null -w '%{size_download} %{http_code}' '$MARKER' 2>/dev/null || echo '0 timeout'")
sleep 2
RB_B=$(marker_bytes "$T1")
printf 'B_VIA_PROXY bytes/code=%s   mihomo_matched=%s\n' "$S_B" "$RB_B"

# ⚠️ 这里**不能**用 `set -- $RB_A`：那会把位置参数（$1 $2 $3 = 镜像/代理/控制器）踩掉，
#    后面的每一处引用都读到解析出来的数字。用 read。
read -r NA BA <<< "$RB_A"
read -r NB BB <<< "$RB_B"
if [ "$NA" = "ERR" ] || [ "$NB" = "ERR" ]; then
  printf 'CONTROL=ERR 读不到 mihomo 控制器（%s）⇒ 这台机器上的代理出口没法计量\n' "$CTRL"
  echo 'EGRESS=INCONCLUSIVE'; exit 3
fi
if [ "${NB:-0}" -eq 0 ]; then
  # 阳性对照没出现 ⇒ 账本看不见这类连接（端口/规则/采集窗口的问题），A 的"没出现"就不是证据。
  printf 'CONTROL=BLIND 挂上代理的那一次在账本里也没有记录 ⇒ 仪器够不着，A 项无意义\n'
  echo 'EGRESS=INCONCLUSIVE'; exit 2
fi
printf 'CONTROL=OK 挂代理那一次账本记到 %s 条 / %s 字节 ⇒ 仪器看得见这类连接\n' "$NB" "$BB"
if [ "${NA:-0}" -gt 0 ]; then
  printf 'LEAK=FOUND 不挂代理那一次**也**被记到 %s 条 / %s 字节 ⇒ 字节确实经过 mihomo\n' "$NA" "$BB"
  FAIL=1
else
  printf 'LEAK=NONE 不挂代理那一次账本零记录 ⇒ 这一趟的门禁字节不经代理（实测，非声明）\n'
fi

if [ "$FAIL" = "1" ]; then echo "EGRESS=FAIL"; exit 1; fi
echo "EGRESS=OK"
