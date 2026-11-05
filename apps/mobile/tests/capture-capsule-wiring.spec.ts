/**
 * 手机端收集框的胶囊接线判据（2026-11-04 对齐滴答清单 · S5 的移动侧）
 * ====================================================================
 *
 * web 那一侧有 jsdom 与真浏览器两层判据；移动端**跑不了 Playwright**，
 * 而它用的是**同一份**共享组件 —— 所以这里钉的是"移动端有没有真的把
 * 宿主该给的三样东西接上"，形状本身由 `packages/ui` 与 web 那两层负责。
 *
 * 🔴 为什么这三条值得单独一枚钉子，而不是靠"共享层只有一份"就完事：
 *  ① `quickPicks` 不传 ⇒ 面板里那四档快捷项**静默消失**，界面仍然合法、仍然能选日子，
 *     只是没人会想到少了什么（与"加一档不改进去"那族同一个形状）；
 *  ② `showPreview` 一旦有人改回 `true` ⇒ 两端形状立刻分叉（web 关、mobile 开），
 *     而这件事**上一轮真的发生过**，还被 `verify-mobile-capture.sh` 钉成了验收项；
 *  ③ 宿主没给 `capsule` / `panel` 措辞 ⇒ 类型会红，但 `capsule` 的**空态返回空串**
 *     这一条类型管不着：返回 `'未设置'` 一样编译通过，而那是本仓禁止的审计腔。
 *
 * ⚠️ 这里钉的是"线接上了"；真机上按一枚胶囊、面板真的画出来，
 * 由设备腿 `scripts/verify-mobile-capture.sh` 判 —— **本轮没有跑过它**，
 * 读数见 `docs/plans/capture-ticktick-alignment-2026-11.md` §9.3 第 6 条。
 */

import { describe, expect, it } from 'vitest';

import { read, stripComments } from './source-reading';

describe('移动端：宿主该给的三样都给了', () => {
  const screen = stripComments(read('apps/mobile/src/screens/TasksScreen.tsx'));
  const labels = stripComments(read('apps/mobile/src/lib/capture-labels.ts'));

  it('① 新建任务面板把快捷四档交给共享捕获件', () => {
    expect(screen).toMatch(/quickPicks=\{quickDatePicks\(/);
  });

  it('② 「实际标题」那一行已经从实现里消失（不是"关掉了"）', () => {
    // 🔴 两端曾经形状不同：web 关了、mobile 留着，而 `verify-mobile-capture.sh`
    //    还把 mobile 那一行钉成验收项。本轮把 prop、渲染、词条一起删 ——
    //    所以这里钉的是"不再有这个东西"，而不是"移动端没打开它"。
    //    一条 `expect(mount).not.toContain('showPreview')` 在 prop 还存在时也能绿
    //    （只要没人传它），那是假绿；判据落在共享实现本身才红得起来。
    const shared = stripComments(read('packages/ui/src/capture/CaptureComposer.tsx'));
    expect(shared).not.toContain('showPreview');
    expect(shared).not.toContain('capture-preview');
    // 挂载点仍只有一枚，且不许有人再往里塞那个开关
    const mounts = screen.match(/<CaptureComposer[\s\S]*?\/>/g) ?? [];
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).not.toContain('showPreview');
  });

  it('🔴 ③ 胶囊空态返回**空串**，不是「未设置」这类审计腔', () => {
    expect(labels).toMatch(/if \(kind === 'empty' \|\| due\.date === undefined\) return '';/);
    expect(labels).not.toMatch(/capsule:[\s\S]{0,200}detail\.unset/);
  });

  it('面板措辞复用详情面那一份 `datePickerLabels`，不是再抄一套月历说法', () => {
    expect(labels).toMatch(/datePicker: datePickerLabels\(t\)/);
  });

  it('时刻子视图的四句措辞都从词条来（列表 / 其它时间 / 返回 / 入口无障碍名）', () => {
    for (const key of ['otherTime', 'backToList', 'backToDay', 'rowAria']) {
      expect(labels, `mobile.capture.panel.time.${key}`).toContain(`mobile.capture.panel.time.${key}`);
    }
  });
});
