/**
 * 共享认证表单的**形状**判据（源码级）
 * ==================================
 *
 * ## 为什么这里不 render
 *
 * `packages/ui` 的单测**不引 jsdom、不 render**（同 `search-panel-material.spec.ts`
 * 与 `task-row-density.spec.ts` 的限制说明）。行为的判据住在宿主那一侧 ——
 * web 用 `apps/web/tests/auth-form.spec.tsx` 真渲染出来验（DOM 的 `autocomplete`、
 * `aria-pressed`、错误文本、焦点去向）。
 *
 * 但有三类事情**只有源码级能验**，而且它们恰好是本仓反复记过的那几类：
 *
 *   1. **一个不该出现的形状不存在**（`check-row-single-source.mjs` 的思路）：
 *      `maxLength`、裸的 autofill 字面量、协议知识 —— 这些在行为测试里
 *      可能**一直绿**（浏览器接受截断、管理器填错要真人注册才看得见、
 *      协议字符串写错了照样跑通到某个端口）。
 *   2. **承重的那一根通道存在**：`aria-pressed` / `aria-invalid` / `aria-checked` /
 *      live region 少了任何一个，界面**功能照常**，只有读屏用户受影响，
 *      所以没有任何一条行为测试会红。
 *   3. **该由 `model.ts` 决定的取值不许在这里重写一遍**：写死 `'current-password'`
 *      不会崩，只会让"两份规则"重新长出来 —— 那正是 §10.1 收编的原因。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../src/auth/AuthForm.tsx', import.meta.url)),
  'utf8',
);

/**
 * 剥掉注释。
 *
 * 🔴 **必须先剥**：本文件大量判据禁的是"代码里出现某个字样"，而注释里
 * 恰恰会**解释为什么禁它**（"不许写 `'current-password'`"一句里就带着那个字面量）。
 * 不剥注释的判据会因为别人把理由写清楚而变红 —— 那教出来的是"别写注释"，
 * 完全跑反了。本仓在这件事上踩过三次。
 */
function stripComments(text: string): string {
  return text
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^\s*\/\/.*$/gm, '');
}

const code = stripComments(source);

describe('AuthForm —— 不该存在的形状', () => {
  it('🔴 口令框**没有** `maxLength`（NIST 禁止静默截断口令）', () => {
    // 全文一次都不许出现，不是"只有口令框没有"：邮箱加截断同样是数据丢失，
    // 而"只给口令框豁免"这种写法迟早会在复制粘贴时把截断带回口令框。
    expect(code).not.toMatch(/maxLength/);
  });

  it('🔴 提交类控件**不禁用**（用 in-flight guard，见文件头那条纪律）', () => {
    // `disabled=` 是这条纪律唯一的可 grep 形状。它出现就意味着有人
    // 用"禁用"代替了"不响应"—— 那会在提交后把焦点从用户脚下抽走。
    expect(code).not.toMatch(/\bdisabled=/);
  });

  it('🔴 没有协议知识：不许出现端点、fetch、服务端的错误码', () => {
    // 这些属于 `@heyta/app-host` 与服务端（AGENTS §3.5）。
    // 一旦出现在共享表单里，它就有了**四个宿主**，而修复要乘四。
    for (const forbidden of ['/api/', 'fetch(', 'password_policy_violation', 'invalid_reset_link']) {
      expect(code, `出现了协议知识：${forbidden}`).not.toContain(forbidden);
    }
  });

  it('🔴 条款链接**不在**同意项的可点区域里（点条款不许等于勾选同意）', () => {
    /**
     * 原来这件事钉在真浏览器的 `label a[href]` 计数上 —— 那是**旧壳**的形状。
     * 共享表单里同意项是 `div[role=checkbox]`、条款是它**后面的兄弟节点**，
     * 整张表单一个 `<label>` 都没有 ⇒ 那条判据恒为 0，**看起来在保护，其实谁都不管**
     * （AGENTS §7：一条永远通过的判据比没有判据更糟）。
     *
     * 这里钉的是结构本身：同意项从 `accessibilityRole="checkbox"` 到它的闭合标签
     * 之间**不许出现**条款链接。链进去的表现是"我想先读条款"变成"我已经同意了" ——
     * 那是同意留痕上的真缺陷，不是样式问题。
     */
    const termsAt = code.indexOf('accessibilityRole="checkbox"');
    const closeAt = code.indexOf('</Pressable>', termsAt);
    expect(termsAt, '同意项整块不见了 —— 空测也算不到东西').toBeGreaterThanOrEqual(0);
    expect(closeAt, '同意项没有闭合标签').toBeGreaterThan(termsAt);
    const inside = code.slice(termsAt, closeAt);
    expect(inside, '条款链接被搬进了同意项里').not.toContain('legal-terms');
    expect(inside, '条款链接被搬进了同意项里').not.toContain('legal-privacy');
  });

  it('🔴 不 import 会拖进第二份 React 或跨层的包', () => {
    // `@heyta/i18n` → 第二份 React（本仓为此崩过一次）；
    // `@heyta/app-host` → 共享 UI 依赖宿主层，四端里 RN 端会连不上。
    expect(code).not.toMatch(/from '@heyta\/(i18n|app-host|domain)'/);
  });
});

