#!/bin/bash

# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 对脚本是按字节偏移
#    增量读取的：运行中被编辑，后半段就从错位字节开始解析，炸出假语法错误。
#    入口先把整份脚本拷成同目录隐藏快照再 exec 副本 —— 之后对源文件的任何
#    编辑都影响不到本次运行；$0 的 dirname 不变，lib/tools 定位照旧。
#    快照名 .原名.snap.PID（进 .gitignore）；trap 尽力清理，被 kill -9 留下的
#    由下一次运行按 mmin +240 顺带扫掉。
case "$(basename "$0")" in
  .*.snap.*) ;; # 已是快照：正常往下跑
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    find "$_snap_dir" -maxdepth 1 -name ".$(basename "$0").snap.*" -mmin +240 -delete 2>/dev/null || true
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" > "$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac
trap 'rm -f -- "$0"' EXIT
#
# 清单 / 标签 / 归档这三处**删除与归档确认**的真机读数（零 mock、真模拟器、离线模式）
# ========================================================================
#
# 🔴 为什么必须有这个脚本
#
# 这一族的形状是「**问不问**」而不是"画得对不对"，而"问不问"在真壳上只有三种
# 合法答案，两把 jsdom 尺各钉住其中一部分，没有一把打在这三格上：
#
#   ① 标签那一列**永远问**（它不进回收站，删了没地方捞 ⇒ 数字为 0 也要问）
#   ② 标签：点「确认删除」才恰好写那一条 op，取消**一条都不写**
#   ③ 清单那一列**有后果才问**（`askOnlyWhenImpact`）⇒ 删一条**空**清单是一键
#   ④ 归档那一格同一条闸门：`archiveChildImpact <= 0` 就一键
#      ⇒ **叶子清单归档不该被问**（这一条是反向判据：有人把归档改成"永远问"，这里红）
#
# 三条判据问的都是**本地界面行为** ⇒ 整趟跑在「只用本机」的离线模式，
# 不需要服务端与 Postgres（与 `verify-mobile-trash.sh` 那条跨设备链分开，各自能单独重跑）。
#
# ⚠️ **本脚本不证**那两句带数字的后果（"它下面还有 N 条子清单" /
#    回收站彻底删除那句"永久失去入口"）。它们要一条**有子**的文件夹，
#    而移动端造父子的唯一入口是拖拽（`ListsSection` 的 dnd 那一支），
#    `input swipe` 下不可靠 ⇒ 收尾里**响亮地报未取证**，不折成通过、也不折成失败。
#    数字那一半钉在 `apps/web/tests/projects-panel.spec.tsx` 与
#    `apps/mobile/tests/projects-sections.spec.ts`。
#
# 🔴 这一版的第 2 条纪律（第一版就是栽在这里）：**前置没成立就不打分。**
#    第一版让"标签没建出来"往下 cascade，于是"确认之后它消失了"与
#    "取消之后它还在"各自拿到一个 ✅ —— 那是 #30 那一格记过的同一个形状
#    （"跳过"与"没命中"在报告里同形）。现在每一格都先看它的前置，
#    前置塌了就打印 ⚠️ 未取证并**明确说明为什么**，不计 PASS/FAIL。
#
# 用法：
#   bash scripts/verify-mobile-organizer-confirm.sh
#   HEYTA_E2E_SERIAL=emulator-5556 bash scripts/verify-mobile-organizer-confirm.sh
#
# 前置：模拟器在跑、`apps/mobile/android/.../app-release.apk` 是刚打出来的那一枚
#       （闸门自己判，且**装上去之前不许有任何设备侧写动作**）。

set -u
export PATH="/opt/homebrew/bin:$PATH"

. "$(dirname "$0")/lib/mobile-e2e.sh"
. "$(dirname "$0")/lib/apk-freshness.sh"
heyta_chain_exit 'restore_ime'

TAG="r98tag"
LIST="r98list"
ARCH="r98arch"
SHOTS="${HEYTA_ORG_CONFIRM_SHOTS:-/tmp/heyta-organizer-confirm}"
mkdir -p "$SHOTS"
SKIP=0

echo "════ 清单/标签/归档确认：真机读数 ════"
echo "  设备: $E2E_SERIAL   载体: $(git -C "$HEYTA_REPO_ROOT" rev-parse --short HEAD)   图: $SHOTS"

