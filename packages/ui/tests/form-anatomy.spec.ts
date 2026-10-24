/**
 * 表单行的**判断**（`packages/ui/src/form/anatomy.ts`）
 * ====================================================
 *
 * 这一族钉的是两端共用的那三条裁决。它们之所以必须在这里测，是因为
 * 它们**没有第二份**：web 的 `FormField` 与移动端的 `Field` 都调这一支，
 * 而"两端各写一份判断"正是这个仓库反复吃亏的形状（同一句话两个端说两遍，两边都不报错）。
 *
 * 🔴 这里**不测渲染**：`packages/ui` 没有 RN 组件测试栈（加一个
 * `@testing-library/react-native` 要过 §3.1/§3.2 两道门，而这不是它的理由）。
 * 渲染侧的判据在 web 那一份：`apps/web/tests/form-field.spec.tsx` 的 F1–F8
 * 与 `e2e/tests/habit-create-shape.spec.ts` 的 S2/S3/S6。
 */

import { describe, expect, it } from 'vitest';

import {
  FIELD_LAYOUTS,
  fieldDescribedById,
  resolveFieldChrome,
} from '../src/form/anatomy.js';

describe('表单行：三种输入怎么解（A 组）', () => {
  it('A1 只有说明 ⇒ describedBy 指向说明，说明画出来', () => {
    const chrome = resolveFieldChrome({ hint: '默认 1 天' });
    expect(chrome.describedBy).toBe('hint');
    expect(chrome.showHint).toBe(true);
    expect(chrome.invalid).toBe(false);
  });

  it('A2 只有错误 ⇒ describedBy 指向错误，没有说明可画', () => {
    const chrome = resolveFieldChrome({ error: '必须是整数' });
    expect(chrome.describedBy).toBe('error');
    expect(chrome.invalid).toBe(true);
    expect(chrome.showHint).toBe(false);
  });

  it('A3 🔴 两者都有 ⇒ 错误优先，**说明让位**（同一行不说两句话）', () => {
    const chrome = resolveFieldChrome({ hint: '默认 1 天', error: '必须是整数' });
    expect(chrome.describedBy).toBe('error');
    expect(chrome.invalid).toBe(true);
    // 这一条是整组的承重：说明和错误同时画出来时，读屏会念两句，
    // 而用户要在里面找哪句是"坏事"。
    expect(chrome.showHint).toBe(false);
  });

  it('A4 空串与 undefined 同义（宿主把错误清成 "" 是常见写法）', () => {
    expect(resolveFieldChrome({ error: '' }).invalid).toBe(false);
    expect(resolveFieldChrome({ error: '' }).describedBy).toBe(null);
    expect(resolveFieldChrome({ hint: '' }).showHint).toBe(false);
  });

  it('A5 都没有 ⇒ describedBy 是 null，不是空字符串', () => {
    const chrome = resolveFieldChrome({});
    expect(chrome.describedBy).toBe(null);
  });
});

describe('表单行：必填与解剖（B 组）', () => {
  it('B1 星号只由 required 决定，且必须对读屏隐藏', () => {
    expect(resolveFieldChrome({ required: true }).showRequiredMark).toBe(true);
    expect(resolveFieldChrome({ required: true }).requiredAriaHidden).toBe(true);
    expect(resolveFieldChrome({}).showRequiredMark).toBe(false);
  });

  it('B2 解剖缺省是 stacked（表单页），inline 是设置/属性面板', () => {
    expect(resolveFieldChrome({}).layout).toBe('stacked');
    expect(resolveFieldChrome({}, 'inline').layout).toBe('inline');
  });

  it('B3 🔴 解剖只有两档 —— 加第三档之前先读 ux-principles.md §1', () => {
    // 一个"封闭词表"判据：多一档就说明有人往这里加了东西，
    // 而两端的渲染器会立刻分叉（web 的 CSS 只有两套、RN 的 flexDirection 只有两支）。
    expect([...FIELD_LAYOUTS]).toEqual(['stacked', 'inline']);
  });
});

describe('表单行：id 怎么拼（C 组）', () => {
  it('C1 有可指的东西 ⇒ 返回 `${id}-${角色}`', () => {
    const chrome = resolveFieldChrome({ hint: 'x' });
    expect(fieldDescribedById('f-1', chrome)).toBe('f-1-hint');
    const withError = resolveFieldChrome({ hint: 'x', error: 'y' });
    expect(fieldDescribedById('f-1', withError)).toBe('f-1-error');
  });

  it('C2 没有可指的东西 ⇒ undefined，**不是空串**（空串会被当成一个存在的 id）', () => {
    const chrome = resolveFieldChrome({});
    expect(fieldDescribedById('f-1', chrome)).toBeUndefined();
  });
});
