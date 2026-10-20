# Landing Page 优化计划

> 状态：**本轮目标已完成；WebGL 按需加载与隐私减动效路径已落地并验收**

本计划承接 [`docs/research/landing-page-ia-ux-audit.md`](../research/landing-page-ia-ux-audit.md)。目标是让 Landing 用一条清晰的产品路径说明 heyta：收集任务、选择处理视图、跨设备完成，并把帮助中心作为问题解决入口。产品 DOM 复现必须与当前 Web 外壳的结构登记和测试保持一致，样例数据只能影响内容，不得伪造真实账户状态。

## 产品决策

1. Hero 只证明产品长什么样；持续倾斜、浮动状态片和第二套装饰性窗口不参与解释。
2. Showcase 使用当前 Web 外壳的同一份结构登记和样例任务，采用直接选择视图；滚动不再是选择视图的唯一方式。
3. AI 在 Landing 只使用一个 Agent 叙事，不展示工具目录或工具调用。当前产品预览默认展示真实任务详情栏，Landing 不伪造一个尚未接入行为的 Chatbot；只有真实 Agent 交互落地后，才补“提案 → 确认 → 写入”的可操作演示。
4. 帮助中心 URL 保持 `/docs`；帮助首页搜索、任务捷径和分类文章都由 `docsOutline()` / 现有文档注册表派生，不建立平行分类真源。
5. 托管和云端 AI 的 CTA 必须与“即将开放”状态一致；自建入口才显示可立即执行的动作。
6. WebGL、Privacy 加密和视图切换都必须有静态可读状态，且在 `prefers-reduced-motion` 下不损失信息。

## 阶段与交付物

### P0：产品叙事与真实预览（已完成）

- [x] 将真实产品预览提前到能力目录之前。
- [x] 将 Hero 产品卡改为稳定的轻量入场，删除指针倾斜和浮层。
- [x] 将 Showcase 由 300vh sticky coverflow 改成直接选择式预览。
- [x] 视图切换继续使用 `MockView`、`app-shell-shape` 和 `SHOWCASE_TASKS`，不在组件中另抄导航、计数或任务。
- [x] 任务勾选只更新本地 mock 状态，不连接 API，并提供演示语义。
- [x] 将复现外壳对齐当前 Web 的 rail → 范围侧栏 → 主区 → 选中任务详情栏；非任务视图不再伪造任务侧栏或捕获框，也不画无行为的 AI 按钮。
- [x] Landing 的 AI 文案统一为单一 AI Agent。

验收：首屏和展厅的导航、视图名称、任务行、象限卡片、标题栏动作与当前 Web 代码登记一致；切换视图不依赖长滚动；键盘 Tab 可到达所有操作。

### P1：帮助中心按问题工作（已完成）

- [x] `/docs` 首页增加本地搜索，搜索 FAQ 问题/答案和文章标题。
- [x] 增加由现有模块派生的快速问题入口。
- [x] 增加“第一次使用 / 同步失败 / 数据导出 / 隐私与 AI / 自建部署”的明确文章锚点；没有文章时不显示死链接。
- [x] 文章页补足从搜索结果返回帮助中心的路径验收。
- [x] 中英文搜索、空状态、清除和键盘 Escape 行为加入测试。
- [x] 区分文档中心顶栏搜索与帮助首页“在帮助内容里找答案”，避免两个同名搜索入口。

验收：用户输入“同步”“导出”“AI”“自建”后可以在两次点击内到答案；无结果时能继续修改查询；窄屏搜索与结果不横溢。

### P2：动效与性能（本轮完成，持续项保留）

- [x] Showcase 切换仅使用短的 opacity/transform 反馈；移动端不保留强制滚动跨度。
- [x] WebGL 继续 Deferred + fallback；隐私演示在减动效下直接展示“设备明文 → 服务端密文”的静态对照。
- [x] 移动端与 375px/1440px 视口验收，确认没有横向溢出和视图丢失。
- [x] 检查动画进入/退出时长与 design token 一致，移除不承担信息传递的循环动效。

## 证据与门禁

- `pnpm --filter @heyta/landing typecheck`
- `pnpm --filter @heyta/landing test`
- `pnpm --filter @heyta/landing build`
- `node research/tools/docs-link-check.mjs`
- `pnpm --dir e2e exec playwright test --config playwright.landing.config.ts landing/homepage-ux.spec.ts landing/docs-centre.spec.ts`
- 通过浏览器检查 `/`、`/docs/`、375/1440 窄宽视口、`prefers-reduced-motion`，记录截图和实际 DOM 状态。
- 生产 mock 结构变更必须同步 `apps/landing/tests/mockup-shell-shape.spec.tsx` 等对应对账测试；不以截图相似代替结构对账。
- 竞品 AI 参考使用 TickTick 官方帮助文章 [AI Assistant](https://help.ticktick.com/articles/7503016104470511616)：它验证的是“单一 Agent 入口 + 自然语言消息 + 建议/动作”这一交互形态，不代表 heyta 当前已提供同等能力。

## 风险和边界

- mock 数据不是用户数据，不能把 Landing 的勾选或未来 Agent 提案写入真实存储；当前 Landing 没有 Agent 输入框或确认链路。
- 竞品页面是动态内容；本计划引用的是审计当天官方页面结构，不把动态价格、视频 URL 或实验性文案写成长期契约。
- 不新增依赖；动效继续使用现有 `motion`、Lucide 和设计 token。
