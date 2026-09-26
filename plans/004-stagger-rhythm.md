# 004 — 错峰节奏收敛成唯一权威

- **Status**: DONE
- **Commit**: 18b34ce
- **Severity**: MEDIUM
- **Category**: 7 Cohesion & tokens
- **Estimated scope**: 1 个文件（`motion.ts`）+ 5 个调用点

## Problem

错峰步长以**手写字面量**散落在六个地方，且彼此不一致：

| 位置 | 取值 |
| --- | --- |
| `apps/landing/src/lib/motion.ts:149` | `stagger = 0.06`（默认值） |
| `apps/landing/src/lib/motion.ts:155` | `delayChildren: 0.05` |
| `apps/landing/src/components/Hero.tsx:78` | `0.08` |
| `apps/landing/src/components/Hero.tsx:187` | `0.07` |
| `apps/landing/src/components/Capabilities.tsx:172` | `0.06` |
| `apps/landing/src/components/SelfHost.tsx:68` | **`0.16`** |
| `apps/landing/src/components/SelfHost.tsx:120` | `0.07` |

```tsx
// apps/landing/src/components/SelfHost.tsx:68 — 当前
            variants={staggerContainer(preset.reduced, 0.16)}
```

AUDIT §7：组入场应当用 **30–80ms** 的错峰。`0.16`（160ms）是上限的两倍，
也是全页其他入场的 2–2.7 倍 —— 终端那一节因此成为全页**最慢、最散**的一次浮现，
而它本该是最紧凑的一块。其余 `0.06/0.07/0.08` 则是典型的「五个几乎一样、
但又不完全一样」的漂移形态，文件头 `motion.ts:5-12` 恰恰在警告这件事。

## Target

在 `motion.ts` 里定义唯一一组常量，所有调用点引用它：

```ts
// target — apps/landing/src/lib/motion.ts
/** 全页统一的错峰步长。AUDIT §7：组入场用 30–80ms。 */
export const STAGGER = 0.07;
/** 组内首个元素的额外延迟，让「一组」和「上一组」分得开。 */
export const STAGGER_DELAY_CHILDREN = 0.05;
/** 首屏英雄区入场的整体延迟 —— 一次性的，不属于错峰体系。 */
export const HERO_ENTRANCE_DELAY = 0.12;
```

```ts
// target — staggerContainer 的默认值与 delayChildren 改用常量
export function staggerContainer(reduced: boolean, stagger = STAGGER): Variants {
  return {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: reduced ? 0 : stagger,
        delayChildren: reduced ? 0 : STAGGER_DELAY_CHILDREN,
      },
    },
  };
}
```

调用点一律改成 `staggerContainer(preset.reduced)`（不再传字面量），
`SelfHost.tsx:68` 的 `0.16` 因此落到 `0.07`。`Hero.tsx:121` 的 `delay: 0.12`
改用 `HERO_ENTRANCE_DELAY`。

## Repo conventions to follow

- `motion.ts` 的导出都带一段解释「为什么是这个值」的中文注释 —— 新常量照此办理，
  不要只写裸数字。
- 错峰**只**在 reduced-motion 下归零（`staggerContainer` 已处理），
  不要在调用点再判断一次。

## Steps

1. `motion.ts`：新增 `STAGGER` / `STAGGER_DELAY_CHILDREN` / `HERO_ENTRANCE_DELAY`
   三个导出常量（放在 `staggerContainer` 上方）。
2. `motion.ts`：`staggerContainer` 的默认形参改为 `STAGGER`，
   `delayChildren` 改用 `STAGGER_DELAY_CHILDREN`。
3. 把调用点里的字面量去掉，改为依赖默认值：
   - `Hero.tsx:78` `staggerContainer(preset.reduced, 0.08)` → `staggerContainer(preset.reduced)`
   - `Hero.tsx:187` `0.07` → 同上
   - `Capabilities.tsx:172` `0.06` → 同上
   - `SelfHost.tsx:68` `0.16` → 同上
   - `SelfHost.tsx:120` `0.07` → 同上
   - `Hero.tsx:121` `delay: preset.reduced ? 0 : 0.12` → `HERO_ENTRANCE_DELAY`
4. 用 `grep -rn "staggerContainer(" apps/landing/src` 确认没有遗漏的字面量实参。

## Boundaries

- 不改 `staggerContainer` 的函数形状与 reduced-motion 语义。
- 不改 `tests/motion.spec.ts:89-100` 的显式传参断言（它们传 `0.12`，
  仍应通过 —— 显式实参高于默认值）。
- 不改 001 已改的 `revealVariants` 签名。**001 必须先完成。**
- 不新增依赖。

## Verification

- **Mechanical**：`cd apps/landing && pnpm test && pnpm typecheck`；
  仓库根 `pnpm check` EXIT=0。
- **Feel check**：
  - 滚到「自建」一节：终端里的命令行应当**紧凑地逐行出现**，
    修之前是拖沓地一条条慢慢冒出来。三张步骤卡也应与全页其他组入场节奏一致。
  - 同一页里横向对比 Hero / 能力 / 自建 / 末尾 CTA 四组入场：
    错峰观感应当**一致**，不应有任何一组明显更慢。
  - `prefers-reduced-motion: reduce`：所有元素同时出现，无逐项错峰。
- **Done when**：`grep -rn "staggerContainer(preset.reduced," apps/landing/src` 无输出；
  全页只存在 `STAGGER = 0.07` 一个错峰值。
