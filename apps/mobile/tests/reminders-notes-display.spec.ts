/**
 * 提醒面板 / 便签板的**文案接线**测试（移动端）
 * ==============================================
 *
 * ⚠️ 本仓库**没有组件级渲染测试**（`apps/web` 与 `apps/mobile` 都只测纯函数，
 * 见 `packages/ui/vitest.config.ts` 文件头）—— 所以这里测的**不是"渲染得对不对"**，
 * 而是那些"写错不会让界面报错、只会静默错"的接线：
 *
 *   1. 🔴 **`labels.offsets` 必须与 `REMINDER_OFFSET_PRESETS_MS` 逐项同序**。
 *      共享组件按下标取文案（`labels.offsets[i]` ↔ `presets[i]`）。
 *      一旦错位，"提前 30 分钟"的按钮点下去建的是"提前 1 天"的提醒 ——
 *      界面完全正常，只在用户等通知的时候才暴露。
 *   2. 🔴 **没有截止时间时不许渲染「截止时」预设**（任务书写的是"不渲染"）。
 *      没有渲染测试，所以退而求其次：读**共享组件源码**，钉住那条分支
 *      （手法与 `tests/habits-display.spec.ts` 读 `packages/ui/src/habits/model.ts`
 *      完全一致 —— 本仓库既有的、对共享层漂移的守卫方式）。
 *   3. **文案与数字的一对**：`reminder.absolute.1h` ↔ `现在 + 1 小时`、
 *      `reminder.a11y.snooze` 里的"10 分钟" ↔ `snoozeDeadline(now, 10)`。
 *      这两处字面上分居两文件，改一处不报错。
 *   4. 便签的四个 `a11y*` 名的占位符变量名必须与词条逐字相同 ——
 *      `translate()` 对认不出的占位符会**原样保留**，拼错只会把 `{excerpt}`
 *      念给读屏用户听。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REMINDER_OFFSET_PRESETS_MS, snoozeDeadline } from '@heyta/domain';
import { translate, type MessageKey } from '@heyta/i18n';
import { describe, expect, it } from 'vitest';

import { formatStamp } from '../src/lib/date';
import { notesBoardLabels } from '../src/lib/notes-display';
import {
  ABSOLUTE_REMINDER_LEAD_MS,
  absoluteReminderTriggerAt,
  reminderListLabels,
  reminderOffsetKeys,
  snoozeTargetAt,
} from '../src/lib/reminders-display';

/** 与界面同一条路：走真的词条表（缺 key 会**抛**，不是返回空串）。 */
const zh = (key: MessageKey, vars?: Record<string, string | number>): string =>
  translate('zh-CN', key, vars);
