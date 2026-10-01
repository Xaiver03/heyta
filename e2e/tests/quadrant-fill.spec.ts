import { expect, test } from '@playwright/test';
import { openApp, switchView } from './helpers';

/**
 * R2 判据 · 组件把视口给的剩余高度**用掉**（"铺满"），而且**不靠写死 vh**。
 *
 * 🔴 本体是**传播判据**，不是"board 够不够高"。后者可以在宿主写一行
 * `height: 100vh` 就糊过去 —— 而那一行同时服务 RN（没有 vh）与窄窗单列
 * （"铺满"在那里意味着要滚），所以它是错的修法。真正要钉住的不变量是：
 * **从视口到需要它的那一层，每一层要么有确定高度、要么把父层的空间传下去**（类 C）。
 *
 * 三条各自挡一种坏法，缺一条就会假绿：
 *  · 判据 1（逐层链）挡"某一层偷偷退回块容器 / `flex: 0 0 auto`"；
 *  · 判据 2（三档视口 + 四格等高）挡"链是通的但没长"；
 *  · 判据 3（窄窗单列）挡"用固定高度换来的绿" —— 那条分支下契约换成"可滚动、不裁切"。
 *
 * ⚠️ 载体：**桌面载荷**（真 Chromium + 真盒模型）。RN 侧同一份共享层由
 * `scripts/verify-mobile-quadrant-fill.sh` 在真模拟器上验，两边不互相冒充。
 *
 * 🔴 阈值全部从 `:root` 上的 CSS 变量推导，不写死 192 / 768 / 24。
 */

// 🔴 证据不落 `e2e/test-results/`：那是 Playwright 每次运行开头会清空的目录，
// 而这条工作树上有并发会话在跑自己的套件（实测过一次，我唯一的四张图被它们删掉）。
const SHOT = (name: string) => `../apps/web/evidence/quadrant-fill/${name}.png`;

interface NodeInfo {
  label: string;
  display: string;
  flexDirection: string;
  flexGrow: string;
  flexShrink: string;
  flexBasis: string;
  height: string;
  minHeight: string;
  overflowY: string;
  clientH: number;
  scrollH: number;
  rectH: number;
}

/** 从 `#quadrant-board` 里的第一格往上走到 `main`，逐层把盒模型事实抄下来。 */
const PROBE = () => {
  const cell = document.querySelector('[data-testid^="quadrant-cell-"]');
  const board = document.querySelector('[data-testid="quadrant-board"]');
  const content = document.querySelector('.ht-content');
  const main = document.querySelector('main.ht-main');
  const read = (label: string, n: Element | null): NodeInfo | null => {
    if (!n) return null;
    const c = getComputedStyle(n);
    return {
      label,
      display: c.display,
      flexDirection: c.flexDirection,
      flexGrow: c.flexGrow,
      flexShrink: c.flexShrink,
      flexBasis: c.flexBasis,
      height: c.height,
      minHeight: c.minHeight,
      overflowY: c.overflowY,
      clientH: n.clientHeight,
      scrollH: n.scrollHeight,
      rectH: +n.getBoundingClientRect().height.toFixed(1),
    };
  };
  const se = document.scrollingElement;
  const cs = content ? getComputedStyle(content) : null;
  /*
    🔴 **滚动所有者必须由探针找出来，不许写死"文档"**（类 D：判据自己选错坐标系）。
    宽屏下 `.ht-app` 是 `min-height:100dvh` ⇒ 整页在文档里滚；
    ≤768px 分支把它改成 `height:100dvh` + `main{overflow-y:auto}`（`app.css:3030-3040`，
    为的是底部导航常驻贴底）⇒ **滚动所有者换成 `main`，文档永远不滚**。
    这条判据当初直接断言 `document.scrollHeight > clientHeight`，于是窄窗那一档
    以"内容被裁"的名义红了一次 —— 而实际内容是可滚到的。
  */
  const label = (n: Element) =>
    n.tagName.toLowerCase() + (n.getAttribute('class') ? `.${n.getAttribute('class')!.split(' ')[0]}` : '');
  let owner: { label: string; scrollH: number; clientH: number; path: string } | null = null;
  for (let n: Element | null = board; n && n.tagName !== 'HTML'; n = n.parentElement) {
    const c = getComputedStyle(n);
    if (/(auto|scroll)/.test(c.overflowY) && n.scrollHeight > n.clientHeight + 1) {
      owner = { label: label(n), scrollH: n.scrollHeight, clientH: n.clientHeight, path: 'el' };
      break;
    }
  }
  if (owner === null && se) {
    owner = { label: 'document', scrollH: se.scrollHeight, clientH: se.clientHeight, path: 'doc' };
  }
  return {
    chain: [
      read('main', main),
      read('.ht-content', content),
      read('#quadrant-board', board),
      read('row', board?.firstElementChild ?? null),
      read('cell', cell),
    ],
    // 内容列**去掉上下内边距**之后真正可用于生长的空间
    contentBoxH: content ? content.clientHeight - parseFloat(cs!.paddingTop) - parseFloat(cs!.paddingBottom) : 0,
    doc: { scrollH: se?.scrollHeight ?? 0, clientH: se?.clientHeight ?? 0 },
    scrollOwner: owner,
    tokens: {
      quadrantMin: (() => {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--ht-layout-quadrant-min-height');
        return v.trim();
      })(),
      twoColumnMin: (() => {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--ht-layout-two-column-min');
        return v.trim();
      })(),
    },
    cells: [...document.querySelectorAll('[data-testid^="quadrant-cell-"]')].map((e) => {
      const b = e.getBoundingClientRect();
      return {
        testId: e.getAttribute('data-testid'),
        h: +b.height.toFixed(1),
        w: +b.width.toFixed(1),
        bottom: +b.bottom.toFixed(1),
      };
    }),
    viewport: { w: innerWidth, h: innerHeight },
  };
};

