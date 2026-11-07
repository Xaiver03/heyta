# 会话交接 · 2026-11-07（滴答对标 + 逆向两条线）

> 这份文档的目标：**一个没有上下文的人，读完能接着干**。
> 事实与推测分开写；每条"没做完"都带**入口**（文件 / 命令 / 提交号），不带"我以为"。
> 配套：**反思索引** [`session-reflection-2026-11-07.md`](session-reflection-2026-11-07.md)（20 条被纠正的判断 + 三条稳定模式）。
> 上游：[PRD](ticktick-parity-prd-2026-11.md) · [交接（滴答对标线，逐包状态）](ticktick-parity-handoff-2026-11.md) ·
> [取证总目录（十条线 + 勘误台账）](../research/ticktick-teardown-index.md) · [入口账本（41 行）](r14-entry-table.md)

---

## 0. 一句话现状

- **代码线**：14 笔提交已入库，工作树 **0 未提交**；`pnpm typecheck` rc=0、`apps/web` **2751 通过 / 0 失败**、
  12 道门禁 rc=0，**唯一红是 `check:l4`（已登记既有债 `BLOCKED.md` B274）**。
- **逆向线**：十册取证已入库；本轮又用"BAML→XAML 之后能读的东西"重答了 4 条未核实里的 2 条，
  **剩 3 条未判定**（见 §3）。
- **两条线都还有活**，清单在 §2、§3。

---

## 1. 已完成并入库（这批的完整清单）

| # | 是什么 | 提交 |
|---|---|---|
| 1 | **E** 入口契约：41 行账本 + `scripts/check-entry-table.mjs`（11 条规则 / 9 臂自检） | `a7d19e36c` |
| 2 | **A** 数据可信：本机库归属唯一账号 / 登出即销毁 / 撤销栈 / 同步可见 | `6828dd820` |
| 3 | **D-①** 暗色 token 族（`--ht-ink-*` + 语义色阶提亮档） | `cd5f79563` |
| 4 | **C-①** 全局唤出（托盘 + 热键 + 快速添加面板） | `9062659c0` |
| 5 | **B** 任务操作闭环：跳过这一次 / 手动排序接通 / 标签管理页 / 字段单点收敛 | `8cd8f8d1e` |
| 6 | **A 的四条边界证据**：待上传>0 真浏览器 / 归属红条 / `rejected` 计数 / R5 现量 | `395c7db86` |
| 7 | **R10「明天」智能清单**：领域一档 + 侧栏一行，不新开 `ViewKey` | `e3c25e6c0` |
| 8 | 侧栏标签计数改用合并别名解析（合并后数字不再偏低） | `32b54097d` |
| 9 | 五份 spec 的 oplog 替身补 `onEngineChange` | `5a478005c` |
| 10 | `check:row-single-source` 收族（29→28，**没抬基线**） | `3d44e4972` |
| 11 | `check:ratchet-ceilings` 修探针 + 进链 + 给"合法的涨"开登记路 | `fd8847610` |
| 12 | 五份 locator/口径类文档与陷阱 #665–#672 | `1e8121d3c` … `7537f725d` |
| 13 | 客户端持久化键登记表 + `check:persistence-keys` | `f3b46be3e` |
| 14 | ADR-0085（外观零 op）+ C-②/D-② 工单 | `1e5dd78d7` / `940…` → 见 `git log` |

> 每一笔的提交信息里都写了**判据怎么才会红**与**现量读数**。要复核某一条：
> `git show <sha> --stat` + 提交正文。

---

## 2. 未完成的**用户需求**（逐条，按"能不能马上干"排）

### 2.1 可以马上开工的两包（工单已就绪）

| 需求 | 现状 | 入口 |
|---|---|---|
| **设置树重排 + 「我的」页**（R13a） | ❌ 没做。要做的是按 ADR-0085 把「个性化」与「行为默认值」分成两个分区，并保证**任意设置项两级内可达**；「我的」页**第一位是身份、最后两位是版本/退出**，**统计与会员解耦**（不照抄它把钱排第 2） | [`c2-d2-work-orders-2026-11.md`](c2-d2-work-orders-2026-11.md) §1② + §3 |
| **四态 + 附件 + 主题/字号/行着色**（D-②） | ❌ 没做。R11 空态**按容器分档**（不居中/居中/卡片/纯文字四形态）；加载"条数未知=骨架、已知=行内转圈"；**补一个错误层**（今天两端都没有）。R5 附件零件齐备、UI 引用 0。R13b 主题系统按 ADR-0085 走"本机零 op"，加键要登记 | 同上 §1③ + §3 |

### 2.2 需要一个决定或一台机器

