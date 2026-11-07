/**
 * mobile kit 的 `EmptyState` 必须**真的**消费共享模型（R11 的 (B) 方案）
 * ====================================================================
 *
 * ## 为什么是"源码形状"而不是"渲染树"
 *
 * `apps/mobile` **没有任何渲染器** —— `react-test-renderer` 与
 * `@testing-library/react-native` 都不在依赖里。要写"黄金树"spec 就得先加一个
 * 依赖，而加依赖要过 `hard-constraints.md` §3.1/§3.2 两道门。
 *
 * ⇒ 所以这一端**不假装有渲染判据**：能钉的是"它到底有没有调用那份判断"。
 * 这与 `packages/ui/tests/settings-hint-through-tip.spec.ts` 同一条纪律
 * （那是本仓已有的"零成本源码形状"判据），也补上了 `check:empty-state` 的
 * 断言 D —— 两处同源，仓库侧再钉一次。
 *
 * ## 它挡的是什么
 *
 * (B) 方案把"算槽位"从 `kit.tsx` 挪到了 `@heyta/ui` 的 `toEmptyStateViewModel`。
 * 收益是**判断只有一份**；风险是**下一班人把那次调用删掉**，把归一化（空串变成
 * 省略、`title` 必填）重新手写回本地 —— 那时界面未必立刻坏，而两份判断又开始
 * 分叉。光靠注释写"请消费模型"是君子协定，删了不会红。
 *
 * 🔴 所以下面**同时**钉三件事：① 从 `@heyta/ui` 导入；② 真的**调用**（不是注释里
 * 提了一句）；③ `size` 是 `'page'` —— 它是唯一允许图形的档，改成 `section`/`line`
 * 会让 `view.illustration` 变 `undefined`，9 个调用点的图形一起消失。
 *
 * ## 判据自己会不会红
 *
 * 最后一组是**配对臂**（本仓反复用的形状）：同一条谓词、同一份源码，
 * 只翻"调用"这一位 ⇒ 必须从 `true` 变 `false`。
 * 没有这一组，前三条只是"读了一遍文件"。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, '../src/ui/kit.tsx');

/**
 * 去掉注释再判 —— 与 `settings-hint-through-tip.spec.ts` 同一条纪律。
 *
 * 不掩码的话，`kit.tsx` 里那段"`toEmptyStateViewModel` 是唯一判断"的**说明**
 * 本身就会被当成"已经消费了"。那是假绿，而且是最坏的一种：注释越详细越绿。
 */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/[^\n]*/gu, '$1');

/** 一条谓词，三处复用（真源 + 两支配对臂）。 */
const consumption = (source: string): {
  readonly imports: boolean;
  readonly calls: boolean;
  readonly pageTier: boolean;
} => {
  const code = stripComments(source);
  return {
    imports: /import\s*\{[^}]*\btoEmptyStateViewModel\b[^}]*\}\s*from\s*'@heyta\/ui'/u.test(code),
    // 必须是**调用**：`toEmptyStateViewModel(` 后面跟实参，而不是只出现一个名字。
    calls: /\btoEmptyStateViewModel\s*\(/u.test(code),
    // `size:` 必须是 `'page'` —— 这一格决定"要不要画图形"，见文件头 ③。
    pageTier: /size:\s*'page'/u.test(code),
  };
};

const real = readFileSync(FILE, 'utf8');

describe('mobile kit 的 EmptyState 消费共享模型', () => {
  it('锚点：这份文件里确实有 kit 的 `EmptyState` 定义（否则下面全是空断言）', () => {
    expect(stripComments(real)).toMatch(/export\s+function\s+EmptyState\s*\(/u);
  });

  it('① 从 `@heyta/ui` 导入 `toEmptyStateViewModel`', () => {
    expect(consumption(real).imports, '没 import 就谈不上消费').toBe(true);
  });

  it('② 真的**调用**它（注释里提一句不算）', () => {
    expect(consumption(real).calls, '调用被删了 ⇒ 归一化又变成手写的第二份').toBe(true);
  });

  it("③ `size` 是 `'page'`（唯一允许图形的档）", () => {
    expect(consumption(real).pageTier).toBe(true);
  });

  it('配对臂 A：把调用注释掉 ⇒ 谓词必须变 false（证明 ② 不是恒真式）', () => {
    const mutated = real.replace(/(\n\s*)(const view = toEmptyStateViewModel\()/u, '$1// $2');
    expect(mutated, '注入没生效 —— 夹具本身失效了').not.toBe(real);
    expect(consumption(real).calls).toBe(true);
    expect(consumption(mutated).calls, '把调用注释掉之后仍然算"消费"' ).toBe(false);
  });

  it('配对臂 B：只在注释里写 `toEmptyStateViewModel(` ⇒ 不许算消费（掩码生效）', () => {
    const onlyComment = `${stripComments(real).replace(/\btoEmptyStateViewModel\s*\(/u, 'noop(')}\n// 我们把 toEmptyStateViewModel( 删掉了\n`;
    expect(consumption(onlyComment).calls, '注释里的字样被当成消费 ⇒ 假绿').toBe(false);
  });

  it('配对臂 C：把 size 改成 section ⇒ 谓词必须变 false', () => {
    const mutated = real.replace(/(\n\s*)size: 'page',/u, "$1size: 'section',");
    expect(mutated).not.toBe(real);
    expect(consumption(mutated).pageTier).toBe(false);
  });
});
