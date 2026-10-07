# 产品 UI / UX / IA 优化计划

> 状态：**代码、文档、Web 证据与四端重装验收完成**（2026-10-06）  
> 依据：[`../research/product-level-ia-ux-audit.md`](../research/product-level-ia-ux-audit.md)（合并裁决稿）；补充基线：[`../research/product-ux-ia-aesthetic-audit.md`](../research/product-ux-ia-aesthetic-audit.md)  
> 目标：把产品从“功能面过宽的精致后台”收敛成“本地优先、执行优先的任务工作台”。

## 0. 执行原则

1. 先修主路径，再修装饰。
2. 不新增一级模块，不做全局玻璃化。
3. 每个交互规则只有一个产品事实源；文档、代码、截图必须指向同一模型。
4. 每批改动都要有截图或可重复的交互证据，不能只看类型检查。
5. 与当前工作树中的其他改动隔离；不覆盖无关文件。

## 1. 目标 IA

### 一级目的地

任务、日历、习惯、搜索常驻；专注是可在设置中开启的高级目的地，开启后从“更多”进入。

### 任务范围

收集箱、今天、最近 7 天、已完成、清单、标签、自定义筛选。

### 次级工具

四象限、时间线、便签、倒数日、成长、回收站。

### 全局入口

同步、账户、设置、帮助、数据导出、隐私与安全。

## 2. 批次与状态

状态值：`待开始` / `进行中` / `待验收` / `完成` / `阻塞`。

| ID | 批次 | 工作项 | 主要文件 | 验收标准 | 状态 |
|---|---|---|---|---|---|
| DOC-1 | 文档 | 固化审计结论与 IA 目标 | 本文与审计文档 | 结论、原则、目标 IA 可被其他任务直接引用 | 完成 |
| IA-1 | IA | 统一 rail / sidebar / tools 分层，消除“更多”矛盾 | `view-tabs.ts`, `App.tsx` | 代码只保留一套导航策略；低频模块有明确入口 | 完成 |
| IA-2 | IA | 设置、帮助、账户从对象详情上下文中隔离 | `App.tsx`, settings surfaces | 打开设置/帮助/搜索时无无关详情列 | 完成 |
| WEB-1 | Web 交互 | AI 工具调用默认收起，任务输入成为唯一主动作 | `App.tsx`, AI feature CSS | 空态首屏只有一个主 CTA；AI 仍可发现、可访问 | 完成 |
| WEB-2 | Web 视觉 | 详情列按四组组织，高级 RRULE 默认收起 | `TaskDetailCard`, task styles | 基本信息、时间、组织、自动化四组清晰 | 完成 |
| WEB-3 | Web 视觉 | 统一四象限空态信息层级 | `QuadrantBoard`, quadrant styles | 保留 2×2 心智模型铺满空间；引导文案去重、标题带计数、规则说明进帮助 | 完成 |
| MOBILE-1 | 响应式 | 窄屏底栏只承担一级目的地，范围改为页面内控件 | `narrow.css`, shell components | 中文标签单行；不再合并整条 sidebar | 完成 |
| DS-1 | 设计系统 | 补组件行为契约和密度/状态规范 | `docs/reference/design-system-behavior.md` | 新组件能从规范选择 list/board/pane/sheet | 完成 |
| CORE-1 | 产品语义 | 决定并实现任务排序、父子完成/删除语义 | `task-order.ts`, `subtasks.ts`, actions | UI 行为、领域函数、跨端结果一致 | 完成（排序已统一；父子完成保持独立，父删除保留软删除并在读侧提升子任务） |
| PERF-1 | 体验性能 | 给任务列表与同步热路径建立用户可感知基线 | `scripts/measure-product-ux.mjs`, `scripts/measure-hydration.mjs` | 500/1000/5000 条任务下有可重复读数 | 完成 |
| EVIDENCE-1 | 项目治理 | 重取当前代码对应的关键截图 | `apps/web/evidence/product-ux-2026-10-06/` | 旧顶栏截图与新 rail 基线不再混用 | 完成 |

## 3. 执行顺序

### 批次 A：方向和主路径（已完成）

IA-1、IA-2、WEB-1、MOBILE-1 必须先完成。它们决定用户如何理解产品，不能被视觉细节抢先覆盖。

### 批次 B：内容面和编辑面（已完成）

WEB-2、WEB-3、DS-1。完成后再处理材质、动效和图标细节。

### 批次 C：产品语义和性能（已完成）

CORE-1、PERF-1。没有排序和父子任务语义，继续增加复杂编辑器会放大返工。

### 批次 D：证据与交付（代码、Web 证据与四端安装完成）

EVIDENCE-1，并对所有已完成项做截图、交互、测试和文档回读。

## 5. 本轮拍板的产品语义

