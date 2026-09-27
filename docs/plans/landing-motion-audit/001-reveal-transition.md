# 001 — 给 `revealVariants` 补上 transition，让入场回到设计系统的物理

- **Status**: DONE
- **Commit**: 18b34ce
- **Severity**: HIGH
- **Category**: 7 Cohesion & tokens（兼 2 Easing & duration）
- **Estimated scope**: 2 个源文件 + 5 个调用点 + 1 个测试文件

## Problem

`apps/landing/src/lib/motion.ts:135-146` 的 `revealVariants` 在**正常模式**下不给
`transition`：

```ts
// apps/landing/src/lib/motion.ts:142-145 — 当前
  return {
    hidden: { opacity: 0, y: distance },
    visible: { opacity: 1, y: 0 },
  };
```

`y` 属于 Motion 的 transform 键，没有 `transition` 时 Motion 会回落到库内置的
`underDampedSpring`。已在依赖里核实：

```js
// node_modules/.pnpm/motion-dom@13.4.4/.../animation/utils/default-transitions.mjs
const underDampedSpring = { type: "spring", stiffness: 500, damping: 25, restSpeed: 10 };
```

换算成 Apple 的阻尼比：ζ = 25 / (2·√500) ≈ **0.56**，即 bounce ≈ **0.44**。这超出
AUDIT §4 建议的 0.1–0.3，也远超该文件自己声明的物理。

为什么这条最该修：`revealVariants` 是全页**用得最多**的入场动效（Capabilities、
Hero/Facts、SelfHost、FinalCta 都走它），而 `motion.ts:5-12` 的文件头明确写了
不许制造「第二个权威」—— 结果恰恰是它的主力入场动效跑在库默认值上，
`tokens.css` 改任何弹簧参数都不会影响它，而且没有任何一处会报错。

同一时刻，导航条与英雄卡用的是 `preset.ui` / `preset.sheet`（临界阻尼、bounce 0）。
所以现在同一页面上并存两种互不相关的弹簧人格。

## Target

`visible` 必须携带一条**由调用方传入**的、源自 `tokens.css` 的 transition。
参数设为**必填**，从类型上杜绝再次回落到库默认值：

```ts
// target — apps/landing/src/lib/motion.ts
export function revealVariants(
  reduced: boolean,
  distance: string,
  transition: Transition,
): Variants {
  if (reduced) {
    return {
      hidden: { opacity: 0 },
      visible: { opacity: 1, transition: { duration: 0.2 } },
    };
  }
  return {
    hidden: { opacity: 0, y: distance },
    visible: { opacity: 1, y: 0, transition },
  };
}
```

调用方一律传 `preset.ui`（临界阻尼 spring，response 来自
`--ht-motion-spring-response-move: 0.4`）：

```tsx
// target — 调用点示例
const copy = revealVariants(preset.reduced, '1rem', preset.ui);
```

## Repo conventions to follow

- 弹簧取值**只能**来自 `useMotionPreset()`（`motion.ts:96-126`），它已经把
  `--ht-motion-spring-damping-default` / `--ht-motion-spring-response-move`
  换算成 Motion 的 `{ stiffness, damping, mass }` 与 `{ type:'spring', bounce, duration }`。
  **不要在落地页里新写 `{ bounce, duration }` 字面量。**
- reduced-motion 的降级范式见 `motion.ts:136-141`：去掉位移、保留 opacity，
  绝不写成 `animation: none`。

## Steps

1. `apps/landing/src/lib/motion.ts`：把 `revealVariants` 的签名改成上面的三参数版本，
   `transition` 为必填；正常分支把 `transition` 放进 `visible`。
2. 更新调用点，全部补第三个实参 `preset.ui`：
   - `apps/landing/src/components/Hero.tsx:72`（`copy`）
   - `apps/landing/src/components/Capabilities.tsx`（`revealVariants(preset.reduced)`）
   - `apps/landing/src/components/SelfHost.tsx:82`、`:91`、`:126`
   - `apps/landing/src/components/FinalCta.tsx`（`revealVariants(preset.reduced)`）
   - 用 `grep -rn "revealVariants(" apps/landing/src` 确认没有漏网。
3. `apps/landing/tests/motion.spec.ts`：现有 3 条断言在 `:58-76`，调用形式是
   `revealVariants(false)` / `revealVariants(true)`。改为传一个本地常量：

   ```ts
   const TEST_TRANSITION = { type: 'spring', bounce: 0, duration: 0.4 } as const;
   ```
   并**新增一条**把 bug 钉死的断言：正常模式下 `visible` 必须带上传入的 transition
   （用文件里已有的 `transitionOf()` 收窄工具，见 `:84-87`）。

## Boundaries

- 不改 `staggerContainer` 的语义（那是 004 的范围）。
- 不改任何组件里的位移距离与错峰值。
- 不新增依赖。
- 若发现某调用点签名与上面不符（相对 `18b34ce` 已漂移），停下来报告，不要即兴发挥。

## Verification

- **Mechanical**：`cd apps/landing && pnpm test && pnpm typecheck && pnpm build`；
  回到仓库根 `pnpm check` 必须 EXIT=0。
- **Feel check**：
  - 滚到「能力」（Capabilities）一节，让入场重放（刷一次页面再滚）：
    元素应当是**干脆地就位、不回弹**；修之前是明显过冲的弹一下。
  - DevTools → Rendering → 把 playback 调到 10%，逐帧看入场尾部：不应出现
    超过目标位再折返的帧。
  - 打开 Rendering → `prefers-reduced-motion: reduce`，确认位移消失但仍有淡入。
- **Done when**：`revealVariants` 的 `transition` 是必填参数，`grep -c "revealVariants("`
  的调用点全部带第三个实参，且新增断言在删掉 `transition` 后会失败。
