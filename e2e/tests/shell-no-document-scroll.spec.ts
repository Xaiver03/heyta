/**
 * 外壳不滚：文档一屏封顶，每一栏各自内部滚动（工单 H11，桌面那一半）
 * ==================================================================
 *
 * 落地的改动只有两条声明（`base.css` 的 `.ht-app` 由 `min-height` 改成钉死的
 * `height: 100dvh` + 行轨 `minmax(0, 1fr)`，滚动挂在 `main-area.css` 的 `.ht-content` 上），
 * 但它们换掉的是一整条**参照系**：在此之前"整页滚"是默认行为，而三份几何判据
 * （`calendar-wheel` / `quadrant-fill` / `search-overlay`）与 `shell-sidebar-height`
 * 量的都是 `window` 那条滚动轴。这一份文件钉的是新参照系本身，缺了它 H11 就是
 * 一次没有判据的行为变更（§7 元规则 2）。
 *
 * 四种坏形状各自会让哪一格红 —— 下面这四条读数是 21:4x 在隔离载体上**逐臂跑出来**的，
 * 不是"应该会红"（臂台与原始日志：`scripts/h11-arms.sh`、`scripts/.h11-arms/*.log`）：
 *   臂 A 把 `height` 换回 `min-height`            ⇒ 实测 3 条全红（W1/W2/W3）；
 *   臂 B 拿掉行轨的 `minmax(0,1fr)`（只钉容器高）  ⇒ 实测 3 条全红；
 *   臂 C 拿掉 `.ht-content` 的 `min-block-size:0`  ⇒ 实测 13 条全绿 = **臂存活**，
 *        所以那一行声明已经从 `main-area.css` 删掉：没有任何判据需要它（flex 项的自动
 *        最小尺寸只在 `overflow: visible` 时才等于内容高度，而这一层正是 `auto`）。
 *        这一格留在这里是挡"以后有人把它加回去并声称它承重"。
 *   臂 D 把滚动从 `.ht-content` 搬到 `.ht-main`    ⇒ 实测 W1 + W2 红，
 *        而 `detail-column-slot` 那三条把手判据**全绿**。⚠️ 第一版写的是"红在把手命中带"，
 *        探针把这句否证了：两种形态下 `elementFromPoint` 都命中把手自己
 *        （`hitIsResizer: true`）。真实的第二条理由是 `.ht-main` 长出 4px 横向可滚范围
 *        （`scrollWidth 628 / clientWidth 624`）—— 那条现在由 **W4** 量着，
 *        臂 D 下 W4 会红（`overflow-x` 变 `auto` 与那 4px 差值各一次）。
 *
 * W2 收的是 B95 看图时记下的那一档：最靠下那一行的整理编辑器**朝下弹**。
 * 这一格不是预防性写的 —— 第一版实现（浮层仍 `position: absolute`）在这条上**真红过**：
 * 滚到底 `scrollTop=933` 已是 max，浮层 `bottom=778` 掉在可视区底 700 以下 78px，
 * 也就是"打开了、下半截永远够不着"。修法是 `material.css` 的 `.ht-material__row-slot`
 * （零高度槽 + 流内本体）。绝对定位的后代**不**计入滚动宿主的 `scrollable overflow`，
 * 这条值得记住：`TaskRepeat.tsx` 里那一枚同形状的浮层还欠着同样的搬运。
 *
 * ⚠️ 载体：默认那份 `playwright.config.ts`（vite **dev**，改 `apps/web/src/**` 不用重打）。
 *    跑法（仓库根）：`cd e2e && npx playwright test tests/shell-no-document-scroll.spec.ts`
 */
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import {
  addHabit,
  addTask,
  openApp,
  rowFor,
  showDetailColumnContent,
  switchView,
} from './helpers';

const SHOT = (name: string) =>
  fileURLToPath(
    new URL(`../../apps/web/evidence/shell-no-document-scroll/${name}.png`, import.meta.url),
  );

