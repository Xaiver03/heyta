# 全页面响应式 UX 审计（2026-10-07）

这是一份面向产品交互和视觉质量的浏览器审计记录。它检查真实渲染结果中的容器边界、固定层定位、文字换行和导航几何，不把类型检查、构建门禁或单元测试当作 UI 体验证据。

## 审计范围

审计使用真实 Chromium 页面，未注入 mock 数据，也未启用模型端点。中文覆盖任务、日历、四象限、习惯、番茄钟、时间线、成长、便签、倒数纪念日、搜索和回收站；同时覆盖个人中心和设置的七个分组：个人资料、任务与显示、同步与隐私、AI 与集成、数据管理、账号与安全、帮助。每个表面均检查亮色和暗色。

英文额外覆盖任务、搜索、个人中心和设置的任务与显示分组，并检查亮色和暗色。

视口矩阵为：

| 类型 | 宽度 × 高度 |
| --- | --- |
| 桌面 | 1440 × 900、1024 × 768 |
| 窄桌面/平板 | 768 × 844 |
| 手机 | 390 × 844、375 × 667 |

审计脚本记录每个状态的 `documentWidth`、`bodyWidth`、全局横向溢出、可见元素内部 `scrollWidth`、固定层/菜单是否出界、按钮和 Tab 是否换行、rail 中轴位置及可见 dialog/menu。截图和逐行读数保存在 [`apps/web/evidence/global-responsive-ux`](../../apps/web/evidence/global-responsive-ux)。

## 可复现命令

从 `e2e/` 目录执行：

```sh
HEYTA_TASTE_PORT=4337 \
./node_modules/.bin/playwright test \
  --config playwright.global-responsive.config.ts \
  --output=test-results-global-responsive
```

配置文件是独立的 [`e2e/playwright.global-responsive.config.ts`](../../e2e/playwright.global-responsive.config.ts)，只启动 Web Vite，不启动 AI stub，也不复用其他套件的输出目录。测试文件为 [`e2e/tests/global-responsive-ux.spec.ts`](../../e2e/tests/global-responsive-ux.spec.ts)。

本轮结果：

```text
GLOBAL_RESPONSIVE_ROWS=230
GLOBAL_RESPONSIVE_FINDINGS=32
1 passed (56.2s)
```

`GLOBAL_RESPONSIVE_FINDINGS` 是需要人工复核的行数，不是缺陷数。本轮 rail 中轴偏移已经修复，剩余 32 行全部是内部容器溢出候选；同一个问题会在多个主题、语言和视口重复出现。

## 结论读数

| 检查项 | 读数 | 解释 |
| --- | ---: | --- |
| 状态总数 | 230 | 所有状态均产生截图和 JSON 读数 |
| `document` 全局横向溢出 | 0 | 页面整体没有被内容撑宽 |
| 出界的可见 fixed/dialog/menu | 0 | 没有证据表明弹层出界 |
| 按钮、Tab、输入控件换行 | 0 | 没有观察到控件文字被撑成多行 |
| 桌面 rail 中轴偏移 | 0 | 所有可见 rail 按钮均为 44px，中心线统一为约 30px |
| 内部容器溢出候选 | 32 | 主要是 4px 级 box 边界差异，以及 focus legend 的隐藏几何节点 |

移动端 rail 的 `centerSpread` 没有被当作缺陷：在 768px 以下 rail 本身是横向滚动条，所有 tab 的中心点横向分散是结构预期。脚本只在宽度至少 1024px 时把 center spread 纳入 findings。

## 已确认的问题

### 1. 桌面 rail 的分组中轴已收敛

此前主导航约 `30px`、工具/AI/同步约 `31.5px` 的差异来自 rail 内容区 47px 与部分按钮 44px 命中盒混用。修复后，在 1440px 和 1024px 的中文/英文、亮色/暗色状态中，所有可见 rail 按钮均为 44px，中心线统一为约 `30px`，`centerSpread=0`。

### 2. 设置页窄屏分类目录已增加安全区

人工查看了：

- [`zh-CN-light-settings-appearance-375x667.png`](../../apps/web/evidence/global-responsive-ux/zh-CN-light-settings-appearance-375x667.png)
- [`zh-CN-light-settings-account-375x667.png`](../../apps/web/evidence/global-responsive-ux/zh-CN-light-settings-account-375x667.png)
- [`en-light-settings-appearance-375x667.png`](../../apps/web/evidence/global-responsive-ux/en-light-settings-appearance-375x667.png)

设置已经采用“分类目录 + 当前分组”的 IA。修复后目录保留横向滚动，并为关闭按钮增加 trailing safe area；每个分类切换后自动滚入并居中。定向浏览器验收覆盖七个分类，确认选中按钮完整位于导航视口内，且不与关闭按钮重叠。

