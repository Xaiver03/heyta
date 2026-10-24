/**
 * `FormField` 的契约（web 表单行原语，2026-10-24）
 * ================================================
 *
 * 这一族钉的是**线**，不是样式：`htmlFor` / `id` 的配对、`aria-describedby` 指向谁、
 * 错误与说明**互斥**、必填怎么念。样式在 `form.css`，几何判据在
 * `e2e/tests/habit-create-shape.spec.ts` 的 S2/S3。
 *
 * 🔴 为什么不测"长得对不对"：jsdom 没有布局。在 jsdom 里写"控件 44px"
 * 只会得到一条**永远通过**的判据 —— 而仓库那条元规则写着
 * 「一条永远通过的判据比没有判据更糟」。
 *
 * ⚠️ 用 `react-dom/client` + `act`，**不引 @testing-library**：
 * 本仓所有渲染测试都是这个形状（见 `habits-list-pane.spec.tsx`），
 * 引一个新测试库要过 §3.1/§3.2 两道门，而这件事不需要它。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FormField } from '../src/lib/form/FormField.js';

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode): void {
  container = document.createElement('div');
  document.body.append(container);
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
});

const ctl = (): HTMLInputElement => document.querySelector('input[data-testid="ctl"]')!;

describe('FormField：标签与控件的连线', () => {
  it('F1 label 的 for 指向控件的 id（点标签能聚焦，读屏念得出名字）', () => {
    render(
      <FormField id="f1" label="习惯名称">
        {(field) => <input {...field} data-testid="ctl" />}
      </FormField>,
    );
    const label = document.querySelector('label[for="f1"]')!;
    expect(label.textContent).toBe('习惯名称');
    expect(ctl().id).toBe('f1');
  });

  it('F2 required 同时给出 aria-required 与视觉星号，且星号不进无障碍名', () => {
    render(
      <FormField id="f2" label="名称" required>
        {(field) => <input {...field} data-testid="ctl" />}
      </FormField>,
    );
    expect(ctl().getAttribute('aria-required')).toBe('true');
    expect(ctl().required).toBe(true);
    // 星号必须是 `aria-hidden` —— 否则读屏念成「名称 星号」。
    const star = document.querySelector('.ht-input-field__required')!;
    expect(star.textContent).toBe('*');
    expect(star.getAttribute('aria-hidden')).toBe('true');
  });

  it('F3 有说明时 aria-describedby 指向说明，且说明在 DOM 里', () => {
    render(
      <FormField id="f3" label="补打卡" hint="默认 1 天">
        {(field) => <input {...field} data-testid="ctl" />}
      </FormField>,
    );
    expect(ctl().getAttribute('aria-describedby')).toBe('f3-hint');
    expect(document.getElementById('f3-hint')!.textContent).toBe('默认 1 天');
  });

  it('F4 错误优先，且**说明让位**（同一行不说两句话，读屏不会念错重点）', () => {
    render(
      <FormField id="f4" label="天数" hint="默认 1 天" error="必须是 1 或更大的整数">
        {(field) => <input {...field} data-testid="ctl" />}
      </FormField>,
    );
    expect(ctl().getAttribute('aria-describedby')).toBe('f4-error');
    expect(ctl().getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('必须是 1 或更大的整数');
    expect(document.getElementById('f4-hint')).toBeNull();
  });

  it('F5 没有错误时 aria-invalid 是 false 而不是缺省（读屏据此改口）', () => {
    render(
      <FormField id="f5" label="天数">
        {(field) => <input {...field} data-testid="ctl" />}
      </FormField>,
    );
    expect(ctl().getAttribute('aria-invalid')).toBe('false');
  });

  it('F6 layout 决定类名：缺省 stacked（表单页），inline 是设置/属性面板', () => {
    render(
      <FormField id="f6" label="A">
        {(field) => <input {...field} />}
      </FormField>,
    );
    expect(document.querySelector('.ht-input-field--stacked')).not.toBeNull();
    act(() => {
      root.unmount();
    });
    render(
      <FormField id="f6b" label="B" layout="inline">
        {(field) => <input {...field} />}
      </FormField>,
    );
    expect(document.querySelector('.ht-input-field--inline')).not.toBeNull();
  });

  it('F7 给了 leading 就不画 label 元素（头像那一格），控件自带 aria-label', () => {
    render(
      <FormField
        id="f7"
        label="图标"
        layout="inline"
        leading={<span data-testid="lead">头</span>}
      >
        {(field) => <input {...field} aria-label="图标" data-testid="ctl" />}
      </FormField>,
    );
    expect(document.querySelector('[data-testid="lead"]')).not.toBeNull();
    expect(document.querySelector('label[for="f7"]')).toBeNull();
    expect(ctl().getAttribute('aria-label')).toBe('图标');
  });

  it('F8 三个属性都由 render prop 给出，调用方不会漏（漏一个就少一条读屏信息）', () => {
    render(
      <FormField id="f8" label="X" required hint="说明">
        {(field) => {
          expect(Object.keys(field).sort()).toEqual([
            'aria-describedby',
            'aria-invalid',
            'aria-required',
            'id',
            'required',
          ]);
          return <input {...field} data-testid="ctl" />;
        }}
      </FormField>,
    );
    expect(ctl()).toBeTruthy();
  });
});
