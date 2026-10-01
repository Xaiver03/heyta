/**
 * 移动端「邮箱 + 密码」这条路（W7）—— 源码级判据
 * ==============================================
 *
 * ## 为什么这里全是源码级断言
 *
 * 本壳**没有** RN 组件测试栈：`@testing-library/react-native` 不在依赖里，
 * 而为一条判据引新依赖要先过 AGENTS §3.1（可维护性）+ §3.2（许可证）两道门。
 * 所以这个屏的**行为**由设备脚本验（`pnpm verify:mobile-auth`，需要真模拟器），
 * 这里钉的是「删掉或写反就会红」的那几件**结构**事实。同一个做法与理由见
 * `privacy-consent-gate.spec.ts` 文件末段（它的 `codeOf` / `bodyOf` 在这里复用）。
 *
 * ## 钉住的六件事，每件都对应一种**不会报错**的坏法
 *
 *   1. **两个秘密不混用** —— 把 `loginPassword` 接成 `password`（E2EE 口令），
 *      等于把设计上永不出设备的秘密发上服务端；反方向接错的症状是
 *      "能登录、同步却解不开自己的数据"。两种都不抛异常。
 *   2. **服务端地址不是第一栏** —— 这是产品负责人定的硬约束，
 *      原话："绝对不允许什么用自己正在用的域名才能够注册"。
 *   3. **未勾同意不发注册** —— 让服务端回 400 也是一种实现，界面看起来一样。
 *   4. **出门动作先过隐私闸门** —— 顺序反了就是"同意之前已经把包发出去"。
 *   5. **失败句子走共享映射、连数字一起拿** —— 只拿 key 会把 `{min}` / `{seconds}`
 *      原样印在屏幕上（`translateIn` 对缺省的 vars 保留占位符），不报错。
 *   6. **口令不做客户端组成规则**：不 `trim()`、无 `maxLength`、不提前按长度拒绝。
 *      NIST SP 800-63B 明确禁止；静默截断比拒绝更糟。
 *
 * ⚠️ 判据一律先去掉注释再匹配（`codeOf`）：把一句调用**注释掉**来糊过判据，
 *    是这个仓库记过的第一种假绿（§7 第 50 条）。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const LOCALES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/i18n/src/locales');

/** 去掉块注释与行注释，只留会被执行的东西。理由见文件头 ⚠️。 */
function codeOf(file: string): string {
  return readFileSync(join(SRC, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');
}

/** 从 `open` 处的 `{` 起做括号配平，返回**不含**外层花括号的内部文本。 */
function braceBalanced(code: string, open: number): string {
  expect(open, '找不到 `{` —— 被匹配的东西不存在').toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  throw new Error('花括号没有闭合');
}

/**
 * 取 `const <name> = (…) => { … }` 的**函数体**。
 *
 * 花括号的起点必须从**参数列表之后**找：`(mode: AuthFormMode): AuthFormField | undefined =>`
 * 这类签名里就带 `{`（默认值），直接找第一个会把函数体整个看丢。
 */
function bodyOf(code: string, name: string): string {
  const at = code.indexOf(`const ${name} =`);
  expect(at, `找不到 ${name} —— 这个动作不存在`).toBeGreaterThanOrEqual(0);
  const afterParams = code.indexOf(')', at);
  expect(afterParams, `${name} 没有参数列表的右括号`).toBeGreaterThan(at);
  return braceBalanced(code, code.indexOf('{', afterParams));
}

/** 断言两个片段都在 `text` 里，且 `before` **先**出现。 */
function assertOrdered(text: string, before: RegExp, after: RegExp, why: string): void {
  const first = text.search(before);
  const second = text.search(after);
  expect(first, `缺少 ${String(before)}：${why}`).toBeGreaterThanOrEqual(0);
  expect(second, `缺少 ${String(after)}：${why}`).toBeGreaterThanOrEqual(0);
  expect(
    first < second,
    `顺序反了：${why}（先出现的位置 ${String(first)} vs ${String(second)}）`,
  ).toBe(true);
}

const code = codeOf('screens/AuthScreen.tsx');

describe('两个秘密各自绑到各自的框 —— 接错不抛异常，只会把口令发上服务端', () => {
  it('🔴 登录密码框绑 `loginPassword`，加密口令框绑 `password`', () => {
    expect(code).toMatch(/value=\{loginPassword\}/);
    expect(code).toMatch(/onChangeText=\{setLoginPassword\}/);
    expect(code).toMatch(/value=\{password\}/);
    expect(code).toMatch(/onChangeText=\{setPassword\}/);
    // 两栏各自的 label 来自**共享层那两个常量**，不是壳里现编的字符串：
    // 「登录密码」与「加密口令」在四端必须同名，否则用户会以为它们是同一个东西。
    expect(code).toMatch(/label=\{t\(SIGN_IN_PASSWORD_LABEL_KEY\)\}/);
    expect(code).toMatch(/label=\{t\(E2EE_PASSPHRASE_LABEL_KEY\)\}/);
  });

  it('🔴 发出去的永远是 `loginPassword`；落进活配置的永远是 `password`（E2EE）', () => {
    for (const name of ['loginWithPassword', 'registerWithPassword']) {
      const body = bodyOf(code, name);
      expect(
        /password:\s*loginPassword/.test(body),
        `${name} 没把登录密码绑到 loginPassword —— 接成 password 就是把 E2EE 口令发上服务端`,
      ).toBe(true);
      expect(/password,|password:\s*password/.test(body), `${name} 把 E2EE 口令发出去了`).toBe(
        false,
      );
    }

    const saved = bodyOf(code, 'saveAndSync');
    expect(/password,/.test(saved), '写进活配置的不是 E2EE 口令那一个 state').toBe(true);
    // 🔴 反向的那半：登录密码**不许**被存成同步口令。它进了磁盘就等于多了一份
    //    可被读到的凭据，而同步口令的契约是"只在内存里、服务端看不到明文"。
    expect(/loginPassword/.test(saved), 'saveAndSync 里出现了 loginPassword').toBe(false);
  });
});

describe('表单形状（产品负责人定的硬约束）', () => {
  it('🔴 服务端地址是**最后一栏**，邮箱是第一栏', () => {
    const email = code.indexOf("t('mobile.auth.email.label')");
    const signIn = code.indexOf('SIGN_IN_PASSWORD_LABEL_KEY)');
    const e2ee = code.indexOf('E2EE_PASSPHRASE_LABEL_KEY)');
    const server = code.indexOf("t('mobile.profile.serverUrl.label')");
    for (const [name, at] of [
      ['邮箱', email],
      ['登录密码', signIn],
      ['加密口令', e2ee],
      ['服务器地址', server],
    ]) {
      expect(at, `${name} 那一栏不存在`).toBeGreaterThanOrEqual(0);
    }
    // 顺序本身就是要钉的东西：地址在第一栏 = 用户在开始注册之前必须先回答
    // "你要连哪台机器"。
    expect(email < signIn && signIn < e2ee && e2ee < server, '四栏的先后不对').toBe(true);
  });

  it('🔴 登录密码有显隐开关，默认档取自共享层（不在壳里写死 true/false）', () => {
    expect(code).toMatch(/secure=\{!passwordRevealed\}/);
    expect(code).toMatch(/useState\(defaultPasswordRevealed\('mobile'\)\)/);
    expect(code).toMatch(/'common\.auth\.form\.showPassword'/);
    expect(code).toMatch(/'common\.auth\.form\.hidePassword'/);
    // ⚠️ 开关的 label 必须**跟着状态变**（这一档是"现在看得见"）：固定写「显示密码」
    //    是 web 那侧靠 `aria-pressed` 表达的，RN 这里没有那个属性可用。
    expect(/passwordRevealed \? 'common\.auth\.form\.hidePassword'/.test(code)).toBe(true);
  });

  it('🔴 加密口令那一栏**不给**显隐开关（它不进网络，肩窥是唯一威胁）', () => {
    const fieldAt = code.indexOf('value={password}');
    const own = code.slice(fieldAt - 260, fieldAt + 200);
    expect(/secure\b(?!=)/.test(own), '口令栏没有 secure').toBe(true);
    expect(/secure=\{!passwordRevealed\}/.test(own), 'E2EE 口令被接到了显隐开关上').toBe(false);
  });

  it('⚠️ 口令不做客户端组成规则：不 trim、不截断、不提前按长度拒绝', () => {
    expect(code, '对登录密码做了 trim() —— 空格是指令的合法字符').not.toMatch(/loginPassword\.trim\(\)/);
    expect(code).not.toMatch(/maxLength/);
    // 判空只比"是不是空串"（省一次无谓往返），长度与常见度归服务端裁决。
    expect(/passwordMissing: loginPassword === ''/.test(bodyOf(code, 'missingField'))).toBe(true);
  });
});

describe('注册的本地闸（顺序错了就是"已经发出去了"）', () => {
  /*
    ⚠️ 这里**刻意没有**「两个口令动作先过隐私闸门」那条判据：
    `requireNetworkConsent()` 与 `src/privacy/` 是另一条尚未落地的线，
    把判据写在它之前，这条套件在别人那条线合进来之前就是红的。
    等 `src/privacy/` 落地，把它补回 `AuthScreen` 的两个 handler 与本文件，
    并同步扩写 `privacy-consent-gate.spec.ts` 的「五个出门动作」。
  */
  it('🔴 未勾同意 → 一个请求都不发：`missingField(\'register\')` 排在请求之前', () => {
    const body = bodyOf(code, 'registerWithPassword');
    assertOrdered(
      body,
      /missingField\('register'\)/,
      /registerWithEmailPassword\(/,
      '同意项没勾也发出了注册请求（服务端会回 400，但那次枚举尝试本身已经出门了）',
    );
    const missing = bodyOf(code, 'missingField');
    expect(
      /termsMissing: mode === 'register' && !termsAccepted/.test(missing),
      '`missingField` 不在 register 档检查同意项',
    ).toBe(true);
    // 登录**不**重新要同意：把同意挡在登录前面，老用户会以为自己被登出了。
    expect(/termsMissing: mode === 'register'/.test(missing), '登录也被同意项挡住').toBe(true);
  });

  it('🔴 注册成功后那句是**中性**的，不许断言"账号已创建"', () => {
    const body = bodyOf(code, 'registerWithPassword');
    expect(
      /setPhase\(\{ kind: 'notice', key: 'mobile\.auth\.sent\.register' \}\)/.test(body),
      '注册成功没落到那句中性提示上',
    ).toBe(true);
    // 服务端对"邮箱已属已验证账号"**故意**回成功而不写凭据（防枚举），
    // 所以任何"已创建"的措辞都是假话。
    expect(body, '注册结果读了服务端的 message').not.toMatch(/result\.message/);
  });

  it('🔴 登录产出会话后**停在 session 那一档**，不直接算完成', () => {
    const body = bodyOf(code, 'loginWithPassword');
    expect(/setPhase\(\{ kind: 'session', session: result\.session \}\)/.test(body)).toBe(true);
    // 规范 §3.2 的第 ④ 步：登录成功 ≠ 同步可用（那是另一个秘密）。
    expect(body, '登录顺手把会话存了，等于跳过了 E2EE 口令那一步').not.toMatch(/saveAuthSession\(/);
  });
});

describe('失败句子走共享映射，并连要填的数字一起拿', () => {
  it('🔴 用 `authFailureMessage`，不许回到只给 key 的那两个旧函数', () => {
    expect(code).toMatch(/authFailureMessage\(/);
    // 只拿 key 的那一半实现不会报错 —— `translateIn` 会把 `{min}` / `{seconds}` 原样印出来。
    expect(code, '用了 authFailureMessageKey（只给句子、不给数字）').not.toMatch(
      /authFailureMessageKey\(/,
    );
    expect(code, '自己再映射了一遍 policyCode').not.toMatch(/passwordPolicyMessageKey\(/);
  });

  it('🔴 契约数字不在本壳里出现：8 与 256 只有一个事实源', () => {
    expect(code, '壳里 import 了 shared-schema').not.toMatch(/@heyta\/shared-schema/);
    expect(code, '壳里写死了口令下限').not.toMatch(/\b(8|256)\b\s*(个字符|码点)/);
    expect(code).not.toMatch(/AUTH_PASSWORD_MIN_CODE_POINTS|AUTH_PASSWORD_MAX_CODE_POINTS/);
  });

  it('🔴 这里没有一行协议知识：不出现端点、不出现 fetch', () => {
    expect(code, '屏里出现了 /api/ 端点 —— 那是 app-host 的边界').not.toMatch(/\/api\//);
    expect(code, '屏里自己发请求').not.toMatch(/\bfetch\(/);
  });

  it('🔴 状态区渲染时必须把 vars 传进去', () => {
    expect(
      code,
      '失败句子渲染时漏了 vars —— 带占位符的那几条会印出字面量'
    ).toMatch(/phase\.vars === undefined \? t\(phase\.key\) : t\(phase\.key, phase\.vars\)/);
  });
});

describe('口令是主路，邮件链接与通行密钥退到「或者用别的方式」', () => {
  it('🔴 两个按钮都在，且各自的 loading 绑在自己的 action 上', () => {
    expect(code).toMatch(/t\('mobile\.auth\.password\.login'\)/);
    expect(code).toMatch(/t\('mobile\.auth\.password\.register'\)/);
    expect(code).toMatch(/action === 'password-login'/);
    expect(code).toMatch(/action === 'password-register'/);
    // busy 期间两个按钮都禁用：同时点两次会发两个请求，而后回来的那个覆盖前一个。
    for (const name of ['loginWithPassword', 'registerWithPassword']) {
      const at = code.indexOf(`t('mobile.auth.password.${name === 'loginWithPassword' ? 'login' : 'register'}')`);
      expect(at, `按钮 ${name} 不存在`).toBeGreaterThanOrEqual(0);
      expect(/disabled=\{busy\}/.test(code.slice(at, at + 400)), `${name} 的按钮没在 busy 时禁用`).toBe(
        true,
      );
    }
  });

  it('🔴 「或者用别的方式」这一组标题排在邮件链接按钮之前', () => {
    assertOrdered(
      code,
      /t\('common\.auth\.form\.otherWays'\)/,
      /t\('mobile\.auth\.magicLink\.login'\)/,
      '魔法链接仍和口令并排 —— 主路与第二条路在界面上没有区别',
    );
  });
});

describe('词条齐备（中英两张表必须同时有）', () => {
  const zh = readFileSync(join(LOCALES, 'zh-CN.ts'), 'utf8');
  const en = readFileSync(join(LOCALES, 'en.ts'), 'utf8');

  for (const key of [
    'mobile.auth.password.register',
    'mobile.auth.password.login',
    'common.auth.signInPassword.label',
    'common.auth.e2eePassphrase.label',
    'common.auth.form.passwordHint',
    'common.auth.form.showPassword',
    'common.auth.form.hidePassword',
    'common.auth.form.otherWays',
  ]) {
    it(`${key} 在中英两张表里都有`, () => {
      expect(zh, `zh-CN 缺 ${key}`).toContain(`'${key}'`);
      expect(en, `en 缺 ${key}`).toContain(`'${key}'`);
    });
  }

  it('🔴 引导句说的是这条路：不再只提"邮件链接或通行密钥"', () => {
    expect(zh).toContain("'mobile.auth.intro': '用邮箱和密码注册或登录");
  });
});
