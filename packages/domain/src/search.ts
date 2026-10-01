/**
 * 任务搜索 —— **"什么算匹配"只有一个定义**
 * ==========================================
 *
 * 🔴 与 `task-filter.ts` 同一条理由（M1）：搜索的**判据**是产品语义
 * （匹配哪些字段、大小写怎么处理、多个词是"都要"还是"有一个就行"），
 * 而它此前**根本不存在**。放在 `apps/*` 里就意味着第二端要再写一遍，
 * 而两份实现的差别不会报错，只会让"同一个词在网页上搜得到、在手机上搜不到"。
 *
 * ## 三件刻意定死的事（都是判断题，不是实现细节）
 *
 * 1. **匹配哪些字段：只匹配任务自己的文本（`title` + `note`）。**
 *    刻意**不**匹配清单名 / 标签名。理由是那需要调用方把名字解析出来传进来，
 *    而"某条任务属于哪个清单"不是 `Task` 自带的（它只有 `projectId`）——
 *    让这个纯函数去依赖一张外部表，会把"搜索"变成"搜索加一次联表"，
 *    而每个宿主的联表方式还不一样。**清单/标签的筛选是另一件事**：
 *    那由 `task-filter.ts` 的 `{kind:'project'}` / `{kind:'tag'}` 负责，
 *    用户想按清单找就该点清单，而不是在一个全局搜索框里碰运气。
 *
 * 2. **大小写不敏感，用 `toLowerCase()`。**
 *    ⚠️ 它**不是**完整的 Unicode case folding（土耳其语的 `İ` 之类会怪），
 *    但那些是真实的边界情况，而错误的 case folding 比不做更让人意外。
 *    中日韩没有大小写，`toLowerCase()` 对它们是恒等变换 —— 这一点很重要，
 *    因为中文用户占我们的大多数，而"中文搜索要不要分词"是个**假问题**：
 *    子串匹配就够了（见第 3 条）。
 *
 * 3. **多个词是"都要"（AND），按空白切分。**
 *    `"写 周报"` 要求标题或备注里**同时**出现"写"和"周报"（可以在不同字段里）。
 *    选 AND 而不是 OR：搜索框里多打一个词，用户期待的是**结果变少**；
 *    变多的话他会以为搜索坏了。AND 也是唯一能让人"逐步收窄"的语义。
 */

import type { Note, Task } from './entities.js';

/** 一条任务里**可被搜索**的字段。加字段时这里与 `haystackOf` 一起改。 */
export interface SearchableText {
  readonly title: string;
  /** 备注（Markdown）。它可能很长，所以也参与匹配 —— 用户记得自己写过什么。 */
  readonly note?: string;
}

/**
 * 把一条任务的文本摊成一个可用于匹配的串。
 *
 * 🔴 **只读 `title` / `note`**（见文件头第 1 条）。摊平时用一个不可能出现在
 * 正常文本里的分隔符（换行）把字段隔开，避免"标题结尾 + 备注开头"拼出一个
 * 跨字段的假匹配 —— 那种匹配用户永远找不到自己搜的是哪一段。
 */
export function haystackOf(task: SearchableText): string {
  return `${task.title}\n${task.note ?? ''}`.toLowerCase();
}

/**
 * 一条任务是否匹配查询串。
 *
 * 空查询**匹配一切** —— 这与"筛选框清空时不过滤"是同一件事。
 * 让调用方去判空的话，每个调用点都要写一遍 `if (q.trim() === '') return all`，
 * 而漏写的那一处会让"清空搜索框之后列表空了"。
 */
export function matchesQuery(task: SearchableText, query: string): boolean {
  const terms = termsOf(query);
  if (terms.length === 0) return true;
  const hay = haystackOf(task);
  return terms.every((term) => hay.includes(term));
}

/**
 * 便签 → 可搜索文本。
 *
 * 🔴 **便签没有 `title`，正文在 `content`** —— 所以不能把 `Note` 直接传给
 * `matchesQuery`（它读的是 `title`）。这里把 `content` 放进 `title` 位：
 * `SearchableText.title` 的语义是"**主要文本**"，不是"标题"。
 *
 * ⚠️ 为什么不给便签也加一个 `title` 字段：那是**持久化字段**的变更
 *（要走 schema 纪律 + 迁移），而这里要的只是"按内容找得到它"。
 * 为了一处展示需求去改实体形状是本末倒置。
 */
export function noteSearchText(note: Note): SearchableText {
  return { title: note.content };
}

/**
 * 按查询串过滤一组便签。
 *
 * 与 `searchTasks` 共用 `termsOf` / `matchesQuery` —— 于是
 * "多词按 AND 收窄"、"空查询匹配一切"这两条语义两端各只有一处定义。
 */
export function searchNotes(notes: readonly Note[], query: string): Note[] {
  const terms = termsOf(query);
  if (terms.length === 0) return [...notes];
  return notes.filter((note) => matchesQuery(noteSearchText(note), query));
}

/** 按查询串过滤一组任务。**顺序不动** —— 排序是调用方的事（见 `task-filter.ts`）。 */
export function searchTasks(tasks: readonly Task[], query: string): Task[] {
  const terms = termsOf(query);
  if (terms.length === 0) return [...tasks];
  return tasks.filter((task) => matchesQuery(task, query));
}

/**
 * 把查询串切成词。
 *
 * `toLowerCase()` 之后按**连续空白**切，并丢掉空串 ——
 * 于是 `" 写   周报 "` 得到 `['写', '周报']`，而不是四个词里夹两个空。
 *
 * 🔴 **已导出**（此前是本模块私有）：`packages/ui` 的搜索面板要用**同一套**
 * 切词规则去匹配「快速跳转」的入口名。留两份切词实现，就会出现
 * "任务里『写 周报』是 AND、跳转项里却是 OR" —— 同一个框两种语义，
 * 而它不报错，只让用户以为搜索时好时坏（AGENTS §3.5 里那类漂移）。
 */
export function termsOf(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter((t) => t !== '');
}
