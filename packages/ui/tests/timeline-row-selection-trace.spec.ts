/**
 * 共享时间线板的**选中痕迹**判据（源码级）
 * ======================================
 *
 * ## 为什么这一张面要单独有一份
 *
 * 时间线行是门禁 F 的第五枚"面"，而它是**这一批里唯一一处 F 原本看不见的面**：
 * 它自己按 id 等值算、自己上 `rowActive` 底色，却登记在"递送层"里，而递送层不要求发
 * 无障碍通道（机制与一次性证明记在工单 §8.42）。修完之后，web 那一端由
 * `e2e/tests/selection-projections.spec.ts` 的真浏览器腿看着像素与属性，
 * 而 **RN 那一端今天没有任何一层行为测试会替它红** —— `packages/ui` 不 render、
 * `apps/mobile/tests/` 一个 render 用例都没有（同 `habit-row-selection-trace.spec.ts`
 * 文件头那段限制说明）。本文件补的就是那一格。
 *
 * ## 判据的三条来路
 *
 *   1. **平铺 vs 对象形态**：RNW 0.21 把 `accessibilityState={{ pressed }}` 整个丢掉，
 *      只有平铺 `aria-pressed={…}` 落到 DOM 上（§7 里 RNW 吞属性那一族）。
 *      RN 的 `AriaProps` 里**没有** `aria-current`，写它不报错也不生效。
 *   2. **一处底色就是一处面**：这块板把选中的行画在**两个地方**（有排期那一行的行区 +
 *      未排期泳道那一条）。只在一处说出来，另一处对读屏就是"没有选中"，
 *      而"这个文件里出现过通道"那种全文件计数**看不出这件事** —— 所以断言按 testID 逐处配对。
 *   3. **属性必须住在可点的那颗上**：挪到里层 `<Text>` 上时像素照常、读屏不知道是哪一条。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../src/timeline/TimelineBoard.tsx', import.meta.url)),
  'utf8',
);

/** 🔴 必须先剥注释：本组件的行内注释里就写着"平铺 `aria-pressed`"与 `styles.rowActive`，
 *  不剥的话，判据会因为别人把理由写清楚而变红（同 `auth-form.spec.ts` 那条纪律）。 */
function stripComments(text: string): string {
  return text
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^\s*\/\/.*$/gm, '')
    .replaceAll(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

const code = stripComments(source);

/** 两处渲染点：testID 前缀 + 它所属的底色表达式里那个"这一行的容器样式"名。 */
const SITES = [
  { name: '有排期那一行', testId: 'timeline-row-', containerStyle: 'styles.row' },
  { name: '未排期泳道那一条', testId: 'timeline-lane-item-', containerStyle: 'styles.laneItem' },
] as const;

/** 从 `testID={`<prefix>` 起，取到**这颗元素开标签结束**那一段（不含子树）。
 *  取法：从 testID 往后扫，`{`/`}` 记花括号深度，深度为 0 时遇到的第一个 `>` 就是开标签的结尾
 *  —— 不能"取前 N 个字符"，也不能"找第一个 `>`"：属性表达式里到处是 `=> ? :`，
 *  按字符数取窗口还会把里层 `<Text>` 蒙进来，那样"通道住在哪颗上"这条就永远看不出错位。 */
function ownTagSlice(testIdPrefix: string): string {
  const at = code.indexOf(`testID={\`${testIdPrefix}`);
  expect(at, `找不到 testID 前缀 ${testIdPrefix} —— 生产者改名了，这一面已经不在这里画`).toBeGreaterThan(-1);
  let depth = 0;
  let end = -1;
  for (let i = at; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) {
      end = i;
      break;
    }
  }
  expect(end, '这颗元素的开标签没有闭合 —— 扫描口径失效，不能拿整份文件去比').toBeGreaterThan(-1);
  const slice = code.slice(at, end);
  expect(slice.slice('testID={'.length), '开标签里出现了第二个 testID ⇒ 通道落到了别的元素上').not.toContain('testID=');
  expect(slice, '开标签里出现了子元素开标签 ⇒ 通道不在可点那颗上').not.toMatch(/<(Text|View)\b/);
  return slice;
}

describe('TimelineBoard —— 两处渲染点各自都要把选中说出来', () => {
  for (const site of SITES) {
    it(`🔴 ${site.name}：同一颗可点元素上带**平铺** \`aria-pressed={rowSelected}\`（对象形态会被 react-native-web 整个丢掉）`, () => {
      const slice = ownTagSlice(site.testId);
      expect(slice, '这一处只有底色、没有通道 ⇒ 选中对读屏不存在').toContain('aria-pressed={rowSelected}');
    });

    it(`🔴 ${site.name}：底色与通道挂在**同一个** \`rowSelected\` 上（改一条漏一条在截图上看不出来）`, () => {
      const slice = ownTagSlice(site.testId);
      expect(slice).toContain(`styles.rowActive`);
      expect(
        slice,
        '底色不是由同一个 `rowSelected` 决定的（改一条漏一条在截图上看不出来）',
      ).toMatch(
        new RegExp(
          `style=\\{\\s*rowSelected \\? \\[[^\\]]*styles\\.rowActive[^\\]]*\\] : ${site.containerStyle.replace('.', '\\.')}`,
        ),
      );
    });
  }

  it('🔴 不许用对象形态 `accessibilityState` 表达选中（RNW 丢的是整组对象形态）', () => {
    expect(code).not.toMatch(/accessibilityState\s*=/);
  });

  it('🔴 选中判据是**这一行的 id 相等**，两处各一份，都不许按位置或常量', () => {
    const matches = code.match(/const rowSelected = [^\n]*/g) ?? [];
    expect(matches.length, '两处渲染点各自要有一份谓词；数量对不上就是有一处被并走了或删了').toBe(2);
    for (const line of matches) {
      expect(line).toContain('activeTaskId === row.taskId');
      expect(line, '按 index 判选中：列表一排序选中就跟着错行').not.toMatch(/\bindex\b|\btrue\b|\bfalse\b/);
    }
  });

  it('`activeTaskId` 是**可选** prop（宿主没接时零行亮，而不是在运行时炸，AGENTS §3.3 同族）', () => {
    expect(code).toMatch(/readonly activeTaskId\?: string \| null;/);
  });
});
