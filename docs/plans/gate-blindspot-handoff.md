# 交接：`check:docs` 的 CI 死角 —— **已闭合**，本文件转为历史

> 状态：🟢 **本轮四项交付全部处理完**（第 4 项两端因**环境**如实报红，见 §4 —— 那两件要用户本人做）
> 交接日期：**2026-09-30**（CST）
> 给**全新会话**用：不从聊天记录继承任何前提。每条断言都带可复现命令或实测输出。
> 上一轮交接是 [`waytofuture-handoff.md`](waytofuture-handoff.md)（它 §3 交还的三件事，
> 本轮完成了两件；第三件「ICP 备案提交」仍等用户本人）。
>
> ⚠️ **本文件原先写的是"注入验证与提交留给下一会话"。那句话已经过期了** ——
> 它在本轮就被同一个会话做完并推送（`82535fff`）。留这个说明是因为
> "交接文档写着自己没做完、而其实做完了"正是本仓库反复出现的那类漂移。

---

## 0. 一句话现状

**四项交付全部落地：**

| 项 | 结论 |
|---|---|
| 1 `motivation.spec.ts` 两条预存在红 | ✅ 已修 + 变异验证，`9ff46dbb` |
| 2 `verify:i18n-failures` 4/91 红 | ✅ 四条全是探针锚点过期，91/91，`79de664e` |
| 3 `check:docs` 的干净检出死角 | ✅ `5f68d446` + `82535fff`，**5 条端到端注入证据在 §3** |
| 4 `pnpm reinstall:all` 四端重装 | 🟡 android / ios 绿（截图人已看）；**mac / windows 红，卡的是两件用户本人的环境动作**（§4） |

`pnpm check` **整体仍不是 exit 0**，而且**不取决于代码** —— 见 §4 第一条那个"看起来是绿的"假象。

---

## 1. 本轮已完成（都已提交）

| 项 | 结论 | 提交 |
|---|---|---|
| 1. `e2e/tests/motivation.spec.ts` 两条预存在红 | **前提被证伪**：不是接线断了，是卡片早在 `02fef9a7` 就被收窄成"只在任务视图出现"。阈值判据换成**按视图断言一个真实元素**（`VIEW_ANCHOR` 表 + 两条双向对账断言） | `9ff46dbb` |
| 2. `pnpm verify:i18n-failures` 4/91 红 | **四条全是探针锚点过期，不是产品缺陷**（`packages/i18n` 多入口 + 代码分割后锚点进了 `chunk-*.js`；`packages/ui` 只导出 `dist`）。用例数保持 91，**91/91 exit 0** | `79de664e` |
| 3a. `check:docs`「本机有、仓库里没有」这一半 | 新增 `UNTRACKED_LINK_OK` 登记 + `TRACKED`（`git ls-files`，**拿不到就 exit 1**）+ 三条出路提示 + 未使用登记告警 | `5f68d446` |
| 3b. `check:docs` 的 **CI 形状**（`exempted-absent`） | 判决表抽成纯函数 `classifyLink`（六种结局）+ 缺席豁免单独计数并打印。**5 条注入全跑过** | `82535fff` |
| 3c. 登记理由**自己写错了**，收窄 | `.agents/skills/` 整目录前缀 → 只登记 `.gitignore` 逐条拦住的**那一条** skill。理由从"仓库里从来不放"（**假的**）改成实测形状。详见 §2.4 | 与本文件同批 |
| 4. `pnpm reinstall:all` 四端重装 | **android / ios 绿**（截图人已看过）；**mac 红**（缺屏幕录制权限）、**windows 红**（打包机不可达）。按判据如实报红，**没用 `--skip`、没降级** | 结论写进 `BLOCKED.md`，已随 `d16e1bff` 提交 |
| 文档入档 | 四条结论 + 变异验证表 | `a3db5ff6`（PROGRESS）、`d26b1f3f`（traps） |

---

## 2. 第 3 项到底改了什么

