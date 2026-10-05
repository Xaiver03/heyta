/**
 * 习惯「列表 + 窗格」的真浏览器验收
 * ==================================
 *
 * jsdom 那两套（`apps/web/tests/habits-list-pane.spec.tsx` 与
 * `apps/web/tests/habits-detail-card.spec.tsx`，条数请现量：
 * `grep -c "it('" apps/web/tests/habits-*.spec.tsx`）已经把**结构**
 * 钉死了：哪些节点存在、选中态挂在哪个属性上、点第二行窗格换人。
 * 这一份只验 **jsdom 根本够不着的四件事**：
 *
 * 1. **真的两列**。清单列与详情栏的 `boundingBox()` 关系是 CSS 布局，jsdom 不做布局 ——
 *    它可以在 DOM 里"有两列"而屏幕上是一列。
 * 2. **窄屏塌缩的方向，以及面单在窄屏**归属哪一列**（这一单起它有两个落点）。
 *    768px 断点必须把整列换到面单**上方**，而不是砍掉三个数字（ADR-0022 那条红线落在布局上）。
 * 3. **打卡标记的颜色真的分得开**。`heatmapLevelToken` 只是 token 名，
 *    能不能"一眼看出哪几天打了"取决于解析后的 `background-color` ——
 *    只有浏览器知道 `--ht-color-heat-4` 实际是什么。
 * 4. **暗色下字看得清**。§6.2 与 AGENTS §5 都要求暗色**实际切换查看**：
 *    `foreground-muted` 压在 `primary-subtle`（暗色下是**带 alpha 的蓝**）上时，
 *    jsdom 只会给你一串 `rgba(...)` 字面量，比值必须在这里算。
 *
 * ## 数据全部从界面上真点出来
 *
 * 不调内部 store、不注入 IndexedDB。理由和 `motivation.spec.ts` 一样：
 * 一份"靠探针写进去的数据"渲染出的界面，证明不了用户点出来的数据能渲染。
 */
import { expect, test } from '@playwright/test';
import { openApp, switchView } from './helpers';

const ADD_PLACEHOLDER = '新习惯，例如「喝水」';

/**
 * 🔴 必须带 `?lang=zh-CN`：placeholder 与视图标签都是中文定位符，而 2026-10-01
 * 起首启语言第 3 层问 `navigator.language`（Playwright = en-US）⇒ 不钉就是英文界面。
 */
const APP_ZH = '/?lang=zh-CN';

/** 加一条习惯（输入 → 回车提交表单），等它出现在左列。 */
async function createHabit(page: import('@playwright/test').Page, name: string): Promise<string> {
  const input = page.getByPlaceholder(ADD_PLACEHOLDER);
  await input.fill(name);
  await input.press('Enter');
  const row = page.locator(`[data-testid^="habit-row-"]`).filter({ hasText: name }).first();
  await expect(row).toBeVisible();
  const testId = (await row.getAttribute('data-testid'))!;
  return testId.replace('habit-row-', '');
}

/**
 * 在页面里算「某个元素的文字 vs 它实际压着的背景」的 WCAG 对比度。
 *
 * 🔴 必须**逐层合成 alpha**：暗色下 `color.primary-subtle` 是 `#2563eb29`
 * （16% 的蓝）。直接拿这串 rgba 去套公式，等于把半透明当成不透明 ——
 * 算出来的比值既不是设计系统那个测试的值，也不是屏幕上用户看到的值。
 * 合成的终点是 `<html>` 的背景，所以暗/亮两套都会走到各自真实的画布色。
 */
async function contrastOf(
  page: import('@playwright/test').Page,
  selector: string,
): Promise<number> {
  return page.evaluate((sel) => {
    const parse = (value: string): [number, number, number, number] => {
      const m = /rgba?\(([^)]+)\)/.exec(value);
      if (!m) return [255, 255, 255, 1];
      const parts = m[1]!.split(/[\s,\/]+/).filter(Boolean).map(Number);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const over = (fg: [number, number, number, number], bg: [number, number, number, number]) => {
      const a = fg[3];
      return [0, 1, 2].map((i) => fg[i]! * a + bg[i]! * (1 - a)) as [number, number, number, number];
    };
    const channel = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (c: [number, number, number, number]) =>
      0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);

    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`找不到 ${sel}`);

    // 从自己往上收集背景层，再**从上往下**合成（先父后子）。
    const layers: [number, number, number, number][] = [];
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg[3] > 0) layers.unshift(bg);
      if (node === document.documentElement) break;
    }
    let backdrop: [number, number, number, number] = layers.length > 0 ? layers[0]! : [255, 255, 255, 1];
    for (let i = 1; i < layers.length; i += 1) backdrop = over(layers[i]!, backdrop);

    const text = over(parse(getComputedStyle(el).color), backdrop);
    const l1 = luminance(text);
    const l2 = luminance(backdrop);
    const hi = Math.max(l1, l2);
    const lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }, selector);
}

