#!/usr/bin/env python3
"""对账：这条线**开工以后**每一笔带过的路径，是否全在 Goal 白名单里。

为什么需要它：任务书完成条件第 2 条写的是"`git status --porcelain` 里非白名单路径的条目数与开工快照相同"。
这一条在共享检出上量的不是本线的动作（并行会话每时每刻在改自己的文件，那个数一定漂）——
已在 B102 登记。真正能回答"我有没有越界"的是**逐笔**对账：每一笔提交实际带过哪些路径。

跑法：
    python3 research/tools/verify-inbound-commit-scope.py                 # 默认：本机 2026-10-09 16:52 之后
    python3 research/tools/verify-inbound-commit-scope.py --since '<git 日期>'
    python3 research/tools/verify-inbound-commit-scope.py --self-test

臂的清单与**臂数**由 `self_test()` 自己在末尾打印，这里不抄（仓规：文档里不许抄臂数）。
每臂的存在理由都一样：`越界=0` 这一句有两种读法 —— "分类器看了、里面没有越界"，和
"根本没枚举到东西"。臂就是把后一种读法逐一排除掉：只有阳性对照的那一臂会红，
其余每一臂都在测"默认那一条能不能永远绿"。

白名单是照任务书正文抄进来的**死表**，不是从别处推的。任务书换了地界就改这里；
改这张表本身属于"判卷口径"，要负责人点头。
✅ **2026-10-28 这点头拿到了**（负责人原话「同意开始做吧。允许你去做」「继续」），按推荐口径做的两件事：
① 白名单补上这份任务书真正要碰的族，**每一族后面注明那笔证据提交**；
② 归属口径升级（B169 闭合）：`DESC_ONLY` 与 `BORROWED_TITLE` 两张**逐枚点名表**进判决，
   外加 `FOREIGN_WRITES_INTO_LINE_PATHS`（别线笔写进本线独占路径的 18 枚）。
   🔴 三张表都**只认点名的笔** —— 新出现的同类笔没登记就照判红，所以这不是把判据放宽，是把归属做对。
   哪一臂在守这件事：ARM-3（反查三半）、ARM-4（分流不吞证据两半）、ARM-6（点名表有牙五半）。

🔴 归属证据这一层（2026-10-11 加）**只打印、不判决**：每行 `OOB` 下面跟着命中段（范围词／仅描述）、
该笔带了几枚本线独占路径与主题行；`ARM-3` 的漏网件同样逐枚附主题。加它的原因是——报红只给路径与笔号时，
读的人必须再跑 `git log -1` 才知道这枚到底是谁的笔，"证据"就没法自证。把"仅描述提及"升成
判据的一部分＝改判卷口径，那属于 B169（待负责人点头），所以这里到打印为止。
"""
import argparse
import contextlib
import io
import re
import subprocess
import sys

KICKOFF = '2026-10-09 16:52'   # 本机时间，PROGRESS.md 开工回执第 4 条（任务 0 复跑那一段）
SUBJECT = '自动收集'

