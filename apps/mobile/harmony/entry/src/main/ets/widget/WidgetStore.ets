/**
 * 鸿蒙小组件 · **只读**地取回快照并解析。
 *
 * ## 数据从哪来
 *
 * 应用（RN 壳或元服务）把快照写进 `preferences`，卡片读它。
 * 卡片**从不自己算"今天"** —— `dayStr` 是应用写的。
 *
 * ## 🔴 三种状态必须分开，且顺序有意义
 *
 * ```
 * 读不到 / 解不开 / 版本不认识  →  placeholder（「打开 Heyta 以显示小组件」）
 * 读到了但 now >= validUntil   →  stale      （「数据已过期，打开 Heyta 刷新」）
 * 读到了且没过期               →  ready      （真实内容，可能是空的）
 * ```
 *
 * 把 `placeholder` 与"空"混为一谈的后果是：用户**还没打开过应用**时
 * 看到「今天没有任务」—— 那不是空状态，那是**撒谎**。
 */

import { preferences } from '@kit.ArkData';
// ⚠️ 写入方要记日志（写失败不抛，只记）—— 所以这个 import 是必需的，
//    没有它 ArkTS 编译期就报 `Cannot find name 'hilog'`。
import { hilog } from '@kit.PerformanceAnalysisKit';
import { util } from '@kit.ArkTS';
// ⚠️ 按**名字**导入，不是 `{ WidgetKey }` —— 那个模块导出的是函数，
//    没有一个叫 `WidgetKey` 的成员（报错是 `has no exported member 'WidgetKey'`）。
import { loadKey, decrypt, getOrCreate, encrypt } from './WidgetKey';
import type { DecryptResult, EncryptResult } from './WidgetKey';
import { parseEnvelope, parsePayload, isStale, envelopeAad, WIDGET_CONTRACT_VERSION, WIDGET_ALG, MAX_EPOCH_MS } from './WidgetParse';
import type { WidgetEnvelope, WidgetPayload, EnvelopeParseResult } from './WidgetParse';
import { buildTodayModel, buildQuadrantModel, buildHabitsModel, buildFocusModel } from './WidgetModels';
import type { TodayModel, QuadrantModel, HabitsModel, FocusModel } from './WidgetModels';

const STORE_NAME: string = 'heyta_widget';
const SNAPSHOT_KEY: string = 'widget_snapshot';

export type CardState = 'placeholder' | 'stale' | 'ready';

/** 一次读盘的结果。四款卡片共用同一个快照，所以只读一次。 */
export interface SnapshotResult {
  state: CardState;
  dayStr: string;
  payload: WidgetPayload | null;
}

/**
 * JSON 字符串 → 对象。解析不了就是 `null`（**不抛**）。
 *
 * ⚠️ 返回 `Object | null`：ArkTS 禁止 `any`/`unknown`，而 `JSON.parse`
 * 的产物本身就是"任意对象"。返回 `Object` 让调用方能直接喂给
 * `parseEnvelope(Object | null)`。
 */
function parseJson(text: string): Object | null {
  try {
    return JSON.parse(text) as Object;
  } catch (err) {
    return null;
  }
}

/**
 * 读一次快照。**这是卡片路径上唯一碰磁盘的地方。**
 *
 * 🔴 `now` 由调用方传入（而不是这里调 `Date.now()`）——
 * 这样它在测试里是可控的，而"跨零点"正是这张卡片最容易出错、
 * 也最容易被忽略的时刻（每天都会发生一次）。
 */
export async function readSnapshot(context: Context, now: number): Promise<SnapshotResult> {
  const store = await preferences.getPreferences(context, STORE_NAME);
  const raw = await store.get(SNAPSHOT_KEY, '');
  if (typeof raw !== 'string' || raw.length === 0) {
    return { state: 'placeholder', dayStr: '', payload: null };
  }

  const parsedJson = parseJson(raw);
  if (parsedJson === null) {
    return { state: 'placeholder', dayStr: '', payload: null };
  }

  const envelopeResult: EnvelopeParseResult = parseEnvelope(parsedJson);
  if (!envelopeResult.ok) {
    // 🔴 未知版本**必须** fail closed。旧卡片读到新契约时唯一安全的行为
    //    是假装没有数据 —— 猜字段会把**错的**数据画在用户桌面上。
    return { state: 'placeholder', dayStr: '', payload: null };
  }
  const envelope: WidgetEnvelope = envelopeResult.envelope;

  // 过期判定**在解密之前**：这样"设备刚重启、密钥库还没解锁"时
  // 我们至少还能正确说出"这份数据过期了"。
  if (isStale(envelope, now)) {
    return { state: 'stale', dayStr: envelope.dayStr, payload: null };
  }

  const keyBytes = await loadKey(context);
  if (keyBytes === null) {
    // 密钥读不到 ≠ 没有数据。但两者在卡片上都只能显示占位态，
    // 用 `hilog` 区分开，否则排查时完全看不出是哪一种。
    return { state: 'placeholder', dayStr: '', payload: null };
  }

  const decrypted: DecryptResult = await decrypt(
    keyBytes,
    envelope.ciphertext,
    envelope.nonce,
    envelopeAad(envelope),
  );
  // `plaintext` 在 `DecryptResult` 里是可选的（成功时才有），
  // 所以**先判它**再用 —— 否则 ArkTS 报 `string | undefined` 不能赋给 `string`。
  if (!decrypted.ok || decrypted.plaintext === undefined) {
    return { state: 'placeholder', dayStr: '', payload: null };
  }

  const payloadJson = parseJson(decrypted.plaintext);
  if (payloadJson === null) {
    return { state: 'placeholder', dayStr: '', payload: null };
  }
  const payloadResult = parsePayload(payloadJson);
  if (!payloadResult.ok) {
    return { state: 'placeholder', dayStr: '', payload: null };
  }

  return { state: 'ready', dayStr: envelope.dayStr, payload: payloadResult.payload };
}

