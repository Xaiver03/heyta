import { expect, test, type Locator, type Page } from '@playwright/test';
import { openApp, switchView } from './helpers';

/**
 * 三枚菜单走同一套键盘模型（全局 UX 线 P5）
 * ==========================================
 *
 * 判断住在 `packages/ui/src/control/menu.ts`（34 条契约测 + 六枚变异取证钉住它），
 * 这一份证的是**接线**：三枚菜单在真浏览器里按同一串键，必须得到同一个结果。
 *
 * 立项现量是三枚菜单**四种**答案（账号菜单一套完整的 / rail 的 More 只接 Escape /
 * 习惯的 More 一条没接、却挂了一条 `document` 上的 Escape）。
 * 那种"各写一份"的缺陷，源码尺只能判"有没有接同一枚钩子"（`check:menu-keyboard`），
 * **按下去到底发生什么**只有真浏览器知道 —— 所以这里逐枚走同一条序列。
 *
 * ⚠️ 每条断言都读"焦点在哪一项"，而不是"有没有报错"。
 *    焦点类断言用 `toBeFocused()` 而不是 `getAttribute('tabindex')`：后者只证形状，不证焦点真的进来了。
 */

interface MenuRig {
  readonly name: string;
  readonly open: (page: Page) => Promise<void>;
  readonly trigger: (page: Page) => Locator;
  readonly menu: (page: Page) => Locator;
  /** 这一枚要不要先切到某个视图。 */
  readonly view?: string;
}

const MENUS: readonly MenuRig[] = [
  {
    name: '账号菜单',
    trigger: (page) => page.getByTestId('account-menu-avatar'),
    menu: (page) => page.getByTestId('account-menu-panel'),
    open: async (page) => {
      await page.getByTestId('account-menu-avatar').click();
    },
  },
  {
    name: 'rail 的 More',
    trigger: (page) => page.locator('.ht-rail__more button[aria-haspopup="menu"]'),
    menu: (page) => page.locator('.ht-rail__more-menu'),
    open: async (page) => {
      await page.locator('.ht-rail__more button[aria-haspopup="menu"]').click();
    },
  },
  {
    name: '习惯的 More',
    view: '习惯',
    trigger: (page) => page.getByTestId('habits-more'),
    menu: (page) => page.getByTestId('habits-menu'),
    open: async (page) => {
      await page.getByTestId('habits-more').click();
    },
  },
];

const itemsOf = (menu: Locator): Locator => menu.locator('[role="menuitem"]');

async function focusIndex(menu: Locator): Promise<number> {
  const items = await itemsOf(menu).all();
  for (const [i, item] of items.entries()) {
    if (await item.evaluate((el) => el === document.activeElement)) return i;
  }
  return -1;
}

