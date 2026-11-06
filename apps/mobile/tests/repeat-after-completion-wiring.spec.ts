/**
 * 「完成后顺延」在**移动端**接没接上（2026-11-06，滴答对齐 §五 第 3 步）。
 *
 * 为什么用 source-reading 这层而不是渲染整张面单：这一格要证的不是"点下去颜色对不对"，
 * 而是**那条调用边存不存在** —— 本仓栽过两次同形状的洞：领域层有函数、界面有控件、
 * 中间没有线，于是**每一块单独看都是绿的**（`repeat-actions.spec.ts` 文件头第 4 条、
 * `packages/app-host/tests/repeat-actions.spec.ts` 的"最后一米"那一组）。
 * 动作层的**行为**判据在 `packages/app-host/tests/repeat-actions.spec.ts`
 * （两档基准各一条，且验过摘掉分支会红），这里只钉移动端这一半。
 */
import { describe, expect, it } from 'vitest';

import { read, stripComments } from './source-reading';

const sheet = stripComments(read('apps/mobile/src/screens/TaskDetailSheet.tsx'));

describe('移动端：完成后顺延这一格真的接到了动作层', () => {
  it('面单调了 `actions.setRepeatAfterCompletion`（不是只画一枚不会动的 chip）', () => {
    expect(sheet).toContain('setRepeatAfterCompletion(');
  });

  it('这一格有稳定探针，且选中态读的是那个字段（不是本地 state）', () => {
    expect(sheet).toContain('task-detail-repeat-after-completion');
    // 读回来的是任务上的字段 ⇒ "另一台设备设过"也能正确显示；本地 state 会骗人。
    expect(sheet).toContain('task.repeatAfterCompletion === true');
  });

  it('两份词表都有这两条（缺一条就是另一种语言里界面会显示 key）', async () => {
    const zh = read('packages/i18n/src/locales/zh-CN.ts');
    const en = read('packages/i18n/src/locales/en.ts');
    for (const key of [
      'mobile.detail.repeat.afterCompletion',
      'mobile.detail.repeat.afterCompletionHint',
    ]) {
      expect(zh, `zh-CN 少了 ${key}`).toContain(`'${key}'`);
      expect(en, `en 少了 ${key}`).toContain(`'${key}'`);
    }
  });
});
