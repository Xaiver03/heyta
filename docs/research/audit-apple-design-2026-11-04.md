# heyta 设置页界面审计 —— Apple Design 方法论逐条核对

> 审计对象：`apps/web/src/features/settings/` 下的设置面板（账号 / 订阅 / 数据与同步 / 提醒与通知 / 外观与语言 / 功能与 AI / 关于与帮助）
> 方法论：`~/.agents/skills/apple-design/SKILL.md`（源自 WWDC *Designing Fluid Interfaces*、*The Details of UI Typography*、*Principles of Great Design*）
> 审计日期：2026-11-04
> 判据基线：设计系统真源 `packages/design-system/src/tokens.css`、规则 `design-system/heyta/MASTER.md`
> 主题前提：应用为**本地优先 + 暗色为主**的桌面应用（Electron/Tauri + Web），不是 iOS 手势应用。审计已按此调整权重：手势/动量类原则按"是否适用"标注，界面结构 / 反馈 / 材质 / 排版 / 无障碍类原则按 Web 现实严格核对。

---

## 0. 总体结论（先看这一页）

这份代码**不是**一个"随手糊的表单"。它在多数 Apple 关心的**软性维度**上做到了工业级水准：

- **反馈的诚实性**（每个失败原因单独成句、`role="status"`/`role="alert"`、`aria-live`、冷却期"动作直接不存在"）—— §16 Craft/Responsibility 上属于第一梯队。
- **对比度 / 暗色 / 触控目标**—— 由测试实算保证，暗色文字梯子明确审计过（`tokens.css:129-138`）。
- **prefers-reduced-motion / prefers-reduced-transparency**—— 有全局降级（把时长压到 1ms、把 tint 压成实色），做法正确（"压值不删属性"）。
- **token 纪律 / 语义分层**—— 面板里零裸值、协议知识与文案严格外置，是可辩护的架构。

**但按 Apple"流体界面"的那一整套物理观感去量，它系统性地缺了三样东西**，而且缺得很有规律——全都指向同一个根因：**这套设计把"诚实的文字反馈"当成了唯一反馈通道，而没有把"按下即回应 / 连续动效 / 材质层次"当成一等公民**：

1. **加载态的指示器不会转。** 设置面板里的 17 处 `Loader2`（已逐文件清点）是 lucide 的静态残月图标，既没挂旋转动画，`WidgetPushPanel` 依赖的 `.ht-spin` 类**在全仓没有 CSS 定义**。"正在处理"只剩文字变了，图标是个死圈。→ 直接违反 §1「反馈要在交互过程中连续给出」。
2. **进入动了，出去没动；而且进来的方向和文件头声称的方向相反。** `.ht-sheet` 只有 `ht-sheet-in`（从下方 8px 淡入），卸载时**瞬间消失**；而 `sheets.css:3` 的文件头写的是"从右侧滑出"。→ 违反 §7「进入与退出走同一条路」。
3. **危险流程里出现了一个"长得像说明文字"的按钮和一枚"重量不对"的确认键。** `CloseAccountPanel` 用了**根本不存在的 `.ht-btn--outline`**（注销第一步的按钮 = 无底无 hover = 读起来是文字），而最终的"确认注销"用的是**行内档** `--danger`（透明底红字），比它上面那颗"坏掉的 outline"还轻。→ 违反 §16 Agency/Responsibility 的"危险确认要比取消更重"，也违反本仓自己的"grep `ht-btn--outline` 应当有定义"。

其余是密度较低、但每一条都有具体落点的中/低危项，逐条在下面 §1–§17 + HIG 清单里给出。

### 严重度分布

| 级别 | 含义 | 条数 | 编号 |
|---|---|---|---|
| 🔴 高 | 用户一眼看得出来 / 直接违背 skill 核心判据 / 有死样式或死类 | 4 | F-01, F-02, F-03, F-04 |
| 🟠 中 | 观感/层级/一致性缺陷，长期侵蚀"精致感" | 7 | F-05 ~ F-11 |
| 🟡 低 | 锦上添花 / 前提受限（桌面、无手势）/ 需权衡 | 6 | F-12 ~ F-17 |

### 问题索引（速查）

| 编号 | 一句话 | 主要落点 | § | 级别 |
|---|---|---|---|---|
| F-01 | Loader2 不旋转，忙态无动效 | 各面板 `<Loader2>`；`.ht-spin` 未定义 | §1/§11/§16 | 🔴 |
| F-02 | 注销第一步按钮用了不存在的 `.ht-btn--outline` | `CloseAccountPanel.tsx:174` | §12/§16/HIG按钮 | 🔴 |
| F-03 | 设置浮层进入有动画、退出无动画；方向与注释不符 | `sheets.css:20,479-494` | §3/§7 | 🔴 |
| F-04 | 最危险动作的确认键用了"行内档"红字，重量低于它上面的按钮 | `CloseAccountPanel.tsx:189` | §16/按钮层级 | 🔴 |
| F-05 | 侧栏导航链接只有 hover，无按下即回应 | `sheets.css:54-77` | §1/§10 | 🟠 |
| F-06 | 子标题排版档位不统一（row-title vs section-title vs headline） | `EmailChangePanel.tsx:186,197` | §15/§16 | 🟠 |
| F-07 | 成功反馈与提示文字同色同档（都是 muted），语义分不开 | `ai-panels.css:390-417` | §16反馈 | 🟠 |
| F-08 | 结果 toast/notice 用 11px（2xs）——状态类文字太小 | `ai-panels.css:414-417` | §15/HIG | 🟠 |
| F-09 | 设置浮层未做 `overscroll-behavior` 收敛（可串滚） | `sheets.css:13-21` | §6/§9 | 🟠 |
| F-10 | 未响应 `prefers-contrast: more` | 全仓无 | §14 | 🟠 |
| F-11 | "?" 说明瞬时弹出，无 500ms hover 延迟，划过即触发 | `SettingsInfoTip.tsx:57,67` | §10 | 🟠 |
| F-12 | 主题切换为瞬切（亮度跳变），未做交叉淡入 | `theme.ts:51-53` | §14 | 🟡 |
| F-13 | 内容面把 sheet 做成实色、无材质层次（有意为之，但与 skill 有张力） | `sheets.css:13-21` | §12 | 🟡 |
| F-14 | 一屏多枚 primary（AI / 订阅 / 数据），与本仓"每屏一枚主 CTA"口径冲突 | `AiSettings.tsx:1182,1205` 等 | §16简洁 | 🟡 |
| F-15 | 原生 checkbox/radio 本体 < 44px（靠 label 兜底） | `CloseAccountPanel.tsx:156` | HIG触控 | 🟡 |
| F-16 | sheet 窄屏无 `env(safe-area-inset-*)` 底部留白 | `sheets.css:13,436-445` | HIG安全区 | 🟡 |
| F-17 | 按下反馈时长正确，但 `.ht-btn` 过渡里带了永远用不到的 `border-color` | `controls.css:34-39` | §4/§11 | 🟡 |

