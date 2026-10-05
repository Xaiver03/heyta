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
#   臂 15 「删除」那条腿的**下一轮**：先把删除真的 --confirm 落库，再拿**同一份点名清单原样干跑复跑**
#              ⇒ 期望 rc=0 且打「已落库」，而不是 §4 自己要求的那个收尾动作在下一轮变红
#              （12:5x 主检出实测红在这一步 —— 当时 14 臂全绿，因为它们都只验当轮；账在 §4.05 (50)）
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
# 🔴 递归闸门（§4.05 (54)）：被测脚本 planner 现在有一格「跑本线三把验证台」，
#    而那三把里就有**本文件** ⇒ 夹具里的每一趟 planner 子进程若不带上这个标记，
#    就会在迷你树里找 `research/tools/r17-*.sh`（迷你树里没有）⇒ 判红 ⇒ exit 3 ⇒ 每一臂都假红。
#    这里 export 是**给子进程看的**，臂 18 专门钉"标记生效时那一格打印跳过读数、且不红"。
export HT_LINE_RIG_NEST=1
# 🔴 调用者环境必须清（10-05 15:0x 现量：本 rig 第一次被 planner 的 3c 格叫起来跑，
#    外层那一趟带着 `MSG=… ANCHORS=…` ⇒ 两个旋钮漏进每一臂的夹具子进程，臂 9 读到
#    "rc=1 但来路是'有孤儿 hunk'而不是'没传 ANCHORS'"、臂 14 的干跑从 rc=0 变 rc=1）。
#    这不是"调用方式不对"——**臂的语义就依赖"这两个旋钮缺席"**，所以缺席要由本文件保证，
#    不能靠调用者恰好没设。清完之后立刻自证一次：泄漏没清干净就 exit 4，不带坏读数进臂。
unset MSG ANCHORS PATHS_OVERRIDE UNCARRIED_OVERRIDE ALLOW_ORPHAN LINE_RIGS CONFIRM
for _k in MSG ANCHORS PATHS_OVERRIDE UNCARRIED_OVERRIDE ALLOW_ORPHAN LINE_RIGS; do
  if [ -n "${!_k:-}" ]; then
    echo "❌ 调用者旋钮没清掉：${_k} ⇒ 本 rig 的臂读数全部不可信（exit 4，不出 pass/fail）" >&2
    exit 4
  fi
done
echo "CALLER_ENV=cleared（MSG/ANCHORS/PATHS_OVERRIDE/UNCARRIED_OVERRIDE/ALLOW_ORPHAN/LINE_RIGS 与 CONFIRM 由本文件保证缺席）"
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

F15=$(mk_del_fixture) || { echo "❌ 夹具15 建不起来"; exit 1; }
(
  cd "$F15" || exit 1
  # 第一腿：先把删除**真的落库**（与臂10 同一条 --confirm 路径，同一份点名清单）。
  rm -f a.txt
  MSG='test: 臂15 落库' PATHS_OVERRIDE='a.txt|docs/plans/mine.md' UNCARRIED_OVERRIDE='' \
    ANCHORS='正文（改过） base' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm15.commit.out" 2>&1
  RC_COMMIT=$?
  # 第二腿（这一臂真正测的东西）：**同一份清单原样复跑一次干跑** —— 也就是本工具在 §4
  # 里自己要求的那个收尾动作。没有下面这几行，"删除"这条腿只验了当轮、没验下一轮，
  # 而 12:5x 主检出就是靠这格红给我看的（账在 §4.05 (50)）。
  PATHS_OVERRIDE='a.txt|docs/plans/mine.md' UNCARRIED_OVERRIDE='' \
    bash research/tools/calendar-line-commit-plan.sh > "${L}.arm15.rerun.out" 2>&1
  RC=$?
  {
    echo "RC_COMMIT=$RC_COMMIT"
    echo "RC=$RC"
    echo "LANDED=$(grep -c '删除\*\*已落库\*\*（HEAD 无此枚' "${L}.arm15.rerun.out" || true)"
    echo "SUMMARY=$(grep -c '另「删除已落库」1 枚' "${L}.arm15.rerun.out" || true)"
    echo "NO_TODO=$(grep -c '无待办' "${L}.arm15.rerun.out" || true)"
    echo "STALE_MSG=$(grep -c '清单过期' "${L}.arm15.rerun.out" || true)"
  } > "${L}.arm15.rd"
  exit $RC
)
A15=$(cat "${L}.arm15.rd" 2>/dev/null)
if [ "$(rd "$A15" RC_COMMIT)" = "0" ] && [ "$(rd "$A15" RC)" = "0" ] \
   && [ "$(rd "$A15" LANDED)" != "0" ] && [ "$(rd "$A15" SUMMARY)" != "0" ] \
   && [ "$(rd "$A15" NO_TODO)" != "0" ] && [ "$(rd "$A15" STALE_MSG)" = "0" ]; then
  ok "臂15 下一轮腿：删除落库后**同一份清单原样复跑** rc=0、打「已落库」并进汇总行、'清单过期'那句不再出现 ⇒ §4 自己要求的收尾动作不会在下一轮变红（配对：臂11 证明'从来没有过的路径'仍然 exit 1，这条口子没开成'没有也放行'）"
else
  bad "臂15 未按预期 ⇒ 下一轮复跑仍红、或已落库那格没被走到、或口子开过头把过期清单放行了：$(printf '%s\n' "$A15" | tr '\n' ' ')"
  echo '--- 臂15 复跑日志尾部 ---'; tail -25 "${L}.arm15.rerun.out"
fi

