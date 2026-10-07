/**
 * 捕获复刻件与共享 `CaptureComposer` 之间的**会红约束**
 * ======================================================
 *
 * 背景：`docs/plans/multi-platform-adaptation.md` 的 M3 每轮固定流程**第 3.5 步**
 * （「把 landing 上对应那一块也换成真组件 / 补上同步判据」）。第八刀（`capture`）
 * 当时**明确未做这一步**，于是捕获那一块一直画在 `AppWindow.tsx` 里、
 * 抄的还是隔壁 `FocusPanel` 那一族取值（见 `capture-shape.ts` 文件头）。
 *
 * 🔴 为什么不是"把复刻件换成真组件"：`docs/research/dida-view-unification.md`
 * §9.1 是**永久判决** —— `apps/landing/src/mockup/**` 静态 import `@heyta/ui`
 * 会让首屏 **+61.9 kB gzip（+31%）**。替代约束是「**纯数据登记处 + 会红判据**」，
 * 与 `mockup-habit-shape.spec.tsx` / `mockup-quadrant-shape.spec.tsx` 同一形状。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这里钉的是"复刻件抄的是不是**这一个**组件的取值"
 *
 * `.mk-input` / `.mk-btn-primary` 是**两族组件共用**的类名（`FocusRing.tsx` 也在用），
 * 所以"复刻件有类名、样式也不裸"完全可能是假象：它的每个数值都可能来自隔壁组件。
 * 本 spec 因此**从共享层源码文本里抽出 token**，再要求 `mockup.css` 的
 * `.mk-input--capture` / `.mk-btn-primary--capture` 用**同一批** token ——
 * 共享层改了而 landing 没跟 → 红；landing 自己挑一组别人的 token → 也红。
 *
 * | 漂移的形状 | 这里怎么红 |
 * |---|---|
 * | 共享层把输入框内边距改成 `space.4` | `.mk-input--capture` 的 `padding-inline` 对不上 |
 * | 复刻件把按钮间距抄成 `space.2`（那是 FocusPanel 的） | `.mk-btn-primary--capture` 的 `gap` 对不上 |
 * | 复刻件把按钮文字抄成 `font-weight.medium` | `.mk-btn-primary--capture` 的 `font-weight` 对不上 |
 * | 真实现去掉禁用态那一层透明度 | `.mk-btn-primary--off` 的 `opacity` 对不上 |
 * | 真实现改成"总是渲染芯片"（空态不再等价） | 空态守卫断言对不上 |
 * | web 宿主把文案 key 换了 | 登记处的 key 与宿主源码里的 `t(...)` 实参对不上 |
 * | 有人在 AppWindow 里绕开登记处手写 key | AppWindow 源码里出现 `'web.capture`字面量 |
 * | 有人把 `@heyta/ui` 静态引进 landing | 源码扫描 |
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这道判据**不**断言什么（如实写下来，别当它是全覆盖）
 *
 *   1. **芯片与「实际标题」预览没有被画出来。** 那不是漏画：共享组件只在
 *      `chips.length > 0` 时渲染那两块，而复刻画的是**空输入框**（只有 placeholder）。
 *      本 spec 反过来钉住这个前提 —— 真实现一旦改成"总是渲染"，复刻的空态就不再
 *      等价，会红。但**复刻确实没有演示"输入一句话 → 看见读懂了什么"这个签名交互**，
 *      那是营销页的已知缺口（登记在计划文件里），不是这里能守住的。
 *   2. **输入框的形态**：复刻是 `<div>`（静态文本），真实现是 RN `TextInput`
 *      （`<input>`）。复刻外框 `pointer-events: none`、整块不可交互，所以
 *      没有 `accessibilityLabel` / 没有 `placeholder` 属性 —— 这是展厅的既定取舍
 *      （`mockup.css` 文件头），不是这一块的漂移。
 *   3. **`font-size` 之外的字形细节**：`line-height` / `letter-spacing` 已按
 *      `row-meta` 对账，但"placeholder 的浏览器默认渲染"（如垂直基线）
 *      不做逐像素比对。
 *
 * ⚠️ 三个只读接缝（故障注入专用，`/tmp` 副本 + 环境变量，**不碰共享工作区**）：
 * `HEYTA_MOCKUP_UI_SRC`（`packages/ui/src`）、`HEYTA_MOCKUP_WEB_SRC`
 * （`apps/web/src`）、`HEYTA_MOCKUP_APP_SRC`（`apps/landing/src/mockup`，
 * 用来注入"复刻件自己抄错"那几向）。不设它们时就是真实路径。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { cssVarName, type TokenName } from '@heyta/design-system';
import { I18nProvider, zhCN } from '@heyta/i18n';

import { AppWindow } from '../src/mockup/AppWindow.js';
import {
  MOCK_CAPTURE_ADD_ICON_SIZE,
  MOCK_CAPTURE_CAN_SUBMIT,
  MOCK_CAPTURE_CLASS,
  MOCK_CAPTURE_DRAFT,
  MOCK_CAPTURE_KEYS,
  MOCK_CAPTURE_LIVE_GUARD,
  mockCaptureAddClass,
} from '../src/mockup/capture-shape.js';
import { readUiSource, readWebSource } from './helpers/source-text.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const REPO = resolve(HERE, '../../..');

// 两枚注入接缝的唯一所有者是 `./helpers/source-text.ts`（原先三份各自定义，
// 变异台架指过去时只会重定向其中一份 ⇒ 另外两份在"临时树"上读的其实是真源码）。
const readUi = readUiSource;
const readWeb = readWebSource;
const MOCKUP_SRC = process.env.HEYTA_MOCKUP_APP_SRC ?? join(APP, 'src/mockup');
const readMockup = (file: string): string => readFileSync(join(MOCKUP_SRC, file), 'utf8');

const captureModelSource = (): string => readUi('capture/model.ts');
const captureComposerSource = (): string => readUi('capture/CaptureComposer.tsx');
const webHostSource = (): string => readWeb('features/capture/CaptureComposer.tsx');
const appWindowSource = (): string => readMockup('AppWindow.tsx');
const captureShapeSource = (): string => readMockup('capture-shape.ts');
const mockupCss = (): string => readMockup('mockup.css');

/**
 * 去掉注释再做"有没有出现某个词"的断言。
 *
 * 🔴 这一步是**必须的**：本仓库已经三次栽在"`grep` 命中的是注释"上
 * （`apps/web` 的 `.ht-capture*` 删除、`mockup-habit-shape.spec.tsx` 的
 * `Math.random` 假红、以及本文件旁边那几份 shape 登记处的文件头说明）。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * jsdom 不实现 `ResizeObserver`，而 `AppWindow` 用它算缩放比。
 * 这是**测试环境的缺口**，不是产品缺陷（与 `mockup-habit-shape.spec.tsx` 同一处取舍）。
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  if (root !== null) {
    act(() => {
      root?.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
});

/** 渲染展厅里「任务」那一幕（捕获输入行在四个视图上都常驻）。 */
function renderMockup(): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <AppWindow view="tasks" />
      </I18nProvider>,
    );
  });
  return container;
}