/** 一次取齐"谁在给谁定高度"这六个数：文档、视口、窗口滚动轴，加滚动宿主的三态。 */
async function hosts(page: Page) {
  return page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('.ht-content');
    const rail = document.querySelector('nav.ht-rail')?.getBoundingClientRect();
    const cr = content?.getBoundingClientRect();
    return {
      docH: document.documentElement.scrollHeight,
      vh: window.innerHeight,
      scrollY: Math.round(window.scrollY),
      contentTop: Math.round(cr?.top ?? -1),
      contentH: Math.round(cr?.height ?? -1),
      contentScrollH: Math.round(content?.scrollHeight ?? -1),
      contentScrollTop: Math.round(content?.scrollTop ?? -1),
      railTop: Math.round(rail?.top ?? -1),
      railBottom: Math.round(rail?.bottom ?? -1),
    };
  });
}

/** 把 `.ht-content` 滚到底（不是 window —— 外壳钉死之后 window 那条轴恒为 0）。 */
async function scrollContentToBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.ht-content');
    if (!el) return -1;
    el.scrollTop = el.scrollHeight;
    return Math.round(el.scrollTop);
  });
}

/** 文档那条轴必须**真的**滚不动：只比 `scrollHeight` 挡不住"能滚 1px"这种漏法。 */
async function tryWindowScroll(page: Page): Promise<number> {
  await page.evaluate(() => window.scrollTo(0, 4000));
  return page.evaluate(() => Math.round(window.scrollY));
}

