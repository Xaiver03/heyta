/**
 * 设置页「提醒送达」：三把系统闸门的**读数→措辞→落点**
 * =====================================================
 *
 * 本仓库没有组件级渲染测试（先例见 `tests/managed-tier-copy.spec.ts` 文件头），
 * 所以判定抽成了 `src/lib/reminder-delivery-display.ts` 里的纯函数，这里逐条钉它。
 *
 * 钉的是四类"写错不会报错、只会画错给用户看"的东西：
 *
 *   1. 🔴 **`'unsupported'` 必须整行消失**，不能被渲染成"未允许"。
 *      Android 12 以下没有精确闹钟这道门，省电豁免在 iOS 上根本不存在；
 *      把"这台设备没这个东西"说成"你没给它"，用户会去找一个不存在的开关。
 *   2. 🔴 **`'default'`（系统还没问过你）不许说成"未允许"** —— 那是替用户
 *      做一个他没做过的决定。
 *   3. 🔴 **省电那一格说"豁免/受限制"，不说"允许/不允许"** —— 系统里那个
 *      开关的名字不是"允许 heyta"。
 *   4. 🔴 **`'appSettings'` 落点必须有自己的句子**：那台 ROM 没有电池优化页，
 *      原生退到了应用信息页。说成"已向你要过授权"是对外的假话
 *      （《认定方法》把"提前索要/一揽子同意"单列违规形态）。
 *
 * 另加两条跨文件的对账：设置页的措辞与**权限清单**那句对外承诺必须用同一个
 * 名字指同一个开关；而**挂载路径只读状态、不索取任何权限**。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { translate } from '@heyta/i18n';
import type { Reminder } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

import {
  deliveryRows,
  landingCopy,
  reminderFaceNotice,
  type DeliveryReadings,
} from '../src/lib/reminder-delivery-display';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, rel), 'utf8');

const allGranted: DeliveryReadings = {
  notification: 'granted',
  settingsPage: 'granted',
  exactAlarm: 'granted',
  battery: 'granted',
};

const ids = (readings: DeliveryReadings, os: string): string[] => deliveryRows(readings, os).map((r) => r.id);

describe('三把闸门各自独立成行，且各自的"不适用"要整行消失', () => {
  it('Android 上三道门都读得到 ⇒ 三行都在，顺序是通知 / 精确闹钟 / 省电', () => {
    expect(ids(allGranted, 'android')).toEqual(['notification', 'exactAlarm', 'battery']);
  });

  it('🔴 iOS 上没有精确闹钟与省电豁免这两道门 ⇒ 只剩通知那一行', () => {
    // iOS 侧 `exactAlarmStatus()` 按"不构成阻碍"返回 'granted'，
    // 但那不等于"这台设备上有这个开关可以给"—— 界面上不许出现一行 iOS 用户点不动的东西。
    expect(ids(allGranted, 'ios')).toEqual(['notification']);
  });

  it("🔴 'unsupported' 那一档整行不渲染，而不是渲染成「未允许」", () => {
    const rows = deliveryRows({ ...allGranted, exactAlarm: 'unsupported', battery: 'unsupported' }, 'android');
    expect(rows.map((r) => r.id)).toEqual(['notification']);
    expect(rows.some((r) => r.valueKey === 'reminder.settings.notAllowed')).toBe(false);
    expect(rows.some((r) => r.valueKey === 'reminder.settings.optimized')).toBe(false);
  });

  it('这台 Android 压根没有通知设置页（API 26 以下）⇒ 只撤掉通知那一行，另外两道门照说', () => {
    // `settingsPage` 只管"有没有一个页面可以让用户去改"这一件事；
    // 精确闹钟与省电豁免各有自己的落点探测，不许被它连带藏掉。
    expect(ids({ ...allGranted, settingsPage: 'unsupported' }, 'android')).toEqual(['exactAlarm', 'battery']);
  });
});

describe('读数→措辞：不许替用户做他没做过的决定', () => {
  it('🔴 系统还没问过（`default`）说"还没问过你"，不说"未允许"', () => {
    const row = deliveryRows({ ...allGranted, notification: 'default' }, 'android')
      .find((r) => r.id === 'notification')!;
    expect(row.valueKey).toBe('reminder.settings.notAsked');
    expect(row.valueKey).not.toBe('reminder.settings.notAllowed');
    expect(row.warning).toBe(true);
  });

  it('🔴 省电那一格说"豁免/受省电限制"，与"允许/不允许"是两套词', () => {
    const exempted = deliveryRows(allGranted, 'android').find((r) => r.id === 'battery')!;
    const limited = deliveryRows({ ...allGranted, battery: 'denied' }, 'android').find((r) => r.id === 'battery')!;
    expect(exempted.valueKey).toBe('reminder.settings.exempted');
    expect(limited.valueKey).toBe('reminder.settings.optimized');
    expect(exempted.warning).toBe(false);
    expect(limited.warning).toBe(true);
  });

  it('被挡住的那一格必须是警示色 —— 它的意思是"提醒可能不响"', () => {
    const blocked = deliveryRows({ ...allGranted, notification: 'denied', exactAlarm: 'denied', battery: 'denied' }, 'android');
    expect(blocked.map((r) => r.warning)).toEqual([true, true, true]);
  });
});

describe('那一跳落到哪儿，就说什么话', () => {
  it('🔴 电池豁免页被这台 ROM 摘掉、退到应用信息页时，不许说成"已向你申请"', () => {
    const copy = landingCopy('battery', 'appSettings');
    expect(copy?.key).toBe('reminder.settings.batteryLanding');
    expect(copy?.key).not.toBe('reminder.settings.batteryFailed');
    // 这不是失败：页面开起来了，只是不是那一页。不该用 alert 打断读屏。
    expect(copy?.alert).toBe(false);
  });

  it('豁免页真的拉起 ⇒ 不说话（说了就是抢用户的话）', () => {
    expect(landingCopy('battery', 'requested')).toBeNull();
  });

  it('两个页面都拉不起来 ⇒ 如实说没打开，并且是 alert', () => {
    expect(landingCopy('battery', 'unavailable')).toEqual({ key: 'reminder.settings.batteryFailed', alert: true });
  });

  it('通知 / 精确闹钟那两行只分"开起来没有"', () => {
    expect(landingCopy('notification', false)?.key).toBe('reminder.settings.notificationFailed');
    expect(landingCopy('exactAlarm', false)?.key).toBe('reminder.settings.exactAlarmFailed');
    expect(landingCopy('notification', true)).toBeNull();
    expect(landingCopy('exactAlarm', true)).toBeNull();
  });
});

describe('词条本身：中英都在，且不许互相顶替', () => {
  const keys = [
    'reminder.settings.section',
    'reminder.settings.notification',
    'reminder.settings.exactAlarm',
    'reminder.settings.battery',
    'reminder.settings.allowed',
    'reminder.settings.notAllowed',
    'reminder.settings.notAsked',
    'reminder.settings.exempted',
    'reminder.settings.optimized',
    'reminder.settings.note',
    'reminder.settings.batteryLanding',
    'reminder.settings.batteryFailed',
    'reminder.settings.exactAlarmFailed',
    'reminder.settings.notificationFailed',
  ] as const;

  it('每个词条中英两表都有，且不是空串', () => {
    for (const key of keys) {
      for (const locale of ['zh-CN', 'en'] as const) {
        const text = translate(locale, key);
        expect(text, `${locale}/${key}`).toBeTypeOf('string');
        expect(text.length, `${locale}/${key}`).toBeGreaterThan(0);
        // `translate()` 认不出 key 时原样返回 key —— 那也算"非空字符串"，所以要单独排掉。
        expect(text, `${locale}/${key} 缺失`).not.toBe(key);
      }
    }
  });

  it('🔴 "还没问过你" / "未允许" / "已允许" 是三句不同的话', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      const values = new Set([
        translate(locale, 'reminder.settings.allowed'),
        translate(locale, 'reminder.settings.notAllowed'),
        translate(locale, 'reminder.settings.notAsked'),
      ]);
      expect(values.size).toBe(3);
    }
  });

  it('🔴 省电那一格的两面与"允许/不允许"不撞词', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      expect(translate(locale, 'reminder.settings.exempted')).not.toBe(translate(locale, 'reminder.settings.allowed'));
      expect(translate(locale, 'reminder.settings.optimized')).not.toBe(translate(locale, 'reminder.settings.notAllowed'));
    }
  });
});

describe('提醒面那一行降级状态（拒绝授权要看得见，且给得出回头路）', () => {
  const NOW = 1_700_000_000_000;
  const HOUR = 3_600_000;
  /** 一条"排在将来、还没响"的提醒 —— 那一行说的就是它。 */
  const pending = (id: string): Reminder => ({
    id,
    taskId: 'task-1',
    triggerAt: NOW + HOUR,
    createdAt: NOW,
    updatedAt: NOW,
  });
  const open = [pending('r-1')];
  const androidAll = { ...allGranted };

  it('🔴 通知被拒 ⇒ 说"到点不会响"，并且那一跳落在通知那一行', () => {
    const notice = reminderFaceNotice({ ...androidAll, notification: 'denied' }, 'android', open, NOW);
    expect(notice?.key).toBe('reminder.delivery.blockedNotification');
    expect(notice?.row).toBe('notification');
  });

  it('🔴 通知已给、只有精确闹钟被拒 ⇒ 说"可能迟到几分钟"，不是"不会响"', () => {
    const notice = reminderFaceNotice({ ...androidAll, exactAlarm: 'denied' }, 'android', open, NOW);
    expect(notice?.key).toBe('reminder.delivery.blockedExactAlarm');
    expect(notice?.row).toBe('exactAlarm');
  });

  it('🔴 两道门都被拒 ⇒ 只说更重的那一句（不会响 > 会迟到）', () => {
    const notice = reminderFaceNotice(
      { ...androidAll, notification: 'denied', exactAlarm: 'denied' },
      'android',
      open,
      NOW,
    );
    expect(notice?.key).toBe('reminder.delivery.blockedNotification');
  });

  it('🔴 系统还没问过（default）⇒ 一句都不说：那刻弹窗正挂在屏幕上', () => {
    expect(reminderFaceNotice({ ...androidAll, notification: 'default' }, 'android', open, NOW)).toBeNull();
  });

  it('🔴 iOS 上精确闹钟读成 denied 也不许出现那一行 —— 那台设备根本没有这个开关', () => {
    // `deliveryRows` 在 iOS 上不渲染精确闹钟那一行；这一行整行消失，不是"未允许"。
    expect(reminderFaceNotice(
      { ...androidAll, notification: 'granted', exactAlarm: 'denied' },
      'ios',
      open,
      NOW,
    )).toBeNull();
  });

  it('🔴 系统里没有"本应用的通知设置"这一页 ⇒ 那句照说，但不画一个点了没反应的入口', () => {
    const notice = reminderFaceNotice(
      { ...androidAll, notification: 'denied', settingsPage: 'unsupported' },
      'android',
      open,
      NOW,
    );
    // 不说 = 让用户以为会响；画了入口点了没反应 = 更糟。两个错各归各的答案。
    expect(notice?.key).toBe('reminder.delivery.blockedNotification');
    expect(notice?.canOpen).toBe(false);
  });

  it('🔴 授权还在、通知总开关被关掉（Android 那一档）⇒ 同样一句都不会响，必须说', () => {
    const notice = reminderFaceNotice(
      { ...androidAll, notification: 'granted', settingsPage: 'denied' },
      'android',
      open,
      NOW,
    );
    expect(notice?.key).toBe('reminder.delivery.blockedNotification');
  });

  it('通知那一行照常存在时，那一跳是给得出的（Android 通知设置页 / iOS app-settings:）', () => {
    expect(reminderFaceNotice({ ...androidAll, notification: 'denied' }, 'android', open, NOW)?.canOpen).toBe(true);
    expect(reminderFaceNotice({ ...androidAll, notification: 'denied' }, 'ios', open, NOW)?.canOpen).toBe(true);
  });

  it('🔴 三道门都放行 ⇒ 不说任何一句（无阻碍时报警是噪音）', () => {
    expect(reminderFaceNotice(androidAll, 'android', open, NOW)).toBeNull();
    expect(reminderFaceNotice(androidAll, 'ios', open, NOW)).toBeNull();
  });

  it('🔴 一条待投递的提醒都没有 ⇒ 不许报警（包括只剩已投递/已关闭的那种）', () => {
    expect(reminderFaceNotice({ ...androidAll, notification: 'denied' }, 'android', [], NOW)).toBeNull();
    const fired: Reminder = { ...pending('r-fired'), firedAt: NOW - 1 };
    const dismissed: Reminder = { ...pending('r-dismissed'), dismissedAt: NOW - 1 };
    expect(reminderFaceNotice({ ...androidAll, notification: 'denied' }, 'android', [fired, dismissed], NOW)).toBeNull();
  });

  it('那句降级话的主语是整个提醒面，不是"这一条"（一行只渲染一次）', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      expect(translate(locale, 'reminder.delivery.blockedNotification')).not.toMatch(/这条提醒|这一条|this reminder/);
      expect(translate(locale, 'reminder.delivery.blockedExactAlarm')).not.toMatch(/这条提醒|这一条|this reminder/);
    }
  });

  it('🔴 "到点不会响"与"可能迟到几分钟"是两句不同的话，不许互相顶替', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      expect(translate(locale, 'reminder.delivery.blockedNotification'))
        .not.toBe(translate(locale, 'reminder.delivery.blockedExactAlarm'));
    }
  });

  it('中英两表的三个 key 都在，且不是把 key 原样回出来', () => {
    for (const key of [
      'reminder.delivery.blockedNotification',
      'reminder.delivery.blockedExactAlarm',
      'reminder.delivery.openSettings',
    ] as const) {
      for (const locale of ['zh-CN', 'en'] as const) {
        const text = translate(locale, key);
        expect(text.length, `${locale}/${key}`).toBeGreaterThan(0);
        expect(text, `${locale}/${key} 缺失`).not.toBe(key);
      }
    }
  });
});

