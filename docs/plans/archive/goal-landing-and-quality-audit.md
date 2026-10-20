# 本轮 goal：全量落账 + 分支合并 + 代码质量审计

> 状态：**已完成（2026-10-03）**。`2ed84122..0c171df1` 共 82 个提交已推送 `origin/main`
>（含并行会话在同一时段自行提交的部分）；`feat/countdown-anniversary` 已合并进 `main`；
> 验证矩阵 §3 全部实跑，审计发现 §4（2 修 3 登记各带证据）。
> 授权：产品负责人指示——「所有更改按逻辑分组 commit 并 push；所有分支从 worktree 合并到
> 主分支；冲突从产品经理视角（用户旅程完整性）解决；做一次大规模代码质量审计」。

---

## 1. 落了什么

### 1.1 主检出的提交分组（11 + 3 笔）

| 组 | 内容 |
|---|---|
| `chore(scripts)` | 13 个移动端验收脚本与 reinstall-all 补执行位（diff 全为 mode 位，零内容改动） |
| `i18n` | 中英词条同步新增（资料面板 / 日历视图族 / 采集 / 到期编辑），先于消费它们的界面提交 |
| `feat(auth)` | 邮箱验证开关收敛成 `emailVerificationRequired()` 一处 + 无 SMTP 时界面不再说「去查收邮件」（`mailDelivered:false` 语义，缺省 ≠ false 三种「没说」仍走原提示） |
| `feat(account)` | 账号资料（昵称/头像）三端贯通：契约→迁移→store/路由→app-host→ProfilePanel；法务两份清单同步；**B14 登记的 5 条红就此闭合**（e2e 桩 + server 断言随形状更新） |
| `feat(calendar)` | 视图族（月/周档位）+ 共享页头工具条 + 从日历发起采集；样式走 `.ht-header__*` 族与类选择器（内联棘轮不回涨） |
| `feat(due)` / `fix(theme)` / `docs(ai)` | 到期编辑器重排；首启探测的主题不持久化 + 对比度 e2e；ADR-0045 落地情况（两档授权 / 内存会话 / 日历锚点出境） |
| `feat(web)` | 壳接线收口（App.tsx 跨三条线的 import 与滚动聚焦、视图标题来源收敛） |
| `docs` | 台账与计划同步（B14、计划索引、ui-review、环境陷阱）+ 四象限/触控区证据 |
| `chore(licenses)` | 合并后按倒数日分支 §3.5 第 1 条在**主检出**全量重渲染许可证清单（962 → 1093 包） |
| `fix(app-host)` / `fix(web)` | 两处类型潜伤（§4 F1/F2） |

第一笔提交曾把索引里**别的会话早前 staged 的内容**一并带走（mint-login-link 测试删除）。
两个坏提交已软重置孤儿化（未推送过），全部分组重做。之后每组提交前强制核对
`git diff --cached --name-status`。

### 1.2 分支合并

`feat/countdown-anniversary`（5 个提交：历法层 / 「每年」重复 / 节假日数据 / 体积闸门 / 文档）
合并进 `main`。三个 /tmp 探针 worktree（detached）经 `merge-base --is-ancestor` 验证**全部是
main 祖先**，无内容可合并，保持原样未清理（可能被验证脚本复用）。

四处冲突的裁决（产品视角）：

| 文件 | 裁决 | 理由 |
|---|---|---|
| `package.json` | 保留 main 的「build 挪链首」，分支的 `check:calendar`/`check:holiday` 插到 `check:tokens` 之后 | 两边意图正交；链序改动是 main 上有意的提交，历法门禁是分支的交付，都要 |
| `docs/README.md` | ADR-0044 行取分支全行（带链接），ADR-0045 行保留，按时间序共存 | 合并完成那一刻 ADR 已入库，main 侧「尚未进仓库故不作链接」的注脚自动失效 |
| `goal-layout-audit.md` | 取分支版 | 分支带 2026-10-03 的准确状态（批次一已落地、W2/W5/W6 未开工），主检出那行是过期注脚 |
| `environment-traps.md` | main 的 #124–160 全保；分支基于同一基底（#123）编的 #137–140 **重排为 #161–164** | 陷阱「编号只增不改」；重排前 grep 验证分支全树对旧号**零引用** |

合并程序按倒数日分支自己预留的 §3.5 指示执行（三份旧版文档移出主检出、lockfile 落地后
重渲染许可证清单），一处偏离：它建议对 `README.md`/`goal-layout-audit.md` 整文件
`git checkout --`，但那两份此刻还含**其他会话与本文作者**的已提交改动 —— 改为先提交、
让 git 三方合并、只裁真冲突。

---

## 2. 🔴 本轮自己的两次假绿（先于一切发现，照实登记）

两次都栽在同一把耙上（§7 #45「管道后 `$?` 是 tail 的」的现行犯）：

1. **typecheck 假绿**：`pnpm -r typecheck 2>&1 | tail -30` 在 pnpm 不在 PATH 时打出
   `command not found`，而退出码是 `tail` 的 0 —— 我据它宣布过一次「基线全绿」。
2. **后台单测假绿**：后台任务的收尾命令是 `tail`，任务通知报 exit 0，而日志里
   `server test: Failed`、真实 exit 1。

纠正与后果：后续所有验证一律 `set -o pipefail` 或直取被验证命令的退出码；用
`corepack pnpm`（本机 pnpm 的 PATH 项指向空 bin）+ 隔离 worktree 重跑。**合并与提交的
正确性判断全部基于重跑后的真实结果**，此前的假绿没有支撑任何一次「判绿」决定——
但它差点支撑了：这正是元规则第 1 条（先怀疑探针）在自己身上的应验。

