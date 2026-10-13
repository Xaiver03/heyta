#!/usr/bin/env bash
# 键盘 vs 可视区：端到端加密口令那一格到底是被压住还是根本不在树上。
# 三段对照，同一次会话内只做这一件事：A 展开表单后、B 敲开键盘后、C 收起键盘后。
set -uo pipefail
A=/opt/homebrew/share/android-commandlinetools/platform-tools/adb
S=emulator-5554
RUN="$HOME/heyta-r109-leg"; mkdir -p "$RUN"

snap() {  # snap <标签>
  "$A" -s $S shell uiautomator dump /sdcard/p.xml >/dev/null 2>&1
  "$A" -s $S exec-out cat /sdcard/p.xml > "$RUN/tree-$1.xml" 2>/dev/null
  python3 - "$1" "$RUN/tree-$1.xml" <<'PY'
import re,sys
tag,f=sys.argv[1],sys.argv[2]
x=open(f,encoding='utf-8').read()
ime=None
print(f"--- {tag} ---")
for m in re.finditer(r'<node[^>]*>',x):
    s=m.group(0)
    lab=((re.search(r'text="([^"]*)"',s) or [None,''])[1] or '')+'|'+((re.search(r'content-desc="([^"]*)"',s) or [None,''])[1] or '')
    cls=(re.search(r'class="([^"]*)"',s) or [None,''])[1]
    b=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',s)
    if not b: continue
    x1,y1,x2,y2=map(int,b.groups())
    for key in ('服务器地址','访问令牌','端到端加密口令'):
        if key in lab:
            print(f"  {key:8} cls={cls.split('.')[-1]:9} bounds=[{x1},{y1}][{x2},{y2}] cy={(y1+y2)//2} clickable={'clickable=\"true\"' in s}")
    if cls.endswith('EditText') and not any(k in lab for k in ('服务器地址','访问令牌','端到端加密口令')):
        print(f"  EditText(无标签) bounds=[{x1},{y1}][{x2},{y2}] focused={'focused=\"true\"' in s}")
for k in ('使用自托管服务器','立即同步','保存'):
    if k in x: print(f"  文案在场: {k}")
sc=re.findall(r'<node[^>]*scrollable="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',x)
print('  可滚容器:',sc)
PY
  "$A" -s $S shell dumpsys input_method 2>/dev/null | grep -m1 mInputShown | sed "s/^/  [$tag] /"
}
taprid() {  # taprid <rid后缀> —— 按 resource-id 精确点
  local xy
  xy=$(python3 - "$1" <<PY
import re
x=open('$RUN/tree-$2.xml',encoding='utf-8').read()
m=re.search(r'<node[^>]*resource-id="[^"]*$1[^>]*>',x)
if m:
    b=re.search(r'bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"',m.group(0))
    x1,y1,x2,y2=map(int,b.groups()); print(f"{(x1+x2)//2} {(y1+y2)//2}")
PY
)
  [ -n "$xy" ] && { echo "  点 $1 @ $xy"; "$A" -s $S shell input tap $xy; sleep 2; } || echo "  没找到 $1"
}

snap "A0-当前(目录层或已展开)"
# 展开自托管表单
"$A" -s $S shell uiautomator dump /sdcard/p.xml >/dev/null 2>&1
"$A" -s $S exec-out cat /sdcard/p.xml > "$RUN/tree-pre.xml"
XY=$(python3 - <<'PY'
import re
x=open('/Users/rocalight/heyta-r109-leg/tree-pre.xml',encoding='utf-8').read()
for m in re.finditer(r'<node[^>]*>',x):
    s=m.group(0)
    lab=((re.search(r'text="([^"]*)"',s) or [None,''])[1] or '')+((re.search(r'content-desc="([^"]*)"',s) or [None,''])[1] or '')
    if '使用自托管服务器' in lab:
        b=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',s)
        x1,y1,x2,y2=map(int,b.groups()); print(f"{(x1+x2)//2} {(y1+y2)//2}"); break
PY
)
[ -n "$XY" ] && { echo "展开自托管表单 @ $XY"; "$A" -s $S shell input tap $XY; sleep 2; }
snap "A1-表单展开后"

# 点服务器地址框并输入 ⇒ 键盘起来
F=$(python3 - <<'PY'
import re
x=open('/Users/rocalight/heyta-r109-leg/tree-A1-表单展开后.xml',encoding='utf-8').read().replace('\n',' ')
for m in re.finditer(r'<node[^>]*>',x):
    s=m.group(0)
    lab=((re.search(r'text="([^"]*)"',s) or [None,''])[1] or '')+((re.search(r'content-desc="([^"]*)"',s) or [None,''])[1] or '')
    if '服务器地址' in lab and 'clickable="true"' in s:
        b=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',s)
        x1,y1,x2,y2=map(int,b.groups()); print(f"{(x1+x2)//2} {(y1+y2)//2}"); break
PY
)
echo "服务器地址输入框 xy=[$F]"
[ -n "$F" ] && { "$A" -s $S shell input tap $F; sleep 1
  "$A" -s $S shell input text "http://10.0.2.2:3111"; sleep 1
  "$A" -s $S shell input tap 540 1400; sleep 1   # 焦点挪开，再点令牌框
}
snap "B-键盘起立后(填过服务器地址)"

# 收起键盘再看第三格
"$A" -s $S shell input keyevent 4; sleep 2
snap "C-收起键盘后"
