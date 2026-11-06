/**
 * 同步入口搬进 rail 底部 + 同步设置搬进 设置（工单 H9，web 端）
 * ============================================================
 *
 * 产品负责人 2026-10-06 的原话："同步按钮不应该放在左下角侧边栏的左下角吗？"
 * 以及第 2 条："设置不应该点击头像之后再打开吗？"
 * 裁决与逐条现量在 `docs/plans/goal-layout-audit.md` §9.1。这一份用例钉的是
 * **搬走之后两边都还成立**：
 *
 *   S1 🔴 页头那一排**不许再有同步**（存在性反向判据）。
 *      为什么必须有这一条而不是只验"rail 里有一枚"：这一排的成因就是
 *      "每批都往页头右侧再塞一枚"（六枚不相关控件平铺）。只验新位置，
 *      下一批把旧的加回来也不会红。
 *   S2 rail 底部那一枚在、可点、**`aria-label` 里带着整句状态**，
 *      且 DOM 里有一枚 `role="status"` 的 live region（状态是异步变的）。
 *   S3 设置里的那一节带着共享状态条（它从页头搬到这里，不是被删掉 ——
 *      `check:ui-provider` 登记的消费者必须在）。
 *   S4 🔴 「同步设置」**只有一处**，而那一处在设置浮层里：
 *      rail 上那颗齿轮必须消失（它长得像全局设置，点开的却只是同步），
 *      而设置关掉之后这一节必须跟着不在 DOM 里（它不再是常驻的同级浮层）。
 *
 * ⚠️ 载体与图标那一族同一条：`vite preview` + `apps/web/dist`，
 *    改完 `apps/web/src/**` 或 `packages/ui/src/**` **必须先重打**（§7 第 27 条那一族）。
 *    跑法（仓库根）：
 *      pnpm --filter @heyta/ui build && pnpm --filter @heyta/web build
 *      cd e2e && npx playwright test tests/shell-sync-rail.spec.ts \
 *        --config playwright.detail-pane.config.ts
 */
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import {
  addTask,
  closeSettingsSheet,
  openApp,
  openSettingsView,
  parkCursor,
  selectSettingsSection,
  stubLegalRecheck,
  stubPublicFacts,
} from './helpers';

const APP_ZH = '/?lang=zh-CN';

