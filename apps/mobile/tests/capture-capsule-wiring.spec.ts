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

/**
 * 🔴 移动端日期面板走底部面板那一档（目标原话点名的 `mobile BottomSheet`）。
 *
 * 上一轮这一格是"接上、量完、撤掉"（§9.6），撤的理由是三处退化。这一版按**成因**分别处理，
 * 所以这里钉的是"三个成因各有一枚会红的钉子"，不是"外壳换了"：
 *  · 出口掉到折叠线以下 ⇒ 出口段必须放进 `footer`（`ScrollView` 之外的兄弟节点）；
 *  · 盖住输入行 ⇒ 档位是 `medium`，不是铺满；
 *  · 语义档位 ⇒ `overlay="popover"`（表里那档无 ×、点外面/返回键收起），
 *    用 `'bottom-sheet'` 会多画一枚 × 并把 Esc 判成 deny。
 * 再加一条**互斥**钉子：出口在共享件里恰好两处、且都被 `outlet === 'inline'` 管着 ——
 * 分置模式下两处都画 = 同一目的地两个控件；一处都不画 = 非整半点填不进去。
 */
describe('移动端：日期面板的底部面板档位', () => {
  const screen = stripComments(read('apps/mobile/src/screens/TasksScreen.tsx'));
  const panel = stripComments(read('packages/ui/src/capture/CaptureDuePanel.tsx'));

  it('① 出口段交给宿主的 footer，档位是 medium，语义是 popover', () => {
    /*
     * 🔴 必须**锚在 `renderDuePanel` 那一段里**。同一个文件里还有别的底部面板，
     *    它们也写着 `detents={['medium']}` —— 拿全文 `toContain` 去问，是别人的段落替我的作答
     *    （第一版就是这样，把档位改成 `large` 它照样绿）。
     */
    const at = screen.indexOf('duePanelOutlet="footer"');
    expect(at, '宿主没把 duePanelOutlet 交给共享件').toBeGreaterThan(-1);
    const sheet = screen.slice(at, at + 1200);
    expect(sheet).toMatch(/renderDuePanel=\{\(slot\) => \(\s*<BottomSheet[\s\S]{0,900}?footer=\{slot\.footerContent\}/);
    expect(sheet).toMatch(/detents=\{\['medium'\]\}/);
    expect(sheet).toMatch(/overlay="popover"/);
  });

  it('② 关闭措辞从词条来（宿主不许自己写一句"关闭"）', () => {
    expect(screen).toContain("t('mobile.capture.panel.sheetClose')");
  });

  it('③ 宿主没有第二份面板：出口只许由共享件决定画几处', () => {
    expect(screen, '宿主自己渲染面板 = 出口可能被画两遍或一遍都没有').not.toContain('CaptureDuePanel');
  });

  it('④ 共享件里出口恰好两处，且都被 inline 判定管着（分置时一处都不画在体内）', () => {
    const guarded = panel.match(/outlet === 'inline' \?/g) ?? [];
    expect(guarded.length, '出口分支的数量变了 ⇒ 分置模式下可能两处都画或都不画，回去重看 §9.33').toBe(2);
    expect(panel.match(/testID="capture-time-row"/g) ?? []).toHaveLength(1);
    expect(panel.match(/testID="capture-time-mode"/g) ?? []).toHaveLength(1);
  });

  it('⑤ 标题由**此刻那句话**推：宿主不许把静态那句硬写死', () => {
    /*
     * 🔴 这一格守的是模态里唯一还能动人的不变量：壳起来后输入行既被盖住也不在可及性树上，
     *    标题是"我在改哪句话"的唯一出口。判的是**接线**（标题取自 slot.subject、走带变量的
     *    词条、没打字时回静态那句），画没画出来由设备腿 ④b 两格量（Yoga 会把它量成 0 高，
     *    而 web/jsdom 两侧看不见那一格）。
     */
    const at = screen.indexOf('duePanelOutlet="footer"');
    expect(at, '宿主没把 duePanelOutlet 交给共享件').toBeGreaterThan(-1);
    const sheet = screen.slice(at, at + 1200);
    expect(sheet, '标题没取 slot.subject ⇒ 壳起来后没人说得出在改哪句话').toMatch(/title=\{dueSheetTitle\(slot\.subject\)\}/);
    // 🔴 壳里只许有**措辞**：那两个词条各是一句怎么说，而"什么时候说哪句"是判断，
    //    必须交回共享层 `captureDuePanelTitle`（AGENTS §3.5）。所以这里钉的是
    //    "宿主把措辞交给共享判断"这个形状，而不是宿主自己写的那个三元表达式。
    expect(screen).toContain('captureDuePanelTitle(');
    expect(screen).toContain("withDraft: (draft) => t('mobile.capture.panel.titleWithDraft', { draft })");
    expect(screen).toContain('staticTitle: labels.panel.title');
    expect(screen, '判断被抄回壳里 = 两端各写一份，迟早漂').not.toMatch(/trimmed === ''\s*\?/u);
  });

  it('⑥ 共享件把草稿交给槽位（宿主拿不到输入框，也不许自己去猜）', () => {
    const shared = stripComments(read('packages/ui/src/capture/CaptureComposer.tsx'));
    expect(shared).toMatch(/readonly subject: string;/u);
    expect(shared, '槽位没带 subject ⇒ 移动端那一档的标题只能写死成静态那句').toMatch(/subject: draft,/u);
  });
});
