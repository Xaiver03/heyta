/**
 * 「系统闸门现在是什么读数」这一份状态的唯一持有者（平台绑定层）。
 *
 * 🔴 为什么抽出来：同一份读数有两个消费者 —— 设置页那一节摊开三道闸门各自的状态，
 * 任务详情的提醒面只说当前最要紧的那一句。两边各写一遍"什么时候重读"迟早会漂成
 * "设置页已经翻新、提醒面还挂着旧的那句"。重读时机因此只在这里存在一份。
 *
 * ⚠️ 判定（哪一行该出现、那一格说什么词、那一跳落到哪儿该怎么说）**不在这个文件里**，
 * 全在 `reminder-delivery-display.ts` 的纯函数中（那里可断言）。这里只做三件事：
 * 读原生、按事件重读、把点击接回原生（AGENTS §3.5）。
 *
 * 三个重读时机，每一个都有它各自的理由：
 * · 挂载 —— 面板打开时得是当下的样子；
 * · 回到前台 —— 用户在系统页面里拨完开关回来，那一行必须是他刚改完的读数；
 * · 投递状态变化 —— 系统授权弹窗**不把应用退到后台**（iOS 上它盖在界面之上），
 *   所以"跨过弹窗那一刻"AppState 根本不会变，只有排程那一侧回答完才会通知。
 *   少了这一条，用户点「允许」后提醒面那句"到点不会响"会一直挂着。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { subscribeReminderDelivery } from './native-reminder-scheduler';
import {
  landingCopy,
  type DeliveryReadings,
  type DeliveryRowId,
} from './reminder-delivery-display';
import {
  batteryOptimizationStatus,
  exactAlarmStatus,
  notificationSettingsStatus,
  openBatteryOptimizationSettings,
  openNotificationSettings,
  requestExactAlarmPermission,
  reminderAuthorizationStatus,
  type BatteryFallback,
} from './reminder-native';

/** 每一行"跳哪儿"是纯外壳知识，判定层不碰它。 */
const openActions: Record<DeliveryRowId, () => Promise<boolean | BatteryFallback>> = {
  notification: openNotificationSettings,
  exactAlarm: requestExactAlarmPermission,
  battery: openBatteryOptimizationSettings,
};

/** 上一次那一跳的落点，连同**是哪一行**：提醒面不该把电池优化那一句显示出来。 */
export interface DeliveryLanding {
  readonly row: DeliveryRowId;
  readonly copy: NonNullable<ReturnType<typeof landingCopy>>;
}

export interface ReminderDeliveryState {
  /** `null` = 还没读完。消费者据此决定"什么都不渲染"，而不是渲染一个假的"未允许"。 */
  readonly readings: DeliveryReadings | null;
  readonly landing: DeliveryLanding | null;
  /** 有一跳正在飞：同一刻连点两次会叠开两个系统页面。 */
  readonly busy: boolean;
  open(row: DeliveryRowId): void;
}

export function useReminderDelivery(): ReminderDeliveryState {
  const [readings, setReadings] = useState<DeliveryReadings | null>(null);
  const [landing, setLanding] = useState<DeliveryLanding | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const readGates = useCallback((): void => {
    void Promise.all([
      reminderAuthorizationStatus(),
      notificationSettingsStatus(),
      exactAlarmStatus(),
      batteryOptimizationStatus(),
    ]).then(([notification, settingsPage, exactAlarm, battery]) => {
      setReadings({ notification, settingsPage, exactAlarm, battery });
    });
  }, []);

  useEffect(() => {
    readGates();
    const onForeground = AppState.addEventListener('change', (next) => {
      if (next === 'active') readGates();
    });
    const onDelivery = subscribeReminderDelivery(readGates);
    return () => {
      onForeground.remove();
      onDelivery();
    };
  }, [readGates]);

  const open = useCallback((row: DeliveryRowId): void => {
    // 闸门用 ref 而不是 `busy` 状态：一次事件循环里的两次点击读到的还是旧值，
    // 而状态更新函数的副作用在 StrictMode 下会被执行两遍（= 叠开两个系统页面）。
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setLanding(null);
    void openActions[row]()
      .then((result) => {
        const copy = landingCopy(row, result);
        if (copy !== null) setLanding({ row, copy });
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
        readGates();
      });
  }, [readGates]);

  return { readings, landing, busy, open };
}
