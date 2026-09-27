# 005 — CSS 动效收尾：按下反馈、非对称时序、材质过渡、死 token

- **Status**: DONE
- **Commit**: 18b34ce
- **Severity**: LOW
- **Category**: 3 Physicality & origin / 4 Interruptibility / 7 Cohesion & tokens / 8 Missed opportunities
- **Estimated scope**: `landing.css` + `motion.ts` + `Nav.tsx`

## Problem

五条独立的收尾问题，全部有 `file:line` 证据。

**(a) 图标按钮没有按下反馈**（AUDIT §3：「pressable elements with no press feedback」）

```css
/* apps/landing/src/styles/landing.css:211-223 — 当前 */
.lp-iconbtn {
  …
  transition: background-color var(--ht-duration-fast) var(--ht-ease-standard),
    color var(--ht-duration-fast) var(--ht-ease-standard);
}
.lp-iconbtn:hover { background: var(--ht-color-hover); color: var(--ht-color-foreground); }
```

全仓库唯一的 `:active` 规则是 `.lp-btn:active`（`:178`）。主题切换与 GitHub
两个图标按钮只有 hover、没有按下反馈。

**(b) 按钮按下/抬起共用同一套时序**（AUDIT §4：「Symmetric timing on press-and-release is a finding」）

```css
/* apps/landing/src/styles/landing.css:173-179 — 当前 */
    transform var(--ht-duration-press) var(--ht-ease-standard);
…
.lp-btn:active { transform: scale(var(--ht-motion-press-scale)); }
```

按下与抬起都走 `--ht-duration-press`（100ms）。注意 `:167-169` 的注释把
**按下 100ms** 记为刻意决定 —— 所以只让**抬起更快**（snap 回来），
不去动按下的 100ms。

**(c) 展厅序号徽章瞬变，所在行却在渐变**（AUDIT §8：状态变化瞬移）

```css
/* apps/landing/src/styles/landing.css:666-690 — 当前 */
.lp-showcase__index { … background: var(--ht-color-surface-sunken); color: …; }   /* 无 transition */
.lp-showcase__item--active .lp-showcase__index {
  background: var(--ht-color-primary);
  color: var(--ht-color-on-primary);
}
```

父级 `.lp-showcase__item` 在 `:655-657` 有 200ms 过渡，徽章却在跳。

**(d) 导航材质变化瞬移**（AUDIT §8：状态变化瞬移；也削弱了 `Nav.tsx:11-13` 声称的 scroll edge effect）

```tsx
// apps/landing/src/components/Nav.tsx:57 — 当前
        style={{ boxShadow: floating ? 'var(--ht-shadow-lg)' : 'var(--ht-shadow-sm)' }}
```

`.lp-nav__bar`（`landing.css:77-92`）没有声明任何 `transition`，阴影直接跳变。

**(e) 一个弹簧 token 定义了却没人读**（AUDIT §7：token 收敛）

`packages/design-system/src/tokens.css:394` 定义了
`--ht-motion-spring-response-rotation: 0.4`，但 `motion.ts:100-103` 只读了
damping 对与 move/sheet 两个 response。页面里唯一的旋转（主题图标，
`Nav.tsx:86-88`）用的是 `preset.ui`。**取值今天就恰好相同（都是 0.4），所以没有
视觉问题**；问题是设计系统哪天调了旋转响应，落地页会静默地留在旧手感上 ——
正是 `motion.ts:5-12` 警告的那种漂移。

## Target

**(a)**

```css
/* target */
.lp-iconbtn {
  …
  transition: background-color var(--ht-duration-fast) var(--ht-ease-standard),
    color var(--ht-duration-fast) var(--ht-ease-standard),
    transform var(--ht-duration-instant) var(--ht-ease-standard);
}

.lp-iconbtn:active {
  transform: scale(var(--ht-motion-press-scale));
}
```

**(b)** 抬起用 `--ht-duration-instant`（80ms，snap），按下保持 `--ht-duration-press`：

