#!/usr/bin/env bash
# calendar-line-commit-plan.sh 的 `--confirm` 那一腿的装置验证。
#    ⚠️ **臂数不写在这份说明里**（写过一次"八臂"，加第 九 臂那天就漂了）—— 现量取最后一行 `== 合计 pass=… fail=… ==`。
#
# 🔴 为什么单独一把 rig：`--confirm` 腿从前**在任何树上都没有跑过** ——
#    它的旧前置"索引必须空"在共享工作树里几乎永远不成立（今天现场就是 1 枚别人的暂存项），
#    于是那腿实际是死代码，而一条没跑过的代码里出事的地方，恰好就是它真跑起来那天。
#    这次把前置换成"提交后逐字节对账别人的暂存"（§5b），**必须**当场证明 §5b 会红，
#    否则等于把一条会拦事故的闸门换成了一句打印。
#
# 各臂（都在 /tmp 下的一次性 git 小副本里跑，绝不碰主检出）：
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
#   臂 9  3b 的**进门那一腿**：`--confirm` 而**不给 ANCHORS** ⇒ 期望 exit 1、点名"没传 ANCHORS"、且不产生提交
#   臂 10 「**本线删除**」那一格的**动作腿**：点名一枚"索引里有、工作树恰好是 ' D'"的路径
#              ⇒ 期望 rc 0、分项打印含 `删除 1` 且与总数自洽、那枚以 `D` 出现在提交里、3b 真的量到它的 hunk
#   臂 11 同一格的**下界①**：点名一枚**索引里也没有**的路径（清单写错/改名后的形状）⇒ 期望 exit 1 且不产生提交
#   臂 12 同一格的**下界②**：那枚删除是**别人已经暂存**的（状态 `D `，索引里已没有它）⇒ 同样期望 exit 1
#              （10/11/12 是一组**方向性**三腿：只做 10 会把口子开成"磁盘上没有的也能带走"也不被发现）
#   臂 13 1b 的**推导格**：夹具里造一枚 NS_RE **结构上匹配不到**的脏证据图（新目录名不在任何交替式里），
#              但它的 README 有 UIPIN ⇒ 期望 rc≠0、由推导格点名，并**同时断言手写枚举那一格没吭声**
#              （`NS_NAMED=0`）—— 这一臂证的不是"又报了一次红"，是"这一格能报到那一格报不到的地方"
#   臂 14 臂 13 的**配对下界**：同一夹具把图点名 ⇒ 期望 rc=0 且"未点名 0 枚"
#              （缺它就无法区分"推导格抓到了漏"与"这棵夹具树本来就跑不通"）
#
# 🔴 **臂 1/2/5/6 必须传 ANCHORS，而这件事曾经没人传（10-05 11:5x 现量查出）**：
#    `cbd18178` 给被测脚本加了"3b 在 --confirm 下缺 ANCHORS 就 exit 1"，**却没同步这套 rig**
#    ⇒ 四臂从那天起整片红，而且红的不是它声称测的那一段（第 5 步根本没到，`REACHED=0`）。
#    现量：那条改动落在 `cbd18178`（10-04 23:32），本 rig 距它约 **12 小时**没被执行过
#    —— `grep -rn calendar-line-commit-only-arms package.json scripts/ .github/workflows/` 现量**为空**
#    ⇒ 它没有任何常驻消费者，"红"不会自己开口；它只在有人**主动跑它**的那一刻才有声音。
#    配套：臂 1 除了 `REACHED` 还断言日志里出现 `== 3b. hunk 归属` 与 `孤儿 0 枚`
#    ——只断 rc=0 的话，"ANCHORS 传了但 3b 整段被摘掉"也能给我一个绿（改输入集合 ≠ 那条被走过）。
#
# 为什么要有 4/5 这一对（17:2x 现量，不是设想）：§3 原来是"仓库里这两道有任何红 ⇒ exit 3"。
# 现场那一趟的红在 `scripts/verify-mobile-ios-reminder.sh`（别人正在编辑、本清单点名 0 处），
# 而 `--only` 的提交集合恰好等于 NAMES ⇒ 那个红**结构上进不了这一笔**，本线入库却被它挡死。
# 收窄只改"量哪个集合"，判据本身没放宽。**方向性**是这一对的全部意义：
# 只测臂 4 会把闸门做得比原来更严也不被发现；只测臂 5 会把它悄悄摘成一句打印也不被发现。
#
# 🔴 臂 1–5 都显式传 `UNCARRIED_OVERRIDE=''`（**set 但为空**）。不传会掉回脚本里那本**在册册子**
#    （它跟着现量涨删，枚数不写在这里），而迷你树里根本没有那些真路径 ⇒ §1b 先 exit 1
#    ⇒ 17:5x 那一趟是**五臂整片转红**，红的还不是被测的那一段。判"有没有传"因此用 `${…+set}`，不是 `-n`。
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
# 退出码：0 = 每一臂都如预期；1 = 某一臂不按预期（= 装置坏了，不是仓库坏了）
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
  # 🔴 3b 会被 --confirm 那腿调用，所以**被依赖的那枚必须与调用者同列进夹具**
  #    （§7 那一族：lib 缺席时调用方报 "No such file or directory"，读数会退化成"有孤儿 hunk"这种假归因）。
  cp research/tools/calendar-line-hunk-ownership.sh "$F/research/tools/"
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
    ANCHORS='MINE NEW 正文（改过）' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm1.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "REACHED=$(grep -c '== 5. --confirm' "${L}.arm1.out" || true)"
    echo "GATE3=$(grep -c 'md-tables rc=0 / shell-unicode rc=0 / docs-link rc=0' "${L}.arm1.out" || true)"
    # 🔴 这两行是**路由自证**：只断 rc=0 的话，"把 3b 整段摘掉"也能给我一个绿。
    echo "ANCHOR_RUN=$(grep -c '== 3b. hunk 归属' "${L}.arm1.out" || true)"
    echo "ORPHAN0=$(grep -c '孤儿 0 枚' "${L}.arm1.out" || true)"
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
   && [ "$(rd "$A1" HAS_OK)" != "0" ] && [ "$(rd "$A1" MINE_IN_HEAD)" = "2" ] \
   && [ "$(rd "$A1" ANCHOR_RUN)" != "0" ] && [ "$(rd "$A1" ORPHAN0)" != "0" ]; then
  ok "臂1 正向：别人的暂存 blob 逐字不变($(rd "$A1" AFTER))、仍在索引、不在本笔；我的两枚进了 HEAD；§5b 打出对账行；3b 那一格真被走到且孤儿 0"
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
    ANCHORS='MINE 正文（改过） commit' \
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
    ANCHORS='MINE 正文（改过）' \
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
    ANCHORS='MINE' \
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