# ------------------------------------------------- 臂 16 3c 那一格红了会不会真挡下提交
F16=$(mk_fixture) || { echo "❌ 夹具16 建不起来"; exit 1; }
echo "夹具16：$F16"
(
  cd "$F16" || exit 1
  printf '#!/bin/bash\necho "STUBRED tail-line"\nexit 1\n' > stub-red.sh
  printf 'MINE16\n' > a.txt
  MSG='test: 臂16' PATHS_OVERRIDE='a.txt' UNCARRIED_OVERRIDE='' ANCHORS='MINE16' \
    env -u HT_LINE_RIG_NEST LINE_RIGS='bash stub-red.sh' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm16.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "STEP3C=$(grep -c '== 3c\.' "${L}.arm16.out" || true)"
    echo "REDMSG=$(grep -c '有验证台红了' "${L}.arm16.out" || true)"
    echo "NOCOMMIT=$(grep -c '== 5\. --confirm' "${L}.arm16.out" || true)"
    echo "COMMITS=$(git rev-list --count HEAD || true)"
  } > "${L}.arm16.rd"
  exit $RC
)
A16=$(cat "${L}.arm16.rd" 2>/dev/null)
if [ "$(rd "$A16" RC)" = "3" ] && [ "$(rd "$A16" STEP3C)" != "0" ] \
   && [ "$(rd "$A16" REDMSG)" != "0" ] && [ "$(rd "$A16" NOCOMMIT)" = "0" ] \
   && [ "$(rd "$A16" COMMITS)" = "1" ]; then
  ok "臂16 3c 有台子红 ⇒ exit 3、大字报「有验证台红了」、**根本没走到第 5 步**、HEAD 仍是那一枚 base（commits=1）⇒ 这一格不是打印格：摘掉那句 exit 3 就会多出一枚提交，NOCOMMIT 与 COMMITS 两条同红"
else
  bad "臂16 未按预期 ⇒ 3c 红了却没挡住提交、或压根没走到那一格：$(printf '%s\n' "$A16" | tr '\n' ' ')"
  echo '--- 臂16 日志尾部 ---'; tail -20 "${L}.arm16.out"
fi

# ------------------------------------------------- 臂 17 台子绿时读数打在成功路径上
F17=$(mk_fixture) || { echo "❌ 夹具17 建不起来"; exit 1; }
echo "夹具17：$F17"
(
  cd "$F17" || exit 1
  printf '#!/bin/bash\necho "STUBGREEN tail-line"\nexit 0\n' > stub-green.sh
  printf 'MINE17\n' > a.txt
  MSG='test: 臂17' PATHS_OVERRIDE='a.txt' UNCARRIED_OVERRIDE='' ANCHORS='MINE17' \
    env -u HT_LINE_RIG_NEST LINE_RIGS='bash stub-green.sh' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm17.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "PERIGN=$(grep -c '台 1 rc=0 :: STUBGREEN tail-line' "${L}.arm17.out" || true)"
    echo "COUNTLINE=$(grep -c 'LINE_RIGS=1 红=0' "${L}.arm17.out" || true)"
    echo "ALLGREEN=$(grep -c '上面数出来的台子全绿' "${L}.arm17.out" || true)"
    echo "REACHED=$(grep -c '== 5\. --confirm' "${L}.arm17.out" || true)"
  } > "${L}.arm17.rd"
  exit $RC
)
A17=$(cat "${L}.arm17.rd" 2>/dev/null)
if [ "$(rd "$A17" RC)" = "0" ] && [ "$(rd "$A17" PERIGN)" != "0" ] \
   && [ "$(rd "$A17" COUNTLINE)" != "0" ] && [ "$(rd "$A17" ALLGREEN)" != "0" ] \
   && [ "$(rd "$A17" REACHED)" != "0" ]; then
  ok "臂17（与臂16 配对）台子绿时**逐台的最后一行读数、枚数行、结论行都出现在成功路径上**，且流程继续走到第 5 步真提交 ⇒ 「判据读数要打在绿路上」这条在这里有牙：只把红那一档打印、绿档静默，PERIGN/COUNTLINE/ALLGREEN 三枚同红"
else
  bad "臂17 未按预期 ⇒ 绿路上没有读数（等于这格在正常时看不见）、或没走到提交：$(printf '%s\n' "$A17" | tr '\n' ' ')"
  echo '--- 臂17 日志尾部 ---'; tail -20 "${L}.arm17.out"
fi

# ------------------------------------------------- 臂 18 递归标记：跳过必须是**读数的跳过**
F18=$(mk_fixture) || { echo "❌ 夹具18 建不起来"; exit 1; }
echo "夹具18：$F18"
(
  cd "$F18" || exit 1
  printf 'MINE18\n' > a.txt
  # 夹具树里**没有**那三把台子 ⇒ 标记要是没生效，默认清单会 127 判红、这一臂必红。
  #    所以这条断言的"绿"只有两种来路：标记生效（打印跳过）或默认清单真能跑到 —— 后者在夹具里不成立。
  MSG='test: 臂18' PATHS_OVERRIDE='a.txt' UNCARRIED_OVERRIDE='' ANCHORS='MINE18' \
    HT_LINE_RIG_NEST=1 \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm18.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "SKIPLINE=$(grep -c '本格跳过（HT_LINE_RIG_NEST=1' "${L}.arm18.out" || true)"
    echo "NORIGRUN=$(grep -c 'LINE_RIGS=' "${L}.arm18.out" || true)"
    echo "REACHED=$(grep -c '== 5\. --confirm' "${L}.arm18.out" || true)"
  } > "${L}.arm18.rd"
  exit $RC
)
A18=$(cat "${L}.arm18.rd" 2>/dev/null)
if [ "$(rd "$A18" RC)" = "0" ] && [ "$(rd "$A18" SKIPLINE)" != "0" ] \
   && [ "$(rd "$A18" NORIGRUN)" = "0" ] && [ "$(rd "$A18" REACHED)" != "0" ]; then
  ok "臂18 带标记时：那一格**打印**跳过（不是静默 continue）、不跑清单（没有枚数行）、流程照常走完 ⇒ 本文件前面 15 臂靠的就是这一手；把标记摘掉或改成静默跳过，这条与臂 16/17 会一起变样"