for (const rig of MENUS) {
  test.describe(`P5 菜单键盘模型：${rig.name}`, () => {
    test('焦点进入 → 环游（含首尾环绕）→ Home/End → Esc 归还 → Tab 走人即收起', async ({ page }) => {
      await openApp(page);
      if (rig.view !== undefined) await switchView(page, rig.view);
      const trigger = rig.trigger(page);
      await expect(trigger, `${rig.name}的触发者没画出来 ⇒ 后面全部读数作废`).toBeVisible();

      await rig.open(page);
      const menu = rig.menu(page);
      await expect(menu).toBeVisible();
      const items = itemsOf(menu);
      const count = await items.count();
      expect(count, `${rig.name} 里一枚菜单项都没有 ⇒ 这一格又没人量了`).toBeGreaterThan(0);

      // 1) 焦点进入：打开即落在第一项（不是留在触发者上）。
      await expect(items.first(), '打开后焦点没进第一项 ⇒ 方向键会去滚页面').toBeFocused();

      // 2) 每一项都不是 Tab 停靠点（`check:menu-keyboard` 的 M2 判源码，这里判渲染出来的属性）。
      for (let i = 0; i < count; i += 1) {
        await expect(items.nth(i), `第 ${i} 项的 tabindex 不是 -1 ⇒ Tab 会走出菜单而它仍开着`).toHaveAttribute(
          'tabindex',
          '-1',
        );
      }

      // 3) 向下走一格；单项菜单停在第 0 项（环绕在 n=1 时就是自己）。
      await page.keyboard.press('ArrowDown');
      await expect(items.nth(Math.min(1, count - 1)), 'ArrowDown 没有把焦点送到下一项').toBeFocused();

      // 4) 从末项向下 ⇒ 环绕回第一项。
      await page.keyboard.press('End');
      await expect(items.nth(count - 1), 'End 没到最后一项').toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(items.nth(0), '末项向下没环绕到第一项').toBeFocused();

      // 5) 从首项向上 ⇒ 环绕到最后一项（这一格是共享判断里唯一不对称的那处）。
      await page.keyboard.press('ArrowUp');
      await expect(items.nth(count - 1), '首项向上没环绕到最后一项').toBeFocused();

      // 6) Home ⇒ 第一项。
      await page.keyboard.press('Home');
      await expect(items.nth(0), 'Home 没回到第一项').toBeFocused();

      // 7) 类型查找：敲最后一项文案的第一个字，焦点必须落在以它开头的那一项。
      const wanted = ((await items.nth(count - 1).textContent()) ?? '').trim();
      const firstChar = [...wanted][0] ?? '';
      const targetIndex = await items.evaluateAll((nodes, char) => {
        const labels = nodes.map((node) => (node.textContent ?? '').trim());
        return labels.findIndex((label) => label.startsWith(char));
      }, firstChar);
      /**
       * 🔴 这一格不能用 `page.keyboard.press(firstChar)`：Playwright 的 `press`
       * 只认它自己那张键名表，中文（以及任何非 ASCII 单字符）直接
       * `Unknown key: "应"` —— 三枚菜单第一次跑就是全部红在这里，
       * 而**红的是装置不是实现**（前面六步都过了）。
       * 界面是中文的，类型查找按的就是中文首字 ⇒ 只能派发一枚真 `keydown`
       * （`bubbles: true` 让它冒到挂着 `onKeyDown` 的那层，React 收得到）。
       */
      await items.nth(Math.max(targetIndex - 1, 0)).evaluate((node, char) => {
        (document.activeElement ?? node).dispatchEvent(
          new KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true }),
        );
      }, firstChar);
      if (targetIndex >= 0) {
        await expect(items.nth(targetIndex), `敲「${firstChar}」没落在以它开头的第 ${targetIndex} 项`).toBeFocused();
      }

      // 8) Esc ⇒ 关掉，且焦点**回到触发者**。
      await page.keyboard.press('Escape');
      await expect(menu, 'Esc 没关掉菜单').toBeHidden();
      await expect(trigger, 'Esc 之后焦点没还给触发者').toBeFocused();

      // 9) Tab ⇒ 关掉，但焦点**不回**触发者（用户要走人是往前的方向，拽回来是第三份答案）。
      await rig.open(page);
      await expect(menu).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(menu, 'Tab 离开后菜单还开着 ⇒ "看不见却开着"那一格').toBeHidden();
      /*
       * ⚠️ 这一条**不在这里判**"焦点有没有被拽回触发者"：
       * 账号菜单的面板是 `createPortal` 到 `body` 末尾的，Tab 走到面板最后一项时
       * 浏览器的顺序导航本来就会环绕回文档开头 —— 那枚触发者正好在那儿。
       * 换句话说 e2e 在这里分不开"浏览器环绕"与"我们主动 focus()"。
       * 那一格改由 jsdom 契约测精确钉（`apps/web/tests/menu-keyboard-hook.spec.tsx`：
       * Tab ⇒ `trigger.focus` 一次都不许被调用；Esc ⇒ 恰好一次）。
       */
      // 用一次 `page.evaluate` 读，而不是 `items.first().evaluate(...)`：
      // 面板已经关掉，locator 会一直等到超时（实测 60s）——那是装置在等一个不存在的东西。
      const roleAfterTab = await page.evaluate(() => document.activeElement?.getAttribute('role') ?? '');
      expect(roleAfterTab, 'Tab 之后焦点仍停在菜单项上 ⇒ 默认行为被拦住了').not.toBe('menuitem');
    });
  });
}
