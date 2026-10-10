#!/usr/bin/env bash
# macOS native-shell Widget + help probe.
#
# WKWebView has no CDP endpoint, so this deliberately uses macOS Accessibility
# (System Events) instead of pretending Playwright can attach. It exits 4 when
# the WebView does not expose its DOM through AX; that is an unverified probe,
# never a false green. Accessibility permission is required for the terminal.
#
#   bash scripts/qa/macos-installed-widget-help.sh
#
# The script only interacts with the already-running HeytaMac process. It does
# not build, install, or change the product.

set -euo pipefail

APP_PROCESS="${HEYTA_MAC_PROCESS:-HeytaMac}"
EXPECTED="${HEYTA_HELP_EXTERNAL_URL:-https://heyta.waytofuture.cn/docs}"
OUT="${HEYTA_MAC_WIDGET_HELP_EVIDENCE:-apps/desktop-macos/evidence/widget-help-ax.txt}"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"

if ! pgrep -x "$APP_PROCESS" >/dev/null 2>&1; then
  echo "PROBE=UNAVAILABLE"
  echo "REASON=HeytaMac is not running"
  exit 4
fi

# 🔴 进程在 ≠ 窗口在。macOS 关掉最后一个窗口后 app 进程照样活着，而下面那趟 AX 遍历
# 对着空窗口列表会一路走到 15s 超时，把"载体没有窗口"读成"探针没验到东西"（2026-10-09 实测
# 就是这个形状：装的 HeytaMac 在跑，`count of windows` = 0，输出只有 UNVERIFIED）。
# 所以先做一次有界的窗口数回读，失败原因要印出来，不能让它伪装成产品结论。
WINDOWS=$(osascript -e "tell application \"System Events\" to tell process \"$APP_PROCESS\" to count of windows" 2>&1)
case "$WINDOWS" in
  '' | *[!0-9]*)
    echo "PROBE=UNAVAILABLE"
    echo "REASON=AX 读不到窗口数：$WINDOWS"
    exit 4
    ;;
esac
if [ "$WINDOWS" -eq 0 ]; then
  echo "PROBE=UNAVAILABLE"
  echo "REASON=$APP_PROCESS 在跑但一个窗口都没有（count of windows = 0）；先把窗口打开再跑本探针"
  exit 4
fi

ERRLOG=$(mktemp -t heyta-mac-widget-help-ax)

# 🔴 "这段是不是 PWA 安装引导"只能按**产品那批词条原文**判，不能按行首的 `1.`/`2.`/`3.` 判。
#    原生小组件引导（`web.widgetJourney.native.*`）渲染出来**同样带序号**，所以旧的形状判据会在
#    壳真的给了小组件引导 —— 也就是产品该有的样子 —— 时报"原生壳暴露了 PWA 安装引导"。
#    两套键名与原文都从真源读（读不到就响亮失败，见 widget-step-words.mjs 文件头）。
RIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_WORDS=$(mktemp -t heyta-mac-widget-install-words)
NOTE_AVAIL_WORDS=$(mktemp -t heyta-mac-widget-note-avail-words)
NOTE_SHELL_WORDS=$(mktemp -t heyta-mac-widget-note-shell-words)
export HEYTA_WIDGET_STEP_MODULE="$RIG_DIR/widget-step-words.mjs"
node --input-type=module -e '
  const { pathToFileURL } = await import("node:url");
  const m = await import(pathToFileURL(process.env.HEYTA_WIDGET_STEP_MODULE).href);
  process.stdout.write(m.stepTexts(m.installStepKeys()).join("\n") + "\n");
' >"$INSTALL_WORDS" || { echo "PROBE=UNAVAILABLE"; echo "REASON=读不出 PWA 安装步骤的词条原文"; exit 4; }
node --input-type=module -e '
  const { pathToFileURL } = await import("node:url");
  const m = await import(pathToFileURL(process.env.HEYTA_WIDGET_STEP_MODULE).href);
  process.stdout.write(m.stepTexts(["web.widgetJourney.note.nativeAvailable"]).join("\n") + "\n");
' >"$NOTE_AVAIL_WORDS" || { echo "PROBE=UNAVAILABLE"; echo "REASON=读不出「原生小组件可用」那行词条原文"; exit 4; }
node --input-type=module -e '
  const { pathToFileURL } = await import("node:url");
  const m = await import(pathToFileURL(process.env.HEYTA_WIDGET_STEP_MODULE).href);
  process.stdout.write(m.stepTexts(["web.widgetJourney.note.nativeShell"]).join("\n") + "\n");