| 需求 | 卡在哪 | 入口 |
|---|---|---|
| **看板重建在 `TaskRow` 上**（唯一红门禁的正解） | `check:l4` 78>74，4 处全在 `features/kanban/KanbanView.tsx`。**正确修法是一次修四笔**（内联样式 / 选中立场 / 键盘光标 / 样式族），净增 0；搬 CSS 或抬基线都是假修 | `BLOCKED.md` **B274** |
| **移动端设备腿**（A 包验收 §三 的缺口④） | 要真模拟器 + 真服务端 + **安静机器**。前置条件三条已写死 | 工单 §5 第 2 条 |
| **`rejected` 行永不清除** | `markRejected` 只改状态不删行 ⇒ "待上传"这个数**单调不减**，用户永远看到 N 项没出口。要"丢弃被拒 op / 按服务端状态重建"的语义，是产品决定 | A 证据报告 §9.1（见 `git show 395c7db86`） |
| **标签合并剩下的读点** | 侧栏两处已修（`32b54097d`）；仍**没接**：`packages/local-api`（AI/MCP 出口与导出仍吐原始 id）、`apps/mobile`/`apps/desktop` 的 `filterTasks` 没传 `context.tags` | [`package-b-2026-11.md`](package-b-2026-11.md) §7 第 3 条 |
| **四端重装** | 这一轮动了 desktop 主进程、tokens、domain 写路径 ⇒ **不重装等于没交付** | `pnpm reinstall:all`（见 `docs/agents/multi-end-build.md`） |

### 2.3 本轮**明确没做**（不是遗漏，是没时间）

- C-② 与 D-② 两个包**没有开工**（单包要几小时，20/25 轮时判断"开了只能留半成品"）。
- 移动端设备腿。

---

## 3. 逆向（RAEA）覆盖率：哪些问过、哪些没问过、结论是什么

**总目录**：[`ticktick-teardown-index.md`](../research/ticktick-teardown-index.md)（十条线 P0–P10 + §3 **勘误台账 11 条** + §4 未核实 + §6 引用纪律）。
🔴 **引用任何数字前先读 §3 台账** —— 那里面 11 条都是"当时读错、后来被否证"的。

### 3.1 已闭环（有独立分册 + 可复现命令）

| 线 | 覆盖什么 | 分册 |
|---|---|---|
| P0 | BAML→XAML 通道（639→638） | `ticktick-baml-xaml-pipeline.md` |
| P1 | 设计系统双端对照（215 个色键 / 字阶 / DIP↔pt） | `ticktick-design-parity.md` |
| P2 | 界面地图 79 行（heyta 有 47 / 半有 11 / 无 21） | `ticktick-surface-matrix.md` |
| P3 | 数据模型 43 行实体对照 | `ticktick-data-model-parity.md` |
| P4 | 同步与冲突 16 问（`conflict` 在 143,939 条文案里 **0 命中**） | `ticktick-sync-questions.md` |
| P5 | 键盘与菜单（62 = 7 bar + 55 leaves；**29 个业务项 0 键**） | `ticktick-keyboard-and-menus.md` |
| P6 | 文案语气画像（AI 真值 119，267 是子串伪影） | `ticktick-copy-tone.md` |
| P7 | 四态与反馈（哑铃形摩擦 / 无错误层 / 无 popconfirm 档） | `ticktick-states-and-feedback.md` |
| P9 | 设置与个性化（18 节 / 8 维） | `ticktick-settings-and-personalization.md` |
| — | UX/IA 入口链路（4 层 + J1–J6 规则） | `ticktick-ux-ia-and-entry-paths.md` |

### 3.2 本轮**新答**的两条（`docs/research/ticktick-windows-inventory-2026-11.md`）

1. **Windows 顶层导航与 macOS 的 13 项不同构 —— 那一问问错了。**
   现量：`mainwindow.xaml` 只有 7 组视图区句柄（清单/日历/专注/习惯/四象限/倒数日/AI），
   顶层导航在 `tabbar/leftmenubar.xaml`，图标型、工具项贴底（同步/通知/帮助/更多）。
   ⇒ Windows 是"一主窗宿主 7 视图 + 一条图标菜单"，**没有 13 项平级导航的对应物**。
2. **Windows 空态不是缺文件。** 全包 `find -iname "*empty*"` 只命中 3 个 + `project/emptyprojectcontrol.xaml`；
   空态由 `misc/emptyimage` + `resource/emptyicons` + 各模块自己的空控件组成，**没有** `EmptyView` 这个东西。

**顺带纠正两个旧数**（口径都写在那份文档 §4）：Windows 语言文件 **46 个 → 去重 43 个语言码**（P6 的 41 是另一个尺）；
主题**调色板 61 个得到证实**，而预览卡 XAML 只有 **16** 个（"28 张预览"若成立，多半是运行时用 16 个模板生成 —— **待重新取证**，别把 16 当反证）。

### 3.3 **仍未判定**（3 条，都写清了卡点）

