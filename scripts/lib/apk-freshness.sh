#!/bin/bash
# ============================================================================
# APK 新鲜度的**唯一**算法（单一所有者）。
#
# 为什么要有这个文件
# ------------------
# `§7 第 27 条`（"packages/ 改了、APK 里是旧 JS bundle，验收对旧代码报绿"）此前只有
# **一道**地方在判它：`verify-mobile-window-gate.sh` 的第 4 步。也就是说 ——
# 一个人**忘了跑闸门**、直接 `pnpm verify:mobile-trash`，脚本照样装包、照样跑完、
# 照样 32/32 全绿，而它验的是旧产物。那条防线当时只存在于"人记得先量一次"。
#
# 所以这里把判据本身搬进被约束的那一步：**装包之前当场判**，不依赖跑之前有没有人替它量。
# 同一个算法两处消费（闸门 + 真机验收脚本），因为"同一个判断写两遍"就是漂移的起点
# （AGENTS §3.2 那条门禁事故的形状）。
#
# 🔴 两个必须显式传的东西
#
# 1. **根**：算"最新源码"要在一棵树里扫。默认取仓库根，但留 `root` 实参给夹具用 ——
#    没有它就没法在不动真实工作树的前提下证这条判据能失败。
# 2. **APK 路径**：由调用方给（`lib/mobile-e2e.sh` 那份 $APK 是同一枚），
#    不在这个文件里再推导一次，否则又是第二套 $APK 定义。
#
# ⚠️ 取不到 mtime 一律**判红**，不按"新鲜"处理：空读数在这里和"确实没有比它更新的源码"
#    长得一模一样，而后者会直接放装包过去 —— 那是假绿的方向。
# ============================================================================

# 🔴 自锚：这个 lib 必须能在**没有被 `lib/mobile-e2e.sh` source** 的时候自己算出仓库根
#    （自检就是直接执行进来的）。留 env 覆盖口给跨树夹具。
HEYTA_REPO_ROOT="${HEYTA_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# 进入 APK 的源码面（Metro 打包真正会收进去的那些目录）。
# ⚠️ 这份清单与 `verify-mobile-window-gate.sh` 当年内联的那一份**逐字相同** ——
#    搬进单一所有者时**刻意没有扩大**：扩大会让闸门的 `REDS=` 读数变向，
#    而那一句是另一条线几把夹具的输入。清单本身偏窄这件事已登记在计划里，
#    要改得由闸门的所有者一起过它的夹具。
HEYTA_APK_SOURCE_DIRS="apps/mobile/src packages/ui/src packages/i18n/src packages/domain/src"

_mtime() { # <file> -> 回显 mtime（整数）；失败回显空
  local v
  v=$(stat -f %m "$1" 2>/dev/null) || v=""
  [ -n "$v" ] || v=$(stat -c %Y "$1" 2>/dev/null) || v=""
  printf '%s' "$v"
}

# <apk> <root?> -> 回显 "<apk_mtime> <source_mtime>"，取不到的一侧是空串。
# 第二行回显到 stderr 的是**用的哪一棵根**，为了跨树比较时读数里带得出来。
heyta_apk_pair() {
  local apk="$1" root="${2:-$HEYTA_REPO_ROOT}"
  local am sm
  [ -f "$apk" ] && am=$(_mtime "$apk") || am=""
  sm=$(cd "$root" 2>/dev/null && find $HEYTA_APK_SOURCE_DIRS \
    -type f \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' \
    -exec stat -f %m {} + 2>/dev/null | sort -rn | head -1)
  [ -n "$sm" ] || sm=$(cd "$root" 2>/dev/null && find $HEYTA_APK_SOURCE_DIRS \
    -type f \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' \
    -exec stat -c %Y {} + 2>/dev/null | sort -rn | head -1)
  printf '%s %s\n' "${am:-}" "${sm:-}"
}

# <apk> <root?> -> rc 0 新鲜 / 1 比源码旧 / 2 APK 不存在 / 3 读不出数
heyta_apk_is_fresh() {
  local pair am sm
  pair=$(heyta_apk_pair "$1" "${2:-$HEYTA_REPO_ROOT}")
  am=${pair%% *}
  sm=${pair##* }
  [ -n "$am" ] || return 2
  [ -n "$sm" ] || return 3
  [ "$sm" -le "$am" ] && return 0
  return 1
}

# 🔴 真机验收脚本用的那道门：装包之前当场判。
# <apk> <脚本名> <root?> -> rc 0 可以装 / 1 拒绝装
heyta_apk_freshness_guard() {
  local apk="$1" who="$2" root="${3:-$HEYTA_REPO_ROOT}"
  local am sm rc
  heyta_apk_is_fresh "$apk" "$root"; rc=$?
  read -r am sm < <(heyta_apk_pair "$apk" "$root")
  echo "   APK $([ -n "$am" ] && date -r "$am" '+%F %T' || echo "（不存在）") / 最新源码 $([ -n "$sm" ] && date -r "$sm" '+%F %T' || echo "（读不出）")"
  echo "   （扫的是 $root 下：${HEYTA_APK_SOURCE_DIRS}）"
  case $rc in
    0) echo "   ✅ 装的是当前源码的产物"; return 0 ;;
    2) echo "   🔴 $who 拒绝装包：APK 不存在（${apk}）"; echo "      先 pnpm --filter @heyta/ui build && pnpm build:android"; return 1 ;;
    3) echo "   🔴 $who 拒绝装包：**读不出源码 mtime**。这里不按「新鲜」处理 ——";
       echo "      空读数与「确实没有比它更新的源码」在输出上长得一样，而后者会放装包过去（假绿方向）。";
       return 1 ;;
    *) echo "   🔴 $who 拒绝装包：APK 比源码旧 —— 跑它验的是旧 bundle（§7 第 27 条）";
       echo "      先 pnpm --filter @heyta/ui build && pnpm build:android";
       echo "      确实要验旧产物才写 HEYTA_ALLOW_STALE_APK=1（那一条会被打印成取证，不会悄悄过去）";
       if [ "${HEYTA_ALLOW_STALE_APK:-0}" = "1" ]; then
         echo "   ⚠️ 已用 HEYTA_ALLOW_STALE_APK=1 放行 —— 本轮结论**不适用于当前源码**"
         return 0
       fi
       return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# 自检：三臂夹具 + **接线臂**。