# ---------------- 臂 9 3b 的进门那一腿：--confirm 却不给 ANCHORS ⇒ 拒绝且不产生提交
# 🔴 这一臂是这次补的**原因本身**：`cbd18178` 加了那条强制却没同步本 rig，四臂从此整片红，
#    而"缺 ANCHORS 就拒"这条新判据在 rig 里**一条断言都没有** —— 也就是说它当时是一条
#    只在被测脚本里存在、没有任何装置证明它会红的闸门（正是本仓反复犯的那一形）。
F9=$(mk_fixture) || { echo "❌ 夹具9 建不起来"; exit 1; }
(
  cd "$F9" || exit 1
  printf 'MINE\n' > a.txt
  HEAD_BEFORE=$(git rev-parse HEAD)
  MSG='test: 臂9' PATHS_OVERRIDE='a.txt' UNCARRIED_OVERRIDE='' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm9.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "NAMED=$(grep -c '却没传 ANCHORS' "${L}.arm9.out" || true)"
    echo "NOT_REACHED=$(grep -c '== 5. --confirm' "${L}.arm9.out" || true)"
    echo "HEAD_SAME=$([ "$(git rev-parse HEAD)" = "$HEAD_BEFORE" ] && echo yes || echo no)"
  } > "${L}.arm9.rd"
  exit $RC
)
A9=$(cat "${L}.arm9.rd" 2>/dev/null)
if [ "$(rd "$A9" RC)" != "0" ] && [ "$(rd "$A9" NAMED)" != "0" ] \
   && [ "$(rd "$A9" NOT_REACHED)" = "0" ] && [ "$(rd "$A9" HEAD_SAME)" = "yes" ]; then
  ok "臂9 进门腿：--confirm 缺 ANCHORS ⇒ rc=$(rd "$A9" RC) 并点名那句理由、没走到第 5 步、HEAD 一枚提交都没多"
