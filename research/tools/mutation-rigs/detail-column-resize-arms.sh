#!/usr/bin/env bash
# 工单 H10 第一刀的牙齿台：`e2e/tests/detail-column-resize.spec.ts` 的四臂变异。
#
# 规矩（AGENTS §8 第 3 条 / §7 元规则 2）：一道不能失败的判据没有价值。
# 每一臂只改**一处**，跑整支 spec，然后核对"红的是不是预期的那几条"——
# 红在别的臂上不算数（traps #355：变异臂"红了"不等于红在你声称的那条判据上）。
#
# 用法（在仓库根或任意目录都行，路径自己算）：
#   bash research/tools/mutation-rigs/detail-column-resize-arms.sh
# 单独跑某一臂：
#   bash research/tools/mutation-rigs/detail-column-resize-arms.sh A C
set -uo pipefail

# 本文件住在 `research/tools/mutation-rigs/` ⇒ 仓库根是**上三层**（第一版写成上两层，
# 于是 `cd` 到的是 `research/`，四条臂全部"没改动文件"就报 NOT_APPLIED —— 那是一次
# 什么都不证明的"跑过了"。）
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

BASE_CSS='apps/web/src/styles/app/base.css'
RESIZER='apps/web/src/features/shell/ColumnResizer.tsx'
SPEC='tests/detail-column-resize.spec.ts'
FAILS=0

# 🔴 函数**不能叫 `md5`**：第一版叫 `md5`，于是函数体里那句 `md5 -q "$1"` 递归调的是
#    它自己，每次都返回空串 ⇒ "改前哈希 == 改后哈希"恒真 ⇒ 四条臂全部报 NOT_APPLIED，
#    而 `BACK_TO_CLEAN=OK` 同样是两个空串在比。**一台什么都不证明的台架，看起来和
#    一台证明了的台架一模一样**（§7 元规则 2）。
digest() { shasum "$1" | cut -d' ' -f1; }
BASE_SUM_CSS="$(digest "$BASE_CSS")"
BASE_SUM_TSX="$(digest "$RESIZER")"
[ -n "$BASE_SUM_CSS" ] && [ -n "$BASE_SUM_TSX" ] || { echo "SEED_HASH_MISSING（取不到基线哈希，这一趟没有读数）"; exit 1; }

# 🔴 备份**从工作树自己拷一份**，不用 `git checkout --`：这两份文件此刻带着本单
#    尚未提交的改动，`git checkout` 会把它们退回 HEAD —— 那是拿变异台当删除键用。
SNAP="$(mktemp -d)"
cp "$BASE_CSS" "$SNAP/base.css"
cp "$RESIZER" "$SNAP/ColumnResizer.tsx"
restore() {
  cp "$SNAP/base.css" "$BASE_CSS"
  cp "$SNAP/ColumnResizer.tsx" "$RESIZER"
}
trap 'restore; rmdir "$SNAP" 2>/dev/null || true' EXIT

# 一臂：$1 = 名字，$2 = 期望红的那几条（逗号分隔的 D 序号），$3 = python 补丁表达式
WANT="${*:-A B C D}"

arm() {
  local name="$1" expect="$2" patch="$3"
  case " $WANT " in
    *" $name "*) ;;
    *) echo "ARM_$name=SKIPPED"; return ;;
  esac
  restore
  python3 - "$BASE_CSS" "$RESIZER" <<PY
import io, sys
base, resizer = sys.argv[1], sys.argv[2]
$patch
PY
  if [ "$(digest "$BASE_CSS")" = "$BASE_SUM_CSS" ] && [ "$(digest "$RESIZER")" = "$BASE_SUM_TSX" ]; then
    echo "ARM_$name=NOT_APPLIED（这一臂根本没改动文件 —— 它证明不了任何事）"
    FAILS=$((FAILS + 1))
    return
  fi
  local out red
  out="$(cd e2e && NO_COLOR=1 npx playwright test "$SPEC" --reporter=list --retries=0 2>&1)"
  # 🔴 只数**红的那几条**：list 报告器对通过的用例打 `✓`、失败的打 `✘`，
  # 不先筛 `✘` 会把通过项也算进红集（那等于每条臂都"红了全部判据"，读数毫无意义）。
  red="$(printf '%s\n' "$out" | grep '✘' | grep -oE '› D[0-9]+' | grep -oE 'D[0-9]+' | sort -u | tr '\n' ',' | sed 's/,$//')"
  if [ "$red" = "$expect" ]; then
    echo "ARM_RED_OK=${name}（红在 ${red}）"
  else
    echo "ARM_WRONG=$name 期望红在 [$expect]，实际 [$red]"
    printf '%s\n' "$out" | grep -E '✘|Error:' | head -6
    FAILS=$((FAILS + 1))
  fi
  restore
}

