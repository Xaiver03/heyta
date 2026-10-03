#!/bin/bash
#
# 移动端 / 四端交付的**开工窗口闸门**（默认只体检不执行）
# ======================================================
#
# 🔴 为什么要它：B（四端重装）与 C（截止时刻的设备验收）这两件事**能不能开跑**
# 完全由现场决定 —— 负载、别的并行验收、工作树里有没有别人未提交的源码、APK 是不是
# 当前源码打出来的、服务端和凭据在不在。这些读数每小时都在变，写进文档就过期
# （本仓库实测过：同一条"负载 16–35"在三小时内变成 73）。所以把判据落成一条命令，
# 谁要开跑就先跑它，而不是谁记忆好。
#
# 用法：
#   bash scripts/verify-mobile-window-gate.sh --target b
#   bash scripts/verify-mobile-window-gate.sh --target c
#   加 --confirm 才真的执行（默认 dry-run，只打印将要执行的命令与现量读数）
#
# 退出码（**三种必须分开**，混成一个数字就没法判断该干什么）：
#   0 = 窗口开着（dry-run 时 = 全部前置满足；--confirm 时 = 被执行的那条命令自己退出 0）
#   1 = 用法错（没给 --target，或给了不认识的 target）
#   3 = 现场不成立（环境/负载/撞车/产物旧）—— **不是产品失败**，等窗口再来
set -u
export PATH="/opt/homebrew/bin:$PATH"

TARGET=''
CONFIRM=0
REPO=''
while [ $# -gt 0 ]; do
  case "$1" in
    --target)   TARGET="${2:-}"; shift 2 ;;
    --target=*) TARGET="${1#*=}"; shift ;;
    --confirm)  CONFIRM=1; shift ;;
    --repo)     REPO="${2:-}"; shift 2 ;;
    *) echo "❌ 不认识的参数：$1" >&2; echo "   用法：--target b|c [--confirm]" >&2; exit 1 ;;
  esac
done

if [ -z "$TARGET" ]; then
  echo "❌ 缺 --target（b = 四端重装；c = 截止时刻的设备验收）" >&2
  exit 1
fi
case "$TARGET" in
  b|c) ;;
  *) echo "❌ --target 只认 b 或 c，收到的是 '$TARGET'" >&2; exit 1 ;;
esac

# 仓库根：脚本可能从任何 cwd 跑（`cd scripts && bash …`），而里面的判据全是
# 相对路径 + 绝对路径混合，根算错会得到"前置全绿但跑的是另一棵树"。
if [ -z "$REPO" ]; then
  REPO="$(cd "$(dirname "$0")/.." && pwd)"
fi
cd "$REPO" || { echo "❌ 进不去仓库根：$REPO" >&2; exit 1; }
# 🔴 打印**两个根**：脚本推导的根与 git 认的根。两者不一致时后面的相对路径全是错的，
# 而那看起来像"前置没过"而不是"根错了"。
GIT_TOP="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ "$REPO" != "$GIT_TOP" ]; then
  echo "❌ 脚本推导的根与 git 根不一致：REPO=$REPO GIT_TOP=$GIT_TOP" >&2
  exit 1
fi
echo "仓库根：${REPO}（与 git 根一致）"

FAIL=0
pass() { echo "   ✅ $1"; }
warn() { echo "   ❌ $1"; FAIL=$((FAIL + 1)); }

# ── 通用前置一：负载门。用**仓里那条规范实现**，不在这里重写解析
#    （`wait-for-quiet-host.sh` 的文件头记着 #168：自己手写 `tr -d '{} '` 会把
#     分隔符连同三个值粘成一个非法整数 ⇒ 比较恒假、循环恒睡，坏了 15 轮没人发现）。
echo ""
echo "════ 1. 负载门（规范实现，阈值 = hw.ncpu × 3/4）════"
. scripts/lib/wait-for-quiet-host.sh
# 这里**只读一次现量**，不阻塞等人：窗口的判断是给调用者的，不是替调用者睡觉。
CORES=$(sysctl -n hw.ncpu)
LIMIT=$((CORES * 3 / 4))
LOAD1=$(uptime | sed 's/.*load averages: //' | awk '{print int($1)}')
echo "   现量：1 分钟负载 ${LOAD1}，阈值 ${LIMIT}（$CORES 核）"
if [ "$LOAD1" -le "$LIMIT" ]; then
  pass "负载达标"
