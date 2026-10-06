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
# 移动端「习惯」屏验收（真模拟器，零 mock）—— 工单 H12
# =====================================================
#
# 🔴 为什么必须有这一份，而不是"再截一次图"
#
# `apps/mobile/evidence/android-habits-*.png` 那 9 张**早就在仓库里**（10-01 17:2x），
# 但产它们的那枚一次性脚本**没有入库** ⇒ 在当前产物上**无法复跑**。
# 后果不是"少几张图"，是这一整面**没有判据**：习惯屏自 10-01 之后落了
# H2（新建入口）/ H3（图标选择器）/ H4（月历 + 补打卡）/ H5（frequency 写入口）
# 四批改动，而设备侧**没有任何一层**会因为它们坏掉而变红。
# 成长屏（`GrowthScreen`）读的是同步过来的连续数字，它绿只证明"数字算出来了"，
# 不证明"习惯那一屏画在当前装出来的包里"。
#
# 与 §6.1.1 那三行"测试全绿 ≠ 这是当前产物"是同一条，缺的是**第四种面目**：
# 门禁与单测全都在 JS 层，装机态那一屏从来没人量。
#
# ─────────────────────────────────────────────────────────────────────────
# 八条判据，每条都把"点了"与"生效了"分开证
#
#   ① 装的是**这一批源码**打出来的包（`apk-freshness` 那条 mtime 对账，不是"装上了"）
#   ② 空态：习惯那一屏**进得去**，且空态文案在（挡"入口接了但屏是白的"）
#   ③ 手机上建一条习惯 → 手机本地库**恰好 1 条 `HABIT/ADD`**（不是"界面出现了它"）
#   ④ 清单里那一行的 aria 数字与本地库对得上（`连续 0 天` ⇒ 没把"渲染"当"物化"）
#   ⑤ 详情里点今天 → `HABIT_LOG/ADD` **恰好 1 条**，且清单那一行变成 `连续 1 天`
#      （打卡是"写了一条 op"，不是"格子变了颜色"）
#   ⑥ **杀掉进程重开**之后仍是已打卡（本地优先的判据：状态在库里，不在 React 里）
#   ⑦ 暗色不是"截图变暗"：同一屏 light/dark 的**主色亮度**必须真的翻面，
#      且两边都还数得出主蓝（挡"暗色只是叠了一层黑"与"暗色把品牌色丢了"两种假绿）
#   ⑧ 撤销 → `HABIT_LOG` 多**恰好 1 条 DEL**、`连续` 回到 0；随后**笔记本**同步后
#      读得到这条 HABIT 与那次打卡的痕迹（跨设备，不是本机自说自话）
#
# 🔴 ③⑤⑧ 三条都写成**数 op 的条数**，不是"有没有那条 op"。理由与
#    `verify-mobile-trash.sh` 第 6b 步同一条：一个用户意图 = 一个 op（AGENTS §3.4），
#    而"多写一条"在界面上**完全看不出来** —— 清单仍然显示连续 1 天。
#
# ⚠️ 载体：真模拟器 `emulator-5554` + 真服务端（**TEST_MODE**）+ 真笔记本设备
#    （`apps/node-host`，独立 SQLite 文件）。全部零 mock。
#    跑法（仓库根）：`bash scripts/verify-mobile-habits.sh`
#    前置：模拟器在跑、Postgres 在 5432、服务端在 3000（`PORT=…` 时改 `E2E_PORT`），
#          且**装的是当前源码的包**：`pnpm build:android && adb install -r …`
#          （或直接 `pnpm reinstall:mobile`）。
#    账号每轮新建并写入 /tmp/heyta_mobile_{token,email,e2ee}.txt。
#
# ⚠️ 标题必须 ASCII：`adb shell input text` 发不了非 ASCII（实测抛异常却可能退 0，
#    §7 第 43 条）。习惯名同理。
#
# ⚠️ **看退出码时不要接管道**（§7 第 45 条）：`bash 这个脚本 | tail` 之后 `$?` 是
#    `tail` 的。要判退出码就 `bash 脚本; echo $?`。
#
set -u
export PATH="/opt/homebrew/bin:$PATH"

