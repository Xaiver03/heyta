/**
 * 倒数日卡片面的文案接线（移动壳，W8）
 * =====================================
 *
 * 结构在 `@heyta/ui`（`countdown/EventBoard.tsx` + `countdown/model.ts`），这里只剩
 * "把语义结果映射到本端词条"这一层 —— 所以它是 `EventBoardLabels` 的构造器，
 * 字段与共享层一一对应（少给一个**编译期**就报，共享层的 `labels` 是必填的）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 复用的全是 **`web.countdown.*`**，一条同义键都没新增
 *
 * 与 `lib/habits-display.ts` 复用 `web.habits.*`、`lib/quadrant-display.ts` 复用
 * `web.quadrant.*` 是**同一个先例**（那份文件头把这件事叫"已知命名残差"）：
 * "倒数日"这件事四端完全同义，它不属于任何一端，而 `@heyta/ui` 不许 import
 * `@heyta/i18n`、`@heyta/app-host` 也不依赖它（见那两个包的 `dependencies`），
 * 所以"注入 labels"这件事**结构上**必须每端各写一次。
 *
 * ⇒ 同一句话登记两条键 = 迟早有一边改了措辞另一边没跟上。将来合并命名空间时，
 *   这一处与 habits 那一处是**同一次纯改名**（键名换、文案不动）。
 *
 * 唯一在本端新增的词条是「我的」页那**一行入口**（`mobile.countdown.entry{,.hint}`），
 * 它说的是"在这台手机上打开它"，与 web 开关表那句模块说明不是同一句话。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 与 `lib/habits-display.ts` 的**一处刻意不同**：本文件**有** `@heyta/ui` 的值导入
 *
 * `reminders-display.ts` / `habits-display.ts` 那条"只 import 类型"的纪律，理由是
 * **它们自己的单测跑在 node 里**，值导入会把 `react-native` 一起拉进来、整个 spec
 * 文件转译失败。本文件**不写单测**（它就是三十行 `t(key)` 的搬运，没有任何判断可测；
 * 而"每一项都取得到字"这件事由 `screens/CountdownScreen.tsx` 的消费点 +
 * `tests/feature-entries.spec.ts` 的词条对账共同覆盖），所以这里按
 * `lib/date-picker-labels.ts` / `lib/timeline-labels.ts` 的先例直接值导入
 * `formatDayTitleText` —— 日期怎么念是**共享层的一份实现**，
 * 在移动端再写一份 `月/日/周几` 的拼法就是第二套事实源（那正是
 * `habits-display.ts` 文件头为 `HEATMAP_MONTH_KEYS` 道歉的那种副本）。
 *
 * 🔴 于是这条分工要记住：**会被 node 单测值导入的 lib 文件**才要躲开 `@heyta/ui`。
 *    要给它加单测时，第一件事是把 `formatDate` 改成注入，而不是改测试环境。
 */

import type { CountdownEventKind, LocalDate } from '@heyta/domain';
import type { MessageKey } from '@heyta/i18n';
import type { CountdownFilter, EventBoardLabels } from '@heyta/ui';
import { formatDayTitleText } from '@heyta/ui';

import type { Translate } from '../i18n/translate';
import type { CardExportFailureCode } from './card-export-native';

/**
 * 类型档位 → 词条键（穷尽 `switch`，加一档不映射就编译红）。
 *
 * 🔴 用 `switch` 而不是模板串：`` t(`web.countdown.kind.${kind}`) `` 在类型上是 `string`，
 * 少登记一个键不会红，症状是界面把**键名本身**渲染给用户看。
 * 这一份与 `apps/web/src/features/countdown/CountdownView.tsx` 的同名映射**逐字相同**，
 * 差别只在那份文件不能被 node 导入。改一边不改另一边 ⇒
 * `tests/feature-entries.spec.ts` 的「两端消费的倒数日词条集合必须相等」红。
 */
function kindMessageKey(kind: CountdownEventKind): MessageKey {
  switch (kind) {
    case 'countdown':
      return 'web.countdown.kind.countdown';
    case 'anniversary':
      return 'web.countdown.kind.anniversary';
    case 'birthday':
      return 'web.countdown.kind.birthday';
    case 'festival':
      return 'web.countdown.kind.festival';
  }
}

