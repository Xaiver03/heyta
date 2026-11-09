# AI 对话流式动效 · 源码级对照学习清单

> 数据核实时间：**2026-11-09**。全部为当日实测：`git clone --depth 1` 走代理 `127.0.0.1:65411` 后逐文件读取 + `sed` 复核行号，非记忆、非二手转述。
> 图例：✅ 具备 / ⚠️ 有条件 / ❌ 缺失 / 🔴 重点
> 本地副本：`/tmp/aui-work/assistant-ui`（assistant-ui）、`/tmp/antdx`（ant-design/x）——**`/tmp` 会被清理，重建命令见 §7**。

---

## 0. 结论先行

**我们要学的东西，两个库各占一半，而且没有一个是"拿过来直接用"的。**

| 问题 | 结论 |
|---|---|
| 我们的流式动效现状 | ❌ **为零**。数据层与归约器全齐，只差渲染层的节奏控制 |
| 该学谁 | **节奏算法学 assistant-ui**（`useSmooth` 自适应追赶），**光标与零依赖加载态学 ant-design/x** |
| 能不能照搬代码 | ❌ **不能**。`packages/ui` 是**单份代码跑 web + RN**（实测无 `.native/.web` 分叉），而两库的动效都是 DOM/CSS 专属 |
| 🔴 最重要的一条 | assistant-ui 的**官方 RN 绑定里没有任何动效**（实测 `useSmooth/smooth/Animated/reanimated` 零命中）⇒ **算法可学，代码不可搬** |
| 我们的 token 体系 | ✅ **比两个库都严谨**。antdx 有大量硬编码 ms；assistant-ui 的缓动 40+ 处重复未抽 token。**不要学它们的 token，学它们的引擎** |
| 预期工作量 | 补"逐字节奏 + 光标 + 加载态"≈ 小；补"粘底不抢滚动"≈ 中（assistant-ui 那份是 544 行状态机） |

**一句话**：我们缺的不是组件库，是**一个能被我方 token 体系约束的流式渲染引擎**。两个库各自的引擎都可以读懂，但没有一行能直接抄——因为我们在 RN 上。

---

## 1. 我们的现状（第一手实测）

### 1.1 技术栈基线

| 项 | 实测值 | 取数方式 |
|---|---|---|
| 前端框架 | **React 19**（web `^19.2.0` / mobile `19.2.3`） | `grep '"react"' apps/*/package.json` |
| 有无 Vue | ❌ 无 | `grep '"vue"' packages/*/package.json apps/*/package.json` → 空 |
| UI 共享层 | **React Native 原语**（`StyleSheet`/`View`/`Text`） | `packages/ui/src/ai/*.tsx` |
| RN 版本 | **0.84.1** | `packages/ui/package.json:40` |
| 平台分叉 | ❌ **单份代码双端**（无 `.native.ts`/`.web.ts`） | `find packages/ui/src -name "*.native.ts*" -o -name "*.web.ts*"` → 空 |
| 动效库 | ❌ 无 reanimated / framer-motion / rc-motion | 各 `package.json` grep |

🔴 **由此推出一条硬约束**：`packages/ui` 里写的任何动效，**必须同时能在 DOM 与 RN 上跑**。纯 CSS `@keyframes`、`scrollHeight`、`getBoundingClientRect()` 这些在两库里被大量使用的手段，**在我们这里直接出局**（除非只在 `apps/web` 单独写）。

### 1.2 动效能力：不是零，但也远不够

**已有的**（RN 核心 `Animated`）：

| 文件 | 用法 | 位置 |
|---|---|---|
| `packages/ui/src/task-list/SwipeReveal.tsx` | `Animated` + `PanResponder` 左滑 | `:36`、`:140` |
| `packages/ui/src/empty-state/StateIllustration.tsx` | 入场动效，正确取 token 缓动 | `:239` |
| `packages/ui/src/overlay/BottomSheet.tsx` | 拖拽吸附，`Animated.spring` | `:275` |

**从未用过的**：`LayoutAnimation`（实测零命中）。

**已有的 token**（`packages/design-system/src/tokens.css`）——成套且严谨：

```
时长  : --ht-duration-instant 80ms / fast 150 / normal 200 / slow 300
        --ht-duration-exit 140ms / press 100ms
首屏  : --ht-duration-splash-enter 420 / stagger 90 / hold 200 / exit 260
缓动  : --ht-ease-standard cubic-bezier(0.2, 0, 0.2, 1)
        --ht-ease-enter    cubic-bezier(0, 0, 0.2, 1)
        --ht-ease-exit     cubic-bezier(0.4, 0, 1, 1)
        --ht-ease-spring   cubic-bezier(0.34, 1.56, 0.64, 1)
弹簧  : --ht-motion-spring-damping-default 1 / momentum 0.8
        --ht-motion-spring-response-move 0.4 / sheet 0.3 / rotation 0.4
        --ht-motion-press-scale 0.97
```