# ── 先准备账号，再加载共享库（顺序不能反，理由见 verify-mobile-conflict.sh）──
. "$(dirname "$0")/lib/mobile-e2e-fresh-account.sh"
heyta_e2e_ensure_account || exit 1
. "$(dirname "$0")/lib/mobile-e2e.sh"
. "$(dirname "$0")/lib/wait-for-quiet-host.sh"
. "$(dirname "$0")/lib/apk-freshness.sh"

BUSY=$(another_mobile_e2e_running)
if [ -n "$BUSY" ]; then
  echo "❌ 这台设备上还有别的移动端验收在跑：$BUSY"
  echo "   两边都会 pm clear + 装包 + 按坐标点击，并行 = 互相清掉对方的现场。"
  exit 3
fi
step "负载门"
wait_for_quiet_host || exit 3

HEALTH=$(curl -s --noproxy '*' -m 5 "${HOST_SERVER}/health" 2>/dev/null)
if ! printf '%s' "$HEALTH" | grep -q '"status":"ok"'; then
  echo "❌ 服务端没在 ${HOST_SERVER}（/health 返回：${HEALTH:-空}）—— 环境未就绪，**不是产品失败**"
  exit 3
fi
echo "   服务端就绪：${HOST_SERVER}"

LAPTOP_DB=/tmp/heyta-habits-laptop.sqlite
PHONE_DB=/tmp/heyta-habits-phone.sqlite
rm -f "$LAPTOP_DB" "$PHONE_DB"
EVIDENCE="$HEYTA_REPO_ROOT/apps/mobile/evidence"
mkdir -p "$EVIDENCE"

# 🔴 装机判据 ① 的**配对**：APK 与"它是由哪一棵树打出来的"必须一起给。
#    默认是主检出；如果这一枚包是在**隔离载体**里打的（共享检出上有别线未提交改动时
#    就该这么做，否则包会把别人的 WIP 一起打进去），要把那一棵根一起指过来：
#      HEYTA_HABITS_APK=…/app-release.apk HEYTA_HABITS_APK_ROOT=…/载体 bash scripts/verify-mobile-habits.sh
#    ⚠️ 只指 APK 不指 ROOT 会让这条 mtime 对账拿**主检出的源码**去比**载体打的包** ——
#    那种比法两种结果都没有意义（别线刚存过盘就必然判"过期"，反之亦然）。
APK="${HEYTA_HABITS_APK:-$HEYTA_REPO_ROOT/apps/mobile/android/app/build/outputs/apk/release/app-release.apk}"
APK_ROOT="${HEYTA_HABITS_APK_ROOT:-$HEYTA_REPO_ROOT}"

# 🔴 复用 10-01 那批证据的**同一组文件名**：那 9 张本来就是这一面的装机判据，
#    只是当时没有产它们的装置。新装置产出的图应当**顶掉**旧图，而不是再起一套
#    前缀留下两份"哪个是当前的"要人猜。旧图在 git 里，随时可 diff 回来。
SHOTS=(1-empty 2-list 3-detail 4-checked 5-list-after-checkin 6-list-after-restart \
       7-dark-list 8-dark-detail 9-undo)

# ── 辅助 ────────────────────────────────────────────────────

phone_db_pull() {
  $ADB root >/dev/null 2>&1; sleep 2
  $ADB pull /data/data/com.heyta/databases/heyta.sqlite "$PHONE_DB" >/dev/null 2>&1
  $ADB unroot >/dev/null 2>&1
}

