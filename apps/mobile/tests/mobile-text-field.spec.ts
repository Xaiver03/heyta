/**
 * 移动端字段：**判断与 web 共用一份**（2026-10-24）
 * ==============================================
 *
 * 这一族钉的是"移动端没有第二份判断"：`kit.TextField` 必须消费
 * `@heyta/ui#resolveFieldChrome`，并且把那三件事（错误优先 / 说明让位 /
 * `aria-invalid`）真的摆到 RN 原语上。
 *
 * ⚠️ 为什么是源码级：本壳没有组件测试栈（`apps/mobile/tests/habit-*.spec.ts` 同一条理由）。
 * 行为面的判据在 web（`form-field.spec.tsx` F1–F8）；**判断本身**在
 * `packages/ui/tests/form-anatomy.spec.ts` A1–C2。这里补的是"移动端接没接上"这一格。
 */

import { describe, expect, it } from 'vitest';

import { mobileSources, read, stripComments } from './source-reading';

describe('移动端 TextField 与共享判断', () => {
  const src = read('apps/mobile/src/ui/kit.tsx');

  it('M1 消费共享判断，而不是自己判一遍', () => {
    expect(src, 'kit.TextField 没有引用 resolveFieldChrome ⇒ 它有自己的第二份判断').toMatch(
      /resolveFieldChrome/,
    );
    expect(src).toMatch(/from '@heyta\/ui'/);
  });

  it('M2 错误优先、说明让位（两个分支都走 chrome，不是 `hint && !error` 手写）', () => {
    // 🔴 必须钉**渲染分支**，不是"文件里出现过 `chrome.invalid`"：
    //    第一版写成后者，于是把渲染那一行改成 `{false ? (…) : null}` 之后
    //    这条判据**照样绿**（文件里还有 `aria-invalid={chrome.invalid}`）。
    //    变异验证（2026-10-24）：把渲染条件换成 `false` ⇒ 必须红。
    expect(src, '错误那一句不是由 `chrome.invalid` 决定画不画').toMatch(
      /\{\s*chrome\.invalid\s*\?\s*\(/,
    );
    expect(src, '说明那一句不是由 `chrome.showHint` 决定画不画').toMatch(
      /\{\s*chrome\.showHint\s*\?\s*\(/,
    );
    expect(
      src,
      '手写了 `hint !== undefined && error === undefined` 这类第二份判断',
    ).not.toMatch(/error === undefined[^)]*hint/);
  });

  it('M3 就地错误必须会被读屏播报，且输入框带 aria-invalid', () => {
    expect(src, '错误那一句没有 accessibilityLiveRegion ⇒ 读屏用户不知道提交失败了').toMatch(
      /accessibilityLiveRegion="polite"/,
    );
    expect(src).toMatch(/aria-invalid=\{chrome\.invalid\}/);
  });

  it('M4 移动端没有第二个 RN 表单渲染器（共享层那份已删）', () => {
    // 第一版我在 `packages/ui/src/form/` 写了一个 `Field.tsx`，零消费者 ——
    // 而移动端本来就有 `kit.TextField`。那条被删掉了：渲染器归各端 kit，判断才归共享层。
    expect(src).toMatch(/export function TextField/);
  });

  it('M5 除了登记过的那几处，**没有屏自己手写 `<TextInput>`**（字段必须走 TextField）', () => {
    /**
     * 允许保留裸 `<TextInput>` 的地方 —— 每条都要写清楚"为什么它不是字段"。
     * ⚠️ 与 web 的 `NOT_A_FIELD_ALLOW` 同一条纪律：**写理由**，而且能删。
     */
    const ALLOWED: Record<string, string> = {
      'apps/mobile/src/screens/TasksScreen.tsx': '搜索框（工具栏控件，不是录入字段）',
      'apps/mobile/src/ai/chat-composer.tsx': '聊天输入条（会随键盘高度变形的多行编辑区）',
      'apps/mobile/src/screens/TaskDetailSheet.tsx':
        '「行内新建清单」那一格：为了消掉 Fabric 的 focus/unmount 竞态崩溃才手写（见该文件 996 行起的说明）',
    };
    const offenders: string[] = [];
    for (const rel of mobileSources()) {
      if (rel.endsWith('ui/kit.tsx')) continue; // 渲染器本体
      const code = stripComments(read(rel));
      if (!/<TextInput\b/.test(code)) continue;
      if (ALLOWED[rel] !== undefined) continue;
      offenders.push(rel);
    }
    expect(offenders, `这些文件手写了 <TextInput>，字段请用 kit 的 TextField：${offenders.join('、')}`).toEqual([]);
    // 登记表本身也要能收紧：每一条今天必须还命中，否则删掉它。
    for (const rel of Object.keys(ALLOWED)) {
      expect(stripComments(read(rel)), `ALLOWED 里登记的 ${rel} 今天已经没有 <TextInput> 了，删掉这一条`).toMatch(
        /<TextInput\b/,
      );
    }
  });
});
