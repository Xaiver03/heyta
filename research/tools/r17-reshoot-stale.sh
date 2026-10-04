#!/bin/bash
# 把 `r17-evidence-md5-check.sh --all` 报成「形状主张已过期」（UISTALE）的证据目录**重拍**一遍。
#
# 为什么要有这么个脚本（2026-10-04 14:2x）：本线现在有 4 份 README / 14 枚截图的 UIPIN 判为过期，
# 重拍是它们唯一的闭合动作，而重拍**必须过一次窗口门**：
# `e2e/playwright.config.ts` 的 webServer 用 `--strictPort` 钉在 **4318/4319**，
# 那两个端口此刻正被**别人的 dev server** 占着（14:2x 现量 node 93264 / 93252）——
# 硬跑就是把人踢出正在做的事（AGENTS §6.2 规定二 + §7 那条"check:ai-e2e 按端口 SIGKILL 别人的 vite"）。
# 所以前置不达标就 **exit 3**（环境无效 ≠ 产品失败），而不是降级、不是"先跑起来看看"。
#
# 🔴 这个脚本**刻意不做**的两件事：
#   1. **不自动重钉 UIPIN**。"钉"的前提是**有人打开那张图看过**（§6.2 规定一）。
#      脚本只把新字节放回去并打印改前/改后 md5；README 里那行"人看到的"和 UIPIN 由看过的人改。
#   2. **不猜目录→spec 的映射**。映射表里没有的目录**点名报错**（exit 1），
#      而不是"看起来像就挑一个同名 spec"——挑错 spec 会拿**别的界面的图**覆盖取证目录，
#      那种破坏在输出上长得和"重拍成功"一模一样。
#
# 用法：
#   bash research/tools/r17-reshoot-stale.sh              # dry-run：打印待重拍清单 + 五格前置读数
#   bash research/tools/r17-reshoot-stale.sh --confirm    # 真的跑（前置全绿才走到这一步）
#   LOAD_MAX=8 bash research/tools/r17-reshoot-stale.sh   # 收紧负载门（默认按 核数×3/4 现算）
#   bash research/tools/r17-reshoot-stale.sh --only calendar-day   # 只重拍一枚目录
set -u

MAIN=$(cd "$(dirname "$0")/../.." && pwd)
R17="$MAIN/research/tools/r17-evidence-md5-check.sh"
# ⚠️ 这里**不给 LOAD_MAX 默认值**：默认值在下面按 `核数 × 3/4` 现算，
#    与 `scripts/lib/wait-for-quiet-host.sh` 同一把尺。写死 12 就是抄一份会漂的常量。
PORTS="${PORTS:-4318 4319}"
DIST_PKGS="${DIST_PKGS:-ui,i18n,design-system,app-host}"
CONFIRM=0
ONLY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --confirm) CONFIRM=1; shift ;;
    --only) ONLY="${2:-}"; [ -n "$ONLY" ] || { echo "❌ --only 后面要给证据目录名" >&2; exit 1; }; shift 2 ;;
    --help|-h) sed -n '1,26p' "$0"; exit 0 ;;
    *) echo "❌ 未知参数：$1（只认 --confirm / --only <目录名> / --help）" >&2; exit 1 ;;
  esac
done

cd "$MAIN" || exit 1

# 证据目录名 → 产出它的 spec。⚠️ 只登记**本线实测过**的对应关系（14:2x 逐条 grep
# `page.screenshot({ path:` 对出来的），别的线的目录要加就先把它验证明白再加。
spec_for() {
  case "$1" in
    calendar-cells) echo calendar-cells.spec.ts ;;
    calendar-week) echo calendar-week.spec.ts ;;
    calendar-capture) echo calendar-capture.spec.ts ;;
    calendar-day) echo calendar-day.spec.ts ;;
    calendar-day-en) echo calendar-day-en.spec.ts ;;
    calendar-view-options) echo calendar-view-options.spec.ts ;;
    calendar-year) echo calendar-year.spec.ts ;;
    # ⚠️ `calendar-day-time/` 那三张**没有同名 spec** —— 它们是 `calendar-day.spec.ts:316/337/403`
    #    用 `SHOT('day-timed'|'day-timed-hour16'|'day-hour-labels')` 拍的。14:2x 逐条 grep 对出来的，
    #    不是"名字像就归过去"。
    calendar-day-time) echo calendar-day.spec.ts ;;
    # 15:5x 加：`--all` 现在把 profile-panel 也报成过期（钉在 39032107，而 HEAD 之后
    # profile 面的判据源码动了）。映射**不是按名字猜的**：
    #   grep -rln 'profile-panel' e2e/tests/*.ts  →  只有 profile-avatar-e2ee.spec.ts，
    # 它第 58 行的 SHOT() 写的就是 `../apps/web/evidence/profile-panel/<name>.png`。
    profile-panel) echo profile-avatar-e2ee.spec.ts ;;
    *) echo "" ;;
  esac
}