# 某实体某类 op 的条数。**读数拿不到不当作 0**：空串原样返回，调用方必须判空。
# ⚠️ JSON 路径是 `$.op.entityType`，不是 `$.entityType`（`data` 列是嵌套结构）。
# opType 传 `*` = 不按类型过滤（数"这个实体一共写了几条"，⑧ 那一档要的就是这个）。
op_count() {  # <sqlite 文件> <entityType> <opType|*> [entityId]
  local f=$1 et=$2 ot=$3 id=${4:-} q
  [ -f "$f" ] || { echo ""; return; }
  q="SELECT COUNT(*) FROM ops WHERE json_extract(data,'\$.op.entityType')='$et'"
  [ "$ot" != "*" ] && q="$q AND json_extract(data,'\$.op.opType')='$ot'"
  [ -n "$id" ] && q="$q AND json_extract(data,'\$.op.entityId')='$id'"
  sqlite3 "$f" "$q;" 2>/dev/null | tr -d ' '
}

shot() {  # <名字> —— 落一张带序号前缀的 PNG，并且**必须**是非空白的
  # ⚠️ 两条 `local` 分开写：macOS 的 bash 3.2 在**同一条** `local a=1 b="…$a…"` 里
  #    求值 `b` 时 `a` 还没赋值，配上 `set -u` 直接 "unbound variable"（实测撞过）。
  local name=$1
  local out="$EVIDENCE/android-habits-$name.png"
  rm -f "$out"
  $ADB exec-out screencap -p > "$out" 2>/dev/null
  if [ ! -s "$out" ]; then bad "截图没落盘：$out"; return 1; fi
  echo "   📸 $out"
}

# 装机判据的**图像那一半**：非空白 + 数得出主蓝 + （暗色对照时）主色亮度真的翻面。
img_stats() {  # <路径> [对照路径] —— 打印 "modalLuminance blue blank"
  node --input-type=module -e '
    const m = await import("./scripts/screenshots/png-stats.mjs");
    const a = m.inspectPng(process.argv[1]);
    const blue = m.countBrandBlue ? m.countBrandBlue(process.argv[1]) : 0;
    let ref = "";
    if (process.argv[2]) {
      const b = m.inspectPng(process.argv[2]);
      ref = " refModal=" + b.modalLuminance;
    }
    console.log([a.modalLuminance, blue, m.looksBlank(a) ? 1 : 0].join(" ") + ref);
  ' "$@" 2>/dev/null
}

# 一条图判据：非空白、数得出主蓝。暗色那一档还要"主色亮度比亮色档低"。
judge_shot() {  # <标签> <路径> [暗色对照路径]
  local label=$1 path=$2 ref=${3:-} s blank blue modal refmodal
  s=$(img_stats "$path" ${ref:+"$ref"}); [ -n "$s" ] || { bad "$label：png-stats 没读数（探针坏了，不算产品失败）"; return 1; }
  read -r modal blue blank refmodal <<< "$s"
  if [ "$blank" = "1" ]; then bad "$label：截图是空白的"; return 1; fi
  if [ "${blue:-0}" -lt 1 ]; then bad "$label：数不出 heyta 主蓝（$blue）—— 装出来的不是我们的界面"; return 1; fi
  if [ -n "$refmodal" ] && [ "$(python3 -c "print(1 if $modal < $refmodal - 40 else 0)")" = "0" ]; then
    bad "$label：暗色档主色亮度 $modal 没比亮色档 $refmodal 暗 40 以上 ⇒ 主题没真的翻面"; return 1
  fi
  ok "$label：非空白 · 主蓝 $blue${refmodal:+ · 亮度 $modal vs $refmodal}"
}

# 底部 5 个 tab 的中心 x（1080 宽均分，见 verify-mobile-calendar.sh 那段推导）。
TAB_TASKS=108; TAB_CALENDAR=324; TAB_FOCUS=540; TAB_CATEGORIES=756; TAB_PROFILE=972
TAB_Y=2253

go_habits() {  # 我的 → 习惯（第二层；入口在 10-01 之后没挪过位置）
  $ADB shell input tap "$TAB_PROFILE" "$TAB_Y"; sleep 2
  # scroll_to_text 会把探到的坐标打到 stdout —— 不接走就会混进验收读数里
  scroll_to_text "习惯" >/dev/null
  xy=$(xy_text "习惯" 0); [ -n "$xy" ] || { bad "「我的」里找不到「习惯」入口"; return 1; }
  $ADB shell input tap $xy; sleep 3
  return 0
}

