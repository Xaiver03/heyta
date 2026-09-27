#!/bin/bash
#
# 三端同步验收：Web ↔ 服务端 ↔ 笔记本（真浏览器 + 真服务端 + 真 SQLite，零 mock）
# ==============================================================================
#
# 🔴 为什么必须有这个脚本
#
# 到本轮之前，**没有任何一条验收覆盖"Web 与服务端之间的同步"**：
#
#   - 移动端脚本（`verify-mobile-*.sh`）证的是「手机 ↔ 服务端 ↔ 笔记本」；
#   - 浏览器套件（`e2e/tests/`）证的是「本地 op-log 落库」，
#     它**刻意离线**（只起假模型端点 + vite），压根不碰服务端。
#
# 于是"在 Web 上打的标签会同步到手机"这句话，既没人证过，也没人证伪过。
# 而 ADR-0016 记的那次事故说明："上传成功 + 下载整批作废"是一种真实存在、
# 界面上看着完全健康的状态 —— 只测一端等于没测。
#
# ═════════════════════════════════════════════════════════════════════════
# 三端，两相，两个方向
#
#   第 1 相（真浏览器）：Web 建 清单 + 标签 + 任务，挂好 → 上传
#   第 2 相（shell）：  笔记本（node-host，真 SQLite，**另一个 clientId**）同步
#                       → 必须读到上面那些；然后**反向**再建一条任务并上传
#   第 3 相（真浏览器，**全新 context = 空 IndexedDB**）：同步
#                       → 必须把上面**两台设备**的数据全部拉回来
#
# 🔴 第 3 相那个"全新 context"是关键：它不是"同一个页面再看一眼"，
# 而是**一台刚装好的新设备**。所以它拉回来的每一样东西都只能来自服务端。
#
# 🔴 判据不只看界面：每一步都同时问**服务端**（Postgres `operations` 表）
# 和**另一台设备**（node-host 的 `list`/`tags`/`projects`）。
# 界面说「已同步」在上传被拒收时**同样会出现** —— 这一条已经骗过两轮。
#
# 用法：
#   pnpm verify:multi-end
#
# 前置：服务端以 TEST_MODE 跑在 127.0.0.1:3000（`/api/test/create-user` 只在
#       TEST_MODE 下挂载，建号要用它）；Playwright 的 chromium 已安装。
#
# 环境变量：
#   HEYTA_MULTI_END_SERVER=http://127.0.0.1:3000   服务端地址（宿主机侧）
#     ⚠️ 刻意**不叫 `SERVER`** —— 共享库会预设那个名字，见下面的注释。
#   HEYTA_E2E_KEEP_ACCOUNT=1         复用现有账号（排查用；正常每轮换新号）

set -u
export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1

# 🔴 **顺序有讲究**：先建号，**再** source 共享库。
# `lib/mobile-e2e.sh` 在 source 的那一刻就把 `/tmp/heyta_mobile_{token,email,e2ee}.txt`
# 读进常量了 —— 先 source 再建号，拿到的仍是**上一个**号。
# 这个顺序在 `verify-mobile-conflict.sh` 里已经踩过一次，注释也在那儿。
. "$(dirname "$0")/lib/mobile-e2e-fresh-account.sh"
heyta_e2e_ensure_account || exit 1
. "$(dirname "$0")/lib/mobile-e2e.sh"

# 🔴 **不能用 `SERVER` 这个名字收参数。**
#
# 共享库（`lib/mobile-e2e.sh`）在 source 的那一刻就把 `SERVER` 设成了
# `http://10.0.2.2:3000` —— 那是**安卓模拟器内部**看宿主机的地址
# （模拟器里的 `127.0.0.1` 是模拟器自己）。我第一版写的是
# `SERVER="${SERVER:-http://127.0.0.1:3000}"`，于是调用方给的值被那个
# 已经存在的 `SERVER` 无声盖掉，浏览器拿着 `10.0.2.2` 去连
# —— 症状是"服务端没起来"，而服务端其实活得好好的。
#
# 本脚本里浏览器与 node-host **都跑在宿主机上**，所以用库里的 `HOST_SERVER`
# （= `127.0.0.1:3000`），并给一个**不会撞名**的覆盖入口。
SERVER="${HEYTA_MULTI_END_SERVER:-$HOST_SERVER}"

