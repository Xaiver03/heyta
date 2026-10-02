#!/usr/bin/env node
/**
 * 生成**发给模型**的产品级 AI 能力清单（W9 / ADR-0045 §2.6 纪律一）
 * ================================================================
 *
 * ```sh
 * node scripts/gen-ai-capability-manifest.mjs          # 写盘
 * node scripts/gen-ai-capability-manifest.mjs --check  # 只校验（门禁用），不一致 exit 1 并打印差异
 * node scripts/gen-ai-capability-manifest.mjs --print  # 把产物打到 stdout，不落盘（排查用）
 * ```
 *
 * 产物：`packages/ai/src/capability-manifest.generated.ts`
 * —— 同一个生成器产出两份东西：**结构化清单** + **给模型的文本投影**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 为什么这件事只能"生成"，不能手写
 *
 * 2026-10-02 的审计（`docs/research/dida-ai-assistant-gap-analysis.md` §2.1）实测到竞品的一句
 * **产品谎言**：滴答助手对用户说"纪念日在我们只能查看、不能新建"。那句话**对模型是实话**
 * （它的工具表里确实只有 `list_countdowns` 一个只读工具），**对使用者是错的**
 * —— 它的产品支持公历/农历生日 + 多提醒 + 重复，只是**没给 AI 配那个工具**。
 *
 * 要让 heyta 的模型能说"**我做不到，但产品做得到**"，前提是一份准确的
 * 「哪个实体、有没有工具、是读还是写」的清单。而清单一旦手写就会漂：
 *
 * · 目录（`packages/local-api/src/tools.ts`）是**唯一**事实源，且它随 W10 要继续扩；
 * · 助手侧不再逐工具授权之后（ADR-0045 §2.2），**目录每加一个工具，AI 就多一个能力** ——
 *   手工维护的清单在目录一扩的当天就开始说谎；
 * · 🔴 漂了的清单**主动**制造错误结论：模型会拿着旧清单**自信地**说"这个产品没有"。
 *
 * 所以本脚本的存在形式是刻意的：**它不复制任何产品结论，只把上游的结构搬过来**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 上游读的是运行时的真身，不是第二份解析器
 *
 * | 事实 | 来源 | 取法 |
 * |---|---|---|
 * | 工具名 / 读还是写 / 给模型看的说明 | `@heyta/local-api` 的 `LOCAL_API_TOOLS` | **import 构建产物** |
 * | 每个工具的参数（字段名 / 类型 / 必填） | `@heyta/local-api` 的 `listAuthorizedTools()` | **同一个投影**：内置 AI 与 MCP 客户端看到的正是它（ADR-0035） |
 * | 哪些实体真的被物化 | `@heyta/domain` 的 `MODELED_ENTITY_TYPES` | import（`EntityModelMap` 的键在编译期已被它钉住） |
 * | 协议认识的全部实体类型 | `@heyta/shared-schema` 的 `ENTITY_TYPES` | import |
 *
 * ⚠️ 之所以取 dist 而不是再写一个源码正则解析器：同一个判断写两遍必然漂移
 * （AGENTS §3.5 那条教训，`check:ai-coverage.mjs` 里也逐字记着同一个理由）。
 * 🔴 因此**依赖 `pnpm build`** —— `pnpm check` 会先构建，单独跑本脚本时若缺产物会
 * **响亮失败并说明怎么补**，而不是"读不到就当没问题"。
 *
 * 唯一一处**读源码文本**的地方是 `mcp.ts` 的 `INPUT_SCHEMAS` 键集合。
 * 它只回答一个 dist 答不了的问题：「这个工具的参数 schema **有没有被人登记过**」——
 * `listAuthorizedTools()` 对没登记的工具回退成空 `properties`，与"这个工具确实不接参数"
 * （`list_projects`）在 dist 层面长得**一模一样**。所以：
 * · 值（字段名 / 类型）来自 dist；
 * · "有没有登记"这个结构事实来自源码键名。
 * 两处不重叠，也就不存在第二份判断。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 分母口径是钉死的（ADR-0045 §2.7，照做、不重算）
 *
 * `EntityModelMap` 有 **10** 个成员，但：
 * · `AI_FEEDBACK` / `PREFERENCE_CORRECTION` 是 AI 反馈与偏好纠正的**落库载体**，
 *   用户不直接创建 ⇒ 从分母剔除 ⇒ 分母是 **8**；
 * · **四象限 / 今天 / 日历 / 搜索不是实体**（`shared-schema` 的 `entity-types.ts`
 *   设计原则第 2 条"视图不建实体"）⇒ **不进分母**，否则分母会随视图增删漂移；
 * · `TASK_REPEAT_CFG` 在 `ENTITY_TYPES` 里但**不在** `EntityModelMap` ⇒ 它算"动作"
 *   不算"已物化实体"，单独一段陈述，不混进"有实体没工具"那句里。
 *
 * 🔴 上面这些**名单**（剔除项、视图名、系统实体）是手写的吗？是，但它们是**判据**不是**内容**，
 * 而且每一条都被上游反着钉住：剔除项/系统实体必须**真的在**上游清单里，视图名必须**真的不在**
 * 上游清单里 —— 任何一边变化都让生成本身失败，逼人重新做一次判断（见 `buildCapabilityManifest()`）。
 * 这与"手写一份清单"是两件相反的事：清单的**内容**（谁有工具、哪个工具是读、有哪些字段）
 * 一个字都不在这里，全部从上游推出来。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 什么情况会**当场失败**（而不是静默少一条）
 *
 * 1. 目录里某个工具**无法判定作用在哪个实体**（名字推不出来、也没有登记 override）
 *    ⇒ 红。这是"清单跟随上游"的承重结构：新工具不可能被静默漏掉。
 * 2. 工具被归到一个**没有领域模型**的实体（例如 `EVENT` 还没落地就先上了它的工具）
 *    ⇒ 红，并点名 ADR-0044/0045 §2.6 那条"实体与它的 AI 工具**同批**"。
 * 3. `mcp.ts` 里有 schema 键、目录里却没有这个工具（孤儿抄件）⇒ 红。
 * 4. 工具名重复 / `kind` 不是 `read|write` / 上游清单为空 / 剔除项已从 `EntityModelMap` 消失
 *    / 视图名变成了实体 ⇒ 全部红。
 *
 * 只有一种情况**刻意不失败**：工具在 `mcp.ts` 里没有登记参数 schema。
 * 那种工具仍然可用（MCP 侧的回退就是为此存在的），所以清单**照样出**，
 * 但带上 `schemaRecorded: false` 标记，并在文本投影里**明说**"这个工具的字段清单不完整" ——
 * 让模型知道自己看到的可能是不全的，比让整个门禁红更值钱。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 产物里为什么**没有中文实体名**（一条刻意的缺席）
 *
 * 界面词表里各实体散在完全不同的 key 下（`web.shell.nav.tasks` / `web.shell.modules.notes.label` /
 * `web.shell.views.habits`……），而 `HABIT_LOG` 根本没有一个"它叫什么"的词条。
 * 也就是说仓库里**目前不存在**「实体 → 界面词」的单一事实源。手抄一份就是 §2.6 禁止的第二份，
 * 而且它抄的恰好是最容易漂的那一类（改个导航名就过期）。
 * ⇒ 产物只说类型常量（`TASK` / `HABIT_LOG`），界面词与"路径 Y"留给 W12（对话外壳）一起定。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 与 `check:ui-language` 的边界（W9 明确核对过）
 *
 * 产物与文本投影里的中文是**发给模型的 prompt 数据**，不是用户界面文案 —— 它不进词条表、
 * 不需要英文对照、也不该被 i18n 的 `t()` 接管（`t()` 出来的会是给用户看的句子，
 * 而这里每一句都是给模型的事实句）。`check:ui-language` 的扫描根是 `apps/{web,landing,mobile}/src`
 * （见 `scripts/check-ui-language.mjs` 的 `ROOTS`），**不含 `packages/ai/src`**，
 * 所以它不会把这份产物当界面文案拦下来。
 * 🔴 反过来也一样成立：本生成器**不往 `apps/**` 写任何东西**，界面文案的事实源仍然只有
 * `packages/i18n`。这两件事都在 W9 实跑过 `pnpm check:ui-language` 核对。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 变异验证（2026-10-03 实测，三条都会红）
 *
 * 1. 手改产物一个字节 ⇒ `--check` 红（`MANIFEST=DIFF`，并打印首个差异行）。
 * 2. fixture 的目录里加一个工具、不重新生成 ⇒ 判据红
 *    （`packages/ai/tests/capability-manifest.spec.ts` 既验"builder 跟着输入走"，
 *    也验"产物 == 上游重生成"）。
 * 3. 把分母从 8 改成 9（塞一个视图名进产物）⇒ **两条**红：
 *    分母逐条对账 + `--check`。结构上也进不来：往 builder 输入塞 `QUADRANT` 会直接抛
 *    「视图不建实体」。
 *
 * `manifestVersion` 是**这份产物自己的结构版本**，与 `CURRENT_SCHEMA_VERSION` 无关
 * —— 它不落盘、不进线协议，改它不代表任何用户数据迁移（AGENTS §3.3 那堵墙不在这里）。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = join(ROOT, 'packages/ai/src/capability-manifest.generated.ts');

/** 产物自身的结构版本（见文件头：不是 `CURRENT_SCHEMA_VERSION`）。 */
const MANIFEST_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────
// A. 口径：从上游清单里剔除谁、哪些名字不是实体
// ─────────────────────────────────────────────────────────────────────────

