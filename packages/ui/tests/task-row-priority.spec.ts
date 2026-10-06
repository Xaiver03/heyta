/**
 * W5：复选框描边即优先级 —— **优先级 → 颜色**这条判断的唯一一份的判据
 * =====================================================================
 *
 * 出处：`docs/plans/detail-pane-alignment.md` W5（调研 A2 / 主计划 §5.3 第 3 条
 * "最值得抄"）。工单给的判据原话是：
 *
 * > 优先级不同的任务，复选框描边色**互不相同且等于该优先级的既有颜色 token**；
 * > ⚠️ 暗色主题必须实际切了看。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这个文件为什么是 W5 的**承重**层
 *
 * W5 改的是 `packages/ui` 的 `TaskRow`，所以它是**四端同时受益**的一刀；
 * 反过来说，判据放在任何一个宿主里都只覆盖那一个宿主。这里量三层：
 *
 *   1. **映射本身**（`priorityColorToken`）：四档 + `undefined`、穷尽、不许悬空。
 *   2. **取值真的互不相同**：light 与 dark **各量一遍** ——
 *      工单那句"暗色必须实际切了看"的数据层证据在这，
 *      界面层的证据是 `e2e/tests/task-priority-checkbox.spec.ts` 的两张图（亮 + 暗）。
 *   3. **行组件真的用了它**（源码级，剥注释）：`TaskRow.tsx` 里必须出现
 *      `priorityColorToken(row.source.priority)`，且 `styles.box` 里**不许**
 *      再有 `color.border-strong`（= 把描边写死成中性色，工单点名的那条变异）。
 *   4. **全仓只有一份定义**：抽取的收尾动作。AGENTS §3.5 记的就是
 *      "抽出了一个共享实现 ≠ 重复被消除了"，所以这条按目录遍历，不点名文件 ——
 *      点名清单挡不住"在第四个文件里再写一份"。
 *
 * ⚠️ 本包单测 import 的是**源码** `../src/...`（不是 `dist/`），所以这里不需要先 build；
 *    但两个宿主经 package exports 读 `dist`，改动后仍需
 *    `pnpm --filter @heyta/ui build`（工单 §1 闸门 4）。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { darkTokens, lightTokens } from '@heyta/design-system';
import { Priority } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

import { priorityColorToken, type PriorityColorToken } from '../src/task-list/priority-color.js';

/** 全部档位，含"根本没这个字段"。 */
const CASES: readonly (readonly [Priority | undefined, PriorityColorToken])[] = [
  [Priority.None, 'color.priority-none'],
  [Priority.Low, 'color.priority-low'],
  [Priority.Medium, 'color.priority-medium'],
  [Priority.High, 'color.priority-high'],
  // 🔴 `Task.priority` 是**可选**字段（`entities.ts` 的 `priority?: Priority`）。
  // 行组件传的就是它，所以 `undefined` 必须是**判据里的一档**而不是被 TS 挡在门外。
  [undefined, 'color.priority-none'],
];

const THEMES = [
  ['light', lightTokens],
  ['dark', darkTokens],
] as const;

/**
 * 从 worktree 根往下遍历源码，跳过构建产物与依赖。
 *
 * 🔴 为什么不用一个写死的文件清单：这条判据要抓的是"有人在别处又写了一份"，
 * 而"别处"是一个还没被命名的文件 —— 点名清单在这个形状上必然是空的。
 */
function* sourceFiles(dir: URL): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', 'dist-types', 'test-results', 'coverage', '.git'].includes(entry)) {
      continue;
    }
    const abs = fileURLToPath(new URL(entry, dir));
    const st = statSync(abs);
    if (st.isDirectory()) {
      yield* sourceFiles(new URL(`${entry}/`, dir));
    } else if (/\.(?:ts|tsx|js|jsx)$/.test(entry)) {
      yield abs;
    }
  }
}

/** 剥注释：判据不能被自己的说明文字弄红（同 `task-row-density.spec.ts` 的教训）。 */
function stripComments(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
}

const repoRoot = new URL('../../../', import.meta.url);

describe('W5 优先级 → 语义色 token：映射本身', () => {
  it('四档各归位，`undefined` 落到 none（不是 crash、不是随手一个色）', () => {
    for (const [priority, expected] of CASES) {
      expect(priorityColorToken(priority), `档位 ${String(priority)}`).toBe(expected);
    }
  });

  it('🔴 `Priority.None` 与 `undefined` 同值 —— 收敛点在这一份里', () => {
    expect(priorityColorToken(undefined)).toBe(priorityColorToken(Priority.None));
  });

  it('映射穷尽：枚举里每一档都有登记（新增一档忘了写会红）', () => {
    // 🔴 从 `Priority` 现取档位清单，不抄字面量：抄一份 `[0,1,2,3]` 的话，
    //    将来加 `Urgent = 4` 这条判据仍然绿，而它会静默落到 `none`。
    const levels = Object.values(Priority).filter((v): v is Priority => typeof v === 'number');
    expect(levels.length).toBeGreaterThan(0);
    const names = levels.map((p) => priorityColorToken(p));
    expect(new Set(names).size, '两个真实档位撞进了同一个 token').toBe(names.length);
  });

  it('每一个 token 名都在设计系统里真的存在（light 与 dark 各核一遍）', () => {
    // 名字是字符串，改名/拼错时编译期抓不到（`PriorityColorToken` 与
    // `HeytaNativeTokens` 是两个包的类型）。这一条是那条缝唯一的守门人。
    for (const [scheme, tokens] of THEMES) {
      for (const [, token] of CASES) {
        expect(tokens[token], `${scheme} 里没有 ${token}`).toBeTypeOf('string');
      }
    }
  });
});