echo "== 1. 现量取「形状主张已过期」的目录（不引用旧读数）=="
ALL_OUT=$(bash "$R17" --all 2>&1)
ALL_RC=$?
printf '   r17 --all rc=%s\n' "$ALL_RC"
STALE=$(printf '%s\n' "$ALL_OUT" | sed -n 's/^DIRCHECK \(.*\) entries=.* mismatch=\([1-9][0-9]*\) .*/\1/p' | sort -u)
if [ -z "$STALE" ]; then
  echo "   ✅ 没有过期目录 ⇒ 无事可做。"
  printf '%s\n' "$ALL_OUT" | grep '^ALLCHECK ' | sed 's/^/      /'
  exit 0
fi
N_STALE=$(printf '%s\n' "$STALE" | grep -c .)
printf '   待重拍 %s 个目录：\n' "$N_STALE"
printf '%s\n' "$STALE" | sed 's/^/      /'

echo "== 2. 映射检查（挑错 spec = 拿别的界面的图覆盖取证目录）=="
PLAN=""
MISS=0
# 🔴 逐行读，不用 `for d in $STALE`：仓库绝对路径里**带空格**
#    （`/Users/…/All in one Data/…`），按空白拆词会把一枚目录拆成四段，
#    于是 `spec_for` 拿到的是 "in" 这种碎片 —— 症状是"映射表里没有它"，看起来像清单缺项。
while IFS= read -r d; do
  [ -n "$d" ] || continue
  name=$(basename "$d")
  [ -n "$ONLY" ] && [ "$name" != "$ONLY" ] && continue
  s=$(spec_for "$name")
  if [ -z "$s" ]; then
    echo "   ❌ ${name}：映射表里没有它 —— 不猜。要么把 spec 名补进 spec_for()（先验证），要么手动处理。" >&2
    MISS=$((MISS + 1)); continue
  fi
  [ -f "$MAIN/e2e/tests/$s" ] || { echo "   ❌ $name → ${s}：spec 文件不在盘上" >&2; MISS=$((MISS + 1)); continue; }
  echo "   $name → e2e/tests/$s"
  PLAN="$PLAN$d|$s
"
done <<STALE_BLOCK
$STALE
STALE_BLOCK
[ "$MISS" = "0" ] || { echo "   ⇒ $MISS 枚映射不了，先修映射再谈重拍（exit 1）。" >&2; exit 1; }
[ -n "$PLAN" ] || { echo "   ❌ --only '$ONLY' 一枚都没匹配上（待重拍清单见上面）⇒ 参数写错了，不能当成「无事可做」。" >&2; exit 1; }

echo "== 3. 前置五格（端口 / 负载 / dist / 依赖 / 载体）=="
GATES=""
BUSY=""
for p in $PORTS; do
  occ=$(lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $1"/"$2}' | sort -u | tr '\n' ' ')
  [ -n "$occ" ] && BUSY="$BUSY$p=${occ}"
done
if [ -n "$BUSY" ]; then
  echo "   ❌ dev 端口被占（硬跑 = 抢别人的 webServer）：$BUSY"
  GATES="$GATES,dev"
else
  echo "   ✅ $PORTS 空闲"
