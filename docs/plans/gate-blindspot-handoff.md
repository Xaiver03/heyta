# 交接：`check:docs` 的 CI 死角 —— 代码已写完，**三条注入验证与提交没跑**

> 状态：🟡 **进行中 —— 只剩"证明它能失败"+"提交"两步**
> 交接日期：**2026-09-30**（CST）
> 给**全新会话**用：不从聊天记录继承任何前提。每条断言都带可复现命令或实测输出。
> 上一轮交接是 [`waytofuture-handoff.md`](waytofuture-handoff.md)（它的 §3 交还的三件事，
> 本轮已完成两件 —— 见下"本轮已完成"）。

---

## 0. 一句话现状

**本轮四项交付里，三项已提交并推送，第四项（四端重装）已跑但两端因环境红。**
唯一**停在半路**的是第 3 项的第二半：`research/tools/docs-link-check.mjs` 里
"登记过的目标在**干净检出上也不存在**"这一格**已经写完、自检已过、门禁已绿**，
但**从未被端到端注入验证过**，而且**还没提交**。

接手要做的就三件事，按序：**注入验证 → 提交 → 交还两个环境前提**。

---

## 1. 本轮已完成（都已提交，`git log --oneline` 可见）

| 项 | 结论 | 提交 |
|---|---|---|
| 1. `e2e/tests/motivation.spec.ts` 两条预存在红 | **前提被证伪**：不是接线断了，是卡片早在 `02fef9a7` 就被收窄成"只在任务视图出现"。阈值判据换成**按视图断言一个真实元素**（`VIEW_ANCHOR` 表 + 两条双向对账断言） | `9ff46dbb` |
| 2. `pnpm verify:i18n-failures` 4/91 红 | **四条全是探针锚点过期，不是产品缺陷**（`packages/i18n` 多入口 + 代码分割后锚点进了 `chunk-*.js`；`packages/ui` 只导出 `dist`）。用例数保持 91，**91/91 exit 0** | `79de664e` |
| 3a. `check:docs`「本机有、仓库里没有」这一半 | 新增 `UNTRACKED_LINK_OK` 登记 + `TRACKED`（`git ls-files`，**拿不到就 exit 1**）+ 三条出路提示 + 未使用登记告警 | `5f68d446` |
| 4. `pnpm reinstall:all` 四端重装 | **android / ios 绿**（截图人已看过）；**mac 红**（缺屏幕录制权限）、**windows 红**（打包机不可达）。按判据如实报红，**没用 `--skip`、没降级** | 未提交（`BLOCKED.md` 第 4 条，见"归属警告"） |
| 文档入档 | 四条结论 + 变异验证表 | `a3db5ff6`（PROGRESS）、`d26b1f3f`（traps） |

---

## 2. 未提交的那一半：它改了什么

文件：**`research/tools/docs-link-check.mjs`**（本轮唯一未提交的代码改动）。

三处：

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

### 已经验证到的程度（实测，2026-09-30）

```bash
node --check research/tools/docs-link-check.mjs     # exit 0
node research/tools/docs-link-check.mjs              # exit 0
```

输出要点（**在本机**）：

```
检查 335 处跨文档章节引用。
检查 54 处页内锚点。
扫描 211 个 Markdown 文件，检查 1352 个相对链接。
ℹ️  「本机有、仓库里没有」已登记 2 条豁免：本机放行 2 条链接、干净检出上缺席放行 0 条。
```

`assertSelfTest()` 第 **(6)** 组**新增 11 行**，把判决表六种结局逐格钉住
（含"【CI 的形状】本机也没有 + 已登记 ⇒ `exempted-absent`"与两格 `SKIP_PATHS`）。
**自检在本机跑过了**（门禁没有打印 `🔴 检查器**自检失败**`）。

**一次没有计划到的现场验证**（交接过程中自己撞上的）：写完本交接文档、把它登记进
`docs/plans/README.md` 之后立刻跑门禁，它**当场把这个新文件本身判红**：

```
🔴 发现 1 处**本机有、仓库里没有**的链接 —— 它们在干净检出（CI 的唯一形态）上是死链：
   docs/plans/README.md:38 -> gate-blindspot-handoff.md
```

⇒ `local-only` 那一半（`5f68d446`）**是端到端有效的**，不只是自检表里的一格。
按门禁给的三条出路选了**①：该入库 ⇒ `git add`**（见 §3.5，本文件与索引行已提交）——
**没有**为了让它变绿去放宽判据或改成纯文字。