---

## §1 Response —— 消除延迟

**Skill 要求**：在 pointer-down 就回应，不是 release；警惕输入路径上的一切延迟（debounce、定时器、过渡等待、~300ms tap 延迟）；反馈要在交互**过程中**连续给出，不能只在结束时给。

### ✅ 做得对的地方（要点名表扬，否则报告失真）

- **按下即反馈是有的，而且只动合成器属性。** `controls.css:173-175`：
  ```css
  .ht-btn:active:not(:disabled) { transform: scale(var(--ht-motion-press-scale)); }
  ```
  `--ht-motion-press-scale: 0.97`、`--ht-duration-press: 100ms`（`tokens.css:321,637`），注释原话就引了"Apple《Designing Fluid Interfaces》—— 反馈必须在按下那一刻出现"。这是全仓最贴合 §1 的一段，且 `:active` 在 pointer-down 触发，符合"highlight on touch-down"。
- **头像"换一张"直接 `fileRef.current?.click()`**（`ProfilePanel.tsx:375`）—— 无人为延迟。
- **忙态用 guard 而非 disabled**（`PasswordPanel.tsx:282-283`、`EmailChangePanel.tsx:312-314`）—— 避免了"禁用把焦点甩掉"的老问题，符合"不要为了防重复点而吃掉即时性"。
- 输入路径上**没有 debounce、没有防抖定时器**（已 grep 全 settings 目录确认，唯一 `setInterval` 是换邮箱倒计时 `EmailChangePanel.tsx:172`，在反馈路径之外）。

### 🔴 F-01：所有加载指示器不转 —— 忙态反馈"断"了（HIGH）

**证据**（全部为静态 `Loader2`，无旋转动画）：
- `ProfilePanel.tsx:378,391`（换头像/删头像 busy）
- `EmailChangePanel.tsx:226,269,325`
- `PasskeyPanel.tsx:216,235,358,389,433`
- `PasswordPanel.tsx:424,525,542`
- `SessionsPanel.tsx:153,175,269`
- `WidgetPushPanel.tsx:227` 写了 `className="ht-spin"`，但 **`.ht-spin` 在全仓 CSS 里没有任何定义**（已用 `grep -rn ht-spin apps/web/src/styles/ packages/design-system/` 验证，退出码 1；仅 `packages/ui/src/sync/SyncStatusBar.tsx:39` 的注释提到"迁之前 web 用 `<Loader2 className="ht-spin">`，圈是靠页面 CSS 动画"——即这条动画在迁移中被删掉了，类名成了悬空引用）。

`apps/web/src/styles/` 里唯一的旋转动画是 `@keyframes ht-rail-sync-spin`（`rail.css:285`），它绑在 `.ht-rail__sync__spin` 上，不在按钮里。

**Gap**：§1 明确要求"反馈在过程中连续给出"。这里的过程反馈**只剩按钮文案从「换一张」变成 spinner + 文字**，而 spinner 是一枚静止的残月（lucide `Loader2` 本身是静态 SVG，不自转）。用户按下去之后看到的是"一个不转的圈"——这在观感上等价于"卡住了"，恰恰是 Apple 说的"发木（falls off a cliff）"的反面教材。**同时 `WidgetPushPanel` 的 `ht-spin` 是一个不能失败的死引用**：它期望有个 CSS 让它转，结果没有。

**修复**：给设置面板统一一个真正旋转的 spinner，并把 `ht-spin` 补回定义（复用既有 token，不新增裸值）。
```css
/* apps/web/src/styles/app/controls.css 末尾补 */
.ht-spin {
  animation: ht-spin-rotate calc(var(--ht-duration-slow) * 2) linear infinite;
  transform-origin: center;
}
@keyframes ht-spin-rotate { to { transform: rotate(360deg); } }
/* reduced-motion 下不转圈，但保留图标（文案已经说明"正在处理"） */
@media (prefers-reduced-motion: reduce) {
  .ht-spin { animation: none; }
}
```
然后把所有设置面板的 `<Loader2 size={ICON_SIZE.xs} aria-hidden="true" />` 统一加 `className="ht-spin"`：
```tsx
<Loader2 size={ICON_SIZE.xs} className="ht-spin" aria-hidden="true" />
```
（更彻底的做法：把"忙态图标"抽成一个 `Spinner` 组件，避免"17 处各写各的、漏一处不会报错"——这正是本仓 §3.5 反复交学费的形状。）

**根因**：这套设计把"诚实的文字"当成了反馈的全部，动效被视为可选装饰，于是状态机做对了（busy 态真的存在），但**表征 busy 的那个视觉元素是一个不会动的图标**。文字在解释"我在忙"，画面在暗示"我没动"——两个通道打架。

---

## §2 Direct manipulation —— 1:1 跟手

**Skill 要求**：拖拽时元素与手指贴合，尊重抓取点偏移；用 Pointer Events + `setPointerCapture`；维护速度/位置历史。

**settings 面板本身没有自定义拖拽手势**——它是表单 + 卡片，不存在"拖一个东西"。所以 §2 对本页基本 **N/A（正确判断，不是遗漏）**。唯一两处"直接操作"在设置页之外：侧栏/详情列拖拽把手（`base.css`/`sidebar.css` 的 `ColumnResizer`）与 rail 排序（`RailNavigation.tsx` dnd-kit）。

**顺带一处（不算违规，记一笔）**：`ai-panels.css:977-981` 的 `.ht-ai__input { resize: vertical }` 用的是**浏览器原生 textarea 拖拽缩放**。原生 resize 是 1:1 跟手的、可接受；但它没有把拖拽结果持久化到设备本地（刷新回默认），而侧栏拖拽是有持久化的——**同为"拖拽改变尺寸"，一处记、一处不记**，是 §16「Familiarity/一致性」上的一个小裂缝（低危，前提受限：AI 输入框尺寸本就是临时的）。