WEB_PORT=4328
HANDLE=/tmp/heyta-multi-end-handle.json
LAPTOP_DB=/tmp/heyta-multi-end-node.sqlite
NODE_TASK="node-b-$(date +%H%M%S)"
E2E_DIR="e2e"
PLAYWRIGHT_CONFIG="playwright.multi-end.config.ts"

echo ""
echo "=== 三端同步验收（真浏览器 + 真服务端 + 真 SQLite，零 mock）==="
echo "  服务端: $SERVER   库: heyta_mobile_smoke"
echo "  账号:   $EMAIL"
echo "  笔记本任务: $NODE_TASK"
echo "  浏览器端口: $WEB_PORT（离线套件用 4318，刻意错开）"

# 全新的笔记本库与 handle 文件：上一次跑到一半留下的数据会让断言含混。
rm -f "$LAPTOP_DB" "$HANDLE"

# ── 辅助 ────────────────────────────────────────────────────

# 跑一相浏览器验收。返回 playwright 的退出码。
#
# 🔴 **不用管道接 tail** —— `... | tail -3` 的 `$?` 是 tail 的（AGENTS.md 陷阱 45）。
# 输出重定向到文件，再单独读退出码。
run_web_phase() {  # <spec 文件> <日志路径>
  local spec="$1" log="$2"
  HEYTA_SYNC_SERVER="$SERVER" \
  HEYTA_SYNC_TOKEN="$TOKEN" \
  HEYTA_SYNC_PASSWORD="$E2EE" \
  HEYTA_MULTI_END_HANDLE="$HANDLE" \
  HEYTA_NODE_TASK="$NODE_TASK" \
    pnpm --dir "$E2E_DIR" exec playwright test "$spec" --config "$PLAYWRIGHT_CONFIG" \
    >"$log" 2>&1
  return $?
}

# 从 handle 文件里取一个字段。取不到就回显空串（调用方负责判空）。
handle_field() {  # <字段名>
  python3 -c "
import json,sys
try: d=json.load(open('$HANDLE'))
except Exception: print(''); raise SystemExit
print(d.get('$1',''))
" 2>/dev/null
}

# 该账号某类 op 的条数。
#
# 🔴 **不能按标题查 —— 服务端的 payload 是密文。**
#
# `operations.payload` 是 E2EE 之后的载荷（同表有 `is_payload_encrypted` 标记），
# 所以 `payload->>'title'` 永远是空的：**服务端在原理上就读不了内容**。
# 第一版这么写，于是第 2 步和第 4 步报"服务端没收到"，而同一轮的第 5 步
# 却从服务端把**笔记本建的那条任务**拉回来了 —— 两个判据互相矛盾。
# 矛盾的双方里，**探针是首要嫌疑**（而这次探针确实错了）。
#
# 尊重 E2EE 的服务端判据只有两类：
#   ① 某类 op 的**条数增量**（收到没收到）；
#   ② **distinct client_id 数**（是不是真的有两台设备在写）。
# "收到的是不是我想的那一条"只能由**另一台设备解密后读出来**回答 —— 那正是第 3 步。
account_ops() {  # <opType> <entityType>
  psql -h 127.0.0.1 -p 5432 -U rocalight -d heyta_mobile_smoke -tAc \
    "SELECT count(*) FROM operations o JOIN users u ON u.id=o.user_id
      WHERE u.email='$EMAIL' AND o.op_type='$1' AND o.entity_type='$2';" 2>/dev/null | tr -d ' '
}

# 该账号的 distinct client_id 数（= 有几台设备真的写过）。
account_clients() {
  psql -h 127.0.0.1 -p 5432 -U rocalight -d heyta_mobile_smoke -tAc \
    "SELECT count(DISTINCT o.client_id) FROM operations o JOIN users u ON u.id=o.user_id
      WHERE u.email='$EMAIL';" 2>/dev/null | tr -d ' '
}

# ── 第 0 步：前置条件 ────────────────────────────────────────

step "0. 前置条件（服务端活着 + 账号还没越过向量时钟上限）"
HEALTH=$(curl -s --noproxy '*' "$SERVER/health" 2>/dev/null)
if printf '%s' "$HEALTH" | grep -q '"status":"ok"'; then
  ok "服务端健康：$HEALTH"
else
  # 这不是产品失败，是环境失败 —— 说清楚，别让后面每一步都报假红。
  echo "   ❌ 服务端没起来或不是 TEST_MODE：$HEALTH"
  echo "      本脚本需要 $SERVER 的 /health 与 /api/test/create-user。"
  exit 3
fi

