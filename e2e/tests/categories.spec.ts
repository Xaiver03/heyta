import { expect, test } from '@playwright/test';
import { openApp, switchView } from './helpers';

/**
 * 分类着色与分类时长的**真浏览器**契约。
 *
 * 与 `apps/web/tests/categories.spec.tsx`（12 条 jsdom）的分工：
 * 那 12 条钉的是**渲染与文案的细节**（泳道结构、堆叠条段序、强度档位映射），
 * 这一条钉的是**只有真浏览器 + 真 op-log 才能证明的三件事**：
 *
 *   1. 分类区块真的挂进了「成长」页（jsdom 里可以直接 mount 组件，绕过接线）；
 *   2. **色槽赋值走完整往返**：点选 → 真的落进 op-log → 刷新页面后仍然是那个槽
 *      → 再点一次取消 → 刷新后仍然是"没设色"。这是"用户赋义色槽"的核心承诺，
 *      而它在 jsdom 里只能证明"调用了 action"；
 *   3. **真实的专注时间真的进了「未归类」那句数字里**（口径：无任务的专注
 *      归不了类，如实说出来，而不是消失）。
 *
 * ## 判据来自哪些源码
 *
 * - `.ht-categories` 区块与其文案：`apps/web/src/features/categories/CategoryBreakdown.tsx`
 * - 色槽选择器：`apps/web/src/features/categories/ColorSlotPicker.tsx`
 *   （选项 `aria-pressed`、`aria-label='色槽 N'`）
 * - 侧栏清单面板与调色板入口：`apps/web/src/features/projects/ProjectsPanel.tsx`
 * - 「未归类」句与时长格式化：`features/categories/copy.ts` + `@heyta/domain#durationParts`
 * - 专注状态机：`apps/web/src/features/focus/store.ts`（25 分钟工作段）
 *
 * ## 🔴 反需求也在这里钉一条
 *
 * 分类这块最容易长出的不是崩溃，而是**评判**："最多的是…""占比 42%"
 * "这项超标了"。它们都"能显示"，而且都很难在代码评审里被发现 ——
 * 所以有一条用例专门扫这一整块文案。
 */

/** 反需求词表。出现任意一个就是**产品缺陷**，不是文案偏好。 */
const BANNED = [
  '最多',
  '最少',
  '最差',
  '最好',
  '排名',
  '排行',
  '占比',
  '超标',
  '失衡',
  '第一名',
  '冠军',
  '领先',
  '落后',
] as const;

/** 取分类区块的全部可见文案。 */
async function categoryText(page: import('@playwright/test').Page): Promise<string> {
  return ((await page.locator('.ht-categories').textContent()) ?? '').trim();
}

