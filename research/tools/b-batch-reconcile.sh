#!/bin/bash
# B（四端重装）的**第二条闭合路**：那趟重装若是别人跑完的，本条要的不是"再跑一遍"，
# 而是一条「装上的那份字节 == 本机这一批产物」的对账（AGENTS §7 第 178 条：
# 四端重装的判据回答「装上了、起得来、画的是我们的界面」，**不回答**「装的是不是这一批」）。
#
# 🔴 这条只管**第一段**（已装 == 本机产物）。"本机产物 == 本批源码"那一段**这里不重写**，
#    一律指向仓里已有的那三把（各端不同工具、别复制实现）：
#      mac/android/共享包  → `node scripts/dist-freshness.mjs --only <被测包>`
#      android bundle 内容 → `bash research/tools/r14c-bundle-testid-preflight.sh`
#      windows 源码同步    → `scripts/reinstall-all.sh` 的 `sync_windows_sources()`（sha256 不一致拒绝打包）
#
# 只读：不装、不卸、不杀、不写盘到被测端。设备正被别人的安装趟动着时，取不到就报 unknown，
#        不猜成"不一样"（猜错的方向是假红，方向反了更糟）。
# 退出码：0 = 四段都能测且逐段相同；1 = 至少一段**测出来不同**（这才是 B 未闭合的证据）；
#         3 = 至少一段取不到（环境，不是产品结论）；4 = 装置坏（探针自己立不住，见 --selftest）。
set -u

REPO="${REPO:-$(cd "$(dirname "$0")/../.." && pwd)}"
IOS_DEVICE_NAME="${IOS_DEVICE_NAME:-}"
ANDROID_SERIAL="${ANDROID_SERIAL:-}"
MAC_APP="${MAC_APP:-/Applications/Heyta.app}"
LOCAL_WEB_INDEX="${LOCAL_WEB_INDEX:-$REPO/apps/web/dist/index.html}"
LOCAL_APK_GLOB="${LOCAL_APK_GLOB:-$REPO/apps/mobile/android/app/build/outputs/apk/release}"
ANDROID_PKG="${ANDROID_PKG:-com.heyta}"
IOS_BUNDLE_ID="${IOS_BUNDLE_ID:-com.heyta}"
# 本机那份 iOS 产物的默认位置 = reinstall-all.sh 的 ios 段用的那个 derivedDataPath。
IOS_LOCAL_APP="${IOS_LOCAL_APP:-/tmp/heyta-ios-release/Build/Products/Release-iphonesimulator/Heyta.app}"
# 探针接缝：selftest 用它把"取已装产物"这一层换成一次性夹具。
P_MAC="${P_MAC:-mac_default}"
P_IOS="${P_IOS:-ios_default}"
P_AND="${P_AND:-android_default}"
P_WIN="${P_WIN:-win_default}"

say() { printf '%s\n' "$*"; }
h() { md5 -q "$1" 2>/dev/null | head -1; }

# ───────── 各端：返回 "<已装哈希> <本机产物哈希> <说明>"，取不到时第一项留空 ─────────
mac_probe() {
  local inst loc
  inst=$(h "$MAC_APP/Contents/Resources/web-dist/index.html")
  loc=$(h "$LOCAL_WEB_INDEX")
  [ -z "$inst" ] && { say "MAC|unknown|| .app 里没有 Contents/Resources/web-dist/index.html（装的那份没带共享 UI，或这台没装）"; return 3; }
  [ -z "$loc" ] && { say "MAC|unknown|$inst|本机那份 apps/web/dist/index.html 读不到 ⇒ 先跑构建，别把这一段记成'不同'"; return 3; }
  if [ "$inst" = "$loc" ]; then say "MAC|same|$inst|$loc|装的那份 == 本机 dist"; return 0; fi
  say "MAC|DIFFER|$inst|$loc|装的是**另一次**构建的共享 UI"; return 1
}

