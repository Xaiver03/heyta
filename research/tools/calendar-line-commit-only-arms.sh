#!/usr/bin/env bash
# calendar-line-commit-plan.sh 的 `--confirm` 那一腿的装置验证（八臂）。
#
# 🔴 为什么单独一把 rig：`--confirm` 腿从前**在任何树上都没有跑过** ——
#    它的旧前置"索引必须空"在共享工作树里几乎永远不成立（今天现场就是 1 枚别人的暂存项），
#    于是那腿实际是死代码，而一条没跑过的代码里出事的地方，恰好就是它真跑起来那天。
#    这次把前置换成"提交后逐字节对账别人的暂存"（§5b），**必须**当场证明 §5b 会红，
#    否则等于把一条会拦事故的闸门换成了一句打印。
#
# 八臂（都在 /tmp 下的一次性 git 小副本里跑，绝不碰主检出）：
#   臂 1  正向：索引里有**别人的**暂存项 ⇒ --only 提交成功，且别人那条 blob 哈希不变、仍在索引、
#              不在本笔的树里 ⇒ 期望 exit 0 且 §5b 打出对账行
#   臂 2  变异（§5b 的牙）：把脚本副本里的 `git commit --only` 改成裸 `git commit`
#              —— 那正是历史上"一笔吞掉别人 109 枚暂存"的形状 ⇒ 期望 exit 1 并点名那枚外来文件
#   臂 3  变异（§2 的牙）：把**本线点名路径**暂存成与工作树不同的另一份内容 ⇒ 期望 exit 1
#              （这条拦的是"--only 会用工作树覆盖别人对我方路径的暂存意图"——真有危险的那种）
#   臂 4  §3 收窄后的**下界**（不许放行）：把带 `$var` 紧跟全角括号的 `.sh` **点名城进来**
#              ⇒ 期望 exit 3、且**没有产生提交**（"这一笔带得走的红"仍然拦得住）
#   臂 5  §3 收窄后的**上界**（不许过挡）：同一种红落在**没点名**的 `.sh` 上
#              ⇒ 期望 exit 0、点名路径照常进 HEAD、那枚别人的文件**仍脏在工作树里且不在本笔**
#   臂 6  在册的**动作腿**：脏 + 在册 + 在 PATHS ⇒ 期望提交里**没有**它、"待入库"枚数不含它，
#              而它仍脏在工作树里（只测打印的话，把分流那一段整块删掉另两臂照样全绿）
#   臂 7  在册断言①：条目漏了 `|理由` ⇒ 期望 exit 1 并点名（空理由的册子会把"带走"读成"已登记"）
#   臂 8  在册断言②：条目**不在 PATHS** ⇒ 期望 exit 1 并点名（§1 按 PATHS 遍历 ⇒ 只在册不在清单的那条永远走不到）
#
# 为什么要有 4/5 这一对（17:2x 现量，不是设想）：§3 原来是"仓库里这两道有任何红 ⇒ exit 3"。
# 现场那一趟的红在 `scripts/verify-mobile-ios-reminder.sh`（别人正在编辑、本清单点名 0 处），
# 而 `--only` 的提交集合恰好等于 NAMES ⇒ 那个红**结构上进不了这一笔**，本线入库却被它挡死。
# 收窄只改"量哪个集合"，判据本身没放宽。**方向性**是这一对的全部意义：
# 只测臂 4 会把闸门做得比原来更严也不被发现；只测臂 5 会把它悄悄摘成一句打印也不被发现。
#
# 🔴 臂 1–5 都显式传 `UNCARRIED_OVERRIDE=''`（**set 但为空**）。不传会掉回脚本里那 4 枚真路径，
#    而迷你树里根本没有它们 ⇒ §1b 先 exit 1 ⇒ 17:5x 那一趟是**五臂整片转红**，
#    红的还不是被测的那一段。判"有没有传"因此用 `${…+set}`，不是 `-n`。
#
# ⚠️ 夹具里三道门禁**两道是桩、一道是真的**（15:3x 现量，别读成"图省事"）：
#    `scripts/check-md-table-rows.mjs` 按**文件名**读 `docs/plans/calendar-year-time-and-mobile-profile.md`
#    （小副本里 ENOENT 直接抛，rc=1），`docs-link-check.mjs` 的自检要解析 `docs/runbooks/deployment.md`
#    （小副本里它报"检查器本身坏了"，rc=1）⇒ 那两道在**任何**夹具里都必然红，所以换成会自报的桩
#    （打印 STUB 并 exit 0）。而 `scripts/check-shell-unicode-vars.mjs` **原样拷进来跑真的** ——
#    它的 ROOT 取自己所在目录的上一级（`path.resolve(dirname, '..')`），
#    所以放在 `<夹具>/scripts/` 下量的就是那棵小树，不需要任何改动就能当被测对象。
#    代价由断言兜住、不靠"应该没事"：
#    每一臂都断言 `REACHED`（日志里出现 `== 5. --confirm`）与 `GATE3`（出现
#    `md-tables rc=0 / shell-unicode rc=0 / docs-link rc=0` 那一行 —— 桩的 stdout 被 §3
#    重定向进独立文件，**不会**出现在主日志里，第一版拿 `grep STUB` 断它，恒 0、臂 1 因此判红），
#    桩若把流程截在半路那一臂就判红 —— 不存在"桩恒绿所以恒过"。
#    臂 4 是个例外：它**期望** `shell-unicode rc=1`，所以断的是收窄那两行而不是 GATE3。
#    §3 在主检出里同样真跑：本次入库前现场量到 md-tables=0 / shell-unicode=1（红在别人的文件上）/ docs-link=0。
#
# 用法：bash research/tools/calendar-line-commit-only-arms.sh
# 退出码：0 = 八臂如预期；1 = 某一臂不按预期（= 装置坏了，不是仓库坏了）
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
# 最小 git 树：两枚已跟踪文件 + 两枚干净的 .sh（臂 4/5 各往其中一枚里造红）
# + 一枚"别人"的暂存项 +（各臂自行加）本线的改动与新文件。
mk_fixture() {
  local F; F=$(mktemp -d /tmp/clc-only.XXXXXX)
  mkdir -p "$F/research/tools" "$F/scripts" "$F/docs/plans"
  cp "$REAL_SCRIPT" "$F/research/tools/"
  # 🔴 shell-unicode 用**真门禁**（臂 4/5 测的就是它的归类，桩测不了）。
  #    它的 ROOT = 自己所在目录的上一级 ⇒ 放进 <夹具>/scripts/ 就自然扫那棵小树。
  cp scripts/check-shell-unicode-vars.mjs "$F/scripts/" || return 1
  for g in check-md-table-rows; do
    printf '#!/usr/bin/env node\nconsole.log("STUB %s: 本 rig 不测这一道, 理由见文件头");\n' "$g" \
      > "$F/scripts/$g.mjs"
  done
  printf '#!/usr/bin/env node\nconsole.log("STUB docs-link: 本 rig 不测这一道");\n' \
    > "$F/research/tools/docs-link-check.mjs"
  (
    cd "$F" || exit 1
    git init -q . >/dev/null
    git config user.email rig@local; git config user.name rig
    printf 'base\n' > a.txt
    printf '# 计划\n\n正文\n' > docs/plans/mine.md
    # 两枚 base 态**干净**的脚本：MINE_SCRIPT 归本线（臂 4 点名它），
    # OTHER_SCRIPT 归"别人"（臂 5 造红在它身上、刻意不点名）。
    printf 'FOO=bar\necho "x ${FOO} base"\n' > scripts/mine.sh
    printf 'FOO=bar\necho "x ${FOO} other"\n' > scripts/other.sh
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
  MSG='test: 臂1' PATHS_OVERRIDE='a.txt|docs/plans/mine.md|new.txt' UNCARRIED_OVERRIDE='' \
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
  MSG='test: 臂2' PATHS_OVERRIDE='a.txt|docs/plans/mine.md|research/tools/calendar-line-commit-plan.sh' UNCARRIED_OVERRIDE='' \
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
  MSG='test: 臂3' PATHS_OVERRIDE='a.txt|docs/plans/mine.md' UNCARRIED_OVERRIDE='' \
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

# --------------------------- 臂 4 §3 的下界：带得走的红仍然拦得住
# 造形与现场同一枚：`$FOO` 紧跟一个全角括号（§7 那族的字面形状）。
# 🔴 写在**单引号**的 printf 格式串里：门禁扫的是"会展开的地方的 `$var`+非 ASCII"，
#    单引号里它不展开、门禁跳它（文件头那条边界）；被写进夹具那枚 .sh 之后它才变成真红。
F4=$(mk_fixture) || { echo "❌ 夹具4 建不起来"; exit 1; }
(
  cd "$F4" || exit 1
  printf 'FOO=bar\necho "x $FOO（这一笔带得走的红）"\n' > scripts/mine.sh
  printf 'MINE\n' > a.txt
  MSG='test: 臂4' PATHS_OVERRIDE='a.txt|scripts/mine.sh' UNCARRIED_OVERRIDE='' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm4.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "R2=$(grep -c 'shell-unicode rc=1' "${L}.arm4.out" || true)"
    echo "CARRY1=$(grep -c '本笔带得走的\*\*：1 枚' "${L}.arm4.out" || true)"
    echo "NAMED=$(grep -c '会进这一笔：scripts/mine\.sh' "${L}.arm4.out" || true)"
    echo "COMMITTED=$(git log --oneline | grep -c 'test: 臂4' || true)"
    echo "STILL_DIRTY=$(git status --porcelain -- scripts/mine.sh a.txt | grep -c . || true)"
  } > "${L}.arm4.rd"
  exit $RC
)
A4=$(cat "${L}.arm4.rd" 2>/dev/null)
if [ "$(rd "$A4" RC)" = "3" ] && [ "$(rd "$A4" R2)" != "0" ] && [ "$(rd "$A4" CARRY1)" != "0" ] \
   && [ "$(rd "$A4" NAMED)" != "0" ] && [ "$(rd "$A4" COMMITTED)" = "0" ] \
   && [ "$(rd "$A4" STILL_DIRTY)" = "2" ]; then
  ok "臂4 §3 下界：红在点名路径上 ⇒ 真门禁 rc=1、归类为「带得走的 1 枚」、点名它并以 rc=3 结束（没产生提交、两枚仍脏在工作树）"
else
  bad "臂4 未按预期 ⇒ §3 被收窄成了放行：$(printf '%s\n' "$A4" | tr '\n' ' ')"
  echo '--- 臂4 日志尾部 ---'; tail -25 "${L}.arm4.out"
fi

# --------------------------- 臂 5 §3 的上界：带不走的红不许过挡
# 同一种红落在**没点名**的 `.sh` 上 ⇒ 它进不了这一笔的树，所以本线入库不该被它挡。
# 这一臂的对照对象是收窄**之前**的行为（那时它 exit 3、A 永久做不动），
# 也同时挡"把这一格摘成不判"的反向漂移：红仍然逐枚打印归属，且流程照走 §5/§5b。
F5=$(mk_fixture) || { echo "❌ 夹具5 建不起来"; exit 1; }
(
  cd "$F5" || exit 1
  printf 'FOREIGN staged v1\n' > foreign.txt
  git add -- foreign.txt
  FH=$(git ls-files --stage -- foreign.txt | awk '{print $2}')
  printf 'FOO=bar\necho "x $FOO（别人树上的红）"\n' > scripts/other.sh
  printf 'MINE\n' > a.txt
  printf '# 计划\n\n正文（改过）\n' > docs/plans/mine.md
  MSG='test: 臂5' PATHS_OVERRIDE='a.txt|docs/plans/mine.md' UNCARRIED_OVERRIDE='' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm5.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "REACHED=$(grep -c '== 5. --confirm' "${L}.arm5.out" || true)"
    echo "R2=$(grep -c 'shell-unicode rc=1' "${L}.arm5.out" || true)"
    echo "CARRY0=$(grep -c '本笔带得走的\*\*：0 枚' "${L}.arm5.out" || true)"
    echo "KEPT=$(grep -c '带不走（不是这一笔的树）：scripts/other\.sh' "${L}.arm5.out" || true)"
    echo "GO=$(grep -c '本笔要提交的文件里没有这类红' "${L}.arm5.out" || true)"
    echo "RECON=$(grep -c '后置对账' "${L}.arm5.out" || true)"
    echo "OTHER_STILL_DIRTY=$(git status --porcelain -- scripts/other.sh | grep -c . || true)"
    echo "OTHER_IN_HEAD=$(git show --name-only --format= HEAD | grep -cxF scripts/other.sh || true)"
    echo "BEFORE=$FH"
    echo "AFTER=$(git ls-files --stage -- foreign.txt | awk '{print $2}')"
  } > "${L}.arm5.rd"
  exit $RC
)
A5=$(cat "${L}.arm5.rd" 2>/dev/null)
if [ "$(rd "$A5" RC)" = "0" ] && [ "$(rd "$A5" REACHED)" != "0" ] && [ "$(rd "$A5" R2)" != "0" ] \
   && [ "$(rd "$A5" CARRY0)" != "0" ] && [ "$(rd "$A5" KEPT)" != "0" ] && [ "$(rd "$A5" GO)" != "0" ] \
   && [ "$(rd "$A5" RECON)" != "0" ] && [ "$(rd "$A5" OTHER_STILL_DIRTY)" = "1" ] \
   && [ "$(rd "$A5" OTHER_IN_HEAD)" = "0" ] && [ -n "$(rd "$A5" BEFORE)" ] \
   && [ "$(rd "$A5" BEFORE)" = "$(rd "$A5" AFTER)" ]; then
  ok "臂5 §3 上界：红在没点名的文件上 ⇒ 仍 rc=1 并逐枚打印归属，但归类为「带得走的 0 枚」后继续，别人的那枚既没进 HEAD 也没被顺手带走（它的暂存/工作树状态原样留着）"
