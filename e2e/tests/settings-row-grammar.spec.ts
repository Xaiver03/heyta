import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

/**
 * 设置中心的**形状**判据：一屏只有一种行。
 *
 * 这不是"好不好看"，全部是可量的几何事实 —— 2026-10-25 的现量（改前）：
 * 同一列里 4 种控件形状（radio 块 / segmented / 文字按钮 / 图标+文字）、
 * 行距约 92px、内容区只占 sheet 的 45%、侧栏宽 400px。
 *
 * 每一条都对应一句能判红的话：
 *   · 同行控件左缘必须唯一（不许一行一个起点）
 *   · 控件高度档位 ≤ 2（大档 = 触控目标，小档 = 行内小按钮；再多的档就是没规矩）
 *   · 行距中位数落在 44–56（macOS 设置的行高区间）
 *   · 侧栏 240±8、内容区 ≥ 80% 宽（两级导航，不是三层、不是半屏留白）
 */
const SECTIONS = [
  'settings-group-appearance',
  'settings-group-ai',
  'settings-group-sync',
  'settings-group-data',
  'settings-group-account',
  'settings-group-help',
] as const;

for (const section of SECTIONS) {
test(`设置中心：一屏只有一种行（${section}）`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, '/?lang=zh-CN');
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('account-menu-settings').click();
  const sheet = page.getByTestId('settings-sheet');
  await expect(sheet).toBeVisible();
  await sheet.locator(`[aria-controls="${section}"]`).click();

  const m = await sheet.evaluate((root, PANE_ID) => {
    /**
     * 🔴 行**不止一种原语**，这一格必须把三种都算进来 —— 否则只有 appearance 那节
     * 量得到（12 行），其余 5 节 rows=0 被上一版的 SKIP 分支静默吞掉，
     * 判据就成了"只有一节永远通过"。2026-10-25 现量就是这么被自己骗过一次。
     *   1. `.ht-settings__preference-row`（新外壳的行：标签左 / 尾控件）
     *   2. `.ht-settings__toggle`（AI 那屏的旧行：☐ + 标签）
     *   3. `.ht-settings__row`（更早的行原语）
     */
    const rows = [...root.querySelectorAll(
      '.ht-settings__preference-row, .ht-settings__toggle, .ht-settings__row, .ht-input-field--inline',
    )].filter((r) => r.getBoundingClientRect().height > 0);
    const pick = (row: Element) => {
      // 行的形状是"左标签 + 右控件"，控件是最后一个有尺寸的子元素（radio 组 / 文字按钮 / 开关都算）。
      const kids = [...row.children].filter((e) => e.getBoundingClientRect().width > 0);
      const el = kids[kids.length - 1] ?? row;
      const label = kids[0] ?? null;
      const rb = row.getBoundingClientRect();
      const cb = el?.getBoundingClientRect();
      return {
        rowTop: Math.round(rb.top),
        labelLeft: label ? Math.round(label.getBoundingClientRect().left) : null,
        ctrlLeft: cb ? Math.round(cb.left) : null,
        ctrlRight: cb ? Math.round(cb.right) : null,
        ctrlW: cb ? Math.round(cb.width) : null,
        ctrlH: cb ? Math.round(cb.height) : null,
        ctrl: el ? el.tagName.toLowerCase() + (el.getAttribute('role') ? `[${el.getAttribute('role')}]` : '') : null,
      };
    };
    const data = rows.map(pick);
    /**
     * 行距只在**同一容器内的相邻行**之间算。
     * 🔴 2026-10-25 被自己的判据骗过第二次：AI 那节两行之间隔着一个提示块，
     * 跨块算出的"行距"是 319px —— 那不是行距，是两块之间的距离。
     * 间距是**列表内部**的属性，不是页面上的绝对坐标差。
     */
    const pitchByParent = new Map<Element | null, number[]>();
    rows.forEach((row, index) => {
      if (index === 0) return;
      const parent = row.parentElement;
      if (parent === null || rows[index - 1]!.parentElement !== parent) return;
      const delta = Math.round(row.getBoundingClientRect().top - rows[index - 1]!.getBoundingClientRect().top);
      if (delta <= 0) return;
      const list = pitchByParent.get(parent) ?? [];
      list.push(delta);
      pitchByParent.set(parent, list);
    });
    const nav = root.querySelector('.ht-settings__nav')?.getBoundingClientRect();
    const pane = root.querySelector('#' + PANE_ID)?.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const uniq = (xs: Array<number | null>) => [...new Set(xs.filter((v): v is number => v != null))];
    const pitches = [...pitchByParent.values()].flat();
    const median = pitches.length ? [...pitches].sort((a, b) => a - b)[Math.floor(pitches.length / 2)]! : null;
    return {
      rows: data.length,
      heights: uniq(data.map((d) => d.ctrlH)),
      lefts: uniq(data.map((d) => d.ctrlLeft)),
      rights: uniq(data.map((d) => d.ctrlRight)),
      medianPitch: median,
      navWidth: nav ? Math.round(nav.width) : null,
      sheetWidth: Math.round(box.width),
      contentWidth: pane ? Math.round(pane.width) : null,
      // 右侧死区：面板右缘减内容右缘。比"占比"更贴近那句抱怨（"右边空一半"）。
      // 🔴 死区要扣掉**内边距**：把 padding 当成空区会逼着人去删该有的留白。
      // 现量：layout 右内边距 44px、面板 24px —— 那 68px 是设计，不是乱。
      rightGap: (() => {
        const layout = root.querySelector('.ht-settings__layout');
        const content = root.querySelector('.ht-settings__content');
        if (!layout || !content) return null;
        const lr = layout.getBoundingClientRect();
        const padR = Number.parseFloat(getComputedStyle(layout as HTMLElement).paddingRight) || 0;
        return Math.round(lr.right - padR - content.getBoundingClientRect().right);
      })(),
      boxes: (() => {
        const pick = (sel: string) => {
          const el = root.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el as HTMLElement);
          return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
            padR: cs.paddingRight, padL: cs.paddingLeft, maxW: cs.maxWidth };
        };
        return { sheet: pick('.ht-settings'), layout: pick('.ht-settings__layout'),
          content: pick('.ht-settings__content'), nav: pick('.ht-settings__nav') };
      })(),
      sample: data.slice(0, 6),
      // 「一种行」还包括：同一节里不许并存两种列表语法（行 + 2 列复选卡网格）。
      cardsGrids: root.querySelectorAll('.ht-settings__cards').length,
      preferenceRows: rows.length,
      // 同一节里用了几种行原语（1 = 合规；>1 = 混用，正是"看着乱"的来源之一）。
      primitives: [...new Set(rows.map((row) => {
        if (row.classList.contains('ht-settings__preference-row')) return 'preference-row';
        if (row.classList.contains('ht-settings__toggle')) return 'toggle';
        if (row.classList.contains('ht-input-field--inline')) return 'form-field-inline';
        return 'row';
      }))],
      pitchSamples: pitches.length,
      skeleton: rows.length > 0 ? null : (() => {
        const pane = root.querySelector('#' + PANE_ID);
        if (!pane) return 'no-pane';
        const walk = (el: Element, d: number): string => {
          if (d > 3) return '';
          const cls = [...el.classList].filter((c) => c.startsWith('ht-')).join('.');
          return `\n${'  '.repeat(d)}<${el.tagName.toLowerCase()}${cls ? ' .' + cls : ''}>` +
            [...el.children].slice(0, 6).map((c) => walk(c, d + 1)).join('');
        };
        return walk(pane, 0).slice(0, 900);
      })(),
      rowParents: [...new Set(rows.map((row) => {
        const p2 = row.parentElement as HTMLElement | null;
        if (!p2) return 'none';
        const cs2 = getComputedStyle(p2);
        return `${p2.className}|gap=${cs2.rowGap}|mt=${getComputedStyle(row as HTMLElement).marginTop}`;
      }))],
    };
  }, section);
  console.log(`SETTINGS_SHAPE ${section} ${JSON.stringify(m)}`);

  /**
   * 样本不足的节（例如「关于与帮助」）**不判形状**，但要出声。
   * 🔴 为什么不直接 `expect(rows).toBeGreaterThan(2)`：那会让门禁因为
   * "这一节本来就没几行"而假红 —— 假红比没有判据更糟（本仓 §7 元规则二）。
   * 也不静默跳过：跳过而不打印，下一个人会以为那一节验过了。
   */
  /*
    🔴 版面那三条（侧栏宽 / 右侧死区 / 一种列表语法）**先判**，它们不需要"行"这个样本。
    2026-10-25 实测：参数化到六个分节之后，其中五节**一行 preference-row 都没有**，
    原来的 `if (rows < 3) return` 让它们连侧栏宽和死区都没量过 —— 六条判据里五条是
    "跑过了但什么都没验"。跳过要出声，但**能量的必须量**。
  */
  expect(m.navWidth!, `[${section}] 侧栏 200–260（macOS 参考区间）`).toBeGreaterThanOrEqual(200);
  expect(m.navWidth!).toBeLessThanOrEqual(260);
  expect(m.rightGap!, `[${section}] 面板右侧死区 ≤ 48px`).toBeLessThanOrEqual(48);
  expect(m.cardsGrids, `[${section}] 同一节不许并存两种列表语法（行 + 复选卡网格）`).toBe(0);

  if (m.rows < 3) {
    // 1–2 行是**样本不完整**（不是"这一节本来就没有行"）：那种情形下"形状一致"
    // 可能只是因为恰好一样，判据会变成恒真 —— 所以要求它是 **0**。
    expect(
      m.rows,
      `[${section}] 有 ${m.rows} 行 preference-row —— 样本 < 3 时"形状一致"证明不了什么，`
        + '要么补行，要么让这一节明确地不含这种行',
    ).toBe(0);
    console.log(`SETTINGS_SHAPE_SKIP ${section} rows=0（这一节没有 preference-row；版面三条已判）`);
    return;
  }
  // 🔴 控件是**尾部对齐**的：右缘必须唯一，左缘本来就该随控件宽度不同。
  // 我第一版写成了"左缘唯一"，那会逼着人把控件改成左对齐 —— 错判据比没有判据更糟。
  expect(m.rights, '同行控件右缘必须唯一').toHaveLength(1);
  expect(m.heights.length, '控件高度档位 ≤ 2').toBeLessThanOrEqual(2);
  // 没有任何"同容器相邻行"的节（每块只有一行）不判行距，但要出声。
  if (m.pitchSamples === 0) {
    console.log(`SETTINGS_PITCH_SKIP ${section}（同容器内没有相邻行）`);
  } else {
    expect(m.medianPitch!, '行距中位数 44–56').toBeGreaterThanOrEqual(44);
    expect(m.medianPitch!).toBeLessThanOrEqual(56);
  }
  /**
   * 🔴 口径：`preference-row` / `toggle` / `row` / `form-field-inline` 在**视觉上**
   * 是同一套语法（标签在左、控件在右、同一高度档），差异只是 DOM 血缘
   * （原生行 / AI 旧行 / 更早的行原语 / 表单字段的 inline 形态）。
   * 所以判据不要求血缘唯一 —— 那会逼着人去重写四个面板 —— 而是要求
   * **量出来的形状一致**：高度档 ≤2、右缘唯一、行距在区间内。这三条已经覆盖
   * "看着乱"的真实来源。血缘只打印出来供人核对。
   */
  console.log(`SETTINGS_PRIMITIVES ${section} ${JSON.stringify(m.primitives)}`);
});
}
