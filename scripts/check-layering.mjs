#!/usr/bin/env node
/**
 * 分层门禁：`apps/*` 不得重新长出"业务上该怎么做"的代码。
 * =====================================================
 *
 * AGENTS.md §3.5 定的判据是：**这段代码里有没有任何一行在决定"业务上该怎么做"？**
 * 有就说明它该在 `packages/` 里，不在 `apps/` 里。
 *
 * 但那条判据是**靠人读的**，而人读过一次之后就不再看第二遍。本文件把它变成
 * 一批机器可查的具体形状（**条数以本文件打印的为准，别在文档里抄数**）——
 * 全部来自**已经真实发生过**的漂移：
 *
 *   1. `new SyncClient(` —— 12 个回调的接线。曾在 `packages/app-host` 与
 *      `apps/web` 里各有一份，**逐字相同，连注释都是复制的**。
 *   2. 自己定义 `resolveClientId` —— 曾在 `apps/web/src/lib/oplog.ts` 里有一份，
 *      回退逻辑与 `app-host` 的那份已经不同（`Math.random()` vs `randomId()`）。
 *      clientId 是 LWW 冲突的**决胜依据**，两份实现等于两套裁决标准。
 *   3. 直接 `crypto.randomUUID(` —— 外壳里这么写就是假定它在。
 *      `ids.ts` 记着实测事故：Hermes 上 `globalThis.crypto` 整个不存在，
 *      应用**启动即崩**在解析 clientId 那一步。必须走 `randomId()`。
 *   4. `OpLogStore` 的游标键名（`lastServerSeq` 字面量）—— 键名只该定义在
 *      `packages/storage` 的 `META_KEYS` 里。外壳自己拼字面量，
 *      换键名时就会有一端悄悄读到 0（= 每次全量重下，或者更糟）。
 *   5. **模型端点字面量 / 厂商 AI SDK** —— 见下方 RULES 里的 `no-model-endpoint-in-apps`
 *      与 `no-vendor-ai-sdk-in-apps`。这一条与上面四条不同：前四条是**防漂移**，
 *      这两条是**防数据出境失控**（ADR-0005 / ADR-0006）。
 *      > ⚠️ 它们的**前提是 `packages/ai` 存在**。在该包落地之前，
 *      > 这两条规则是"提前立的规矩"，而不是在保护一份已存在的实现。
 *   6. **外壳里自己拼 op**（`no-op-construction-in-apps`）。
 *      🔴 这一条是**补上的收尾动作**。AGENTS.md §3.5 末尾那条教训写得很清楚：
 *      **"抽出了一个共享实现"不等于"重复被消除了"** —— `createTaskActions`
 *      抽出来之后，`apps/web` 那份**从没被删掉**，而且**漂移了**。
 *      文档里记着它，它却一直活在代码里，因为**当时没有门禁钉住它**。
 *      加这条规则时它一次抓出了 **17 处**（实测 `apps/web`：7 TASK / 4 PROJECT /
 *      2 TAG / 2 HABIT / 2 HABIT_LOG）—— 那是**真实存在的违规**，
 *      比注入一个假违规更有说服力。
 *   7. **外壳里自己声明助手档位**（`no-assistant-tier-literal-in-apps`）。
 *      同一条收尾动作的第二遍：`assistantTier` 的**默认值 + fail-closed 归一 +
 *      两档顺序**原先住在 `apps/web/src/features/settings/aiStore.ts` 与
 *      `AiSettings.tsx` 里，2026-10 抽进 `packages/app-host/src/assistant-tier-settings.ts`。
 *      这一档决定"模型这次能不能改用户的数据"，而**两个壳的默认值不一样时不会报错** ——
 *      症状是同一个用户在两台设备上权限不同，界面却都写着"只读"。
 *
 * 前两条是本文件写出来时**刚刚修掉的**；后四条是仓库里已经记录过的同形状事故
 * 与已定案的 ADR 约束。
 * 把它们一起钉住，是因为修复一个具体 bug 的正确收尾方式是
 * **让它再也回不来**，而不是相信下次不会有人再写一遍。
 *
 * 用法：node scripts/check-layering.mjs
 *   非零退出 = 有违规。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPS = join(ROOT, 'apps');

/** 不扫的目录：产物与第三方源码，不是我们写的。 */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-types',
  'build',
  'coverage',
  'Pods',
  '.gradle',
  '.cxx',
  'ios',
  'android',
  '.expo',
]);

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