else
  bad "臂5 未按预期 ⇒ §3 仍按「仓库有任何红就挡」或已被摘成不判：$(printf '%s\n' "$A5" | tr '\n' ' ')"
  echo '--- 臂5 日志尾部 ---'; tail -25 "${L}.arm5.out"
fi

# ---------------- 臂 6 在册的**动作腿**：脏 + 在册 + 在 PATHS ⇒ 不进这一笔
# 🔴 这一臂测的是"真的没带走"，不是"打印了一句在册"。
#    没有它，`is_uncarried` 那一段可以整块删掉而 1c 的三臂照样全绿（打印归打印、动作归动作）。
F6=$(mk_fixture) || { echo "❌ 夹具6 建不起来"; exit 1; }
(
  cd "$F6" || exit 1
  printf 'NOT MINE\n' > pic.png                       # 脏（未跟踪）
  printf 'MINE\n' > a.txt
  MSG='test: 臂6' PATHS_OVERRIDE='a.txt|pic.png' \
    UNCARRIED_OVERRIDE='pic.png|测试理由：这一枚的字节不是我拍的' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm6.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "REACHED=$(grep -c '== 5. --confirm' "${L}.arm6.out" || true)"
    echo "SEEN=$(grep -c '另「刻意不带」1 枚' "${L}.arm6.out" || true)"
    echo "PRINTED=$(grep -c '在册 \[??\]：pic\.png' "${L}.arm6.out" || true)"
    echo "REASON=$(grep -c '理由：测试理由' "${L}.arm6.out" || true)"
    echo "IN_HEAD=$(git show --name-only --format= HEAD | grep -cxF pic.png || true)"
    echo "MINE_IN_HEAD=$(git show --name-only --format= HEAD | grep -cxF a.txt || true)"
    echo "STILL_DIRTY=$(git status --porcelain -- pic.png | grep -c . || true)"
  } > "${L}.arm6.rd"
  exit $RC
)
A6=$(cat "${L}.arm6.rd" 2>/dev/null)
if [ "$(rd "$A6" RC)" = "0" ] && [ "$(rd "$A6" REACHED)" != "0" ] && [ "$(rd "$A6" SEEN)" != "0" ] \
   && [ "$(rd "$A6" PRINTED)" != "0" ] && [ "$(rd "$A6" REASON)" != "0" ] \
   && [ "$(rd "$A6" IN_HEAD)" = "0" ] && [ "$(rd "$A6" MINE_IN_HEAD)" = "1" ] \
   && [ "$(rd "$A6" STILL_DIRTY)" = "1" ]; then
  ok "臂6 在册的动作腿：pic.png 脏且在册 ⇒ 提交里有 a.txt、**没有** pic.png，而那枚仍在工作树里（打印 + 分流两件事都成立）"
