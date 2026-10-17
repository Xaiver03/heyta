import { expect, test } from '@playwright/test';
import { openApp, switchView } from './helpers';

/**
 * 🔴 玻璃材质三态验收（ADR-0042 / P1）—— 只有真浏览器能证的那一半
 * =================================================================
 *
 * 覆盖 P1 落地的五个悬浮功能层：
 *   搜索浮层（chrome 档，共享层 tint + 宿主 blur）
 *   账号菜单 / 通知面板 / 任务「整理」下拉 / 任务「提醒」下拉（panel 档）
 *
 * ⚠️ 第五枚原本是「重复」下拉：§8.141 之后宽档行尾不再渲染它（编辑本体进了栏里那一格，
 *   行尾只剩只读徽标）。替补的选取口径写在 `SURFACES` 最后一项的注释里 ——
 *   **要用 ADR-0042 §3 名单上的面**，不是"长得像的另一枚下拉"。
 *   🔴 §8.145 之后连替补那一枚也不在宽档了 ⇒ 那一腿**自己把视口收到窄档**再量（覆盖面不变）。
 *   ⚠️ 所以本文件不再"五面同在 1440×900 下拍"：判据仍是计算样式，截图的**窗口宽度**逐腿而定。
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
      return page.locator('.ht-accountmenu__panel');
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
    // 🔴 §8.147 起这一腿必须**先把视口收到窄档**，理由与本文件 `reminder-dropdown` 那条
    //   （§8.145 同一件事）逐字同形：工单 §8.147 把「清单 + 标签」的编辑本体搬进栏里那一格之后，
    //   宽档（本套件的 1440×900，详情列在画）行尾只剩只读 `TagChips`、`<summary>` 不再渲染
    //   ⇒ 原先这一腿在 1440 档**超时等不到** `task-organize-summary`（light 与 dark 两条一起红）。
    //   覆盖面一个字没换：「清单标签下拉」是 ADR-0042 §3 那五个玻璃候选之一，
    //   窄档（详情列不画）时那块面板原样回到行尾 —— 换的只是"在哪一档量它"，**删掉这一腿才是把覆盖丢掉**。
    //   ⚠️ `close` 里把视口还回 1440×900：本套件其余四面按宽档拍，继承窄档 = 截图互相污染。
    name: 'organize-dropdown',
    open: async (page) => {
      /*
       * 🔴 2026-10-17（第二个坑，已复现）：这一面在 `SURFACES` 里排第 4，**前面 `inbox-panel`
       * 会把视图切到收集箱**（它的 `close` 只关面板、不还视图）⇒ 锚点那两行根本不在屏上，
       * 于是后面所有"找那一行/那一枚"的动作一律走到 60s 超时（第 33 轮在 `detail-pane-task`
       * 上踩过同一个坑）。⇒ 打开之前先切回任务视图（同族既有手法，`switchView` 在 helpers 里）。
       */
      await switchView(page, '任务');
      await page.setViewportSize({ width: 900, height: 600 });
      /*
       * 🔴 2026-10-17：整理入口现在住在**每行那枚「更多」披露**里（`details.ht-compose-actions`）
       * —— 折叠时它在 DOM 里但不画，直接点会一路
       * `waiting for element to be visible` 到 60s 超时（现量）。先把披露打开（按它自己的
       * `task-actions-summary-*` 定位，不需要知道任务标题），再点整理入口。
       */
      const more = page.locator('[data-testid^="task-actions-summary-"]').first();
      if (
        (await more.count()) > 0 &&
        !(await page
          .locator('[data-testid="task-organize-summary"]')
          .first()
          .isVisible()
          .catch(() => false))
      ) {
        await more.click();
      }
      await page.locator('[data-testid="task-organize-summary"]').first().click();
      return page
        .locator('details:has([data-testid="task-organize-summary"]) .ht-material')
        .first();
    },
    close: async (page) => {
      /*
       * 🔴 2026-10-17：**关**两层 —— 整理入口住在每行那枚「更多」披露里，
       * 只点整理入口只会把里面那层收起来，外层 `details.ht-compose-actions`
       * 还开着 ⇒ 判据 `…关干净再拍下一个（不可见即关闭）` 读到 `.ht-material`
       * 仍然 visible（现量：`Expected: hidden, Received: visible`）。
       * 这里按"点外层 summary 收起"来关（它本来就是 toggle），再按 Esc 兜底。
       *
       * 🔴 2026-10-17（第六个读数，**这一条是本轮真因**）：只收外层**不够**。
       * 在真实流程里插桩量到：下一面点 chip 时，命中点是 `label`，而它属于
       * **同一行**的另一个 `.ht-material__row-pop` 面板（`popRow == chipRow`）——
       * 也就是**这一面的整理面板并没有随外层披露一起消失**，它压在下一面的目标上
       * （探针里单任务、干净状态量不到）。
       * ⇒ 关法改成**先关内层、再收外层**（内层还可见时才点它，避免"关掉又打开"）。
       * ⚠️ 应用侧仍有一个真问题留在台账里：**同一时刻只允许一个行内浮层**这条不变量
       * 现在没有谁在保证（行内浮层彼此重叠是真实存在的），它不该靠用例的关闭顺序兜住。
       */
      const chip = page.locator('[data-testid="task-organize-summary"]').first();
      if (await chip.isVisible().catch(() => false)) await chip.click();
      const more = page.locator('[data-testid^="task-actions-summary-"]').first();
      if ((await more.count()) > 0) {
        const outer = more.locator('xpath=ancestor::details[1]');
        if ((await outer.getAttribute('open')) !== null) await more.click();
      }
      await page.keyboard.press('Escape');
    },
  },
  {
    // 🔴 这一腿原本是 `repeat-dropdown`：工单 §8.141 把「重复」的编辑本体搬进栏里那一格之后，
    //   宽档（本套件的 1440×900，详情列在画）行尾只剩只读徽标、`<summary>` 不再渲染 ⇒ 那一腿
    //   会点在不存在的选择器上。
    //
    // ⚠️ 替补**不是**随手挑的：第一版换成了「截止」那一枚，跑出来 `bgAlpha=1` 直接红 ——
    //   因为 `DueEditor` 的两副身体都带内联 `backgroundColor: color.surface`（实色），
    //   而 ADR-0042 §3 的逐面裁决表（审计 §3.4）里那五个玻璃候选是
    //   账号菜单 / 通知面板 / 清单标签下拉 / 重复规则下拉 / **捕获条下拉**，
    //   截止下拉**从来不在名单上**。⇒ 拿它替「重复」等于把覆盖面换成一个非玻璃面。
    //   这里换成提醒那一枚（`.ht-compose--popover` + `.ht-compose-panel ht-material`，
    //   无内联底色覆盖），它既在名单上、又仍在宽档行尾渲染。
    //
    // 🔴 §8.145 之后**宽档也没有它了**（提醒的编辑本体进了栏里那一格，行尾只剩 `ReminderBadge`）。
    //   这一腿不删、改成**先把视口收到窄档**：`details.ht-compose--popover` 整块是条件挂载，
    //   窄档（详情列不画）时它原样回到行尾 ⇒ 覆盖面（名单上的那一面）一个字没换，
    //   换的只是"在哪一档量它"。删掉这一腿才是把覆盖丢掉。
    //   ⚠️ `close` 里必须把视口还回 1440×900：本套件其余四面都按宽档拍，
    //   让下一腿继承窄档 = 截图互相污染（同一循环里已经有一条"关干净再拍下一个"的判据）。
    name: 'reminder-dropdown',
    open: async (page) => {
      /* 🔴 同 `organize-dropdown`：这一面排第 5，前面的面会把视图切走 ⇒ 先切回任务视图。 */
      await switchView(page, '任务');
      await page.setViewportSize({ width: 900, height: 600 });
      /*
       * 🔴 2026-10-17：提醒那枚 `summary` 现在也住在**每行那枚「更多」披露**里
       *（`details.ht-compose-actions`）—— 折叠时它在 DOM 里但不画，直接点会一路
       * `waiting for element to be visible` 到 60s 超时（现量，第三次遇到同一族）。
       * 先按 `task-actions-summary-*` 把外层披露打开，再点提醒那一枚。
       */
      /*
       * 先把**目标那一枚自己的祖先披露**打开 —— 用 `evaluate` 按元素自己置位，
       * 而不是去点"包含 popover 的第一行"那枚按钮：后者与本行不一定是同一行
       * （现量教训：点了另一行 ⇒ 目标那枚始终折叠 ⇒ `waiting for element to be visible` 一路 60s）。
       * 点开披露只是**取出元素**的仪器动作；真正要被检验的是下面那一次对 chip 的
       * `locator.click()`（actionability 比 `mouse.click` 严，能抓住"看得见点不着"）。
       */
      const popSummary = page.locator('details.ht-compose--popover > summary').first();
      await popSummary.evaluate((el) => {
        const outer = el.closest('details.ht-compose-actions');
        if (outer !== null && !outer.open) outer.open = true;
      });
      /*
       * 🔴 2026-10-17（第四个坑，逐行读数定位）：`expect(...).toBeVisible()` 与下一句
       * `locator.click()` **各自重新解析一次 `.first()`**，而 popover 打开之后 DOM 里有两个
       * 实例（现量 `matches=2`）⇒ 两次解析之间可能指向**另一枚（折叠的）**元素：
       * 现量就是"可见断言过了、紧接着 click 报 `waiting for element to be visible`"，
       * 失败行精确落在 `await popSummary.click();`。
       * ⇒ 把目标**绑成同一个元素句柄**再断言/滚动/点击（不再重解析）。
       * 点击本身仍是 `elementHandle.click()`（真实 actionability，能抓住"看得见点不着"）。
       *
       * 🔴 2026-10-17（第五个读数，**仍未解决**）：在真实流程里插桩量到 —— 点击那一刻
       * 目标 chip 在 `540..594`，而 `elementFromPoint` 命中的是 **`label.`（rect 525..769）**，
       * 它属于**另一个** `.ht-material__row-pop` 面板（`513..781`）⇒ **上一条面的行内浮层
       * 还没关干净，正压在这一枚上**（探针里单任务、干净状态量不到这一条）。
       * 下一手：查 `organize-dropdown` 的 close 是否真的把它的 `.ht-material__row-pop` 关掉
       * （或应用侧是否本该"同一时刻只允许一个行内浮层"）。
       */
      const chip = await popSummary.elementHandle();
      expect(chip, '要找得到提醒那一枚').not.toBeNull();
      await chip!.waitForElementState('visible');
      await chip!.scrollIntoViewIfNeeded();
      await chip!.click();
      const panel = page.locator('details.ht-compose--popover .ht-material').first();
      // 🔴 把锚点那一行滚到可视区中部再量：这一族的锚点任务落在列表末尾，而
      //   `position: absolute` 的行尾面板开在**滚动容器**里 ⇒ 朝下开就被容器底裁掉。
      //   2026-10-05 看图实测：不滚的时候 `toBeVisible()` 与计算样式**全绿**，截图里
      //   却整块面板都没画（既有的 `organize-dropdown` 腿同一件事）。
      //   ⇒ 材质判据量的是元素，"用户看得见"要另有一条，见工单 §8.141 边界。
      await panel.scrollIntoViewIfNeeded();
      return panel;
    },
    close: async (page) => {
      /*
       * 🔴 2026-10-17（第三个坑，已用读数定位）：这里原来又去点
       * `details.ht-compose--popover > summary` 的 `.first()` —— 而**popover 打开之后
       * DOM 里多出一个实例**（现量：`matches=2`，两枚都 visible、各挂在一条 task-item 行上），
       * 于是 `close` 的 `.first()` 已经指向**另一个（折叠的）**元素 ⇒
       * `waiting for element to be visible` 一路 60s（而 `open` 里同一句是好的，因为它发生在
       * 打开之前、那时只有一个实例）。
       * ⇒ 关法改成**不依赖"第几个实例"**：Esc（这一族的面板本来就是 Esc 关，`organize-dropdown`
       * 的 close 也是这么兜的）+ 把外层披露收回去（按行自己那枚「更多」的状态决定要不要点）。
       */
      await page.keyboard.press('Escape');
      const more = page.locator('[data-testid^="task-actions-summary-"]').first();
      if ((await more.count()) > 0) {
        const outer = more.locator('xpath=ancestor::details[1]');
        if ((await outer.getAttribute('open')) !== null) await more.click();
      }
      await page.setViewportSize({ width: 1440, height: 900 });
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
  test(`玻璃三态 · ${state}：五个悬浮层截图 + 材质判据`, async ({ page }) => {
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