---

## §3 Interruptibility —— 可打断（最重要的原则）

**Skill 要求**：任何动画都必须能在中途被抓住、被反向；绝不锁住输入；永远从**呈现值（当前屏上值）**起步，不从目标值起步；手势驱动的东西避免 CSS transition/@keyframes。

**现状**：设置页里唯一的"位移动画"是 sheet 入场（`ht-sheet-in`，§7 会算总账）。它是一次性 `@keyframes`，200ms，跑完即止，期间**不锁输入**（sheet 内容立即可交互，因为入场只动 `opacity/transform`，不挡点击）——这点是对的。

**🟡 观察（不升级为缺陷）**：因为设置页没有可被"抓住再拖"的连续动画（sheet 不可拖拽关闭，见 §6），所以 §3 的核心判据"从呈现值重新起步""re-target 时blend速度"在本页**无用武之地**。真正需要 §3 的是搜索浮层/侧滑那些带手势的表面。设置页把 sheet 做成"要么开要么关、不可中途抓住"，在这个前提下反而是**可辩护的简化**——代价是没有流体感，换来的是实现简单。**但这正是它与 Apple 流体理念的根本差距**：Apple 会说"设置浮层应当能被手指抓住往回拖"。

---

## §4 Behavior over animation —— 用弹簧

**Skill 要求**：用户能碰的东西优先用弹簧；默认 damping 1.0（不过冲），只有手势本身带动量才 ~0.8；用 damping+response 思考，不是 duration。

**✅ 设计系统层面这一条做到了满分**：`tokens.css:626-645` 原样把 Apple 的 damping/response 参数落了地，注释直接引 WWDC 2018：
```css
--ht-motion-spring-damping-default: 1;
--ht-motion-spring-damping-momentum: 0.8;
--ht-motion-spring-response-move: 0.4;
--ht-motion-spring-response-sheet: 0.3;   /* 抽屉/底部面板，与 skill 表格一致 */
--ht-motion-deceleration-rate: 0.998;
--ht-motion-rubber-band-constant: 0.55;
```
而且 `sheets.css:554-561` 的搜索卡片入场**显式消费** `--ht-motion-spring-response-sheet` 并把注释讲清楚了"damping=1.0 所以不过冲，ease-enter 正是临界阻尼在 CSS 里的正确形状，ease-spring 的过冲只属于带速度的手势"——这段论证与 skill 逐字同调。

**🟡 F-17（LOW）：一处过渡属性是死代码。** `controls.css:34-39` 的 `.ht-btn` 过渡里列了 `border-color`：
```css
transition:
  background-color var(--ht-duration-fast) var(--ht-ease-standard),
  color var(--ht-duration-fast) var(--ht-ease-standard),
  border-color var(--ht-duration-fast) var(--ht-ease-standard),
  transform var(--ht-duration-press) var(--ht-ease-standard);
```
但按钮**没有边框**（borderless 裁决，`MASTER.md:11-19`；`.ht-btn` 也不设 border）。过渡一个恒为 `none` 的属性是无意义成本。且 `--ht-ease-standard: cubic-bezier(0.2,0,0.2,1)`（`tokens.css:340`）作为 hover/press 曲线是合适的。非阻塞，属精致度。**建议删掉 `border-color` 那一条**。

**关于时长本身**：`--ht-duration-fast:150 / normal:200 / slow:300 / exit:140 / instant:80 / press:100`（`tokens.css:313-321`）——"退出比进入快"（exit 140 < normal 200）在**参数层**是设了的；但设置页里 sheet 没有用到 exit（见 §7）。

---

## §5 Velocity handoff（拖↔动交接）—— N/A

设置页无"拖完释放接动画"的手势，正确不适用。**注意**：参数层已经把速度交接所需的原料备齐（`response-sheet`、`deceleration-rate`），说明设计系统的作者懂这一条，只是设置页用不上。

---

## §6 Momentum projection —— 动量投影 / 底部面板

**Skill 要求**：用速度**投影**落点（`current + (v/1000)·d/(1−d)`），不要从释放点就近吸附；这条是好的 bottom-sheet / carousel 的标准。

**现状**：设置是 `position:absolute; inset:0` 铺满内容区的整面浮层（`sheets.css:13-21`），**不可拖拽、无把手、无分页**，所以不存在"甩一下投到哪一档"的场景。§6 对本页 **N/A（合理）**。

**🟠 F-09：sheet 没有 `overscroll-behavior` 收敛（MEDIUM）**
`.ht-sheet { overflow-y: auto }`（`sheets.css:17`）——**未设 `overscroll-behavior: contain`**。对照本仓自己在其它滚动容器上的纪律：`ai-panels.css:706` `.ht-ai__conversation{overscroll-behavior:contain}`、`growth.css:77` `overscroll-behavior-inline:contain`。设置浮层滚到底继续拉，会把滚动**串联到背景那一层**（虽然 shell 钉死了整页不滚，但在内嵌 shell/移动端 WebView 里，滚到底的过量滚动会外溢成浏览器级 rubber-band / 甚至触发回弹）。Apple 的判据是"边界要软、且不越界打扰别层"。
```css
.ht-sheet { overscroll-behavior: contain; }   /* 与其它滚动面同一条纪律 */
```
**根因**：sheet 早于 overscroll 纪律定型，补纪律时没回扫这一格。

---

## §7 Spatial consistency —— 空间一致（对称路径 / 锚定）

**Skill 要求**：进入与退出走**同一条路**（从右进必从右出）；把交互锚定到触发件（`transform-origin` 对准 trigger）；可逆过渡镜像缓动曲线。

**🔴 F-03：进入有动画，退出没有；方向与文件头自相矛盾（HIGH）**

证据：
- `sheets.css:13-21` `.ht-sheet` 有 `animation: ht-sheet-in var(--ht-duration-normal) var(--ht-ease-enter)`。
- `sheets.css:479-488` `@keyframes ht-sheet-in { from{opacity:0;transform:translateY(var(--ht-space-2))} to{opacity:1;transform:none} }`——**从下方 8px 淡入向上**。
- **没有对应的 out/exit keyframe**。sheet 是在 `App.tsx` 里 `{view === 'settings' ? <sheet/> : …}` 条件渲染，关闭 = 直接卸载 → **瞬间消失，无退场**。
- 而文件头 `sheets.css:3-9` 写的是"设置是**从右侧滑出**的浮层（对照滴答实测）"。**注释说从右，代码做的是从下淡入。** 这两件事在 §7 里都是问题：方向不对（没兑现 IA 承诺），且进出不对称。