### 1.3 🔴 实测发现的两处真实缺口

**缺口 A：RN 侧缓动取值不统一，且有一处注释已过时。**

- `packages/ui/src/theme.tsx:163` **已实现** `easing: (key) => parseCubicBezier(tokens[key])`
- `StateIllustration.tsx:239` 正确用法：`native.easing('ease.enter')`
- 🔴 但 `SwipeReveal.tsx:143-145` 的注释写着「RN 侧没有对应刻度，自造一组数字等于在 token 表外新建一份裁决」，然后直接写了 `Easing.out(Easing.cubic)`
- ⇒ **机制早就存在，注释与事实不符**。这是一处可以直接修掉的不一致。

**缺口 B：弹簧参数两套模型并存。**

- token 层定义的是 **Apple 的「阻尼比 + 响应」模型**（`tokens.css:678-693`，注释明确引 WWDC 2018）
- 但 `BottomSheet.tsx:277-283` 实际硬编码了 **`stiffness: 320, damping: 32, mass: 0.7`**（物理三件套）
- ⇒ token 定义了却没人消费。**两套模型并存 = 后续重写必须先统一**。

### 1.4 流式链路：数据全齐，渲染空缺

```
packages/ai/src/stream.ts          SSE 解析 → StreamDelta { text | reasoning | tool-call }
       ↓
packages/app-host/src/ai-assistant.ts:230-241
       AssistantTurnEvent { text | reasoning | tool-started | tool-finished }
       ↓  开关：`:770` onDelta 只在调用方给了 onEvent 才装（"显式要"）
apps/web/src/features/ai/AssistantPanel.tsx:198  reduceAssistantLive()
       纯函数，增量拼接（`base.text + event.delta`）
       ↓
AssistantPanel.tsx:972   <span data-testid="ai-chat-live-text">{live.text}</span>
       🔴 整段累积字符串直接渲染 —— 零节奏控制、零光标、零淡入
```

**结论**：`reduceAssistantLive` 已经在**逐片**产出文本，缺的只是最后一跳——把"已到但未显示"的字符按节奏吐出来。这正好是 `useSmooth` 解决的问题。

### 1.5 四端一致性现状

| 端 | AI 界面位置 | 行数 | 流式 | 说明 |
|---|---|---|---|---|
| **web** | `apps/web/src/features/ai/`（16 文件） | `AssistantPanel.tsx` **1286** | ✅ 有 | 流式动效的落点 |
| **desktop**（3 平台） | **加载 `apps/web/dist`** | — | ✅ 自动跟随 | `apps/desktop/src/main.ts:203-211` |
| **mobile** | `apps/mobile/src/ai/`（11 文件） | **2764** | ❌ **无流式** | `chat-controller.ts` 里 `onEvent`/`stream` 零命中 |
| **共享层** | `packages/ui/src/ai/` | **591** | — | 两端共用 |

🔴 **两个要点**：
1. **desktop 复用 web 产物** ⇒ 改 `apps/web` 即三端生效，**重写范围是 2 处不是 4 处**。
2. **mobile 完全没有流式**（"整段回来再显示"）⇒ 若要做逐字动效，移动端要么先接流式，要么动效只能做成"整段淡入"。

### 1.6 滚动锚定：有，但流式期间不跟

`AssistantPanel.tsx:294-315`：

- `revealLatest()` 滚到底；有披露块时对齐标题（不裁掉标题与关闭键）
- `ResizeObserver` 监听 `conversation` 重新对齐
- 🔴 依赖数组是 **`[items.length, phase]`** —— **流式 delta 不触发**，所以**流式期间不会自动跟到底**

---

## 2. assistant-ui 取证（commit `29638c4e`，MIT，13,020 stars）

### 2.1 核心运行时零动画库

`packages/react/package.json` 依赖里**没有** motion / framer-motion / react-spring。全仓 `motion` 只出现在**文档站**（`packages/docs-theme/package.json:59,77`、`apps/docs/package.json:93`，`motion@^14`），不随组件发布。

⇒ 它的动效来自三处：**自研 RAF 动画器**、纯 CSS keyframes、外部 `streamdown` 的 caret。

### 2.2 🔴 核心引擎 `useSmooth` —— 本次最有价值的算法