# ── 开始 ────────────────────────────────────────────────────

echo ""
echo "=== 移动端习惯屏装机验收（零 mock）==="
echo "  设备: $E2E_SERIAL   服务端: $SERVER   账号: $EMAIL"

HABIT_NAME="habits-e2e-$(date +%H%M%S)"

step "1. 装包并启动（① 装的是这一批源码）"
heyta_apk_freshness_guard "$APK" "习惯验收" "$APK_ROOT" || {
  echo "❌ APK 不比源码新 —— 先 pnpm build:android（或 reinstall:mobile）再跑这一条"
  exit 1
}
$ADB uninstall com.heyta >/dev/null 2>&1
INSTALL=$($ADB install -r -t "$APK" 2>&1)
case "$INSTALL" in
  *Success*) ok "全新安装：Success" ;;
  *) bad "安装失败：$(printf '%s' "$INSTALL" | head -2)"; exit 1 ;;
esac
launch_app; sleep 8
ensure_app_foreground || { blame_crash; exit 1; }
dismiss_permission_dialog
handle_privacy_consent
dismiss_welcome_if_present
require_screen

step "2. 配置同步凭据并首次同步"
configure_sync_credentials || exit 1
# 🔴 填完凭据**不等于**同步开始了：`configure_sync_credentials` 只负责把三个字段
#    填进去并确认"界面认为已配置"，真正发起同步要点「立即同步」那一下
#    （`verify-mobile-calendar.sh` 的第 3 步就是这一档）。少了它，下面等的
#    就不是"派生慢"而是"根本没人发起"，而两者的输出长得一样（§7 元规则一）。
$ADB shell input tap "$TAB_PROFILE" "$TAB_Y"; sleep 3
dump
if XY=$(tap_label "立即同步"); then
  echo "     首次同步含一次纯 JS 的 Argon2id 派生，实测 30–900 秒 ⇒ 等 180 轮 × 5s"
  T=$(wait_synced 180)
  if [ -n "$T" ]; then ok "首次同步完成（约 $T 秒）"; else bad "首次同步未完成（900 秒）"; exit 1; fi
else
  bad "找不到「立即同步」按钮 —— 凭据面板没走完，不是同步慢"
  exit 1
fi

step "3. ② 空态：习惯那一屏进得去，且空态文案在"
go_habits || exit 1
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
$ADB shell cat /sdcard/ui.xml > "$UI_XML" 2>/dev/null
if [ "$(has_text '还没有习惯。添加一个开始打卡。')" = "1" ]; then
  ok "空态文案在（这一屏画出来了，不是白屏）"
else
  bad "空态文案不在 —— 入口接上了但那一屏没画对"
fi
shot 1-empty && judge_shot "①-② 空态图" "$EVIDENCE/android-habits-1-empty.png"

step "4. ③ 建一条习惯 → 本地库恰好 1 条 HABIT/ADD"
if [ "$(has_text '新习惯名称')" = "1" ]; then
  xy=$(xy_text "新习惯名称" 0)
else
  scroll_to_text "新习惯名称" >/dev/null
  xy=$(xy_text "新习惯，例如「喝水」" 0)
fi
[ -n "${xy:-}" ] || { bad "找不到新建习惯的输入框"; exit 1; }
$ADB shell input tap $xy; sleep 1
disable_ime
clear_and_type "$HABIT_NAME"
tap_label "添加习惯" || { bad "「添加习惯」没点到"; exit 1; }
sleep 3
phone_db_pull
HID=$(sqlite3 "$PHONE_DB" "SELECT json_extract(data,'\$.op.entityId') FROM ops WHERE json_extract(data,'\$.op.entityType')='HABIT' ORDER BY seq LIMIT 1;" 2>/dev/null | tr -d ' ')
BEFORE_H=$(op_count "$PHONE_DB" HABIT ADD "$HID")
# 🔴 数的是**这一条习惯**的 ADD 条数，不是"HABIT/ADD 有没有"：一个用户意图 = 一个 op
#    （AGENTS §3.4），而"多写一条"在界面上完全看不出来。
if [ "${BEFORE_H:-}" = "1" ]; then ok "手机本地库里这条习惯恰好 1 条 HABIT/ADD"; else bad "HABIT/ADD 条数 = ${BEFORE_H:-读不到}（期望 1）"; fi
[ -n "$HID" ] && ok "拿到习惯 entityId（${HID:0:8}…）" || bad "拿不到习惯 entityId"

