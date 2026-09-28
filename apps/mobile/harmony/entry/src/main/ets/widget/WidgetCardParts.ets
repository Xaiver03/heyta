/**
 * 四张卡片**共用**的 UI 零件。
 *
 * 🔴 与 Android 侧同一个理由：四份必然漂移，而漂移的表现是
 * "四款里只有一款在过期之后还显示昨天的数据"。所以：
 *
 * - 「能显示什么」只有一处（`WidgetStore.readSnapshot`）；
 * - 占位/过期的**长相**只有一处（本文件）；
 * - 四张卡片的 `.ets` 只负责把字段摆到屏幕上，**不做任何判断**。
 */
import { WidgetStrings } from './WidgetStrings';

/** 一行任务。 */
@Component
export struct WidgetTaskRow {
  title: string = '';
  isDone: boolean = false;
  accent: string = '';
  compact: boolean = false;
  /**
   * 任务 id。空串 = **不可点**（有些卡片位置只做展示）。
   *
   * 🔴 默认空串是刻意的：把"忘了传 id"变成"点了没反应"而不是"点错任务"。
   *    点错任务会改到别的数据，而点了没反应只是少一个功能。
   */
  taskId: string = '';

  build() {
    Row({ space: 6 }) {
      Text(this.isDone ? '✓' : '○')
        .fontSize(13)
        .fontColor(this.isDone ? '#94a3b8' : (this.accent.length > 0 ? this.accent : '#64748b'))
      Text(this.title)
        .fontSize(this.compact ? 13 : 14)
        .fontColor(this.isDone ? '#94a3b8' : '#0f172a')
        .decoration({ type: this.isDone ? TextDecorationType.LineThrough : TextDecorationType.None })
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
    }
    .width('100%')
    .padding({ top: 3, bottom: 3 })
    // 🔴 卡片**不能直接改数据** —— 它没有 op-log、不知道冲突规则。
    //    这里只把「用户希望这条变成什么状态」作为一条 message 发给 EntryFormAbility，
    //    由它写进意图队列，应用下次唤醒时 drain 出来转成真正的 op。
    //    ⚠️ 发的是**目标状态**（`!isDone`）而不是"切换"：动作在过期视图上会算错。
    .onClick(() => {
      if (this.taskId.length === 0) return;
      postCardAction(this, {
        action: 'message',
        params: { taskId: this.taskId, targetIsDone: !this.isDone },
      });
    })
  }
}

/** 卡片标题栏。 */
@Component
export struct WidgetHeader {
  title: string = '';
  badge: string = '';

  build() {
    Row() {
      Text(this.title).fontSize(13).fontWeight(FontWeight.Medium).fontColor('#334155')
      Blank()
      if (this.badge.length > 0) {
        Text(this.badge).fontSize(12).fontColor('#64748b')
      }
    }
    .width('100%')
    .padding({ bottom: 6 })
  }
}

/**
 * 🔴 「我不知道」这一档的**唯一**长相。
 *
 * `placeholder` 与 `stale` 都走这里，但文案不同：
 * - placeholder：快照还没读到 / 解不开 / 版本不认识
 * - stale：读到了但过期
 *
 * 两者**都不是**「今天没有任务」。把"不知道"画成"空"是撒谎。
 */
@Component
export struct WidgetMessage {
  text: string = '';

  build() {
    Column() {
      Text(this.text)
        .fontSize(13)
        .fontColor('#64748b')
        .textAlign(TextAlign.Center)
        .maxLines(3)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .padding(12)
  }
}

/** 状态 → 文案。**这是四张卡片共用的唯一一处**。 */
export function messageFor(state: string, isZh: boolean): string {
  return state === 'stale' ? WidgetStrings.stale(isZh) : WidgetStrings.placeholder(isZh);
}