位置：`packages/react/src/utils/smooth/useSmooth.ts`（302 行）

**自适应追赶**（`:87-98`）——这是 antdx 完全没有的能力：

```js
const remainingChars = this.targetText.length - this.currentText.length;
const baseTimePerChar = Math.min(
  this.maxCharIntervalMs,
  this.drainMs / remainingChars,     // ← 积压越多，每字越快
);
let timeToConsume = deltaTime;
let charsToAdd = 0;
while (timeToConsume >= baseTimePerChar && charsToAdd < frameLimit) {
  charsToAdd++;
  timeToConsume -= baseTimePerChar;
}
```

**语义**：目标是在 `drainMs` 毫秒内排空积压。积压多 → 每字快；积压少 → 退化为 `maxCharIntervalMs`。**结果是恒定的"排空时间"，而不是恒定的"打字速度"**。

| 参数 | 默认 | 含义 |
|---|---|---|
| `drainMs` | **250** | 排空积压的目标时间 |
| `maxCharIntervalMs` | **5** | 最慢每字间隔（积压少时的下限） |
| `maxCharsPerFrame` | `Infinity` | 每帧最多吐几个字 |
| `minCommitMs` | `0` | 可见文本最少多久提交一次（防 markdown 反复重解析） |

**两个精妙的边界处理**：

- `:270-277` —— 若**一帧都没画就 settle**，立即提交全文。注释原话：*"A pending frame that never runs would leave an empty bubble after settle."* ⇒ 防空气泡。
- `:99-103` —— 被 `maxCharsPerFrame` 截断的帧**不能把剩余时间存起来**，否则下一帧会突发越过上限。

**无障碍**（`:161-164`）：`prefers-reduced-motion: reduce` 时**自动禁用**、立即提交全文，且**优先级高于显式 `smooth={true}`**。

### 2.3 滚动：544 行状态机

- 接入层：`packages/react/src/primitives/thread/useThreadViewportAutoScroll.ts`（128 行）
- **算法本体：`packages/store/src/utils/thread-viewport-auto-scroll.ts`（544 行）**

它把"用户到底想不想跟着滚"拆成**四个独立状态位**（`:115-119`）：`isAtBottom` / `followBottom` / `followPaused` / `scrolledSincePause`。

关键判定（`:220-240`）区分了这些情况：

| 状态 | 含义 |
|---|---|
| `scrolledUp` | 用户上滚且内容在变长 |
| `escapedClamp` | 🔴 **浏览器 clamp 到底部** vs **真实上滚**的区分 |
| `inFlightDownward` | 正在进行的向下滚动意图 |

另有两条工程细节：

- **「用户刚向上滚」做成只活两帧的瞬态信号**（`:168-179`），专门解决平滑滚动的 scroll 事件延迟一帧到达
- `ResizeObserver` **逐个观察子元素** + `MutationObserver` 补新节点（`viewport-scroll.ts:57-80`），否则 CSS 高度动画、图片/字体加载、autosize textarea 全都感知不到

### 2.4 🔴 滚动锚定 × 入场动画的冲突（我们同样会踩）

`packages/react/src/primitives/thread/topAnchor/computeTopAnchorSlack.ts:34-35` 注释原文：

> *"Use layout geometry, not visual rects, so entrance transforms/animations on the anchor do not shift the scroll target while they settle."*

⇒ 它用 **`offsetTop` 累加**而不是 `getBoundingClientRect()`，因为**入场动画期间视觉 rect 会读到错误的 Y 坐标**。

**为什么这条对我们特别重要**：RN 的 `measureInWindow` / `measure` 同样是"视觉 rect"，而 `apps/mobile/src/ai/AssistantScreen.tsx:276` 已经在用 `measureInWindow` 做键盘偏移。**一旦给消息加入场动画，同一类错误就会在我们这里出现。**

### 2.5 入场动画与缺失项

- 助手消息：`thread.aui.tsx:690` — `fade-in slide-in-from-bottom-1 animate-in duration-150`
  ⇒ 仅 **150ms**、opacity + 4px translateY，非常克制
- 用户消息：`:878` 同款
- ❌ **无 stagger**（全仓搜 `stagger` 无相关命中）
- ❌ **无 spring**（无 stiffness/damping/mass 参数）
- ❌ **消息无退出动画**（只有浮层有 `animate-out`）

### 2.6 缓动（明显的债，别学）

三条曲线**全部硬编码字面量、40+ 处重复、未抽 token**：

