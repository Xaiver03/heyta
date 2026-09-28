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
import { readSnapshot } from './WidgetStore';
import { buildData, resolveIsZh, rememberForm, forgetForm } from './WidgetForms';
import { appendIntent } from './WidgetIntents';

const DOMAIN: number = 0x0001;
const TAG: string = 'HeytaWidget';

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
    // 🔴 **登记 formId 是这一环的关键。** 不登记的话，应用之后写入快照时
    //    没有任何东西知道"该推给哪张卡片" —— 卡片会永远停在加它的那一刻。
    void rememberForm(this.context, formId, name);
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
    // 🔴 **只转发，不改数据** —— 与其它三端同一条纪律。
    //    真正落入数据的是应用侧：一次 drain = 一条 op。
    void this.recordIntent(message);
  }

  /**
   * 把卡片发来的 message 解成一条意图，写进队列。
   *
   * ⚠️ `message` 是**卡片的 `params` 序列化后的字符串**，形状由平台决定，
   *    所以这里对"解不开"必须**安静地放弃**而不是抛 ——
   *    一次解不开不该让整张卡片的事件通道失效。
   */
  private async recordIntent(message: string): Promise<void> {
    try {
      const parsed: Object = JSON.parse(message) as Object;
      const obj: Record<string, Object> = parsed as Record<string, Object>;
      const idValue: Object | undefined = obj['taskId'];
      const targetValue: Object | undefined = obj['targetIsDone'];
      const taskId: string = typeof idValue === 'string' ? idValue : '';
      const targetIsDone: boolean = typeof targetValue === 'boolean' ? targetValue : false;
      if (taskId.length === 0) return;
      const ok: boolean = await appendIntent(this.context, taskId, targetIsDone);
      hilog.info(DOMAIN, TAG, '意图已入队: %{public}s -> %{public}s (%{public}s)',
        taskId, targetIsDone ? 'done' : 'undone', ok ? 'ok' : 'failed');
    } catch (err) {
      hilog.warn(DOMAIN, TAG, 'onFormEvent 的 message 解不开，已忽略');
    }
  }

  onRemoveForm(formId: string): void {
    hilog.info(DOMAIN, TAG, `onRemoveForm ${formId}`);
    // 注销掉 —— 留着会让每次推送都去推一张已经不在桌面上的卡片。
    void forgetForm(this.context, formId);
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