else
  bad "臂18 未按预期 ⇒ 标记没生效（夹具里就会因缺台子判红）或跳过是静默的：$(printf '%s\n' "$A18" | tr '\n' ' ')"
  echo '--- 臂18 日志尾部 ---'; tail -20 "${L}.arm18.out"
fi

# ------------------------------------------------- 臂 19 旋钮被拧成空白 ⇒ 判不了要按红
F19=$(mk_fixture) || { echo "❌ 夹具19 建不起来"; exit 1; }
echo "夹具19：$F19"
(
  cd "$F19" || exit 1
  printf 'MINE19\n' > a.txt
  MSG='test: 臂19' PATHS_OVERRIDE='a.txt' UNCARRIED_OVERRIDE='' ANCHORS='MINE19' \
    env -u HT_LINE_RIG_NEST LINE_RIGS='   ' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm19.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "ZERO=$(grep -c '一行台子都没跑到' "${L}.arm19.out" || true)"
    echo "COMMITS=$(git rev-list --count HEAD || true)"
  } > "${L}.arm19.rd"
  exit $RC
)
A19=$(cat "${L}.arm19.rd" 2>/dev/null)
if [ "$(rd "$A19" RC)" = "3" ] && [ "$(rd "$A19" ZERO)" != "0" ] \
   && [ "$(rd "$A19" COMMITS)" = "1" ]; then
  ok "臂19 清单被拧成纯空白 ⇒ RIG_N=0 走「读不出数按红处理」那一档（exit 3、不产生提交）⇒ 挡掉的是那种「旋钮设空 ⇒ 一格没跑 ⇒ 照样绿」的假通过；把空白行也算成一台、或把 0 台当通过，这条就红"
else
  bad "臂19 未按预期 ⇒ 空清单被当成通过，或 exit 3 那句没打：$(printf '%s\n' "$A19" | tr '\n' ' ')"
  echo '--- 臂19 日志尾部 ---'; tail -20 "${L}.arm19.out"
fi

# --------------------------------- 臂 20 / 臂 21 干跑"只报不拦"与 --confirm 照旧拦（配对两腿）
mk_orphan_fixture() {
  local F; F=$(mk_fixture) || return 1
  (
    cd "$F" || exit 1
    printf 'MINE20\n' > a.txt
    printf '%s\n' "$F"
  )
}

F20=$(mk_orphan_fixture) || { echo "❌ 夹具20 建不起来"; exit 1; }
echo "夹具20：$F20"
(
  cd "$F20" || exit 1
  # 干跑 + 传一枚**对不上任何 hunk** 的锚点：归属那一格必须报数，但**不许**打破干跑契约
  MSG='test: 臂20' PATHS_OVERRIDE='a.txt' UNCARRIED_OVERRIDE='' ANCHORS='完全不搭的针' \
    bash research/tools/calendar-line-commit-plan.sh > "${L}.arm20.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "ORPHAN_REPORTED=$(grep -c '孤儿 1 枚' "${L}.arm20.out" || true)"
    echo "ONLY_REPORT_LINE=$(grep -c '干跑判到孤儿 hunk ⇒ 只报数' "${L}.arm20.out" || true)"
    echo "NOT_REACHED=$(grep -c '== 5\. --confirm' "${L}.arm20.out" || true)"
  } > "${L}.arm20.rd"
  exit $RC
)
A20=$(cat "${L}.arm20.rd" 2>/dev/null)
if [ "$(rd "$A20" RC)" = "0" ] && [ "$(rd "$A20" ORPHAN_REPORTED)" != "0" ] \
   && [ "$(rd "$A20" ONLY_REPORT_LINE)" != "0" ] && [ "$(rd "$A20" NOT_REACHED)" = "0" ]; then
  ok "臂20 干跑 + 传了对不上的锚点 ⇒ **报孤儿但不拦**（rc=0、那句'只报数'在输出里、也没走到第 5 步）⇒ 修掉的是'可选输入 ANCHORS 在测量模式下拿到了拦人的权力'；把它改回 exit 1 这条就红"
else
  bad "臂20 未按预期 ⇒ 干跑又被 ANCHORS 挡住了，或孤儿没报出来：$(printf '%s\n' "$A20" | tr '\n' ' ')"
  echo '--- 臂20 日志尾部 ---'; tail -20 "${L}.arm20.out"
fi

F21=$(mk_orphan_fixture) || { echo "❌ 夹具21 建不起来"; exit 1; }
echo "夹具21：$F21"
(
  cd "$F21" || exit 1
  MSG='test: 臂21' PATHS_OVERRIDE='a.txt' UNCARRIED_OVERRIDE='' ANCHORS='完全不搭的针' \
    bash research/tools/calendar-line-commit-plan.sh --confirm > "${L}.arm21.out" 2>&1
  RC=$?
  {
    echo "RC=$RC"
    echo "REFUSED=$(grep -c '拒绝提交（exit 1）' "${L}.arm21.out" || true)"
    echo "NOT_REACHED=$(grep -c '== 5\. --confirm' "${L}.arm21.out" || true)"
    echo "COMMITS=$(git rev-list --count HEAD || true)"
  } > "${L}.arm21.rd"
  exit $RC
)
A21=$(cat "${L}.arm21.rd" 2>/dev/null)
if [ "$(rd "$A21" RC)" = "1" ] && [ "$(rd "$A21" REFUSED)" != "0" ] \
   && [ "$(rd "$A21" NOT_REACHED)" = "0" ] && [ "$(rd "$A21" COMMITS)" = "1" ]; then
  ok "臂21（与臂20 同夹具、只差 --confirm）⇒ rc=1、大字'拒绝提交'、没走到第 5 步、HEAD 没多提交 ⇒ 臂20 那条放宽**只作用于测量模式**，归属闸门对真提交那一腿一条没松"