| 未核实 | 卡点 | 下一步是不是可执行 |
|---|---|---|
| **Windows 文案**（46 份 `stringresource/*.xaml` 全空） | 转换器只解了 BAML 主树，**没解 deferred 资源流**（`DeferrableContent="<!--deferred-stream:NNNNB-->"`）。文案全在里面 | ✅ **可执行**：在 `scripts/ticktick/baml-to-xaml.ps1` 里对 `DeferrableContent` 复用同一套解析器。做完 Windows 侧文案统计才成立（现在 P6 只有 macOS 读数） |
| **Windows 本地库表结构** | `sqlite-net` 走反射、**无可读 DDL**；要它跑起来才有库。P3 那 43 行是从**模型类**推的 | ⚠️ 要一台能跑滴答的 Windows + 登录后 dump |
| **`KotlinMultiplatformAll` 的同步语义** | native、符号剥离，只剩字符串 | ⛔ 本轮无新证据，**未判定** |

### 3.4 还没人问过、但值得问的（我列的候选，不是承诺）

- **提醒的调度语义**：什么条件下补发、错过窗口怎么办（heyta 有提醒投递，但"错过"这一档没对照过）。
- **导入/导出格式**：它的 `.csv` / 备份包字段与我们的导入器差在哪（`ticktick-import.ts` 已读 `Order` 列，其余未对表）。
- **搜索的匹配规则**：分词/前缀/拼音首字母（heyta 的搜索是另一套）。
- **习惯与番茄的统计口径**：连续天数怎么断、补打卡窗口多大（heyta 有 `habit-backfill`，但没和它对照过）。

---

## 4. 验证状态（怎么复核这批）

```bash
cd <repo>
git log --oneline -15            # 14 笔提交
pnpm typecheck                   # rc=0
pnpm --filter @heyta/domain --filter @heyta/app-host --filter @heyta/storage \
     --filter @heyta/shared-schema --filter @heyta/ui test   # 1233 / 2106 / 431 / 191 / 897
cd apps/web && npx vitest run    # 2751 passed / 0 failed
pnpm check:entry-table && pnpm check:row-single-source && pnpm check:control-semantics \
  && pnpm check:ratchet-ceilings && pnpm check:persistence-keys && pnpm check:ui-language \
  && pnpm check:layering && pnpm check:design && pnpm check:docs \
  && pnpm check:traps-index-coverage && pnpm check:e2e-specs-parse   # 逐条 rc=0
pnpm check:l4                    # 🔴 rc=1，78>74，全部是 KanbanView（B274 既有债）
```

**真浏览器腿**（真服务端 + 真浏览器，跑在**挪开的端口槽**上，别占默认 4318）：
```bash
cd e2e
HEYTA_E2E_APP_PORT=4428 HEYTA_E2E_STUB_PORT=4429 npx playwright test \
  tests/r5-entry-depth.spec.ts tests/signout-owner-notice.spec.ts      # 5 + 2 passed
```

---

## 5. 交接时必须知道的坑（都是这一轮踩出来的）

1. **`apps/web` 读的是各 workspace 包的构建产物类型**（`dist/*.d.cts`）。
   改了 `@heyta/domain` / `@heyta/i18n` / `@heyta/ui` 的**签名或联合成员**，必须
   `pnpm --filter <pkg> build`，否则 web 侧报 `Expected 1 arguments` / 类型不可赋值 —— 而源码看着是对的。
2. **给 `TaskFilter` 加一档会逼所有 switch 表态**（`isActive` 那次就是 `pnpm typecheck` 抓的）。这是好事，别绕过。
3. **`git checkout -- <file>` 会连未提交的改动一起回滚**。变异测试前先 `cp` 备份（我这一轮漏了一次，把"明天"入口回滚掉了）。
4. **入口表用 `文件:行号（锚点）`**：改任何被引用的文件都会让行号漂，`check:entry-table` 会红。
   修法不是手改 —— 写个脚本按锚点重定位（本轮那 19 处就是这么修的）。
5. **`pnpm check:docs` 会因为"链接指向未跟踪文件"红**：新增文档先 `git add` 再引它。
6. **`packages/i18n` 是单对象字面量**：两个包同时加键会静默互吃（`check:ui-language` 只数条数相等，数量一样它绿）。**串行写入**。
7. **跑单测别看单包绿就收工**：改共享模块的**导出面**（模块顶层调用也算）之后要跑一次 `apps/web` 全量，
   否则那种红长得像"这些 spec 过时了"（`5a478005c` 就是）。
8. **e2e spec 的语法错 `pnpm typecheck` 看不见**，用 `check:e2e-specs-parse`（我提交过一份带重复声明的 spec，只有它抓得到）。

---

## 6. 下一会话建议的第一件事（按序）

1. `git log --oneline -15` + 读 [`ticktick-parity-handoff-2026-11.md`](ticktick-parity-handoff-2026-11.md) §0（它写的"就剩一格半"与本文一致）。
2. **`BLOCKED.md` B274**：看板重建在 `TaskRow` 上（一次修四笔，修完 `check:l4` 与 `check:row-single-source` 同时绿、族数仍 33）。
3. 按 [`c2-d2-work-orders-2026-11.md`](c2-d2-work-orders-2026-11.md) 发 **R13a** 与 **D-②** 两个包（文件边界已切好，三处分歧已拍板）。
4. 想要 Windows 文案画像 ⇒ 解 deferred stream（§3.3 第一行，可执行）。