**Gap**：§7 原话"如果某个东西朝一个方向消失，我们期待它从它来的地方出现"。这里"出现"动了、"消失"不动——用户关掉设置时画面是硬切；而且声称的空间隐喻（右侧滑出）与实际动效（下方淡入）不符，等于把"东西从哪来"这件事告诉错了用户。

**修复（两选一，先对齐方向）**：
1. 若要兑现"右侧滑出"（符合滴答、也符合 `base.css:176-191` 把详情列整根退场给设置让位的"右侧浮层"心智）：
```css
@keyframes ht-sheet-in  { from { opacity:0; transform:translateX(var(--ht-space-6)); } to { opacity:1; transform:none; } }
@keyframes ht-sheet-out { from { opacity:1; transform:none; } to { opacity:0; transform:translateX(var(--ht-space-6)); } }
```
2. 若维持"下方淡入"，则文件头 `sheets.css:3` 那句"从右侧滑出"应改成实话，别留一条会误导下一个改动者的注释。
退场需要：sheet 关闭时先挂 `ht-sheet-out`（时长用 `--ht-duration-exit:140ms`，符合"退出比进入快"），动画结束再卸载——这需要把卸载从"立即 `setView`"改成"标记 closing → `animationend` 后卸载"，参照 `boot-splash.ts` 已有的 `animationend` 卸载范式（`boot-splash.ts:77`）。
`prefers-reduced-motion` 下把进出都压成 `opacity` 或 `animation:none`（现有 `sheets.css:490-494` 只压了 in，要补 out）。

**根因**：动效被当成"进入时加一层装饰"，而不是"一个有始有终、可逆的过渡"。§7 把对称性当可预测性的一部分——不对称的路径会让用户失去"这东西从哪来、回哪去"的空间模型。

---

## §8 Hint in the direction of the gesture —— 朝手势方向给预示

**Skill 要求**：中间帧要**预示**终态（Control Center 模块"朝手指方向长出去"），而不是盲目插值到终点。

设置页没有手势驱动的过渡，`ht-sheet-in` 只是"下往上 + 淡入"，不携带方向预示信息。**N/A（合理）**。

唯一擦边：`SettingsInfoTip` 气泡**固定**落在触发件正下方（`sheets.css:391-393 inset-block-start: calc(100% + space-1)`）——不随触发件在屏上的位置智能选上下（靠近视口底部会溢出）。这是 §8/§16 Wayfinding 的一个小盲点（低危，因为气泡很小、且面板通常在上半屏）。

---

## §9 Rubber-banding —— 软边界

**Skill 要求**：到边界要"渐进阻力"，不要硬停（硬停读起来像卡死）。

token 里有原料 `--ht-motion-rubber-band-constant: 0.55`（`tokens.css:644`），但设置页**没有 JS 拖拽**能应用它。浏览器原生 `overflow:auto` 在 iOS/Safari 下自带 rubber-band，在桌面 Chrome 是硬截断。因为设置不可拖拽关闭、只有原生纵向滚动，所以本页 §9 **基本 N/A**；与 F-09（overscroll 收敛）合起来看：正确的做法是既 `contain` 掉串滚，又不该在桌面 WebView 里让设置区出现"滚到头弹一下背景"的失控观感。

---

## §10 Gesture design details —— 手势细节（tap/hysteresis）

**Skill 要求**：tap = touch-down 高亮、touch-up 提交，给 ~10px hysteresis 命中余量，可拖离取消；最小化消歧延迟。

**✅** 命中余量与阈值原料都在：`--ht-gesture-hit-slop: 0.625rem`（10px）、`--ht-gesture-hysteresis: 0.625rem`（`tokens.css:598-599`）。按钮 `:active` scale 满足"down 高亮、up 提交"。

**🟠 F-11：说明气泡瞬时弹出，无 hover 延迟（MEDIUM）**
`SettingsInfoTip.tsx:57` `const open = hovered || focused;`，`:67 onPointerEnter={() => setHovered(true)}`——**指针一进入立刻开**。Apple（及 ARIA APG）对 hover tooltip 的惯例是 ~500ms 出现延迟：鼠标**划过**时不该因为途经一枚 `?` 就弹出一段气泡，尤其这页有 7+ 枚 `?`（昵称/换邮箱/通行密钥/密码/设备/隐私/AI…）。指针从面板左侧移到右侧会**连串点亮又被下一枚替换**。
```tsx
// SettingsInfoTip.tsx：hover 走开→进 250–500ms 定时器才 open；focus/键盘路径保持即时（无障碍优先）
onPointerEnter={() => { hoverTimer.current = setTimeout(() => setHovered(true), 400); }}
onPointerLeave={() => { clearTimeout(hoverTimer.current); setHovered(false); }}
```
（focus 那条**不要加延迟**——键盘用户应当即时得到。）

**🟠 F-05：侧栏导航链接无"按下即回应"（MEDIUM）**
`.ht-settings__nav-link`（`sheets.css:54-77`）只有 `:hover` 换底色，**没有 `:active` 反馈**，且它是 `<button>`/`<a>` 但**不带 `.ht-btn`**，所以吃不到 `controls.css:173` 的 scale。桌面靠 hover 还过得去；**触摸设备（独立设置窗口在 iPad/触屏笔电、以及窄屏一档）点它时，按下瞬间没有任何回应**，只有松手后 `aria-current` 才变——违反 §1/§10 "highlight on touch-down"。补一条：
```css
.ht-settings__nav-link:active { background: var(--ht-color-active); }
```

---

## §11 Frame-level smoothness —— 逐帧平滑

**Skill 要求**：只动 `transform`/`opacity`；需要时用 `will-change` 预告。

**✅ 大体合规**：`ht-sheet-in`/`ht-material-in`/`ht-search-overlay` 入场都只碰 `opacity + transform`（`sheets.css:479-488`、`material.css:77-86`）。`controls.css:165` 注释明确"只动 transform：合成器处理、不触发布局"。这正是 §11 的要害。

