/**
 * 两级「次要文字」不许合并（字号角色钉子）
 * ========================================
 *
 * 仓库里有两个"次要文字"角色，它们**看起来像同一个东西，判据却相反**：
 *
 * | 角色 | 取值 | 判断标准 |
 * |---|---|---|
 * | 任务行元信息（`row-meta`） | **12px** | 扫读时**应该被跳过** —— 所以要比正文小得多（16:12 = 1.33） |
 * | 设置页说明句（`.ht-settings__hint`） | **13px** | 是**成句散文**，要读得懂 —— 但不能和正文同级（16:14 = 1.14 读不出层级） |
 *
 * ## 为什么这值得一条测试
 *
 * 「统一字号」是一种非常自然的整理冲动 —— 下一个人看到 12 和 13 并存，
 * 很可能把它们"顺手统一"成 12 或 14。两种统一都真的更差：
 * · 统一成 12：说明句变成元信息档，长句难读，且和 `caption`/`row-meta` 撞角色；
 * · 统一成 14：回到 1.14 的比值，面板读起来像一份文档（这正是 2026-11-02 改掉的那件事）。
 *
 * 而**没有任何门禁拦得住**：`check:design` / `check:font-size-discipline`
 * 只管"有没有用裸值""有没有小到 11px"，不管"这一级该是几号"。实测过：
 * 把 hint 改回 14，五条设计门禁**全绿**。
 *
 * 所以这里钉的不是"必须是 13"（那是变更探测器），而是**它们必须不是同一档** ——
 * 这才是当初那个决定的实质。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 找仓库根 —— **三条都不能用，各踩过一次**：
 *
 * · `process.cwd()`：`pnpm --filter @heyta/web exec vitest` 的 cwd 是 `apps/web/`，
 *   于是拼出 `apps/web/apps/web/src/...` 报 ENOENT，而 vitest 把它显示成
 *   **"no tests"**（看起来像文件没被收集，不像路径错）。
 * · `import.meta.url` + `fileURLToPath`：jsdom 环境下 `import.meta.url` 是
 *   `http://localhost/...`，直接 `ERR_INVALID_URL_SCHEME`。
 * · `__dirname`：ESM 里没有。
 *
 * 所以从 cwd 往上找 `pnpm-workspace.yaml` —— cwd 在哪都能到仓库根。
 */
function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`找不到仓库根（从 ${start} 往上没有 pnpm-workspace.yaml）`);
}

const ROOT = findRepoRoot(process.cwd());

/**
 * 取某个 CSS 选择器块里 `font-size:` 那一行的值。
 *
 * 🔴 必须以**行首**锚定：`.ht-settings__hint {` 也是
 * `.ht-settings__preference-label .ht-settings__hint {` 的子串，
 * 用裸 `indexOf` 会先命中那条**后代选择器**（它没有 font-size）⇒ 读到 undefined。
 * 实测过这一次失败，报的是"说明句不是 md"，看起来像改错了文件。
 */
function fontSizeOfRule(css: string, selector: string): string | undefined {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) return undefined;
  const end = css.indexOf('}', start);
  const block = css.slice(start, end);
  const m = /font-size:\s*([^;]+);/.exec(block);
  return m?.[1]?.trim();
}

describe('次要文字的两级角色', () => {
  const css = readFileSync(join(ROOT, 'apps/web/src/styles/app/ai-panels.css'), 'utf8');
  const typography = readFileSync(
    join(ROOT, 'packages/design-system/src/typography.ts'),
    'utf8',
  );

  it('设置页说明句用 md（13px）—— 成句散文，比正文低一档但仍要读得懂', () => {
    expect(fontSizeOfRule(css, '.ht-settings__hint')).toBe('var(--ht-font-size-md)');
  });

  it('任务行元信息用 xs（12px）—— 扫读时应该被跳过', () => {
    // typography.ts 里 row-meta 的 size 字段
    const block = typography.slice(typography.indexOf("'row-meta': {"));
    const m = /size:\s*'([^']+)'/.exec(block.slice(0, 200));
    expect(m?.[1]).toBe('font-size.xs');
  });

  it('🔴 两者**不是同一档**（这才是当初那个决定的实质）', () => {
    const hint = fontSizeOfRule(css, '.ht-settings__hint');
    expect(hint).not.toBe('var(--ht-font-size-xs)');
    expect(hint).not.toBe('var(--ht-font-size-sm)');
  });

  it('说明句不许落到 11px（可见消息的最小档，`check:font-size-discipline` 同一取向）', () => {
    expect(fontSizeOfRule(css, '.ht-settings__hint')).not.toBe('var(--ht-font-size-2xs)');
  });
});
