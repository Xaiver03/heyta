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
    expect(settings).toContain('case \'profile\':');
    expect(settings).toContain('return <>{profileEditor}</>;');
    expect(settings).not.toContain('profile-nickname-input');
  });

  it('设置目录按职责分组，并保留资料直达后的组内返回', () => {
    for (const key of ['profile', 'general', 'sync', 'ai', 'data', 'security']) {
      expect(settings, `设置缺少 ${key} 分组`).toContain(`${key}: t('mobile.settings.section.${key}')`);
      expect(settings, `设置缺少 ${key} 分组渲染分支`).toContain(`case '${key}':`);
    }
    expect(settings).toContain('testID="settings-directory"');
    expect(settings).toContain('setSection(initialSection)');
    expect(settings).toContain('section === undefined ? \'action.close\' : \'action.back\'');
    expect(settings).toContain('if (current !== undefined)');
    expect(settings).toContain('setSection(undefined)');
  });

  it('设置入口位于账号卡之后，资料编辑入口进入 profile 分组', () => {
    const home = between(profile, 'return (\n    <Screen', '<SettingsScreen');
    const accountEnd = home.indexOf("<SettingsRow row={settingsRow} />");
    const growthSummary = home.indexOf('<ProfileProgressSummary');

    expect(accountEnd).toBeGreaterThan(-1);
    expect(growthSummary).toBeGreaterThan(accountEnd);
    expect(profile).toContain("testID: 'profile-entry-settings'");
    expect(profile).toContain("navigation.push('settings');");
    expect(profile).toContain("setSettingsSection('profile');");
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
    const sync = between(settings, 'const syncStatusVisible =', 'const renderGeneral');

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
});