step "5. ④ 清单里那一行的 aria 数字与物化对得上"
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml > "$UI_XML" 2>/dev/null
if [ "$(has_text "$HABIT_NAME")" = "1" ] || [ "$(has_desc_sub "$HABIT_NAME")" = "1" ]; then
  ok "新建的那条出现在清单里"
else
  bad "清单里没有新建的那条"
fi
if [ "$(has_desc_sub '连续 0 天')" = "1" ]; then
  ok "行 aria 是「连续 0 天」（刚建、没打卡 —— 数字来自物化状态而不是写死的文案）"
else
  bad "行 aria 里没有「连续 0 天」"
fi
shot 2-list && judge_shot "④ 清单图" "$EVIDENCE/android-habits-2-list.png"

step "6. ⑤ 详情里点今天 → HABIT_LOG/ADD 恰好 1 条，行 aria 变连续 1 天"
xy=$(xy_text "$HABIT_NAME" 0)
[ -n "$xy" ] || { bad "清单里点不到那条（拿不到坐标）"; exit 1; }
$ADB shell input tap $xy; sleep 3
require_screen
shot 3-detail && judge_shot "⑤ 详情图" "$EVIDENCE/android-habits-3-detail.png"
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml > "$UI_XML" 2>/dev/null
# ⚠️ 这一格是**截出来的片段**，不是整条词条：表里那条是
#    `web.habits.month.today` = `{date}，今天还没打卡`，日期前缀由应用自己拼，
#    所以这里按 content-desc 的**子串**定位（`xy_desc` 走 substring）。
#    与 `verify-mobile-calendar.sh:303` 的 `"${DUE_TITLE}，1 个任务"` 同一族，
#    因此 `check:verify-script-copy` 把它列进"插值 needle / 需人读"而不是判命中。
TODAY_TAIL="今天还没打卡"
xy=$(xy_desc "${TODAY_TAIL}" 0)
[ -n "$xy" ] || { bad "详情里找不到「今天还没打卡」那一格"; exit 1; }
$ADB shell input tap $xy; sleep 3
phone_db_pull
LOG_ADD=$(op_count "$PHONE_DB" HABIT_LOG ADD "$HID")
if [ "${LOG_ADD:-}" = "1" ]; then ok "HABIT_LOG/ADD 恰好 1 条"; else bad "HABIT_LOG/ADD 条数 = ${LOG_ADD:-读不到}（期望 1）"; fi

step "7. 回清单：那一行必须变成「连续 1 天」"
$ADB shell input keyevent KEYCODE_BACK; sleep 2
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml > "$UI_XML" 2>/dev/null
if [ "$(has_desc_sub '连续 1 天')" = "1" ]; then ok "行 aria 变成「连续 1 天」"; else bad "行 aria 没变（还是 0 天？）"; fi
shot 4-checked && judge_shot "⑤ 打卡后详情/清单图" "$EVIDENCE/android-habits-4-checked.png"
shot 5-list-after-checkin && judge_shot "⑤ 打卡后清单图" "$EVIDENCE/android-habits-5-list-after-checkin.png"

step "8. ⑥ 杀进程重开：状态必须在库里，不在 React 里"
$ADB shell am force-stop com.heyta; sleep 2
launch_app; sleep 8
ensure_app_foreground || { blame_crash; exit 1; }
go_habits || exit 1
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml > "$UI_XML" 2>/dev/null
if [ "$(has_desc_sub '连续 1 天')" = "1" ]; then
  ok "重启后仍是「连续 1 天」（本地优先：这条不依赖网络回来）"
