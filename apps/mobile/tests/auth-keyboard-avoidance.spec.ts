/**
 * 注册 / 登录页的**键盘避让**（2026-11-18）
 * ========================================
 *
 * 现象（产品负责人）：手机上注册登录页输入框弹出后，输入法会盖住输入框，
 * 页面不会自然上移。
 *
 * 根因是结构性的，不是"样式没调好"：
 *   · 欢迎页的认证面板是 `position:'absolute'; bottom:0` 的抽屉，键盘弹起时它
 *     不会动 —— 绝对定位的元素不参与 `KeyboardAvoidingView` 的重排；
 *   · 从「设置 → 账号」进入的整屏 `AuthScreen` 也没有任何键盘避让。
 *
 * 这一组只钉**结构事实**（本仓 `apps/mobile` 没有 RN 组件测试栈，行为由
 * `pnpm verify:mobile-auth` 在真机验）：两条路径各自必须保留避让实现，
 * 否则下一次重构把它删掉时不会有任何报错，只会重新变成"输入框被盖住"。
 *
 * ⚠️ 与其它结构用例同一做法：先去掉注释再匹配（`codeOf`），
 * 免得把实现注释掉就能糊过判据。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

function codeOf(file: string): string {
  return readFileSync(join(SRC, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');
}

describe('欢迎页：底部升起的认证抽屉要跟着键盘走', () => {
  const code = codeOf('screens/WelcomeScreen.tsx');

  it('🔴 订阅键盘显示/隐藏，并把高度记进 state', () => {
    expect(code, '没有 Keyboard.addListener —— 抽屉不会随键盘上移').toMatch(/Keyboard\.addListener/);
    expect(code).toMatch(/keyboardWillShow/);
    expect(code).toMatch(/keyboardDidShow/);
    expect(code).toMatch(/keyboardWillHide/);
    expect(code).toMatch(/keyboardDidHide/);
    expect(code).toMatch(/setKeyboardHeight\(event\.endCoordinates\.height\)/);
  });

  it('🔴 键盘高度真的用在抽屉定位上（bottom 抬到键盘上沿 + 高度上限收窄）', () => {
    // 只订阅不用，等于没修。
    expect(code).toMatch(/keyboardSheet/);
    expect(code).toMatch(/bottom:\s*windowShrunkByKeyboard/);
    expect(code).toMatch(/maxHeight:/);
    // 抽屉内的 ScrollView 必须能收缩，否则多出来的内容会被裁切而不是可滚动。
    expect(code).toMatch(/sheetScroll/);
    expect(code).toMatch(/flexShrink:\s*1/);
  });

  it('🔴 区分「窗口已被压矮」与「窗口未缩」两种系统（避免抬两次）', () => {
    expect(code).toMatch(/baseWindowHeight/);
    expect(code).toMatch(/windowShrunkByKeyboard/);
  });
});

describe('整屏认证页（设置 → 账号）：由自己负责键盘避让', () => {
  const code = codeOf('screens/AuthScreen.tsx');

  it('🔴 整屏档用 KeyboardAvoidingView 包裹表单', () => {
    expect(code, '整屏认证页没有键盘避让').toMatch(/<KeyboardAvoidingView/);
    expect(code).toMatch(/behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/);
  });

  it('🔴 内嵌档不重复叠加（滚动/安全区/键盘归宿主）', () => {
    expect(code).toMatch(/if \(embedded\) return panel;/);
  });
});
