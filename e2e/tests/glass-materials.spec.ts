import { expect, test } from '@playwright/test';
import { openApp, switchView } from './helpers';

/**
 * 🔴 玻璃材质三态验收（ADR-0042 / P1）—— 只有真浏览器能证的那一半
 * =================================================================
 *
 * 覆盖 P1 落地后**现存的四个悬浮功能层**：
 *   搜索浮层（chrome 档，共享层 tint + 宿主 blur）
 *   账号菜单 / 通知面板 / 任务行右键菜单（panel 档）
 *
 * 🔴 **数量从五降到四，是覆盖面跟着界面走，不是删判据**（2026-11 行操作 UX 重设计）：
 *   原来第三、四、五腿钉的是「清单+标签下拉」与「提醒下拉」（中间那腿曾由「重复」换成
 *   「提醒」，换的理由写在旧注释里）。这一轮把**行尾那一排字段编辑器整排删了** ——
 *   编辑器唯一所有者是 `TaskDetailCard`，而栏里那几格是**在流内**的
 *   （`TaskDetailCard.tsx:379/401/420/493` 逐条写着"这一格里没有 `<details>`、
 *   没有 Portal、也没有 `.ht-material`"）。三个行尾浮层外壳（`TaskOrganizer` /
 *   `ReminderPanel` / `TaskRepeat`）**不再被 `App.tsx` 渲染**：
 *   现量 `grep -rn '<TaskOrganizer\|<ReminderPanel\|<TaskRepeat' apps/web/src` = 0 / 0 / 0，
 *   于是 `[data-testid="task-organize-summary"]` 与 `details.ht-compose--popover`
 *   在真界面上各 0 枚 —— 那两腿只能一路等到 60 秒超时（2026-11-04 那趟的首个错误
 *   正是 `locator('[data-testid="task-organize-summary"]').first()` 的 click 超时）。
 *   ⇒ 行内弹出层的位置由这一轮**新加的那一枚**接住：任务行右键菜单
 *   （`TaskRowMenu`，`role="menu"` + `.ht-row-menu ht-material`）。它同样从任务行上
 *   弹出、同样压着可滚动的内容，"内容会从它下面滚过去吗"这条 ADR-0042 §3 的判据
 *   对它成立，而它正是这一轮**新引入**的悬浮面 —— 比任何一枚存量面都更该被盯着。
 *   ⚠️ 所以本文件不再"四面同在 1440×900 下拍"：判据仍是计算样式，截图的**窗口宽度**
 *   逐腿而定（下面 `row-menu` 那一腿的注释写着为什么它不需要再改视口）。
 *
 * 每个面 × 三个状态各截一张（固定路径，人必须看，AGENTS §6.2 规定一）：
 *   light / dark / reduced-transparency（系统"减少透明度"）
 *
 * 判据不靠截图（截图是给人看的证据），靠**计算样式**：
 *   · light/dark —— 玻璃是两半：`backdrop-filter` 含 blur + 底色半透明
 *     （与 `search-overlay.spec.ts` ⑧ 同一条纪律：只查一半会放走另一半的回归）；
 *   · reduced-transparency —— tokens.css 末尾的媒体查询把 tint 压成实色、
 *     模糊压成 0：底色必须**不透明**（alpha=1）。这条红了 = 降级链断了，
 *     而它正是 ADR-0042 §4 的硬约束（材质要能退让）。
 *
 * 主蓝命中判据（§7 #82："非空白"挡不住错误屏）由 `scripts/screenshots/png-stats.mjs`
 * 在跑完本文件后对固定路径截图执行（见 test.afterAll 里的说明）。
 */

/** 进应用必须带 `?lang=zh-CN`（理由见 search-overlay.spec.ts 的同款注释）。 */
const APP_URL = '/?lang=zh-CN';