else
  bad "重启后打卡痕迹没了"
fi
shot 6-list-after-restart && judge_shot "⑥ 重启后清单图" "$EVIDENCE/android-habits-6-list-after-restart.png"

step "9. ⑦ 暗色：同一屏 light/dark 的主色亮度必须真的翻面"
LIGHT_REF="$EVIDENCE/android-habits-6-list-after-restart.png"
$ADB shell cmd uimode night yes; sleep 3
$ADB shell am force-stop com.heyta; sleep 1
launch_app; sleep 8
ensure_app_foreground || blame_crash
go_habits || true
shot 7-dark-list
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml > "$UI_XML" 2>/dev/null
judge_shot "⑦ 暗色清单图" "$EVIDENCE/android-habits-7-dark-list.png" "$LIGHT_REF"
xy=$(xy_text "$HABIT_NAME" 0); [ -n "$xy" ] && { $ADB shell input tap $xy; sleep 3; }
shot 8-dark-detail && judge_shot "⑦ 暗色详情图" "$EVIDENCE/android-habits-8-dark-detail.png" "$LIGHT_REF"
$ADB shell cmd uimode night no; sleep 2

step "10. ⑧ 撤销 → HABIT_LOG/DEL 恰好 1 条、连续回到 0，然后笔记本读得到"
$ADB shell am force-stop com.heyta; sleep 1
launch_app; sleep 8
ensure_app_foreground || blame_crash
go_habits || true
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml > "$UI_XML" 2>/dev/null
xy=$(xy_desc "撤销「$HABIT_NAME」" 0)
[ -n "$xy" ] || { bad "找不到撤销那一下（aria 里没有「撤销「…」今日打卡」）"; exit 1; }
$ADB shell input tap $xy; sleep 3
phone_db_pull
LOG_DEL=$(op_count "$PHONE_DB" HABIT_LOG DEL "$HID")
if [ "${LOG_DEL:-}" = "1" ]; then ok "HABIT_LOG/DEL 恰好 1 条"; else bad "HABIT_LOG/DEL 条数 = ${LOG_DEL:-读不到}（期望 1）"; fi
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $ADB shell cat /sdcard/ui.xml > "$UI_XML" 2>/dev/null
if [ "$(has_desc_sub '连续 0 天')" = "1" ]; then ok "撤销后行 aria 回到「连续 0 天」"; else bad "撤销后 aria 没回到 0 天"; fi
shot 9-undo && judge_shot "⑧ 撤销后图" "$EVIDENCE/android-habits-9-undo.png"

phone_sync || bad "手机侧最终同步没完成（跨设备那一半只能等）"
ROUNDS="${HEYTA_HABITS_LAPTOP_ROUNDS:-120}"
i=0; seen=""
while [ "$i" -lt "$ROUNDS" ]; do
  laptop_raw sync >/dev/null 2>&1
  seen=$(op_count "$LAPTOP_DB" HABIT ADD "$HID")
  [ "${seen:-0}" != "0" ] && break
  i=$((i+1)); sleep 5
done
if [ "${seen:-0}" != "0" ]; then
  ok "笔记本读到了那条 HABIT（跨设备物化）"
  LOGS=$(op_count "$LAPTOP_DB" HABIT_LOG '*' "$HID")
  echo "   （笔记本侧该习惯的 HABIT_LOG 条数 = ${LOGS:-读不到}；打卡 + 撤销各 1 ⇒ 期望 2）"
  [ "${LOGS:-}" = "2" ] && ok "两次写入都到了对端" || bad "对端 HABIT_LOG 条数 = ${LOGS:-读不到}（期望 2）"
else
  bad "笔记本在 $((ROUNDS*5)) 秒里没读到那条习惯 —— 跨设备没闭环"
fi

summary "移动端习惯屏装机验收"
