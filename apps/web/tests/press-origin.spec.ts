/**
 * 按下扩散的原点：判定表
 * ==========================
 *
 * 这条链路有三个**只会静默出错**的地方，各钉一条：
 *
 *   1. **圆心必须真的跟着点击点走。** 写错了（例如恒写 50%）样式照样生效、
 *      高光照样出现，只是永远在中心 —— 看起来"有这个效果"，其实是死的。
 *   2. **必须钳在盒内。** 从屏幕边缘按下时 `clientX` 落在按钮外，
 *      不钳的话渐变中心跑出去，读起来像"高光从外面飘进来"。
 *   3. **按钮外的点击不能写。** 委托在 document 上，不筛选择器的话
 *      每次点空白都会往某个祖先写属性（或直接报错）。
 *
 * 🔴 这里刻意**不测 CSS**（`::after` 的 opacity / content）。样式对不对
 * 的判据只能是真实渲染 —— 那由提交信息里那份 Playwright 像素采样负责
 * （按下点 61,90,186 vs 对侧 53,83,183）。jsdom 没有布局，测不出来。
 */

import { afterEach, describe, expect, it } from 'vitest';

import { PRESS_ORIGIN_X, PRESS_ORIGIN_Y, installPressOrigin } from '../src/lib/press-origin.js';

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.innerHTML = '';
});

/** 造一个 200×50、位于 (100, 100) 的按钮。jsdom 的 getBoundingClientRect 恒为 0，必须自己给。 */
function makeButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'ht-btn';
  button.getBoundingClientRect = () =>
    ({ left: 100, top: 100, width: 200, height: 50, right: 300, bottom: 150, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(button);
  return button;
}

function press(target: Element, clientX: number, clientY: number): void {
  const event = new MouseEvent('pointerdown', { bubbles: true, clientX, clientY });
  target.dispatchEvent(event);
}

describe('installPressOrigin：圆心跟着点击点走', () => {
  it('在按钮左半边按下 → 圆心落在左侧百分比', () => {
    const button = makeButton();
    dispose = installPressOrigin(document);

    // 盒子 100..300 宽 200 ⇒ clientX 140 是 20%
    press(button, 140, 125);

    expect(button.style.getPropertyValue(PRESS_ORIGIN_X)).toBe('20.00%');
    // 盒子 100..150 高 50 ⇒ clientY 125 是 50%
    expect(button.style.getPropertyValue(PRESS_ORIGIN_Y)).toBe('50.00%');
  });

  it('在按钮右半边按下 → 同一个按钮的圆心跟着变（不是只写一次）', () => {
    const button = makeButton();
    dispose = installPressOrigin(document);

    press(button, 140, 125);
    press(button, 260, 125);

    // 260 - 100 = 160 / 200 = 80%
    expect(button.style.getPropertyValue(PRESS_ORIGIN_X)).toBe('80.00%');
  });

  it('点在按钮内的**子元素**上，也归到按钮（委托要看祖先）', () => {
    const button = makeButton();
    const icon = document.createElement('span');
    button.appendChild(icon);
    dispose = installPressOrigin(document);

    press(icon, 140, 125);

    expect(button.style.getPropertyValue(PRESS_ORIGIN_X)).toBe('20.00%');
  });
});

describe('installPressOrigin：边界', () => {
  it('钳在 0–100%：从盒子左侧外面按下不会写出负值', () => {
    const button = makeButton();
    dispose = installPressOrigin(document);

    // clientX 60 在盒子左边界（100）之外 ⇒ 相对位置 -20%
    press(button, 60, 125);

    expect(button.style.getPropertyValue(PRESS_ORIGIN_X)).toBe('0.00%');
  });

  it('点数在文档上但不落在 `.ht-btn` 里 → 一个属性都不写', () => {
    const button = makeButton();
    const other = document.createElement('div');
    document.body.appendChild(other);
    dispose = installPressOrigin(document);

    press(other, 10, 10);

    expect(button.style.getPropertyValue(PRESS_ORIGIN_X)).toBe('');
    expect(other.style.getPropertyValue(PRESS_ORIGIN_X)).toBe('');
  });

  it('尺寸为 0 的按钮跳过（不写 0/0 = NaN）', () => {
    const button = document.createElement('button');
    button.className = 'ht-btn';
    button.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(button);
    dispose = installPressOrigin(document);

    press(button, 10, 10);

    expect(button.style.getPropertyValue(PRESS_ORIGIN_X)).toBe('');
  });

  it('卸载后不再写（HMR / 测试之间不留监听）', () => {
    const button = makeButton();
    const stop = installPressOrigin(document);
    stop();

    press(button, 140, 125);

    expect(button.style.getPropertyValue(PRESS_ORIGIN_X)).toBe('');
  });
});
