# heyta 跨端交互与视口 UX 审计

> 日期：2026-10-07
> 范围：Web、移动端、桌面壳；重点检查拖拽、长按、四象限、栏宽调整、时间线和小视口。
> 方法：代码审计、现有真实浏览器验收、平台规范对照。静态风险不会被描述成真机已复现。

## 产品判断

heyta 的交互方向已经形成一个可用的分工：Web 适合直接操控，移动端优先点按和详情编辑，桌面窄窗通过折叠和内部滚动承载内容。问题集中在“动作发生后用户是否知道发生了什么”和“快捷手势是否有可见替代路径”，而不是缺少更多手势。

本轮的统一决策是：**直接操控负责加速，显式操作负责兜底；所有改变用户数据的拖拽都必须可解释、可撤销或可恢复；视口缩小时优先重排、折叠和内部滚动，不要求用户先把窗口拖大。**

## 外部规范与产品翻译

| 来源 | 规范要点 | heyta 的落地规则 |
|---|---|---|
| [WCAG 2.2 SC 2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) | 拖拽动作要有不依赖拖拽的单指针替代方式 | 四象限提供任务详情中的重要性/截止时间编辑；以后侧栏排序也必须有菜单或键盘入口 |
| [WCAG 2.2 SC 1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) | 缩小视口时内容应重排，核心操作不能被横向裁切 | Web 使用 `100dvh`、`minmax(0, 1fr)`、内部滚动和 `clamp()`；移动端避免固定高度面板遮挡键盘 |
| [Apple HIG Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures) | 自定义手势要可发现、简单、与标准手势不冲突，不能是唯一入口 | 长按是批量选择快捷方式；任务行和工具栏仍提供可见选择路径 |
| [Apple HIG Drag and Drop](https://developer.apple.com/design/human-interface-guidelines/drag-and-drop) | 拖拽过程要持续反馈，非法投放要说明，错误应回弹，最好支持撤销 | 拖拽握把、悬停高亮、状态播报、失败提示和 5 秒撤销；四象限日期变化立即说明 |
| [Android gestures](https://developer.android.com/develop/ui/compose/touch-input/pointer-input/understand-gestures) | 触摸手势需要区分点击、滚动和长按，避免竞争 | 任务行长按只在可打开行体上触发；横向/纵向滚动不由长按抢占 |
| [Android adaptive layouts](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes) | 按窗口尺寸重排，而不是按设备型号猜布局 | 共享任务语义不变，移动端使用单列和详情面，Web 在窄视口隐藏详情列 |

## 交互审计

### AI Agent 入口

- 产品只保留一个 Agent / Chatbot 入口。用户表达目标，系统在同一条对话链路里展示
  读取、执行、出境披露和写入提案状态；“工具调用”是过程，不是导航目的地。
- Web 在任务页只显示一个 Agent 面；窄窗口将 Agent 按需放入 overlay/sheet，不挤压主任务内容；移动端是一个 Agent 页面。
  快捷建议可以帮用户开始，但不再把 capture、breakdown、tool-calling 等内部能力做成
  并列产品面板。
- 设置保留端点、模型、授权和数据出境策略；写入提案必须由用户确认。这样同时满足
  滴答清单式的低心理负担和 heyta 的本地优先安全边界。

### 四象限拖拽

- Web 使用独立握把、`PointerSensor`、`KeyboardSensor`、悬停高亮和拖拽浮层，基础可发现性与键盘入口成立。
- 拖入紧急象限会把截止时间推进到一小时内，拖入非紧急象限会清除截止时间。这个领域语义是合理的，但原先没有在完成后告诉用户，属于 P1 数据可解释性缺陷。
- 已修复：拖放成功后显示状态；发生截止时间变化时明确说明；写入失败显示错误；5 秒内可撤销；握把的无障碍名称改为动作名。
- 已补齐：任务行的“移动到象限”显式选择入口与拖拽共用同一条 `moveTask` 语义；拖拽仍需要首次使用时的轻量握把提示。

### 移动端长按

- 普通任务列表已有长按进入批量选择，但此前四象限没有接入，造成同一任务在不同投影中行为不一致。
- 已修复：四象限复用同一 `onLongPressTask`、选择态和选中集合；长按后继续点按会切换选择，不会误打开详情。
- 当前批量工具栏会固定在任务页 AppBar 下方，并提供取消、完成、移动、删除等显式动作。`TasksScreen` 在非批量态显示 `mobile.tasks.gestureHint`，任务列表和四象限都传入 `onLongPressTask`；任务/四象限/时间线切换下还提供可见的 `web.shell.bulk.select` 选择入口（时间线切换时隐藏）。因此“没有教育提示、没有独立选择入口”的旧结论已失效。
- 仍需真机验收的是 TalkBack/VoiceOver 对提示、选择态和批量工具栏的实际读屏顺序，以及滚动过程不会误触长按；这属于设备证据，不应再写成代码缺口。

### 侧栏与详情栏调整宽度

- 现有实现已支持 pointer capture、触控 `touch-action`、键盘方向键、Home、双击复位、`role=separator` 和 CSS 夹取。
- 已修复：`pointercancel` 回滚到拖动前宽度，不再提交中间值；pointerup 使用 ref 中的最终宽度，避免落后一帧；键盘调整支持 Escape 取消。
- 仍需后续：验证空闲手柄在不同主题和视口下的发现性。首次 coachmark 暂不增加，保持工作台低干扰；只有实测证明用户无法发现边界时，才重新开启提示设计。

### 时间线

- 当前时间线已区分点击与拖动：任务条移动超过阈值后才进入拖动，末端手柄是可聚焦的 Pressable，键盘触发后进入同一个 `editSchedule` 任务排期编辑器。
- 这条路径已经提供无需拖拽的可访问替代入口。直接用键盘连续调整时长不属于当前产品承诺，持续观察即可，不再作为缺陷或 P2 实施项。

### 视口与滚动

- Web 外壳已有正确的封顶与重排基础，现有 `shell-no-document-scroll` 和 `sidebar-resize` 浏览器验收在 1280×700 等视口通过。
- 移动端列表视图已先把 `FlatList` 设为唯一纵向滚动宿主，移除最严重的 `ScrollView` + `FlatList` 手势竞争；页头筛选目前固定在列表上方。后续仍应把这些控制合入 `ListHeaderComponent`，让长页头也能随列表自然滚动。
- 已修复：任务详情面板 Android 使用 `KeyboardAvoidingView` 的 `height` 策略，并加入底部安全区 inset；设置页同步采用 `height`，避免键盘遮挡提交操作。

## 优先级

| 优先级 | 问题 | 状态 |
|---|---|---|
| P0 | 核心操作在窄视口被裁切或必须手动扩大窗口 | Web 外壳与移动列表滚动宿主已修复，需当前产物做真机回归 |
| P1 | 四象限拖拽静默修改截止时间 | 已修复：说明、失败反馈、撤销 |
| P1 | 四象限与任务列表的长按行为不一致 | 已修复：共享选择态接线 |
| P1 | 键盘/安全区遮挡移动端详情与设置 | 已修复代码，需 Android/iOS 当前产物验收 |
| P1 | 时间线点击与拖动语义冲突 | 已修复：阈值与 `editSchedule` 点击路径已接通；末端手柄提供可聚焦 Pressable 与键盘替代入口 |
| P2 | 调宽手柄发现性 | 持续观察：空闲手柄保持轻量可见；首次 coachmark 暂不增加，只有实测发现不可发现时再设计 |