describe('降级那一行与跳系统设置入口真的挂上了（漏一半不会报类型错）', () => {
  const sharedSrc = read('../../../packages/ui/src/reminders/ReminderList.tsx');
  const sheetSrc = read('../src/screens/TaskDetailSheet.tsx');

  it('共享组件画出那句说明与那一跳的按钮（两处 testID 是给设备取证用的锚点）', () => {
    expect(sharedSrc).toContain('testID="reminder-delivery-blocked"');
    expect(sharedSrc).toContain('testID="reminder-delivery-open-settings"');
    expect(sharedSrc).toContain('{deliveryBlocked.text}');
    // 🔴 钉的是**这一支的守卫本身**，不是"文件里出现过 onPress"：
    // 只查 `deliveryBlocked.settings.onPress` 的话，把守卫改成 `{false ? null : (…)}`
    // （= 入口永远不画）这句判据照样绿 —— 实测过，它抓不住"只说不给回头路"。
    expect(sharedSrc).toContain('{deliveryBlocked.settings === undefined ? null : (');
    expect(sharedSrc).toContain('onPress={deliveryBlocked.settings.onPress}');
    // 那句说明挂在**有提醒的那一支**里：空列表上方报警是没有证据的告警。
    const noticeAt = sharedSrc.indexOf('testID="reminder-delivery-blocked"');
    const emptyAt = sharedSrc.indexOf('{rows.length === 0 ? (');
    const addRowAt = sharedSrc.indexOf('testID="reminder-add-row"');
    expect(emptyAt).toBeLessThan(noticeAt);
    expect(noticeAt).toBeLessThan(addRowAt);
  });

  it('🔴 详情面板把判定结果接上了：少接一处只是界面少一行，编译不会告诉你', () => {
    expect(sheetSrc).toContain('reminderFaceNotice(');
    expect(sheetSrc).toContain('deliveryBlocked={');
    expect(sheetSrc).toContain("t('reminder.delivery.openSettings')");
    expect(sheetSrc).toContain('delivery.open(deliveryNotice.row)');
  });
});

