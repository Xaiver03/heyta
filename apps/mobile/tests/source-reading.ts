/**
 * 源码层判据共用的**读文件**工具
 * ==============================
 *
 * `apps/mobile` 刻意没有 RN 组件测试栈（理由见 [`habit-create-entry.spec.ts`](./habit-create-entry.spec.ts)
 * 文件头），所以"接线在不在、有没有长出第二份事实源"这类判据只能**读源码文本**。
 *
 * 🔴 这份工具原来在 `habit-create-entry.spec.ts` 与 `habit-icon-picker.spec.ts` 里
 *    **各有一份逐字相同的实现**（同一判断写两遍必漂一处 —— 本仓库为这件事写过专门的教训）。
 *    工单 H5 是第三个消费者，就在此处收口成一份。
 *
 * ⚠️ `stripComments` 是判据的一部分，不是美化：注释里出现 `setHabitIcon(` 或中文文案
 *    会让"不许出现 X"那类反向判据**假绿**。任何一条 `not.toMatch` 都必须先剥注释。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根（本文件在 `apps/mobile/tests/` 下）。 */
export const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** 读一个**仓库相对路径**的源文件。 */
export const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

/** 剥掉块注释与整行 `//` 注释。 */
export const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

/** `apps/mobile/src` 下所有 `.ts` / `.tsx`（仓库相对路径，排序稳定）。 */
export function mobileSources(): string[] {
  const root = join(REPO, 'apps/mobile/src');
  const acc: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      // `__tests__` 里的东西不是"源码"：判据扫的是生产代码，扫到自己人会把
      // "不许出现 X"那类反向判据变成永远绿（判据里出现的字符串当然在判据文件里）。
      else if (/\.tsx?$/.test(name) && !/__tests__/.test(full)) acc.push(relative(REPO, full));
    }
  };
  walk(root);
  return acc.sort();
}
