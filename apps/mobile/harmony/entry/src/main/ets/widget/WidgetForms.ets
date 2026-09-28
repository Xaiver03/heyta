/**
 * 卡片宿主侧的三件事：**记住 formId / 拼 bindingData / 主动推刷新**。
 * ==================================================================
 *
 * ## 🔴 这个文件补的是鸿蒙链路上最后一个洞
 *
 * 此前的状态是：应用能把快照封包落盘、读路径能把任务解出来（都实测过），
 * **但桌面上那张卡片一直显示占位态**。根因不在加解密、也不在沙箱：
 *
 *   `EntryFormAbility.onAddForm` 在读快照的同时**没有把 `formId` 记下来**，
 *   于是应用后来写入快照时，**没有任何东西通知卡片宿主重画** ——
 *   卡片上那份渲染就停在"加卡片的那一刻"（那时还没有数据）。
 *
 * 这不是"少个功能"，是**这条链的最后一环没接上**：数据写对了，只是没人敲那扇门。
 *
 * ## 为什么 `buildData` 必须搬到这个模块
 *
 * 原来 `buildData` 是 `EntryFormAbility` 里的私有函数。
 * 而"写入方"（应用页）需要**自己拼出同一份 bindingData** 才能推刷新 ——
 * 如果让它在页面里另写一份拼法，就造出了**第二份真相**：
 * 页面推的数据和卡片渲染逻辑一旦不一致，症状正是我们现在在修的这种
 * 「界面说有、卡片说没有」。**同一份拼法只能有一处。**
 */

import { preferences } from '@kit.ArkData';
import { formBindingData, formProvider } from '@kit.FormKit';
import { i18n } from '@kit.LocalizationKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

import { readSnapshot, todayCard, quadrantCard, habitsCard, focusCard } from './WidgetStore';
import type { SnapshotResult } from './WidgetStore';

const DOMAIN: number = 0x0001;
const TAG: string = 'HeytaWidget';

/** 与快照同一个 preferences 库（同一个应用沙箱，见文件头）。 */
const STORE_NAME: string = 'heyta_widget';
const FORMS_KEY: string = 'form_registry';

/** 一条已登记的卡片实例。 */
interface FormRef {
  formId: string;
  name: string;
}

function parseRegistry(raw: string): FormRef[] {
  try {
    const parsed: Object = JSON.parse(raw) as Object;
    return parsed as FormRef[];
  } catch (err) {
    // ⚠️ 坏了就当空表：**不抛**。一个坏掉的注册表不该让"加卡片"这件事失败。
    return [];
  }
}

/**
 * 系统语言是不是中文。
 *
 * 🔴 取不到时回退到**是**（`base` 那份），不是"否"：
 * `resources/base` 是中文、`en_US` 是英文，而鸿蒙自己在取不到语言时也回退 `base`；
 * 这里判成"否"就会出现**资源显示中文、卡片文案显示英文**的混搭。
 */
export function resolveIsZh(): boolean {
  try {
    const language: string = i18n.System.getSystemLanguage();
    return language.toLowerCase().startsWith('zh');
  } catch (err) {
    hilog.warn(DOMAIN, TAG, '读系统语言失败，回退到中文');
    return true;
  }
}

/**
 * 快照 + 卡片名 → 卡片宿主吃的 bindingData。
 *
 * ⚠️ `state` 原样交给卡片：`placeholder` / `stale` / `ready` 是**三个**状态，
 * 卡片侧的渲染顺序依赖它。把 `placeholder` 与"今天没有任务"混起来的后果是
 * **撒谎** —— 用户还没打开过应用时会看到"今天没有任务"。
 */