文件：**`research/tools/docs-link-check.mjs`**（本轮唯一的代码改动，已全部提交）。

### 2.1 三处结构改动

1. **`classifyLink({ exists, isDirectory, docTracked, targetTracked, inSkipPath, hasExemption })`**
   —— 把散在 `if (existsSync) … else …` 两支里的判断抽成**纯函数**，返回六种结局之一：
   `skip` / `ok` / `broken` / `local-only` / `exempted` / `exempted-absent`。
   扫描循环现在**只对这一个判决做分派**（原来同一个判断写了两遍 —— 本仓库的漂移都是从这个形状开始的）。
2. **`exempted-absent`（这轮真正的新增）**：命中 `UNTRACKED_LINK_OK` 且**本机也不存在**的链接，
   不再算死链，单独计数进 `absentExempted`。
   🔴 **没有它，第 3 项等于只修了一半**：`5f68d446` 的登记只覆盖"本机有"的形状，
   而**干净检出（= CI 的唯一形态）上那些目标根本不存在** ⇒ 照样掉进 `broken`
   ⇒ `check:docs` 在 CI 上**永远红**。
3. **`SKIP_PATHS` 现在两侧都认**（原来只在"本机没有"那一支认）。
   不这么改会**误报**：本机恰好 clone 过 `research/upstream/` 时，指向其中文件的链接
   会掉进新加的 `local-only`。

### 2.2 一次没有计划到的现场验证（写交接文档时自己撞上的）

写完本交接文档、把它登记进 `docs/plans/README.md` 之后立刻跑门禁，它**当场把这个新文件本身判红**：

```
🔴 发现 1 处**本机有、仓库里没有**的链接 —— 它们在干净检出（CI 的唯一形态）上是死链：
   docs/plans/README.md:38 -> gate-blindspot-handoff.md
```

⇒ `local-only` 那一半（`5f68d446`）**是端到端有效的**，不只是自检表里的一格。
按门禁给的三条出路选了**①：该入库 ⇒ `git add`** —— **没有**为了让它变绿去放宽判据或改成纯文字。

### 2.3 🔴 又一次现场验证：门禁抓到了**我自己登记的理由是假的**

收窄这一条不是优化，是**被实测推翻后的更正**。原登记写的是：

> `.agents/skills/` —— 每台机器自己安装的本地 agent skill 目录，**仓库里从来不放**

在一次性 worktree（= 干净检出）里核对时，`ls .agents` **返回 YES**。查下去：

| 事实 | 证据 |
|---|---|
| 仓库**确实跟踪了**一条 `.agents/skills/` 下的软链 | `git ls-files -s .agents` ⇒ `120000 … .agents/skills/cac-algorithm-filing` |
| 那条软链在干净检出上是**断的** | 它指向 `../../../ssos/.agents/skills/cac-algorithm-filing`（**另一个项目**） |
| `.gitignore` 自己承认了这件事 | 那节注释写明 `cac-algorithm-filing` 是"早先已跟踪的同形状软链，这条规则对它**无效**"，要清需要 `git rm --cached` |

⇒ "仓库里从来不放"这句话**是假的**，而登记的理由必须是**真的**（这是 §3.2 许可证 `REVIEWED_OTHER`
同一套手法的前提：登记的**内容**承重，不成立就等于没登记）。
同时 `.agents/skills/` 这个**整目录前缀**也太宽 —— 与本文件声明的标准
（"范围尽量窄，宽到 `docs/` 那种等于把这一半检查关掉"）自相矛盾。

**改成**：只登记 `.gitignore` 逐条拦住的那一条 ——
`.agents/skills/tencent-cloud-icp-app-filing/`，理由写实测形状（指向仓库外另一个项目的本机软链，
提交进去对所有克隆者都是死链）。**后果是刻意的**：以后链接到别的 skill 要**新登记一条**。

### 2.4 收窄不是纸面收紧 —— 它当场就能失败（注入 ⑤）

