#!/bin/bash
# 一次性探针：把「设置 → 同步与隐私」那一组的**全部控件形状**打出来，
# 用来判"端到端加密口令"到底是填了就生效，还是要再按一枚确认按钮。
set -u
export PATH="/opt/homebrew/bin:$PATH"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE"; while [ "$ROOT" != "/" ] && [ ! -e "$ROOT/.git" ]; do ROOT="$(dirname "$ROOT")"; done
export PORT=4520 HEYTA_E2E_DB=heyta_uxr119
export HEYTA_E2E_TOKEN_FILE=/Users/rocalight/heyta-r119-leg/token.txt
export HEYTA_E2E_EMAIL_FILE=/Users/rocalight/heyta-r119-leg/email.txt
export HEYTA_E2E_E2EE_FILE=/Users/rocalight/heyta-r119-leg/e2ee.txt
export HEYTA_E2E_UI_XML=/Users/rocalight/heyta-r119-leg/ui2.xml
export HEYTA_E2E_XY_PY=/Users/rocalight/heyta-r119-leg/xy.py
. "$ROOT/scripts/lib/mobile-e2e.sh"

launch_app; sleep 3; close_settings_sheet
open_settings_section sync || { echo "开组失败"; exit 1; }
for s in 0 1 2; do
  dump
  echo "──── 第 $s 屏 ────"
  python3 - "$UI_XML" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
for m in re.finditer(r'<node ([^>]*?)/?>', xml):
    a = m.group(1)
    g = lambda k: (re.search(k + r'="([^"]*)"', a).group(1) if re.search(k + r'="([^"]*)"', a) else "")
    lab = g("text") or g("content-desc")
    if not lab:
        continue
    flags = []
    if g("password") == "true": flags.append("SECURE")
    if g("class").endswith("EditText"): flags.append("INPUT")
    if g("clickable") == "true": flags.append("CLICK")
    print(f"  {g('class').split('.')[-1]:<10} {'[' + ','.join(flags) + ']' if flags else '':<18} {lab[:60]}")
PY
  swipe_in_view; sleep 1.5
done