const en = (key: MessageKey, vars?: Record<string, string | number>): string =>
  translate('en', key, vars);

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('reminderListLabels：offsets 与 REMINDER_OFFSET_PRESETS_MS 逐项同序', () => {
  it('长度 = 领域层预设数（领域层加一档而这里没加 → 立刻红）', () => {
    expect(reminderListLabels(zh).offsets).toHaveLength(REMINDER_OFFSET_PRESETS_MS.length);
    expect(reminderOffsetKeys()).toHaveLength(REMINDER_OFFSET_PRESETS_MS.length);
  });

  it('🔴 顺序逐项对齐：按钮说"提前 30 分钟"，建的就必须是 30 分钟那一档', () => {
    // 领域层的顺序（这条断言把"数字"与"文案"绑在同一行上）。
    expect([...REMINDER_OFFSET_PRESETS_MS]).toEqual([
      0,
      5 * MINUTE,
      15 * MINUTE,
      30 * MINUTE,
      HOUR,
      DAY,
    ]);
    // 界面文案的顺序。
    expect([...reminderListLabels(zh).offsets]).toEqual([
      '截止时',
      '提前 5 分钟',
      '提前 15 分钟',
      '提前 30 分钟',
      '提前 1 小时',
      '提前 1 天',
    ]);
    // 下标 3 在两边都是"30 分钟"—— 这正是"按钮说 30 分钟、实际建 1 天"的判据。
    expect(REMINDER_OFFSET_PRESETS_MS[3]).toBe(30 * MINUTE);
    expect(reminderListLabels(zh).offsets[3]).toBe('提前 30 分钟');
    expect(REMINDER_OFFSET_PRESETS_MS[5]).toBe(DAY);
    expect(reminderListLabels(zh).offsets[5]).toBe('提前 1 天');
  });

  it('英文侧同序（漏翻一条会变成两种语言按钮顺序不同）', () => {
    expect([...reminderListLabels(en).offsets]).toEqual([
      'At due time',
      '5 minutes before',
      '15 minutes before',
      '30 minutes before',
      '1 hour before',
      '1 day before',
    ]);
  });

  it('每一个预设都有词条 key（缺席时 `offsetMessageKey` 抛，而不是渲染空串）', () => {
    expect(() => reminderListLabels(zh)).not.toThrow();
    expect([...reminderOffsetKeys()]).toEqual([
      'reminder.offset.0',
      'reminder.offset.5m',
      'reminder.offset.15m',
      'reminder.offset.30m',
      'reminder.offset.1h',
      'reminder.offset.1d',
    ]);
  });

  it('「1 小时后提醒」不混进 offsets —— 它是绝对时刻入口，不是第 7 个预设', () => {
    expect(reminderListLabels(zh).offsets).not.toContain('1 小时后提醒');
  });
});

describe('没有截止时间时的入口：文案与"现在 + 1 小时"绑在一起', () => {
  it('absolute 用的是 `reminder.absolute.1h`；入口建的是正好 1 小时后', () => {
    expect(reminderListLabels(zh).absolute).toBe('1 小时后提醒');
    expect(reminderListLabels(en).absolute).toBe('Remind me in 1 hour');
    // 🔴 键名里的 `1h` 是契约：文案与下面这个数字必须同时改。
    expect(ABSOLUTE_REMINDER_LEAD_MS).toBe(HOUR);
    expect(absoluteReminderTriggerAt(NOW)).toBe(NOW + HOUR);
  });

  it('noDueDate 是**说明**（不是按钮字），且和 absolute 是两句不同的话', () => {
    const labels = reminderListLabels(zh);
    expect(labels.noDueDate).toContain('没有截止时间');
    expect(labels.noDueDate).not.toBe(labels.absolute);
  });
});

describe('稍后提醒：读屏说 10 分钟，实际就必须推迟 10 分钟', () => {
  it('`snoozeTargetAt` 走领域层 `snoozeDeadline`，与 a11y 文案里的数字一致', () => {
    expect(reminderListLabels(zh).a11ySnooze(NOW)).toContain('10 分钟');
    expect(snoozeTargetAt(NOW)).toBe(snoozeDeadline(NOW, 10));
    expect(snoozeTargetAt(NOW)).toBe(NOW + 10 * MINUTE);
  });
});

describe('phase / a11y：五个状态一个不漏，占位符真的被替换', () => {
  it('phase 是五个状态（Record 在编译期已钉住，这里钉运行时文案非空）', () => {
    const labels = reminderListLabels(en);
    expect(Object.keys(labels.phase).sort()).toEqual([
      'dismissed',
      'due',
      'fired',
      'scheduled',
      'snoozed',
    ]);
    for (const value of Object.values(labels.phase)) {
      expect(value).not.toBe('');
    }
  });

  it('a11y 时刻名里是格式化后的时刻，不是原样的占位符', () => {
    const labels = reminderListLabels(zh);
    expect(labels.a11yRemove(NOW)).toContain(formatStamp(NOW));
    expect(labels.a11ySnooze(NOW)).toContain(formatStamp(NOW));
    expect(labels.a11yDismiss(NOW)).toContain(formatStamp(NOW));
    // `{when}` 必须已经被替换掉 —— 留着它就是把占位符念给用户听。
    expect(labels.a11yRemove(NOW)).not.toContain('{when}');
  });

  it('整块的无障碍名带上列表标题', () => {
    expect(reminderListLabels(zh).a11yList('提醒')).toContain('提醒');
    expect(reminderListLabels(zh).a11yList('提醒')).not.toContain('{title}');
  });
});

