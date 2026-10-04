#!/usr/bin/env bash
# calendar-line-commit-plan.sh 的 `--confirm` 那一腿的装置验证（三臂）。
#
# 🔴 为什么单独一把 rig：`--confirm` 腿从前**在任何树上都没有跑过** ——
#    它的旧前置"索引必须空"在共享工作树里几乎永远不成立（今天现场就是 1 枚别人的暂存项），
#    于是那腿实际是死代码，而一条没跑过的代码里出事的地方，恰好就是它真跑起来那天。
#    这次把前置换成"提交后逐字节对账别人的暂存"（§5b），**必须**当场证明 §5b 会红，
#    否则等于把一条会拦事故的闸门换成了一句打印。
#
# 三臂（都在 /tmp 下的一次性 git 小副本里跑，绝不碰主检出）：
#   臂 1  正向：索引里有**别人的**暂存项 ⇒ --only 提交成功，且别人那条 blob 哈希不变、仍在索引、
#              不在本笔的树里 ⇒ 期望 exit 0 且 §5b 打出对账行
#   臂 2  变异（§5b 的牙）：把脚本副本里的 `git commit --only` 改成裸 `git commit`
#              —— 那正是历史上"一笔吞掉别人 109 枚暂存"的形状 ⇒ 期望 exit 1 并点名那枚外来文件
#   臂 3  变异（§2 的牙）：把**本线点名路径**暂存成与工作树不同的另一份内容 ⇒ 期望 exit 1
#              （这条拦的是"--only 会用工作树覆盖别人对我方路径的暂存意图"——真有危险的那种）
#
# ⚠️ 这一臂测 §2/§4/§5/§5b 那段**动作**，不测 §3。理由不是偷懒，是 15:3x 现量：
#    `scripts/check-md-table-rows.mjs` 按**文件名**读 `docs/plans/calendar-year-time-and-mobile-profile.md`
#    （小副本里 ENOENT 直接抛，rc=1），`docs-link-check.mjs` 的自检要解析 `docs/runbooks/deployment.md`
#    （小副本里它报"检查器本身坏了"，rc=1）⇒ 那两道在**任何**夹具里都必然红。
#    所以夹具里换成会自报的桩（打印 STUB 并 exit 0）。代价由断言兜住、不靠"应该没事"：
#    每一臂都断言 `REACHED`（日志里出现 `== 5. --confirm`）与 `GATE3`（出现
#    `md-tables rc=0 / shell-unicode rc=0 / docs-link rc=0` 那一行 —— 桩的 stdout 被 §3
#    重定向进独立文件，**不会**出现在主日志里，第一版拿 `grep STUB` 断它，恒 0、臂 1 因此判红），
#    桩若把流程截在半路那一臂就判红 —— 不存在"桩恒绿所以恒过"。
#    §3 在主检出里是真跑的：本次入库前现场量到 md-tables=0 / shell-unicode=0 / docs-link=0。
#
# 用法：bash research/tools/calendar-line-commit-only-arms.sh
# 退出码：0 = 三臂如预期；1 = 某一臂不按预期（= 装置坏了，不是仓库坏了）
set -u
cd "$(dirname "$0")/../.." || exit 1
REAL_SCRIPT="research/tools/calendar-line-commit-plan.sh"
[ -f "$REAL_SCRIPT" ] || { echo "❌ 找不到被测脚本：$REAL_SCRIPT"; exit 1; }
L=/tmp/clc-$$           # 每跑唯一：固定名会被同一时刻另一趟的读数顶掉

PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); printf '✅ %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '❌ %s\n' "$1"; }
rd()  { printf '%s\n' "$1" | sed -n "s/^$2=//p"; }

# ---------------------------------------------------------------- fixture
# 最小 git 树：两枚已跟踪文件 + 一枚"别人"的暂存项 +（各臂自行加）本线的改动与新文件。
mk_fixture() {
  local F; F=$(mktemp -d /tmp/clc-only.XXXXXX)
  mkdir -p "$F/research/tools" "$F/scripts" "$F/docs/plans"
  cp "$REAL_SCRIPT" "$F/research/tools/"
  local g
  for g in check-md-table-rows check-shell-unicode-vars; do
    printf '#!/usr/bin/env node\nconsole.log("STUB %s: 本 rig 不测 3, 理由见文件头");\n' "$g" \
      > "$F/scripts/$g.mjs"
  done
  printf '#!/usr/bin/env node\nconsole.log("STUB docs-link: 本 rig 不测 3");\n' \
    > "$F/research/tools/docs-link-check.mjs"
  (
    cd "$F" || exit 1
    git init -q . >/dev/null
    git config user.email rig@local; git config user.name rig
    printf 'base\n' > a.txt
    printf '# 计划\n\n正文\n' > docs/plans/mine.md
    git add -A >/dev/null && git commit -qm base >/dev/null
    printf '%s\n' "$F"
  )
}

