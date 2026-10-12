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
```

> 该检查器已用**注入违规文件**验证过能失败（4 类硬编码全部抓到），
> 也验证过合规写法能通过。**不能失败的检查没有价值。**

### 🔴 对比度是测试保证的，不是文档保证的

`pnpm --filter @heyta/design-system test` 会解析 tokens.css、递归展开 `var()`、
按 WCAG 公式**真实计算**每一对前景/背景对比度，不达标就失败。

> **这个测试已经抓到过真问题**：`quadrant-3` 原用 amber-600（`3.19:1`）不达正文标准，
> 已改为 amber-700（`5.02:1`）。写在文档里的"4.5:1"是拦不住的。

### 容易犯的几个错

- ❌ **用 emoji 当图标** —— 跨平台渲染不一致且不受 token 控制。统一用 **Lucide**。
- ❌ **`outline: none`** —— 抹掉焦点环是最常见的可访问性回归。用 `:focus-visible`。
- ❌ **hover 用 `translateY` 位移** —— 扁平风格用**边框**表达层次，阴影只给真正的浮层。
- ❌ **不测暗色主题就交付** —— 暗色不是亮色的反相，必须**实际切换查看**。
- ❌ **数字不加 `.tabular-nums`** —— 番茄钟计时与统计数字的宽度会跳动。

---