/** 取共享层 `makeStyles()` 里某个样式块的块体。 */
function styleBlock(source: string, key: string): string {
  const at = source.indexOf(`\n    ${key}: {`);
  if (at < 0) throw new Error(`共享 CaptureComposer 里找不到样式块：${key}`);
  const open = source.indexOf('{', at);
  const close = source.indexOf('\n    },', open);
  if (close < 0) throw new Error(`样式块 ${key} 没有闭合`);
  return source.slice(open + 1, close);
}

/** 块体 → `属性 → 值`。 */
function styleDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of body.split('\n')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const key = part.slice(0, colon).trim();
    const value = part
      .slice(colon + 1)
      .trim()
      .replace(/,$/, '');
    if (key !== '') declarations.set(key, value);
  }
  return declarations;
}

/** `tokens['a.b']` → `a.b`。**共享层的取值只能来自 token 表**，别的写法直接抛。 */
function tokenOf(source: string, block: string, property: string): TokenName {
  const value = styleDeclarations(styleBlock(source, block)).get(property);
  const match = value === undefined ? null : /tokens\['([^']+)'\]/.exec(value);
  if (match === null) {
    throw new Error(`共享 CaptureComposer 的 ${block}.${property} 不是 tokens['…']：${String(value)}`);
  }
  return match[1] as TokenName;
}