# A：把"没东西可画就不占位"整个拿掉（轨道不归零、也不 display:none）⇒ 只有 D1 该红。
arm A D1 '
s = io.open(base, encoding="utf-8").read()
old = ".ht-app[data-detail-empty] {\n  --ht-detail-track: 0;\n}"
assert s.count(old) == 1, "A: 找不到 data-detail-empty 那条轨道归零规则"
s = s.replace(old, "/* 臂 A：故意拿掉 */")
s = s.replace(
    ".ht-app[data-detail-empty] .ht-app__detail,\n.ht-app[data-detail-empty] .ht-app__detail-resizer {",
    ".ht-app[data-detail-empty] .ht-app__detail-resizer {",
)
io.open(base, "w", encoding="utf-8").write(s)
'

# B：把手所在的那一侧写反 ⇒ D3 该红（往左拖变成变窄）。
#    D6 一起红是**这条判据本来的形状**：它钉的就是"方向写在参数里"，
#    把这枚字面量改掉，源码判据与行为判据同时失效才叫对（不是意外连带）。
arm B "D3,D6" '
s = io.open(resizer, encoding="utf-8").read()
old = "      edge=\"start\""
assert s.count(old) == 1, "B: 找不到 DetailColumnResizer 的 edge 参数"
s = s.replace(old, "      edge=\"end\"")
io.open(resizer, "w", encoding="utf-8").write(s)
'

# C：hover 提示线换回"与静态边框同色"⇒ 只有 D4 该红（画了等于没画）。
arm C D4 '
s = io.open(base, encoding="utf-8").read()
anchor = ".ht-app__detail-resizer:hover::after"
i = s.index(anchor)
j = s.index("inline-size: var(--ht-border-width-thick);", i)
old = "background: var(--ht-color-primary);"
assert s.count(old, i, j) == 1, "C: 详情列那一枚的 hover 换色句没找到"
s = s[:i] + s[i:j].replace(old, "background: var(--ht-color-border);", 1) + s[j:]
io.open(base, "w", encoding="utf-8").write(s)
'

# D：只把**用户收起**那一档里栏自身的 display:none 摘掉 ⇒ 只有 D5 该红。
#    （A 与 D 打的不是同一件事：A 是"没内容还占位"，D 是"轨道归零了但栏以
#     padding+border=33px 画在视口外"。两条各一条判据，各自只红一条。）
#
# 🔴 这一臂**先后被两件事挡住**，两件事各自都会让它"什么都不杀"：
#   1. 证人选错视图：任务面里收起会把栏同时清空，`[data-detail-empty]` 那条**顺带**
#      把它藏了 ⇒ D5 换成番茄钟那一腿（面单不受收起开关管）才有证人。
#   2. 同一份 display 声明在 base.css 末尾还有**第二份**（HEAD 里 `W7` 那段之后那条，
#      与本单新加的组选择器逐字同选择器、同声明）：摘掉上面那份，下面那份照样生效。
#      那条是本单制造的第二份 —— 收尾动作是**删掉旧的那份**（AGENTS §3.5 的教训），
#      删掉后干净态 6/6 仍过，证它确实是死的；这一臂才第一次红在 D5。
#    ⇒ 判据："某一臂期望红在 X 却红集为空"时，先问**这条声明是不是还有第二处**，
#      再怀疑判据本身。
arm D D5 '
s = io.open(base, encoding="utf-8").read()
# 整段补丁在 bash 的单引号里，所以 CSS 里那两个单引号只能用 chr(39) 拼出来。
q = chr(39)
old = ".ht-app[data-detail=" + q + "collapsed" + q + "] .ht-app__detail,"
assert s.count(old) == 1, "D: 找不到 collapsed 档那条 display:none"
s = s.replace(old, "/* 臂 D：故意拿掉 */\n")
io.open(base, "w", encoding="utf-8").write(s)
'

restore
if [ "$(digest "$BASE_CSS")" = "$BASE_SUM_CSS" ] && [ "$(digest "$RESIZER")" = "$BASE_SUM_TSX" ]; then
  echo "BACK_TO_CLEAN=OK"
else
  echo "BACK_TO_CLEAN=FAIL（文件没回到干净态）"
  FAILS=$((FAILS + 1))
fi
echo "DETAIL_TEETH_FAILS=$FAILS"
exit "$FAILS"
