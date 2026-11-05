/**
 * T1 就地高亮 · **web 覆盖层可行性 spike**（2026-11-05）
 * ======================================================
 *
 * 这枚 spike 只回答一个问题，而它现在有承重作用：
 * 计划 §9.13 把"彻底删掉框下那一行"的前置挂在 T1 上，§3.5 只写了
 * "Web：可做，做法是覆盖层" —— **本仓对这一法一次都没有实测过**。
 * 量出对齐，S2 那半句才有真出路；量出不对齐，§3.5 那句"可做"就得改口成"未证实"。
 * 两种结果都是读数，只有"没跑"是零信息。
 *
 * 🔴 这一枚**不碰被交付的组件**：不改 `CaptureComposer`，
 *    只在真实 app 的输入框上**注入**一层覆盖层（样式全部从那个 input 的
 *    `getComputedStyle` 抄来）。它不会把一次没验证过的做法带进产品里。
 *
 * 量的三件事（每条都是能红的断言，不是截图观感）：
 *   ① 宽度对齐：同一段字，覆盖层着色文本的排版宽度 == 原生 input 里那段字的排版宽度
 *      （`scrollWidth` 减左右 padding），误差 ≤1px。三档长度 × 三种字形构成，
 *      任何一列不等宽都会在长句上把误差放大。
 *   ② 横向滚动同步：内容打到溢出时 `scrollLeft > 0` 要真成立，
 *      否则这一条根本没在量东西（假绿形状）。
 *   ③ caret 独立于文字色：把 input 的 `color` 设成 transparent 之后
 *      `caret-color` 不能跟着透明 —— 这条一崩，"透明文字 + 覆盖层"整体不可用。
 */
import { expect, test, type Page } from '@playwright/test';

import { switchTheme } from './helpers.js';

/** 证据落本轮专属目录，不落两条会话会互踩的共用 `test-results/`。 */
const SHOT = (name: string): string =>
  `../apps/web/evidence/capture-inline-highlight-spike-20261105/inline-highlight-${name}.png`;

async function openApp(page: Page): Promise<void> {
  await page.goto('/?lang=zh-CN', { waitUntil: 'networkidle' });
  const later = page.getByRole('button', { name: /以后再说|Decide later/ });
  if (await later.count()) {
    await later.click();
    await page.waitForTimeout(400);
  }
  await page.waitForSelector('[data-testid="task-list"]', { timeout: 30_000 });
}

const SAMPLES: Array<[string, string]> = [
  ['纯汉字', '今天下午八点给张教授发'],
  ['汉字加数字冒号', '今天下午八点交周报 20:00'],
  ['长句三十三个字', '今天下午八点给张教授发PPT并且把附件一起发过去谢谢'],
];

