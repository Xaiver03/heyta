/**
 * R13a · 设置树的分区与「我的」页锚点
 * ==================================
 *
 * 这棵树的结构住在 `App.tsx` 的 `SETTINGS_NAV_ITEMS` 里（不是导出常量），
 * 所以这里用**源码形状**判据：直接读那个文件，钉住三件在评审时看不见、
 * 但一改就会让深链/入口表/文案一起漂的事。
 *
 * 🔴 为什么不渲染整个 App：这些断言要回答的是"结构对不对"，而渲染整棵树
 * 只会把同一个事实再测一遍（还慢）。形状判据的代价是"改写法会红"，
 * 那正是我们想要的：换写法就得回来改这条判据，顺便再想一遍。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { en, zhCN } from '@heyta/i18n';

// vitest 的 cwd 是 apps/web（见它的 vitest.config.ts），这里按它定位源文件。
const APP = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
const PROFILE = readFileSync(
  join(process.cwd(), 'src/features/settings/ProfileOverview.tsx'),
  'utf8',
);

describe('设置树：个性化分区（R13a）', () => {
  it('组 id 仍是 settings-group-appearance —— 深链只认 id，改名不改 id', () => {
    const line = APP.split('\n').find((l) => l.includes("id: 'settings-group-appearance'"));
    expect(line).toBeDefined();
    // 同一条登记里必须用新的显示名词条
    expect(line).toContain("'mobile.settings.section.personalization'");
  });

  it('该节的 aria-label 与导航用同一条词条（不许一处新一处旧）', () => {
    const section = APP.split('\n').find((l) => l.includes('id="settings-group-appearance"'));
    expect(section).toBeDefined();
    expect(section).toContain("t('mobile.settings.section.personalization')");
  });

  it('「行为默认值」这一轮没有建组（0 项可放，建了就是空组）', () => {
    // 见 docs/plans/r13a-settings-tree-2026-11.md §3：五个初值项全仓不存在。
    // 真要开这一区，先把这条改成正面断言，并在那份文档里写清有哪几项。
    expect(APP).not.toContain('settings-group-defaults');
  });

  it('新词条中英都在（check:ui-language 只数条数，这里钉键名）', () => {
    expect(zhCN['mobile.settings.section.personalization']).toBe('个性化');
    expect(en['mobile.settings.section.personalization']).toBe('Personalization');
  });
});

describe('「我的」页最后两位（R13a）', () => {
  it('版本号读唯一真源，不许写死字面量', () => {
    // 🔴 只断言"渲染出来等于 HEYTA_APP_VERSION"是不够的：写死当前版本号也能过，
    // 要等下一次 bump 才红 —— 那时已经晚了。所以这里判**源码形状**：
    // 必须 import 生成物里的常量，且版本行那一格不许出现 `1.2.3` 这种字面量。
    expect(PROFILE).toContain("from '@heyta/app-host'");
    expect(PROFILE).toContain('HEYTA_APP_VERSION');
    const idx = PROFILE.indexOf('data-testid="profile-center-version"');
    expect(idx).toBeGreaterThan(-1);
    const cell = PROFILE.slice(idx, idx + 200);
    expect(cell).toContain('HEYTA_APP_VERSION');
    expect(/\b\d+\.\d+\.\d+\b/.test(cell)).toBe(false);
  });

  it('退出登录只在我的页渲染（signedIn 条件在），且由 onSignOut 驱动', () => {
    const idx = PROFILE.indexOf('profile-center-signout');
    expect(idx).toBeGreaterThan(-1);
    const block = PROFILE.slice(Math.max(0, idx - 400), idx + 200);
    expect(block).toContain('signedIn');
    expect(block).toContain('onSignOut');
  });
});
