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
#   bash research/tools/r17-reshoot-stale.sh              # dry-run：打印待重拍清单 + 全部前置门读数
#   bash research/tools/r17-reshoot-stale.sh --confirm    # 真的跑（前置全绿才走到这一步）
#   LOAD_MAX=8 bash research/tools/r17-reshoot-stale.sh   # 收紧负载门（默认按 核数×3/4 现算）
#   HEYTA_MEM_GATE_MIN_PCT=20 bash research/tools/r17-reshoot-stale.sh   # 收紧内存门（默认可回收/空闲 ≥ 物理内存的 10%）
#   bash research/tools/r17-reshoot-stale.sh --only calendar-day   # 只重拍一枚目录
#   FORCE_SHOOT=calendar-capture bash research/tools/r17-reshoot-stale.sh --only calendar-capture
#       ↑ 点名一枚目录**不论过期与否**都拍（要拍的是一张从没钉过 UIPIN 的新图时用）；
#         必须与 --only 同用且同枚，其余判据（映射 / 覆盖 / 前置门）一条不放宽。
set -u

MAIN=$(cd "$(dirname "$0")/../.." && pwd)
R17="$MAIN/research/tools/r17-evidence-md5-check.sh"
# ⚠️ 这里**不给 LOAD_MAX 默认值**：默认值在下面按 `核数 × 3/4` 现算，
#    与 `scripts/lib/wait-for-quiet-host.sh` 同一把尺。写死 12 就是抄一份会漂的常量。
PORTS="${PORTS:-4318 4319}"
DIST_PKGS="${DIST_PKGS:-ui,i18n,design-system,app-host}"
CONFIRM=0
ONLY=""
SELFTEST=0
# 🔴 三个旋钮只为**让"放回 + 报数"那一层可以被测**（见 --selftest）。
#    默认值就是现场路径，不传任何一个时行为逐字不变。
EVID_ROOT="${EVID_ROOT:-$MAIN/apps/web/evidence}"
TR_ROOT="${TR_ROOT:-$MAIN/e2e/test-results}"

while [ $# -gt 0 ]; do
  case "$1" in
    --confirm) CONFIRM=1; shift ;;
    --selftest) SELFTEST=1; shift ;;
    --only) ONLY="${2:-}"; [ -n "$ONLY" ] || { echo "❌ --only 后面要给证据目录名" >&2; exit 1; }; shift 2 ;;
    --help|-h) sed -n '1,26p' "$0"; exit 0 ;;
    *) echo "❌ 未知参数：$1（只认 --confirm / --selftest / --only <目录名> / --help）" >&2; exit 1 ;;
  esac
done

cd "$MAIN" || exit 1
# 🔴 负载与内存这两格**都用那份共享实现里的谓词**，不在这里另写一把尺
#    （`scripts/lib/wait-for-quiet-host.sh` 是这台机器"现在能不能开工"的唯一所有者；
#     设备验收那五条脚本也 source 它 —— 同一台机器上两套"能不能跑"比没有判据更糟）。
#    这里用的是**一次性**的 `host_memory_gate`，不是内层带等待循环的 `wait_for_quiet_host`：
#    本脚本的契约是"不达标就 exit 3 让看守隔 INTERVAL 再问一次"，自己憋着等会把看守的
#    让路逻辑（B/H 真在跑时要让路）堵在里面。
. scripts/lib/wait-for-quiet-host.sh

# 证据目录名 → 产出它的 spec。⚠️ 只登记**本线实测过**的对应关系（14:2x 逐条 grep
# `page.screenshot({ path:` 对出来的），别的线的目录要加就先把它验证明白再加。
# 🔴 **一枚目录可以对应多枚 spec**（一行一枚）。这条形状是 11:2x 现量撞出来的：
#   `calendar-day/` 这**一枚目录里住着两枚 spec 的图** —— 五枚 `calendar-day-*.png` 出自
#   `calendar-day.spec.ts`，三枚 `day-en-*.png` 出自 `calendar-day-en.spec.ts`（它第 60 行的
#   `SHOT()` 写的就是 `../apps/web/evidence/calendar-day/`）。旧表一条只给一枚 ⇒
#   跑完 `calendar-day.spec.ts` 动了 5 张、`settle_dir` 判"这枚目录重拍完成"，
#   而那 3 张过期主张**一张都没拍** —— 与本脚本 09:5x 修的那格同族，只是粗一档（目录 vs spec）。
#   现量：`grep -c 'day-en-full' e2e/tests/calendar-day.spec.ts` ⇒ **0**（另一枚 spec 才认得它）。
#   ⚠️ 表里以前还有一条 `calendar-day-en)` —— 盘上**没有**这枚证据目录（`ls -d apps/web/evidence/…` 现量），
#   那条永远不会命中；它的真实归属就是上面这条，所以删掉分支而不是留一枚死映射。
spec_for() {
  case "$1" in
    calendar-cells) echo calendar-cells.spec.ts ;;
    calendar-week) echo calendar-week.spec.ts ;;
    calendar-capture) echo calendar-capture.spec.ts ;;
    calendar-day) printf '%s\n' calendar-day.spec.ts calendar-day-en.spec.ts ;;
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