WHITELIST = [
    r'^server/src/automation/',
    r'^server/src/entitlement\.ts$',
    r'^server/src/api\.ts$',
    r'^server/prisma/schema\.prisma$',
    r'^server/prisma/migrations/',
    r'^server/tests/',
    r'^packages/inbound-core/',
    r'^packages/shared-schema/src/inbound-',
    r'^packages/app-host/package\.json$',
    r'^packages/app-host/src/index\.ts$',
    r'^packages/app-host/src/inbound-',
    r'^packages/app-host/tests/inbound-',
    r'^packages/domain/tests/inbound-',
    r'^packages/sync-client/tests/inbound-',
    r'^apps/web/src/features/settings/(InboundAutomationSettings\.tsx|inbound-automation\.css|inbound-runtime\.ts)$',
    r'^apps/web/tests/inbound-',
    r'^apps/mobile/src/inbound/',
    r'^e2e/playwright\.inbound\.config\.ts$',
    r'^e2e/tests/inbound-automation\.spec\.ts$',
    r'^docs/plans/inbound-automation\.md$',
    r'^docs/reference/inbound-automation-protocol\.md$',
    r'^docs/reference/pricing-and-entitlements\.md$',
    r'^docs/research/inbound-automation-review\.md$',
    r'^docs/research/evidence/inbound-automation-review/',
    r'^research/tools/verify-inbound-[^/]+\.py$',
    r'^PROGRESS\.md$',
    r'^BLOCKED\.md$',
    # ↓ 2026-10-28 按新任务书补的族（负责人点头：「同意开始做吧。允许你去做」）。
    #   每条都是**本线真动过的地界**，后面注释是那一步的证据笔；不许凭"大概会用到"预加。
    r'^docs/adr/\d{4}-inbound-[a-z-]+\.md$',          # 交付 1：ADR-0077（35a6ec2d）
    r'^docs/plans/inbound-automation[a-z-]*\.md$',    # 交付 5／交接：工单与交接书（21616b10、0eafd8ca）
    r'^docs/plans/email-to-task-brief\.md$',          # 交付 6 点名要重指向的那份（35a6ec2d）
    r'^docs/runbooks/deployment\.md$',                # 这一档八枚 env 键的部署面（b6a5feef）
    r'^docs/reference/environment-traps\.md$',        # 仓规：踩过的坑追加到这里（b7627b5e）
    r'^docs/README\.md$',                             # 文档分层索引（0eafd8ca）
    r'^docs/plans/README\.md$',                       # 同上，计划目录那一页（0eafd8ca）
    r'^server/src/ai/',                               # 交付 2 选的那条发送腿（9cc4e000、4306ff18）
    r'^packages/i18n/src/locales/(zh-CN|en)\.ts$',    # 交付 4：新词条的唯一事实源（b55e9880）
    r'^package\.json$',                               # 新门接进 check 链（4306ff18）
    r'^server/package\.json$',                        # 服务端脚本/依赖（af287a83）
    r'^scripts/check-inbound-[a-z-]+\.mjs$',          # 本线新加的对外正文与 fixture 对账尺（55203a48、bc983822）
    r'^scripts/check-gate-wiring\.mjs$',              # 登记新门（bc983822）
    r'^scripts/check-worktree-exceptions\.mjs$',      # 例外归属表跟上新现实（fdaf5eb1）
    r'^apps/node-host/',                              # 无头宿主那一腿（4d377391）
    r'^apps/mobile/src/ai/AiSettingsSection\.tsx$',   # 移动壳的上传/处理位置文案（2fff2c47）
    r'^server/src/sync/cleanup\.ts$',                 # A5 退役时钟清扫（4b321c61）
    r'^apps/mobile/tests/(inbound-[a-z-]+|ai-copy-parity)\.spec\.ts$',  # 移动侧本线用例（b55e9880、08e27cd2）
    r'^apps/web/src/features/settings/inbound-lifecycle\.ts$',          # 本线自己的生命周期模块（afe07423）
    r'^apps/web/src/App\.tsx$',                       # ⚠️ 别线的壳：只为 B140 那处 `active` 接线被动过，
    r'^apps/web/src/features/settings/AiSettings\.tsx$',  #   那是负责人 2026-10-16 点头后代做的三处改动（afe07423、d36fce58）
    r'^docs/agents/environment-traps-index\.md$',     # 陷阱索引随正文追加（7d76e762、24d05137）
    r'^docs/runbooks/self-host\.md$',                 # 这一档八枚 env 键的自托管面（b6a5feef）
    r'^server/(docker-compose\.yml|env\.example)$',   # 同上：env 表面（b6a5feef）
]


def in_bounds(path: str) -> bool:
    return any(re.match(pattern, path) for pattern in WHITELIST)


def commits_since(since: str) -> list[tuple[str, str, str]]:
    out = subprocess.run(['git', 'log', f'--since={since}', '--format=%H\t%ad\t%s',
                          '--date=format:%m-%d %H:%M', f'--grep={SUBJECT}'],
                         capture_output=True, text=True).stdout.strip()
    rows = []
    for line in out.splitlines():
        if not line:
            continue
        sha, date, subject = line.split('\t', 2)
        rows.append((sha, date, subject))
    return rows


def touched(sha: str) -> list[str]:
    return subprocess.run(['git', 'diff-tree', '--no-commit-id', '--name-only', '-r', sha],
                          capture_output=True, text=True).stdout.split()


