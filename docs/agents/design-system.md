<!-- 由 heyta/AGENTS.md 按作用域拆分而来（2026-10-12）。内容零删除。
     本文件是「设计系统（UI 代码必读）」的完整规则（原文 §5 设计系统）。返回入口：[`AGENTS.md`](../../AGENTS.md)。
     原始单体文件备份：`AGENTS.md.bak-full-2026-10-12`。 -->

## 5. 设计系统（UI 代码必读）

**唯一事实源：[`packages/design-system/src/tokens.css`](../../packages/design-system/src/tokens.css)。**
规则与理由见 [`design-system/heyta/MASTER.md`](../../design-system/heyta/MASTER.md)（**不复制取值表**）。

**色系：蓝白。** 主蓝 `#2563EB`，近白底 `#F8FAFC`，冷调石板灰中性色。

### 🔴 三条硬规则

1. **组件禁止裸值** —— 不得出现裸 hex / px / ms / z-index / rgb()。
   用 `cssVar('color.foreground')`（类型安全，拼错编译期报错）。
2. **语义名，不用外观名** —— `--ht-color-danger` 而不是 `--ht-red`。
   组件只消费语义层，原始色阶（`--ht-blue-600`）留给设计系统内部。
3. **要新变量，先加 token** —— 先改 tokens.css 与 `TOKEN_GROUPS`，再消费。
   **加 token 的成本是刻意的**，它逼你想清楚这个值是不是一次性的。

```bash
pnpm check:design     # 非零退出 = 有裸值
```

#### 🔴 文字层级（2026-09-30 增：排版审计实测"一页八个页标题"）

语义文字样式的唯一规范是 `packages/design-system/src/typography.ts` 的
`TEXT_STYLES`（字号+字重+行高+字距**整条消费**，不许只挑字号）。web 的映射：

| 角色 | 值 | 例 |
|---|---|---|
| 页标题（一屏一个） | xl + semibold（`.ht-header__title`） | 设置 / 收集箱 |
| 区块标题 | **lg + semibold**（= 共享层 `section-title`） | 设置的"功能模块/提醒通知"、任务分组头 |
| 子块/卡片标题 | base + semibold（`.ht-settings__h3`） | 面板里的小节 |
| 正文 | base + regular，行高 `--ht-line-height-normal` | |
| 辅助/说明 | xs 或 sm + muted 色 | 卡片描述、表单注释 |

反例（已修）：设置面板标题曾是 xl + bold —— 与页标题一般大，层级全塌。

> 该检查器已用**注入违规文件**验证过能失败（它扫的类别数由自己打印，现量看 `pnpm check:design` 第一行；
> 这一句原先钉着的类数早已落后于实现）。⚠️ 它只证过**注入的那几类**会红，
> **不等于每一类都有注入证据** —— 要新增一类就先补一枚能红的臂，别替它吹。
> **不能失败的检查没有价值。**

### 🔴 对比度是测试保证的，不是文档保证的

`pnpm --filter @heyta/design-system test` 会解析 tokens.css、递归展开 `var()`、
按 WCAG 公式**真实计算**每一对前景/背景对比度，不达标就失败。

> **这个测试已经抓到过真问题**：`quadrant-3` 原用 amber-600（`3.19:1`）不达正文标准，
> 已改为 amber-700（`5.02:1`）。写在文档里的"4.5:1"是拦不住的。

### 🔴 行内动作条：每一枚动作都是 `.ht-chip`，不许裸 `<summary>`

`.ht-compose-actions__items` 这一排（备注 / 子任务 / 截止 / 提醒 / AI …）里，
动作的**字号不属于组件，属于这一排**：`.ht-chip` = `font-size-2xs`（11px）。
一枚裸 `<summary>` 只写 display/gap/color 时，字号会**回落到从行的 16px** ——
于是同一排出现 11px 与 16px 两档，而所有测试都是绿的。

2026-10-21 实测（1012×632 打开「更多」）：`备注/子任务/提醒` = 11px，`截止` = **16px**，
用户一眼看出来（"截止这两个字也太大了吧"）。修法是把它收进 `.ht-chip`，
判据是 `e2e/tests/ai-panel-layout.spec.ts` 里那条**同一排 font-size 必须只有一档**。

### 🔴 把 RN 组件嵌进 web 的 flex 行：必须显式给它 `flex` / `max-inline-size`

React Native 的 `View` 默认 `flex: 0 0 auto`（与 CSS 的 `0 1 auto` **不同**），
`width: auto` 于是解析成 **max-content**。嵌进 web 的 flex 行时，它会**既不收缩也不换行**，
把容器撑破。实测：AI 提案面板（RN `View`）在 384px 的行内浮层里量到 **493px**，
左溢 121px 压住任务列表 —— 原因是 note 那一整行 469px + 内边距 24px。
判据与修法都在 `apps/web/src/styles/app/controls.css` 的
`.ht-compose-actions__items > [role='dialog']` 那一段（`flex: 1 1 100%` + `min-inline-size: 0`）。

### 容易犯的几个错

- ❌ **用 emoji 当图标** —— 跨平台渲染不一致且不受 token 控制。统一用 **Lucide**。
- ❌ **`outline: none`** —— 抹掉焦点环是最常见的可访问性回归。用 `:focus-visible`。
- ❌ **hover 用 `translateY` 位移** —— 扁平风格用**边框**表达层次，阴影只给真正的浮层。
- ❌ **不测暗色主题就交付** —— 暗色不是亮色的反相，必须**实际切换查看**。
- ❌ **数字不加 `.tabular-nums`** —— 番茄钟计时与统计数字的宽度会跳动。

---