| 曲线 | 用途 |
|---|---|
| `cubic-bezier(0.32, 0.72, 0, 1)` | 主力（位移/高度/折叠） |
| `cubic-bezier(0.23, 1, 0.32, 1)` | opacity/scale 按压 |
| `cubic-bezier(0.2, 0, 0, 1)` | 图标交叉淡入 |

时长梯度 150 / 200 / 300 / 500 / 700ms。唯一抽了 token 的是 `--animation-duration`（200ms），但它的值来自**三处各自独立的 `const ANIMATION_DURATION = 200`**（`reasoning.tsx:22`、`tool-group.aui.tsx:21`、`tool-fallback.aui.tsx:42`）——**值同但无单一事实源**。

### 2.7 🔴 它有官方 RN 绑定，但里面没有动效

`@assistant-ui/react-native`（`packages/react-native`）：

- description：*"React Native bindings for assistant-ui"*
- 依赖：只有 `core` / `store` / `tap` / `assistant-cloud` / `assistant-stream` —— **无动效库**
- primitives 含 `chainOfThought`（思维链）、`message`、`thread`、`composer`、`attachment` 等
- 🔴 **实测无可动效**：`grep -rn "useSmooth\|smooth\|Animated\|reanimated" packages/react-native/src` → **零命中**，也没有 `useSmooth` 的 RN 版文件

⇒ **这是本次调研最重要的一条边界**：连官方 RN 绑定都没把动效移植过去。**算法可学，代码不可搬。**

---

## 3. ant-design/x 取证（commit `da08db16`，MIT，4,843 stars）

### 3.1 打字机是真引擎，不是 CSS

位置：`packages/x/components/bubble/hooks/useTyping.ts`（`TypingContent.tsx:14` 只是个壳）

**RAF + 时间门槛**，不用 `setInterval`：

```js
if (now - lastActivedFrameTime < interval) {
  raf.current = requestAnimationFrame(fn);
  return;                          // 未到 interval 就空转，与刷新率解耦
}
const len = renderedData.current.length;
const _step = typeof step === 'number'
  ? step
  : Math.floor(Math.random() * (step[1] - step[0])) + step[0];  // 数组 = 随机步长
const nextText = content.slice(len, len + _step);
```

**默认参数**：`effect: 'fade-in'` / `interval: 100ms` / `step: 6` / `keepPrefix: true`

**中断与续打**（`:169-181`）——`taskId` 代际取消：

```js
if (animating.current && !content.startsWith(renderedData.current)) {
  cancelAnimationFrame(raf.current);          // 内容被整体换掉 → 打断
  requestAnimationFrame(() => excuteAnimation(++currentTask.current));
} else if (animating.current === false) {
  excuteAnimation(currentTask.current);       // 是旧内容的超集 → 续打
}
```

另有 **LCP 公共前缀保留**（`:12-21` 的 `getLCP` + `:99-101`）：重启动画时不复读已显示文本。

**"一次流式 = 一个动画周期"**（`:122-139`）：切完了但 `streaming` 仍为真 → 继续等下一批；`streaming === false` 才触发 `onTypingComplete`。

### 3.2 光标与加载态：纯 CSS、零 JS、零依赖

- **光标**（`bubble/style/index.ts:11-15`）：`content: "|"`、**0.8s**、`linear`、`infinite`，走 `cursorBlink` keyframes（opacity 1 → 0 → 1）
- **片段淡入**（`bubble/style/bubble.ts:105-110`）：`.fade-in` 挂 `fadeIn` keyframes、**1s linear**
- **加载三点**（`bubble/style/bubble.ts:112-138`）：三个 `<i>` 空标签 + `loadingMove` keyframes（Y 轴 `0 → 4px → 0 → -4px → 0`）、**2s**、`linear`、`infinite`，用 `nth-child` 的 `animationDelay: 0s / 0.2s / 0.4s` 做 **stagger**

⇒ **加载态是三个 div 加一个 keyframes，比引入动画库划算得多。**

### 3.3 折叠动效：全仓单一事实源

`packages/x/components/_util/motion.ts:19-31` 的 `initCollapseMotion`：

```js
const getCollapsedHeight = () => ({ height: 0, opacity: 0 });
const getRealHeight = (node) => ({ height: node.scrollHeight, opacity: 1 });
const getCurrentHeight = (node) => ({ height: node.offsetHeight });
// ...
motionDeadline: 500,
```

