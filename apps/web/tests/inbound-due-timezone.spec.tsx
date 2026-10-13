import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { parseLocalDate, type Task } from '@heyta/domain';
import { I18nProvider } from '@heyta/i18n';
import { HeytaUiProvider } from '@heyta/ui';

import { DueBadge } from '../src/features/tasks/DueBadge.js';
import { DueEditor } from '../src/features/tasks/DueEditor.js';

/**
 * 自动收集那枚 date-only 落在**列表徽标**与**详情编辑面**这两处时，不许随设备时区漂。
 *
 * 🔴 为什么这两处要单独钉：`packages/domain/src/entities.ts` 给 `dueDateLocal` 写的是
 * "readers must prefer this field when present so a device timezone cannot move the day" ——
 * 那是一句**约定**，而约定错了没有任何一层会失败（§7 那一族）。配对怎么产生的由
 * `packages/app-host/tests/inbound-draft-date-zone.spec.ts` 钉（缝那一层），
 * 这一枚钉的是**读的那一侧**：真组件、真词条、四档设备时区。
 * 被钉的那一行是 `apps/web/src/features/tasks/DueEditor.tsx:134` 的
 * `task.dueDateLocal ?? toLocalDate(task.dueDate)` —— 顺序反了就整面漂。
 *
 * 判据取的是这三处各自的密度：徽标 `12-31`（中英两档都是这一个形状，因为它走
 * `formatCompactLocalDate` 而不是词条）、月历里被选中那格的无障碍名（**按形状认**：
 * `数字 非数字 数字`，中英两档分别是 `12月31日` 与 `12/31`），以及**触发器那一串必须包含它** ——
 * 拿格子自己当对照，就不抄界面文案。产品本来就给三种写法，这条钉的是同一天。
 *
 * 🔴 中文档之外还跑英文档，为的是 `t('web.due.dayLabel')` 这条本地化路径本身；
 * 而英文档的枚举值是 `'en'`。写成 `'en-US'` 时目录表查无此值会**静默回退默认档**，
 * 于是"两档都覆盖了"其实是同一档跑了两遍 —— 所以最后那道 ⑤ 断言两档产出的格子名**必须不同**。
 * （这一条不是设想：本轮亲手用 `'en-US'` 跑过一次，⑤ 当场报
 * `两档 locale 产出的月历无障碍名一模一样（实取 12月31日）= locale 臂空转`。）
 *
 * ⚠️ 编辑面**没有** ISO 日期输入框：共享 `DatePicker` 画的是月历格子
 * （`packages/ui/src/date-picker/DatePicker.tsx:269-324`，`value === cell.date` 那格
 * 带 `aria-selected`）。所以这一面读的是"哪一格被选中"，不是"输入框里写着什么"。
 *
 * 🔴 反向臂在最后：把配对摘掉之后，同一枚 epoch 在 `Etc/GMT+12` 那档**必须**被徽标读成
 * `12-30`、被月历选中的那格**必须**变成 `12月30日`。两处都读不歪就说明上面那批判据是空转的。
 *
 * ⚠️ 这一枚是 jsdom 组件层：钉不到"App 有没有把徽标挂进行"（那一层由真浏览器
 * `e2e/tests/inbound-automation.spec.ts` 负责，与 `due-date-edit.spec.tsx` 文件头记的
 * 同一套分工）。
 */
const zones = ['Pacific/Kiritimati', 'Etc/GMT+12', 'UTC', 'Asia/Shanghai'] as const;
const probeExpected: Record<(typeof zones)[number], number> = {
  'Pacific/Kiritimati': 31, 'Etc/GMT+12': 30, UTC: 30, 'Asia/Shanghai': 31,
};
/** 规则时区 `Asia/Shanghai` 的 `2026-12-31` 零点，折成 epoch 是 `2026-12-30T16:00Z`。 */
const epoch = Date.UTC(2026, 11, 30, 16);
const now = parseLocalDate('2026-12-01').getTime();

