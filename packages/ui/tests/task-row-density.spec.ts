/**
 * `TaskRow` 的 `density` 档位 —— **"density 没实现时会红"的判据**
 * ================================================================
 *
 * 出处：`docs/research/dida-view-unification.md` §4.2 / §4.3 ——
 *
 * > 四象限卡里的行 = `<TaskRow density="compact" />`，
 * > 日历格里的行 = `<TaskRow density="minimal" />`。**不是三份 JSX。**
 *
 * 背景（2026-09-28 实测）：在那之前 `TaskList` 把行的 JSX 内联在 `renderItem`
 * 里，**不存在**能传 `density` 的 `TaskRow`。当时的判据（`apps/web` 的
 * `quadrant-row-parity`）断言的是"列表的行 DOM == 象限的行 DOM" ——
 * **两边用同一个默认档时它必然通过**，所以在"density 完全没实现"时
 * 也是绿的。**它证明的是"象限没有另写行"，不是"密度真的分了三档"。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这道判据怎么做到"density 是装饰时变红"
 *
 * 三层，缺一不可：
 *
 *   A. **档位必须真的有差异**：`DENSITY_SPEC` 的三档两两在
 *      「可见槽位 + 空间 token」上不同。把所有档位都指向同一份规格
 *      （= "density 永远用同一档"）会让这一条**直接变红**。
 *   B. **同一密度下与当前默认档一致**：`comfortable` 必须逐项等于
 *      `task-row-shape.ts` 的 `TASK_ROW_SHAPE` 取值 + "两个插槽都显示"。
 *      这一条防的是"为了做出差异，把默认档也一起改了"。
 *   C. **组件必须真的用这个档位**（源码级）：`TaskRow.tsx` 里必须出现
 *      `resolveTaskRowDensity(density)`，且**不许**有
 *      `density === …` 散落分支、不许把 `'comfortable'` 写死。
 *      没有 C 的话，"在组件里硬编码默认档"能骗过 A 与 B。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 这道判据**抓不到**什么（如实写，别当它全覆盖）
 *
 * 1. **它不在 DOM 上比对**：`packages/ui` 的单测跑在 node 环境
 *    （`vitest.config.ts` 明确不 render、不引 jsdom / `@testing-library/*`），
 *    所以这里的"结构"是**渲染计划的纯数据**（槽位清单 + 空间 token），
 *    不是 `outerHTML`。真正的 DOM 级跨密度断言要放在 `apps/web/tests`
 *    （那里有 react-native-web + jsdom），而那是**下一刀**的白名单。
 * 2. 它不校验像素：密度差异是否"看起来对"仍要看真机/真浏览器（§6.2 规定一）。
 *
 * ⚠️ 这个包的单测 import 的是**源码** `../src/...`（不是 `dist/`）——
 * 这与 `apps/web` 不同（那边经 package exports 读 `dist`）。所以本文件
 * 不需要先 build；但为了让 apps 侧看到同一份实现，改动后仍需
 * `pnpm --filter @heyta/ui build`。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TASK_ROW_SHAPE } from '@heyta/design-system';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TASK_ROW_DENSITY,
  DENSITY_SPEC,
  TASK_ROW_DENSITIES,
  resolveTaskRowDensity,
  type TaskRowDensity,
} from '../src/task-list/density.js';

/**
 * 「同一实体在不同密度下渲染出的**计划**」。
 *
 * 输入是**生产的那张表**（`resolveTaskRowDensity`），不是测试里另抄一份 ——
 * 否则"组件没接上表"这件事又一次骗过测试。
 */
function plan(density: TaskRowDensity): {
  readonly slots: readonly string[];
  readonly minHeight: string | null;
  readonly bodyPaddingBlock: string;
  readonly gap: string;
} {
  const spec = resolveTaskRowDensity(density);
  return {
    slots: [
      // 骨架槽位**三档都在**：勾选框 + 标题是"这是一行"的定义，
      // 密度不许把它改掉（改了就是"另一种行"，不是"更紧凑的行"）。
      'checkbox',
      'title',
      ...(spec.showMeta ? ['meta'] : []),
      ...(spec.showTrailing ? ['trailing'] : []),
    ],
    minHeight: spec.minHeight,
    bodyPaddingBlock: spec.bodyPaddingBlock,
    gap: spec.gap,
  };
}