- 🔴 **高度必须实测**：`node.scrollHeight` 注入 inline height，`height: 0 → 实测px` 才可过渡。**绝不写死 `max-height`。**
- `skipOpacityTransition`（`:16-17`）：`propertyName === 'height'` 或 `deadline === true` 时提前收尾，不等 opacity 也跑完
- `motionDeadline: 500` —— 兜底，防 CSS 事件丢失导致组件**永久卡在动效态**
- transition 在 `style/motion/collapse.ts:14-18`：`height` 与 `opacity` 各一条，都用 `motionDurationMid` + `motionEaseInOut`

### 3.4 token 数值（公式在 antd，不在 x 仓）

| token | 值 |
|---|---|
| `motionDurationFast` | 0.1s |
| **`motionDurationMid`** | **0.2s** |
| `motionDurationSlow` | 0.3s |
| **`motionEaseInOut`** | **`cubic-bezier(0.645, 0.045, 0.355, 1)`** ← 折叠/旋转首选 |
| `motionEaseOut` | `cubic-bezier(0.215, 0.61, 0.355, 1)` |

🔴 **token 之外硬编码的**（说明它也没那么干净）：`0.8s`（光标）、`1s`（fade-in）、`2s`（loading）、`0.2/0.4s`（stagger delay）、`500ms`（deadline）、`100ms`（typing interval）。

### 3.5 🔴 最值得借的机制：`motion: false` 全局降级

`theme/util/alias.ts:36-41` —— `mergedToken.motion === false` 时把三个 duration **全置 `'0s'`**，**一处开关关掉全部过渡**。

⇒ 这和我们 `packages/ui` 的 `reducedMotion` 是**同一个问题的两种解法**。我们的做法（每个组件各自判 `theme.reducedMotion`）更细但更容易漏；它的做法（统一把时长归零）更省事但更粗。**可以组合**：保留我们的订阅，但增加一个"全局时长归零"的兜底。

### 3.6 `@rc-component/motion` 原语机制

抽象是：**「状态 → class 名 → CSS 负责画，JS 只切状态和判结束」**。

- 4 状态（`appear`/`enter`/`leave`/`none`）× 4 阶段（`prepare`/`start`/`active`/`end`）
- **双类激活法**：`.x-enter` 单独存在时 `animation-play-state: paused`，`.x-enter.x-enter-active` 才 `running`
  ⇒ 解决**"同类名重复挂载不重播"**
- `motionDeadline`：到点伪造 `{deadline: true}` 事件强制收尾
- `removeOnLeave`（默认 `true`）：离场后卸 DOM；`false` 则换成 `leavedClassName` 的壳
- `CSSMotionList`：调用方只管传 keys，diff（`ADD`/`KEEP`/`REMOVE`）与 enter/leave 它自己做

---

## 4. 对照表

### 4.1 六个维度逐项对照

| 维度 | ant-design/x | assistant-ui | **heyta 现状** | 差距 |
|---|---|---|---|---|
| **流式逐字** | RAF + 固定 `interval:100/step:6`，taskId 代际取消 | 🔴 RAF + **自适应追赶** `drainMs=250`，`minCommitMs` 节流 | 🔴 **无**（`live.text` 整段直出） | **最大缺口** |
| **光标** | ✅ `"|"` 0.8s blink（纯 CSS token 可改） | ❌ 不自研，透传 `streamdown` 的 `caret` prop | ❌ 无 | 大 |
| **加载/思考态** | ✅ 三 `<i>` + `loadingMove` 2s + `0.2/0.4s` stagger，**纯 CSS 零 JS** | ✅ `animate-pulse` + shimmer；`key={label}` 重挂重放 | ⚠️ 纯文字 `ai-assistant-waiting`（`AssistantPanel.tsx:1042`） | 中 |
| **折叠/思维链** | ✅ `initCollapseMotion`，`scrollHeight` 实测高度 + `motionDeadline 500` | — | ⚠️ `ReasoningRow`（`AssistantPanel.tsx:1151`）用原生 `<details>`，**无高度动画** | 中 |
| **滚动锚定** | 双层 `scroll-box/content` + `ResizeObserver` + `smooth` | 🔴 **544 行状态机**，四状态位 + 瞬态信号 | ⚠️ `revealLatest()` 滚到底；**流式 delta 不触发** | 中 |
| **无障碍降级** | ✅ `motion:false` → duration 全 `0s`（一处开关） | ✅ `prefers-reduced-motion` 优先级高于显式开启 | ✅ **已有** `reducedMotion`（`theme.tsx:170-186`），各组件都判 | **持平/领先** |
| **token 体系** | ⚠️ 有 token 但多处硬编码 | ❌ 缓动 40+ 处重复，无单一事实源 | ✅ **7 档时长 + 4 条曲线 + spring 组** | **我们领先** |

