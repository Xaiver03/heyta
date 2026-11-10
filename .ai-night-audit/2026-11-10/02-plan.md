# 02 · 执行计划与检查点

- **选定任务**：G. 文档/实现/产品边界三方对照（加权 4.85，见 `01-selection.md`）
- **预算**：夜间约 6 小时；本文件时间盒合计 ≈ 3.5 小时，留 2.5 小时给深挖与报告
- **输出目录**：`.ai-night-audit/2026-11-10/`（唯一共享目录）

---

## 一、约束（本轮适用）

| 允许 | 禁止 |
|---|---|
| 写 `.ai-night-audit/2026-11-10/` 下任何文件 | 改生产配置、跑迁移、部署 |
| 改 `apps/landing/` 下**已证实的漂移**（用户本轮明确授权修复） | 改 `apps/web/`、`server/`、`packages/shared-schema/` 等真源 |
| 跑只读命令、现有测试、门禁脚本 | 改测试的**期望值**来让红变绿（除非已证明期望值本身过时且方向唯一） |
| 起独立 git 分支 / 在输出目录写复现脚本 | 合并、push、外发数据 |

**修复的前置条件（三条全满足才动手）**：
1. 根因唯一，且能指到某个提交的**明确意图**（不能是"我觉得应该这样"）；
2. 有现成判据能在修完后自证（绿/红）；
3. 不触碰真源文件。

---

## 二、子任务拆解

### T1 · 固化证据（时间盒 20 min）✅ 已完成
- **做什么**：把 4 处漂移的根因、提交号、`apps/landing` 受影响行数固化成可复现命令。
- **检查点**：每条结论都有"能重新跑出来"的命令。
- **验收**：`04-tests/repro-*.sh` 可独立运行并输出与报告一致的结论。

### T2 · 修复漂移 1/4：`web.shell.nav.tomorrow`（时间盒 20 min）
- **改哪**：`apps/landing/src/mockup/app-shell-shape.ts` 的 `SHELL_PRIMARY_NAV`（加一项）
  + `apps/landing/tests/mockup-shell-shape.spec.tsx` 的阳性对照字面清单（跟加一项）。
- **检查点**：`SHELL_PRIMARY_NAV` 与 `PRIMARY_NAV` 逐项同 key 同序。
- **验收**：`#1 主导航` 组全绿。
- **风险**：`AppWindow.tsx` 的注释说"主导航三项"，改完要同步（否则文档又漂）。

### T3 · 修复漂移 2/4：`history-notice` + `manage-tags-open`（时间盒 25 min）
- **改哪**：`SHELL_HEADER_ACTIONS` 的 `anchors` —— 把这两枚挂到**语义正确的登记项**上
  （`history-notice` 是撤销回执 ⇒ 归 `task-menu` 那组还是单列？需先读真应用的位置），
  并同步 spec 的 `webTestids()` 阳性对照字面清单。
- **检查点**：登记处锚点集合 ⇔ 真应用 testid 集合，**双向等集**。
- **验收**：`#7 页头右侧` 组的"双向等集"与"阳性对照"两条绿。

### T4 · 修复漂移 3/4：删 `detail-pane-open`（时间盒 20 min）
- **改哪**：`SHELL_HEADER_ACTIONS` 里 `detail-pane-toggle` 的 `anchors` 去掉 `'detail-pane-open'`，
  并改掉它上面那段现在已经**说谎**的注释（"详情列收起之后展开它的入口在 `⋯` 里"）。
- **检查点**：真应用 `detail-pane-open` 计数 = 0（`829272f8` 已裁决）。
- **验收**：`#7` 双向等集绿。
- **🔴 注意**：这是唯一一处"**删**登记项"的修改。**必须先确认 R14 的裁决没有被后续提交推翻**
  （若后来又把入口加回来了，方向就反了）。验证命令：
  `grep -c "detail-pane-open" apps/web/src/App.tsx` ⇒ 必须为 0。

### T5 · 复刻渲染跟进（时间盒 20 min）
- **做什么**：登记处改完后，`AppWindow.tsx` 画出来的侧栏/页头必须与登记处一致
  （spec 的 `渲染出的侧栏主导航含「已完成」，且登记的每一项都在` 那条会验）。
- **验收**：22 条全绿。

### T6 · 全量回归（时间盒 30 min）
- **做什么**：`apps/landing` 全量 vitest（24 文件 / 1456 条）+ `apps/landing` typecheck。
- **检查点**：1456 passed / 0 failed（当前是 1453/3）。
- **验收**：命令输出留档到 `.run-logs` 或输出目录。

### T7 · 同族深挖：还有没有"已提交但没人对账"的漂移（时间盒 45 min）
- **做什么**：把 `mockup-shell-shape.spec.tsx` 的**对账面**列出来，逐面看有没有
  "真源改了、登记处没跟、且当前判据看不见"的格子。
- **方法**：对每个登记项，`git log -S "<真源符号>" -- apps/web/src` 看最后一次改动
  是否落在 `apps/landing` 之后。
- **验收**：至少给出 1 个结论（有/没有），有则写成 finding。

### T8 · 写产出（时间盒 40 min）
- `03-findings.md`（固定模板）
- `04-tests/`（复现脚本 + 测试草稿）
- `05-morning-report.md`

---

## 三、检查点汇总（可验收）

| # | 检查点 | 命令 | 期望 |
|---|---|---|---|
| CP1 | 漂移 4 处都有提交级证据 | `bash 04-tests/repro-landing-drift.sh` | 4 行 `0`（landing 未同步） |
| CP2 | 修复后 spec 全绿 | `cd apps/landing && npx vitest run tests/mockup-shell-shape.spec.tsx` | 22 passed / 0 failed |
| CP3 | 全量不回归 | `cd apps/landing && npx vitest run` | 1456 passed / 0 failed |
| CP4 | 类型不坏 | `cd apps/landing && npx tsc --noEmit -p tsconfig.spec.json` | rc=0 |
| CP5 | 未触碰真源 | `git status --porcelain apps/web server packages` | 与本轮开始时一致 |

---

## 四、中断与恢复

- 每一步的结论都落到 `03-findings.md` 或 `04-tests/`，**不依赖对话上下文**。
- 若中途被打断：读 `03-findings.md` 的"已完成"标记 + `git diff --stat apps/landing` 即可续跑。
- 修复若未完成：登记处与 spec 的改动是**自洽的一对**，任一时刻停下都不会让情况比现在更糟
  （现在已是红的）。

## 五、并行

本任务规模小（1 个数据文件 + 1 个 spec + 1 个渲染文件），**不派子代理** ——
派发的协调成本高于收益，且共享文件会产生写冲突（本仓 `AGENTS.md` §并发协作 有明训）。
T7 的深挖是纯只读，与 T2–T5 无文件交集，可在修复验证间隙穿插执行。
