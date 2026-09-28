/**
 * 鸿蒙卡片的生命周期入口（`form` 类型的 ExtensionAbility）。
 *
 * ## 关键纪律
 *
 * - **卡片绝不解密以外的事**：读快照 → 判过期 → 解密 → 解析 → 交模型。
 * - **卡片绝不新建设备密钥**（用 `WidgetKey.loadKey`，不是 `getOrCreate`）。
 *   读不到密钥就显示占位态 —— 自己造一把会把正确的密钥**覆盖掉**，
 *   用户再也恢复不了。
 * - **`onFormEvent` 收到的 `message` 是用户点击**，我们**只把它交给应用**，
 *   不在这里改数据。理由与其它三端相同：卡片没有 op-log、不知道冲突规则。
 */
import { FormExtensionAbility, formBindingData, formProvider } from '@kit.FormKit';
import { Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
// ⚠️ 只用来**读**系统语言（`i18n.System`），不引入任何资源加载器 ——
//    卡片进程越薄越好。
import { i18n } from '@kit.LocalizationKit';
import { readSnapshot, todayCard, quadrantCard, habitsCard, focusCard } from './WidgetStore';
import type { SnapshotResult } from './WidgetStore';

const DOMAIN: number = 0x0001;
const TAG: string = 'HeytaWidget';

/**
 * 系统语言是不是中文。
 *
 * 🔴 **取不到时必须回退到"是"（即 `base` 那份），不能回退到"否"。**
 * `resources/base/element/string.json` 是中文、`en_US` 是英文；
 * 取不到语言时鸿蒙本身也会回退到 `base`（中文）——
 * 如果这里判成"否"，就会出现**资源显示中文、卡片文案显示英文**的混搭。
 * 两处回退方向必须一致。
 *
 * ⚠️ **绝不抛异常**：读语言失败不该让卡片画不出来。整个调用包在 try 里，
 * 任何失败都当作"中文"。
 */
function resolveIsZh(): boolean {
  try {
    const language: string = i18n.System.getSystemLanguage();
    return language.toLowerCase().startsWith('zh');
  } catch (err) {
    hilog.warn(DOMAIN, TAG, '读系统语言失败，回退到中文：%{public}s',
      err instanceof Error ? err.message : 'unknown');
    return true;
  }
}

/** 卡片名（写在 `form_config.json` 的 `name` 里）→ 该卡片该渲染什么。 */
function buildData(snapshot: SnapshotResult, name: string): formBindingData.FormBindingData {
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

export default class EntryFormAbility extends FormExtensionAbility {
  onAddForm(want: Want): formBindingData.FormBindingData {
    // ⚠️ `want.parameters` 在类型上是 `Record<string, Object>`，
    //    写成 `parameters.ohos.extra.param…` 会报 `Property 'extra' does not exist on type 'Object'`。
    //    卡片的 name / id 是通过 **bracket 字符串键**取的（平台约定）。
    const params: Record<string, Object> = want.parameters ?? {};
    const nameValue: Object | undefined = params['ohos.extra.param.key.form_name'];
    const name: string = typeof nameValue === 'string' ? nameValue : 'today';
    hilog.info(DOMAIN, TAG, `onAddForm ${name}`);
    // 🔴 `onAddForm` **是同步签名**，而读快照是异步的（要走磁盘与解密）。
    //    所以这里先返回占位态，真正的内容由下面的异步任务补推。
    //    这样用户看到的第一帧是「打开 Heyta 以显示小组件」，
    //    **而不是**一块空白，也不是"今天没有任务"。
    const idValue: Object | undefined = params['ohos.extra.param.key.form_identity'];
    const formId: string = typeof idValue === 'string' ? idValue : '';
    void this.refresh(formId, name);
    // ⚠️ 这里也要走 `resolveIsZh()` —— 占位态正是**最需要**说对话言的一屏
    //    （用户还没打开过应用，卡片上只有这一句话可读）。写死 `true`
    //    会让英文用户在唯一有字可读的那一屏看到中文。
    return formBindingData.createFormBindingData({ state: 'placeholder', todayRows: '[]', quadrantSlots: '[]', habitRows: '[]', focusModel: '{}', isZh: resolveIsZh() });
  }

  onUpdateForm(formId: string): void {
    hilog.info(DOMAIN, TAG, `onUpdateForm ${formId}`);
    void this.refresh(formId, 'today');
  }

  onFormEvent(formId: string, message: string): void {
    // 🔴 **只转发，不改数据。** 卡片不知道冲突规则，也不知道 op-log。
    //    真正落入数据的是应用侧 —— 一次调用 = 一条 op。
    hilog.info(DOMAIN, TAG, `onFormEvent ${formId} ${message}`);
  }

  onRemoveForm(formId: string): void {
    hilog.info(DOMAIN, TAG, `onRemoveForm ${formId}`);
  }

  private async refresh(formId: string, name: string): Promise<void> {
    if (formId.length === 0) return;
    try {
      const snapshot = await readSnapshot(this.context, Date.now());
      await formProvider.updateForm(formId, buildData(snapshot, name));
    } catch (err) {
      // 刷新失败**不抛**：卡片停在上一帧，比白屏好。
      hilog.error(DOMAIN, TAG, `刷新失败 ${formId}`);
    }
  }
}