### 3. 内部边界存在重复的 4px 级溢出候选

读数里重复出现以下组合：

| 元素 | 典型尺寸 | 出现位置 |
| --- | --- | --- |
| `nav.ht-sidebar` | 239 / 243 | 任务桌面视图 |
| `main.ht-main` | 784 / 788、413 / 417、608 / 612、1024 / 1028 | 任务、搜索、番茄钟 |
| `#calendar-sidebar` | 239 / 243 | 桌面日历 |
| `div.ht-sidebar__month-head` | 189 / 193、341 / 345、734 / 738 | 日历各视口 |
| `legend.ht-app__focus-settings-legend` | 4 / 68 | 番茄钟各视口 |

这些候选没有造成 document 级横向滚动；抽查截图也没有看到文字被剪切。它们更像 `box-sizing`、边框、滚动条或隐藏 legend 的内部几何差异，当前不能直接升级为用户缺陷。下一轮应针对每个元素检查实际 `getBoundingClientRect()`、父容器的 overflow 规则和可见像素，再决定是修正布局还是登记为允许的内部溢出。

### 4. 日历底部内容需要补一次固定底栏遮挡复核

[`zh-CN-light-calendar-375x667.png`](../../apps/web/evidence/global-responsive-ux/zh-CN-light-calendar-375x667.png) 显示日历的第二个月份面板延伸到固定底栏附近。全局宽度和弹层均正常，但本矩阵没有滚动到内容末端验证最后一行是否被底栏遮住。因此这项记录为待复核风险，不写成已确认缺陷：需要一次真实滚动到底、点击最后一个日期并确认底栏不会遮挡目标。

## 已确认没有证据支持的问题

- 没有发现页面级横向滚动条或 `document` 被撑宽。
- 没有发现可见 fixed dialog/menu 出界。
- 没有发现按钮、Tab 或输入控件文字换行。
- 习惯页的热力图在本轮截图中没有出现之前的明显右溢出；增长热力图的横向滚动容器属于预期交互，应继续保持局部滚动，不应让它扩大 document 宽度。
- 个人中心在 375px 首屏能显示身份状态、近期状态和成就进度，内容继续向下滚动；本轮没有证据表明个人中心与底部导航发生宽度溢出。首屏之外的成就完整展示仍需专门的纵向滚动验收。

本轮补充了个人中心专项验收：375px 视口从头像菜单进入个人中心，成就入口可见并进入 `growth-board`；随后滚动到成长页末端，成长内容仍可见。证据截图为 [`profile-growth-375x667.png`](../../apps/web/evidence/global-responsive-ux/profile-growth-375x667.png)。

日历窄屏底部专项验收也通过：375px 视口点击最后日期格，编辑器保持在视口内，并可再次从页头入口打开。该验收复用了 `calendar-capture.spec.ts` 的真实浏览器路径，结果为 `1 passed`。

“没有证据支持”只表示本次状态和截图没有观察到该问题，不等于所有滚动路径都已覆盖。

## 对 IA / UX 的判断

设置的“目录 + 当前分组”比把七组内容堆在一个长 sheet 中更容易建立位置感，个人中心从头像菜单进入、再通过明确动作回到设置，也符合用户对“资料”和“偏好”的区分。当前主要缺口是窄屏分类目录的可发现性：信息架构已经分组，但移动端的目录呈现没有为有限宽度提供足够明确的滚动或替代选择方式。

个人中心首屏以身份状态、近期状态和成就进度组成摘要，适合作为“我是谁 / 最近怎样 / 下一步是什么”的入口；成就详情不应全部塞入首屏，应保留摘要卡并通过“查看全部”进入专门的成就列表或按阶段分组的详情面。

设置与个人中心应继续保持两个入口：头像菜单中的个人中心负责身份与成长摘要，设置中的个人资料负责编辑资料和账号相关偏好。个人中心可以提供“编辑个人资料”和“打开设置”两个明确动作，但不要把同步、AI、数据管理等系统配置复制到个人中心。

## 交由产品实现的收口项

1. 对 sidebar、main、calendar month head 和 focus legend 的 4px 候选做一次元素级复核，只有确认用户可见裁切后才修改 CSS。
2. 保持设置窄屏目录的 safe area 与选中项自动滚动行为，后续跨端验收继续检查长语言文案。
3. 保持个人中心“摘要 → 完整成长”的单向入口，避免把成长详情复制回个人中心。
4. 日历底部日期编辑器已通过 375px 浏览器验收，后续只需在统一源码冻结点复跑。

本审计只新增审计脚本、独立 Playwright 配置、截图证据和本报告；没有修改产品 CSS 或组件逻辑。父代理可以在源码合并完成后先构建 `packages/*` / Web dist，再从同一源码冻结点重跑本矩阵，避免截图和产物来自不同版本。