else
  warn "负载 $LOAD1 > $LIMIT —— 等落回阈值内再开跑（本脚本不替你等）"
fi

# ── 通用前置二：工作树里**别人**未提交的源码。
#    这是 §7 第 82 条那一族的根判据："装进四端的是别人 WIP 而判据全绿"。
#    所以这一条不是礼貌性检查，是"这次交付到底是不是当前源码"的唯一现场证据。
echo ""
echo "════ 2. 工作树：有没有别人未提交的源码 ════"
DIRTY_SRC=$(git status --porcelain -- packages apps server | grep -E '^ ?M' | wc -l | tr -d ' ')
if [ "$DIRTY_SRC" = "0" ]; then
  pass "packages/ apps/ server/ 里没有未提交的修改"
else
  echo "   ❌ $DIRTY_SRC 枚未提交的源码改动（这些会被打进产物，而判据看不出来）："
  git status --porcelain -- packages apps server | grep -E '^ ?M' | sed 's/^/      /'
  FAIL=$((FAIL + 1))
fi
# `??` 不判：未跟踪文件进不了包（打包走 `git ls-files`），所以它不是"装了别人 WIP"的通道。

case "$TARGET" in
  b)
    echo ""
    echo "════ 3. B 专属：reinstall-all.sh 自身必须干净 ════"
    # 🔴 被执行的那个脚本自己在工作树里被改着 = 跑的是"上一版流程 + 这一版判据"。
    #    本仓库实测过这条（交接 §4 B 那条错就是"只看 op-log、没看被执行脚本自己"）。
    if [ -z "$(git status --porcelain -- scripts/reinstall-all.sh)" ]; then
      pass "scripts/reinstall-all.sh 干净"
    else
      warn "scripts/reinstall-all.sh 正被改动 —— 先等它落地"
    fi
    echo ""
    echo "════ 4. B 专属：iOS 设备名每次现取（不许抄字面量）════"
    BOOTED=$(/usr/bin/xcrun simctl list devices booted 2>/dev/null | grep -E '\(Booted\)' | sed 's/^ *//;s/ (.*//')
    echo "$BOOTED" | sed 's/^/      已启动的模拟器: /'
    if [ -z "$(printf '%s' "$BOOTED" | tr -d '[:space:]')" ]; then
      warn "没有已启动的 iOS 模拟器 —— B 的 ios 段会判红（脚本如实报因，不硬装）"
    else
      pass "有已启动的模拟器：$(printf '%s; ' $BOOTED)"
    fi
    CMD="IOS_DEVICE_NAME=\"<上面现取的名字>\" bash scripts/reinstall-all.sh"
    ;;
  c)
    E2E_SERIAL="${HEYTA_E2E_SERIAL:-emulator-5554}"
    echo ""
    echo "════ 3. C 专属：设备独占（AGENTS §8.9）════"
    # 🔴 **不 source `lib/mobile-e2e.sh`**：它在文件尾 `trap restore_ime EXIT`，
    #    而 `restore_ime` 是真的会动设备的（`ime enable` + `show_ime_with_hard_keyboard 1`）。
    #    一个"只是看看窗口开没开"的 dry-run 不该改设备状态。
    #    权威判据在 `verify-mobile-due-time.sh` 第 0 步的 `another_mobile_e2e_running` 里，
    #    这里只做同一条排除规则的粗筛：只认"直接 bash 那个脚本"的行，`bash -n` 是预检不算运行者。
    OTHERS=$(pgrep -f 'bash [^ ]*verify-mobile-[a-z-]+\.sh' 2>/dev/null | grep -v "^$$\$" | head -3)
    if [ -n "$OTHERS" ]; then
      echo "   ❌ 有移动端验收在跑（pid：$(printf '%s ' $OTHERS)）"
      FAIL=$((FAIL + 1))
    else
      pass "粗筛没有别的移动端验收在抢 ${E2E_SERIAL}（权威判据在验收脚本第 0 步）"
    fi
    if adb -s "$E2E_SERIAL" get-state >/dev/null 2>&1; then
      pass "$E2E_SERIAL 在线"
    else
      warn "$E2E_SERIAL 不在线"
    fi
    echo ""
    echo "════ 4. C 专属：验收的三个外部前置 ════"
    # 这三个都实测过"缺了会怎样"：缺凭据 → lib 在 source 阶段就 `cat: No such file`，
    # 但脚本**照往下跑**（TOKEN 变空串），要到第 0 步的令牌长度判据才拦下来；
    # 缺服务端 → 症状是"应用没起来 / 找不到按钮"，看起来像产品坏了。
    MISSING_CRED=''
    for f in "${HEYTA_E2E_TOKEN_FILE:-/tmp/heyta_mobile_token.txt}" \
             "${HEYTA_E2E_EMAIL_FILE:-/tmp/heyta_mobile_email.txt}" \
             "${HEYTA_E2E_E2EE_FILE:-/tmp/heyta_mobile_e2ee.txt}"; do
      [ -f "$f" ] || MISSING_CRED="$MISSING_CRED $f"
    done
    if [ -z "$MISSING_CRED" ]; then
      pass "凭据三件套都在"
    else
      warn "缺凭据文件：$MISSING_CRED"
    fi
    PORT="${PORT:-3000}"
    HEALTH=$(curl -s --noproxy '*' -m 5 "http://127.0.0.1:${PORT}/health" 2>/dev/null)
    if printf '%s' "$HEALTH" | grep -q '"status":"ok"'; then
      pass "服务端就绪（:${PORT}/health）"
    else
      warn "服务端没在 :${PORT}（返回：${HEALTH:-空}）"
    fi
    APK="apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
    if [ -f "$APK" ]; then
      APK_MT=$(stat -f %m "$APK")
      NEWEST=$(find apps/mobile/src packages/ui/src packages/i18n/src packages/domain/src \
        -type f \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' \
        -exec stat -f %m {} + 2>/dev/null | sort -rn | head -1)
      echo "      APK $(date -r "$APK_MT" '+%F %T') / 最新源码 $(date -r "${NEWEST:-0}" '+%F %T')"
      if [ -n "$NEWEST" ] && [ "$NEWEST" -le "$APK_MT" ]; then
        pass "APK 不比源码旧"
      else
        warn "APK 比源码旧 —— 跑它验的是旧 bundle（§7 第 27 条）"
      fi
    else
      warn "APK 不存在：$APK"
    fi
    echo ""
    echo "════ 5. C 专属：脚本已进自快照 MANIFEST ════"
    if grep -q "verify-mobile-due-time.sh" scripts/check-script-snapshot.mjs; then
      pass "scripts/check-script-snapshot.mjs 的 MANIFEST 里有本线那条脚本"
    else
      warn "MANIFEST 里没有它 —— 长验收脚本必须登记（traps #110/#113）"
    fi
    CMD="bash scripts/verify-mobile-due-time.sh"
    ;;
esac

echo ""
echo "════ 结论 ════"
if [ "$FAIL" -gt 0 ]; then
  echo "   窗口**没开**：$FAIL 条前置不成立。这是环境状态，不是产品失败（exit 3）。"
  echo "   下一步（B/C 都适用的补前置顺序）："
  echo "     1) 等并行会话把上面列出的文件提交"
  echo "     2) bash scripts/mobile-e2e-up.sh        # 起服务端 + 建号写凭据"
  echo "     3) pnpm --filter @heyta/ui build && pnpm build:android"
  echo "     4) 等负载落回 $LOAD1 → ≤$LIMIT"
  echo "     5) 重跑本脚本（不带 --confirm）确认全绿"
  exit 3
fi

if [ "$CONFIRM" = "0" ]; then
  echo "   窗口开着。**未执行** —— 这是 dry-run。要执行加 --confirm："
  echo "     $CMD"
  exit 0
fi

echo "   窗口开着，--confirm 已给，开始执行："
echo "     $CMD"
if [ "$TARGET" = "b" ]; then
  IOS_NAME=$(printf '%s\n' "$BOOTED" | head -1)
  IOS_DEVICE_NAME="$IOS_NAME" bash scripts/reinstall-all.sh
else
  bash scripts/verify-mobile-due-time.sh
fi
