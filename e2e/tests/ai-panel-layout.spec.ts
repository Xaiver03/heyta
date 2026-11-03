/**
 * 真实浏览器验收：任务详情里的 AI 面板 —— **不许越出它所在的那一格**，且同一族的动作标题
 * **只有一档字号**
 * ======================================================================================
 *
 * ## 这条用例原先钉的是什么，以及 2026-11 为什么换了主体
 *
 * 它钉的是 2026-10-21 用户报的两个真缺陷：
 *
 *   1. 🔴 **AI 拆解提案浮层左溢 121px，压住任务列表与侧栏。**
 *      实测（1012×632）：浮层 `x=604 w=384`，而里面的 `[data-testid="ai-proposal"]`
 *      `x=483 w=493`。原因不是宽度算错 —— 那枚是 RN 的 `View`，RNW 默认
 *      `flex: 0 0 auto`，宽度取 **max-content**（note 整行 469 + 内边距 24 = 493）；
 *      浮层起点又是 `margin-inline-start: calc(100% - 面板宽)`（"往左长"），
 *      于是多出来的宽度全部长到**左边**。
 *
 *   2. 🔴 **浮层是半透明材质（0.78），底下的任务行文字透上来**，而且
 *      `截止` 这枚动作是裸 `<summary>`、字号回落到 16px，与同排的
 *      `备注 / 子任务 / 提醒`（`.ht-chip` = 11px）不是一档。
 *
 * ⚠️ 2026-11：**行内动作行整体被删了**（产品负责人：「把所有这种铺开式组件全都删掉，
 * 全都收拢进来」）。于是上面测量过的两个主体一起消失：
 *
 *   · `.ht-compose-actions__panel` —— 装 AI 面板的那枚行内浮层（现量：`App.tsx` 里
 *     `ht-compose-actions` 出现 **0** 次，只剩 `controls.css` 里的孤儿样式）；
 *   · `.ht-compose-actions__items > details` —— 那一排四枚动作（备注 / 子任务 / 截止 / 提醒）。
 *
 * ⇒ 判据**跟着动作搬，不跟着动作消失**。搬完之后的新主体是：
 *
 *   · **AI 面板住在任务详情的「自动化」组**（`App.tsx` 的 `automationSlotNode`），
 *     所以"越出它所在的那一格"要对着 `[data-testid="task-pane"]` 量；
 *   · 那四枚动作变成了详情卡里的**块标题**（`blockLabelStyle`），与分组标题
 *     （`groupHeaderStyle`）是两个不同的族。同一族内部必须一档字号 —— 这一条仍然会红：
 *     谁再往详情里塞一枚手写样式的动作，它就不在族里，字号立刻分叉。
 *
 * 判据清单（两档视口都跑：越界在窄窗更严重，而"只是宽窗没事"会让判据看起来是绿的）：
 *
 *   A. `ai-proposal` 的左右边落在 `task-pane` 的内容盒内（±1px），
 *      且**也落在视口内**，且文档不出现横向滚动。
 *   B. `ai-proposal` 自己那层底必须**不透明**（`alpha === 1`）——
 *      "透上来"这一类缺陷仍然可能，只是现在透上来的是详情的底色而不是任务行。
 *   C. 详情那一格自己**没有横向溢出**（`scrollWidth <= clientWidth`）。这一条替换了原来
 *      钉 `flex-shrink === 1` 的那一臂：`flex-shrink` 只是当初那枚缺陷**成因的机制**
 *      （RNW 默认 `0 0 auto` 取 max-content，再配合 `margin-inline-start` 往左长），
 *      而面板搬进详情后它已经是普通块级流里的孩子，机制不再承重（现量 `flex-shrink: 0`
 *      而 A 臂全绿 —— 钉机制会得到一个**假红**）。行为本身仍然要钉：
 *      孩子再长出去，这一格就会横向滚动。
 *   D. 详情里**同一族的标题只有一档字号**：分组标题 ≥4 枚、块标题 ≥3 枚，
 *      各自集合大小必须为 1（两族之间可以不同，它们是两种角色）。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { openTaskDetail } from './ai-entry.js';
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

/** 选中那一行把详情打开 → AI 拆解 → 发送，停在提案态。 */
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
  // ⚠️ 「AI 拆解」入口住在任务详情的「自动化」组（不再挂行尾）⇒ 先开详情再点入口。
  await openTaskDetail(page, '把新版本发到生产环境');
  await page.locator('[data-testid^="ai-breakdown-"]').click();
  await page.locator('[data-testid="ai-send"]').click();
  await expect(page.locator('[data-testid="ai-proposal"]')).toBeVisible();
}

