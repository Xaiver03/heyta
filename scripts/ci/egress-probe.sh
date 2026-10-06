#!/usr/bin/env bash
# 出口探针：证明"这一趟门禁一个字节都没走代理"，而且**这条判据会失败**
# ==========================================================================
#
# 为什么需要一枚探针而不是"我把 proxy 变量清了所以肯定没走"
# ---------------------------------------------------------
# "清了变量"是一句**没有反证**的自我声明。这台机器上有三条会绕过它的路：
#
#   1. dockerd 自己的 proxy（`/etc/docker/daemon.json` 里配的 mihomo，实测存在）——
#      它不影响容器里 curl 的路由，但**任何 `docker pull` 都走它**。
#   2. git 的全局配置：finlaw 上 ubuntu 用户 `git config --global http.proxy` = mihomo
#      （实测）。⇒ 即使 shell 里没有 `http_proxy`，一次 `git ls-remote https://github.com`
#      **照样会成功**并且走代理。这一条是我自己差点用来证明"直连 GitHub 是通的"的东西
#      —— 差点把"代理还在跑"读成"网络变好了"。
#   3. 工具各自读的配置（npmrc / corepack / .curlrc）。
#
# 所以探针判的是**可达性**，不是变量：真去连一次 GitHub，连不上才算"这条路是关的"。
#
# 🔴 阳性对照（第 4 项）是这条判据的**承重件**：
#    "curl github 失败"有两种成因 —— "路由被我关了"与"根本没人能连上 github"。
#    只有前者才是我想要的。所以再显式挂代理连一次，**必须成功**。
#    对照失败 ⇒ 整枚探针判 INCONCLUSIVE 并退出非零，**不许**把"连不上"回填成"没走代理"。
#    代价：这一条对照会真的走代理，约 1 KB。它是整套装置里唯一花额度的动作，
#    而它买的是"其余 100% 的字节确实没走"这句话的可信度。
#
# 用法（由 gate-ssh.mjs 在容器内执行）：
#   bash scripts/ci/egress-probe.sh [代理 URL，默认 http://172.17.0.1:7890]
# 退出码：0 = 出口形状成立；1 = 有代理残留或国内源不通；2 = 阳性对照不成立（结论无效）
set -uo pipefail

PROXY="${1:-http://172.17.0.1:7890}"
NP(){ env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY curl -sS --max-time 8 -o /dev/null -w '%{http_code}' "$@" 2>/dev/null; }
FAIL=0
INCONCLUSIVE=0

# 1) 容器内不许有代理环境变量（大小写两套都要查：curl 读小写，很多工具读大写）
LEFT=$(env | grep -iE '^[a-z_]*proxy=' | grep -viE '^(GOPROXY|NO_PROXY|no_proxy)=' || true)
if [ -n "$LEFT" ]; then
  printf 'PROXY_ENV=FAIL %s\n' "$(printf '%s' "$LEFT" | tr '\n' ' ')"
  FAIL=1
else
  printf 'PROXY_ENV=OK (无 http(s)_proxy / all_proxy)\n'
fi

# 2) git 不许带着 proxy 配置进来（宿主那条全局配置会随 HOME 漂进容器）
if GITPROXY=$(git config --get http.proxy 2>/dev/null) && [ -n "$GITPROXY" ]; then
  printf 'GIT_PROXY=FAIL http.proxy=%s ⇒ 这一趟任何 git-over-HTTPS 都会走代理\n' "$GITPROXY"
  FAIL=1
else
  printf 'GIT_PROXY=OK (无 http.proxy)\n'
fi

# 3) GitHub 必须连不上（这才是"这条路真的关着"的读数）
G_NOPROXY=$(NP https://github.com/ || true)
if [ "$G_NOPROXY" = "000" ] || [ -z "$G_NOPROXY" ]; then
  printf 'GITHUB_DIRECT=OK (http=%s，连不上 ⇒ 批量传输不可能悄悄走代理)\n' "${G_NOPROXY:-000}"
else
  printf 'GITHUB_DIRECT=FAIL http=%s ⇒ 这台机器直连 GitHub 是通的，探针无法区分"没走代理"与"走了代理"\n' "$G_NOPROXY"
  FAIL=1
fi

# 4) 🔴 阳性对照：挂上代理必须连得上。失败 ⇒ 第 3 项读数无意义，整枚探针作废。
G_PROXY=$(curl -sS --max-time 12 -o /dev/null -w '%{http_code}' -x "$PROXY" https://github.com/ 2>/dev/null || true)
if [ "$G_PROXY" = "200" ] || [ "$G_PROXY" = "301" ] || [ "$G_PROXY" = "302" ]; then
  printf 'CONTROL_VIA_PROXY=OK http=%s ⇒ 第 3 项的"连不上"是路由选择，不是网络故障\n' "$G_PROXY"
else
  printf 'CONTROL_VIA_PROXY=INCONCLUSIVE http=%s（代理不可用/没开）\n' "${G_PROXY:-000}"
  printf '  ⇒ 本轮**不能**声称"零代理字节"，只能声称"没连上 GitHub"。这是两件不同的事。\n'
  INCONCLUSIVE=1
fi

# 5) 门禁需要的国内源必须直连通（不通就不是"没走代理"，而是"跑不起来"）
for u in https://registry.npmmirror.com/ https://registry.npmjs.org/; do
  c=$(NP "$u")
  if [ "$c" = "200" ]; then printf 'SOURCE %s=OK\n' "$u"; else printf 'SOURCE %s=FAIL http=%s\n' "$u" "${c:-000}"; FAIL=1; fi
done

if [ "$INCONCLUSIVE" = "1" ]; then echo "EGRESS=INCONCLUSIVE"; exit 2; fi
if [ "$FAIL" = "1" ]; then echo "EGRESS=FAIL"; exit 1; fi
echo "EGRESS=OK"
