/**
 * 语言偏好读写测试
 * ==================
 *
 * 🔴 这个文件存在的理由：**语言偏好读错/写错，用户会看到自己读不懂的界面，
 * 而且没有任何一处会报错。**
 *
 * web 的语言是四层解析链（2026-10-01 拍板，`src/lib/locale.ts` 文件头）：
 *
 *   - 读：已存偏好 > 落地页带来的 `?lang=` > `navigator.language` > `DEFAULT_LOCALE`；
 *   - 写：`applyLocale` 必须落到正确的键、并同步 `<html lang>`；
 *
 * `tests/setup.ts` 已把 jsdom 的 `navigator.language` 钉成 `zh-CN`
 * （保持「无偏好 ⇒ 中文」的既有默认）；本文件测第 3 层的用例逐条覆写它。
 * 标签匹配本身的用例在 `packages/i18n/tests/match.spec.ts`，不在这里重复。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LOCALE } from '@heyta/i18n';

import { applyLocale, isLocale, resolveInitialLocale } from '../src/lib/locale.js';

/** 覆写系统语言 —— `mockRestore()` 后回到 setup.ts 钉的 `zh-CN`。 */
function setNavigatorLanguage(value: string) {
  return vi.spyOn(navigator, 'language', 'get').mockReturnValue(value);
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
});

describe('isLocale', () => {
  it('只认支持的两种语言', () => {
    expect(isLocale('zh-CN')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('zh')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe('resolveInitialLocale', () => {
  it('读取已存的有效偏好', () => {
    localStorage.setItem('heyta.locale', 'en');
    expect(resolveInitialLocale()).toBe('en');
    localStorage.setItem('heyta.locale', 'zh-CN');
    expect(resolveInitialLocale()).toBe('zh-CN');
  });

  it('🔴 存了不支持的语言时回落到默认语言，而不是被它带走', () => {
    localStorage.setItem('heyta.locale', 'fr-FR');
    expect(resolveInitialLocale()).toBe(DEFAULT_LOCALE);
  });
});

describe('resolveInitialLocale：系统语言（第 3 层，2026-10-01 拍板新增）', () => {
  it('没存过偏好、没带参数时，用系统语言做首启语言', () => {
    const spy = setNavigatorLanguage('en-US');
    expect(resolveInitialLocale()).toBe('en');
    spy.mockRestore();

    const spy2 = setNavigatorLanguage('zh-TW');
    expect(resolveInitialLocale()).toBe('zh-CN');
    spy2.mockRestore();
  });

  it('🔴 系统语言不受支持时兜底默认 —— 不猜 fr→en 这类映射', () => {
    const spy = setNavigatorLanguage('fr-FR');
    expect(resolveInitialLocale()).toBe(DEFAULT_LOCALE);
    spy.mockRestore();
  });

  it('🔴 已存偏好胜过系统语言 —— 明确选过的不被自动检测翻回', () => {
    // 旧决策否掉 navigator 层时担心的正是这个场景；四层链下它必须仍然成立，
    // 否则"用户明确选了英文之后又被翻回中文"会以新的形式复发。
    const spy = setNavigatorLanguage('en-US');
    localStorage.setItem('heyta.locale', 'zh-CN');
    expect(resolveInitialLocale()).toBe('zh-CN');
    spy.mockRestore();
  });
});

describe('resolveInitialLocale：落地页带来的 `?lang=`', () => {
  /**
   * 🔴 这一段钉的是 roadmap §5.1 留下的保留之一：读完**英文**落地页点进应用，
   * 看到的却是中文。落地页靠 URL 定语言（要 SEO），应用靠偏好存储定语言，
   * 两边原本不通；`apps/landing/src/lib/app-url.ts` 现在会在外链上带 `?lang=en`。
   */
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('没存过偏好时接受 URL 里的语言', () => {
    window.history.replaceState({}, '', '/?lang=en');
    expect(resolveInitialLocale()).toBe('en');
  });

  it('🔴 `?lang=` 胜过系统语言 —— 那是用户刚在落地页读着的语言', () => {
    // 设备语言是英文，但用户刚读完中文落地页点进来 —— 必须是中文。
    const spy = setNavigatorLanguage('en-US');
    window.history.replaceState({}, '', '/?lang=zh-CN');
    expect(resolveInitialLocale()).toBe('zh-CN');
    spy.mockRestore();
  });

  it('URL 里是不受支持的语言时**落穿到系统语言**，而不是被它带走', () => {
    // `?lang=fr-FR` 不受支持 ⇒ 参数作废 ⇒ 走下一层（系统语言），不是默认值。
    // 2026-10-01 之前这里断言的是「回落到默认语言」—— 第 3 层加入后语义变了。
    const spy = setNavigatorLanguage('en-US');
    window.history.replaceState({}, '', '/?lang=fr-FR');
    expect(resolveInitialLocale()).toBe('en');
    spy.mockRestore();
  });

  it('🔴 已存偏好**胜过** URL 参数 —— 陈旧参数不许覆盖用户的明确选择', () => {
    // 真实场景：带 `?lang=en` 进来（偏好存成 en）→ 用户在应用里切成中文 →
    // 刷新时地址栏里那个参数**还在**。若参数更强，用户会被翻回英文，
    // 而这件事看起来像"语言设置没保存"。
    // 断言写成"期望 en、URL 给 zh-CN"，才能把"存的高过 URL"与"恰好都是默认值"区分开。
    localStorage.setItem('heyta.locale', 'en');
    window.history.replaceState({}, '', '/?lang=zh-CN');
    expect(resolveInitialLocale()).toBe('en');
  });

  it('没有参数时走系统语言（回归）', () => {
    // setup.ts 把系统语言钉成 zh-CN，与默认语言相同 ——
    // 这条断言的是"无参数路径不再锁死默认值"，改坏第 3 层（删掉 navigator）
    // 时它不会红，由上面「用系统语言做首启」那条负责。
    const spy = setNavigatorLanguage('en-US');
    window.history.replaceState({}, '', '/');
    expect(resolveInitialLocale()).toBe('en');
    spy.mockRestore();
  });
});

describe('applyLocale', () => {
  it('写入 heyta.locale 键并同步 <html lang>', () => {
    applyLocale('en');
    expect(localStorage.getItem('heyta.locale')).toBe('en');
    expect(document.documentElement.lang).toBe('en');

    applyLocale('zh-CN');
    expect(localStorage.getItem('heyta.locale')).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});