/** 构造共享 `EventBoard` 需要的整份文案。每一项都走真的词条表（缺 key 会抛）。 */
export function eventBoardLabels(t: Translate): EventBoardLabels {
  return {
    empty: t('web.countdown.empty'),
    emptyHint: t('web.countdown.empty.hint'),
    archivedEmpty: t('web.countdown.archived.empty'),
    archivedEmptyHint: t('web.countdown.archived.empty.hint'),
    composerPlaceholder: t('web.countdown.composer.placeholder'),
    add: t('web.countdown.add'),
    pickDate: t('web.countdown.pickDate'),
    formatDate: (date: LocalDate) => formatDayTitleText(date, t),
    filterName: (filter: CountdownFilter) => t(filterMessageKey(filter)),
    viewActive: t('web.countdown.view.active'),
    viewArchived: t('web.countdown.view.archived'),
    faceText: (face, days) =>
      face === 'until'
        ? t('web.countdown.face.until', { days })
        : face === 'today'
          ? t('web.countdown.face.today')
          : t('web.countdown.since', { days }),
    // 🔴 「已经 N 天」与逾期那一句**共用同一条词条**（与 web 同一个理由）：
    //    两处各登记一遍，迟早有一边改了措辞另一边没跟上，
    //    而"审判感"（§2.7 不飘红也不许写成"你错过了"）正是措辞层面的红线。
    ageText: (days) => t('web.countdown.since', { days }),
    badgePinned: t('web.countdown.badge.pinned'),
    pin: t('web.countdown.pin'),
    unpin: t('web.countdown.unpin'),
    edit: t('web.countdown.edit'),
    save: t('web.countdown.save'),
    cancel: t('web.countdown.cancel'),
    archive: t('web.countdown.archive'),
    unarchive: t('web.countdown.unarchive'),
    remove: t('web.countdown.remove'),
    fieldTitle: t('web.countdown.field.title'),
    fieldDate: t('web.countdown.field.date'),
    fieldKind: t('web.countdown.field.kind'),
    kindName: (kind) => t(kindMessageKey(kind)),
    kindUnset: t('web.countdown.kind.unset'),
    yearly: t('web.countdown.yearly'),
    lunar: t('web.countdown.lunar'),
    fieldTemplate: t('web.countdown.field.template'),
    templateDefault: t('web.countdown.template.none'),
    templateName: (slot) => t('web.countdown.template.slot', { slot }),
    // W7：给了这一格才会渲染（与 `onExportCard` **成对**，见共享层注释）。
    // 词条复用 `web.countdown.export` —— 同一件事在两端的名字必须一样，
    // 各起一个键迟早漂成"导出图片 / 导出成品图"两种说法。
    exportCard: t('web.countdown.export'),
    a11yMenu: (title) => t('web.countdown.a11y.menu', { title }),
    a11yCloseMenu: (title) => t('web.countdown.a11y.menuClose', { title }),
    errorPrefix: t('web.countdown.error'),
  };
}

/**
 * 导出失败那一句。**四种因各有各的一句**，共用一句就等于把
 * "这台设备的包里没带导出组件"与"分享面板拒了"说成同一件事 ——
 * 而前者该重装、后者该换个去处，让用户去做错的那件事比不提示更糟。
 *
 * `detail` 是原生**原样**回来的字符串，它**只进日志、不进界面**（理由见函数体里那段：
 * 里面有沙盒绝对路径、平台英文串与跟随系统语言的 `localizedDescription`）。
 */
export function exportFailureText(
  t: Translate,
  error: CardExportFailureCode,
  detail?: string,
): string {
  const sentence =
    error === 'no-module'
      ? t('mobile.countdown.export.noModule')
      : error === 'rasterize-empty'
        ? t('mobile.countdown.export.rasterize')
        : error === 'write-failed'
          ? t('mobile.countdown.export.write')
          : t('mobile.countdown.export.share');
  /**
   * 🔴 `detail` **不上屏**，只进日志。
   *
   * 它的来源全是非 i18n 串：`CardExportModule.kt` 的 `MKDIR_FAILED` 带**沙盒绝对路径**、
   * Java 的 `e.message`、iOS 的 `error.localizedDescription`（跟着系统语言走，中英不定）、
   * RN `Share` 的平台英文串。把它们拼进界面同时违反两条立场：§5「界面里不许出现硬编码文案」，
   * 以及"验证失败页不许回显服务端原始错误"那一族（本仓 09-30 刚在服务端修掉同一个形状）。
   * 但失败**也不许静默吞掉**，所以它走日志通道：可搜索、可对照，只是不进界面。
   */
  if (detail !== undefined && detail !== '') {
    console.warn(`[card-export] ${error}: ${detail}`);
  }
  return sentence;
}

/** 筛选档位 → 词条键（`全部` 与四种类型；穷尽 switch，加一档不映射就编译红）。 */
function filterMessageKey(filter: CountdownFilter): MessageKey {
  switch (filter) {
    case 'all':
      return 'web.countdown.filter.all';
    case 'countdown':
      return 'web.countdown.kind.countdown';
    case 'anniversary':
      return 'web.countdown.kind.anniversary';
    case 'birthday':
      return 'web.countdown.kind.birthday';
    case 'festival':
      return 'web.countdown.kind.festival';
  }
}