# 正文提及 ≠ 本线动作：`git log --grep` 匹配的是**整条提交信息**，所以别线那笔只要正文里
# 提了一句"自动收集"就会被算进本线笔数，它带过的外线路径就被报成本线的越界（2026-10-10 实测
# 三枚：731cc2e2 / 6e813df9 / 4a1dacd9，主题分别是账号标准套件线与产品体验线的台账）。
# 本桶只按**主题行**认笔；仅正文提及的那些不删、照样打印，但不参与判决 —— 分层不是放松：
# 本线真越界仍然判红，而 ARM-4 逼着"提及件的外线路径必须出现在打印集合里"。
# 借名笔（2026-10-28 现量；口径变更由负责人同日点头「同意开始做吧。允许你去做」，见计划文末⑦那一格）：
# 主题的 scope 写了本线词，带过的路径却全是别线的件。**分类器照样判它们越界**（臂 7 逼着这一条），
# 只是从判决里挪出来、逐枚点名打印。这张表只对**点名的笔**生效：新出现的借名笔没登记 ⇒ 照样判红。
BORROWED_TITLE = {
    'f9084821': '主题 scope 写了「自动收集」，带过的 90 枚全是产品体验线的件'
                '（apps/mobile/evidence/ux-final-20261016/** 88 枚 + docs/plans/product-ux-optimization*.md 2 枚）',
}

# 关键字只命中在**冒号后的描述**里、且**一枚本线独占路径都没动**的笔 —— 别线台账把各线名字列了一遍那一类。
# 它们从判决里挪进"仅提及"桶（路径仍逐枚打印，证据不丢）。同样只对点名的笔生效；
# 臂 6 两头都有牙：拿 scope 的形状反查每张表里的笔是不是真属于它声称的那一类，标错就红。
DESC_ONLY = {
    '79e8ede1': '主题 `docs(协作 push 格)`，关键字只在描述里；带过 docs/plans/goal-collaboration-shared-lists.md（协作线的计划）',
    'f05c639d': '主题 `docs(台账 §6.101 + BLOCKED 待拍板表)`，关键字只在描述里；带过 docs/plans/account-standard-suite.md（注册登录线的台账）',
}


# 别线的笔**写进了本线独占路径**（2026-10-28 逐枚现量，每枚后面是它动了本线哪一路径）。
# 这张表存在的理由：`LINE_EXCLUSIVE` 那句"别的线不会去动它们"在共享检出上是**假前提** ——
# 整条链会把已入库的截图按当前产物重写、别线会在本线台账里记跨线条目、别线会修本线的 e2e 用例。
# 臂 3 的反查测的是"本线自己某笔主题漏了词 ⇒ 真越界被静悄悄少算"，那件事**不被这张表影响**：
# 只认逐枚点名的笔，新出现的没登记 ⇒ 照样判红。
FOREIGN_WRITES_INTO_LINE_PATHS = {
    '1335fc1b': '协作线在本线计划里写 §9.37 载体那段（docs/plans/inbound-automation.md +81 行）',
    '500f7bf3': '台账笔在本线计划补 push 那一格（同文件 +2 行）',
    'dfeee27c': '台账笔在本线计划补合并与两格拍板（同文件 +19 行）',
    '1393ed8b': 'billing 那笔在本线计划留一行（同文件 +1）',
    '2e45c9eb': 'billing adapter 那笔在本线计划留两行（同文件 +2）',
    'd4844794': '环境陷阱补号那笔在本线计划留一行（同文件 +1）',
    'e0f3dc7a': '下载页四端按钮那笔改了本线计划一行（同文件 +1/−1）',
    '8cd3e3e3': '整条链把已入库截图按当前产物重写（#602 那一族，panel-390-dark.png）',
    '459727fc': '界面复扫整批重生成，含本线那 4 枚面板取证图',
    'e492afb1': '归档整理那笔把本线 4 枚面板取证图换回另一版',
    '5e0f25f7': '台账整批写回：本线 8 枚取证图 + 动了本线 e2e 用例 10 行',
    '63e61f23': '产品体验线那笔带着本线 e2e 配置与用例一起入库（+163 行）',
    'd0fea0a3': '界面/A3 那笔修了本线那枚 web 用例（waiting-entitlement 不再一条空白正文）',
    'd49f77e3': '桌面+移动+落地页那笔带着本线移动端 lifecycle 那 64 行一起入库',
    '4f07c3f4': '验收装置那笔把本线电池的**反向对照**搬进仓库（装置本体归本线，主题无本线词）',
    '3998e598': '账号标准套件那笔动了一本 `verify-inbound-*` 装置（改密告知信那步的落点）',
    '6180eccc': '统一信封对齐那笔动了本线 `inbound-entitlement-remote.ts` 的错误体消费点',
    'd0bd83b3': '自托管镜像那笔补了本线包的第四枚 tgz 声明（`packages/inbound-core/package.json`）',
}