/**
 * 从**分母**里剔除的已物化实体（ADR-0045 §2.7）。
 *
 * 🔴 这两个不是"还没做工具"，而是**用户根本不直接创建它们**：
 * 它们是 AI 反馈与偏好纠正的落库载体。把它们算进分母，
 * "AI 覆盖面 = 界面功能面"那条门禁就会永远追一个不存在的需求。
 */
export const DENOMINATOR_EXCLUSIONS = Object.freeze([
  { entityType: 'AI_FEEDBACK', reason: 'AI 建议处置的落库载体（用户不直接创建它）' },
  { entityType: 'PREFERENCE_CORRECTION', reason: '偏好纠正的落库载体（用户不直接创建它）' },
]);

/**
 * **视图**的名字：它们在产品里是功能，但不是实体（`shared-schema` 的 `entity-types.ts`
 * 设计原则第 2 条）。它们仍然**应该**有工具（"帮我排四象限""搜便签"），
 * 但绝不出现在实体覆盖的分母里 —— 否则门禁的分母会随视图增删漂移。
 *
 * 🔴 这些名字被 `buildCapabilityManifest()` 反向钉住：任何一个真的进了 `ENTITY_TYPES`，
 * 生成当场失败，这条陈述就不会烂成谎话。
 */
export const NON_ENTITY_VIEWS = Object.freeze(['QUADRANT', 'TODAY', 'CALENDAR', 'SEARCH']);

/**
 * 同步协议的基础设施实体 —— 它们在 `ENTITY_TYPES` 里，但既不是产品功能、
 * 也不该有工具（`entity-types.ts` 设计原则第 3 条"系统实体保留，不能删"）。
 */
export const SYSTEM_ENTITY_TYPES = Object.freeze([
  'GLOBAL_CONFIG',
  'MIGRATION',
  'RECOVERY',
  'ALL',
]);

// ─────────────────────────────────────────────────────────────────────────
// B. 工具 → 实体 的判定规则（**规则**，不是清单内容）
// ─────────────────────────────────────────────────────────────────────────

/** 工具名的前缀是动词，判定实体时先剥掉。 */
const VERB_PREFIXES = new Set([
  'list',
  'get',
  'fetch',
  'read',
  'find',
  'search',
  'create',
  'add',
  'new',
  'update',
  'set',
  'edit',
  'patch',
  'upsert',
  'delete',
  'remove',
  'purge',
  'restore',
  'complete',
  'uncomplete',
  'reopen',
  'check',
  'uncheck',
  'log',
  'record',
  'mark',
  'start',
  'stop',
  'pause',
  'resume',
  'snooze',
  'dismiss',
  'move',
  'pin',
  'unpin',
  'archive',
  'unarchive',
  'reorder',
  'count',
]);

/**
 * 名词 → 实体类型。刻意**不收**含糊的名（`session` 既能指专注会话也能指对话会话，
 * `folder` 在 heyta 是"一层文件夹"而不是一个实体）—— 宁可让判定失败、逼一次人判断。
 *
 * 🔴 `EVENT`（倒数日 / 纪念日）**已经在表里**，但它在 `EntityModelMap` 里还不存在。
 * 于是"先上 `list_countdowns`、后落实体"这种顺序会被 `buildCapabilityManifest()` 当场拒掉 ——
 * 这正是 ADR-0045 §2.6 与 ADR-0044 咬合（"实体与它的 AI 工具**同批**"）的机器化。
 */
