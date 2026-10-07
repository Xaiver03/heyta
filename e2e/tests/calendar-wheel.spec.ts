import { expect, test, type Page } from '@playwright/test';

import { openApp } from './helpers';

/**
 * 滚轮翻月（真浏览器）—— 只判 jsdom **判不到**的那一件事
 * ==========================================================
 *
 * jsdom 那边（`apps/web/tests/calendar-wheel-month.spec.tsx`，19 条）已经把
 * **判据与接线**钉住了：一格 = 一个月、`deltaMode` 归一化、锁定期吃掉惯性、
 * 横向/⌘ 让出去、两列同一个 cursor。那些用例全绿也**证明不了页面没跟着滚** ——
 * 🔴 jsdom 有布局吗？没有。它实现了规范里的 in-passive 标志（所以"注册成 passive"
 * 这件事单测抓得到：`defaultPrevented` 会留在 false），但它**不会滚**，事件目标
 * 也就不会从格子底下移走。而真浏览器里挂成 passive 的实测形状更糟：浏览器先滚、
 * 再按**滚动后**的位置做命中测试 ⇒ `event.target` 已经不在格子内 ⇒ `within`
 * 判假 ⇒ 连 `preventDefault()` 都走不到（控制台一句警告没有），月份压根不翻。
 * ⇒ "滚没滚页面"这一半只有真浏览器能证，而它正是这条交互的产品语义。
 *
 * ## 所以这里只做三件事
 *
 * 1. **边界**：Web 月档不再重复渲染当天清单，月格之外的页脚滚轮应该让给页面；
 *    指针在**月历格子**上滚 → 月份变了且事件被月历消费。
 * 2. `defaultPrevented` 由**页面自己在 window 冒泡阶段读回来**，
 *    不是我们自说自话（监听器必须挂在 host 之后收到事件的那一侧 = window 冒泡）。
 * 3. `prefers-reduced-motion: reduce` 下功能一致，且月历卡片**没有**任何动画
 *    （翻月是换数据，不是弹跳）。
 *
 * ## 截图
 *
 * 先截图再断言。三张固定名：滚月前 / 滚月后 / reduce 动效下。
 */

// 🔴 视口压矮：默认 720 下这一屏**根本不溢出**，于是"翻月时页面没跟着滚"
//     会因为"没东西可滚"而永远成立 —— 一条测不出假的判据不如没有。
test.use({ viewport: { width: 1280, height: 600 } });

const STAMP = Date.now().toString().slice(-6);
const MONTH_CARD = '[data-testid="calendar-board-month-card"]';
const BOARD_MONTH = '[data-testid="calendar-toolbar-month"]';
const MINI_TITLE = '[data-testid="calendar-mini-title"]';

/**
 * 🔴 必须带 `?lang=zh-CN`：这一屏的定位符（placeholder「添加任务」、标签「日历」、
 * aria-label「完成：…」）全是中文，而 2026-10-01 起首启语言第 3 层问
 * `navigator.language`（Playwright = en-US）⇒ 不钉就是英文界面，定位符全落空。
 */
const APP_ZH = '/?lang=zh-CN';

/** 一条到期于今天的任务，保证月格中存在可读的任务条。 */
async function seed(page: Page): Promise<void> {
  await openApp(page, APP_ZH);
  const composer = page.locator('input[placeholder^="添加任务"]');
  // 6 条：把这一屏撑过视口（A/B 前提之一）。
  for (let i = 0; i < 6; i += 1) {
    await composer.fill(`今天 滚轮-${i}-${STAMP}`);
    await composer.press('Enter');
    await expect(page.getByRole('checkbox', { name: `完成：滚轮-${i}-${STAMP}` })).toBeVisible();
  }
  await page.getByRole('tab', { name: '日历' }).click();
  await expect(page.locator(MONTH_CARD)).toBeVisible();
}

/**
 * 把指针放到某个元素**内部**，并返回那个点。
 *
 * 🔴 这一屏在 600px 高的视口下月历与页脚可能超出一屏。Chromium 对落在视口外的
 *    滚轮事件会走合成线程直接滚文档，根本不派发到主线程，所以命中测试必须先
 *    把靶子滚进视口。
 *
 * 所以这里做三件事：① 先把靶子滚进视口；② 取一个**保证在视口内**的点；
 * ③ 用 `elementFromPoint` 反查那个点**真的命中靶子**，不命中就直接判红 ——
 *    否则"滚了"可能是滚在别的元素上，A/B 的前提就没了。
 */
