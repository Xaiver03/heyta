#!/usr/bin/env node
/**
 * 「已建模 ≠ 可达」门禁 —— 实体可以同步、可以导入导出，但**没有任何一条写入路径**。
 * ====================================================================================
 *
 * 判据出处：`docs/plans/site-and-parity-alignment.md` §C-8（W4，「本计划里唯一有杠杆的一条」）
 *
 *   > **判据**：对 `EntityModelMap` 里的每个实体，检查是否存在
 *   > ① `packages/app-host/src/` 里的 action；
 *   > ② 至少一个宿主（各宿主目录）的调用点。
 *   >
 *   > **为什么必须做**：13 个幻觉全是同一个形状 —— **基础设施做完了、最后一米没接**。
 *   > 修掉那 13 项只是修了 13 个实例；`check:reachability` 修的是**产生它们的机制**。
 *
 * 上位判据是 [dida365-feature-benchmark.md](../docs/research/dida365-feature-benchmark.md)
 * §3 那段「共同形状：**基础设施做完了，最后一米没接。**」，
 * 以及 §3.1 的可复用三问（action？调用点？验收？）。本门禁只做第 1、2 问 ——
 * 第 3 问（从用户动作出发的验收）需要跑 e2e，不是静态扫描能判定的，见文末「覆盖不到什么」。
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * 🔴 与 A8（`check:site-reachability`）的分工（别做重）
 * ─────────────────────────────────────────────────────────────────────────────────
 *
 *   · **A8 / `render.spec.tsx` 的 N2** 管的是**站点路由的可达性**：
 *     一条 URL 有没有被 `Nav`/`Footer`/正文链接指向。
 *   · **本门禁（C-8）** 管的是**数据实体的可达性**：
 *     一个已建模的实体有没有「被生成」和「被消费」的代码路径。
 *     「站点上没有指向 /help 的链接」A8 抓；「`NOTE` 实体没有任何宿主能建它」本门禁抓。
 *   两者判据不重叠，也**不允许**用对方的存在当作自己不做的理由。
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * 🔴 这个形状在本仓库长什么样（2026-10-01 实测）
 * ─────────────────────────────────────────────────────────────────────────────────
 *
 * **真实例子 1 —— `NOTE`：已建模、已物化、零 action（= 幻觉 #12「笔记模块」）**
 *
 *   ⚠️ **2026-10-05：这个例子已经修掉，但保留在这里 —— 它是最好的形状说明书。**
 *   下面每一行都是**当时的实测**；现在 `packages/app-host/src/note-actions.ts`
 *   已经存在（`entityType: 'NOTE'` 有写路径），断言 B 对它转绿。
 *   留着它是因为下一个"已建模但零 action"的实体会**一模一样**，
 *   而本文件的价值就是让那种形状一眼可辨。
 *
 *   · `packages/domain/src/entities.ts:188`  `export interface Note extends EntityBase`
 *   · `packages/domain/src/entities.ts:326`  `EntityModelMap` 里有 `NOTE: Note`
 *   · `packages/domain/src/entities.ts:352`  `MODELED_ENTITY_TYPES` 里有 `'NOTE'`
 *   · `packages/op-log/src/state.ts:76`      `BUCKET_BY_ENTITY` 里有 `NOTE: 'notes'`
 *   · `packages/op-log/src/state.ts:63`      物化状态里有 `notes: {}`
 *   ⇒ **三处登记齐全、桶已存在、可以同步、会被导出**（`export-dump.ts:138` 按 `ENTITY_TYPES` 全量导出）。
 *   ⇒ 而**当时** `packages/app-host/src` 的 `.ts` 文件里**没有任何一处** `entityType: 'NOTE'`
 *      —— 九类 action（task / project / habit / focus / ai-feedback）全都不写它。
 *   ⇒ **当时**仓库里对 `NOTE` 的全部引用都是**显示用途**：
 *      `packages/ui/src/sync/model.ts:485`（冲突面板的实体名标签）、
 *      `apps/web/src/features/sync/ConflictDialog.tsx:101`（同一条词的 web 变体）。
 *      它们证明"这个名字有翻译"，**不证明"用户能创建一条笔记"** —— 这正是本门禁要区分的。
 *
 * **真实例子 2 —— `REMINDER`：合法实体名、零建模、零 action（= 幻觉 #1「任务提醒」）**
 *
 *   · `packages/shared-schema/src/entity-types.ts:31`  `'REMINDER'` 在 `ENTITY_TYPES` 里
 *   · `packages/op-log/src/state.ts:141-144`  `UNMODELED_ENTITY_TYPES` 里写着
 *     `{ entityType: 'REMINDER', reason: '提醒；需要通知调度与产品决策，尚未开始' }`
 *   ⇒ **read 起来像"提醒已经建模"**（实体名合法、服务端会接受、op 能入队并同步到所有设备），
 *      而**没有任何设备会物化它、没有任何 action 能建它**。
 *   ⇒ `reason` 自己写着「尚未开始」—— 那就是一笔**明账**，本门禁把它读出来并按账判红。
 *
 * **为什么现有门禁一条都发现不了**
 *
 *   · `check:layering` 管"op 的构造只在 app-host"——`NOTE` 的 op **根本不存在**，无构造可查；
 *   · `check:materialized-reads` 管"物化状态被读时是否走单一来源"——没人读 `notes` 桶；
 *   · `check:row-single-source` / `check:empty-state` 管视图形状——`NOTE` 没有视图；
 *   · `check:ui-language` 管硬编码文案——`NOTE` 只有词条，词条是合规的；
 *   · `op-log/tests/entity-coverage.spec.ts` 管"合法实体必须被显式登记"——
 *     `NOTE` **登记了**（`BUCKET_BY_ENTITY`），于是它反而是**绿的**。
 *   ⇒ 每一道门禁单独看都对，合起来是一个**洞**：**「实体在建、在同步、在导出，但没人能建它」**
 *     这个形状落在所有门禁的缝里。本门禁补的就是这条缝。
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * 🔴 判据（四条，全部可判定；不许靠感觉）
 * ─────────────────────────────────────────────────────────────────────────────────
 *
 * **A · 锚点自检**（找不到锚点 = 判据失效 = 报错，**不是通过**）
 *
 *   A1 `EntityModelMap` / `MODELED_ENTITY_TYPES` / `BUCKET_BY_ENTITY` 三处登记必须都扫得到；
 *   A2 三处登记的实体集合必须**相等**（`NOTE` 就在其中 —— 它是判据的输入，不能写死）；
 *   A3 `UNMODELED_ENTITY_TYPES` 清单必须扫得到；
 *   A4 action 家族锚点必须能扫到（`createTaskActions` 等，见 `ACTION_FAMILIES`）；
 *   A5 宿主扫描范围必须真扫到文件（空目录 = 范围缺口会静默失效）。
 *
 * **B · 已建模实体必须有写路径**：`EntityModelMap` 的每个实体，在
 *   `packages/app-host/src` 的 `.ts` 文件里必须至少有一处 `entityType: '<实体>'`（写 op 的锚点）。
 *   零处 → **红**（这就是 `NOTE`）。
 *
 * **C · 有写路径的实体必须有宿主消费点**：对 B 通过的每个实体，在其 action 家族的**宿主**里
 *   （`apps` 下各宿主的 `src/`，排除 `dist*` 产物与测试）必须至少有一处
 *   `createXxxActions(` 的真实调用。零处 → **红**（这就是"action 写了但没人接"那一半）。
 *
 * **D · 合法但未建模的实体**：`UNMODELED_ENTITY_TYPES` 的每一项，如果它的
 *   `reason` **不是**明确的"决定不用"，则必须在宿主目录里有消费点，
 *   否则 → **红**（这就是 `REMINDER`）。`TASK_REPEAT_CFG` 的 reason 写着
 *   「本引擎做不到…本条不是"还没做"，是"决定不用"」⇒ **豁免**，且这个豁免**读自源码**而不是本脚本写死。
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * 🔴 刻意排除（附理由；不放宽判据，只避免误报）
 * ─────────────────────────────────────────────────────────────────────────────────
 *
 *   1. **纯显示用途的引用不算"调用点"。** `NOTE` / `TASK_REPEAT_CFG` 出现在
 *      `packages/ui/src/sync/model.ts` 的实体名标签映射里（`NOTE: 'common.entity.NOTE'`）。
 *      那是**翻译表**，不是用户能触达的路径。把它算作调用点，本门禁就会对 `NOTE` 变绿
 *      —— 那就是**假的完备**，比不完备更危险（本仓库已有先例）。
 *      所以调用点只认宿主 apps 目录下 src/ 里对**具体 action 家族工厂函数**的调用。
 *   2. **不扫 `dist` / `dist-types` / `build` / `.expo` 等产物目录。** 产物里有同样的字符串，
 *      扫进来只会让"源码里已经删掉"的地方仍然看起来可达。
 *   3. **不扫测试文件**（`*.spec.*` / `*.test.*` / `__tests__`）。测试证明的是"这个能力存在"，
 *      不是"用户碰得到"。`apps/web/tests/stores.spec.ts:389` 就在讨论 `createFocusActions`
 *      —— 用测试当调用点会让门禁在功能被摘掉后仍然绿。
 *   4. **`e2e/` 不算调用点。** 同上：它是验收侧（三问的第 3 问），本门禁刻意只做 1、2 问。
 *   5. **`packages/app-host/src/` 自身不算调用点。** 那里是**定义**（工厂函数），
 *      调用点必须来自宿主目录 apps/。把定义处算进去等于让 B/C 自证。
 *   6. **Vendored 线协议实体名不删。** `TASK_REPEAT_CFG` 留在 `ENTITY_TYPES` 里是**故意的**
 *      （`entities.ts:125` 写明：vendored 线协议词表，不能删）。判据 D 的豁免读它自己的 `reason`。
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * 🔴 覆盖不到什么（诚实的不完备 > 假的完备）
 * ─────────────────────────────────────────────────────────────────────────────────
 *
 *   · **第 3 问（从用户动作出发的验收）完全没覆盖。** 有 action + 有调用点，
 *     但调用点在一条死代码分支里、或被 feature flag 关掉，本门禁看不见。
 *   · **调用点的"质地"不查。** 只数"有没有 `createXxxActions(` 的调用"，
 *     不查它是否真的被挂进了渲染树 / 命令注册表。`apps/node-host/src/cli-mcp.ts` 里
 *     建一次 action 但从不注册命令，本门禁仍然绿。
 *   · **"哪个字段/能力"粒度不查。** 本门禁判的是**实体**层。
 *     幻觉 #7（`Task.order` 零写入路径）、#8（`FocusConfig` 零 UI 调用）是**字段/配置**层，
 *     尽管它们同属"基础设施做完了、最后一米没接"，本门禁**抓不到**。
 *     将来要做，正确的做法是照本脚本的形状再补一条字段级门禁，**不是**把本判据放宽。
 *   · **"零 action"与"零调用点"都为空但功能其实存在**的情况（宿主自己绕过 op-log 直接改状态）
 *     本门禁抓不到 —— 那种违规属于 `check:layering` 的 `no-op-construction-in-apps`。
 *   · 移植到别的仓库前必须重做侦察：`ACTION_FAMILIES` 是本仓库的**命名习惯**，不是通用规律。
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * 🔴 故障注入（已实测；跑在 `HEYTA_CHECK_ROOT` 的 `/tmp` 副本上，不动工作区）
 * ─────────────────────────────────────────────────────────────────────────────────
 *
 *   E1  注入一个"已建模、零 action"的实体（`entity-types.ts` 加 `PING` +
 *       `entities.ts` 三处登记）                                  → B 红
 *   E2  删掉一个真实写路径（`actions.ts` 的 `entityType: 'TASK'` 改掉） → B 红
 *   E3  删掉一个真实宿主调用点（`apps/web/.../focus/store.ts` 的
 *       `createFocusActions(`）                                    → C 红
 *   E4  把 `UNMODELED_ENTITY_TYPES` 里 `REMINDER` 的 reason 改成
 *       "尚未开始"（即它与 `TASK_REPEAT_CFG` 换位）                → D 红
 *   E5  把 `MODELED_ENTITY_TYPES` 里删掉 `'NOTE'`（三处登记不等）  → A2 红
 *
 *   ⚠️ 每一项都记录了**旧状态对照**：在本门禁不存在时，上述改动不会被任何门禁拦到。
 *
 * 用法：
 *   node scripts/check-reachability.mjs                 # 全部判据
 *   node scripts/check-reachability.mjs --entity=TASK   # 只跑一个实体（故障注入隔离用）
 *   node scripts/check-reachability.mjs --list          # 只打印实体账，不判红
 *   非零退出 = 有违规，或有判据失效。
 *
 * `HEYTA_CHECK_ROOT`：与 `check-empty-state.mjs` / `check-ai-tools.mjs` 同一个约定 ——
 * 只给**故障注入探针**用（把门禁跑在 `/tmp` 的副本上，不动共享工作区）。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT =
  process.env.HEYTA_CHECK_ROOT === undefined
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.env.HEYTA_CHECK_ROOT);

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-types',
  'build',
  'coverage',
  '.expo',
  '.turbo',
  '.git',
  'release',
  'android',
  'ios',
  '.gradle',
  'Pods',
]);

/* ========================================================================
 * 判据的锚点（全部是**路径 + 模式**，找不到就报错，不许静默通过）
 * ====================================================================== */

