#!/usr/bin/env bash
# 边界 F 的第二条：移动壳里 `web.*` 词条键的**现量清点**（只读，不改任何文件）。
#
# 为什么要落成脚本而不是写在台账里：台账里那句"188 处"是一条**断言**，
# 而它此前四次复跑全靠把一长串 `grep` 塞进 `$( )` 现拼 —— 03:0x 那趟就是这么把探针弄坏的
# （为了嵌引号写的 `\"` 让 pattern 真带上了引号字符 ⇒ 处数与阳性对照**同时为 0**，
# 看着像"代码干净"，其实是探针没跑对）。脚本文件里没有那一层引号嵌套，就少一种坏法。
#
# 读数形状（每趟都打这四列 + 一条阳性对照）：
#   处 = 出现次数；文件 = 命中的文件数；行 = 含命中的行数；去重键 = 不同的键字符串数。
#   处 ≥ 行 ≥ 文件 是恒成立的包含关系；反过来若"处 < 行"就是探针坏了。
#
# 退出码：
#   0 读数成立（含"已清零"那种 0 —— 它必须与下面两种 0 区分开，所以只有这一种打 `结论：`）
#   4 探针不可信（阳性对照为 0，或包含关系反了）⇒ 这不是"边界做完了"，别读成好消息
#   1 目录不存在 / 参数错
set -uo pipefail

SRC_DIR="${SRC_DIR:-apps/mobile/src}"
CONTROL_DIR="${CONTROL_DIR:-$SRC_DIR}"

if [ "${1:-}" = "--selftest" ]; then
  st=$(mktemp -d /tmp/ht-f-st.XXXXXXXX) || exit 1
  mkdir -p "$st/src"
  printf "%s\n" "t('web.a')" "t('web.b')" "t('web.a')" "t('common.z')" > "$st/src/x.ts"
  bad=0
  out=$(SRC_DIR="$st/src" bash "$0" 2>&1); rc=$?
  printf '%s\n' "$out" | grep -q '处=3 行=3 文件=1 去重键=2' || { echo "❌ 夹具计数不对：$out"; bad=$((bad + 1)); }
  [ "$rc" = 0 ] || { echo "❌ 夹具应退 0，实际 $rc"; bad=$((bad + 1)); }
  # 负向腿：夹具里**不放** common.* ⇒ 阳性对照为 0 ⇒ 必须退 4（这一条是整把装置的牙）
  rm "$st/src/x.ts"; printf "%s\n" "t('web.a')" > "$st/src/y.ts"
  out2=$(SRC_DIR="$st/src" bash "$0" 2>&1); rc2=$?
  [ "$rc2" = 4 ] || { echo "❌ 阳性对照为 0 时竟退 ${rc2}（探针瞎了不会被发现）：$out2"; bad=$((bad + 1)); }
  # 负向腿二：目录不存在 ⇒ 1，不是 0
  out3=$(SRC_DIR="$st/nope" bash "$0" 2>&1); rc3=$?
  [ "$rc3" = 1 ] || { echo "❌ 目录不存在时应退 1，实际 $rc3"; bad=$((bad + 1)); }
  rm -rf "$st"
  if [ "$bad" = 0 ]; then echo "✅ selftest 三臂成立（夹具四列对得上 / 对照为 0 必报瞎 / 目录缺失必报参数错）"; exit 0; fi
  echo "selftest 有 $bad 条不成立 ⇒ 装置坏，不是边界坏"; exit 4
fi

if [ ! -d "$SRC_DIR" ]; then
  echo "❌ 目录不存在：${SRC_DIR}（在仓库根跑，或显式传 SRC_DIR=…）"; exit 1
fi

PAT="web\.[a-zA-Z0-9._-]*"
CPAT="common\.[a-zA-Z0-9._-]*"

OCC=$(grep -rho -- "'$PAT" "$SRC_DIR" 2>/dev/null | wc -l | tr -d ' ')
LINES=$(grep -rn -- "'$PAT" "$SRC_DIR" 2>/dev/null | wc -l | tr -d ' ')
FILES=$(grep -rl -- "'$PAT" "$SRC_DIR" 2>/dev/null | wc -l | tr -d ' ')
KEYS=$(grep -rho -- "'$PAT" "$SRC_DIR" 2>/dev/null | sort -u | wc -l | tr -d ' ')
CTRL=$(grep -rho -- "'$CPAT" "$CONTROL_DIR" 2>/dev/null | wc -l | tr -d ' ')

echo "扫描根=${SRC_DIR}（只读，未改任何文件）"
echo "处=${OCC} 行=${LINES} 文件=${FILES} 去重键=${KEYS} 阳性对照 common=${CTRL}"

if [ "$CTRL" = 0 ]; then
  echo "🔴 阳性对照为 0 ⇒ 这一趟的 grep **根本没在跑对的形状**（上面四个数全部作废）。"
  echo "   不要读成'改名做完了'。先修探针：同形状应能数出 common.* 若干处。"
  exit 4
fi
if [ "$OCC" -lt "$LINES" ] || [ "$LINES" -lt "$FILES" ]; then
  echo "🔴 包含关系反了（应满足 处 ≥ 行 ≥ 文件）⇒ 计数层坏了，读数作废。"
  exit 4
fi
if [ "$OCC" = 0 ]; then
  echo "结论：这条边界已清零（同趟对照=${CTRL} ⇒ 扫描器是活的）。F 的这笔改名可以摘掉。"
  exit 0
fi
echo "结论：边界仍在 ⇒ 下一批那笔纯改名要做的是把移动壳读的这些键搬到它自己的命名空间，"
echo "        并按 AGENTS §3·i18n 那条中英同步后 rebuild。改前要先给 check:l4 挣出余量（台账 §6 那条）。"