# --------------------------------------------------------- 臂 1 正向
F=$(mk_fixture) || { echo "❌ 夹具1 建不起来"; exit 1; }
echo "夹具1：$F"
(
  cd "$F" || exit 1
  printf 'FOREIGN staged v1\n' > foreign.txt
  git add -- foreign.txt
  FH=$(git ls-files --stage -- foreign.txt | awk '{print $2}')
  printf 'MINE\n' > a.txt
  printf '# 计划\n\n正文（改过）\n' > docs/plans/mine.md
  printf 'NEW\n' > new.txt
  MSG='test: 臂1' PATHS_OVERRIDE='a.txt|docs/plans/mine.md|new.txt' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm1.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "REACHED=$(grep -c '== 5. --confirm' "${L}.arm1.out" || true)"
    echo "GATE3=$(grep -c 'md-tables rc=0 / shell-unicode rc=0 / docs-link rc=0' "${L}.arm1.out" || true)"
    echo "BEFORE=$FH"
    echo "AFTER=$(git ls-files --stage -- foreign.txt | awk '{print $2}')"
    echo "IN_HEAD=$(git show --name-only --format= HEAD | grep -cxF foreign.txt || true)"
    echo "STILL_INDEXED=$(git diff --cached --name-only | grep -cxF foreign.txt || true)"
    echo "HAS_OK=$(grep -c '后置对账' "${L}.arm1.out" || true)"
    echo "MINE_IN_HEAD=$(git show --name-only --format= HEAD | grep -cE '^(a\.txt|new\.txt)$' || true)"
  } > "${L}.arm1.rd"
  exit $RC
)
A1=$(cat "${L}.arm1.rd" 2>/dev/null)
if [ "$(rd "$A1" RC)" = "0" ] && [ "$(rd "$A1" REACHED)" != "0" ] && [ "$(rd "$A1" GATE3)" != "0" ] \
   && [ -n "$(rd "$A1" BEFORE)" ] && [ "$(rd "$A1" BEFORE)" = "$(rd "$A1" AFTER)" ] \
   && [ "$(rd "$A1" IN_HEAD)" = "0" ] && [ "$(rd "$A1" STILL_INDEXED)" != "0" ] \
   && [ "$(rd "$A1" HAS_OK)" != "0" ] && [ "$(rd "$A1" MINE_IN_HEAD)" = "2" ]; then
  ok "臂1 正向：别人的暂存 blob 逐字不变($(rd "$A1" AFTER))、仍在索引、不在本笔；我的两枚进了 HEAD；§5b 打出对账行"
else
  bad "臂1 不如预期：$(printf '%s\n' "$A1" | tr '\n' ' ')"
  echo '--- 臂1 日志尾部 ---'; tail -25 "${L}.arm1.out"
fi

