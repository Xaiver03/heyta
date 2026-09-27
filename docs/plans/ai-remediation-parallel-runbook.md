# 三个 AI 模块**并行开工** runbook

> 适用：[模块 1 引擎](ai-remediation-module-1-engine.md)、[模块 2 旅程](ai-remediation-module-2-journey.md)、
> [模块 3 记忆护城河](ai-remediation-module-3-memory-moat.md)
> 分叉点：**tag `ai-remediation-fork`**（三条分支都从这里开；先提交本 runbook，再打 tag）
> 状态：已落地（`scripts/check-module-boundaries.mjs` 是这一节的可执行版本）

---

## 0. 结论：能，而且不需要任何串行等待

此前"必须等模块 1 全部做完才能唤醒模块 2 和 3"，来自**两处**，都不是技术必然：

| 绑死它的东西 | 原文 / 实测 | 现在 |
|---|---|---|
| 任务书里写死的合并顺序 | 模块 3 §1.4：「两个模块**不许并行改同一分支**，合并顺序是 **1 → 2 → 3**」 | **删掉**，改成"任意顺序 + 接口先行" |
| 三个 AI 共用同一个检出目录 | 本轮实测：`git status` 里 **102 个未提交文件**，分属 5 个不同的工作 | **一模块一 worktree** |

第二条是关键，而且它有一个**可运行的证据**：本仓库已经吃过一次亏 ——
未合并分支 `feat/motivation-system` 的 `7ac61bf` 记着实测（该文件只在那个分支上，
所以这里不写链接，写了就是死链）：
主检出的未提交改动与本分支改动的**交集是 7 个文件**，git 直接拒绝合并
（`local changes would be overwritten`），处置只有一句"**等对方先提交**"。
那句话就是"我必须等一个 AI 做完才能唤醒下一个"的真正来源。

在共享检出里，连"你有没有越界"都判断不了：本轮实测 `--module 2` 会报
**93 个越界文件**，而它们全是别人的在制品。所以顺序只能是：
**先隔离目录，再谈租约。**

---

## 0.5 开工前：**先确认分叉点是绿的** —— 本轮它不绿

worktree 隔离防的是"互相覆盖"，它**防不住"分叉点自己就构建不过"**。
本轮实测（tag `ai-remediation-fork`）：

| 项 | 数字 |
|---|---|
| `apps/web` 类型错误 | **22 个 / 12 个文件** |
| `@heyta/web` 测试 | **47 failed** / 480 passed / 12 skipped |

成因还是同一个形状：**改动只提交了一半** —— `apps/web` 那半提交了，
`packages/*` 那半还躺在主检出的工作区里。可复跑的证据：

```bash
# PreferenceHint 在**全部已提交历史**里都没有 facts，而 head 上已经有代码在调它
git log -S facts -- packages/domain/src/            # 输出为空
grep -n "hint\.facts" apps/web/src/features/ai/AiDuration.tsx
```

被已提交代码引用、却从未提交的另一半（共 9 处）：
`PreferenceHint.facts`、`PreferenceEvidence`、`clockText`、`roundedDaysText`、
`WithheldPreference.remaining`、`Preference.evidenceFacts`、`QuadrantDropPlan`、
`TaskActions.setQuadrantDrop`、`StorageError`。

🔴 **分叉点红的时候不要开工。** 你会分不清"是我改坏的"还是"本来就坏"。
本轮 ai-m2 是靠 `git stash` 前后各跑一次全量、逐项对齐
（47 failed/480 passed → 47 failed/482 passed）才敢说"本改动 +2 通过、0 新增失败"。

🔴 **`pnpm check` 跑在脏检出上等于没跑。** 这是本轮最贵的一课：
上一轮的交付报告写着"`pnpm check` exit 0"，而那个检出里躺着别人 102 个未提交文件 ——
**它验证的不是任何一个提交**；已提交状态实际是红的（就是上面那 22 + 47）。
→ 门禁必须在**干净的 worktree 上、对着某个提交**跑。这是隔离的第二个好处。

**分叉点 tag 的移动协议**：`ai-remediation-fork` 只允许在**没有任何模块开始提交之前**移动。
本轮它移动过两次（都是预检修复）。一旦有人提交了，再改分叉点就必须
`git rebase ai-remediation-fork`（本轮 ai-m2 就是这么跟上来的）—— 所以**别再动它**。

