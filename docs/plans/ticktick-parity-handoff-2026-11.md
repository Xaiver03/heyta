# 滴答对标 · 交接文档（2026-11-06）

> 上游：[产品需求对齐清单](ticktick-parity-prd-2026-11.md)（R1–R14）· [取证总目录](../research/ticktick-teardown-index.md)（十条线）。
> 本文回答三件事：**现在谁在做什么**、**接下来按什么顺序开工**、**每个包的交界线在哪**。
> 前任的判错与踩坑都留在那份总目录的 §3 台账里，**先读台账再引用任何数字**。

---

## 0. 一页现状（2026-11-06 20:5x）

| 类别 | 状态 |
|---|---|
| **取证** | ✅ 十条线全部入库：主干 619 行 + P0–P10 九份分册 + 四份决策备忘 |
| **PRD** | ✅ R1–R14 已分档（P0 四条 / P1 六条 / P2 五条 / 明确不做五条） |
| **在飞（三个分包，同一工作树）** | **A**（多账号+撤销+同步可见）：`packages/op-log` · `packages/storage` · `packages/sync-client` · `packages/app-host` · 各壳 `host.ts` · 已出 `docs/adr/0084`（未跟踪）<br>**C-①**（R6 唤出）：`apps/desktop/src` + `renderer` + `tests`（`quick-add.html` / `bridge.ts` / `global-summon` 已出现）<br>**D-①**（R9 暗色 token）：`packages/design-system/src/tokens.css`（+147 行） |
| **待派** | **E**（入口契约）· **B**（任务闭环）· **C-②**（明天视图+设置树）· **D-②**（四态+附件+主题骨架） |
| **远端** | linux-dev 已恢复；qoder 正在跑三单（入口表 20 行 / 入口重复审计 / Windows 设置界面抽条目） |

