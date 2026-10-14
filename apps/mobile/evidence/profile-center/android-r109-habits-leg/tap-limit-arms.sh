#!/usr/bin/env bash
# 臂对：证明 `xy_edit_sane` 那道下沿守卫改的是"**浮层开着**"这一格，而不是把保护放宽了。
#
# 为什么用夹具而不是只跑设备腿：真人的复现状态在 2026-10-14 01:47 那条腿里出现过一次
# （那一拍 `可滚区=[0,210][1080,2400]`、`「端到端加密口令」标签 bounds=[84,2049][996,2105]`，
# 它下面那格 EditText 的中心 ≈2173，`xy_edit_sane` 返回空），而那个状态要先把两条凭据
# 填进键盘起立过的表单才会出现，重放一次要占整台设备。这里把**同一形状**做成确定性夹具，
# 让"改前会红、改后会绿"这件事可以在无设备的条件下反复量。
#
# 夹具的底本是真 dump：`tree-D-sheet-open-e2ee.xml`（本目录，2026-10-14 08:0x 从
# emulator-5554 取，里面有 rid=settings-sheet、bounds=[0,0][1080,2400] 那一枚，也有三格 EditText）。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RUN="${HEYTA_TAP_LIMIT_RUN:-$HERE/arms-run}"
BASE="$HERE/tree-D-sheet-open-e2ee.xml"
mkdir -p "$RUN"

[ -f "$BASE" ] || { echo "🔴 没有底本 $BASE —— 夹具是从真机上取的 dump，底本不在这几条臂就无从求值"; exit 1; }

# 仓库根**往上找**，不数层数：第一版把 `../../../..` 写死（少算一层），`cd` 落到了 `…/heyta/apps`，
# 于是 source 的是不存在的路径 —— 而它被 `2>/dev/null` 吞掉了，只留下一句"没生成量具"。
REPO="$HERE"
while [ "$REPO" != "/" ] && [ ! -f "$REPO/scripts/lib/mobile-e2e.sh" ]; do REPO="$(dirname "$REPO")"; done
[ -f "$REPO/scripts/lib/mobile-e2e.sh" ] || { echo "🔴 从 $HERE 往上找不到 scripts/lib/mobile-e2e.sh"; exit 1; }

# 🔴 两个旋钮的名字不一样：`HEYTA_E2E_*` 是**外层**给 lib 的落点，lib 在 source 时把它们
#    抄成 `UI_XML` / `XY_PY` 再 `export` 给 python 子进程（`_xy.py` 读的是 `os.environ['UI_XML']`）。
#    第一版这里只设了 `HEYTA_E2E_UI_XML` 就直接调 python ⇒ 量具读的还是 `/tmp/ui.xml`，
#    四条臂全在同一份不相干的树上求值，红的绿都不说明任何事。
export HEYTA_E2E_UI_XML="$RUN/ui.xml"
export HEYTA_E2E_XY_PY="$RUN/_xy.py"
cd "$REPO" || exit 1
# 只为了拿一枚新生成的 `_xy.py`（守卫的实现就在里面），不发任何 adb 命令
# stdout 是 lib 的横幅，吞掉；stderr **不吞** —— 上一版把两边都吞了，路径写错这件事只剩一句哑读数。
# shellcheck disable=SC1091
source scripts/lib/mobile-e2e.sh >/dev/null || true
[ -f "$HEYTA_E2E_XY_PY" ] || { echo "🔴 没生成 $HEYTA_E2E_XY_PY —— lib 的夹具形状变了"; exit 1; }

# ── 造夹具：把「端到端加密口令」那格整体下移 351 px（01:47 那一拍的量）──
python3 - "$BASE" "$RUN/A-sheet-open.xml" "$RUN/B-sheet-gone.xml" <<'PY'
import re, sys
src, a_out, b_out = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(src, encoding='utf-8', errors='replace').read()