#
# 接线臂存在的理由：把判据抽进 lib 而不确认调用方真的在调它，就等于新写了一份
# **没人执行的更漂亮版本**（AGENTS §3.5 那条教训的原话形状）。
# 拿掉 `verify-mobile-trash.sh` 里那一行调用 ⇒ 这一臂必须转红。
# ---------------------------------------------------------------------------
heyta_apk_freshness_selftest() {
  local root apk src_dir fail=0
  root=$(mktemp -d)
  mkdir -p "$root/apps/mobile/src" "$root/apps/mobile/android/app/build/outputs/apk/release"
  src_dir="$root/apps/mobile/src"
  apk="$root/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"

  # 臂 1：源码比 APK 新 -> 必须判旧（rc=1，且 guard 拒绝）
  printf 'x\n' > "$src_dir/FreshnessProbe.ts"
  touch -t 202601010000 "$apk"
  touch -t 202609010000 "$src_dir/FreshnessProbe.ts"
  heyta_apk_is_fresh "$apk" "$root"; [ $? -eq 1 ] \
    && echo "   ✅ 臂 1 旧 bundle 被判出" || { echo "   🔴 臂 1 存活：APK 比源码旧却没被判出"; fail=1; }
  heyta_apk_freshness_guard "$apk" "selftest" "$root" >/dev/null 2>&1; [ $? -eq 1 ] \
    && echo "   ✅ 臂 1b guard 拒绝装包" || { echo "   🔴 臂 1b 存活：guard 放行了旧包"; fail=1; }

  # 臂 2：APK 比源码新 -> 必须放行（证明这条判据不是恒红）
  touch -t 202610010000 "$apk"
  heyta_apk_is_fresh "$apk" "$root"; [ $? -eq 0 ] \
    && echo "   ✅ 臂 2 新 bundle 放行（不是恒红）" || { echo "   🔴 臂 2 坏了：新鲜也被拒"; fail=1; }

  # 臂 3：APK 不存在 -> rc=2（与"旧"是两种原因，不许合并）
  rm -f "$apk"
  heyta_apk_is_fresh "$apk" "$root"; [ $? -eq 2 ] \
    && echo "   ✅ 臂 3 不存在单独成档" || { echo "   🔴 臂 3 坏了：不存在的 APK 被读成别的"; fail=1; }

  # 臂 4：接线 —— 真实脚本里必须有那一发调用
  if grep -q "heyta_apk_freshness_guard" "$HEYTA_REPO_ROOT/scripts/verify-mobile-trash.sh"; then
    echo "   ✅ 臂 4 verify-mobile-trash.sh 里确有调用点"
  else
    echo "   🔴 臂 4 断了：脚本没调用这道门（那这条判据等于没装）"
    fail=1
  fi

  # 臂 5：注入的根必须真的被用 —— 算出来的"最新源码"要逐字等于**夹具里那个文件**的 mtime。
  # 不这么判的话，"传了根参数"与"其实又去扫了真实工作树"在输出上长得一样（跨树比较最阴的一种）。
  local expect got
  expect=$(_mtime "$src_dir/FreshnessProbe.ts")
  got=$(heyta_apk_pair "$root/does-not-exist.apk" "$root"); got=${got##* }
  if [ -n "$expect" ] && [ "$got" = "$expect" ]; then
    echo "   ✅ 臂 5 读数来自注入的根（$got == 夹具文件 mtime）"
  else
    echo "   🔴 臂 5 坏了：注入根后算出的是「${got:-空}」，与夹具文件 mtime「${expect:-空}」不一致"; fail=1
  fi

  rm -rf "$root"
  [ $fail -eq 0 ] && { echo "自检 5/5 通过"; return 0; } || { echo "自检有臂存活"; return 1; }
}

# 直接执行（不是 source）时只给一条入口：自检。被 source 时什么都不做。
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:-}" in
    --self-test) heyta_apk_freshness_selftest; exit $? ;;
    *) echo "用法：source 这个文件，或 bash $0 --self-test"; exit 2 ;;
  esac
fi