/**
 * ① 三处实体登记的锚点。
 *
 * 🔴 为什么三处都要钉：`entities.ts:341-344` 写明这三份定义曾经互不校验、
 * 必然漂移。三处相等是判据 A2；任何一处改名/消失都是**判据失效**，必须报红，
 * 而不是"读不到就跳过"。
 */
const REGISTRY_ANCHORS = [
  {
    key: 'EntityModelMap',
    file: 'packages/domain/src/entities.ts',
    label: '领域模型映射（编译期）',
    extract: (src) => {
      const m = /export\s+interface\s+EntityModelMap\s*\{([\s\S]*?)\n\}/.exec(src);
      if (m === null) return null;
      return new Set([...m[1].matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:/gm)].map((x) => x[1]));
    },
  },
  {
    key: 'MODELED_ENTITY_TYPES',
    file: 'packages/domain/src/entities.ts',
    label: '领域层运行时可读清单',
    extract: (src) => {
      const m = /export\s+const\s+MODELED_ENTITY_TYPES\s*=\s*\[([\s\S]*?)\]\s*as\s+const/.exec(src);
      if (m === null) return null;
      return new Set([...m[1].matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((x) => x[1]));
    },
  },
  {
    key: 'BUCKET_BY_ENTITY',
    file: 'packages/op-log/src/state.ts',
    label: 'op-log 实体 → 桶 映射',
    extract: (src) => {
      const m = /const\s+BUCKET_BY_ENTITY\s*=\s*\{([\s\S]*?)\n\}\s*as\s+const/.exec(src);
      if (m === null) return null;
      return new Set([...m[1].matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:/gm)].map((x) => x[1]));
    },
  },
];

