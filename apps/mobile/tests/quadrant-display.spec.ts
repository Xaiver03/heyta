/**
 * 移动端四象限的文案接线测试
 * ============================
 *
 * 🔴 这里防的**不是"分桶算错了"**（那在 `@heyta/domain` / `@heyta/ui` 的
 * `model.ts` 里，各有自己的测试），而是**两端漂移与假话**：
 *
 *   1. `quadrantBoardLabels` 是移动端与共享 `QuadrantBoard` 的**唯一接缝** ——
 *      少给一项、或给错了命名空间，共享层不会报错，只是界面上少一句话。
 *   2. 标题 / 说明必须与 web 端说的是**同一批词条**（本刀没加新键，
 *      见 `lib/quadrant-display.ts` 的命名残差）。键名一旦漂移，
 *      两端会对同一件事说两种话，而各自的测试都是绿的。
 *   3. 🔴 **空态不能说"拖任务到这里"**：移动端没有拖放，照搬
 *      `web.quadrant.dropHere` 就是让界面承诺一个不存在的动作。
 *      这条断言是那个决定唯一的守卫。
 */

import { Quadrant } from '@heyta/domain';
import { translate } from '@heyta/i18n';
import { describe, expect, it } from 'vitest';

import {
  QUADRANT_HINT_KEYS,
  QUADRANT_TITLE_KEYS,
  quadrantBoardLabels,
} from '../src/lib/quadrant-display';

/** 与界面同一条路：走真的词条表（缺 key 会**抛**，不是返回空串）。 */
const zh = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>): string =>
  translate('zh-CN', key, vars);
const en = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>): string =>
  translate('en', key, vars);

describe('quadrantBoardLabels：象限映射到共享层契约', () => {
  it('四象限的标题与说明（中文）', () => {
    const labels = quadrantBoardLabels(zh);
    expect(labels.title(Quadrant.UrgentImportant)).toBe('马上做');
    expect(labels.title(Quadrant.ImportantNotUrgent)).toBe('计划做');
    expect(labels.title(Quadrant.UrgentNotImportant)).toBe('交给别人');
    expect(labels.title(Quadrant.Neither)).toBe('先不做');

    expect(labels.hint(Quadrant.UrgentImportant)).toBe('重要且紧急');
    expect(labels.hint(Quadrant.ImportantNotUrgent)).toBe('重要不紧急');
    expect(labels.hint(Quadrant.UrgentNotImportant)).toBe('紧急不重要');
    expect(labels.hint(Quadrant.Neither)).toBe('不重要不紧急');
  });

  it('同一批键在英文表里也有话说（不是漏翻）', () => {
    const labels = quadrantBoardLabels(en);
    expect(labels.title(Quadrant.UrgentImportant)).toBe('Do now');
    expect(labels.hint(Quadrant.UrgentImportant)).toBe('Important and urgent');
    expect(labels.empty(Quadrant.Neither)).not.toBe('');
  });

  it('cellA11y 是一整句，且带上标题与说明', () => {
    const labels = quadrantBoardLabels(zh);
    expect(
      labels.cellA11y({
        quadrant: Quadrant.UrgentImportant,
        title: '马上做',
        hint: '重要且紧急',
        count: 3,
      }),
    ).toBe('象限：马上做，重要且紧急');
  });

  it('🔴 空态是事实句，不是「拖任务到这里」（移动端没有拖放）', () => {
    const labels = quadrantBoardLabels(zh);
    expect(labels.empty(Quadrant.UrgentImportant)).toBe('这里还没有任务');
    // 把这条写死：web 的空态专指拖放，不能漂移过来。
    expect(labels.empty(Quadrant.UrgentImportant)).not.toBe(zh('web.quadrant.dropHere'));
  });

  it('footnote 刻意不传（web 那句在讲拖拽会改截止时间，移动端拖不了）', () => {
    expect(quadrantBoardLabels(zh).footnote).toBeUndefined();
  });

  it('复用 web.quadrant.* 的键名（已知命名残差；合并命名空间时这里是纯改名）', () => {
    expect(QUADRANT_TITLE_KEYS[Quadrant.UrgentImportant]).toBe('web.quadrant.do');
    expect(QUADRANT_TITLE_KEYS[Quadrant.ImportantNotUrgent]).toBe('web.quadrant.plan');
    expect(QUADRANT_TITLE_KEYS[Quadrant.UrgentNotImportant]).toBe('web.quadrant.delegate');
    expect(QUADRANT_TITLE_KEYS[Quadrant.Neither]).toBe('web.quadrant.drop');
    expect(QUADRANT_HINT_KEYS[Quadrant.UrgentImportant]).toBe('web.quadrant.q1');
    expect(QUADRANT_HINT_KEYS[Quadrant.Neither]).toBe('web.quadrant.q4');
  });
});
