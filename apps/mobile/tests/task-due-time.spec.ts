/**
 * R14c：移动端任务详情的**时刻输入侧**（接线判据）
 * ==================================================
 *
 * 这一批的缺陷形状很特殊：**共享层早就有能力，宿主没接**。
 * `packages/ui/src/date-picker/DatePicker.tsx:72-73` 原文写着"整个 prop 可选 ——
 * 不传就一个节点都不画，所以现有消费者（移动端任务详情）渲染出来的东西与改动前
 * 逐字节相同"。于是 R14 那一轮 `pnpm -r test` 全绿、web 真浏览器截图也看了，
 * 移动端却一直"能看日子、不能定时刻"，而**没有任何一层会报错**。
 *
 * 🔴 所以这里钉的是"接上了没有"，而不是"函数算得对不对"（后者在
 * `packages/domain/tests/capture.spec.ts` 与 `apps/web/tests/due-date-edit.spec.tsx`）。
 * `apps/mobile` 的测试通道是**源码级**的（node 环境，没有 RTL / 没有 jsdom，
 * 理由原文见 `profile-nickname-entry.spec.ts` 文件头），行为本身归设备脚本
 * `pnpm verify:mobile-edit` 那一族。
 *
 * 每条负向断言都配**正向对照**：否则"没命中"可能只是探针根本没读到文件。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { en, zhCN } from '@heyta/i18n';

// 🔴 路径必须相对本文件解析（vitest 的工作目录是 `apps/mobile`）。
const SCREEN = new URL('../src/screens/TaskDetailSheet.tsx', import.meta.url);
const LABELS = new URL('../src/lib/date-picker-labels.ts', import.meta.url);
const ZH = new URL('../../../packages/i18n/src/locales/zh-CN.ts', import.meta.url);
const EN = new URL('../../../packages/i18n/src/locales/en.ts', import.meta.url);

/** 读源码并**去掉注释** —— 注释里提到的函数名不算接上了。 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\S\s]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const screen = (): string => stripComments(readFileSync(SCREEN, 'utf8'));
const labels = (): string => stripComments(readFileSync(LABELS, 'utf8'));

/**
 * 取某一张 `DatePicker` 的 JSX 块（从它的开始标签到自我闭合的 `/>`）。
 *
 * 🔴 按 `value={...}` 这个实参选块，不按出现顺序：文件里有两张选择器（截止与
 * 排期起点），"第几个"会随别人往中间插块而漂移，而这两件事在产品里是不同的字段。
 */
const pickerBlock = (valueProp: string): string => {
  const src = screen();
  // 两张选择器所在的 JSX 层级不同，不能把某一档缩进当成结构契约。
  // 仍按精确 value prop 选中目标，并要求它是一个自闭合 DatePicker 节点。
  const opening = new RegExp(`<DatePicker\\s+value=\\{${valueProp}\\}`).exec(src);
  expect(opening, `源码里找不到 value={${valueProp}} 那张 DatePicker`).not.toBeNull();
  if (opening === null) return '';
  const start = opening.index;
  const closing = /\n\s*\/>/.exec(src.slice(start));
  expect(closing, `${valueProp} 那张 DatePicker 没有找到自闭合标签`).not.toBeNull();
  if (closing === null) return '';
  return src.slice(start, start + closing.index);
};

/** `datePickerTimeLabels` 的函数体。 */
const timeLabelsBody = (): string => {
  const src = labels();
  const start = src.indexOf('export function datePickerTimeLabels');
  expect(start, '源码里找不到 `datePickerTimeLabels`').toBeGreaterThan(-1);
  return src.slice(start);
};

/** 时刻那一行用到的四个键（完整写死：模板字面量拼不出 `MessageKey` 类型）。 */
const TIME_KEYS = [
  'common.due.timeLabel',
  'common.due.allDay',
  'common.due.timePlaceholder',
  'common.due.timeAria',
] as const;