// 显示层夹具：只带这两处会读的字段。配对字段的**来源**由缝那一层那枚 spec 钉住。
function taskOf(dueDateLocal?: string): Task {
  return {
    id: 'inbound:evt-tz:0', title: 'Boundary day task', priority: 0, dueDate: epoch,
    ...(dueDateLocal === undefined ? {} : { dueDateLocal }),
  } as unknown as Task;
}

let container: HTMLDivElement;
let mounted: Root | undefined;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (mounted !== undefined) act(() => mounted?.unmount());
  mounted = undefined;
  document.body.innerHTML = '';
});

// React 18 里同一枚 root 卸载后不能再渲染，所以每次挂载都换一枚新 root。
// ⚠️ 英文档的枚举值是 `'en'`，**不是** `'en-US'`：`I18nProvider` 对目录表里查无此值的 locale
// 是 `CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE]`（`packages/i18n/src/react.tsx:44`）——
// 写错就静默回退到默认档，两档跑成同一档而什么都不会红。本文件最后那道 ⑤ 就是这一条的防护。
function mount(node: React.ReactNode, locale: 'zh-CN' | 'en' = 'zh-CN'): void {
  const before = mounted;
  if (before !== undefined) act(() => before.unmount());
  container = document.createElement('div');
  document.body.appendChild(container);
  mounted = createRoot(container);
  act(() => {
    mounted?.render(<I18nProvider locale={locale}><HeytaUiProvider>{node}</HeytaUiProvider></I18nProvider>);
  });
}

// 🔴 面板有第二副身体（Portal 到 body 的 fixed 卡），所以面板里的东西一律从 `document` 取
// —— `due-date-edit.spec.tsx` 文件头那条实测教训（在 container 里找会得到 null）。
const text = (scope: ParentNode = container): string => (scope.textContent ?? '').replace(/\s+/g, ' ');

/** jsdom 不实现 summary 的展开切换，直接把 disclosure 置开（同 `due-date-edit.spec.tsx`）。 */
function openPanel(): void {
  const details = container.querySelector('details');
  expect(details, 'DueEditor 应是行尾的一个 disclosure').not.toBeNull();
  act(() => { details!.open = true; });
}

/**
 * 月历里**被选中**那格的无障碍名；探针对照：格子总数与"恰好一格被选中"。
 *
 * 🔴 这两道探针不是装饰：`aria-selected` 若因为 RNW 版本换了而不再落到 DOM 上，
 * 属性选择器会安静地返回空数组，于是"选中的是那个月末"变成一条永真的话。
 *
 * ⚠️ 认"这是一枚月历格子"用的是**形状**（`数字 非数字 数字`），不是中文措辞 ——
 * 中英两档的 `web.due.dayLabel` 分别是 `{month}月{day}日` 与 `{month}/{day}`，
 * 把任何一种抄进测试就等于给界面文案做第二份抄件，它一定会漂。
 */
function selectedDayLabel(): string {
  const cells = Array.from(document.querySelectorAll<HTMLElement>('[role="button"][aria-label]'))
    .filter((node) => /^\d{1,2}\D+\d{1,2}\D*$/u.test(node.getAttribute('aria-label') ?? ''));
  expect(cells.length, '月历格子一枚都没取到 = 探针空转（面板根本没画）').toBeGreaterThan(27);
  const selected = cells.filter((node) => node.getAttribute('aria-selected') === 'true');
  expect(selected.length, `被选中的格子应有且只有一格，实取 ${selected.length} —— 探针失效，这条判据不许这样过`)
    .toBe(1);
  return selected[0]!.getAttribute('aria-label')!;
}

/** 从无障碍名的形状里取「月, 日」；中英两档都是"月在前、日在后"。 */
function monthAndDayOf(label: string): [number, number] {
  const groups = label.match(/\d+/gu) ?? [];
  expect(groups.length, `「${label}」里没取到两段数字 = 尺读不到被测物`).toBeGreaterThanOrEqual(2);
  return [Number(groups[0]), Number(groups[1])];
}

