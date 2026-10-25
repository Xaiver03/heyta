/**
 * 判据：PIPL 同意面的**视觉层级**在两档主题下都成立
 * =================================================
 *
 * 这一屏曾经是什么形状：控件全是能用、能读的真 `Pressable`，功能断言一条都不会红，
 * 但整个模态**零条样式** —— 三行同意范围与两颗按钮在视觉上等权，"确认共享"读起来
 * 和"取消"一样轻。同意面长成这样正是 PIPL 要防的形状（默认路径与拒绝路径看不出差别），
 * 而它躲过了全部既有判据。所以这里判的不是"有没有 class"，是**颜色本身**。
 *
 * ## 为什么住在 `apps/web` 而不是 `packages/ui`
 *
 * `packages/ui` 的既成纪律是只测模型层（那 44 份 `*.spec.ts` 里没有一棵渲染树），
 * 而**颜色来自宿主解析出的那张 token 表** —— 亮/暗两棵树只有在宿主侧才构造得出来。
 * 挂在 `HeytaUiProvider value=...` 上就是宿主真实交出去的那一份值。
 *
 * ## 为什么这几条不是自证
 *
 * - 断言的是「暗色表里的那枚主蓝」，**并同时断言暗 ≠ 亮** ⇒ 硬编码一枚亮色十六进制的
 *   组件会红（那正是 `packages/ui/src/theme.tsx` 文件头记着的 25 个低对比文字那次事故的形状）。
 * - 「取消按钮不许有实心底色」这条对**整块零样式**那一版直接成立为红 —— 也就是说
 *   把样式删回去会红，这是本用例的牙齿（五臂实测见计划里那一节）。
 * - 两档主题各跑一遍同一棵树，挡的是"只在某档里对"。
 *
 * ## 🔴 为什么不用 `getComputedStyle`
 *
 * react-native-web 把样式编译成**原子 class**（`r-backgroundColor-1frcd3k`），声明落在注入
 * 文档的那张表里。jsdom 对"**原地换了 class 的节点**"会返回**换之前**的值 —— 本用例第一版
 * 就这么读：勾选之后仍然读到未勾选那枚底色（`rgb(2, 6, 23)`），与"产品根本没换色"在输出上
 * 完全同形，而且它在单跑与全套之间一绿一红。所以这里读的是 **class → 声明** 本身
 * （`declared()`）—— 查那张表，不查节点上的缓存。
 *
 * ## ⚠️ 为什么这条不用真浏览器截图（AGENTS §5 要求"实际切换查看"）
 *
 * `e2e/tests/collab-journey.spec.ts` 那张 02 号图是**亮色**证据。暗色试过在旅程里补一张：
 * `emulateMedia({ colorScheme: 'dark' })` 之后截出来与亮色**逐字节相同**（md5 相同，2026-10-11 实测，
 * → §7 第 409 条）—— web 的暗色只改 `<html data-theme>`（`apps/web/src/lib/theme.ts` 文件头），
 * 而共享层的颜色来自**开机时解析完的那张表**。要让它真变暗必须重载页面，
 * 而重载会把这条旅程的解锁态打断。所以暗色由这里判：**同一棵树、同一张宿主交出的暗色表、断言颜色值本身**。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { translate, type MessageKey } from '@heyta/i18n';
import {
  HeytaUiProvider,
  ShareConsentModal,
  resolveHeytaUiTheme,
  type ShareConsentModalProps,
} from '@heyta/ui';

import { declared, norm } from './helpers/rnw-styles.js';

const LABELS = {
  title: translate('zh-CN', 'common.share.consent.title' as MessageKey),
  body: translate('zh-CN', 'common.share.consent.body' as MessageKey),
  scopes: [
    translate('zh-CN', 'common.share.consent.scope.content' as MessageKey),
    translate('zh-CN', 'common.share.consent.scope.metadata' as MessageKey),
    translate('zh-CN', 'common.share.consent.scope.notAffected' as MessageKey),
  ],
  dontAskAgain: translate('zh-CN', 'common.share.consent.dontAskAgain' as MessageKey),
  accept: translate('zh-CN', 'common.share.consent.accept' as MessageKey),
  cancel: translate('zh-CN', 'common.share.consent.cancel' as MessageKey),
};

const DARK = resolveHeytaUiTheme({ scheme: 'dark' });
const LIGHT = resolveHeytaUiTheme({ scheme: 'light' });

/** 取宿主那张表里的颜色值（token 名写错当场炸，不会静默比到 `undefined`）。 */
function tokenValue(theme: typeof DARK, name: string): string {
  const value = theme.tokens[name as keyof typeof theme.tokens];
  if (typeof value !== 'string') throw new Error(`token ${name} 不是颜色字符串（拿到 ${String(value)}）`);
  return norm(value);
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(props: Partial<ShareConsentModalProps> = {}, theme = DARK): HTMLElement {
  if (root !== undefined) {
    act(() => {
      root?.unmount();
    });
    root = undefined;
  }
  container?.remove();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <HeytaUiProvider value={theme}>
        <ShareConsentModal
          labels={LABELS}
          store={{}}
          onConsent={() => undefined}
          onProceed={() => undefined}
          onCancel={() => undefined}
          {...props}
        />
      </HeytaUiProvider>,
    );
  });
  return container as HTMLDivElement;
}

