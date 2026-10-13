/**
 * 小组件桥接层（应用侧）
 * ======================
 *
 * 这一层是 `apps/mobile` 与原生小组件模块之间**唯一**的接触面。它做三件事：
 *
 *   1. 把 `NativeModules.HeytaWidget` 的读取**整条路径**包成防御式的；
 *   2. 给调用方一个**有类型**的接口，而不是到处写 `any`；
 *   3. 在模块缺失时**明确地**降级，而不是让 `undefined is not a function` 在某个
 *      后台路径上炸出来。
 *
 * ## 后台刷新降级，显式清理必须报告失败
 *
 * 这些函数的调用点都在"应用已经在正常工作了"的路径上（写入之后刷新快照、
 * 启动时 drain 意图）。在那里抛异常只会让一个**已经工作的应用**因为小组件而崩 ——
 * 而小组件是**附属功能**，它不该有这种权力。
 *
 * 清理是例外：失败必须传播给登出流程，不能把仍存有快照报告为已清除。
 *
 * 代价是失败会变安静。所以每次失败都 `console.warn` 带上原生侧的**错误码**
 *（`E_WIDGET_INVALID_ENVELOPE` 等，定义在 `WidgetModule.kt`），
 * 让"为什么小组件不更新"至少有一条日志可查。
 *
 * ## 为什么把 [callNativeSafely] 与 [describeWidgetError] 导出
 *
 * 本仓库的移动端测试**刻意不 import `react-native`**（在 node 里加载它直接失败），
 * 所以"原生模块存在"的那条路径在这里根本跑不到。
 * 与其为了测试去 mock `react-native`（那会让测试验的是 mock 而不是代码），
 * 不如把**真正有逻辑的那部分**抽成不依赖原生的纯函数 —— 与
 * `src/sync/auto-sync-core.ts` 被抽出来的理由是同一个。
 */

/** 与 `WidgetModule.kt` 的 `WidgetModule.NAME` **必须一致**。 */
const MODULE_NAME = 'HeytaWidget';

import type { Locale } from '@heyta/i18n';
import { beginWidgetCleanup } from './publish-coordinator';

interface WidgetNativeModule {
  /** 非敏感设备语言，与账号快照分开存储。 */
  setWidgetLocale?(locale: string): Promise<boolean>;
  setWidgetSnapshot(envelopeJson: string): Promise<boolean>;
  drainIntentQueue(): Promise<string | null>;
  ackIntentQueue(processedJson: string): Promise<number>;
  /** 把失败意图**合并**回容器（不是覆盖），返回写回后的队列长度。 */
  mergeIntentQueue(pendingJson: string): Promise<number>;
  clearWidgetState(): Promise<boolean>;
  /**
   * 让**原生**用设备密钥把载荷封成信封，返回信封 JSON。
   *
   * 🔴 密钥**不穿桥**：JS 交明文、拿回密文，全程拿不到密钥字节。
   * 这是"原生生成随机密钥、永不离开 Keystore"这个决定的落地方式 ——
   * 见 `docs/plans/multi-platform-widgets-progress.md` §5 的「W1-4 动手前必读」第 1 条。
   */
  sealWidgetSnapshot(payloadJson: string, dayStr: string, validUntil: number): Promise<string>;
  /**
   * W5-2 · 写"锁屏始终隐藏标题"偏好（写进**与快照分开的**一个文件）。
   *
   * ⚠️ 与 `setWidgetSnapshot` 分开是刻意的：写成同一个文件的话，
   * "发布一份新快照"会把用户的隐私开关**覆盖成默认值** ——
   * 用户打开的开关会在下一次刷新时悄悄关掉。
   */
  setWidgetPrivacy(alwaysHideTitles: boolean): Promise<boolean>;
  /**
   * W5-2 · 读"锁屏始终隐藏标题"偏好。
   *
   * ⚠️ `null` = **这个平台没有这一项**（安卓/鸿蒙上锁屏组件不存在）或模块不可用。
   * 与 `false` 是**两件不同的事**：`false` 是"用户关着"，`null` 是"这里没有这个开关"。
   * 把 `null` 当成 `false` 会让应用在安卓上显示一个**按了没反应的开关** ——
   * 而用户会以为他设上了。
   */
  readWidgetPrivacy(): Promise<boolean | null>;
  /**
   * W5-3 · 读快照 + 判定 + 推进灵动岛（一条龙，见原生侧 `FocusActivityRefresh`）。
   *
   * ⚠️ 返回**字符串**而不是布尔：`'started' | 'updated' | 'ended' | 'noop' | 'none'`。
   * 用一个只有两态的布尔会把"我没能判断"（`none`）和"判断了、不用做"（`noop`）压成同一个值，
   * 而那两种情况的排查方向完全不同。
   */
  syncFocusActivity(): Promise<string>;
}

/**
 * 原生模块在桥接失败时可能是 `undefined`；某些构建里属性访问还会**抛异常**
 *（而不是返回 `undefined`），所以不能只写 `?.` —— 那挡不住"getter 自己抛"。
 * 这与 `src/i18n/locale.ts` 里那段是同一类防御。
 */