else
  bad "臂6 未按预期 ⇒ 在册分流没落地：$(printf '%s\n' "$A6" | tr '\n' ' ')"
  echo '--- 臂6 日志尾部 ---'; tail -25 "${L}.arm6.out"
fi

# ---------------- 臂 7 在册断言①：没写理由 ⇒ 拒绝
# 格式写错（漏了 `|理由`）的那本册子会把"带走"读成"已登记" —— 比不登记更危险，所以它必须红。
F7=$(mk_fixture) || { echo "❌ 夹具7 建不起来"; exit 1; }
(
  cd "$F7" || exit 1
  printf 'NOT MINE\n' > pic.png
  printf 'MINE\n' > a.txt
  MSG='test: 臂7' PATHS_OVERRIDE='a.txt|pic.png' UNCARRIED_OVERRIDE='pic.png' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm7.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "NAMED=$(grep -c '在册条目没写理由' "${L}.arm7.out" || true)"
    echo "COMMITTED=$(git log --oneline | grep -c 'test: 臂7' || true)"
  } > "${L}.arm7.rd"
  exit $RC
)
A7=$(cat "${L}.arm7.rd" 2>/dev/null)
if [ "$(rd "$A7" RC)" != "0" ] && [ "$(rd "$A7" NAMED)" != "0" ] && [ "$(rd "$A7" COMMITTED)" = "0" ]; then
  ok "臂7 断言①：在册条目漏了理由 ⇒ 点名并以 rc=$(rd "$A7" RC) 拒绝、没有产生提交"
