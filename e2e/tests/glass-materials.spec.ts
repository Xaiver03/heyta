import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

/**
 * 🔴 玻璃材质三态验收（ADR-0042 / P1）—— 只有真浏览器能证的那一半
 * =================================================================
 *
 * 覆盖 P1 落地的五个悬浮功能层：
 *   搜索浮层（chrome 档，共享层 tint + 宿主 blur）
 *   账号菜单 / 通知面板 / 任务「整理」下拉 / 任务「重复」下拉（panel 档）
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
    name: 'organize-dropdown',
    open: async (page) => {
      await page.locator('[data-testid="task-organize-summary"]').first().click();
      return page
        .locator('details:has([data-testid="task-organize-summary"]) .ht-material')
        .first();
    },
    close: async (page) => {
      await page.locator('[data-testid="task-organize-summary"]').first().click();
    },
  },
  {
    name: 'repeat-dropdown',
    open: async (page) => {
      await page.locator('[data-testid="task-repeat-summary"]').first().click();
      return page.locator('details:has([data-testid="task-repeat-summary"]) .ht-material').first();
    },
    close: async (page) => {
      await page.locator('[data-testid="task-repeat-summary"]').first().click();
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

    // 🔴 走套件的规范启动路径（openApp = 启用全部模块 + 生产者垫片）：
    //    裸 goto 时模块全关，rail 没有「搜索」tab，而且 main 里的展示层会拦住指针。
    await openApp(page, APP_URL);

    // 🔴 首启隐私同意面板（privacy/consent-gate）会以 z.modal 盖住整个界面，
    // 不先做决定的话 rail 的 tab 一个都点不了。选「仅本机」：对本组判据而言
    // 它是最小承诺的决定（不触网、不依赖服务端），且面板本身是模态实卡
    // （ADR-0042 裁决表：模态不改玻璃）—— 不在本组三态截图的对象里。
    const consent = page.getByTestId('privacy-consent-dialog');
    if (await consent.isVisible().catch(() => false)) {
      await page.getByTestId('privacy-consent-local-only').click();
      await expect(consent, '做完决定后同意面板必须关掉').toHaveCount(0);
    }
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
      if (state === 'reduced-transparency') {
        expect(
          material.bgAlpha,
          `${surface.name}：减少透明度时底色必须退成实色（${material.bgAlpha}）`,
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