**🟡 F-17（同上）**：`.ht-btn` 把 `background-color/color/border-color` 也放进了 transition。颜色过渡是 paint，不触发 layout，可接受；`border-color` 恒无、属死代码。`--ht-color-active` 定义了但按钮没用到"状态叠加层"（`--ht-state-pressed-opacity: 0.08`）——skill 无强要求，记录。**结论：§11 无真正违规。**

**没有 `will-change`**：入场是一次性 keyframe，Chrome 会自行提升合成层；对本页规模不必加（加了反而常驻内存）。**N/A，正确。**

---

## §12 Materials & depth —— 材质与层次

**Skill 要求**：导航/工具条/sheet 做成半透明悬浮层（`backdrop-filter`），内容从下面滚过；材料重量表达层级；禁止亮半透明面叠亮半透明面；模态配 dim scrim + 把背景往后/往下推；大面更厚（更强 blur + 更深阴影）；文字在玻璃上用 vibrancy；用滚缘渐隐而非硬 1px 分隔线；"materialize"（进出同时动 blur+scale）。

这里是**代码哲学与 Apple skill 正面相遇、并有意识分道**的地方，需要分辨清楚——不能一律判红。

**✅ 本仓有明确的、经过论证的材质边界（ADR-0042）**：`MASTER.md:80-114` 与 `material.css:1-15` 定义了"**内容面扁平、悬浮功能层才用材质**"的分界，判据是"内容从它下面滚过去吗"。这套裁决是**自洽且可辩护的**：
- 悬浮层确实做了玻璃：`.ht-material` = `backdrop-filter: blur(20px) saturate(180%)` + 分档 tint（chrome/panel/sheet）+ `edge-highlight` 亮顶边（`material.css:16-27`、`tokens.css:661-681`），与 skill §12 的代码示例几乎同形。
- 暗色材质**不是**亮色反相（`tokens.css:793-799` 用 `#0d1526` 深蓝族）——skill 未细讲、但方向正确。
- "禁止亮半透明叠亮半透明"被写成硬规则（`tokens.css:653-656`、`MASTER.md:370-373`），且 `controls.css:471-473` 用 `:has([role=dialog])` 把装了 AI 面板的浮层强制实色，**正是为了治理"两层字透叠"**——这是 skill §12「Never stack a light translucent surface on another」的实战兑现。

**🟡 F-13：设置 sheet 被归为"内容面"→ 实色、无材质层次（LOW，与 skill 有张力但已论证）**
`sheets.css:13-21` `.ht-sheet` 用 `background: var(--ht-color-background)`（**实色**），注释 `sheets.css:9-11` 说明理由是"设置内容自己使用不透明表面，避免任务标题从背景透出来与设置文字叠在一起"。
- 按 skill §12，sheet 是"悬浮功能层"、应当半透明 + 内容滚过 + **配 scrim 变暗聚焦** + 把背景往下推。
- 本仓的实际裁决：设置**盖满内容区**（`inset:0`），下层任务被整片挡住，所以**没有 scrim、没有透出**（`sheets.css:19`）；但"把背景推走"这一半做到了——`base.css:189-191` `[data-detail-suppressed]` 在设置打开时把详情列整根退场。
- 这是一次**有意识的取舍**（实色避免透字事故 vs. 玻璃的层次隐喻），不是疏忽。**我不判红**，但指出：既然它是"次级表面浮层"，Apple 语言下"变暗以聚焦（dim to focus）"是缺的——rail 仍亮着、无 scrim，用户视觉上"设置"与"下面那层"的**层级关系只靠遮挡表达**，而不是靠材质深浅。
建议（可选、低优先）：给 sheet 加一层极淡的进入 scrim 或把下层 rail/header 在 `--state-hover-opacity` 档压暗，以补"dim to focus"。**前提**：若坚持 `MASTER.md` 的扁平内容面裁决，此项**维持现状即可辩护**——报告在此如实标注为"哲学分歧，非缺陷"。

**🔴 与 §12 直接冲突的是 F-02（下面按钮层级一并讲）**：`CloseAccountPanel` 那颗 `.ht-btn--outline` 让一枚**本应可点**的东西在材质上"消失"成了文字。

---

## §13 Multimodal feedback —— 多模态反馈

**Skill 要求**：因果性（在真正致因事件上触发）、同步性（视觉/声音/触感同帧）、效用性（只在有意义处加）。

**Web 端现实**：本仓设置页**未使用任何声音或 `navigator.vibrate()` 触感**（grep 确认无 Vibration API）。这在 Web 桌面应用里是**默认合理**的——skill §13 自己也说"只在有意义的时刻加"。设置里唯一勉强算"值得触感回执"的是危险动作提交（注销确认、退出所有设备、删最后一条通行密钥），若做原生壳可加一次轻触感；纯 Web 无此能力。**记为 N/A（前提受限，非缺陷）。**

**⚠️ 但因果性有一条被 §1/F-01 拖累**：视觉回执（spinner）与"请求真的在飞"之间失去了对应——图标不转，等于致因事件（发起）没有可感知的视觉伴随。修好 F-01 即补齐。

---

## §14 Reduced motion & accessibility —— 减少动效与无障碍

**Skill 要求**：响应三个独立信号——`prefers-reduced-motion`（用交叉淡入替代滑动/弹簧，去掉过冲）、`prefers-reduced-transparency`（半透明→实色，降 blur）、`prefers-contrast: more`（近实色 + 明确描边）；避免全屏移动背景、0.2Hz 循环、**亮度骤变**。

**✅ 前两个信号做到了，而且做法正确：**
- **motion**：`tokens.css:818-837` 把**全部** `--ht-duration-*` 压到 `1ms`（不是删属性——注释解释"删了会让依赖 transitionend 的逻辑永不触发"），`controls.css:169-171` 因此**故意不在组件里重复写 media query**（避免第二套降级策略）。`sheets.css:490-494`、`material.css:88-92`、`auth-dialog.css`、`category-create-dialog.css` 对 keyframe 类动画各自 `animation:none`。这是**教科书级**的 reduced-motion 架构（集中在一处、组件零改动）。
- **transparency**：`tokens.css:850-861` 把 blur 压 0、tint 压成实色 `var(--ht-color-surface)`，并**刻意放在文件末尾**（注释讲清了同特异性后来者胜、否则会被暗色块盖掉的坑）。