else
  bad "臂9 未按预期 ⇒ 3b 那条强制没牙或它挡住了本该继续的流程：$(printf '%s\n' "$A9" | tr '\n' ' ')"
  echo '--- 臂9 日志尾部 ---'; tail -25 "${L}.arm9.out"
fi

# --------- 臂 10/11/12 「本线删除」那一格：动作腿 + 两条下界
# 🔴 这一组是 10-05 12:0x 加**那条分支的同一趟**补的：入库装置原来把"点名路径不在磁盘上"一律判
#    "清单过期 exit 1"，于是"按判据处置掉一枚取证图"这种**真实交付形状**走不了本线的提交装置。
#    放宽一个前置而不同时补臂，就是上一笔刚犯过的错（加闸门的人没同步测闸门的人）。
mk_del_fixture() {
  local F; F=$(mk_fixture) || return 1
  ( cd "$F" || exit 1
    printf '# 计划\n\n正文（改过）\n' > docs/plans/mine.md )
  printf '%s\n' "$F"
}

F10=$(mk_del_fixture) || { echo "❌ 夹具10 建不起来"; exit 1; }
(
  cd "$F10" || exit 1
  rm -f a.txt                                   # 工作树删除、索引未动 ⇒ 状态恰好 " D"
  HEAD_BEFORE=$(git rev-parse HEAD)
  MSG='test: 臂10' PATHS_OVERRIDE='a.txt|docs/plans/mine.md' UNCARRIED_OVERRIDE='' \
    ANCHORS='正文（改过） base' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm10.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "STATUS_BEFORE=$(git show --name-status --format= HEAD | tr -d ' \t' | grep -c '^Da\.txt$' || true)"
    echo "SUM=$(grep -c '待入库 2 枚（改动 1 / 新增 0 / 删除 1）' "${L}.arm10.out" || true)"
    echo "BRANCH=$(grep -c '🗑 本线删除' "${L}.arm10.out" || true)"
    echo "HUNKED=$(grep -c 'a\.txt：hunk' "${L}.arm10.out" || true)"
    echo "ORPHAN0=$(grep -c '孤儿 0 枚' "${L}.arm10.out" || true)"
    echo "GONE=$([ ! -e a.txt ] && echo yes || echo no)"
    echo "HEAD_MOVED=$([ "$(git rev-parse HEAD)" != "$HEAD_BEFORE" ] && echo yes || echo no)"
  } > "${L}.arm10.rd"
  exit $RC
)
A10=$(cat "${L}.arm10.rd" 2>/dev/null)
if [ "$(rd "$A10" RC)" = "0" ] && [ "$(rd "$A10" STATUS_BEFORE)" = "1" ] \
   && [ "$(rd "$A10" SUM)" != "0" ] && [ "$(rd "$A10" BRANCH)" != "0" ] \
   && [ "$(rd "$A10" HUNKED)" != "0" ] && [ "$(rd "$A10" ORPHAN0)" != "0" ] \
   && [ "$(rd "$A10" GONE)" = "yes" ] && [ "$(rd "$A10" HEAD_MOVED)" = "yes" ]; then
  ok "臂10 动作腿：' D' 那枚被带走并在提交里记成 D、分项与总数自洽（删除 1 进了打印）、3b 真量到它的 hunk 且孤儿 0"