---

## 1. 四条规则

### R1 · 一个模块一个 worktree（永不共用检出）

主检出（`heyta/`）从此**只做两件事**：整合、跑门禁。任何模块都不许在里面写代码。

```bash
# 一次性：三条互不干扰的工作目录，都从同一个分叉点开
cd "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta"
FORK=ai-remediation-fork
git worktree add .worktrees/ai-m1 -b feat/ai-module-1-engine       "$FORK"
git worktree add .worktrees/ai-m2 -b feat/ai-module-2-journey      "$FORK"
git worktree add .worktrees/ai-m3 -b feat/ai-module-3-memory-moat  "$FORK"

# 每个 worktree 需要自己的 node_modules（pnpm 走全局 store，硬链接，很快）
# 实测：ai-m1 32.5s / ai-m2 24.2s / ai-m3 20.5s
for d in ai-m1 ai-m2 ai-m3; do (cd ".worktrees/$d" && pnpm install --frozen-lockfile); done

# 🔴 还要各自 build 一次。**这一步不做，测试根本跑不起来**：
# 包间是通过 `dist/` 消费的（`@heyta/i18n` 的入口指向 `dist/index.js`），
# 而新 worktree 里没有任何 `dist/`。实测（ai-m2，未 build）：
#   Failed to resolve entry for package "@heyta/i18n" ... Tests: no tests
# 它长得像"测试配置坏了"，其实是"工作副本还没编译过"。
#
# ⚠️ **不要用 `pnpm -r build`**：它会把 `server` 一起带上，而 `server` 的
# prebuild 是 `prisma generate`，它要写 `~/.cache/prisma/...`（工作区之外）——
# 在受限沙箱里实测报 `EPERM ... utime 'libquery-engine'` 并**中断整条链**。
# 那跟三个模块毫无关系。只建自己要用的那棵子图：
for d in ai-m1 ai-m2 ai-m3; do (cd ".worktrees/$d" && pnpm --filter "@heyta/web..." build); done
```

`.worktrees/` 已在 `.git/info/exclude` 里（本仓库既有约定，见 `.worktrees/motivation`）。
`dist/` 是构建产物、不进 git，所以每个工作副本都得自己来一遍 —— 这是隔离的**代价**，
一次性的（后面只 `pnpm -r build` 增量重建被改动的包）。

### R2 · 租约是可执行的，不是一句话

```bash
# 我在本分支上改的，是否都在我的租约内？（不需要等任何人）
node scripts/check-module-boundaries.mjs --module 2 --rev ai-remediation-fork
```

租约表在脚本的 `LEASES` 里，和任务书 §1.1 的白名单**一一对应**。
改动任务书的白名单时，**必须同时改脚本** —— 两边不一致时，以脚本为准，
因为它是唯一能自动跑的那份。

三条规则里最有价值的一条是 `deny`：`apps/web/src/features/settings/**` 与
`apps/web/tests/**` 是两个模块**真实交叉**的地方，脚本把它们写成了排除项
（模块 2 不许碰 `MemoryPanel.tsx` / `preference-copy.ts` / `memory-panel.spec.tsx`）。
**交叉面必须写进代码，写进散文一定会漂移。**

### R3 · 共享文件只有两类，各有各的规矩

**① 追加型（多写者）：`packages/i18n/src/locales/{zh-CN,en}.ts`**

模块 2 和模块 3 都往这两份文件里加词条。它**不需要**串行，前提是三条：

- **只许追加**：不许移动、重排、重命名已有键（两边都在追加，重排 = 必然冲突）；
- **命名空间不重叠**：模块 2 用 `web.ai.*`，模块 3 用 `web.memory.*`；
- **中英同一次提交加齐**（`check-ui-language` 已经在核对两侧数量相等）。

三条都做到时，两个模块加的是文件里**位置不同**的两段，git 会自动合并。
**不满足三条时唯一正确的处置是"两边都留"，绝不是"取一边"。**

**② 唯一 owner：`apps/web/src/App.tsx` → owner 是模块 2**

模块 3 的租约里已经**不含** `App.tsx`。它需要 App 配合时，走 §2 的三条路之一，
**不许自己改**。同一时刻只有一个模块能改一个文件 —— 这就是"唯一 owner"的全部含义。