/** 一行里 7 个点解析后的背景色 + 它们的 title（按 DOM 顺序）。 */
async function dotCells(
  page: import('@playwright/test').Page,
  habitId: string,
): Promise<{ color: string; title: string }[]> {
  return page.evaluate((id) => {
    const row = document.querySelector(`[data-testid="habit-row-${id}"]`);
    if (!row) throw new Error(`找不到习惯行 ${id}`);
    return Array.from(row.querySelectorAll('.ht-habit__dot')).map((dot) => ({
      color: getComputedStyle(dot as Element).backgroundColor,
      title: dot.getAttribute('title') ?? '',
    }));
  }, habitId);
}

/** 同色算一个格子：用于"打之前 7 格同色 / 打之后恰好一格不同"。 */
const colorsOf = (cells: { color: string; title: string }[]): string[] => cells.map((c) => c.color);

async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  // 🔴 先截图再断言（AGENTS §6.2 规定一）：断言失败时那张图也得在盘上。
  await page.screenshot({ path: `test-results/${name}.png` });
}

test.describe('习惯视图 = 列表 + 窗格（真浏览器）', () => {
  test.use({ viewport: { width: 1280, height: 820 } });

  test('宽屏下左右两列、三个具体数字常驻、打卡那天与没打的颜色分得开', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));

    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await expect(page.getByRole('tab', { name: '习惯' })).toHaveAttribute('aria-selected', 'true');

    const first = await createHabit(page, '喝水');
    const second = await createHabit(page, '阅读');

    const side = page.locator('.ht-habit__side');
    const pane = page.locator('.ht-habit__pane');
    const column = page.locator('.ht-app__detail');
    // 🔴 先等渲染完再量盒子：面单从这一单起**会随视口搬家**（宽屏在详情栏里、窄屏回
    // 清单那一列），搬家靠 `matchMedia` ⇒ 视口变化之后还有一帧重渲染。`boundingBox()`
    // 不等，实测在窄屏那条读到 `null` 而 a11y 快照里面单最终就在 `<main>` 末尾 ——
    // 界面没错，是探针抢跑（§7 元规则一）。
    await expect(side).toBeVisible();
    await expect(column).toBeVisible();
    await expect(pane).toBeVisible();

    const sideBox = await side.boundingBox();
    const paneBox = await pane.boundingBox();
    const columnBox = await column.boundingBox();
    await shot(page, 'habits-list-pane-light');

    /* 🔴 判据从布局推出来，不是从常量推出来：面单必须在清单**右边**，并且**落在那一栏里**。

       ⚠️ ~~`expect(sideBox.width).toBeLessThan(paneBox.width)`~~ 与 ~~两列竖向区间重叠~~
       这对代理（2026-10-05 工单 §8.133 撤掉）量的是"同一个视图里的主从两栏"，比例 2fr/5fr。
       自 §8.133 起面单落在**详情列**（`.ht-app__detail`，宽 22rem），清单铺满中间那一列 ⇒
       "清单比窗格窄"不再是契约，而是恰好被这次改动否证的形状；竖向重叠那条代理也没了依据：
       面单的高度由**内容**决定（没选中时只有一行空态文案），而清单列有一整页行 ——
       两个盒子可以完全不相交而布局是对的。替代判据是下面三条，都与高度无关：
       面单被栏的矩形**包住** + 栏贴视口右边缘 + 清单只占一根轨道（不留空轨道）。 */
    expect(sideBox, '清单列没有渲染盒子').not.toBeNull();
    expect(paneBox, '窗格没有渲染盒子').not.toBeNull();
    expect(columnBox, '详情列没有渲染盒子').not.toBeNull();
    expect(paneBox!.x).toBeGreaterThan(sideBox!.x + sideBox!.width - 1);
    expect(paneBox!.x, '面单左边缘在详情列左边之外').toBeGreaterThanOrEqual(columnBox!.x - 1);
    expect(paneBox!.y, '面单上边缘在详情列上边之外').toBeGreaterThanOrEqual(columnBox!.y - 1);
    expect(paneBox!.x + paneBox!.width, '面单右边缘溢出详情列').toBeLessThanOrEqual(
      columnBox!.x + columnBox!.width + 1,
    );
    expect(paneBox!.y + paneBox!.height, '面单下边缘溢出详情列').toBeLessThanOrEqual(
      columnBox!.y + columnBox!.height + 1,
    );

    // 那一栏贴窗口右边缘（W2 的承重几何，面单落地不该弄坏它）。
    // ⚠️ 量的是**列盒子**而不是 pane：pane 在列里还有一圈 inset，贴边的是列。
    const viewportWidth = page.viewportSize()!.width;
    expect(
      columnBox!.x + columnBox!.width,
      `详情列右边缘 ${String(columnBox!.x + columnBox!.width)} 没贴到视口右边缘 ${String(viewportWidth)}`,
    ).toBeGreaterThanOrEqual(viewportWidth - 1);
    // 清单那一侧只有一根轨道（面单走了之后不许留一整块空白）。
    const tracks = await side.evaluate((el) => {
      const grid = el.closest('.ht-habit');
      return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : -1;
    });
    expect(tracks, '`.ht-habit` 不是单列 ⇒ 面单搬走后留了一根没人住的轨道').toBe(1);

    // 全页只有一块板（motivation.spec 的白屏检测靠它，两边必须同一条判据）。
    await expect(page.getByTestId('habit-board')).toHaveCount(1);

    // 三个具体数字：同等权重、常驻（ADR-0022 那一条落在布局上的形态）。
    const nums = page.locator(`[data-testid="habit-row-${first}"] .ht-habit__chip-num`);
    await expect(nums).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) await expect(nums.nth(i)).toHaveText('0');

    // 🔴 点哪一行，窗格就换人。这条**不依赖默认选中的是谁** ——
    // §8.131 起根本没有"默认"：没选中时窗格说的是"选一条习惯"，谁都不画。
    // 所以两边各点一次、各验一次，顺序怎么变判据都成立。
    await page.locator(`[data-testid="habit-row-${second}"]`).click();
    await expect(pane).toHaveAttribute('aria-label', /「阅读」/);
    await page.locator(`[data-testid="habit-row-${first}"]`).click();
    await expect(pane).toHaveAttribute('aria-label', /「喝水」/);
    await expect(page.locator(`[data-testid="habit-row-${first}"]`)).toHaveAttribute(
      'aria-current',
      'true',
    );

    // 打卡标记：打之前 7 个格子同色，打之后**恰好最后一格**换了色。
    const before = await dotCells(page, first);
    expect(before).toHaveLength(7);
    expect(new Set(colorsOf(before)).size).toBe(1);
    expect(before.every((c) => c.title.includes('没打卡'))).toBe(true);

    await page.getByTestId(`habit-checkin-${first}`).click();
    // 🔴 必须**轮询**而不是点完就读：打卡走的是 op-log → IndexedDB → 重渲染，
    // 同步读一次拿到的是写之前的颜色（实测第一版就是在这里红的 ——
    // 界面没错，是探针抢跑）。超时只影响"多久算失败"，不影响判据强度。
    await expect
      .poll(async () => new Set(colorsOf(await dotCells(page, first))).size, { timeout: 10_000 })
      .toBe(2);

    const after = await dotCells(page, first);
    await shot(page, 'habits-list-pane-light-checked');

    const missed = before[0]!.color;
    const changed = after.map((c, i) => ({ ...c, i })).filter((c) => c.color !== missed);
    expect(changed).toHaveLength(1);
    // 换色的那一格必须是**最后一格**（列表的 7 天窗口以今天结尾）而且标着「已打卡」。
    expect(changed[0]!.i).toBe(6);
    expect(changed[0]!.title).toContain('已打卡');
    expect(after.filter((c) => c.title.includes('没打卡'))).toHaveLength(6);

    // 打过的那格不能只是"深一点点"：与未打格子的亮度比必须一眼可见。
    // 阈值 1.6 是"看得出来"的地板，heat-0(#f1f5f9) vs heat-4(#1d4ed8) 实际远大于此。
    const relLum = await page.evaluate(
      ([a, b]) => {
        const ch = (v: number) =>
          v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
        const lum = (s: string) => {
          const p = s.match(/\d+/g)!.map(Number);
          return 0.2126 * ch(p[0]!) + 0.7152 * ch(p[1]!) + 0.0722 * ch(p[2]!);
        };
        const l1 = lum(a as string);
        const l2 = lum(b as string);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      },
      [changed[0]!.color, missed],
    );
    expect(relLum).toBeGreaterThan(1.6);

    // 数字也跟着走：今天打一次 ⇒ 三个都变 1（列表与窗格读的是同一份日志）。
    for (let i = 0; i < 3; i += 1) await expect(nums.nth(i)).toHaveText('1');

    expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('窄屏（≤768px）面单回到清单那一列、换到其下方，三个数字一个都不砍', async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    const id = await createHabit(page, '喝水');
    await page.setViewportSize({ width: 700, height: 900 });

    const side = page.locator('.ht-habit__side');
    const pane = page.locator('.ht-habit__pane');
    // 🔴 等面单**搬完家**再量（同上面那条理由）：视口 700px ⇒ `DETAIL_FITS_QUERY` 转假，
    // 面单要从 `.ht-app__detail` 搬回 `.ht-habit` 末尾，这一步是 matchMedia 之后的一帧重渲染。
    await expect(side).toBeVisible();
    await expect(pane).toBeVisible();
    const sideBox = await side.boundingBox();
    const paneBox = await pane.boundingBox();
    await shot(page, 'habits-list-pane-narrow');

    expect(sideBox).not.toBeNull();
    expect(paneBox).not.toBeNull();
    // 🔴 面单在窄屏必须**离开详情列**。这条是这一单新增的：以前它恒在 `.ht-habit` 里，
    // "窄屏要不要收"根本不构成判据；现在它有两个落点，只看"塌到下面"挡不住
    // "落点在栏里、靠 CSS `display:none` 藏起来"这一种假通过 —— 那正是拍板 #1
    // 反对的形状（界面不说、模型已变）。承重的是这里：**DOM 里它归属哪一列**。
    const inDetailColumn = await pane.evaluate((el) => el.closest('.ht-app__detail') !== null);
    expect(inDetailColumn, '窄屏下面单仍挂在详情列里 ⇒ 落点没跟着视口走').toBe(false);
    // 🔴 塌缩方向只有一个正确答案：清单在**上**、面单在**下**。
    // 反过来（面单在上）等于把"扫一眼"的那一列挤到要滚动才看见的地方。
    expect(sideBox!.y + sideBox!.height).toBeLessThanOrEqual(paneBox!.y + 1);
    expect(paneBox!.y).toBeGreaterThan(sideBox!.y);

    // 三个数字仍然在屏上（不是 display:none、不是被 nowrap 挤没）。
    const nums = page.locator(`[data-testid="habit-row-${id}"] .ht-habit__chip-num`);
    await expect(nums).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) await expect(nums.nth(i)).toBeVisible();
    // 「累计」不许是第一个被砍的 —— 它必须与前两个同等可见。
    const totalBox = await nums.nth(2).boundingBox();
    expect(totalBox).not.toBeNull();
    expect(totalBox!.width).toBeGreaterThan(0);
  });

  test('暗色主题下 chip 数字与习惯名都读得清（对比度真算过）', async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    const id = await createHabit(page, '喝水');
    await createHabit(page, '阅读');

    await page.getByRole('button', { name: '切换到暗色主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const selected = page.locator(`[data-testid="habit-row-${id}"]`);
    await selected.click();
    await expect(selected).toHaveAttribute('aria-current', 'true');

    // 🔴 未选中那行也得**真的存在**才量它。原本写的 `if (!habitId) continue`
    // 是"找不到就跳过"—— 一条只剩一行数据时自动永不执行的判据比没有判据更糟
    // （§7 第 33 条那个元规则），所以这里改成先断言两条 id 都取得到。
    // ⚠️ 这里第二次踩过同一类坑：`.replace('habit-row-')` 少写第二个参数时，
    // 前缀会被换成字符串 `"undefined"`，拼回去的选择器**永远找不到**元素，
    // 而报错长得像"界面少了这一行"。写 `?? ''` 之外还要给 replace 两个参数。
    const plainId = await page.evaluate((current) => {
      const rows = Array.from(document.querySelectorAll('[data-testid^="habit-row-"]'));
      const other = rows.find((r) => r.getAttribute('data-testid') !== `habit-row-${current}`);
      return other?.getAttribute('data-testid')?.replace('habit-row-', '') ?? '';
    }, id);
    expect(plainId, '只有一行习惯，未选中行的背景根本没被量到').not.toBe('');

    await shot(page, 'habits-list-pane-dark');

    // 未选中那行压在 surface 上，选中那行压在**带 alpha 的** primary-subtle 上 ——
    // 两种背景都要过线，因为用户两种都会看到。
    for (const [where, habitId] of [
      ['选中行', id],
      ['未选中行', plainId],
    ] as const) {
      const chip = await contrastOf(page, `[data-testid="habit-row-${habitId}"] .ht-habit__chip`);
      const name = await contrastOf(page, `[data-testid="habit-row-${habitId}"] .ht-habit__name`);
      // 4.5 = WCAG AA 正文。chip 是 xs 字重 regular，够不着"大字 3.0"的豁免。
      expect(chip, `${where}的 chip 数字在暗色下看不清（${chip.toFixed(2)}:1）`).toBeGreaterThanOrEqual(4.5);
      expect(name, `${where}的习惯名在暗色下看不清（${name.toFixed(2)}:1）`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
