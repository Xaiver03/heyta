/**
 * 主题切换**过程中**文字必须一直读得出（不是只保证两端）
 * =======================================================
 *
 * 起因是 R11 批二的暗色取证图：页头那颗语言 chip 在暗色截图里是**一块没有字的白底**。
 * 人眼看图以为是对比度门禁漏了的一对配色，实测下来根因完全不同 ——
 * `.ht-chip` 只给 `background` 上了 `transition`，而 `color` 是瞬切的：
 * 切换后的头几十毫秒里，**新主题的字压在旧主题的底上**。
 *
 * ⚠️ **2026-10-04 的载体变更（判据一条没动）**：顶栏那个语言控件不再是 `.ht-chip`，
 * 换成了带可见标签的分组（`LanguageSwitcher.tsx` 文件头记着为什么）。
 * 本文件量的载体随之换成 `.ht-header__lang-option`，而**定位符仍按 testID 找**
 * —— 它测的是"页头那个语言项在切主题的那一瞬读不读得出"，与它穿哪件 CSS 无关。
 * 🔴 新那件 CSS 刻意**不写任何 transition**（`main-area.css` 里写了这条理由），
 * 所以判据 1 现在是"保持"而不是"修复"。变异：往 `.ht-header__lang-option` 上加
 * `transition: background var(--ht-duration-fast)` ⇒ 判据 1 当场红。
 *
 *
 * 实测（`getComputedStyle` + WCAG 公式，2026-10-03）：
 *   稳态 16.40:1 → 0ms **1.01:1** → 30ms 2.29:1 → 60ms 6.79:1 → 100ms 13.35:1
 *
 * ## 🔴 为什么这条判据长这样（两条，缺一不可）
 *
 * 1. **样式契约**（确定性）：语言项上不得存在任何会动到"字色/底色这一对"的过渡。
 *    这一条不依赖时序，所以它是 CI 里真正承重的那条。
 *    ⚠️ 不能只写"不含 background"：Chromium 下没声明过渡时计算值是 `all`，
 *       而 `all` **确实包含** background —— 所以 `all` 必须被当成"时长为 0"来放行，
 *       一旦有时长又不是 `none`，就得逐条看属性。
 * 2. **行为**（真实测量）：点完切换按钮**立刻**量对比度，必须 ≥ AA 正文的 4.5:1，
 *    亮→暗和暗→亮两个方向都量。这一条才说的是产品那句话；
 *    它单独用不稳（采样落点后 60ms 就会假绿），所以配着 1 用。
 *
 * ⚠️ **别用"两个属性一起过渡"来修**：端点各自合规，中点是两边各取一半，
 *    算出来仍是 ~1.5:1。成对变化的属性只要有一个被过渡，中间态必然掉对比。
 */

import { expect, test, type Page } from '@playwright/test';

import { openApp } from './helpers';

/** 与 `calendar-cells.spec.ts` 同一个理由：不钉 `?lang=` 会得到英文界面。 */
const APP_ZH = '/?lang=zh-CN';
/**
 * 载体：页头语言分组里**当前语言那一项**（中文界面 ⇒ zh 项是选中态）。
 * 按 testID 找而不是按类名 —— 类名 2026-10-04 换过一次，而这条判据不该跟着漂。
 */
const LANG_OPTION = '[data-testid="language-option-zh-CN"]';
const AA_BODY = 4.5;

/** 会动到"字色 / 底色 / 边框色"这一对对比度参与者的属性。 */
const CONTRAST_PROPS = ['background', 'background-color', 'color', 'border-color'];

/**
 * 量一次某元素的**真实**对比度：半透明背景要沿祖先链合成到不透明底上，
 * 否则量到的是 `rgba(...)` 的原始分量，而不是眼睛看到的那个颜色。
 */
function contrastOf(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const srgb = (n: number) => {
      const v = n / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const parse = (c: string): [number, number, number, number] => {
      const m = c.match(/rgba?\(([^)]+)\)/u);
      if (!m) return [0, 0, 0, 1];
      const p = m[1].split(/[,\s/]+/u).filter((x) => x !== '');
      return [Number(p[0]), Number(p[1]), Number(p[2]), p.length > 3 ? Number(p[3]) : 1];
    };
    const lum = (r: number, g: number, b: number) =>
      0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);

    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const [fr, fg, fb] = parse(cs.color);

    const stack: [number, number, number, number][] = [];
    for (let n: HTMLElement | null = el; n !== null; n = n.parentElement) {
      const [r, g, b, a] = parse(getComputedStyle(n).backgroundColor);
      if (a > 0) {
        stack.push([r, g, b, a]);
        if (a >= 1) break;
      }
    }
    let bg: [number, number, number] = [255, 255, 255];
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const [r, g, b, a] = stack[i];
      bg = [bg[0] + (r - bg[0]) * a, bg[1] + (g - bg[1]) * a, bg[2] + (b - bg[2]) * a];
    }
    const l1 = lum(fr, fg, fb);
    const l2 = lum(bg[0], bg[1], bg[2]);
    return {
      ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05),
      color: cs.color,
      bg: `rgb(${bg.map((v) => Math.round(v)).join(', ')})`,
      transitionProperty: cs.transitionProperty,
      transitionDuration: cs.transitionDuration,
    };
  }, selector);
}

test('🔴 主题切换的那一瞬，页头语言项的文字不许压在旧主题的底上', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, APP_ZH);

  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  const steady = await contrastOf(page, LANG_OPTION);
  expect(steady, '页头找不到语言控件那一项 —— 后面量的都是空气').not.toBeNull();
  // 前提：稳态本身得合规。稳态就不合规的话，下面那条"切换瞬间 ≥ 4.5"没有意义。
  expect(
    steady!.ratio,
    `前提不成立：亮色稳态对比度只有 ${steady!.ratio.toFixed(2)}:1`,
  ).toBeGreaterThanOrEqual(AA_BODY);

  // ── 判据 1：样式契约（确定性，CI 里承重的那条）──────────────────────
  const running =
    steady!.transitionDuration !== '0s' && steady!.transitionProperty !== 'none';
  const animated = running
    ? steady!.transitionProperty === 'all'
      ? CONTRAST_PROPS
      : CONTRAST_PROPS.filter((p) => steady!.transitionProperty.includes(p))
    : [];
  expect(
    animated,
    `语言项上存在会动到字色/底色这一对的过渡（${steady!.transitionProperty} / ` +
      `${steady!.transitionDuration}）—— 切主题时另一半是瞬切的，中间态必然掉对比。` +
      `实测这个中间态是 1.01:1。`,
  ).toEqual([]);

  // ── 判据 2：行为（两个方向各量一次"点完立刻"）───────────────────────
  const toDark = page.getByRole('button', { name: '切换到暗色主题' });
  await toDark.click();
  const midDark = await contrastOf(page, LANG_OPTION);
  expect(
    midDark!.ratio,
    `亮→暗刚切完的这一刻只有 ${midDark!.ratio.toFixed(2)}:1（字 ${midDark!.color} / 底 ${midDark!.bg}）`,
  ).toBeGreaterThanOrEqual(AA_BODY);

  const toLight = page.getByRole('button', { name: '切换到亮色主题' });
  await toLight.click();
  const midLight = await contrastOf(page, LANG_OPTION);
  expect(
    midLight!.ratio,
    `暗→亮刚切完的这一刻只有 ${midLight!.ratio.toFixed(2)}:1（字 ${midLight!.color} / 底 ${midLight!.bg}）`,
  ).toBeGreaterThanOrEqual(AA_BODY);

  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});