⚠️ **但自检只钉住了那张纯函数表** —— `absentExempted` 的**计数与打印**在本机永远是 0，
所以"CI 上从红变绿"这件事**至今没有任何端到端证据**。这就是下一节。

---

## 3. 下一步（有序，三条 A/B 注入 → 提交 → 交还）

🔴 **全部注入在一次性 worktree 里做**，别在真实工作树上加临时死链
（真实树里有**别的会话的未提交改动**，见 §5）。`.worktrees/` 已在 `SKIP_DIRS` 里，
从主检出扫不会扫进去。

### 3.1 注入 ③（最有价值的一条，先跑它）：干净检出上的 A/B

```bash
cd "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta"
git worktree add .worktrees/ci-shape HEAD          # HEAD 里那份脚本仍是 5f68d446 那一版（不含 exempted-absent）
cd .worktrees/ci-shape

# A) 用 HEAD 里那份**旧**脚本跑 ⇒ 必须红，报的是 3 条死链
node research/tools/docs-link-check.mjs; echo "EXIT=$?"

# B) 把工作树上那份**新**脚本盖进去再跑 ⇒ 必须 exit 0，且摘要里「本机也没有」= 3 次
cp ../../research/tools/docs-link-check.mjs research/tools/docs-link-check.mjs
node research/tools/docs-link-check.mjs; echo "EXIT=$?"
```

**预期**：A 红（`docs/operations/icp-app-filing.md` 里 2 条指向
`icp-app-filing.values.local.md` + 1 条指向 `.agents/skills/…/SKILL.md`，
在干净检出上不存在 ⇒ 旧版判成死链）；B 绿并打印
`本机放行 0 条链接、干净检出上缺席放行 2 条` 与两条登记的「本机也没有 2 次 / 1 次」。
**B 绿 + 计数 3 就是"CI 上永远红"被修好的唯一证据。**

### 3.2 注入 ①：未登记的缺席**必须仍是死链**

在上面那个 worktree 里（用新版脚本）往一份**已被跟踪**的文档追加一条指向不存在文件的链接：

```bash
printf '\n[临时注入](does-not-exist-injection-xyz.md)\n' >> docs/reference/environment-traps.md
node research/tools/docs-link-check.mjs; echo "EXIT=$?"     # 必须 1，且出现在「发现 N 个死链」里
```

### 3.3 注入 ②：把那条登记进去 ⇒ 回绿，且缺席计数 +1

```bash
# 在该 worktree 的 research/tools/docs-link-check.mjs 里，往 UNTRACKED_LINK_OK
# 加一条 ['docs/reference/does-not-exist-injection-xyz.md', '注入验证用，稍后删掉']
node research/tools/docs-link-check.mjs; echo "EXIT=$?"     # 必须 0
# 且摘要里该 pattern 显示「本机也没有 1 次」
```

🔴 **两条都要看计数真的变了**，不能只看退出码：只看 exit 0 无法区分
"放行逻辑生效"和"这条链接根本没被扫到"。

### 3.4 收尾

```bash
cd "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta"
git worktree remove --force .worktrees/ci-shape
git worktree list                     # 确认没有残留
pnpm check:docs                       # 主检出的工作树上仍须 exit 0
```

### 3.5 提交与推送

🔴 **只 stage 自己的路径**（本仓库并发开会话，`git add -A` 会把别人的半成品一起带走）：

```bash
git add research/tools/docs-link-check.mjs
git commit -m "feat(check:docs): 登记过的引用在干净检出上不再算死链，并把判决表抽成可自检的纯函数"
git push
```

**本交接文档与 `docs/plans/README.md` 的索引行已单独提交**（写交接的那一轮做的 ——
不提交就正好构成门禁要拦的形状：被跟踪的索引指向一个未跟踪的文件）。
所以**这里只剩脚本一个文件**，它等的就是 §3.1–§3.3 那三条注入的证据。

建议**提交后再补一次 §3.1 的 A**，把 worktree 指向**新 commit**
（`git worktree add .worktrees/ci-shape2 <新 sha>`）—— 那才是 CI 真正会跑的形态。

---

## 4. `pnpm check` 为什么仍不是 exit 0 —— 两件**要用户本人**做的