/** 取某条 CSS 规则的规则体（第一条匹配）。 */
function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`mockup.css 里找不到规则：${selector}`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

/** 规则体 → `属性 → 值`（不用 `toContain`，它回答的不是"这一项取值对"）。 */
function cssDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  return declarations;
}

/** 某个属性的值必须**恰好**是 `var(<token>)`。 */
function expectVar(css: string, selector: string, property: string, token: TokenName): void {
  const value = cssDeclarations(ruleBody(css, selector)).get(property);
  expect(value, `${selector} 的 ${property} 必须恰好是 var(${cssVarName(token)})`).toBe(
    `var(${cssVarName(token)})`,
  );
}

describe('真实现的锚点还在，而且捕获只剩一份实现', () => {
  it('判断层：芯片三态 / 可提交 / 忽略清单 / 剩余天数都在 `capture/model.ts`', () => {
    const model = captureModelSource();
    for (const symbol of [
      'export function toCaptureChips',
      'export function captureChipAction',
      'export function captureCanSubmit',
      'export function toggleCaptureIgnore',
      'export function captureChipRemainingDays',
      'export function parseCaptureDraft',
    ]) {
      expect(model, `capture/model.ts 少了 ${symbol}`).toContain(symbol);
    }
    // 🔴 解析仍然只有一份：共享判断层不自己写正则。
    expect(model).toContain('parseCapture');
  });

  it('共享视图：输入行 / 提交按钮 / 芯片 / 预览都在同一个组件里', () => {
    const composer = captureComposerSource();
    for (const anchor of [
      'toCaptureChips',
      'captureCanSubmit',
      'toggleCaptureIgnore',
      'labels.placeholder',
      'labels.add',
      'labels.rejected',
      'labels.unused',
      'labels.previewLead',
      'labels.matchesAria',
    ]) {
      expect(composer, `共享 CaptureComposer 少了 ${anchor}`).toContain(anchor);
    }
  });

  it('🔴 空态守卫：芯片与预览两块都由 `chips.length > 0` 守着', () => {
    const composer = captureComposerSource();
    const guards = composer.split(MOCK_CAPTURE_LIVE_GUARD).length - 1;
    expect(
      guards,
      `共享层不再用 \`${MOCK_CAPTURE_LIVE_GUARD}\` 守芯片/预览 —— ` +
        '复刻件画的是空输入框，这个前提一变，空态就不再等价',
    ).toBe(2);
  });

  it('web 宿主只剩接线：文案走 `web.capture.*`，写库走 `addTask`，芯片骨架不在它这儿', () => {
    const host = webHostSource();
    expect(host).toContain(`t('${MOCK_CAPTURE_KEYS.placeholder}')`);
    expect(host).toContain(`t('${MOCK_CAPTURE_KEYS.add}')`);
    expect(host).toContain('SharedCaptureComposer');
    expect(host).toContain('addTask');
    // 芯片的骨架属于共享层 —— 它回到 web 的 JSX 里就说明迁移被回滚了。
    expect(stripComments(host)).not.toContain('toCaptureChips');
  });
});