test.describe('外壳不滚（H11 桌面那一半）', () => {
  test.use({ viewport: { width: 1280, height: 700 } });

  test('W1 文档一屏封顶；rail 与详情栏不跟着内容滚走', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    await openApp(page, '/?lang=zh-CN');
    await showDetailColumnContent(page, '外壳不滚甲');
    for (let i = 0; i < 14; i++) await addTask(page, `外壳不滚乙${String(i)}`);

    const before = await hosts(page);
    expect(
      before.contentScrollH - before.contentH,
      `内容列 ${String(before.contentScrollH)}px 而它的可视区 ${String(before.contentH)}px ⇒ ` +
        '这份夹具根本没让内容超高，"外壳不滚"在这屏上不需要成立 ⇒ 这一条没在验它声称验的东西',
    ).toBeGreaterThan(40);

    await page.screenshot({ path: SHOT('w1-before-scroll') });

    // ① 正面判据：窗口那条轴必须**试了才知道**滚不动。
    expect(await tryWindowScroll(page), '外壳仍然能整页滚（H11 那颗钉子被拔了）').toBe(0);
    const after = await hosts(page);
    expect(
      after.docH,
      `文档高 ${String(after.docH)}px 超过视口 ${String(after.vh)}px ⇒ 有人又用内容替整篇文档定高度`,
    ).toBeLessThanOrEqual(after.vh + 2);

    // ② 内容列自己滚得动（"不滚"不等于"看不见"）。
    const advanced = await scrollContentToBottom(page);
    expect(advanced, '.ht-content 滚到底 scrollTop 仍是 0 ⇒ 它不是滚动宿主，那内容超高去哪了？').toBeGreaterThan(0);

    // ③ rail 与详情栏对**视口**钉住：滚完内容之后不许动了。
    const scrolled = await hosts(page);
    expect(
      [scrolled.railTop, scrolled.railBottom],
      `rail 现在 top=${String(scrolled.railTop)} bottom=${String(scrolled.railBottom)}，` +
        `视口高 ${String(scrolled.vh)} ⇒ 它跟着内容滚上去了（§9.4 第 1 条用户看到的那一件事）`,
    ).toEqual([before.railTop, before.railBottom]);
    expect(scrolled.railTop, `rail 顶边不在视口顶上（${String(scrolled.railTop)}）`).toBe(0);
    expect(
      Math.abs(scrolled.railBottom - scrolled.vh),
      `rail 底边在 ${String(scrolled.railBottom)} 而视口底在 ${String(scrolled.vh)} ⇒ 它没有一屏封顶`,
    ).toBeLessThanOrEqual(2);
    expect(
      scrolled.contentTop,
      `内容列顶边从 ${String(before.contentTop)} 变成 ${String(scrolled.contentTop)} ⇒ 页头跟着滚走了`,
    ).toBe(before.contentTop);

    await page.screenshot({ path: SHOT('w2-after-scroll-bottom') });

    // ④ 详情栏是**另一条**滚动轴，且也对视口钉住。
    const detail = page.locator('.ht-app__detail');
    await expect(detail, '1280 宽却没有详情栏 ⇒ 这一条量的是两栏，不是三栏').toHaveCount(1);
    const dBox = await detail.boundingBox();
    expect(dBox, '详情栏"可见"却量不到盒子').not.toBeNull();
    expect(
      Math.round(dBox?.y ?? -1),
      `详情栏顶边在 ${String(Math.round(dBox?.y ?? -1))}，滚完内容之后它应当仍贴着视口顶`,
    ).toBe(0);
    expect(
      Math.round((dBox?.y ?? 0) + (dBox?.height ?? 0)),
      `详情栏底边在 ${String(Math.round((dBox?.y ?? 0) + (dBox?.height ?? 0)))} 而视口高 ${String(scrolled.vh)}`,
    ).toBeLessThanOrEqual(scrolled.vh + 2);

    expect(errors, `界面里有控制台错误：${errors.join(' | ')}`).toEqual([]);
  });

  test('W3 四个视图逐个量：没有任何一栏可以把文档顶长', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');
    for (let i = 0; i < 10; i++) await addTask(page, `外壳不滚丙${String(i)}`);
    // 🔴 「新习惯名称」那枚输入框**住在习惯视图里**，所以建习惯之前必须先切过去
    //（第一版直接 `addHabit` ⇒ 等 60s 超时，红在夹具而不是产品）。
    await switchView(page, '习惯');
    await addHabit(page, '外壳不滚丁习惯');
    await switchView(page, '任务');

    for (const label of ['任务', '日历', '四象限', '习惯']) {
      await switchView(page, label);
      const g = await hosts(page);
      expect(
        g.docH,
        `「${label}」这一屏文档高 ${String(g.docH)}px > 视口 ${String(g.vh)}px ⇒ 那一栏还在替整篇文档定高度`,
      ).toBeLessThanOrEqual(g.vh + 2);
      expect(await tryWindowScroll(page), `「${label}」这一屏外壳仍然能整页滚`).toBe(0);
    }

    await page.screenshot({ path: SHOT('w3-last-view') });
  });

  /**
   * W4 「为什么不挂在 `.ht-main`」的**可失败**版本。
   *
   * 第一版这里写的是一条推论（照抄 `sidebar.css` 的"命中带被裁 ⇒ 拖不动"），
   * 臂 D 探针把它否证了：两种形态下把手中心都命中自己。所以这一格改判**量得到的那件事**：
   * `.ht-main` 必须**不是**滚动宿主，而详情列把手那 4px 的有意越界
   * （`base.css` 的 `.ht-app__detail-resizer`：`inset-inline-end: -0.5 × space-2`）
   * 也不许变成一条只装得下 4px 的横向滚动。
   * 臂 D 现量：挂在 `.ht-main` 时 `overflow-x` 从 `visible` 变 `auto`、
   * `scrollWidth 628 > clientWidth 624` ⇒ 下面两条各红一次。
   */
  test('W4 `.ht-main` 不是滚动宿主，把手那 4px 也不成为横向滚动范围', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');
    await showDetailColumnContent(page, '外壳不滚甲');
    for (let i = 0; i < 14; i++) await addTask(page, `外壳不滚丁${String(i)}`);
    await scrollContentToBottom(page);

    const g = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('.ht-main');
      const el = document.querySelector<HTMLElement>('.ht-app__detail-resizer');
      if (!main || !el) return { missing: true };
      const cs = getComputedStyle(main);
      const b = el.getBoundingClientRect();
      const mb = main.getBoundingClientRect();
      const hit = document.elementFromPoint(
        Math.round(b.left + b.width / 2),
        Math.round(mb.top + 120),
      );
      // 🔴 判"它到底滚不滚得动"要**真的滚一次**，不是比 `scrollWidth > clientWidth`：
      // 那 4px 的越界在**两种**形态下都会让 `scrollWidth` 比 `clientWidth` 大 4
      // （修好的形态实测也是 628 / 624 —— 第一版据此写的判据在正确形态下就红了）。
      // 真正的区别是"有没有变成滚动容器"，所以这里试写 `scrollLeft` 再读回来。
      const beforeLeft = main.scrollLeft;
      main.scrollLeft = 100;
      const afterLeft = main.scrollLeft;
      main.scrollLeft = beforeLeft;
      return {
        missing: false,
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
        scrollW: main.scrollWidth,
        clientW: main.clientWidth,
        canScrollX: afterLeft,
        overhangRight: Math.round(b.right - mb.right),
        hitIsResizer: hit === el,
        space2: getComputedStyle(document.documentElement).getPropertyValue('--ht-space-2').trim(),
        // token 存的是 **rem**，`parseFloat` 拿到的那个数不是像素（实测 `--ht-space-2`
        // 计算值是 "0.5rem" ⇒ 直接除二得到 0.25，判据当场假红）。
        // 要 px 就让浏览器自己算：挂一枚临时元素、把 token 原样喂给它、量它的宽度。
        space2px: (() => {
          const probe = document.createElement('div');
          probe.style.position = 'absolute';
          probe.style.visibility = 'hidden';
          probe.style.inlineSize = 'var(--ht-space-2)';
          document.body.appendChild(probe);
          const w = probe.getBoundingClientRect().width;
          probe.remove();
          return Math.round(w);
        })(),
      };
    });
    expect(g.missing, '量不到 `.ht-main` 或详情列把手 ⇒ 这一条没有基准').toBe(false);
    expect(
      [g.overflowX, g.overflowY],
      `滚动挂回了 .ht-main（computed overflow = ${String(g.overflowX)}/${String(g.overflowY)}）：` +
        '页头会跟着滚走，而把手那 4px 的越界会变成一条能滚的横轴（见 main-area.css 那段读数）',
    ).toEqual(['visible', 'visible']);
    expect(
      g.canScrollX,
      `给 .ht-main 写 scrollLeft=100 之后读回来是 ${String(g.canScrollX)} ⇒ 它是横向滚动容器 ` +
        `(scrollWidth=${String(g.scrollW)} clientWidth=${String(g.clientW)})，` +
        '主区底部会有一条只装得下把手那 4px 的横滚条',
    ).toBe(0);
    expect(g.hitIsResizer, '把手中心反查命中的不是它自己 ⇒ 命中带被祖先裁掉了').toBe(true);
    // 越界值从 token 推，不写死 4（§7 元规则 2：阈值要能从被约束的常量算出来）。
    // 契约是 `inline-size: space-2` + `inset-inline-end: space-2 × -0.5`
    // ⇒ 命中带宽 = token 的 px 值，而骑出去的那一半 = 宽度的一半。
    expect(g.space2px, `--ht-space-2 量出来是 ${String(g.space2px)}px（计算值 "${g.space2}"）`).toBeGreaterThan(0);
    expect(
      g.overhangRight,
      `把手骑出主区右边缘 ${String(g.overhangRight)}px，而设计值是 --ht-space-2（${String(g.space2px)}px）的一半`,
    ).toBe(Math.round(g.space2px / 2));
  });
});

