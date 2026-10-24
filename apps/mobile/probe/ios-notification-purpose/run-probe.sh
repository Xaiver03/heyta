#!/usr/bin/env bash
# 取证跑法：装 → 卸（把授权状态打回 notDetermined）→ 装 → 起 → 截图 → 收读数。
#
# 🔴 为什么每一步都不能省：
# · 不 `uninstall` 就永远看不到弹窗（系统每台设备只问一次），那一轮什么都不能说明；
# · 暗号必须**逐轮新生成**（`MARKER`），否则下一张截图可能拍到上一轮的陈旧弹窗（假绿）；
# · 截图与读数必须一起留 —— 只有截图说不清是哪一次申请，只有读数证不了屏幕上有那串。
#
# 判据（三条都要成立，缺一不算取证）：
#   1. `alert-now.png` / `alert-plus8s.png` 某一帧里弹窗正文出现的串
#      **逐字等于** `installed-marker.txt`；
#      对不上 = 拍到的是上一轮残留的弹窗（本装置 2026-10-24 就这么逮住过两次）。
#   2. `installed-marker.txt` 由脚本从**设备容器里那份 plist** 现读，且等于本轮 `$MARKER`
#      （不等就退出，不截图）。
#   3. `app.log` 里有 `PROBE_STATUS_BEFORE=0` —— 这一发确实是"从没问过"的那一次；
#      没有它脚本根本不会走到截图（ readiness 就是这一行，见下面那段）。
# 结论由人读那张图给出（本脚本只负责把东西取回来，不替人下结论）。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UDID="${HEYTA_IOS_UDID:?要显式指定模拟器 UDID（防两台同时在飞时抓错屏）：HEYTA_IOS_UDID=<id> bash run-probe.sh}"
OUT="${HEYTA_PROBE_OUT:-$HERE/../../evidence/ios-notification-purpose-$(date +%Y%m%d)}"
# 🔴 构建产物**不许落进取证目录**（`check:evidence-hygiene` 的口径是"证据目录只存证据"，
#    而一枚 94 KB 的可执行文件加 .app 曾被这套装置拖进去过）。
BUILD="$HERE/build"
MARKER="HEYTA-PURPOSE-$(date +%s)-$RANDOM"
BUNDLE="cloud.finlaw.heyta.notifypurposeprobe"
APP="$BUILD/HeytaNotifyPurposeProbe.app"

mkdir -p "$OUT" "$BUILD"
printf '%s\n' "$MARKER" > "$OUT/marker.txt"

SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"
xcrun --sdk iphonesimulator swiftc -O -sdk "$SDK" -target "$(uname -m)-apple-ios15.0-simulator" \
  -framework UIKit -framework UserNotifications "$HERE/main.swift" -o "$BUILD/HeytaNotifyPurposeProbe"

mkdir -p "$APP"
cp "$BUILD/HeytaNotifyPurposeProbe" "$APP/HeytaNotifyPurposeProbe"
# swiftc 只留 linker 的 ad-hoc 签名，它**不绑 Info.plist**（`codesign -dv` 里是
# "Info.plist=not bound"）。取证要的是"系统读到的那串就是写进 plist 的那串"，
# 所以每次改完 plist 都重签一次，把 plist 封进签名。
write_plist() {
  sed "s/__PURPOSE_MARKER__/$1/" "$HERE/Info.plist.template" > "$APP/Info.plist"
  codesign --force --sign - "$APP" >/dev/null
}

# ⚠️ 这里**不**冷重启设备。原先每轮 `shutdown + boot` 是为了清掉上一轮残留的弹窗，
#    但试过之后否证了它值得这个代价：猜的因果是"冷重启后的第一发才回落到系统自带句式"，
#    而 2026-10-24 21:02 那一轮**没重启、设备已温**，弹窗正文照样是自带那句。
#    重启既不造成也不消除那个现象，就不该为它付"每次多等 90 秒 + 打断别人在用设备"的代价。
#    陈旧弹窗那一头由暗号纪律兜：截图里的串必须逐字等于 `installed-marker.txt`，
#    对不上就重跑（真要清屏时人工重启一次，再连跑两轮、取第二轮）。
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
while [ "$(xcrun simctl list devices | grep "$UDID" | grep -c 'Booted')" = "0" ]; do sleep 1; done

