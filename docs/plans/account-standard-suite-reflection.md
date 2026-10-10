# 复盘：注册登录标准套件线（2026-10-10）

> 只收**本轮对话里真发生过的纠正**（每条都有仓内读数或日志出处），不写泛用建议。
> 长期可复用的那部分另见文末「可长期记忆候选」——那一节里**只有标 ✅ 的才进了记忆**，
> 其余留在本文件当候选，等第二次独立证据。
> 现状交接在 [`account-standard-suite-handoff.md`](account-standard-suite-handoff.md)；
> 逐趟读数在 [`account-standard-suite.md`](account-standard-suite.md)。

归因口径：`信息不足` = 当时能拿到但没拿的信号；`判断逻辑有问题` = 信号齐了但推错了；`两者都有`。

---

## 1. 纠正表

| 修改内容 | 错误归因 | 证据 | 下次开头指令建议 |
|---|---|---|---|
| **§6.81 第一行**「纯 HEAD 的 `pnpm -r build` 红在 `packages/app-host` barrel」→ 在新 tip 上不再成立，本线交接已按今天读数改写 | `判断逻辑有问题`：把**我查的那一刻**的红，写成了**「纯 HEAD」的红**。缺失信号 = 那行只写了 tip `731cc2e2`，没写「红在哪一格是 tip 的瞬时属性」；而别人每小时在推进 tip | 同一棵树两种走法：13:36 那趟 `build-pure-head.log` 整个没走到编译，红在 `ERR_PNPM_META_FETCH_FAIL`（撞网）；16:43 叠上 3 枚在飞 manifest 后 `build-head3.log` 红在 `packages/ui` 12 条 TS2305/2307/2322 | 引用任何一条「X 会红在 Y」的旧结论前，先确认它带没带**载体 + tip + 时刻**三件套；少一件就重跑那条命令，别照句子行动 |
| **§6.81 末段**「加 `npm_config_verify_deps_before_run=false` 才是走到真错的那一步」→ 今天否证；那条环境变量**拦不住** pnpm 的依赖协调 | `两者都有`。`信息不足`：当时载体的 lockfile 与 manifest **本来就一致**，所以「加了它就走通了」这一步是真的。`判断逻辑有问题`：从「我做 A 之后 B 通了」直接推「A 是 B 的前提」，**没跑「不做 A」的对照臂** | 18:35 那趟 `pnpm install --frozen-lockfile --offline` **不带那个变量、也已删掉载体 `.npmrc`**，仍 `INSTALL_RC=0` / `Already up to date` / 227 ms；而我先后试过环境变量与 `.npmrc` 两种写法，两趟都没拦住协调 | 把「我做了这一步所以通了」写进文档之前，先跑一次**去掉这一步**的对照；对照不通才配写因果 |
| **「把 `apps/node-host` 整层退回已提交那版，载体就能构建」**→ 同一趟内被否证 | `信息不足`：**没有按作用枚举消费方**。只查了报错点名的那一处（`host.ts:274`），没 grep 那个类型的全仓使用者。缺失信号就是一条 `grep -rn` | 排除后 `BUILD_RC=1` 仍在，位置换成 `apps/web/src/features/settings/inbound-runtime.ts(210,5)`；全仓枚出**三处**内联（`host.ts:274`／`inbound-runtime.ts:184`／`InboundAutomationSettings.tsx:56`+`:291`），第三处**被第二处遮着**：`setProcessState(result.state)` 里 `result` 的类型来自第二处那个三态签名 | 想用「排除一处」让构建变绿，**先 grep 那个类型/常量的全部消费方**，再真的重跑一次构建 —— 别信「应该只剩这一处」 |
| **从 tip 那几把尺派生的一整批法务文本**作废（差点提交进法务文件） | `信息不足`：不知道 tip 的 `packages/legal/tests/structure.spec.ts` 顺序回放迁移里的外键增删但**不认识 `DROP TABLE`**，`tombstones_user_id_fkey` 一直留在账上 | 三档读数（**"失败条数更少"不等于更对**）：纯 tip 基线 `2 failed｜64 passed` → 我的派生态 `1 failed｜65 passed` → 主检出那批装到纯 tip 代码上 `5 failed｜71 passed`。真表 `account_tombstones`（`schema.prisma:549-553`）**故意不建外键** —— 建了级联会把注销标记一起抹掉 | 用一把尺的输出去「修」另一份文本之前，先给那把尺喂一条**它自己没见过的输入**（正向对照不够，要有"这题它答错时会不会告诉你"） |
| **§6.78②**「工作树里也发不出去」撤回（那句话是假的） | `判断逻辑有问题`：一把判据里**混了两种可见性范围**——读文本用磁盘（`readFileSync`）、找调用点用 `git grep`（只看得见索引），于是"未跟踪但真在调"的那枚文件被读成"没调用点" | `server/src/password/registration-otp.ts:259,319` 真的调 `sendEmailPasswordRegistrationCodeEmail`（该文件此刻 `??`）⇒「十封」是真话。改法带臂：新 **A6** 抹掉那枚发信常量的**全部**调用文件 ⇒ 那一封必须立刻不算实发，而 `git grep` 那一版**纹丝不动**；`--self-test` 7/7 | 写判据时先问「它读磁盘还是读索引」；一条里两者都有就**显式声明**，并造一条臂让"另一种读法"会给出不同答案 |
| **共享检出里那 6 枚删除件**（差点把本线最后四笔提交无声删掉） | `信息不足`：提交前没查**索引**，只看了工作树 | `git status` 报 6 枚 D/M，恰好是本线最后四笔的全部文件；工作树磁盘内容逐枚 == HEAD ⇒ 任何一次基于索引的提交都会删掉它们。处置：`git restore --staged --source=HEAD -- <6 枚>`，复验 `git diff --cached` 空 | 在共享检出里**每次**提交前先 `git diff --cached --name-status`；不属于我那片就把索引退回 HEAD，**只动索引、不动工作树** |
| **本线 `BLOCKED.md` B131 那段文字被别线那笔提交吸走**（`0eea4c0f`） | `判断逻辑有问题`：知道共享检出要带 pathspec，实际操作时用了宽 `git add`。缺失信号 = 当时手边就有 plumbing 那条路 | `git log -S'B131' --oneline -- BLOCKED.md` 落在别线的 `0eea4c0f`；那段文字现在**已公开、不能再 amend** | 共享检出里落自己的 hunk **走 plumbing**（`hash-object -w` → 临时索引 → `write-tree` → `commit-tree` → CAS `update-ref` → `diff-tree` 证明），不用 `git add` |
| **我自己那条挂了 52 分钟的陈旧门禁循环**占着载体，让我误判"载体空闲/负载高" | `判断逻辑有问题`：起后台等待循环时**没设终止条件、没登记 pid**，于是下一轮无从判断载体归谁 | 载体里查到 PID 28750 + 子 97598；**先**用 `lsof -a -p 28750 -d cwd` 证明其 cwd = `.worktrees/iosacct`（即我自己起的），才 kill —— 符合"只对自己创建的对象动手" | 起任何等待循环之前**登记 pid + 最长寿命**；怀疑载体被占，用 `lsof` 的 cwd **认人**之后再动，禁止按名字 kill |
| **交接件里两枚 ADR 文件名是我凭记忆拼的，两枚都不存在**（`0063-session-rows-and-email-rebind.md`／`0039-token-compartmentalization.md`） | `判断逻辑有问题`：以为「ADR 编号 + 主题」能拼出文件名。缺失信号就是一次 `ls docs/adr/`，我跳过了 | 🔴 **发现者不是我**：别线那枚 B136 的死链读数点名 `account-standard-suite-handoff.md:8-10` 三条，我这才去 `ls` ⇒ 真名 `0063-email-rebinding-and-per-session-revocation.md`／`0039-email-first-auth-and-desktop-reverse-authorization.md`。改后 `node research/tools/docs-link-check.mjs` 对这两个文件只剩一条命中（"reflection 尚未被 git 跟踪"，新文件正常态） | 文档里**任何**指向具体文件的路径，落笔前先 `ls`/`test -e` 现量 —— 编号与主题拼不出文件名。写完立刻跑一次死链检查，别把"提交前再跑"当保障：**共享仓里别人可能比你先跑到，并把你的名字写进他的账** |
| **我"替 owner 打上那枚类型修正"的有界实验**——其实早就没东西可打了 | `信息不足`：我在 19:11 打算改 `apps/node-host/src/host.ts:274` 做实验，**依据是 19:0x 那次现量**，而载体落后主检出 3 笔。缺失信号 = 实验前没重读那枚文件 | `python3` 替换脚本里的 `assert s.count(old)==1` 当场 `AssertionError: 0` ⇒ 那枚"旧串"已经不存在（owner 已把它改成 `Promise<InboundAutomationCycleResult>`）。📌 **这次不是失误而是装置救了场**：动手前的"旧串还在不在"断言，本身就是一枚免费的现量尺 | 往别人的文件上打任何临时补丁之前，**先跑一次"我要替换的那段还在不在"的断言**；断言失败就停下现量，别把"改不动"当成"改坏了" |
| **我给那枚 i18n 重复键取的号（B138）与别线 18:5x 那枚撞了**，而两件事确实不是同一件 | `判断逻辑有问题`：18:5x 现量末号 B136 ⇒ 取 B137/B138；**中间隔了一小时多的构建与写文档**，而那一个小时里别人追加了 B137…B140。`BLOCKED.md` **没有防重号门禁**（`check:adr-numbering` 只管 ADR）⇒ 没有任何一层会替我发现 | `grep -oE '^## B[0-9]+' BLOCKED.md \| sort \| uniq -d` 抓到 `## B138` 命中 2 次（7184 行是别线的 `InboundAutomationHostOptions` 两份定义、7989 行是我这枚）⇒ 已把我这枚改成 **B141**（后到者让号），并更正三处交叉引用；仓内另有一枚**历史遗留**的 `## B102` 重号，不归本线 | **取号与落笔之间不许隔任何等待**：落笔前再跑一次 `uniq -d`。（更一般地：共享账本上"我是第 N 号"这件事的保质期，只到你写下它的那一秒。） |