describe('W5 取值：优先级不同的行必须看得出不同', () => {
  it('🔴 三个有档位的优先级，色值两两互不相同 —— 亮色与暗色各量一遍', () => {
    const colored: readonly PriorityColorToken[] = [
      'color.priority-high',
      'color.priority-medium',
      'color.priority-low',
    ];
    for (const [scheme, tokens] of THEMES) {
      for (const left of colored) {
        for (const right of colored) {
          if (left === right) continue;
          expect(
            tokens[left],
            `${scheme} 下 ${left} 与 ${right} 是同一个色 —— 描边分不出优先级`,
          ).not.toBe(tokens[right]);
        }
      }
    }
  });

  it('`none` 不与任何一档撞色（否则"没优先级"的行会冒充某一档）', () => {
    for (const [scheme, tokens] of THEMES) {
      for (const token of ['color.priority-high', 'color.priority-medium', 'color.priority-low'] as const) {
        expect(tokens['color.priority-none'], `${scheme} 下 none 与 ${token} 同色`).not.toBe(
          tokens[token],
        );
      }
    }
  });

  it('暗色不是一句口号：四个取值 dark 与 light 全不相同', () => {
    // 这一条不是装饰：`dark` 在 `tokens.css` 里是**稀疏覆盖**，
    // 有人漏掉一档，那一档在暗色下就沿用亮色值（红/琥珀在深底上会刺眼），
    // 而界面层的图只能看出"看起来还行"，说不出漏了哪一档。
    for (const token of [
      'color.priority-none',
      'color.priority-low',
      'color.priority-medium',
      'color.priority-high',
    ] as const) {
      expect(
        darkTokens[token],
        `${token} 两档同色 —— dark 对它没做任何事`,
      ).not.toBe(lightTokens[token]);
    }
  });
});

describe('W5 行组件真的用上了它', () => {
  const row = stripComments(
    readFileSync(fileURLToPath(new URL('../src/task-list/TaskRow.tsx', import.meta.url)), 'utf8'),
  );

  it('🔴 描边色按行取，`styles.box` 里不许留中性色（工单点名的那条变异）', () => {
    expect(row).toMatch(/priorityColorToken\(\s*row\.source\.priority\s*\)/);
    expect(row).not.toMatch(/borderColor:\s*tokens\['color\.border-strong'\]/);
  });

  it('逐行色排在 `box` 之后、`boxDone` 之前：完成态仍压过优先级', () => {
    const boxIndex = row.indexOf('styles.box,');
    const priorityIndex = row.indexOf('{ borderColor: priorityBorderColor }');
    const doneIndex = row.indexOf('row.done ? styles.boxDone : null');
    expect(boxIndex).toBeGreaterThan(-1);
    expect(priorityIndex, '行里没有逐行的描边色声明').toBeGreaterThan(boxIndex);
    expect(doneIndex, '完成态的覆盖被摘掉了').toBeGreaterThan(priorityIndex);
    // `boxDone` 自己必须还是主色，不能跟着优先级跑。
    expect(row).toMatch(/boxDone:\s*\{[\s\S]*?borderColor:\s*tokens\['color\.primary'\]/);
  });

  it('勾选框可寻址（`task-box-*`）', () => {
    // 逐行描边色要能被**界面层**的判据读到，就得有一个稳定的名字。
    // ⚠️ 它刻意**不**叫 `task-row-*` / `task-item-*` / `task-toggle-*`：
    // 那三个前缀在 `e2e/tests/desktop-window.spec.ts` 与
    // `scripts/verify-universal-slice.browser.mjs` 里被**当行数来数**，
    // 多一个同前缀的元素会把每一行数两遍（`task-title-*` 的注释里记着同一条）。
    expect(row).toContain('task-box-');
  });
});

describe('W5 抽取的收尾：全仓只有一份定义', () => {
  it('🔴 `priorityColorToken` 的定义在 apps/ 与 packages/ 的源码里只出现一次', () => {
    const definedIn: string[] = [];
    for (const rel of ['apps', 'packages']) {
      for (const file of sourceFiles(new URL(`../../../${rel}/`, import.meta.url))) {
        if (/function\s+priorityColorToken/.test(stripComments(readFileSync(file, 'utf8')))) {
          definedIn.push(file.replace(fileURLToPath(repoRoot), ''));
        }
      }
    }
    expect(
      definedIn,
      `priorityColorToken 有 ${definedIn.length} 份定义（应该是唯一一份）`,
    ).toEqual(['packages/ui/src/task-list/priority-color.ts']);
  });
});