interface Surface {
  name: string;
  /**
   * 🔴 这一面是不是**实色面**（"玻璃"不成立、也不该成立）。
   *
   * 2026-10-17 加：`search` 就是这种面 —— 共享层 `packages/ui/src/search/SearchPanel.tsx:172-175`
   * 逐字写着 "Search is a reading surface: **opaque on every host** so underlying task titles
   * never compete with results or the query"，并据此传 `materialSurface(tokens, 'chrome', false)`
   * （第三个实参就是"不是玻璃"）。而这条判据原来对**所有**面都要求"背景模糊 + 底色半透明"，
   * 于是它把一条**产品明确写下来的决定**读成了缺陷（现量：`search` 那一面
   * `backdrop=none`、`bg=rgb(255,255,255)` 不透明）。⇒ 实色面只钉"底色是实色"，
   * 不钉"必须有模糊"；玻璃面（其余四面）照旧两条都钉。
   */
  solid?: boolean;
  /** 打开这个悬浮层，返回**面板本体**的定位器（计算样式从它身上取）。 */
  open: (page: import('@playwright/test').Page) => Promise<import('@playwright/test').Locator>;
  /** 关掉（下一个面打开前必须干净，否则截图互相污染）。 */
  close: (page: import('@playwright/test').Page) => Promise<void>;
}

async function addTask(page: import('@playwright/test').Page, title: string): Promise<void> {
  const composer = page.getByTestId('capture-input');
  await composer.fill(title);
  await composer.press('Enter');
}

const SURFACES: Surface[] = [
  {
    name: 'search',
    // 实色面（理由见 `Surface.solid` 的注释：共享层逐字写着 "opaque on every host"）。
    solid: true,
    open: async (page) => {
      await page.getByRole('tab', { name: '搜索' }).click();
      return page.getByTestId('search-overlay-surface').locator('> *').first();
    },
    close: async (page) => {
      await page.keyboard.press('Escape');
    },
  },
  {
    name: 'account-menu',
    open: async (page) => {
      await page.getByTestId('account-menu-avatar').click();
      return page.locator('.ht-rail__account__panel');
    },
    close: async (page) => {
      await page.keyboard.press('Escape');
      // 菜单不吃 Esc 就点内容区收掉（不能让上一张脸叠进下一张截图）。
      await page.mouse.click(700, 400);
    },
  },
  {
    name: 'inbox-panel',
    open: async (page) => {
      await page.getByTestId('inbox-trigger').click();
      return page.locator('.ht-inbox__panel');
    },
    close: async (page) => {
      await page.keyboard.press('Escape');
      await page.mouse.click(700, 400);
    },
  },
  {
    /*
     * 🔴 **这一腿接过的是「清单+标签下拉」与「提醒下拉」两腿的覆盖面** ——
     * 而它们已经**没有被测物**了（行操作 UX 重设计，2026-11）：
     *   · 行尾那一排字段编辑器整排被删，三个行尾浮层外壳
     *     （`TaskOrganizer` / `ReminderPanel` / `TaskRepeat`）**不再被 `App.tsx` 渲染**
     *     （现量：`grep -rn '<TaskOrganizer\|<ReminderPanel\|<TaskRepeat' apps/web/src`
     *     = 0 / 0 / 0），行尾只剩只读徽标（`task-*-badge` / `task-chip-repeat`…）；
     *   · 字段编辑器的唯一所有者在 `TaskDetailCard`，而栏里那几格是**在流内**的
     *     （那个文件逐条写着"这一格里没有 `<details>`、没有 Portal、也没有 `.ht-material`"）。
     *   ⇒ `[data-testid="task-organize-summary"]` 与 `details.ht-compose--popover`
     *     在真界面上各 0 枚：原来那两腿一路等到 60 秒超时。2026-11-04 那趟的首个错误原文是
     *     `locator.click: Test timeout of 60000ms exceeded.`
     *     `waiting for locator('[data-testid="task-organize-summary"]').first()`
     *     （light 与 dark 两条一起红）。
     *
     * 🔴 替补**不是**随手挑的：ADR-0042 §3 第 6 条把"各下拉"列为玻璃候选，而这一轮
     * **新加**的那枚行右键菜单正是行内唯一的弹出层（`TaskRowMenu`：`role="menu"` +
     * `.ht-row-menu ht-material`，层从 `.ht-material` 的 tint + blur 来，自己只加定位）。
     * 它一样从任务行上弹出、一样压在可滚动的内容之上 —— ADR-0042 §3 那条
     * "内容会从它下面滚过去吗"对它是成立的。而且它是这一轮**新引入**的面：
     * 新面比存量面更该被材质判据盯着（"新加的浮层忘了走材质"正是这条 ADR 要防的回归）。
     *
     * ⚠️ 它**不需要**再收窄视口（与前面那两腿不同）：右键菜单不看详情列在不在画，
     *    1440×900 下原样从行上弹出。所以这一腿把视口留在宽档，截图与其余三面同一档。
     */
    name: 'row-menu',
    open: async (page) => {
      /* 🔴 同 `organize-dropdown` 的第二个坑：前面的 `inbox-panel` 会把视图切到收集箱
         （它的 `close` 只关面板、不还视图）⇒ 锚点那一行根本不在屏上。先切回任务视图。 */
      await switchView(page, '任务');
      const row = page.locator('[data-testid^="task-item-"]').first();
      await expect(row, '任务行必须先画出来（右键菜单是从它上面弹出来的）').toBeVisible();
      /*
       * 走**真手势**（右键），不直接点菜单里的东西：这一面存在的唯一入口就是它，
       * 而"右键弹不出来"正是这一轮最该被发现的那种回归（行尾的删除/整理入口全撤了）。
       */
      await row.click({ button: 'right' });
      const menu = page.getByTestId('task-row-menu');
      await expect(menu, '右键之后行菜单必须出现（它是行上唯一的弹出层）').toBeVisible();
      return menu;
    },
    close: async (page) => {
      /*
       * 菜单是**条件挂载**（不是 `<details>`）：Esc 之后就整块卸载。
       * 只按 Esc、不补鼠标兜底 —— 菜单不吃 Esc 这件事本身该红（`check:menu-keyboard`
       * 盯的是同一格），用一次 `mouse.click` 兜过去等于把它测掉。
       */
      await page.keyboard.press('Escape');
    },
  },
];