describe('共享 ReminderList 的分支：无截止时间不渲染「截止时」预设', () => {
  it('presets 在 `!hasDueDate` 时为空，绝对时刻入口只由 `onAddAbsolute` 打开', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    /**
     * ⚠️ `HEYTA_REMINDER_SHARED_VIEW` 是**只读接缝**，只给故障注入用
     * （把共享层源码复制到 `/tmp`、改一处、指过去）。不设时就是真实路径。
     */
    const source = readFileSync(
      process.env.HEYTA_REMINDER_SHARED_VIEW ??
        resolve(here, '../../../packages/ui/src/reminders/ReminderList.tsx'),
      'utf8',
    );

    // 判据锚点自检：找不到就说明共享组件被改名/重写，而不是"通过"。
    const presetsBranch = 'const presets = hasDueDate ? offsetPresets() : [];';
    expect(
      source,
      '共享层找不到 `presets` 分支 —— 判据锚点已失效，请更新本测试',
    ).toContain(presetsBranch);

    // 🔴 无截止时间时**不许**回退成 `offsetPresets().slice(0, 1)`（那是旧的 bug：
    // 留下写着「截止时」的按钮，而它按下去必然抛错）。空数组是唯一正确解。
    //
    // ⚠️ 必须在**剥掉注释**的代码上查 —— 共享组件的文件头**正在讲**这个旧 bug
    // （"这里曾经是 `… : offsetPresets().slice(0, 1)`"），直接查原文会命中那句说明。
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toContain('slice(0, 1)');

    // 绝对时刻入口只在无截止时间且传了 `onAddAbsolute` 时渲染，且用 `labels.absolute`。
    expect(source).toContain('{hasDueDate || onAddAbsolute === undefined ? null : (');
    expect(source).toContain('accessibilityLabel={labels.absolute}');
  });
});

describe('notesBoardLabels：共享 NotesBoard 的文案契约', () => {
  it('每一项都映射到 `notes.*` 词条，钉选两个状态是不同的话', () => {
    const labels = notesBoardLabels(zh);
    expect(labels.empty).toBe('还没有便签');
    expect(labels.emptyHint).not.toBe('');
    expect(labels.composerPlaceholder).not.toBe('');
    expect(labels.add).toBe('添加便签');
    expect(labels.remove).toBe('删除便签');
    expect(labels.badgeToday).toBe('今天');
    // 「钉选」与「取消钉选」必须是两句不同的话 —— 相同会让用户看不出当前状态。
    expect(labels.pin).not.toBe(labels.unpin);
  });

  it('🔴 四个 a11y 名的 `{excerpt}` 被真的替换掉（变量名拼错会被原样保留）', () => {
    const labels = notesBoardLabels(zh);
    for (const text of [
      labels.a11yEdit('买牛奶'),
      labels.a11yRemove('买牛奶'),
      labels.a11yPin('买牛奶'),
      labels.a11yUnpin('买牛奶'),
    ]) {
      expect(text).toContain('买牛奶');
      expect(text).not.toContain('{excerpt}');
    }
  });

  it('🔴 saveFailed 走 notes.error.saveFailed，且把「内容还在」说进话里（W8b）', () => {
    // 缺 key 时 `t` 会抛 —— 两侧构造本身就是"词条存在"的判据；再钉值与关键词。
    expect(notesBoardLabels(zh).saveFailed).toBe(zh('notes.error.saveFailed'));
    expect(notesBoardLabels(en).saveFailed).toBe(en('notes.error.saveFailed'));
    // 这句文案的承重承诺：失败时草稿**还留在输入框里**（共享层 W8a 的保草稿）。
    // 共享层若改回"失败清草稿"，这句话就在撒谎 —— 用关键词把它钉住。
    expect(notesBoardLabels(zh).saveFailed).toContain('输入框');
    expect(notesBoardLabels(en).saveFailed).toContain('still in the box');
  });
});