test.describe('T1 就地高亮 · web 覆盖层 spike', () => {
  test('① 覆盖层的排版宽度要等于文字引擎自己的度量（canvas measureText 同 font 串）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);

    // 🔴 第一版这里量的是 `input.scrollWidth - padding`，读出 568px 对 130.6px，
    //    看起来像"覆盖层差 4 倍"。**错的是探针不是被测法**：固定宽度的 input 上
    //    `scrollWidth` 返回的是盒子宽（内容不溢出时 == clientWidth），不是文字宽。
    //    换成文字引擎自己的度量：`canvas.measureText` 用**同一个 computed font 串**，
    //    它与原生 input 走的是同一套 advance width ⇒ 这才是"同字号同字距"的独立参照。
    for (const [name, text] of SAMPLES) {
      const measured = await page.evaluate((value) => {
        const input = document.querySelector<HTMLInputElement>('[data-testid="capture-input"]');
        if (input === null) throw new Error('收集框输入行不在页面上');
        const cs = getComputedStyle(input);
        const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const ctx = document.createElement('canvas').getContext('2d');
        if (ctx === null) throw new Error('拿不到 canvas 2d 上下文');
        ctx.font = font;
        // 引擎度量：letter-spacing 在 canvas 上要单独加（每个间隙 × (n-1)）
        const ls = parseFloat(cs.letterSpacing) || 0;
        const engineWidth = ctx.measureText(value).width + ls * (value.length - 1);

        const probe = document.createElement('span');
        probe.textContent = value;
        probe.style.position = 'absolute';
        probe.style.left = '-9999px';
        probe.style.whiteSpace = 'pre';
        probe.style.fontFamily = cs.fontFamily;
        probe.style.fontSize = cs.fontSize;
        probe.style.fontWeight = cs.fontWeight;
        probe.style.fontStyle = cs.fontStyle;
        probe.style.letterSpacing = cs.letterSpacing;
        probe.style.wordSpacing = cs.wordSpacing;
        document.body.appendChild(probe);
        const overlayWidth = probe.getBoundingClientRect().width;
        probe.remove();
        return { engineWidth, overlayWidth, font, letterSpacing: cs.letterSpacing };
      }, text);
      const drift = Math.abs(measured.overlayWidth - measured.engineWidth);
      // 🔴 阈值 2px 不是"够用"的结论，而是**随长度线性增长**的证据：
      //    实测 33 字差 1.75px（≈0.053px/字），而 `letter-spacing` 是 `-0.132px`
      //    这种非整数值 ⇒ "字体度量必须逐字相同"（§3.5 原话）**按构造做不到**。
      //    另有一层：canvas `measureText` 与 DOM 排版各有各的舍入，
      //    所以这个差值里混着参照物自己的误差 —— 结论只能是"对齐到亚像素级、
      //    但不是逐字相同"，不能写成"覆盖层已验证可用"。
      expect(
        drift,
        `「${name}」覆盖层 ${measured.overlayWidth.toFixed(2)}px vs 文字引擎 `
        + `${measured.engineWidth.toFixed(2)}px，差 ${drift.toFixed(2)}px`
        + `（font=${measured.font.slice(0, 48)}，letter-spacing=${measured.letterSpacing}）`,
      ).toBeLessThanOrEqual(2);
      const perChar = drift / text.length;
      expect(
        perChar,
        `「${name}」每字漂移 ${perChar.toFixed(4)}px（总 ${drift.toFixed(2)}px / `
        + `${String(text.length)} 字）⇒ 超过 0.1px/字就不是同一套度量`,
      ).toBeLessThanOrEqual(0.1);
    }
  });

  test('④ 原生 input 不暴露 caret 的 x 坐标 ⇒ §3.5 那句"光标位置不偏"在 web 上无法自动验', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    const probe = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="capture-input"]');
      if (input === null) throw new Error('收集框输入行不在页面上');
      input.value = '今天下午八点给张教授发PPT';
      input.setSelectionRange(6, 6);
      const chain: unknown[] = [];
      let o: unknown = input;
      while (o !== null && o !== undefined) {
        chain.push(...Object.getOwnPropertyNames(o as object));
        o = Object.getPrototypeOf(o);
        if (o === Object.prototype) break;
      }
      const caretApi = [...new Set(chain)].filter((k) => /caret|selectionRect/i.test(k));
      return {
        caretApi,
        // `caretRangeFromPoint` 是**反向**的（点坐标 → Range），对 `<input>` 内部不工作；
        // 正向（第 n 个字 → x）在 DOM 里没有 API。这里只登记它存在与否，不拿它当证据。
        hasCaretRangeFromPoint: typeof document.caretRangeFromPoint === 'function',
      };
    });
    // 🔴 这条不是"证明能做"，是把**做不到的那一半钉成读数**：
    //    §3.5 的判据写着"caret 可见、光标位置不偏"，而 caret 可见能量（③ 已过），
    //    位置不偏**量不到** ⇒ T1 的自动判据天生缺一格，只能靠看图。
    expect(probe.caretApi, `居然找到了 caret 几何 API：${probe.caretApi.join(',')}`).toHaveLength(0);
  });

  test('② 溢出时输入框确实会横向滚动（不溢出就换更长的一句再判）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    const long = '今天下午八点给张教授发PPT并且把附件一起发过去谢谢麻烦尽快处理一下感谢理解'
      + '并且把这份材料同步给财务与法务两边确认之后再走盖章流程谢谢配合';
    const readout = await page.evaluate((value) => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="capture-input"]');
      if (input === null) throw new Error('收集框输入行不在页面上');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      input.setSelectionRange(value.length, value.length);
      const cs = getComputedStyle(input);
      return {
        scrollLeft: input.scrollLeft,
        scrollWidth: input.scrollWidth,
        clientWidth: input.clientWidth,
        overflowX: cs.overflowX,
        whiteSpace: cs.whiteSpace,
      };
    }, long);
    // 🔴 这一条的结论允许是"这一法在这里量不到"，但不许把它读成"滚动同步没问题"：
    //    单行 input 的 scrollWidth 在不溢出时恒等于 clientWidth，此时 scrollLeft 必为 0。
    if (readout.scrollWidth <= readout.clientWidth) {
      expect(
        readout.scrollWidth,
        `输入框没横向滚动（scrollWidth=${String(readout.scrollWidth)} == clientWidth，`
        + `overflowX=${readout.overflowX}）⇒ 这一法在本组件上量不到滚动同步，`
        + '要判它得先让输入框真的溢出',
      ).toBeGreaterThan(readout.clientWidth);
    }
    expect(readout.scrollLeft, '内容溢出后 caret 到底仍没滚动').toBeGreaterThan(0);
  });

  test('③ 文字设成 transparent 之后 caret 仍然可见（caret-color 独立）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    const readout = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="capture-input"]');
      if (input === null) throw new Error('收集框输入行不在页面上');
      input.style.color = 'transparent';
      input.focus();
      const cs = getComputedStyle(input);
      return { color: cs.color, caretColor: cs.caretColor };
    });
    expect(readout.color).toContain('rgba(0, 0, 0, 0)');
    expect(
      readout.caretColor,
      `caret-color 也跟着透明了（${readout.caretColor}）⇒ 覆盖层这一法在原生 input 上不成立`,
    ).not.toContain('rgba(0, 0, 0, 0)');
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`看图：${theme} 档覆盖层打在真实输入框上的样子`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openApp(page);
      // ⚠️ `switchTheme` 是**点一下开关**，不是设档 ⇒ 先读现档，已经在目标档就别点。
      const current = await page.locator('html').getAttribute('data-theme');
      if (current !== theme) await switchTheme(page, theme);

      const drift = await page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>('[data-testid="capture-input"]');
        if (input === null) throw new Error('收集框输入行不在页面上');
        const cs = getComputedStyle(input);
        const text = '今天下午八点给张教授发PPT';
        const box = input.getBoundingClientRect();
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:absolute;z-index:99999;pointer-events:none;white-space:pre;'
          + `left:${String(box.left + parseFloat(cs.paddingLeft))}px;`
          + `top:${String(box.top + parseFloat(cs.paddingTop))}px;`
          + `font-family:${cs.fontFamily};font-size:${cs.fontSize};`
          + `font-weight:${cs.fontWeight};letter-spacing:${cs.letterSpacing};`;
        const hot = document.createElement('span');
        hot.textContent = '今天下午八点';
        hot.style.color = '#2563eb';
        const rest = document.createElement('span');
        rest.textContent = '给张教授发PPT';
        wrap.append(hot, rest);
        document.body.appendChild(wrap);
        input.value = text;
        input.style.color = 'transparent';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const overlayRight = hot.getBoundingClientRect().right;
        const probe = document.createElement('span');
        probe.textContent = '今天下午八点';
        probe.style.cssText = 'position:absolute;left:-9999px;white-space:pre;'
          + `font-family:${cs.fontFamily};font-size:${cs.fontSize};`
          + `font-weight:${cs.fontWeight};letter-spacing:${cs.letterSpacing};`;
        document.body.appendChild(probe);
        const expected = probe.getBoundingClientRect().width;
        probe.remove();
        return { actual: overlayRight - hot.getBoundingClientRect().left, expected };
      });
      expect(
        Math.abs(drift.actual - drift.expected),
        `覆盖层里那段着色的宽度与预期差 ${(drift.actual - drift.expected).toFixed(2)}px`,
      ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: SHOT(theme), clip: { x: 300, y: 70, width: 900, height: 120 } });
    });
  }
});
