#!/bin/bash
# 一键把 Android 真机登进 heyta（生产/Staging 账号）。见 docs/reference/mobile-login-registration.md。
#
# 用途：调试/验收时由 AI 直接登录，不让人工输密码。读 .local/test-account.env 或环境变量。
# 已登录则直接退出。真机 USB 会掉线，每一步都带 adb 重连重试。
#
# 用法：
#   bash scripts/login-device-staging.sh
#   HEYTA_TEST_EMAIL=... HEYTA_TEST_PASSWORD=... HEYTA_TEST_E2EE=... bash scripts/login-device-staging.sh
set -u
cd "$(dirname "$0")/.." || exit 1
[ -f .local/test-account.env ] && . .local/test-account.env
EMAIL="${HEYTA_TEST_EMAIL:-}"; PW="${HEYTA_TEST_PASSWORD:-}"; E2EE="${HEYTA_TEST_E2EE:-${PW}}"
if [ -z "$EMAIL" ] || [ -z "$PW" ]; then echo "缺少 HEYTA_TEST_EMAIL / HEYTA_TEST_PASSWORD（放在 .local/test-account.env）" >&2; exit 2; fi
ADB="${ADB:-adb}"
PKG="com.heyta"
UI=/tmp/heyta-login-ui.xml

adb_r(){ local n=15; while [ $n -gt 0 ]; do "$ADB" "$@" >/dev/null 2>&1 && return 0; "$ADB" reconnect offline >/dev/null 2>&1; sleep 1; n=$((n-1)); done; return 1; }
dump(){ local n=15; while [ $n -gt 0 ]; do "$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && "$ADB" pull /sdcard/ui.xml "$UI" >/dev/null 2>&1 && return 0; "$ADB" reconnect offline >/dev/null 2>&1; sleep 1; n=$((n-1)); done; return 1; }
# find.py <rid|"" > <label|""> <classfilter:any|EditText|Button>  -> prints "x y" if found
findxy(){ python3 - "$UI" "$1" "$2" "${3:-any}" <<'PY'
import re,sys
try: s=open(sys.argv[1],encoding='utf-8',errors='ignore').read()
except: sys.exit(0)
rid,lab,clsf=sys.argv[2],sys.argv[3],sys.argv[4]
for m in re.finditer(r'<node\b[^>]*>',s):
    t=m.group(0)
    if rid and ('resource-id="%s"'%rid) not in t: continue
    tx=re.search(r'text="([^"]*)"',t); de=re.search(r'content-desc="([^"]*)"',t); cl=re.search(r'class="([^"]*)"',t)
    v=(tx.group(1) if tx else '') or (de.group(1) if de else '')
    if lab and v!=lab: continue
    if clsf!='any' and clsf not in (cl.group(1) if cl else ''): continue
    b=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',t)
    if b:
        x1,y1,x2,y2=map(int,b.groups())
        if x2>x1 and y2>y1: print((x1+x2)//2,(y1+y2)//2); break
PY
}
tap_rid(){ local c; c=$(findxy "$1" "" any); [ -z "$c" ] && return 1; adb_r shell input tap $c; }
tap_text(){ local c; c=$(findxy "" "$1" "${2:-any}"); [ -z "$c" ] && return 1; adb_r shell input tap $c; }
has_rid(){ [ -n "$(findxy "$1" "" any)" ]; }
has_text(){ [ -n "$(findxy "" "$1" any)" ]; }
present(){ # 是否已在主界面
  has_text '任务' && has_text '我的'
}

echo "== 启动 $PKG =="
adb_r shell am force-stop "$PKG"
adb_r shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1
sleep 9

if dump && present; then echo "✅ 已登录（已在主界面），无需操作"; exit 0; fi

for round in $(seq 1 24); do
  dump || { echo "dump 失败（设备掉线）" >&2; exit 3; }
  if present; then echo "✅ 已进入主界面（登录完成）"; exit 0; fi
  if has_rid welcome-signin; then echo "· 欢迎页 → 注册/登录"; tap_rid welcome-signin; sleep 3; continue; fi
  if has_text '同意并联网'; then echo "· 隐私联网同意 → 同意并联网"; tap_text '同意并联网'; sleep 4; continue; fi
  if has_text '我已读完并确认'; then echo "· 条款版本确认 → 我已读完并确认"; tap_text '我已读完并确认'; sleep 6; continue; fi
  if has_text '加密口令' && tap_text '加密口令' EditText; then
     echo "· 登录后加密口令 → 填 $([ -n "$E2EE" ] && echo 已设 || echo 空)"; adb_r shell input text "$E2EE"; sleep 1
     adb_r shell input keyevent 4; sleep 1
     if tap_text '保存并启用同步' Button || tap_text '保存并启用同步'; then echo "· 保存并启用同步"; sleep 8; fi
     continue
  fi
  if has_rid mobile-auth-form-email; then
     if ! has_text "$EMAIL"; then echo "· 填邮箱"; tap_rid mobile-auth-form-email; sleep 1; adb_r shell input text "$EMAIL"; sleep 1; fi
  fi
  if has_rid mobile-auth-form-password; then
     echo "· 填密码 + 登录"; tap_rid mobile-auth-form-password; sleep 1; adb_r shell input text "$PW"; sleep 1
     adb_r shell input keyevent 4; sleep 1
     tap_rid mobile-auth-form-submit && { echo "· 点登录"; sleep 7; }
     continue
  fi
  sleep 2
done
echo "⚠️ 24 轮未确认进入主界面，请人工看一眼（截图在手机屏）。" >&2
exit 1
