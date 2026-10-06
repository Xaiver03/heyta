import { expect, test } from '@playwright/test';
import {
  openApp,
  switchTheme,
  switchView,
} from './helpers';

/**
 * R1 判据 · 任务行的勾选框：**命中区是一条真实的尺寸声明，而且没被裁**。
 *
 * 两条各自挡一种坏法（缺一条就会假绿）：
 *
 * · **命中区 ≥ `touch-target.min`** —— 改之前 `checkboxHit` 只有
 *   `marginLeft: -(44-22)/2`，**没有任何 width/height**，所以注释里承诺的 44
 *   在盒模型上根本不存在（类 A）。只测"没被裁"会放过它：圈完整了，可点的还是那 22px。
 * · **`margin-left` 必须是 `0px`，且命中区左边不得越过所在行的左边** ——
 *   负边距把圈推到裁剪祖先（RNW `ScrollView` ⇒ `overflow-x: hidden`）之外，
 *   实测正好切掉一半（类 B）。这条专门挡"把负边距调小到肉眼看不见"那种假修法。
 *
 * 🔴 阈值**全部从 token 推导**（读 `:root` 上的 CSS 变量再换算成 px），
 * 不在这里写 44 / 22 —— 写死的阈值挡不住"把 token 改了而判据还绿"。
 *
 * ⚠️ 载体：**桌面载荷**（真 Chromium + 真 DOM 盒模型）。RN 侧同一份共享层由
 * `scripts/verify-mobile-task-row.sh` 在真模拟器上验，两边不互相冒充。
 */

// 🔴 证据**不落在 `e2e/test-results/`**：那是 Playwright 每次运行开头会清空的目录，
// 而这条工作树上有并发会话在跑自己的套件 —— 实测过一次，我唯一的四张图被它们删掉。
const SHOT = (name: string) => `../apps/web/evidence/task-row-touch-target/${name}.png`;

/** 长标题：中文可逐字断行，用来量"命中区还在不在行内"。 */
const LONG =
  '把这条任务的标题写得很长很长，长到足以检验它在行里会不会把左边的勾选框挤扁，或者把整行撑出容器之外';
/**
 * 不可断的长 token（URL / 英文单词）。它原本是为 `body` 上的 `minWidth: 0` 准备的
 * 测试面 —— **那个假设已被实测证伪**：删掉那一行后 body 仍计算为 `min-width: 0px`
 * （RNW 的 `flex: 1` 自己就把 min-width 归零），行的 `scrollWidth == clientWidth == 359`
 * 两种状态完全一样，变异 m3 不红。⇒ 修法与那条只看撑宽的断言一起删掉了。
 * 这一行**留着**，因为它还在测另一件事：标题里有一个断不开的东西时，勾选框的命中区
 * 仍然要完整、仍然要在行内（长内容把行撑宽之后，左边距判据才真正有牙齿）。
 */
const UNBREAK = '看这个链接 https://heyta.example.com/a-very-long-unbreakable-path-segment-that-nobody-would-ever-type';

interface Probe {
  hit: { left: number; top: number; w: number; h: number };
  circle: { left: number; w: number; h: number };
  marginLeft: string;
  rowLeft: number;
  minPx: number;
  boxPx: number;
  aria: string;
}

/**
 * ⚠️ 这个函数**必须在浏览器里自包含**：Playwright 序列化只带函数自身源码，
 * 引用模块作用域的外层函数/常量会得到 `undefined`（实测踩过）。
 */