' >"$NOTE_SHELL_WORDS" || { echo "PROBE=UNAVAILABLE"; echo "REASON=读不出「原生壳但无小组件桥」那行词条原文"; exit 4; }
for f in "$INSTALL_WORDS" "$NOTE_AVAIL_WORDS" "$NOTE_SHELL_WORDS"; do
  if [ ! -s "$f" ]; then echo "PROBE=UNAVAILABLE"; echo "REASON=词条原文文件是空的（${f}）—— 读空不许当通过"; exit 4; fi
done

set +e
osascript - "$APP_PROCESS" "$EXPECTED" "$OUT" "$INSTALL_WORDS" "$NOTE_AVAIL_WORDS" "$NOTE_SHELL_WORDS" >"$ERRLOG" 2>&1 <<'APPLESCRIPT' &
on run argv
  set appProcess to item 1 of argv
  set expectedUrl to item 2 of argv
  set outPath to item 3 of argv
  set installWords to paragraphs of (read POSIX file (item 4 of argv) as «class utf8»)
  set noteAvailable to paragraphs of (read POSIX file (item 5 of argv) as «class utf8»)
  set noteNativeShell to paragraphs of (read POSIX file (item 6 of argv) as «class utf8»)
  set lines to {}
  set end of lines to "PROBE=macOS-AX"
  set end of lines to "PROCESS=" & appProcess
  set end of lines to "EXPECTED=" & expectedUrl

  -- Capture the browser state before the click. Checking only the final URL can
  -- pass because an old tab was already on the help page.
  set beforeBrowserUrl to ""
  try
    tell application "Safari" to set beforeBrowserUrl to URL of current tab of front window
  end try
  if beforeBrowserUrl is "" then try
    tell application "Google Chrome" to set beforeBrowserUrl to URL of active tab of front window
  end try
  if beforeBrowserUrl is "" then try
    tell application "Microsoft Edge" to set beforeBrowserUrl to URL of active tab of front window
  end try
  if beforeBrowserUrl is "" then try
    tell application "Arc" to set beforeBrowserUrl to URL of active tab of front window
  end try
  set end of lines to "BROWSER_URL_BEFORE=" & beforeBrowserUrl

  tell application "System Events"
    if not (exists process appProcess) then error "process not visible to System Events"
    tell process appProcess
      if (count of windows) = 0 then error "HeytaMac has no window"
      set theWindow to front window
      set end of lines to "WINDOW_TITLE=" & (name of theWindow)

      -- Reach Settings → Tasks and display without stealing foreground focus.
      -- The probe must exercise the same user path as the Windows probe; reading
      -- whatever screen happened to be open would not prove the Widget journey.
      set nodes to entire contents of theWindow
      set appearanceButton to missing value
      repeat with nodeRef in nodes
        set nodeItem to contents of nodeRef
        try
          set labelText to ((description of nodeItem) as text)
        on error
          set labelText to ""
        end try
        try
          if labelText is "" then set labelText to ((name of nodeItem) as text)
        on error
          -- keep the empty label
        end try
        if labelText is "任务与显示" or labelText is "Tasks and display" then set appearanceButton to nodeItem
      end repeat

      if appearanceButton is missing value then
        set avatarButton to missing value
        repeat with nodeRef in nodes
          set nodeItem to contents of nodeRef
          try
            set labelText to ((description of nodeItem) as text)
          on error
            set labelText to ""
          end try
          try
            if labelText is "" then set labelText to ((name of nodeItem) as text)
          on error
            -- keep the empty label
          end try
          if labelText is "账号" or labelText is "Account" then set avatarButton to nodeItem
        end repeat
        if avatarButton is missing value then error "AX did not expose the account menu or appearance settings"
        click avatarButton
        delay 1
        set nodes to entire contents of front window
        set settingsButton to missing value
        repeat with nodeRef in nodes
          set nodeItem to contents of nodeRef
          try
            set labelText to ((description of nodeItem) as text)
          on error
            set labelText to ""
          end try
          try
            if labelText is "" then set labelText to ((name of nodeItem) as text)
          on error
            -- keep the empty label
          end try
          if labelText is "应用设置" or labelText is "App settings" then set settingsButton to nodeItem
        end repeat
        if settingsButton is missing value then error "AX did not expose the account menu settings action"
        click settingsButton
        delay 1
        set nodes to entire contents of front window
        repeat with nodeRef in nodes
          set nodeItem to contents of nodeRef
          try
            set labelText to ((description of nodeItem) as text)
          on error
            set labelText to ""
          end try
          try
            if labelText is "" then set labelText to ((name of nodeItem) as text)
          on error
            -- keep the empty label
          end try
          if labelText is "任务与显示" or labelText is "Tasks and display" then set appearanceButton to nodeItem
        end repeat
      end if
      if appearanceButton is missing value then error "AX did not expose the appearance settings section"
      click appearanceButton
      delay 1
      set theWindow to front window
      set nodes to entire contents of theWindow
      set nativeStatus to false
      set installGuide to false
      set numberedRows to 0
      set capabilityKind to "none"
      set aboutButton to missing value
      set webViewUrlBefore to ""
      set inWidgetSection to false
      repeat with nodeRef in nodes
        set nodeItem to contents of nodeRef
        try
          set labelText to ((description of nodeItem) as text)
        on error
          set labelText to ""
        end try
        try
          if labelText is "" then set labelText to ((name of nodeItem) as text)
        on error
          -- keep the empty label
        end try
        if labelText is "正在原生桌面应用中运行" or labelText is "Running in the native desktop app" then set nativeStatus to true
        if labelText is "桌面小组件" or labelText is "Desktop widgets" then set inWidgetSection to true
        -- 🔴 "是不是 PWA 安装引导"按**产品词条原文**判（含就行，AX 会把序号拼在前面，
        --    所以不能整行相等，也不能按行首 "1."/"2."/"3." 的形状判 —— 原生小组件引导同样带序号）。
        if inWidgetSection and (labelText starts with "1." or labelText starts with "2." or labelText starts with "3.") then set numberedRows to numberedRows + 1
        repeat with w in installWords
          set wText to (w as text)
          if (count of wText) > 0 and inWidgetSection and (wText is in labelText) then set installGuide to true
        end repeat
        repeat with n in noteAvailable
          set nText to (n as text)
          if (count of nText) > 0 and (nText is in labelText) then set capabilityKind to "nativeAvailable"
        end repeat
        repeat with n in noteNativeShell
          set nText to (n as text)
          if (count of nText) > 0 and (nText is in labelText) and capabilityKind is "none" then set capabilityKind to "nativeShell"
        end repeat
        try
          if role of nodeItem is "AXWebArea" then
            set webViewUrlBefore to value of attribute "AXURL" of nodeItem as text
          end if
        end try
        if labelText is "关于与帮助" or labelText is "About & help" then set aboutButton to nodeItem
      end repeat
      set end of lines to "NATIVE_STATUS_MATCH=" & nativeStatus
      set end of lines to "INSTALL_GUIDE_MATCH=" & installGuide
      set end of lines to "NUMBERED_ROWS_IN_WIDGET=" & numberedRows
      set end of lines to "WIDGET_CAPABILITY_KIND=" & capabilityKind
      if nativeStatus is false then error "AX did not expose the native desktop status"
      if installGuide is true then error "native shell exposed a PWA install guide"
      -- capabilityKind 只可能是产品那两行之一：状态行已判为 native-shell，而 noteKey 在该分支里
      -- 只有 nativeAvailable / nativeShell 两种取值（`WidgetJourneyPanel.tsx:84-91`）。
      -- 读到 "none" 说明这段说明文字不是产品写的（或词条原文对不上），那是探针未闭合，响亮失败。
      if capabilityKind is "none" then error "AX 里那行小组件能力边界说明不等于产品两条原文之一"
      if aboutButton is missing value then error "AX did not expose the About and Help settings section"
      click aboutButton
      delay 2
      set end of lines to "ABOUT_HELP_SECTION_CLICK=OK"

      -- The rail Help button only opens the in-app About panel. Find and click
      -- its actual external Help centre link; stopping after the panel is a
      -- false positive for the product journey.
      set helpLink to missing value
      set afterHelpNodes to entire contents of front window
      repeat with nodeRef in afterHelpNodes
        set nodeItem to contents of nodeRef
        try
          set labelText to ((description of nodeItem) as text)
        on error
          set labelText to ""
        end try
        try
          if labelText is "" then set labelText to ((name of nodeItem) as text)
        on error
          -- keep the empty label
        end try
        try
          if (role of nodeItem is "AXLink") and (labelText starts with "帮助中心" or labelText starts with "Help centre" or labelText starts with "Help center" or labelText starts with "文档" or labelText starts with "Docs") then set helpLink to nodeItem
        end try
      end repeat
      if helpLink is missing value then error "AX did not expose the external Help centre link"
      click helpLink
      delay 2
      set end of lines to "HELP_CENTRE_LINK_CLICK=OK"

      -- AXURL is the only acceptable shell-side navigation evidence for a
      -- WKWebView probe. A surviving window alone does not prove the WebView
      -- stayed on Heyta; if AX does not expose AXURL, return UNVERIFIED.
      set webViewUrlAfter to ""
      set afterLinkNodes to entire contents of front window
      repeat with nodeRef in afterLinkNodes
        set nodeItem to contents of nodeRef
        try
          if role of nodeItem is "AXWebArea" then
            set webViewUrlAfter to value of attribute "AXURL" of nodeItem as text
          end if
        end try
      end repeat
      set end of lines to "WEBVIEW_URL_BEFORE=" & webViewUrlBefore
      set end of lines to "WEBVIEW_URL_AFTER=" & webViewUrlAfter
      if webViewUrlBefore is "" or webViewUrlAfter is "" then error "WKWebView AXURL is unavailable; shell navigation is unverified"
      if webViewUrlBefore is not webViewUrlAfter then error "Heyta WebView URL changed after opening external help"
    end tell
  end tell

  tell application "System Events"
    set frontName to name of first application process whose frontmost is true
  end tell
  set end of lines to "FRONTMOST=" & frontName

  set openedUrl to ""
  if frontName is "Safari" then
    tell application "Safari" to set openedUrl to URL of current tab of front window
  else if frontName is "Google Chrome" then
    tell application "Google Chrome" to set openedUrl to URL of active tab of front window
  else if frontName is "Microsoft Edge" then
    tell application "Microsoft Edge" to set openedUrl to URL of active tab of front window
  else if frontName is "Arc" then
    tell application "Arc" to set openedUrl to URL of active tab of front window
  end if
  set end of lines to "BROWSER_URL=" & openedUrl

  -- The native shell must remain alive after opening the external browser.
  tell application "System Events"
    tell process appProcess
      set shellWindowStillThere to ((count of windows) > 0)
    end tell
  end tell
  set end of lines to "SHELL_WINDOW_STILL_THERE=" & shellWindowStillThere

  set payload to ""
  repeat with lineText in lines
    set payload to payload & (contents of lineText) & linefeed
  end repeat
  do shell script "printf %s " & quoted form of payload & " > " & quoted form of outPath
  if openedUrl is "" then error "frontmost app is not a supported browser or URL is unavailable"
  if openedUrl does not start with expectedUrl then error "browser URL does not match expected help URL"
  if beforeBrowserUrl starts with expectedUrl then error "browser was already on the expected help URL before the click"
  if shellWindowStillThere is false then error "HeytaMac window disappeared after opening help"
  return payload
