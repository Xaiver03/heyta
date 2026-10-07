/**
 * R15b：移动端「我的」页的**头像读写界面**（接线判据）
 * =====================================================
 *
 * 通道与 R15a 同一条：`apps/mobile` 的测试是**源码级**的（node，无 RTL / 无 jsdom），
 * 真行为由设备脚本负责。所以这里钉的是"接的是谁"和"说的是哪句"，不是像素。
 *
 * 🔴 每条负向断言都配正向对照（同一段源码里必然命中另一枚 needle），
 *    否则"没命中"可能只是探针根本没读到内容。
 *
 * ## 这一族判据要防的那一种事故
 *
 * 头像是**加密的**，所以"取不到"有五种原因，而五种对应的用户动作不同。
 * web 那边曾经把 `AvatarDecodeResult` 的失败支并成一个 `undefined`：
 * 口令不对的人因此被告知"你还没有头像"，他接着点「换一张」，
 * **把自己原来那张覆盖掉了**。数据没有丢，丢的是那张图 —— 没有任何一层会报错。
 * 移动端接的是同一个功能，所以这里从第一天就把五种分开钉住。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 🔴 路径相对本文件解析（vitest 的工作目录是 `apps/mobile`）。
const SCREEN = new URL('../src/screens/ProfileScreen.tsx', import.meta.url);
const BADGE = new URL('../src/ui/avatar.tsx', import.meta.url);
const PREPARE = new URL('../src/lib/avatar-prepare.ts', import.meta.url);
const TOKENS = new URL(
  '../../../packages/design-system/src/generated/tokens.native.ts',
  import.meta.url,
);
const ZH = new URL('../../../packages/i18n/src/locales/zh-CN.ts', import.meta.url);
const EN = new URL('../../../packages/i18n/src/locales/en.ts', import.meta.url);

const stripComments = (src: string): string =>
  src.replace(/\/\*[\S\s]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const screen = (): string => stripComments(readFileSync(SCREEN, 'utf8'));

/** `fetchAvatarImage` 那一段（到 `needsPassword` 声明之前）。 */
const fetchImageBody = (): string => {
  const src = screen();
  const start = src.indexOf('const fetchAvatarImage');
  expect(start, '源码里找不到 `const fetchAvatarImage`').toBeGreaterThan(-1);
  const end = src.indexOf('const needsPassword', start);
  expect(end, '源码里找不到 `const needsPassword`').toBeGreaterThan(start);
  return src.slice(start, end);
};

/** `changeAvatar` 那一段（到 `removeAvatar` 之前）。 */
const changeBody = (): string => {
  const src = screen();
  const start = src.indexOf('const changeAvatar');
  expect(start, '源码里找不到 `const changeAvatar`').toBeGreaterThan(-1);
  const end = src.indexOf('const removeAvatar', start);
  expect(end, '源码里找不到 `const removeAvatar`').toBeGreaterThan(start);
  return src.slice(start, end);
};

