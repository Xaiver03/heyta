/**
 * `@任务` 的候选与标签
 * ====================
 *
 * 语法层（`mentions.ts`）只认"这段文本里有哪些 @"。到了这里才有**对象**：
 * 哪些任务可以被 @、每一项显示成什么、以及**同一句话里的两个 @ 该不该指向同一个任务**。
 *
 * ## 🔴 这个文件存在的唯一理由：标签必须有唯一解
 *
 * `@买牛奶` 要被还原成 `taskId`，就必须承认一件事：**标题不是主键**。
 * 同一份清单里两条「开会」是完全正常的（一条周一、一条周三）。而解析是
 * "标签 → 任务"的单值映射，于是：
 *
 * - 两条同名任务 ⇒ `@开会` 到底指哪一条？**没有答案**。
 * - 若实现挑"第一个"，用户永远 @ 不到第二条，而且**没有任何提示** ——
 *   表现为"我明明 @ 了，它却关联到另一条"。
 *
 * 所以这里的选择是：**同名时给标签加消歧后缀**（"开会（周三）"）。
 * 代价是标签变长、用户看到的 chip 文案不完全等于标题；换来的是
 * **每个标签都能唯一还原**，并且用户在候选列表里能看见两条不同的项。
 *
 * ⚠️ 消歧后缀取什么：只用**日期**与**清单名**两种，因为它们是用户自己写下来的、
 * 稳定的区分依据。不用 `id` 尾号（`开会 #a3f`）—— 那是给开发者看的，
 * 而这句话最终会被用户读到。
 *
 * ## 这里**不**读 op-log
 *
 * 入参是一份已经物化好的任务数组。理由与 `mentions.ts` 同一条：
 * 纯函数才好测，也才不会被"当前状态"绑死。
 */

import { rankMentionCandidates } from './mentions.js';

/**
 * 候选需要的最小任务形状。
 *
 * ⚠️ 结构化类型而不是 import `Task`：这里的判据只有三格，
 * 而耦合到完整实体（十几个字段）会让这个函数在任何一次实体扩展时都要跟着改签名，
 * 尽管它一个字段都不用。
 */
export interface MentionTaskLike {
  readonly id: string;
  readonly title: string;
  /** 截止日期 `YYYY-MM-DD`（有就用来消歧）。 */
  readonly dueDate?: string | undefined;
  /** 清单名（有就用来消歧）。 */
  readonly projectTitle?: string | undefined;
}

/** 一个可被 @ 的任务。 */
export interface MentionTaskCandidate {
  readonly taskId: string;
  /** 写进文本的那串字（**不含** `@` 与引号）。 */
  readonly label: string;
  /** 候选列表里显示的主标题（永远是原样的任务标题，不带消歧后缀）。 */
  readonly title: string;
  /** 消歧后缀；没有就是 `undefined`。界面可以把它画淡一点。 */
  readonly suffix?: string | undefined;
}

/**
 * 尾部 5 个字相同的标题要当成"看起来一样"。
 *
 * 判据来自界面：候选列表里一行只有那么宽，用户扫的是**尾部**
 * （"周会 / 项目周会 / 客户周会"在视觉上比"周会一 / 周会二"更好分）。
 * ⚠️ 这一条只影响**给不给后缀**，不影响解析 —— 解析永远按完整标签精确匹配。
 */
function disambiguatorFor(
  task: MentionTaskLike,
  all: readonly MentionTaskLike[],
): { suffix: string | undefined; needs: boolean } {
  const sameTitle = all.filter((other) => other.title.trim() === task.title.trim());
  if (sameTitle.length <= 1) return { suffix: undefined, needs: false };

  // 优先用日期，其次清单名；两者都没有就只能靠"第几条"——那说明数据本身没给区分依据。
  if (task.dueDate !== undefined && task.dueDate !== '') {
    return { suffix: task.dueDate.slice(5), needs: true };
  }
  if (task.projectTitle !== undefined && task.projectTitle !== '') {
    return { suffix: task.projectTitle, needs: true };
  }
  const index = sameTitle.findIndex((other) => other.id === task.id);
  return { suffix: `#${String(index + 1)}`, needs: true };
}

/**
 * 把任务变成候选（带消歧后缀）。
 *
 * 没有重名的任务**不加后缀** —— 这是绝大多数情况，而给每个标签都加日期会让
 * `@买牛奶（08-15）` 这种冗余后缀淹掉正文。
 */
export function mentionCandidatesFor(
  tasks: readonly MentionTaskLike[],
): readonly MentionTaskCandidate[] {
  return tasks.map((task) => {
    const title = task.title.trim();
    const { suffix, needs } = disambiguatorFor(task, tasks);
    return needs && suffix !== undefined
      ? { taskId: task.id, title, label: `${title}（${suffix}）`, suffix }
      : { taskId: task.id, title, label: title };
  });
}

/**
 * 按查询串给出候选。
 *
 * 过滤与排序交给 `rankMentionCandidates`（前缀优先、中文友好）——
 * 这里只负责"哪些任务可被 @ + 它们叫什么"。
 *
 * ⚠️ **标题为空的任务不进候选**：空标签会让语法层的 `label.trim() === ''`
 * 把它当普通文字，于是候选里有一条**点了没反应**的项。
 */
export function mentionCandidates(
  tasks: readonly MentionTaskLike[],
  query: string,
  limit = 8,
): readonly MentionTaskCandidate[] {
  const eligible = tasks.filter((task) => task.title.trim() !== '');
  const all = mentionCandidatesFor(eligible);
  return rankMentionCandidates(all, query, (candidate) => candidate.label, limit);
}

/**
 * 从标签还原成 taskId。
 *
 * 🔴 **精确匹配**，不做前缀/模糊匹配：模糊匹配会让"@开会"命中"@开会（周三）"，
 * 而用户根本没有打过后者。宁可不解析（`undefined`，界面上如实当普通文字），
 * 也不要猜一个错的任务 —— 猜错的后果是"我以为 @ 的是周三那条"。
 */
export function mentionLookupFor(
  tasks: readonly MentionTaskLike[],
): (label: string) => string | undefined {
  const byLabel = new Map<string, string>();
  for (const candidate of mentionCandidatesFor(tasks)) {
    // 同一个标签出现两次说明消歧失败了（数据异常）。这时**两条都不登记**，
    // 让 `@` 如实落到 unresolved —— 比随机挑一条好。
    if (byLabel.has(candidate.label)) {
      byLabel.set(candidate.label, '');
      continue;
    }
    const existing = byLabel.get(candidate.label);
    if (existing === '') continue;
    byLabel.set(candidate.label, candidate.taskId);
  }
  return (label: string) => {
    const id = byLabel.get(label.trim());
    return id === undefined || id === '' ? undefined : id;
  };
}