describe('复刻件的取值 = 共享层那一组（逐项对账）', () => {
  it('复用 `compose` 的间距，而不是自己挑一个', () => {
    const composer = captureComposerSource();
    expectVar(mockupCss(), MOCK_CAPTURE_CLASS.row, 'gap', tokenOf(composer, 'compose', 'gap'));
  });

  it('🔴 输入框：内边距用 `size.field-padding-x`（**不是**隔壁 FocusPanel 的 `space.4`）', () => {
    const composer = captureComposerSource();
    const css = mockupCss();
    expectVar(
      css,
      '.mk-input--capture',
      'padding-inline',
      tokenOf(composer, 'input', 'paddingHorizontal'),
    );
    expectVar(css, '.mk-input', 'min-block-size', tokenOf(composer, 'input', 'minHeight'));
    expectVar(css, '.mk-input', 'border-radius', tokenOf(composer, 'input', 'borderRadius'));
    expectVar(css, '.mk-input', 'background', tokenOf(composer, 'input', 'backgroundColor'));
    // 输入框里的字是 **placeholder**（复刻件只有 placeholder），所以取
    // `placeholderTextColor` 那一族，而不是 `color.foreground`。
    expectVar(css, '.mk-input', 'color', 'color.foreground-subtle');
    expect(captureComposerSource()).toContain(
      "placeholderTextColor={tokens['color.foreground-subtle']}",
    );
    // 无边界输入：共享层与复刻都明确使用 0；其余输入属性仍逐项走 token 对账。
    expect(styleDeclarations(styleBlock(composer, 'input')).get('borderWidth')).toBe('0');
    const border = cssDeclarations(ruleBody(css, '.mk-input')).get('border') ?? '';
    expect(border).toBe('0');
    // `row-meta` 的排版四件套（字号一条，其余三条在修饰类里）。
    expectVar(css, '.mk-input', 'font-size', 'font-size.sm');
    expectVar(css, '.mk-input--capture', 'font-weight', 'font-weight.regular');
    expectVar(css, '.mk-input--capture', 'line-height', 'line-height.normal');
    expectVar(css, '.mk-input--capture', 'letter-spacing', 'tracking.body');
  });

  it('🔴 提交按钮：`space.1` + `size.field-padding-x` + `font-weight.regular`', () => {
    const composer = captureComposerSource();
    const css = mockupCss();
    expectVar(
      css,
      '.mk-btn-primary--capture',
      'gap',
      tokenOf(composer, 'addButton', 'gap'),
    );
    expectVar(
      css,
      '.mk-btn-primary--capture',
      'padding-inline',
      tokenOf(composer, 'addButton', 'paddingHorizontal'),
    );
    expectVar(css, '.mk-btn-primary--capture', 'font-weight', 'font-weight.regular');
    expectVar(css, '.mk-btn-primary--capture', 'line-height', 'line-height.normal');
    expectVar(css, '.mk-btn-primary--capture', 'letter-spacing', 'tracking.body');

    // 承载色与文字色（启用态）：真实现与复刻用的是同一个 token。
    expectVar(css, '.mk-btn-primary', 'background', tokenOf(composer, 'addEnabled', 'backgroundColor'));
    expectVar(css, '.mk-btn-primary', 'color', tokenOf(composer, 'addText', 'color'));
    expectVar(css, '.mk-btn-primary', 'min-block-size', tokenOf(composer, 'addButton', 'minHeight'));
    expectVar(css, '.mk-btn-primary', 'border-radius', tokenOf(composer, 'addButton', 'borderRadius'));
    expectVar(css, '.mk-btn-primary', 'font-size', 'font-size.sm');
  });

  it('🔴 空标题下的禁用态：`state.disabled-opacity`（复刻原来画的是全不透明）', () => {
    const composer = captureComposerSource();
    expectVar(
      mockupCss(),
      '.mk-btn-primary--off',
      'opacity',
      tokenOf(composer, 'addDisabled', 'opacity'),
    );
  });
});

