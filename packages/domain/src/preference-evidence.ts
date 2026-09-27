/**
 * 偏好的「结构化事实」与它的中文投影
 * ====================================
 *
 * 🔴 为什么要有这个文件：`Preference.evidence` 是**界面文案**（类型注释里
 * 自己写着"给用户看的原话"），但它是一句**领域层拼好的中文**。
 * 两个壳把它直接渲染出来，于是英文界面永远露中文 —— 而 `check:ui-language`
 * 扫不到，因为壳里渲染的是**变量**，不是字面量。
 *
 * 修法和 `packages/storage` 的 `StorageFailure`、`packages/ai` 的
 * `EndpointHealthDisclosure` **一模一样**：**先给事实，再给句子**。
 * 事实是结构化的（数字、方向、样本量），句子是投影。
 *
 *   - 壳拿 `evidenceFacts` 按 `kind` 取自己的词条（中英各一份）；
 *   - 领域层的 `preferenceEvidenceText()` 是**中文投影**，
 *     保留给已有的领域测试与任何非界面消费者 —— 它由事实生成，
 *     所以「句子」和「事实」**不可能漂移**（这正是投影的意义）。
 *
 * ⚠️ `PreferenceId` 与这里的 `kind` 是**一一对应**的（7 对 7）。
 * 下面那条类型断言就是保证：**新加一种偏好却忘了给事实形状 → 编译报错**。
 * 否则壳里那一条会永远显示不出来，而没有任何测试会红。
 */

import type { PreferenceId } from './preferences.js';

/** 一条偏好"凭什么这么说"的原始事实。**只有事实，没有措辞。** */
export type PreferenceEvidence =
  | {
      readonly kind: 'estimate-bias';
      /** 实际用时 / 计划用时。>1 倾向低估，<1 倾向高估。 */
      readonly multiplier: number;
      readonly samples: number;
    }
  | {
      readonly kind: 'deep-work-window';
      readonly startHour: number;
      readonly endHour: number;
      /** 落在窗口内的专注占比（0–1）。 */
      readonly concentration: number;
      readonly samples: number;
    }
  | {
      readonly kind: 'lead-time';
      /** 提前为正、逾期为负（天）。 */
      readonly days: number;
      readonly samples: number;
    }
  | {
      readonly kind: 'granularity';
      readonly items: number;
      readonly samples: number;
    }
  | {
      readonly kind: 'title-style';
      readonly cjkShare: number;
      readonly medianTitleLength: number;
      readonly emojiShare: number;
      readonly samples: number;
    }
  | {
      readonly kind: 'feedback-granularity';
      readonly items: number;
      readonly adopted: number;
    }
  | {
      readonly kind: 'feedback-keep-ratio';
      /** 保留比例（0–1）。 */
      readonly ratio: number;
      readonly adopted: number;
    };

/**
 * 🔴 每一种 `PreferenceId` 都必须有一种事实形状。
 *
 * 双向包含 → 两个集合相等。少一个（新加偏好忘了加事实）就编译不过。
 */
type AssertSame<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _EVERY_PREFERENCE_HAS_FACTS: AssertSame<PreferenceId, PreferenceEvidence['kind']> = true;
void _EVERY_PREFERENCE_HAS_FACTS;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * 小时 → `09:00` 这种钟点文本。**中性格式，不是文案**，所以不进词条表。
 *
 * 导出给外壳用：壳要自己拼中英句子，而"09:00"这种写法两种语言一样 ——
 * 让壳各写一份，就迟早会有一边写成"9:00"。
 */
export const clockText = (h: number): string => `${pad2(h)}:00`;

/**
 * 中性的天数写法：不足一天用一位小数，其余取整。
 *
 * 同样导出给外壳 —— "几位小数"是中性格式，不是中文也不是英文的正字法。
 */
export function roundedDaysText(days: number): string {
  const abs = Math.abs(days);
  return abs < 1 ? abs.toFixed(1) : String(Math.round(abs));
}

/**
 * 事实 → 中文句子（**投影**，不是第二个真源）。
 *
 * 「中性的天数写法」「钟点文本」这类**正字法**留在这里，不进词条表 ——
 * 词条表只管句子，正字法按语言各写一份（与 `LIST_SEPARATOR` 同一个先例）。
 */
export function preferenceEvidenceText(facts: PreferenceEvidence): string {
  switch (facts.kind) {
    case 'estimate-bias': {
      const ratio = facts.multiplier.toFixed(2);
      if (facts.multiplier > 1.05) {
        return `基于 ${facts.samples} 次专注，你倾向低估任务耗时 —— 实际用时约为计划的 ${ratio} 倍`;
      }
      if (facts.multiplier < 0.95) {
        return `基于 ${facts.samples} 次专注，你倾向高估任务耗时 —— 实际用时约为计划的 ${ratio} 倍`;
      }
      return `基于 ${facts.samples} 次专注，你的时间估计很准（实际约为计划的 ${ratio} 倍）`;
    }
    case 'deep-work-window': {
      const pct = Math.round(facts.concentration * 100);
      return `基于 ${facts.samples} 次专注，${pct}% 集中在 ${clockText(facts.startHour)}–${clockText(facts.endHour)}`;
    }
    case 'lead-time': {
      const rounded = roundedDaysText(facts.days);
      if (facts.days > 0.5) {
        return `基于 ${facts.samples} 个已完成任务，你平均提前 ${rounded} 天完成`;
      }
      if (facts.days < -0.5) {
        return `基于 ${facts.samples} 个已完成任务，你平均逾期 ${rounded} 天完成`;
      }
      return `基于 ${facts.samples} 个已完成任务，你通常在截止当天完成`;
    }
    case 'granularity':
      return `你的 ${facts.samples} 条带清单任务，中位数是 ${facts.items} 项`;
    case 'title-style': {
      // ⚠️ 这里的措辞是**披露给用户**的那一套（`以中文为主`），
      // 与 `preference-hints.ts` 注入 prompt 的那一套（`任务标题以中文为主，…请保持同样的风格`）
      // **刻意不同**：一个给用户看，一个给模型看。
      // 我第一版照提示词那套抄，领域测试当场抓到（`以中文为主` 不见了）。
      const lang =
        facts.cjkShare >= 0.8 ? '以中文为主' : facts.cjkShare <= 0.2 ? '以英文为主' : '中英混用';
      const emoji = facts.emojiShare >= 0.2 ? '，常用 emoji' : '';
      return `基于 ${facts.samples} 条任务，你的标题${lang}，平均 ${Math.round(facts.medianTitleLength)} 个字${emoji}`;
    }
    case 'feedback-granularity':
      return `基于你采纳的 ${facts.adopted} 次拆解，通常是 ${facts.items} 项`;
    case 'feedback-keep-ratio': {
      const pct = Math.round(facts.ratio * 100);
      if (facts.ratio >= 0.9) {
        return `基于 ${facts.adopted} 次采纳，你几乎总是全部保留 AI 的拆解`;
      }
      if (facts.ratio <= 0.3) {
        return `基于 ${facts.adopted} 次采纳，你通常只留下 ${pct}% —— AI 给得太多了`;
      }
      return `基于 ${facts.adopted} 次采纳，你通常留下约 ${pct}% 的拆解项`;
    }
  }
}