else
  bad "臂10 未按预期 ⇒ 「本线删除」那一格坏了或没被走到：$(printf '%s\n' "$A10" | tr '\n' ' ')"
  echo '--- 臂10 日志尾部 ---'; tail -25 "${L}.arm10.out"
fi

F11=$(mk_del_fixture) || { echo "❌ 夹具11 建不起来"; exit 1; }
(
  cd "$F11" || exit 1
  HEAD_BEFORE=$(git rev-parse HEAD)
  MSG='test: 臂11' PATHS_OVERRIDE='ghost.png|docs/plans/mine.md' UNCARRIED_OVERRIDE='' \
    ANCHORS='正文（改过）' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm11.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "NAMED=$(grep -c '不满足「本线删除」那三条件' "${L}.arm11.out" || true)"
    echo "NOT_REACHED=$(grep -c '== 5. --confirm' "${L}.arm11.out" || true)"
    echo "HEAD_SAME=$([ "$(git rev-parse HEAD)" = "$HEAD_BEFORE" ] && echo yes || echo no)"
  } > "${L}.arm11.rd"
  exit $RC
)
A11=$(cat "${L}.arm11.rd" 2>/dev/null)
if [ "$(rd "$A11" RC)" != "0" ] && [ "$(rd "$A11" NAMED)" != "0" ] \
   && [ "$(rd "$A11" NOT_REACHED)" = "0" ] && [ "$(rd "$A11" HEAD_SAME)" = "yes" ]; then
  ok "臂11 下界①：清单里一枚索引也没有的路径 ⇒ rc=$(rd "$A11" RC) 点名拒绝、没走到第 5 步、HEAD 没多提交（放宽没放宽成'磁盘上没有也带走'）"
else
  bad "臂11 未按预期 ⇒ 那条口子开过头了：$(printf '%s\n' "$A11" | tr '\n' ' ')"
  echo '--- 臂11 日志尾部 ---'; tail -25 "${L}.arm11.out"
fi

F12=$(mk_del_fixture) || { echo "❌ 夹具12 建不起来"; exit 1; }
(
  cd "$F12" || exit 1
  git rm -q a.txt                               # 别人**已经把删除暂存**了：状态 `D `、索引里已无此枚
  HEAD_BEFORE=$(git rev-parse HEAD)
  MSG='test: 臂12' PATHS_OVERRIDE='a.txt|docs/plans/mine.md' UNCARRIED_OVERRIDE='' \
    ANCHORS='正文（改过）' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm12.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "NAMED=$(grep -c '不满足「本线删除」那三条件' "${L}.arm12.out" || true)"
    # 🔴 判"没被吞"要看**那枚暂存本身还在不在**，不能拿 `git show HEAD` 数文件 ——
    #    这一臂 HEAD 根本不该动，而 base 提交里本来就有 a.txt ⇒ 那样数恒 1（我第一版就是这么写错的，
    #    臂当场红给我看：红的是臂的断言，不是闸门。日志三行显示 rc=1 + 点名 + HEAD 未动，全对）。
    echo "STILL_STAGED=$(git status --porcelain -- a.txt | cut -c1)"
    echo "HEAD_SAME=$([ "$(git rev-parse HEAD)" = "$HEAD_BEFORE" ] && echo yes || echo no)"
  } > "${L}.arm12.rd"
  exit $RC
)
A12=$(cat "${L}.arm12.rd" 2>/dev/null)
if [ "$(rd "$A12" RC)" != "0" ] && [ "$(rd "$A12" NAMED)" != "0" ] \
   && [ "$(rd "$A12" STILL_STAGED)" = "D" ] && [ "$(rd "$A12" HEAD_SAME)" = "yes" ]; then
  ok "臂12 下界②：别人暂存的删除不被当成「本线删除」带走 ⇒ rc=$(rd "$A12" RC) 拒绝、那枚的索引列仍是 D（暂存原样留着）、HEAD 未动（出路是 restore --staged，不是放宽判据）"
