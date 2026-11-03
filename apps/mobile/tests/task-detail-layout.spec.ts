/**
 * 移动端任务详情面板的**解剖**（内容层 / 折叠层 / 常驻动作区）
 * ==========================================================
 *
 * ## 为什么是**源码级**断言
 *
 * `apps/mobile` 没有组件测试栈（刻意不引 `@testing-library/*`，理由见
 * `packages/ui/vitest.config.ts` 文件头），所以这一族判据的形状与
 * `tests/subtask-entry.spec.ts`、`tests/task-due-time.spec.ts` 完全一致：
 * 钉的是**接线与结构**，行为本身归设备脚本（`verify:mobile-*` 那一族）与真机渲染。
 *
 * ## 它要防的失效不是"算错了"，而是"结构又长回去了"
 *
 * 重排之前这块面板是 **13 个区段一次性全展开**的编辑表单：标题是一格写着"标题"的
 * 输入框、完成 / 删除在滚动内容**之外**、没有"次要"这个概念。那三条每一条都有
 * 已入库的判据（`docs/agents/ux-principles.md` §1 / §3 / §4），而 `check:design`、
 * `check:l4`、`check:overlay`、类型检查**全都不会红** —— 界面结构是三层门禁共同的
 * 盲区（"6 种解剖 / 26 处手写标签"那次事故就是这么长出来的）。
 *
 * 🔴 每条判据都同时给**正向锚点**（探针读得到、形状命中得了）与**反向断言**
 * （违规形状会被打中）：只有"没命中"能被判成"违规"而不是"没读到"，绿才是证据。
 * 单条注入验证写在每条判据的注释里，整族注入见本文件末尾那一条。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHEET = resolve(HERE, '../src/screens/TaskDetailSheet.tsx');
/**
 * "动作区不随正文滚走"是**几何**判据，而几何由共享原语决定，不由宿主决定 ——
 * 所以这一条读 `packages/ui/src/overlay/BottomSheet.tsx` 的真实源码
 * （与 `tests/reminders-notes-display.spec.ts` 读共享 `ReminderList` 同一个手法）。
 */
const BOTTOM_SHEET = resolve(HERE, '../../../packages/ui/src/overlay/BottomSheet.tsx');

/**
 * 剥掉注释。
 *
 * 🔴 必须剥：这一族判据几乎全是 `not.toMatch`，而面板的文件头**正在逐字描述**
 * 那些旧形状（"标题是一格写着『标题』的输入框"）。不剥注释的话，
 * 反向断言会命中**说明文字**，于是"讲过这个 bug"变成"还有这个 bug"。
 */
