/**
 * 倒数纪念日 e2e 的**共用夹具**（W5 与 W7 两条 spec 共用的那几步交互）
 * ===================================================================
 *
 * 🔴 为什么单独一份：`addCountdownEvent` 那一段是"翻月 → 点那一格 → 回显 → 输标题 →
 * 点添加"，它的形状**完全由共享 `EventBoard` 的 testID 契约决定**。抄在两处
 * （`countdown.spec.ts` 与 `countdown-export.spec.ts`）的后果是：契约改一次只有
 * 一份红，另一份仍按旧形状点 —— 而点错的症状是"超时"，不是"testID 变了"，
 * 排查的人会先去查产品。单所有者 + 两个消费方是这仓一贯的收口动作
 * （AGENTS §3.5：抽取的收尾是**删掉旧的那份**，不是再写一份更好的）。
 *
 * ⚠️ 这里只放**交互**与**定位**，不放任何判据。判据留在各条 spec 里，
 * 否则"这条用例在验什么"会从两份文件里同时消失。
 */
import { expect, type Page } from '@playwright/test';

export const TAB = '倒数纪念日';
export const BOARD = '[data-testid="countdown-view"]';
export const CARD = '[data-testid^="event-card-"]';

/** `YYYY年M月D日` 里那一天的**无障碍名**（共享 DatePicker 的 `dayLabel` 形状）。 */
export function cellLabel(month: number, day: number): string {
  return `${String(month)}月${String(day)}日`;
}

/** 下一月的 1 号（永远是未来）。 */
export function nextMonthFirst(): { label: string; days: number } {
  const now = new Date();
  const target = Date.UTC(now.getFullYear(), now.getMonth() + 1, 1);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const month = new Date(target).getUTCMonth() + 1;
  return { label: cellLabel(month, 1), days: Math.round((target - today) / 86_400_000) };
}

/** 上一月的 2 号（永远是过去；2 号在任何月份都存在）。 */
export function prevMonthSecond(): string {
  const now = new Date();
  const month = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 2)).getUTCMonth() + 1;
  return cellLabel(month, 2);
}

/**
 * 在板子上加一条倒数日：点日期 → 翻到目标月 → 点那一格 → 输标题 → 点添加。
 *
 * 🔴 每步都**落账**（等它该产出的界面状态），不"点完就走"：
 * 点击被吞掉时，症状会是后面那条断言红，而不是"这一步没生效"。
 */
export async function addCountdownEvent(
  page: Page,
  title: string,
  label: string,
  months: number,
): Promise<void> {
  await page.getByTestId('event-pick-date').click();
  const picker = page.getByTestId('event-date-picker');
  await expect(picker, '点「选日期」之后日历必须展开').toBeVisible();
  for (let step = 0; step < Math.abs(months); step += 1) {
    await page.getByRole('button', { name: months > 0 ? '下个月' : '上个月' }).click();
  }
  const cell = page.locator(`[aria-label="${label}"]`);
  // 翻月之后这一格必须**唯一**（跨月的首尾行会重复出现别的月份的格子）。
  await expect(cell, `日历里「${label}」应当只有一格`).toHaveCount(1);
  await cell.click();
  await expect(
    page.getByTestId('event-pick-date'),
    '选完日期，日历收起并把那一天回显在按钮上',
  ).toContainText(label);

  await page.getByTestId('event-title-input').fill(title);
  await page.getByTestId('event-add').click();
  await expect(
    page.locator(CARD).filter({ hasText: title }).first(),
    `添加「${title}」之后卡片必须出现`,
  ).toBeVisible();
}

/** 按标题取那张卡（标题是用例自己给的，唯一性在这里当场断，不让它悄悄拿到两张）。 */
export function cardByTitle(page: Page, title: string) {
  return page.locator(CARD).filter({ hasText: title });
}

/** 展开那张卡的二级操作菜单，并等**最后一条**动作出现（菜单真开了，而不是点动了）。 */
export async function openCardMenu(page: Page, title: string) {
  const card = cardByTitle(page, title);
  await expect(card, `卡片「${title}」应当只有一张`).toHaveCount(1);
  const menu = card.locator('[data-testid^="event-menu-"]');
  // 🔴 **按 `aria-expanded` 决定点不点**，不无脑点：那个按钮是 `onPress={() => onOpenMenu(!menuOpen)}`
  //   —— 一个**开关**。第二次"展开"如果直接点，会把已经开着的菜单**关掉**，
  //   症状是"等不到删除条"，看起来像菜单坏了。实测：同一张卡连导两次就撞上了。
  if ((await menu.getAttribute('aria-expanded')) === 'true') {
    await expect(
      card.locator('[data-testid^="event-remove-"]'),
      '菜单回显为已展开，但二级操作不在（那是界面在说谎）',
    ).toBeVisible();
    return card;
  }
  await menu.click();
  await expect(
    card.locator('[data-testid^="event-remove-"]'),
    '点「⋯」之后二级操作必须展开（删除条常驻菜单最末）',
  ).toBeVisible();
  return card;
}

/** 卡片上那一行日期（导出文件名里的日期段用的就是它）。 */
export async function cardDateLine(page: Page, title: string): Promise<string> {
  const text = await cardByTitle(page, title)
    .locator('[data-testid^="event-date-"]')
    .textContent();
  return (text ?? '').trim();
}

/** 收集控制台的 error 与页面异常（白屏的根因几乎只在这里现形，AGENTS §6.2 规定一）。 */
export async function collectErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}
