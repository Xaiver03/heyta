/**
 * 真实浏览器验收：行内浮层里的 AI 面板 —— **不许越出浮层**，且同一排动作**只有一档字号**
 * ======================================================================================
 *
 * 这条用例钉的是 2026-10-21 用户报的两个真缺陷（不是审美意见）：
 *
 *   1. 🔴 **AI 拆解提案浮层左溢 121px，压住任务列表与侧栏。**
 *      实测（1012×632）：浮层 `x=604 w=384`，而里面的 `[data-testid="ai-proposal"]`
 *      `x=483 w=493`。原因不是宽度算错 —— 那枚是 RN 的 `View`，RNW 默认
 *      `flex: 0 0 auto`，宽度取 **max-content**（note 整行 469 + 内边距 24 = 493）；
 *      浮层起点又是 `margin-inline-start: calc(100% - 面板宽)`（B214 的"往左长"），
 *      于是多出来的宽度全部长到**左边**。
 *      判据：AI 面板的左右边必须落在浮层的内容盒内（±1px 容差），
 *      且文档不出现横向滚动。
 *
 *   2. 🔴 **浮层是半透明材质（0.78），底下的任务行文字透上来**，而且
 *      `截止` 这枚动作是裸 `<summary>`、字号回落到 16px，与同排的
 *      `备注 / 子任务 / 提醒`（`.ht-chip` = 11px）不是一档。
 *      判据：装了 AI 面板的浮层背景必须**不透明**；同一排四枚动作的
 *      `font-size` 必须**逐字相等**（不是"看着差不多"）。
 *
 * ⚠️ 两档视口都跑：越界在窄窗更严重，而"只是宽窗没事"会让判据看起来是绿的。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { revealRowActions } from './ai-entry.js';
import {
  addTask,
  CAP_LONG_CONTEXT,
  CAP_STRUCTURED_OUTPUT,
  configureEndpoint,
  openApp,
  resetStub,
  switchView,
} from './helpers.js';

const EVIDENCE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/web/evidence/ai-panel-layout',
);

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 打开「更多」→ AI 拆解 → 发送，停在提案态。 */
async function openProposal(page: Page, request: Parameters<typeof resetStub>[0]): Promise<void> {
  await resetStub(request);
  await openApp(page, '/', 'accepted');
  // 这一发外部登录配置请求在本机被 CORS 拦（与流式那条用例同一处置），
  // 否则"控制台干净"这类断言会被环境噪音污染。
  await page.route('**/api/auth/central/config', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await configureEndpoint(page, {
    capabilities: [CAP_STRUCTURED_OUTPUT, CAP_LONG_CONTEXT],
    features: ['breakdown'],
  });
  await switchView(page, '任务');
  await addTask(page, '把新版本发到生产环境');
  await revealRowActions(page, '把新版本发到生产环境');
  await page.locator('[data-testid^="ai-breakdown-"]').click();
  await page.locator('[data-testid="ai-send"]').click();
  await expect(page.locator('[data-testid="ai-proposal"]')).toBeVisible();
}

/** 量一批元素（浮层 / AI 面板 / 任务列表）与同一排动作的字号。 */
async function measure(page: Page): Promise<{
  panel: Rect | null;
  dialog: Rect | null;
  list: Rect | null;
  panelBg: string;
  dialogFlex: string;
  actionFontSizes: string[];
  docScrollWidth: number;
  innerWidth: number;
}> {
  return page.evaluate(() => {
    const rect = (el: Element | null): Rect | null => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const panel = document.querySelector('.ht-compose-actions__panel');
    const dialog = document.querySelector('[data-testid="ai-proposal"]');
    const list = document.querySelector('[data-testid="task-list"]');
    const items = document.querySelector('.ht-compose-actions__items');
    const actions = [...(items?.children ?? [])].filter((el) => el.matches('details'));
    return {
      panel: rect(panel),
      dialog: rect(dialog),
      list: rect(list),
      panelBg: panel === null ? '' : getComputedStyle(panel).backgroundColor,
      dialogFlex: dialog === null ? '' : getComputedStyle(dialog).flexShrink,
      actionFontSizes: actions.map((el) => {
        const label = el.querySelector('summary') ?? el;
        return getComputedStyle(label).fontSize;
      }),
      docScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
}

test.describe('行内浮层里的 AI 面板：不越界 / 不透明 / 一档字号', () => {
  for (const viewport of [
    { name: 'wide', width: 1280, height: 720 },
    { name: 'narrow', width: 1012, height: 632 },
  ] as const) {
    test(`${viewport.name}（${String(viewport.width)}×${String(viewport.height)}）`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openProposal(page, request);

      const m = await measure(page);
      expect(m.panel, '浮层必须在').not.toBeNull();
      expect(m.dialog, 'AI 面板必须在').not.toBeNull();
      expect(m.list, '任务列表必须在').not.toBeNull();
      if (m.panel === null || m.dialog === null || m.list === null) return;

      // ══ 1. 不许横向越界：面板左右边落在浮层内（±1px 取整误差）══
      expect(
        m.dialog.x,
        `AI 面板左边 ${m.dialog.x.toFixed(1)} 越出浮层左边 ${m.panel.x.toFixed(1)}`,
      ).toBeGreaterThanOrEqual(m.panel.x - 1);
      expect(
        m.dialog.x + m.dialog.w,
        `AI 面板右边 ${(m.dialog.x + m.dialog.w).toFixed(1)} 越出浮层右边 ${(m.panel.x + m.panel.w).toFixed(1)}`,
      ).toBeLessThanOrEqual(m.panel.x + m.panel.w + 1);
      // 也不许压到任务列表左边线之外（侧栏那侧）
      expect(m.dialog.x).toBeGreaterThanOrEqual(m.list.x - 1);
      // 文档级横向滚动条 = 真的越出界面了
      expect(m.docScrollWidth, '文档出现横向滚动 = 有东西越出视口').toBeLessThanOrEqual(m.innerWidth);

      // ══ 2. 装 AI 面板的浮层必须不透明（否则下层行文字透上来）══
      // `rgb(r, g, b)` = 不透明；`rgba(r, g, b, a)` 要 a === 1
      const alphaOf = (color: string): number => {
        const rgba = /^rgba\(([^)]+)\)$/.exec(color);
        if (rgba === null) return 1;
        const parts = (rgba[1] ?? '').split(',').map((x) => Number(x.trim()));
        return parts.length === 4 ? (parts[3] ?? 0) : 1;
      };
      expect(alphaOf(m.panelBg), `浮层背景 ${m.panelBg} 仍是半透明`).toBe(1);

      // ══ 3. 同一排动作只有一档字号（`截止` 曾经是 16px，另外三枚 11px）══
      expect(m.actionFontSizes.length, '这一排应当有备注/子任务/截止/提醒四枚').toBeGreaterThanOrEqual(4);
      expect(
        new Set(m.actionFontSizes).size,
        `同一排动作出现了多档字号：${m.actionFontSizes.join(' / ')}`,
      ).toBe(1);

      // ══ 4. RN View 的收缩必须被打开（否则它又会长回 max-content）══
      expect(m.dialogFlex).toBe('1');

      await page.screenshot({
        path: `${EVIDENCE}/${viewport.name}.png`,
        fullPage: false,
      });
    });
  }
});
