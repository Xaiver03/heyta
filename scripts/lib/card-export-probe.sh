#!/bin/bash
#
# W7 成品图设备验收的**共享取值层** —— 两端探针（Android / iOS）都用它。
#
# 🔴 为什么单独一个文件：这四个助手原来只住在 `verify-mobile-card-export.sh` 里。
#    iOS 那一半（`verify-mobile-card-export-ios.sh`）要取的是**同一批词条与同一对契约常量**，
#    抄一份就是第二份会漂的抄件（AGENTS §3.5 那条"抽出来之后没删旧的那份"教训的正面做法：
#    抽单一所有者 + 两边都改成 source）。
#
# 🔴 为什么"取值"要走读数器而不是写字面量：那会变成 i18n 的**抄件** —— 改了词条的一侧
#    不会让这里变红，而这两条验收的意义恰好是"界面上那句话被点到了"。
#    读数器取不到就非零退出，调用方把它当**环境不成立**（exit 3）而不是"界面上没有"。
#
# 前置：先 source `lib/mobile-e2e.sh`（它定 `HEYTA_REPO_ROOT`）。
#

READER="$HEYTA_REPO_ROOT/scripts/verify-mobile-card-export-read.mjs"
[ -f "$READER" ] || { echo "❌ 读数器不在 $READER —— 探针没有输入（本轮无效）" >&2; exit 3; }

zh() {  # <i18n key>
  local out
  out=$(node "$READER" zh "$1" 2>/dev/null) || {
    echo "   ❌ 词条取不到：$1 —— **探针坏了，不是产品坏了**（本轮无效）" >&2; exit 3; }
  printf '%s' "$out"
}

contract() {  # <导出名>
  local out
  out=$(node "$READER" contract "$1" 2>/dev/null) || {
    echo "   ❌ 契约常量取不到：$1（dist 过期或没 build？本轮无效）" >&2; exit 3; }
  printf '%s' "$out"
}

read_png() {  # <png 路径>
  node "$READER" png "$1" 2>&1 || printf 'READER_ERROR'
}

field() {  # "<读数串>" <字段名>
  printf '%s' "$1" | tr ' ' '\n' | sed -n "s/^$2=//p" | head -1
}

# 判据①的两条腿（**两端共用同一段**）：读数器必须"读得对"而且"会区分"。
# 不做这一步，后面"设备出图 = 契约"可能是一条恒真断言（§7 元规则二）。
probe_reader_selfcheck() {  # <EXP_W> <EXP_H>
  local w="$1" h="$2" pos neg pr
  pos="$HEYTA_REPO_ROOT/apps/web/evidence/countdown-export/card-light.png"
  neg="$HEYTA_REPO_ROOT/apps/web/evidence/countdown-export/probe-3x2.png"
  [ -f "$pos" ] && [ -f "$neg" ] || { echo "   ❌ 自检缺图 ⇒ 判据①无效（本轮不成立）"; exit 3; }
  pr=$(read_png "$pos"); echo "   正向 $pr"
  nr=$(read_png "$neg"); echo "   反向 $nr"
  if [ "$(field "$pr" W)" = "$w" ] && [ "$(field "$pr" H)" = "$h" ]; then
    ok "正向对照：web 那张成品图读回 ${w}×${h}，与契约逐字相同"
  else
    echo "   ❌ 自检就把读数器照出来了：契约 ${w}×${h}，web 成品图读回 $(field "$pr" W)×$(field "$pr" H)"
    echo "      ⇒ 后面的 IHDR 判据一律不可信（探针坏了 ≠ 产品坏了）"; exit 3
  fi
  if [ "$(field "$nr" W)" != "$w" ] && [ -n "$(field "$nr" W)" ] && [ "$(field "$nr" W)" != "0" ]; then
    ok "反向对照：同一台读数器对另一张图读出 $(field "$nr" W)×$(field "$nr" H) ⇒ 它**会区分**，不是恒返回契约值"
  else
    bad "反向对照不成立：第二张图读出「$(field "$nr" W)」，与契约同值或读不到 ⇒ IHDR 那条判据可能没牙"
  fi
}
