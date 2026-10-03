/**
 * 移动端清单 / 标签的**接线判据**
 * ==================================
 *
 * 出处：`docs/plans/multi-platform-adaptation.md` 的 M3「每轮的固定流程」
 * 第 3 步（mobile 切过去）与 §判据 A「该特性在 `apps/web` 与 `apps/mobile` 下
 * **不再各有一份实现**」。
 *
 * 🔴 这里**不测"层级算得对不对"** —— 那是共享层 `projects/model.ts` 的
 * `tests/projects-model.spec.ts` 的事（判据只写一份）。这里防的是**接线漂移**，
 * 也就是"两个端各写一份，差异不会让任何测试变红"的那一类：
 *
 *   1. 两段是否真的渲染共享 `OrganizerList`（而不是又长出一份本地骨架）；
 *   2. 层级 / 标签适配是否走共享模型（`toOrganizerTree` / `toTagItems`）；
 *   3. **不加 tab**（P10：ADR-0015 §4 的"不新增 tab"是更上位的事实）；
 *   4. 文案仍然复用既有的 `mobile.lists.*` / `mobile.tags.*`（零新增同义键）。
 *
 * ⚠️ 本文件是**源码级**的、不 import `@heyta/ui`：移动端测试跑在 node 环境，
 * 而 `@heyta/ui` 会拖进 `react-native`（Flow 源码，node 解析不了）。
 * 这等于免费钉住了"这两段不许把渲染实现搬回 mobile"。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 只读接缝，只给故障注入用（把目录复制到 `/tmp`、改一处、指过去，
 * 证明"共享实现漂了 → 红"）。不设时就是真实路径。
 */
const SCREENS = resolve(HERE, '../src/screens');
const UI_MODEL =
  process.env.HEYTA_PROJECTS_SHARED_MODEL ??
  resolve(HERE, '../../../packages/ui/src/projects/model.ts');

const readScreen = (name: string): string => readFileSync(resolve(SCREENS, name), 'utf8');

describe('两段都渲染共享 `OrganizerList`（不再各写一份行骨架）', () => {
  it('ListsSection / TagsSection 从 `@heyta/ui` 取 `OrganizerList`', () => {
    for (const file of ['ListsSection.tsx', 'TagsSection.tsx']) {
      const source = readScreen(file);
      expect(source, `${file} 没有从 @heyta/ui 取 OrganizerList`).toContain('OrganizerList');
      expect(source).toContain("from '@heyta/ui'");
      // 老实现的行骨架标记不许回来。
      expect(source).not.toContain('organizer-row');
    }
  });

  it('本地的 `OrganizerSection.tsx` 已删除（它的位置被共享层取代）', () => {
    // 读不到就说明文件真的不在了 —— 这正是本刀要的。
    expect(() => readScreen('OrganizerSection.tsx')).toThrow();
  });

  it('层级 / 标签适配走共享模型，而不是在屏里自己拼', () => {
    expect(readScreen('ListsSection.tsx')).toContain('toOrganizerTree');
    const tags = readScreen('TagsSection.tsx');
    expect(tags).toContain('toTagItems');
    expect(tags).toContain('toOrganizerNodes');
  });
});

describe('共享层的锚点还在（改了就红）', () => {
  it('`packages/ui/src/projects/model.ts` 里有层级与标签适配的导出', () => {
    const source = readFileSync(UI_MODEL, 'utf8');
    expect(source).toContain('export function toOrganizerTree');
    expect(source).toContain('export function topLevelProjects');
    expect(source).toContain('export function childProjects');
    expect(source).toContain('export function toTagItems');
    expect(source).toContain('export function toOrganizerNodes');
  });
});

describe('P10：不许新增 tab', () => {
  it('底部标签仍是 5 个，且没有清单 / 标签 / projects 这一项', () => {
    const tabBar = readFileSync(resolve(HERE, '../src/nav/TabBar.tsx'), 'utf8');
    expect(tabBar).not.toMatch(/'(projects|lists|tags|project)'/);
    // 「我的」是这两段的家；tab 数由 `TABS` 登记（5 个）。
    expect(tabBar).toContain('mobile.tab.profile');
  });
});

describe('文案复用既有词条（零新增同义键）', () => {
  it('两段用的还是 `mobile.lists.*` / `mobile.tags.*`，空态那一族用 `common.organizer.*`', () => {
    const lists = readScreen('ListsSection.tsx');
    for (const key of [
      'mobile.lists.remove',
      'common.organizer.lists.empty',
      'common.organizer.lists.empty.hint',
      'mobile.lists.removeHint',
      'mobile.lists.nameLabel',
      'mobile.lists.newPlaceholder',
      'mobile.lists.add',
    ]) {
      expect(lists, `ListsSection 少用了词条 ${key}`).toContain(`t('${key}'`);
    }

    const tags = readScreen('TagsSection.tsx');
    for (const key of [
      'mobile.tags.remove',
      'common.organizer.tags.empty',
      'common.organizer.tags.empty.hint',
      'mobile.tags.removeHint',
      'mobile.tags.nameLabel',
      'mobile.tags.newPlaceholder',
      'mobile.tags.add',
    ]) {
      expect(tags, `TagsSection 少用了词条 ${key}`).toContain(`t('${key}'`);
    }
  });
});