# 取一个 content-desc 的坐标并点击；取不到就回 1（**不**打空靶）。
tap_desc() {
  local xy
  xy=$(xy_desc "$1")
  if [ -z "$xy" ]; then echo "   · 取不到「$1」的坐标" >&2; return 1; fi
  $ADB shell input tap $xy
}

# 进「我的」→ 某一节。<节名> <该节独有的锚点串>。
# 🔴 底部那一枚「我的」用 `xy_desc` 而不是 `tap_label`：后者走的是 `desc-sane`
#    （只认"滚进可点区域"的节点），而标签栏那枚按钮过不了那道筛 —— 实测
#    `tap_label 我的` 静默返回空、界面根本不动，于是后面每一步都在**任务页**上打靶。
open_section() {
  local want=$1 anchor=$2 xy
  # 🔴 **已经在「我的」页就别再点那一枚 tab。** 实测：从某一节（标签）按 BACK 回到
  #    「我的」之后，再点一次 tab 会把页面重挂一遍，「设置」那一行在重挂期间读不到
  #    ⇒ 上一轮就是栽在这里（诊断行「点了「我的」却没等到「设置」」）。
  #    所以先看树：有「设置」就直接往下走，没有才去点 tab。
  dump
  [ "$(has_text "设置")" = "1" ] && { :; } || {
    xy=$(xy_desc "我的"); [ -z "$xy" ] && { echo "     · 取不到「我的」那一枚 tab" >&2; return 1; }
    $ADB shell input tap $xy; sleep 2
    settle_for "设置" 6 2 >/dev/null || { echo "     · 点了「我的」却没等到「设置」" >&2; return 1; }
  }
  # 🔴 那一行是 `SettingsRow`，它的可辨识名在 **content-desc** 上（实测 `xy_desc 标签`
  #    给得出坐标，而 `scroll_to_text` 走的是 text-sane 那一把尺，拿不到）。
  #    两种都试，顺序固定：先 desc，退到 text。
  # 🔴 必须走**会滚动**的那一把尺：`xy_desc` 只读当前树，而「清单」那一行常在折叠线以下
  #    —— 它给得出坐标（甚至是个负高度矩形的中心），点上等于什么都没点。
  #    `scroll_to_desc` 会自己滚到"滚进可点区域"为止（desc-sane）。
  xy=$(scroll_to_desc "$want"); [ -z "$xy" ] && xy=$(xy_desc "$want")
  [ -z "$xy" ] && { echo "     · 滚过 5 次也没把「$want」那一行滚进可点区域" >&2; return 1; }
  $ADB shell input tap $xy; sleep 2
  settle_for "$anchor" 8 2 >/dev/null || { echo "     · 点了「$want」却没等到锚点「$anchor」" >&2; return 1; }
}

# 造一条行：<名称> <输入框标签> <提交按钮文案>；成功回 0。
create_row() {
  local name=$1 label=$2 submit=$3
  clear_and_type "$name" "$label"
  if [ "$(edit_value "$label")" != "$name" ]; then
    echo "   · 输入框读回的不是「$name」（得到 [$(edit_value "$label")]）" >&2
    return 1
  fi
  tap_label "$submit" >/dev/null 2>&1
  settle_for "$name" 8 2 >/dev/null || return 1
  [ "$(has_sub "$name")" = "1" ]
}

# ── 第 0 步：装的是当前产物吗 ────────────────────────────────
step "0. APK 新鲜度闸门（任何设备侧写动作之前）"
heyta_apk_freshness_guard "$APK" "verify-mobile-organizer-confirm" || {
  bad "装着的那枚 APK 不比源码新 ⇒ 后面所有读数都是在替旧版本作证"
  summary "清单/标签/归档确认" "环境不成立，本轮无效" 3
}
ok "APK 新鲜度闸门通过（文件比源码新）"

step "0b. 把这一枚装上去（闸门只证明文件新，不证明设备上跑的是它）"
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'

