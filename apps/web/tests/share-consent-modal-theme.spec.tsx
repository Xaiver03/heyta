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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { translate, type MessageKey } from '@heyta/i18n';
import {
  HeytaUiProvider,
  SHARE_CONSENT_SCOPE_KEYS,
  ShareConsentModal,
  resolveHeytaUiTheme,
  type ShareConsentModalProps,
} from '@heyta/ui';

import { declared, norm } from './helpers/rnw-styles.js';

const LABELS = {
  // 语境键：这两套各代表一侧（分享／加入）。`describe('标题按语境分叉')` 拿它们互相断言，
  // 所以调用点把两颗键接反当场就红。那颗确认按钮同样按语境 —— 入群的人没在"确认共享"。
  share: {
    title: translate('zh-CN', 'common.share.consent.title.share' as MessageKey),
    body: translate('zh-CN', 'common.share.consent.body.share' as MessageKey),
    accept: translate('zh-CN', 'common.share.consent.accept.share' as MessageKey),
  },
  join: {
    title: translate('zh-CN', 'common.share.consent.title.join' as MessageKey),
    body: translate('zh-CN', 'common.share.consent.body.join' as MessageKey),
    accept: translate('zh-CN', 'common.share.consent.accept.join' as MessageKey),
  },
};

const SHARE_LABELS: ShareConsentModalProps['labels'] = {
  ...LABELS.share,
  detailsLabel: translate('zh-CN', 'common.share.consent.details.label' as MessageKey),
  details: SHARE_CONSENT_SCOPE_KEYS.map((key) => translate('zh-CN', key as MessageKey)),
  dontAskAgain: translate('zh-CN', 'common.share.consent.dontAskAgain' as MessageKey),
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
          labels={SHARE_LABELS}
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

const TRIGGER = '[data-testid="share-consent-details-trigger"]';
const PANEL = '[data-testid="share-consent-details"]';

function node(el: ParentNode, selector: string): HTMLElement {
  const found = el.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`DOM 里没有 ${selector}`);
  return found;
}

/** 这一块在布局里**有没有**（收起 = `display:none`，内容仍然在树里）。 */
function laidOut(el: ParentNode, selector: string): boolean {
  return declared(el, selector, 'display') !== 'none';
}