def partition(rows: list[tuple[str, str, str]]) -> tuple[list, list]:
    own, mentioned = [], []
    for row in rows:
        if row[0][:8] in DESC_ONLY:
            mentioned.append(row)
            continue
        (own if SUBJECT in row[2] else mentioned).append(row)
    return own, mentioned


# 归属证据：关键字命中的是主题行的**范围词**（`test(自动收集 …)` 那个括号，本线笔的形状）
# 还是冒号后的**描述**（别线那笔把各线名字列了一遍，如 79e8ede1 `docs(协作 push 格)`）。
# 为什么要它：上一版报红时只给路径与笔号，读的人必须自己 `git log -1` 才能判归属 ——
# 证据不可自证，等于把"这枚是不是本线越界"重新变成一次手工动作（负责人 2026-10-11 点名的毛病）。
# 2026-10-28：这一层经负责人点头**进了判决**（点名的 desc-only 笔与借名笔带的件才生效，见上面两张表）。
def keyword_field(subject: str) -> str:
    head = subject.split('\n', 1)[0]
    m = re.match(r'^[a-zA-Z][a-zA-Z0-9-]*(\([^)]*\))?!?:', head)
    scope = m.group(0) if m else ''
    if SUBJECT in scope:
        return 'scope'
    return 'desc' if SUBJECT in head else 'none'


def paths_of(rows: list[tuple[str, str, str]]) -> dict[str, list[str]]:
    paths: dict[str, list[str]] = {}
    for sha, _, _ in rows:
        for path in touched(sha):
            paths.setdefault(path, []).append(sha[:8])
    return paths


def subject_of(sha: str) -> str:
    return subprocess.run(['git', 'log', '-1', '--format=%s', sha],
                          capture_output=True, text=True).stdout.strip()


def snip(subject: str, n: int = 48) -> str:
    return subject if len(subject) <= n else subject[:n] + '…'


def report(since: str) -> int:
    rows = commits_since(since)
    if not rows:
        print(f'REFUSE: 窗口 `{since}` 之后一枚提交都没枚举到 —— 空分母不许报"越界 0"')
        return 1
    own, mentioned = partition(rows)
    if not own:
        print(f'REFUSE: 窗口内 {len(rows)} 笔里没有一枚主题带 `{SUBJECT}` —— 分母被外来提及占满，不许报"越界 0"')
        return 1
    fields = [keyword_field(subject) for _, _, subject in own]
    paths = paths_of(own)
    raw_oob = {p: c for p, c in paths.items() if not in_bounds(p)}
    # 借名笔带的外线路径**仍然被判为越界形状**，只是不参与判决（全部来源笔都在点名表里才算）。
    oob = {p: c for p, c in raw_oob.items() if not all(s in BORROWED_TITLE for s in c)}
    borrowed = {p: c for p, c in raw_oob.items() if all(s in BORROWED_TITLE for s in c)}
    print(f'窗口起 {since}　本线笔数={len(own)}　仅正文提及={len(mentioned)}　涉及路径={len(paths)}　越界={len(oob)}'
          f'　借名笔带的件（不判决、逐枚点名）={len(borrowed)}')
    print(f'　本线笔关键字命中段：范围词={fields.count("scope")}　仅描述={fields.count("desc")}'
          f'（2026-10-28 起这一层**进了判决**：点名的 desc-only 笔挪出、点名的借名笔带的件挪出，两张表只认逐枚点名件，'
          f'新出现的同类笔没登记就照判红 —— 口径变更经负责人 2026-10-28 点头，B169 那一格就此闭合）')
    for path, shas in sorted(oob.items()):
        print(f'  OOB {path} {shas}')
        for sha in shas:
            subject = subject_of(sha)
            exclusive = [p for p in touched(sha) if is_line_exclusive(p)]
            print(f'      ← {sha} 命中段={keyword_field(subject)} 带本线独占路径={len(exclusive)} 主题「{snip(subject)}」')
    for path, shas in sorted(borrowed.items()):
        print(f'  BORROWED（借名笔带的别线件，不参与判决）{path} {shas}　理由「{snip(BORROWED_TITLE[shas[0]], 76)}」')
    foreign_oob = {p: c for p, c in paths_of(mentioned).items() if not in_bounds(p)}
    for path, shas in sorted(foreign_oob.items()):
        print(f'  MENTION-ONLY（非本线动作）{path} {shas}')
    return 1 if oob else 0