# 🔴 **什么时候可以截图**不由时间表决定，由应用自己的读数决定：容器文件里出现
#    `PROBE_STATUS_BEFORE` 才算通知服务答了话。实测（2026-10-24，同一台设备）：
#    冷启后头几次起，`getNotificationSettings` 35 秒不答、屏上只有白窗；
#    再往后同一枚包 14 秒就答了并弹出授权框 —— "多久能答"没有稳定值。
#    押时间点会稳定产出白屏截图，而白屏截图读起来正好像"系统不读那枚键"（假结论）。
#    所以答不上就重装重起（重装顺手把授权状态打回 notDetermined），有界重试；
#    始终答不上 ⇒ 整轮判废、不截图。
#    （原先这里写的"预热一发就好"是一条**没被复现撑住的**归因，已按实测撤掉。）
write_plist "$MARKER"
READY=0
tick=0
for attempt in $(seq 1 6); do
  xcrun simctl uninstall "$UDID" "$BUNDLE" 2>/dev/null || true
  xcrun simctl install "$UDID" "$APP"
  if ! xcrun simctl launch "$UDID" "$BUNDLE" >"$OUT/launch.out" 2>"$OUT/launch.err"; then
    echo "   第 ${attempt} 次：起进程就失败（$(head -c 100 "$OUT/launch.err" | tr '\n' ' ')）"
    sleep 10
    continue
  fi
  for tick in $(seq 1 10); do
    sleep 3
    DATA_CONTAINER="$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)"
    if [ -f "$DATA_CONTAINER/Documents/heyta-probe.txt" ] \
       && grep -q "PROBE_STATUS_BEFORE" "$DATA_CONTAINER/Documents/heyta-probe.txt"; then
      READY=1
      break
    fi
  done
  if [ "$READY" = "1" ]; then
    echo "READY_AFTER_LAUNCH=$attempt（第 ${attempt} 次起、$((tick * 3)) 秒后通知服务答话）"
    break
  fi
  echo "   第 ${attempt} 次：起了，但 $((tick * 3)) 秒内通知服务没答话"
  xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
  sleep 10
done
if [ "$READY" != "1" ]; then
  echo "❌ 六次都拿不到 PROBE_STATUS_BEFORE ⇒ 通知服务始终没应答，这一轮不算取证。" >&2
  exit 1
fi

# 🔴 把**装进设备的那一份**里的暗号抄进取证目录：弹窗归 SpringBoard 渲染，
#    上一轮残留的弹窗不会因为本轮 uninstall/install 而消失（2026-10-24 实测：
#    截图里是 …1792837114，设备上那份 plist 是 …1792837248）。
#    所以判据不是"截图里出现了 HEYTA-PURPOSE-*"，而是
#    **"截图里出现的串 == installed-marker.txt 里这一轮的串"**。
# `get_app_container … bundle` 给的是**容器目录**，`.app` 在它下面一层。
INSTALLED_APP="$(xcrun simctl get_app_container "$UDID" "$BUNDLE" bundle)/$(basename "$APP")"
plutil -extract NSUserNotificationsUsageDescription raw "$INSTALLED_APP/Info.plist" > "$OUT/installed-marker.txt"
if [ "$(cat "$OUT/installed-marker.txt")" != "$MARKER" ]; then
  echo "❌ 设备上那份 plist 的暗号和本轮注入的不一致，这一轮不算取证。" >&2
  exit 1
fi

# 两帧：服务刚答话那一瞬 + 8 秒后。弹窗是系统进程画的，落屏时间不保证为零。
xcrun simctl io "$UDID" screenshot "$OUT/alert-now.png"
sleep 8
xcrun simctl io "$UDID" screenshot "$OUT/alert-plus8s.png" || true

DATA_CONTAINER="$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)"
if [ -f "$DATA_CONTAINER/Documents/heyta-probe.txt" ]; then
  cp "$DATA_CONTAINER/Documents/heyta-probe.txt" "$OUT/app.log"
else
  : > "$OUT/app.log"
fi
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true

echo "MARKER=$MARKER"
echo "INSTALLED_MARKER=$(cat "$OUT/installed-marker.txt")"
echo "OUT=$OUT"
grep -E "PROBE_" "$OUT/app.log" || echo "（容器读数里没有 PROBE_ 行 ⇒ 这一轮没跑起来，不算取证）"