const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/shell-sync-rail/${name}.png`, import.meta.url));

/** 量一枚元素的盒子。 */
async function boxOf(page: Page, locator: ReturnType<Page['locator']>, what: string) {
  const box = await locator.first().boundingBox();
  expect(box, `${what} 量不到盒子 ⇒ 它没画出来`).not.toBeNull();
  return box as { x: number; y: number; width: number; height: number };
}

/**
 * 拍「rail 那一枚 hover 出来的那句话」。
 *
 * 🔴 **为什么不能直接拍 rail 的静止态**（2026-11 实测，总包看图抓出来的）：
 * 48px 的 rail 在静止态**只画图标**，那句「· N 项还没上传」进的是
 * `aria-label` + `role="status"` live region + **hover 才 opacity:1 的 `.ht-rail__label`**
 * （`SyncBar.tsx:118-124` + `inbox.css` 的 `.ht-rail__label`）。
 * 而**截图拍不到 `aria-label`** ⇒ 一张静止态的 rail 图只证明"它看起来和以前一样"，
 * 而不是"它说得出 N 项没上传"。那种图比没有图更糟：下一个人会以为这件事被验过了。
 *
 * 所以这里做三件事，缺一不可：
 *   1. `hover()` 让标签真的画出来；
 *   2. 断言那句文字**在标签里**，且标签的**计算 opacity 真的到了 1**（不是"在 DOM 里"——
 *      opacity:0 在 Playwright 眼里也算 visible，只看 `toBeVisible()` 会被骗）；
 *   3. `clip` 按**标签自己的盒子**算，保证那句话在成图里，而不是被裁在框外。
 *
 * ⚠️ 由此也记一笔既成事实：**这枚按钮在静止态看不见字，不是缺陷**（48px 放不下第二行文字）。
 * 别把这张图读成"静止态也看得见"。
 */
async function shootRailTooltip(page: Page, name: string, mustContain: RegExp): Promise<void> {
  const action = page.getByTestId('sync-rail-action');
  const label = page.locator('.ht-rail__sync .ht-rail__label');
  await action.hover();
  await expect(label, 'hover 之后 rail 那句标签的文字不对').toHaveText(mustContain);
  await expect
    .poll(
      async () => label.evaluate((el) => getComputedStyle(el).opacity),
      { message: 'hover 之后标签的 opacity 没到 1 ⇒ 图里那句话其实没画出来' },
    )
    .toBe('1');
  const box = await boxOf(page, label, 'rail 那句 hover 标签');
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const left = 0;
  const top = Math.max(0, Math.floor(box.y) - 16);
  const width = Math.min(viewport.width - left, Math.ceil(box.x + box.width) + 16);
  const height = Math.min(viewport.height - top, Math.ceil(box.height) + 32);
  await page.screenshot({
    path: SHOT(name),
    clip: { x: left, y: top, width, height },
    scale: 'device',
  });
}

/**
 * 给这一页塞一份**已登录**的同步凭据。
 *
 * 🔴 2026-10-25：`SyncSettingsPanel` 里那枚共享状态条是 `signedIn ? … : "登录后…"` 的
 * 一支（`SyncSettingsPanel.tsx:133-140`）—— 未登录时它**根本不渲染**
 * （实测：`document.querySelectorAll('[data-testid="sync-status-bar"]').length === 0`）。
 * 而 S3 要钉的正是"那一节 مصرف 了共享状态条"，所以前提得先成立：塞凭据。
 * ⚠️ 这不是"为了让判据变绿造环境"：未登录那一支的文案另有判据（S1/S2 与设置里的入口），
 * 这里要的是"登录之后状态条在不在那一节里"。
 */
async function seedSignedIn(page: Page, server = 'http://sync.rail.e2e.test'): Promise<void> {
  await page.addInitScript((origin: string) => {
    localStorage.setItem(
      'heyta.sync.credentials',
      JSON.stringify({ baseUrl: origin, token: 'e2e-shell-sync-token', email: 'sync-rail@example.test' }),
    );
  }, server);
}

test.describe('同步入口在 rail 底部（H9，web 端）', () => {
  test('S1 🔴 页头那一排不许再出现同步的任何一枚', async ({ page }) => {
    await openApp(page, APP_ZH);

    const actions = page.locator('.ht-header__actions');
    await expect(actions, '页头动作区没画出来 ⇒ 这一条没有基准').toHaveCount(1);

    // 反向存在性：整块同步 affordance（旧形状）与其三枚动作都不许在页头里。
    await expect(
      actions.locator('[data-testid="sync-rail"], [data-testid="sync-settings-entry"], [data-testid="sync-help-link"]'),
      '页头里又出现了同步的某一枚 ⇒ "别往页头塞"这条没有生效',
    ).toHaveCount(0);
    // 文字通道：旧的那枚主按钮/链接的文案也不许在页头出现（testID 改名挡不住文案回来）。
    for (const word of ['未同步', '立即同步', '处理冲突']) {
      await expect(
        actions.getByText(word, { exact: false }),
        `页头里还能读到「${word}」—— 同步没真的搬走`,
      ).toHaveCount(0);
    }
  });

  test('S2 rail 底部那一枚在、可点、并且把状态说得出', async ({ page }) => {
    await openApp(page, APP_ZH);

    const button = page.getByTestId('sync-rail').locator('button').first();
    await expect(button, 'rail 底部没有同步那一枚').toBeVisible();
    await expect(button, '这一枚没有可访问名 ⇒ 纯图标控件').not.toHaveAttribute('aria-label', '');

    // 🔴 状态必须**在标签里**：这一枚没有常驻文字，色点也不是给眼睛之外的通道。
    const label = (await button.getAttribute('aria-label')) ?? '';
    expect(label, `aria-label 里没念出状态：${label}`)
      .toMatch(/未同步|已同步|同步中|离线|冲突|出错|同步，当前状态/);

    // live region 与 hover 标签是两件事：读屏要的那句必须常驻 DOM。
    const live = page.getByTestId('sync-rail').locator('[role="status"]');
    await expect(live, '少了 role="status" 的 live region ⇒ 状态变化不会播报').toHaveCount(1);
    expect(((await live.textContent()) ?? '').trim().length, 'live region 是空的').toBeGreaterThan(0);

    // 位置：它要在 rail 里、并且是这一列**最底下**那一组（在「帮助」之下）。
    const rail = await boxOf(page, page.locator('.ht-rail'), '左 rail');
    const here = await boxOf(page, button, '同步那一枚');
    const help = await boxOf(page, page.getByTestId('rail-help'), '「帮助」那一枚');
    expect(here.x, '同步那一枚不在 rail 的横向范围里').toBeGreaterThanOrEqual(rail.x - 1);
    expect(here.x + here.width, '同步那一枚超出 rail 右边界').toBeLessThanOrEqual(
      rail.x + rail.width + 1,
    );
    expect(here.y, '同步那一枚不在「帮助」之下 ⇒ 它没有真的贴到左下角').toBeGreaterThan(help.y);

    const viewport = page.viewportSize();
    expect(viewport, '量不到视口尺寸 ⇒ 这一条没有基准').not.toBeNull();
    const vh = viewport?.height ?? 0;

    /*
      🔴 下段**每一枚**都要在视口内，而不只同步那一枚。
      这一条的第一版只量了同步按钮，于是它红的时候（底边 y=800 > 视口 720）我把它读成
      "差一点，挪挪间距就行" —— 真相是 rail 底下整组（通知/帮助/同步 ≈ 160px）
      都堆在折叠线以下，而只有眼睛能一眼看出"堆了几枚"（§6.2 规定一第 4 条）。
      逐枚量还把"只把同步那枚救回来、把下面那一枚留在折叠线下"这种改法挡掉。
    */
    const bottomGroup = [
      ['通知（铃铛）', page.locator('nav.ht-rail > button[aria-haspopup="dialog"]')],
      ['帮助', page.getByTestId('rail-help')],
      ['同步', button],
    ] as const;
    const readings: string[] = [];
    for (const [what, locator] of bottomGroup) {
      const box = await boxOf(page, locator, what);
      readings.push(`${what} y=${String(Math.round(box.y))}..${String(Math.round(box.y + box.height))}`);
      expect(box.y >= -1, `${what} 顶边 y=${String(Math.round(box.y))} 在视口顶之上`).toBe(true);
      expect(
        box.y + box.height <= vh + 1,
        `${what} 底边 y=${String(Math.round(box.y + box.height))} 掉出视口底边（视口高 ${String(Math.round(vh))}；${readings.join(' | ')}）`,
      ).toBe(true);
    }

    /*
      🔴 "下段常驻"的另一半：**放不下的那一段必须自己会滚**。
      只断言上面那四条的话，把 `.ht-rail` 改成 `overflow: hidden` 而不给上段滚动区
      也会全绿 —— 那等于把视图列表裁掉，比掉出视口更糟（够不着了）。
      所以这里按"上段内容是否超出它自己的盒子"分流：超出就必须 `overflow-y: auto|scroll`，
      没超出（高视口）就只要求它别是 `hidden`（否则这条判据在矮视口下也会红得没人信）。
    */
    const tabsOverflow = await page
      .locator('.ht-rail__tabs')
      .evaluate((el) => ({
        clipped: el.scrollHeight - el.clientHeight,
        overflowY: getComputedStyle(el).overflowY,
      }));
    if (tabsOverflow.clipped > 1) {
      expect(
        tabsOverflow.overflowY === 'auto' || tabsOverflow.overflowY === 'scroll',
        `上段的视图列表被裁掉 ${String(Math.round(tabsOverflow.clipped))}px 而 overflow-y 是 "${tabsOverflow.overflowY}" —— 那些视图谁都点不到`,
      ).toBe(true);
    }

    // 🔴 **先截图，再断言**（§6.2 规定一第 1 条）：这一条第一版把截图放在最后一句，
    //    于是"掉出视口底边"红的时候**没有图可看** —— 而那恰恰是最需要看图的一红
    //    （rail 底下到底堆了多少枚，只有眼睛能一眼判断）。
    await page.screenshot({ path: SHOT('rail-sync-button') });

    /*
      整页 1280×720 里 rail 只有 64px 宽 —— 那一列在整图里**看不清任何一枚**，
      而 H9 的全部争议都在那一列的底部（"下段堆了几枚、每枚画成什么样"）。
      所以额外裁一份下段放大图：`clip` 只截这块，`scale: 'device'` 保留像素密度。
      这张图是给人看的证据，不是判据（判据是上面那四条逐枚量出来的盒子）。
    */
    await page.screenshot({
      path: SHOT('rail-bottom-group'),
      clip: { x: 0, y: Math.max(0, vh - 300), width: 128, height: Math.min(300, vh) },
      scale: 'device',
    });
  });

  test('S3 设置里那一节带着共享状态条，并且三个字段都在', async ({ page }) => {
    await seedSignedIn(page);
    await openApp(page, APP_ZH);
    await openSettingsView(page);
    // 🔴 2026-10-25：设置中心重做之后是**分节**的（`settings-group-*`），
    // 「同步」那一节默认 `hidden` —— 不先切到那一节，`sync-settings-panel` 永远不可见。
    await selectSettingsSection(page, 'sync');

    const panel = page.getByTestId('sync-settings-panel');
    await expect(panel, '设置浮层里没有「同步」那一节').toBeVisible();

    /*
      🔴 必须**滚进视野再拍**：`toBeVisible()` 量的是 CSS 可见，而设置浮层是一列
      很长的可滚动列表 —— 不滚的话截图拍的是浮层**顶部**（个人信息 + 显示），
      而这张图的名字声称的是同步那一节。2026-10-06 人眼看第一版这张图时看到的就是
      顶部那一屏 —— 判据全绿、图是错的（§6.2 规定一第 4 条要的就是这一步）。
    */
    await panel.scrollIntoViewIfNeeded();

    /*
      🔴 把"图里真的是那一节"从人眼步骤升级成一条几何判据：截图之前量一次盒子，
      要求它的**顶边在视口内**。没有这一条，下一次有人把 `scrollIntoViewIfNeeded`
      删掉或把这一节挪到浮层更深处，红只会出现在"人看图"那一格（而那一格经常被跳过），
      而它红的时候已经太晚了 —— 同 §7 第 82 条"错误屏也非空白"是一个家族：
      **判据要能自己变红，不能靠人替它红**。
    */
    const panelBox = await panel.boundingBox();
    expect(panelBox, '量不到「同步」那一节的盒子').not.toBeNull();
    const viewportSize = page.viewportSize();
    expect(
      panelBox!.y >= 0 && panelBox!.y < (viewportSize?.height ?? 0),
      `截图时那一节的顶边在 y=${String(Math.round(panelBox!.y))}，不在视口里 ⇒ 那张图拍的不是它`,
    ).toBe(true);

    // 🔴 先截图再断言（§6.2 规定一第 1 条）：这张图是"同步设置搬到设置里之后
    //    到底长什么样"的唯一人眼证据，红的时候也必须留着它。
    await parkCursor(page);
    await page.screenshot({ path: SHOT('settings-sync-section') });

    // 共享那枚状态条骨架的**消费者从页头改成了这里**，不是被删：
    // 拿掉它会同时让 `check:ui-provider` 红（那枚组件登记在 PROVIDER_DEPENDENT 里）。
    await expect(
      panel.getByTestId('sync-status-bar'),
      '「同步设置」那一节里没有状态条 ⇒ 搬家的收尾是把旧的删了',
    ).toBeVisible();

    /*
     * 字段这一半：地址与令牌必须在（口令在未登录时也在）。
     *
     * 🔴 2026-10-25 改定位方式：`getByLabel('服务端地址')` 会命中**两枚** ——
     * `sync-server-url` 那枚 input，**以及**包着它的 `<fieldset>`（它的 `<legend>`
     * 就是「服务端地址」；Playwright 的 `getByLabel` 把 legend 也算作该分组的标签）。
     * 实测读数：`[{"tag":"fieldset","cls":"sync-settings__fieldset"},{"tag":"input","id":"sync-server-url"}]`。
     * 所以"地址输入框不止一处"这条报错是**探针自己的**，不是产品有两份。
     * ⇒ 按角色收窄到 `textbox`（fieldset 不是 textbox），条数才等于"输入框的份数"。
     */
    for (const [label, id] of [['服务端地址', '#sync-server-url'], ['访问令牌', '#sync-token']] as const) {
      // ⚠️ 用**元素的 id**，不用 `getByLabel` 也不用 `getByRole(name)`：
      //    · `getByLabel` 会把包着它的 `<fieldset>`（legend = 服务端地址）一起算进来 ⇒ 数成 2；
      //    · `getByRole('textbox', { name })` 在这块表里数到 0（无障碍名不是从可见 label 算出来的），
      //      于是"地址输入框不止一处"变成"一个都没有" —— 两种探针都会说谎，id 不会。
      const field = panel.locator(id);
      await expect(
        field,
        `那一节里没有「${label}」的输入框 ⇒ 表单只搬了一半`,
      ).toHaveCount(1);
    }
    await expect(
      panel.getByRole('button', { name: '保存并同步' }),
      '那一节没有「保存并同步」⇒ 填了也没法生效',
    ).toHaveCount(1);
  });

  test('S5 R7 数据状态三行：待上传 / 上次成功同步 / 本地优先，人眼读得懂', async ({ page }) => {
    await seedSignedIn(page);
    await openApp(page, APP_ZH);
    await openSettingsView(page);
    await selectSettingsSection(page, 'sync');

    const panel = page.getByTestId('sync-settings-panel');
    await expect(panel, '设置浮层里没有「同步」那一节').toBeVisible();
    await panel.scrollIntoViewIfNeeded();

    const pending = panel.getByTestId('sync-pending-count');
    const lastSynced = panel.getByTestId('sync-last-synced');
    const localFirst = panel.getByTestId('sync-local-first');
    await expect(pending, '没有「待上传」那一行 ⇒ 用户看不出有没有东西没上去').toBeVisible();
    await expect(lastSynced, '没有「上次成功同步」那一行').toBeVisible();
    await expect(localFirst, '没有「本地优先」那句解释').toBeVisible();

    // 全新安装 + 未同步过：这两行必须说事实，而不是留空或说"已同步"。
    await expect(pending).toHaveText(/本机的改动都已经上传|正在读取本机待上传的改动/);
    await expect(lastSynced).toHaveText(/还没有成功同步过/);
    await expect(localFirst).toHaveText(/先写在这台设备上/);

    const panelBox = await panel.boundingBox();
    expect(panelBox, '量不到「同步」那一节的盒子').not.toBeNull();
    const viewportSize = page.viewportSize();
    expect(
      panelBox!.y >= 0 && panelBox!.y < (viewportSize?.height ?? 0),
      `截图时那一节的顶边在 y=${String(Math.round(panelBox!.y))}，不在视口里 ⇒ 那张图拍的不是它`,
    ).toBe(true);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('settings-data-status') });
  });

  test('S4 🔴 同步设置只有一处，而那一处住在设置浮层里', async ({ page }) => {
    await openApp(page, APP_ZH);

    // 齿轮必须真的没了 —— 产品负责人第 2 条的病根就是它**长得像**全局设置。
    await expect(
      page.getByTestId('sync-settings-entry'),
      'rail 上还有那颗「同步设置」齿轮 ⇒ 旧入口没删（AGENTS §3.5：抽取的收尾是删掉旧的那份）',
    ).toHaveCount(0);
    // 「查看帮助」也跟着表单搬进设置，不再常驻 rail 那一列。
    await expect(
      page.locator('.ht-rail__sync [data-testid="sync-help-link"]'),
      'rail 里还留着「查看帮助」⇒ 它现在住在 设置 → 同步 那一节',
    ).toHaveCount(0);
    // 未打开设置时，屏幕上不该有同步表单（它不是常驻的同级浮层了）。
    await expect(
      page.locator('#sync-server-url'),
      '没进设置就能读到服务端地址输入框 ⇒ 那一节其实是常驻浮层',
    ).toHaveCount(0);

    await openSettingsView(page);
    await selectSettingsSection(page, 'sync');
    // 「有且只有一处」：多处会红，缺一处也会红。
    // ⚠️ 计数用的是 DOM 里的节点（section 即使 `hidden` 也还在），所以这一条在
    // "只有一节"这件事上仍然成立；而"可见"由上面那句 `selectSettingsSection` 负责。
    await expect(page.getByTestId('sync-settings-panel'), '同步设置不止一处').toHaveCount(1);
    // 同 S3 的理由与同一个读法：按元素 id 数（`getByLabel` 会把 fieldset 的 legend 算进来，
    // `getByRole(name)` 在这块表里又数到 0 —— 两种探针都会说谎）。
    await expect(page.locator('#sync-server-url'), '地址输入框不止一处').toHaveCount(1);

    await closeSettingsSheet(page);
    await expect(
      page.getByTestId('sync-settings-panel'),
      '关掉设置之后那一节还在 DOM 里 ⇒ 它其实不是设置的一部分',
    ).toHaveCount(0);
  });

  /**
   * ── S6：**待上传 > 0** 那一态（A 包验收记录 §三 第 1 条的缺口①）──────────────
   *
   * A 包当时只有 jsdom；这一条把它搬到真浏览器上，并且**真造出 3 条未上传改动**
   * （不是往 store 里塞一个数字 —— 那只能证明渲染分支，证明不了计数真的来自库）。
   *
   * 为什么它以前"看不见"：`refreshPendingUpload()` 只挂在启动与同步结束两处，
   * 于是"刚写完 3 条、还没同步"这一态在界面上根本没有刷新点。
   * 补的那一刀在 `features/sync/store.ts` 末尾（`onEngineChange` + 一次微任务合并）。
   *
   * 🔴 判据怎么才会红（本轮实测）：把 `refreshPendingUpload` 里的和换回常量 0
   * （或只数 pending ⇒ 这一态仍是 3，所以那一刀要配 S7 才红；S6 单独红要靠把
   * `onEngineChange` 那一段注掉 ⇒ rail 与设置两处都退回"都已经上传"）。
   */
  test('S6 🔴 待上传 > 0：rail 与 设置→同步 两处都说得出「3 项还没上传」', async ({ page }) => {
    await seedSignedIn(page);
    // `local-only` 就够：这一态的全部读数都是**本地**的（不联网也必须有）。
    await openApp(page, APP_ZH);

    // 真造 3 条未上传改动：每条 `addTask` = 一次本地写入 = 一条 `pending` op。
    for (const title of ['待上传证据甲', '待上传证据乙', '待上传证据丙']) {
      await addTask(page, title);
    }

    const action = page.getByTestId('sync-rail-action');
    // 整句状态后面挂「· 3 项还没上传」——读屏与 hover 是同一句。
    await expect(action, 'rail 那一枚没说出现在有 3 条改动没上传').toHaveAttribute(
      'aria-label',
      /· 3 项还没上传/,
    );
    await expect(
      page.getByTestId('sync-rail').locator('[role="status"]'),
      'live region 与 aria-label 是两件事，这句也得在',
    ).toHaveText(/3 项还没上传/);

    /*
      🔴 rail 的证据**必须是 hover 态**（见 `shootRailTooltip` 那段说明）：
      静止态那枚只画图标，图里读不到「3 项还没上传」。
    */
    const viewport = page.viewportSize();
    const vh = viewport?.height ?? 720;
    await shootRailTooltip(page, 'rail-pending-3-hover', /3 项还没上传/);
    await parkCursor(page);

    // 第二处读数：设置 → 同步 那一行。
    await openSettingsView(page);
    await selectSettingsSection(page, 'sync');
    const panel = page.getByTestId('sync-settings-panel');
    await expect(panel).toBeVisible();
    await panel.scrollIntoViewIfNeeded();
    await expect(
      page.getByTestId('sync-pending-count'),
      '设置里那一行没说"还有 3 项改动没上传" ⇒ 与 rail 的读数分了家',
    ).toHaveText(/还有 3 项改动没上传/);
    await expect(page.getByTestId('sync-pending-count')).toHaveText(/3/);
    // 反向：这一刻它**不许**说"都已经上传"。
    await expect(page.getByTestId('sync-pending-count')).not.toHaveText(/都已经上传/);

    const panelBox = await panel.boundingBox();
    expect(panelBox, '量不到「同步」那一节的盒子').not.toBeNull();
    expect(
      panelBox!.y >= 0 && panelBox!.y < vh,
      `截图时那一节的顶边在 y=${String(Math.round(panelBox!.y))}，不在视口里 ⇒ 那张图拍的不是它`,
    ).toBe(true);
    await parkCursor(page);
    await page.screenshot({ path: SHOT('settings-pending-3') });
  });

  /**
   * ⚠️ S7 **从上面那个 describe 里拆出来**，因为它是本文件里唯一一条
   * "要让请求真的打到假服务端上"的用例，而它需要一个额外的上下文选项。
   * 拆出来之后 S1–S6 的运行环境**一个字都没变**。
   */
});

test.describe('S7 · 服务端永久拒绝（需要接管全部出站请求）', () => {
  /**
   * 🔴 **必须关掉 Service Worker。**
   *
   * 第一趟实测（2026-11-07）：`page.route` 注册得好好的，而同步却读到
   * `HTTP 503` —— 因为生产构建里注册了 PWA 的 Service Worker，
   * 而 **SW 的请求不经过 `page.route`**：它自己 `fetch` 出去、自己决定回什么。
   * 也就是说"注入的成功/失败"根本没落到被测的那条路径上，
   * 红的原因和被测的东西无关（这是环境陷阱 #191 那一族：
   * **注入必须先证明目标请求真的命中了屏障**）。
   *
   * 关掉 SW 之后请求才真正走 `page.route`；而"请求到了假服务端"这件事
   * 由用例里的 `posted` 数组**数出来**（`posted.length >= 3`），
   * 不是靠"我注册了 handler"这句自述。
   */
  test.use({ serviceWorkers: 'block' });

  /**
   * ── S7：**服务端永久拒绝**的改动仍然算「没到服务端」（A 包 §三 第 4 条的缺口）──
   *
   * ## "假"的只有服务端的响应体，不是产品行为
   *
   * 与 `inbox.spec.ts` / `account-email-change-and-sessions.spec.ts` 同一条纪律：
   * 真 DOM、真 op-log（这里是真 SQLite + Worker 桥）、真 `fetch`、真 store。
   * 唯一造出来的是「服务端对每条 op 回 `accepted:false` + `INVALID_CLIENT_ID`」。
   *
   * ⇒ `markRejected` 走的是**真路径**（`client.ts` 的硬拒绝分支 → `engine.markRejected`
   * → 存储层把 `uploadStatus` 写成 `'rejected'`），不是往库里塞一个假状态。
   *
   * ## 这条判据在量什么
   *
   * 3 条改动被**永久拒绝**之后：
   *   · `pending` 变 0（它们被移出队列，否则每次同步都会重传再被拒）；
   *   · `rejected` 变 3（数据没上云，也不会自动补传）；
   *   · 界面那句「N 项还没上传」必须是 **3**，不是 0。
   *
   * 🔴 判据怎么才会红（本轮实测）：把 `refreshPendingUpload` 里的
   * `pending + rejected` 换回只数 `pending` ⇒ 这一条当场红在
   * 「本机的改动都已经上传。」上 —— 而那一刻**一分数据都没上去**。
   * 阳性对照（证明拒绝真的发生了，而不是"3 条还在队列里所以也是 3"）：
   * 同一屏的状态条必须说出「被服务端拒绝」那句。
   */
  test('S7 🔴 被服务端永久拒绝的改动，仍然计进「N 项还没上传」', async ({ page }) => {
    const SERVER = 'http://sync.reject.e2e.test';
    const posted: string[] = [];

    await seedSignedIn(page, SERVER);
    // 补签 / 公共事实 / 权益探测 / 载荷模式：**开机就会打**的四条，与本主题无关，
    // 但不登记它们会在这里失败（而失败看着像"同步坏了"）。
    await stubLegalRecheck(page, SERVER);
    await stubPublicFacts(page, SERVER);
    await page.route(`${SERVER}/api/sync/status**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ latestSeq: 0 }),
      });
    });
    await page.route(`${SERVER}/api/sync/payload-mode**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mode: 'e2ee' }),
      });
    });

    /*
      🔴 上传端点：**逐条拒绝**，而整体仍回 200。
      这正是服务端的真实形状（`client.ts` 的注释：「HTTP 200 **不代表** op 被接受」），
      也是"只看 res.ok 就会报已同步而数据一条没上云"那个缺陷的载体。
      `INVALID_CLIENT_ID` 在 `PERMANENT_REJECTION_CODES` 里 ⇒ 走 `markRejected`。
    */
    await page.route(`${SERVER}/api/sync/ops**`, async (route) => {
      const req = route.request();
      if (req.method() === 'GET') {
        // 下载段：一页空的、没有更多。
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ops: [], hasMore: false, latestSeq: 0 }),
        });
        return;
      }
      const body = JSON.parse(req.postData() ?? '{}') as { ops?: { id: string }[] };
      const ops = body.ops ?? [];
      posted.push(...ops.map((op) => op.id));
      /*
        🔴 **只拒前两条，最后一条不出现在 `results` 里**（⇒ 它留在待上传队列）。
        这样界面上那个 3 才是 **1 条 pending + 2 条 rejected** ——
        一个"只数 pending"的实现会读到 **1**（而不是 3），
        一个"只数 rejected"的实现会读到 2。两个错法都在这条判据的射程里。
        ⚠️ 全拒（第一版就是这么写的，0 + 3）只能证明"rejected 被算进来了"，
        不能证明"它和 pending 相加" —— 这才是总包点名要的那一格。
      */
      const keepsPending = ops.length > 0 ? ops[ops.length - 1]!.id : undefined;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          latestSeq: 0,
          newOps: [],
          hasMorePiggyback: false,
          results: ops
            .filter((op) => op.id !== keepsPending)
            .map((op) => ({
              opId: op.id,
              accepted: false,
              errorCode: 'INVALID_CLIENT_ID',
              error: 'e2e：这条 op 不属于本机（判据要的是"永久拒绝"这一分支）',
            })),
        }),
      });
    });
    // 实时通道：塞了凭据后应用会去连，接管掉即可（本用例不验实时同步）。
    await page.routeWebSocket(`ws://sync.reject.e2e.test/api/sync/ws*`, () => {
      /* 保持连接打开即可 */
    });

    // `accepted`：同步要真的出门（`local-only` 下一个字节都不发，闸门根本不放行）。
    await openApp(page, APP_ZH, 'accepted');

    for (const title of ['被拒证据甲', '被拒证据乙', '被拒证据丙']) {
      await addTask(page, title);
    }
    await expect(
      page.getByTestId('sync-rail-action'),
      '同步之前就该看到 3 项（这一半是 S6 的读数，这里当前置）',
    ).toHaveAttribute('aria-label', /· 3 项还没上传/);

    // 真同步一次：设置 → 同步 → 填 E2EE 口令 → 保存并同步。
    await openSettingsView(page);
    await selectSettingsSection(page, 'sync');
    await page.locator('#sync-password').fill('e2e-reject-passphrase');
    await page.getByTestId('sync-unlock-and-sync').click();

    // ① 阳性对照：拒绝**真的**发生了（否则下面那个 3 可能只是"还在队列里"）。
    const error = page.getByTestId('sync-status-error');
    await expect(error, '没出现"被服务端拒绝"那条 ⇒ 这一条没有量到拒绝分支').toBeVisible();
    await expect(error).toHaveText(/被服务端拒绝/);
    expect(posted.length, '上传请求里一条 op 都没有 ⇒ 同步根本没走到上传段').toBeGreaterThanOrEqual(3);

    // ② 判据本体：**1 条还在队列 + 2 条被永久拒绝 = 3**，那句 N 必须还是 3。
    //    ⚠️ 读数带上口径：`N = pending + rejected`。只数 pending 会说 1，只数 rejected 会说 2
    //    —— 两个错法都被这一条挡着（夹具的构造见上面 `keepsPending`）。
    const pendingLine = page.getByTestId('sync-pending-count');
    await expect(
      pendingLine,
      '被永久拒绝之后那句读数是"1 / 2 / 都已经上传" ⇒ 界面在说假话（1 条还在队列 + 2 条被拒 = 3）',
    ).toHaveText(/还有 3 项改动没上传/);
    await expect(pendingLine).not.toHaveText(/都已经上传/);

    // ③ 这一张**趁设置还开着**拍。
    // 🔴 第一版是在关掉设置之后再 `openSettingsView()` 一次去补拍，结果那一趟
    //    renderer 直接崩了（`locator.click: Target crashed`，在第二次打开设置的
    //    分组按钮上）。崩的原因与被测的判据无关（重复挂载一大片面板 + 4.5 MB 的包），
    //    但"一条会崩的用例"不是证据 ⇒ 改成一次打开、两个位置各拍一张。
    const panel = page.getByTestId('sync-settings-panel');
    await panel.scrollIntoViewIfNeeded();
    await parkCursor(page);
    await page.screenshot({ path: SHOT('settings-pending-rejected-3') });

    // ④ rail 那一枚同一句（两处读数不许分家），同 `shootRailTooltip` 的理由拍 hover 态。
    await closeSettingsSheet(page);
    await expect(page.getByTestId('sync-rail-action')).toHaveAttribute(
      'aria-label',
      /· 3 项还没上传/,
    );
    await shootRailTooltip(page, 'rail-pending-rejected-3-hover', /3 项还没上传/);
    await parkCursor(page);
  });
});
