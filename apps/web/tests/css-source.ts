/**
 * 读 CSS 并**递归展开本地 @import**。
 * ==================================
 *
 * 2026-11-23：大 CSS 文件拆成"聚合器（只剩 @import）+ 按节模块"。
 * 任何直接 `readFileSync('.../mockup.css')` 的判据都会读到**空聚合器**，
 * 于是一把尺悄悄变成"读不到 ⇒ 断言失败/或更糟：断言恒真"。
 *
 * 这里按 @import 顺序把模块内容原地展开，等于还原拆分前的单个文件 ——
 * 判据一行不用改就知道自己在看全部规则，而且以后再怎么拆都不会坏。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const IMPORT_RE = /^\s*@import\s+['"](\.[^'"]+)['"]\s*;?\s*$/;

export function readCss(entryPath: string): string {
  const abs = resolve(entryPath);
  const seen = new Set<string>();
  const out: string[] = [];
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const dir = dirname(file);
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = IMPORT_RE.exec(line);
      const target = m?.[1];
      if (target !== undefined) walk(resolve(dir, target));
      else out.push(line);
    }
  };
  walk(abs);
  return out.join('\n');
}