function probeToggle(el: Element): Probe {
  const rect = (n: Element) => {
    const b = n.getBoundingClientRect();
    return { left: +b.left.toFixed(2), top: +b.top.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) };
  };
  const root = getComputedStyle(document.documentElement);
  const rootPx = parseFloat(getComputedStyle(document.body).fontSize) || 16;
  // 只认 rem / px 两种写法 —— 别的单位说明 token 变了形状，判据要**响**而不是猜。
  const toPx = (v: string): number => {
    const n = parseFloat(v);
    if (!Number.isFinite(n)) throw new Error(`token 不是数字: ${JSON.stringify(v)}`);
    if (v.trim().endsWith('rem')) return n * rootPx;
    if (v.trim().endsWith('px')) return n;
    throw new Error(`token 单位不认识: ${JSON.stringify(v)}`);
  };
  const row = el.closest('[data-testid^="task-item-"]') ?? el;
  const circle = el.firstElementChild;
  if (!circle) throw new Error('勾选框里没有视觉标记那一层');
  return {
    hit: rect(el),
    circle: rect(circle),
    marginLeft: getComputedStyle(el).marginLeft,
    rowLeft: +row.getBoundingClientRect().left.toFixed(2),
    // 行自己的"内容宽 vs 盒子宽"：`body` 缺 `minWidth: 0` 时长标题会把行撑宽
    // （弹性盒 §4.5：`min-width: auto` 的内容下限）。这是那条修法**唯一**的判据面 ——
    // Yoga 没有 auto-min-size，所以 RN 原生上根本不会出现这个症状，不在移动端判。
    rowScrollW: Math.round(row.scrollWidth),
    rowClientW: Math.round(row.clientWidth),
    minPx: toPx(root.getPropertyValue('--ht-touch-target-min')),
    boxPx: toPx(root.getPropertyValue('--ht-size-checkbox')),
    aria: el.getAttribute('aria-label') || '',
  };
}

async function measureFirst(
  page: import('@playwright/test').Page,
  scope: string,
): Promise<Probe> {
  const toggle = page.locator(`${scope} [data-testid^="task-toggle-"]`).first();
  await expect(toggle).toBeVisible();
  return toggle.evaluate(probeToggle);
}

function assertNotClipped(p: Probe, where: string): void {
  // 阈值全部来自 token：命中区下限 = touch-target.min，视觉圈 = size.checkbox。
  expect(p.minPx, `${where}：token 读不出来`).toBeGreaterThan(0);
  expect(p.hit.w, `${where}：命中区宽度 ${p.hit.w} < ${p.minPx}（"圈完整"不等于"点得中"）`).toBeGreaterThanOrEqual(
    p.minPx - 0.5,
  );
  expect(p.hit.h, `${where}：命中区高度 ${p.hit.h} < ${p.minPx}`).toBeGreaterThanOrEqual(p.minPx - 0.5);
  expect(p.marginLeft, `${where}：还在用负边距借位（${p.marginLeft}）`).toBe('0px');
  expect(
    p.hit.left,
    `${where}：命中区左边 ${p.hit.left} 越过了行的左边 ${p.rowLeft} —— 又落进裁剪区了`,
  ).toBeGreaterThanOrEqual(p.rowLeft - 0.5);
  // 圈仍然是那个圈，而且**在命中区里居中**（居中 = 两侧留白相等，用差值断言，不靠"看起来对"）。
  expect(p.circle.w, `${where}：视觉圈宽 ${p.circle.w} != ${p.boxPx}`).toBeCloseTo(p.boxPx, 1);
  expect(p.circle.h, `${where}：视觉圈高 ${p.circle.h} != ${p.boxPx}`).toBeCloseTo(p.boxPx, 1);
  expect(
    p.circle.left - p.hit.left,
    `${where}：圈没在命中区里居中`,
  ).toBeCloseTo((p.hit.w - p.circle.w) / 2, 1);
}