---

## 2. 本轮**做对**了的两件事（也要留形，不然只记得住失败）

1. **「叠什么必须声明」这个纪律起了作用。** 载体装置 `sync-dirty-to-carrier.sh` / `sync-prefixes-to-carrier.sh`
   的文件头写着叠加口径与为什么，所以当我从「三前缀」换到「整片」时，是照着**上一次自己写下的理由**换的，
   而不是重新赌一遍。它当场照出一枚无法归因的红（`apps/landing` 的在飞 i18n 词条 + HEAD 的 landing 源码 = **混代**），
   而我能立刻说清"这不是任何一条线的缺陷，是我的叠加口径切了一半"。
2. **否证掉自己的打算之后没有硬修。** 发现 B131 是一类三处时，按既有三条（一子可删／改后运行时形状现量等于改前／
   一条命令可回退）判为**不齐**，登记成 **B137** 交回 owner —— 而不是为了让设备腿能跑去代改别人的产品语义。
   代价是这一腿今天没取到数，但这正是那三条要付的价。

---

## 3. 可长期记忆候选

判据：这条是否**跨项目**成立、是否已有**第二次独立证据**。已进记忆的标 ✅ 并写明落在哪一层。

| 候选 | 是否已达可复用标准 | 处置 |
|---|---|---|
| ✅ **「排除一处让构建变绿」之前要按作用枚举全部消费方** | 是。本轮第三次独立命中（用户级记忆 `报修的缺陷是一类不是一个` 已有两条；本轮又加一条"遮罩"形状 —— 第二处修了第三处才现形） | 已**更新**用户级记忆 `feedback-reported-defect-is-a-class.md`，把「遮罩」这一形补进去 |
| ✅ **写进文档的因果句要先跑"去掉这一步"的对照** | 是。本轮 `npm_config_verify_deps_before_run` 是一条**已入库的因果句**被否证；同族第一次是"失败条数更少≠更对" | 已**更新**用户级记忆 `gates-teeth-and-consumers` 族表对应条目 |
| ✅ **旧结论的保质期 = 载体 + tip + 时刻三件套** | 是，且§6.81 是**我自己上一笔提交**里写的 | 已在用户级 `正文别存会漂的值` 内（同一理，本轮加"瞬时属性必须带读取三件套"的具体形状） |
| 🟡 **一条判据里不许混磁盘读法与索引读法** | 候选 —— 本仓只有一枚独立实例（`check:legal-email-claims`），别处未见 | 留本文件 + 已进过程账 §6.80②（带臂），**不进记忆** |
| 🟡 **zsh 双引号里的反引号会打断 shell**（本线第二次）／**缓冲管道 `| tail -N` 探长任务零增量输出** | 候选 —— 属工具用法层，且与仓内陷阱 #45（管道后 `$?` 是 tail 的）同族但不完全同题 | 留本文件，**下次再命中就登记进 `docs/reference/environment-traps.md` 末尾**（编号现量：`grep -cE '^[0-9]+\. ' docs/reference/environment-traps.md`，写这份时 411 条 ⇒ 下一条 B/条目号请以正文 `sort -n` 读最大号为准，别按条数推） |