### 4.2 🔴 RN 可行性判定（决定能不能学）

| 手法 | 来源 | RN 可行性 | 我们的等价物 |
|---|---|---|---|
| RAF 逐字节奏 | 两库均有 | ✅ **完全可行** | RN 有 `requestAnimationFrame` |
| `drainMs` 自适应追赶 | assistant-ui | ✅ **完全可行** | 纯算法，无平台依赖 |
| `minCommitMs` 节流 | assistant-ui | ✅ **完全可行** | 同上 |
| taskId 代际取消 | antdx | ✅ **完全可行** | 闭包 + `useRef` |
| LCP 前缀保留 | antdx | ✅ **完全可行** | 纯字符串算法 |
| 光标 blink | antdx | ⚠️ 需改写 | `Animated.loop` + `opacity` 插值（RN 无 CSS 动画） |
| 加载三点 stagger | antdx | ⚠️ 需改写 | 三个 `Animated.Value` + `delay` |
| `scrollHeight` 测高 | antdx | ✅ **有现成先例** | **`onLayout`**（仓库已用 6 处，如 `CalendarBoard.tsx:271`） |
| `getBoundingClientRect` 避坑 | assistant-ui | ✅ **同样适用** | RN 的 `measureInWindow` 有同样问题（`AssistantScreen.tsx:276` 已在用） |
| 544 行滚动状态机 | assistant-ui | ⚠️ 需按 RN 重写 | `onScroll` + `onContentSizeChange` |
| CSS keyframes | 两库 | ❌ **不可用** | 必须改 `Animated` |
| `CSSMotionList` | antdx | ❌ 不可用 | 需自己写列表 diff |

**判定结论**：
- ✅ **算法类全部可学**（逐字节奏、自适应追赶、代际取消、前缀保留、实测高度）
- ⚠️ **表现类需改写**（CSS → `Animated`）
- ❌ **代码一行不能照搬**

---

## 5. 落地建议（供后续重写参考，**本次未改任何代码**）

### 5.1 建议的优先级

| 优先级 | 做什么 | 依据 | 预估 |
|---|---|---|---|
| **P0** | 流式逐字引擎（`drainMs` 自适应 + 代际取消 + reduce 降级） | §2.2 算法可直接学；我们数据层已就绪 | 小 |
| **P0** | 流式期间滚动跟随（修 `[items.length, phase]` 依赖） | §1.6 实测缺口 | 小 |
| **P1** | 光标 + 加载三点（RN `Animated` 改写） | §3.2 | 小 |
| **P1** | 统一 RN 侧缓动取值（修 `SwipeReveal.tsx:143-145` 过时注释） | §1.3 缺口 A | 小 |
| **P2** | 思维链折叠高度动画（`onLayout` 替代 `scrollHeight`） | §3.3 + §4.2 | 中 |
| **P2** | 统一弹簧模型（token 的 damping/response vs 代码的 stiffness/damping/mass） | §1.3 缺口 B | 中 |
| **P3** | 移动端接流式 | §1.5 mobile 无流式 | 大 |

### 5.2 需要新增的 token（草案）

若要给流式动效建 token，按 `design-system.md`「要新变量必须先加 token」的要求，建议：

```
--ht-duration-stream-drain: 250ms;     /* 排空积压的目标时间（assistant-ui drainMs 默认） */
--ht-duration-stream-char-max: 5ms;    /* 每字最慢间隔（maxCharIntervalMs 默认） */
--ht-duration-caret-blink: 800ms;      /* 光标闪烁周期（antdx 实测 0.8s） */
--ht-duration-typing-dots: 2000ms;     /* 加载三点周期（antdx 实测 2s） */
--ht-duration-typing-stagger: 200ms;   /* 三点错峰（antdx 实测 0.2s） */
--ht-duration-msg-enter: 150ms;        /* 消息进入（assistant-ui 实测 150ms） */
```

⚠️ **这只是草案，不是定稿**：数值需在真实设备上调，且要过对比度/时长门禁。

### 5.3 明确不建议做的事

- ❌ **不要装 `framer-motion` / `rc-motion` / `reanimated`**：前者是 DOM 专属，后两者会让 `packages/ui` 失去"单份代码双端"的能力
- ❌ **不要照搬 CSS keyframes 方案**：`packages/ui` 里没有 CSS
- ❌ **不要照搬 assistant-ui 的滚动状态机 544 行**：它解决的是 DOM clamp 问题，RN 无对应场景；**学它的状态划分思路即可**
- ❌ **不要学它们的 token 体系**：我们已有的更严谨。**学引擎，不学 token**