end run
APPLESCRIPT
osascript_pid=$!
timed_out=1
for _ in $(seq 1 60); do
  if ! kill -0 "$osascript_pid" 2>/dev/null; then
    timed_out=0
    break
  fi
  sleep 0.25
done
if [ "$timed_out" -eq 1 ]; then
  kill "$osascript_pid" 2>/dev/null || true
  wait "$osascript_pid" 2>/dev/null || true
  status=124
else
  wait "$osascript_pid"
  status=$?
fi
set -e

if [ -f "$OUT" ]; then
  cat "$OUT"
else
  echo "PROBE=UNAVAILABLE"
  echo "REASON=Accessibility tree or browser URL could not be read"
fi

if [ "$status" -ne 0 ]; then
  if [ "$status" -eq 124 ]; then
    echo "REASON=macOS Accessibility probe timed out; result is unverified"
  fi
  # AppleScript 的 error 文本是这一步唯一的归因通道 —— 没有它，"壳没暴露 DOM"和
  # "壳没有窗口"和"权限没给"在输出上长得一模一样。
  if [ -s "$ERRLOG" ]; then
    echo "AX_ERROR=$(head -5 "$ERRLOG" | tr '\n' ' ')"
  fi
  rm -f "$ERRLOG" "$INSTALL_WORDS" "$NOTE_AVAIL_WORDS" "$NOTE_SHELL_WORDS"
  echo "RESULT=UNVERIFIED"
  exit 4
fi
rm -f "$ERRLOG" "$INSTALL_WORDS" "$NOTE_AVAIL_WORDS" "$NOTE_SHELL_WORDS"
echo "RESULT=OK"