# 🔴 **前置条件断言：这个源真的被放行了吗。**
#
# 浏览器壳跑在 vite 的独立端口上，调 API 就是**跨域**。服务端默认只放行
# 上游那个域名（`DEFAULT_CORS_ORIGINS = ['https://app.super-productivity.com']`，
# 随 `super-sync-server` 一起继承来的）。预检不通过时：
#
#   - 浏览器**根本不会发出**那个 POST；
#   - 界面状态条变成「离线 · 改动已排队，联网后自动重试」；
#   - 服务端日志里一条请求都没有。
#
# 也就是"看起来像网络问题，其实请求没发出去"。而本脚本后面所有断言都会
# 因为这个前置条件不成立而集体变红 —— 那会把它伪装成产品缺陷。
# 所以在**第 0 步**先单独确认它，并直接说清怎么修。
CORS_ORIGIN="http://127.0.0.1:$WEB_PORT"
CORS_ACAO=$(curl -s -i --noproxy '*' -X OPTIONS "$SERVER/api/sync/push" \
  -H "Origin: $CORS_ORIGIN" \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type' 2>/dev/null \
  | tr -d '\r' | grep -i '^access-control-allow-origin:' | head -1)
if [ -n "$CORS_ACAO" ]; then
  ok "CORS 放行了 $CORS_ORIGIN（$CORS_ACAO）"
else
  echo "   ❌ 服务端没有放行 $CORS_ORIGIN —— 浏览器的同步请求会被**直接拦下**。"
  echo "      症状会诱导你往错的方向查：状态条显示「离线 · 改动已排队」，"
  echo "      服务端日志里却一条请求都没有（看起来像网络问题，其实请求没发出去）。"
  echo ""
  echo "      这是**环境/部署**问题，不是产品缺陷 —— 本轮结果无效。"
  echo "      修法（二选一）："
  echo "        · 用本仓库的验收栈起服务端（已默认带上这一项）："
  echo "            bash scripts/mobile-e2e-down.sh && bash scripts/mobile-e2e-up.sh"
  echo "        · 或给服务端加环境变量：CORS_ORIGINS=$CORS_ORIGIN"
  echo "        · 生产上的等价做法是**同源部署**（服务端自己托管 Web 产物）。"
  exit 3
fi

# 🔴 **前置条件断言**：账号的 client 数必须还在 `MAX_VECTOR_CLOCK_SIZE = 20` 之下。
# 越过之后向量时钟被裁剪 → 服务端拒绝该设备的**每一条**写入 →
# 后面所有"收敛/同步"断言都不再有意义。让它在这一步自己说出来。
heyta_e2e_assert_client_budget || bad "账号 client 数已逼近向量时钟上限（后续断言不可信）"

# 记下基线。后面的"服务端收到了"判据全是**增量**（见 `account_ops` 的注释：
# 服务端读不了内容，只能数条数）。用增量而不是"≥1"是因为本脚本允许
# `HEYTA_E2E_KEEP_ACCOUNT=1` 复用旧号 —— 那时"有 op"不代表**这一次**收到了。
TASK_BEFORE=$(account_ops CRT TASK)
TAG_BEFORE=$(account_ops CRT TAG)
CLIENTS_BEFORE=$(account_clients)
echo "      基线：TASK/CRT=$TASK_BEFORE  TAG/CRT=$TAG_BEFORE  client 数=$CLIENTS_BEFORE"

# ── 第 1 相：Web 建数据并上传 ────────────────────────────────

step "1. 第 1 端（真浏览器）：建清单/标签/任务并上传"
if run_web_phase "multi-end/01-web-up.spec.ts" /tmp/heyta-multi-end-web-up.log; then
  ok "浏览器第 1 相通过（界面上的动作全部做完并同步过）"
else
  bad "浏览器第 1 相失败 —— 完整日志：/tmp/heyta-multi-end-web-up.log"
  tail -30 /tmp/heyta-multi-end-web-up.log | sed 's/^/      /'
fi

TITLE=$(handle_field title)
LIST=$(handle_field list)
TAG=$(handle_field tag)
if [ -n "$TITLE" ] && [ -n "$LIST" ] && [ -n "$TAG" ]; then
  ok "拿到第 1 相创建的名字：任务「$TITLE」清单「$LIST」标签「$TAG」"
else
  # 名字拿不到，下面每一步都无从断言 —— 直接终止，别让后面的空串变成假绿。
  bad "拿不到第 1 相创建的名字（handle=$HANDLE）—— 后续断言无从进行"
  summary "三端同步验收"
fi

# ── 第 2 步：服务端真的收到了 ────────────────────────────────

step "2. 服务端确实收到了（这才是「上传成功」的证据）"
# 🔴 判据是**增量**，不是内容 —— 服务端读不了密文，见 `account_ops` 的注释。
TASK_AFTER=$(account_ops CRT TASK)
TAG_AFTER=$(account_ops CRT TAG)
if [ -n "$TASK_AFTER" ] && [ "$TASK_AFTER" -gt "$TASK_BEFORE" ]; then
  ok "服务端 TASK/CRT 从 $TASK_BEFORE 涨到 $TASK_AFTER —— 任务那条真的上传了"
else
  bad "服务端 TASK/CRT 没有增加（$TASK_BEFORE → $TASK_AFTER）—— 界面说同步完成，但服务端没收到"
fi
if [ -n "$TAG_AFTER" ] && [ "$TAG_AFTER" -gt "$TAG_BEFORE" ]; then
  ok "服务端 TAG/CRT 从 $TAG_BEFORE 涨到 $TAG_AFTER —— 标签那条真的上传了"
else
  bad "服务端 TAG/CRT 没有增加（$TAG_BEFORE → $TAG_AFTER）"
fi
# 🔴 **记下此刻的设备数** —— 下面第 4 步要拿它当基线。
#
# 第一版这里没记，第 4 步比的是"第 1 相之前"那个值（0）。于是判据是
# `2 > 0`：**只要最后有两台设备写过就通过**，而它想验的是"**笔记本是一台新的**"。
# 如果笔记本复用了 Web 的 clientId，distinct 会停在 1 —— 判据 `1 > 0` **照样绿**，
# 而"这是另一台设备"当场就不成立了。
# 基线取在"Web 刚上传完"这一刻，才真的能测出"有没有冒出一个新 client"。
CLIENTS_AFTER_WEB=$(account_clients)
if [ -n "$CLIENTS_AFTER_WEB" ] && [ "$CLIENTS_AFTER_WEB" -ge 1 ]; then
  ok "上传后服务端有 $CLIENTS_AFTER_WEB 个 client（作为第 4 步的基线）"
else
  bad "上传后服务端 client 数异常（'$CLIENTS_AFTER_WEB'）—— 第 4 步的基线不可信"
fi

# ── 第 3 步：第 2 端（笔记本）把 Web 写的东西拉下来 ──────────

step "3. 第 2 端（node-host，真 SQLite，另一个 clientId）同步并读回来"
LT_SYNC=$(laptop sync)
case "$LT_SYNC" in
  *'"ok":true'*) ok "笔记本 sync 成功" ;;
  # 按 ADR-0016：解不开的 op 不阻断同步，好 op 已逐条应用、游标也推进了。
  # 新号上不该出现，所以这里只算"通过但记账"。
  *undecryptable-ops*) ok "笔记本 sync 完成（含 undecryptable-ops，见 ADR-0016）" ;;
  *) bad "笔记本 sync 失败：$LT_SYNC" ;;