/** 触屏那一下 —— 手机上唯一拿得到的通道，与 web 上的点击是同一条代码路径。 */
function tapTrigger(el: ParentNode): ParentNode {
  act(() => {
    node(el, TRIGGER).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return el;
}

const FIRST_DETAIL = SHARE_LABELS.details[0] ?? '';

/** 先按开，再交回这棵树（披露面的底色只在展开态存在）。 */
function openDetails(el: ParentNode): ParentNode {
  tapTrigger(el);
  return el;
}

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

  it('展开后的条款是一块凹陷披露面（底色 = 暗色 surface-sunken，且与亮色不同）', () => {
    const sunken = tokenValue(DARK, 'color.surface-sunken');
    expect(sunken).not.toBe(tokenValue(LIGHT, 'color.surface-sunken'));
    expect(declared(openDetails(render()), '[data-testid="share-consent-details"]', 'background-color')).toBe(sunken);
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

describe('标题、正文与那颗按钮按语境分叉（负责人令①「直接说『分享清单』『加入清单』」）', () => {
  it('🔴 分享侧那棵树写「分享清单」，并且**读不到**「加入清单」——两颗键接反就红', () => {
    const body = render().textContent ?? '';
    expect(body).toContain(LABELS.share.title);
    expect(body, '分享侧同意面写出了加入侧的标题 = 语境键接反').not.toContain(LABELS.join.title);
    expect(body).toContain(LABELS.share.body);
    expect(body, '分享侧同意面写出了加入侧那句正文 = 语境键接反').not.toContain(LABELS.join.body);
    expect(body).toContain(LABELS.share.accept);
    expect(body, '分享侧按钮写成加入那句').not.toContain(LABELS.join.accept);
  });

  it('🔴 加入侧反过来：写「加入清单」，读不到「分享清单」，按钮也不是「确认共享」', () => {
    const body = render({ labels: { ...SHARE_LABELS, ...LABELS.join } }).textContent ?? '';
    expect(body).toContain(LABELS.join.title);
    expect(body, '加入侧同意面写出了分享侧的标题 = 语境键接反').not.toContain(LABELS.share.title);
    expect(body).toContain(LABELS.join.body);
    expect(body, '加入侧同意面写出了分享侧那句正文 = 语境键接反').not.toContain(LABELS.share.body);
    expect(body).toContain(LABELS.join.accept);
    expect(body, '入群的人在替用户说"我确认共享"——那是他没做的事').not.toContain(LABELS.share.accept);
  });

  it('宿主已经写着同一句时（web 对话框的 `<h2>`）置 `titleHidden` ⇒ 这句不再出现，但短话与确认按钮仍在', () => {
    const body = render({ titleHidden: true }).textContent ?? '';
    expect(body, '同屏不许出现两个同名标题').not.toContain(LABELS.share.title);
    expect(body).toContain(LABELS.share.body);
    expect(body).toContain(SHARE_LABELS.accept);
  });
});

/**
 * 🔴 **三发各钉一件事，不许并成"有 tooltip"一句**。
 *
 * 为什么这里**没有**悬停那一发：§9.38 原本写"网页＝悬停 ⓘ 气泡"，两种形状都在真浏览器
 * 里量过坏法（行内展开 ⇒ 居中的对话框被撑高 ⇒ ⓘ 跳出指针 ⇒ 开了收收了开地振荡，旅程里
 * 点「确认共享」`waiting for … stable` 333 次；浮层 ⇒ 压在按钮上又被对话框的
 * `overflowY:'auto'` 裁掉）。现在的形状是"只有按压，且那一叠排在动作区下面"，
 * 于是三发各挡一种坏法：摘掉 `onPress`／把那一叠挪回按钮上面／把卸载当成收起。
 * 合取的坑记在 `#598` 那一族。
 *
 * 展开是**行内展开**，不是自绘浮层：关闭策略表不覆盖 tooltip 一类，而行内展开也不给
 * `check:overlay` R2 添新债。
 */
describe('提示层的开合：按压、键盘、位置、收起态', () => {
  it('🔴 触屏：点一下 ⓘ 展开、再点一下收回（摘掉 `onPress` 这一发会红）', () => {
    const el = render();
    expect(laidOut(el, PANEL), '条款又变成常驻了').toBe(false);
    tapTrigger(el);
    expect(laidOut(el, PANEL)).toBe(true);
    expect(node(el, TRIGGER).getAttribute('aria-expanded')).toBe('true');
    tapTrigger(el);
    expect(laidOut(el, PANEL), '点了两下还开着 = 按压态没有跟着切换').toBe(false);
  });

  it('🔴 ⓘ 是一枚真按钮：有 `role="button"`、可聚焦（读屏与键盘激活走的都是它的 `onPress`）', () => {
    const trigger = node(render(), TRIGGER);
    expect(trigger.getAttribute('role'), 'ⓘ 不是按钮 = 读屏里它根本不是一个可操作的东西').toBe('button');
    expect(trigger.getAttribute('tabindex'), 'ⓘ 不可聚焦 = 键盘根本到不了它').not.toBeNull();
    // ⚠️ 这一发刻意**不**去模拟"Enter 键把它打开"：RNW 的键盘激活要过它自己的 responder
    //    系统（`PressResponder` 的 keydown 只 `start()`，完成在挂在 document 上的 keyup，
    //    且要求 `_responderElement === event.target`），jsdom 里两发都发了仍然不落地——
    //    那是探针打不通，不是产品坏。开合本身由上面那发（`onPress`）钉住，两壳同一条路。
  });

  it('🔴 两枚 web 宿主各自接对自己那一侧的语境键（接反＝分享的面写着「加入」，反之亦然）', () => {
    // 上面几枚判的是组件拿到什么 labels；这一枚判的是**宿主**接没接对——
    // 宿主接反时 labels 仍然是自洽的一套，组件那几枚一条都不会红。
    const read = (rel: string): string =>
      readFileSync(join(process.cwd(), '..', '..', rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
    const owner = read('apps/web/src/features/share/ShareFeature.tsx');
    const joiner = read('apps/web/src/features/share/JoinSharedListDialog.tsx');
    expect(owner).toContain("consent.title.share'");
    expect(owner, 'owner 侧接到加入键 = 分享的面写着「加入清单」').not.toContain("consent.title.join'");
    expect(owner).toContain("consent.accept.share'");
    expect(joiner).toContain("consent.title.join'");
    expect(joiner, '入群侧接到分享键 = 加入的面写着「分享清单」').not.toContain("consent.title.share'");
    expect(joiner).toContain("consent.accept.join'");
    expect(joiner, '入群侧的确认按钮写成 owner 语').not.toContain("consent.accept.share'");
  });

  it('🔴 展开的那一叠排在两颗按钮**下面**：它长出来时不许有任何控件被推走', () => {
    // 这条钉的是"位置"，不是"有没有展开"。把它挪到按钮上面，两发实测过的坏法都会回来：
    // 行内展开 ⇒ 按钮在指针底下跳（旅程第 2 跑点空）；改浮层 ⇒ 压在按钮上并溢出对话框
    // （`02b-owner-consent-details.png` 第 1 版）。判据 = 动作区在这块的**前面**。
    const el = openDetails(render());
    const panel = node(el, PANEL);
    const accept = node(el, '[data-testid="share-consent-accept"]');
    // `DOCUMENT_POSITION_FOLLOWING` ⇒ panel 排在 accept **之后**。
    expect(accept.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('🔴 收起态下条款内容仍在树里（判据与读屏都不必先"打开"才读得到）', () => {
    const el = render();
    expect(laidOut(el, PANEL)).toBe(false);
    expect(el.textContent ?? '', '条款被卸载了：读屏用户在没有 hover 的设备上一条都读不到')
      .toContain(FIRST_DETAIL);
  });
});
