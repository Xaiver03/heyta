/**
 * AI 输出的语言 —— 绑定界面语言。
 *
 * 🔴 这一条解决的是**概率性的数据污染通道**：提示词本身是中文（它是给模型的
 * 指令，不是界面文案），模型于是倾向于用中文回话。英文界面用户点"确认"之后，
 * 那条中文标题 / 那份中文子项清单会**写进用户数据并同步到所有设备**
 * （`ai-breakdown.ts` 的 `mergeChecklistIntoNote` 就是落备注的那条路）。
 * 也就是说：提示词语言泄漏出去的不是界面文案，而是**存量数据**。
 *
 * 所以规则是：**指令可以一直是中文，输出语言必须跟着界面走。**
 *
 * ⚠️ 为什么这里不 `import type { Locale } from '@heyta/i18n'`：
 * app-host 是宿主无关的接线层，词条表是壳的依赖（本仓库只有 `apps/*` 依赖
 * `@heyta/i18n`，加这条边会让 packages/ 反向依赖界面词表）。
 * 两边的一致性靠**赋值兼容**钉住：壳把 `Locale` 传进 `locale` 字段时，
 * 若 i18n 加了第三种语言而这里没加，`Locale`（三成员）赋给 `AiOutputLocale`
 * （两成员）**直接编译不过** —— 这是刻意的 forcing function，
 * 它把"加语言"的待办精确地指向本文件这张表。
 */

/** 会被写进提示词「输出语言」指令的界面语言。见文件头对 `Locale` 的说明。 */
export type AiOutputLocale = 'zh-CN' | 'en';

/**
 * 每种界面语言对应的输出语言指令。
 *
 * 🔴 用 `Record<AiOutputLocale, string>` 而不是 `switch` + `default`：
 * 加一种语言时这里必须补一行，补不出来就编译不过。
 * 语言名用**该语言自己的写法**（简体中文 / English）—— 这是给模型看的，
 * 模型对"用英文解释 English"这种自指指令的遵循度明显更高。
 */
const OUTPUT_LANGUAGE_DIRECTIVE: Record<AiOutputLocale, string> = {
  'zh-CN':
    '输出语言：界面语言是简体中文。所有**给人看**的文字（标题、子项、理由）一律用简体中文。',
  en: '输出语言：界面语言是 English。所有**给人看**的文字（标题、子项、理由）一律用 English 输出，**即使本提示词的其余部分是中文** —— 不要把标题写成中文。',
};

/**
 * 追加在指令末尾的不变部分：**机器可读的字节不许翻译**。
 *
 * ⚠️ 单独拆出来是因为它**与语言无关**，而且漏了会直接坏掉解析：
 * `parseCaptureResult` 按 `"title"` / `"dueDate"` / `"priority"` 取键，
 * 优先级按 `"high" | "medium" | "low"` 判定，`prioritize` 按输入里的 `id` 回填。
 * 模型若把这些"顺手翻译"了，结果是**解析失败**（对用户是"没法读成任务字段"），
 * 而不是"输出成了另一种语言"。
 */
const MACHINE_READABLE_CLAUSE =
  '机器可读的部分保持原样、不要翻译：JSON 的键名、任务 id、枚举取值（如 "high" / "medium" / "low"）、日期格式。';

/**
 * 「输出语言」这一段。调用方把它拼进 `system`。
 *
 * ⚠️ 只进 `system`，不进 `user`，也不进 `fields`：`fields` 是**用户数据字段**的词表
 * （披露说"将要送出这些字段"），把指令名塞进去会让披露变成用户读不懂的东西。
 * 界面语言不是用户提交的数据，是本机的指令参数。
 */
export function outputLanguageDirective(locale: AiOutputLocale): string {
  // 🔴 编译期挡不住无类型的 JS 调用方（`scripts/verify-ai-*-live.mjs` 直接 import `dist`）。
  // 让它带着 `undefined` 走下去不会报错 —— 只会发出一条写着「输出语言：undefined」的
  // 真请求，而探针照常判绿。宁可在装配这一步就炸。
  const directive = OUTPUT_LANGUAGE_DIRECTIVE[locale];
  if (directive === undefined) {
    const supported = Object.keys(OUTPUT_LANGUAGE_DIRECTIVE).join(' / ');
    throw new Error(
      `不支持的 AI 输出语言：${String(locale)}。可选：${supported}（新增语言要在 OUTPUT_LANGUAGE_DIRECTIVE 里补一行）。`,
    );
  }
  return `${directive}\n${MACHINE_READABLE_CLAUSE}`;
}