在同一个干净检出里，往一份**已跟踪**文档追加一条链接指向**同目录但没登记**的另一条 skill
（`.agents/skills/huawei-agc/SKILL.md`，它在 `.gitignore` 里、干净检出上不存在）：

```
EXIT_narrow_inject=1     🔴 发现 1 个死链
```

**用原来的整目录前缀，这条会被静默放行。** 所以收窄真的多拦住了东西，不是改个说法。

---

## 3. 五条注入的实测结果（这就是"它能失败"的证据）

🔴 **全部在一次性 worktree 里做**，不在真实工作树上加临时死链
（真实树里有**别的会话的未提交改动**，见 §5）。`.worktrees/` 已在 `SKIP_DIRS` 里，从主检出扫不会扫进去。

复现（本轮实际跑的命令）：

```bash
cd "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta"
git worktree add --detach .worktrees/ci-shape <sha>
cd .worktrees/ci-shape
node research/tools/docs-link-check.mjs > /tmp/x.txt 2>&1; echo "EXIT=$?"; cat /tmp/x.txt
cd ../.. && git worktree remove --force .worktrees/ci-shape
```

| # | 注入 | 结果（实测） |
|---|---|---|
| ③A | 指向**旧**脚本所在 commit（`5f68d446` 那一版，不含 `exempted-absent`）的干净检出 | **EXIT=1**，`发现 3 个死链`：`docs/operations/icp-app-filing.md:9`（`../../.agents/skills/tencent-cloud-icp-app-filing/SKILL.md`）、`:65` 与 `:270`（`icp-app-filing.values.local.md`）。⇒ 死角确实存在，不是想象出来的 |
| ③B | 同一个干净检出，换上**新**脚本 | **EXIT=0**，摘要 `本机放行 0 条链接、干净检出上缺席放行 2 条`，明细两条分别 `本机也没有 2 次` / `1 次` ⇒ **合计 3，与 ③A 报的 3 条逐条对上**。"CI 上永远红"被修好 |
| ① | 干净检出里往已跟踪文档追加一条**未登记**的缺席链接 | **EXIT=1**，`发现 1 个死链` ⇒ 查不到 ≠ 放行 |
| ② | 再把那条路径**登记进去** | **EXIT=0**，摘要 `已登记 3 条豁免 … 缺席放行 3 条`，注入的那条显示 `本机也没有 1 次` ⇒ **计数与打印也接上了**，不只是纯函数表里的一格 |
| ⑤ | 收窄登记范围后，链接到**同目录未登记**的另一条 skill | **EXIT=1**，`发现 1 个死链`（见 §2.4）⇒ 收窄是实质收紧 |

🔴 ③B/② 都**同时看了计数变化** —— 只看 exit 码无法区分"放行逻辑生效"和"这条链接根本没被扫到"。

**提交后的字节再验一次**（本轮最后跑的就是这条，`82535fff` 已推送）：

```bash
git worktree add --detach .worktrees/ci-shape2 82535fff
cd .worktrees/ci-shape2 && node research/tools/docs-link-check.mjs    # → EXIT=0，缺席放行 2 条
```

⇒ **CI 真正会跑的那份字节**是绿的。主检出（本机有那两个目标）同样 exit 0，
摘要走的是另一半：`本机放行 2 条链接、干净检出上缺席放行 0 条`。

---

## 4. `pnpm check` 为什么仍不是 exit 0 —— 两件**要用户本人**做的

| # | 卡点 | 症状（实测） | 需要的动作 |
|---|---|---|---|
| 1 | macOS 壳窗口门禁 `check:macos-window` 拿不到屏幕像素 | `screencapture -x` → `could not create image from display` | 给**启动 Qoder 的那个父进程**授予"屏幕录制"权限（系统设置 → 隐私与安全性），换一个有权限的父进程再跑 |
| 2 | Windows 打包机不可达 | `ssh … 10.111.127.237:22: No route to host` | 把 `windows-pc` 接回网络，然后 `pnpm reinstall:desktop` |