**🟠 F-10：完全未响应 `prefers-contrast: more`（MEDIUM）**
grep 全仓无 `prefers-contrast`。skill 要求第三条信号。缓解因素：设置页内容本就是实色面 + 发丝线 + 已经过 AA 的文字梯子，"高对比"诉求已被**部分**满足（不像玻璃拟态那样急需 fallback）。但严格讲缺失：
- 高对比模式下应把 `--ht-color-border-subtle`/发丝线提到 `border-strong`、去掉 `--ht-state-*` 的半透明叠加、把 tint 实化。
最小可用补丁（在 `tokens.css` 末尾，仿 transparency 块的写法）：
```css
@media (prefers-contrast: more) {
  :root {
    --ht-color-border-subtle: var(--ht-color-border-strong);
    --ht-color-hover: var(--ht-color-active); /* 状态层更实 */
  }
}
```
**根因**：作者按 WCAG 2.x 的 contrast 是"颜色对比度阈值"来理解（已由 tokens.spec 保证），而没把 `prefers-contrast` 当成**一个要响应的媒体特性**。

**🟡 F-12：主题切换是瞬切，亮度骤变（LOW，但已论证）**
`theme.ts:51-53` 直接改 `data-theme`，颜色**无过渡**——从近白 `#f8fafc` 整屏跳到近黑 `#020617`。skill §14 "ease dark↔light theme changes / avoid abrupt brightness jumps" 倾向加一个 ~200ms 交叉淡入。
**但本仓有明确的、量化的反对证据**：`ai-panels.css:82-92` 与 `:525-537` 记着实测——只过渡 `background` 而 `color` 瞬切时，切换中间态对比掉到 **1.01:1**（稳态 16.40:1），约 50ms 全程低于正文 AA；且"成对变化的属性只要有一个被过渡，中间态必然掉对比"。iOS 26 用 `UIView.transition` 做**整体 cross-fade**（旧画面淡出、新画面淡入，不逐属性插值中间色）来规避——Web 侧可用 `document.startViewTransition()` 实现同样"整层交叉淡入、不产生中间低对比色"。
```ts
// 主题应用处（applyTheme），有 API 才用，降级即瞬切
function applyThemeAnimated(theme: Theme) {
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(() => { document.documentElement.dataset.theme = theme; });
  } else { document.documentElement.dataset.theme = theme; }
}
```
**判定**：现有"瞬切"在**不用 startViewTransition 的前提下是对的**（逐属性 CSS 过渡会制造对比事故）。这是"skill 的表面建议 vs. 本仓的实测教训"的一次正面碰撞，本仓赢——但报告应指出 **startViewTransition 是同时满足 skill §14「别骤变」和实测「别掉对比」的唯一干净解**，值得补。

---

## §15 Typography —— 光学尺寸 / tracking / leading / 系统字体 / Dynamic Type

**Skill 要求**：tracking 随字号变（大字收紧、小字放宽，绝不一个值通吃）；leading 与字号反比；层级由 weight+size+leading **成组**构建；尊重用户字号设置（间距用 rem/em，让版面随字放大）；优先平台系统字体。

**✅ 这一页是**本仓最像 Apple 的地方**，几乎逐条命中：**
- **tracking 分层**：`tokens.css:591-594` 按层级给 `--ht-tracking-display:-0.022 / title:-0.019 / body:-0.011 / caption:+0.006`（大字负、小字正），注释原话就是"Apple 规则：字距随字号变，固定一个必然错"。与 skill §15 代码示例（`-0.02em` display）同形。
- **语义档位成组消费**：`MASTER.md:380-407` 把"字号+字重+行高+字距"当一个不可分割整体（`row-title/section-title/headline/caption/…`），且 `typography.spec.ts` 钉住"行高/字距在原生端要乘字号""字距不许取整"。组件不许自拼四件套（`ai-panels.css:252-259`、`sheets.css:635-638` 反复强调"排版来自 `.ht-type-*`，这里不凑第二套"）。**这正是 skill「hierarchy from weight+size+leading as a set」的工业化实现。**
- **leading 随用途变**：`tokens.css:266-268` tight 1.25 / normal 1.5 / relaxed 1.75；数字强制 `tabular-nums`（`MASTER.md:222`、`controls.css:271-278`——"还剩 3 天→12 天不许整行跳"）。
- **CJK 回退显式**：`tokens.css:234-237` 在 `--ht-font-sans` 里排了 PingFang/微软雅黑/Noto Sans SC——不写会中文落系统衬线、与英文割裂。
- **Dynamic Type**：字号、间距全 `rem`（`--ht-space-*` 皆 rem、`--ht-layout-prose-max:65ch` 用 ch），浮层宽用 `rem`（`controls.css:332` 注释"rem 随宿主字号缩放，不写死 px"）——用户放大字号版面会跟着长。

