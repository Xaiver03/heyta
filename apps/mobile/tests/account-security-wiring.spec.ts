/**
 * 账号标准套件在移动端的**接线判据**（源码层）
 * ==========================================
 *
 * 🔴 为什么是读源码而不是渲染组件：`apps/mobile` 刻意没有 RN 组件测试栈
 * （理由见 `tests/habit-create-entry.spec.ts` 文件头 —— node 里加载 `react-native`
 * 直接失败，而 mock 它就把"没有 RN"这条被测的降级路径换掉了）。
 * 所以"接线在不在、有没有长出第二份事实源"只能读文本。
 *
 * 这里钉的四件事都会**悄悄**坏掉（不报错、界面也不难看）：
 *   ① 已登录"添加通行密钥"走了注册新账号那两条端点 ⇒ 界面说成功、凭据不存在；
 *   ② 换绑界面把"等哪一边"记在自己的 state 里 ⇒ 一次卸载之后它开始说假话；
 *   ③ 本屏自己 `readSyncConfig()` 抓一次令牌快照 ⇒ 改密之后每个后续调用都在用
 *      一枚服务端已经不认的令牌；
 *   ④ 底部标签被加成第 6 个（P10 / ADR-0015 §4 的硬边界）。
 */

import { describe, expect, it } from 'vitest';

import { read, stripComments } from './source-reading';

const SECURITY = stripComments(read('apps/mobile/src/screens/SecurityScreen.tsx'));
const EMAIL = stripComments(read('apps/mobile/src/screens/EmailChangeSection.tsx'));
const SESSIONS = stripComments(read('apps/mobile/src/screens/SessionsSection.tsx'));
const PROFILE = stripComments(read('apps/mobile/src/screens/ProfileScreen.tsx'));
const TABBAR = stripComments(read('apps/mobile/src/nav/TabBar.tsx'));

/** 剥掉 import 块，只留"这个文件里出现了哪些标识符"。 */
function withoutImports(src: string): string {
  return src.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '');
}

describe('已登录添加通行密钥走的是**真会写库**那两条端点', () => {
  it('import 了 `beginPasskeyEnrollment` / `completePasskeyEnrollment`', () => {
    expect(SECURITY).toContain('beginPasskeyEnrollment');
    expect(SECURITY).toContain('completePasskeyEnrollment');
  });

  it('🔴 **不** import `beginPasskeyRegistration` / `completePasskeyRegistration`', () => {
    // 那两条是"注册**新账号**"。服务端 `verifyRegistration` 对
    // "这个 email 已属于一个已验证账号"**故意提前返回成功而不写任何凭据**（防枚举）。
    // 已登录用户走那条 ⇒ 界面说"添加成功"、账号上什么都没有；
    // 而设置页在拒绝"删最后一条"时正是让用户"先添加一条新的" ——
    // 用户照做再删掉旧的，就再也登不进去。
    // 变异：把 `beginPasskeyEnrollment` 改成 `beginPasskeyRegistration` ⇒ 本条红。
    expect(SECURITY).not.toMatch(/\bbeginPasskeyRegistration\b/);
    expect(SECURITY).not.toMatch(/\bcompletePasskeyRegistration\b/);
  });

  it('平台那一步只用 `auth/passkey-host.ts`，而且探测在发请求**之前**', () => {
    expect(SECURITY).toContain('resolvePasskeyProvider');
    expect(SECURITY).toContain('describePasskeyError');
    // 没有平台桥 ⇒ 一个请求都不发，直接说"这台设备不支持"。
    // ⚠️ 界面读的是**驼峰词条名** `passkeyUnsupported`（封闭集合里那个原因字符串
    // 是连字符形状 `passkey-unsupported`，由 `describePasskeyError` 产出）。
    const enroll = SECURITY.slice(SECURITY.indexOf('submitEnroll'), SECURITY.indexOf('submitRecovery'));
    expect(enroll).toContain('passkeyUnsupported');
    expect(enroll.indexOf('resolvePasskeyProvider')).toBeLessThan(enroll.indexOf('beginPasskeyEnrollment'));
  });
});