- **排序**：默认未完成在前、截止时间升序、无截止时间最后；用户可切换添加时间或优先级。排序是设备本地阅读偏好，不写入 op-log。
- **父子完成**：父任务和子任务独立完成。勾选父任务不级联勾选子任务，子任务全部完成也不自动改写父任务；详情面只展示真实完成状态。
- **父任务删除**：删除仍是可恢复的软删除单 op。子任务不被级联删除；父节点在读侧消失后，子任务作为顶级任务显示，并通过领域树的 `promotedFromDeletedParent` 留痕。
- **批量操作**：一个用户意图只产生一个带批量作用域的 op；删除使用 `DEL`，字段批量更新使用 `BATCH`。重复任务混入选择时，批量完成必须阻止整批写入并解释原因，不静默跳过。
- **撤销**：本阶段只承诺批量删除后的 5 秒撤销。批量完成与移动暂不显示撤销入口，避免在没有保存原始字段快照时制造错误的可逆承诺。

这组选择优先保护可恢复性和用户意图的可逆性，避免一次点击静默影响多条任务。若未来要提供级联删除，应作为显式批量动作另立产品决策与确认文案。

## 4. 验收矩阵

### 产品体验

- 新用户进入任务页后，首个视觉焦点是新建任务。
- AI 工具调用不抢占新建任务，但仍可被发现和键盘访问。
- 设置、帮助、搜索不会保留无关任务详情列。
- 窄屏底栏标签不换行、不竖排，范围筛选仍然可达。
- 四象限、时间线、习惯的层级关系能从导航结构直接理解。

### 设计系统

- 所有新增样式继续使用语义 token。
- 新增组件状态至少覆盖 default、hover、focus、selected、disabled、loading、empty、error。
- 材质只用于悬浮层或导航，不进入任务行、表单、日历格等内容面。

### 工程与证据

- 每个批次有对应的单元或交互测试。
- 每个视觉结论有当前源码对应的截图。
- 文档中的导航策略与 `view-tabs.ts`、移动端 `TabBar`、设置入口一致。
- 不能把旧产物或旧截图当成当前实现的验收依据。

## 5. 明确不做

- 不增加新的一级功能模块。
- 不把所有表面改成玻璃。
- 不为 Linux 手写一套与共享 UI 不一致的业务界面。
- 不通过隐藏模块、删掉台账或修改截图来制造“完成”。

## 6. 收尾验收（2026-10-06）

- `pnpm --filter @heyta/web test`：**2036 passed / 13 skipped / 0 failed**（156 个测试文件，2 个文件级跳过）。
- `pnpm --filter @heyta/web build`：通过；Vite 产物已生成。现有大 chunk 仅为构建提示，不影响产物生成。
- 当前代码截图：`apps/web/evidence/product-ux-2026-10-06/` 的桌面任务、更多菜单、窄屏任务与窄屏更多菜单均由当前 Vite 工作树重新截取；W02/W04/W05/W06/MW02 目标也通过截图流水线的真实导航路径复跑。
- 截图流水线现在会：先清首启遮罩；默认关闭的模块通过设置页开关启用；低频视图从真实「更多」菜单进入；窄屏先把横向滚动中的入口滚入视口；点击后仍回读 `aria-selected`，不接受“命名对但视图没切”的假证据。
- 性能基线已记录在 [`../reference/product-ux-performance-baseline.md`](../reference/product-ux-performance-baseline.md)，设计行为契约已记录在 [`../reference/design-system-behavior.md`](../reference/design-system-behavior.md)。

## 7. 第二阶段执行批次（2026-10-06，代码、Web 证据与四端安装完成）

开放项已由 [`../research/product-decision-record.md`](../research/product-decision-record.md) 裁决：

| ID | 工作项 | 交付物 | 验收 | 状态 |
|---|---|---|---|
| BRAND-1 | 页头品牌眉标与蓝白识别深化 | `App.tsx`、`main-area.css` | 亮/暗/窄屏可见，不挤压页标题 | 完成 |
| BULK-1 | Web 任务多选、批量完成/移动/软删除 | `app-host` actions、Web task UI | 单一批量作用域 op、键盘/触摸可达 | 完成 |
| UNDO-1 | 批量删除短时 undo toast | Web shell | 删除后 5 秒内可撤销，过期自动消失 | 完成 |
| LIST-1 | 清单级设备本地排序偏好 | `project-sort-pref.ts`、任务页 | 按清单记忆，不进 op-log | 完成 |
| MOBILE-2 | 移动端 push/pop 二级导航栈 | `apps/mobile/src/nav`、`App.tsx` | 返回优先 pop，tab 状态保留 | 完成（原生实机仍需安装当前产物） |
| SETTINGS-1 | 设置页分类导航与渐进披露 | `App.tsx`、`sheets.css`、i18n | 桌面目录 + 窄屏横向目录；关闭出口在首屏；内容不透字 | 完成 |
| RELEASE-1 | 四端重装验收 | `pnpm reinstall:all` 分端证据 | 四端当前产物均安装并启动 | 完成 |

本轮四端已通过分端收口：macOS 与 Windows 通过 `pnpm reinstall:all --only mac,windows`，Android 通过 `pnpm reinstall:all --only android`，iOS 通过 `IOS_DEVICE_NAME=heyta-iphone-17pro pnpm reinstall:all --only ios`。期间发现并修复收口脚本的构建顺序问题：`pnpm -r build` 后追加一次 `@heyta/web build`，确保原生壳打包时 web-dist 晚于 workspace 依赖产物。四端均有清旧、重打、重装和当前产物判据；不能把早先的整轮环境失败日志当成最终状态。