---

## 5b. 实施结果（2026-11-10 回填）

> 本节在 §5 的建议落地**之后**补写，用于记录"实际做了什么、与建议差在哪、实施中发现的新事实"。
> §5 本身保持原样（它是当时的判断，不该被结果改写）——两者差异本身是信息。

### 做了的

| 项 | 状态 | 提交 |
|---|---|---|
| P0 流式逐字揭示引擎（`drainMs` 自适应 + 代际取消 + reducedMotion 降级） | ✅ | `9467ade6` |
| P0 流式期间滚动跟随（修依赖数组；用户上滚即停止跟随） | ✅ | `9467ade6` |
| P1 等待态三个跳动点 | ✅ | `0325d610` |
| P1 流式光标 | ✅ | `eb4f2dc3`（组件/测试）+ `6232f149`（渲染接线） |
| P1 统一 RN 侧缓动（`SwipeReveal` 过时注释） | ✅ | `e05c3793` |
| P1 收敛 mobile 三处裸缓动 | ✅ | `a3703bee` |
| P2 思维链折叠高度动画 | ✅ | `d4160864` |
| P2 统一弹簧模型（token ↔ `stiffness/damping/mass` 换算） | ✅ | `9a1008ac` |
| P3 移动端流式（逻辑层 + 状态 + 渲染 + 接线） | ⏳ **差一步** | `380d3416` / `6232f149` |

### 与 §5 建议的差异（以及为什么）

| §5 建议 | 实际做的 | 差异原因 |
|---|---|---|
| 建议新增 6 条 token（`--ht-duration-stream-drain` 等） | **一条都没加** | §5.3 自己写着"不要学它们的 token 体系"。实施时确认了这条判断是对的：复用既有 `--ht-duration-*` / `--ht-ease-*` 已足够，而新增 token 要过 `check:design` 门禁、且要证明"只此一处用"。节奏参数（250/5ms）留作引擎常量，它们是**算法参数**不是**设计变量** |
| 建议 P3"移动端接流式"（隐含：直接做） | **只做到差一步** | 实施中发现真正的障碍不是"没做"而是**RN 的 `fetch` 响应没有可读 body**。解法（XHR 增量）已写出且可测，但**只能真机验证**——先接上再让用户在真机上发现问题，比"没做"更糟 |

### 🔴 实施中发现的新事实（§1-4 里没有的）

1. **移动端其实有 `TextDecoder`**。§1 曾推断"Hermes 缺 `TextDecoder` 所以移动端读不了流"——**错了一半**：`apps/mobile/index.js` 装了 `fast-text-encoding` polyfill。真正的障碍只有一条：**`fetch` 响应没有可读 `body`**。
2. **`packages/ui` 的使用方与 SSR 兼容**。`realClock()` 在 `requestAnimationFrame` 缺席时返回 `null`，此时降级为"到达即显示"而不是抛错。
3. **`<HeytaUiProvider reducedMotion>` 这个 prop 在嵌套场景下会被外层盖掉**（`theme.tsx` 的"外层已有主题就沿用"逻辑）。要测"某个偏好下的渲染"必须用 `value` 显式传主题。这个坑让一条测试**假绿**过，是变异测试抓出来的。
4. **RN 的 `ViewStyle` 不接受 `em` 单位**（`DimensionValue` 只认数字与百分比）。写 `height: '1em'` 直接 typecheck 报错 —— 光标的字号因此必须是入参。
5. **`react-native-web` 把静态样式编译成 CSS class**，`style` 属性里只剩动态值。所以测"某个样式属性"要断 class 名，不能读 `style.height`。
6. **RN 的 `requestAnimationFrame` 在后台不触发**（`apps/mobile/src/lib/card-export-units.ts:94` 已有此实测记录）。对揭示引擎的含义：切后台再回来会"卡在半截"，但内容最终会追上。
7. **`reduceAssistantLive` 已下沉到 `@heyta/app-host`**（`e4f32e0d`）。§5 没预料到这一步 —— 移动端接流式时发现它住在 `apps/web`，而 AGENTS.md 规定业务语义只许在 `packages/`，所以顺手下沉，避免抄第二份。

### 判据方法上的一处收获

**变异测试抓出了三条"测不到东西的判据"**，它们全都是第一次写对、实际假绿的：
- `reveal.ts` 的"截断帧不结转时间"——纯函数结构下该情况不可能发生，删掉归零语句行为不变
- `follow-scroll.ts` 的"内容短于视口提前返回"——与正常路径等价，是死代码
- 光标的"reducedMotion 下仍渲染"——`<HeytaUiProvider reducedMotion>` 被外层 context 盖掉，实际测的是 `reducedMotion=false`

