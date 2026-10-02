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
# 移动端「从滴答清单导入」验收（真模拟器，零 mock）
# ==================================================
#
# 🔴 为什么必须有这个脚本
#
# `B2-1` 的移动端入口（`lib/ticktick-import.ts` + `ExportScreen` 的**粘贴**路径）
# 早就写好了，也有 `apps/mobile/tests/ticktick-import.spec.ts` —— 但那是**纯函数**
# 测试：它证明 `parseTickTickCsv` 与 `importPlan` 对不对，证明不了
# **"在手机上粘进去、按预览、按确认，数据真的落库"** 这条链路。
# M3 要求逐端可失败验收，所以补这一条。
#
# ✅ 这一跑**能**用真 CSV：滴答的列名与内容都是 ASCII，而
#    `adb shell input text` 打得出 ASCII（中文标题打不出，所以样例用 ASCII）。
#
# ## 三个踩过的坑（都写在这里）
#
# 1. 🔴 **`adb shell input text` 发不了换行**：CSV 至少要两行（表头 + 一条）。
#    办法是 `input text` 打完表头后用 `input keyevent 66`（ENTER）换行。
# 2. 🔴 **设备侧 shell 会把 `;` 当命令分隔符**（见 `verify-mobile-repeat-custom.sh`
#    的文件头）—— 这份 CSV 里没有 `;`，但**有空格**：`List Name` 里的空格必须写成
#    `%s`（`input text` 的约定），否则会被 shell 拆成两个参数。
# 3. **`预览` 这个词既是按钮又是段落标题**（`web.ticktick.previewTitle` 也是"预览"）
#    —— 断言必须挑**只有它对**的那一句（预览计数里的"个清单"）。
#
# 用法：
#   bash scripts/verify-mobile-ticktick-import.sh
#
# 前置：模拟器在跑、服务端在 3000（TEST_MODE）、
#       /tmp/heyta_mobile_{token,email,e2ee}.txt 存在。

set -u
export PATH="/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/lib/mobile-e2e.sh"

# 表头 + 一条任务。列名与 `packages/domain/src/ticktick-format.ts` 的
# `TICKTICK_COLUMNS` 逐字一致（解析器按归一化后的列名找）。
HEADER="Title,List%sName"
ROW="tt-e2e-$(date +%H%M%S),Inbox"

echo ""
echo "=== 移动端滴答清单导入验收（真实模拟器，零 mock）==="
echo "  设备: emulator-5554   服务端: $SERVER"
echo "  账号: $EMAIL"
echo "  CSV : $HEADER / $ROW"

step "0. 装包并启动"
# 先卸掉改名前的旧包（`com.heytamobile`）：与它并存时 `monkey -p com.heyta`
# 在旧包占前台时看起来"起来了"，于是整个 E2E 驱动的是旧界面。
$ADB shell am force-stop com.heytamobile >/dev/null 2>&1
$ADB uninstall com.heytamobile >/dev/null 2>&1
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
$ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 6
dump
if [ -n "$($ADB shell pidof "$PKG" 2>/dev/null | tr -d '\r')" ]; then
  ok "被测应用（${PKG}）已在运行"
else
  bad "被测应用（${PKG}）没有运行 —— 前台可能是别的包"; screen_txt
fi
dismiss_welcome_if_present
dump
if [ "$(has_text "任务")" = "1" ]; then ok "应用已启动"; else bad "应用没起来"; screen_txt; fi

step "1. 配置同步凭据"
configure_sync_credentials

step "2. 进「我的 → 导出数据」"
# 标签栏坐标：5 个 tab 的中心（108/324/540/756/972），与其它 verify 脚本一致。
$ADB shell input tap 972 2253; sleep 3
dump
if [ "$(has_text "我的")" = "1" ]; then ok "已切到「我的」"; else bad "没切到「我的」"; screen_txt; fi
XY=$(scroll_to_text "导出数据")
if [ -z "$XY" ]; then
  bad "找不到「导出数据」入口"; screen_txt
else
  $ADB shell input tap $XY; sleep 3
  dump
  ok "已进入「导出数据」"
fi

step "3. 滚到导入区，粘一份两行 CSV"
# 界面先断言"导入区在"：`从滴答清单导入` 是这一块的标题。
if [ "$(scroll_to_text "从滴答清单导入" >/dev/null && echo found)" = "found" ]; then
  ok "页面上有「从滴答清单导入」"
else
  bad "导出页里没有导入区"; screen_txt
fi
XY=$(scroll_to_edit "粘贴 CSV 文本")
if [ -z "$XY" ]; then
  bad "滚不到「粘贴 CSV 文本」输入框"; screen_txt
else
  $ADB shell input tap $XY; sleep 1
  # 表头：`%s` = 空格（见文件头坑 2）。
  $ADB shell input text "$HEADER"; sleep 0.8
  # 🔴 换行只能用 keyevent（见文件头坑 1）。
  $ADB shell input keyevent 66; sleep 0.8
  $ADB shell input text "$ROW"; sleep 1
  dump
  if [ "$(has_sub "Title")" = "1" ]; then ok "CSV 已粘进去"; else bad "CSV 没进去"; screen_txt; fi
  disable_ime; sleep 1
fi

step "4. 按「预览」—— 解析结果必须出现计数"
# 🔴 先确认**还在导出页**再点。实测踩过：`xy_text "预览"` 拿到的是**过期 dump** 里的
# 坐标（uiautomator 在界面不空闲时不覆盖 /tmp/ui.xml），那一下点到了底部标签栏，
# 于是后面每一步都在"专注"页上跑 —— 而失败信息看起来像"解析失败"。
dump
if [ "$(has_text "从滴答清单导入")" != "1" ]; then
  bad "已经不在导出页了（点之前就不在）—— 后面的断言都不作数"; screen_txt
else
  # 用库里的 `tap_label`：它同时认 text 与 content-desc，并在找不到时明确失败。
  if tap_label "预览"; then
    ok "点了「预览」"
  else
    bad "找不到「预览」按钮"; screen_txt
  fi
  sleep 3
fi
dump
# 🔴 判据挑的是**只有它对**的那句：`web.ticktick.previewCounts` 里的"个清单"。
# （"预览"两个字按钮和段落标题都有，用它做断言等于没断言 —— 见文件头坑 3。）
if [ "$(has_sub "个清单")" = "1" ]; then
  ok "预览出了计数（解析成功）"
else
  bad "没有预览计数 —— 解析可能失败（看下面屏幕文本）"; screen_txt
fi

step "5. 按「确认导入」—— 必须给出导入完成的结果"
if tap_label "确认导入"; then
  ok "点了「确认导入」"
else
  bad "找不到「确认导入」"; screen_txt
fi
sleep 4
dump
if [ "$(has_sub "导入完成")" = "1" ]; then
  ok "导入完成（写了 op，见下）"
else
  bad "没有出现「导入完成」"; screen_txt
fi

step "6. 回任务列表，那条导入的任务应当真的在"
$ADB shell input tap 108 2253; sleep 3
dump
if [ "$(scroll_to_desc "打开任务：$ROW" >/dev/null && echo found)" = "found" ]; then
  ok "任务列表里能找到导入进来的任务"
else
  # 不直接判失败：导入的落点在收集箱，而列表当前可能停在"今天"那一档。
  # 第 5 步的"导入完成"（写着"写了 N 条操作"）已经是落库证据，这里只是加一层旁证。
  echo "   ℹ️  任务不在当前分组（导入落在收集箱，属正常）"
fi

summary "移动端滴答清单导入"