describe('外壳接线与对外承诺对账', () => {
  const sectionSrc = read('../src/screens/ReminderDeliverySection.tsx');
  const hookSrc = read('../src/lib/use-reminder-delivery.ts');
  const settingsSrc = read('../src/screens/SettingsScreen.tsx');
  const permissionsSrc = read('../../../packages/legal/src/documents/permissions.ts');

  it('设置页里真的挂着这一节（挂在详情面板里不算：拒完之后再回去找入口是第二条路）', () => {
    expect(settingsSrc).toContain('<ReminderDeliverySection />');
  });

  it('🔴 重读时机只有一份 —— 设置节与提醒面共用同一个 hook，不许各挂一个监听', () => {
    expect(sectionSrc).toContain('useReminderDelivery()');
    expect(sectionSrc).not.toMatch(/AppState\.addEventListener/);
    // 提醒面那一行用的是同一个 hook（否则两处读数会漂，见 hook 文件头）。
    expect(read('../src/screens/TaskDetailSheet.tsx')).toContain('useReminderDelivery()');
  });

  it('🔴 挂载路径只读状态：三个"跳系统页"的动作不许出现在首屏读取里', () => {
    expect(hookSrc).toMatch(/readGates/);
    expect(hookSrc).toMatch(/useEffect\(\s*\(\)\s*=>\s*\{\s*readGates\(\)/);
    // `openActions` 那张表只在 `open()` 里被点出来，`useEffect` 里一次都不许出现。
    const effect = hookSrc.slice(hookSrc.indexOf('useEffect('), hookSrc.indexOf('const open'));
    expect(effect).not.toContain('openActions');
    expect(effect).not.toContain('requestExactAlarmPermission');
    expect(effect).not.toContain('openBatteryOptimizationSettings');
    expect(effect).not.toContain('openNotificationSettings');
  });

  it('🔴 回到前台必须重读 —— 用户在系统里拨完开关回来，这一格不能还是旧读数', () => {
    expect(hookSrc).toMatch(/AppState\.addEventListener\('change'/);
    expect(hookSrc).toMatch(/next === 'active'/);
  });

  it('🔴 答完系统授权弹窗也要重读 —— 那个弹窗不把应用退到后台，AppState 等不来', () => {
    expect(hookSrc).toContain('subscribeReminderDelivery(readGates)');
  });

  it('对外承诺引的那个开关名，与设置页里那一行的名字必须是同一个', () => {
    const zhBatteryLabel = translate('zh-CN', 'reminder.settings.battery');
    expect(permissionsSrc).toContain(zhBatteryLabel);
    expect(permissionsSrc).toContain('REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');
    expect(permissionsSrc).toContain('RECEIVE_BOOT_COMPLETED');
  });
});
