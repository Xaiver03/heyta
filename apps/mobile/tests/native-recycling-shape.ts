/**
 * ⑩ 那组判据共用的**原生回收形状**读法
 * =====================================
 *
 * 存在的理由（环境陷阱 #598）：「系统横幅在手机上做不到」那句理由此前**没有任何门读过
 * 那两枚原生件**，所以我把只属于 iOS 的机制写成了"两端同一机制"，六格载体一起错了几天。
 * 判据要能红，就得把"读法"收口成一处、并能被病灶喂到（`mutation-rigs` 那套纪律）。
 *
 * 🔴 **这两枚原生件不许原地注病灶**：它们是 Swift/Kotlin，任何 JS 门都不读它们，
 * 但同一台机器上一旦有别的会话在编 Xcode/Gradle，注入的病灶会被**编译进产物**，
 * 拿到的设备读数就是假的。所以这一族的"能不能红"靠**内存里的副本施变**（见
 * `share-ui-assembly.spec.ts` 的对照臂）：拿真文件的原文，改一笔，再喂回同一组读法。
 */

import { read } from './source-reading';

export const IOS_MODULE = 'apps/mobile/ios/Heyta/HeytaReminderModule.swift';
export const ANDROID_MODULE =
  'apps/mobile/android/app/src/main/java/com/heytamobile/reminder/ReminderModule.kt';

/**
 * 取一枚原生函数/方法的**函数体**（Swift/Kotlin 都按花括号配平）。
 * 找不到签名或配不平均回空串 —— 那是设计好的失败形状：读它的那条 `length > 0` 会红，
 * 逼着下一位按新形状重读判据，而不是默默绿。
 */
export function nativeBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) return '';
  const open = src.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return '';
}

/** iOS：`cancelStale` 里有几处按那枚 category 认领。**当前读数 2**（pending 与 delivered 各一处）。 */
export const iosCategoryClaims = (body: string): number =>
  (body.match(/content\.categoryIdentifier == HeytaReminderReceipts\.category/g) ?? []).length;

/** iOS：回收会不会摘掉**已投递**的通知（那句"借道会被当场抹掉"的落点）。 */
export const iosRemovesDelivered = (body: string): boolean =>
  body.includes('removeDeliveredNotifications');

/** 安卓：`cancelStale` 读的是哪几本台账（去掉 `KEY_` 前缀、排序去重）。 */
export const androidLedgers = (body: string): string[] =>
  [...new Set((body.match(/KEY_[A-Z_]+/g) ?? []).map((m) => m.replace(/^KEY_/, '')))].sort();

/** 安卓：它是不是用"台账减 keep"那把尺摘通知（它与 iOS 不同形的正面证据）。 */
export const androidCancelsByLedgerDiff = (body: string): boolean =>
  /cancelLocked\(\s*context,\s*all\s*-\s*keep\s*\)/.test(body);

/** 安卓：函数体里有没有长出"按通道认领"的形状（一旦为真，那句"两端不同形"就作废）。 */
export const androidClaimsByChannel = (body: string): boolean =>
  /getNotificationChannel|\.channel\b|CHANNEL/.test(body);