# ── 第 1 步：起应用，走离线模式 ──────────────────────────────
step "1. 冷启动 → 只用本机 → 先离线使用"
disable_ime
$ADB shell pm clear "$PKG" >/dev/null 2>&1
launch_app
sleep 6
# 🔴 走共享库那一条路径，不在这里抄一份"点同意卡"的代码：库里那段注释记着
#    五枚脚本各抄一份、各自等的时长与点的按钮不一样，第六个要用的脚本没抄到就整轮假红。
#    「只用本机」是**本脚本**的选择（三条判据全是本地行为），所以只换首选按钮，不换流程。
CONSENT_GATE_PREFERRED="只用本机" dismiss_welcome_if_present
sleep 3
dump; require_screen
if [ "$(has_desc '我的')" = "1" ]; then
  ok "离线模式进入主界面（底部导航在位）"
else
  bad "没进主界面 ⇒ 后面每一格都无从谈起"
  summary "清单/标签/归档确认" "环境不成立，本轮无效" 3
fi

# ── 第 2 步：标签 ────────────────────────────────────────────
step "2. 进「我的 → 标签」并造一条标签「$TAG」"
TAG_OK=0
if ! open_section "标签" "标签名称"; then
  echo "   · 进不去标签那一节（锚点「标签名称」没等到）" >&2
else
  create_row "$TAG" "标签名称" "新建标签" && TAG_OK=1
fi
if [ "$TAG_OK" = "1" ]; then
  ok "标签已建出（列表里读得到「$TAG」）"
else
  echo "   ⚠️ 前置塌了：标签没建出来 ⇒ 判据 ①② 本轮**不打分**（见文件头那条纪律）"
  SKIP=$((SKIP + 1))
fi

if [ "$TAG_OK" = "1" ]; then
  step "3. 判据 ①：点删除**只出确认行**，取消后那条还在"
  if tap_desc "删除标签「$TAG」"; then
    sleep 2; dump; require_screen
    $ADB exec-out screencap -p > "$SHOTS/1-tag-confirm.png" 2>/dev/null
    if [ "$(has_sub "确定要删除「$TAG")" = "1" ] \
       && [ "$(has_desc '确认删除')" = "1" ] \
       && [ "$(has_desc '取消删除')" = "1" ]; then
      ok "标签那一列**数字为 0 也问**：问句 + 确认删除 + 取消删除 三件齐"
    else
      bad "标签删除没先问（问句/确认/取消 缺件）⇒ W4b 拦的那一下点击被放回去了"
    fi
    tap_desc '取消删除' >/dev/null 2>&1; sleep 2
    settle_for "$TAG" 6 2 >/dev/null
    if [ "$(has_sub "$TAG")" = "1" ]; then
      ok "判据 ① 后半：取消之后「$TAG」还在（那一下点击一条 op 都没写）"
    else
      bad "取消却把标签删了 ⇒ 确认框不是一等公民的形状又回来了"
    fi
  else
    echo "   ⚠️ 取不到「删除标签」那一格 ⇒ 判据 ① 本轮**不打分**"
    SKIP=$((SKIP + 1))
  fi

  step "4. 判据 ②：点「确认删除」才恰好删掉它"
  # 第二下要点掉「确认删除」。**先确认那一行真的出来了**再点 ——
  # 上一格刚点过「取消删除」，列表状态会挪，直接连点会打空靶（实测第一轮就是这样）。
  ARM=0
  for _try in 1 2; do
    tap_desc "删除标签「$TAG」" || break
    sleep 2; dump
    [ "$(has_desc '确认删除')" = "1" ] && { ARM=1; break; }
  done
  if [ "$ARM" = "1" ] && tap_desc '确认删除'; then
    sleep 3; dump; require_screen
    if [ "$(has_sub "$TAG")" = "0" ]; then
      ok "确认之后「$TAG」从列表里消失"
    else
      bad "点了确认删除，「$TAG」却还在 ⇒ 确认行没接上写路径"
    fi
  else
    echo "   ⚠️ 那两下点击没打出去 ⇒ 判据 ② 本轮**不打分**"
    SKIP=$((SKIP + 1))
  fi
fi

# ── 第 5 步：清单（空的那一行**不该**问）────────────────────
step "5. 进「我的 → 清单」并造一条空清单「$LIST」"
LIST_OK=0
$ADB shell input keyevent 4 >/dev/null 2>&1; sleep 2
# 上一节可能停在"确认行"上：再按一次 BACK 只把它收掉，不会退出这一节。
$ADB shell input keyevent 4 >/dev/null 2>&1; sleep 2
if open_section "清单" "清单名称"; then
  create_row "$LIST" "清单名称" "新建清单" && LIST_OK=1
