#!/usr/bin/env bash
# 给 C 那一趟真机跑**补上第 4 层的判据形态**（只读，不碰设备）。
#
# 为什么需要这一步：开窗后那一趟用的是**载体里已提交**的 `verify-mobile-due-time.sh`，
# 而我这条判据（第 4 层"服务端读得到 ops/devices 计数"）还留在主检出的未提交改动里 ——
# 所以那一趟的第 4 层只是**一行打印，不是判据**（交接 §5 第 4 条 02:4x 记的就是这件事）。
# 等 A 落笔之前，这条脚本用**同一份逻辑、同一组 env 旋钮**把那个读数按判据的形态取一次：
# 读得到 ⇒ exit 0；读不到 ⇒ exit 1 并带出服务端原文。
#
# 🔴 它只跑一条 `SELECT count(*)`，不写任何东西；断言也只有"读得到"，**不断条数**
#    （这枚库是多条会话共用的，把具体数字写进判据就是把别人的现场当自己的前提）。
#
# 用法：
#   bash research/tools/r14c-server-readability-judgment.sh
#   RUN='第 72 趟 03:5x' bash research/tools/r14c-server-readability-judgment.sh
#   HEYTA_E2E_DB=一个不存在的库 bash research/tools/r14c-server-readability-judgment.sh   # 自检：必须 exit 1
#
# 退出码：0 = 读到了（判据成立）  1 = 读不到（判据红，带服务端原文）
#         2 = 输入不成立（psql 不在 PATH 等，不冒充判据红）
set -u

PG_DB="${HEYTA_E2E_DB:-heyta_mobile_smoke}"
PG_USER="${HEYTA_E2E_DB_USER:-$(whoami)}"
PG_HOST="${HEYTA_E2E_DB_HOST:-127.0.0.1}"
PG_PORT="${HEYTA_E2E_DB_PORT:-5432}"
RUN="${RUN:-未标注哪一趟}"

if ! command -v psql >/dev/null 2>&1; then
  echo "❌ 输入不成立：psql 不在 PATH ⇒ 这不叫判据红（exit 2）。" >&2
  exit 2
fi

OUT=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT (SELECT count(*) FROM operations) AS ops, (SELECT count(*) FROM sync_devices) AS devices" 2>&1)
RC=$?

if printf '%s' "$OUT" | grep -qE '^[0-9]+\|[0-9]+$'; then
  echo "✅ 第 4 层判据成立：服务端现场 ops|devices = ${OUT}（库 ${PG_DB} @ ${PG_HOST}:${PG_PORT}，用户 ${PG_USER}）"
  echo "   标注：${RUN}；rc=${RC}；这条读数补的是那一趟里「打印不是判据」那一格。"
  exit 0
fi

echo "❌ 第 4 层判据红：读不到服务端的 ops/devices 计数（库 ${PG_DB} @ ${PG_HOST}:${PG_PORT}，用户 ${PG_USER}）"
echo "   服务端原文：${OUT}"
echo "   标注：${RUN}；psql rc=${RC}"
exit 1
