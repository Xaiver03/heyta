/**
 * 共享习惯列表的**选中痕迹**判据（源码级）
 * ======================================
 *
 * ## 为什么这一张面只能这么验
 *
 * `packages/ui` 的单测不引 jsdom、不 render（同 `auth-form.spec.ts` 文件头那段限制说明），
 * 而 `apps/mobile/tests/` 今天**一个 render 用例都没有** —— 也就是说 RN 端这张面上
 * "选中那一行到底说不说得出自己是选中"这件事，**没有任何一层行为测试会替它红**。
 *
 * 这不是假想的洞：本批 §8.26 逐处现量时数到**五处渲染点**，而 §8.22 那六条变异臂全部打在
 * web 的便签与任务上 ⇒ 覆盖面上 mobile 那一处一直是零断言。本文件补的就是那一格，
 * 并按 §4 的纪律给每条判据配了能红的臂（臂与红集记在工单 §8.34）。
 *
 * ## 判据的三条来路
 *
 *   1. **平铺 vs 对象形态**：RNW 0.21 会把 `accessibilityState={{ pressed }}` 整个丢掉，
 *      只有 `aria-pressed={selected}` 这种平铺写法落到 DOM 上（§7 里 RNW 吞属性那一族）。
 *   2. **属性必须住在可点的那颗上**：挂在里层 `View` 上时视觉照常、读屏不知道是哪一条，
 *      所以没有任何一条行为测试会红 —— 这正是"承重的无障碍通道"该由源码级判据守着的原因。
 *   3. **单层高亮同源于一个谓词**：选中态使用语义底色，不再在列表行外套边框。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../src/habits/HabitProgressList.tsx', import.meta.url)),
  'utf8',
);

/** 🔴 必须先剥注释：本组件的文件头与行内注释里就写着"不要用对象形态 `accessibilityState`"，
 *  不剥的话，判据会因为别人把理由写清楚而变红（同 `auth-form.spec.ts` 那条纪律）。 */
function stripComments(text: string): string {
  return text
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^\s*\/\/.*$/gm, '')
    // JSX 注释 `{/* … */}` 去掉上面块注释后只剩 `{ … }`，这里连着花括号一起剥。
    .replaceAll(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

const code = stripComments(source);

describe('HabitProgressList —— 选中痕迹的无障碍通道确实在', () => {
  it('🔴 行元素带**平铺** `aria-pressed={selected}`（对象形态会被 react-native-web 整个丢掉）', () => {
    expect(code).toMatch(/aria-pressed=\{selected\}/);
  });

  it('🔴 不许改用 `accessibilityState` 表达按下/选中（RNW 丢的是整组对象形态）', () => {
    expect(code).not.toMatch(/accessibilityState\s*=/);
  });

  it('🔴 `aria-pressed` 住在可点的那颗 `Pressable` 上，不是里层的 `View`/`Text`', () => {
    const at = code.indexOf('aria-pressed={selected}');
    expect(at, '上一条已经断过它在，这条的前提').toBeGreaterThan(-1);
    const before = code.slice(0, at);
    const pressable = before.lastIndexOf('<Pressable');
    const wrapper = Math.max(before.lastIndexOf('<View'), before.lastIndexOf('<Text'));
    expect(pressable, '找不到 `<Pressable` 开标签').toBeGreaterThan(-1);
    expect(pressable, '属性离最近的开标签是 `View`/`Text` ⇒ 它不在可点那颗上').toBeGreaterThan(wrapper);
  });
});

describe('HabitProgressList —— 单层高亮同源于一个谓词', () => {
  it('选中判据是**这一行的 id 相等**，不许按位置（列表一排序选中就跟着错行）', () => {
    expect(code).toMatch(/const selected = habit\.id === selectedId;/);
  });

  it('高亮底色挂在**同一个** `selected` 上', () => {
    expect(code).toMatch(/style=\{selected \? \[styles\.row, styles\.rowSelected\] : styles\.row\}/);
  });

  it('🔴 `rowSelected` 只用 `backgroundColor: color.primary-subtle`，不再套选中边框', () => {
    const block = code.slice(code.indexOf('rowSelected: {'));
    const body = block.slice(0, block.indexOf('}'));
    expect(body, '选中态没有底色线索').toMatch(/backgroundColor: tokens\['color\.primary-subtle'\]/);
    expect(body, '选中态仍然使用描边').not.toMatch(/border(Color|Width)\s*:/);
  });
});

describe('HabitProgressList —— 宿主没递选中时不许有任何一行亮', () => {
  it('`selectedId` 是**可选** prop（必填会让没接的宿主在运行时炸，AGENTS §3.3 同族）', () => {
    expect(code).toMatch(/readonly selectedId\?: string;/);
  });

  it('选中谓词只由 `selectedId` 与行 id 决定（不掺入 index / 布尔常量）', () => {
    // `selectedId` 为 undefined 时全列表 `=== selectedId` 都是 false ⇒ 零行亮。
    const at = code.indexOf('const selected =');
    expect(at).toBeGreaterThan(-1);
    const line = code.slice(at, code.indexOf('\n', at));
    expect(line).not.toMatch(/\bindex\b|\btrue\b|\bfalse\b/);
  });
});