⚠️ **工作树里现在有 35 个未提交改动，属于三个在飞分包。** 总包（我）只 `git add` 明确路径，**从不 `git add -A`** —— 理由见 [§7 #664](../reference/environment-traps.md)。

---

## 1. 工程排序：我的决定

### 结论

```
W1  E（契约 + 修 4 个已发现的入口缺陷）        ← 只有这一条是"串行前置"
W1  ∥ A 收尾  ∥ C-① 收尾  ∥ D-① 收尾          ← 已在飞，别重开
W2  B（exDates / 手排接通 / 标签页）            ← 等 A 的回滚接口，接口一落就开
W2  ∥ R13b 主题骨架（与 R9 同源，归 D 的人）
W3  C-②（明天视图 + R13a 设置树与「我的」页）
W3  ∥ D-②（四态 + 附件）
W4  R7 同步可见收口 + 全量回归（四端重装）
```

### 为什么这么排（四条理由，按权重）

1. **E 是唯一真串行**：它不写功能，只产出「动作 × 层级 × 主入口」一张表和五条规则。B/C/D 每加一个按钮都要按它放 —— 不先定，就会各发明一套入口，那正是「UX 混乱」的成因。
2. **E 顺手能修掉四个已发现的缺陷**（见 §3）：它们**都在入口层**、都不碰数据语义、都不改 schema，是同一份工作的副产品。**先修这四个，用户能立刻感知"不乱了"**（同一动作两个入口、一端没入口）。
3. **B 必须等 A 的一条接口**：B 的 exDates 与手排都会产生写操作，**先有撤销才敢上**（写错了只能靠回收站捞）。但 A 的 `Task.order` 已存在、`abandon` id 已在共享层 —— 这两件不需要等。
4. **C-②/D-② 必须等 B**：`task-filter.ts` 有 **17 个消费者**（B 要加 exDates 过滤、C-② 要加第八个 kind），`packages/ui` 也重叠。两个包同时改会互相打架。

### 不建议的做法

- ❌ 四个包一起开：`task-filter.ts` 与 `packages/ui` 会立刻冲突，而且我们的门禁抓不住"语义冲突"（只抓得到编译与形状）。
- ❌ 先补功能再理入口：B5（同一动作两个入口）已经存在，再补功能只会加更多入口。

---

## 2. 分包边界（文件主权）

| 包 | 独占路径 | **不许碰** |
|---|---|---|
| **E** 入口契约 | `docs/plans/r14-entry-table.md` · `packages/ui/src/**/row-actions*` · `apps/web/src/features/tasks/TaskRowMenu.tsx` · `apps/web/src/App.tsx`（仅入口相关行） | `packages/domain`、`shared-schema`、`tokens.css`、`apps/desktop*` |
| **A**（在飞） | `packages/{op-log,storage,sync-client,app-host}` · `apps/*/src/host.ts` · `docs/adr/0084` | 同上之外的 UI 入口 |
| **B** | `packages/domain/src/{entities,task-filter,ticktick-import}.ts` · `packages/ui/src/task-list/*` · 标签页相关 | `packages/design-system`、`apps/desktop*` |
| **C-②** | `apps/web/src/features/settings/*` · `apps/web/src/features/shell/*` · `packages/domain/src/task-filter.ts`（**加 kind 前先与 B 对表**） | `tokens.css`、`op-log` |
| **D-②** | `packages/design-system/src/*`（含 `generated/`）· `packages/ui/src` 的状态组件 | `packages/domain`、`apps/desktop*` |

> 两条硬规矩：① **一文件一主权**，越界即打回（[§7 #664](../reference/environment-traps.md)）；② 覆盖别人文件之前**先 `cp` 快照 + `shasum`**。

---

## 3. E 包要顺手修掉的四个缺陷（已复核到代码）

| 编号 | 缺陷 | 证据 | 修法方向 |
|---|---|---|---|
| **B5** | 详情面板开关，**收起态两枚同时在场** | `apps/web/src/App.tsx`：页头那枚 `detail-pane-toggle` 只判 `canToggleDetailPane`；`⋯` 里那枚才判 `!detailColumnShown`；注释 `:3026` 写"让位给助手"但代码没让位 | 二选一：收起态只留 `⋯` 那枚；或页头那枚改成"开关"、`⋯` 删掉 |
| **A1** | 「放弃任务」**web 零入口** | 共享层 `row-actions.ts` 有 `abandon` id、移动端 `icons.tsx:116` 有图标、`grep -rn abandon apps/web/src` = **0** | 按 E 的层级规则补一处主入口（对象层），并登记进入口表 |
| **C2** | **两套行动作词汇表** | 共享层 7 个 id 与 web 行菜单 7 项**只交集 3** | 收敛成一份（共享层为准），web 只做渲染 |
| **C3** | 多选只有完成/删除 | `App.tsx:2811/2865`；而它的批量条是改期/推迟/移清单/优先级/标签 5 个 + 更多 | 按 E 的表补，先补"移清单"与"改期"两项 |

---

## 4. 交接给分包的固定三件套

每个包回来必须带：

1. **计划**（含「这条判据怎么才会红」）；
2. **实现 + 门禁读数**（`pnpm typecheck` / `check:design` / `check:ui-language` / `check:layering` / `check:reachability`，能跑的都跑，贴 exit code）；
3. **「用户能看到什么变化」的验收记录**（截图或 e2e 名 + 读数）。

---

## 5. 现在的风险清单

| 风险 | 现状 | 处置 |
|---|---|---|
| `check:docs` **红** | 全来自 `docs/adr/0084`（A 的在飞草稿）把两个 ADR 文件名猜成标题 | 等 A 修；或用 `0003-multi-platform-strategy.md` / `0048-deletion-four-states-and-the-no-physical-erase-boundary.md` 替它改两行 |
| 三个分包同树改代码 | 35 个未提交文件，路径基本不重叠 | 总包只 add 明确路径；分包各自 commit 前先 `git status` 确认 |
| 取证原料只在 `/tmp` | 不可提交、换机即失 | 需要时重跑（各分册都带复现命令） |
| 远端 qoder 的产出未经复核 | 三单在跑 | 回来后**逐条复核**再入库（Flash 档会编） |

---

## 6. 下一步（谁做什么）

1. **总包**：等 qoder 三单回来 → 复核 → 入口表落成 `docs/plans/r14-entry-table.md`；
2. **E 分包**：按入口表修四个缺陷 + 写五条规则的检查草案；
3. **A 分包**：继续，交付时**必须**把 `docs/adr/0084` 的两处链接改对；
4. **B 分包**：等 A 说"回滚接口可用"再开；
5. **C-②/D-②**：等 B 落地。
