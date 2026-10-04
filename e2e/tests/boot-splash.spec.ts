import { expect, test } from '@playwright/test';

/**
 * 首屏（启动）动画：品牌帧**画得出来**，而且**真的会退场**。
 *
 * ## 为什么要两条，而不是一条"截图能看到 logo"
 *
 * `apps/web/index.html` 里那段是生成物：一层 `position: fixed; inset: 0`、
 * `z-index` 取阶梯最上一档（900）的满屏遮罩。它**只被画出来过一次**是不够的 ——
 * 一个永远不消失的品牌帧同样"非空白"、同样"数得出主蓝"（那块底板就是
 * `#2563eb`），在截图统计上比真界面还好看。这正是环境陷阱 §7 第 82 条的形状，
 * 所以这里的第二条用例钉的是**退场**（`apps/web/src/boot-splash.ts` 那条接线），
 * 不是 logo 好不好看。
 *
 * 截图判据写成**存在性**（"那一帧里有 mark、有主蓝底板"），
 * 而不是"我以为会有的那几个元素各长什么样" —— 后者抓不到"少了一整块"。
 *
 * ## 两条用例的分工
 *
 * | 用例 | 载体 | 证明 |
 * |---|---|---|
 * | A | **人为按住** `/src/main.tsx` 不发 | bundle 到货之前那一帧长什么样（不按住它在高负载机器上拍到的是随机时刻，判据会漂） |
 * | B | 零拦截、真实启动路径 | 遮罩在应用第一次画出内容后**从 DOM 里消失**（这条才是退场接线） |
 *
 * ⚠️ A 的"按住"只是探针，**不是被测对象**：它证明不了退场，B 才证明。
 * 反过来 B 拍不到品牌帧（太快），所以两条缺一条都等于少一半判据。
 */

const SPLASH_ID = 'heyta-boot';
/** 设计系统主蓝（`color.primary`）。这里断的是**观感事实**，不是 token 名。 */
const PRIMARY_RGB = 'rgb(37, 99, 235)';

test.describe('首屏动画（启动品牌帧）', () => {
  test('A：bundle 到货之前，那一帧是品牌帧', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err)}`));

    // 按住入口模块 ⇒ React 永远不会挂载 ⇒ 界面停在首屏那一帧。
    // 这一步是**为了可复现地拍到 t=0**，它不参与任何结论（结论在 B）。
    //
    // ⚠️ 第一版这里写的是「等放行后 `route.abort()`」，实测两条用例都红在
    // `route.abort: Route is already handled!` —— abort 与 Playwright 自己的
    // 请求收尾撞车。改成** fulfilled 一个空模块**：语义更准（React 从没加载，
    // 而不是加载失败），而且空 body 是合法 JS，不会在控制台留下噪声，
    // 那部分噪声会被下面 `consoleErrors` 的断言通道收走、误导归因。
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let released = false;
    const hold = () => {
      if (released) return;
      released = true;
      release();
    };
    await page.route('**/src/main.tsx', async (route) => {
      await held;
      await route
        .fulfill({ contentType: 'text/javascript; charset=utf-8', body: '/* 探针：入口模块按住 */' })
        .catch(() => {
          /* 页面已关闭 —— 探针的收尾不是判据 */
        });
    });

    await page.goto('http://127.0.0.1:4318/', { waitUntil: 'commit' });
    // 遮罩本身是 HTML 的一部分，不等 React；只等它出现在 DOM 里。
    await page.waitForSelector(`#${SPLASH_ID}`, { state: 'attached' });

    // 🔴 先截图，再断言（§6.2 规定一第 1 条）：失败时也要有图可看。
    await page.screenshot({ path: 'test-results/boot-splash-frame.png' });

    const plate = page.locator(`#${SPLASH_ID} .heyta-boot__plate`);
    const bars = page.locator(`#${SPLASH_ID} .heyta-boot__bar`);
    try {
      await expect(plate).toBeVisible();
      // 存在性判据：三道字形**一道都不许少**（少一道在截图上只是"logo 有点怪"，
      // 只有数得出来才会红）。
      await expect(bars).toHaveCount(3);
      // 底板必须是设计系统主蓝 —— 这是"是我们的界面"而不是"有东西"的分界。
      await expect(plate).toHaveCSS('fill', PRIMARY_RGB);
      await expect(bars.first()).toHaveCSS('fill', 'rgb(255, 255, 255)');
      // 入场动画在跑（不是静止的一张图）。
      await expect(bars.first()).toHaveCSS('animation-name', 'heyta-boot-rise');
      // 遮罩压在阶梯最上一档：首启的隐私同意面板不许盖在它上面。
      await expect(page.locator(`#${SPLASH_ID}`)).toHaveCSS('z-index', '900');
    } catch (err) {
      hold();
      throw new Error(`${String(err)}\n控制台输出：\n${consoleErrors.join('\n') || '（无内容）'}`);
    }

    hold();
  });

  test('B：真实启动路径下，遮罩会退场并从 DOM 摘掉', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err)}`));

    await page.goto('http://127.0.0.1:4318/');

    let failure: Error | null = null;
    try {
      // 应用真画出了东西（不是一层遮罩）：`#root` 里有节点。
      await expect.poll(async () => await page.evaluate(() => document.getElementById('root')?.childNodes.length ?? 0)).toBeGreaterThan(0);
      // 🔴 这一条是本轮真正的判据：**遮罩不是隐藏，是摘掉**。
      // 只断言"看不见"会放过 `opacity: 0` + 仍然满屏挡事件的实现；
      // 而 `display:none` 那种"收起来"的写法在无障碍树里仍是一个 role=img 元素。
      await expect(page.locator(`#${SPLASH_ID}`)).toHaveCount(0);
    } catch (err) {
      failure = err instanceof Error ? err : new Error(String(err));
    }

    await page.screenshot({ path: 'test-results/boot-splash-after.png' });

    if (failure !== null) {
      throw new Error(
        `${failure.message}\n（截图已落在 test-results/boot-splash-after.png —— 先看那张图）` +
          `\n控制台输出：\n${consoleErrors.join('\n') || '（无内容）'}`,
      );
    }
  });
});
