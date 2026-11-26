# AI 对话助手界面规范（参照 WeKnora）

> 本文件按 [`docs/agents/design-system.md`](../../../docs/agents/design-system.md) §0 登记为页面级覆盖规范，约束 AI 对话面板与周边提示组件。
> 所有取数与变量值以 [`packages/design-system/src/tokens.css`](../../../packages/design-system/src/tokens.css) 为唯一事实源，本文不复制具体取值。
>
> 参考实现：`weknora/frontend/src/views/chat/`（`usermsg.vue`、`botmsg.vue`、`AgentStreamDisplay.vue`、`EmbedChatCore.vue`）与 `design-demos/ai-chat/A-weknora.html`。

---

## 1. 信息极简与反噪音原则

1. **禁止冗余文本铺张**（对齐 `docs/agents/ux-principles.md` §11）：
   - 对话界面只保留改变用户决策或理解的最小文案；
   - 过程、状态、来源、免责不能逐块铺成大段说明。
2. **顶栏永不折行**：
   - 顶栏保持单行（标题左对齐截断，操作按钮右对齐紧凑排列）；
   - 在 320px/352px 右侧详情栏内也不得把标题与操作拆成上下两行。
3. **工具与思考过程（统一竖线时间线）**：
   - 顶层折叠触发器保持无边框轻文字形态（执行中显示 `调用工具中 ⌄` 且默认展开，完成后收敛为 `用了 N 步工具 ⌄` 且默认收起），不画厚重圆角边框胶囊，也不在折叠态下方同时平铺重复工具名；
   - 展开后统一呈竖线时间线：左侧固定图标列（思考节点用时钟图标，工具节点用大括号/警告图标），下方用 1px `color.border` 竖线连通后续节点并在最后一个节点自动收尾；
   - 长段思考内容收起态裁切为 3 行并带底部渐隐遮罩，长文本/工具明细下方放紧凑圆角按钮 `查看更多` / `收起`（底色 `color.hover`），点击原地展开或收起。
4. **AI 生成标识轻量化、去重复**：
   - 共享层 [`AiGeneratedLabel`](../../../packages/ui/src/ai/AiGeneratedLabel.tsx) 必须使用 `row-meta`（`12px`、常规字重 `400`）+ `color.foreground-subtle`，严禁用 `500` 字重或高对比文字抢过正文注意力；
   - 同一轮 AI 回答紧接提案卡时，不在中间夹塞重复标识，整段回答只在末尾保留一次轻灰收口。
5. **页脚单层轻提示**：
   - 底部提示使用 `font-size.xs` + `color.foreground-subtle` 紧凑排布，保持简短单句，不用多段长文占据垂直空间。

---

## 2. 角色排版与视觉层级

| 角色 | 形态 | 排版与颜色 |
|---|---|---|
| **用户消息** | 贴右浅底气泡（`max-inline-size` 受控，窄栏不撑成满宽方块），圆角右下收敛 | `font-size.sm`（窄栏）/ `font-size.base`（宽工作区），`line-height.relaxed`，`color.primary-subtle` 底，`color.foreground` |
| **助手回答** | 贴左无框正文（`background: transparent; padding-inline: 0`），直接回到正文流 | `font-size.sm`（窄栏）/ `font-size.base`（宽工作区），`line-height.relaxed`，`color.foreground` |
| **过程折叠头与时间线** | 无边框轻文字触发器（`调用工具中 ⌄` / `用了 N 步工具 ⌄`）+ 图标列 1px 竖线时间线 + 紧凑 `查看更多` 按钮（`color.hover` 底） | `font-size.xs`，`color.foreground-muted` / `color.foreground-subtle` |
| **提案 / 确认卡** | 浅蓝/中性承载卡；头部短标题 + 下方结构化任务行 + 明确主次按钮 | 标题 `font-size.sm` + `semibold`；任务行左名右标签，不把任务清单串进标题重复写两遍 |
| **追问 / 建议芯片** | 紧凑圆角胶囊（高度取 `--ht-size-chip-height`），不复用 44px 表单高 | `font-size.xs`，`color.surface-sunken` 底，`color.foreground-muted` |
| **法定标识 / 页脚注记** | 正文下方轻灰脚注，视觉权重严格低于正文 | `row-meta`（`font-size.xs`、`400`），`color.foreground-subtle` |

---

## 3. 提案卡结构规范（对齐 WeKnora 卡片行）

- **禁止重复信息**：卡片标题只写动作摘要（如「调整 2 项任务优先级」），不得把任务名与参数全部拼成多行粗体长句再在下方列表重复一遍；
- **状态与优先级标签**：任务行右侧用轻量语义标签标出目标值（高 / 中 / 低 / 完成），圆点与标签语义一致，不全员用同一个橙点；
- **失效/恢复提示**：跨重载恢复的失效提案只留一句简短状态提示（如「已失效，请重新发起。」），不塞多行解释文字。

---

## 4. 窄栏（320px–360px）与宽工作区适配

- **对话区留白**：左右安全边距 `space.4`（16px），防止无框助手正文贴边；
- **输入容器（Composer）**：采用三列网格（附件按钮 / 单行输入框 / 发送按钮）包在同一枚圆角容器（`radius-lg` + `border-width-thin` + `shadow-sm`）内，附件按钮不再绝对定位压过输入区域；
- **焦点单一外环**：内层 `.ht-ai__input` 禁止自绘方框焦点环（`outline: 0; box-shadow: none`），聚焦态由外层 `.ht-ai__composer:has(.ht-ai__input:focus-visible)` 统一绘制跟随圆角的 `1px` `color.ring` 边框环；
- **芯片适配深浅主题**：追问与建议芯片背景使用 `color.hover`（亮/暗主题均与面板底形成稳定对比），高度收敛为 `--ht-size-chip-height`（28px）。