test.describe('分类着色：真浏览器契约', () => {
  test('成长页挂着分类时长区块，空状态如实说明', async ({ page }) => {
    await openApp(page);
    await switchView(page, '成长');

    const section = page.locator('.ht-categories');
    await expect(section, '分类区块必须真的挂进成长页（不是只在 jsdom 里能 mount）').toHaveCount(1);
    await expect(section).toContainText('分类时长');
    await expect(section, '说明里要写明颜色是用户自己赋义的').toContainText('颜色由你自己赋义');
    await expect(section, '没有记录时要说清楚"怎么才会有"').toContainText(
      '还没有可以归类的时间记录',
    );
    // 空状态也不许出现百分号：这个页面**从不**用占比表达任何东西
    expect(await categoryText(page), '分类区块里不该出现百分号').not.toContain('%');
  });

  test('🔴 色槽：赋色 → 刷新后仍在（真 op-log 往返）→ 再点一次取消', async ({ page }) => {
    await openApp(page);

    // ── 建一条清单（真实侧栏表单，真 op）─────────────────────────────
    const newProject = page.locator('input[placeholder="新清单"]');
    await newProject.fill('深度工作');
    await page.getByRole('button', { name: '添加清单' }).click();

    const toggle = page.getByRole('button', { name: '给「深度工作」设置分类颜色' });
    await expect(toggle).toBeVisible();

    /**
     * ⚠️ 选一个色槽之后，面板**自己收起**（见 `ColorSlotPicker` 的
     * `setOpen(false)`）—— 所以断言要**重新展开**再读。
     *
     * 🔴 第一版我点完就直接断言那个按钮的 `aria-pressed`，它当然是红的：
     * 按钮已经不在 DOM 里了。这条错误的断言恰好在提醒一件事 ——
     * 必须证明的是"**读回来的**值是 3"，而不是"刚才点到了 3"。
     */
    async function pick(slot: string): Promise<void> {
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
      await page.getByRole('button', { name: slot }).click();
    }

    // ── 选 3 号色槽 ─────────────────────────────────────────────────
    await pick('色槽 3');

    // 行首那个"当前颜色"指示块必须变成 3 号色 —— 与色板里 3 号块的背景**逐值相同**。
    // 比不比字符串更好：颜色取值来自 token，测试不该把 hex 抄进来一份。
    await toggle.click();
    const swatch3 = await page
      .getByRole('button', { name: '色槽 3' })
      .locator('.ht-slot-picker__swatch')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await expect(toggle.locator('.ht-slot-picker__current')).toHaveCSS(
      'background-color',
      swatch3,
    );
    await expect(page.getByRole('button', { name: '色槽 3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: '色槽 4' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    /**
     * 🔴 **刷新**才是这条用例的重点。
     *
     * 不刷新的话，界面上"看起来选中了"可能只是 React 的局部状态 ——
     * 而"用户给这一类赋了 3 号色"必须是一条**落了盘的 op**：
     * 换一台设备/重开应用也要还在。这一步能失败，且失败的方式是静默的
     * （界面好看、数据没写）。
     */
    await page.reload();
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
    await toggle.click();
    await expect(
      page.getByRole('button', { name: '色槽 3' }),
      '刷新后 3 号色槽仍然是选中的 —— 说明它真的进了 op-log',
    ).toHaveAttribute('aria-pressed', 'true');

    // ── 再点一次同一个槽 = 取消（不需要第 10 个按钮表达"不用颜色"）────
    await pick('色槽 3');
    await toggle.click();
    await expect(page.getByRole('button', { name: '色槽 3' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await page.reload();
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
    await toggle.click();
    await expect(
      page.getByRole('button', { name: '色槽 3' }),
      '取消也要落盘 —— 清空写的是 null（能穿过 JSON），不是 undefined',
    ).toHaveAttribute('aria-pressed', 'false');
  });

  test('🔴 真实的专注时间进入「未归类」，而且它只是读数', async ({ page }) => {
    /**
     * 🔴 **把浏览器时钟接管过来**，否则这条用例要么等 25 分钟、要么只能断言
     * "大约几秒"（显示成「0 分钟」，等于什么都没证明）。
     *
     * `install` 之后**必须 `resume`**：装完的时钟默认不走，而应用启动要等
     * `setTimeout` 才会打开本地库 —— 不 resume 的话症状是"白屏"，看起来像应用坏了。
     * `resume` 让它像正常时钟一样走，需要时再 `fastForward` 跳过专注的那 25 分钟。
     */
    await page.clock.install({ time: new Date(2026, 8, 24, 20, 0, 0) });
    await page.clock.resume();
    await openApp(page);

    await switchView(page, '番茄钟');

    // 不选任务 = 这段专注归不了类（`taskId` 缺省）—— 正是"未归类"那条路径。
    await page.getByRole('button', { name: '开始专注' }).click();
    await expect(page.getByRole('button', { name: '暂停' })).toBeVisible();

    // 跳过整个工作段（领域层的 `advance()` 会把 actualMs 记成 plannedMs = 25 分钟）
    await page.clock.fastForward('26:00');

    await switchView(page, '成长');
    const section = page.locator('.ht-categories');
    await expect(section, '未归类的时间必须**说出来**，不能消失').toContainText('没有归到任何清单或习惯');
    await expect(
      section,
      '25 分钟的专注应当被算成 25 分钟（领域层记的是 plannedMs，不是"跑了几秒"）',
    ).toContainText('25 分钟');
    // 空状态那句此时**不该**再出现 —— 有记录却还显示"还没有记录"是自相矛盾
    await expect(section).not.toContainText('还没有可以归类的时间记录');
  });

  test('🔴 样式真的生效：颜色是 token 展开的真值，未归类不冒充分类行', async ({ page }) => {
    /**
     * 这一条补的是 jsdom 与"区块可见"都补不上的缝：**样式表到底有没有生效**。
     *
     * jsdom 不排版、不算样式（`getComputedStyle` 在那边拿不到 `var()` 展开的值），
     * 而 `toContainText` 只证明文字在 —— 一个 class 名写错、`tokens.css` 没被引入、
     * 变量名拼错，三种情况都会让"文字全在、界面是一坨黑字"照样通过。
     */
    await page.clock.install({ time: new Date(2026, 8, 24, 20, 0, 0) });
    await page.clock.resume();
    await openApp(page);

    // 造一点真数据：一段无任务的专注（它只进"未归类"那句，不画分类行）
    await switchView(page, '番茄钟');
    await page.getByRole('button', { name: '开始专注' }).click();
    await page.clock.fastForward('26:00');
    await switchView(page, '成长');
    await expect(page.locator('.ht-categories')).toContainText('25 分钟');

    // ① 区块自己的布局来自样式表
    const sectionStyle = await page
      .locator('.ht-categories')
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { display: s.display, direction: s.flexDirection, gap: s.gap };
      });
    expect(sectionStyle.display, '区块的布局来自 app.css，不是浏览器默认的 block').toBe('flex');
    expect(sectionStyle.direction).toBe('column');
    expect(sectionStyle.gap, 'gap 来自 space token（不是 0）').not.toBe('0px');

    // ② 说明文字的颜色**真的**是那个 token 展开后的值。
    //    这条同时钉住三件事：变量名没写错、tokens.css 被引入了、暗色/亮色解析出的是一个真颜色。
    const note = await page.locator('[data-testid="category-note"]').evaluate((el) => ({
      color: getComputedStyle(el).color,
      token: getComputedStyle(document.documentElement)
        .getPropertyValue('--ht-color-foreground-muted')
        .trim(),
    }));
    expect(note.token, 'token 必须能在 :root 上读到').not.toBe('');
    // 把 token 的引用展开成实际 rgb：用一个临时元素量一次，避免把 hex 抄进测试
    const tokenColor = await page.evaluate((value) => {
      const probe = document.createElement('span');
      probe.style.color = value;
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return resolved;
    }, note.token);
    expect(note.color, '说明文字的颜色必须等于 color.foreground-muted 展开后的值').toBe(tokenColor);

    /**
     * ③ 🔴 「未归类」**不画成分类行、也不画成柱子**。
     *
     * 它是一句话，不是泳道 —— 否则用户会以为"未归类"是他可以赋色的第九类，
     * 而且那一行会跟真分类抢同一套视觉语言。
     *
     * ⚠️ 这里**不是**在测"没数据时界面空着"这种一眼可见的事，而是在钉两条口径：
     * 格子的存在与否取决于有没有**分类行**（`report.series`），
     * 柱子的存在与否取决于 `peakWeeklyMs`（峰值只从分类行来）——
     * 于是"未归类"这个词在数据模型里根本不是一类，界面也就画不出来。
     *
     * 这条能失败：把未归类也塞进 `report.series`（或者让峰值把未归类算进去）就会红。
     *
     * 📌 反过来说，**十二格泳道与十二根堆叠柱的 CSS 像素级检查现在做不到** ——
     * 真数据要有一条"归到某个清单"的专注，而 Web 上今天没有"把任务放进清单"
     * 的界面（在别人的在飞工作里，见 `docs/plans/activity-categories-and-colors.md` §8.6）。
     * 那条路径一旦落地，这一段就能升级成"12 条轨道 + 12 个 MM-DD 标签"的断言。
     * 现在**不假装**：宁可少一条，也不要一条测不到真东西的。
     */
    await expect(
      page.locator('[data-testid="category-cells"]'),
      '没有分类行时不该有格子（未归类是一句话，不是一行）',
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="category-bar-track"]'),
      '峰值只从分类行算，未归类不该凭空画出一排柱子',
    ).toHaveCount(0);

    // ④ 十二周的范围行仍然要在（它说的是窗口，不依赖有没有分类行）
    await expect(page.locator('[data-testid="category-range"]')).toContainText('至');

    // ⑥ 那句话与上面之间有一条分隔线（样式表里的 border-top 真的落了地）
    const separated = await page.locator('[data-testid="category-unassigned"]').evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: parseFloat(s.borderTopWidth), style: s.borderTopStyle };
    });
    expect(separated.style, '分隔线的样式来自 token 的 border-width/border-color').not.toBe('none');
    expect(separated.width, '分隔线宽度必须 > 0').toBeGreaterThan(0);
  });

  test('反需求：这一块文案里没有排名 / 占比 / 优劣词', async ({ page }) => {
    await openApp(page);
    await switchView(page, '成长');

    const text = await categoryText(page);
    const hits = BANNED.filter((word) => text.includes(word));
    expect(
      hits,
      `分类区块出现了评判性说法：${JSON.stringify(hits)}。` +
        '这一页只许有两种句子：某类做了多久、这些时间怎么算出来的。',
    ).toEqual([]);
    expect(text, '颜色只编码身份，不用占比表达').not.toContain('%');
  });
});