fi
# 🔴 负载这一格**第一版是坏的，而且坏成"永远绿"**：我写的是
#   `sysctl -n vm.loadavg | tr -d '{} '` —— 那正是 `scripts/lib/wait-for-quiet-host.sh:39`
#   的注释点名**别再犯**的坑（traps #168）：`tr` 把分隔符和花括号一起删掉，
#   三个数粘成一个 `31.4729.0034.04`，再拿去和 12 比 ⇒ 现场负载 **31** 时它打印 `✅ ≤ 12`。
#   同一个格子里还叠了第二条错：比较方向写反（`sort -g | head -1 != LOAD_MAX` 在超阈值时**为假**）。
#   ⇒ 两条一般规律：**抄现成实现之前先读它注释里那句"为什么不用另一种写法"**；
#      新写的门**第一次 dry-run 就要拿一个必然超阈值的现场喂它**（这里负载本来就 31，
#      所以第一跑就该红 —— 它报绿才是信号）。
CORES=$(sysctl -n hw.ncpu)
LOAD_LIMIT="${LOAD_MAX:-$((CORES * 3 / 4))}"
LOAD1=$(uptime | sed 's/.*load averages: //' | awk '{print int($1)}')
if [ "$LOAD1" -gt "$LOAD_LIMIT" ]; then
  echo "   ❌ 负载 load1=$LOAD1 > ${LOAD_LIMIT}（$CORES 核 × 3/4，与设备验收同一把尺）"
  GATES="$GATES,load"
else
  echo "   ✅ 负载 load1=$LOAD1 ≤ $LOAD_LIMIT"
fi
DF_OUT=$(node "$MAIN/scripts/dist-freshness.mjs" --only "$DIST_PKGS" --strict 2>&1)
DF_RC=$?
if [ "$DF_RC" != "0" ]; then
  echo "   ❌ dist 落后于源码（--strict）：读的是旧产物，拍出来的图不算当前形状"
  printf '%s\n' "$DF_OUT" | grep -E '落后于源码|❌|⚠️' | head -3 | sed 's/^/      /'
  GATES="$GATES,dist"
else
  echo "   ✅ dist 新鲜（${DIST_PKGS}）"
fi
if [ ! -d "$MAIN/e2e/node_modules" ]; then
  echo "   ❌ e2e 依赖没装（跑不了 playwright）：cd e2e && pnpm install"
  GATES="$GATES,deps"
else
  echo "   ✅ e2e/node_modules 在"
fi