function readWidgetModule(): WidgetNativeModule | undefined {
  try {
    const modules = (require('react-native') as { NativeModules?: Record<string, unknown> })
      .NativeModules;
    return (modules?.[MODULE_NAME] ?? undefined) as WidgetNativeModule | undefined;
  } catch {
    // 测试环境（node）没有 react-native —— 走到这里只是"没有原生模块"，不是错误。
    return undefined;
  }
}

/**
 * 把一次原生调用包成**永不抛**。
 *
 * 🔴 顺序很重要：`await call()` 必须在 `try` **里面**。
 * 写成 `try { const p = call() } catch` 只会挡住同步异常，
 * 而原生模块的失败**全部**是 Promise rejection（`promise.reject(...)`），
 * 那样写等于没接住 —— 症状是"应用偶发崩溃在小组件刷新路径上"。
 */
export async function callNativeSafely<T>(
  label: string,
  call: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    console.warn(`[widget] ${label}失败：`, describeWidgetError(error));
    return fallback;
  }
}

/**
 * 把原生侧的错误整理成一行可读文本。
 *
 * 🔴 `code` 是这里**真正重要的东西**：原生模块用契约的拒绝原因做错误码
 *（`E_WIDGET_INVALID_ENVELOPE` + `unknown-version: …`），
 * 丢掉它之后日志里就只剩"写入失败"，而"写入失败"可以有十几种原因。
 */
export function describeWidgetError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' && code !== '' ? `${code}: ${error.message}` : error.message;
  }
  return String(error);
}

/**
 * 原生模块是否可用。
 *
 * ⚠️ 诊断用，**不要**拿它当"要不要写快照"的开关：那会让"忘了在 MainApplication 里
 * 注册 `WidgetPackage`"表现为"小组件永远不更新"而**没有任何一处报错**。
 */
export function isWidgetBridgeAvailable(): boolean {
  return readWidgetModule() !== undefined;
}

/**
 * 模块缺失时**只警告一次**。
 *
 * 🔴 为什么需要它：`MainApplication` 里漏掉 `add(WidgetPackage())` 的症状是
 * "小组件永远不更新" —— 没有异常、没有红、界面上一切正常。这是最难查的一类问题。
 *
 * 为什么只警告一次：iOS 侧在 W2 之前**本来就没有**这个模块，
 * 每次写入都警告会把日志刷满，反而让人学会忽略它。
 */
let warnedAboutMissingModule = false;

function noteMissingModule(): void {
  if (warnedAboutMissingModule) return;
  warnedAboutMissingModule = true;
  console.warn(
    `[widget] 原生模块 ${MODULE_NAME} 不存在 —— 小组件不会更新。` +
      'Android 上通常是忘了在 MainApplication 里 add(WidgetPackage())；' +
      '其它平台则可能只是还没实现。',
  );
}

/** 仅供测试：重置"已警告过"的状态。 */
export function resetMissingModuleWarningForTests(): void {
  warnedAboutMissingModule = false;
}

/** 非敏感设备语言，原生保存成功后重绘全部系统模板。 */
export async function setWidgetLocale(locale: Locale): Promise<boolean> {
  const native = readWidgetModule();
  const write = native?.setWidgetLocale;
  if (write === undefined) return false;
  return callNativeSafely('同步小组件语言', () => write.call(native, locale), false);
}

/**
 * 写入一份**已加密**的快照信封。
 *
 * ⚠️ 本函数**不加密**。加密与设备密钥派生在 W1-4；这里只负责把信封字符串送过桥。
 *
 * 返回 `false` 有三种情况，日志里能区分：模块不存在、信封没过契约校验、写盘失败。
 */
export async function setWidgetSnapshot(envelopeJson: string): Promise<boolean> {
  const native = readWidgetModule();
  if (native === undefined) {
    noteMissingModule();
    return false;
  }
  return callNativeSafely('写入快照', () => native.setWidgetSnapshot(envelopeJson), false);
}

/**
 * 让**原生**把载荷封成信封（用 Keystore 里的设备密钥），返回信封 JSON。
 *
 * 🔴 **密钥不穿桥** —— JS 交明文、拿回密文。这是密钥归属决定的落地方式：
 * JS 侧从一开始就拿不到密钥字节，所以"密钥进 JS 堆 / 进日志 / 进崩溃上报"
 * 这三件事在结构上不可能发生。
 *
 * ⚠️ 返回 `null` 表示模块不可用或原生失败（日志里有具体错误码）。
 * **不要**在这里降级成"用别的密钥在 JS 里自己加密" —— 那会同时废掉
 * "密钥不穿桥"与"本平台只有一份 AES 实现"两条。
 */
export async function sealWidgetSnapshot(
  payloadJson: string,
  dayStr: string,
  validUntil: number,
): Promise<string | null> {
  const native = readWidgetModule();
  if (native === undefined) {
    noteMissingModule();
    return null;
  }
  return callNativeSafely(
    '封包快照',
    () => native.sealWidgetSnapshot(payloadJson, dayStr, validUntil),
    null,
  );
}