def shift(text):
    # 只动 content-desc="端到端加密口令" 的那枚 EditText：y 整体 +351 ⇒ 中心 1822 → 2173
    out, n = [], 0
    for m in re.finditer(r'<node[^>]*?>', text):
        t = m.group(0)
        if ('class="android.widget.EditText"' in t and 'content-desc="端到端加密口令"' in t
                and n == 0):
            b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', t)
            x1, y1, x2, y2 = map(int, b.groups())
            nb = f'bounds="[{x1},{y1 + 351}][{x2},{y2 + 351}]"'
            t = t[:b.start()] + nb + t[b.end():]
            n += 1
        out.append(t)
    assert n == 1, "夹具没命中那枚 EditText —— 底本形状变了，这条臂无从求值"
    return re.sub(r'<node[^>]*?>', lambda m: out.pop(0), text)

a = shift(s)
# B：同一份夹具，只把浮层根节点摘掉 ⇒ 模拟"主屏上、没有 Modal"的那一格
b = re.sub(r'<node[^>]*resource-id="settings-sheet"[^>]*/?>', '', a, count=1)
assert 'resource-id="settings-sheet"' not in b
open(a_out, 'w', encoding='utf-8').write(a)
open(b_out, 'w', encoding='utf-8').write(b)
print(f"   夹具 A（浮层在）与 B（浮层摘掉）已生成，那一格移动后的 bounds：",
      re.search(r'content-desc="端到端加密口令"[^>]*bounds="[^"]*"', a).group(0)[-30:])
PY

ask() {  # <量具> <xml> —— 拿 edit-sane 的读数（python 读的是 UI_XML，见上面那段）
  UI_XML="$2" python3 "$1" edit-sane 端到端加密口令 0 2>/dev/null
}

# 臂 A0：**改前**的形状。不动仓库，把生成出来的量具拷到仓外，只把那一行下沿钉回常量 2100
# —— 它就是本次修改之前那道守卫。臂 A 与臂 A0 用的是**同一份夹具**，差别只有守卫。
OLD_PY="$RUN/_xy.before.sh.py"
sed 's/^TAP_LIMIT = .*/TAP_LIMIT = 2100/' "$HEYTA_E2E_XY_PY" > "$OLD_PY"
grep -q '^TAP_LIMIT = 2100$' "$OLD_PY" || { echo "🔴 臂 A0 没施上：量具里那一行的形状变了"; exit 1; }
ARM_A0=$(ask "$OLD_PY" "$RUN/A-sheet-open.xml")

echo "── 四条读数 ──"
CTRL=$(ask "$HEYTA_E2E_XY_PY" "$BASE")     # 真底本未变异：那一格中心 1822，改前改后都该拿到
ARM_A=$(ask "$HEYTA_E2E_XY_PY" "$RUN/A-sheet-open.xml") # 变异后中心 2173，浮层在 ⇒ 应当拿到
ARM_B=$(ask "$HEYTA_E2E_XY_PY" "$RUN/B-sheet-gone.xml") # 变异后中心 2173，浮层不在 ⇒ 应当为空（原保护还在）
echo "   对照（未变异真 dump）        → [${CTRL}]"
echo "   臂 A0（改前的守卫，同夹具）  → [${ARM_A0}]"
echo "   臂 A（改后 + 浮层在树上）    → [${ARM_A}]"
echo "   臂 B（改后 + 浮层被摘掉）    → [${ARM_B}]"

rc=0
[ -n "$CTRL" ] || { echo "🔴 对照拿不到坐标 —— 底本或量具坏了，这几条臂证明不了任何事"; rc=1; }
[ -z "$ARM_A0" ] || { echo "🔴 臂 A0 没复现旧形状：把下沿钉回 2100 后那一格仍可点 ⇒ 夹具没造出真正的边界情形"; rc=1; }
[ -n "$ARM_A" ] || { echo "🔴 臂 A 存活：浮层开着时那一格仍被判不可点 ⇒ TAP_LIMIT 没按浮层下沿放宽"; rc=1; }
[ -z "$ARM_B" ] || { echo "🔴 臂 B 坏了：浮层不在树上却仍放行 2173 ⇒ 主屏那排底部标签的保护被放宽了"; rc=1; }
[ "$rc" = 0 ] && echo "✅ 四条全合预期：A0 空 → A 有点（改动确实作用在边界那格），而 B 仍空（主屏那格照旧挡）"
exit "$rc"
