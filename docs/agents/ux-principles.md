<!-- 2026-10-24 新增；同日按最佳实践重写第二版（v2）。
     它回答的是"界面该长什么样"，不是"值从哪来"（那是 design-system.md）
     也不是"浮层怎么关"（那是 overlay-feedback.md）。
     返回入口：[`AGENTS.md`](../../AGENTS.md) §4 规则地图。 -->

# 界面结构原则（UX / 解剖）

**一句话**：本仓对「值」极严、对「浮层行为」有账本、对「界面结构」此前**零规则** ——
所以「添加习惯」长出了 11 个控件平铺、标签在控件上方、动作按钮滚出视口，
而 `check:design` / `check:l4` / `check:overlay` **全部走绿**。本文件补的就是这一层，
并且每一条都**有出处、有判据、能被判红**。

---

## 0. 事故的形状（为什么要写这一份）

2026-10-24，产品负责人对着「添加习惯」说：「我们的 UX 明显不对」「为什么我们的框高度
那么不统一呢？这挤压太厉害了吧」「做整个 UX 应该有抽象的原则……那么我们到底 UX 有没有原则呢？」

当天的实测量（判据落地前）：

| 读数 | 当时 | 为什么没红 |
|---|---|---|
| 控件高度档位 | **2 档**（input 44 / 原生 `<select>` 20） | 两件都写了 `min-block-size: 44`，静态检查读起来完美统一 |
| 动作按钮下沿 | **689 > 632 视口** | `toBeVisible()` 只验"有非空 box"，不验"在不在视口里" |
| 图标 | **24 枚常驻** | 同一功能的详情面早就是折叠的；且一条 e2e 把"常驻"写成了不变量 |
| 字段纵向占用 | 76px（标签占一整行） | 没有任何判据读"标签在哪" |
| 表单解剖种类 | **6 种**（13 个文件、**35** 处手写**字段**标签；同日收口后降到 **26**） | 三层门禁没有一层有"解剖"这个词 |

---

## 1. 🔴 只有两种解剖，按**任务类型**选

这是本文件唯一需要"判断"的地方，所以给出处：