else
  bad "臂12 未按预期 ⇒ 别人暂存的删除被吞进本笔：$(printf '%s\n' "$A12" | tr '\n' ' ')"
  echo '--- 臂12 日志尾部 ---'; tail -25 "${L}.arm12.out"
fi

# --------- 臂 13/14 1b 的「推导格」：NS_RE 看不见的那一枚，它必须看得见
# 🔴 为什么要这两臂（12:5x，与加格同趟）：这一格的存在理由**不是**"再多一条反查"，而是
#    "反查的范围由仓库事实推导，不由我手写的正则决定"。所以它的判据必须是
#    **一枚 NS_RE 结构上匹配不到的文件** —— 否则红了也分不清是谁干的，
#    而"分不清是谁干的"就等于这条新格从来没有牙（trap #165 那一族：变异要配对的断言）。
#    夹具形状：`apps/web/evidence/zderived/` 这枚目录名**不在 NS_RE 的任何交替式里**，
#    但它的 README 里有一行 UIPIN ⇒ 推导格据 README 认出"图字节与锚点绑死"。
mk_deriv_fixture() {
  local F; F=$(mk_fixture) || return 1
  ( cd "$F" || exit 1
    mkdir -p apps/web/evidence/zderived
    printf '# 取证\n\nUIPIN zderived/z.png %s apps/web/src/calendar/CalendarBoard.tsx\n' \
      "$(git rev-parse --short HEAD)" > apps/web/evidence/zderived/README.md
    printf 'PNG-BYTES-v1\n' > apps/web/evidence/zderived/z.png
    git add -A >/dev/null && git commit -qm 'evidence base' >/dev/null
    # 模拟"重拍写了整目录"：README 与图的字节**同时**变了，而点名清单只有 README。
    printf '# 取证（重钉锚点后）\n\nUIPIN zderived/z.png %s apps/web/src/calendar/CalendarBoard.tsx\n' \
      "$(git rev-parse --short HEAD)" > apps/web/evidence/zderived/README.md
    printf 'PNG-BYTES-v2-reshoot\n' > apps/web/evidence/zderived/z.png )
  printf '%s\n' "$F"
}

F13=$(mk_deriv_fixture) || { echo "❌ 夹具13 建不起来"; exit 1; }
(
  cd "$F13" || exit 1
  # 先自证前提成立（两条都必须是"匹配不到 / 脏着"，否则这一臂测的是空气）：
  #   ① NS_RE 里那支证据目录的交替式对 `zderived` 不命中，② 图在 git 眼里是 ' M'。
  {
    echo "PRE_NS_RE_HIT=$(printf 'apps/web/evidence/zderived/z.png\n' | grep -cE \
      '^apps/web/evidence/(calendar-day|calendar-view-options|profile-panel)/[^/]+\.(md|png)$|^apps/web/evidence/(calendar-year|calendar-day-time|calendar-cells|calendar-week|calendar-capture)/[^/]+\.(md|png)$' || true)"
    echo "PRE_DIRTY=$(git status --porcelain -- apps/web/evidence/zderived/z.png | cut -c1-2 | tr -d ' ')"
  } > "${L}.arm13.pre"
  RC_PRE=0
  MSG_UNUSED=1 PATHS_OVERRIDE='docs/plans/mine.md|apps/web/evidence/zderived/README.md' \
    UNCARRIED_OVERRIDE='' \
    bash research/tools/calendar-line-commit-plan.sh > "${L}.arm13.out" 2>&1 || RC_PRE=$?
  {
    echo "RC=$RC_PRE"
    echo "DERIV_NAMED=$(grep -c '推导格.*脏了却没点名.*zderived/z\.png' "${L}.arm13.out" || true)"
    echo "NS_NAMED=$(grep -c '本线命名空间有改动却没点名.*zderived' "${L}.arm13.out" || true)"
    echo "DERIV_COUNT=$(grep -oE '钉锚点目录内脏 png [0-9]+ 枚，未点名 [0-9]+ 枚' "${L}.arm13.out" || true)"
  } > "${L}.arm13.rd"
  exit $RC_PRE
)
A13=$(cat "${L}.arm13.rd" 2>/dev/null); P13=$(cat "${L}.arm13.pre" 2>/dev/null)
if [ "$(rd "$A13" RC)" != "0" ] && [ "$(rd "$A13" DERIV_NAMED)" != "0" ] \
   && [ "$(rd "$A13" NS_NAMED)" = "0" ] && [ "$(rd "$P13" PRE_NS_RE_HIT)" = "0" ] \
   && [ "$(rd "$P13" PRE_DIRTY)" = "M" ] && [ "$(rd "$A13" DERIV_COUNT)" = "钉锚点目录内脏 png 1 枚，未点名 1 枚" ]; then
  ok "臂13 推导格有牙：NS_RE 结构上匹配不到的那枚脏图（前置现量 PRE_NS_RE_HIT=0）被推导格判红并点名，而手写枚举那一格确实一个字没说它（NS_NAMED=0）⇒ 这一格挡住的正是枚举少一支的那类漏"