KNOWN_OUT_OF_BOUNDS = {
    'packages/shared-schema/src/index.ts',
    'packages/shared-schema/tests/supersync-http-contract.spec.ts',
    'pnpm-lock.yaml',
}

# 2026-10-10 现量：这三枚路径由**别线**的笔带过（主题分别是账号标准套件线 / 产品体验线的台账），
# 而它们的正文里提了一句"自动收集"，于是被 `--grep` 抓进窗口集合。路径 → 一枚代表笔。
KNOWN_MENTION_ONLY = {
    'docs/plans/account-standard-suite.md': '731cc2e2',
    'docs/plans/product-ux-optimization.md': '6e813df9',
}

# 臂 5 的两枚点名样本（都取自真历史，2026-10-11 现量其主题行）：一枚关键字命中在**范围词**里
# （本线笔的形状），一枚只命中在**冒号后的描述**里（别线那笔把各线名字列了一遍，正是把越界算到
# 本线头上的那一类）。取笔靠 `git log -1 --format=%s` —— 笔不在了就返回空串，判不成 scope/desc，
# 这一臂会红而不是安静放行。
KNOWN_SCOPE_HIT = 'dee2048d'
KNOWN_DESC_HIT = '79e8ede1'

# 只属于本线的路径（别的线不会去动它们）。用来**反查归属过滤本身有没有漏**：
# 笔的归属是按提交信息里的主题词取的，而本机 git user 对所有并行会话同值，作者字段区分不了。
# 若我自己某一笔没带那个词，report() 会静悄悄少算一笔 —— 那一笔真越界也不会报出来（假绿）。
# ⇒ 凡动了下面这些路径的笔，都必须落在被计入的那一堆里。
LINE_EXCLUSIVE = [
    'packages/inbound-core/',
    'docs/plans/inbound-automation.md',
    'docs/reference/inbound-automation-protocol.md',
    'docs/research/inbound-automation-review.md',
    'docs/research/evidence/inbound-automation-review/',
    'research/tools/verify-inbound-',
    'packages/shared-schema/src/inbound-',
    'packages/app-host/src/inbound-',
    'packages/app-host/tests/inbound-',
    'packages/domain/tests/inbound-',
    'packages/sync-client/tests/inbound-',
    'apps/web/tests/inbound-',
    'apps/mobile/src/inbound/',
    'e2e/tests/inbound-automation.spec.ts',
    'e2e/playwright.inbound.config.ts',
]


def is_line_exclusive(path: str) -> bool:
    return any(path.startswith(prefix) for prefix in LINE_EXCLUSIVE)


def commits_all(since: str) -> list[tuple[str, str, str]]:
    """窗口内**全部**提交（不带 --grep）—— 用来和按主题词计入的那一堆做差。"""
    out = subprocess.run(['git', 'log', f'--since={since}', '--format=%H\t%ad\t%s',
                          '--date=format:%m-%d %H:%M'], capture_output=True, text=True).stdout.strip()
    rows = []
    for line in out.splitlines():
        if line:
            sha, date, subject = line.split('\t', 2)
            rows.append((sha, date, subject))
    return rows


def attribution_check(since: str) -> tuple[list, int, list]:
    """返回（动了独占路径却没被主题词计入、**且没在点名表里**的提交，逐枚带 `(短号, 首枚独占路径, 独占路径枚数, 主题行)`
    与（被计入且含独占路径的笔数），另附逐枚点名的那一些。主题行一起取回来，是为了让读的人**不用再跑一次 `git log -1`**
    就能在"别线动了本线路径"与"本线某笔主题漏了词"这两种读法之间自己判 —— 尺不替人下这个结论。"""
    matched = {sha for sha, _, _ in commits_since(since)}
    escapes, matched_exclusive, named = [], 0, []
    for sha, _, subject in commits_all(since):
        hit = [p for p in touched(sha) if is_line_exclusive(p)]
        if not hit:
            continue
        if sha in matched:
            matched_exclusive += 1
        elif sha[:8] in FOREIGN_WRITES_INTO_LINE_PATHS:
            named.append((sha[:8], hit[0], len(hit), subject))
        else:
            escapes.append((sha[:8], hit[0], len(hit), subject))
    return escapes, matched_exclusive, named


