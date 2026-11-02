/**
 * 移动端认证壳的不变量（2026-10-26 重写）
 * =====================================
 *
 * ## 为什么重写，而不是"删掉旧的"
 *
 * 这一份原来钉的是 `AuthScreen.tsx` 里**手写的字段与状态**（`loginPassword`、
 * `passwordRevealed`、`missingField`…）。那一版已经被删掉：移动端现在用
 * `@heyta/ui` 的 `AuthForm`（与 Web 同一份），字段、显隐、本地校验、错误落点
 * 全部归共享层。**旧判据里有价值的那些没有丢**，它们分两类搬了家：
 *
 *   · 「字段怎么摆、怎么报错」→ 共享层 `packages/ui/tests/auth-form.spec.ts`
 *     （那份本来就在，且 web 的 126 条也在守）；
 *   · 「**壳**这一半必须怎么接」→ 就是本文件。这一半是**本端独有**的：
 *     隐私闸门、请求代际、中央设备配对、加密口令那一步。
 *
 * 所以本文件现在钉的是「**壳不许自己再实现一遍表单**」以及「壳独有的那几条口径」。
 *
 * ## 为什么仍是源码级断言
 *
 * 与重排前同一个理由：本壳没有 RN 组件测试栈（引 `@testing-library/react-native`
 * 要先过 AGENTS §3.1 + §3.2 两道门），行为由 `pnpm verify:mobile-auth` 在真机验。
 * 这里只钉**结构事实** —— 每一条都对应一种**不会报错**的坏法。
 *
 * ⚠️ 判据一律先去掉注释再匹配（`codeOf`）：把一句调用**注释掉**来糊过判据，
 * 是这个仓库记过的第一种假绿（§7 第 50 条）。
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
 * 取 `const <name> = async (…) => { … }` 的**函数体**。
 *
 * 花括号的起点必须从**参数列表之后**找：签名里可能已经带 `{`（解构参数），
 * 直接找第一个会把函数体整个看丢。
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

describe('表单归共享层：壳里不许再有一份字段', () => {
  it('🔴 渲染的是共享的 `AuthForm`', () => {
    expect(code).toMatch(/<AuthForm/);
    expect(code).toMatch(/from '@heyta\/ui'/);
  });

  it('🔴 壳里只有一个输入框 —— 加密口令那一个', () => {
    // 多出第二个就说明"登录密码/邮箱"又被抄回来了。它是**这一版之前**的病根：
    // 同一张表单两份实现，Web 的布局与动效永远到不了手机。
    const fields = code.match(/<TextField/g) ?? [];
    expect(fields, `壳里有 ${String(fields.length)} 个手写输入框`).toHaveLength(1);
  });

  it('🔴 那一枚输入框绑的是加密口令，不是登录密码', () => {
    const at = code.indexOf('<TextField');
    const own = code.slice(at, at + 320);
    expect(own).toContain('value={passphrase}');
    expect(own).toContain('E2EE_PASSPHRASE_LABEL_KEY');
    expect(own).toMatch(/\bsecure\b(?!\s*=)/);
  });

  it('🔴 壳不持有任何「登录密码」的 state 或 prop', () => {
    // 结构上的保证比"两处 state 各自接对"强：口令根本不进这个文件。
    expect(code).not.toMatch(/loginPassword/);
    expect(code).not.toMatch(/confirmLoginPassword/);
    expect(code).not.toMatch(/passwordRevealed/);
  });

  it('🔴 不许把加密口令预填进共享表单的「登录密码」', () => {
    // `AuthForm` 的 `initialPassword` 是**登录密码**的预填口。把本屏的加密口令
    // 喂进去，就是把设计上不该出设备的秘密塞进一个"要发出去"的框里。
    // ⚠️ 本屏自己的 `initialPassword` prop 是加密口令的**入参**，它出现在文件里是对的 ——
    // 所以判据取的是 AuthForm 那一块 JSX，不是整个文件。
    const at = code.indexOf('<AuthForm');
    expect(at, '找不到 <AuthForm>').toBeGreaterThanOrEqual(0);
    const formJsx = code.slice(at, code.indexOf('/>', at));
    expect(formJsx).not.toMatch(/initialPassword/);
  });

  it('发出去的永远是共享表单交回来的口令；落进活配置的永远是加密口令', () => {
    const login = bodyOf(code, 'login');
    expect(login, 'login 没把共享表单交回来的口令发出去').toMatch(/loginWithEmailPassword\(options, \{ email, password \}\)/);
    const saved = bodyOf(code, 'saveAndSync');
    expect(saved, '写进活配置的不是加密口令那一个 state').toMatch(/password: passphrase/);
    // 反方向：登录密码**不许**被存成同步口令。它进了磁盘就等于多了一份可读到的凭据。
    expect(saved, 'saveAndSync 里把登录密码存成了同步口令').not.toMatch(/password:\s*password\b/);
  });
});

describe('两道本地闸（顺序错了就是"已经发出去了"）', () => {
  it('🔴 未勾同意 → 一个请求都不发：`AuthForm` 与壳**各**一道闸', () => {
    const body = bodyOf(code, 'register');
    assertOrdered(
      body,
      /if \(!accepted\) return failWithKey\(AUTH_TERMS_REQUIRED_KEY\)/,
      /requestEmailPasswordRegistrationCode\(/,
      '同意项没勾也发出了注册请求（服务端会回 400，但那次枚举尝试本身已经出门了）',
    );
    // 共享层那一道（AuthForm 内部）也必须还在 —— 只靠壳这一道就等于两道都没有。
    const form = readFileSync(resolve(SRC, '../../../packages/ui/src/auth/AuthForm.tsx'), 'utf8');
    expect(form).toMatch(/termsMissing: mode === 'register' && !termsAccepted/);
  });

  it('🔴 每一个出门动作都先过隐私闸门，再发请求', () => {
    for (const [name, egress] of [
      ['login', /loginWithEmailPassword\(/],
      ['register', /requestEmailPasswordRegistrationCode\(/],
      ['verifyRegistrationCode', /verifyEmailPasswordRegistrationCode\(/],
      ['resendRegistrationCode', /resendEmailPasswordRegistrationCode\(/],
      ['forgotPassword', /requestPasswordReset\(/],
      ['recoverPasskey', /requestPasskeyRecovery\(/],
      ['sendLoginLink', /requestMagicLink\(/],
      ['redeemPasted', /redeemPastedAuthToken\(/],
    ] as Array<[string, RegExp]>) {
      assertOrdered(
        bodyOf(code, name),
        /requireNetworkConsent\(\)/,
        egress,
        `${name} 在未同意时就把请求发出去了`,
      );
    }
  });

  it('🔴 通行密钥先判能力，再发请求', () => {
    // 反过来的话请求已经出去了，而 `passkey-unsupported` 的契约是"一个请求都没发"。
    assertOrdered(
      bodyOf(code, 'passkeyLogin'),
      /passkeyProvider === undefined/,
      /beginPasskeyLogin\(/,
      '没有通行密钥实现时仍然发出了 begin 请求',
    );
  });

  it('🔴 勾选同意同时就是联网的明示（注册与通行密钥注册两处）', () => {
    for (const name of ['register', 'passkeyRegister']) {
      const body = bodyOf(code, name);
      assertOrdered(body, /acceptNetworkConsent\(\)/, /requireNetworkConsent\(\)/,
        `${name} 没把"勾了同意"记成联网许可`);
    }
  });
});

describe('拿到令牌 ≠ 完成：加密口令是独立的一档', () => {
  it('🔴 登录成功后停在 `session` 那一档', () => {
    expect(bodyOf(code, 'enterSession')).toContain("setPhase({ kind: 'session'");
    expect(code).toMatch(/phase\.kind === 'session'/);
    expect(code).toMatch(/passphraseStep/);
  });

  it('切换服务端会清掉会话与口令（认证边界变了）', () => {
    const body = bodyOf(code, 'updateServerUrl');
    for (const expression of [
      'authGeneration.current += 1',
      "setPhase({ kind: 'idle' })",
      'setSessionServerUrl(undefined)',
      "setPassphrase('')",
      'setTermsAccepted(false)',
    ]) {
      expect(body, `服务端边界变化后缺少 ${expression}`).toContain(expression);
    }
  });
});

describe('失败句子走共享映射，并连要填的数字一起拿', () => {
  it('🔴 用 `authFailureMessage`，不许回到只给 key 的旧函数', () => {
    expect(code).toMatch(/authFailureMessage\(/);
    expect(code).toMatch(/message\.vars/);
  });

  it('🔴 状态区渲染时把 vars 一起传进去', () => {
    expect(code).toMatch(/vars === undefined \? t\(key\) : t\(key, vars\)/);
  });

  it('🔴 契约数字不在本壳里出现：8 与 256 只有一个事实源', () => {
    expect(code).not.toMatch(/\b256\b/);
    expect(code).not.toMatch(/length\s*<\s*8\b/);
  });

  it('🔴 这里没有一行协议知识：不出现端点、不出现 fetch', () => {
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/\/api\//);
  });
});

describe('中性文案（规范 §2-A2）', () => {
  it('🔴 注册之后那句不断言"账号已创建"', () => {
    expect(code).not.toContain('账号已创建');
    expect(code).not.toContain('账号已经创建');
  });

  it('🔴 只有服务端**明确**说没发出去时才改口（`=== false`，不是"有值就算"）', () => {
    // 它是**表达式体**的箭头函数（没有花括号块），所以不用 bodyOf。
    expect(code).toMatch(/result\.emailDelivered === false\s*\?\s*'mobile\.auth\.sent\.mailNotSent'\s*:\s*'mobile\.auth\.sent\.register'/);
    // 把 `undefined` 当 false 会让每个"无需邮箱验证"的自托管用户看到"邮件没发出去"。
    expect(code).not.toMatch(/emailDelivered !== true[\s\S]{0,60}mailNotSent/);
  });
});

describe('移动端认证请求代际隔离', () => {
  it('切换服务端与卸载时会递增代际，延迟响应不能恢复旧状态', () => {
    expect(code).toMatch(/authGeneration\.current \+= 1/);
    expect(code).toMatch(/useEffect\(\(\) => \(\) => \{\s*authGeneration\.current \+= 1/s);
    expect(code).toMatch(/if \(!isCurrentAuthAction\(generation\)\) return/);
  });

  it('验证码验证与重发都在代际检查之后才写回界面状态', () => {
    // ⚠️ 不能拿"第一个 setPhase"当判据：进 busy 的那一次**必然**在闸门之前。
    // 要钉的是**响应回来之后**的那次写回。
    assertOrdered(
      bodyOf(code, 'verifyRegistrationCode'),
      /isCurrentAuthAction\(generation\)/,
      /enterSession\(result\.session\)/,
      '验证码通过后，会话在代际检查之前就被写进了状态',
    );
    assertOrdered(
      bodyOf(code, 'resendRegistrationCode'),
      /isCurrentAuthAction\(generation\)/,
      /kind: 'registration-code'/,
      '重发之后，新挑战在代际检查之前就覆盖了旧挑战',
    );
  });
});

describe('词条齐备（中英两张表必须同时有）', () => {
  const zh = readFileSync(join(LOCALES, 'zh-CN.ts'), 'utf8');
  const en = readFileSync(join(LOCALES, 'en.ts'), 'utf8');

  for (const key of [
    'common.auth.signInPassword.label',
    'common.auth.e2eePassphrase.label',
    'common.auth.form.showPassword',
    'common.auth.form.hidePassword',
    'common.auth.form.otherWays',
    'common.auth.form.otherWaysOpen',
    'common.auth.form.otherWaysClose',
    'common.auth.form.confirmPassword',
    'common.auth.form.passwordConfirmationRequired',
    'common.auth.form.passwordMismatch',
    'web.auth.registrationCode.title',
    'web.auth.recovery.request',
    'mobile.auth.sent.register',
    'mobile.auth.sent.mailNotSent',
  ]) {
    it(`${key} 在中英两张表里都有`, () => {
      expect(zh, `zh-CN 缺 ${key}`).toContain(`'${key}'`);
      expect(en, `en 缺 ${key}`).toContain(`'${key}'`);
    });
  }

  it('🔴 认证面上**不挂说明文字**（2026-10-26 产品负责人的禁令）', () => {
    // 「去掉所有说明文字，现在严禁有任何说明文字，除了必要的。」
    // 所以那一段「用邮箱和密码注册或登录。登录成功后…」整句搬去了文档中心，
    // 词条一起删了 —— 留着一枚没人渲染的键，这条测试就会变成假信号。
    expect(zh, 'mobile.auth.intro 又被写回词条表了').not.toContain("'mobile.auth.intro'");
    // 共享表单的副标题口子也不许被填上（填了就是说明文字回来了）。
    expect(code).not.toMatch(/subtitle:\s*t\(/);
  });
});
