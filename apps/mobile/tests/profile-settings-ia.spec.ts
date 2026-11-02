import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PROFILE = readFileSync(new URL('../src/screens/ProfileScreen.tsx', import.meta.url), 'utf8');
const SETTINGS = readFileSync(new URL('../src/screens/SettingsScreen.tsx', import.meta.url), 'utf8');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const profile = stripComments(PROFILE);
const settings = stripComments(SETTINGS);

function between(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  expect(start, `找不到源码边界：${startNeedle}`).toBeGreaterThanOrEqual(0);
  expect(end, `找不到源码边界：${endNeedle}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('移动端个人中心与设置的 IA 接线', () => {
  it('个人中心只读身份，资料编辑器只有一个并由设置面承载', () => {
    const profileEditor = between(profile, 'const profileEditor =', 'return (\n    <Screen');
    const profileHome = between(profile, 'return (\n    <Screen', '<SettingsScreen');

    expect(profileEditor).toContain('profile-nickname-input');
    expect(profileEditor).toContain('common.profile.avatar.change');
    expect(profileHome).not.toContain('<TextField');
    expect(profileHome).not.toContain('setNameEditing(true)');
    expect(profile).toContain('profileEditor={profileEditor}');
    // 🔴 2026-10-27 IA 迁移：`profile` 改叫 `account`（用户意图：账号），
    //    并且它现在**同时承载账号安全**（原来那是一个独立的第七组）。
    expect(settings).toContain('case \'account\':');
    expect(settings).toContain('{profileEditor}');
    expect(settings).toContain('{renderSecurity()}');
    expect(settings).not.toContain('profile-nickname-input');
  });

  it('设置目录按职责分组，并保留资料直达后的组内返回', () => {
    /*
      🔴 2026-10-27：这七个 key 从"技术模块"改成了"用户意图"。旧名见
      `SettingsScreen.tsx` 的 `LEGACY_SECTION`（深链仍按它落位）。
      这条判据钉的是**目录与渲染分支一一对应**，不是当时的组名 ——
      组名再改时改这个数组即可，不要退化成"只查有没有目录"。
    */
    for (const key of ['account', 'subscription', 'data', 'notifications', 'appearance', 'features', 'about']) {
      expect(settings, `设置缺少 ${key} 分组`).toContain(`${key}: t('mobile.settings.section.${key}')`);
      expect(settings, `设置缺少 ${key} 分组渲染分支`).toContain(`case '${key}':`);
    }
    expect(settings).toContain('testID="settings-directory"');
    expect(settings).toContain('setSection(initialSection)');
    expect(settings).toContain('section === undefined ? \'action.close\' : \'action.back\'');
    expect(settings).toContain('if (current !== undefined)');
    expect(settings).toContain('setSection(undefined)');
  });

  it('设置入口位于账号卡之后，资料编辑入口进入账号分组', () => {
    const home = between(profile, 'return (\n    <Screen', '<SettingsScreen');
    const accountEnd = home.indexOf("<SettingsRow row={settingsRow} />");
    const growthSummary = home.indexOf('<ProfileProgressSummary');

    expect(accountEnd).toBeGreaterThan(-1);
    expect(growthSummary).toBeGreaterThan(accountEnd);
    expect(profile).toContain("testID: 'profile-entry-settings'");
    expect(profile).toContain("navigation.push('settings');");
    expect(profile).toContain("setSettingsSection('account');");
    expect(profile).toContain("navigation.push('settings');");
  });

  it('设置的同步、数据与安全动作由个人中心提供，避免复制路由状态', () => {
    expect(profile).toContain('syncStatus={syncStatus}');
    expect(profile).toContain('dataActions={entryRows.filter');
    expect(profile).toContain("'profile-entry-export'");
    expect(profile).toContain("'profile-entry-trash'");
    expect(profile).toContain('securityActions={entryRows.filter');
    expect(profile).toContain("'profile-entry-security'");
    expect(profile).toContain("'profile-entry-close-account'");
    expect(settings).toContain('rows={dataActions ?? []}');
    expect(settings).toContain('rows={securityActions}');
  });

  it('同步默认走 heyta 登录；自托管字段只在高级路径显示', () => {
    expect(settings).toContain('onOpenAuth');
    expect(settings).toContain("t('mobile.profile.sync.officialTitle')");
    expect(settings).toContain("t('mobile.profile.sync.advancedOpen')");
    expect(settings).toContain("t('mobile.profile.sync.advancedTitle')");
    expect(settings).toContain('advancedSync ?');
    expect(settings).toContain('form.token.trim() !== \'\'');
    expect(settings).toContain('form.setServerUrl(DEFAULT_SERVER_URL)');
    expect(profile).toContain('onOpenAuth={openAuth}');
    expect(profile).toContain('if (!allowServerSelection)');
    expect(settings).toContain('onOpenAuth(true)');
    expect(profile).toContain('onUseOfficialSync={onClearCredentials}');
  });

  it('未配置时先给官方登录入口，隐藏无效状态卡并收缩设置动作', () => {
    const sync = between(settings, 'const syncStatusVisible =', 'const renderNotifications');

    expect(sync).toContain('const syncStatusVisible = form.configured || advancedSync;');
    expect(sync).toContain('{syncStatusVisible ? syncStatus : renderSyncConfiguration()}');
    expect(sync).toContain('{syncStatusVisible ? renderPrivacy() : null}');
    expect(sync).toContain('{syncStatusVisible ? renderSyncConfiguration() : renderPrivacy()}');
    expect(settings).not.toContain("t('mobile.profile.account.signInHint')");
    expect(settings).toMatch(
      /<Text variant="caption" tone="subtle">\s*\{t\('common\.privacy\.settings\.decidedAt'/u,
    );
    expect(settings).toContain("style={{ alignSelf: 'flex-start' }}");
    expect(profile).toContain("style={{ alignSelf: 'flex-start' }}");
  });

  it('清单、标签、便签是 profile 栈的二级管理页，并沿同一条返回路径', () => {
    for (const key of ['lists', 'tags', 'notes']) {
      expect(profile).toContain(`navigation.push('profile:${key}');`);
      expect(profile).toContain(`managementPage === 'profile:${key}'`);
    }
    expect(profile).toContain('onPress: () => { navigation.pop(); }');
  });

  it('设置 Modal 只在 profile tab 显示，关闭和 Android 返回都 pop 当前栈', () => {
    expect(profile).toContain("visible={navigation.tab === 'profile' && settingsOpen}");
    expect(profile).toContain('setSettingsSection(undefined);');
    expect(profile).toContain('onClose={() => {');
    expect(profile).toContain('navigation.pop();');
    expect(settings).toContain('onRequestClose={onClose}');
  });

  /*
    ─────────────────────────────────────────────────────────────────────────
    2026-10-27 · 按计划 §5.2 重排「我的」：16 行 → 12 行 / 6 块
    ─────────────────────────────────────────────────────────────────────────

    🔴 这三条是**新增**的判据，不是"为了让上面那些变绿而改"。上面 8 条一条都没动
    （它们钉的三件事仍然成立：资料编辑器只有一份、设置入口在账号卡之后、
    设置面是独立 surface）。新增的是重排**本来的产物**：

    | # | 钉什么 | 能红的注入 |
    |---|---|---|
    | A1 | 首屏显式 8 行 + 近期状态卡 4 行 = 12 行 | 往首屏再加一行 `<SettingsRow`（把功能域搬回去） |
    | A2 | 5 个功能域**不在**首屏，但仍在「功能与 AI」页可达 | 把 `entryRows` 整批渲染回首屏 / 删掉枢纽页的 `hubRows.map` |
    | A3 | 同步只剩一行摘要，异常才展开细节 | 把 `StatusRow` 无条件渲染回去（三行状态卡回潮） |

    ⚠️ **口径**：行数按"可见 `SettingsRow` 条数"数，与计划 §5.6 的 B4 判据同一条。
    账号卡是 `Card`（不是 `SettingsRow`），所以在 16 与 12 两次读数里都不计。
  */

  /*
    🔴 2026-10-27 第二批（12 → 11）：近期状态卡里「成就」那一行自己成了成长入口，
    「查看完整成长」那行删掉（两行去同一张屏 = §3.1 的重复入口）。
    ⚠️ 判据仍然是**行数账**，不是"看起来更短"：显式 8 + 卡片 3 = 11。
    再要往 10 走的那一行（通知 / 清单与标签）是产品还没定的取舍，见 plan §6。
  */
  it('A1 首屏 11 行 = 显式 8 行 + 近期状态卡 3 行（重排前 16 行）', () => {
    const home = between(profile, 'return (\n    <Screen', '<SettingsScreen');

    // 显式那 8 行：订阅 / 设置 / 同步摘要 / 通知 / 功能与 AI / 清单 / 标签 / 便签。
    // 🔴 这条能红：往首屏加一行 `<SettingsRow` 就会变成 9。
    expect(
      [...home.matchAll(/<SettingsRow\b/g)],
      '「我的」首屏的显式设置行数变了 —— 16 → 12 的账在 plan §5.6 B4 里记着',
    ).toHaveLength(8);

    // 那 8 行各自是哪一行（名字写死，防止"数量对、成分错"）。
    for (const row of [
      'subscriptionRow',
      'settingsRow',
      'syncSummaryRow',
      'notificationsRow',
      'featuresHubRow',
    ]) {
      expect(home, `首屏少了 ${row} 那一行`).toContain(`<SettingsRow row={${row}} />`);
    }

    // 另外 3 行由 `ProfileProgressSummary` 画（本周任务 / 专注 / 成就+成长入口）。
    const progress = stripComments(
      readFileSync(new URL('../src/screens/ProfileProgressSummary.tsx', import.meta.url), 'utf8'),
    );
    expect(progress.match(/kind: 'value'/g), '近期状态卡的值行不再是 3 行').toHaveLength(3);
    // 成就不再是纯读数：它必须能进成长页（否则成长入口就没了）。
    // 从"成就那一行的标签"往后找 onPress：整张卡里第一个 `kind: 'value'` 是本周任务，
    // 拿它当起点会把距离拉到 200 字以外（那会让这条判据在**正确**的实现上假红）。
    expect(progress).toMatch(
      /label: t\('mobile\.profile\.progress\.achievements'\)[\s\S]{0,400}onPress: onOpenGrowth/,
    );
    expect(progress).toContain("testID: 'profile-progress-growth'");
  });

  it('A2 五个功能域移出首屏，但仍在「功能与 AI」页可达（不删功能域）', () => {
    const home = between(profile, 'return (\n    <Screen', '<SettingsScreen');

    // 🔴 这条**能红**：重排前首屏正是靠整批渲染 `entryRows` 把 7 行铺出来的。
    expect(
      home,
      '首屏又整批渲染 entryRows 了 —— 习惯/倒数/共享/AI 会跟着一起回到「我的」',
    ).not.toMatch(/entryRows\.(filter|map)\(/);

    // 通知留在首屏：§5.5 说移动端没有 web 那种顶栏铃铛位，这是唯一收件入口。
    expect(home).toContain('<SettingsRow row={notificationsRow} />');
    // 成长不再有第二条路：唯一入口是「近期状态」卡里那一行（§5.3 删掉重复那一行）。
    expect(profile, '`profile-entry-growth` 又渲染出来了').not.toMatch(
      /row=\{featureRows\[|profile-entry-growth'/,
    );

    // 枢纽页：5 个功能域的 testID 逐个登记，且那一页真的把它们铺出来。
    const hub = between(profile, 'const HUB_ROW_TEST_IDS', 'if (securityOpen)');
    for (const id of [
      'profile-entry-habits',
      'profile-entry-countdown',
      'profile-entry-share',
      'profile-entry-assistant',
      'profile-entry-ai-toolbox',
    ]) {
      expect(hub, `枢纽页丢了 ${id} —— 那一项在移动端就没有入口了`).toContain(`'${id}'`);
    }
    expect(hub, '枢纽页没有把 hubRows 铺出来 = 入口在、点了看不到东西').toContain('hubRows.map(');
    // 入口行 → 那条路由 → 那个分支，三样缺一不可（缺了就是"点了没反应"）。
    expect(profile).toContain("navigation.push('profile:features')");
    expect(profile).toContain("=== 'profile:features'");
    expect(profile).toContain("key === 'profile:features'");
  });

  it('A3 同步只剩一行摘要，异常才展开细节（不再常驻三行状态卡）', () => {
    const home = between(profile, 'return (\n    <Screen', '<SettingsScreen');

    expect(profile).toContain("valueTestID: 'profile-sync-summary'");
    expect(home).toContain('<SettingsRow row={syncSummaryRow} />');
    // 🔴 展开是有条件的：`error` / `conflict` 才画细节。
    expect(home).toContain('syncDetailVisible ?');
    expect(profile).toContain("status.kind === 'error' || status.kind === 'conflict'");
    expect(home).toContain('detailOnly');
    // 待上传 / 上次成功同步那两行**只在设置面**（它们是"细节"，不是首屏摘要）。
    expect(home, '待上传那两行又回到首屏了').not.toContain("valueTestID: 'profile-pending-value'");
    expect(home, '上次同步那两行又回到首屏了').not.toContain("valueTestID: 'profile-last-sync-value'");
  });
});