/** 今日任务卡片的数据 + 状态。 */
export function todayCard(snapshot: SnapshotResult, dark: boolean): TodayModel | CardState {
  if (snapshot.state !== 'ready' || snapshot.payload === null) return snapshot.state;
  const model = buildTodayModel(snapshot.payload, dark);
  model.dayStr = snapshot.dayStr;
  return model;
}

export function quadrantCard(snapshot: SnapshotResult, isZh: boolean): QuadrantModel | CardState {
  if (snapshot.state !== 'ready' || snapshot.payload === null) return snapshot.state;
  return buildQuadrantModel(snapshot.payload, isZh);
}

export function habitsCard(snapshot: SnapshotResult): HabitsModel | CardState {
  if (snapshot.state !== 'ready' || snapshot.payload === null) return snapshot.state;
  return buildHabitsModel(snapshot.payload);
}

export function focusCard(snapshot: SnapshotResult): FocusModel | CardState {
  if (snapshot.state !== 'ready' || snapshot.payload === null) return snapshot.state;
  return buildFocusModel(snapshot.payload);
}

// ---------------------------------------------------------------------------
// 写入方 —— 卡片读什么，这里就写什么
// ---------------------------------------------------------------------------

/** base64 → 字节。⚠️ 只在这里用一次，所以不额外抽公共模块。 */
function base64ToBytes(b64: string): Uint8Array {
  const helper: util.Base64Helper = new util.Base64Helper();
  return helper.decodeSync(b64);
}

/**
 * 把**已经加密好的**信封 JSON 写进快照。
 *
 * 🔴 **这是读路径的镜像，两者必须严格对称**：同一个 `STORE_NAME`、
 * 同一个 `SNAPSHOT_KEY`。不对称的后果不是"报错"，而是**卡片永远停在占位态**
 * —— 应用以为写成功了，卡片读不到，而两边都不报错。
 *
 * ## 为什么参数是"已经加密好的 JSON 字符串"而不是一个 payload 对象
 *
 * 因为**加密不在鸿蒙侧**。四条不变量里的第一条是"单一写入者"：
 * 快照的**内容**（算今天、选任务、算 `validUntil`）由**应用**决定，
 * 这里只负责**落盘**。让这张卡片所在的进程自己去算"今天"会造出
 * 第二份真相 —— 而两份真相在一个跨零点的问题上必然分叉。
 *
 * ⚠️ 调用方负责 `JSON.stringify`：ArkTS 禁止 `any`，而 `JSON.stringify`
 * 的入参在这里只能是具体类型；字符串进、字符串出，边界最清楚。
 */
export async function writeSnapshot(context: Context, envelopeJson: string): Promise<boolean> {
  if (envelopeJson.length === 0) {
    // 🔴 **空串不是"清空"** —— 它是一个读路径会当作 placeholder 的坏值，
    //    而调用方多半是"我以为传了个对象"。要清空请用 `clearSnapshot`。
    hilog.warn(0x0000, 'heyta', 'writeSnapshot 收到空串，已忽略（清空请用 clearSnapshot）');
    return false;
  }
  try {
    const store = await preferences.getPreferences(context, STORE_NAME);
    await store.put(SNAPSHOT_KEY, envelopeJson);
    // ⚠️ `flush()` **不是可选的**。`put` 只改内存里的副本，
    //    不进 `flush` 的话卡片进程读到的仍是旧值 —— 而这一条在
    //    应用自己的进程里**看起来完全正常**（读自己刚写的值会命中缓存），
    //    只有**另一个进程**（卡片宿主）才看得出没落盘。
    await store.flush();
    return true;
  } catch (err) {
    // ⚠️ 不抛：写快照失败不该让调用它的业务流程（保存任务）失败。
    //    组件显示旧数据是可以接受的，任务没保存不可以。
    hilog.error(0x0000, 'heyta', 'writeSnapshot 失败：%{public}s', err instanceof Error ? err.message : 'unknown');
    return false;
  }
}