export function buildData(snapshot: SnapshotResult, name: string): formBindingData.FormBindingData {
  const isZh: boolean = resolveIsZh();
  let todayRows: string = '[]';
  let quadrantSlots: string = '[]';
  let habitRows: string = '[]';
  let focusModel: string = '{}';

  if (snapshot.state === 'ready') {
    if (name === 'today') {
      const model = todayCard(snapshot, false);
      if (typeof model !== 'string') todayRows = JSON.stringify(model.rows);
    } else if (name === 'quadrant') {
      const model = quadrantCard(snapshot);
      if (typeof model !== 'string') quadrantSlots = JSON.stringify(model.slots);
    } else if (name === 'habits') {
      const model = habitsCard(snapshot);
      if (typeof model !== 'string') habitRows = JSON.stringify(model.rows);
    } else {
      const model = focusCard(snapshot);
      if (typeof model !== 'string') focusModel = JSON.stringify(model);
    }
  }

  // 🔴 临时诊断：卡片"有状态没数据"时，唯一能一次问清的就是把三个值都打出来。
  hilog.info(DOMAIN, TAG, '[buildData] name=%{public}s state=%{public}s todayRows=%{public}d chars',
    name, snapshot.state, todayRows.length);

  return formBindingData.createFormBindingData({
    state: snapshot.state,
    dayStr: snapshot.dayStr,
    todayRows,
    quadrantSlots,
    habitRows,
    focusModel,
    isZh,
  });
}

/** 登记一张卡片实例。`onAddForm` 里调。 */
export async function rememberForm(context: Context, formId: string, name: string): Promise<void> {
  if (formId.length === 0) return;
  try {
    const store = await preferences.getPreferences(context, STORE_NAME);
    const raw: string = await store.get(FORMS_KEY, '[]') as string;
    const list: FormRef[] = parseRegistry(raw);
    // 同一张卡片重复登记只保留一条 —— 否则每次重加都会让推送次数翻倍。
    const next: FormRef[] = list.filter((f: FormRef) => f.formId !== formId);
    next.push({ formId: formId, name: name });
    await store.put(FORMS_KEY, JSON.stringify(next));
    await store.flush();
  } catch (err) {
    hilog.warn(DOMAIN, TAG, '登记 formId 失败（不影响卡片本身）');
  }
}

/** 注销一张卡片实例。`onRemoveForm` 里调。 */
export async function forgetForm(context: Context, formId: string): Promise<void> {
  if (formId.length === 0) return;
  try {
    const store = await preferences.getPreferences(context, STORE_NAME);
    const raw: string = await store.get(FORMS_KEY, '[]') as string;
    const next: FormRef[] = parseRegistry(raw).filter((f: FormRef) => f.formId !== formId);
    await store.put(FORMS_KEY, JSON.stringify(next));
    await store.flush();
  } catch (err) {
    hilog.warn(DOMAIN, TAG, '注销 formId 失败');
  }
}

/**
 * 把当前快照推给**所有已登记的卡片**。
 *
 * 🔴 **写入方写完快照必须调它** —— 这就是文件头那个洞的补丁。
 * 不调的话卡片会一直停在"加它的那一刻"的渲染上，而应用侧看起来一切正常。
 *
 * ⚠️ 返回推送成功的条数，**不抛**：推送失败不该让"保存任务"这种业务流程失败。
 * 卡片显示旧数据可以接受，任务没保存不可以。
 */
export async function pushAllForms(context: Context, now: number): Promise<number> {
  let pushed: number = 0;
  try {
    const store = await preferences.getPreferences(context, STORE_NAME);
    const raw: string = await store.get(FORMS_KEY, '[]') as string;
    const list: FormRef[] = parseRegistry(raw);
    if (list.length === 0) return 0;

    const snapshot: SnapshotResult = await readSnapshot(context, now);
    for (const ref of list) {
      try {
        await formProvider.updateForm(ref.formId, buildData(snapshot, ref.name));
        pushed += 1;
      } catch (err) {
        // 单张失败不影响其它卡片 —— 一张被删掉的卡片不该让其余的都不刷新。
        hilog.warn(DOMAIN, TAG, '推送某张卡片失败：%{public}s', ref.formId);
      }
    }
  } catch (err) {
    hilog.warn(DOMAIN, TAG, 'pushAllForms 失败');
  }
  return pushed;
}