describe('移动端截止时刻的输入侧（R14c）', () => {
  it('T1 截止那张选择器真的传了 `time=`，且可编辑性读的是"有没有日子"', () => {
    const due = pickerBlock('dueLocal');
    expect(due).toContain('time={{');
    // 🔴 `enabled` 必须是"这条有没有日子"，不是恒真、也不是"有没有时刻"：
    //    没日子就没有"几点"可言，而时刻栏此时应**画出来但填不进字**。
    expect(due).toContain('enabled: dueLocal !== undefined');
    expect(due).toContain('value: dueTimeValue');
    // 正向对照：这一句在 web 是同一形状（两端读同一个 prop，不是各写一套）。
    expect(due).toContain('labels: dueTimeText');
  });

  it('T2 写入走共享层那一条 `dueDateToEpoch(日子, 时刻)`，壳里没有第二套时分算术', () => {
    const due = pickerBlock('dueLocal');
    expect(due).toMatch(/dueDateToEpoch\(\s*dueLocal,\s*next\s*\)/u);
    expect(due).toMatch(/dueDateToEpoch\(\s*date,\s*dueTimeValue\s*\)/u);
    // 🔴 负向：没有本地 `getHours()` / `setHours()` —— 那是"两份裁决"的起手式，
    //    而漂移的后果（提醒提前一整天）界面上看不出来。
    expect(screen()).not.toMatch(/\bgetHours\s*\(/u);
    expect(screen()).not.toMatch(/\bsetHours\s*\(/u);
    // 正向对照：这个正则形状在本文件确实能命中（否则上面两条 not 没有牙）。
    expect(screen()).toMatch(/dueDateToEpoch\(/u);
  });

  it('T3 时刻那一行的四句措辞全在词条表里，壳里零硬编码文案', () => {
    // 🔴 迭代的是**词条键**而不是标签对象的属性名：那一行对外叫 `placeholder` /
    //    `aria`，表里叫 `common.due.timePlaceholder` / `timeAria`。第一版按属性名
    //    拼出 `t('common.due.placeholder')` 去比，红的是一句根本不存在的键 ——
    //    那种红既不是缺陷也不是通过，它只是探针自己在错。
    const body = timeLabelsBody();
    for (const key of TIME_KEYS) {
      expect(body, `缺少 t('${key}')`).toContain(`t('${key}'`);
    }
    // 🔴 移动端读的是 `common.due.*` 而不是 `web.due.*`（同一命名空间纪律，
    //    R15a 的 `common.profile.*` 已经立过一次）：键名说"哪个壳画的"，
    //    下一端要复用就只能再抄一份值。
    expect(body).not.toContain("t('web.");
    for (const literal of ['时刻', '全天', '时:分']) {
      expect(screen(), `选择器源码里出现了裸文案「${literal}」`).not.toContain(literal);
      expect(body, `措辞源码里出现了裸文案「${literal}」`).not.toContain(literal);
    }
    // 正向对照：注释剥干净了，所以「时刻」这两个字在剥完的文本里只可能来自真文案。
    expect(readFileSync(LABELS, 'utf8')).toContain('时刻');
  });

  it('T4 一次渲染里"这条有没有时刻"只读一处', () => {
    const src = screen();
    const derivations = (src.match(/\blocalTimeOf\s*\(/gu) ?? []).length;
    expect(derivations, `localTimeOf 读了 ${derivations} 次，应当只有一次`).toBe(1);
    // 正向对照：这一处确实被两处消费（时刻栏的值 + 换日子时的搬运）。
    expect((src.match(/\bdueTimeValue\b/gu) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('T5 中英两份表都有这四键，且「全天」与日历那条带逐字同源', () => {
    for (const key of TIME_KEYS) {
      expect(zhCN[key], `zh 表缺 ${key}`).toBeTruthy();
      expect(en[key], `en 表缺 ${key}`).toBeTruthy();
    }
    // 🔴 两键不并（键名说的是"哪块面的标签"），但值必须同源：
    //    「全天」在任务编辑器和时间线那条带里说成两种话，界面上就是两件事。
    expect(zhCN['common.due.allDay']).toBe(zhCN['common.calendar.dayAllDay']);
    expect(en['common.due.allDay']).toBe(en['common.calendar.dayAllDay']);
    // 反向对照：等值这条真的能红 —— 两条句子里至少有一条不是空串。
    expect(zhCN['common.due.allDay'].length).toBeGreaterThan(0);
  });

  it('🔴 旧的 `web.due.time*` 四键没有留在表里当第二份抄件', () => {
    const zh = readFileSync(ZH, 'utf8');
    const enSrc = readFileSync(EN, 'utf8');
    for (const src of [zh, enSrc]) {
      for (const key of ['timeLabel', 'allDay', 'timePlaceholder', 'timeAria']) {
        expect(src, `表里还留着 web.due.${key}`).not.toContain(`'web.due.${key}'`);
      }
    }
    // 正向对照：同一份文本里 `common.due.timeLabel` 一定在（否则上面的 not 是空读）。
    expect(zh).toContain("'common.due.timeLabel'");
    expect(enSrc).toContain("'common.due.timeLabel'");
  });

  it('T6 两张选择器各有 testID（设备脚本要能分辨点的是哪一张）', () => {
    const due = pickerBlock('dueLocal');
    const schedule = pickerBlock('startLocal');
    expect(due).toContain('testID="task-due"');
    expect(schedule).toContain('testID="task-schedule-start"');
    // 🔴 共享层把 `testID` 派生成 `${testID}-time-input`（`DatePicker.tsx:337`），
    //    宿主不传就两边都是默认的 `date-picker` —— 同一屏出现两个同名节点时，
    //    `uiautomator` 的 dump 里点哪个都可能，设备判据会对着错的输入框读数。
    expect(screen()).not.toContain("testID=\"date-picker\"");
    expect([due, schedule].filter((b) => /testID="/u.test(b)).length).toBe(2);
  });

  it('排期起点那张**没有**接时刻栏（本批的范围裁决，写死免得下一批顺手加上）', () => {
    const schedule = pickerBlock('startLocal');
    expect(schedule).not.toContain('time={{');
    // 正向对照：同文件另一张（截止）接上了 —— 见 T1。
    expect(pickerBlock('dueLocal')).toContain('time={{');
    // 排期仍走自己的那条 op（一次意图一条 op），没有顺手变成两次写。
    expect(schedule).toContain('actions.setSchedule(');
  });
});
