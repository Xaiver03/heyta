/**
 * 收集框的日期胶囊与面板 —— **真浏览器**验收（2026-11-04 对齐滴答清单纯 S5）
 * ==========================================================================
 *
 * jsdom 那一份（`apps/web/tests/capture-composer.spec.tsx`）管形状与不变量；
 * 这里管它量不到的三件事：
 *
 *   1. **App 真的把胶囊挂进了输入行**（jsdom 直接渲染组件，宿主漏挂看不见）；
 *   2. 点开的那块面板在**真布局**里画得出来、锚在胶囊下面、**整块在视口内**
 *      —— 这条不是形式主义：`DueEditor` 当年实测过"面板 fixed 且滚动即关，
 *      最后两周在屏幕外 ⇒ 那个日子在界面上根本点不到"；
 *   3. 暗色那一档真的翻成了暗色（`helpers.ts` 那条假绿记录：`emulateMedia`
 *      只改系统偏好，应用一旦记住"用户显式选过"就不再读它 ⇒ 用例名写着暗色、
 *      量的却是亮色。所以这里点真开关）。
 *
 * §6.2 规定一：**先截图再断言**，固定路径，失败也要有图；console/pageerror
 * 在窗口一创建就挂。
 */

import { expect, test, type Page } from '@playwright/test';

import { switchTheme, switchView } from './helpers.js';

const SENTENCE = '今天下午八点给张教授发PPT';

/**
 * 证据直接落进本单自己的目录，不落 `test-results/`。
 *
 * 🔴 2026-11-04 实测换来的：`test-results/` 是**整个 e2e 套件共用**的输出目录，
 * 两条会话同时跑 Playwright 时会互相清掉对方的 trace
 * （报出来是 `browserContext.close: ENOENT ... .playwright-artifacts-N/...trace`，
 * 看着像用例坏了，其实是载体被踩）。日历那条线早就直接写 `apps/web/evidence/…`，这里跟同一个惯例。
 */
const SHOT = (name: string): string =>
  `../apps/web/evidence/capture-due-capsule-20261104/capture-due-capsule-${name}.png`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function openApp(page: Page): Promise<void> {
  await page.goto('/?lang=zh-CN', { waitUntil: 'networkidle' });
  const later = page.getByRole('button', { name: /以后再说|Decide later/ });
  if (await later.count()) {
    await later.click();
    await page.waitForTimeout(400);
  }
  await page.waitForSelector('[data-testid="task-list"]', { timeout: 30_000 });
}

/**
 * 一帧：打字 → 看胶囊 → 点开面板 → 量几何 → 在面板里改一天 → 取证。
 *
 * @param narrow 375 档：面板必须**整块**在视口里，且不能盖住输入行自己
 */