type Probe = Awaited<ReturnType<typeof PROBE>>;

/** 把探针结果写成可读的失败信息（几何判据不给出数字就没法排查）。 */
const fmt = (p: Probe) =>
  p.chain
    .filter(Boolean)
    .map((n) => `${n!.label}: ${n!.display}/${n!.flexDirection} grow=${n!.flexGrow} shrink=${n!.flexShrink} basis=${n!.flexBasis} h=${n!.height} rect=${n!.rectH}`)
    .join('\n    ') +
  `\n    cells=${p.cells.map((c) => `${c.testId}:${c.h}`).join(' ')} contentBox=${p.contentBoxH.toFixed(1)} doc=${p.doc.scrollH}/${p.doc.clientH} owner=${p.scrollOwner ? `${p.scrollOwner.label}:${p.scrollOwner.scrollH}/${p.scrollOwner.clientH}` : 'none'}`;

async function probe(page: import('@playwright/test').Page): Promise<Probe> {
  // 等过渡落位再量（§2.4 第 3 条：按太快的快门会拍到中间态）
  await page.waitForTimeout(400);
  return page.evaluate(PROBE);
}

test.describe('R2 · 四象限铺满剩余高度（桌面载荷）', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page, '/');
    if (await page.getByTestId('privacy-consent-dialog').isVisible().catch(() => false)) {
      await page.getByTestId('privacy-consent-local-only').click();
      await expect(page.getByTestId('privacy-consent-dialog')).toHaveCount(0);
    }
    // 建两条任务，让格子里有内容（空格的 minHeight 会让"长满"和"没长"难以区分）
    const add = async (text: string): Promise<void> => {
      const before = await page.locator('[data-testid^="task-item-"]').count();
      const composer = page.locator('input[placeholder^="添加任务"]');
      await composer.fill(text);
      await composer.press('Enter');
      await expect
        .poll(() => page.locator('[data-testid^="task-item-"]').count(), { timeout: 15_000 })
        .toBeGreaterThan(before);
    };
    await add('铺满判据用的短标题甲');
    await add('铺满判据用的短标题乙');
    await switchView(page, '四象限');
    await expect(page.getByTestId('quadrant-cell-1').first()).toBeVisible();
  });

  test('判据 1 · 确定高度从视口一路传到格子（逐层链，不许有块容器断点）', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const p = await probe(page);
    const [main, content, board, row, cell] = p.chain;
    expect(main, 'main.ht-main 不在 DOM 里').not.toBeNull();
    expect(content, '.ht-content 不在 DOM 里').not.toBeNull();

    // ① 内容列必须是 **flex 列**：块容器只 Stretch 自己、不传弹性基准（类 C 的本体）
    expect(content!.display, `内容列不是 flex ⇒ 子层的 flex-grow 全部空转\n    ${fmt(p)}`).toBe('flex');
    expect(content!.flexDirection, `内容列不是列方向 ⇒ 高度不会分给子层\n    ${fmt(p)}`).toBe('column');
    expect(Number(content!.flexGrow), `内容列自己没有 grow ⇒ 拿不到 main 的剩余高度\n    ${fmt(p)}`).toBeGreaterThanOrEqual(1);

    // ② 板子必须**声明增长**，而且**不许被压**
    expect(Number(board!.flexGrow), `板子没有 flex-grow ⇒ 它的高度由内容决定，格子的 flex:1 空转\n    ${fmt(p)}`).toBeGreaterThanOrEqual(1);
    expect(Number(board!.flexShrink), `板子允许收缩 ⇒ 任务一多就被压到 minHeight 以下（那是另一种看不见）\n    ${fmt(p)}`).toBe(0);

    // ③ 行层同样要传下去（两行等分），格子自己只兜底
    expect(Number(row!.flexGrow), `行没有 flex-grow ⇒ 两行不会等分板子的剩余高度\n    ${fmt(p)}`).toBeGreaterThanOrEqual(1);
    expect(Number(row!.flexShrink), `行允许收缩 ⇒ 四格互相叠\n    ${fmt(p)}`).toBe(0);
    expect(parseFloat(cell!.minHeight), `格子没有 minHeight ⇒ 单列分支下会被压成零高\n    ${fmt(p)}`).toBeGreaterThan(0);

    // ④ 链上**任何一层**都不许是 `flex: 0 0 auto`（那等于把断点重新种回去）
    for (const n of [content, board, row]) {
      expect(
        n!.flexGrow === '0' && n!.flexBasis === 'auto',
        `${n!.label} 是 flex:0 0 auto —— 确定高度在这一层断了\n    ${fmt(p)}`,
      ).toBeFalsy();
    }
    await page.screenshot({ path: SHOT('chain-800') });
  });

  for (const height of [800, 1000, 1200]) {
    test(`判据 2 · 视口高 ${height}：板子用掉剩余空间且四格等高`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height });
      const p = await probe(page);
      const ratio = p.chain[2]!.rectH / p.contentBoxH;
      expect(
        ratio,
        `板子只占内容列的 ${(ratio * 100).toFixed(1)}%（< 90% 就是"没铺满"）\n    ${fmt(p)}`,
      ).toBeGreaterThanOrEqual(0.9);
      const hs = p.cells.map((c) => c.h);
      expect(hs.length, '四格没都渲染出来').toBe(4);
      expect(Math.max(...hs) - Math.min(...hs), `四格高度不等 ⇒ 行层没等分：${hs.join('/')}\n    ${fmt(p)}`).toBeLessThanOrEqual(1);
      // 横向同样要铺满：两格 + 一条缝 = 板子内宽
      const boardInner = p.chain[2]!.rectH > 0 ? await page.locator('[data-testid="quadrant-board"]').evaluate((e) => e.clientWidth - parseFloat(getComputedStyle(e).paddingLeft) - parseFloat(getComputedStyle(e).paddingRight)) : 0;
      const rowW = p.cells[0].w * 2; // 只验"两格之和接近内宽"，缝由 gap token 决定
      expect(rowW, `两格宽度之和远小于板子内宽 ⇒ 横向没铺满\n    ${fmt(p)}`).toBeGreaterThan(boardInner * 0.9);
      await page.screenshot({ path: SHOT(`fill-${height}`) });
    });
  }

  test('判据 3 · 窄窗单列：契约换成"不裁切 + 可滚动"，每格不低于 token', async ({ page }) => {
    const twoCol = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ht-layout-two-column-min').trim(),
    );
    const narrow = parseFloat(twoCol) - 68; // 768px → 700px：确实掉进单列分支
    await page.setViewportSize({ width: narrow, height: 800 });
    const p = await probe(page);
    const minPx = await page.evaluate(() => {
      const el = document.createElement('div');
      el.style.display = 'none';
      el.style.height = getComputedStyle(document.documentElement).getPropertyValue('--ht-layout-quadrant-min-height');
      document.body.appendChild(el);
      const px = parseFloat(getComputedStyle(el).height);
      el.remove();
      return px;
    });
    const hs = p.cells.map((c) => c.h);
    expect(hs.length, '单列下四格应当仍然都在').toBe(4);
    for (const h of hs) {
      expect(h, `单列下有格子低于 minHeight token（${minPx}px）：${hs.join('/')}\n    ${fmt(p)}`).toBeGreaterThanOrEqual(minPx - 0.5);
    }
    // "铺满"在单列下 = 内容长到能滚，而不是被压进一屏。
    // 🔴 两条分开断言，各自挡一种坏法：
    //   A. **该滚的必须能滚**：板子比滚动所有者的可视区还高时，那个所有者必须真的可滚
    //      （挡住"某个祖先 overflow:hidden 把第四格切掉"和"被 flex 压扁成零头"）；
    //   B. **滚到最底必须看得见最后一格**：挡住"能滚但滚不够"（尾部 padding 被裁）
    //      与"滚动条存在但内容被 clip"。
    const owner = p.scrollOwner;
    expect(owner, `找不到滚动所有者 ⇒ 内容被 clip 在某一层里\n    ${fmt(p)}`).not.toBeNull();
    const boardH = p.chain[2]!.rectH;
    if (boardH > owner!.clientH + 1) {
      expect(
        owner!.scrollH,
        `板子 ${boardH}px 高于 ${owner!.label} 可视区 ${owner!.clientH}px，但所有者不能滚（scrollH=${owner!.scrollH}）⇒ 内容被裁\n    ${fmt(p)}`,
      ).toBeGreaterThan(owner!.clientH);
    }
    await page.screenshot({ path: SHOT('narrow-top') });
    const reach = await page.evaluate(() => {
      const board = document.querySelector('[data-testid="quadrant-board"]');
      let scroller: HTMLElement | null = null;
      for (let n: Element | null = board; n && n.tagName !== 'HTML'; n = n.parentElement) {
        const c = getComputedStyle(n);
        if (/(auto|scroll)/.test(c.overflowY) && (n as HTMLElement).scrollHeight > n.clientHeight + 1) {
          scroller = n as HTMLElement;
          break;
        }
      }
      const cells = [...document.querySelectorAll('[data-testid^="quadrant-cell-"]')];
      const last = cells[cells.length - 1];
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      else window.scrollTo(0, document.scrollingElement!.scrollHeight);
      const lb = last.getBoundingClientRect();
      // 裁剪框：滚动元素自己的可视区；文档态则取视口
      const cb = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight } as DOMRect;
      return {
        label: scroller ? scroller.tagName.toLowerCase() : 'document',
        lastTop: +lb.top.toFixed(1),
        lastBottom: +lb.bottom.toFixed(1),
        clientTop: +cb.top.toFixed(1),
        clientBottom: +cb.bottom.toFixed(1),
      };
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: SHOT('narrow-single-column') });
    expect(
      reach.lastBottom <= reach.clientBottom + 1,
      `滚到最底后最后一格底边 ${reach.lastBottom} 仍在 ${reach.label} 可视区(${reach.clientBottom}) 之外 ⇒ 被裁\n    ${fmt(p)}`,
    ).toBe(true);
    expect(
      reach.lastTop >= reach.clientTop - 1,
      `滚到最底后最后一格顶边 ${reach.lastTop} 在 ${reach.label} 可视区(${reach.clientTop}) 之上 ⇒ 它被推到了看不见的地方\n    ${fmt(p)}`,
    ).toBe(true);
  });
});