### R4 · 没有合并顺序

三条分支可以任意顺序落地，因为它们改的文件集合互不相交（共享的只有追加区）。
"必须先 1 再 2 再 3"是旧模型的产物，删掉。

### R5 · 门禁的扫描面已经梳理过（唯一越界的那一个已修）

并行开工后有一个新问题：**别人的半成品会不会把我的门禁弄红？**
三个"从磁盘找文件"的门禁实测如下：

| 门禁 | 扫描根 | 会走进 `.worktrees/` 吗 |
|---|---|---|
| `scripts/check-ui-language.mjs` | 写死的相对目录（`apps/web/src` 等） | 不会 |
| `scripts/check-ai-coverage.mjs` | `packages/app-host/src`、`apps/web/src` | 不会 |
| `research/tools/docs-link-check.mjs` | **仓库根递归** | **会** → 已修 |

docs 那一个是实测出来的：在 `.worktrees/ai-m1` 里放一个死链，
主检出的 `check:docs` 立刻 `exit 1` —— 等于"另一个模块的半成品文档能卡住主检出"。
已把 `.worktrees` 加进它的跳过表。

**修的是扫描面，不是阈值**，两个方向的对照实验都做了：

1. worktree 里的死链 → 主检出 `exit 0`（隔离生效）；
2. 主检出自己的死链 → 仍然 `exit 1`（门禁没被削弱）。

🔴 以后新增任何"从磁盘找文件"的门禁时，先确认它的扫描根不会走到 `.worktrees/`。

---

## 2. 跨模块需要新符号怎么办（这是"要不要等"的唯一真实来源）

模块 2 要读模块 1 的 `resolveRoute` / `CandidateExclusionReason`；
模块 3 要读 `packages/domain` 的 `FocusGap`。**这些都已经在分叉点存在**，
所以此刻三条分支是纯并行的。

万一某个模块需要**分叉点还不存在**的东西，只有三条路，**没有第四条**：

1. **用已有的导出**（首选）。任务书里那句"你需要的导出**已经有了**"就是这个意思 ——
   先去 `packages/*/src/index.ts` 找一遍，绝大多数情况答案在这里。
2. **本地适配器 + 报告登记**。在自己这一侧写一个薄包装，把缺口挡在自己的包边界内，
   并在交付报告的"未核实 / 需要别人做的事"里写清"合并后可以删掉这个适配器"。
   例：模块 2 要的 `explainNoCandidate` 语义，就是自己写一份、
   而不是去改模块 1 的 `packages/ai`。
3. **接口先行（pre-land）**。把一个共享文件的改动**提前到分叉点之前**：
   由 owner 一次提交（例如模块 2 在 `App.tsx` 里预埋一个 `focusGaps` prop），
   别的模块随后只用那个 prop。改完之后它就不再是共享冲突，而是一份契约。

🔴 **禁止**：为了等一个接口，去改另一个模块的文件；或者把分支停在半路等人。
遇到这类需求 —— **写进报告，然后继续做别的**。

---

## 3. 落地（任意顺序）

```bash
cd "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta"   # 主检出
FORK=ai-remediation-fork

# ① 谁要落地，先自证没越界
node scripts/check-module-boundaries.mjs --module 2 --rev "$FORK"

# ② 体检：主检出脏文件 × 本分支改动文件，交集必须为空
node scripts/check-module-boundaries.mjs --premerge --rev "$FORK"

# ③ 合并（任意顺序）
git checkout main
git merge --no-ff feat/ai-module-2-journey
```

⚠️ **主检出脏的时候不要合并，也不要更新 `main` ref**（`git push . …:main` 这类）——
那正是 §0 里那个 7 文件交集的成因。worktree 模型下主检出本来就该是干净的；
它脏了，说明有人又在里面写代码了，先查清是谁。

---

## 4. 每个模块收工前的自检清单

```bash
cd .worktrees/ai-m2
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

node ../../scripts/check-module-boundaries.mjs --module 2 --rev ai-remediation-fork   # 0 越界
node ../../scripts/check-ui-language.mjs                                  # exit 0
pnpm --filter @heyta/web test                                            # 不低于基线
```

三行都过，才可以喊人合并 —— **不需要等另外两个模块**。