---

## 3. 验证矩阵（全部实跑，`/tmp/heyta-mergecheck` 为合并提交的隔离 worktree）

| 验证 | 树 | 结果 |
|---|---|---|
| `pnpm -r build` | 隔离 | ✅ |
| `pnpm -r typecheck` | 隔离 | 🔴→✅ 初跑抓出 F1/F2 两处，修复后 **exit 0** |
| `check:calendar` / `check:holiday`（合并带来的新门禁） | 隔离 | ✅（历法双实现分歧按登记口径取随包；节假日 20 公告年与源一致） |
| `check:layering` / `check:design` / `check:ui-language` / `check:ai-tools` / `check:ai-coverage` / `check:ai-quota` / `check:migrations` / `check:arkts` | 隔离 | ✅ 全部 exit 0 |
| `check:tokens` | 隔离 | 🔴→✅ 初跑红是脚本内部调裸 `pnpm`（F4）；垫片后 ✅（8 文件 201 token 一致） |
| 许可证盘点 + 全量重渲染 | 主检出 | ✅ 1093 包：宽松 1092 / 受限 0 / 白名单外已登记 1 |
| `docs-link-check` | 隔离 | ✅ 无死链、无失效锚点 |
| 全量单测 | 隔离 | server 2064 passed + 其余包全绿；唯一红是 F3（环境依赖，非缺陷） |
| server 套件（含账号资料 27 条） | 主检出 | ✅ 110 文件 / 2091 passed / 1 skipped |
| e2e 浏览器套件 | — | ⚠️ **本轮未跑**。B14 的 e2e 侧闭口（假端点补 `/api/account/profile` 桩）已随提交入库，但离线全量留待下一轮开工前实跑 |

---

## 4. 审计发现（2 已修 / 3 登记）

- **F1 🔴 已修**：`hosted-account-profile.spec.ts` 的测试 helper 用 `Partial<typeof PROFILE>`，
  字面量推断把 `displayName` 收窄成 `string`、`avatarHash` 收窄成 `null` ⇒ 「传 null 清除昵称」
  「传回真实 hash」两个用例在类型上写不出来（TS2322）。运行时一直绿（vitest 不查类型），
  红只在 tsc 下现形。修：覆写类型显式写成线上形状（两个都可空）。
- **F2 🔴 已修**：`calendar-view-family.spec.tsx` 把 `tab ?? undefined` 传给签名
  为 `HTMLElement | null` 的 `click()` —— 绕过了 helper 自带的非空断言。修：传 `null`。
- **F3 🟡 登记（可复现性）**：`server/tests/account-profile.spec.ts` 在加载时要求
  `process.env.JWT_SECRET`，缺失即响亮抛错。主检出（有 gitignore 的 `server/.env`）全绿，
  **干净检出上 server 套件 1 红**。方向是对的（拒绝静默假跑），但把「测试基建自足」破了：
  其余 109 个套件不依赖它也成立。修法建议：setup 链给测试缺省 secret，或该 spec 显式
  `??` 一个测试值并注释为什么它不削弱断言。
- **F4 🟡 登记（环境假红）**：`check:tokens`（design-system 的 generate:check）内部以裸
  `pnpm` 起子进程 —— 在「pnpm 不在 PATH、靠 corepack 直调」的环境里以 command-not-found 红，
  症状与「token 漂移」不可区分。修法建议：子进程继承父进程的 pnpm 解析（或文档注明前提）。
- **F5 🔴 方法论（不改代码，改流程）**：§2 的两次假绿。「后台/管道任务的 exit 0 必须来自
  被验证的那条命令」这一判据，建议按仓库惯例补进 environment-traps（编号递增、追加正文）；
  本文暂缓直写 traps —— 该文件此刻有并行会话的未提交改动，避免在同一区域相撞。
- **F6 ✅ 正面（审计结论，不只是挑错）**：账号资料的服务端面（五条路由）质量很高：
  身份一律取自令牌（不存在「查别人资料」的那条路）、逐路由限流、服务端是校验唯一裁决者、
  头像复用同步通道的 E2EE 形状闸门而不另写一份、hash 由服务端独算、幂等删除用
  `deleteMany`、迁移注释把「昵称为何明文 / 头像为何密文 / 为什么没有 multipart」的
  产品裁决逐条写全。合并缝（门禁链序、陷阱重排）经隔离树全量验证无回归。

---

## 5. 已知边界（别读多）

- **并行会话的未提交改动不在本轮范围**：本轮期间有会话在同一工作树持续写入
  （日历日板 `CalendarDayBoard` 等）并自行提交（`c444d827` 等已随本轮推送）。
  处置原则：不动别人的现场；自己的合并正确性在**隔离 worktree**验证
  （`git worktree add` 到合并提交，主树照常被别人写）。这个手法本轮首次成型，可复用。
- **`pnpm reinstall:all` 未跑**：本轮改了 `packages/*`（domain/ui/app-host/shared-schema/i18n），
  按固定收尾流程，各端下次开工前先重装，否则验收的是旧 bundle。
- **e2e 浏览器套件未实跑**（见 §3 末行）。
- 三个 /tmp 探针 worktree 未清理（均为 main 祖先，无未合并内容）。
- 倒数日 worktree（`heyta-wt-countdown`）与分支保留未删：批次二尚未开工，那是它的现场。