esac

LT_TAGS=$(laptop tags)
echo "      $LT_TAGS" | head -c 300; echo
LT_TAG_ID=$(printf '%s' "$LT_TAGS" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
print(next((t['id'] for t in d.get('tags',[]) if t['name']=='$TAG'),''))
")
if [ -n "$LT_TAG_ID" ]; then
  ok "笔记本读到了标签「$TAG」：$LT_TAG_ID"
else
  bad "笔记本没读到标签「$TAG」—— 标签实体没同步过去"
fi

LT_PROJECTS=$(laptop projects)
LT_LIST_ID=$(printf '%s' "$LT_PROJECTS" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
print(next((p['id'] for p in d.get('projects',[]) if p['name']=='$LIST'),''))
")
if [ -n "$LT_LIST_ID" ]; then
  ok "笔记本读到了清单「$LIST」：$LT_LIST_ID"
else
  bad "笔记本没读到清单「$LIST」—— 清单实体没同步过去"
fi

LT_LIST=$(laptop list --all)
LT_TASK=$(printf '%s' "$LT_LIST" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
t=next((t for t in d.get('tasks',[]) if t['title']=='$TITLE'),None)
print(json.dumps(t, ensure_ascii=False) if t else '')
")
if [ -n "$LT_TASK" ]; then
  ok "笔记本读到了任务「$TITLE」"
  # 归属 + 标签引用都要对上，而且必须是**刚建的那个 id**。
  if printf '%s' "$LT_TASK" | grep -q "$LT_LIST_ID" && [ -n "$LT_LIST_ID" ]; then
    ok "任务归属与清单 id 一致（$LT_LIST_ID）"
  else
    bad "任务的归属对不上：$LT_TASK"
  fi
  if [ -n "$LT_TAG_ID" ] && printf '%s' "$LT_TASK" | grep -q "$LT_TAG_ID"; then
    ok "任务上的 tagIds 与标签 id 一致（$LT_TAG_ID）—— 标签引用跨端到达"
  else
    bad "任务的 tagIds 里没有那个标签 id：$LT_TASK"
  fi
else
  bad "笔记本没读到任务「$TITLE」—— 任务没同步过去"
fi

# ── 第 4 步：反向 —— 笔记本写一条并上传 ─────────────────────

step "4. 第 2 端反向写入并上传（为「Web 能拉到别的设备」准备数据）"
LT_ADD=$(laptop add "$NODE_TASK")
if printf '%s' "$LT_ADD" | grep -q '"ok":true'; then
  ok "笔记本建了任务「$NODE_TASK」"
else
  bad "笔记本建任务失败：$LT_ADD"
fi
LT_UP=$(laptop sync)
case "$LT_UP" in
  *'"ok":true'*) ok "笔记本这次 sync 成功" ;;
  *undecryptable-ops*) ok "笔记本 sync 完成（含 undecryptable-ops）" ;;
  *) bad "笔记本 sync 失败：$LT_UP" ;;
