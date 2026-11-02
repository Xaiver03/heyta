/**
 * `@` 提及的**文本语法** —— 纯函数，零 IO，零 UI 依赖
 * =====================================================
 *
 * ## 🔴 为什么 @ 是"文本语法"而不是"富文本芯片"
 *
 * 最直觉的做法是把输入框换成 `contenteditable`，把 `@张三` 变成一个不可分割的
 * DOM 节点。代价在三个地方同时出现，而三处都不是"以后再补"能解决的：
 *
 * 1. **持久化**：草稿现在是 `string`（`assistant-history` / 会话快照都吃它）。
 *    富文本要存一棵树或 HTML，而"上次没发完的半句话"会变成一份要迁移的格式。
 * 2. **复制粘贴**：从别处粘一段带 @ 的话进来，富文本要么吞掉、要么生成一堆
 *    指向不存在实体的芯片。文本则天然降级成"就是这几个字"。
 * 3. **跨端**：Web 有 DOM，RN 没有。同一套交互要在两端各实现一遍富文本编辑器，
 *    而两端漂移的表现是"手机上发出去的消息，电脑上 @ 没生效"。
 *
 * 所以这里的选择是：**文本是唯一事实源，芯片只是它的可视化投影**。
 * 输入框里始终是 `@买牛奶` 这几个字；渲染层把它画成一枚 chip 是**可以随时不做**的
 * 增强，不做也不影响语义。
 *
 * ## 🔴 语法边界：什么算一个 @
 *
 * 这几条都是"不写清楚就会踩"的：
 *
 * - **`@` 前面必须是边界**（行首、空白、或标点）。否则 `zhang@example.com`
 *   会把邮箱后半段当成提及查询 —— 用户打邮箱时弹出一个任务候选列表。
 * - **不能用 `\b`**：JS 的 `\b` 只认 ASCII 单词字符，`@张三` 后面没有边界可言
 *   （中文不是 word char），于是 `@张三的` 与 `@张三` 无法区分。这里改成
 *   **显式终止符集合**，中文标点也在里面。
 * - **带空格的标题要引号**：`@"下周三的评审会"`。任务标题里空格很常见，
 *   不加引号形态就等于"这类任务永远没法 @ 到"。
 * - **空查询是合法的**：用户刚敲下 `@` 那一瞬间查询是空串，此时应当弹出**全部**候选，
 *   而不是"没匹配上"。
 *
 * ## 这一层**不**解析成 taskId
 *
 * 域层不认识"用户当前有哪些任务"，也不该认识（那要看 op-log 的物化状态）。
 * 它只回答"这段文本里有哪些 @、各自查的是什么"。**把 label 映射成 id 是调用方的事**，
 * 映射不上的 @ 就**如实当普通文字**留着 —— 静默删除用户一个字，比 @ 不生效更糟。
 */

/**
 * 光标处正在输入的 `@` 记号。
 *
 * `start` / `end` 是**整段 token 在原文里的区间**（含 `@` 与引号），
 * 调用方按它做替换时不必自己再算一遍下标。
 */
export interface ActiveMention {
  /** 会被替换掉的原文片段，含 `@`（引号形态含两侧引号）。 */
  readonly prefix: string;
  /** `@` 之后的查询串（引号形态里是引号内的内容）。 */
  readonly query: string;
  readonly quoted: boolean;
  readonly start: number;
  readonly end: number;
}

/** 文本里已经成型的一处 @。 */
export interface MentionSpan {
  /** `@` 本身的下标。 */
  readonly start: number;
  /** 记号结束后的下标（不含）。 */
  readonly end: number;
  readonly label: string;
  readonly quoted: boolean;
}

/**
 * token 的终止字符。
 *
 * 🔴 中文标点必须在内：`@张三，下午三点` 里的逗号是句子的一部分，不是标题的一部分。
 * 少了它，`@张三，` 会去匹配一个叫「张三，」的任务。
 */
const TERMINATORS = new Set([
  ' ',
  '\t',
  '\n',
  '\r',
  '，',
  '。',
  '、',
  '；',
  '：',
  '！',
  '？',
  ',',
  '.',
  ';',
  ':',
  '!',
  '?',
  '）',
  ')',
  '】',
  ']',
  '》',
  '>',
  '”',
  '"',
]);

/** `@` 之前允许出现的字符：行首之外，只有这些才算"新起一个提及"。 */
const BOUNDARIES = new Set([
  ' ',
  '\t',
  '\n',
  '\r',
  '（',
  '(',
  '【',
  '[',
  '「',
  '『',
  '《',
  '“',
  '"',
  '，',
  '。',
  '、',
  '；',
  '：',
  '！',
  '？',
  ',',
  '.',
  ';',
  ':',
  '!',
  '?',
  '-',
  '—',
]);

/** 这个 `@` 是不是一个提及的开头（而不是邮箱、变量名里的一部分）。 */
function isMentionStart(text: string, at: number): boolean {
  if (text[at] !== '@') return false;
  if (at === 0) return true;
  const before = text[at - 1] ?? '';
  return BOUNDARIES.has(before);
}

/**
 * 从 `from` 开始扫一个 @ 记号。
 *
 * 引号形态碰到行尾就停（未闭合的引号不会吞掉整段文本）；
 * 普通形态扫到终止符为止。
 */