const ENTITY_NOUNS = new Map(
  Object.entries({
    task: 'TASK',
    tasks: 'TASK',
    todo: 'TASK',
    todos: 'TASK',
    project: 'PROJECT',
    projects: 'PROJECT',
    tag: 'TAG',
    tags: 'TAG',
    note: 'NOTE',
    notes: 'NOTE',
    habit: 'HABIT',
    habits: 'HABIT',
    habit_log: 'HABIT_LOG',
    habit_logs: 'HABIT_LOG',
    habit_checkin: 'HABIT_LOG',
    habit_checkins: 'HABIT_LOG',
    checkin: 'HABIT_LOG',
    checkins: 'HABIT_LOG',
    focus: 'FOCUS_SESSION',
    focuses: 'FOCUS_SESSION',
    pomodoro: 'FOCUS_SESSION',
    pomodoros: 'FOCUS_SESSION',
    reminder: 'REMINDER',
    reminders: 'REMINDER',
    alarm: 'REMINDER',
    alarms: 'REMINDER',
    event: 'EVENT',
    events: 'EVENT',
    countdown: 'EVENT',
    countdowns: 'EVENT',
    anniversary: 'EVENT',
    anniversaries: 'EVENT',
  }),
);

/**
 * 介词之后的 token 是**限定语**（按什么筛、在哪个范围里），不是被操作的对象。
 * 没有这条切分，`list_tasks_by_project` 会被判成 PROJECT —— 而它改的是任务。
 */
const PREPOSITIONS = new Set(['by', 'in', 'on', 'at', 'for', 'to', 'from', 'with', 'of', 'and']);

/**
 * 按名字判定不出实体的工具，在这里**逐个点名**并写明理由。
 *
 * 🔴 它是逃生门，不是主路：键必须是目录里真实存在的工具（否则 `buildCapabilityManifest()` 红 ——
 * 这条校验是防"逃生门变成第二份手写清单"的，工具删了而这条还留着，
 * 于是后来人以为它还在）。
 */
export const TOOL_ENTITY_OVERRIDES = Object.freeze({});

/**
 * 由工具名判定它作用在哪个实体：**剥前导动词 → 切掉介词之后的限定语 → 复合名优先、
 * 再从尾往前**找名词表（三步都写在下面的编号注释里，逐步可验）。
 *
 * ⚠️ 这是**启发式**，判不出来就返回 `null`，由 `buildCapabilityManifest()` 当场失败 ——
 * 判据与内容分开：规则写在这里（可读、可改、可被 override 点名），清单内容一个字都不在这里。
 *
 * @returns {{ entityType: string, how: 'override'|'name'|null }}
 */
export function attributeToolByName(name) {
  const override = Object.prototype.hasOwnProperty.call(TOOL_ENTITY_OVERRIDES, name)
    ? TOOL_ENTITY_OVERRIDES[name]
    : undefined;
  if (override !== undefined) return { entityType: override, how: 'override' };

  const tokens = String(name)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '');
  if (tokens.length === 0) return { entityType: null, how: null };

  // 1) 剥掉前导动词；至少留一个 token（全动词的名字判不出实体，是故意的）。
  let start = 0;
  while (start < tokens.length - 1 && VERB_PREFIXES.has(tokens[start])) start += 1;
  const afterVerb = tokens.slice(start);

  // 2) 介词之前才是**被操作的对象**：`list_tasks_by_project` 的对象是 tasks，
  //    `get_focuses_by_time` 的对象是 focuses。整段都没有介词时按整段处理。
  const prepositionAt = afterVerb.findIndex((token) => PREPOSITIONS.has(token));
  const head = prepositionAt === -1 ? afterVerb : afterVerb.slice(0, prepositionAt);
  const segment = head.length > 0 ? head : afterVerb;

  // 3) 先整体（`habit_log` 这种复合名），再**从尾往前**逐 token ——
  //    英文复合名词的中心词在后：`upsert_habit_checkins` 管的是打卡记录，不是习惯定义。
  const candidates = [segment.join('_'), ...[...segment].reverse()];
  for (const candidate of candidates) {
    const hit = ENTITY_NOUNS.get(candidate);
    if (hit !== undefined) return { entityType: hit, how: 'name' };
  }
  return { entityType: null, how: null };
}

// ─────────────────────────────────────────────────────────────────────────
// C. 纯构建：输入上游事实 → 输出清单（所有校验都在这里，可被 fixture 驱动）
// ─────────────────────────────────────────────────────────────────────────

export class CapabilityManifestError extends Error {
  constructor(problems) {
    const list = Array.isArray(problems) ? problems : [problems];
    super(list.map((p) => `   · ${p}`).join('\n'));
    this.name = 'CapabilityManifestError';
    this.problems = list;
  }
}

/**
 * @param {{
 *   protocolEntityTypes: readonly string[],
 *   modeledEntityTypes: readonly string[],
 *   tools: readonly { name: string, kind: string, description: string, schemaRecorded?: boolean,
 *                    args: readonly { name: string, type: string, required: boolean }[] }[],
 * }} input
 */