const strip = (src: string): string =>
  src.replace(/\/\*[\S\s]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const sheet = (): string => strip(readFileSync(SHEET, 'utf8'));

/** 取 `footer={…}` 那一块的内容（`BottomSheet` 的 `footer` 槽）。 */
const footerBlock = (src: string): string | undefined =>
  /footer=\{([\S\s]*?)\n      \}\n    >/.exec(src)?.[1];

/**
 * 折叠层应当有哪几格。
 *
 * 🔴 这份清单是**判据**，不是抄件：新增一格而忘了登记，下面的计数会红。
 * 截止（`due`）**刻意不在这里** —— 它的触发器就是内容层那一行日期状态：
 * 值常驻可见、点开才出 `DatePicker`，所以它既不是"平铺的区段"，也不是折叠层的一格。
 *
 * `activity`（任务动态）是 2026-11-02 随工单 #8 加的一格：它是这一屏上**唯一**
 * 需要异步读本地 op-log 的格子，读回来的是"这台设备记录到的变更"。
 */
const FOLDED = [
  'reminders',
  'repeat',
  'schedule',
  'priority',
  'important',
  'project',
  'parent',
  'tags',
  'activity',
] as const;

describe('① 内容层常驻：首屏回答"这是什么任务"，不是"这条记录有哪些列"', () => {
  it('🔴 标题是大字正文，编辑态才出输入框（默认形状不是带 label 的 TextField）', () => {
    const src = sheet();
    // 正向锚点：正文态那一支存在，且标题由**共享行**画成正文（不是输入框）。
    expect(src).toMatch(/\{\s*editingTitle\s*\?\s*\(/);
    // 🔴 2026-11-02 换锚点：原来这里钉的是 `<Text variant="screen-title"`（面板自己
    //   画大字标题）。那是 `check:row-single-source` 抓的"第二份行实现"的一部分 ——
    //   标题现在由 `packages/ui` 的 `TaskRow` 画（唯一那份）。
    //   ⚠️ 顺带如实记下代价：拿不到 `screen-title` 那一档字号，因为
    //   `density.ts:32` 明文禁止按密度改排印（"标题永远是 row-title"）。
    //   本条断言的**实质没变**：首屏不许是一格写着"标题"的输入框。
    expect(src, '标题没有交给共享的那一份行实现').toContain('<TaskRow');
    // `TextField` 必须落在**编辑分支**里（否则首屏又是一格写着"标题"的输入框）。
    // ⚠️ `{0,600}` 不是随手放的：注入验证时用过 `{0,200}`，红的是探针自己
    // （`<TextField>` 到它的 `testID` 实测 331 字符），不是产品。
    expect(/editingTitle \? \(\s*<TextField[\S\s]{0,600}?testID="task-detail-title"/.exec(src), '标题输入框没有落在编辑态分支里').not.toBeNull();
    // 反向：正文态那一支里不许有可点区之外的输入控件。
    expect(/editingTitle \? \([\S\s]*?\) : \(([\S\s]{0,400}?)\n      \)\}/.exec(src)?.[1] ?? '').not.toMatch(/<TextField|<TextInput/);
  });

  it('备注同一条：正文态是 Text，不是常驻输入框', () => {
    const src = sheet();
    expect(src).toMatch(/\{\s*editingNote\s*\?\s*\(/);
    expect(/editingNote \? \(\s*<TextField[\S\s]{0,600}?testID="task-detail-note"/.exec(src), '备注输入框没有落在编辑态分支里').not.toBeNull();
    expect(src).toMatch(/<Text\s+variant="row-title"[\S\s]{0,160}?numberOfLines=\{3\}/);
  });

  it('🔴 勾选框在内容层（勾完成不用滚到底），而且不在 footer 里', () => {
    const src = sheet();
    // 换锚点（2026-11-02）：勾选框由共享的 `<TaskRow>` 提供，面板自己**不许**再画一枚
    // —— 那是 `check:row-single-source` 的要求。所以"内容层有勾选框"现在等价于
    // "内容层有那一行"，而"面板没造第二份"成了一条新的反向判据。
    expect(src, '内容层没有那一行（勾选框的来源）').toContain('<TaskRow');
    expect(src, '面板又自己画了一枚勾选框 = 第二份行实现').not.toContain('<Checkbox');
    // 落点判据：`footer={…}` 在原语的 props 上（先于 children 出现），
    // 所以"在 children 里"= 在 `footer={…}` **块之后**，而不是在块之内。
    const block = footerBlock(src);
    expect(block, '面板没有 footer 那一格').not.toBeUndefined();
    expect(block ?? '', '那一行被放进了动作条（它属于内容层）').not.toContain('<TaskRow');
    expect(src.indexOf('<TaskRow'), '那一行出现在 footer 块之前 = 还没进内容层').toBeGreaterThan(
      src.indexOf('footer={'),
    );
  });

  it('离开输入框 / 收起面板仍提交标题与备注（重排不许丢掉这条既有行为）', () => {
    const src = sheet();
    const closeBlock = src.slice(
      src.indexOf('const close = useCallback'),
      src.indexOf('const handleRequestClose'),
    );
    expect(closeBlock, 'close() 里少了标题提交').toContain('commitTitle();');
    expect(closeBlock, 'close() 里少了备注提交（写完就关会丢字）').toContain('commitNote();');
    // 编辑态收回正文态时也要提交 —— 那才是"离开输入框即提交"的那一条通道。
    expect(src).toMatch(/onBlur=\{\(\) => \{\s*commitTitle\(\);/);
    expect(src).toMatch(/onBlur=\{\(\) => \{\s*commitNote\(\);/);
    expect(src).toMatch(/onSubmitEditing=\{\(\) => \{\s*commitTitle\(\);/);
  });

  it('排程预览留在内容层（AI 拆过清单时才有内容可排）', () => {
    expect(sheet()).toMatch(/planBlock\?\.hasChecklist \? \(\s*<ChecklistPlanPreview/);
  });

  it('🔴 标题栏那句没用的"任务详情"换成了它该回答的事（清单归属）', () => {
    const src = sheet();
    // 反向锚点：原语的可访问名称不再是"这一格是什么"，而是"这条任务挂在哪个容器下"。
    expect(src, '标题栏又回到那句不回答任何问题的固定标题').not.toContain("t('mobile.detail.title')");
    expect(src).toMatch(/title=\{listValue\}/);
    // 正向对照：关闭那枚 × 的无障碍名仍然要说清关的是"任务详情"（设备脚本按它寻址）。
    expect(src).toContain("t('mobile.detail.close')");
  });
});

describe('② 折叠层：收起态看得见值，但被折叠的控件数量为 0（§1 + §4 / S4）', () => {
  it('🔴 折叠用的是**不渲染**，不是藏起来', () => {
    const src = sheet();
    // 正向锚点：`DetailSection` 只有一处渲染分支，就是 `open ? children : null`。
    expect(src.match(/\{open \? children : null\}/g), 'DetailSection 的折叠分支形状变了').toHaveLength(1);
    // 反向：任何"仍挂载但看不见"的折叠都会把控件留在无障碍树里
    // （读屏能点到屏幕上没有的东西 —— 那是本仓在别的屏上踩过的形状）。
    expect(src).not.toMatch(/display:\s*'none'/);
    expect(src).not.toMatch(/accessibilityElementsHidden/);
    expect(src).not.toMatch(/pointerEvents="none"/);
  });

  it(`八格区段各有一枚触发器（${FOLDED.join(' / ')}）`, () => {
    const src = sheet();
    for (const id of FOLDED) {
      expect(src, `折叠层少了 ${id} 那一格`).toContain(`open={openSections.${id} === true}`);
      expect(src, `${id} 那一格点不开`).toContain(`toggleSection('${id}')`);
    }
    // 判据自己的锚点：`DetailSection` 用了八次，一次不多一次不少。
    expect(src.match(/<DetailSection/g), '格数与 FOLDED 清单不一致').toHaveLength(FOLDED.length);
  });

  it('🔴 收起态那一行画「属性名 → 当前值」（标签在左、值在右）', () => {
    const src = sheet();
    // ⚠️ 类型注解那一块以 `}: {` 结尾，`\n}` 会先在那里停住 ——
    // 注入验证时命中过这个探针自己的错，所以这里显式跨过签名取函数体。
    const section = /function DetailSection\([\S\s]*?\n\}\): React\.JSX\.Element \{([\S\s]*?)\n\}/.exec(src);
    expect(section, '找不到 DetailSection 的函数体（签名形状变了）').not.toBeNull();
    const body = section?.[1] ?? '';
    expect(body).toMatch(/<Text variant="row-title">\{label\}<\/Text>/);
    expect(body).toMatch(/<Text variant="row-meta"[^>]*>\s*\{value\}\s*<\/Text>/);
    // 展开状态要给读屏：只画箭头的话，无声世界里没人知道这一格还能点开。
    expect(body).toMatch(/accessibilityState=\{\{ expanded: open \}\}/);
  });

  it('编辑控件全在展开分支内部（截止那张选择器在日期状态行之后才出现）', () => {
    const src = sheet();
    expect(src).toMatch(/\{dueOpen \? \(\s*<Stack[\S\s]{0,120}?<DatePicker\s+value=\{dueLocal\}/);
    // 反向：收起态（`dueOpen` 那一条之外）不许再画第二张截止选择器。
    expect(src.match(/<DatePicker\s+value=\{dueLocal\}/g) ?? []).toHaveLength(1);
    const scheduleSection = /open=\{openSections\.schedule === true\}[\S\s]*?<\/DetailSection>/.exec(src);
    expect(scheduleSection, '排期区段结构变了，判据锚点要更新').not.toBeNull();
    expect(scheduleSection?.[0]).toContain('<DatePicker');
    // 整块面板里 `TextField` 恰好三处：标题编辑态 / 备注编辑态 / 自定义 RRULE。
    // 多出来的每一处都是"把编辑控件摊在首屏"。
    expect(src.match(/<TextField/g) ?? [], 'TextField 数量变了').toHaveLength(3);
  });

  it('「⋯」是总开关：展开全部用的是同一张表，不是数格子', () => {
    const src = sheet();
    expect(src).toContain('toggleAllSections');
    expect((src.match(/SECTION_IDS/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // 正向对照：这张表真的列了那八格（否则"展开全部"会静默漏掉某几格）。
    const table = /const SECTION_IDS = \[([\S\s]*?)\] as const/.exec(sheet())?.[1] ?? '';
    for (const id of FOLDED) expect(table, `SECTION_IDS 少了 ${id}`).toContain(`'${id}'`);
  });
});

describe('③ 🔴 动作区是常驻层（§3 / S1：不滚动就能点到完成与删除）', () => {
  it('完成 / 删除 / 关闭三枚走 `footer`，不是 children 末尾', () => {
    const src = sheet();
    const block = footerBlock(src);
    expect(block, '面板没有 footer 那一格（动作又滚回滚动内容里了）').not.toBeUndefined();
    expect(block ?? '').toContain('task-detail-complete');
    expect(block ?? '').toContain('task-detail-delete');
    expect(block ?? '').toContain('task-detail-close-button');
    // 反向：同一枚删除不许有第二份（滚到底才见得到的那一份就是旧形状）。
    expect(src.match(/task-detail-delete/g) ?? []).toHaveLength(1);
  });

  it('几何证据：原语把 footer 挂在 ScrollView **之外**', () => {
    const primitive = strip(readFileSync(BOTTOM_SHEET, 'utf8'));
    const scrollOpen = primitive.indexOf('<ScrollView');
    const scrollClose = primitive.indexOf('</ScrollView>');
    const footerAt = primitive.indexOf('{footer !== undefined ?');
    expect(scrollOpen, '共享原语里找不到 ScrollView —— 判据锚点失效，请更新本测试').toBeGreaterThan(-1);
    expect(footerAt, '原语不再渲染 footer —— 常驻这一格断了').toBeGreaterThan(scrollClose);
    // 反向对照：footer 不是 ScrollView 的子节点（在块内就等于跟着正文滚走）。
    expect(primitive.slice(scrollOpen, scrollClose).indexOf('{footer !== undefined ?')).toBe(-1);
  });

  it('勾选框与动作条共用同一条完成 op，界面不自己判"这条算不算完成"', () => {
    const src = sheet();
    expect(src.match(/actions\.setCompleted\(task\.id, !done\)/g) ?? []).toHaveLength(2);
    // 🔴 `completedAt` 在一次渲染里只读一处（与 `localTimeOf` 那条同一个理由）：
    // 两处读就会有两处判断，而第二处通常是错的。
    expect(src.match(/completedAt/g) ?? []).toHaveLength(1);
    expect(src).toMatch(/const done = task\.completedAt !== undefined;/);
  });
});

describe('④ 逾期状态行 + 顺延（app-host 的动作，此前移动端零调用点）', () => {
  it('🔴 接上了 `postponeToToday`', () => {
    const src = sheet();
    expect(src, '移动端又没有顺延入口了（app-host 那个动作此前零调用点）').toMatch(
      /actions\s*\n?\s*\.postponeToToday\(/,
    );
    // 反向：不在界面里算"推到哪" —— 顺延不许被写成一次自带的 setDueDate。
    expect(src).not.toMatch(/postponeToToday\([\S\s]{0,200}?setDueDate\(/);
    expect(src).not.toMatch(/Date\.now\(\)/);
  });

  it('逾期天数与"什么算逾期"都来自共享那份，界面只负责说出来', () => {
    const src = sheet();
    expect(src).toContain("from '../lib/due-display'");
    expect(src).toMatch(/toDueDisplay\(task, 'countdown', now, t\)/);
    expect(src).toMatch(/dueTone\(dueRemaining\.urgency\)/);
    // 🔴 反向：没有第二套倒计时、没有第二份时刻算术。
    expect(src).not.toMatch(/computeCountdown\(/);
    expect(src).not.toMatch(/\bgetHours\s*\(/);
    expect(src).not.toMatch(/\bsetHours\s*\(/);
    // 正向对照：这个 `not` 有牙 —— 同一文件里的日期算术只有一个出口（共享层）。
    expect(src).toMatch(/dueDateToEpoch\(/);
  });

  it('「顺延」只在逾期时出现（画一个按下去什么都不发生的入口比不画更糟）', () => {
    const src = sheet();
    expect(src).toMatch(/\{isOverdue \? \(\s*<Button[\S\s]{0,400}?task-detail-postpone/);
    expect(src).toMatch(/const isOverdue = dueRemaining\?\.overdue === true;/);
    // 反向：这一判据只读一次（`overdue` 由领域层算）。
    expect(src.match(/\.overdue === true/g) ?? []).toHaveLength(1);
  });
});

describe('⑤ 档位记忆接在宿主本地偏好上（原语的 记忆 > 默认档 > medium）', () => {
  it('🔴 读与写都走 `prefs/device-prefs`，没有第二套持久层', () => {
    const src = sheet();
    expect(src).toContain("from '../prefs/device-prefs'");
    expect(src).toMatch(/readDevicePref\(PREF_KEY_TASK_DETAIL_DETENT\)/);
    expect(src).toMatch(/writeDevicePref\(PREF_KEY_TASK_DETAIL_DETENT, next\)/);
    // 反向：不引 AsyncStorage（一条新原生依赖）、不碰 localStorage（RN 端没有这个东西）。
    expect(src).not.toMatch(/async-storage/i);
    expect(src).not.toMatch(/localStorage/);
  });

  it('记忆与原语的两个 prop 都接上了（此前 `onDetentChange` 全仓零宿主使用）', () => {
    const src = sheet();
    expect(src).toContain('rememberedDetent={rememberedDetent}');
    expect(src).toContain('onDetentChange={rememberDetent}');
    // 校验用共享层那张档位表，不在界面里另写三个档名字面量。
    expect(src).toMatch(/SHEET_DETENTS as readonly string\[\]\)\.includes\(raw\)/);
    expect(src).not.toMatch(/=== 'small'|=== 'medium'|=== 'large'/);
  });
});

describe('⑥ 边界：文案、样式债、业务判断都不许落在这一层', () => {
  it('🔴 代码里零硬编码文案（注释已剥，剩下的中文只能来自注释）', () => {
    const src = sheet();
    expect(src, '界面里出现了写死的中文文案 —— 词条是唯一事实源').not.toMatch(/[\u4e00-\u9fff]/);
    // 正向对照：文件确实被读到了（否则上面那条 `not` 是空读）。
    expect(readFileSync(SHEET, 'utf8')).toMatch(/[\u4e00-\u9fff]/);
  });

  it('内联样式棘轮：这一枚文件降到 **0** 处（只减不增）', () => {
    // `check:l4-no-style` 数的是含 `style={{` 的行（且**先剥注释**）——
    // 这里用同一个口径把判据钉到单文件，避免"整目录还绿、这一枚又在涨"。
    // 重排前：本文件 21 处。重排后：0 处（几何集中在 `styles` 那一份 useMemo 里）。
    expect(sheet().match(/style=\{\{/g) ?? [], '这一枚文件又长出内联样式了').toHaveLength(0);
  });

  it('已放弃那一层归动作层的分裂出口，宿主不自己 filter', () => {
    const src = sheet();
    expect(src).not.toMatch(/filter\([^)]*abandoned/);
    // 唯一保留的过滤是"已删除"（候选父表），那是既有判据，见 `subtask-entry.spec.ts`。
    expect(src).toMatch(/filter\(\(t2\) => t2\.deletedAt === undefined\)/);
  });

  it('hook 全在提前 return 之前（放在之后会让"面板打开"那一次多几个 hook）', () => {
    // 🔴 在**剥掉注释**的源码上找那个提前返回：文件头与 `customDraft` 那两段说明
    // 都在**逐字引用**这一行（讲的就是这个崩溃），`indexOf` 会先命中说明文字，
    // 于是判据读到的"函数体"根本不是你以为的那一段。
    const src = sheet();
    const guard = src.indexOf('if (task === undefined) return null;');
    expect(guard, '找不到那个提前返回 —— 结构变了，这条判据要重新看').toBeGreaterThan(-1);
    // 🔴 只看**组件自己的函数体**：文件末尾那两个内部组件各有一套 hook，
    // 把它们算进"提前返回之后"会得到一条假红（第一版就红在这儿）。
    const body = src.slice(guard, src.indexOf('function DetailSection'));
    expect(body, '提前返回之后还有 useState —— 会崩，且 release 里没有红屏').not.toMatch(/\buseState\(/);
    expect(body).not.toMatch(/\buseEffect\(/);
    expect(body).not.toMatch(/\buseMemo\(/);
    expect(body).not.toMatch(/\buseCallback\(/);
    // 正向对照：hook 确实都在 guard 之前（否则上面的 `not` 是空读）。
    expect(src.slice(0, guard).match(/useState\(/g) ?? []).not.toHaveLength(0);
  });
});