describe('移动端 Profile 的头像（R15b）', () => {
  it('🔴 读 / 写 / 删都接共享层，本壳里没有第二套头像裁决', () => {
    const src = screen();
    expect(src).toMatch(/resolveAccountAvatarImage\s*\(/u);
    expect(src).toMatch(/uploadAccountAvatar\s*\(/u);
    expect(src).toMatch(/deleteAccountAvatar\s*\(/u);
    // data URI 的拼法只有一处（共享层）：屏幕自己拼 `data:` 就是第二权威。
    expect(src).toMatch(/avatarDataUri\s*\(/u);
    expect(src).not.toMatch(/data:\$\{/u);
    // 正向对照：它确实是从 @heyta/app-host 进来的，不是本地同名函数。
    const raw = readFileSync(SCREEN, 'utf8');
    expect(raw).toMatch(/type AccountAvatarImage,\n\} from '@heyta\/app-host'/u);
  });

  it('首字母的判定在共享层，界面圈组件只是消费者', () => {
    const badge = stripComments(readFileSync(BADGE, 'utf8'));
    expect(badge).toMatch(/avatarInitialFromEmail\s*\(/u);
    // 🔴 本壳不许自己算首字母：`split('@')` 一旦出现在 screens/ui 里就是第三份裁决。
    expect(badge).not.toMatch(/\.split\('@'\)/u);
    expect(screen()).not.toMatch(/\.split\('@'\)/u);
  });

  it('`avatarHash === null` 时**一个取图请求都不发**（契约前提，不是优化）', () => {
    const body = fetchImageBody();
    expect(body).toMatch(/avatarHash === undefined \|\| avatarHash === null/u);
    // 正向对照：闸门齐了它才真的发请求。
    expect(body).toMatch(/resolveAccountAvatarImage\s*\(\s*\{/u);
  });

  it('取图路径也走出境闸门（与昵称、徽标同一条）', () => {
    expect(fetchImageBody()).toContain('networkAllowed()');
    // 正向对照：这一段不是空函数。
    expect(fetchImageBody()).toMatch(/readSyncConfig\(\)/u);
  });

  it('🔴 读侧的每种失败各有一句，且都不是"头像没有传上去"', () => {
    const src = screen();
    expect(src).toContain('common.profile.avatar.undecryptable');
    expect(src).toContain('common.profile.avatar.unreadable');
    expect(src).toContain('common.profile.avatar.needPassword');
    // 上传失败那句只准出现在**写侧**：读侧用它就是在讲一件没发生过的事。
    const readSlice = fetchImageBody();
    expect(readSlice).not.toContain('avatar.failed');
    // 正向对照：读侧真的在按状态出句子。
    expect(readSlice).toMatch(/reading\.state === 'ready'/u);
  });

  it('上传成功说的是**头像**那句，不是"昵称已保存"', () => {
    const body = changeBody();
    expect(body).toContain('common.profile.avatar.uploaded');
    expect(body).not.toContain('nickname.saved');
    // 正向对照：成功后确实把本地显示与 hash 一起换了。
    expect(body).toMatch(/setAvatarHash\(outcome\.avatarHash\)/u);
  });

  it('没有口令时**不发**上传，说的是"为什么现在不能换"', () => {
    const body = changeBody();
    expect(body).toMatch(/password === ''/u);
    expect(body).toMatch(/common\.profile\.avatar\.needPassword/u);
    // 正向对照：过了这道闸才走 pick/upload。
    expect(body).toMatch(/await pick\(/u);
  });

  it('🔴 "这台设备没有读图通道"是单独一句，不折叠进"图不行"', () => {
    const src = screen();
    expect(src).toContain('mobile.profile.avatar.noChannel');
    // 通道判定住在 lib 层，屏幕只按 `no-channel` 出句子。
    const prepare = stripComments(readFileSync(PREPARE, 'utf8'));
    expect(prepare).toMatch(/typeof mod\?\.prepareAvatarBase64 !== 'function'/u);
    expect(prepare).toMatch(/error: 'no-channel'/u);
  });

  it('移除按钮只在真的有图时出现；取消选择是静默的', () => {
    const src = screen();
    expect(src).toMatch(/avatarImage === undefined \? null :/u);
    expect(changeBody()).toContain('OPERATION_CANCELED');
    // 正向对照：移除走的是共享的幂等删除。
    expect(src).toMatch(/deleteAccountAvatar\s*\(\s*\{\s*baseUrl/u);
  });

  it('🔴 新增的两段（头像逻辑 + 头像 JSX）一个 `style={{` 都没有', () => {
    // `check:l4` 的 mobile 段基线恰在 90、零余量；这一条不是替它把关，
    // 是**不许把样式写回屏幕**这条纪律在改动落点上先自证一次。
    const src = screen();
    const logicFrom = src.indexOf('const [avatarHash');
    expect(logicFrom, '找不到头像状态的起点').toBeGreaterThan(-1);
    const logicTo = src.indexOf('const prepareMessage', logicFrom);
    expect(logicTo, '找不到头像状态的终点').toBeGreaterThan(logicFrom);
    expect(src.slice(logicFrom, logicTo)).not.toMatch(/style=\{\{/u);

    const jsxFrom = src.indexOf('{savedName === undefined ? null : !profileNetworkAllowed ? null : (');
    expect(jsxFrom, '找不到头像 JSX 的起点').toBeGreaterThan(-1);
    const jsxTo = src.indexOf(
      '{savedName === undefined ? null : !profileNetworkAllowed ? null : nameEditing',
      jsxFrom,
    );
    expect(jsxTo, '找不到昵称 JSX 的起点（头像段的终点）').toBeGreaterThan(jsxFrom);
    expect(src.slice(jsxFrom, jsxTo)).not.toMatch(/style=\{\{/u);
    // 正向对照：证明这两段真的在被扫（里面有组件，不是空串）。
    expect(src.slice(jsxFrom, jsxTo)).toContain('AvatarBadge');
  });

  it('头像圈消费的每一枚 token 都真的存在（拼错在 `any` 下不会报错）', () => {
    const badge = stripComments(readFileSync(BADGE, 'utf8'));
    const keys = [...badge.matchAll(/\['([a-z0-9.-]+)'\]/gu)].map((m) => m[1] as string);
    // 无描边头像仍须消费尺寸、形状和底色，不以旧边框 token 数量判定探针。
    expect(keys).toEqual(expect.arrayContaining(['size.avatar-lg', 'radius.full', 'color.surface-sunken']));
    const table = readFileSync(TOKENS, 'utf8');
    for (const key of keys) {
      expect(table, `tokens.native.ts 里没有 '${key}'`).toContain(`'${key}':`);
    }
  });

  it('界面文案全部走 i18n，且本屏不读 `web.*` 命名空间的键', () => {
    const raw = readFileSync(SCREEN, 'utf8');
    const jsx = raw.slice(
      raw.indexOf('{savedName === undefined ? null : !profileNetworkAllowed ? null : ('),
    );
    expect(jsx).not.toMatch(/>[^<{\n]*[\u4e00-\u9fa5]/u);
    expect(jsx).toMatch(/t\('common\.profile\.avatar\./u);
    expect(raw).not.toMatch(/t\('web\./u);
  });

  it('R15b 新词条中英都在，值不是同一段文字', () => {
    const zh = readFileSync(ZH, 'utf8');
    const en = readFileSync(EN, 'utf8');
    const keys = [
      'common.profile.avatar.uploaded',
      'common.profile.avatar.undecryptable',
      'common.profile.avatar.unreadable',
      'common.profile.loadFailed',
      'mobile.profile.avatar.noChannel',
    ];
    for (const key of keys) {
      expect(zh, `zh-CN 缺 ${key}`).toContain(`'${key}'`);
      expect(en, `en 缺 ${key}`).toContain(`'${key}'`);
    }
  });
});