export function buildCapabilityManifest(input) {
  const protocol = [...(input.protocolEntityTypes ?? [])];
  const modeled = [...(input.modeledEntityTypes ?? [])];
  const tools = [...(input.tools ?? [])];
  const problems = [];

  // ── C1. 上游本身不能是空的（探针够不着 ≠ 一切正常，AGENTS §7 元规则 1）──
  if (protocol.length === 0) problems.push('上游 `ENTITY_TYPES`（shared-schema）读出来是空的 —— 无法判定。');
  if (modeled.length === 0) problems.push('上游 `MODELED_ENTITY_TYPES`（domain）读出来是空的 —— 无法判定。');
  if (tools.length === 0) problems.push('上游工具目录（`LOCAL_API_TOOLS`）读出来是空的 —— 清单会变成"什么都没有"，那是谎话而不是事实。');

  // ── C2. 口径名单必须仍然对得上上游（防止手写判据烂掉）──
  for (const exclusion of DENOMINATOR_EXCLUSIONS) {
    if (!modeled.includes(exclusion.entityType)) {
      problems.push(
        `剔除项 \`${exclusion.entityType}\` 已经不在 \`EntityModelMap\` 里了 —— 分母口径要重新拍，` +
          `不是把这一行删掉就行（ADR-0045 §2.7）。`,
      );
    }
  }
  for (const system of SYSTEM_ENTITY_TYPES) {
    if (!protocol.includes(system)) {
      problems.push(
        `系统实体 \`${system}\` 已经不在 \`ENTITY_TYPES\` 里了 —— 本脚本的判据过期了，请重新判断（不是放宽校验）。`,
      );
    }
  }
  for (const view of NON_ENTITY_VIEWS) {
    if (protocol.includes(view) || modeled.includes(view)) {
      problems.push(
        `\`${view}\` 现在是实体类型了 —— 但它是**视图**。` +
          `「视图不建实体」是 shared-schema 的 entity-types.ts 设计原则第 2 条与 ADR-0015 的结论；` +
          `先回答"为什么把它建成实体"，再回来改本脚本的 NON_ENTITY_VIEWS。`,
      );
    }
  }
  // 已物化 ⊆ 协议认识。反过来不成立正是 §2.7 里 `TASK_REPEAT_CFG` 那条口径。
  for (const modeledType of modeled) {
    if (!protocol.includes(modeledType)) {
      problems.push(`\`${modeledType}\` 在 \`EntityModelMap\` 里，却不在 \`ENTITY_TYPES\` 里 —— 两端实体清单已经不一致。`);
    }
  }

  // ── C3. 目录本身 ──
  const seen = new Set();
  for (const tool of tools) {
    if (typeof tool?.name !== 'string' || tool.name === '') {
      problems.push('目录里有一条没有名字的工具。');
      continue;
    }
    if (seen.has(tool.name)) problems.push(`工具名重复：\`${tool.name}\`。`);
    seen.add(tool.name);
    if (tool.kind !== 'read' && tool.kind !== 'write') {
      problems.push(
        `\`${tool.name}\` 的 kind 是 \`${String(tool.kind)}\`，而判定读写只有 \`read\` / \`write\` 两个取值 —— ` +
          `清单里"可读还是可写"是唯一能撑住拒绝话术的事实，不能含糊。`,
      );
    }
  }
  for (const name of Object.keys(TOOL_ENTITY_OVERRIDES)) {
    if (!seen.has(name)) {
      problems.push(
        `\`TOOL_ENTITY_OVERRIDES\` 里还留着 \`${name}\`，但目录里已经没有这个工具了 —— 删掉这条，` +
          `别让它变成第二份手写清单。`,
      );
    }
  }

  // ── C4. 每个工具必须归到一个**已物化**实体（判不出来 = 当场失败）──
  /** @type {Map<string, { entityType: string, how: string }>} */
  const attribution = new Map();
  for (const tool of tools) {
    const result = attributeToolByName(tool.name);
    if (result.entityType === null) {
      problems.push(
        `无法判定工具 \`${tool.name}\` 作用在哪个实体（名字推不出来，也没有登记 override）。` +
          `🔴 清单**不会**把它默默漏掉 —— 请二选一：在 ENTITY_NOUNS 里补这个名词，` +
          `或在 TOOL_ENTITY_OVERRIDES 里点名它并写明理由。不要删工具来让门禁变绿。`,
      );
      continue;
    }
    if (!modeled.includes(result.entityType)) {
      problems.push(
        `工具 \`${tool.name}\` 被判成实体 \`${result.entityType}\`，但它**没有领域模型**（不在 \`EntityModelMap\`）。` +
          `如果 \`${result.entityType}\` 是这一批新加的实体，ADR-0045 §2.6 与 ADR-0044 要求**实体和它的 AI 工具同批**落地；` +
          `先落实体，再重跑本脚本。`,
      );
      continue;
    }
    attribution.set(tool.name, result);
  }

  if (problems.length > 0) throw new CapabilityManifestError(problems);

  // ── C5. 组装（顺序全部由上游决定，产物因此可复现）──
  const userOperable = modeled.filter(
    (t) => !DENOMINATOR_EXCLUSIONS.some((e) => e.entityType === t),
  );
  const excludedPresent = DENOMINATOR_EXCLUSIONS.filter((e) => modeled.includes(e.entityType));
  const toolEntries = tools.map((tool) => {
    const { entityType } = attribution.get(tool.name);
    return {
      name: tool.name,
      kind: tool.kind,
      entityType,
      description: tool.description ?? '',
      schemaRecorded: tool.schemaRecorded !== false,
      args: (tool.args ?? []).map((arg) => ({
        name: arg.name,
        type: arg.type,
        required: arg.required === true,
      })),
    };
  });

  const entityOf = (entityType) => {
    const own = toolEntries.filter((t) => t.entityType === entityType);
    const readToolNames = own.filter((t) => t.kind === 'read').map((t) => t.name);
    const writeToolNames = own.filter((t) => t.kind === 'write').map((t) => t.name);
    const coverage =
      readToolNames.length > 0 && writeToolNames.length > 0
        ? 'read-write'
        : readToolNames.length > 0
          ? 'read-only'
          : writeToolNames.length > 0
            ? 'write-only'
            : 'none';
    return {
      entityType,
      materialized: modeled.includes(entityType),
      countsTowardCoverage: userOperable.includes(entityType),
      coverage,
      readToolNames,
      writeToolNames,
    };
  };

  const entities = modeled.map(entityOf);
  const entityTypesWithoutTools = userOperable.filter(
    (t) => entities.find((e) => e.entityType === t).coverage === 'none',
  );
  const covered = userOperable.length - entityTypesWithoutTools.length;

  return {
    manifestVersion: MANIFEST_VERSION,
    // 文本投影里那句"由代码生成"是策略句，不是产品事实（见文件头）。
    policy: {
      refusalMustSeparate: [
        '我没有这个工具（AI 侧缺工具）',
        '产品做不到（实体或功能不存在）',
      ].join(' ｜ '),
      source: 'ADR-0045 §2.6 纪律二',
    },
    coverage: { covered, denominator: userOperable.length, ratio: `${String(covered)}/${String(userOperable.length)}` },
    userOperableEntityTypes: userOperable,
    modelledEntityTypes: modeled,
    excludedFromDenominator: excludedPresent,
    entityTypesWithoutTools,
    entities,
    tools: toolEntries,
    // 协议认识、但没有领域模型、也不是系统实体的类型 ⇒ 算"动作"，不算"已物化实体"（§2.7）。
    protocolTypesWithoutModel: protocol.filter(
      (t) => !modeled.includes(t) && !SYSTEM_ENTITY_TYPES.includes(t),
    ),
    systemEntityTypes: protocol.filter((t) => SYSTEM_ENTITY_TYPES.includes(t)),
    nonEntityViews: NON_ENTITY_VIEWS,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// D. 给模型的文本投影
// ─────────────────────────────────────────────────────────────────────────

const KIND_LABEL = { read: '读', write: '写' };
const COVERAGE_LABEL = {
  none: '没有任何工具',
  'read-only': '只有读',
  'write-only': '只有写',
  'read-write': '读和写都有',
};

/**
 * 文本投影：**发给模型的 prompt 数据**，不是界面文案（见文件头最后一节的边界）。
 *
 * 只搬清单里已有的事实，句子结构本身是模板。刻意写成模型能直接引用的形状：
 * 每个实体一段，工具名 + 读写 + 参数字段；没有工具的实体单独成段，
 * 并紧跟一句"产品里有它"—— 纪律二要的就是这两句**必须同时出现**。
 */
export function renderModelText(manifest) {
  const lines = [];
  const byName = new Map(manifest.tools.map((t) => [t.name, t]));

  lines.push('heyta 能力清单（由工具目录与领域实体生成，不是手写的）');
  lines.push(`覆盖口径：用户可操作的已物化实体 ${manifest.coverage.denominator} 个，其中 ${manifest.coverage.covered} 个有 AI 工具（${manifest.coverage.ratio}）。`);
  lines.push('');
  lines.push('🔴 拒绝时两件事必须分开说：' + manifest.policy.refusalMustSeparate + '。');
  lines.push('下面标了"没有工具"的实体，在产品里是**真实存在**的：可以说"我没有这个工具"，');
  lines.push('不可以说"产品不支持"。');
  lines.push('');

  lines.push(`一、有 AI 工具的实体（${String(manifest.coverage.covered)} 个）`);
  const withTools = manifest.entities.filter(
    (e) => e.countsTowardCoverage && e.coverage !== 'none',
  );
  if (withTools.length === 0) lines.push('- （无）');
  for (const entity of withTools) {
    const own = manifest.tools.filter((t) => t.entityType === entity.entityType);
    lines.push(
      `- ${entity.entityType} —— ${COVERAGE_LABEL[entity.coverage]}（读 ${String(entity.readToolNames.length)} / 写 ${String(entity.writeToolNames.length)}）`,
    );
    for (const tool of own) {
      const args =
        tool.args.length === 0
          ? '无参数'
          : tool.args
              .map((a) => `${a.name}${a.required ? '*' : ''}:${a.type}`)
              .join(', ');
      lines.push(`  · [${KIND_LABEL[tool.kind]}] ${tool.name}（${args}）`);
      if (!tool.schemaRecorded) {
        lines.push(
          `    ⚠️ 这个工具的参数 schema 没有登记 —— 上面这行不代表它真的不接参数，字段清单可能不完整。`,
        );
      }
    }
  }
  void byName;

  lines.push('');
  lines.push(
    `二、产品里有、但我没有任何工具的实体（${String(manifest.entityTypesWithoutTools.length)} 个）—— 实体存在，只是我没配工具`,
  );
  if (manifest.entityTypesWithoutTools.length === 0) lines.push('- （无）');
  for (const entityType of manifest.entityTypesWithoutTools) {
    lines.push(`- ${entityType}：产品支持它，但我没有任何工具 —— 别说产品做不到。`);
  }

  lines.push('');
  lines.push('三、不计入上面分母的已物化实体（设计如此，不是遗漏）');
  for (const exclusion of manifest.excludedFromDenominator) {
    lines.push(`- ${exclusion.entityType}：${exclusion.reason}`);
  }

  if (manifest.protocolTypesWithoutModel.length > 0) {
    lines.push('');
    lines.push('四、同步协议认识、但没有领域模型的实体类型（算"动作"，不算"已物化实体"）');
    for (const entityType of manifest.protocolTypesWithoutModel) {
      lines.push(`- ${entityType}：不要把它写成"有个实体没配工具"。`);
    }
  }

  lines.push('');
  lines.push('五、视图不是实体（所以不在上面的清单里，但可以有工具）');
  lines.push(`- ${manifest.nonEntityViews.join(' / ')} 都是由已物化实体的字段派生的视图。`);
  if (manifest.systemEntityTypes.length > 0) {
    lines.push(`- 同步基础设施实体（不属于产品功能）：${manifest.systemEntityTypes.join(' / ')}。`);
  }

  lines.push('');
  lines.push('参数字段名带 `*` 的是必填。字段名照工具的 schema 原样搬，不要改写。');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// E. 产物渲染（TS）
// ─────────────────────────────────────────────────────────────────────────

/** 单引号字符串字面量。 */
function sq(text) {
  const escaped = String(text)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
  return `'${escaped}'`;
}

function tsValue(value, indent) {
  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 2);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[] as const';
    return `[\n${value.map((item) => `${inner}${tsValue(item, indent + 2)},`).join('\n')}\n${pad}]`;
  }
  if (value === null) return 'null';
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return `{\n${entries
      .map(([key, item]) => `${inner}${sq(key)}: ${tsValue(item, indent + 2)},`)
      .join('\n')}\n${pad}}`;
  }
  if (typeof value === 'string') return sq(value);
  return String(value);
}

