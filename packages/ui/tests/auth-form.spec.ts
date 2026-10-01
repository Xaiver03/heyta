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
    // 每个 `invalidFor(...)` 都必须旁边挂一条 `<Text>`，否则"报错"只剩颜色。
    const blocks = code.match(/invalidFor\('(\w+)'\) \?\s*\(/g) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const block of code.match(
      /invalidFor\('\w+'\) \? \(\s*<Text[^>]*>\{labels\.localErrors\.\w+/g,
    ) ?? []) {
      expect(block).toContain('<Text');
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