/**
 * 宿主接线守卫（源码级）。
 *
 * 🔴 为什么需要它：`ReminderList` 的 `onAddAbsolute` 是**可选** prop
 * （不传就不渲染那个入口），所以"忘了把绝对时刻入口接上"**不会**是类型错误
 * —— 界面只会少一个按钮，没有任何一处报错。同理，`NotesBoard` 的三个回调
 * 少接一个，也只是那个动作点了没反应。
 *
 * ⚠️ 本仓库没有组件渲染测试（见文件头），所以这一层只能在源码上钉。
 * 它与 `check:ui-provider` 是两种不同的守卫：那道门禁管"组件挂在 Provider 里"，
 * 这条管"回调真的传了"。
 */
describe('宿主接线：共享组件的必填回调真的传了（少传不会报类型错）', () => {
  const here = dirname(fileURLToPath(import.meta.url));

  it('`TaskDetailSheet` 传了 onAdd / onAddAbsolute（后者漏传 = 无截止时间时入口静默消失）', () => {
    const screen = readFileSync(resolve(here, '../src/screens/TaskDetailSheet.tsx'), 'utf8');
    expect(screen).toContain('<ReminderList');
    expect(screen).toContain('onAdd={addBeforeDue}');
    expect(screen).toContain('onAddAbsolute={addAbsoluteInOneHour}');
    expect(screen).toContain('onSnooze={snooze}');
    expect(screen).toContain('onDismiss={dismiss}');
    expect(screen).toContain('onRemove={removeReminder}');
  });

  it('`NotesSection` 把 NotesBoard 的四个回调都接上了（含 onEdit）', () => {
    const screen = readFileSync(resolve(here, '../src/screens/NotesSection.tsx'), 'utf8');
    expect(screen).toContain('<NotesBoard');
    expect(screen).toContain('onAdd={(content) => {');
    expect(screen).toContain('onRemove={(entityId) => {');
    expect(screen).toContain('onTogglePinned={(entityId, pinned) => {');
    // 🔴 W8b：onAdd 的失败必须交回共享层 —— `run(...)` 把 reject 咽成本地 error，
    // 共享层只看得到 resolve（= 假 saved ⇒ 清草稿）；`actions === null` 静默
    // return 同罪（"没提交"被当成"存上了"）。两条接线判据钉在源码上
    // （本仓库对"少传/改错回调不报类型错"的既有守卫方式，见本 describe 文件头）。
    expect(screen).toContain("if (actions === null) throw new Error(t('notes.error.saveFailed'));");
    expect(screen).toContain('return runAdd(actions.createNote(content));');
    // 🔴 **这条断言是翻向的**（多端第二批，2026-10-03）。原文是
    // `expect(screen).not.toContain('onEdit=')`，理由「移动端没有便签编辑屏」。
    // 屏有了（`NoteEditScreen`），所以"不传"从正确变成缺陷：摘要那段会退回纯文本，
    // 用户写错一个字只能删掉重建一条（丢掉钉选与创建时间）。
    expect(screen).toContain('onEdit=');
    /**
     * 但"传了 onEdit"本身不等于"改动能落库" —— 接线只证明入口在。
     * 所以这里同时钉住**那条真 op 的落点**：编辑屏走的是动作层的
     * `updateNoteContent`（op 的构造只有 app-host 一份，AGENTS §3.5），
     * 而不是在界面里改状态、也不是拼一个 `entityType: 'NOTE'`。
     */
    const editor = readFileSync(resolve(here, '../src/screens/NoteEditScreen.tsx'), 'utf8');
    expect(editor).toContain('.updateNoteContent(noteId, content)');
    expect(editor).not.toContain("entityType: 'NOTE'");
  });

  it('`ProfileScreen` 真的挂了 NotesSection（挂不上就白做，且没有别的门禁）', () => {
    const screen = readFileSync(resolve(here, '../src/screens/ProfileScreen.tsx'), 'utf8');
    expect(screen).toContain("import { NotesSection } from './NotesSection';");
    expect(screen).toContain('<NotesSection />');
  });
});