describe('换绑界面：那句"还等谁点"只有服务端一个来源', () => {
  it('阶段只从 `emailChangeStage(status)` 来', () => {
    expect(EMAIL).toContain('getEmailChangeStatus');
    expect(EMAIL).toContain('emailChangeStage(');
  });

  it('🔴 组件里**没有**任何本地"阶段"state', () => {
    // 变异：加一行 `const [stage, setStage] = useState<'idle'|…>('awaiting-both')` ⇒ 本条红。
    // 这一条不是洁癖：`SettingsScreen` 是 RN `Modal`，`visible={false}` 时 children
    // **整体卸载** —— 本地记的那半句话活不过一次切标签，而界面上留下的是假话。
    expect(EMAIL).not.toMatch(/useState<\s*EmailChangeStage/);
    expect(EMAIL).not.toMatch(/setStage\s*\(/);
    expect(EMAIL).not.toMatch(/const \[stage,/u);
  });

  it('只调用换绑那一族四个函数，**没有** confirm（客户端刻意不许有第五条）', () => {
    for (const fn of ['requestEmailChange', 'getEmailChangeStatus', 'cancelEmailChange']) {
      expect(EMAIL).toContain(fn);
    }
    // `account-security.ts` 文件头写明了为什么没有 `confirmEmailChange`：
    // 两个收件箱各自点一次的时序判断只能有一个裁决点。
    expect(EMAIL).not.toMatch(/\bconfirmEmailChange\b/);
    expect(EMAIL).not.toMatch(/EMAIL_CHANGE_PATHS\s*\.\s*confirm/);
  });

  it('成功说的是"信发出去了"，**不是**"邮箱改好了"', () => {
    expect(EMAIL).toContain('common.emailChange.sent');
    expect(EMAIL).not.toContain('common.emailChange.applied');
  });

  it('挂在 `profileEditor` 里（设置面的 profile 分组），不在「我的」滚动流里', () => {
    // 🔴 `check:mobile-settings` 与 `profile-settings-ia.spec.ts` 钉的是"表单不进滚动流"。
    // 这里的判据是**位置**：`EmailChangeSection` 必须出现在
    // `const profileEditor =` 与主 `return (` 之间，而且紧跟在只读邮箱行之后
    // —— `common.profile.email.hint` 那句"请用下面的「更换登录邮箱」"必须指得到东西。
    const editorStart = PROFILE.indexOf('const profileEditor =');
    const homeReturn = PROFILE.indexOf('return (\n    <Screen');
    const section = PROFILE.indexOf('<EmailChangeSection');
    const emailRow = PROFILE.indexOf("t('common.profile.email.label')");
    expect(editorStart).toBeGreaterThanOrEqual(0);
    expect(homeReturn).toBeGreaterThan(editorStart);
    expect(emailRow).toBeGreaterThan(editorStart);
    expect(section).toBeGreaterThan(emailRow);
    expect(section).toBeLessThan(homeReturn);
  });
});

describe('凭据快照：本屏不再自己读一次磁盘', () => {
  it('SecurityScreen 不出现 `readSyncConfig(`', () => {
    // 旧版 `useMemo(() => readSyncConfig(), [])` 抓一次快照。后果不是外观：
    // 改密成功、服务端发了新令牌之后，本屏**每一次**后续调用还在用那枚
    // 已经被 `tokenVersion` 作废的旧令牌 ⇒ 列表/改名/删除全部 `unauthorized`，
    // 而界面上一句解释都没有。变异：把那行 import 加回来 ⇒ 本条红。
    expect(withoutImports(SECURITY)).not.toContain('readSyncConfig(');
    expect(SECURITY).toContain('baseUrl: string');
    expect(SECURITY).toContain('token: string');
  });
});

describe('登录设备：三件事各是一条路，不许合并', () => {
  it('那一块真的挂在安全面上，四个 prop 一起接', () => {
    // 变异靶：把 `<SessionsSection … />` 整块删掉 ⇒ 本条必须红。
    // 补这条之前 `pnpm check` 里没有任何一层钉着这次挂载：它只被
    // `verify-mobile-account-email-sessions.sh` 与 `verify-mobile-ios-account-email-sessions.sh`
    // 两枚设备脚本读着，而那两枚要真模拟器。少挂一层的症状是"设置面里根本没有
    // 登录设备这一块"，而单测与全部静态门禁照样绿。
    expect(SECURITY).toContain('<SessionsSection');
    for (const prop of [
      'baseUrl={baseUrl}',
      'token={token}',
      'onSignOutCurrentDevice={onSignOutCurrentDevice}',
      'onSignedOutEverywhere={onSignedOutEverywhere}',
    ]) {
      expect(SECURITY, `挂载里缺 prop：${prop}`).toContain(prop);
    }
  });

  it('逐枚撤销 / 退出这台 / 退出所有 —— 三个函数各自被用', () => {
    expect(SESSIONS).toContain('listHostedSessions');
    expect(SESSIONS).toContain('revokeHostedSession');
    expect(SESSIONS).toContain('logoutEveryDevice');
    // 「退出登录」那一条**不在本文件**里发：它要连着"清本机"一起编排，
    // 而本机清哪些存储只有宿主知道（见 `auth/sign-out-flow.ts`）。
    expect(SESSIONS).toContain('onSignOutCurrentDevice');
    expect(SESSIONS).toContain('onSignedOutEverywhere');
  });

  it('`current` 那一行**没有**可点的撤销按钮', () => {
    // 服务端比的是自己验出来的 `jti`。在别的设备上把"退出登录"画在
    // "这台设备"那一行，用户点下去撤销的是**自己**正在用的那枚。
    const branchStart = SESSIONS.indexOf('{session.current ? (');
    const elseStart = SESSIONS.indexOf(') : (', branchStart);
    expect(branchStart).toBeGreaterThanOrEqual(0);
    expect(elseStart).toBeGreaterThan(branchStart);
    const currentBranch = SESSIONS.slice(branchStart, elseStart);
    expect(currentBranch).toContain('common.sessions.currentHint');
    expect(currentBranch).not.toContain('sessions-revoke');
    // 正向对照：撤销按钮**确实**在 else 那一支里（否则上面那条"没有"是空的）。
    const elseBranch = SESSIONS.slice(elseStart, elseStart + 600);
    expect(elseBranch).toContain('sessions-revoke');
  });

  it('「退出所有设备」成功之后**必须**走本机清理（手上那枚一起死了）', () => {
    // 切在**函数体**上，不是切在第一次出现 `logoutEveryDevice` 的地方 ——
    // 那个位置在文件头的 import 块里，从那儿切会把上面几个回调一起卷进来，
    // 于是"这一支不许有 load()"永远验不到它该验的那一段。
    const start = SESSIONS.indexOf('const signOutEverywhere = useCallback');
    const end = SESSIONS.indexOf('const askSignOutEverywhere', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const every = SESSIONS.slice(start, end);
    expect(every).toContain('logoutEveryDevice');
    expect(every).toContain('onSignedOutEverywhere()');
    // 本地不许"成功之后继续用这枚令牌再拉一次列表" —— 那必然 401。
    expect(every).not.toContain('load()');
  });

  it('本屏那两条退出出口都接到了 ProfileScreen 的清理编排上', () => {
    expect(PROFILE).toContain('onSignOutCurrentDevice');
    expect(PROFILE).toContain('onSignedOutEverywhere');
    // 🔴 待撤销那句话由**常驻的本屏**说（子屏关掉之后才更需要被看见）。
    expect(PROFILE).toContain('common.signOut.pending');
    expect(PROFILE).toContain('common.signOut.retry');
  });
});

describe('命名空间：新写的界面不许往"读 web.* 那本旧账"上加一条', () => {
  it('三个新文件里一个 `t(\'web.` 都没有', () => {
    for (const [name, src] of [
      ['SecurityScreen', SECURITY],
      ['EmailChangeSection', EMAIL],
      ['SessionsSection', SESSIONS],
    ] as const) {
      expect(src.match(/t\(\s*'web\./gu) ?? [], `${name} 里出现了 t('web.…')`).toHaveLength(0);
      // 正向对照：同形状的探针在这些文件里是能命中的。
      expect(src.match(/t\(\s*'(common|mobile)\./gu)?.length ?? 0, name).toBeGreaterThan(3);
    }
  });
});

describe('硬边界：底部标签仍然是 5 个', () => {
  it('🔴 这一批没有加第 6 个标签（P10 / ADR-0015 §4）', () => {
    // 这一条与本批的成败无关地**必须存在**：四个新界面全部走「我的」的二级屏
    // 与设置面，而"给登录设备加一个标签"是最省事的错法 —— 它曾经以
    // `quadrant` 的名字发生过一次，代价是一整个 P10（见 `nav/TabBar.tsx` 文件头）。
    // 变异：往 `TABS` 里塞第 6 项 ⇒ 本条红（`toHaveLength(5)`）。
    const start = TABBAR.indexOf('export const TABS = [');
    const end = TABBAR.indexOf('] as const satisfies', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const keys = TABBAR.slice(start, end).match(/key:\s*'[a-z-]+'/g) ?? [];
    expect(keys).toHaveLength(5);
  });
});

describe('换绑之后界面上那个邮箱地址：权威只能是服务端读回来的那一个', () => {
  // 真设备验收第 11 趟步骤 10 实测：两边都点完、库里已经是新地址，
  // 而「当前邮箱」那一行仍显示**旧**地址 —— 因为它读的是"登录那一刻记下的"那一个。
  // 这一族判据钉的是"别再退回去"，行为本身由那一趟设备读数负责（两层各管一段）。
  const SESSION = stripComments(read('apps/mobile/src/auth/session.ts'));

  it('那一行的值走 `accountEmail`，而它的**首选**是 `status.currentEmail`', () => {
    expect(EMAIL).toMatch(/const accountEmail = status\?\.currentEmail \?\? currentEmail;/u);
    expect(EMAIL).toContain('value: accountEmail ??');
    expect(EMAIL).not.toMatch(/value:\s*currentEmail \?\?/u);
  });

  it('🔴 读回来的真值要写回会话，否则「我的」页其余几处"当前账号"还说旧地址', () => {
    expect(EMAIL).toContain("from '../auth/session'");
    expect(EMAIL).toMatch(/const observed = status\?\.currentEmail;/u);
    expect(EMAIL).toMatch(/setSignedInEmailFromServer\(observed\)/u);
  });

  it('🔴 那个 setter **只**能被服务端事实调用：拿本地输入框喂它就拆了这条不变量', () => {
    expect(EMAIL).not.toMatch(/setSignedInEmailFromServer\(\s*draft/u);
    expect(EMAIL).not.toMatch(/setSignedInEmailFromServer\(\s*'[a-z0-9._-]+@/iu);
  });

  it('`signedInEmail` 全仓只有两处写入：登录那一次 + 这一处服务端覆盖', () => {
    const writes = SESSION.match(/^\s*signedInEmail\s*=.*$/gm) ?? [];
    expect(writes).toHaveLength(4);
    // 4 而不是 2：`= undefined;` 那两处是登出与注销的**忘掉**，它们同样必须是赋值语句。
    expect(writes.filter((line) => /=\s*undefined;\s*$/u.test(line))).toHaveLength(2);
  });
});