/** 量宿主格 / AI 面板 / 两族标题的字号。 */
async function measure(page: Page): Promise<{
  host: Rect | null;
  proposal: Rect | null;
  proposalBg: string;
  hostScrollOverflow: number;
  groupHeaderFontSizes: string[];
  blockLabelFontSizes: string[];
  docScrollWidth: number;
  innerWidth: number;
}> {
  return page.evaluate(() => {
    const rect = (el: Element | null): Rect | null => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const host = document.querySelector('[data-testid="task-pane"]');
    const proposal = document.querySelector('[data-testid="ai-proposal"]');
    const fontSizes = (els: Element[]): string[] =>
      els.map((el) => getComputedStyle(el).fontSize);
    // 分组标题带 `task-detail-group`；块标题（备注 / 子任务 / 截止 / 优先级）**不带**
    // 那个 testid —— 这个区分本身就是"两种角色"的现量形状，不额外加标记。
    const groupHeaders = [...(host?.querySelectorAll('h3[data-testid="task-detail-group"]') ?? [])];
    const blockLabels = [...(host?.querySelectorAll('h3:not([data-testid])') ?? [])];
    return {
      host: rect(host),
      proposal: rect(proposal),
      proposalBg: proposal === null ? '' : getComputedStyle(proposal).backgroundColor,
      hostScrollOverflow: host === null ? 0 : host.scrollWidth - host.clientWidth,
      groupHeaderFontSizes: fontSizes(groupHeaders),
      blockLabelFontSizes: fontSizes(blockLabels),
      docScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
}

test.describe('任务详情里的 AI 面板：不越界 / 不透明 / 同族一档字号', () => {
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
      expect(m.host, 'AI 面板所在的详情格必须在').not.toBeNull();
      expect(m.proposal, 'AI 面板必须在').not.toBeNull();
      if (m.host === null || m.proposal === null) return;

      // ══ A. 不许横向越界 ════════════════════════════════════════════════
      expect(
        m.proposal.x,
        `AI 面板左边 ${m.proposal.x.toFixed(1)} 越出详情格左边 ${m.host.x.toFixed(1)}`,
      ).toBeGreaterThanOrEqual(m.host.x - 1);
      expect(
        m.proposal.x + m.proposal.w,
        `AI 面板右边 ${(m.proposal.x + m.proposal.w).toFixed(1)} 越出详情格右边 ${(m.host.x + m.host.w).toFixed(1)}`,
      ).toBeLessThanOrEqual(m.host.x + m.host.w + 1);
      // 用户看得见的那一条：越出视口就是压到了别的东西上。
      expect(m.proposal.x, 'AI 面板左边越出视口').toBeGreaterThanOrEqual(-1);
      expect(
        m.proposal.x + m.proposal.w,
        'AI 面板右边越出视口',
      ).toBeLessThanOrEqual(m.innerWidth + 1);
      // 文档级横向滚动条 = 真的越出界面了
      expect(m.docScrollWidth, '文档出现横向滚动 = 有东西越出视口').toBeLessThanOrEqual(
        m.innerWidth,
      );

      // ══ B. 面板自己那层底必须不透明（否则下层文字透上来）═════════════════
      // `rgb(r, g, b)` = 不透明；`rgba(r, g, b, a)` 要 a === 1。
      const alphaOf = (color: string): number => {
        const rgba = /^rgba\(([^)]+)\)$/.exec(color);
        if (rgba === null) return 1;
        const parts = (rgba[1] ?? '').split(',').map((x) => Number(x.trim()));
        return parts.length === 4 ? (parts[3] ?? 0) : 1;
      };
      expect(alphaOf(m.proposalBg), `AI 面板背景 ${m.proposalBg} 仍是半透明`).toBe(1);

      // ══ C. 详情那一格不许横向溢出（孩子长出去 = 这一格开始横向滚动）════════
      expect(m.hostScrollOverflow, `详情格横向溢出 ${String(m.hostScrollOverflow)}px`).toBeLessThanOrEqual(1);

      // ══ D. 详情里同一族的标题只有一档字号 ═════════════════════════════════
      expect(m.groupHeaderFontSizes.length, '详情至少有基本/时间/组织/自动化四组标题')
        .toBeGreaterThanOrEqual(4);
      expect(m.blockLabelFontSizes.length, '块标题至少有备注/子任务/截止/优先级四枚')
        .toBeGreaterThanOrEqual(3);
      expect(
        new Set(m.groupHeaderFontSizes).size,
        `分组标题出现了多档字号：${m.groupHeaderFontSizes.join(' / ')}`,
      ).toBe(1);
      expect(
        new Set(m.blockLabelFontSizes).size,
        `块标题出现了多档字号：${m.blockLabelFontSizes.join(' / ')}`,
      ).toBe(1);

      await page.screenshot({
        path: `${EVIDENCE}/${viewport.name}.png`,
        fullPage: false,
      });
    });
  }
});