/**
 * 清空快照（登出 / 切换账号）。
 *
 * 🔴 **必须与 `clearWidgetState` 的语义一致：快照与密钥一起清。**
 * 只清快照留下密钥是无害的（密钥没有数据可解）；只清密钥留下快照是
 * **安全的**（解不开 ⇒ 卡片显示占位）。但如果两件事分散在两个地方调用，
 * 迟早会有人只记得其中一件 —— 所以调用约定写在进度账本里，而不是散在代码注释里。
 *
 * ⚠️ `delete` 之后**同样要 `flush()`** —— 理由与 `writeSnapshot` 完全一样。
 */
export async function clearSnapshot(context: Context): Promise<boolean> {
  try {
    const store = await preferences.getPreferences(context, STORE_NAME);
    await store.delete(SNAPSHOT_KEY);
    await store.flush();
    return true;
  } catch (err) {
    hilog.error(0x0000, 'heyta', 'clearSnapshot 失败：%{public}s', err instanceof Error ? err.message : 'unknown');
    return false;
  }
}

// ---------------------------------------------------------------------------
// 封包 —— 把明文载荷加密成信封，再落盘
// ---------------------------------------------------------------------------

/**
 * 把**明文载荷**封成信封并落盘。这是整个鸿蒙链路的**上半截**。
 *
 * 🔴 **在此之前鸿蒙侧完全没有这个函数**，所以：卡片能读、解密逻辑齐全、
 * 但**没有任何人能把数据写进去** —— 卡片会永远停在占位态
 * 「打开 Heyta 以显示小组件」。这不是"少个功能"，是这条链**不成立**。
 *
 * ## 与其它三端必须逐字节一致的两处
 *
 * 1. **AAD** = `${契约版本}|${dayStr}|${validUntil}`（`envelopeAad()` 的同一个拼法）。
 *    差一个字符 = GCM 认证失败 = **只有鸿蒙这一端解不开**，而其它三端全正常。
 * 2. **线上格式** = `ciphertext || tag`（不是 `nonce || ciphertext || tag`）。
 *    这个差异坑过一次（Swift 的 `SealedBox(combined:)` 期望后者）。
 *
 * ⚠️ 加密本身在 `WidgetKey.encrypt`，它带**自解校验** —— 见那里的注释。
 *    一个不自检的封包会把错误推迟到"卡片显示占位态"，而在卡片上
 *    "解不开"与"没有数据"长得一模一样。
 *
 * ⚠️ 密钥用 `getOrCreate`（**应用侧**，用户正在使用应用，可以生成密钥）。
 *    卡片侧恰恰相反，只用 `loadKey` —— 自己造密钥会把正确的密钥**覆盖掉**。
 */
export async function sealSnapshot(
  context: Context,
  payloadJson: string,
  dayStr: string,
  validUntil: number,
): Promise<boolean> {
  if (dayStr.length === 0) {
    hilog.warn(0x0000, 'heyta', 'sealSnapshot：dayStr 不能为空（它进 AAD）');
    return false;
  }
  if (validUntil < 0 || validUntil > MAX_EPOCH_MS) {
    hilog.warn(0x0000, 'heyta', 'sealSnapshot：validUntil 越界');
    return false;
  }

  const keyB64: string = await getOrCreate(context);
  if (keyB64.length === 0) {
    hilog.error(0x0000, 'heyta', 'sealSnapshot：拿不到设备密钥');
    return false;
  }
  const keyBytes: Uint8Array = base64ToBytes(keyB64);

  const aad: string = `${WIDGET_CONTRACT_VERSION}|${dayStr}|${validUntil}`;
  const sealed: EncryptResult = await encrypt(keyBytes, payloadJson, aad);
  if (!sealed.ok || sealed.ciphertextB64 === undefined || sealed.nonceB64 === undefined) {
    hilog.error(0x0000, 'heyta', 'sealSnapshot：加密失败：%{public}s', sealed.reason ?? '未知');
    return false;
  }

  // ⚠️ 字段名与顺序跟其它三端一致 —— `parseEnvelope` 会逐字段校验。
  const envelopeJson: string = JSON.stringify({
    v: WIDGET_CONTRACT_VERSION,
    dayStr: dayStr,
    validUntil: validUntil,
    alg: WIDGET_ALG,
    nonce: sealed.nonceB64,
    ciphertext: sealed.ciphertextB64,
  });

  return await writeSnapshot(context, envelopeJson);
}
