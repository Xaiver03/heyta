/**
 * 鸿蒙端的**应用内小组件页** —— 也就是写入路径的调用点。
 * ====================================================
 *
 * 原来这一页是 DevEco 模板的 "Hello World"，也就是说：
 * **卡片能读、解密逻辑齐全，但没有任何东西能把数据写进去。**
 * 用户加了卡片之后，它会永远显示「打开 Heyta 以显示小组件」。
 *
 * ## 🔴 这一页做的三件事，以及它**不**做的事
 *
 * 1. **写**：把示例载荷封包并落盘（`sealSnapshot` → `writeSnapshot`）。
 * 2. **清**：登出 / 换账号时该清掉快照与密钥（D6）—— 这里给出手动入口。
 * 3. **说清状态**：卡片现在到底有没有数据、密钥在不在。
 *
 * ⚠️ **它不生成密钥之外任何密码学的东西**，也不自己算"今天" ——
 * `dayStr` 与 `validUntil` 由这一层给，但**四端的拼法必须一致**，
 * 所以它们直接来自 `WidgetParse` 里的常量，不在这里再写一遍字面量。
 */
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

import { sealSnapshot, clearSnapshot, readSnapshot } from '../widget/WidgetStore';
import { pushAllForms } from '../widget/WidgetForms';
import { peekIntents, drainIntents } from '../widget/WidgetIntents';
import type { WidgetIntent } from '../widget/WidgetIntents';
import type { SnapshotResult } from '../widget/WidgetStore';
import { SAMPLE_PAYLOAD_JSON } from '../widget/SamplePayload';
import { WIDGET_CONTRACT_VERSION } from '../widget/WidgetParse';

/** 一次"今天"的起止。⚠️ 与其它三端同源：本地日期 + 当天末。 */
function todayStr(): string {
  const d: Date = new Date();
  const m: string = (d.getMonth() + 1).toString().padStart(2, '0');
  const day: string = d.getDate().toString().padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function endOfTodayMs(): number {
  const d: Date = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

@Entry
@Component
struct Index {
  @State status: string = '正在检查…';
  @State busy: boolean = false;
  /** 卡片点出来的意图条数。**队列只进不出的样子必须看得见** —— 见下面的按钮。 */
  @State pending: number = 0;
  /** 上一次 drain 出来的东西，原样显示（诊断用）。 */
  @State drained: string = '';

  private context = getContext(this) as common.UIAbilityContext;

  aboutToAppear(): void {
    this.refreshStatus();
  }

  /**
   * 状态文案直接**复用卡片那条读路径**（`readSnapshot`），而不是另写一份"文件在不在"的判断。
   *
   * 🔴 理由：另写一份判断就会造出**第二份真相** —— 界面说"有数据"而卡片显示占位态，
   * 是这类功能里最难排查的一种不一致。这里显示的 `state` 就是卡片真正会用的那个判定结果。
   */
  private async refreshStatus(): Promise<void> {
    const snapshot: SnapshotResult = await readSnapshot(this.context, Date.now());
    // 顺带读一眼队列 —— 与快照状态一起显示，用户才知道"点了到底有没有被记下来"。
    this.pending = (await peekIntents(this.context)).length;
    if (snapshot.state === 'ready') {
      this.status = `卡片现在能显示真实内容（今日 ${snapshot.payload?.today.length ?? 0} 条，契约 v${WIDGET_CONTRACT_VERSION}）。`;
    } else if (snapshot.state === 'stale') {
      this.status = `快照已过期（${snapshot.dayStr}）—— 卡片会显示「数据已过期」。`;
    } else {
      this.status = '卡片现在显示的是占位态：设备上没有可用的快照。';
    }
  }

  build() {
    Column({ space: 12 }) {
      Text('heyta 小组件')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
      Text(this.status)
        .fontSize(14)
        .fontColor('#6b7280')

      Divider()

      Text('⚠️ 下面写入的是「示例数据」（四端共用的那份黄金夹具），不是你的真实任务。')
        .fontSize(13)
        .fontColor('#b45309')

      Button(this.busy ? '写入中…' : '把示例任务写进卡片')
        .enabled(!this.busy)
        .onClick(async () => {
          this.busy = true;
          try {
            const ok: boolean = await sealSnapshot(
              this.context,
              SAMPLE_PAYLOAD_JSON,
              todayStr(),
              endOfTodayMs(),
            );
            hilog.info(0x0000, 'heyta', 'sealSnapshot 结果: %{public}s', ok ? 'ok' : 'failed');
            if (!ok) {
              this.status = '写入失败 —— 看日志（可能是自解校验没过）。';
            } else {
              // 🔴 **写完必须推一次。** 少了这一步，卡片会一直停在
              //    "加它的那一刻"的渲染上（那时还没有数据），而应用侧看起来一切正常 ——
              //    "界面说能显示、卡片说没有"就是这么来的。
              const pushed: number = await pushAllForms(this.context, Date.now());
              // ⚠️ **顺序有讲究**：`refreshStatus()` 会整句覆盖 `status`，
              //    所以必须**先刷新状态、再把推送结果拼上去**。
              //    反过来写的话，推送条数永远看不见 —— 我自己就踩了这一下。
              await this.refreshStatus();
              this.status = pushed > 0
                ? `${this.status} 已推送给 ${pushed} 张桌面卡片。`
                : `${this.status} ⚠️ 桌面还没有登记过的卡片实例 —— 先从桌面把卡片加上。`;
              this.busy = false;
              return;
            }
          } catch (err) {
            this.status = '写入抛异常，看日志。';
          }
          this.busy = false;
          await this.refreshStatus();
        })

      Text(`卡片点出来的意图：${this.pending} 条待处理`)
        .fontSize(13)
        .fontColor('#6b7280')

      Button(this.busy ? '处理中…' : '取走这些意图（drain）')
        .enabled(!this.busy && this.pending > 0)
        .backgroundColor('#0f172a')
        .onClick(async () => {
          this.busy = true;
          try {
            // 🔴 **取走并清空是同一个动作。** 只取不清的话，每次唤醒都会把
            //    同一次点击再执行一遍 —— 用户看到"我只点了一次，它被标记了好几回"。
            const taken: WidgetIntent[] = await drainIntents(this.context);
            this.drained = taken.length === 0
              ? '（队列是空的）'
              : taken.map((i: WidgetIntent) => `${i.taskId}→${i.targetIsDone ? '完成' : '未完成'}`).join('、');
            hilog.info(0x0000, 'heyta', 'drain 出 %{public}d 条', taken.length);
          } catch (err) {
            this.drained = 'drain 出错，看日志。';
          }
          this.busy = false;
          await this.refreshStatus();
        })

      if (this.drained.length > 0) {
        Text(`上次取走：${this.drained}`)
          .fontSize(13)
          .fontColor('#0f172a')
      }

      Button('清掉卡片数据与设备密钥')
        .backgroundColor('#ef4444')
        .onClick(async () => {
          await clearSnapshot(this.context);
          this.status = '已清空快照。密钥清除在真机上由登录态驱动（此处只清快照）。';
          await this.refreshStatus();
        })
    }
    .width('100%')
    .height('100%')
    .padding(24)
    .justifyContent(FlexAlign.Center)
  }
}
