#!/usr/bin/env bash
# §10.146 那句"HEAD 的 step 5 本体逐字存活，我只加了一个分支"是不是**现在**还成立。
# 原来的量法是硬行号（577,647 / 577,698）—— HEAD 一动行号就漂，所以这版改成按 step 标题取块。
#
# 🔴 这一版修的是**上一版的自己**：`block()` 的签名收了 $2 却把结果打在 stdout 上，
# 两个块文件从没被创建 ⇒ `comm` 报错、`grep -c ''` 得到空串、`[ "" = "0" ]` 为假 ⇒ 三道空值守卫
# 一道都没触发，最后照样打印 `VERBATIM=survives`（rc=0）。那是一条**恒真**的判据（traps #288 同族）。
# 现在：块必须落盘、落盘必须非空、锚点必须可见，且每次正常读数之后都跑一次
# **阳性对照**（从工作树那块里删掉 HEAD 也有的那一行 ⇒ 必须报 MISSING=1）。对照不红就整体不作数。
set -uo pipefail
# 根目录由**脚本自己的位置**往上找到 `.git` 为止：
#   `dirname $0/..` 那种写法只在"文件躺在仓库根下一层"时成立（这台上就是 —— 它原来躺在 tmp/），
#   而 `git rev-parse --show-toplevel` 换了一个断法：从**别的目录**调起这台装置时就炸（实测 cwd=/tmp）。
# 两种错法都不响亮，所以取"跟着文件走"的那一条。
_d=$(cd "$(dirname "$0")" && pwd)
while [ "$_d" != "/" ] && [ ! -d "$_d/.git" ]; do _d=$(dirname "$_d"); done
[ -d "$_d/.git" ] || { echo "ROOT=NOT-FOUND（从 $0 往上没找到 .git ⇒ 这台装置不在仓库里，读数不作数）"; exit 1; }
cd "$_d" || exit 1
RIG=scripts/verify-mobile-account-erasure.sh
HEAD_REF=${HEAD_REF:-HEAD}
HB=/tmp/b76-head-block.txt
WB=/tmp/b76-work-block.txt
ANCHOR='判据 C'

extract_block() { # $1=源文件 $2=输出（必须非空，且含锚点行）
  awk '/^step "5/{f=1} f&&/^step "6/{f=0} f' "$1" \
    | sed 's/^[[:space:]]*//' | grep -v '^[[:space:]]*$' | sort -u > "$2" || true
  [ -s "$2" ] || { echo "VERBATIM=EXTRACT-EMPTY（$2 是空文件或没写成 ⇒ 锚点 step \"5→step \"6 没命中，本结论不作数）"; exit 1; }
  ANCHOR_HITS=$(grep -c "$ANCHOR" "$2")
  [ "$ANCHOR_HITS" -ge 1 ] || { echo "VERBATIM=ANCHOR-MISSING（$2 有 $(grep -c '' "$2") 行但读不到「${ANCHOR}」⇒ 取到的是别的块）"; exit 1; }
  echo "   $2：$(grep -c '' "$2") 行，锚点「${ANCHOR}」命中 $ANCHOR_HITS"
}

git show "${HEAD_REF}:${RIG}" > /tmp/b76-verbatim-head.sh 2>/dev/null || {
  echo "VERBATIM=NO-HEAD-COPY（git show 失败：${HEAD_REF} 里没有 ${RIG}）"; exit 1; }

say() { printf '\n════ %s ════\n' "$1"; }

say "1. 取块（HEAD 版 vs 工作树版）"
echo "   载具：HEAD=$(git rev-parse --short "${HEAD_REF}")  取块方式=step5→step6 逐行去缩进集合"
extract_block /tmp/b76-verbatim-head.sh "$HB"
extract_block "$RIG" "$WB"

missing_lines() { comm -23 "$1" "$2"; }

say "2. 正常读数"
HEAD_LINES=$(grep -c '' "$HB"); WORK_LINES=$(grep -c '' "$WB")
MISSING=$(missing_lines "$HB" "$WB" | grep -c '' || true)
ADDED=$(comm -13 "$HB" "$WB" | grep -c '' || true)
printf '   HEAD 块 %s 行 / 工作树块 %s 行\n' "$HEAD_LINES" "$WORK_LINES"
printf '   HEAD 里有而工作树没有的（= 被改写的原句）：%s 行\n' "$MISSING"
printf '   工作树新增的：%s 行\n' "$ADDED"
if [ "$MISSING" != "0" ]; then
  echo '   ⇒ 原句清单：'
  missing_lines "$HB" "$WB" | sed 's/^/     | /' | cut -c1-140