/**
 * 读取意图队列的**原始 JSON**，成功处理并 ack 前保留在原生容器。`null` = 没有待处理的点击，或模块不可用。
 *
 * ⚠️ 返回的是**原始字符串**，调用方必须用 `@heyta/widget-core` 的
 * `parseIntentQueueJson`（它收字符串、永不抛）解析 —— 队列语义只有那一份真源。
 * **不要**自己 `JSON.parse` 再 `parseIntentQueue`：后者收的是对象，
 * 直接传字符串会**静默返回空队列**（`isPlainObject` 把它挡掉），
 * 症状是"点了没反应，且没有任何一处报错"。
 */
export async function drainIntentQueue(): Promise<string | null> {
  const native = readWidgetModule();
  if (native === undefined) {
    noteMissingModule();
    return null;
  }
  return callNativeSafely('读取意图队列', () => native.drainIntentQueue(), null);
}

/** Acknowledge only exact processed clicks; newer clicks remain in native storage. */
export async function ackIntentQueue(processedJson: string): Promise<number | null> {
  const native = readWidgetModule();
  if (native === undefined) { noteMissingModule(); return null; }
  return callNativeSafely('确认组件操作', () => native.ackIntentQueue(processedJson), null);
}

/**
 * 把 drain 之后**执行失败**的意图写回共享容器。返回写回后队列的长度。
 *
 * 🔴 原生侧做的是**合并**而不是覆盖 —— `drainIntentQueue` 是"读出来 + 清空"，
 * 写回发生在之后，这两步之间用户完全可能又点一下；整体覆盖会把那个新点击
 * **悄悄抹掉**（症状是点了没反应，且任何日志里都没有痕迹）。
 * 详见 `WidgetIntentQueues.mergeAll` 的注释。
 *
 * ⚠️ 返回 `null` = 模块不可用或原生失败。**不要**在这里退化成"那就丢掉吧" ——
 * 丢了就真的没有下次重试了。
 */
export async function mergeIntentQueue(pendingJson: string): Promise<number | null> {
  const native = readWidgetModule();
  if (native === undefined) {
    noteMissingModule();
    return null;
  }
  return callNativeSafely('写回意图队列', () => native.mergeIntentQueue(pendingJson), null);
}

/**
 * W5-2 · 写"锁屏始终隐藏标题"偏好。**永不抛**（与这个文件里所有函数同一契约）。
 *
 * 返回 `false` = 没写成（模块不可用或原生失败）。⚠️ **不要**在这里退化成"那就当它失败吧"
 * 然后去改 UI —— 偏好文件写不成的后果是"用户以为设了、其实没设"，
 * 所以调用方**必须**把 `false` 显示出来（见 `ProfileScreen` 的开关）
 * 而不是假装成功。这也是它返回 `boolean` 而不是 `void` 的唯一理由。
 */
export async function setWidgetPrivacy(alwaysHideTitles: boolean): Promise<boolean> {
  const native = readWidgetModule();
  if (native === undefined) {
    noteMissingModule();
    return false;
  }
  return callNativeSafely(
    '写锁屏隐私偏好',
    () => native.setWidgetPrivacy(alwaysHideTitles),
    false,
  );
}

/**
 * W5-2 · 读锁屏隐私偏好。
 *
 * 🔴 返回 `null`（而不是 `false`）当这个平台没有这一项时 —— 上层据此
 * **整段不渲染**那个开关。理由见 `WidgetNativeModule.readWidgetPrivacy` 的注释。
 */
export async function readWidgetPrivacy(): Promise<boolean | null> {
  const native = readWidgetModule();
  if (native === undefined) {
    noteMissingModule();
    return null;
  }
  // ⚠️ 原生缺失这个方法时（旧版本原生代码 + 新 JS）会得到 `undefined`，
  //    这里必须把它归一成 `null` —— 否则 `undefined` 会在 UI 里变成"关着"。
  return callNativeSafely(
    '读锁屏隐私偏好',
    async () => (await native.readWidgetPrivacy()) ?? null,
    null,
  );
}

/** W5-3 · 推进灵动岛。返回原生给的结局字符串；拿不到就给 `'none'`。 */
export async function syncFocusActivity(): Promise<string> {
  const native = readWidgetModule();
  if (native === undefined) {
    noteMissingModule();
    return 'none';
  }
  return callNativeSafely('推进灵动岛', () => native.syncFocusActivity(), 'none');
}

/** 登出 / 切换账号：清掉快照、意图队列与设备密钥（D6）。 */
export async function clearWidgetState(
  native: Pick<WidgetNativeModule, 'clearWidgetState'> | undefined = readWidgetModule(),
): Promise<void> {
  const lease = await beginWidgetCleanup();
  if (native === undefined) {
    noteMissingModule();
    lease.release(true);
    return;
  }
  try {
    if (!await native.clearWidgetState()) throw new Error('Widget state could not be cleared');
    lease.release(true);
  } catch (error) {
    lease.release(false);
    throw error;
  }
}