describe('登记处 ⟷ 渲染 ⟷ AppWindow 三处一致', () => {
  it('登记处的 key 就是宿主注入的那两条', () => {
    expect(MOCK_CAPTURE_KEYS.placeholder).toBe('web.capture.placeholder');
    expect(MOCK_CAPTURE_KEYS.add).toBe('web.capture.add');
    // 中英词条表里真的有它们（而不是只在登记处凭空写了一个 key）。
    expect(zhCN[MOCK_CAPTURE_KEYS.placeholder]).toBeTruthy();
    expect(zhCN[MOCK_CAPTURE_KEYS.add]).toBeTruthy();
  });

  it('AppWindow 从登记处渲染，不再手抄类名与 key', () => {
    const source = stripComments(appWindowSource());
    for (const anchor of [
      'MOCK_CAPTURE_CLASS.row',
      'MOCK_CAPTURE_CLASS.input',
      'MOCK_CAPTURE_KEYS.placeholder',
      'MOCK_CAPTURE_KEYS.add',
      'mockCaptureAddClass',
    ]) {
      expect(source, `AppWindow 少了 ${anchor}`).toContain(anchor);
    }
    expect(source, "AppWindow 里又出现 `'web.capture…'` 字面量了").not.toContain("'web.capture");
  });

  it('渲染出来：输入框恰好两个子元素（空态没有芯片 / 没有预览）', () => {
    const view = renderMockup();
    const row = view.querySelector(`.${MOCK_CAPTURE_CLASS.row}`);
    expect(row, '渲染结果里没有捕获输入行 —— 判据锚点已失效').not.toBeNull();
    expect(row?.children, '空输入框下这一行只应有「输入框 + 按钮」两个元素').toHaveLength(2);
    expect(row?.textContent ?? '').not.toContain(zhCN['web.capture.previewLead']);
    expect(row?.textContent ?? '').not.toContain(zhCN['web.capture.unused']);
  });

  it('渲染出来：输入框的提示语与按钮的字都来自登记处那几个 key', () => {
    const view = renderMockup();
    const input = view.querySelector('.mk-input--capture');
    const add = view.querySelector('.mk-btn-primary--capture');
    expect(input?.textContent?.trim()).toBe(zhCN[MOCK_CAPTURE_KEYS.placeholder]);
    expect(add?.textContent?.trim()).toBe(zhCN[MOCK_CAPTURE_KEYS.add]);
  });

  it('渲染出来：空草稿 ⇒ 按钮带禁用态，`+` 图标就是 `icon.sm` 的 16px', () => {
    const view = renderMockup();
    const add = view.querySelector('.mk-btn-primary--capture');
    expect(mockCaptureAddClass(MOCK_CAPTURE_CAN_SUBMIT)).toBe(
      `${MOCK_CAPTURE_CLASS.add} ${MOCK_CAPTURE_CLASS.addOff}`,
    );
    expect(add?.getAttribute('class')).toBe(mockCaptureAddClass(MOCK_CAPTURE_CAN_SUBMIT));
    expect(add?.getAttribute('class')).toContain('mk-btn-primary--off');

    const svg = add?.querySelector('svg');
    expect(svg, '提交按钮里没有 `+` 图标').not.toBeNull();
    expect(svg?.getAttribute('width')).toBe(String(MOCK_CAPTURE_ADD_ICON_SIZE));
    // 16 这个数不是随手写的：它就是 `icon.sm`（真实现那一侧）。
    expectVar(mockupCss(), '.mk-btn-primary', 'font-size', 'font-size.sm');
    expect(captureComposerSource()).toContain("size={tokens['icon.sm']}");
  });
});

describe('首屏包不许变大（这一块同样适用）', () => {
  it('登记处是纯数据：不 import `@heyta/ui` / `react-native` / React', () => {
    const source = captureShapeSource();
    expect(source).not.toMatch(/from\s+['"]@heyta\/ui['"]/);
    expect(source).not.toMatch(/from\s+['"]react-native['"]/);
    expect(source).not.toMatch(/from\s+['"]react['"]/);
  });
});

describe('覆盖边界（写进断言，免得读的人以为它管得更宽）', () => {
  it('复刻件画的是**空态**：草稿为空、不许提交 —— 芯片与预览的缺席由此而来', () => {
    expect(MOCK_CAPTURE_DRAFT).toBe('');
    expect(MOCK_CAPTURE_CAN_SUBMIT).toBe(false);
    // 非空标题那一态（按钮实心）没有被画出来，但函数本身必须能表达它。
    expect(mockCaptureAddClass(true)).toBe(MOCK_CAPTURE_CLASS.add);
    expect(mockCaptureAddClass(true)).not.toContain('mk-btn-primary--off');
  });

  it('真实现那一侧的锚点：解析 / 换算都在共享层，web 只出文案', () => {
    expect(webHostSource()).toContain('captureChipRemainingDays');
    expect(webHostSource()).toContain('capturePriorityLabelKey');
    expect(captureComposerSource()).not.toMatch(/from\s+['"]@heyta\/i18n['"]/);
  });
});