esac
TASK_AFTER2=$(account_ops CRT TASK)
if [ -n "$TASK_AFTER2" ] && [ "$TASK_AFTER2" -gt "$TASK_AFTER" ]; then
  ok "服务端 TASK/CRT 从 $TASK_AFTER 涨到 $TASK_AFTER2 —— 笔记本那条真的上传了"
else
  bad "服务端 TASK/CRT 没有增加（$TASK_AFTER → $TASK_AFTER2）—— 反向上传没成"
fi
# 🔴 而且必须是**另一台设备**写的：distinct client_id 要涨。
# 只数 op 条数的话，"同一条被重复上传"也会让条数变大。
CLIENTS_AFTER=$(account_clients)
if [ -n "$CLIENTS_AFTER" ] && [ "$CLIENTS_AFTER" -ge $((CLIENTS_AFTER_WEB + 1)) ]; then
  ok "服务的 client 数从 $CLIENTS_AFTER_WEB 涨到 $CLIENTS_AFTER —— 确实多出一台**新**设备（笔记本）"
else
  bad "client 数没有多出新的（$CLIENTS_AFTER_WEB → $CLIENTS_AFTER）—— 无法证明那条是**另一台设备**写的"
fi

# ── 第 5 步：第 3 相 —— 全新 Web 安装把两边的数据都拉回来 ────

step "5. 第 3 端（全新浏览器上下文 = 空 IndexedDB）同步，拉回两台设备的数据"
# 🔴 Playwright 每个用例一个全新 context → 空 IndexedDB。
# 所以这一刻的 Web 是"刚装好的新设备"，它本地什么都没有。
if run_web_phase "multi-end/02-web-down.spec.ts" /tmp/heyta-multi-end-web-down.log; then
  ok "浏览器第 3 相通过：清单/标签/任务（含笔记本建的那条）全部从服务端拉回"
else
  bad "浏览器第 3 相失败 —— 完整日志：/tmp/heyta-multi-end-web-down.log"
  tail -30 /tmp/heyta-multi-end-web-down.log | sed 's/^/      /'
fi

# ── 第 6 步：服务端汇总 ──────────────────────────────────────

step "6. 服务端汇总"
psql -h 127.0.0.1 -p 5432 -U rocalight -d heyta_mobile_smoke -tAc \
  "SELECT count(DISTINCT client_id) FROM operations o JOIN users u ON u.id=o.user_id
    WHERE u.email='$EMAIL';" 2>/dev/null \
  | sed 's|^|      该账号的 client 数 = |'
psql -h 127.0.0.1 -p 5432 -U rocalight -d heyta_mobile_smoke -tAc \
  "SELECT count(*) FROM operations o JOIN users u ON u.id=o.user_id
    WHERE u.email='$EMAIL';" 2>/dev/null \
  | sed 's|^|      该账号的 op 总数 = |'

summary "三端同步（Web↔服务端↔笔记本）" "三端全链路通过"