/**
 * 触发器写的那串日期与月历里被选中那一格**必须是同一串**（两处都出自同一个 `value`）。
 * 拿单元格自己当对照，而不是再抄一份措辞 —— 这样换语言、换词条都不用改这条判据。
 */
function triggerLabel(): string {
  const summary = container.querySelector('summary');
  expect(summary, 'DueEditor 的触发器应是那个 summary').not.toBeNull();
  return (summary!.textContent ?? '').replace(/\s+/g, ' ').trim();
}

it('keeps one calendar day in the list badge and the detail editor across device timezones', () => {
  const previous = process.env.TZ;
  const locales = ['zh-CN', 'en'] as const;
  // 两档 locale 各自产出的"被选中那格"无障碍名。留下来只为最后一道空转防护用。
  const observedCellLabels = new Set<string>();
  try {
    for (const zone of zones) {
      process.env.TZ = zone;
      // ① 探针对照：这一档的 TZ 若没换动，下面三条会一起变成空转。
      expect(new Date(epoch).getDate(), `${zone}：本进程的设备时区没换动，探针失效`).toBe(probeExpected[zone]);

      for (const locale of locales) {
        const tag = `${zone}/${locale}`;

        // ② 列表徽标（`mode='date'` 那一档）。徽标走的是 `formatCompactLocalDate`，
        // 中英两档都是 `MM-DD`，所以这一条不随 locale 变 —— 变了就是它偷偷读了词条。
        mount(<DueBadge task={taskOf('2026-12-31')} mode="date" now={now} />, locale);
        expect(text(), `${tag}：徽标里没取到任何日期读数 = 探针空转`).toMatch(/\d{1,2}-\d{2}/u);
        expect(text(), `${tag}：列表徽标不许把这天折成前一天 —— 实读 ${text()}`).toContain('12-31');
        expect(text(), `${tag}：列表徽标读歪了 —— 实读 ${text()}`).not.toContain('12-30');

        // ③ 详情编辑面：触发器那一串 + 月历里被选中的那一格。
        mount(<DueEditor task={taskOf('2026-12-31')} now={now} onSetDueDate={() => undefined} />, locale);
        openPanel();
        const cell = selectedDayLabel();
        observedCellLabels.add(cell);
        expect(monthAndDayOf(cell), `${tag}：月历里被选中的那格不是 12 月 31 日（实读 ${cell}）`).toEqual([12, 31]);
        expect(triggerLabel(), `${tag}：触发器与月历选中格不是同一串（触发器 ${triggerLabel()} / 格子 ${cell}）`)
          .toContain(cell);
      }
    }

    // ④ 反向臂：摘掉配对 ⇒ 同一枚 epoch 在西半那一档必须读成前一天，两面都得跟着歪。
    process.env.TZ = 'Etc/GMT+12';
    for (const locale of locales) {
      mount(<DueBadge task={taskOf()} mode="date" now={now} />, locale);
      expect(text(), `反向臂 ${locale}：没有 dueDateLocal 时徽标必须读成 12-30，读不歪就说明 ② 是空转`).toContain('12-30');
      mount(<DueEditor task={taskOf()} now={now} onSetDueDate={() => undefined} />, locale);
      openPanel();
      expect(monthAndDayOf(selectedDayLabel()), `反向臂 ${locale}：没有 dueDateLocal 时月历必须选中 30 号，选不歪就说明 ③ 是空转`)
        .toEqual([12, 30]);
    }

    // ⑤ locale 臂自己的空转防护：两档产出的无障碍名**必须不同**。
    //    相同就说明 `I18nProvider locale=` 那一档没生效（词条缺失回退、provider 被忽略都会是这样），
    //    那样"中英两档都覆盖到了"是一句空话 —— 上面两档跑的其实是同一档。
    expect(
      [...observedCellLabels].sort(),
      `两档 locale 产出的月历无障碍名一模一样（实取 ${[...observedCellLabels].join(' | ')}）= locale 臂空转`,
    ).toHaveLength(2);
  } finally {
    process.env.TZ = previous;
  }
});
