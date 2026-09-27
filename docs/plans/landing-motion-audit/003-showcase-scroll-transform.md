# 003 — 展厅 coverflow：合成单条 transform，并把 `will-change` 收进视口

- **Status**: DONE
- **Commit**: 18b34ce
- **Severity**: HIGH
- **Category**: 5 Performance
- **Estimated scope**: 1 个组件 + 1 个 CSS 文件

## Problem

`apps/landing/src/components/Showcase.tsx:75-90` 用**四个独立的 MotionValue**
分别驱动 `x` / `z` / `rotateY` / `scale`：

```tsx
// apps/landing/src/components/Showcase.tsx:78-89 — 当前
  const rotateY = useTransform(offset, (o) => o * -34);
  const x = useTransform(offset, (o) => `${String(o * 46)}%`);
  const z = useTransform(offset, (o) => o * -220);
  const scale = useTransform(offset, (o) => 1 - Math.min(0.18, Math.abs(o) * 0.1));
  …
        : { opacity, rotateY, x, z, scale, transformStyle: 'preserve-3d' }
```

这是页面**签名级**的滚动交互（300vh sticky + 三块整屏窗口联动的 3D coverflow），
而每个窗口每帧要写 4 个 transform 键。AUDIT §5 的目标是把它合成成
**一条完整的 `transform` 字符串**：单通道、每帧一次写入。

同时 `landing.css:711-715` 给三个**常驻挂载**的整屏窗口加了永久 `will-change`：

```css
/* apps/landing/src/styles/landing.css:711-715 — 当前 */
.lp-showcase__win {
  position: absolute;
  inset: 0;
  will-change: transform, opacity;
}
```

三块窗口是 `inset: 0` 的整屏元素，内部还各自含 `backdrop-filter` 材质
（`mockup.css` 的窗口 chrome）。永久提升三层大图层 = 页面整个生命周期都在吃
GPU 内存，而这套变换只在展厅这一节滚动时才发生。AUDIT §5：`will-change`
应当是**窄而临时**的。

## Target

合成单条 transform：

```ts
// target — apps/landing/src/components/Showcase.tsx，替换 :78-81 的四个 useTransform
const transform = useTransform(offset, (o) => {
  const tx = o * 46;                                  // %
  const tz = o * -220;                                // px
  const ry = o * -34;                                 // deg
  const s = 1 - Math.min(0.18, Math.abs(o) * 0.1);    // 无单位
  return `translateX(${tx}%) translateZ(${tz}px) rotateY(${ry}deg) scale(${s})`;
});
```

绑定：

```tsx
// target
      style={
        reduced
          ? { opacity }
          : { opacity, transform, transformStyle: 'preserve-3d' }
      }
```

`will-change` 收进视口（用 IntersectionObserver 给 section 打一个 `data-active`）：

```tsx
// target — Showcase() 内新增
const [active3d, setActive3d] = useState(false);

useEffect(() => {
  const el = sectionRef.current;
  if (el === null || typeof IntersectionObserver === 'undefined') return;
  const observer = new IntersectionObserver(
    (entries) => {
      setActive3d(entries[0]?.isIntersecting ?? false);
    },
    { rootMargin: '25% 0% 25% 0%' },
  );
  observer.observe(el);
  return () => {
    observer.disconnect();
  };
}, []);
```

```tsx
// target — section 上
<section className="lp-showcase" id="showcase" ref={sectionRef} data-active={active3d ? 'true' : undefined}>
```

```css
/* target — apps/landing/src/styles/landing.css */
.lp-showcase__win {
  position: absolute;
  inset: 0;
}

/* 只在展厅进入视口时才提升图层（AUDIT §5：will-change 必须窄而临时） */
.lp-showcase[data-active='true'] .lp-showcase__win {
  will-change: transform, opacity;
}
```

## Repo conventions to follow

- 变量命名避免与已有的 `active` 状态（`Showcase.tsx:101`，表示当前第几屏）冲突，
  所以新状态叫 `active3d`。
- `IntersectionObserver` 的可用性兜底范式见 `components/Deferred.tsx`：
  `typeof IntersectionObserver === 'undefined'` 时直接认为可见。
- 该文件刻意让三块窗口**常驻挂载**（`Showcase.tsx:14-15` 注释：重挂会重建
  每块的 ResizeObserver 与缩放计算，滚动中会闪）—— **不要**改成条件挂载。

## Steps

1. `Showcase.tsx`：把 `:78-81` 的四个 `useTransform` 换成单条 `transform`。
2. `Showcase.tsx`：`style` 绑定改为上面的形态（`x/z/rotateY/scale` 四个键移除）。
3. `Showcase.tsx`：`useState` 已 import；补 `useEffect` 到 `react` 的 import 里
   （当前是 `import { useRef, useState } from 'react';`）。
4. `Showcase.tsx`：加 `active3d` 状态与 observer；section 上挂 `data-active`。
5. `landing.css`：按上面的 target 拆分 `.lp-showcase__win` 与 `will-change` 规则。
6. 确认 `reduced` 分支仍然只传 `{ opacity }`（`Showcase.tsx:87-88`），
   即 reduced-motion 下**不产生任何 3D 变换**。

## Boundaries

- 不改几何取值：`46%` / `-220px` / `-34deg` / `0.18` / `0.1` / `1.05` 全部保持原样。
- 不改 `.lp-showcase` 的 `min-block-size: 300vh`、sticky、`perspective: 90rem`。
- 不引入 `@scroll-timeline` / `animation-timeline`（兼容性未达标）。
- 不改 `useScroll` 的 `offset`。
- 不新增依赖。

## Verification

- **Mechanical**：`cd apps/landing && pnpm test && pnpm typecheck && pnpm build`；
  仓库根 `pnpm check` EXIT=0。`tests/render.spec.tsx` 会渲染整页 —— 它已给
  `IntersectionObserver` 装了永不交错的桩，所以 `data-active` 不会出现，
  断言不应因此变化。
- **Feel check**：
  - 慢速滚动穿过展厅：三块窗口应**严格联动**（同一滚动进度推导），
    换位过程顺滑，没有某块独自跑偏。
  - DevTools → Performance 录制一次展厅滚动：不应出现长任务或明显的
    dropped frame；三块窗口的 transform 每帧只写一次（Elements 面板看 style 属性）。
  - 滚过展厅后回到页面顶部，在 Elements 里确认 `will-change` 已从三块窗口上消失。
  - `prefers-reduced-motion: reduce`：退化成纯透明度交叉淡入，**没有位移/旋转**。
- **Done when**：`Showcase.tsx` 中不再出现 `rotateY` / `z` / `scale` 作为 `style` 键；
  三个窗口的 `will-change` 只在展厅进入视口时存在。