ios_probe() {
  if [ -z "$IOS_DEVICE_NAME" ]; then
    say "IOS|unknown|||没传 IOS_DEVICE_NAME ⇒ 已启动的模拟器不止一台时**不猜目标**（§6.1.1 那条纪律）"
    return 3
  fi
  local ctn inst loc bid
  # 🔴 bundle id **不写死**：09:5x 现量这台模拟器上装的是 `com.heyta`，而脚本里另一处（widget 接线）
  #    写的是 `com.heyta.mobile` —— 拿任一个当唯一答案都会把"装了"读成"未装"（假 unknown 与假红一样贵）。
  #    正解是先枚举这台机器上真的有哪些 `com.heyta*`，用读到的那个去要容器。
  # `listapps` 的键那一行真身是 `    "com.heyta" =     {`（等号后是**一串空格**）——
  # 把正则写成 `= {` 会**恒不命中**，症状与"这台没装"逐字相同（假 unknown）。09:5x 实测踩过。
  bids=$(xcrun simctl listapps "$IOS_DEVICE_NAME" 2>/dev/null \
         | sed -n 's/^[[:space:]]*"\(com\.heyta[a-zA-Z0-9._-]*\)"[[:space:]]*=[[:space:]]*{/\1/p')
  for bid in $bids "$IOS_BUNDLE_ID"; do
    ctn=$(xcrun simctl get_app_container "$IOS_DEVICE_NAME" "$bid" app 2>/dev/null | head -1)
    [ -n "$ctn" ] && [ -f "$ctn/main.jsbundle" ] && break
    ctn=""
  done
  if [ -z "$ctn" ]; then
    say "IOS|unknown|||$IOS_DEVICE_NAME 上没找到带 main.jsbundle 的 heyta 包（枚举到：$(printf '%s' "$bids" | tr '\n' ' ')）⇒ 未装 / 别人的趟正在卸装 / 包结构不是这里假设的形状"
    return 3
  fi
  say "IOS|identity|bid=$bid|container=$ctn"
  inst=$(h "$ctn/main.jsbundle")
  loc=$(h "$IOS_LOCAL_APP/main.jsbundle")
  [ -z "$inst" ] && { say "IOS|unknown|$ctn|bundle 容器里没有 main.jsbundle（这台的包结构不是这里假设的形状，别把 unknown 记成 DIFFER）"; return 3; }
  [ -z "$loc" ] && { say "IOS|unknown|$inst|本机没有可比的 iOS 产物（默认看 IOS_LOCAL_APP，现指 ${IOS_LOCAL_APP}）⇒ 那一段仍由 reinstall-all.sh 的 ios 段（FRESH 判据）负责，此处不计入红"; return 3; }
  if [ "$inst" = "$loc" ]; then say "IOS|same|$inst|$loc|已装 == 本机 xcodebuild 产物"; return 0; fi
  say "IOS|DIFFER|$inst|$loc|已装的不是本机这一份"; return 1
}