# spec 源文件所在目录（selftest 把它指到一次性夹具上，才能测下面那条覆盖判据的两腿）
TESTS_ROOT="${TESTS_ROOT:-$MAIN/e2e/tests}"

# 🔴 映射表的**覆盖判据**：一枚目录里每条 `UIPIN` 钉着的图，必须至少被选中的某枚 spec
#   点名过（spec 里 `SHOT('<图名>')` 的那个字面串）。没人点名 ⇒ 打印出来。
#   为什么要有这一层：上面那条多 spec 映射是**手工表**，手工表会漂；而"跑完动了 5 张"这种
#   部分完成在输出上长得和"全拍完了"一模一样（本脚本 09:5x 那一格的粗档版本）。
#   这条判据不猜新映射 —— 它只**拒绝把没拍到的读成拍到了**，出路仍然是"往表里补一条实测过的映射"。
coverage_for_dir() {
  cd_dir="$1"; shift
  unc=""
  # 🔴 解析形状**逐字抄规范裁判** `r17-evidence-md5-check.sh:163`（要 `<名>.png` + 7–40 位十六进制 + 空格）。
  #    第一版这里写的是裸 `grep '^UIPIN '`，于是 README 里那句讲形状的**散文**
  #    （"…路径集为空 rc=4…"）被当成一枚锚点，臂 h 报出 `未认领:路径集为空` ——
  #    一条自己搭的哨兵比规范裁判宽，红在一个不存在的东西上（本仓那一族：哨兵必须等于裁判）。
  while IFS= read -r pin; do
    [ -n "$pin" ] || continue
    img=$(printf '%s' "$pin" | awk '{print $2}')
    [ -n "$img" ] || continue
    base="$img"
    base=${base%.png}; base=${base%.jpg}; base=${base%.jpeg}; base=${base%.webp}
    hit=0
    for cs in "$@"; do
      [ -f "$TESTS_ROOT/$cs" ] || continue
      grep -qF -- "$base" "$TESTS_ROOT/$cs" && { hit=1; break; }
    done
    [ "$hit" = "1" ] || unc="$unc $img"
  done <<PINS
$(grep -hE '^UIPIN [^ ]+\.(png|jpg|jpeg|webp) [0-9a-f]{7,40} ' "$cd_dir/README.md" 2>/dev/null || true)
PINS
  if [ -n "$unc" ]; then
    printf '未认领:%s\n' "$(printf '%s\n' $unc | tr '\n' ' ')"
  fi
  return 0
}

# 整棵证据树的 png 指纹（`路径<TAB>md5`，按路径排序）。拍一趟 spec 之前拍一次、之后拍一次，
# 差集就是"这一趟真正动过的图"。
snap_tree() {
  find "$EVID_ROOT" -type f -name '*.png' 2>/dev/null | LC_ALL=C sort | while IFS= read -r p; do
    printf '%s\t%s\n' "$p" "$(md5 -q "$p")"
  done
}

