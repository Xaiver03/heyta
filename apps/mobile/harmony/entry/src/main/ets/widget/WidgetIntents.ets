/**
 * 卡片点击的**意图队列** —— 鸿蒙侧此前完全没有这一层。
 * ====================================================
 *
 * ## 为什么卡片不能直接改数据
 *
 * 卡片不知道冲突规则、没有 op-log、也读不到"另一台设备刚改了什么"。
 * 它唯一能做的是把**用户的意图**记下来，由应用在下次唤醒时取走、转成一条真正的 op。
 * 四端都是这个形状（Android 的 `WidgetIntentQueue`、Web 的 SW 点击日志、iOS 的 intent 队列）。
 *
 * ## 🔴 两条承重语义（与 Android 逐条一致，不是各写各的）
 *
 * 1. **记的是"目标状态"而不是"切换"。** 动作在过期视图上会算错：
 *    用户看到未完成、实际已完成，点一下变"标记完成" = 没有变化。
 *    目标状态是幂等的。
 * 2. **同一任务 last-wins。** 连点两下（先标完成、发现错了再标未完成）时，
 *    如果两条都留着并被依次执行，**最终状态取决于消息顺序** ——
 *    而顺序在跨进程之间不保证。留最后一条让结果确定。
 */

import { preferences } from '@kit.ArkData';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN: number = 0x0001;
const TAG: string = 'HeytaWidget';
const STORE_NAME: string = 'heyta_widget';
const INTENTS_KEY: string = 'intent_queue';

/**
 * 队列上限。与契约里的 `WIDGET_INTENT_MAX` 同值。
 *
 * ⚠️ 满了**丢最旧的**，不是拒绝新的 —— 用户最近那几次点击才是他记得住的。
 */
const INTENT_MAX: number = 50;

export interface WidgetIntent {
  taskId: string;
  /** 用户希望这个任务变成的完成状态（**目标**，不是切换）。 */
  targetIsDone: boolean;
  /** 点击时刻，仅用于诊断。⚠️ 排序**不看它** —— 见文件头第 2 条。 */
  at: number;
}

function parseQueue(raw: string): WidgetIntent[] {
  try {
    const parsed: Object = JSON.parse(raw) as Object;
    return Array.isArray(parsed) ? (parsed as WidgetIntent[]) : [];
  } catch (err) {
    // 坏了就当空队列：一个坏掉的队列不该让"点一下"这件事失败。
    return [];
  }
}

/** 追加一条意图（同任务 last-wins，超上限丢最旧）。 */
export async function appendIntent(
  context: Context,
  taskId: string,
  targetIsDone: boolean,
): Promise<boolean> {
  if (taskId.length === 0) return false;
  try {
    const store = await preferences.getPreferences(context, STORE_NAME);
    const raw: string = await store.get(INTENTS_KEY, '[]') as string;
    // 🔴 同任务只留最后一条 —— 见文件头第 2 条。
    const kept: WidgetIntent[] = parseQueue(raw).filter((i: WidgetIntent) => i.taskId !== taskId);
    kept.push({ taskId: taskId, targetIsDone: targetIsDone, at: Date.now() });
    const trimmed: WidgetIntent[] = kept.length > INTENT_MAX ? kept.slice(kept.length - INTENT_MAX) : kept;
    await store.put(INTENTS_KEY, JSON.stringify(trimmed));
    // ⚠️ `flush()` 不是可选的：不落盘的话应用侧（另一个进程）读到的还是旧队列。
    await store.flush();
    return true;
  } catch (err) {
    hilog.error(DOMAIN, TAG, '写意图失败');
    return false;
  }
}

/** 只看不取。 */
export async function peekIntents(context: Context): Promise<WidgetIntent[]> {
  try {
    const store = await preferences.getPreferences(context, STORE_NAME);
    return parseQueue(await store.get(INTENTS_KEY, '[]') as string);
  } catch (err) {
    return [];
  }
}

/**
 * 取走并清空。**应用侧调这个。**
 *
 * 🔴 取完必须清空：不清的话每次唤醒都会把**同一次点击**再执行一遍，
 * 用户会看到"我明明只点了一次，它被标记了好几回"。
 */
export async function drainIntents(context: Context): Promise<WidgetIntent[]> {
  try {
    const store = await preferences.getPreferences(context, STORE_NAME);
    const queue: WidgetIntent[] = parseQueue(await store.get(INTENTS_KEY, '[]') as string);
    await store.put(INTENTS_KEY, '[]');
    await store.flush();
    return queue;
  } catch (err) {
    return [];
  }
}
