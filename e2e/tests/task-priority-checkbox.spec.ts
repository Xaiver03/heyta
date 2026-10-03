/**
 * W5 · 复选框描边即优先级（真浏览器层）
 * ======================================
 *
 * 工单（`docs/plans/detail-pane-alignment.md` W5）原话：
 *
 * > 优先级不同的任务，复选框描边色**互不相同且等于该优先级的既有颜色 token**；
 * > ⚠️ **暗色主题必须实际切了看**。
 *
 * 映射本身（档位 → token 名、取值互不相同、暗色覆盖齐全）的判据在
 * `packages/ui/tests/task-row-priority.spec.ts`。那一份是 node 层的，
 * 它**证明不了描边真的画到了那个圈上** —— 本文件补的就是这一层。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 三条不显然的做法
 *
 * 1. **色值不抄进测试**：期望值由页内探针把 `var(--ht-color-priority-high)`
 *    解析成浏览器自己的 `rgb()`（`colorOfCssVar`）。抄一遍 hex 就等于把 token
 *    的当前值写死进判据 —— 改 token 的人不会被告知这里有一条（§7 元规则 2）。
 * 2. **载体自己带前提**：优先级是通过**真的在捕获框里打 `!1`** 写进去的
 *    （`packages/domain/src/capture.ts` 的 `!\s*([1-4])`）。如果那个标记没被解析，
 *    四条描边会全是"无优先级"色，而两两不同的判据会红得像产品坏了 ——
 *    所以每条先断**徽章在场**（「高优先级」那句文案），它证明的才是"优先级真写进去了"。
 * 3. **暗色那一档带正对照**：先断 `<html data-theme>` 真的是 `dark`。
 *    `applyTheme` 刻意不写盘（`apps/web/src/lib/theme.ts` 文件头那条实测缺陷），
 *    如果启动时读不到 localStorage，"暗色截图"会是一张亮色图而判据照样绿。
 *
 * ⚠️ 这条判据**改了视觉**，所以本文件里不许出现"改前后逐字节相同"那类零视觉断言
 *    （工单 §W5 的警告）。预期差在哪写在下面 `CASES` 的注释与 §8 落地记录里。
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { openApp, parkCursor, rowFor } from './helpers';

const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/task-priority-checkbox/${name}.png`, import.meta.url));

/**
 * 🔴 本套件自己把视口加高到 1000。
 *
 * 默认 720 高的那张图里**只有三行**（第四行"无优先级"在折叠线下面），
 * 而判据量的是四行 —— 图与读数不对齐的证据等于没有证据（§6.2 规定一：
 * 人要看的那张图必须真的包含被断言的那四行）。
 * 首屏被 AI 面板占了半屏是 `enableAllModules` 的结果，不是缺陷。
 */
test.use({ viewport: { width: 1280, height: 1000 } });

/** 每轮一个唯一后缀：IndexedDB 在本套件里不是每次全新的，撞标题会让 `has-text` 命中两行。 */
const STAMP = Date.now().toString().slice(-6);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  return errors;
}

/**
 * 把一个设计 token 在本页当前主题下解析成浏览器自己的颜色字符串。
 *
 * 🔴 探针必须**挂在文档上**再量：分离节点的 `getComputedStyle` 在 Chromium 里
 * 返回空串（W1 那次实测），而空串一旦被当成"值"去比，不相等判据就恒真了。
 * 拿回空串时这里**直接抛**，不留那条静默的通路。
 */
async function colorOfCssVar(page: Page, name: string): Promise<string> {
  const value = await page.evaluate((varName) => {
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.color = `var(${varName})`;
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return computed;
  }, name);
  expect(value, `页面算不出 ${name} —— 那个 token 不存在或没被当前主题覆盖`).not.toBe('');
  return value;
}

/** 取某一行勾选框的**实际描边色**（存在性先于取值）。 */
async function boxBorderColor(page: Page, title: string): Promise<string> {
  const box = rowFor(page, title).locator('[data-testid^="task-box-"]');
  await expect(box, `${title} 那一行的勾选框不止一个或根本不在`).toHaveCount(1);
  return box.evaluate((node) => getComputedStyle(node).borderTopColor);
}

/**
 * 四档：捕获框里真打的标记 → 期望的 token → 界面上该有的徽章文字。
 *
 * 标记来自 `packages/domain/src/capture.ts` 的 `PRIORITY_BY_NUMBER`
 * （`!1`=高 / `!2`=中 / `!3`=低），`!4` 与"什么也没写"都是无优先级，
 * 后者单独留一档，因为它验的是**字段缺失**（`Task.priority` 是可选的）。
 *
 * 🔴 标题里**不许**出现 `!` 或 `p1`…`p4`：那两种写法本身就是优先级标记，
 * 被采纳的片段会从标题里**删掉**（`capture.ts:508-522`），标题就对不上行了。
 * 形状照 `calendar-cells.spec.ts` 的 `日历格-${i}-${STAMP}`（实测安全）。
 */
const CASES = [
  { key: 'high', mark: '!1', token: '--ht-color-priority-high', badge: '高优先级' },
  { key: 'medium', mark: '!2', token: '--ht-color-priority-medium', badge: '中优先级' },
  { key: 'low', mark: '!3', token: '--ht-color-priority-low', badge: '低优先级' },
  // 无标记那一档：`badge: null`，同时它就是"字段缺失"这一腿。
  { key: 'none', mark: '', token: '--ht-color-priority-none', badge: null },
].map((c) => ({ ...c, title: `描边优先级-${c.key}-${STAMP}` }));

/**
 * 按档位名取那一行。
 *
 * ⚠️ 不用 `CASES[0]`：那个下标读起来像"随便哪一行"，而完成态那条用例要的**就是**
 * 有优先级的那一行 —— 名字写出来，换档位时不会悄悄换掉被测的东西。
 */