async function pointInside(page: Page, sel: string): Promise<{ x: number; y: number }> {
  const target = page.locator(sel);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box, `靶子不存在：${sel}`).not.toBeNull();
  const viewport = page.viewportSize();
  const maxY = (viewport?.height ?? 720) - 8;
  const minY = 8;
  const y = Math.min(Math.max(box!.y + Math.min(40, box!.height / 2), minY), maxY);
  const x = box!.x + box!.width / 2;
  const hit = await page.evaluate(
    ([px, py, selector]) => {
      const at = document.elementFromPoint(px, py);
      const want = document.querySelector(selector);
      return {
        hit: at !== null,
        inside: at !== null && want !== null && (want === at || want.contains(at) || at.contains(want)),
      };
    },
    [x, y, sel] as [number, number, string],
  );
  expect(hit.hit, `(${String(x)}, ${String(y)}) 上没有任何元素（点跑到视口外了？）`).toBe(true);
  expect(
    hit.inside,
    `(${String(x)}, ${String(y)}) 命中的不是 ${sel} 的子树 —— 滚轮会落在别人身上，A/B 的前提不成立`,
  ).toBe(true);
  return { x, y };
}

/** 在 window 冒泡阶段读回 `defaultPrevented`（监听器挂在 host **之后**收到事件的一侧）。 */
async function armPreventedProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __wheel: unknown[] }).__wheel = [];
    window.addEventListener(
      'wheel',
      (event) => {
        (window as unknown as { __wheel: unknown[] }).__wheel.push({
          prevented: event.defaultPrevented,
          deltaY: event.deltaY,
        });
      },
      false,
    );
  });
}

async function lastPrevented(page: Page): Promise<boolean | null> {
  return page.evaluate(
    () =>
      ((window as unknown as { __wheel?: { prevented: boolean }[] }).__wheel ?? []).at(-1)
        ?.prevented ?? null,
  );
}

async function monthText(page: Page): Promise<string> {
  return (await page.locator(BOARD_MONTH).textContent())?.trim() ?? '';
}

test('滚轮归月历：指针在格子上滚翻月，月历之外的滚轮让给页面', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  await seed(page);
  await armPreventedProbe(page);

  const before = await monthText(page);
  await page.screenshot({ path: 'test-results/calendar-wheel-before.png' });

  // ── ① 月历之外的区域让出滚轮（当前月档的稳定命中点是页脚） ──
  const footnotePoint = await pointInside(page, '[data-testid="calendar-board-footnote"]');
  await page.mouse.move(footnotePoint.x, footnotePoint.y);
  await page.mouse.wheel(0, 240);
  expect(await lastPrevented(page), '月历之外的滚轮不应被月历吃掉').toBe(false);

  // ── ② 指针移到月历格子：翻月而**不把事件交给页面** ──
  const cardPoint = await pointInside(page, MONTH_CARD);
  await page.mouse.move(cardPoint.x, cardPoint.y);
  await page.mouse.wheel(0, 240);

  const after = await monthText(page);
  expect(after, `下滚一格必须翻到**下一个**月（起点 ${before}）`).not.toBe(before);
  expect(await lastPrevented(page), '月历上的滚轮必须被吃掉，否则页面会同时滚走').toBe(true);
  expect(
    await page.locator(MINI_TITLE).textContent(),
    '侧栏迷你月历必须跟着走同一个 cursor',
  ).toContain(after.slice(0, 5));
  await page.screenshot({ path: 'test-results/calendar-wheel-after.png' });

  // ── ③ 一格只翻一个月：连发三次（触控板惯性形状）也只 +1 ──
  const oneMonth = after;
  await page.mouse.wheel(0, 120);
  await page.mouse.wheel(0, 90);
  await page.mouse.wheel(0, 60);
  expect(await monthText(page), '惯性尾巴必须被锁定期吃掉，不能攒成连翻').toBe(oneMonth);

  // ── ④ 横向手势（触控板两指横滑）让出去：不翻月、也不吃 ──
  await page.mouse.move(cardPoint.x, cardPoint.y);
  await page.mouse.wheel(400, 40);
  expect(await monthText(page), '横向手势不是"上下滑动切月"').toBe(oneMonth);
  expect(await lastPrevented(page), '横向手势不属于月历').toBe(false);

  // ── ⑤ 上滚回到起点（方向是两条相反的判据，不是一条的逆） ──
  await page.waitForTimeout(300);
  await page.mouse.wheel(0, -240);
  expect(await monthText(page), '上滚 = 上一月').toBe(before);

  const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  expect(errors, `控制台有报错：\n${errors.join('\n')}`).toHaveLength(0);
});

test('prefers-reduced-motion：滚轮照旧翻月，月历卡片不带任何动画', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seed(page);

  const motion = await page.locator(MONTH_CARD).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { animationName: cs.animationName, transition: cs.transitionProperty };
  });
  expect(motion.animationName, '翻月是换数据，不许挂动画').toBe('none');
  expect(motion.transition, `月历卡片不许有 transform 类过渡：${motion.transition}`).not.toContain(
    'transform',
  );

  const before = await monthText(page);
  const box = await page.locator(MONTH_CARD).boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, 240);
  expect(await monthText(page), '降低动效不是降低功能').not.toBe(before);
  await page.screenshot({ path: 'test-results/calendar-wheel-reduced.png' });
});