const source = (file: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/task-list/${file}`, import.meta.url)), 'utf8');

/**
 * 剥掉注释再断言。
 *
 * 🔴 这一步不能省：`TaskRow.tsx` 的文件头**故意**写着"默认档是
 * `'comfortable'`"这类说明，文件里也有讲解 `density === …` 为什么被禁止的
 * 文字。不剥注释的话，判据会被自己的说明文字弄红 ——
 * `apps/web/tests/quadrant-row-parity.spec.tsx` 实测踩过同一个坑
 * （见那里的"源码判断先剥掉注释"）。
 */
function stripComments(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
}


describe('TaskRow 的 density 档位', () => {
  it('档位是有界的，且表与清单一一对应（加了档位忘登记会红）', () => {
    expect(TASK_ROW_DENSITIES.length).toBe(3);
    expect([...TASK_ROW_DENSITIES].sort()).toEqual(Object.keys(DENSITY_SPEC).sort());
  });

  it('A. 同一实体在不同密度下，渲染计划必须两两不同', () => {
    const plans = TASK_ROW_DENSITIES.map((d) => ({ density: d, plan: plan(d) }));

    for (const left of plans) {
      for (const right of plans) {
        if (left.density === right.density) continue;
        // 🔴 这一条是"density 是装饰"的直接判据：把两档做成同一份规格，
        //    这里必然有一对相等 → 红。
        expect(
          left.plan,
          `档位 ${left.density} 与 ${right.density} 渲染出同一结构 —— density 变成了装饰`,
        ).not.toEqual(right.plan);
      }
    }
  });

  it('A2. 次要槽位的显隐按档位分：minimal 只有骨架，compact 仍带元信息与尾部', () => {
    // 日历格那种一格一行的地方：只有勾选框 + 标题。
    expect(plan('minimal').slots).toEqual(['checkbox', 'title']);
    // 象限卡：仍是完整的一行（拖动手柄在 renderTrailing 里，**不能**丢）。
    expect(plan('compact').slots).toEqual(['checkbox', 'title', 'meta', 'trailing']);
    expect(plan('comfortable').slots).toEqual(['checkbox', 'title', 'meta', 'trailing']);
    // compact 与 comfortable 的差异在空间（行高/内间距），不在槽位。
    expect(plan('compact').minHeight).not.toBe(plan('comfortable').minHeight);
    expect(plan('minimal').minHeight).toBeNull();
  });

  it('B. 默认档缺省即 comfortable，且与"抽取之前"的几何逐项一致', () => {
    expect(DEFAULT_TASK_ROW_DENSITY).toBe('comfortable');
    expect(resolveTaskRowDensity()).toEqual(DENSITY_SPEC.comfortable);
    expect(resolveTaskRowDensity('comfortable')).toEqual(DENSITY_SPEC.comfortable);

    // 🔴 承重：默认档必须仍然是 `task-row-shape.ts` 登记的那一组 token +
    //    两个插槽都渲染。有人把默认档"顺手调紧"会让这里红。
    expect(DENSITY_SPEC.comfortable).toEqual({
      minHeight: TASK_ROW_SHAPE.minHeight,
      bodyPaddingBlock: TASK_ROW_SHAPE.bodyPaddingBlock,
      gap: TASK_ROW_SHAPE.gap,
      showMeta: true,
      showTrailing: true,
    });
  });

  it('C. 组件必须真的把 density 交给表（硬编码默认档会红）', () => {
    const row = stripComments(source('TaskRow.tsx'));

    // density 必须流进唯一的解析入口 —— 而不是被忽略。
    expect(row).toMatch(/resolveTaskRowDensity\(\s*density\s*\)/);

    // 差异必须**单点定义**：组件里不许有散落的档位判断。
    expect(row).not.toMatch(/\bdensity\s*===/);
    expect(row).not.toMatch(/\bdensity\s*!==/);
    // 默认档名不许写死在组件里（否则"缺省档"与"表"会漂开两份真相）。
    expect(row).not.toContain("'comfortable'");

    // 计划里的三个槽位真的被读到了：否则表改了组件也不动。
    expect(row).toContain('spec.showMeta');
    expect(row).toContain('spec.showTrailing');
    expect(row).toContain('spec.minHeight');
    expect(row).toContain('spec.bodyPaddingBlock');

    // 行骨架的可寻址名字（各端按它做断言）必须在行组件里，不在列表里。
    expect(row).toContain('task-item-');
    expect(row).toContain('task-toggle-');
    expect(row).toContain('task-row-');
  });

  it('C2. `TaskList` 只渲染 `TaskRow`，不再内联一份行（回到"两份行"会红）', () => {
    const list = stripComments(source('TaskList.tsx'));

    expect(list).toContain('<TaskRow');
    // 行的骨架标记（勾选框 role）必须只在 TaskRow 里 —— TaskList 里再有
    // 一份就说明"抽取"没有收尾（旧那份没删掉），这正是本仓库踩过的形状。
    expect(list).not.toContain('accessibilityRole="checkbox"');
    // 列表只透传档位，不认识任何档位细节。
    expect(list).toContain('density');
    expect(list).not.toContain("'compact'");
    expect(list).not.toContain("'minimal'");

    // 空间几何也只该在行组件里。
    expect(list).not.toContain('checkboxHit');
  });
});