function scanMention(
  text: string,
  at: number,
): { label: string; end: number; quoted: boolean } | undefined {
  if (!isMentionStart(text, at)) return undefined;
  const after = text[at + 1];

  if (after === '"') {
    const close = text.indexOf('"', at + 2);
    const stop = close === -1 ? text.length : close;
    const label = text.slice(at + 2, stop);
    // 未闭合的引号：label 就是到行尾的内容，end 也停在行尾 —— 这样"还没打完的引号"
    // 也能开始补全，而不是等用户先把引号闭上。
    return { label, end: close === -1 ? stop : close + 1, quoted: true };
  }

  let end = at + 1;
  while (end < text.length && !TERMINATORS.has(text[end] ?? '')) end += 1;
  return { label: text.slice(at + 1, end), end, quoted: false };
}

/**
 * 光标处**正在输入**的 @。
 *
 * 光标必须落在 token 内部（含末尾）；落在 token 之后一格就已经不算"正在输入"了
 * （那时用户已经把这句话说完了，不该再弹候选）。
 *
 * @param text 整段输入文本
 * @param caret 光标位置（0..text.length）
 */
export function activeMention(text: string, caret: number): ActiveMention | undefined {
  const at = Math.min(Math.max(caret, 0), text.length);

  /**
   * 🔴 **正向找最近的 `@`，用同一个 `scanMention`** —— 不是"从光标往回扫"。
   *
   * 往回扫的写法在引号形态上必然出错：`@"下周三 评审会` 里的空格是标签的一部分，
   * 而往回扫一碰到空格就会以为"光标已经不在这个提及里了"。
   * 两套语法（往回找 token 一套、解析 token 另一套）就是两份会漂移的事实源 ——
   * 这里只留一套：找到 `@`，问 `scanMention` 它到哪结束，再看光标在不在里面。
   */
  // ⚠️ `lastIndexOf('@', -1)` 在个别实现里会从 0 重新搜到 0 ⇒ 死循环。
  // 所以 i 到 0 就停，不是让它自己往下退。
  for (
    let i = text.lastIndexOf('@', at - 1);
    i >= 0;
    i = i === 0 ? -1 : text.lastIndexOf('@', i - 1)
  ) {
    if (!isMentionStart(text, i)) continue;
    const scanned = scanMention(text, i);
    if (scanned === undefined) continue;
    // 光标必须落在记号内部（含两端）。落在它之后 ⇒ 这个提及已经说完了。
    if (at <= i || at > scanned.end) continue;

    const queryStart = scanned.quoted ? i + 2 : i + 1;
    const query = text.slice(queryStart, Math.min(at, scanned.end));

    return {
      prefix: text.slice(i, scanned.end),
      query,
      quoted: scanned.quoted,
      start: i,
      end: scanned.end,
    };
  }

  return undefined;
}

/**
 * 把选中的候选写成文本形态。
 *
 * @returns 要插入的文本；`label` 含**无法用这套语法表示**的字符（控制字符、引号本身）时
 *          返回 `undefined` —— 让调用方拒绝这次插入，而不是插进去一个解析不回来的东西。
 */
export function formatMention(label: string): string | undefined {
  const trimmed = label.trim();
  if (trimmed === '') return undefined;
  // 控制字符与引号无法表示：引号会提前闭合并把后半段留在外面。
  if (/[\u0000-\u001f\u007f-\u009f"@]/u.test(trimmed)) return undefined;
  if (/\s/u.test(trimmed)) return `@"${trimmed}"`;
  return `@${trimmed}`;
}

/**
 * 用选中的标签替换光标处那个记号。
 *
 * @returns 替换后的完整文本与新光标位置；光标处没有活动记号时返回 `undefined`
 *          （调用方应当忽略这次选择，而不是在光标处硬插一段文本）。
 */
export function applyMention(
  text: string,
  active: ActiveMention,
  label: string,
): { text: string; caret: number } | undefined {
  const formatted = formatMention(label);
  if (formatted === undefined) return undefined;
  const next = text.slice(0, active.start) + formatted + text.slice(active.end);
  return { text: next, caret: active.start + formatted.length };
}

/**
 * 扫出文本里**所有**已经成型的 @。
 *
 * 用途是发送前把文本里的提及还原成引用（"这条消息 @ 了哪几个任务"）。
 * 同一个标签出现两次就是两处提及，不去重 —— 去重会让"引用清单"与用户写的对不上。
 */
export function findMentions(text: string): readonly MentionSpan[] {
  const spans: MentionSpan[] = [];
  let at = text.indexOf('@');
  while (at !== -1) {
    const scanned = scanMention(text, at);
    if (scanned !== undefined && scanned.label.trim() !== '') {
      spans.push({ start: at, end: scanned.end, label: scanned.label, quoted: scanned.quoted });
      at = text.indexOf('@', scanned.end);
    } else {
      at = text.indexOf('@', at + 1);
    }
  }
  return spans;
}

/**
 * 候选过滤与排序（给候选列表用）。
 *
 * 三条规则，都是为了"打两个字就要看到想选的那个"：
 * 1. **前缀优先**，其次子串 —— 用户多半是从标题开头想起的。
 * 2. **大小写不敏感**，但中文没有大小写，所以只对拉丁字符生效。
 * 3. **空查询返回全部**（按传入顺序）—— 刚敲下 `@` 时不该是空列表。
 */
export function rankMentionCandidates<T>(
  candidates: readonly T[],
  query: string,
  label: (candidate: T) => string,
  limit = 8,
): readonly T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') return candidates.slice(0, limit);

  const starts: T[] = [];
  const contains: T[] = [];
  for (const candidate of candidates) {
    const haystack = label(candidate).toLocaleLowerCase();
    if (haystack.startsWith(needle)) starts.push(candidate);
    else if (haystack.includes(needle)) contains.push(candidate);
    if (starts.length + contains.length >= limit * 4) break;
  }
  return [...starts, ...contains].slice(0, limit);
}