# 🔴 第五格「载体」：**拍的树必须就是锚点声称的那一份**。
#    15:5x 实测：dev 端口空、负载 11 ≤ 12、dist 新鲜、spec 全在 —— 四格全绿，
#    而 `packages/i18n/src/locales/{zh-CN,en}.ts` 正被另一条线改着（+116/−60，设备撤销与
#    口令措辞那批词条）。dev server 读的是**工作树**，所以这一刻拍出来的图里渲染的是
#    别人未提交的文案，而我要钉的 UIPIN 写的是 `packages/i18n@<某个提交>` ⇒
#    锚点会从"这张图对应那份代码"变成"这张图对应一份我当时并说不清谁的树"。
#    这与 `scripts/reinstall-all.sh` 的 src 不变量是同一件事（四端重装也要求"无别人未提交源码"），
#    也与 traps #82/#178（"装上了当前产物"要有判据）同族 —— 只不过这里产物换成截图。
#    判据范围**只取本线锚点自己列出的那些判据路径**（不吞整仓 100+ 枚脏行）：
#    谁的改动会改掉这张图，由锚点说了算，不由我的直觉说了算。
echo "   ── 载体：UIPIN 的判据路径里有没有未提交的改动"
DIRTY=$(git -C "$MAIN" status --porcelain | cut -c4- | sed 's/.* -> //')
SRC_HIT=""
# 一枚锚点行 = `UIPIN <文件> <提交> <判据路径…>`；把每条判据路径与脏行做前缀比对。
# 🔴 用函数包 `set --`：在顶层做位置参数替换会把脚本自己的 "$@" 打掉（这一腿之后
#    还有别的格读参数），而函数内的位置参数只在函数内有效。判据路径都不含空格，
#    所以这里按空白拆是安全的（目录路径含空格那一坑在上面的 STALE 循环里已经踩过）。
check_pin_line() {
  set -- $1
  [ "$#" -ge 4 ] || return 0
  shift 3
  local p pp f
  for p in "$@"; do
    pp=${p%%@*}                                  # 允许 `path@commit` 的写法
    case "$pp" in packages/*|apps/*|scripts/*) ;; *) continue ;; esac
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      case "$f" in
        "$pp"|"$pp"/*) SRC_HIT="$SRC_HIT$NAME ← $pp  （未提交：${f}）
" ;;
      esac
    done <<DIRTY_BLOCK
$DIRTY
DIRTY_BLOCK
  done
}
while IFS= read -r item; do
  [ -n "$item" ] || continue
  d=${item%|*}; NAME=$(basename "$d")
  [ -f "$d/README.md" ] || continue
  while IFS= read -r pl; do
    [ -n "$pl" ] && check_pin_line "$pl"
  done < <(grep -h '^UIPIN ' "$d/README.md" 2>/dev/null || true)
done <<PLAN_BLOCK
$PLAN
PLAN_BLOCK
N_SRC=$(printf '%s\n' "$SRC_HIT" | grep -c . || true)
if [ "$N_SRC" != "0" ]; then
  printf '%s' "$SRC_HIT" | sort -u | sed 's/^/      · /'
  echo "   ❌ 载体不干净：这张图会把**未提交的判据源码**渲染进去，而锚点钉的是提交态（exit 3，等其所有者提交）"
  GATES="$GATES,src"
else
  echo "   ✅ 判据路径没有未提交改动 ⇒ 拍出来的就是 HEAD 那份形状"
fi

if [ -n "$GATES" ]; then
  echo "   ⇒ 前置不达标：GATES=${GATES#,} —— 这是**环境无效**，不是产品失败（exit 3，不降级、不硬跑）。" >&2
  exit 3
fi

if [ "$CONFIRM" != "1" ]; then
  echo "== 4. dry-run 收尾 =="
  echo "   五格前置全绿，**但没有 --confirm ⇒ 一张图都没重拍、一个字节都没动**。"
  echo "   要动：bash research/tools/r17-reshoot-stale.sh --confirm"
  echo "   ⚠️ 重拍之后仍必须：① 逐张打开看图，② 改 README 里那行「人看到的」，③ 重钉 UIPIN。"
  echo "      这个脚本**不做** ②③ —— 没有「人看过」的锚点就是没锚点。"
  exit 0
fi

echo "== 4. 逐目录重拍并放回证据目录 =="
FAIL=0
while IFS= read -r item; do
  [ -n "$item" ] || continue
  d=${item%|*}; s=${item#*|}
  name=$(basename "$d")
  echo "   ── ${name}（${s}）"
  OUT=$(cd "$MAIN/e2e" && npx playwright test "tests/$s" --reporter=list 2>&1); RC=$?
  if [ "$RC" != "0" ]; then
    echo "      ❌ spec 非零退出（rc=${RC}）⇒ **不复制任何字节**：失败的趟里哪些图是完整的没有记录，" >&2
    echo "         拿它们覆盖取证目录 = 用一次不确定的运行替换掉已知的那一份。" >&2
    printf '%s\n' "$OUT" | tail -6 | sed 's/^/         /'
    FAIL=$((FAIL + 1)); continue
  fi
  for f in "$MAIN/e2e/test-results/"*.png; do
    [ -f "$f" ] || continue
    b=$(basename "$f")
    [ -f "$d/$b" ] || continue
    old=$(md5 -q "$d/$b"); new=$(md5 -q "$f")
    cp "$f" "$d/$b"
    printf '      %s  %s → %s%s\n' "$b" "${old:0:8}" "${new:0:8}" "$([ "$old" = "$new" ] && echo '（字节相同）')"
  done
done <<PLAN_BLOCK
$PLAN
PLAN_BLOCK

echo "== 5. 复跑对账 =="
bash "$R17" --all 2>&1 | grep -E '^(ALLCHECK|UISTALE|❌|✅)' | sed 's/^/   /'
echo "   ⇒ 还报 UISTALE 的那些**是预期的**：锚点钉的是「看过旧字节的那个人」的时刻。"
echo "     下一步（脚本不替你做）：逐张打开新图 → 改「人看到的」→ 把 UIPIN 的 pin 换成当前提交。"
[ "$FAIL" = "0" ] || { echo "❌ $FAIL 个目录的 spec 失败，未放回字节" >&2; exit 1; }
exit 0