**🟠 F-06：子标题档位不统一（MEDIUM）**
同为"面板内小节标题"，三个面板用了三档：
- `PasskeyPanel.tsx:181` / `SessionsPanel.tsx:125` / `PasswordPanel.tsx:373` / `CloseAccountPanel.tsx:121` → `.ht-settings__title .ht-type-section-title`（base/**600**）。
- `DataSettingsPanel.tsx:29,49` → `.ht-type-headline`（base/600，`headline` 档）。
- `EmailChangePanel.tsx:186,197` → `.ht-settings__h3 .ht-type-row-title`（base/**500**、leading **1.75 relaxed**）。
问题：`EmailChangePanel` 的"更换登录邮箱"小节标题落在 `row-title`（数据行的名字），而它是**结构性标题**——字重比邻居轻一级、行高反而更松（relaxed 1.75 是给阅读段落的，不是给标题的）。skill §15"用 weight 表达层级、大字紧行小字松"——这里标题却用了**最松的 leading**，读起来像正文而非 heading。与 `ProfilePanel` 里 `.ht-settings__row-label` 的 `ht-settings__item-label`(medium) 混排时，层级会塌。**建议**：小节标题统一走 `headline`（600），`EmailChangePanel` 的两处 `ht-type-row-title` 改 `ht-type-headline`。

**🟠 F-08：状态回执用 11px（MEDIUM）**
`.ht-settings__notice`（成功回执，如"昵称已保存""已撤销"）= `color:foreground-muted; font-size:--ht-font-size-2xs`(11px)（`ai-panels.css:414-417`）。skill §15/HIG 可读性：承载**结果结论**的文字不该压到"极致紧凑标签"那一档。11px muted 在暗色小屏上偏轻。建议回执至少 `--ht-font-size-xs`(12px)，且——见 F-07——与 hint 拉开。

---

## §16 Design foundations —— 八原则

对设置页逐条打分（8 条里 5 条强、2 条中、1 条有硬伤）：

1. **Purpose（意图）**：✅ 强。文件头大段论证"该做 / 不该做什么"（`ProfilePanel:9-59` 解释为何不新开 view、为何删头像加密 disclosure）。"少做"的自觉性高。
2. **Agency（掌控 + 宽恕）**：🟠 中。删除通行密钥两段式（`PasskeyPanel`）、注销两段 + 必勾（`CloseAccountPanel`）、改密双表可主动切换（`PasswordPanel:571-585`"从来没设过？"）——**给出口、不逼单路径**做得好。扣分项见 F-04：最危险的那一步**视觉上没有比取消更重**，"确认"的分量感被削弱；且第一步按钮（F-02）几乎看不见，用户可能不知道自己"能不能往下走"。
3. **Responsibility（负责：隐私/安全/AI）**：✅ 强。这是本仓的招牌：AI 面板文件头（`AiSettings.tsx:8-19`）"每一道闸单独可见 / 远端端点旁永远显示数据会离开这台设备 / 授权按功能给可逐个撤销 / 密钥关掉页面就没了"；隐私撤回同意入口（`PrivacyPanel`）满足 PIPL 第 15 条；反枚举、成功句中性（`PasswordPanel:359-368`）。**安全诚实性远超 Apple 的及格线。**
4. **Familiarity（熟悉/一致）**：🟠 中。图标用 Lucide、无 emoji、危险色分离——符合约定。裂缝：F-06 标题档位不统一、F-05 导航链接与按钮的反馈语法不同（一屏两套按下响应）。§7 的"右侧滑出"承诺 vs 下方淡入（F-03）也是"熟悉的隐喻没兑现"。
5. **Flexibility（不同情境/能力/设备）**：✅ 良。断点体系（48/64rem）、独立设置窗口（`?settings&standalone`，`sheets.css:1011-1089`）为深链接/桌面分窗做了专门版式；row→stacked 换档；键盘可全走（focus-visible 矩阵有判据）。
6. **Simplicity（简洁≠极简）**：🟠 中。"一行一件事 + `?` 收纳说明"的裁决（`ProfilePanel:27-30`）是对的——**该藏的解释藏进 `?`，该留的留在行里**。但 F-14：部分长面板（AI/订阅/数据）同时可见多枚 primary，"最重要的那件事最显眼"被稀释。`PrivacyPanel` 用两个 `<fieldset><legend>` 分组，映射清晰（正面）。
7. **Craft（手艺）**：🟠 中（因 F-01/F-02/F-04/F-11 掉分）。发丝线/圆角档/对比度这些静态精致度是 A 级；但**动效与状态表征的精致度是 B 级**——不转的 spinner、悬空的 `.ht-spin`、不存在的 `.ht-btn--outline`、无退场动画，这些是"能失败的细节没管住"。skill §16 Craft 明说"layout 崩、图标错位、滚动抖读起来就是疏忽"——本仓的**死类/死样式**就是疏忽类。
8. **Delight（愉悦）**：🟡 弱（可接受）。设置页不追求 delight（正确，密集配置区硬加弹跳是噪音）。但 skill 说 delight 是"另外七件做对的结果"——F-01/F-03 修好后，"按下即转圈、开合都有对称动效"会带来基础手感愉悦。

**战术子规则**：
- **反馈四型（status/completion/warning/error）**：✅ 覆盖极好——`role=status/alert`、`aria-live`、加载/成功/失败各有独立句（`ProfilePanel:123-128` 甚至专设 loadNotice 与 nameNotice 分开，防止"GET 失败却在昵称下说头像传不上"）。**但 F-07**：success 回执（`__notice`，muted）与 hint（`__hint`，muted）**同色同档**，"这件事成功了"与"这是背景说明"在画面上分不开——违背"状态要能被一眼分辨"。
- **Wayfinding（我在哪/能去哪/怎么出去）**：✅ 强。sticky 分类栏 + `aria-current`、sticky 关闭按钮（`sheets.css:453-472`）、Esc 关闭（`App.tsx:2274-2282` 挂捕获阶段）、深链可回原 view（`settingsBaseView`）。"从不困住用户"做到了。
- **Grouping & mapping**：✅ 好（`ht-settings__row` 标签左/控件右、`__actions` 把按钮聚在控件旁、换邮箱紧贴邮箱行 `ProfilePanel:491-503` 论证"只在看见当前地址那一刻才想换")。
- **直接具体的标签**：✅（"更换登录邮箱""登录设备"而非泛称）。

**🟠 F-07（重述，MEDIUM）**：把 success 回执与 hint 分离——`__notice` 提到 xs 档 + `foreground`（或配一枚 `Check` 图标已在代码里有：`ProfilePanel` NoticeLine 无图标，但 `EmailChangePanel.tsx:343-347` 的 sent 有 `CheckCircle2`，两处不统一）。统一"成功回执 = 图标 + foreground + ≥12px"，hint 保持 muted。

---

## §17 Process —— 流程（原型 / 交互与视觉同设计 / 真人实测）

**Skill 要求**：交互式原型（"胜过一百万张静态设计"）；交互与视觉一起设计，"看不出从哪结束"；真人真实情境测；慢放逐帧复核动效。

**证据**：代码里大量"产品负责人实拍 → 逐条病因表"（`ProfilePanel:19-30` 症状/病因对照、`ai-panels.css:61-92` 语言控件四条违规逐条对号、`sheets.css:1091-1112` 拿两张截图逐字节比对 0.5px vs 1px）。**这是真人看图迭代的确凿痕迹，§17 的"视觉↔事实"闭环做得比多数团队好。**

**但"交互与视觉一起设计"这一半明显缺席**：整个设置页的**动效是被事后、最小化添加的**（sheet 一层 `ht-sheet-in`、tooltip 无动效、spinner 无动效、无退场）。文件里看不到对"手感"的迭代记录，只对"排版/颜色/文案"的迭代记录。**根因**与 F-01/F-03 同源：这套团队把**信息诚实度**做到了极致，把**运动设计**当成了可选装饰层——于是 Apple 那句"你不应能分辨视觉与交互在哪里分开"在这里**不成立**：视觉（表单/文字/对比度）和交互（反馈/过渡/材质）分属两个成熟度。

---

## Apple HIG 专项检查

| 检查项 | 结论 | 证据 / 说明 |
|---|---|---|
| **触控目标 ≥ 44pt** | ✅ 基本达标 | `--ht-touch-target-min:2.75rem`(44px，`tokens.css:375`) 被 `.ht-btn`/`.ht-input`/`nav-link`/`tip-trigger`(44×44)/`switch-cell`/`option`/`sub-plan` 全线消费。🟡 **F-15**：原生 `checkbox`/`radio` 本体 ~16px（`CloseAccountPanel.tsx:156`），靠外层 `label`/`__row` 把命中区撑到 44——合规但脆弱（label 文字很短时命中区仍偏小）。建议给裸 checkbox 包一层 44px 命中盒（本仓 `.ht-chip--action` 已有此范式）。 |
| **安全区感知** | 🟡 部分 | `narrow.css:202` 底部导航有 `env(safe-area-inset-bottom)`。🟡 **F-16**：`.ht-sheet` 窄屏仅 `padding:space-4`（`sheets.css:436-439`），其滚动内容底部未加 `safe-area-inset-bottom`——iPad/带 Home 指示条的触屏笔电上，设置最后一节可能贴/压在指示条下。补 `padding-block-end:max(space-4, env(safe-area-inset-bottom))`。 |
| **间距系统一致** | ✅ 强 | 4px 基准 8 步（`--ht-space-*`），全部有倍数测试；行高刻意收进 macOS 44–56 区间（`sheets.css:113-135`、`ai-panels.css:264-268` 有 2026-10-25 实测读数）。`e2e/tests/settings-row-grammar.spec.ts` 在守这条。 |
| **暗色对比度** | ✅ 极强 | 暗色文字梯子整体上移一级并实测（`tokens.css:706-711`：subtle slate-400=7.11、muted slate-300=12.27）；on-danger 暗色专设 slate-950=7.29（不是跟亮色反相）。由 `tokens.spec.ts` 实算。**这是全仓最硬的护城河。** |
| **各字号可读性** | 🟠 | 见 F-08：状态回执/成功句落在 11px(2xs)；`__danger`/`__hint`=12px(xs) 属辅助下限。密集信息 UI 里 12px 可接受，但**结论型文字**（成功/失败）应 ≥12 且用 foreground。 |
| **按钮层级：一 context 一枚 primary** | 🟠 | 单面板做得好（ProfilePanel：昵称 primary、头像 ghost，`ProfilePanel:360-368` 有意识论证）。🟡 **F-14**：AI/订阅/数据长面板同时可见多枚 primary（`AiSettings.tsx:1182,1205` 逐功能授权各一 primary + 添加端点 primary），与本仓 `ui-ux-pro-max §4`"每屏一枚 primary"口径相冲。**🔴 F-02/F-04 更严重**：注销流程第一步用不存在的 outline（读作文字、层级为 0），第二步 danger 用行内档（透明红字）——**最危险的确认反而比常规 ghost 还轻**，层级颠倒。修法：第一步 → `--secondary`；最终确认 → `--danger --commit`（`controls.css:117-125` 已有这一档，专门给"确认层里唯一要按下去的危险按钮"，本仓 `DangerConfirmDialog` 在用，CloseAccount 没跟上）。 |

---

## 修复优先级建议（若要动手，按 ROI 排序）

1. **P0**：补 `.ht-spin` 定义 + 给设置 17 处 `Loader2` 加 `className="ht-spin"`（修 F-01，或把忙态图标抽成一个 `Spinner` 组件根治"漏一处不报错"）。
2. **P0**：`CloseAccountPanel.tsx:174` `ht-btn--outline` → `ht-btn--secondary`；`:189` → `ht-btn--danger ht-btn--commit`（修 F-02+F-04，恢复危险确认的重量）。
3. **P1**：`.ht-sheet` 补对称退场（`ht-sheet-out` + animationend 卸载）并把方向与 `sheets.css:3` 注释对齐（修 F-03+§7）。
4. **P1**：`.ht-settings__nav-link:active` 补按下反馈（F-05）；`SettingsInfoTip` hover 加 400ms 延迟、focus 保持即时（F-11）。
5. **P2**：`EmailChangePanel` 两处标题档位改 `headline`（F-06）；success 回执与 hint 分离、提到 ≥12px（F-07/F-08）。
6. **P2**：`.ht-sheet{overscroll-behavior:contain}`（F-09）；补 `@media (prefers-contrast: more)`（F-10）；窄屏 sheet 底部加 safe-area（F-16）。
7. **P3**：`.ht-btn` 删死掉的 `border-color` 过渡（F-17）；主题切换接 `startViewTransition`（F-12，需测对比中间态）；裸 checkbox 包 44px 命中盒（F-15）。

---

## 根因综述（一句话诊断）

**heyta 设置页是一支"把信息诚实度与静态可访问性做到工业级、但把运动设计与状态表征动效当成可选装饰"的成熟代码。** 它在 Apple 八原则里 Purpose/Responsibility/Flexibility/Wayfinding 上属于优等生，在 §4/§14 的**参数层与降级架构**上甚至逐字对齐 WWDC 原话；但恰恰在 §1「过程连续反馈」、§3/§7「可逆、对称的过渡」、§12「材质层级」、§16「Craft 的动态一半」上系统性欠债——表现为**不转的 spinner、没有退场的浮层、悬空的 `.ht-spin`、不存在的 `.ht-btn--outline`、重量颠倒的危险确认**。这些不是审美分歧，而是"能失败的判据没设"：一个不转的圈、一个查无此类的按钮、一段进得了出不去的动画，全都是 `check:*` 门禁覆盖不到的**动效/表征维度**。补上一枚真会转的 spinner 和对称的 sheet 退场，性价比高于任何新的静态打磨。

> 本报告为**只读审计**，未改动任何源码。所列修复均为建议示例，取值一律引现有 token，符合 `MASTER.md` 规则 1–3（禁裸值）。落地前按 `docs/agents/ui-acceptance.md` 用 Playwright 真跑 + 真看截图复核，勿以"编译过/测试绿"代替看图。
