/**
 * 「说明文字只许经 `?` 出」的**共享组件**判据（2026-10-24）
 * ==========================================================
 *
 * `pnpm check:settings-prose` 扫的是**调用点**（`ht-settings__*hint*` 容器、
 * 行模型里的 `hint:` 字段）—— 它有意不扫组件内部，理由写在那个脚本的头部。
 *
 * 那条边界留下一个缝：`SettingsRow` / `SettingsActionRow` 的渲染体里，
 * 有人把 `{row.hint}` 直接摊成 `<Text>` 时，**调用点一个字节都没变** ⇒
 * 门禁照样绿，而屏幕上一整句说明又回来了。
 *
 * 2026-10-24 实测过这条缝（当时是为了证明设备腿会红）：
 *   · 把 `Settings.tsx` 里两处 `row.hint` 的渲染改成 `<Text>{row.hint}</Text>`；
 *   · `pnpm check:settings-prose` → **✅ 绿**（缝是真的）；
 *   · `pnpm verify:mobile-ios-subscription` → **❌ 红**（设备腿抓到了）。
 *
 * 设备腿能抓，但它是"要一枚模拟器 + 一次构建"的判据 ⇒ 不能当**第一道**防线。
 * 这里补的是零成本的那一道：源码形状。
 *
 * ## 判据
 *
 * `packages/ui/src/settings/Settings.tsx` 里每一处 `row.hint` 都必须是下面两种之一：
 *
 *   ① `<SettingsInfoTip text={row.hint} …>` —— 交给气泡组件；
 *   ② `{row.hint === undefined ? null : (` —— 存在性守卫（它只决定"要不要画那枚问号"）。
 *
 * 其余形态（尤其是 `<Text>{row.hint}</Text>`）一律红，并打印出那一行。
 *
 * ⚠️ 这是**形状**判据，不是行为判据：它证明"没有人绕过气泡组件"，
 * 不证明"气泡真的能点开" —— 后者只有设备腿能证（`pnpm verify:mobile-ios-subscription`）。
 * 两条分工是刻意的：同一个判断不在两个地方长牙，但**入口**必须有一道零成本的。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, '../src/settings/Settings.tsx');

/** 去掉注释再判 —— 注释里写"这里不许直出"是在**描述**纪律，不该被判红。 */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/[^\n]*/gu, '$1');

/** 每一处 `row.hint` 出现的位置，连带它所在的那一行。 */
function hintSites(source: string): { index: number; line: string; lineNo: number }[] {
  const lines = source.split('\n');
  const sites: { index: number; line: string; lineNo: number }[] = [];
  let offset = 0;
  lines.forEach((line, i) => {
    let at = line.indexOf('row.hint');
    while (at !== -1) {
      sites.push({ index: offset + at, line: line.trim(), lineNo: i + 1 });
      at = line.indexOf('row.hint', at + 1);
    }
    offset += line.length + 1;
  });
  return sites;
}

const ALLOWED = [/<SettingsInfoTip\s+text=\{row\.hint\}/u, /\{row\.hint === undefined \? null : \(/u];

describe('设置行模型里的 hint 只许经「?」出', () => {
  const source = stripComments(readFileSync(FILE, 'utf8'));
  const sites = hintSites(source);

  it('这个文件里确实有 hint 的渲染点（判据自己的阳性对照）', () => {
    // 一处都不剩 = 判据变成了恒真式（有人把 hint 从行模型里删了却没删这条测试）
    expect(sites.length).toBeGreaterThan(0);
  });

  it('每一处 row.hint 都交给 SettingsInfoTip 或存在性守卫', () => {
    const offenders = sites.filter((site) => !ALLOWED.some((pattern) => pattern.test(site.line)));
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `这些地方把说明文字直接摊开了（禁令要求只走「?」）：\n${offenders
            .map((site) => `  Settings.tsx:${site.lineNo}  ${site.line}`)
            .join('\n')}`,
    ).toEqual([]);
  });
});