test.describe('R1 · 勾选框命中区与不被裁（桌面载荷）', () => {
  test('任务列表 / 四象限 / 时间线 三处都过，长标题那一行也算', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));

    // 首启隐私同意面板由 `openApp` 做完（真点「只用本机」，不塞 localStorage）：
    // 它是 `position: fixed; inset: 0` 的整屏遮罩，**rail 也在它底下** ——
    // 不做完这一步，后面每一次 `click()` 都会卡在"…intercepts pointer events"直到超时。
    await openApp(page, '/');
    const add = async (text: string): Promise<void> => {
      const before = await page.locator('[data-testid^="task-item-"]').count();
      const composer = page.locator('input[placeholder^="添加任务"]');
      await composer.fill(text);
      await composer.press('Enter');
      await expect
        .poll(() => page.locator('[data-testid^="task-item-"]').count(), { timeout: 15_000 })
        .toBeGreaterThan(before);
    };
    await add(LONG);
    await add(UNBREAK);
    await add('短标题');
    // 时间线板只画**有时刻**的行（`TimelineBoard` 无数据时是 `timeline-view-empty`），
    // 所以第三条走真实的自然语言日期入口（输入框占位文案里就写着「明天」）。
    await add('带截止的任务 明天');

    // ── 先截图，再断言（失败时也要有图，§6.2 规定一）
    await page.screenshot({ path: SHOT('tasks-light'), fullPage: false });
    assertNotClipped(await measureFirst(page, 'body'), '任务列表');

    // 不可断的长 token 那一行：`body` 缺 `minWidth: 0` 时是它把行撑宽。
    const longRow = page.locator(`[data-testid^="task-item-"]:has-text("${UNBREAK.slice(0, 12)}")`);
    const longProbe = await longRow
      .locator('[data-testid^="task-toggle-"]')
      .first()
      .evaluate(probeToggle);
    assertNotClipped(longProbe, '任务列表·长 token 行');

    await switchView(page, '四象限');
    await expect(page.getByTestId(/^quadrant-cell-/).first()).toBeVisible();
    await page.screenshot({ path: SHOT('quadrant-light') });
    assertNotClipped(
      await measureFirst(page, '[data-testid^="quadrant-cell-"]'),
      '四象限格内',
    );

    await switchView(page, '时间线');
    await page.waitForTimeout(600);
    await page.screenshot({ path: SHOT('timeline-light') });
    // 🔴 2026-10-01 时间线重画（goal：docs/plans/goal-timeline-rework.md）：
    // 板上不再渲染 TaskRow（行 = 任务头 + 轨道上的菱形，没有任何勾选框）——
    // 这一处探针的**消失是设计使然**，不是回退。R1 的判据面因此收窄为
    // 任务列表 + 四象限（仍渲染 TaskRow 的两个面）；时间线这一腿留下的是
    // 新板自己的锚点判据：视图在场且画出了行。
    await expect(page.getByTestId('timeline-view')).toBeVisible();
    // 板子有**两种排布**：有时刻的行（`timeline-row-*`）和"未排期"泳道
    // （`timeline-lane-item-*`，`TimelineBoard.tsx:266` / `:367`）。只认前一种会把
    // 后者当成"没画出来" —— 实测这一轮三条任务全落进未排期泳道，其中一条在任务
    // 视图里明明带着 10-02 的日期片。⚠️ 时间线排程**此刻正在另一条会话手里改**
    // （`packages/app-host/src/timeline-plan.ts` 的 mtime 就是本次运行前两分钟），
    // 所以这里只登记观测、不下因果结论，判据收窄为"板子画出了东西"。
    // R4 的归属与这条观测一起记在 `docs/plans/ui-review-fill-zh-timeline.md`。
    await expect(page.getByTestId(/^timeline-(row|lane-item)-/).first()).toBeVisible();

    // ── 暗色不是亮色的反相（§5）：勾选框的边框色/填充色都要真的看过
    await switchView(page, '任务');
    await switchTheme(page, 'dark');
    // 🔴 等过渡落位再按快门：主题切换后**立刻**截，行尾那排 chip 会拍成空心灰块
    // （文字还没画上）—— 实测一次，据此差点登记成一个不存在的暗色缺陷。
    // 判据量的是盒模型（不受影响），但**图是给人看的证据**，糊的证据比没证据更糟。
    await page.waitForTimeout(1200);
    await page.screenshot({ path: SHOT('tasks-dark') });
    assertNotClipped(await measureFirst(page, 'body'), '任务列表·暗色');

    expect(errors, `控制台报错：\n${errors.join('\n')}`).toEqual([]);
  });
});
