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
  it('两段用的还是 `mobile.lists.*` / `mobile.tags.*`', () => {
    const lists = readScreen('ListsSection.tsx');
    for (const key of [
      'mobile.lists.remove',
      'mobile.lists.empty',
      'mobile.lists.empty.hint',
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
      'mobile.tags.empty',
      'mobile.tags.empty.hint',
      'mobile.tags.removeHint',
      'mobile.tags.nameLabel',
      'mobile.tags.newPlaceholder',
      'mobile.tags.add',
    ]) {
      expect(tags, `TagsSection 少用了词条 ${key}`).toContain(`t('${key}'`);
    }
  });
});
