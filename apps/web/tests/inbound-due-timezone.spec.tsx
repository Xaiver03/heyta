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
 * 判据取的是这三处各自的密度（徽标 `12-31`、触发器 `12月31日`、月历里被选中那格的
 * 无障碍名 `12月31日`），不是"三处字符串逐字相同" —— 产品本来就给三种写法，这条钉的是同一天。
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
function mount(node: React.ReactNode): void {
  const before = mounted;
  if (before !== undefined) act(() => before.unmount());
  container = document.createElement('div');
  document.body.appendChild(container);
  mounted = createRoot(container);
  act(() => {
    mounted?.render(<I18nProvider locale="zh-CN"><HeytaUiProvider>{node}</HeytaUiProvider></I18nProvider>);
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
 * 属性选择器会安静地返回空数组，于是"选中的是 12月31日"变成一条永真的话。
 */
function selectedDayLabel(): string {
  const cells = Array.from(document.querySelectorAll<HTMLElement>('[role="button"][aria-label]'))
    .filter((node) => /^\d{1,2}月\d{1,2}日$/u.test(node.getAttribute('aria-label') ?? ''));
  expect(cells.length, '月历格子一枚都没取到 = 探针空转（面板根本没画）').toBeGreaterThan(27);
  const selected = cells.filter((node) => node.getAttribute('aria-selected') === 'true');
  expect(selected.length, `被选中的格子应有且只有一格，实取 ${selected.length} —— 探针失效，这条判据不许这样过`)
    .toBe(1);
  return selected[0]!.getAttribute('aria-label')!;
}

it('keeps one calendar day in the list badge and the detail editor across device timezones', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of zones) {
      process.env.TZ = zone;
      // ① 探针对照：这一档的 TZ 若没换动，下面三条会一起变成空转。
      expect(new Date(epoch).getDate(), `${zone}：本进程的设备时区没换动，探针失效`).toBe(probeExpected[zone]);

      // ② 列表徽标（`mode='date'` 那一档）。
      mount(<DueBadge task={taskOf('2026-12-31')} mode="date" now={now} />);
      expect(text(), `${zone}：徽标里没取到任何日期读数 = 探针空转`).toMatch(/\d{1,2}-\d{2}/u);
      expect(text(), `${zone}：列表徽标不许把这天折成前一天 —— 实读 ${text()}`).toContain('12-31');
      expect(text(), `${zone}：列表徽标读歪了 —— 实读 ${text()}`).not.toContain('12-30');

      // ③ 详情编辑面：触发器那枚中文档 + 月历里被选中的那一格。
      mount(<DueEditor task={taskOf('2026-12-31')} now={now} onSetDueDate={() => undefined} />);
      openPanel();
      expect(text(), `${zone}：详情触发器必须是 12月31日 —— 实读 ${text()}`).toContain('12月31日');
      expect(selectedDayLabel(), `${zone}：月历里被选中的那格不是 12月31日`).toBe('12月31日');
    }

    // ④ 反向臂：摘掉配对 ⇒ 同一枚 epoch 在西半那一档必须读成前一天，两面都得跟着歪。
    process.env.TZ = 'Etc/GMT+12';
    mount(<DueBadge task={taskOf()} mode="date" now={now} />);
    expect(text(), '反向臂：没有 dueDateLocal 时徽标必须读成 12-30，读不歪就说明 ② 是空转').toContain('12-30');
    mount(<DueEditor task={taskOf()} now={now} onSetDueDate={() => undefined} />);
    openPanel();
    expect(selectedDayLabel(), '反向臂：没有 dueDateLocal 时月历必须选中 12月30日，选不歪就说明 ③ 是空转')
      .toBe('12月30日');
  } finally {
    process.env.TZ = previous;
  }
});