# 🔴 「跑完一趟 spec，然后把变化**报告**出来」这一层（09:5x 重写的理由见下面两段注释）。
#    返回 0 = 至少有一张图被确认动了 / 1 = spec 绿了但**零信号** / 2 = spec 自己红了。
settle_dir() {
  d="$1"; s="$2"
  ST_DIR="${ST:-}"
  [ -n "$ST_DIR" ] || ST_DIR=$(mktemp -d /tmp/ht-reshoot-run.XXXXXX)
  mkdir -p "$ST_DIR" || return 2
  snap_tree > "$ST_DIR/before"
  # 🔴 起跑前**先清掉 test-results 里同名的残留**。不清的后果不是脏文件，是**假绿**：
  #    上一趟（甚至别人那趟）留在 test-results/ 里的同名图会被拷进证据目录，
  #    字节恰好相同时打印成「（字节相同）」—— 于是"spec 什么都没产出"与
  #    "spec 产出了一模一样的字节"在输出上长得一模一样（探针命中自家残留，§7 那一族）。
  for f in "$d"/*.png; do [ -f "$f" ] || continue; rm -f "$TR_ROOT/$(basename "$f")"; done
  if [ -n "${SPEC_CMD:-}" ]; then
    # 这两个根目录**必须显式传给桩**：它们是 shell 变量、不在环境里，
    # 不传的话桩里的 `$EVID_ROOT/cal/a.png` 会展开成 `/cal/a.png`（写不进任何东西），
    # 症状是"spec 非零退出"—— 看起来像夹具坏了，其实是装置没把作用域交出去。
    OUT=$(EVID_ROOT="$EVID_ROOT" TR_ROOT="$TR_ROOT" SPEC_NAME="$s" bash -c "$SPEC_CMD" 2>&1); RC=$?
  else
    OUT=$(cd "$MAIN/e2e" && npx playwright test "tests/$s" --reporter=list 2>&1); RC=$?
  fi
  if [ "$RC" != "0" ]; then
    echo "      ❌ spec 非零退出（rc=${RC}）⇒ **不复制任何字节**：失败的趟里哪些图是完整的没有记录，" >&2
    echo "         拿它们覆盖取证目录 = 用一次不确定的运行替换掉已知的那一份。" >&2
    printf '%s\n' "$OUT" | tail -6 | sed 's/^/         /'
    return 2
  fi
  # 先做差（**在拷贝之前**）：这一步抓到的是 spec **就地**写进证据目录的那些
  # （`SHOT()` 直接返回 `../apps/web/evidence/<目录>/<名字>.png` 的那种形状 ——
  #  calendar-day / calendar-day-en / profile-panel / calendar-view-options / calendar-year 都是）。
  snap_tree > "$ST_DIR/after"
  CHG=$(awk -F'\t' 'NR==FNR{a[$1]=$2; next} ($1 in a) && a[$1] != $2 {print $1}' "$ST_DIR/before" "$ST_DIR/after")
  INPLACE=0
  SIB=""
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    case "$p" in
      "$d"/*) INPLACE=$((INPLACE + 1)); printf '      就地 %s  %s\n' "$(basename "$p")" "$(md5 -q "$p" | cut -c1-8)" ;;
      *) SIB="$SIB $(basename "$(dirname "$p")")" ;;
    esac
  done <<CHG_BLOCK
$CHG
CHG_BLOCK
  NCP=0
  for f in "$TR_ROOT"/*.png; do
    [ -f "$f" ] || continue
    b=$(basename "$f")
    [ -f "$d/$b" ] || continue
    old=$(md5 -q "$d/$b"); new=$(md5 -q "$f")
    cp "$f" "$d/$b"
    NCP=$((NCP + 1))
    printf '      拷回 %s  %s → %s%s\n' "$b" "${old:0:8}" "${new:0:8}" "$([ "$old" = "$new" ] && echo '（字节相同）')"
  done
  # 🔴 零信号必须**响亮**：第一版这里什么都没有，因为脚本只认 test-results 那一种形状。
  #    10-05 09:5x 现场：五枚目录跑完，profile-panel 那一段**一行没印**（它的 spec 是就地写的，
  #    test-results 里没有它的图），日志读起来像"这一枚无事可做"，而它其实重拍了 4 张、
  #    其中 r15b-3-ready-dark 换了字节。同一趟 calendar-day.spec.ts 还顺带改了
  #    **不在计划里的** calendar-day-time/ 三张 —— 也是从 git 的 M 里发现的，不是从日志里。
  # 先点名"改到别处去了"，**再**判零信号：这两件事必须同时看得见 ——
  # 这一枚没动而兄弟目录动了，正是零信号那格的解释（不然下一位只会看到"没拍到"）。
  if [ -n "$SIB" ]; then
    printf '      ⚠️ 这一趟还改了目标目录**之外**的取证目录：%s\n' "$(printf '%s\n' $SIB | sort -u | tr '\n' ' ')"
    echo "         ⇒ 它们的「人看过」主张同样过期了；人看与重钉要把这几枚一起算进来（本脚本不代改 README）。"
  fi
  if [ "$INPLACE" = "0" ] && [ "$NCP" = "0" ]; then
    echo "      ❌ ${s} 跑绿了，但这一枚目录**一张图都没有动**（既没有就地写入，也没有 test-results 产物）" >&2
    echo "         ⇒ 不把它读成「重拍完成」。要么这条映射的 spec 不产出本目录的图（去改 spec_for），" >&2
    echo "           要么它写去了别处（看上面有没有点名别的目录），要么它根本没跑。" >&2
    return 1
  fi
  return 0
}

if [ "$SELFTEST" = "1" ]; then
  # 🔴 这五臂测的是**报告层**，不是对账层（对账在 r17-evidence-md5-check.sh）。
  #    由来是 10-05 09:5x 那一趟：脚本只认 test-results 那一种形状，就地写图的 spec 跑完
  #    **一行都不印**，日志把"重拍了 4 张、其中一枚换了字节"读成"无事可做"。
  #    那种形态的洞不会红也不会响 —— 它只是让"跑完了"这句话失去内容。
  bad=0
  V=$(mktemp -d /tmp/ht-reshoot-st.XXXXXX)
  EVID_ROOT="$V/evidence"; TR_ROOT="$V/tr"; ST="$V/st"
  reset_tree() {
    rm -rf "$EVID_ROOT" "$TR_ROOT"; mkdir -p "$EVID_ROOT/cal" "$EVID_ROOT/sibling" "$TR_ROOT"
    printf 'OLD1' > "$EVID_ROOT/cal/a.png"; printf 'OLD2' > "$EVID_ROOT/cal/b.png"
    printf 'SIB0' > "$EVID_ROOT/sibling/s.png"
  }
  echo "== selftest 臂 a：就地形状（spec 直接写证据目录）=="
  reset_tree
  SPEC_CMD='printf NEW > "$EVID_ROOT/cal/a.png"'
  OUT=$(settle_dir "$EVID_ROOT/cal" "fake-inplace.spec.ts" 2>&1); RC=$?
  printf '%s\n' "$OUT" | sed 's/^/      /'
  if [ "$RC" != "0" ] || ! printf '%s' "$OUT" | grep -q '就地 a.png'; then
    echo "❌ 臂 a 坏了（rc=${RC}）⇒ 就地写图的那一类仍然报不出字节" >&2; bad=$((bad+1))
  fi
  echo "== selftest 臂 b：test-results 形状（要拷回证据目录）=="
  reset_tree
  SPEC_CMD='printf NEWCP > "$TR_ROOT/b.png"'
  OUT=$(settle_dir "$EVID_ROOT/cal" "fake-copy.spec.ts" 2>&1); RC=$?
  printf '%s\n' "$OUT" | sed 's/^/      /'
  if [ "$RC" != "0" ] || ! printf '%s' "$OUT" | grep -q '拷回 b.png'; then
    echo "❌ 臂 b 坏了（rc=${RC}）⇒ 拷贝那一类回归到旧行为，等于没测" >&2; bad=$((bad+1))
  fi
  # 臂 b2：字节**真的相同**时也要照样打印，否则"拷了一张一模一样的图"与"什么都没拷"不可区分
  echo "== selftest 臂 b2：拷回的字节与现场相同 ⇒ 仍要印出那一行（不许静默）=="
  reset_tree
  SPEC_CMD='cp "$EVID_ROOT/cal/a.png" "$TR_ROOT/a.png"'
  OUT=$(settle_dir "$EVID_ROOT/cal" "fake-same.spec.ts" 2>&1); RC=$?
  if [ "$RC" != "0" ] || ! printf '%s' "$OUT" | grep -q '字节相同'; then
    echo "❌ 臂 b2 坏了（rc=${RC}）⇒「一模一样的重拍」被读成「没拍」" >&2; bad=$((bad+1))
  fi
  echo "== selftest 臂 c：spec 跑绿但零产出 ⇒ 必须 rc=1 并响亮说清 =="
  reset_tree
  SPEC_CMD='true'
  OUT=$(settle_dir "$EVID_ROOT/cal" "fake-nothing.spec.ts" 2>&1); RC=$?
  printf '%s\n' "$OUT" | sed 's/^/      /'
  if [ "$RC" != "1" ] || ! printf '%s' "$OUT" | grep -q '一张图都没有动'; then
    echo "❌ 臂 c 坏了（rc=${RC}，要 1）⇒「跑绿但没拍到」会被写成「重拍完成」（就是 09:5x 那一格）" >&2; bad=$((bad+1))
  fi
  echo "== selftest 臂 d：test-results 里有**残留**（内容还不一样）⇒ 起跑前必须清掉，不许拷成产物 =="
  reset_tree
  printf 'STALE-LEFTOVER' > "$TR_ROOT/a.png"
  SPEC_CMD='true'
  OUT=$(settle_dir "$EVID_ROOT/cal" "fake-leftover.spec.ts" 2>&1); RC=$?
  LEFT=$( [ -f "$TR_ROOT/a.png" ] && echo yes || echo no )
  if [ "$RC" != "1" ] || [ "$LEFT" != "no" ] || printf '%s' "$OUT" | grep -q '拷回'; then
    echo "❌ 臂 d 坏了（rc=${RC} 残留还在=${LEFT}）⇒ 上一趟留下的图会被读成本趟拍的（探针命中自家残留）" >&2; bad=$((bad+1))
  fi
  echo "== selftest 臂 e：只有**别的**证据目录被改 ⇒ rc=1 且必须点名那枚目录 =="
  reset_tree
  SPEC_CMD='printf X > "$EVID_ROOT/sibling/s.png"'
  OUT=$(settle_dir "$EVID_ROOT/cal" "fake-sibling.spec.ts" 2>&1); RC=$?
  printf '%s\n' "$OUT" | sed 's/^/      /'
  # ⚠️ 断言的是**警告行本身**（`之外的取证目录`），不是 spec 文件名 ——
  #    第一版这里 grep 的是 `sibling`，而 `fake-sibling.spec.ts` 里就带着这个词，
  #    于是那条臂在警告**根本没打印**的时候也照样过（假绿臂，靠下面这条 SIB_DONE 才照出来）。
  SIBOK=$(printf '%s' "$OUT" | grep -cF '取证目录：'); SIBOK=${SIBOK:-0}
  SIBBYTE=$(md5 -q "$EVID_ROOT/sibling/s.png")
  if [ "$RC" != "1" ] || [ "$SIBOK" != "1" ] || [ "$SIBBYTE" = "SIB0" ]; then
    echo "❌ 臂 e 坏了（rc=${RC} 警告行=${SIBOK} 兄弟图真改了=${SIBBYTE}）⇒ calendar-day.spec.ts 顺带改 calendar-day-time/ 那一类没有出处" >&2; bad=$((bad+1))
  fi
  echo "== selftest 臂 g：映射表的**覆盖判据**（一枚目录住着两枚 spec 的图）=="
  rm -rf "$V/t2"; mkdir -p "$V/t2/tests" "$V/t2/evidence/twodir"
  printf "test('one', async () => { SHOT('a') })\n" > "$V/t2/tests/one.spec.ts"
  printf "test('two', async () => { SHOT('b') })\n" > "$V/t2/tests/two.spec.ts"
  printf 'OLD' > "$V/t2/evidence/twodir/a.png"; printf 'OLD' > "$V/t2/evidence/twodir/b.png"
  {
    printf 'UIPIN a.png deadbeef34 packages/ui\n'
    printf 'UIPIN b.png deadbeef34 packages/ui\n'
  } > "$V/t2/evidence/twodir/README.md"
  OLD_TESTS_ROOT="$TESTS_ROOT"; TESTS_ROOT="$V/t2/tests"
  NEG=$(coverage_for_dir "$V/t2/evidence/twodir" one.spec.ts)
  POS=$(coverage_for_dir "$V/t2/evidence/twodir" one.spec.ts two.spec.ts)
  TESTS_ROOT="$OLD_TESTS_ROOT"
  if ! printf '%s' "$NEG" | grep -q '未认领' || ! printf '%s' "$NEG" | grep -q 'b.png'; then
    echo "❌ 臂 g 的负腿坏了（[${NEG}]）⇒ 少映射一枚 spec 时没人报，部分完成会被读成做完" >&2; bad=$((bad+1))
  fi
  if [ -n "$POS" ]; then
    echo "❌ 臂 g 的正腿坏了（[${POS}]）⇒ 两枚都选上还说没覆盖，这条判据会变成常驻红" >&2; bad=$((bad+1))
  fi
  echo "== selftest 臂 h：**出厂那张表**自己不漂（逐枚目录跑覆盖判据 + calendar-day 必须是两枚 spec）=="
  NSPEC=$(spec_for calendar-day | grep -c .); NSPEC=${NSPEC:-0}
  DRIFT=""
  while IFS= read -r dn; do
    [ -n "$dn" ] || continue
    [ -d "$MAIN/apps/web/evidence/$dn" ] || continue
    [ -f "$MAIN/apps/web/evidence/$dn/README.md" ] || continue
    sel=$(spec_for "$dn")
    [ -n "$sel" ] || continue
    unc=$(coverage_for_dir "$MAIN/apps/web/evidence/$dn" $sel)
    [ -n "$unc" ] && DRIFT="$DRIFT $dn:${unc}"
  done <<TBL_BLOCK
calendar-cells
calendar-week
calendar-capture
calendar-day
calendar-view-options
calendar-year
calendar-day-time
profile-panel
TBL_BLOCK
  if [ "$NSPEC" != "2" ]; then
    echo "❌ 臂 h：spec_for calendar-day 现在给 ${NSPEC} 枚 spec（要 2）⇒ day-en 那三张会没人拍" >&2; bad=$((bad+1))
  fi
  if [ -n "$DRIFT" ]; then
    echo "❌ 臂 h：出厂映射表有目录覆盖不全 ⇒${DRIFT}" >&2; bad=$((bad+1))
  else
    echo "   ✅ 表里 8 条映射逐枚跑覆盖判据都没有「没人认领的图」"
  fi
  echo "== selftest 臂 i：映射检查会把一枚目录摊成**多行 PLAN**（少一行就是漏拍一半）=="
  NPLAN=0
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    [ -f "$MAIN/e2e/tests/$s" ] && NPLAN=$((NPLAN + 1))
  done <<SPS
$(spec_for calendar-day)
SPS
  if [ "$NPLAN" != "2" ]; then
    echo "❌ 臂 i：calendar-day 展开成 ${NPLAN} 行 PLAN（要 2，且两行都得在盘上）⇒ 重拍会只做一半" >&2; bad=$((bad+1))
  else
    echo "   ✅ 一枚目录摊成 2 行 PLAN，两枚 spec 都在盘上（第 4 步逐行跑 ⇒ 5 张 + 3 张都会拍到）"
  fi
  echo "== selftest 臂 f（变异）：摘掉「起跑前清残留」那一行 ⇒ 臂 d 那一步必须不再红 =="
  HITS=$(grep -cE 'rm -f "\$TR_ROOT/\$\(basename "\$f"\)"' "$0"); HITS=${HITS:-0}
  N_LINE=$(grep -nE 'rm -f "\$TR_ROOT/\$\(basename "\$f"\)"' "$0" | head -1 | cut -d: -f1)
  MUT=$(mktemp /tmp/ht-reshoot-mut.sh.XXXXXX)
  if [ "$HITS" != "1" ] || [ -z "$N_LINE" ]; then
    # 针脚没落地（那行改了形）⇒ 直接判红，不许把"变异没落地"读成"这条臂本来就该绿"
    echo "❌ 臂 f 的针脚命中 ${HITS} 行（要恰好 1）⇒ 清残留那一行的形状变了，臂 d 的牙此刻无法证明" >&2; bad=$((bad+1))
  else
    { sed -n "1,$((N_LINE - 1))p" "$0"; sed -n "$((N_LINE + 1)),\$p" "$0"; } > "$MUT"
    reset_tree; printf 'STALE-LEFTOVER' > "$TR_ROOT/a.png"
    SPEC_CMD='true'
    eval "$(sed -n '/^settle_dir()/,/^}/p' "$MUT")"
    OUT=$(settle_dir "$EVID_ROOT/cal" "x.spec.ts" 2>&1); RC=$?
    if [ "$RC" = "1" ]; then
      echo "❌ 臂 f 的变异腿仍然红（rc=1）⇒ 臂 d 的红不是长在「起跑前清残留」那一行，那条牙是虚的" >&2; bad=$((bad+1))
    else
      printf '   MUT_LAND=1：摘掉那一行之后残留被当成本趟产物拷了（rc=%s，臂 d 原来是 1）⇒ 牙在那一行\n' "$RC"
    fi
    eval "$(sed -n '/^settle_dir()/,/^}/p' "$0")"
  fi
  rm -rf "$V" "$MUT"
  [ "$bad" = "0" ] || { echo "❌ selftest ${bad} 臂红" >&2; exit 1; }
  echo "SELFTEST=OK（就地报数 / 拷贝报数 / 字节相同仍印 / 零产出必须红 / 残留被清 / 只改别的目录时点名且不判成完成 / 变异腿证明牙在清残留那一行 / 覆盖判据两腿 / 出厂映射表逐枚自查没有无人认领的图 / 一枚目录摊成多行 PLAN）"
  exit 0
fi


echo "== 1. 现量取「形状主张已过期」的目录（不引用旧读数）=="
ALL_OUT=$(bash "$R17" --all 2>&1)
ALL_RC=$?
printf '   r17 --all rc=%s\n' "$ALL_RC"
STALE=$(printf '%s\n' "$ALL_OUT" | sed -n 's/^DIRCHECK \(.*\) entries=.* mismatch=\([1-9][0-9]*\) .*/\1/p' | sort -u)
# 🔴 FORCE_SHOOT：**点名一枚目录就拍它，不论它过期没过期**。10-05 13:5x 加，因为它要解的是一件
#    这条路径**结构上办不到**的事：`ONLY=calendar-capture` 想拍的是一张**从没钉过 UIPIN 的新图**
#    （`calendar-capture-input-wins.png`），而"过期与否"这个判据是从 UIPIN 推出来的 ——
#    没钉过的图永远推不出"过期"，于是重拍集合里不可能有它，看守就只能报"无事可做"。
#    这不是判据太严，是**判据的适用范围不含这一档**。所以给一个**只管一枚**的点名旋钮，
#    而不是把过期判据放宽（放宽后任何人跑默认档都会无视 r17 的读数）。
#    三条前置缺一不可：必须与 --only 同用、两枚名字必须相同、那枚目录必须在盘上 ——
#    少任何一条，这个旋钮就会变成"点名一枚、实拍一片"。
if [ -n "${FORCE_SHOOT:-}" ]; then
  if [ -z "$ONLY" ]; then
    echo "   ❌ FORCE_SHOOT=$FORCE_SHOOT 必须与 --only 同用 —— 不给 --only 就等于「无视过期判据重拍全树」，那不是这个旋钮的范围。" >&2
    exit 1
  fi
  if [ "$FORCE_SHOOT" != "$ONLY" ]; then
    echo "   ❌ FORCE_SHOOT=$FORCE_SHOOT 与 --only=$ONLY 不是同一枚目录 ⇒ 拒绝（一档只管一枚，不做批量）。" >&2
    exit 1
  fi
  _fsd="$MAIN/apps/web/evidence/$ONLY"
  if [ ! -d "$_fsd" ]; then
    echo "   ❌ FORCE_SHOOT 点名的证据目录不在盘上：$_fsd" >&2
    exit 1
  fi
  if printf '%s\n' "$STALE" | grep -qx "$_fsd"; then
    echo "   FORCED=0（$ONLY 本来就在待重拍集合里，这个旋钮不改变任何东西）"
  else
    STALE=$(printf '%s\n%s\n' "$STALE" "$_fsd" | grep .)
    echo "   FORCED=1（$ONLY 不在待重拍集合里，按 FORCE_SHOOT 点名加入）"
    echo "     为什么这一档必须存在：过期判据由 UIPIN 推导，而这一枚要的是一张**从没钉过锚点的新图**；"
    echo "     映射与覆盖判据（§2）和全部前置门（§3）照旧执行 —— 这个旋钮只改「拍谁」，不改「怎么拍、能不能拍」。"
  fi
fi
if [ -z "$STALE" ]; then
  # 🔴 10-05 13:5x 现量照出来的**形状错误**：`--only <目录>` 在"零枚过期"的那棵树上，
  #    原来会走到这里打 `✅ 没有过期目录 ⇒ 无事可做` 并退 **0**，而 §2 那条
  #    `--only 一枚都没匹配上 ⇒ 参数写错了` 的检查在它**后面**，永远走不到。
  #    后果不是"少了句话"：看守把 `rc=0` 当成"窗口开了"（那是它自己文件头写的开窗条件），
  #    于是打出 `WINDOW=OPEN GATES=〈空〉` —— 而**这一趟第 3 节的前置门一枚都没跑**
  #    （端口/负载/内存/dist 全没判）。读数实测：13:48:03 `WINDOW=OPEN try=1 GATES=〈空〉`，
  #    同一分钟我手工 `host_load_gate` 的量是 `load1=13` 对阈值 12 ⇒ **红的**。
  #    也就是说这把看守在"没有活"的时候报"门开了"，而它报的那声"门开了"没有任何闸门背书。
  if [ -n "$ONLY" ]; then
    echo "   ❌ ONLY_MISMATCH=$ONLY —— 点名的这枚**不在待重拍集合里**：r17 --all 现量没把它报成过期。" >&2
    echo "      这**不是**「无事可做」（那是「不给 --only」才有的形状）。要拍一枚**从没钉过 UIPIN 的新图**，" >&2
    echo "      这条路径结构上做不到（过期与否是从 UIPIN 推的，没钉过就没有「过期」可言）⇒ 直跑那条 spec，" >&2
    echo "      判据与理由见 docs/plans/calendar-profile-handoff.md §4.05 (50)。退 1 = 载体/用法不成立（不是环境无效，不降级）。" >&2
    exit 1
  fi
  echo "   ✅ 没有过期目录 ⇒ 无事可做。"
  # 🔴 这枚标记是给**消费者**看的：这一条早退**没有跑第 3 节的前置门**，
  #    所以 `rc=0` 在这里的含义是"没活"，绝不是"闸门全绿、可以起跑"。
  #    没有它，任何拿 `rc=0` 当开窗判据的上层都会把"没跑闸门"读成"跑过且绿了"。
  echo "   NOTHING_TO_SHOOT=1（本条早退**未执行第 3 节前置门** ⇒ 不许被读成 WINDOW=OPEN）"
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
  specs=$(spec_for "$name")
  if [ -z "$specs" ]; then
    echo "   ❌ ${name}：映射表里没有它 —— 不猜。要么把 spec 名补进 spec_for()（先验证），要么手动处理。" >&2
    MISS=$((MISS + 1)); continue
  fi
  SEL=""
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    if [ ! -f "$MAIN/e2e/tests/$s" ]; then
      echo "   ❌ $name → ${s}：spec 文件不在盘上" >&2; MISS=$((MISS + 1)); continue
    fi
    echo "   $name → e2e/tests/$s"
    PLAN="$PLAN$d|$s
"
    SEL="$SEL $s"
  done <<SPEC_BLOCK
$specs
SPEC_BLOCK
  # 🔴 覆盖判据：这张目录里被 UIPIN 钉着的每一张图，都要有**被选中的某枚 spec** 认领
  UNCOV=$(coverage_for_dir "$d" $SEL)
  if [ -n "$UNCOV" ]; then
    echo "   ❌ ${name}：${UNCOV} —— 这几张图没有任何一枚被选中的 spec 认得它们" >&2
    echo "      ⇒ 不重拍它们却宣布这枚目录做完，读起来会像「三张过期主张已经闭合」，而它们一张都没拍。" >&2
    echo "         出路只有一条：往 spec_for() 里补一条**实测过的**映射（一行一枚，脚本不猜）。" >&2
    MISS=$((MISS + 1))
  fi
done <<STALE_BLOCK
$STALE
STALE_BLOCK
[ "$MISS" = "0" ] || { echo "   ⇒ $MISS 枚映射不了，先修映射再谈重拍（exit 1）。" >&2; exit 1; }
[ -n "$PLAN" ] || { echo "   ❌ --only '$ONLY' 一枚都没匹配上（待重拍清单见上面）⇒ 参数写错了，不能当成「无事可做」。" >&2; exit 1; }

echo "== 3. 前置门（端口 / 负载 / 内存 / dist / 依赖 / 载体 —— 以实际打印的 GATES= 为准）=="
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
# ✅ 17:4x 再收一层：这一格原来还**自带一份读法和一份阈值推导**（`sysctl -n hw.ncpu` 加
#    `uptime | sed … | awk …`），也就是我一边写着"与设备验收同一把尺"一边**抄了第二把尺**。
#    现在读法、阈值、字形校验（含 #168 那串粘连读数 ⇒ 判探针故障而不是判 0）全在
#    `host_load_gate` 里，本脚本只把 `LOAD_MAX` 桥成 `HEYTA_LOAD_GATE_MAX`、把两条现量原样打印。
if HEYTA_LOAD_GATE_MAX="${LOAD_MAX:-}" host_load_gate; then
  echo "   ✅ 负载 ${HOST_LOAD_READING} ≤ ${HOST_LOAD_LIMIT}"
else
  echo "   ❌ 负载 ${HOST_LOAD_READING} 没过（阈值 ${HOST_LOAD_LIMIT}）"
  GATES="$GATES,load"
fi
# 🔴 「内存」这一格：这台机上的弹窗与失控是**内存形状**的，产品负责人的硬规矩第二条
#    是「测试开始之前必须探查好系统还剩多少内存」—— 那条规矩在此之前只有话、没有装置。
#    判据与设备验收共用 `host_memory_gate`（占物理内存的百分比，不写死 GB、不拿 swap 当地板；
#    读不到数字按**探针故障**判不过）。
host_memory_gate || GATES="$GATES,mem"
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

# 🔴 「载体」这一格：**拍的树必须就是锚点声称的那一份**。
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
  echo "   全部前置门都绿，**但没有 --confirm ⇒ 一张图都没重拍、一个字节都没动**。"
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
  settle_dir "$d" "$s" || FAIL=$((FAIL + 1))
done <<PLAN_BLOCK
$PLAN
PLAN_BLOCK

echo "== 5. 复跑对账 =="
bash "$R17" --all 2>&1 | grep -E '^(ALLCHECK|UISTALE|❌|✅)' | sed 's/^/   /'
echo "   ⇒ 还报 UISTALE 的那些**是预期的**：锚点钉的是「看过旧字节的那个人」的时刻。"
echo "     下一步（脚本不替你做）：逐张打开新图 → 改「人看到的」→ 把 UIPIN 的 pin 换成当前提交。"
[ "$FAIL" = "0" ] || { echo "❌ $FAIL 个目录的 spec 失败，未放回字节" >&2; exit 1; }
exit 0