android_probe() {
  local dev serial locpath inst loc
  dev=$(command -v adb 2>/dev/null) || { say "ANDROID|unknown|||这台没有 adb（环境不具备，不是产品结论）"; return 3; }
  serial=$("$dev" devices 2>/dev/null | awk 'NR>1 && $2=="device"{print $1; exit}')
  [ -n "$ANDROID_SERIAL" ] && serial="$ANDROID_SERIAL"
  [ -z "$serial" ] && { say "ANDROID|unknown|||没有在线设备（或都还在 offline）"; return 3; }
  locpath=$(ls "$LOCAL_APK_GLOB"/*.apk 2>/dev/null | head -1)
  [ -z "$locpath" ] && { say "ANDROID|unknown|||本机 release APK 不存在 ⇒ 这一段不计入红（先 build:android）"; return 3; }
  local apkpath
  apkpath=$("$dev" -s "$serial" shell pm path "$ANDROID_PKG" 2>/dev/null | sed -n 's/^package://p' | head -1)
  [ -z "$apkpath" ] && { say "ANDROID|unknown|||$serial 上读不到 $ANDROID_PKG 的安装路径（未装 / 别人的趟正在装）"; return 3; }
  inst=$("$dev" -s "$serial" shell md5sum "$apkpath" 2>/dev/null | awk '{print $1}' | tr -d '\r')
  loc=$(h "$locpath")
  [ -z "$inst" ] && { say "ANDROID|unknown|$loc|设备上 md5sum 取不到（toybox 没有它 ⇒ 这一段不可测，不是不同）"; return 3; }
  if [ "$inst" = "$loc" ]; then say "ANDROID|same|$inst|$loc|已装 == 本机 APK（serial=${serial}）"; return 0; fi
  say "ANDROID|DIFFER|$inst|$loc|设备上那份不是本机这一枚 APK"; return 1
}

# windows 那一段刻意**不在本机复现**：产物在打包机上，本机唯一能读的是它带回来的证据文件。
windows_probe() {
  # 🔴 09:5x 现量：那四行判据**不在** packaged-first-run.txt 里，而在
  #    `evidence/reinstall-<日期>-<时分>-windows-install-capture.txt`（以及 reinstall-<日期>/install-capture.txt）。
  #    按错文件名读会得到"证据里没有那两行"这种**假读数** —— 症状和环境不具备逐字相同。
  local ev stamp
  ev=$(ls -t "$REPO"/apps/desktop-windows/evidence/*install-capture*.txt \
            "$REPO"/apps/desktop-windows/evidence/*/install-capture.txt 2>/dev/null | head -1)
  if [ -z "$ev" ]; then say "WINDOWS|unknown|||本机没有远端带回来的 install-capture 证据（这一段只能由 reinstall-all.sh 的 windows 段自己判）"; return 3; fi
  stamp=$(stat -f '%Sm' -t '%F %T' "$ev" 2>/dev/null)
  say "WINDOWS|unknown|$ev|证据新鲜度=${stamp}；里面数得出：$(grep -ho 'M2D=[A-Z]*\|PAYLOAD_WEBDIST=[A-Za-z]*\|ADD_APPX=[A-Z]*\|RESULT=[A-Z]*' "$ev" 2>/dev/null | sort -u | tr '\n' ' ')"
  say "  ⇒ 这四格是**壳级**判据（装上了 + 带 web-dist + 起了窗），**不是**「== 本机这一批」；"
  say "    windows 那一段的批次身份只由 reinstall-all.sh 的 sync_windows_sources() 的 sha256 对账负责，此处不另建一份"
  return 3
}

run_probe() {
  # $1 = 名字；按旋钮决定用真探针还是夹具
  case "$1" in
    MAC) [ "$P_MAC" = mac_default ] || { printf '%s\n' "$P_MAC"; return "$(printf '%s' "$P_MAC" | awk -F'|' '{print ($2=="DIFFER")?1:(($2=="unknown")?3:0)}')"; }
       mac_probe ;;
    IOS) [ "$P_IOS" = ios_default ] || { printf '%s\n' "$P_IOS"; return "$(printf '%s' "$P_IOS" | awk -F'|' '{print ($2=="DIFFER")?1:(($2=="unknown")?3:0)}')"; }
       ios_probe ;;
    ANDROID) [ "$P_AND" = android_default ] || { printf '%s\n' "$P_AND"; return "$(printf '%s' "$P_AND" | awk -F'|' '{print ($2=="DIFFER")?1:(($2=="unknown")?3:0)}')"; }
       android_probe ;;
    WINDOWS) [ "$P_WIN" = win_default ] || { printf '%s\n' "$P_WIN"; return "$(printf '%s' "$P_WIN" | awk -F'|' '{print ($2=="DIFFER")?1:(($2=="unknown")?3:0)}')"; }
       windows_probe ;;
  esac
}