| `layout` | 用在哪 | 为什么 | 出处 |
|---|---|---|---|
| `stacked`（标签在上） | **表单页**：一次录入一组新数据（新建、注册、结算、问卷） | 标签在上时行高稳定、可换行；长标签与译文不会挤压控件；"一次只做一件事"的路径更短 | [GOV.UK — Question pages](https://design-system.service.gov.uk/patterns/question-pages/)、[GOV.UK — Text input](https://design-system.service.gov.uk/components/text-input/) |
| `inline`（标签在左） | **设置 / 属性面板**：改同一对象的几个属性（滴答的添加习惯、macOS 系统设置） | 用户的动作是**扫读已有值**；左列稳定给出"属性名 → 值"的映射，行距可压到 44+8 | [Apple HIG — Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)（grouped list：前导标签 + 尾部值） |

**判据**：`e2e/tests/habit-create-shape.spec.ts` 的 **S3** —— 同一张表单里所有标签的
`left` 去重后恰好 1 个、所有控件单元格的 `left` 恰好 1 个，且控件列在标签列右边。

🔴 **两档之外不许有第三档。** 想加档之前先回答："这一屏的用户是在**录入**，还是在**扫读已有值**？"
答不出来就不该加。**6 种解剖就是这么长出来的** —— 每一处都觉得自己是个特例。

**判断只有一份，渲染器有两个**（这就是"同一件事的第二份实现"的正确形态）：

| 层 | 位置 | 谁用 |
|---|---|---|
| **判断**（错误让位 / 必填 / id 怎么拼） | `packages/ui/src/form/anatomy.ts`（`resolveFieldChrome` / `fieldDescribedById`） | 两端 |
| web 渲染器（HTML + CSS） | `apps/web/src/lib/form/FormField.tsx` + `apps/web/src/styles/app/form.css` | web 的 3 处已迁移 |
| 移动端渲染器（RN） | `apps/mobile/src/ui/kit.tsx#TextField`（**已消费同一份判断**） | 移动端全部 `TextField` 调用点 |

判据：`packages/ui/tests/form-anatomy.spec.ts` A1–C2（10 条，钉判断）+
`apps/web/tests/form-field.spec.tsx` F1–F8（钉 web 渲染的连线）。
注入验证：把"说明让位"改成 `showHint: hasHint` ⇒ **A3 精确红**。
判据：`pnpm check:form-anatomy` —— 手写 `<label>` 只减不增（**现量 63 处 / 27 文件**，逐文件账本；
现量由脚本自己打印，别抄这里），且 `.ht-input-field*` **只许在 `form.css` 里定义**。两条臂都做过注入验证（见 §8）。

**已迁移**（2026-10-24，共 8 处）：「添加习惯」、新建清单、自动收集规则面板
（那 9 个字段此前用的 `.ht-settings__input` **全仓没有定义**，因此渲成浏览器默认的 ≈22px）、
AI 端点的三行 `inline` 字段、保险库口令的六格 `stacked` 字段、
同步设置的口令/服务器/令牌（`stacked`）、AI 一句话捕获的三行（`stacked`，
其中日期 + 时间共用一行 —— 那是原语的第二个配比 `--wide-first`，不是第二种解剖）、
番茄钟的四个时长 + 关联任务（`inline` / `stacked`）、习惯目标编辑器（`stacked`）、
助理档位（`inline`）、习惯「每隔几天」（`stacked`）、子任务归属 / 任务清单归属（`stacked`）、
自定义重复规则（`stacked`）。

🔴 **指标在 2026-10-24 当天收窄过一次**：R1 原先数"所有 `<label>`"，
把复选框/单选框/开关也算成"字段债"（它们该是"选项"，解剖不同）。
收窄成"包着 `input`（非 checkbox/radio）/`select`/`textarea` 的 `<label>`"之后，
基线从 72 重设为 **35**，当天晚些时候降到 **0** —— web 壳里**一处手写字段标签都不剩**
（最后 10 处是后台 `admin/AdminPanel.tsx`）。重设基线用 `--reseed`，
它只许在**指标定义变了**时用。

---

## 2. 🔴 一个可交互控件只有一档高度

**陈述**：同一个容器里，可键入 / 可点的控件只允许**一档高度** = `--ht-size-field-height`。

**反面症状**：input 44、`<select>` 20、按钮 34 混排 —— 用户读到的不是"三种控件不同"，
而是"这个界面没做完"。

**为什么"写了 token"不等于"做到了"**：`min-block-size` 只是**下限**。
原生 `<select>` 的外观、`<input type=number>` 的 spinner、`font: inherit` 没写时的回落，
都会让内容高度越过下限。实测：input 与 select 都写了 `min-block-size: 44`，
渲染出来是 **44 与 20**。⇒ 必须 `block-size` 给死 + `appearance: none`。

**取值**：44pt 是 [Apple HIG Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
的触控下限；Material 是 48dp。本仓取 44（`--ht-size-field-height`），**不再加第二档**。

**判据**：`habit-create-shape.spec.ts` 的 **S2** —— 量 `getBoundingClientRect().height`
的**去重集合大小**。⚠️ 不能写成"每个都 ≥44"：那会把"两档都合规"也算过。

---

## 3. 🔴 动作区是常驻层，不随正文滚走

模态里主次动作固定在底部，只有正文滚动。
出处：[Apple HIG — Modality](https://developer.apple.com/design/human-interface-guidelines/modality)
（模态必须自带明确退出口）、以及本仓 `overlay-feedback.md` §3 的关闭策略表。

**判据**：按钮 `rect.bottom ≤ innerHeight`，**并且**不滚动就能 `click()` 成功（**S1**）。
🔴 **不许用 `toBeVisible()` 当几何证据** —— 本仓为此栽过三次（H3 的 `I6`、动作按钮、
390 宽的标签列）。

---

## 4. 🔴 配置项默认收起；同屏一个主任务

**少数时候才改**的东西不占首屏。一次性配置（图标、颜色、提醒、分组）用"点主体 → 展开"。
出处：[Apple HIG — Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)
的 Simplicity（"show the common path first, advanced options one level deeper"）、
[Apple HIG — Disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls)、
以及 `ui-ux-pro-max` 的 `progressive-disclosure`（Forms & Feedback）。

**判据**：收起态里被折叠的控件**数量为 0**；点开那一枚触发器之后才出现（**S4**）。
⚠️ 旧版 `habit-create-options.spec.ts` 用 `toHaveCount(1)` 断言"立即存在"，
等于把毛病钉成不变量 —— **谁折叠谁红**。这类断言是本次事故的一半成因。

---

## 5. 🔴 焦点必须可见；静止态描边**不**必须

这一条是本次调研最有价值的反转：**"要不要描边"有规范答案，而且答案不是"要"。**

WCAG 1.4.11 的 Boundaries 一节原文：

> This success criterion does not require that controls have a visual boundary indicating
> the hit area. If a control has visible content (such as text or a sufficiently contrasting icon),
> which helps users identify the presence of the control, then a border or other indication of the
> overall boundary of the hit area is not required.
> — [W3C, Understanding SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)

同页紧接着一句：

> Even when a control does not need to have a visual boundary indicating its hit area,
> it will still need to have a **sufficiently contrasting focus indication**.

⇒ 本仓的两条结论（与产品负责人 2026-10-07「无描边交互」**不冲突**）：

1. **静止态不描边**，字段的可识别性由**填充色**承担（`surface-sunken` 对 `surface-raised`）。
   ⚠️ 那个对比只有 **1.1:1** —— 按 1.4.11 合法（边界不是必需项），但
   [同页的 Note](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) 对认知障碍
   用户建议"把边界都画出来"，所以填充色**不许再变浅**。
2. **键盘焦点必须画环**，且 ≥3:1。实现只有一处：
   `apps/web/src/styles/app/borderless-controls.css` 的 `:focus-visible` 分支
   （主色 `#2563eb` 对白 **5.17:1**）。

🔴 **2026-10-24 修掉的真缺陷**：那条文件里的 `:focus { outline: 0 !important }` 把
**所有输入框的键盘焦点**一起抹掉了 —— 全仓零可见焦点。这不是审美取舍，是
[WCAG 2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) 的失败，
而且它**没有任何判据**能发现（颜色测试只测 token，不测"焦点在不在"）。

**判据**：
- 环**存在**且对底色 ≥3:1 —— `e2e/tests/habit-create-shape.spec.ts` 的 **S6**
  （真浏览器读 `outline-style` / `outline-width` / `outline-color`，并在页面里现算对比度）。
  注入验证：把那 6 行删掉 ⇒ **S6 红**，报错正是「焦点环被抹掉了（outline-style = none）」。
- ring 颜色本身在白底 5.17:1 —— `packages/design-system/tests/tokens.spec.ts` 的对比度测试。

---

## 6. 分组：线数 = 组数 − 1

只在**语义真的分组**的地方画分隔线，且线跨整内容宽（不从标签列起）。
不画线的多组字段在视觉上是同一件事，而"这行是不是必须填"正是用户最需要一眼分辨的东西。
出处：`ui-ux-pro-max` 的 `field-grouping`（Forms & Feedback，引 Material）、
[Apple HIG — Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)（grouped 分节）。

---

## 7. 错误与说明：同一行只说一句话

- 错误**就地**显示在字段下（不许只在顶部汇总）；
- 错误出现时**说明让位** —— 读屏同时念两句，用户要在里面找哪句是坏事；
- `aria-describedby` 指向**当前生效**的那一句，`aria-invalid` 显式给 `false` 而不是缺省。
- 出处：[WCAG 3.3.1 错误识别](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html)、
  [WCAG 3.3.2 标签或说明](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html)、
  `ui-ux-pro-max` 的 `error-placement` / `inline-validation` / `aria-live-errors`。

**判据**：`apps/web/tests/form-field.spec.tsx` 的 F1–F8（8 条，毫秒级）。

---

## 8. 判据总表与欠账

| 原则 | 判据 | 能红吗 |
|---|---|---|
| §1 两种解剖 | `check:form-anatomy`（R1 账本 / R2 单一来源）+ e2e **S3** | ✅ 两条臂注入验证过（新增一处 `<label>`、在 habits.css 加一条 `.ht-input-field--rogue`，各自精确红） |
| §2 一档高度 | `e2e/tests/helpers.ts#assertFormRhythm`（**共享判据**），被 e2e **S2** 与自动收集规则面板调用 | ✅ 注入 `block-size: 32` ⇒ 报「表单里出现了 2 档控件高度：44 / 32」 |
| §3 动作常驻 | e2e **S1** | ✅ 改前实测 689 > 632 |
| §4 配置收起 | e2e **S4** | ✅ 反向断言（收起态必须为 0） |
| §5 焦点可见 | e2e **S6** + tokens 对比度测试 | ✅ 删掉那 6 行 ⇒ S6 精确红 |
| §6 分组 | 无（看图） | ⚠️ 见下 |
| §7 错误/说明 | `form-field.spec.tsx` F1–F8 | ✅ 8 条 |

🔴 **未闭合（本文件不掩盖）**：

1. **移动端已接线（2026-10-24）**：`anatomy.ts` 这份**判断**现在被
   `apps/mobile/src/ui/kit.tsx#TextField` 消费 —— 移动端每一处 `TextField` 都自动
   拿到"错误优先 / 说明让位 / `aria-invalid` / `accessibilityLiveRegion`"。
   🔴 **第一版我做错了**：在 `packages/ui/src/form/` 写了一个 RN 渲染器 `Field.tsx`，
   零消费者 —— 而移动端本来就有 `kit.TextField`。那不是"共享"，是**第三份实现**。
   已删除；现在的分工是：**判断归共享层，渲染器归各端 kit**。
   **覆盖范围（2026-10-24 收口）**：文本 / 数字 / 多行备注都走 `TextField`
   （`keyboard='number-pad'`、`multiline`、`onBlur` 都已收进去）；
   习惯目标、任务标题、任务备注、新建习惯都已迁移。
   **剩下的裸 `<TextInput>` 只有三处，且都登记了理由**（搜索框、聊天输入条、
   行内新建清单那一格的 Fabric focus 竞态）—— 判据 `mobile-text-field.spec.ts` 的 **M5**：
   账外出现即红，登记的条目**今天必须还能命中**。注入验证：把一处字段退回裸
   `<TextInput>` ⇒ M5 精确红。
2. **26 处手写字段标签仍是债务**：账本只保证"不再增加"，不保证"会减少"。
   剩下的大头是 `admin/AdminPanel.tsx`（12 处，运营者才看得见）与 AI 那几个浮层
   （`AiCapture` 3 处等）—— 前者优先级最低，后者在浮层里、要先确认它们的解剖归类。
4. **几何判据已抽成 `assertFormRhythm(scope)`**（2026-10-24），当前有 2 个调用方
   （添加习惯、自动收集规则面板）。剩下的 24 处填表界面**还没有**调用它 ——
   每接一处就多一份保障，那是持续动作，不是一次性收尾。

## 9. 🔴 "两端一致"指**字段**，不指**版面**

这条是被一次**说不清的验收**逼出来的：2026-10-24 的收口表里留着两条
"移动端与 web 不一致"（新建习惯的形状、图标选择器的入口位置），谁也判不了它算不算欠账。
判不了的原因是**"一致"这个词没定义**。现在把它切开：

| 层 | 必须一致吗 | 依据 |
|---|---|---|
| **判断**（什么时候出错误、错误与说明谁让位、必填星号怎么给读屏） | ✅ **必须** —— 同一件事只能有一份判断 | `packages/ui/src/form/anatomy.ts`，两端各自消费 |
| **字段解剖**（标签在上还是左、控件只有一档高度） | ✅ **必须** | 本条 §1/§2；两端各有判据 |
| **版面**（对话框 vs 全屏卡片、动作条常驻 vs 页尾按钮） | ❌ **不必** —— 该随容器与平台走 | Apple HIG《Adapting to different platforms》：同一任务在不同设备上用**适合该设备**的呈现；GOV.UK Design System 讲的是"问同一组问题"，不是"长得一样" |

🔴 所以"移动端新建习惯是单列卡片 + 主按钮、web 是 40rem 对话框 + 常驻动作条"
**不是欠账**：两个容器本来就不同。真正的欠账是**判断分叉** ——
例如一端把"错误"和"说明"同时画出来、而另一端让说明让位。那一类才是本条要拦的。

⚠️ 这条**不是**给"两端随便各画各的"开的口子：版面差异必须能说出**为什么这个容器要这样**。
说不出来，那就是随手画的，回到 §1。