// 读声明本身的实现搬到了 `./helpers/rnw-styles.ts`（第二条用到它的判据是
// `share-notif-prefs-affordance.spec.tsx`）；两条禁令（不许按 classList 顺序扫、
// 不许用 `getComputedStyle`）的理由写在那份文件的文件头。
// ⚠️ `'<none>'` 是**读数**不是探针失败：对"取消不许有底色"这一条，它正是判据要的值。

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  container?.remove();
  container = undefined;
});

describe('暗色档：确认与取消不等权（这一屏的 PIPL 层级）', () => {
  it('🔴 主按钮吃到暗色表里的主蓝，而不是亮色那枚', () => {
    const darkPrimary = tokenValue(DARK, 'color.primary');
    // 前提：两档主蓝确实不同。不成立时下面那条断言就退化成"随便一枚蓝"。
    expect(darkPrimary, '暗色与亮色的主蓝必须不同，否则这条判据没有射程').not.toBe(
      tokenValue(LIGHT, 'color.primary'),
    );
    expect(declared(render(), '[data-testid="share-consent-accept"]', 'background-color')).toBe(darkPrimary);
  });

  it('🔴 取消按钮不许有实心底色（把样式整块删回去 —— 2026-10-11 之前那一版 —— 这条会红）', () => {
    const cancelBg = declared(render(), '[data-testid="share-consent-cancel"]', 'background-color');
    expect(cancelBg, `取消按钮读到的底色是 ${cancelBg}`).not.toBe(tokenValue(DARK, 'color.primary'));
    expect(cancelBg, '取消按钮应当根本没有底色声明（有实心＝与确认等权）').toBe('<none>');
  });

  it('主按钮文字用 on-primary，取消文字用正文色', () => {
    const el = render();
    expect(declared(el, '[data-testid="share-consent-accept"] > div', 'color')).toBe(
      tokenValue(DARK, 'color.on-primary'),
    );
    expect(declared(el, '[data-testid="share-consent-cancel"] > div', 'color')).toBe(
      tokenValue(DARK, 'color.foreground'),
    );
  });

  it('三行同意范围是一块凹陷披露面（底色 = 暗色 surface-sunken，且与亮色不同）', () => {
    const sunken = tokenValue(DARK, 'color.surface-sunken');
    expect(sunken).not.toBe(tokenValue(LIGHT, 'color.surface-sunken'));
    expect(declared(render(), '[data-testid="share-consent-scopes"]', 'background-color')).toBe(sunken);
  });

  it('勾选框：未勾选是描边空框，点一下变实心主蓝（状态不只靠颜色，还有 `aria-checked`）', () => {
    const el = render();
    const box = '[data-testid="share-consent-dont-ask"] > div';
    const row = '[data-testid="share-consent-dont-ask"]';
    expect(declared(el, box, 'background-color')).toBe(tokenValue(DARK, 'color.background'));
    // ⚠️ RNW 会把 `borderColor` **展开成四条 per-side 属性**（实测注入的是
    // `border-top-color` / `-right-` / `-bottom-` / `-left-`），所以按 `border-color` 读**永远是空**——
    // 那是"探针读不到"，不是"这一层没画"。逐边读其中一边。
    expect(declared(el, box, 'border-top-color')).toBe(tokenValue(DARK, 'color.border'));

    const node = el.querySelector<HTMLElement>(row);
    if (node === null) throw new Error(`DOM 里没有 ${row}`);
    expect(node.getAttribute('aria-checked'), '未勾选时 aria-checked 必须是 false').toBe('false');
    act(() => {
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(node.getAttribute('aria-checked'), '勾选后 aria-checked 必须跟着变').toBe('true');
    expect(declared(el, box, 'background-color'), '勾选后必须实心，不能只多了一个勾').toBe(
      tokenValue(DARK, 'color.primary'),
    );
  });
});

describe('亮色档：同一棵树不能只在暗色里对', () => {
  it('主按钮是亮色主蓝，取消仍无底色', () => {
    const el = render({}, LIGHT);
    expect(declared(el, '[data-testid="share-consent-accept"]', 'background-color')).toBe(
      tokenValue(LIGHT, 'color.primary'),
    );
    expect(declared(el, '[data-testid="share-consent-cancel"]', 'background-color')).toBe('<none>');
  });
});

describe('标题只出现一次（同屏两个同名标题是这次一并修掉的）', () => {
  it('默认渲染这句标题', () => {
    expect(render().textContent ?? '').toContain(LABELS.title);
  });

  it('宿主已经写着同一句时（web 的对话框 `<h2>`）置 `titleHidden` ⇒ 这句不再出现，但三行范围仍在', () => {
    const el = render({ titleHidden: true });
    const body = el.textContent ?? '';
    expect(body, '同屏不许出现两个同名标题').not.toContain(LABELS.title);
    expect(body).toContain(LABELS.scopes[0] ?? '');
    expect(body).toContain(LABELS.accept);
  });
});
