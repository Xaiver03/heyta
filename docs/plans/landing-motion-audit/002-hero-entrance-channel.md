# 002 — 英雄卡：把入场位移与指针弹簧拆到两个元素上

- **Status**: DONE
- **Commit**: 18b34ce
- **Severity**: HIGH
- **Category**: 5 Performance（兼 3 Physicality & origin）
- **Estimated scope**: 1 个组件 + 1 个 CSS 文件

## Problem

`apps/landing/src/components/Hero.tsx:112-122` 在**同一个元素**上同时绑定了
指针弹簧的 `y`（走 `style`）和入场的 `y`（走 `initial`/`animate`）：

```tsx
// apps/landing/src/components/Hero.tsx:112-121 — 当前
<motion.div
  className="lp-hero__card"
  style={
    preset.reduced ? undefined : { rotateX, rotateY, x: shiftX, y: shiftY }
  }
  initial={preset.reduced ? { opacity: 0 } : { opacity: 0, y: '2rem', scale: 0.96 }}
  animate={{ opacity: 1, y: 0, scale: 1 }}
  transition={{ ...preset.sheet, delay: preset.reduced ? 0 : 0.12 }}
>
```

`style` 里绑定的 MotionValue 是该 key 的权威来源，`animate` 不再驱动它。
`shiftY` 的静止值是 0（`Hero.tsx:53`：`useTransform(pointerY,[0,1],[-8,8])`，
而 `pointerY` 初始 0.5），所以入场的 `y: '2rem' → 0` **从未执行过**。

两个后果：

1. **入场是死的**。英雄卡本该「从下方升起」，实际只有 opacity + scale 在动。
   这是无声的功能缺失 —— 没有任何报错，视觉上也「看起来还行」，所以一直没被发现。
2. **§5 性能**：四个 spring 分别写 `x`/`y`/`rotateX`/`rotateY` 四个 transform 键，
   AUDIT §5 的目标是合成成一条完整的 `transform` 字符串（单通道、单次写入）。

## Target

拆成两层：外层只负责入场，内层只负责指针倾斜。

```tsx
// target — apps/landing/src/components/Hero.tsx
<motion.div
  className="lp-hero__enter"
  initial={preset.reduced ? { opacity: 0 } : { opacity: 0, y: '2rem', scale: 0.96 }}
  animate={{ opacity: 1, y: 0, scale: 1 }}
  transition={{ ...preset.sheet, delay: preset.reduced ? 0 : 0.12 }}
>
  <motion.div
    className="lp-hero__card"
    style={preset.reduced ? undefined : { transform: tilt, transformStyle: 'preserve-3d' }}
  >
    <AppWindow view="tasks" />
    {/* 两片浮层原样留在卡内 */}
  </motion.div>
</motion.div>
```

把四个弹簧合成一条 transform 字符串：

```ts
// target — 放在 Hero.tsx 现有四个 spring 定义之后
const tilt = useTransform(
  [rotateX, rotateY, shiftX, shiftY],
  ([rx = 0, ry = 0, sx = 0, sy = 0]) =>
    `translate3d(${sx}px, ${sy}px, 0) rotateX(${rx}deg) rotateY(${ry}deg)`,
);
```

（`noUncheckedIndexedAccess` 下数组解构会带 `undefined`，所以用 `= 0` 默认值。）

CSS 侧：

```css
/* target — apps/landing/src/styles/landing.css */

/* 外层：入场通道。保留 3D 上下文，否则 .lp-hero__stage 的 perspective
   传不到卡上（卡变成孙级） */
.lp-hero__enter {
  transform-style: preserve-3d;
}

.lp-hero__card {
  position: relative;
  z-index: var(--ht-z-base);
  transform-style: preserve-3d;
}

/* will-change 只在**能触发倾斜**的设备上给（AUDIT §5：永久/无差别提升图层
   会常驻吃掉 GPU 内存，而触摸设备根本不会倾斜） */
@media (hover: hover) and (pointer: fine) {
  .lp-hero__card {
    will-change: transform;
  }
}
```

## Repo conventions to follow

- 3D 透视放在父级 `.lp-hero__stage`（`landing.css:302` `perspective: 90rem`）
  —— 见该处注释。所以新增的中间层必须 `transform-style: preserve-3d`，
  否则破坏纵深。
- 弹簧一律取自 `useMotionPreset()`；倾斜幅度常量 `TILT_Y`/`TILT_X`（`Hero.tsx:31-32`）不动。
- reduced-motion 下 `style` 传 `undefined`，倾斜整体消失 —— 保持现有做法
  （`Hero.tsx:56,66,115-117`）。

## Steps

1. `Hero.tsx`：在四个 spring 之后新增 `tilt`（`useTransform` 数组合并）。
2. `Hero.tsx`：把现有 `.lp-hero__card` 的 `motion.div` 包进新的
   `.lp-hero__enter` `motion.div`，入场三件套搬到外层；内层只留 `style`。
   注意 `<AppWindow>` 与两片 `.lp-float` 仍留在**卡内**（它们靠
   `.lp-hero__card` 的 3D 空间分层，不能提到外层）。
3. `landing.css`：新增 `.lp-hero__enter`；把 `.lp-hero__card` 的
   `will-change: transform` 移到 `@media (hover: hover) and (pointer: fine)` 块内。
4. 确认 `.lp-hero__card` 上的 `transform-style: preserve-3d` 仍在（浮片纵深依赖它）。

## Boundaries

- 不动 `handlePointerMove` / `handlePointerLeave` 的逻辑与阈值。
- 不动倾斜幅度、`perspective-origin`、浮片的 `--lp-float-z` 取值。
- 不改 `.lp-hero` 分栏与任何布局属性 —— 新增外层必须是**布局中性**的
  （block 包裹块级卡，不产生额外间距或收缩）。
- 不新增依赖。

## Verification

- **Mechanical**：`cd apps/landing && pnpm test && pnpm typecheck && pnpm build`；
  仓库根 `pnpm check` EXIT=0（`check:design` 会扫 `apps/landing/src`，
  新 CSS 只能用 token，不能出现裸 `px`/`ms`）。
- **Feel check**：
  - 硬刷新首屏（DevTools → Network → Disable cache），确认英雄卡**从下方 2rem 升起**
    并同时 scale 0.96→1 —— 修之前只有淡入+放大，没有上升。
  - 鼠标在右侧舞台内画圈：卡片应平滑跟随倾斜，**且不再有入场时的位置跳变**。
  - 鼠标移出：卡片应从**当前角度**平滑回中，不是先跳回再回中。
  - DevTools → Rendering → playback 10%：入场与倾斜是两个独立通道，互不干扰。
  - `prefers-reduced-motion: reduce`：倾斜完全不生效，仍有淡入。
- **Done when**：英雄卡首屏可见上升位移；`style` 上不再同时出现入场 `y` 与指针 `y`。