# ───────────────────────────── selftest：这条对账能不能红 ─────────────────────────────
if [ "${1:-}" = "--selftest" ]; then
  bad=0
  # 对照：两端 same、一段 unknown ⇒ 整体必须 3（unknown 不许被折叠成"通过"）
  out=$(P_MAC='MAC|same|a|a|x' P_IOS='IOS|unknown|||没传设备名' P_AND='ANDROID|same|b|b|x' P_WIN='WINDOWS|same|e|e|x' bash "$0" 2>&1); rc=$?
  [ "$rc" = 3 ] || { say "❌ 对照（有 unknown）应退 3，实际 $rc"; say "$out"; bad=$((bad+1)); }
  printf '%s\n' "$out" | grep -q '^MAC|same' || { say "❌ 对照没打 MAC|same"; bad=$((bad+1)); }
  # 臂 A：任意一端 DIFFER ⇒ 必须 1（这才叫"B 未闭合"有证据形态）
  out=$(P_MAC='MAC|DIFFER|a|b|x' P_IOS='IOS|same|c|c|x' P_AND='ANDROID|same|d|d|x' P_WIN='WINDOWS|same|e|e|x' bash "$0" 2>&1); rc=$?
  [ "$rc" = 1 ] || { say "❌ 臂A 有 DIFFER 却退 $rc ⇒ 这条对账永远不会报未闭合"; bad=$((bad+1)); }
  # 臂 B：全 same ⇒ 必须 0（另一侧的对照：不然臂 A 可能只是"恒 1"）。
  # 🔴 这一臂第一次跑就红了，而红的是**装置自己**：windows 那一段没有接缝 ⇒ 它恒 unknown
  #    ⇒ "全 same 退 0"这一档**结构性不可达**。一条永远满足不了的判据与一条永远通过的判据
  #    是同一个缺陷的两个方向（AGENTS §8.3 的对偶），所以这里补的是 **P_WIN 接缝**，不是改期望。
  out=$(P_MAC='MAC|same|a|a|x' P_IOS='IOS|same|c|c|x' P_AND='ANDROID|same|d|d|x' P_WIN='WINDOWS|same|e|e|x' bash "$0" 2>&1); rc=$?
  [ "$rc" = 0 ] || { say "❌ 臂B 全 same 却退 $rc"; say "$out"; bad=$((bad+1)); }
  # 臂 C：unknown 与 DIFFER 同时存在 ⇒ 必须是 1（"测出来不同"比"测不到"更该响）
  out=$(P_MAC='MAC|unknown|||x' P_IOS='IOS|DIFFER|c|d|x' P_AND='ANDROID|same|d|d|x' P_WIN='WINDOWS|same|e|e|x' bash "$0" 2>&1); rc=$?
  [ "$rc" = 1 ] || { say "❌ 臂C 既有 DIFFER 又退 $rc ⇒ 红被 unknown 盖掉了"; bad=$((bad+1)); }
  [ "$bad" = 0 ] && { say "✅ selftest 四臂成立（unknown→3 / 有 DIFFER→1 / 全 same→0 / 混在一起仍→1；四段都有接缝）"; exit 0; }
  say "selftest 有 $bad 条不成立 ⇒ 装置坏（exit 4），不是对账结论"; exit 4
fi

if [ "${1:-}" = "--help" ]; then
  say "用法：IOS_DEVICE_NAME=<现取的模拟器名> bash research/tools/b-batch-reconcile.sh"
  say "  只读对账「四端已装的产物 == 本机这一批产物」；退出码 0=same 1=有 DIFFER 3=有 unknown 4=装置坏"
  exit 0
fi

cd "$REPO" || exit 4
worst=0
for end in MAC IOS ANDROID WINDOWS; do
  run_probe "$end"; rc=$?
  case "$rc" in
    1) worst=1 ;;                       # 最响的那一档不会被后面盖掉
    3) [ "$worst" = 0 ] && worst=3 ;;
  esac
done
say ""
say "结论：$([ "$worst" = 0 ] && echo '四段都可测且逐段相同 ⇒ B 的"装的是这一批"有证据' \
              || { [ "$worst" = 1 ] && echo '🔴 至少一段测出来不同 ⇒ B **未闭合**（这正是要抓的东西）' \
              || echo '⚠️ 至少一段取不到 ⇒ 环境未具备，**不能**记成闭合'; })"
say "（本工具只判「已装 == 本机产物」；「本机产物 == 本批源码」见文件头指的那三把现成工具）"
exit "$worst"