/** ② 合法但未建模的实体清单。 */
const UNMODELED_ANCHOR = {
  file: 'packages/op-log/src/state.ts',
  label: '合法但未物化的实体清单',
  extract: (src) => {
    const m = /export\s+const\s+UNMODELED_ENTITY_TYPES[^=]*=\s*\[([\s\S]*?)\n\];/.exec(src);
    if (m === null) return null;
    const body = m[1];
    const out = [];
    for (const item of body.matchAll(/\{([\s\S]*?)\n\s*\}/g)) {
      const ent = /entityType:\s*'([A-Z][A-Z0-9_]*)'/.exec(item[1]);
      const reason = /reason:([\s\S]*)$/.exec(item[1]);
      if (ent !== null) {
        out.push({
          entityType: ent[1],
          reason: (reason?.[1] ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^'/, '')
            .replace(/',?$/, '')
            .trim(),
        });
      }
    }
    return out;
  },
};

/**
 * ③ **action 家族**：实体 → 它在 `packages/app-host/src` 里被哪族工厂函数写入。
 *
 * 🔴 这张表**不许**代替判据 B。B 的依据仍然是"源码里有没有 `entityType: '<实体>'`"，
 * 表只用来把"有写路径"的实体接到它的**宿主调用点**上（判据 C）。
 *
 * 为什么把话反过来说很重要：如果 C 只按这张表判定，下一个新增实体只要
 * **不进表**就自动跳过 —— 那就是"扫不到就跳过"。所以 C 的输入永远来自 B，
 * 表里查不到家族名只会让"调用点无法判定"变成**报错**（见 MISSING 分支），不是通过。
 *
 * `family` 必须真的被扫到（判据 A4）；名字是本仓库的命名习惯，不是通用规律。
 */
const ACTION_FAMILIES = [
  { entity: 'TASK', family: 'createTaskActions' },
  { entity: 'PROJECT', family: 'createProjectActions' },
  { entity: 'TAG', family: 'createProjectActions' },
  { entity: 'HABIT', family: 'createHabitActions' },
  { entity: 'HABIT_LOG', family: 'createHabitActions' },
  { entity: 'FOCUS_SESSION', family: 'createFocusActions' },
  { entity: 'AI_FEEDBACK', family: 'createAiFeedbackActions' },
  { entity: 'PREFERENCE_CORRECTION', family: 'createPreferenceCorrectionActions' },
  /**
   * M3/W3 B1-1（`app-host/src/reminder-actions.ts`）。
   * 🔴 **补这一行是合法的登记，不是"只补表不写 action"那种假修法** ——
   * `createReminderActions` 在 `packages/app-host/src/reminder-actions.ts` 里**真的存在**
   * （定义 1 处 + `index.ts` 导出 1 处，已 grep 核实）。
   */
  { entity: 'REMINDER', family: 'createReminderActions' },
  /**
   * 便签（幻觉 #12「笔记模块」，`app-host/src/note-actions.ts`）。
   *
   * 🔴 **2026-10-05 更新：这一行是补上的登记，与上面 `REMINDER` 同一条纪律 ——
   * `createNoteActions` 先真的写出来了，才允许进表。**
   *
   * 本表曾经刻意**不含** `NOTE`，注释写着"它在 app-host 里真的没有 action"。
   * 那句话当时是**实测为真**的（判据 B 红着），但状态变了之后它就成了**过期注释**：
   * 而"过期注释"正是本仓库反复踩的坑（`index.ts` 曾写着"补登记 AiDisclosure"
   * 却 6 轮没人做）。所以这里连同上面那条引用 `NOTE` 缺席的注释一并改掉。
   *
   * ⚠️ 顺序也是刻意的：**先写 action、后进表**。反过来做（先进表再看家族名）
   * 会让判据 C 变成"查一个不存在的东西"，从而静默通过 —— 那正是本文件
   * 文末列出的禁止修法之一。
   */
  { entity: 'NOTE', family: 'createNoteActions' },
  { entity: 'EVENT', family: 'createEventActions' },
  /**
   * D-4 (ii) 跨设备会话实体（`app-host/src/assistant-session-actions.ts`，2026-10-05）。
   *
   * 🔴 这一行是**本门禁当场抓出来的**，不是补登记补出来的：`10b53a81` 落了新实体与写路径后，
   * 判据 C 报「ASSISTANT_TURN 有写路径，但 ACTION_FAMILIES 里没有它的宿主 action 家族 ——
   * 无法判定」。这正是本文件设计的用途：**新实体不许悄悄跳过 C**。
   *
   * 合法性按 `REMINDER` / `NOTE` 那两行的同一条纪律核过：
   * `createAssistantSessionActions` 在 `assistant-session-actions.ts:155` **真的存在**、
   * `index.ts:820` 导出、且宿主里有真实生产调用点
   * （`apps/node-host/src/host.ts:273`；测试与 `e2e/` 一律不算）。
   *
   * ⚠️ **但这一行只回答"有没有宿主接了"，不回答"用户碰得到吗"** —— 现量：
   * 只有 `apps/node-host` 写这个实体。`apps/web` 的助手对话仍只落本机 `localStorage`
   * （`assistant-history.ts`，D-4 (i)），`apps/mobile` 完全不写会话实体。
   * ⇒ "手机上的一段对话出现在电脑上"这件事，在**两个 UI 壳上都还没成立**。
   * 本门禁拦不住这种"宿主只有一枚"的缺口（它的判据本来就是 ≥1），所以这条缺口
   * 记在 `docs/adr/0045-*.md` 的落地情况与 `docs/plans/ai-assistant-closure.md` 的未闭合清单里，
   * **别把这行读成 D-4 (ii) 对用户可用了**。
   */
  { entity: 'ASSISTANT_TURN', family: 'createAssistantSessionActions' },
];

/** 写 op 的锚点：`entityType: 'X'` 后允许 `as EntityType` 之类的类型断言。 */
const ENTITY_WRITE = (entity) =>
  new RegExp(`entityType\\s*:\\s*'${entity}'\\s*(?:as\\s+[A-Za-z_$][\\w$.]*)?`);

/** app-host 的 action 实现目录（判据 B 的扫描范围）。 */
const APP_HOST_SRC = 'packages/app-host/src';

/** 宿主扫描范围：只有各宿主 apps 的 src/ 算"用户碰得到"（判据 C/D）。 */
const HOST_ROOT = 'apps';
const HOST_REQUIRED_SUBDIR = 'src';

/* ========================================================================
 * 工具
 * ====================================================================== */

const isTestFile = (rel) =>
  /\.(spec|test)\./.test(rel) || /(^|[\\/])__tests__[\\/]/.test(rel) || /(^|[\\/])tests?[\\/]/.test(rel);

function* walk(target) {
  let st;
  try {
    st = statSync(target);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (/\.(tsx?|jsx?|mjs|cjs)$/.test(target)) yield target;
    return;
  }
  let entries;
  try {
    entries = readdirSync(target);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    yield* walk(join(target, name));
  }
}

const readIfExists = (rel) => {
  const abs = join(ROOT, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
};

/** 去掉行注释与块注释，避免"注释里的 anchor 被当成真的"。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
}

/* ========================================================================
 * 参数
 * ====================================================================== */

const argv = process.argv.slice(2);
const LIST_ONLY = argv.includes('--list');
const entityArg = argv.find((a) => a.startsWith('--entity='));
const ONLY_ENTITY = entityArg === undefined ? null : entityArg.slice('--entity='.length);

let failed = false;
const fail = (title, lines) => {
  failed = true;
  console.error(`🔴 ${title}`);
  for (const l of lines) console.error(l);
  console.error('');
};

console.log('─'.repeat(78));
console.log('「已建模 ≠ 可达」门禁（C-8）：实体有模型，就必须有写路径，也必须有人接');
console.log(`   ROOT = ${relative(process.cwd(), ROOT) || '.'}${process.env.HEYTA_CHECK_ROOT === undefined ? '' : '（HEYTA_CHECK_ROOT 副本）'}`);
console.log(`   范围 = ${APP_HOST_SRC} + ${HOST_ROOT} 下各宿主的 ${HOST_REQUIRED_SUBDIR}/`);
if (ONLY_ENTITY !== null) console.log(`   ⚠️ --entity=${ONLY_ENTITY}：只跑这一个实体（故障注入隔离用）`);
console.log('─'.repeat(78));

/* ========================================================================
 * 断言 A：锚点自检
 * ====================================================================== */

console.log('\n【断言 A】判据锚点必须真的扫得到（扫不到 = 判据失效，不是通过）\n');

const anchorErrors = [];
const registries = new Map();

for (const anchor of REGISTRY_ANCHORS) {
  const src = readIfExists(anchor.file);
  if (src === null) {
    anchorErrors.push(`   · ${anchor.file} 不存在（${anchor.label}）`);
    continue;
  }
  const set = anchor.extract(stripComments(src));
  if (set === null) {
    anchorErrors.push(
      `   · ${anchor.file} 里找不到 ${anchor.key} 的定义（${anchor.label}）—— ` +
        `判据的输入没了，本门禁已经不能做事`,
    );
    continue;
  }
  if (set.size === 0) {
    anchorErrors.push(`   · ${anchor.file} 的 ${anchor.key} 解析出 0 个实体（${anchor.label}）`);
    continue;
  }
  registries.set(anchor.key, set);
  console.log(`   ✅ ${anchor.key}（${anchor.label}）：${String(set.size)} 个实体`);
}

const unmodeledSrc = readIfExists(UNMODELED_ANCHOR.file);
let unmodeled = null;
if (unmodeledSrc === null) {
  anchorErrors.push(`   · ${UNMODELED_ANCHOR.file} 不存在（${UNMODELED_ANCHOR.label}）`);
} else {
  unmodeled = UNMODELED_ANCHOR.extract(stripComments(unmodeledSrc));
  if (unmodeled === null || unmodeled.length === 0) {
    anchorErrors.push(
      `   · ${UNMODELED_ANCHOR.file} 里找不到 / 解析不出 UNMODELED_ENTITY_TYPES（${UNMODELED_ANCHOR.label}）`,
    );
    unmodeled = null;
  } else {
    console.log(`   ✅ UNMODELED_ENTITY_TYPES（${UNMODELED_ANCHOR.label}）：${String(unmodeled.length)} 项`);
  }
}

/**
 * 🔴 A2：三处登记**必须相等**。
 *
 * 这一条不是锦上添花：判据 B 的输入直接取自这里。三处若不等，
 * "哪些实体已建模"就有多个互相矛盾的答案，而 B 会挑其中一份执行 ——
 * 那正是 `entities.ts` 文件头记过的"多份定义必然漂移"的形状。
 */
const modelUnion = new Set();
const modelInter = new Set(registries.get('EntityModelMap') ?? []);
for (const [key, set] of registries) {
  for (const e of set) modelUnion.add(e);
  if (key !== 'EntityModelMap') {
    for (const e of [...modelInter]) if (!set.has(e)) modelInter.delete(e);
  }
}

if (registries.size === REGISTRY_ANCHORS.length) {
  const mismatches = [];
  for (const e of modelUnion) {
    const present = [...registries.entries()]
      .filter(([, set]) => set.has(e))
      .map(([k]) => k);
    const missing = [...registries.keys()].filter((k) => !registries.get(k).has(e));
    if (missing.length > 0) {
      mismatches.push(`   · ${e}：只在 ${present.join(' / ')}，缺 ${missing.join(' / ')}`);
    }
  }
  if (mismatches.length > 0) {
    anchorErrors.push(
      `   · 三处实体登记**不相等**（判定依据是集合相等，不是"至少包含"）：\n` +
        mismatches.join('\n') +
        `\n     ⇒ 加一个实体要同时改三处（+ ` +
        `packages/shared-schema/src/entity-types.ts 的 ENTITY_TYPES）。` +
        `\n       只改一处会让"哪些实体已建模"出现多个互相矛盾的答案。`,
    );
  } else {
    console.log(`   ✅ 三处登记相等（集合相等）：${[...modelInter].sort().join(', ')}`);
  }
}

/** A4：action 家族锚点必须能扫到。 */
const appHostFiles = [];
if (!existsSync(join(ROOT, APP_HOST_SRC))) {
  anchorErrors.push(`   · ${APP_HOST_SRC} 不存在 —— 判据 B 没有扫描面`);
} else {
  for (const f of walk(join(ROOT, APP_HOST_SRC))) {
    const rel = relative(ROOT, f);
    if (isTestFile(rel)) continue;
    appHostFiles.push(rel);
  }
  if (appHostFiles.length === 0) {
    anchorErrors.push(`   · ${APP_HOST_SRC} 下一个实现文件都没扫到 —— 范围缺口会静默失效`);
  } else {
    console.log(`   ✅ ${APP_HOST_SRC}：${String(appHostFiles.length)} 个实现文件`);
  }
}

/** 读一遍 app-host 全部源码，供 B 与 A4 使用。 */
const appHostSrcMap = new Map();
for (const rel of appHostFiles) {
  appHostSrcMap.set(rel, stripComments(readIfExists(rel) ?? ''));
}

const familySeen = new Map();
for (const { family } of ACTION_FAMILIES) {
  const re = new RegExp(`export\\s+function\\s+${family}\\s*\\(`);
  const hits = [...appHostSrcMap.entries()].filter(([, src]) => re.test(src)).map(([rel]) => rel);
  familySeen.set(family, hits);
  if (hits.length !== 1) {
    anchorErrors.push(
      `   · action 家族 ${family} 在 ${APP_HOST_SRC} 里的**定义**有 ${String(hits.length)} 处` +
        `（期望恰好 1 处）：${hits.length === 0 ? '（一处都没有）' : hits.join(', ')}`,
    );
  }
}
/**
 * ⚠️ 这里每个家族只报一次，且用 `Set` 去重 —— 多个实体共用一族（PROJECT/TAG、
 * HABIT/HABIT_LOG）时不该出现三条同样的锚点错误。
 */
const seenFamilyAnchors = new Set(familySeen.keys());
console.log(
  `   ${anchorErrors.some((e) => e.includes('action 家族')) ? '🔴' : '✅'} action 家族锚点：` +
    `${String(seenFamilyAnchors.size)} 族（${[...seenFamilyAnchors].join(', ')}）`,
);

/** A5：宿主扫描面。 */
const hostFiles = [];
const hostApps = [];
if (!existsSync(join(ROOT, HOST_ROOT))) {
  anchorErrors.push(`   · ${HOST_ROOT}/ 不存在 —— 判据 C/D 没有扫描面`);
} else {
  for (const app of readdirSync(join(ROOT, HOST_ROOT))) {
    const srcDir = join(ROOT, HOST_ROOT, app, HOST_REQUIRED_SUBDIR);
    if (!existsSync(srcDir)) continue;
    hostApps.push(app);
    for (const f of walk(srcDir)) {
      const rel = relative(ROOT, f);
      if (isTestFile(rel)) continue;
      hostFiles.push(rel);
    }
  }
  if (hostFiles.length === 0) {
    anchorErrors.push(
      `   · ${HOST_ROOT} 下各宿主的 ${HOST_REQUIRED_SUBDIR}/ 一个源文件都没扫到 —— 范围缺口会静默失效`,
    );
  } else {
    console.log(
      `   ✅ 宿主扫描面：${String(hostApps.length)} 个宿主（${hostApps.join(', ')}），` +
        `${String(hostFiles.length)} 个源文件`,
    );
  }
}

if (anchorErrors.length > 0) {
  fail(
    '断言 A 不通过 —— 判据失效：',
    [
      ...anchorErrors,
      '',
      '   ⇒ 这不是"没有违规"，是**这道检查已经不能做事了**（见文件头，与',
      '      check-pricing-consistency.mjs / check-empty-state.mjs 同一条纪律：',
      '      **匹配不到就跳过是禁止的**）。',
      '      修法：确认锚点仍在原处；若只是改名，同步更新本脚本的 REGISTRY_ANCHORS /',
      '      UNMODELED_ANCHOR / ACTION_FAMILIES —— **不要**把判据放宽成"扫不到就通过"。',
    ],
  );
} else {
  console.log('\n   ✅ 断言 A 通过：判据的输入（实体清单三处 + 未建模清单 + 两个扫描面）都真的在。');
}

/* ========================================================================
 * 实体账（判据 B / C / D 的输入，永不写死）
 * ====================================================================== */

const modeled = [...modelInter].sort();
const judged = ONLY_ENTITY === null ? modeled : modeled.filter((e) => e === ONLY_ENTITY);
/**
 * `--entity` 只用于**故障注入隔离**：把判据范围缩到一个实体。
 *
 * ⚠️ 允许它指向 `UNMODELED_ENTITY_TYPES` 里的项（那是断言 D 的输入，
 * 例如 `REMINDER`）；只在**两个清单都没有**时才判"无法执行"。
 * 这一点是刻意写出来的：只认已建模清单的话，`--entity=REMINDER` 会被
 * 误报成"写错了实体名"，而它其实是一条完全合法的判据输入 ——
 * 那正是"判据覆盖不到的输入被当成通过/当成错误"的形状。
 */
{
  const knownEntities = new Set([...modeled, ...(unmodeled ?? []).map((u) => u.entityType)]);
  if (ONLY_ENTITY !== null && judged.length === 0 && !knownEntities.has(ONLY_ENTITY)) {
    fail('判据无法执行：', [
      `   · --entity=${ONLY_ENTITY} 既不在已建模清单里，也不在未建模清单里`,
      `     （已建模：${modeled.join(', ')}）`,
      `     （未建模：${(unmodeled ?? []).map((u) => u.entityType).join(', ')}）`,
      '   ⇒ 故障注入写错了实体名，或者清单已经变了。**不当作通过。**',
    ]);
  }
}

const appHostRel = (needle) =>
  [...appHostSrcMap.entries()]
    .filter(([, src]) => needle.test(src))
    .map(([rel]) => rel);

/** 判据 B：写路径。 */
const writes = new Map(); // entity → rel[]
for (const entity of modeled) {
  writes.set(entity, appHostRel(ENTITY_WRITE(entity)));
}

/** 判据 C：宿主调用点（家族级；家族 → rel[]）。 */
const hostCallSites = new Map(); // family → rel[]
for (const family of new Set(ACTION_FAMILIES.map((f) => f.family))) {
  const re = new RegExp(`\\b${family}\\s*\\(`);
  const hits = [];
  for (const rel of hostFiles) {
    const src = stripComments(readIfExists(rel) ?? '');
    if (re.test(src)) hits.push(rel);
  }
  hostCallSites.set(family, hits);
}

if (LIST_ONLY) {
  console.log('\n【实体账】（--list，只打印不判红）\n');
  for (const entity of modeled) {
    const w = writes.get(entity);
    const fam = ACTION_FAMILIES.find((f) => f.entity === entity)?.family;
    const c = fam === undefined ? [] : (hostCallSites.get(fam) ?? []);
    console.log(
      `   ${entity.padEnd(24)} action ${w.length > 0 ? '✅' : '❌'} ${String(w.length).padStart(2)} 处` +
        `   家族 ${fam ?? '（无）'}   宿主调用点 ${String(c.length)} 处`,
    );
  }
  console.log('');
  process.exit(0);
}

/* ========================================================================
 * 断言 B：已建模实体必须有写路径
 * ====================================================================== */

console.log('\n【断言 B】已建模的实体，必须在 app-host 里有一条写路径');
console.log("             （判据：源码里 entityType 指向该实体的真实出现，注释不算）\n");

const zeroWrite = [];
for (const entity of judged) {
  const hits = writes.get(entity);
  if (hits.length === 0) {
    zeroWrite.push(entity);
    console.log(`   🔴 ${entity.padEnd(24)} 0 处写路径`);
  } else {
    console.log(`   ✅ ${entity.padEnd(24)} ${String(hits.length).padStart(2)} 处：${hits.join(', ')}`);
  }
}

/**
 * 🔴 零 action 不是"没有违规"。
 *
 * 这一条就是 C-8 的**主要杠杆**：13 个幻觉里最典型的那个（`NOTE`，幻觉 #12）
 * 在两道既有门禁下**全是绿的** —— 它建模齐全、桶存在、导出覆盖、词条齐全。
 * 只有"有没有一条能写它的 action"这一个问题能把它单独拎出来。
 */
if (zeroWrite.length > 0) {
  const lines = [];
  for (const entity of zeroWrite) {
    const inUnmodeled = unmodeled?.find((u) => u.entityType === entity);
    lines.push('');
    lines.push(`   · ${entity} —— 已建模，但 app-host 里**一处写 op 的地方都没有**。`);
    lines.push(
      `       登记齐全（EntityModelMap + MODELED_ENTITY_TYPES + BUCKET_BY_ENTITY），` +
        `桶存在、会被 export-dump 导出、op 能同步到所有设备，`,
    );
    lines.push('       但**没有任何 action 能生成它**（三问的第 1 问：有没有 app-host 的 action？）。');
    if (inUnmodeled !== undefined) {
      lines.push(`       ⚠️ 它在 UNMODELED_ENTITY_TYPES 里的 reason 是：「${inUnmodeled.reason}」`);
    }
    const displayOnly = [];
    for (const rel of ['packages/ui/src/sync/model.ts']) {
      const src = readIfExists(rel);
      if (src !== null && new RegExp(`\\b${entity}\\b`).test(src)) displayOnly.push(rel);
    }
    if (displayOnly.length > 0) {
      lines.push(
        `       ⚠️ 它在 ${displayOnly.join(', ')} 里出现，但那是**实体名标签映射（显示用途）**，` +
          `不是可达路径 ——`,
      );
      lines.push('          把它算作"调用点"会让本门禁在这里变绿，那是假的完备。');
    }
    lines.push('       修法：在 app-host 里补一族 action（照 `habit-actions.ts` 的形状），');
    lines.push('             并在宿主（apps/web 或 apps/mobile）里接上真实入口。');
    lines.push(
      `             ⚠️ **不要**把 ${entity} 从 EntityModelMap 里删掉来"修绿" —— ` +
        `那会让合法的历史 op`,
    );
    lines.push('                变成未知实体而被静默丢弃（op-log 对未知实体的处理就是跳过）。');
  }
  fail(
    `断言 B 不通过：${String(zeroWrite.length)} 个已建模的实体**零写路径**`,
    [
      ...lines,
      '',
      '   ⇒ 判据出处：site-and-parity-alignment.md §C-8（「基础设施做完了、最后一米没接」）。',
      '      这不是 13 个实例里的某一个的问题，是**产生它们的机制**：实体登记与',
      '      可用性之间没有任何门禁。本门禁不修这些实体，它只让"下一个"无法再发生。',
    ],
  );
} else {
  console.log('\n   ✅ 断言 B 通过：每一个已建模实体都有写路径。');
}

/* ========================================================================
 * 断言 C：有写路径的实体必须有宿主调用点
 * ====================================================================== */

console.log('\n【断言 C】有写路径的实体，必须有**宿主**（各宿主 src/）的真实调用点');
console.log('             （测试与共享层定义不算 —— 理由见文件头「刻意排除」）\n');

const cErrors = [];
const cChecked = judged.filter((e) => (writes.get(e) ?? []).length > 0);
for (const entity of cChecked) {
  const mapping = ACTION_FAMILIES.find((f) => f.entity === entity);
  if (mapping === undefined) {
    cErrors.push(
      `   · ${entity} 有写路径，但 ACTION_FAMILIES 里没有它的宿主 action 家族 —— ` +
        `**无法判定**。\n` +
        `       这不是"通过"：把新实体漏在这张表外就能自动跳过，正是"扫不到就跳过"。\n` +
        `       修法：把 ${entity} 的宿主 action 家族补进 ACTION_FAMILIES。`,
    );
    continue;
  }
  const sites = hostCallSites.get(mapping.family) ?? [];
  if (sites.length === 0) {
    cErrors.push(
      `   · ${entity}（家族 ${mapping.family}）在 ${HOST_ROOT} 下各宿主的 ${HOST_REQUIRED_SUBDIR}/ 里` +
        `**零调用点**。\n` +
        `       写路径在（app-host 里 op 构造全对），但没有任何宿主建过这族 action ——\n` +
        `       这正是三问的第 2 问：**有没有宿主的调用点？**（没有它，用户碰不到）`,
    );
  } else {
    console.log(`   ✅ ${entity.padEnd(24)} ${mapping.family}：${sites.length} 处宿主调用点`);
    for (const rel of sites.slice(0, 4)) console.log(`        · ${rel}`);
    if (sites.length > 4) console.log(`        · …另有 ${String(sites.length - 4)} 处`);
  }
}
if (cErrors.length > 0) {
  fail(`断言 C 不通过：${String(cErrors.length)} 项`, [
    ...cErrors,
    '',
    '   ⇒ 判据出处：dida365-feature-benchmark.md §3.1 三问的第 2 问。',
    '      ⚠️ 宿主调用点必须是**生产代码**里的调用。测试（`*.spec.*` / `tests/`）与',
    '         `e2e/` 都**不算** —— 它们证明"能力存在"，不证明"用户碰得到"。',
  ]);
} else {
  console.log('\n   ✅ 断言 C 通过：有写路径的实体全部有宿主调用点。');
}

/* ========================================================================
 * 断言 D：合法但未建模的实体，reason 必须是真的
 * ====================================================================== */

console.log('\n【断言 D】UNMODELED_ENTITY_TYPES 里"尚未开始"的项，必须有人接');
console.log('             （"决定不用"的项豁免 —— 豁免读自 reason 自身，不写死在本脚本）\n');

const dErrors = [];
if (unmodeled !== null) {
  /**
   * 🔴 豁免的判定**读源码里的 reason**，不是本脚本写死"TASK_REPEAT_CFG 豁免"。
   *
   * 写死的话，下一个人把 reason 改成"尚未开始"而行为不变 —— 门禁看不出来。
   * 读 reason 则是：**这句话本身就是要经得起检查的那个事实**。
   */
  const DECIDED_NOT_TO = /决定不用|有意不|有意落|不是"还没做"|不是「还没做」|不是还没做/;
  const skip = ONLY_ENTITY === null ? null : new Set(judged);
  void skip;
  for (const item of unmodeled) {
    if (ONLY_ENTITY !== null && item.entityType !== ONLY_ENTITY) continue;
    if (DECIDED_NOT_TO.test(item.reason) || item.reason.includes('不是用户数据') || item.reason.includes('不是真实实体')) {
      console.log(`   ⏭️  ${item.entityType.padEnd(24)} 豁免（reason 表明是"决定不用/不属于用户数据"）`);
      continue;
    }
    const hasWrite = (writes.get(item.entityType) ?? []).length > 0;
    const mentionedInApps = hostFiles.filter((rel) =>
      new RegExp(`\\b${item.entityType}\\b`).test(readIfExists(rel) ?? ''),
    );
    if (hasWrite || mentionedInApps.length > 0) {
      console.log(
        `   ✅ ${item.entityType.padEnd(24)} 未建模，但有引用（action ${String(writes.get(item.entityType)?.length ?? 0)} 处 / 宿主提及 ${String(mentionedInApps.length)} 处）`,
      );
    } else {
      dErrors.push(
        `   · ${item.entityType} —— 合法实体名、**零建模、零 action、宿主里零提及**。\n` +
          `       reason 自己写着：「${item.reason}」\n` +
          `       ⇒ 它读起来像"已经建模"（服务端接受这个类型、op 能入队并同步到所有设备），\n` +
          `         而**没有任何设备会物化它、没有任何 action 能建它** —— 用户数据的静默黑洞。\n` +
          `       修法（二选一）：\n` +
          `         a) 真的做：加领域模型 → 三处登记 → app-host action（照 habit-actions.ts）→ 宿主入口；\n` +
          `         b) 决定不做：把 reason 改成明确的"决定不用"+ 依据，本门禁会豁免它\n` +
          `            （**不许**为了让门禁变绿而删掉这一项 —— 那会让 op-log 把它当未知实体静默丢弃）。`,
      );
    }
  }
}
if (dErrors.length > 0) {
  fail(`断言 D 不通过：${String(dErrors.length)} 项`, [
    ...dErrors,
    '',
    '   ⇒ 判据出处：dida365-feature-benchmark.md §3 幻觉 #1（任务提醒）——',
    '      `REMINDER` 是合法实体名，读起来像"已经建模"。',
  ]);
} else {
  console.log('\n   ✅ 断言 D 通过：未建模的项要么已决定不做，要么有引用。');
}

/* ========================================================================
 * 结论
 * ====================================================================== */

console.log('');
console.log('─'.repeat(78));
if (failed) {
  console.error('🔴 「已建模 ≠ 可达」门禁未通过。');
  console.error('');
  console.error('   ⚠️ 门禁红了本身也是有效产出：它抓到的每一条都是真的"最后一米没接"。');
  console.error('      **不要**用下列任一手法修绿（都会被下一个人复制）：');
  console.error('        · 把实体从 EntityModelMap / BUCKET_BY_ENTITY 删掉；');
  console.error('        · 把 action 家族补进本脚本的 ACTION_FAMILIES 而不写 action；');
  console.error('        · 把测试或 e2e 当成调用点。');
  console.error('');
  process.exit(1);
}
console.log('✅ 「已建模 ≠ 可达」：四条断言都通过。');
console.log(
  `   已建模 ${String(judged.length)} 个实体，每个都有写路径与宿主调用点；` +
    `未建模清单 ${String(unmodeled?.length ?? 0)} 项都已结清。`,
);
console.log('');