```css
/* target — 基态即"抬起" */
.lp-btn {
  …
  transition: background-color var(--ht-duration-fast) var(--ht-ease-standard),
    color var(--ht-duration-fast) var(--ht-ease-standard),
    border-color var(--ht-duration-fast) var(--ht-ease-standard),
    transform var(--ht-duration-instant) var(--ht-ease-standard);
}

/* 按下：稍慢，读起来是"故意的"；抬起走基态的 instant，snap 回来 */
.lp-btn:active {
  transform: scale(var(--ht-motion-press-scale));
  transition: background-color var(--ht-duration-fast) var(--ht-ease-standard),
    color var(--ht-duration-fast) var(--ht-ease-standard),
    border-color var(--ht-duration-fast) var(--ht-ease-standard),
    transform var(--ht-duration-press) var(--ht-ease-standard);
}
```

**(c)**

```css
/* target — 徽章与所在行同时序 */
.lp-showcase__index {
  …
  transition: background-color var(--ht-duration-normal) var(--ht-ease-standard),
    color var(--ht-duration-normal) var(--ht-ease-standard);
}
```

**(d)**

```css
/* target — landing.css:77-92 的 .lp-nav__bar 内新增一行 */
  box-shadow: var(--ht-shadow-md);
  transition: box-shadow var(--ht-duration-normal) var(--ht-ease-standard);
```

**(e)** 给 `MotionPreset` 加 `rotation`，读 `--ht-motion-spring-response-rotation`：

```ts
// target — apps/landing/src/lib/motion.ts
export interface MotionPreset {
  …
  /** 旋转（如主题图标翻转）：响应单独一条 token。 */
  rotation: Transition;
}

// useMotionPreset 内
    const responseRotation = readNumberToken('--ht-motion-spring-response-rotation', 0.4);
    …
      rotation: {
        type: 'spring',
        bounce: 1 - dampingDefault,
        duration: responseRotation,
      },
```

```tsx
// target — apps/landing/src/components/Nav.tsx:88
              transition={preset.rotation}
```

## Repo conventions to follow

- 所有时长必须用 token（`--ht-duration-instant|fast|normal|press`），
  禁止裸 `ms` —— `check:design` 会扫 `apps/landing/src` 并报错。
- 按下缩放值统一用 `--ht-motion-press-scale`（0.97），不要另写数字。
- 弹簧一律走出 `useMotionPreset()`。

## Steps

1. `landing.css`：按 (a) 改 `.lp-iconbtn` 并新增 `:active` 规则。
2. `landing.css`：按 (b) 改 `.lp-btn` 基态与 `:active`。
3. `landing.css`：按 (c) 给 `.lp-showcase__index` 加 transition。
4. `landing.css`：按 (d) 给 `.lp-nav__bar` 加 `box-shadow` transition。
5. `motion.ts`：`MotionPreset` 加 `rotation` 字段并实现；`Nav.tsx:88` 改用它。

## Boundaries

- **不要**动 `landing.css:167-169` 注释里记的「按下 100ms」这个刻意决定。
- 不改主题图标 ±90° 旋转的**方向语义**（`Nav.tsx:79-83` 注释，刻意设计）。
- 不改任何布局属性。
- 不新增依赖。
- **本计划不包含**「WebGL 画布淡入」（`Deferred` + lazy chunk 挂载时 `.lp-sync__canvas`
  会突然出现）。它需要给 `landing.css` 引入第一个 `@keyframes`，
  而该文件刻意保持零 keyframes（见 `SelfHost.tsx:95-102` 注释）。单独评估，不在本计划内。

## Verification

- **Mechanical**：`cd apps/landing && pnpm test && pnpm typecheck && pnpm build`；
  仓库根 `pnpm check` EXIT=0（重点看 `check:design` 是否因裸值报错）。
- **Feel check**：
  - 按住主题切换图标不放：应看到它**轻微缩小**；松开后**快速弹回**
    （比按下更快）。GitHub 按钮同样。
  - 慢放（playback 10%）看主 CTA：按下与抬起应当是**两种速度**，不是镜像。
  - 滚动到导航浮起的那一刻（约 24px）：阴影应**渐变**过去，不是突然变深。
  - 展厅里切换当前屏：序号徽章的底色应与所在行的变化**同时**发生。
  - `prefers-reduced-motion: reduce`：上述过渡被 token 压到 1ms，
    视觉上等同瞬时 —— 这是预期行为，不是 bug。
- **Done when**：`.lp-iconbtn` 有 `:active`；`grep -c "will-change"` 与本次无关；
  `grep -n "response-rotation" apps/landing/src/lib/motion.ts` 有命中。