else
  bad "臂7 未按预期 ⇒ 断言①没牙（空理由的册子会被当成已登记）：$(printf '%s\n' "$A7" | tr '\n' ' ')"
  echo '--- 臂7 日志尾部 ---'; tail -25 "${L}.arm7.out"
fi

# ---------------- 臂 8 在册断言②：在册却不在 PATHS ⇒ 拒绝
# 只在册不在清单 ⇒ §1 根本遍历不到它，那本册子就是**装饰**（它既不会被带走也不会被 1b 看见）。
F8=$(mk_fixture) || { echo "❌ 夹具8 建不起来"; exit 1; }
(
  cd "$F8" || exit 1
  printf 'MINE\n' > a.txt
  MSG='test: 臂8' PATHS_OVERRIDE='a.txt' UNCARRIED_OVERRIDE='ghost.png|它不在清单里' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm8.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "NAMED=$(grep -c '在册却不在 PATHS：ghost\.png' "${L}.arm8.out" || true)"
    echo "COMMITTED=$(git log --oneline | grep -c 'test: 臂8' || true)"
  } > "${L}.arm8.rd"
  exit $RC
)
A8=$(cat "${L}.arm8.rd" 2>/dev/null)
if [ "$(rd "$A8" RC)" != "0" ] && [ "$(rd "$A8" NAMED)" != "0" ] && [ "$(rd "$A8" COMMITTED)" = "0" ]; then
  ok "臂8 断言②：在册却没写进 PATHS ⇒ 点名 ghost.png 并以 rc=$(rd "$A8" RC) 拒绝（两处必须一起写）"
else
  bad "臂8 未按预期 ⇒ 断言②没牙：$(printf '%s\n' "$A8" | tr '\n' ' ')"
  echo '--- 臂8 日志尾部 ---'; tail -25 "${L}.arm8.out"
fi

rm -rf "$F" "$F2" "$F3" "$F4" "$F5" "$F6" "$F7" "$F8"
echo "== 合计 pass=$PASS fail=$FAIL =="
rm -f "${L}".arm*.out "${L}".arm*.rd
[ "$FAIL" = 0 ] || exit 1
exit 0