/**
 * 联合类型成员：`'TASK' | 'PROJECT' | ...`。
 *
 * 每行最多 4 个成员 —— 一行塞 15 个的产物没法 review，而 review 是漂移的唯一人工防线。
 */
function tsUnion(values, firstPrefix) {
  if (values.length === 0) return `${firstPrefix}never;`;
  const members = values.map((v) => sq(v));
  const rows = [];
  for (let i = 0; i < members.length; i += 4) rows.push(members.slice(i, i + 4).join(' | '));
  if (rows.length === 1) return `${firstPrefix}${rows[0]};`;
  return rows
    .map((row, i) => `${i === 0 ? firstPrefix : `${firstPrefix}  `}${row}${i === rows.length - 1 ? ';' : ' |'}`)
    .join('\n');
}

const ARTIFACT_HEADER = [
  '/**',
  ' * heyta 的**产品级 AI 能力清单** —— **自动生成，请勿手改**。',
  ' *',
  ' * 唯一事实源：`packages/local-api/src/tools.ts`（工具目录）+ `packages/local-api/src/mcp.ts`',
  ' * （参数 schema）+ `packages/domain` 的 `MODELED_ENTITY_TYPES` + `packages/shared-schema`',
  ' * 的 `ENTITY_TYPES`。改**上游**，不要改这里 —— 这里每改一个字节都是给模型的一句谎话。',
  ' *',
  ' * 重新生成：`node scripts/gen-ai-capability-manifest.mjs`',
  ' * 校验漂移：`node scripts/gen-ai-capability-manifest.mjs --check`（门禁用，不一致 exit 1 并打印差异）',
  ' *',
  ' * 🔴 为什么禁止手写（ADR-0045 §2.6 纪律一）：助手侧不再逐工具授权之后，目录每加一个工具',
  ' *    AI 就多一个能力；手工维护的清单在**当天**就开始说谎，而漂了的清单会让模型',
  ' *    **自信地说不存在的不存在** —— 滴答助手那句"纪念日只能查看不能新建"就是这个形状',
  ' *    （`docs/research/dida-ai-assistant-gap-analysis.md` §2.1）。',
  ' *',
  ' * 🔴 纪律二（拒绝话术）：这份清单同时表达三件事 —— 实体在产品里**存在**、',
  ' *    AI **有没有**工具、有工具的话是**读还是写**。所以"我没有这个工具"和',
  ' *    "产品做不到"在数据上就是两回事，模型不必也不该把它们混着说。',
  ' *',
  ' * ⚠️ 这是**发给模型的 prompt 数据**，不是用户界面文案：它不进 `packages/i18n` 词条表、',
  ' *    不需要英文对照，也不归 `check:ui-language` 管（那个门禁扫的是 `apps/{web,landing,mobile}/src`）。',
  ' *    界面上的句子仍然只能来自词条表。',
  ' *',
  ' * ⚠️ 刻意**不含**时间戳：有时间戳的生成物每次 `--check` 都会红，那条门禁就废了。',
  ' * ⚠️ 刻意**不含**实体的中文显示名：仓库里没有「实体 → 界面词」的单一事实源，',
  ' *    手抄一份就是被禁止的第二份。界面词与"路径 Y"由 W12（对话外壳）一并定。',
  ' */',
  '',
];