fi
if [ "$LIST_OK" = "1" ]; then
  ok "清单已建出（列表里读得到「$LIST」）"
else
  echo "   ⚠️ 前置塌了：清单没建出来 ⇒ 判据 ③ 本轮**不打分**"
  SKIP=$((SKIP + 1))
fi

if [ "$LIST_OK" = "1" ]; then
  step "6. 判据 ③：删一条**空**清单不该先问（闸门 askOnlyWhenImpact 在位）"
  if tap_desc "删除清单「$LIST」"; then
    sleep 2; dump; require_screen
    $ADB exec-out screencap -p > "$SHOTS/2-list-direct-remove.png" 2>/dev/null
    if [ "$(has_sub "确定要删除「$LIST")" = "0" ] && [ "$(has_sub "$LIST")" = "0" ]; then
      ok "空清单一键直删：没出确认行，且那一行当场消失"
    elif [ "$(has_sub "确定要删除「$LIST")" = "1" ]; then
      bad "删一条空清单却先问了 ⇒ 闸门被摘掉（verify-mobile-trash.sh 第 6 步那发点击会被读成没生效）"
    else
      bad "既没出确认行、那一行也还在 ⇒ 那一下点击没生效"
    fi
  else
    echo "   ⚠️ 取不到「删除清单」那一格 ⇒ 判据 ③ 本轮**不打分**"
    SKIP=$((SKIP + 1))
  fi
fi

# ── 第 7 步：归档（叶子那一行**不该**被问）──────────────────
step "7. 造一条待归档的叶子清单「$ARCH」"
ARCH_OK=0
create_row "$ARCH" "清单名称" "新建清单" && ARCH_OK=1
if [ "$ARCH_OK" = "1" ]; then
  ok "清单已建出（列表里读得到「$ARCH」）"
else
  echo "   ⚠️ 前置塌了：清单没建出来 ⇒ 判据 ④ 本轮**不打分**"
  SKIP=$((SKIP + 1))
fi

if [ "$ARCH_OK" = "1" ]; then
  step "8. 判据 ④：归档一条**叶子**清单不该被问（archiveChildImpact<=0 那一档）"
  if tap_desc "归档「$ARCH」"; then
    sleep 2; dump; require_screen
    $ADB exec-out screencap -p > "$SHOTS/3-archive-leaf-direct.png" 2>/dev/null
    if [ "$(has_sub "确定要归档「$ARCH")" = "0" ]; then
      ok "叶子归档一键直写：没有确认行 ⇒ 「有后果才问」这条不对称在归档那一格也成立"
    else
      bad "归档一条没有子的清单却先问了 ⇒ 有人把闸门改成「永远问」，那会打断正常操作"
    fi
  else
    echo "   ⚠️ 取不到「归档」那一格 ⇒ 判据 ④ 本轮**不打分**"
    SKIP=$((SKIP + 1))
  fi
fi

step "9. 未取证那一格（照实报，不折成通过）"
echo "   ⚠️ 那两句**带数字**的后果本轮没有读数："
echo "      · 清单删除确认里「它下面还有 N 条子清单」"
echo "      · 归档确认里「还挂着 N 条子清单 + 整支会跟着收起」"
echo "      · 回收站彻底删除里「那 N 条会永久失去入口」"
echo "      原因：移动端造父子的唯一入口是拖拽（ListsSection 的 dnd），input swipe 不可靠。"
echo "      数字那一半钉在 apps/web/tests/projects-panel.spec.tsx 与 apps/mobile/tests/projects-sections.spec.ts。"
SKIP=$((SKIP + 3))

if [ "$FAIL" -eq 0 ] && [ "$SKIP" -gt 0 ]; then
  summary "清单/标签/归档确认（离线模式，不碰服务端）" \
    "跑到的判据全绿，另有 $SKIP 格未取证（见上，别读成「三处确认框都在设备上验过」）" 0
else
  summary "清单/标签/归档确认（离线模式，不碰服务端）" "真机全链路通过"
fi