⇒ **可复用的结论**：写完一条判据后，故意改坏对应实现看它是否变红。这三条若没有这一步，会以"已覆盖"的姿态留在仓库里。

---

## 6. 未发现 / 存疑（诚实记录）

| 项 | 状态 |
|---|---|
| assistant-ui 消息**退出**动画 | ❌ 未发现（只有浮层有 `animate-out`） |
| assistant-ui 消息 **stagger** | ❌ 未发现 |
| assistant-ui **spring** 物理动画 | ❌ 未发现（无 stiffness/damping/mass） |
| antdx `thought-chain` 列表 **stagger** | ❌ 未发现（逐项各自独立，无 index 递增 delay） |
| antdx `BubbleList` 列表增量动画 | ❌ 未发现（普通 `map`，无 `CSSMotionList`） |
| antdx 是否有 `setTimeout` 驱动的打字机 | ❌ 未发现（全走 RAF） |
| `@rc-component/motion` 版本差异 | ⚠️ x 声明 `^1.1.6`，实测仓库 HEAD 是 `1.3.3`；**1.1.x 与 1.3.x 的行为差异未核对** |
| antd token 公式 | ⚠️ `motionDuration*` 的公式在 **antd 仓**（`genCommonMapToken.js:11-13`），x 仓内没有；数值经 `antd@6.7.0` 核对 |
| 移动端流式改造的可行性 | ⚠️ 未评估（本次只做调研） |

---

## 7. 复核方式

```bash
# 环境（GitHub 需代理）
export https_proxy=http://127.0.0.1:65411 http_proxy=http://127.0.0.1:65411 all_proxy=socks5://127.0.0.1:65411

# 重建两个上游副本（/tmp 会被清理）
git clone --depth 1 https://github.com/assistant-ui/assistant-ui.git /tmp/aui-work/assistant-ui
git clone --depth 1 https://github.com/ant-design/x.git /tmp/antdx

# ── assistant-ui 核心 ──
sed -n '47,48p;87,98p;161,164p;270,277p' /tmp/aui-work/assistant-ui/packages/react/src/utils/smooth/useSmooth.ts
sed -n '30,40p' /tmp/aui-work/assistant-ui/packages/react/src/primitives/thread/topAnchor/computeTopAnchorSlack.ts
sed -n '220,240p' /tmp/aui-work/assistant-ui/packages/store/src/utils/thread-viewport-auto-scroll.ts
grep -rn "useSmooth\|Animated" /tmp/aui-work/assistant-ui/packages/react-native/src   # 应为空

# ── ant-design/x 核心 ──
sed -n '48,53p;112,121p;169,181p' /tmp/antdx/packages/x/components/bubble/hooks/useTyping.ts
sed -n '10,31p' /tmp/antdx/packages/x/components/_util/motion.ts
sed -n '11,15p' /tmp/antdx/packages/x/components/bubble/style/index.ts
sed -n '105,138p' /tmp/antdx/packages/x/components/bubble/style/bubble.ts

# ── 本仓库现状 ──
wc -l packages/ui/src/ai/*.tsx
sed -n '294,315p;966,975p;1151,1162p' apps/web/src/features/ai/AssistantPanel.tsx
sed -n '160,195p' packages/ui/src/theme.tsx
sed -n '140,150p' packages/ui/src/task-list/SwipeReveal.tsx
sed -n '270,286p' packages/ui/src/overlay/BottomSheet.tsx
sed -n '355,395p;665,700p' packages/design-system/src/tokens.css
```

---

## 8. 来源与合规

| 项目 | 版本/commit | License | 是否引入依赖 |
|---|---|---|---|
| assistant-ui | `29638c4e473a1c1bc453087e90321874c958adbb` | **MIT** | ❌ **未引入**（仅只读调研） |
| ant-design/x | `da08db16714b608d7f5db248c2b2fcc30a756660` | **MIT** | ❌ **未引入** |
| @rc-component/motion | HEAD `3b408508`（package.json `1.3.3`） | MIT | ❌ **未引入** |

🔴 **本次为纯只读调研**：未修改任何仓库代码、未新增任何依赖、未触发许可证门禁。
若后续要**复制代码进产物**，须走 `AGENTS.md` §3.2 登记进 `THIRD_PARTY_LICENSES.md`；
若要**引入依赖**，须先过 §3.1 可维护性 + §3.2 许可证两道门。
本文件记录的是**手法与算法**，实现由我们按自己的 token 体系重写。
