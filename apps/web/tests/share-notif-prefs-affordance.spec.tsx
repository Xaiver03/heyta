/**
 * 通知偏好面的开关**看得出来是开关**（2026-10-25 补的一格）
 * =========================================================
 *
 * ## 这一格是怎么发现的
 *
 * `pnpm verify:mobile-collab:ios` 第 6 步那张 `06c-共享清单首页.png`：「共享通知」那一格里，
 * 三行活动（完成/新增/删除）在屏幕上是**三段裸文字** —— 没有方框、没有对钩、看不出当前是开还是关。
 * 而运行时一切正常：行是真 `Pressable`、`aria-checked` 在、点了确实翻转并落盘。
 * 所以既有判据一条都不会红：
 *   · 装置那侧判的是**文字在不在**（`活动通知`）与"没有输入的开关不许再摆着"；
 *   · `packages/ui` 的纪律是只测模型层，这一层没有一棵渲染树。
 *
 * 这正是 `ShareConsentModal` 2026-10-11 那次事故的同形物（那个文件头写着"控件都能用能读，
 * 但整个模态零条样式"）—— 差别只在于同意面后来补了样式，而这份面板的**状态标记从来没有过**。
 * 摆一枚点得动却看不出状态的开关，与摆一枚谎称有能力的开关，对用户是同一件事。
 *
 * ## 判什么
 *
 * | 判据 | 坏法 |
 * |---|---|
 * | 未选中的行右端有**描边空框**、且没有实心底 | 把标记整块删回去（＝截图里那一版） |
 * | 选中的行是**实心主蓝 + 对钩**（暗色读到的是暗色表里那枚主蓝） | 硬编码一枚亮色十六进制 / 只用颜色区分 |
 * | 点一行 ⇒ 宿主只收到"那一档翻转"的偏好 | 三档一起翻（`toggleActivity` 拼错键名） |
 * | `aria-checked` 与 `prefs` 同源（读屏拿到的与眼睛拿到的是同一个状态） | 只画不给无障碍状态 |
 *
 * 两档主题各跑一遍同一棵树，挡"只在某档里对"。读的是**注入表里的声明本身**而不是
 * `getComputedStyle`（为什么：`./helpers/rnw-styles.ts` 文件头）。
 */

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { translate, type MessageKey } from '@heyta/i18n';
import {
  DEFAULT_NOTIFICATION_PREFS,
  HeytaUiProvider,
  NotificationPrefsPanel,
  resolveHeytaUiTheme,
  type NotificationPrefsLabels,
  type ShareActivityKind,
  type ShareNotificationPrefs,
} from '@heyta/ui';

import { declared, norm } from './helpers/rnw-styles.js';

const LABELS: NotificationPrefsLabels = {
  sectionTitle: translate('zh-CN', 'common.share.notif.sectionTitle' as MessageKey),
  activitiesTitle: translate('zh-CN', 'common.share.notif.activitiesTitle' as MessageKey),
  activityCompleted: translate('zh-CN', 'common.share.notif.activityCompleted' as MessageKey),
  activityAdded: translate('zh-CN', 'common.share.notif.activityAdded' as MessageKey),
  activityDeleted: translate('zh-CN', 'common.share.notif.activityDeleted' as MessageKey),
};

const KINDS: ReadonlyArray<ShareActivityKind> = ['completed', 'added', 'deleted'];

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
/** 宿主最后一次收到的偏好（受控渲染的输入，也是"只翻转那一档"的读数）。 */
let lastChange: ShareNotificationPrefs | undefined;

/** 真宿主形状：`prefs` 进、`onChange` 出，落盘之后把新值传回来。 */
function PrefsHost({ initial, theme }: { initial: ShareNotificationPrefs; theme: typeof DARK }): React.JSX.Element {
  const [prefs, setPrefs] = useState(initial);
  return (
    <HeytaUiProvider value={theme}>
      <NotificationPrefsPanel
        prefs={prefs}
        labels={LABELS}
        onChange={(next) => {
          lastChange = next;
          setPrefs(next);
        }}
      />
    </HeytaUiProvider>
  );
}

const render = (theme: typeof DARK, initial = DEFAULT_NOTIFICATION_PREFS): HTMLElement => {
  act(() => { root?.unmount(); });
  root = undefined;
  container?.remove();
  container = document.createElement('div');
  document.body.append(container);
  lastChange = undefined;
  act(() => {
    root = createRoot(container!);
    root.render(<PrefsHost initial={initial} theme={theme} />);
  });
  return container as HTMLDivElement;
};

const pressRow = (el: ParentNode, kind: ShareActivityKind): void => {
  const node = el.querySelector<HTMLElement>(`[data-testid="share-notif-activity-${kind}"]`);
  if (node === null) throw new Error(`DOM 里没有第 ${kind} 行`);
  act(() => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const allOn = (): ShareNotificationPrefs => ({
  activities: { onCompleted: true, onAdded: true, onDeleted: true },
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = undefined;
  container?.remove();
  container = undefined;
});

const THEMES = [
  { name: '暗色', theme: DARK },
  { name: '亮色', theme: LIGHT },
] as const;

describe.each(THEMES)('$name档：三行都是看得见的开关', ({ theme }) => {
  it('🔴 未选中：右端有描边空框，且没有实心底（把标记整块删回去 —— 截图里那一版 —— 这条会红）', () => {
    const el = render(theme);
    for (const kind of KINDS) {
      const marker = `[data-testid="share-notif-activity-${kind}-marker"]`;
      expect(declared(el, marker, 'border-top-color'), `${kind} 行的标记没有描边`).toBe(tokenValue(theme, 'color.border'));
      expect(declared(el, marker, 'background-color'), `${kind} 行未选中却有实心底`).toBe('<none>');
    }
  });

  it('🔴 选中：实心主蓝（读的是这一档表里那枚主蓝，不是硬编码）', () => {
    // 前提：两档主蓝确实不同，否则这条退化成"随便一枚蓝"。
    expect(tokenValue(DARK, 'color.primary')).not.toBe(tokenValue(LIGHT, 'color.primary'));
    const el = render(theme, allOn());
    for (const kind of KINDS) {
      expect(declared(el, `[data-testid="share-notif-activity-${kind}-marker"]`, 'background-color'))
        .toBe(tokenValue(theme, 'color.primary'));
    }
  });

  it('状态不只靠颜色：`aria-checked` 与画面同步（读屏与眼睛拿到同一个状态）', () => {
    const off = render(theme);
    expect(off.querySelector('[data-testid="share-notif-activity-added"]')?.getAttribute('aria-checked')).toBe('false');
    const on = render(theme, allOn());
    expect(on.querySelector('[data-testid="share-notif-activity-added"]')?.getAttribute('aria-checked')).toBe('true');
  });
});

describe('点一行只翻那一行', () => {
  it('🔴 交回宿主的偏好里只有被点那一档变了，画面上那一行也跟着变实心', () => {
    const el = render(DARK);
    pressRow(el, 'added');
    expect(lastChange).toEqual({ activities: { onCompleted: false, onAdded: true, onDeleted: false } });
    expect(declared(el, '[data-testid="share-notif-activity-added-marker"]', 'background-color'))
      .toBe(tokenValue(DARK, 'color.primary'));
    pressRow(el, 'added');
    expect(lastChange).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });
});