async function shootFrame(page: Page, name: string, narrow: boolean): Promise<void> {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: narrow ? 375 : 1440, height: narrow ? 720 : 900 });
  await openApp(page);

  const input = page.getByTestId('capture-input');
  const capsule = page.getByTestId('capture-due-capsule');
  const submit = page.getByTestId('capture-submit');

  // ① 输入行三件都在，而且**只有**这三件（第四件就是"铺开式控件"复发）。
  await expect(input).toBeVisible();
  await expect(capsule).toBeVisible();
  await expect(submit).toBeVisible();

  // ② 打字：截止由胶囊说，框下那一行此刻**一行都不挂**。
  await input.fill(SENTENCE);
  await page.waitForTimeout(300);
  await expect(capsule).toContainText('20:00');
  await expect(page.getByTestId('capture-matches'), '框下又长出一行识别芯片').toHaveCount(0);
  await expect(page.getByTestId('capture-preview'), '「实际标题」那一行不许回来').toHaveCount(0);
  await page.screenshot({ path: SHOT(`${name}-1-row`) });

  // ③ 点开面板。
  await capsule.click();
  const panel = page.getByTestId('capture-due-popover');
  await expect(panel, '胶囊点不开面板').toBeVisible();
  // RNW 的 Yoga 布局落地后再往下走，证据图里要有真月历而不是空壳。
  await page.waitForTimeout(400);

  // ④  几何：锚在胶囊下方，且**整块在视口内**（视口外的日子用户点不到）。
  const capsuleBox = (await capsule.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(capsuleBox, '胶囊量不到 boundingBox').not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(panelBox.x, '面板左缘出了视口').toBeGreaterThanOrEqual(0);
  expect(panelBox.x + panelBox.width, '面板右缘出了视口').toBeLessThanOrEqual(viewport.width + 1);
  expect(panelBox.y + panelBox.height, '面板底边出了视口 ⇒ 那几周的日子点不到')
    .toBeLessThanOrEqual(viewport.height + 1);
  /*
   * 🔴 上面那两条**允许面板贴死在视口两侧**（`>= 0` / `<= viewport`），
   *    所以"横贯一整屏的色带"在旧判据下是全绿的。2026-11-05 看图量到：
   *    1440 那档时刻列表把面板撑到与视口齐边（左 0 / 右 1440），
   *    它已经不像"贴着胶囊的那块面板"，而像一整条覆盖侧栏的带子。
   *    这一条钉的是**齐边不许**，不是"越界不许"—— 越界那半已经有判据了。
   */
  expect(panelBox.x, `面板左缘与视口齐边（x=${String(panelBox.x)}）⇒ 它不是贴着胶囊的面板`).toBeGreaterThan(0);
  expect(
    panelBox.x + panelBox.width,
    `面板右缘与视口齐边（right=${String(panelBox.x + panelBox.width)}，视口 ${String(viewport.width)}）`,
  ).toBeLessThan(viewport.width);
  // 锚定：贴在胶囊下沿（留 placeAnchoredPanel 那个 gap 的余量），不是飘在屏幕中央。
  expect(Math.abs(panelBox.y - capsuleBox.y - capsuleBox.height), '面板没锚在胶囊下方')
    .toBeLessThan(40);

  // ⑤ 面板里那张月历真的画出来了（宽度撑得住 7 列）。
  const picker = panel.getByTestId('date-picker');
  await expect(picker).toBeVisible();
  const pickerBox = (await picker.boundingBox())!;
  expect(pickerBox.width, `面板里月历只有 ${String(pickerBox.width)}px 宽，画不出来`)
    .toBeGreaterThan(narrow ? 240 : 300);

  /*
   * 📸 `-2-panel` 这一张**挪到这里**拍。
   *    起因是我拿 md5 比对两趟批跑，看到 375 那几张字节不同，先怀疑"图拍到了半布局状态"
   *    （因为 `waitForTimeout(400)` 是一枚定时赌注，而几何断言跑在拍图之后）。
   *    ⚠️ 那个假设**被实测否证**了：同一份代码连跑两趟，`magick compare -metric AE` 是
   *    **每枚 1 个像素**，位置在页头行（y≈21），不在收集框控件里 —— 是像素噪声，不是半布局。
   *    但顺序仍然要改，理由换成站得住的那条：**图只能作为"已经过了判据的形状"的证据**，
   *    所以拍图必须排在所有不滚动的断言之后；而它又必须排在 `scrollIntoView` 之前，
   *    否则证据里看到的是滚过之后的面板，不是用户第一眼看到的那一屏。
   */
  await page.screenshot({ path: SHOT(`${name}-2-panel`) });

  /*
   * 🔴 ⑤.2 出口可达性。375 暗色看图量到：日期视图里「时刻 …」那一行**正好压在折叠线上**，
   *    截图里只露出上半行。这本身不是缺陷（内容比可视区高就该滚），但它把本单最贵的那族
   *    事故变成必须一直成立的东西：**出口被裁住而容器不给滚 ⇒ 看不见也点不到，而旧断言全绿**
   *    （Playwright 的 click 自己会滚，所以"点得到"从来不是这一格的证据）。
   *    这里量两件事：溢出时容器必须可滚；滚完那一行要**整条**进可视区。
   *    ⚠️ 它必须排在上面那张图**之后** —— 这一段自己会滚动面板。
   */
  const timeRow = panel.getByTestId('capture-time-row');
  const scrollBox = await page.getByTestId('capture-due-scroll').evaluate((el) => ({
    clientBottom: el.getBoundingClientRect().bottom,
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  // 读数打出来：这一格的意义全在"分支走到没有"——不打出来，绿的用例和恒假的用例长得一样。
  console.info(
    `[出口可达] ${name}：内层可视 ${String(scrollBox.clientHeight)}px / 内容 ${String(scrollBox.scrollHeight)}px`
    + ` ⇒ 溢出 ${String(scrollBox.scrollHeight - scrollBox.clientHeight)}px，overflow-y=${scrollBox.overflowY}`,
  );
  if (scrollBox.scrollHeight > scrollBox.clientHeight) {
    expect(
      ['auto', 'scroll'],
      `面板内容溢出 ${String(scrollBox.scrollHeight - scrollBox.clientHeight)}px，`
      + `而 overflow-y=${scrollBox.overflowY} ⇒ 底部那几条出口滚不到`,
    ).toContain(scrollBox.overflowY);
    await timeRow.scrollIntoViewIfNeeded();
  }
  const rowBox = (await timeRow.boundingBox())!;
  expect(
    rowBox.y + rowBox.height,
    `「时刻」出口没整条落进可视区（可视底边 ${String(scrollBox.clientBottom)}，`
    + `行底 ${String(rowBox.y + rowBox.height)}，溢出 ${String(scrollBox.scrollHeight - scrollBox.clientHeight)}px）`,
  ).toBeLessThanOrEqual(scrollBox.clientBottom + 1);

  // ⑤.5 🔴 **面板里的每一条撤销出口都要点得到**。
  //
  // 这条是看图看出来的，不是断言抓出来的：375×720 那一帧，面板外壳"没越视口"，
  // 而底边「文字里读到的日期」那两条的 × 压在底部导航（`.ht-compact-rail`）下面 ——
  // 上一版只量了外壳，于是几何全绿、用户点不到。
  // 现在的契约是"**能滚到，滚到之后既在视口内、也不被底部栏压住**"。
  const rail = page.locator('.ht-compact-rail');
  const railCount = await rail.count();
  // 🔴 窄档**必须有**底部导航，否则下面那两条"不许被压住"会因 `railBox === null`
  //    静默跳过 —— 而这一整格就是为了抓 375 那一帧 × 被底部栏压住才写的。
  //    一条在关键档位上可能整段不执行的判据，等于没有判据（AGENTS.md §6 第 2 条）。
  if (narrow) {
    expect(
      railCount,
      '窄档没有 `.ht-compact-rail` ⇒ 这一格的"不被底部栏压住"是空跑，先确认底部栏的类名/渲染',
    ).toBeGreaterThan(0);
  }
  const railBox = railCount > 0 ? await rail.first().boundingBox() : null;
  const toggles = panel.locator('[data-testid^="capture-due-item-toggle-"]');
  const toggleCount = await toggles.count();
  expect(toggleCount, '面板里没有逐条撤销出口 ⇒ 不变量"每条都能单独取消"没有出口').toBeGreaterThan(0);
  for (let i = 0; i < toggleCount; i += 1) {
    const node = toggles.nth(i);
    await node.scrollIntoViewIfNeeded();
    await expect(node, `第 ${String(i + 1)} 条撤销出口滚过之后仍然不在视口里`).toBeInViewport();
    if (railBox !== null) {
      const box = (await node.boundingBox())!;
      expect(
        box.y + box.height,
        `第 ${String(i + 1)} 条撤销出口压在底部导航下面 ⇒ 用户在界面上点不到它`,
      ).toBeLessThanOrEqual(railBox.y + 1);
    }
  }

  // ⑥ 在面板里改一天 = 覆盖，而**覆盖不许把用户写的字吞掉**。
  await picker.getByRole('button', { name: '明天' }).click();
  await page.waitForTimeout(300);
  await expect(capsule).toContainText('明天');
  await expect(capsule).toContainText('20:00');
  await expect(input).toHaveValue(SENTENCE);
  await page.screenshot({ path: SHOT(`${name}-3-picked`) });

  // ⑥.5 🔴 时刻子视图（计划 S3 点名的 30 分步进列表）。
  //       量三件真浏览器才量得到的事：列表**取代**月历（不是叠在下面）、
  //       那一格滚得到也点得到、以及「其它时间」把 20:15 这一档留着。
  await panel.getByTestId('capture-time-row').click();
  await expect(panel.getByTestId('capture-time-slots'), '点「时刻」没有进步进列表').toBeVisible();
  await expect(panel.getByTestId('date-picker'), '列表叠在月历下面 ⇒ 面板高到要滚着找日历').toHaveCount(0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOT(`${name}-4-time-list`) });

  const slot = panel.getByTestId('capture-time-slot-21:00');
  await slot.scrollIntoViewIfNeeded();
  await expect(slot, '21:00 这一格滚过之后仍然不在视口里').toBeInViewport();
  if (railBox !== null) {
    const slotBox = (await slot.boundingBox())!;
    expect(slotBox.y + slotBox.height, '21:00 压在底部导航下面 ⇒ 点不到').toBeLessThanOrEqual(railBox.y + 1);
  }
  await slot.click();
  await expect(capsule).toContainText('21:00');

  // 「其它时间」：列表**必须让位**给自由输入（两者不许同时在），且 20:15 填得进去。
  await panel.getByTestId('capture-time-mode').click();
  await expect(panel.getByTestId('capture-time-input')).toBeVisible();
  await expect(panel.getByTestId('capture-time-slots'), '列表与自由输入同时在场 = 同一目的地两个控件').toHaveCount(0);
  await panel.getByTestId('capture-time-input').fill('20:15');
  await expect(capsule).toContainText('20:15');
  await page.screenshot({ path: SHOT(`${name}-5-other-time`) });

  // 回日期视图，收尾要停在"看得见月历"那一档
  await panel.getByTestId('capture-time-mode').click();
  await panel.getByTestId('capture-time-back').click();
  await expect(panel.getByTestId('date-picker')).toBeVisible();

  // ⑦ 收面板。🔴 用 **Esc** 而不是"点外面"：375 档面板几乎占满视口，
  // 剩下的空白点得到点不到取决于当天排版，那条断言量的其实是坐标运气。
  // `popover` 那一档的出口有两条（scrim 与 Esc），这里钉与视口无关的那一条；
  // scrim 那条由 `dirty-form-guard.spec.ts` 在宽档那侧负责。
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  expect(errors, '控制台与页面不应有错误').toEqual([]);
}

test.describe('收集框：输入行里的日期胶囊与它点开的面板', () => {
  test('1440 亮色：三件套、面板锚定与视口、覆盖不吞字', async ({ page }) => {
    await shootFrame(page, '1440-light', false);
  });

  test('1440 暗色：同一格在暗底上仍然读得出来（胶囊描边/面板底色）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await switchTheme(page, 'dark');
    await shootFrame(page, '1440-dark', false);
  });

  test('375 亮色：窄档面板不越视口', async ({ page }) => {
    await shootFrame(page, '375-light', true);
  });

  test('375 暗色：窄档 + 暗底', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await openApp(page);
    await switchTheme(page, 'dark');
    await shootFrame(page, '375-dark', true);
  });

  /*
   * 🔴 英文那一档。本单新增 9 条 `*.capture.panel.*` / `capsule.*` 词条，
   * 而四帧取证全是 `?lang=zh-CN` ⇒ **英文那条腿只有静态门核过，没有渲染证据**。
   * 这正是本仓记过的"只剩一条腿量得到"那一族（暗色那一档当初也是这样）。
   *
   * 断言全部用 `packages/i18n/src/locales/en.ts` 里**逐字抄下来**的值，
   * 不凭记忆写英文 —— 凭记忆写的英文断言会跟着措辞一起漂。
   */
  test('英文档：胶囊与面板的措辞真的来自 en 词条（不是静默回落中文）', async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?lang=en', { waitUntil: 'networkidle' });
    const later = page.getByRole('button', { name: /Decide later|以后再说/ });
    if (await later.count()) {
      await later.click();
      await page.waitForTimeout(400);
    }
    await page.waitForSelector('[data-testid="task-list"]', { timeout: 30_000 });

    const input = page.getByTestId('capture-input');
    const capsule = page.getByTestId('capture-due-capsule');
    await input.fill('2026-12-25 20:00 write the draft');
    await page.waitForTimeout(300);

    // ① 有值时胶囊的 aria 是英文那一句模板填出来的。
    await expect(capsule).toHaveAccessibleName(/^Due .+, tap to change$/);
    await expect(capsule).toContainText('20:00');
    // ② 空态那句也必须是一整句英文（不是把值拼进前缀，也不是回落中文）。
    await input.fill('write the draft');
    await page.waitForTimeout(300);
    await expect(capsule).toHaveAccessibleName('Choose a due date');
    await input.fill('2026-12-25 20:00 write the draft');
    await page.waitForTimeout(300);

    // ③ 打开面板：标题、快捷项、清除、识别项分组名全是 en 那一份。
    await capsule.click();
    const panel = page.getByTestId('capture-due-popover');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('capture-due-panel')).toHaveAccessibleName('Choose a due date');
    for (const pick of ['Today', 'Tomorrow', 'This weekend', 'Next Monday', 'Clear']) {
      await expect(
        panel.getByTestId('capture-due-panel').getByRole('button', { name: pick, exact: true }),
        `快捷项/清除里少了「${pick}」⇒ 这一档回落了中文或没接上词条`,
      ).toBeVisible();
    }
    // ④ 框下那一行此刻念的是英文的「未采用」类说明吗？这里两条都被采纳，
    //    所以分组名出现在面板里，而不是框下多挂一行。
    await expect(panel.getByTestId('capture-due-items')).toHaveAccessibleName(
      'Dates read from what you typed',
    );
    await page.waitForTimeout(300);
    await page.screenshot({ path: SHOT('1440-en-panel') });

    // ⑤ 时刻子视图：入口、返回、其它时间三句都是英文。
    //    ⚠️ 入口的无障碍名挂在**那一行自己身上**（`capture-time-row` 就是那枚按钮），
    //    所以必须对它本身断言，不能"在那枚按钮里面找一个同名按钮"——
    //    上一版就是这么写的，Playwright 等不到元素直接超时。
    const timeRow = panel.getByTestId('capture-time-row');
    await expect(timeRow, '时刻那一行的无障碍名不是 en 那句').toHaveAccessibleName('Choose a time');
    await timeRow.click();
    await expect(panel.getByTestId('capture-time-slots')).toBeVisible();
    await page.screenshot({ path: SHOT('1440-en-time-list') });
    /*
     * 🔴 三个出口各说各话，逐个点名验一遍。
     * 上一版在这里超时，查出来是实现的问题：**「返回」那枚按钮的无障碍名被写成了
     * 「选择时刻」**（`rowAria` 挂错了对象）—— 写着「返回」的按钮念"选择时刻"，
     * 读屏用户按下去之前无法知道它会去哪。措辞对不对，光看可见文字是看不出来的，
     * 必须问 accessible name。
     */
    const otherTime = panel.getByRole('button', { name: 'Other time', exact: true });
    const backToList = panel.getByRole('button', { name: 'List', exact: true });
    const backToDay = panel.getByRole('button', { name: 'Back', exact: true });
    await expect(otherTime).toBeVisible();
    await otherTime.click();
    await expect(panel.getByTestId('capture-time-input')).toBeVisible();
    await expect(panel.getByTestId('capture-time-slots'), '列表与自由输入同时在场 = 同一目的地两个控件').toHaveCount(0);
    // 进了文本档，出口就该换成「列表」，而且「其它时间」不再在场
    await expect(otherTime).toHaveCount(0);
    await expect(backToList).toHaveAccessibleName('List');
    await backToList.click();
    await expect(panel.getByTestId('capture-time-slots')).toBeVisible();
    await expect(backToDay, '「返回」的无障碍名说的必须是返回').toHaveAccessibleName('Back');
    await backToDay.click();
    await expect(panel.getByTestId('date-picker'), '按「返回」没回日期视图').toBeVisible();

    // ⑥ 英文那一档不许残留汉字（措辞回落中文时，这一步会红，而不是静默通过）。
    const panelText = (await panel.innerText()) ?? '';
    expect(/[\u4e00-\u9fff]/u.test(panelText), `面板里出现了汉字：${panelText.slice(0, 120)}`).toBe(false);

    expect(errors, '控制台与页面不应有错误').toEqual([]);
  });

  /*
   * 🔴 第二枚落点：日历里那个**已经浮着的**捕获编辑器。
   *
   * 它吃的是 `renderDuePanel` **不传**那一档（面板就地展开）。这条用例的存在理由
   * 不是"再看一次月历"，而是那一档如果传了锚定浮层会发生什么：
   * 日期面板 Portal 到 `document.body` ⇒ 它不在外层编辑器的 DOM 子树里 ⇒
   * 外层那条 `pointerdown` 外部关闭判据把它当成"点了外面" ⇒
   * 用户点的是月历里的一天，界面却弹出「放弃这次的修改？」。
   * 一个浮层里再弹一个浮层，外层必须先知道内层是谁 —— 而这里根本不该有第二个浮层。
   */
  test('日历落点：日期面板就地展开，点日子不许触发「放弃这次的修改？」', async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await openApp(page);
    await switchView(page, '日历');

    const target = await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    await page.locator(`[data-testid="calendar-cell-${target}"]`).click();
    const editor = page.getByTestId('calendar-capture');
    await expect(editor).toBeVisible();

    // 先写一笔没提交的字：外层那一档此刻是"脏"的，任何误判都会弹出确认框。
    // 🔴 带一段日期短语，是为了让面板里真的出现「文字里读到的日期」那几条 ——
    //    就地展开时外层编辑器自己有 `maxBlockSize`，那些出口会不会被裁到够不着，
    //    是这一档独有的风险（锚定浮层那一档由内层滚动容器兜住，见 §9.2 第 4 条）。
    await page.getByTestId('capture-input').fill('明天还没决定要不要写的任务');
    await page.getByTestId('capture-due-capsule').click();

    // ① 面板必须在**外层编辑器里面**（就地展开），不是 Portal 出去的浮层。
    await expect(editor.getByTestId('capture-due-panel'), '日历落点里日期面板没有就地展开').toBeVisible();
    await expect(page.getByTestId('capture-due-popover'), '日历落点里不该再有一枚锚定浮层').toHaveCount(0);

    /*
     * ①.5 / ①.6 出口**够不够得着** —— 判的是**没有滚之前的状态**。
     *
     * 🔴 这两条的第一版写的是 `scrollIntoViewIfNeeded()` + `toBeInViewport()`，
     *    那是一条**恒真**断言：`overflow: hidden` 的容器仍然可以被**程序**滚动，
     *    于是 Playwright 自己会把元素滚进来，判据永远绿。
     *    怎么发现的：给面板顶部加 700px 内边距（浏览器回读 `computed paddingTop=700px`，
     *    确认真的生效），行底仍然是 `820.328125` —— 数字纹丝不动不是"本来就看得见"，
     *    是"被工具滚进来了"。
     *
     * 现在按 §9.28 锚定浮层那一支的同一种形状判：先量**原始**状态；
     * 只有当它落在可视底边以下时，才要求容器**用户滚得动**（`overflow-y ∈ {auto, scroll}`）。
     * `hidden` + 落在外面 = 裁住且滚不到 = 红。
     */
    const editorView = await editor.evaluate((el) => ({
      clientBottom: el.getBoundingClientRect().bottom,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      overflowY: getComputedStyle(el).overflowY,
    }));
    const outlets = [
      ['逐条撤销', editor.getByTestId('capture-due-panel').locator('[data-testid^="capture-due-item-toggle-"]').first()] as const,
      ['时刻', editor.getByTestId('capture-due-panel').getByTestId('capture-time-row')] as const,
    ];
    for (const [label, node] of outlets) {
      await expect(node, `日历落点的面板里没有「${label}」出口`).toBeVisible();
      const box = (await node.boundingBox())!;
      console.info(
        `[出口可达·就地展开] ${label}：底边 ${String(box.y + box.height)} / 编辑器可视底 `
        + `${String(editorView.clientBottom)} / 内容 ${String(editorView.scrollHeight)}px`
        + ` 可视 ${String(editorView.clientHeight)}px / overflow-y=${editorView.overflowY}`,
      );
      if (box.y + box.height > editorView.clientBottom + 1) {
        expect(
          ['auto', 'scroll'],
          `「${label}」出口落在编辑器可视区以下 `
          + `${String(Math.round(box.y + box.height - editorView.clientBottom))}px，`
          + `而 overflow-y=${editorView.overflowY} ⇒ 用户既看不见也滚不到`,
        ).toContain(editorView.overflowY);
      }
    }

    // ② 点一格日子 ⇒ 值进胶囊，而且**不许弹出「放弃这次的修改？」**。
    //    枚数先量：面板里"下周一"这枚快捷项只许有一枚（同一目的地两个控件是本仓判过的形状）。
    //    🔴 故意选**与打字那段不一致**的一天：输入里写的是「明天」，
    //    若这里也点「明天」，"胶囊念着下周一"这件事就证明不了是覆盖生效还是巧合。
    const nextWeek = editor.getByTestId('capture-due-panel').getByRole('button', { name: '下周一' });
    expect(
      await nextWeek.count(),
      '日期面板里「下周一」出现了不止一枚 ⇒ 要么面板画了两份，要么外层日历的控件混进了这一层',
    ).toBe(1);
    await nextWeek.click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('discard-confirm'), '点日子被读成了"点了外面"').toHaveCount(0);
    /*
     * 🔴 胶囊这里念的是**日期**（「11月9日」），不是那枚按钮的字（「下周一」）。
     * 这条断言原本是 `toContainText('下周一')`，跑出来红 —— 红得对：
     * 「还剩 5 天」这类相对词对 3 天以外的日子**省掉了哪一天**，
     * 而"哪一天"是这个字段唯一致命的错法。分档判断在共享层
     * `captureCapsuleShowsWord`，两端宿主各自复用现成的日期措辞。
     */
    await expect(page.getByTestId('capture-due-capsule')).toContainText(/\d+月\d+日/);
    await expect(page.getByTestId('capture-due-capsule')).not.toContainText('明天');
    await expect(page.getByTestId('capture-due-capsule')).not.toContainText('还剩');
    await expect(page.getByTestId('capture-input'), '覆盖不许把用户写的字吞掉').toHaveValue(
      '明天还没决定要不要写的任务',
    );

    await page.screenshot({ path: SHOT('calendar-inline-panel') });
    expect(errors, '控制台与页面不应有错误').toEqual([]);
  });

  /*
   * 🔴 **没写日期时点时刻**这一格在真浏览器上的腿（2026-11-05，S3c）。
   *
   * 这条缺陷是移动端设备腿量到的（§9.16）：收集箱里标题不带日期词 ⇒
   * 时刻列表 48 格 + 全天 + 自由输入**按下去全部静默**。jsdom 那 5 条新用例
   * 钉的是共享件，web 宿主在真布局里画不画得出来、点下去接不接得住，
   * 只有这条腿量得到 —— 而本单前面每一帧都先打了带日期的句子，
   * 所以"没有日期"那个状态在浏览器里从来没被点过。
   */
  test('收件箱里没写日期 ⇒ 点一格 21:00 落在今天（不是按了没反应）', async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);

    const input = page.getByTestId('capture-input');
    const capsule = page.getByTestId('capture-due-capsule');
    await input.fill('给张教授发PPT');
    await page.waitForTimeout(300);

    // 前置：这一刻**确实没有日期**（否则这条用例又跑在"已经有值"的状态上，白测）。
    // ⚠️ 空态下胶囊只画图标、**不画值那一节**，所以这里只能问可及名，不能 `toHaveText('')`。
    await expect(capsule, '标题里没有日期词，胶囊该停在空态那句').toHaveAttribute('aria-label', /选择截止日期/);

    await capsule.click();
    const panel = page.getByTestId('capture-due-popover');
    await expect(panel).toBeVisible();
    await panel.getByTestId('capture-time-row').click();
    const slot = panel.getByTestId('capture-time-slot-21:00');
    await expect(slot, '时刻列表没画出来').toBeVisible();

    await slot.click();
    await page.waitForTimeout(300);
    await expect(capsule, '点时刻点了个空 —— 设备腿量到的那枚死按钮在 web 上的同一形状').toContainText('21:00');
    await expect(capsule, '无日期的时刻落在今天（capture.ts 文件头那条）').toContainText('今天');
    await expect(input, '补日期不许动用户写的字').toHaveValue('给张教授发PPT');

    // 这一帧正是"没有日期 ⇒ 面板只有时刻列表那一块内容"的宽度，最容易顶满视口。
    const box = (await panel.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.x, `面板左缘与视口齐边（x=${String(box.x)}）`).toBeGreaterThan(0);
    expect(
      box.x + box.width,
      `面板右缘与视口齐边（right=${String(box.x + box.width)}，视口 ${String(vp.width)}）`,
    ).toBeLessThan(vp.width);

    await page.screenshot({ path: SHOT('no-date-time-today') });
    expect(errors, '控制台与页面不应有错误').toEqual([]);
  });
});