interface MaterialComputed {
  backdrop: string;
  bgAlpha: number;
}

async function materialOf(
  locator: import('@playwright/test').Locator,
): Promise<MaterialComputed> {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    const bg = s.backgroundColor;
    // rgb() 三参 = 不透明（alpha 1）；rgba() 的第 4 参才是 alpha。
    // 🔴 不要用「抓最后一个数字」的正则：不透明的 rgb(255,255,255) 会把
    // 蓝色通道当 alpha 读出 255 —— 本轮就这么误报过一次。
    const parts = /rgba?\(([^)]+)\)/.exec(bg)?.[1]?.split(',').map((x) => x.trim()) ?? [];
    const alpha = parts.length >= 4 ? Number(parts[3]) : 1;
    return {
      backdrop: s.backdropFilter || (s as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter || 'none',
      bgAlpha: alpha,
    };
  });
}

for (const state of ['light', 'dark', 'reduced-transparency'] as const) {
  test(`玻璃三态 · ${state}：四个悬浮层截图 + 材质判据`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    if (state === 'dark') await page.emulateMedia({ colorScheme: 'dark' });
    if (state === 'reduced-transparency') {
      // ⚠️ **环境边界（2026-10-01 实测）**：Chromium 153 + Playwright 1.63 的
      // `emulateMedia({ reducedTransparency: 'reduce' })` 对这个特性**既不驱动
      // CSS 媒体查询、也不驱动 `matchMedia`**（注入 @media 探针规则量到
      // z-index 仍是 auto）。因此这里用**确定性探针**：在应用脚本加载前补丁
      // `matchMedia`，让「系统开了减少透明度」在应用唯一的消费通道
      // （共享层 theme 的检测）上成立。
      // ⇒ 本态只断言 **JS 通道的搜索卡片**（正是本轮 e2e 抓到的真缺陷所在）；
      //   DOM 表面的 CSS 降级由 design-system 测试直接断言 tokens.css 媒体块
      //   （`tokens.spec.ts` 的玻璃动态对 + `native.spec.ts` 的覆盖层合并），
      //   不在这里假装被验过。
      await page.addInitScript(() => {
        const ORIGINAL = window.matchMedia.bind(window);
        window.matchMedia = (query: string): MediaQueryList => {
          const list = ORIGINAL(query);
          if (query.includes('prefers-reduced-transparency')) {
            return {
              matches: true,
              media: query,
              onchange: null,
              addListener: () => {},
              removeListener: () => {},
              addEventListener: () => {},
              removeEventListener: () => {},
              dispatchEvent: () => false,
            } as MediaQueryList;
          }
          return list;
        };
      });
    }

    // 🔴 走套件的规范启动路径（openApp = 启用全部模块 + 中文偏好 + 生产者垫片
    //    + 做完首启隐私同意，默认「仅本机」= 对本组判据的最小承诺）。
    //    同意面板本身是模态实卡（ADR-0042 裁决表：模态不改玻璃），
    //    而且它在 openApp 里就已经关掉 —— 不在本组三态截图的对象里。
    await openApp(page, APP_URL);

    // 造一点有色彩的下层内容（玻璃需要可折射的东西；空页面验不出玻璃）。
    await addTask(page, '玻璃三态判据的锚点任务·甲');
    await addTask(page, '玻璃三态判据的锚点任务·乙');
    await expect(page.locator('[data-testid="task-list"]')).toBeVisible();

    if (state === 'dark') {
      await expect(
        page.locator('html'),
        '前提：暗色真的生效了（否则后面所有暗色截图都是亮色假绿）',
      ).toHaveAttribute('data-theme', 'dark');
    }

    // reduced 态只走 JS 通道的搜索卡（理由见上方环境边界注释）；
    // 其余四面在该态下的 CSS 降级不在本浏览器可验范围。
    const surfaces = state === 'reduced-transparency' ? SURFACES.filter((s) => s.name === 'search') : SURFACES;
    for (const surface of surfaces) {
      const panel = await surface.open(page);
      await expect(panel, `${surface.name}：面板应当出现`).toBeVisible();
      const shot = `test-results/glass-${surface.name}-${state}.png`;
      await page.screenshot({ path: shot, fullPage: false });

      const material = await materialOf(panel);
      if (state === 'reduced-transparency' || surface.solid === true) {
        expect(
          material.bgAlpha,
          `${surface.name}：${surface.solid === true ? '这是实色面，底色必须是实色' : '减少透明度时底色必须退成实色'}（${material.bgAlpha}）`,
        ).toBe(1);
      } else {
        expect(
          material.backdrop,
          `${surface.name}：玻璃两半之一——背景模糊（实测 ${material.backdrop}）`,
        ).toContain('blur(');
        expect(
          material.bgAlpha,
          `${surface.name}：玻璃两半之二——底色必须半透明（实测 ${material.bgAlpha}）`,
        ).toBeLessThan(1);
      }
      await surface.close(page);
      // `<details>` 收起时内容**留在 DOM**（只是不可见），菜单类则是卸载 ——
      // 两种关法用同一个判据：不可见。拿 count=0 断 details 会永远红。
      await expect(
        panel,
        `${surface.name}：关干净再拍下一个（不可见即关闭）`,
      ).toBeHidden();
    }
  });
}

test.afterAll(async () => {
  // 主蓝命中判据不在这里跑（Playwright 里没有零依赖的 PNG 解码器）：
  // 跑完本文件后对固定路径执行
  //   node scripts/screenshots/png-stats.mjs e2e/test-results/glass-*.png
  // 判据 = 非空白 + heyta 主蓝命中 > 0（§7 #82："非空白"挡不住错误屏）。
  // 人工复核同一组截图（§6.2 规定一：人看了才算）。
});