test.describe('滚到底之后，行尾整理编辑器仍够得着（B95 那一档）', () => {
  test.use({ viewport: { width: 900, height: 700 } });

  test('W2 真手势：滚到底 → 点最靠下一行的整理触发器 → 编辑器可见且能滚到完整', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    await openApp(page, '/?lang=zh-CN');
    const titles: string[] = [];
    for (let i = 0; i < 12; i++) {
      const t = `外壳不滚戊${String(i)}`;
      titles.push(t);
      await addTask(page, t);
    }

    // 挑视口里最靠下的那一行（B95 的形状就是"最靠下那一行的编辑器朝下弹到折叠线以下"）。
    let target = '';
    let bestBottom = Number.NEGATIVE_INFINITY;
    for (const t of titles) {
      const box = await rowFor(page, t).boundingBox();
      if (box && box.y + box.height > bestBottom) {
        bestBottom = box.y + box.height;
        target = t;
      }
    }
    expect(target, `${titles.length} 行一行都没量到 ⇒ 主区没画出来，这一条没有基准`).not.toBe('');

    const advanced = await scrollContentToBottom(page);
    expect(
      advanced,
      '内容列滚不动 ⇒ W1 那条"它是滚动宿主"已经不成立，这一条的量法失去前提',
    ).toBeGreaterThan(0);

    const trigger = rowFor(page, target).getByTestId('task-organize-summary');
    const tBox = await trigger.boundingBox();
    expect(tBox, '量不到行尾整理触发器 ⇒ 这一条点的是空气').not.toBeNull();
    await page.mouse.click(
      Math.round((tBox?.x ?? 0) + (tBox?.width ?? 0) / 2),
      Math.round((tBox?.y ?? 0) + (tBox?.height ?? 0) / 2),
    );

    const editor = page.getByLabel(`任务「${target}」所属清单`);
    await expect(editor, '点行尾触发器没打开整理编辑器').toBeVisible();
    await page.screenshot({ path: SHOT('w2-editor-open-before-fit') });

    // 🔴 "够得着"必须**展开之后再真的滚到底**才知道。第一版用的是
    // `editor.scrollIntoViewIfNeeded()`，而它只保证**那个输入框**可见 —— 失败的是浮层的
    // **底边**（实测 top=611 bottom=765 而可视区底是 700），于是这一条会读成通过。
    // 浮层是绝对定位的（`TaskOrganizer.tsx` 里那枚 `.ht-material`），
    // 它到底算不算进内容列的 `scrollHeight` 正是这一条要验的东西 —— 只能真的滚一次。
    const fitted = await editor.evaluate((el) => {
      const content = document.querySelector<HTMLElement>('.ht-content');
      // 🔴 从**编辑器自己**往上找它那张浮层，而不是 `document.querySelector('details[open]')`：
      // 一行里并列的 disclosure 不止一枚（「备注」也有一枚，理由写在
      // `TaskOrganizer.tsx` 里那段 testID 注释），全页第一个展开的可能根本是别行的。
      const panel = el.closest('details')?.querySelector<HTMLElement>('.ht-material');
      if (content) content.scrollTop = content.scrollHeight;
      const c = content?.getBoundingClientRect();
      const p = panel?.getBoundingClientRect();
      return {
        hasPanel: Boolean(p),
        panelTop: Math.round(p?.top ?? -1),
        panelBottom: Math.round(p?.bottom ?? -1),
        boxTop: Math.round(c?.top ?? -1),
        boxBottom: Math.round(c?.bottom ?? -1),
        scrollTop: Math.round(content?.scrollTop ?? -1),
        hostScrollH: Math.round(content?.scrollHeight ?? -1),
        hostH: Math.round(content?.clientHeight ?? -1),
        triggerTop: Math.round(
          el.closest('details')?.querySelector<HTMLElement>('summary')?.getBoundingClientRect().top ?? -1,
        ),
      };
    });
    expect(fitted.hasPanel, '展开后量不到那一行的整理浮层 ⇒ 下面两条没有基准').toBe(true);
    expect(
      fitted.panelBottom <= fitted.boxBottom + 1 && fitted.panelTop >= fitted.boxTop - 1,
      `整理编辑器 top=${String(fitted.panelTop)} bottom=${String(fitted.panelBottom)}，` +
        `可视区 top=${String(fitted.boxTop)} bottom=${String(fitted.boxBottom)}；` +
        `内容列 scrollTop=${String(fitted.scrollTop)}（已滚到 max）scrollHeight=${String(fitted.hostScrollH)} ` +
        `clientHeight=${String(fitted.hostH)}，触发器 top=${String(fitted.triggerTop)} ⇒ ` +
        '展开那枚浮层**不进**这一栏的可滚范围，外壳钉死之后它够不着（B95 那一档）：' +
        '要么让它参与 scrollHeight，要么让它在贴底时朝上弹',
    ).toBe(true);

    await page.screenshot({ path: SHOT('w2-editor-open-fitted') });
    expect(errors, `界面里有控制台错误：${errors.join(' | ')}`).toEqual([]);
  });
});