# ------------------------------------------------- 臂 2 变异：摘掉 --only
# 历史事故形状：裸 `git commit` 提交的是**整份索引** ⇒ 别人那枚一起进 HEAD。
# 这里改的是**夹具里那份副本**，主检出的脚本一字未动。
F2=$(mk_fixture) || { echo "❌ 夹具2 建不起来"; exit 1; }
(
  cd "$F2" || exit 1
  # 🔴 替换式里的 `$MSG` **必须写成 `\$MSG`**：perl 的替换侧会把它当变量插值，
  #    不转义就产出 `git commit -m ""` —— 那是语法都不对的行，MUT 读数会假装"变异没落地"。
  #    行尾**不锚 `$`**：变异只换前半段，` || { …; }` 留着（锚死结尾 MUT 恒 0、这一臂恒前提不成立）。
  perl -pi -e 's/^git commit --only -m "\$MSG" -- "\$\{NAMES\[@\]\}"/git commit -m "\$MSG"/' \
    research/tools/calendar-line-commit-plan.sh
  MUT=$(grep -c '^git commit -m "\$MSG"' research/tools/calendar-line-commit-plan.sh || true)
  printf 'FOREIGN staged v1\n' > foreign.txt
  git add -- foreign.txt
  printf 'MINE\n' > a.txt
  printf '# 计划\n\n正文（改过）\n' > docs/plans/mine.md
  # 被 perl 改过的副本**本身**落在本线命名空间里 ⇒ 必须一起点名，否则 §1b 先 exit 1，
  # 这一臂测的就不是 §5b 了（15:3x 实测到一次：红读的是"命名空间有改动却没点名"）。
  MSG='test: 臂2' PATHS_OVERRIDE='a.txt|docs/plans/mine.md|research/tools/calendar-line-commit-plan.sh' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm2.out" 2>&1
  RC=$?
  {
    echo "MUT=$MUT"
    echo "RC=$RC"
    echo "REACHED=$(grep -c '== 5. --confirm' "${L}.arm2.out" || true)"
    echo "NAMED=$(grep -c '别人的暂存被本笔带走了：foreign.txt' "${L}.arm2.out" || true)"
    echo "FOREIGN_IN_HEAD=$(git show --name-only --format= HEAD | grep -cxF foreign.txt || true)"
  } > "${L}.arm2.rd"
  exit $RC
)
A2=$(cat "${L}.arm2.rd" 2>/dev/null)
if [ "$(rd "$A2" MUT)" != "0" ] && [ "$(rd "$A2" REACHED)" != "0" ] && [ "$(rd "$A2" RC)" != "0" ] \
   && [ "$(rd "$A2" NAMED)" != "0" ] && [ "$(rd "$A2" FOREIGN_IN_HEAD)" != "0" ]; then
  ok "臂2 变异（裸 commit，MUT=$(rd "$A2" MUT)）：foreign.txt 真被带走 ⇒ §5b 点名并以 rc=$(rd "$A2" RC) 结束"
else
  bad "臂2 未按预期 ⇒ §5b 没有牙：$(printf '%s\n' "$A2" | tr '\n' ' ')"
  echo '--- 臂2 日志尾部 ---'; tail -25 "${L}.arm2.out"
fi

# ------------------------------------- 臂 3 变异：我方路径被暂存成别的内容
F3=$(mk_fixture) || { echo "❌ 夹具3 建不起来"; exit 1; }
(
  cd "$F3" || exit 1
  printf 'THEIRS staged\n' > a.txt
  git add -- a.txt
  printf 'MINE worktree\n' > a.txt          # 工作树随后又被改走 ⇒ 索引 ≠ 工作树
  printf '# 计划\n\n正文（改过）\n' > docs/plans/mine.md
  MSG='test: 臂3' PATHS_OVERRIDE='a.txt|docs/plans/mine.md' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm3.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "NAMED=$(grep -c '本线点名路径已被暂存成另一份内容：a.txt' "${L}.arm3.out" || true)"
    echo "COMMITTED=$(git log --oneline | grep -c 'test: 臂3' || true)"
    echo "STILL_STAGED=$(git diff --cached --name-only | grep -cxF a.txt || true)"
  } > "${L}.arm3.rd"
  exit $RC
)
A3=$(cat "${L}.arm3.rd" 2>/dev/null)
if [ "$(rd "$A3" RC)" != "0" ] && [ "$(rd "$A3" NAMED)" != "0" ] \
   && [ "$(rd "$A3" COMMITTED)" = "0" ] && [ "$(rd "$A3" STILL_STAGED)" != "0" ]; then
  ok "臂3 变异（我方路径暂存≠工作树）：§2 以 rc=$(rd "$A3" RC) 拒绝、没有产生提交、那份暂存原样留着"
else
  bad "臂3 未按预期：$(printf '%s\n' "$A3" | tr '\n' ' ')"
  echo '--- 臂3 日志尾部 ---'; tail -25 "${L}.arm3.out"
fi

rm -rf "$F" "$F2" "$F3"
echo "== 合计 pass=$PASS fail=$FAIL =="
rm -f "${L}".arm*.out "${L}".arm*.rd
[ "$FAIL" = 0 ] || exit 1
exit 0