⚠️ **第 1 条现在"看起来是绿的"可能是假象**：`check:macos-window` 会 exit 0，如果它走的是
"响亮跳过"（exit 4）那条分支，而不是真的取到了像素。本轮它依赖的是**另一个会话**的改动
（`apps/desktop-macos/scripts/capture-window.sh`、`scripts/check-macos-window.mjs`、
`112e3fd7`）。**这两个文件不是本轮的，不要碰、不要提交、不要还原。**

---

## 5. 归属警告（🔴 接手前先读这一段）

本轮**只提交过**这些路径：`e2e/tests/motivation.spec.ts` 与相关判据、`scripts/verify-i18n-failures.mjs`
与 `packages/*/tests/*`（第 2 项）、`research/tools/docs-link-check.mjs`（第 3 项）、
本文件、`docs/reference/environment-traps.md`、`PROGRESS.md` 与 `BLOCKED.md` 中本轮那部分。

**别的会话正在改**这些路径 —— 不碰、不提交、不还原：

```
apps/desktop-macos/**                       （含 scripts/capture-window.sh、evidence/**）
scripts/check-macos-window.mjs
scripts/verify-web-auth-journey.mjs
e2e/auth-journey/**、e2e/playwright.auth-journey.config.ts
docs/plans/desktop-storage-host-handoff.md
docs/README.md
PROGRESS.md                                 ← 本轮结论已写进去，但**仍未提交**（同一份文件里有别人的工作）
```

本轮结束时状态已变化：`BLOCKED.md`、`docs/plans/README.md`（含本文件的索引行）
由并发会话随 `d16e1bff` **一起提交了** —— 这是本仓库**共享同一个工作树与分支**的直接后果。
🔴 **规则不变**：只 `git add` 自己的路径，**永远不要 `git add -A`**。

---

## 6. 本机环境的已知故障（会直接影响你能不能干活）

🔴 **Bash / Grep / Glob 三个工具 intermittent 报 `Error: spawn EBADF`**，本轮多次整段不可用。

- **一次成功不代表恢复了** —— 同一条命令紧接着又会失败。判据要用**重试三次**的结果。
- **有效的绕行**：让**子代理**跑命令。实测 `git` 直接调失败 5 次，但
  在 `node -e` 里用 `child_process.execSync` 调同一个 `git` 命令成功（exit 0，输出逐字可用）。
- 不要用 heredoc / 嵌套引号；多行内容走 Write 工具落文件。
- zsh 里 `${PIPESTATUS[0]}` 取不到值 ⇒ 用 `cmd > /tmp/x.txt 2>&1; echo "EXIT=$?"`。

---

## 7. 这一轮学到的、已经写进代码或文档的两条（**别重述、别重做**）

1. **"非空白"挡不住错误屏 / 判界面要有界面特征** —— 已入
   [`docs/reference/environment-traps.md`](../reference/environment-traps.md)（§7 第 82 条那一批，`d26b1f3f`）。
2. **e2e 套件不能与自己并发**（固定端口 4317–4319 + 共享 `e2e/test-results/` ⇒ 每次红的是不同 spec）
   —— 同一份 traps 文件里。**结构性门禁红了，先单独重跑那一步再归因。**

---

## 8. 验收判据（"现在长什么样"）

```bash
node research/tools/docs-link-check.mjs          # exit 0（主检出：本机放行 2 / 缺席 0）
pnpm verify:i18n-failures                        # 91/91
cd e2e && npx playwright test tests/motivation.spec.ts   # 7 passed
git status --porcelain research/tools/docs-link-check.mjs docs/plans/gate-blindspot-handoff.md   # → 空
```

要**再证明一次这个门禁能失败**，不要重跑 §3 全部 —— 单条 ①（往已跟踪文档塞一条不存在的链接）
就够，因为①走的分支最窄、最容易回归。

`pnpm check` **整体**是否 exit 0 **不取决于代码会话** —— 它卡在 §4 那两件用户本人的环境动作上。
把这一点如实说清楚，**不要为了让 `pnpm check` 变绿而放宽任何判据**。