fi

say "3. 阳性对照（判据必须能红）"
# 从工作树那块删掉一行**两边都有**的行 ⇒ 同一段比较必须报 MISSING=1。
# （取"两边都有"而不是"HEAD 首行"：HEAD 首行可能正好就是缺的那条，拿它当对照等于自证。）
PROBE_LINE=$(comm -12 "$HB" "$WB" | head -1)
if [ -z "$PROBE_LINE" ]; then echo "   CONTROL=NO-LINE（两块没有公共行 ⇒ 无法造对照）"; exit 1; fi
cp "$WB" /tmp/b76-work-mut.txt
grep -F -v -- "$PROBE_LINE" /tmp/b76-work-mut.txt > /tmp/b76-work-mut.txt.2 || true
BEFORE=$(grep -c '' /tmp/b76-work-mut.txt)
AFTER=$(grep -c '' /tmp/b76-work-mut.txt.2)
REMOVED=$(( BEFORE - AFTER ))
if [ "$REMOVED" -lt 1 ]; then
  echo "   CONTROL=NO-OP（那一行删不掉 ⇒ 对照腿无效）"; rm -f /tmp/b76-work-mut.txt /tmp/b76-work-mut.txt.2 /tmp/b76-verbatim-head.sh; exit 1
fi
CTRL_MISSING=$(missing_lines "$HB" /tmp/b76-work-mut.txt.2 | grep -c '' || true)
EXPECT=$(( MISSING + REMOVED ))
echo "   按「包含」删掉了 ${REMOVED} 行 ⇒ MISSING 从 ${MISSING} 变成 ${CTRL_MISSING}（要恰好等于 ${MISSING}+${REMOVED}=${EXPECT}）"
rm -f /tmp/b76-work-mut.txt /tmp/b76-work-mut.txt.2 /tmp/b76-verbatim-head.sh
# 🔴 期望值是 MISSING+REMOVED 而不是 REMOVED：改这一版之前我写的就是后者，于是**一趟真实读数被自己的
# 对照判据判成 UNFAIABLE** —— 对照确实有牙（多删一行就多报一行），坏的是那条算术。设备比我对它的要求严。
if [ "$CTRL_MISSING" != "$EXPECT" ]; then
  echo "   VERBATIM=UNFAIABLE（对照的增量 ${CTRL_MISSING}-${MISSING} ≠ 实际删掉的行数 ${REMOVED} ⇒ 计数与删行不成对，上面的读数不算数）"; exit 1
fi
echo "   CONTROL=OK（删 ${REMOVED} 行 ⇒ MISSING 恰好 $(( CTRL_MISSING - MISSING )) 行，逐行成对）"

say "4. 结论"
# 把"缺的那行是不是 step 标题"分开报，免得我凭眼睛把"只改了标题"写成结论。
BODY_MISSING=$(missing_lines "$HB" "$WB" | grep -vc '^step "5' || true)
if [ "$MISSING" = "0" ]; then
  echo "   VERBATIM=survives —— HEAD（$(git rev-parse --short "${HEAD_REF}")）的 step 5 本体逐行都在工作树里，"
  echo "            工作树只往那块加了 $ADDED 行。§10.146 那句到这一趟仍然成立。"
  exit 0
fi
if [ "$BODY_MISSING" = "0" ]; then
  echo "   VERBATIM=title-only —— 缺的 $MISSING 行**全部**是 step \"5 那一行标题本体（$BODY_MISSING 行是标题之外的正文）。"
  echo "            ⇒ §10.146 那句「本体逐字存活、只加分支」对**正文**成立，但「逐字」要划掉标题那一行。"
  exit 1
fi
echo "   VERBATIM=rewritten —— HEAD 的 step 5 有 $MISSING 行不在工作树里，其中 $BODY_MISSING 行是标题之外的正文。"
echo "            §10.146 那句「只加了一个分支」不再成立，要原地更正。"
exit 1