def self_test() -> int:
    # 每臂都跑完再汇总 rc —— 早退会让后面那几枚臂没有读数，而"有没有牙"只能按臂逐条证明。
    # 判据本身一枚都没动：任一臂不成立仍然 rc=1。
    arms, failed = 0, []
    # 臂 1：阳性对照 —— 开工前那一批分组提交里有**已知命名的**三枚越界，把它们纳进窗口就必须逐枚报出来。
    # 这里要的是"这三枚都在报出的集合里"，不是"报了点什么" —— 后者换一条别的路径也算过，臂就没在测它声称的东西。
    rows = commits_since('2026-10-09 12:00')
    paths = {p for sha, _, _ in rows for p in touched(sha)}
    found = {p for p in paths if not in_bounds(p)}
    arms += 1
    missing = sorted(KNOWN_OUT_OF_BOUNDS - found)
    verdict = "全部命中（OK）" if not missing else "缺 " + ", ".join(missing) + " —— 这枚分类器没有牙"
    print(f"ARM-1 阳性对照：窗口内越界 {len(found)} 枚，已知三枚{verdict}")
    if missing:
        failed.append('ARM-1')
    # 臂 2：空窗口必须**响亮地拒绝**，而且要走真入口 report()，不是在外面自己判一次"有没有行"。
    arms += 1
    rc_empty = report('2099-01-01 00:00')
    print(f'ARM-2 空分母：report() rc={rc_empty} ⇒ '
          f'{"拒绝（OK）" if rc_empty == 1 else "放行 —— 这一臂不成立（没枚举到东西也报干净）"}')
    if rc_empty != 1:
        failed.append('ARM-2')
    # 臂 3：归属过滤的反查。两半缺一不可 ——
    #   a) 分母自检：被计入的那些笔里**必须真的有**独占路径，否则"漏网 = 0"是空集给的，不是过滤器给的；
    #   b) 判决：动了独占路径却没被计入的笔必须为 0。
    # 臂 3：归属过滤的反查。三半缺一不可 ——
    #   a) 分母自检：被计入的那些笔里**必须真的有**独占路径，否则"漏网 = 0"是空集给的，不是过滤器给的；
    #   b) 判决：动了独占路径却没被计入、又没在点名表里的笔必须为 0；
    #   c) 点名表不许过期：每一枚点名的笔必须**仍然**动过本线独占路径、且仍然整条提交信息里没有本线词 ——
    #      把它塞进表里来躲反查是不行的（那两半都会红），表里的笔将来不成立时也会红而不是安静放行。
    arms += 1
    escapes, matched_exclusive, named_foreign = attribution_check(KICKOFF)
    stale = []
    matched_shas = {sha for sha, _, _ in commits_since(KICKOFF)}
    for sha8 in FOREIGN_WRITES_INTO_LINE_PATHS:
        if sha8 not in {s for s, _, _, _ in named_foreign}:
            why_hit = [p for p in touched(sha8) if is_line_exclusive(p)]
            if not why_hit:
                stale.append(f'{sha8} 已不再动本线独占路径（表该显式删）')
            elif sha8 in matched_shas:
                stale.append(f'{sha8} 现在已被主题词计入，不该留在别线点名表里')
            else:
                stale.append(f'{sha8} 未出现在反查结果里（表与现量不符）')
    if matched_exclusive == 0:
        print("ARM-3 归属反查：计入的笔里独占路径 0 份 ⇒ 这一臂没有分母，不成立")
        failed.append('ARM-3')
    else:
        print(f"ARM-3 归属反查：计入的笔中含独占路径 {matched_exclusive} 笔（分母非空，OK）；"
              f"别线笔逐枚点名={len(FOREIGN_WRITES_INTO_LINE_PATHS)} 枚（实到 {len(named_foreign)}，过期 {len(stale)}）；"
              f"动了独占路径却没被计入且没点名 = {len(escapes)} ⇒ "
              + ("0（OK）" if not escapes else "漏网，逐枚附主题行（两种读法请照主题自己判，尺不下结论）："))
        for sha8, path, n, subject in escapes[:5]:
            print(f"      ✗ {sha8} 动本线独占路径 {n} 枚（首枚 {path}）主题无本线词「{snip(subject, 40)}」")
        if len(escapes) > 5:
            print(f"      …共 {len(escapes)} 枚，只列前 5")
        for line in stale:
            print(f"      ✗ 点名表过期：{line}")
        if escapes or stale:
            failed.append('ARM-3')
    # 臂 4：主题/正文分流的**两半**。只测"分流能把外来笔分出去"会漏掉另一半：
    # 分流若把外来笔的路径整个丢掉，越界照样为 0 而证据也消失了 —— 那是把假红换成假绿。
    # 所以两半都要：a) 已知的"仅正文提及"笔不许落在本线桶里；b) 它带的外线路径必须仍在提及桶的
    # 越界集合里（照样打印，只是不判决）。变异形状：让 partition 全部归 own ⇒ a 与 b 同时红。
    arms += 1
    rows4 = commits_since(KICKOFF)
    own4, mentioned4 = partition(rows4)
    own_shas = {sha[:8] for sha, _, _ in own4}
    mentioned_oob = {p for p in paths_of(mentioned4) if not in_bounds(p)}
    # 分流后的"证据仍在"这一半要认两路打印：仅提及桶的越界集合，**以及借名笔带的件**（2026-10-28 新增那一块）。
    # 判据不变的是"不许静悄悄消失"——只是它现在多了一个合法的落点。
    borrowed4 = {p for p, c in paths_of(own4).items() if not in_bounds(p) and all(s in BORROWED_TITLE for s in c)}
    judged4 = {p for p, c in paths_of(own4).items() if not in_bounds(p) and not all(s in BORROWED_TITLE for s in c)}
    bad = [f'{sha} 被当成本线笔' for sha in own_shas if sha in set(KNOWN_MENTION_ONLY.values())]
    bad += [f'{path} 的证据被分流丢了' for path, _ in KNOWN_MENTION_ONLY.items()
            if path not in mentioned_oob | borrowed4 or path in judged4]
    print(f'ARM-4 主题/正文分流：本线 {len(own4)} 笔 / 仅提及 {len(mentioned4)} 笔；'
          f'已知提及件 {len(KNOWN_MENTION_ONLY)} 枚 ⇒ ' + ('两半都成立（OK）' if not bad else "坏 " + "; ".join(bad)))
    if bad:
        failed.append('ARM-4')
    # 臂 5：归属**证据**这一层能不能在真历史上把两类笔分开。它测的是 `keyword_field()` 与 OOB 行下面
    # 那行归属，不测判决 —— 判决那一半由臂 1/2/4 管。三半：
    #   a) 点名的范围词笔必须判 scope —— 去掉"只看 `type(…) ` 那个括号"这一步，它会被降成 desc，本半红；
    #   b) 点名的描述提及笔必须判 desc —— 那条正则若写宽到把冒号后的描述也当范围词，本半红；
    #   c) 真入口 `report()` 每行 OOB 后面必须跟着归属行（走真入口、捕获它的输出，不在外面自己拼一遍），
    #      窗口内 0 枚越界时**明说这一半没有分母**，不许把"没东西可查"读成"查过且都带归属"。
    arms += 1
    got_scope = keyword_field(subject_of(KNOWN_SCOPE_HIT))
    got_desc = keyword_field(subject_of(KNOWN_DESC_HIT))
    cap = io.StringIO()
    with contextlib.redirect_stdout(cap):
        report(KICKOFF)
    lines = cap.getvalue().splitlines()
    idx_oob = [i for i, line in enumerate(lines) if line.startswith('  OOB ')]
    orphan = [lines[i] for i in idx_oob
              if i + 1 >= len(lines) or not lines[i + 1].startswith('      ← ')]
    bad5 = []
    if got_scope != 'scope':
        bad5.append(f'{KNOWN_SCOPE_HIT} 应判 scope，实判 {got_scope or "none"}')
    if got_desc != 'desc':
        bad5.append(f'{KNOWN_DESC_HIT} 应判 desc，实判 {got_desc or "none"}')
    if idx_oob and orphan:
        bad5.append(f'{len(orphan)} 行 OOB 缺归属行')
    print(f'ARM-5 归属证据：范围词件 {KNOWN_SCOPE_HIT}→{got_scope or "none"}　描述件 {KNOWN_DESC_HIT}→{got_desc or "none"}　'
          f'OOB 行={len(idx_oob)}　缺归属的行={len(orphan)}　'
          + ('三半成立（OK）' if not bad5 else '坏 ' + '; '.join(bad5))
          + ('' if idx_oob else '［c 半本窗口无分母：0 枚越界可查，这一臂只证到 a/b］'))
    if bad5:
        failed.append('ARM-5')
    # 臂 6：两张**点名表**（DESC_ONLY / BORROWED_TITLE）有没有牙。五半缺一不可 ——
    #   a) 表里的笔仍在窗口内可枚举（笔没了就红，不安静放行）；
    #   b) DESC_ONLY 的笔确实"关键字只在描述位、且一枚本线独占路径都没动"—— 拿形状反查标错：
    #      把自己的真笔塞进这张表来躲判决，本半立刻红；
    #   c) DESC_ONLY 的笔带的外线路径仍出现在"仅提及"桶的越界集合里（分流只挪判决，不吞证据）；
    #   d) BORROWED_TITLE 的笔仍是 scope 命中，且它带的件**按分类器仍然越界** ——
    #      即"把这张表去掉，越界必须涨回去"：证起作用的是点名表，而不是有人把白名单写宽了；
    #   e) 每一枚借名件都必须在输出里被逐枚点名打印（走真入口捕获，不在外面自己拼一遍）。
    arms += 1
    rows6 = commits_since(KICKOFF)
    own6, mentioned6 = partition(rows6)
    all6 = {sha[:8] for sha, _, _ in rows6}
    bad6 = []
    for sha8, why in DESC_ONLY.items():
        if sha8 not in all6:
            bad6.append(f'{sha8} 不在窗口内（点名表过期）')
            continue
        row6 = next(r for r in rows6 if r[0][:8] == sha8)
        if keyword_field(row6[2]) != 'desc':
            bad6.append(f'{sha8} 关键字不在描述位（实判 {keyword_field(row6[2]) or "none"}），不该进 DESC_ONLY')
        if any(is_line_exclusive(p) for p in touched(row6[0])):
            bad6.append(f'{sha8} 动了本线独占路径，不该被当外来提及剔除：{why}')
    desc_oob6 = {p for p in paths_of(mentioned6) if not in_bounds(p)}
    for sha8 in DESC_ONLY:
        row8 = next((r for r in rows6 if r[0][:8] == sha8), None)
        if row8 is None:
            continue
        bad6 += [f'{sha8} 的证据被分流丢了 {path}' for path in touched(row8[0])
                 if not in_bounds(path) and path not in desc_oob6]
    own_shas6 = {sha[:8] for sha, _, _ in own6}
    for sha8, why in BORROWED_TITLE.items():
        if sha8 not in own_shas6:
            bad6.append(f'{sha8} 已不是 scope 命中的本线笔，排除表要显式更新而不是留着（{why}）')
        elif not [p for p in touched(sha8) if not in_bounds(p)]:
            bad6.append(f'{sha8} 带的路径已全在白名单内 —— 排除表成了多余件，要显式删掉')
    paths6 = paths_of(own6)
    raw6 = {p for p, c in paths6.items() if not in_bounds(p)}
    judged6 = {p for p, c in paths6.items() if not in_bounds(p) and not all(s in BORROWED_TITLE for s in c)}
    suppressed = raw6 - judged6
    if not suppressed:
        bad6.append('点名表没起作用：去掉它越界不涨（说明是白名单被写宽，不是归属在起作用）')
    cap6 = io.StringIO()
    with contextlib.redirect_stdout(cap6):
        report(KICKOFF)
    printed_borrowed = {m.group(1) for line in cap6.getvalue().splitlines() if line.startswith('  BORROWED')
                        for m in [re.search(r'BORROWED（[^）]*）(\S+)', line)] if m}
    if suppressed - printed_borrowed:
        bad6.append(f'{len(suppressed - printed_borrowed)} 枚借名件没被逐枚点名打印（最先是 {sorted(suppressed - printed_borrowed)[0]}）')
    print(f'ARM-6 点名表有牙：DESC_ONLY={len(DESC_ONLY)}　借名笔={len(BORROWED_TITLE)}　'
          f'去表前越界={len(raw6)}　判决里剩={len(judged6)}　被压住且逐枚打印={len(suppressed & printed_borrowed)} ⇒ '
          + ('五半成立（OK）' if not bad6 else '坏 ' + '; '.join(bad6)))
    if bad6:
        failed.append('ARM-6')
    print(f'臂数={arms}，不成立={len(failed)}' + ("" if not failed else " → " + ", ".join(failed)))
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--since', default=KICKOFF)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    return self_test() if args.self_test else report(args.since)


if __name__ == '__main__':
    sys.exit(main())