⚠️ 本节标 ✅ 的三条**必须真的写进记忆文件才算数**（见文末"实际落笔"）。本文件只是账，不是记忆。

---

## 4. 实际落笔（写这份的人自查）

- 用户级记忆是否更新：见 `~/.qoder-cn/memory/families/gates-teeth-and-consumers.md` 与
  `~/.qoder-cn/memory/feedback-reported-defect-is-a-class.md` 的当前内容（**接手者请现量核对**，
  本文件不构成"已经写进去了"的证据）。
- `BLOCKED.md` 的 **B137**：本轮已登记（B131 一类三处的交回内容，含"第三处被第二处遮着"那一形）。
  末号现量 `grep -oE '^## B[0-9]+' BLOCKED.md | grep -oE '[0-9]+' | sort -n | tail -1`。
- 🔴 **这两份交接件本身是被别线那笔 `0243762a` 提交进去的**（18:49，宽 `git add` 第二次把本线未提交件扫走 ——
  第一次是 B131 那段进 `0eea4c0f`）。⇒ 内容里若有错**不能再 amend**，只能新写一笔更正。
  本轮就当场用上了这条：我凭记忆写下的两枚 ADR 文件名**都是错的**
  （写成 `0063-session-rows-and-email-rebind.md` / `0039-token-compartmentalization.md`，
  真名是 `0063-email-rebinding-and-per-session-revocation.md` / `0039-email-first-auth-and-desktop-reverse-authorization.md`），
  是别线 B136 那次死链检查**先于我发现**并点名了我这两行 ⇒ 已改成真名，
  并被这条新事实改写了处置：**猜文件名 = 造死链，必须 `ls` 现量**（见下表第 9 行）。
  `grep -oE '^## B[0-9]+' BLOCKED.md | tail -1`。
- 过程账对应节：**§6.81**（已入库、其中两句本文件已否证 ⇒ 下一个接手的人应就地改准，
  别只在文末追加成功记录而保留正文旧断言 —— AGENTS §8 第 8 条）。