export function renderTypeScript(manifest, text) {
  const modeled = manifest.modelledEntityTypes;
  const protocol = [...modeled, ...manifest.protocolTypesWithoutModel, ...manifest.systemEntityTypes];
  const lines = [...ARTIFACT_HEADER];

  lines.push('/** 同步协议认识的实体类型（生成的联合类型，成员随上游变）。 */');
  lines.push('export type AiCapabilityEntityType =');
  lines.push(tsUnion(protocol, '  '));
  lines.push('');
  lines.push('/** 真的被 `packages/op-log` 物化了领域模型的实体类型。 */');
  lines.push('export type AiCapabilityModeledEntityType =');
  lines.push(tsUnion(modeled, '  '));
  lines.push('');
  lines.push('/** 工具的可写性 —— 判定读写只有这两个取值（`@heyta/local-api` 的 `ToolKind`）。 */');
  lines.push("export type AiCapabilityToolKind = 'read' | 'write';");
  lines.push('');
  lines.push('/** 某个实体上 AI 工具的形状。`none` 是"产品有它、我没有工具"，不是"没有这个东西"。 */');
  lines.push("export type AiCapabilityCoverage = 'none' | 'read-only' | 'write-only' | 'read-write';");
  lines.push('');
  lines.push('/** 一个工具参数。`*` 号在文本投影里表示必填。 */');
  lines.push('export interface AiCapabilityToolArg {');
  lines.push('  readonly name: string;');
  lines.push('  readonly type: string;');
  lines.push('  readonly required: boolean;');
  lines.push('}');
  lines.push('');
  lines.push('export interface AiCapabilityTool {');
  lines.push('  readonly name: string;');
  lines.push('  readonly kind: AiCapabilityToolKind;');
  lines.push('  readonly entityType: AiCapabilityModeledEntityType;');
  lines.push('  readonly description: string;');
  lines.push('  /** `false` = `mcp.ts` 的 `INPUT_SCHEMAS` 里没有这个工具 —— `args` 可能**不完整**。 */');
  lines.push('  readonly schemaRecorded: boolean;');
  lines.push('  readonly args: readonly AiCapabilityToolArg[];');
  lines.push('}');
  lines.push('');
  lines.push('export interface AiCapabilityEntity {');
  lines.push('  readonly entityType: AiCapabilityModeledEntityType;');
  lines.push('  readonly materialized: boolean;');
  lines.push('  /** 是否算进"AI 覆盖面 = 界面功能面"的分母（ADR-0045 §2.7 的口径）。 */');
  lines.push('  readonly countsTowardCoverage: boolean;');
  lines.push('  readonly coverage: AiCapabilityCoverage;');
  lines.push('  readonly readToolNames: readonly string[];');
  lines.push('  readonly writeToolNames: readonly string[];');
  lines.push('}');
  lines.push('');
  lines.push('export interface AiCapabilityDenominatorExclusion {');
  lines.push('  readonly entityType: AiCapabilityModeledEntityType;');
  lines.push('  readonly reason: string;');
  lines.push('}');
  lines.push('');
  lines.push('export interface AiCapabilityManifest {');
  lines.push('  /** **本产物的结构版本**，与 `CURRENT_SCHEMA_VERSION` 无关：它不落盘、不进线协议。 */');
  lines.push('  readonly manifestVersion: number;');
  lines.push('  readonly policy: { readonly refusalMustSeparate: string; readonly source: string };');
  lines.push('  readonly coverage: { readonly covered: number; readonly denominator: number; readonly ratio: string };');
  lines.push('  readonly userOperableEntityTypes: readonly AiCapabilityModeledEntityType[];');
  lines.push('  readonly modelledEntityTypes: readonly AiCapabilityModeledEntityType[];');
  lines.push('  readonly excludedFromDenominator: readonly AiCapabilityDenominatorExclusion[];');
  lines.push('  readonly entityTypesWithoutTools: readonly AiCapabilityModeledEntityType[];');
  lines.push('  readonly entities: readonly AiCapabilityEntity[];');
  lines.push('  readonly tools: readonly AiCapabilityTool[];');
  lines.push('  readonly protocolTypesWithoutModel: readonly string[];');
  lines.push('  readonly systemEntityTypes: readonly string[];');
  lines.push('  readonly nonEntityViews: readonly string[];');
  lines.push('}');
  lines.push('');
  lines.push('export const AI_CAPABILITY_MANIFEST =');
  // 🔴 `as const satisfies` 必须和闭合的 `}` **同一行**：换行会被 ASI 断成一条
  // 独立语句，`as` 开头就不是表达式了（实测 TS1434 + TS1005）。
  lines.push(`${tsValue(manifest, 0)} as const satisfies AiCapabilityManifest;`);
  lines.push('');
  lines.push('/**');
  lines.push(' * 给模型的那份文本投影 —— 与上面的结构化清单**同一次生成**产出，所以不可能对不上。');
  lines.push(' * 接线它的位置是对话外壳（W12）拼 system prompt 的时候；它不是界面文案，不走 `t()`。');
  lines.push(' */');
  lines.push('export const AI_CAPABILITY_TEXT = [');
  for (const line of text.split('\n')) lines.push(`  ${sq(line)},`);
  lines.push("].join('\\n');");
  lines.push('');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// F. 读上游（dist + 一处源码结构事实）
// ─────────────────────────────────────────────────────────────────────────

const LOCAL_API_DIST = join(ROOT, 'packages/local-api/dist/index.js');
const DOMAIN_DIST = join(ROOT, 'packages/domain/dist/index.js');
const SHARED_SCHEMA_DIST = join(ROOT, 'packages/shared-schema/dist/index.js');
const MCP_SOURCE = join(ROOT, 'packages/local-api/src/mcp.ts');

function missingDistMessage(file) {
  return (
    `读不到 \`${relative(ROOT, file)}\` —— 本生成器读的是**构建产物**（同一个判断不写第二遍）。\n` +
    '   先跑 `pnpm -r build`（`pnpm check` 会先构建，所以正常路径下不会遇到这个）。'
  );
}

/**
 * 扫 `mcp.ts` 里 `INPUT_SCHEMAS` 的**顶层键名**。
 *
 * 🔴 只取键名、不解析值 —— 值来自 dist 的 `listAuthorizedTools()`。
 * 为什么非读源码不可：dist 层面"没登记 schema"与"确实不接参数"长得一模一样
 * （`listAuthorizedTools` 有 `schema ?? 空 properties` 的回退）。见文件头的表格。
 */
export function readInputSchemaKeys(source) {
  const marker = 'INPUT_SCHEMAS';
  const at = source.indexOf(marker);
  if (at === -1) return null;
  const open = source.indexOf('{', source.indexOf('=', at));
  if (open === -1) return null;

  let depth = 0;
  const keys = [];
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) break;
        i += 1;
      }
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') {
      depth += 1;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth -= 1;
      if (depth === 0) break; // 顶层对象闭合，扫完
      continue;
    }
    if (depth !== 1) continue;
    if (/[A-Za-z_]/.test(ch) === false) continue;
    let j = i;
    while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j += 1;
    const word = source.slice(i, j);
    // 只认「键:」形状（`const INPUT_SCHEMAS` 那行里的标识符 depth 是 0，不会进来）。
    if (/^\s*:/.test(source.slice(j, j + 40))) keys.push(word);
    i = j - 1;
  }
  return keys;
}