else
  bad "臂21 未按预期 ⇒ --confirm 那一腿没拦住孤儿 hunk（口子开大了）：$(printf '%s\n' "$A21" | tr '\n' ' ')"
  echo '--- 臂21 日志尾部 ---'; tail -20 "${L}.arm21.out"
fi

# ============================================================================
# 臂 22–27：`calendar-line-wire-evidence-rigs.mjs`（把三台验证台接进 check 链的那一步，§4.05 (59)）
#   这一族测的是**写盘工具的闸门**，不是链的内容：默认不写、脏就拒、锚点不猜、半截不补、写第二次是空操作。
#   夹具用**迷你 package.json**（不碰真的那枚），且目标放在非仓库目录 ⇒ 对账门禁那一格如实报 skipped。
# ============================================================================
WIRE=research/tools/calendar-line-wire-evidence-rigs.mjs
# 🔴 臂 23 那腿在子 shell 里 `cd` 进了夹具 ⇒ 相对路径会解析成"夹具里的文件"，
#    node 报 "Cannot find module" 并退 1，读数会长得像"工具没拒绝"（码对、来路错）。绝对路径才行。
WIRE_ABS="$PWD/$WIRE"
[ -f "$WIRE" ] || { bad "臂22–27 的夹具没建：$WIRE 不在树里（这一族的存在理由整格作废）"; }
mk_pkg() {   # $1 = 目标文件路径
  printf '{\n  "scripts": {\n    "check:md-tables": "node scripts/check-md-table-rows.mjs",\n    "check": "pnpm check:md-tables && pnpm check:pricing"\n  }\n}\n' > "$1"
}
FW=$(mktemp -d /tmp/clc-wire.XXXXXX)
if [ -f "$WIRE" ]; then
  # --- 臂22：默认必须是 dry-run，且**逐字节不写**（哈希对账，不看它自己怎么说）---
  mk_pkg "$FW/base.json"; cp "$FW/base.json" "$FW/a22.json"
  H0=$(md5 -q "$FW/a22.json")
  O22=$(node "$WIRE" --pkg "$FW/a22.json" 2>&1); R22=$?
  H1=$(md5 -q "$FW/a22.json")
  if [ "$R22" = 0 ] && [ "$H0" = "$H1" ] && printf '%s' "$O22" | grep -q 'dry-run 结束（没写盘）'; then
    ok "臂22 默认 dry-run ⇒ rc=0、打印两处、文件 md5 逐字未变 ⇒ \"默认不动盘\"是被证明的，不是被声称的"
  else
    bad "臂22 未按预期 ⇒ 默认档没保证不写盘或读数不对（rc=${R22} 变没变=${H0}/${H1}）"
    printf '%s\n' "$O22" | tail -6 | sed 's/^/      /'
  fi

  # --- 臂23：目标在工作树里脏 ⇒ 拒绝（exit 3），且必须落在那条"同一行"的理由上 ---
  FR=$(mktemp -d /tmp/clc-wiredirty.XXXXXX)
  (
    cd "$FR" || exit 1
    git init -q .; git config user.email t@t; git config user.name t
    mkdir -p scripts research/tools
    printf '#!/usr/bin/env node\nconsole.log("STUB gate");\n' > scripts/check-gate-wiring.mjs
    mk_pkg "$FR/package.json"
    git add -A >/dev/null 2>&1; git commit -qm base
    # 🔴 脏的那一份**必须保留两处锚点**（改的是不相干的一行）—— 第一版我在这里顺手改了链串，
    #    于是 rc 走的是"锚点数不对"那一档（exit 4），臂 23 测的却是"脏 ⇒ 拒绝"（exit 3）。
    #    夹具改坏了被测前提，读数就会退化成另一条不相干的码。
    printf '{\n  "scripts": {\n    "check:md-tables": "node scripts/check-md-table-rows.mjs",\n    "check:someones-work": "echo 别人正在加的门禁",\n    "check": "pnpm check:md-tables && pnpm check:pricing"\n  }\n}\n' > package.json
    echo "DIRTY=$(git status --porcelain -- package.json)"
    echo "BEFORE=$(md5 -q package.json)"
    O=$(node "$WIRE_ABS" --pkg "$FR/package.json" --confirm 2>&1); echo "RC=$?"
    printf '%s\n' "$O" | sed 's/^/      OUT: /'
    printf '%s\n' "$O" | grep -q '别人未提交的字节' && echo REFUSED=yes || echo REFUSED=no
    echo "AFTER=$(md5 -q package.json)"
  ) > "${L}.arm23.out" 2>&1
  A23=$(cat "${L}.arm23.out")
  if [ "$(rd "$A23" RC)" = "3" ] && [ "$(rd "$A23" REFUSED)" = "yes" ] \
     && [ "$(rd "$A23" BEFORE)" = "$(rd "$A23" AFTER)" ] && [ -n "$(rd "$A23" DIRTY)" ]; then
    ok "臂23 目标脏 + --confirm ⇒ rc=3、点名\"别人未提交的字节\"、文件 md5 前后一致 ⇒ 同一行相撞时它不替别人带字节"
  else
    bad "臂23 未按预期 ⇒ 脏目标上的 --confirm 没有拒绝（这一格是整个工具的存在理由）"
    printf '%s\n' "$A23" | tail -6 | sed 's/^/      /'
  fi

  # --- 臂24：锚点数不对 ⇒ exit 4「不猜插入点」，一条字节都不许写 ---
  mk_pkg "$FW/a24.json"
  sed 's/pnpm check:md-tables \&\& pnpm check:pricing/pnpm check:md-tables \&\& pnpm check:tokens/' "$FW/a24.json" > "$FW/a24b.json"
  B0=$(md5 -q "$FW/a24b.json")
  O24=$(node "$WIRE" --pkg "$FW/a24b.json" --confirm 2>&1); R24=$?
  B1=$(md5 -q "$FW/a24b.json")
  if [ "$R24" = 4 ] && [ "$B0" = "$B1" ] && printf '%s' "$O24" | grep -q '不猜插入点'; then
    ok "臂24 链锚点数 0 ⇒ rc=4、大字\"不猜插入点\"、文件 md5 未变 ⇒ 改了形的链不会被它猜着插进别处"
  else
    bad "臂24 未按预期 ⇒ 锚点缺失时它没拒绝或动手写了（rc=${R24} 变没变=${B0}/${B1}）"
    printf '%s\n' "$O24" | tail -6 | sed 's/^/      /'
  fi

  # --- 臂25：半截状态（链里有、定义没有）⇒ 不许"顺手补定义"，exit 4 ---
  printf '{\n  "scripts": {\n    "check:md-tables": "node scripts/check-md-table-rows.mjs",\n    "check": "pnpm check:md-tables && pnpm check:calendar-evidence-rigs && pnpm check:pricing"\n  }\n}\n' > "$FW/a25.json"
  O25=$(node "$WIRE" --pkg "$FW/a25.json" --confirm 2>&1); R25=$?
  if [ "$R25" = 4 ] && printf '%s' "$O25" | grep -q '半截状态'; then
    ok "臂25 链里已有名而定义行不在 ⇒ rc=4 并写清\"正确的修法不是自动补定义\" ⇒ 它不会把别人的半截改动圆成自己的"
  else
    bad "臂25 未按预期 ⇒ 半截状态被它自动补全了（那是造第二份真相）rc=${R25}"
    printf '%s\n' "$O25" | tail -4 | sed 's/^/      /'
  fi

  # --- 臂26：干净目标 + --confirm 写一次，再跑第二次必须是空操作（幂等）；写入结果必须是合法 JSON ---
  mk_pkg "$FW/a26.json"
  node "$WIRE" --pkg "$FW/a26.json" --confirm > "${L}.arm26a.out" 2>&1; R26A=$?
  JOK=$(node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$FW/a26.json" >/dev/null 2>&1 && echo yes || echo no)
  NDEF=$(grep -c '"check:calendar-evidence-rigs":' "$FW/a26.json" || true)
  NCHAIN=$(grep -o 'pnpm check:calendar-evidence-rigs' "$FW/a26.json" | grep -c . || true)
  node "$WIRE" --pkg "$FW/a26.json" --confirm > "${L}.arm26b.out" 2>&1; R26B=$?
  IDP=$(grep -c '两处都已在册' "${L}.arm26b.out" || true)
  if [ "$R26A" = 0 ] && [ "$JOK" = yes ] && [ "$NDEF" = 1 ] && [ "$NCHAIN" = 1 ] \
     && [ "$R26B" = 0 ] && [ "$IDP" = 1 ]; then
    ok "臂26 干净目标 --confirm ⇒ rc=0、JSON 合法、定义 1 枚且链里 1 枚（**不会插成两份**）、第二次跑报\"两处都已在册\"仍 rc=0 ⇒ 反复跑安全"
  else
    bad "臂26 未按预期 ⇒ rc=${R26A}/${R26B} JSON=${JOK} 定义=${NDEF} 链=${NCHAIN} 幂等句=${IDP}"
    tail -6 "${L}.arm26a.out" "${L}.arm26b.out" | sed 's/^/      /'
  fi
fi
# --- 臂27：半缺的另一侧（定义已在、链没接）⇒ 只补缺的那一半，不许把定义插成两份 ---
printf '{\n  "scripts": {\n    "check:md-tables": "node scripts/check-md-table-rows.mjs",\n    "check:calendar-evidence-rigs": "bash research/tools/calendar-line-commit-only-arms.sh && bash research/tools/r17-reshoot-arms.sh && bash research/tools/r17-reshoot-stale.sh --selftest",\n    "check": "pnpm check:md-tables && pnpm check:pricing"\n  }\n}\n' > "$FW/a27.json"
node "$WIRE" --pkg "$FW/a27.json" --confirm > "${L}.arm27.out" 2>&1; R27=$?
J27=$(node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$FW/a27.json" >/dev/null 2>&1 && echo yes || echo no)
D27=$(grep -c '"check:calendar-evidence-rigs":' "$FW/a27.json" || true)
C27=$(grep -o 'pnpm check:calendar-evidence-rigs' "$FW/a27.json" | grep -c . || true)
if [ "$R27" = 0 ] && [ "$J27" = yes ] && [ "$D27" = 1 ] && [ "$C27" = 1 ]; then
  ok "臂27 定义已在而链没接 ⇒ rc=0、链补上 1 枚、定义**仍是 1 枚**（没插成两份同名键）⇒ 补缺那一半是被证明的"
else
  bad "臂27 未按预期 ⇒ rc=${R27} JSON=${J27} 定义=${D27}（要 1）链=${C27}（要 1）"
  tail -6 "${L}.arm27.out" | sed 's/^/      /'
fi

# ============================================================================
# 臂 28–32：`calendar-line-append-trap.mjs`（往环境陷阱册子追加一枚的自闸命令，§4.05 (60)）
#   同一族规矩：缺参不动手 / 目标脏不动手 / 默认不写盘 / 幂等按正文判 / 未拉下来的远端也占号。
# ============================================================================
TRAP=research/tools/calendar-line-append-trap.mjs
TRAPTXT=research/tools/calendar-line-trap-entry-diff-shape-vs-semantics.txt
TRAP_ABS="$PWD/$TRAP"; TXT_ABS="$PWD/$TRAPTXT"
FT=$(mktemp -d /tmp/clc-trap.XXXXXX)
mk_traps() { printf '# 环境陷阱\n\n%s\n' "$(for i in $(seq 1 "$1"); do printf '%s. 第 %s 条\n\n' "$i" "$i"; done)" > "$2"; }
if [ ! -f "$TRAP" ] || [ ! -f "$TRAPTXT" ]; then
  bad "臂28–32 的夹具没建：$TRAP 或 $TRAPTXT 不在树里"
else
  # --- 臂28：缺 --text ⇒ exit 1（不猜正文，也不接受内联）---
  node "$TRAP_ABS" > "${L}.arm28.out" 2>&1; R28=$?
  if [ "$R28" = 1 ] && grep -q '缺 --text' "${L}.arm28.out"; then
    ok "臂28 不带 --text ⇒ rc=1 并说清\"不猜要写什么\" ⇒ 需要人给的值确实是缺参就停，不是拿默认值动手"
  else
    bad "臂28 未按预期 ⇒ rc=${R28}"; tail -3 "${L}.arm28.out" | sed 's/^/      /'
  fi

  # --- 臂29：目标在工作树里脏 ⇒ exit 3，且逐字节不动（BEFORE==AFTER）---
  mkdir -p "$FT/dirty/docs/reference"
  (
    cd "$FT/dirty" || exit 1
    git init -q .; git config user.email t@t; git config user.name t
    mk_traps 2 docs/reference/environment-traps.md
    git add -A >/dev/null 2>&1; git commit -qm base
    mk_traps 3 docs/reference/environment-traps.md          # 别人未提交的第 4 条
    echo "DIRTY=$(git status --porcelain -- docs/reference/environment-traps.md)"
    echo "BEFORE=$(md5 -q docs/reference/environment-traps.md)"
    node "$TRAP_ABS" --text "$TXT_ABS" --pkg-file "$FT/dirty/docs/reference/environment-traps.md" --confirm \
      > /dev/null 2>&1; echo "RC=$?"
    echo "AFTER=$(md5 -q docs/reference/environment-traps.md)"
  ) > "${L}.arm29.out" 2>&1
  A29=$(cat "${L}.arm29.out")
  if [ "$(rd "$A29" RC)" = "3" ] && [ -n "$(rd "$A29" DIRTY)" ] && [ "$(rd "$A29" BEFORE)" = "$(rd "$A29" AFTER)" ]; then
    ok "臂29 册子脏 + --confirm ⇒ rc=3、md5 前后一致 ⇒ 并行会话正在逐段追加时它不替别人带 hunk，也不插号"
  else
    bad "臂29 未按预期"; printf '%s\n' "$A29" | tail -4 | sed 's/^/      /'
  fi

  # --- 臂30：dry-run ⇒ rc=0、现量末号+1 被打印出来、文件逐字节不变 ---
  mk_traps 5 "$FT/a30.md"; H0=$(md5 -q "$FT/a30.md")
  O30=$(node "$TRAP_ABS" --text "$TXT_ABS" --pkg-file "$FT/a30.md" 2>&1); R30=$?
  H1=$(md5 -q "$FT/a30.md")
  if [ "$R30" = 0 ] && [ "$H0" = "$H1" ] && printf '%s' "$O30" | grep -q '⇒ 这一枚取 6'; then
    ok "臂30 末号 5 的目标 dry-run ⇒ rc=0、打印\"取 6\"（编号是现量的，不是抄的）、文件 md5 未变"
  else
    bad "臂30 未按预期 ⇒ rc=${R30} 取号句=$(printf '%s' "$O30" | grep -c '这一枚取') 变没变=${H0}/${H1}"
    printf '%s\n' "$O30" | tail -4 | sed 's/^/      /'
  fi

  # --- 臂31：--confirm 写一次，第二次必须按**正文**判已在册（号已经变了，按号判永远命中不了）---
  mk_traps 5 "$FT/a31.md"
  node "$TRAP_ABS" --text "$TXT_ABS" --pkg-file "$FT/a31.md" --confirm > "${L}.arm31a.out" 2>&1; R31A=$?
  NAPP=$(grep -c '^6\. 🔴' "$FT/a31.md" || true)
  B1=$(md5 -q "$FT/a31.md")
  node "$TRAP_ABS" --text "$TXT_ABS" --pkg-file "$FT/a31.md" --confirm > "${L}.arm31b.out" 2>&1; R31B=$?
  IDP=$(grep -c '已在册（现量号 6）' "${L}.arm31b.out" || true)
  B2=$(md5 -q "$FT/a31.md")
  if [ "$R31A" = 0 ] && [ "$NAPP" = 1 ] && [ "$R31B" = 0 ] && [ "$IDP" = 1 ] && [ "$B1" = "$B2" ]; then
    ok "臂31 写一次得号 6、第二次报\"已在册（现量号 6）\"且 md5 不变 ⇒ 幂等判的是正文；按号判的那版会再追加一份同号不同条目的重复"
  else
    bad "臂31 未按预期 ⇒ rc=${R31A}/${R31B} 追加=${NAPP} 已在册句=${IDP} 变没变=${B1}/${B2}"
    tail -4 "${L}.arm31b.out" | sed 's/^/      /'
  fi

  # --- 臂32：本检出落后远端 ⇒ origin/main 已占的那个号必须拦下来（"没拉下来的条目"是真的）---
  mkdir -p "$FT/rem/docs/reference"
  (
    cd "$FT/rem" || exit 1
    git init -q .; git config user.email t@t; git config user.name t
    mk_traps 1 docs/reference/environment-traps.md
    git add -A >/dev/null 2>&1; git commit -qm c1
    mk_traps 2 docs/reference/environment-traps.md
    git commit -qam c2
    git update-ref refs/remotes/origin/main HEAD
    git reset -q --hard HEAD~1                    # 本地回到 1 条，工作树干净，但 origin/main 已经有第 2 条
    echo "DIRTY=$(git status --porcelain | wc -l | tr -d ' ')"
    echo "BEFORE=$(md5 -q docs/reference/environment-traps.md)"
    node "$TRAP_ABS" --text "$TXT_ABS" --pkg-file "$FT/rem/docs/reference/environment-traps.md" --confirm \
      >/dev/null 2>&1; echo "RC=$?"
    echo "AFTER=$(md5 -q docs/reference/environment-traps.md)"
  ) > "${L}.arm32.out" 2>&1
  A32=$(cat "${L}.arm32.out")
  if [ "$(rd "$A32" RC)" = "3" ] && [ "$(rd "$A32" DIRTY)" = "0" ] && [ "$(rd "$A32" BEFORE)" = "$(rd "$A32" AFTER)" ]; then
    ok "臂32 目标干净、本地末号 1、但 origin/main 里已有第 2 条 ⇒ rc=3 且文件未动 ⇒ \"ahead/behind\"那种状态下它不会插一个撞号"
  else
    bad "臂32 未按预期 ⇒ 远端对照那一格没拦下来"; printf '%s\n' "$A32" | tail -4 | sed 's/^/      /'
  fi

  # --- 臂33：N 不撞、但**同号写着两条不同的坑** ⇒ 「对得上号」那一格必须拦 ---
  #     形状来自 §4.05 (61)③ 的真数据：origin/main 末号 283 / 本检出 278，#279–#283 同号不同文。
  #     臂32 那一格只覆盖"N 恰好撞上"，而那种状态下若本地未提交那批一落地，N 就不撞了 ——
  #     工具会把这一枚追加进一本**已经重号**的册子，输出看着完全正常。
  mkdir -p "$FT/rem33/docs/reference"
  (
    cd "$FT/rem33" || exit 1
    git init -q .; git config user.email t@t; git config user.name t
    mk_traps 3 docs/reference/environment-traps.md
    git add -A >/dev/null 2>&1; git commit -qm c1
    git update-ref refs/remotes/origin/main HEAD            # 远端 = 原文 1/2/3
    T33=$(mktemp); sed 's/^2\. .*/2. 本地那一版/' docs/reference/environment-traps.md > "$T33" && mv "$T33" docs/reference/environment-traps.md
    git commit -qam c2                                       # 本检出 = #2 改写过；号集合与远端一致 ⇒ N=4 不撞
    echo "DIRTY=$(git status --porcelain | wc -l | tr -d ' ')"
    echo "BEFORE=$(md5 -q docs/reference/environment-traps.md)"
    node "$TRAP_ABS" --text "$TXT_ABS" --pkg-file "$FT/rem33/docs/reference/environment-traps.md" --confirm; echo "RC=$?"
    echo "AFTER=$(md5 -q docs/reference/environment-traps.md)"
  ) > "${L}.arm33.out" 2>&1
  A33=$(cat "${L}.arm33.out")
  if [ "$(rd "$A33" RC)" = "3" ] && [ "$(rd "$A33" DIRTY)" = "0" ] && [ "$(rd "$A33" BEFORE)" = "$(rd "$A33" AFTER)" ] \
     && printf '%s' "$A33" | grep -q '同号不同文'; then
    ok "臂33 本地与远端号集合相同、只有 #2 文本分叉（N=4 不与远端撞）⇒ rc=3 且文件未动、红句点名『同号不同文』 ⇒ 重号的册子里它不会再加一枚"
  else
    bad "臂33 未按预期 ⇒ rc=$(rd "$A33" RC) 脏=$(rd "$A33" DIRTY) 变没变=$(rd "$A33" BEFORE)/$(rd "$A33" AFTER) 点名=$(printf '%s' "$A33" | grep -c '同号不同文')"; printf '%s\n' "$A33" | tail -4 | sed 's/^/      /'
  fi

  # --- 臂34：远端有本检出没有的号、而 N 也不撞 ⇒ 同一格另一种形状（missing 分支）---
  #     🔴 夹具的**前提**自己也要断言：这一臂第一版就是栽在这里 —— `git commit -m c1` 的 c1 是**提交信息**、
  #     不是 ref，`git checkout c1 -- 文件` 直接 `fatal: invalid reference`，而那一步之后没有 `set -e`，
  #     于是工作树停留在"远端那版"⇒ 本地=远端 ⇒ missing=0 ⇒ 工具**真的写盘了**，读数 rc=0。
  #     红的是我的夹具，不是那一格 —— 所以现在把两边的号集合打出来，先证明形状成立再判结果。
  mkdir -p "$FT/rem34/docs/reference"
  (
    cd "$FT/rem34" || exit 1
    git init -q .; git config user.email t@t; git config user.name t
    mk_traps 3 docs/reference/environment-traps.md
    printf '10. 第 10 条\n\n' >> docs/reference/environment-traps.md    # 本检出的号集合 {1,2,3,10} ⇒ N=11
    git add -A >/dev/null 2>&1; git commit -qm local
    S_LOCAL=$(git rev-parse HEAD)
    git update-ref refs/remotes/origin/main HEAD
    mk_traps 4 docs/reference/environment-traps.md                       # 远端 {1,2,3,4} 再补 10 ⇒ 多一枚 #4
    printf '10. 第 10 条\n\n' >> docs/reference/environment-traps.md
    git commit -qam remote
    git update-ref refs/remotes/origin/main HEAD                         # origin/main = 带 #4 的那版
    git checkout -q "$S_LOCAL" -- docs/reference/environment-traps.md
    git commit -qam local-again                                          # 本检出回到不带 #4 的那版，工作树干净
    echo "DIRTY=$(git status --porcelain | wc -l | tr -d ' ')"
    echo "LNUMS=$(grep -oE '^[0-9]+\.' docs/reference/environment-traps.md | tr -d '.' | tr '\n' ',')"
    echo "RNUMS=$(git show origin/main:docs/reference/environment-traps.md | grep -oE '^[0-9]+\.' | tr -d '.' | tr '\n' ',')"
    echo "BEFORE=$(md5 -q docs/reference/environment-traps.md)"
    node "$TRAP_ABS" --text "$TXT_ABS" --pkg-file "$FT/rem34/docs/reference/environment-traps.md" --confirm; echo "RC=$?"
    echo "AFTER=$(md5 -q docs/reference/environment-traps.md)"
  ) > "${L}.arm34.out" 2>&1
  A34=$(cat "${L}.arm34.out")
  if [ "$(rd "$A34" LNUMS)" = "1,2,3,10," ] && [ "$(rd "$A34" RNUMS)" = "1,2,3,4,10," ] \
     && [ "$(rd "$A34" RC)" = "3" ] && [ "$(rd "$A34" DIRTY)" = "0" ] && [ "$(rd "$A34" BEFORE)" = "$(rd "$A34" AFTER)" ] \
     && printf '%s' "$A34" | grep -q '枚号在本检出里不存在'; then
    ok "臂34 夹具形状已自证（本地 1,2,3,10 / 远端 1,2,3,4,10，N=11 不撞任何号）⇒ rc=3、文件未动、红句点名『本检出里不存在』⇒ missing 分支独立于臂33 的 clash 分支"
  else
    bad "臂34 未按预期 ⇒ 形状=$(rd "$A34" LNUMS)/$(rd "$A34" RNUMS) rc=$(rd "$A34" RC) 脏=$(rd "$A34" DIRTY) 点名=$(printf '%s' "$A34" | grep -c '枚号在本检出里不存在') 变没变=$(rd "$A34" BEFORE)/$(rd "$A34" AFTER)"; printf '%s\n' "$A34" | tail -4 | sed 's/^/      /'
  fi

  # --- 臂35：阳性对照 —— 编号集合对得上时那一格**必须放行** ---
  #     §7 第 282 条那一族：永远拒绝的门和永远通过的门同族。删掉臂33/34 的红是坏的，
  #     把这四臂合起来看才回答"这一格判的是对不对得上号"。
  mkdir -p "$FT/rem35/docs/reference"
  (
    cd "$FT/rem35" || exit 1
    git init -q .; git config user.email t@t; git config user.name t
    mk_traps 3 docs/reference/environment-traps.md
    git add -A >/dev/null 2>&1; git commit -qm c1
    git update-ref refs/remotes/origin/main HEAD                          # 远端 == 本检出
    echo "DIRTY=$(git status --porcelain | wc -l | tr -d ' ')"
    echo "BEFORE=$(md5 -q docs/reference/environment-traps.md)"
    node "$TRAP_ABS" --text "$TXT_ABS" --pkg-file "$FT/rem35/docs/reference/environment-traps.md"; echo "RC=$?"
    echo "AFTER=$(md5 -q docs/reference/environment-traps.md)"
  ) > "${L}.arm35.out" 2>&1
  A35=$(cat "${L}.arm35.out")
  if [ "$(rd "$A35" RC)" = "0" ] && [ "$(rd "$A35" DIRTY)" = "0" ] && [ "$(rd "$A35" BEFORE)" = "$(rd "$A35" AFTER)" ] \
     && printf '%s' "$A35" | grep -q '对得上号' && printf '%s' "$A35" | grep -q '这一枚取 4'; then
    ok "臂35 远端与本检出编号集合逐项同号同文 ⇒ dry-run rc=0、打印『对得上号』+『这一枚取 4』、文件未动 ⇒ 新那一格不是永远拒绝的门"
  else
    bad "臂35 未按预期 ⇒ rc=$(rd "$A35" RC) 脏=$(rd "$A35" DIRTY) 放行句=$(printf '%s' "$A35" | grep -c '对得上号') 取号句=$(printf '%s' "$A35" | grep -c '这一枚取 4') 变没变=$(rd "$A35" BEFORE)/$(rd "$A35" AFTER)"; printf '%s\n' "$A35" | tail -5 | sed 's/^/      /'
  fi
fi
rm -rf "$FT"

rm -rf "$FW" "$FR"

rm -rf "$F" "$F2" "$F3" "$F4" "$F5" "$F6" "$F7" "$F8" "$F9" "$F10" "$F11" "$F12" "$F13" "$F14" "$F15" "$F16" "$F17" "$F18" "$F19" "$F20" "$F21"
echo "== 合计 pass=$PASS fail=$FAIL =="
rm -f "${L}".arm*.out "${L}".arm*.rd
[ "$FAIL" = 0 ] || exit 1
exit 0