/** 每条规则：一个正则 + 为什么它有害 + 正确做法。 */
const RULES = [
  {
    id: 'no-sync-client-construction',
    pattern: /\bnew\s+SyncClient\s*\(/,
    what: '直接构造 SyncClient',
    why: '它的 12 个回调是宿主无关的接线，复制一份就会与 packages/app-host 的那份漂移。',
    fix: '用 `createSyncClient({ engine, store, baseUrl, getToken, getPassword, applyRemote })`（@heyta/app-host）。宿主只该注入这 5 样。',
  },
  {
    id: 'no-local-resolve-client-id',
    pattern: /(?:async\s+)?function\s+resolveClientId\s*\(|const\s+resolveClientId\s*[:=]/,
    what: '自己定义 resolveClientId',
    why: 'clientId 是 LWW 冲突的确定性决胜依据。两份实现 = 两套裁决标准，而两台设备撞 id 会让冲突处理失去确定性。',
    fix: '从 `@heyta/app-host` 导入 `resolveClientId(adapter)`。它存在 `META_KEYS.CLIENT_ID`，与所有宿主同一个键。',
  },
  {
    id: 'no-direct-random-uuid',
    pattern: /\bcrypto\s*\.\s*randomUUID\s*\(/,
    what: '直接调用 crypto.randomUUID()',
    why: 'Hermes 上 `globalThis.crypto` 可能整个不存在（实测：应用启动即崩在解析 clientId 那一步，停在错误页）。',
    fix: '用 `randomId()` / `newTaskId()`（@heyta/app-host）。它们带完整回退，且回退的强度代价已在 ids.ts 里写清。',
  },
  {
    id: 'no-literal-cursor-key',
    pattern: /['"]lastServerSeq['"]/,
    what: '外壳里硬写游标键名',
    why: '键名只该定义在 packages/storage 的 META_KEYS 里。外壳自己拼字面量，改键名时会有一端静默读到 0。',
    fix: '用 `OpLogStore` 的 `getLastServerSeq()` / `setLastServerSeq()`，或 `META_KEYS.LAST_SERVER_SEQ`。',
  },
  {
    id: 'no-model-endpoint-in-apps',
    // 只匹配**模型服务端点**的字面量，不匹配普通 fetch —— 外壳当然要能发请求。
    // 覆盖：OpenAI 兼容的 /chat/completions、各家官方主机名、Google 的 generateContent。
    pattern:
      /chat\/completions|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai|openrouter\.ai\/api|:11434\/v1/,
    what: '外壳里直接写模型端点',
    why:
      '两个理由，每个都足以打回：① 违反 ADR-0003/AGENTS.md §3.5 —— 走哪个端点、带什么字段、' +
      '怎么处理失败，全是产品语义，属于 packages/；② **违反 ADR-0005/0006 的数据出境约束** —— ' +
      '出境必须经过统一的披露与授权层，散落在外壳里的 fetch 无法被审计，用户也无从撤销。',
    fix:
      '用 `packages/ai` 的 provider 端口（`createProvider(config)`）。它同时承载"用户自备端点"与' +
      '"heyta 托管"两种供给模式，并在发请求前走出境披露层。',
  },
  {
    id: 'no-vendor-ai-sdk-in-apps',
    // 厂商 SDK 一律不引入：它们各自一套认证、重试、流式协议，
    // 且会把 provider 选择硬编码进外壳。OpenAI 兼容的 /v1 已是事实标准。
    pattern: /from\s+['"](?:openai|@anthropic-ai\/sdk|@google\/generative-ai|cohere-ai|@mistralai\/[^'"]+)['"]/,
    what: '外壳里直接 import 厂商 AI SDK',
    why:
      '厂商 SDK 会把 provider 选择、凭据位置、重试策略硬编码进外壳，' +
      '而这三样都必须能由用户在"自备 / 托管"之间切换（ADR-0006）。' +
      'SDK 也是新的第三方依赖，要过 AGENTS.md §3.1–3.2 两道门并逐项登记。',
    fix: '只依赖 `packages/ai` 的端口，实现统一走 OpenAI 兼容的 HTTP 契约，不引厂商 SDK。',
  },
  {
    id: 'no-op-construction-in-apps',
    // 匹配 `entityType: 'TASK'` 这种**字面量**，不匹配 `entityType: someVariable`。
    // 这一条抓的就是"外壳在自己拼 op" —— 拼 op 必然要写出实体名。
    pattern: /\bentityType:\s*['"][A-Z][A-Z_]*['"]/,
    what: '外壳里自己拼 op（写死了 entityType 字面量）',
    why:
      'op 的构造是**产品语义**：写哪些字段、清除字段用 `null` 还是省略、软删除发 `DEL` 还是改标志位、' +
      'id 怎么生成 —— 全都要在所有宿主上**一模一样**。而这一类漂移**不会报错**，' +
      '症状是两台设备看到不同的数据。实测代价：`createTaskActions` 早就存在、移动端一直在用，' +
      '`apps/web` 却另外留着一份自己的实现，且**已经漂移**（本地计数器生成 id、' +
      '空标题静默忽略、`Partial<Task>` 直接摊进 payload）。' +
      '同一个形状在专注上也有：Web 那份未关联时**不放 `taskId` 键**，移动端写 `null`。' +
      '**这条规则上线时一次抓出 17 处真实违规**（TASK 7 / PROJECT 4 / TAG 2 / ' +
      'HABIT 2 / HABIT_LOG 2），全部已收编进 app-host 的动作层。' +
      '注意这不是"顺手整理"：那 7 处 TASK 是在 `createTaskActions` **已经存在、' +
      '移动端已经在用**的情况下继续活着的 —— 抽取的收尾动作是删掉旧的那份**并加门禁**，' +
      '不是写一个更好的新版本。',
    fix:
      '用 `@heyta/app-host` 的动作层：`createTaskActions` / `createProjectActions`' +
      '（含 TAG）/ `createHabitActions`（含 HABIT_LOG）/ `createFocusActions`。' +
      '**所有已物化的实体都已有对应动作层，不要再在外壳里就地拼。**' +
      '将来新增实体时，先在 app-host 里加动作层，再让外壳调它。' +
      '注意测试文件不在此规则范围内（见 `walk()`）：测试**可以**直接造 op，' +
      '那是在模拟另一台设备，不是在重新定义产品语义。',
  },
  {
    id: 'no-loopback-classification-in-apps',
    // 🔴 只抓**判断**，不抓**绑定**。
    //
    //   ❌ `hostname === '127.0.0.1'`      ← 在判断"这个端点在不在本机"
    //   ❌ `/^https?:\/\/(localhost|127...)\.test(url)` ← 同上，手写正则
    //   ✅ `server.listen(port, '127.0.0.1')` ← 这是我们**自己**在监听，是反过来的事
    //
    // 所以：正则字面量里出现回环主机名 → 抓；拿回环主机名做相等比较 → 抓。
    // 单纯把 `'127.0.0.1'` 当参数传出去（listen / host:）→ 不抓。
    pattern:
      /\/(?:[^/\\]|\\.)*(?:localhost|127\\?\.0\\?\.0|::1)(?:[^/\\]|\\.)*\/[gimsuy]*|(?:===|!==|==|!=)\s*['"](?:localhost|127\.0\.0\.\d+|::1)['"]/,
    what: '外壳里自己判断"这个端点是不是本机"',
    why:
      '"端点算不算本机"决定**要不要给用户看 E2EE 警告** —— 这是产品语义，' +
      '而且错了只会往一个方向错：把远端判成本机 → **警告被跳过**，' +
      '用户以为数据没出设备。实测就是这次：`apps/web` 里一个手写正则把 ' +
      '`http://127.0.0.1:80@evil.com/v1` 判成了本机（`127.0.0.1` 是 userinfo，' +
      '真实主机是 `evil.com`），于是**不显示警告而数据发给了 evil.com**。' +
      '同一正则还把 `http://LOCALHOST:11434/v1` 和 `http://127.0.0.2:11434/v1` ' +
      '判成远端（真实判据是"大小写不敏感"+"127/8 整段回环"），造成虚假警告。' +
      '注释当时还写着"与 classifyDestination 同一条判据" —— **它不是**。' +
      '这和 ADR-0010 §3.10.1 记的是同一个形状：同一件事有两个实现就一定会漂移。',
    fix:
      '调 `packages/ai` 的 `isLoopbackEndpoint()`。要判断"数据去哪"用 ' +
      '`classifyDestination()`。⚠️ 注意区分：`listen(port, \'127.0.0.1\')` 是' +
      '**我们自己**在监听，属于外壳职责，不受本规则限制。',
  },
  {
    id: 'no-local-category-color-map',
    /**
     * 两种形态都拦 —— 因为两种都真实出现过（M0-1，2026-09-27）：
     *
     *   (a) 起个名字（`SLOT_TOKENS` / `HEAT_VARS`…），再赋一个数组/对象字面量
     *   (b) 名字起成别的，但结构是「数字槽位键 → 颜色 token 字符串」
     *
     * (b) 分支存在的理由：只按变量名拦是**可绕过的** ——
     * 下一个人把 `SLOT_TOKEN` 改名成 `colors` 就溜过去了，而漂移照旧。
     *
     * ⚠️ 它**不匹配**合法形态：`const SLOT_TOKENS = CATEGORY_SLOT_TOKEN_BY_SLOT`
     * 是**从单点派生**（`=` 后不是字面量），规则要求 `=` 后紧跟 `[` 或 `{`，
     * 所以放行 —— 那正是要鼓励的写法。
     */
    pattern:
      /(?:SLOT_TOKENS?|HEAT_VARS|HEAT_TOKENS)\s*(?::[^=]+)?=\s*[[{]|\{\s*1\s*:\s*['"](?:color\.|--ht-)/,
    what: '外壳里手写「槽位 / 热力」到颜色的映射',
    why:
      '这是 ADR-0010 §3.10.1 那个形状最隐蔽的版本：**它不会失败**。' +
      '实测（M0-1）：槽位映射在 `packages/design-system` 有一份真源，' +
      '`apps/web` 从真源**派生**，而 `apps/mobile` **手抄了 8 个槽位值 + 5 个 heat 值**。' +
      '于是改掉一个槽位取值后，Web 跟着变、移动端**静默保持旧色**，' +
      '而**没有任何测试会红** —— 设计系统原有的测试只钉自己的 registry，' +
      '从不看外壳的副本。更糟的是移动端那份的注释还写着' +
      '"设计系统那边的测试已经在钉这件事"，而那句话是错的。' +
      '取值必须只有一份，且那一份在 `packages/` 里。',
    fix:
      '用 `CATEGORY_SLOT_TOKEN_BY_SLOT` / `HEAT_TOKENS` / `UNSET_CATEGORY_TOKEN`' +
      '（`@heyta/design-system`）。外壳只保留**最后一层适配**：' +
      'Web 用 `cssVar()` 包成 `var(--ht-*)`，RN 多传一个 `tokens` 参数。',
  },
  {
    id: 'no-assistant-tier-literal-in-apps',
    // 档位只有两个取值，而它们的**值本身**是磁盘格式（已写进用户设备的
    // `localStorage`，将来还会写进原生端的表）。外壳里出现引号字面量，
    // 就意味着这个外壳在自己声明"哪一档是只读、哪一档算开写"。
    pattern: /['"](?:read-only|read-and-propose)['"]/,
    what: '外壳里自己声明助手档位（写死了档位字面量）',
    why:
      '档位决定**模型这一次能不能改用户的数据**：默认值是哪一档、坏值往哪边落、' +
      '两档谁高谁低 —— 全是产品语义（ADR-0045 §2.2 / ADR-0014 的 fail-closed）。' +
      '抽取之前这三行住在 `apps/web/src/features/settings/aiStore.ts` 里。' +
      '下一个壳（node-host、移动）接助手时**必然自己再写一遍**，而两份的默认值或' +
      '归一方向只要有一个不同，同一个用户在两台设备上就有两种权限 —— ' +
      '症状还是"界面上写着只读、其实能写"，**没有任何一层会报错**。' +
      '这与 §3.5 记的 `createTaskActions` 事故同形：共享实现抽出来了、旧那份从没删掉，' +
      '因为当时没有门禁。所以本条同时钉住"顺序第一格必须是默认档"赖以成立的那份列表。',
    fix:
      '从 `@heyta/app-host` 取：`DEFAULT_ASSISTANT_TIER`（出厂默认）、' +
      '`normalizeAssistantTier(raw)`（读回时的 fail-closed 归一）、' +
      '`ASSISTANT_TIER_ORDER`（低→高，界面渲染顺序）、' +
      '`ASSISTANT_TIER_READ_ONLY` / `ASSISTANT_TIER_READ_AND_PROPOSE`（要比较或建 `Record` 时用常量）。' +
      '**存储通道仍归壳**（Web 是 `heyta.ai.settings` 那块 JSON，原生端是 SQLite/偏好）：' +
      '壳可以决定"存在哪"，不可以决定"默认算什么、坏值算不算开写"。' +
      '自己存这一档的宿主用 `createAssistantTierStore(port)`。',
  },
];

/** 该行是否在注释里（粗略但足够：只看行首 token）。 */
function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (EXTENSIONS.some((e) => name.endsWith(e))) {
      // 测试文件不在此列：它们**可以**直接构造被测对象。
      if (/\.(spec|test)\.[cm]?tsx?$/.test(name)) continue;
      yield full;
    }
  }
}

const violations = [];
let scanned = 0;

for (const file of walk(APPS)) {
  scanned += 1;
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');

  for (const rule of RULES) {
    lines.forEach((line, i) => {
      // 注释里提到这些名字是**解释**，不是违规。
      // （本门禁自己的文档、以及各文件头解释"为什么不再这么写"都靠这条。）
      if (isCommentLine(line)) return;
      if (rule.pattern.test(line)) {
        violations.push({ rel, line: i + 1, rule, text: line.trim() });
      }
    });
  }
}

if (violations.length === 0) {
  console.log(`✅ apps/* 分层边界完好（扫描 ${String(scanned)} 个文件，${String(RULES.length)} 条规则）。`);
  process.exit(0);
}

console.error(`🔴 apps/* 里有 ${String(violations.length)} 处违规：\n`);
for (const v of violations) {
  console.error(`   ${v.rel}:${String(v.line)}`);
  console.error(`      违规：${v.rule.what}`);
  console.error(`      代码：${v.text}`);
  console.error(`      为什么有害：${v.rule.why}`);
  console.error(`      正确做法：${v.rule.fix}\n`);
}
console.error('规则出处：AGENTS.md §3.5（宿主外壳的边界）。\n');
process.exit(1);