/** @returns {Promise<{protocolEntityTypes: string[], modeledEntityTypes: string[], tools: object[], warnings: string[]}>} */
export async function readUpstream() {
  const problems = [];
  for (const file of [LOCAL_API_DIST, DOMAIN_DIST, SHARED_SCHEMA_DIST]) {
    if (!existsSync(file)) problems.push(missingDistMessage(file));
  }
  if (!existsSync(MCP_SOURCE)) {
    problems.push(`读不到 \`${relative(ROOT, MCP_SOURCE)}\` —— 参数 schema 的登记情况无法核对。`);
  }
  if (problems.length > 0) throw new CapabilityManifestError(problems);

  const localApi = await import(pathToFileURL(LOCAL_API_DIST).href);
  const domain = await import(pathToFileURL(DOMAIN_DIST).href);
  const sharedSchema = await import(pathToFileURL(SHARED_SCHEMA_DIST).href);

  const directory = localApi.LOCAL_API_TOOLS;
  const listAuthorizedTools = localApi.listAuthorizedTools;
  const modeled = domain.MODELED_ENTITY_TYPES;
  const protocol = sharedSchema.ENTITY_TYPES;
  if (!Array.isArray(directory) || typeof listAuthorizedTools !== 'function') {
    throw new CapabilityManifestError(
      '`@heyta/local-api` 的产物里没有 `LOCAL_API_TOOLS` / `listAuthorizedTools` —— 导出形状变了，本生成器要跟着改（不是放宽校验）。',
    );
  }
  if (!Array.isArray(modeled) || !Array.isArray(protocol)) {
    throw new CapabilityManifestError(
      '`MODELED_ENTITY_TYPES` 或 `ENTITY_TYPES` 读不出来 —— 实体清单的运行时口径变了。',
    );
  }

  // 「全部工具都授权」地把它们过一遍**真投影** —— 与内置 AI / MCP 客户端看到的
  // 是同一次调用（ADR-0035：一份目录 + 一份投影），所以字段清单不会漂。
  const grants = Object.fromEntries(directory.map((tool) => [tool.name, true]));
  const definitions = listAuthorizedTools(grants);

  const schemaKeys = readInputSchemaKeys(readFileSync(MCP_SOURCE, 'utf8'));
  const keyProblems = [];
  if (schemaKeys === null) {
    keyProblems.push('`mcp.ts` 里找不到 `INPUT_SCHEMAS` —— 参数 schema 的登记情况无法核对，不要绕过这一步。');
  } else if (schemaKeys.length === 0 && directory.length > 0) {
    // 🔴 探针够不着 ≠ 一切正常（AGENTS §7 元规则 1）：扫出空集只说明解析前提变了，
    //    而继续跑会把**每个**工具都标成"没登记 schema"，那是全场一致的假结论。
    keyProblems.push(
      '`mcp.ts` 的 `INPUT_SCHEMAS` 顶层键**一个都没扫到** —— 形状变了（或被搬走了），先改本脚本的扫描前提，不要放过。',
    );
  } else {
    for (const key of schemaKeys) {
      if (!directory.some((tool) => tool.name === key)) {
        keyProblems.push(
          `\`mcp.ts\` 的 \`INPUT_SCHEMAS\` 里有 \`${key}\`，但工具目录里没有它 —— 孤儿抄件，删掉那段 schema（留着就是第二份定义）。`,
        );
      }
    }
  }
  if (keyProblems.length > 0) throw new CapabilityManifestError(keyProblems);

  const warnings = [];
  const tools = directory.map((tool) => {
    const definition = definitions.find((d) => d.name === tool.name);
    const schema = definition?.inputSchema;
    const properties = schema?.properties ?? {};
    const required = schema?.required ?? [];
    const schemaRecorded = schemaKeys === null ? true : schemaKeys.includes(tool.name);
    if (!schemaRecorded) {
      warnings.push(
        `工具 \`${tool.name}\` 在 \`mcp.ts\` 的 \`INPUT_SCHEMAS\` 里没有登记 —— 清单会带上 schemaRecorded:false，` +
          `并在文本投影里明说它的字段可能不完整。`,
      );
    }
    return {
      name: tool.name,
      kind: tool.kind,
      description: tool.description,
      schemaRecorded,
      args: Object.entries(properties).map(([name, spec]) => ({
        name,
        type: typeof spec?.type === 'string' ? spec.type : 'unknown',
        required: Array.isArray(required) && required.includes(name),
      })),
    };
  });

  return {
    protocolEntityTypes: [...protocol],
    modeledEntityTypes: [...modeled],
    tools,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// G. 比对与差异打印
// ─────────────────────────────────────────────────────────────────────────

/** 首块差异 + 统计。返回 null 表示一致。 */
export function diffLines(current, expected) {
  if (current === expected) return null;
  const a = current.split('\n');
  const b = expected.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  return {
    start,
    removed: a.slice(start, endA),
    added: b.slice(start, endB),
    changedCount: (endA - start) + (endB - start),
    totalA: a.length,
    totalB: b.length,
  };
}

const DIFF_WINDOW = 14;

function formatDiff(diff) {
  const out = [];
  out.push(`   第 ${String(diff.start + 1)} 行起不一致（产物 ${String(diff.totalA)} 行 / 应为 ${String(diff.totalB)} 行）。`);
  const clip = (rows) =>
    rows.length > DIFF_WINDOW
      ? [...rows.slice(0, DIFF_WINDOW), `        … 还有 ${String(rows.length - DIFF_WINDOW)} 行`]
      : rows;
  if (diff.removed.length > 0) {
    out.push('   🔴 仓库里现在是：');
    for (const line of clip(diff.removed)) out.push(`     - ${String(line).replace(/^ +/, '')}`);
  }
  if (diff.added.length > 0) {
    out.push('   ✅ 由上游重新生成应该是：');
    for (const line of clip(diff.added)) out.push(`     + ${String(line).replace(/^ +/, '')}`);
  }
  return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// H. CLI
// ─────────────────────────────────────────────────────────────────────────

async function generate() {
  const input = await readUpstream();
  const manifest = buildCapabilityManifest(input);
  const text = renderModelText(manifest);
  return { output: renderTypeScript(manifest, text), manifest, warnings: input.warnings };
}

export async function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const print = argv.includes('--print');
  const { output, manifest, warnings } = await generate();

  for (const warning of warnings) console.warn(`  ⚠️  ${warning}`);

  if (print) {
    process.stdout.write(output);
    return 0;
  }

  if (check) {
    let current = '';
    let existed = true;
    try {
      current = readFileSync(ARTIFACT, 'utf8');
    } catch {
      existed = false;
    }
    if (!existed) {
      // 🔴 产物不存在**不是**"没有漂移"，是判据的对象消失了 —— 响亮失败。
      console.error(
        `🔴 找不到能力清单产物：${relative(ROOT, ARTIFACT)}\n` +
          '   跑 `node scripts/gen-ai-capability-manifest.mjs` 生成它，并把产物**一起提交**。',
      );
      return 1;
    }
    const diff = diffLines(current, output);
    if (diff !== null) {
      console.error(
        `🔴 能力清单产物与上游不一致：${relative(ROOT, ARTIFACT)}\n` +
          `${formatDiff(diff)}\n` +
          '   产物是**生成物**：跑 `node scripts/gen-ai-capability-manifest.mjs` 重新生成并一起提交。\n' +
          '   ⚠️ 手改产物 = 给模型写一句谎话（ADR-0045 §2.6 纪律一）。要改的是上游。',
      );
      return 1;
    }
    console.log('AI 能力清单门禁 —— 产物由工具目录与实体清单生成，逐字节核对');
    console.log(`  工具目录：${String(manifest.tools.length)} 个（读 ${String(manifest.tools.filter((t) => t.kind === 'read').length)} / 写 ${String(manifest.tools.filter((t) => t.kind === 'write').length)}）`);
    console.log(`  覆盖面：${manifest.coverage.ratio}（分母口径见 ADR-0045 §2.7，剔除 ${String(manifest.excludedFromDenominator.length)} 个落库载体）`);
    console.log(`  无工具实体：${manifest.entityTypesWithoutTools.length === 0 ? '（无）' : manifest.entityTypesWithoutTools.join(', ')}`);
    console.log(`✅ ${relative(ROOT, ARTIFACT)} 与上游一致。`);
    return 0;
  }

  writeFileSync(ARTIFACT, output, 'utf8');
  console.log(
    `✅ 已写入 ${relative(ROOT, ARTIFACT)} —— 工具 ${String(manifest.tools.length)} / 实体 ${String(manifest.entities.length)} / 覆盖面 ${manifest.coverage.ratio}`,
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    process.exitCode = await main();
  } catch (error) {
    if (error instanceof CapabilityManifestError) {
      console.error(`🔴 能力清单**拒绝生成**（${String(error.problems.length)} 条）：\n`);
      for (const problem of error.problems) console.error(`   · ${problem}`);
      console.error(
        '\n   🔴 这些判据挡的是"清单与上游悄悄不一致"。放宽本脚本的校验不会让清单变准，\n' +
          '      只会让它变成一份没人核对的手写抄件。要么改上游，要么把理由写进本脚本。\n',
      );
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