| # | 卡点 | 症状（实测） | 需要的动作 |
|---|---|---|---|
| 1 | macOS 壳窗口门禁 `check:macos-window` 拿不到屏幕像素 | `screencapture -x` → `could not create image from display` | 给**启动 Qoder 的那个父进程**授予"屏幕录制"权限（系统设置 → 隐私与安全性），换一个有权限的父进程再跑 |
| 2 | Windows 打包机不可达 | `ssh … 10.111.127.237:22: No route to host` | 把 `windows-pc` 接回网络，然后 `pnpm reinstall:desktop` |

🔴 **第 1 条现在"看起来是绿的"是假象，不要当成已解决**：
它 exit 0 只因为**另一个会话**在 `apps/desktop-macos/scripts/capture-window.sh` 与
`scripts/check-macos-window.mjs` 上有一份**未提交**的"响亮跳过"（exit 4）改动。
这两个文件**不是本轮的**，**不要碰、不要提交、不要还原**（见 §5）。

---

## 5. 归属警告（🔴 接手前先读这一段）

主检出里**别的会话正在改**这些路径 —— 不碰、不提交、不还原：

```
BLOCKED.md                                  ← 本轮更新过内容，但**刻意未提交**（同一份文件里有别人的工作）
PROGRESS.md                                 ← 同上；本轮那部分已随 a3db5ff6 提交
apps/desktop-macos/**                       （含 scripts/capture-window.sh、evidence/**）
scripts/check-macos-window.mjs
scripts/verify-web-auth-journey.mjs
e2e/auth-journey/**、e2e/playwright.auth-journey.config.ts
docs/plans/desktop-storage-host-handoff.md
docs/README.md
```

`git status` 当前还额外显示未跟踪的 `e2e/tests/admin-console.spec.ts`、`apps/web/evidence/**` —— **同样不是本轮的**。

**`BLOCKED.md` / `PROGRESS.md` 与本轮相关的结论已经写进去了**：
第 1、2 项标了 ✅（含变异验证表与"前提被证伪"的更正）、第 4 项是新写的四端重装结论。
下一个会话**先读 `BLOCKED.md` 再决定要不要提交它** —— 它承载的是两个会话的内容。

---

## 6. 本机环境的已知故障（会直接影响你能不能干活）

🔴 **Bash / Grep / Glob 三个工具 intermittent 报 `Error: spawn EBADF`**，本轮多次整段不可用。

- **一次成功不代表恢复了** —— 同一条命令紧接着又会失败。判据要用**重试三次**的结果。
- **有效的绕行**：让**子代理**跑命令。实测 `git` 直接调失败 5 次，但
  在 `node -e` 里用 `child_process.execSync` 调同一个 `git` 命令成功（exit 0，输出逐字可用）。
- 不要用 heredoc / 嵌套引号；多行内容走 Write 工具落文件。

---

## 7. 这一轮学到的、已经写进代码或文档的两条（**别重述、别重做**）

1. **"非空白"挡不住错误屏 / 判界面要有界面特征** —— 已入
   [`docs/reference/environment-traps.md`](../reference/environment-traps.md)（§7 第 82 条那一批，`d26b1f3f`）。
2. **e2e 套件不能与自己并发**（固定端口 4317–4319 + 共享 `e2e/test-results/` ⇒ 每次红的是不同 spec）
   —— 同一份 traps 文件里。**结构性门禁红了，先单独重跑那一步再归因。**
   正式修法（per-run 端口与 outputDir）**故意没做**：`e2e/playwright.*.config.ts` 正被另一个会话改。

---

## 8. 验收判据（"接手成功"长什么样）

```bash
# 1) 三条注入的结论都对：③A 红 / ③B 绿且缺席 3 / ① 红 / ② 绿且缺席计数 +1
# 2) 主检出干净树之外不再有未提交的门禁代码
git status --porcelain research/tools/docs-link-check.mjs    # → 空
# 3) 门禁本身
pnpm check:docs        # exit 0
# 4) 本轮那三项已提交的仍然成立
pnpm verify:i18n-failures          # 91/91
cd e2e && npx playwright test tests/motivation.spec.ts   # 7 passed
```

`pnpm check` **整体**是否 exit 0 **不取决于接手会话** —— 它卡在 §4 那两件用户本人的环境动作上。
把这一点如实说清楚，**不要为了让 `pnpm check` 变绿而放宽任何判据**。