describe('AuthForm —— 承重的无障碍通道确实在', () => {
  it('显隐开关带**平铺** `aria-pressed`（对象形态会被 react-native-web 整个丢掉）', () => {
    expect(code).toMatch(/aria-pressed=\{revealed\}/);
  });

  it('每个可报错的字段都有 `aria-invalid` 通道', () => {
    // 三个字段各一条：漏一个的表现是"那个框错了但读屏不知道"，
    // 而视觉上一切正常（红字就在旁边，看不见红字的人也正是受影响的人）。
    expect(code).toMatch(/aria-invalid=\{invalidFor\('email'\)\}/);
    expect(code).toMatch(/aria-invalid=\{invalidFor\('password'\)\}/);
    expect(code).toMatch(/aria-invalid=\{invalidFor\('baseUrl'\)\}/);
  });

  it('同意项是真 `role="checkbox"` + `aria-checked`，不是一个会变色的方块', () => {
    expect(code).toMatch(/accessibilityRole="checkbox"/);
    expect(code).toMatch(/aria-checked=\{termsAccepted\}/);
  });

  it('状态区是 live region（异步失败必须被播报，否则静默变化=没发生）', () => {
    expect(code).toMatch(/accessibilityLiveRegion="polite"/);
  });

  it('错误是**文字**，不是只有红框（WCAG SC 3.3.1）', () => {
    /**
     * 🔴 这条在 2026-10-02 跟着 `AuthForm` 一起换了形。原来"能标红"和"该说一句
     * 这一格没填"是同一个布尔（`invalidFor`），于是服务端把错误指到口令框时，
     * 框里明明写着 `123`、框下却印出「还没有填密码。」。现在两半分开：
     *   · **指格子** = `aria-invalid={invalidFor(...)}`（上一条用例钉的就是它）；
     *   · **说话** = `missing(...)` 旁边那条 `<Text>{labels.localErrors...}`，
     *     服务端指字段时那句具体的话住在状态区（live region，也已钉）。
     * 不变量没变，只是换了形状：**每一格能标红，就必须有一句话，而且那句话
     * 得是这一格的**。所以这里同时数两侧并把它们对齐 —— 只数 caption 会退化成
     * "有人把 `invalidFor` 改名成别的就悄悄红/悄悄绿"。
     */
    const redFlags = [...code.matchAll(/aria-invalid=\{invalidFor\('(\w+)'\)\}/g)].map(
      (m) => m[1] as string,
    );
    const captions = [
      ...code.matchAll(/missing\('(\w+)'\)\s*\?\s*\(\s*<Text\b[\s\S]{0,200}?\{labels\.localErrors\.(\w+)/g),
    ];
    // 前提必须成立：两侧都空着的时候下面两个循环都恒真，那这条判据就只是装饰。
    expect(redFlags.length, '一条 aria-invalid 都没数到 —— 空判据比没有判据更糟').toBeGreaterThanOrEqual(
      3,
    );
    expect(captions.length, '一条 caption 都没数到 —— 空判据比没有判据更糟').toBeGreaterThanOrEqual(3);
    const spoken = new Set(captions.map((m) => m[1] as string));
    for (const field of redFlags) {
      expect(spoken.has(field), `字段 ${field} 能标红，界面上却没有属于它的那句话（只剩颜色）`).toBe(true);
    }
    for (const [, field, key] of captions) {
      expect(key, `missing('${field}') 旁边挂的是 localErrors.${key} —— 说的话不是这一格的`).toBe(field);
    }
  });
});

describe('AuthForm —— 该由 model 决定的取值不许重写', () => {
  it('autofill 走 `passwordAutocomplete(mode)`，**不写死**字面量', () => {
    expect(code).toMatch(/autoComplete=\{passwordAutocomplete\(mode\)\}/);
    // 写死不会崩，只会让两份规则各自漂移 —— 而漂移的表现是
    // "管理器把旧口令填进注册表单"，只有真人注册一次才看得见。
    expect(code).not.toMatch(/'current-password'|'new-password'/);
  });

  it('邮箱 autofill 走 `AUTH_EMAIL_AUTOCOMPLETE`（唯一的 cast 点在 model.ts）', () => {
    expect(code).toMatch(/autoComplete=\{AUTH_EMAIL_AUTOCOMPLETE/);
    expect(code).not.toMatch(/'username webauthn'/);
  });

  it('显隐默认档走 `defaultPasswordRevealed(...)`，`secureTextEntry` 跟着 state 走', () => {
    expect(code).toMatch(/defaultPasswordRevealed\(/);
    // 常量 `secureTextEntry` / `secureTextEntry={false}` 都算重写：
    // 前者没有开关，后者把默认档焊死在一端。
    expect(code).toMatch(/secureTextEntry=\{!revealed\}/);
  });

  it('两步判定走 `authFormStageAfterContinue`，本地校验走 `firstAuthErrorField`', () => {
    // 这两个函数是"空邮箱不许前进""第一个错误字段是谁"的**唯一**判据所在。
    // 在组件里重写一遍（`if (email === '')`）就会开始出现
    // "web 允许前进、移动端不允许"那种两端不一致。
    expect(code).toMatch(/authFormStageAfterContinue\(/);
    expect(code).toMatch(/firstAuthErrorField\(/);
  });

  it('口令**原样**交出：不 trim、不 normalize、不改大小写', () => {
    // 归一化只在服务端一处发生（存的与验的都是它归一化后的串）。
    // 客户端先 trim 会制造"同一个口令两台设备登不上"—— 而它是**用户**的口令，
    // 我们连"哪一份是对的"都无从判断。
    expect(code).not.toMatch(/password\.trim\(\)|password\.normalize|password\.toLowerCase/);
    expect(code).toMatch(/onChangeText=\{\(next\) => \{\s*setPassword\(next\)/);
  });
});

describe('AuthForm —— 服务端地址不许当注册的前置条件', () => {
  /**
   * 2026-10-01 产品负责人原话：**「绝对不允许什么用自己正在用的域名才能够注册。」**
   *
   * 那一栏原来排在邮箱**上面** —— 一张表单的第一栏要人写出同步域名，
   * 就是"你是自建部署的运维吗"被当成了注册条件。这条判据钉的是**渲染顺序**：
   * 它必须排在邮箱之后（在共享层里能钉的就是这个，"发得出请求"那一半在宿主侧，
   * 钉在 `apps/web/tests/auth-journey.spec.tsx`：未配置时注册仍然真的发出去）。
   *
   * ⚠️ 用 `testID` 而不是中文句子做锚点：testID 不翻译、也不会因为改文案而漂移。
   */
  it('`server-url` 那一栏排在 `email` **之后**', () => {
    const emailAt = code.indexOf('`${testID}-email`');
    const serverAt = code.indexOf('`${testID}-server-url`');

    // 两个锚点都必须**在**：把邮箱栏删掉也能让"顺序对"成立，那是空测。
    expect(emailAt, '邮箱栏不见了').toBeGreaterThanOrEqual(0);
    expect(serverAt, '服务端地址栏不见了').toBeGreaterThanOrEqual(0);
    expect(serverAt, '服务端地址栏又跑回邮箱上面了 —— 那道墙就还在').toBeGreaterThan(emailAt);
  });
});

describe('AuthForm —— 注册确认密码与强度反馈', () => {
  it('只在注册分支渲染确认字段和本地强度估计', () => {
    expect(code).toContain('testID={`${testID}-password-confirmation`}');
    expect(code).toContain('<PasswordStrength');
    expect(code).toMatch(/passwordStrength/);
  });

  it('提交前要求确认密码匹配，并把焦点移到确认字段', () => {
    expect(code).toMatch(/confirmPassword === ''/);
    expect(code).toMatch(/confirmPassword !== password/);
    expect(code).toMatch(/confirmPasswordInput\.current\?\.focus\(\)/);
    expect(code).toMatch(/onRegister\(\{[\s\S]{0,220}password,[\s\S]{0,120}termsAccepted/);
  });

  it('确认字段使用新密码 autofill，并有独立无障碍错误落点', () => {
    expect(code).toMatch(/testID=\{`\$\{testID\}-password-confirmation`\}/);
    expect(code).toMatch(/autoComplete=\{passwordAutocomplete\(mode\)\}/);
    expect(code).toMatch(/aria-invalid=\{invalidFor\('passwordConfirmation'\)\}/);
  });
});