else
  bad "臂13 未按预期 ⇒ 推导格坏了、或它红的原因是别的、或前提（NS_RE 匹配不到）不成立：$(printf '%s\n' "$A13" "$P13" | tr '\n' ' ')"
  echo '--- 臂13 日志尾部 ---'; tail -25 "${L}.arm13.out"
fi

F14=$(mk_deriv_fixture) || { echo "❌ 夹具14 建不起来"; exit 1; }
(
  cd "$F14" || exit 1
  # 配对臂：同一枚夹具、只把图**点名列进清单** ⇒ 那一格必须转绿。
  # 没有这一臂，臂13 的红可能来自"这棵夹具树本来就跑不通"，而不是"推导格抓到了漏"。
  MSG_UNUSED=1 PATHS_OVERRIDE='docs/plans/mine.md|apps/web/evidence/zderived/README.md|apps/web/evidence/zderived/z.png' \
    UNCARRIED_OVERRIDE='' \
    bash research/tools/calendar-line-commit-plan.sh > "${L}.arm14.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "DERIV_NAMED=$(grep -c '推导格.*脏了却没点名' "${L}.arm14.out" || true)"
    echo "CLEAN=$(grep -c '钉锚点目录内脏 png 1 枚，未点名 0 枚' "${L}.arm14.out" || true)"
    echo "ALSO_OK=$(grep -c '推导格 1 枚也全部已点名' "${L}.arm14.out" || true)"
  } > "${L}.arm14.rd"
  exit $RC
)
A14=$(cat "${L}.arm14.rd" 2>/dev/null)
if [ "$(rd "$A14" RC)" = "0" ] && [ "$(rd "$A14" DERIV_NAMED)" = "0" ] \
   && [ "$(rd "$A14" CLEAN)" != "0" ] && [ "$(rd "$A14" ALSO_OK)" != "0" ]; then
  ok "臂14 配对下界：同一夹具把图点名后 rc=0、未点名归零 ⇒ 臂13 的红来自'没点名'而不是夹具本身跑不通"
else
  bad "臂14 未按预期 ⇒ 推导格是一条天生红的闸门（会把正常入库一直挡在外面）：$(printf '%s\n' "$A14" | tr '\n' ' ')"
  echo '--- 臂14 日志尾部 ---'; tail -25 "${L}.arm14.out"
fi

rm -rf "$F" "$F2" "$F3" "$F4" "$F5" "$F6" "$F7" "$F8" "$F9" "$F10" "$F11" "$F12" "$F13" "$F14"
echo "== 合计 pass=$PASS fail=$FAIL =="
rm -f "${L}".arm*.out "${L}".arm*.rd
[ "$FAIL" = 0 ] || exit 1
exit 0