const BY_KEY = Object.fromEntries(CASES.map((c) => [c.key, c])) as Record<
  (typeof CASES)[number]['key'],
  (typeof CASES)[number]
>;

async function addFour(page: Page): Promise<void> {
  const composer = page.locator('input[placeholder^="添加任务"]');
  for (const c of CASES) {
    const before = await page.locator('[data-testid^="task-item-"]').count();
    await composer.fill(`${c.title} ${c.mark}`.trim());
    await composer.press('Enter');
    await expect
      .poll(() => page.locator('[data-testid^="task-item-"]').count(), { timeout: 15_000 })
      .toBeGreaterThan(before);
  }
}

test('四档描边各归其色、两两不同，且等于该档 token 在当前主题下的取值', async ({ page }) => {
  const errors = watchErrors(page);
  await openApp(page, '/?lang=zh-CN');
  await addFour(page);

  // ── 先截图，再断言（失败时也要有图，§6.2 规定一）
  await parkCursor(page);
  await page.screenshot({ path: SHOT('light-four-tiers') });

  // 🔴 载体前提：优先级必须**真的写进去了**。徽章文案由宿主经 i18n 给，
  //    它和描边色是两条独立的路 —— 徽在而色不对 = 产品坏了；
  //    徽都不在 = 我这个载体没成立，不能拿去判产品。
  for (const c of CASES) {
    if (c.badge === null) continue;
    await expect
      .poll(async () => (await rowFor(page, c.title).innerText()).includes(c.badge), {
        message: `${c.mark} 没被解析成 ${c.badge} —— 载体没成立，描边的读数无效`,
      })
      .toBe(true);
  }

  const seen = new Map<string, string>();
  for (const c of CASES) {
    const expected = await colorOfCssVar(page, c.token);
    const actual = await boxBorderColor(page, c.title);
    expect(actual, `${c.mark || '（无标记）'} 的描边 ${actual} != ${c.token}=${expected}`).toBe(
      expected,
    );
    seen.set(c.title, actual);
  }

  // 工单那句"互不相同"在界面层的读数：四行两两不等。
  for (const [left, leftColor] of seen) {
    for (const [right, rightColor] of seen) {
      if (left === right) continue;
      expect(leftColor, `${left} 与 ${right} 描边同色`).not.toBe(rightColor);
    }
  }

  expect(errors, `控制台有报错：${errors.join('\n')}`).toEqual([]);
});

test('🔴 完成态压过优先级：勾掉之后描边回到主色', async ({ page }) => {
  const errors = watchErrors(page);
  await openApp(page, '/?lang=zh-CN');
  await addFour(page);

  const high = BY_KEY.high;
  await rowFor(page, high.title).getByRole('checkbox', { name: `完成：${high.title}` }).click();
  /**
   * 🔴 勾掉之后这一条**离开收集箱**了 —— 失败快照实测：主区只剩「无截止时间 3」，
   * 那条已完成的在侧栏的「已完成 1」范围里。不点进去就断言，
   * `expect.poll` 里那条 `toHaveCount(1)` 会一直重试到超时，
   * 报错写的是"描边没变成主色"，而真相是"这一行不在这儿" ——
   * 一个会让人去改产品的假红。先点范围、再确认行在场，读数才指得到那圈描边。
   */
  await page.getByRole('button', { name: /^已完成/ }).click();
  await expect(rowFor(page, high.title), '点进已完成范围后仍找不到那一行').toBeVisible();

  const primary = await colorOfCssVar(page, '--ht-color-primary');
  await expect
    .poll(() => boxBorderColor(page, high.title), {
      message: '完成后描边没变成主色 —— 优先级把"做完了没有"这个更要紧的判断盖掉了',
    })
    .toBe(primary);

  await parkCursor(page);
  await page.screenshot({ path: SHOT('light-done-overrides-priority') });
  expect(errors, `控制台有报错：${errors.join('\n')}`).toEqual([]);
});

test('暗色主题实际切了看：四档在 dark 下同样各归其色、互不相同', async ({ page }) => {
  const errors = watchErrors(page);
  // 主题必须在导航**之前**种进去 —— 应用启动时从 `heyta.theme` 读一次
  // （`apps/web/src/lib/theme.ts`），导航后再写就只影响下一次启动。
  await page.addInitScript(() => {
    window.localStorage.setItem('heyta.theme', 'dark');
  });
  await openApp(page, '/?lang=zh-CN');
  await addFour(page);

  // 🔴 正对照：暗色真的生效了。没有这一条，"暗色截图"可能是一张亮色图。
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['theme'] ?? ''), {
      message: '界面没有切到暗色（data-theme != dark）—— 下面所有读数都是亮色的',
    })
    .toBe('dark');

  await parkCursor(page);
  await page.screenshot({ path: SHOT('dark-four-tiers') });

  for (const c of CASES) {
    const expected = await colorOfCssVar(page, c.token);
    const actual = await boxBorderColor(page, c.title);
    expect(actual, `暗色下 ${c.mark || '（无标记）'} 的描边 ${actual} != ${expected}`).toBe(expected);
  }

  const colors = CASES.map((c) => c.token);
  const resolved = new Map<string, string>();
  for (const token of colors) resolved.set(token, await colorOfCssVar(page, token));
  for (const [left, leftColor] of resolved) {
    for (const [right, rightColor] of resolved) {
      if (left === right) continue;
      expect(leftColor, `暗色下 ${left} 与 ${right} 同色`).not.toBe(rightColor);
    }
  }

  expect(errors, `控制台有报错：${errors.join('\n')}`).toEqual([]);
});