/**
 * 空态那一族**跨端只有一份**，而且两端都得**接上线**。
 *
 * 这一条是 2026-10-01 对着参照图重做收集箱时补的：共享层 `OrganizerList`
 * 早就支持 `labels.empty/emptyHint`，可 web 侧栏那份 `labels` 只传了
 * `removeLabel` —— 于是"一个清单都没有"的时候界面**什么都不显示**，
 * 而移动端同样的状态下有一句说明。两个端对同一件事给出两种界面，
 * 且没有任何测试会红，正是本文件存在的理由（判据 A）。
 *
 * ⚠️ 源码级断言（不渲染）：本套件跑在 node 环境，`@heyta/ui` 会拖进
 * `react-native`。这里能钉住的是"接线在不在、词条是不是同一族"。
 */
describe('空态词条是 `common.organizer.*`，两个宿主都接了线', () => {
  const REPO = resolve(HERE, '../../..');
  const read = (rel: string): string => readFileSync(resolve(REPO, rel), 'utf8');

  it('web 侧栏（`ProjectsPanel`）传了同一套 empty/emptyHint', () => {
    const panel = read('apps/web/src/features/projects/ProjectsPanel.tsx');
    for (const key of [
      'common.organizer.lists.empty',
      'common.organizer.lists.empty.hint',
      'common.organizer.tags.empty',
      'common.organizer.tags.empty.hint',
    ]) {
      expect(panel, `web 侧栏没有接线词条 ${key}`).toContain(`t('${key}'`);
    }
  });

  it('旧的 `mobile.lists.empty*` / `mobile.tags.empty*` 已经改名，没有留下第二套', () => {
    for (const locale of ['zh-CN', 'en']) {
      const table = read(`packages/i18n/src/locales/${locale}.ts`);
      for (const gone of [
        "'mobile.lists.empty'",
        "'mobile.lists.empty.hint'",
        "'mobile.tags.empty'",
        "'mobile.tags.empty.hint'",
      ]) {
        expect(table, `${locale}.ts 里 ${gone} 还在 —— 改名只做了一半`).not.toContain(gone);
      }
      for (const key of [
        "'common.organizer.lists.empty'",
        "'common.organizer.lists.empty.hint'",
        "'common.organizer.tags.empty'",
        "'common.organizer.tags.empty.hint'",
      ]) {
        expect(table, `${locale}.ts 缺词条 ${key}`).toContain(key);
      }
    }
  });
});

/**
 * W4b · 标签删除确认的**接线与形状**（源码级）
 * ---------------------------------------------
 *
 * 渲染结果由 `apps/web/tests/projects-panel.spec.tsx` 的 `W4b` 那一块钉（node 里
 * 加载不了 `react-native`，移动端只能读源码）。这里防的是那两种"不报错的形状坏法"：
 *
 *   1. **只有一半宿主接了** —— 于是"删标签要不要确认"在两个端是两个答案；
 *   2. **确认框画了，按下还是直接删** —— 组件里 `onRemove` 多了一个没被文案挡住的调用点。
 *
 * 🔴 第 3 条是**刻意的不对称**（清单不确认、标签确认），必须留在这儿：
 * 没有这条注释，下一个看到"两边不一致"的人会把它"顺手统一"掉。
 */
describe('W4b 标签删除确认：两端都接、且默认形态没被改动', () => {
  const REPO = resolve(HERE, '../../..');
  const read = (rel: string): string => readFileSync(resolve(REPO, rel), 'utf8');
  const component = read('packages/ui/src/projects/OrganizerList.tsx');

  it('两端宿主都传 `confirmRemove` 与 `removeImpact`（缺一个就是"零件都在、没人接线"）', () => {
    for (const [file, source] of [
      ['apps/mobile/src/screens/TagsSection.tsx', readScreen('TagsSection.tsx')],
      ['apps/web/src/features/projects/ProjectsPanel.tsx', read('apps/web/src/features/projects/ProjectsPanel.tsx')],
    ] as const) {
      expect(source, `${file} 没打开删除确认`).toContain('confirmRemove:');
      expect(source, `${file} 没传影响面`).toContain('removeImpact={');
    }
  });

  it('影响面取数走共享的 `liveTaskCountsByTag`，**不是**行上那个 `openTagCounts`', () => {
    const tags = readScreen('TagsSection.tsx');
    expect(tags).toContain('liveTaskCountsByTag(');
    // 口径顶替的症状是确认框说"没有任务受影响"（已完成的任务被滤掉了）。
    expect(tags, '拿常驻计数当影响面 = 一句假承诺').not.toContain('openTagCounts(');
    expect(read('apps/web/src/features/projects/ProjectsPanel.tsx')).toContain('liveTaskCountsByTag(');
  });

  it('清单那一列**不传** confirmRemove（删了能捞，标签不能 —— 这是拍板的不对称）', () => {
    expect(readScreen('ListsSection.tsx')).not.toContain('confirmRemove');
  });

  it('🔴 组件里 `onRemove(item)` 只有两个调用点：没确认文案时的直删、以及「确认删除」', () => {
    const calls = component.match(/onRemove\(item\)/g) ?? [];
    expect(calls, `onRemove 有 ${calls.length} 个调用点，多出来的那一个不受确认挡`).toHaveLength(2);
    // 直删那一条必须**被文案挡住**（不是"看起来在同一行"）。
    expect(component).toContain('if (confirmLabels === undefined) {');
    expect(component).toContain('setPendingRemove(item.id)');
  });

  it('四个词条中英各就位（宿主传了不存在的键不会报错，只会把键名渲染到界面上）', () => {
    for (const locale of ['zh-CN', 'en']) {
      const table = read(`packages/i18n/src/locales/${locale}.ts`);
      for (const key of [
        "'common.organizer.confirm.ask'",
        "'common.organizer.confirm.impactTags'",
        "'common.organizer.confirm.delete'",
        "'common.organizer.confirm.cancel'",
      ]) {
        expect(table, `${locale}.ts 缺词条 ${key}`).toContain(key);
      }
    }
  });
});
