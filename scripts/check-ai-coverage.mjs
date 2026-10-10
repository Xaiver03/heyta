#!/usr/bin/env node
/**
 * 门禁：**声明的 AI 功能必须真的能走到**。
 *
 * ## 为什么需要这条
 *
 * 2026-09-26 实测：`AiFeature` 联合类型里有四个成员
 * （`capture` / `breakdown` / `prioritize` / `duration-estimate`），
 * 设置界面也会**为这四个功能逐个渲染配置行**（选端点、声明能力、逐功能授权），
 * 但**只有 `breakdown` 一条链路真的通**。
 *
 * 后果是具体的，不是理论上的：
 *
 *   用户可以给「优先级建议」配好端点、勾上能力、点下"我同意这个功能出境"，
 *   然后**什么都不会发生，而且没有任何提示**。
 *
 * 这是最坏的一类失效：**功能是空的，界面在说谎**。类型系统不会报，
 * 因为 `'prioritize'` 确实是一个合法的 `AiFeature`；单测也不会报，
 * 因为没有任何东西可以测。它只在"有人真的去用"的时候才暴露，
 * 而那时用户已经先相信了界面。
 *
 * 仓库里同类失效已经出现过 **12 次以上**：能力实现了、单测全绿、
 * **零个生产调用点**。见 `docs/reference/ai-architecture.md` §16 第 8 条。
 *
 * ## 这条门禁查什么
 *
 * 它**由 `AiFeature` 联合类型驱动** —— 不是写死一份清单。
 * 往联合类型里加一个成员，这条门禁立刻开始要求它的全套接线；
 * 漏了任何一处就红。换句话说：**联合类型是规格，这条门禁是执行**。
 *
 * 对每一个 `AiFeature`：
 *
 *   1. `packages/app-host/src/` 里有调用构建器（出现 `feature: '<F>'`）
 *   2. 该文件导出了 `request<X>` 形式的入口函数
 *   3. 该入口**从 `packages/app-host/src/index.ts` 可达**（防止"写了但没导出"）
 *   4. `packages/ai/src/routing.ts` 的 `DEFAULT_FEATURE_CAPABILITIES` 声明了它
 *   5. `packages/domain/src/preference-hints.ts` 的 `RELEVANT_PREFERENCES` 声明了它
 *   6. 界面**真的可达**，对 `UI_ENDS` 里的**每一端**分别查两级：
 *      a. 该端的 `src/` 里有人调用它的入口（防止"后端通了但界面没有入口"）
 *      b. 调用它的那个界面文件**自己也被别处以 JSX 渲染**（防止"组件写好了但没挂载"）
 *
 *      🔴 第 b 级是**被一个坏门禁逼出来的**：第一版只查 a，于是两个组件
 *      静静地 import 了入口就让门禁变绿 —— 而没有任何地方渲染它们。
 *      这正是同一类失效上升了一层。**门禁绿不等于用户能用**，
 *      所以这里必须查到"渲染"为止，而不是查到"引用"为止。
 *
 * 外加两条**反向**检查：
 *
 *   7. app-host 里出现的 `feature: 'X'` 必须都是合法的 `AiFeature`
 *      （防止拼写漂移出一个永远不会被路由到的功能）
 *   8. 运行时不变式：**托管云 AI 仍然被挡住**（ADR-0013），且「这一份不受端到端
 *      加密保护」的明确否定仍在**界面真正渲染的两份词条表**里
 *      （ADR-0006 的结论不许被悄悄改掉）
 *
 * 再加一段**另一个轴**的覆盖（第 9 段，详见那里的注释）：驱动源不是 `AiFeature`
 * 而是 `EntityModelMap` —— 每个用户可操作的实体都必须**读得到也改得动**，
 * 否则要带 `AI-COV-n` 工单号在这里逐字点名。倒数日 `EVENT` 落进
 * `EntityModelMap` 的那一刻，这一段会当场变红（ADR-0044 要的"同批"就是靠它执行）。
 *
 * ## 为什么第 8 条是运行时而不是静态
 *
 * 因为它是**决策**，不是**写法**。静态地 grep `supply.ts` 只能证明
 * "某一行还在"，证明不了"它现在的行为还是那样"。所以这里直接
 * `import` 构建产物、真的调一次 —— 它挂掉就说明决策被改动了。
 *
 * ⚠️ 它依赖 `packages/ai/dist/`，而 `pnpm check` 会先跑 `pnpm build`，
 * 所以正常路径下产物一定是新的。单独跑这个脚本前请先 `pnpm build`。
 *
 * ## 误报怎么办
 *
 * 如果某个功能**确实**不需要某个端的直接界面入口（例如由复合 Chatbot 或
 * 宿主 worker 消费），把它按端加进 `NO_UI_ENTRY_BY_END` 并**写明理由** ——
 * 不要放宽匹配规则，也不要把它豁免到所有端。
 * 放宽规则会让这条门禁悄悄失效，那比没有门禁更糟。
 *
 * ## 6b：为什么"界面"要**按端**枚举（2026-10-03）
 *
 * 第 6 条原来只扫 `apps/web/src/`。后果不是"移动端现在是红的"，而是**它永远不会红**：
 * 移动端接完第一个 AI 入口之后，这条门禁照样一句"web 5/5 全覆盖"报绿 ——
 * 而移动端可能只接了 5 条里的 1 条，剩下 4 条恰好是"设置界面能授权、授权了什么都不发生"
 * 那个形状（就是本文件开头 2026-09-26 那次实测的失效）。
 * **只覆盖一个端的"全覆盖"是一个谎话，不是绿灯。**
 *
 * 所以现在是：**每个声明要交付 AI 的端都走同一套两级判据**（下面的 `UI_ENDS`）。
 *
 * 🔴 这里**原来**还有一张 `GAP_ENDS` 表，用来登记"这端此刻刻意没做 + 出处"，
 * 并配一条会咬人的规则（该端一旦 import 了任何一个入口，剩余几条立刻转红）。
 * 2026-10-05 把全端 GAP 表删掉，原因是它自己变成了它要防的那件事：靠人按时销毁的
 * 豁免表迟早会永久存在。当前仅允许下面按端登记的产品裁决；它们不会减少其它端的核对。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const AI_DIR = join(ROOT, 'packages/ai/src');
const APP_HOST_DIR = join(ROOT, 'packages/app-host/src');
const DOMAIN_DIR = join(ROOT, 'packages/domain/src');
const WEB_DIR = join(ROOT, 'apps/web/src');

/**
 * 要核对界面可达性的端 —— **列在这里就意味着"必须全覆盖"**。
 *
 * 🔴 没有"这端此刻刻意没做"那一档了（原来叫 `GAP_ENDS`，文件头写了为什么删）。
 * 新端接入 AI 之前不要往这里加条目：加了就等于承诺 5 条功能在这一端全部可点。
 * 壳还没建的端（鸿蒙）不在这里 —— 它连 `apps/…/src` 都还没有，没什么可核对的。
 */
const UI_ENDS = [
  { end: 'web', dir: WEB_DIR },
  { end: 'mobile', dir: join(ROOT, 'apps/mobile/src') },
];

/**
 * 确实不需要界面入口的功能。
 *
 * 🔴 **这里目前是空的，而且应当尽量保持为空。**
 * 一个 AI 功能如果用户碰不到，那它就不是功能，是库。
 * 加进来之前先问：**用户在哪儿用它？**
 */
const NO_UI_ENTRY = new Set([]);

/**
 * 端级产品入口裁决。
 *
 * heyta 的移动端只提供一个 Assistant/Chatbot 表面；capture、breakdown、
 * prioritize、duration-estimate 是宿主可复用能力，移动端不再复制四套隐形
 * 页面。入站自动化同样由 Web 设置管理、由宿主 worker 消费，不在移动端直接
 * 发起模型请求。这里按端登记是为了让门禁表达真实 IA，而不是逼出重复 UI。
 * Web 的这些能力仍由各自真实组件继续覆盖。
 */
const NO_UI_ENTRY_BY_END = new Map([
  ['web', new Set(['inbound-automation'])],
  ['mobile', new Set(['capture', 'breakdown', 'prioritize', 'duration-estimate', 'inbound-automation'])],
]);

/** 复合 UI 的真实挂载组件；实现文件本身是控制器，不是 JSX 组件。 */
const UI_ENTRY_COMPONENT_BY_END = new Map([
  ['mobile', new Map([['tool-calling', 'AssistantScreen']])],
]);

/**
 * 出境披露里那句否定的两个**词条 key**（`packages/i18n`）。
 *
 * 🔴 按 key 查，不按中文子串查 —— 界面渲染的是这两条拼起来的句子
 * （`apps/web/src/features/ai/AiDisclosureHost.tsx` 的 `labels`），
 * 所以不变式必须钉在**用户真能看到的那里**。
 */
const E2EE_LEAD_KEY = 'web.ai.disclosure.e2eeLead';
const E2EE_STRONG_KEY = 'web.ai.disclosure.e2eeStrong';

/**
 * 每种语言「端到端加密」的**说法**与**否定标记**。
 *
 * ⚠️ 新增语言必须在这里加一行，否则 8c 直接红。这是**故意**的：
 * 「不受端到端加密保护」是 ADR-0006 的基石，一种语言里怎么表达否定
 * （日语「～ではない」、韩语「～하지 않습니다」）必须由人判断并登记，
 * 不能让一条没登记的词条自动算"通过"。
 *
 * 判据落在 `e2eeStrong` 那一截 —— 强调边界由 `<strong>` 决定，
 * 否定恰好写在强调里（zh「不受…保护。」/ en「not protected by …」）。
 */
const E2EE_COPY_RULES = {
  'zh-CN': { term: /端到端加密/, negation: /(?:不|未|非|没)/ },
  en: { term: /end[-\s]?to[-\s]?end encrypt/i, negation: /\b(?:not|never)\b/i },
};

/**
 * 读 `packages/i18n` 的**构建产物**里的词条表。
 *
 * 为什么取产物而不是再写一个源码解析器：`check:ui-language` 已经有一份按行解析器，
 * **同一个判断写两遍必然漂移**（AGENTS §3.5 那条教训的形状）。
 * 产物里的 `CATALOGS` 就是应用运行时真正用到的那张表，比源码正则更贴近事实。
 *
 * ⚠️ 依赖 `pnpm build`；`pnpm check` 会先构建，所以正常路径下不会遇到缺失。
 */
async function loadCatalogs() {
  const I18N_DIST = join(ROOT, 'packages/i18n/dist/index.js');
  if (!exists(I18N_DIST)) {
    fail(
      '找不到 `packages/i18n/dist/index.js` —— 出境披露的否定话术无法核对。\n' +
        '     先跑 `pnpm build`（`pnpm check` 会先构建，所以正常路径下不会遇到这个）。',
    );
    return {};
  }
  const i18n = await import(I18N_DIST);
  return i18n.CATALOGS ?? {};
}

// ───────────────────────────────────────────────────────────────────────────
// 小工具
// ───────────────────────────────────────────────────────────────────────────

function read(p) {
  return readFileSync(p, 'utf8');
}

function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** 递归收集某个目录下的文件（按扩展名过滤），跳过 dist / node_modules。 */
function walk(dir, exts, out = []) {
  if (!exists(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'dist-types') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, exts, out);
    } else if (exts.some((e) => name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

/** 从一段源码里抽出所有单引号字符串字面量。 */
function stringLiterals(block) {
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/**
 * 抽出 `export type AiFeature = ... ;` 里的成员。
 *
 * 🔴 **这是这条门禁的驱动源。** 不写死清单 —— 写死就意味着
 * "有人加了功能但忘了加进清单"会静默通过，而那正是要防的事。
 */
function readAiFeatures() {
  const src = read(join(AI_DIR, 'egress.ts'));
  const m = src.match(/export\s+type\s+AiFeature\s*=([\s\S]*?);/);
  if (m === null) {
    throw new Error(
      '在 packages/ai/src/egress.ts 里找不到 `export type AiFeature = ...;`。\n' +
        '这条门禁由它驱动 —— 找不到就无法判断覆盖，所以直接失败而不是跳过。',
    );
  }
  const features = stringLiterals(m[1]).filter((s) => !s.includes('/') && !s.includes(' '));
  if (features.length === 0) {
    throw new Error('`AiFeature` 联合类型里没解析出任何成员 —— 解析规则可能过期了。');
  }
  return features;
}

/** 抽出某个 `Record<AiFeature, ...>` 常量对象的键。 */
function readRecordKeys(file, constName) {
  const src = read(file);
  const start = src.indexOf(constName);
  if (start === -1) {
    throw new Error(`${relative(ROOT, file)} 里找不到 ${constName}。`);
  }
  // 取到第一个 `};` 为止 —— 这几个常量都是简单字面量对象。
  const end = src.indexOf('};', start);
  const block = src.slice(start, end === -1 ? undefined : end);
  // 只认 `key:` 或 `'key':` 形式的键，避免把类型参数也当成键。
  return [...block.matchAll(/(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:/g)]
    .map((m) => m[1] ?? m[2])
    .filter((k) => k !== 'Record' && k !== 'AiFeature');
}

// ───────────────────────────────────────────────────────────────────────────
// 检查
// ───────────────────────────────────────────────────────────────────────────

const problems = [];
const notes = [];

function fail(msg) {
  problems.push(msg);
}

const aiFeatures = readAiFeatures();

// ── 4 / 5. 能力声明与偏好相关性（先读，后面逐个功能核对）──────────────────
const capabilityKeys = new Set(
  readRecordKeys(join(AI_DIR, 'routing.ts'), 'DEFAULT_FEATURE_CAPABILITIES'),
);
const relevanceKeys = new Set(
  readRecordKeys(join(DOMAIN_DIR, 'preference-hints.ts'), 'RELEVANT_PREFERENCES'),
);

// ── 1 / 2 / 3. app-host 的实现与可达性 ────────────────────────────────────
/** feature 字面量 → 实现它的文件 */
const implFileByFeature = new Map();
/** 所有 app-host 源文件里出现过的 feature 字面量（用于反向检查） */
const declaredLiterals = new Map();

for (const file of walk(APP_HOST_DIR, ['.ts']).filter(
  (f) => !f.includes('/tests/') && !f.endsWith('.spec.ts'),
)) {
  const src = read(file);
  for (const m of src.matchAll(/feature\s*:\s*'([^']+)'/g)) {
    const feature = m[1];
    if (!declaredLiterals.has(feature)) declaredLiterals.set(feature, []);
    declaredLiterals.get(feature).push(file);
    if (!implFileByFeature.has(feature)) implFileByFeature.set(feature, file);
  }
}

const indexSrc = read(join(APP_HOST_DIR, 'index.ts'));

/** feature → 它的 request* 入口名（若有） */
const entryByFeature = new Map();

for (const feature of aiFeatures) {
  const implFile = implFileByFeature.get(feature);

  // 1. 有实现
  if (implFile === undefined) {
    fail(
      `功能 \`${feature}\` 在 \`packages/app-host/src/\` 里**没有调用构建器**。\n` +
        `     它是合法的 \`AiFeature\`，设置界面也会为它渲染配置行 ——\n` +
        `     也就是说用户可以授权、可以配端点，然后**什么都不会发生**。\n` +
        `     要么实现它，要么把它从 \`AiFeature\` 里删掉。`,
    );
  }

  // 2. 导出了 request*
  let entry = null;
  if (implFile !== undefined) {
    const src = read(implFile);
    /**
     * 🔴 必须**锚到行首**：不锚，注释里的一句代码草图会被当成导出。
     *
     * 实测（2026-10-05，移动端接线时）：`ai-assistant.ts` 的文件头写着
     * 「实现文件里有没有 `export function request*`」，未锚定时正则从中取出
     * `request`，于是 `tool-calling` 的"入口名"变成了一枚**根本不存在的导出**，
     * 真入口 `requestAssistantTurn` 反而排在它后面被忽略。后果分两种，都不是好事：
     *   · web 第 1 级用 `includes(entry)` —— `'request'` 是哪句的子串，**恒真**，
     *     那一格从此不会红（假绿）；
     *   · 端的 import 判据按**精确说明符** —— 谁都没 import 过 `request`，
     *     于是移动端明明 import 了真入口，仍被判"一条都没接"（假红）。
     * 一条判据同时会造假绿和假红，就是这条。
     */
    const names = [
      ...src.matchAll(/^export\s+(?:async\s+)?function\s+(request[A-Za-z0-9_]*)/gm),
    ].map((m) => m[1]);
    if (names.length === 0) {
      fail(
        `功能 \`${feature}\` 的实现文件 ${relative(ROOT, implFile)} 里\n` +
          `     没有 \`export function request*\` 入口。\n` +
          `     没有入口 = 这个文件不可能被界面调用到。`,
      );
    } else {
      entry = names[0];
      entryByFeature.set(feature, entry);
      if (names.length > 1) {
        notes.push(
          `功能 \`${feature}\` 有多个 request* 入口（${names.join(', ')}），` +
            `门禁只核对第一个 \`${entry}\`。`,
        );
      }
    }
  }

  // 3. 从 index.ts 可达
  if (entry !== null && !indexSrc.includes(entry)) {
    fail(
      `功能 \`${feature}\` 的入口 \`${entry}\` **没有从 \`packages/app-host/src/index.ts\` 导出**。\n` +
        `     实现写了但没导出 = 壳拿不到它。这是本仓库的高发失效形状。`,
    );
  }

  // 4. 能力声明
  if (!capabilityKeys.has(feature)) {
    fail(
      `功能 \`${feature}\` 没有在 \`packages/ai/src/routing.ts\` 的\n` +
        `     \`DEFAULT_FEATURE_CAPABILITIES\` 里声明能力。\n` +
        `     后果是路由层会按"这个功能不需要任何能力"来筛端点 ——\n` +
        `     于是它可能被路由到一个根本做不了这件事的端点上。`,
    );
  }

  // 5. 偏好相关性
  if (!relevanceKeys.has(feature)) {
    fail(
      `功能 \`${feature}\` 没有在 \`packages/domain/src/preference-hints.ts\` 的\n` +
        `     \`RELEVANT_PREFERENCES\` 里声明偏好相关性。\n` +
        `     后果：它要么拿不到该拿的偏好提示（白建了记忆层），\n` +
        `     要么是有人忘了想"这个功能该发哪些偏好出去"。`,
    );
  }
}

// ── 6. 界面可达性（对 `UI_ENDS` 的每一端查两级）────────────────────────────
const endCoverage = [];

for (const spec of UI_ENDS) {
  if (!exists(spec.dir)) {
    fail(
      `本脚本声明要核对 \`${spec.end}\` 端（\`UI_ENDS\`），但 ${relative(ROOT, spec.dir)}\n` +
        `     **不存在**。声明了就要核对：目录没了就让这条门禁响亮地停下，\n` +
        `     不许它"安静地跳过这一端、然后照样报全覆盖"。`,
    );
    continue;
  }

  const files = walk(spec.dir, ['.ts', '.tsx']).filter((f) => !f.includes('/tests/'));
  const srcOf = new Map(files.map((f) => [f, read(f)]));
  let reached = 0;

  for (const feature of aiFeatures) {
    if (NO_UI_ENTRY.has(feature) || NO_UI_ENTRY_BY_END.get(spec.end)?.has(feature)) continue;
    const entry = entryByFeature.get(feature);
    if (entry === undefined || entry === null) continue; // 上面已经报过了

    // 第 1 级：这一端有文件用到了这个入口。
    // 🔴 带词边界的正则，不是 `includes(entry)`。子串判会被"名字像"点亮：
    // 实测过一次 `tool-calling` 的入口名被上游的正则截成 `request`，于是移动端
    // 三个写了 `requestPasswordReset` 的文件把一格**从未接线**的端自己点亮了。
    // 根因已在第 2 步（锚定 `^export …`）修掉，这里再留一层是挡"将来又出一个
    // `requestDurationV2` 之类的近名入口"。
    const uses = new RegExp(`\\b${entry}\\b`);
    const users = files.filter((f) => uses.test(srcOf.get(f)));
    if (users.length === 0) {
      fail(
        `功能 \`${feature}\` 的入口 \`${entry}\` 在 \`${relative(ROOT, spec.dir)}/\` 里\n` +
          `     **没有任何调用点**。\n` +
          `     后端通了、这一端没有入口 —— 用户碰不到，等于这一端没做。\n` +
          `     （如果它确实只给本机 API / MCP 用，请加进本脚本的 \`NO_UI_ENTRY\` 并写明理由。）`,
      );
      continue;
    }

    // 🔴 第 2 级：**用到了 ≠ 用户能用。**
    //
    // 这一条是"用一个坏门禁"逼出来的。第一版只查到第 1 级，于是
    // `AiPrioritize.tsx` / `AiDuration.tsx` 静静地 import 了 entry 就让门禁变绿了 ——
    // 而**没有任何地方渲染这两个组件**，用户在界面上根本碰不到它们。
    //
    // 这正是同一类失效上升了一层：第一层是"能力实现了但没调用点"，
    // 第二层是"组件写好了但没挂载"。两层都不报错、都不影响测试，
    // 都只在"有人真的去用"的时候才暴露。
    //
    // ⚠️ 判据写的是**渲染**（别处出现 `<Name`），不是"被 import"。2026-10-05 在
    // 移动端实测到 import 这一版挡不住的那个形状：`ProfileScreen` import 了
    // `AssistantScreen`、入口行也在（`setAssistantOpen(true)`），**唯独没读
    // `assistantOpen` 的那个渲染分支** —— 点进去什么都不发生，而"被 import"是绿的。
    // 按 import 判还会跟着打包器的后缀习惯漂移：web 写 `from '../x.js'`，
    // RN 不写后缀，同一条正则一端有效一端失灵。JSX 标签这一层两端同形。
    const componentName = UI_ENTRY_COMPONENT_BY_END.get(spec.end)?.get(feature);
    const mounted = users.filter((f) => {
      if (componentName !== undefined) {
        return files.some((g) => g !== f && new RegExp(`<${componentName}[\\s/>]`).test(srcOf.get(g)));
      }
      const name = basename(f).replace(/\.(tsx?|jsx?)$/, '');
      if (name === 'index') return true; // 目录入口，从文件名判断不了，放行
      const tag = new RegExp(`<${name}[\\s/>]`);
      return files.some((g) => g !== f && tag.test(srcOf.get(g)));
    });

    if (mounted.length === 0) {
      fail(
        `功能 \`${feature}\`（端 \`${spec.end}\`）的界面文件（${users
          .map((f) => relative(ROOT, f))
          .join(', ')}）\n` +
          `     **没有任何地方渲染它** —— 它用到了 \`${entry}\`，组件也写好了，\n` +
          `     但全端找不到一处 \`<Name\` 用法。用户打开应用时看不到它，这个功能**依然碰不到**。`,
      );
      continue;
    }

    reached += 1;
  }

  endCoverage.push({ end: spec.end, reached, total: aiFeatures.length });
}

// ── 7. 反向：不许有拼错的 feature 字面量 ──────────────────────────────────
for (const [literal, files] of declaredLiterals) {
  if (!aiFeatures.includes(literal)) {
    fail(
      `\`packages/app-host/src/\` 里出现了 \`feature: '${literal}'\`，\n` +
        `     但它**不在 \`AiFeature\` 联合类型里**。\n` +
        `     文件：${files.map((f) => relative(ROOT, f)).join(', ')}\n` +
        `     这通常意味着拼写漂移 —— 该功能永远不会被正确路由到。`,
    );
  }
}

// ── 8. 运行时不变式（ADR-0006 / ADR-0013 的结论）──────────────────────────
const AI_DIST = join(ROOT, 'packages/ai/dist/index.js');
if (!exists(AI_DIST)) {
  fail(
    `找不到 \`packages/ai/dist/index.js\` —— 运行时不变式无法核对。\n` +
      `     先跑 \`pnpm build\`（\`pnpm check\` 会先构建，所以正常路径下不会遇到这个）。`,
  );
} else {
  const ai = await import(AI_DIST);

  // 🔴 词条表在这里**只加载一次**，供 8a-bis 与 8c 两段共用。
  // 上一版它只在 8c 里加载，而我把新的一段插在 8a 后面去引用 `catalogs` ——
  // `const` 的暂时性死区让门禁直接抛 ReferenceError，症状是"门禁坏了"，
  // 而不是"我的写法错了"。（同一个坑本会话已经踩过一次。）
  const catalogs = await loadCatalogs();
  const catalogLocales = Object.keys(catalogs).sort();
  if (catalogLocales.length === 0) {
    fail(
      '`packages/i18n` 的 `CATALOGS` 是**空的** —— 8a-bis 与 8c 都无从判定。\n' +
        '     这不是"没有违规"，这是探针够不着。检查 `packages/i18n/dist` 的导出形状是否变了。',
    );
  }

  // 8a. 托管档的"留多久"必须**说得出数字**（ADR-0054 已定案）
  //
  // 🔴 这一条在 2026-10-05 之前钉的是**反方向**的事（"必须还是 undefined，
  // 因为策略没定"）。裁决落地之后它翻转成：这一档的保留声明**不许为空**，
  // 而且句子里必须带着那个常量推导出来的天数 —— 界面渲染的是结构化那一份，
  // 中文句给 CLI 与法务对账用，两边数字漂开时这里先红。
  const managedRetention = ai.describeRetention('heyta-cloud');
  const managedKind = ai.retentionDisclosure('heyta-cloud').kind;
  if (managedKind !== 'metadata-only') {
    fail(
      `\`retentionDisclosure('heyta-cloud').kind\` 是 \`${managedKind}\`，不是 \`metadata-only\`。\n` +
        `     ADR-0054 §2 的裁决是"只留元数据、不留正文"。换成别的分类请**先写一份新 ADR**，\n` +
        `     而不是改这里 —— 那两个壳的词条表是按这个判别式穷举的。`,
    );
  } else if (
    typeof managedRetention !== 'string' ||
    managedRetention.length === 0 ||
    !managedRetention.includes(String(ai.MANAGED_AI_METADATA_RETENTION_DAYS))
  ) {
    fail(
      `托管档的保留声明**没有带出那个天数**（收到：${JSON.stringify(managedRetention)}）。\n` +
        `     界面上的"留多久"是从 ` +
        `\`MANAGED_AI_METADATA_RETENTION_DAYS\` 推的，这里查的是中文投影那一路有没有断。`,
    );
  } else {
    notes.push(
      `托管档保留声明在场（正文不留存 + 计数表 ${String(ai.MANAGED_AI_METADATA_RETENTION_DAYS)} 天）。`,
    );
  }

  // 8a-bis. 保留声明必须点到**两个载体** —— 中文投影 + 每一种语言的词条表
  //
  // 🔴 这条是 2026-10-05 现场补的，起因是我自己写的那一句：
  // 「服务端**只记调用计数**（账号、计费周期、次数、最后使用时间）」。
  // 那句当时看着保守（少说比多说安全），实际是**假话**：托管代理每次调用还经
  // `recordManagedAiAttempt` → `Logger.audit` 写一行运维日志，字段是时间、账号、
  // 功能名、结果状态、请求/响应字节数、耗时（ADR-0054 §4 那份元数据清单说的就是它）。
  //
  // 两个方向的错都要拦，而**少说这一侧没有人会发现**：
  //   · 多说 → 承诺了一个不存在的采集（`ai-metering.pglite.spec.ts` 那条"多一列就红"管它）；
  //   · 少说 → 披露少了一项真存在的采集，界面、法务、库里全都"看起来更干净"。
  // 所以这里查的是**存在性**，不是数值：两个载体的名字都得到场。
  //
  // ⚠️ 只查"到场"，不查天数归谁。给日志写天数是另一种错（它的上限是容量不是时间），
  //    那种改法要靠 ADR-0054 §4 那张两载体表 + 人评审，机器在这里帮不上。
  // ⚠️ 中文兼容句用的那份词表**单独命名**，并由 `CARRIER_RULES['zh-CN']` 引用同一个数组。
  // 上一版这里写的是 `CARRIER_RULES['zh-CN'].filter(...)`，于是给那张表改一个 key
  // 就把门禁自己撞成 `TypeError: Cannot read properties of undefined` ——
  // 变异当场跑出来了：它红是红的，但**红在了错的地方**（崩溃而不是那条 fail-closed 话术），
  // 而一个会因自己被人编辑而崩的门禁，报出来的理由永远不可信。
  const ZH_CARRIER_TERMS = ['计数表', '运维日志'];
  const CARRIER_RULES = {
    'zh-CN': ZH_CARRIER_TERMS,
    en: ['counter row', 'operational log'],
  };
  const missingInCompat = ZH_CARRIER_TERMS.filter((term) => !managedRetention.includes(term));
  if (missingInCompat.length > 0) {
    fail(
      `\`describeRetention('heyta-cloud')\` 少了载体：${missingInCompat.join('、')}。\n` +
        `     托管路径上有**两个**保留载体 —— 一张计数表（有 45 天这个数字）和\n` +
        `     每次调用一行的运维日志（上限是日志容量，不是时间）。少说一个就是少披露了一项\n` +
        `     真实存在的采集。出处：\`server/src/ai/managed-proxy.routes.ts\` 的 \`recordManagedAiAttempt\`。`,
    );
  }
  const carriersChecked = [];
  for (const locale of catalogLocales) {
    const terms = CARRIER_RULES[locale];
    if (terms === undefined) {
      fail(
        `\`packages/i18n\` 里有 \`${locale}\` 词条表，但 \`CARRIER_RULES\` 没登记它。\n` +
          `     保留披露"说了哪几个载体"必须**每种语言显式登记一次怎么说**，\n` +
          `     不能让它悄悄继承另一语言的写法（同 \`E2EE_COPY_RULES\` 的理由）。`,
      );
      continue;
    }
    const sentence = catalogs[locale]?.['web.ai.disclosure.retentionMetadataOnly'];
    if (typeof sentence !== 'string') {
      fail(
        `\`${locale}\` 词条表里没有 \`web.ai.disclosure.retentionMetadataOnly\` —— ` +
          `托管档的"留多久"在界面上**根本不出现**。`,
      );
      continue;
    }
    const missing = terms.filter((term) => !sentence.includes(term));
    if (missing.length > 0) {
      fail(
        `\`${locale}\` 的托管保留句少了载体：${missing.join('、')}。\n` +
          `     两个载体（计数表 / 每次调用一行的运维日志）都要在场 —— ` +
          `少写一个不是保守，是**少披露了一项真实存在的采集**。`,
      );
    } else {
      carriersChecked.push(locale);
    }
  }
  if (carriersChecked.length > 0 && catalogLocales.length === carriersChecked.length) {
    notes.push(
      `托管保留句在 ${String(carriersChecked.length)} 份词条表（${carriersChecked.join(', ')}）里都点到两个载体。`,
    );
  }

  // 8b. 托管档的**两道门**都必须在运行时成立
  //
  // | 配置 | 必须发生 | 为什么这条要活在门禁里 |
  // |---|---|---|
  // | `managed` 没端点 | 抛 `endpoint-required` | 没有目的地就没有"发给谁"，启用不了 |
  // | `managed` + 境内白名单 | **不抛** | 开档这件事本身（ADR-0054）—— 悄悄退回去挡住，产品就没这一档 |
  // | `managed` + 境外端点 | 抛 `managed-endpoint-not-domestic` | 🔴 红线 6c："只能接境内"不许靠形容词，必须有一条运行时真的打它的判据 |
  const thrownOf = (config) => {
    try {
      ai.assertEnableable(config);
      return null;
    } catch (err) {
      return err?.reason;
    }
  };
  const noEndpointReason = thrownOf({ mode: 'managed' });
  if (noEndpointReason !== 'endpoint-required') {
    fail(
      `\`assertEnableable({ mode: 'managed' })\`（没端点）的理由是 ${JSON.stringify(noEndpointReason)}，\n` +
        `     不是 \`endpoint-required\`。那是配置缺口，用户能做的动作是"去填地址" ——\n` +
        `     换成别的理由就等于告诉用户一个他做不到的修复动作。`,
    );
  }
  const domestic = ai.MANAGED_MODEL_HOSTS[0]?.host;
  if (domestic === undefined) {
    fail('境内白名单是空的 —— 8b 后两条臂无从判定，这不是"没有违规"，是探针够不着。');
  } else {
    const domesticReason = thrownOf({ mode: 'managed', endpoint: `https://${domestic}/v1` });
    if (domesticReason !== null) {
      fail(
        `托管档接**境内白名单**端点（${domestic}）仍然被拒，理由 ${JSON.stringify(domesticReason)}。\n` +
          `     ADR-0054 已把保留策略定案，这一档**应该能启用** —— 门又被焊回去了。`,
      );
    }
    const foreignReason = thrownOf({ mode: 'managed', endpoint: 'https://api.openai.com/v1' });
    if (foreignReason !== 'managed-endpoint-not-domestic') {
      fail(
        `托管档接**境外**端点（api.openai.com）的理由是 ${JSON.stringify(foreignReason)}，\n` +
          `     不是 \`managed-endpoint-not-domestic\`。红线是"托管只能接境内的模型供应商"，\n` +
          `     这条臂就是它的运行时证据 —— 它不响，那条红线就只剩一句注释。`,
      );
    }
    notes.push(`托管档两道门在运行时成立（境内 ${domestic} 可启用；境外以 not-domestic 被拒）。`);
  }

  // 8c. 托管 AI 不得被描述成端到端加密（ADR-0006 的基石）
  //
  // 🔴 **查的是界面真正渲染的那两份词条表**，不再查 `packages/ai` 的中文兼容句。
  // 原来这里读 `describeDestination('heyta-cloud')` 里的中文投影，而那句
  // **已经不在任何界面上了**（`AiDisclosure` 渲染的是 `web.ai.disclosure.e2ee*`）。
  // 于是这条门禁保护的是一个没人看的地方：把界面上的「不受端到端加密保护」
  // 改成「受端到端加密保护」，旧门禁照样绿 —— 而那恰好是 ADR-0006 禁止的事。
  //
  // ⚠️ 也不按中文子串匹配。每个语言在 `E2EE_COPY_RULES` 里登记它**怎么说**
  // 「端到端加密」和**怎么标记否定**，没登记就红 —— 那是故意的：加一门语言
  // 必须为这句话做一次真判断，而不是让它悄悄继承"看起来有否定"。
  // ⚠️ `catalogs` / `catalogLocales` 在 8a-bis 之前就已加载并做过空表守卫，这里复用。
  const e2eeChecked = [];
  for (const locale of catalogLocales) {
    const rules = E2EE_COPY_RULES[locale];
    if (rules === undefined) {
      fail(
        `\`packages/i18n\` 里有 \`${locale}\` 词条表，但 \`E2EE_COPY_RULES\` 没登记它。\n` +
          `     这条否定（「这一份不受端到端加密保护」）是 ADR-0006 的基石，\n` +
          `     每种语言都必须**显式**登记它怎么说「端到端加密」、怎么标记否定，不能默认放过。`,
      );
      continue;
    }
    const catalog = catalogs[locale];
    const missing = [E2EE_LEAD_KEY, E2EE_STRONG_KEY].filter(
      (key) => typeof catalog[key] !== 'string',
    );
    if (missing.length > 0) {
      fail(
        `\`${locale}\` 词条表里少了出境披露要用到的 key：${missing.join(', ')}。\n` +
          `     没有这两条，界面上**根本不会出现**那句"不受端到端加密保护"。\n` +
          `     （键集合一致性由 \`check:ui-language\` 管，这里查的是**这句否定在不在**。）`,
      );
      continue;
    }
    const strong = catalog[E2EE_STRONG_KEY];
    const lacksTerm = !rules.term.test(strong);
    const lacksNegation = !rules.negation.test(strong);
    if (lacksTerm || lacksNegation) {
      fail(
        `\`${locale}\` 的 \`${E2EE_STRONG_KEY}\` 不再是那句否定了。\n` +
          (lacksTerm ? `     缺「端到端加密」这个说法（应匹配 ${rules.term}）。\n` : '') +
          (lacksNegation ? `     缺否定标记（应匹配 ${rules.negation}）。\n` : '') +
          `     实际文案：${JSON.stringify(strong)}\n` +
          `     ADR-0006 的基石：托管 AI **永远不能**被描述成端到端加密 ——\n` +
          `     用户在按下"发送"前看到的那句话必须说清这一份是**明文**出境。`,
      );
      continue;
    }
    e2eeChecked.push(locale);
  }
  if (e2eeChecked.length > 0) {
    notes.push(
      `出境披露的否定话术在 ${e2eeChecked.length} 份词条表（${e2eeChecked.join(', ')}）里都在（ADR-0006）。`,
    );
  }

  // ── 8d. 托管白名单：「境内」必须是**一张表 + 一条对账**，不是形容词 ──────────
  //
  // 为什么要**在门禁里**再核一遍，而不是只靠 `packages/ai` 的单测：
  // 单测跑的是 `src/`，而这个洞的真正形状是**产物**的行为（AGENTS §7 第 27 条那一族：
  // "改了源码、产物还是旧的"）。同时表的内容是**对外承诺**——托管档卖出去之后，
  // "接的是哪一家、凭什么说它在境内"是会被追问的，所以每一项都必须带可核对的出处。
  const hosts = ai.MANAGED_MODEL_HOSTS;
  if (!Array.isArray(hosts) || hosts.length === 0) {
    fail(
      '`MANAGED_MODEL_HOSTS` 不是非空数组 —— 托管档的境内白名单**没有事实源**了。\n' +
        '     空表不等于"更安全"：那意味着这条规则不再约束任何人，而界面上那句话还在。',
    );
  } else {
    const problems8d = [];
    const seen = new Set();
    for (const entry of hosts) {
      const host = typeof entry?.host === 'string' ? entry.host : '';
      if (host === '') problems8d.push('有条目的 `host` 不是非空字符串。');
      if (seen.has(host)) problems8d.push(`\`${host}\` 重复登记（两行指向同一家 = 出处可以互相顶包）。`);
      seen.add(host);
      if (host !== host.toLowerCase() || /[:\/[\]]/.test(host)) {
        problems8d.push(
          `\`${host}\` 不是规范化主机名（必须小写、不含协议/端口/路径/方括号）。\n` +
            '     匹配是**逐字相等**，所以一个带端口的行永远匹配不上任何真实端点。',
        );
      }
      if (entry?.jurisdiction !== 'cn') {
        problems8d.push(
          `\`${host}\` 的所在地登记为 \`${String(entry?.jurisdiction)}\`，而托管路径只接受境内（ADR-0053 §3.3）。`,
        );
      }
      const evidence = typeof entry?.evidence === 'string' ? entry.evidence : '';
      if (evidence.length <= 20 || !/ADR-\d{4}|docs\/|https?:\/\//.test(evidence)) {
        problems8d.push(
          `\`${host}\` 的「境内」没有**可核对的出处**（要指向一份 ADR、一份仓库文档或一个 URL）。\n` +
            `     实际写的是：${JSON.stringify(evidence)} —— 形容词不是判据。`,
        );
      }
      if (ai.isDomesticManagedEndpoint(`https://${host}/v1`) !== true) {
        problems8d.push(
          `\`${host}\` 在白名单上，但 \`isDomesticManagedEndpoint()\` 认不出它 ——\n` +
            '     这条目是**装饰**：写了也放不了行，读代码的人会以为托管接了这家。',
        );
      }
    }
    // 🔴 阳性对照（§7 元规则 2）：**所在地那把尺子必须证明自己会咬人**。
    // 生产表里全是 'cn'，所以光跑真表证明不了 `jurisdiction !== 'cn'` 那一支还活着。
    // 表是入参（`managedEndpointVerdictAgainst`），于是这里能拿一张合成表去打它。
    const syntheticForeign = [
      {
        host: 'api.foreign.example',
        provider: '门禁合成条目，只为证明这条判据活着',
        jurisdiction: 'foreign',
        evidence: '本行只存在于这段门禁里，用来证明"在表上"与"在境内"是两把尺子。',
      },
    ];
    if (ai.managedEndpointVerdictAgainst('https://api.foreign.example/v1', syntheticForeign).ok !== false) {
      fail(
        '`managedEndpointVerdictAgainst()` 对一张**含境外条目**的表放行了。\n' +
          '     那条规则是"托管只能接境内"，不是"只能在表上" —— 后者挡不住把境外供应商加进表里那次提交。',
      );
    }
    if (problems8d.length > 0) {
      fail(`托管白名单（ADR-0053 §3.3）有 ${String(problems8d.length)} 处不成形：\n     ` + problems8d.join('\n     '));
    } else {
      notes.push(
        `托管白名单 ${String(hosts.length)} 行，逐行境内 + 带出处 + 真的匹配得上；含境外条目的合成表被拒（ADR-0053）。`,
      );
    }
  }

  // ── 8e. 托管的目的地**必须从端点推导**（旧形状那个"不看端点"的洞）──────────
  const heytaCloudFrom = (endpoint) =>
    ai.classifyDestination(endpoint === undefined ? { mode: 'managed' } : { mode: 'managed', endpoint });
  const mustNotClaimHeytaCloud = [
    undefined,
    '',
    'https://api.openai.com/v1',
    'not a url',
    ...(Array.isArray(hosts) && hosts.length > 0
      ? [`http://${String(hosts[0]?.host)}/v1`, `https://${String(hosts[0]?.host)}.evil.cn/v1`]
      : []),
  ];
  const lying = mustNotClaimHeytaCloud.filter((e) => heytaCloudFrom(e) === 'heyta-cloud');
  if (lying.length > 0) {
    fail(
      `这些托管配置被推导成了 \`heyta-cloud\`，而它们的端点不合格：${lying.map((e) => JSON.stringify(e)).join('、')}\n` +
        '     `heyta-cloud` 这个值**本身就是一句陈述**："明文到了 heyta 的服务器上"。\n' +
        '     旧实现无条件返回它（不看端点），于是"接了一家境外 API 但 mode 写着 managed"\n' +
        '     在界面上仍然显示"到了我们自己的云" —— ADR-0053 §3.3 堵的就是这个洞。',
    );
  } else {
    // 🔴 反向也要核：合格端点必须**确实**推出 heyta-cloud，否则这条门禁只是"什么都拒"。
    const ok = Array.isArray(hosts) && hosts.length > 0 ? heytaCloudFrom(`https://${String(hosts[0]?.host)}/v1`) : '（无白名单）';
    if (ok !== 'heyta-cloud') {
      fail(
        '`classifyDestination` 连**合格**的托管端点都推不出 `heyta-cloud` —— 上面那条"不许谎报"就失去了意义。\n' +
          `     实际值：${String(ok)}。这条判据的两半都要成立。`,
      );
    } else {
      const stillConsent = mustNotClaimHeytaCloud.every(
        (e) => ai.requiresEgressConsent(heytaCloudFrom(e)) === true,
      );
      if (!stillConsent) {
        fail(
          '有一种托管配置**既推不出 heyta-cloud、又不需要出境授权** —— 那是把"洞堵上了、门也拆了"。\n' +
            '     被拒的端点必须落到仍然要授权的那一档。',
        );
      } else {
        notes.push('托管目的地从端点推导：不合格端点拿不到 `heyta-cloud`，且照旧一律要授权（ADR-0053 §3.3）。');
      }
    }
  }

  // ── 8f. 地址类别补进模型，但**免授权面一格都没扩**（ADR-0053 §3.2）──────────
  const addressCases = [
    ['http://localhost:11434/v1', true],
    ['http://127.0.0.1:1234/v1', true],
    ['http://[::1]:11434/v1', true],
    ['http://169.254.1.1/v1', false],
    ['http://[fe80::1]/v1', false],
    ['http://192.168.1.20:11434/v1', false],
    ['http://100.64.0.1/v1', false],
    ['http://[fd00::1]/v1', false],
    ['http://nas.local/v1', false],
    ['http://my-nas.lan:11434/v1', false],
    ['http://a.localhost/v1', false],
    ['http://[::ffff:127.0.0.1]/v1', false],
    ['https://api.openai.com/v1', false],
  ];
  const misjudged = addressCases.filter(
    ([endpoint, loopback]) => ai.isLoopbackEndpoint(endpoint) !== loopback,
  );
  if (misjudged.length > 0) {
    fail(
      `回环判定的结果与 ADR-0053 §3.2 的"只紧不松"对不上：${misjudged.map(([e]) => JSON.stringify(e)).join('、')}\n` +
        '     免授权的一格只能留在字面量回环里；链路本地、私网、局域网命名形态**照旧要授权**。',
    );
  } else {
    const unknownIsStrict = ['https://api.openai.com/v1', 'http://nas.local/v1', 'not a url'].every(
      (e) => {
        const c = ai.classifyEndpointAddress(e);
        return c.known === false && c.category === 'unknown' && typeof c.reason === 'string';
      },
    );
    if (!unknownIsStrict) {
      fail(
        '`classifyEndpointAddress()` 对域名/局域网名字/坏写法不再返回 `known:false + category:"unknown"`。\n' +
          '     那一批必须落在"未定性 ⇒ 按最严的一档"，这是这一轮承诺的另一半。',
      );
    } else {
      const localOnly = ai.classifyDestination({ mode: 'own', endpoint: 'http://192.168.1.20:11434/v1' });
      if (localOnly !== 'user-endpoint') {
        fail(
          `局域网私网端点的目的地变成了 \`${String(localOnly)}\` —— 私网**不**免出境授权（ADR-0053 §3.2）。`,
        );
      } else {
        notes.push('地址类别已进模型（回环/链路本地/私网/公网/未定性），而免授权面一格都没扩（ADR-0053）。');
      }
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 9. 实体覆盖面：界面里能操作的东西，AI 必须**读得到也改得动**
// ───────────────────────────────────────────────────────────────────────────
/**
 * ## 为什么这一段住在这里而不是新写一个脚本
 *
 * 上面那 8 段回答的是「**声明的 AI 功能**能不能走到」，驱动源是 `AiFeature`；
 * 这一段回答的是「**用户可操作的实体**AI 碰不碰得到」，驱动源是 `EntityModelMap`。
 * 同一个问题（界面在说谎）的两个轴，同一道门禁 —— 拆成两个脚本之后，
 * "加了一个实体"要记得去两个地方登记，而漏登记正是这一段要防的事。
 *
 * ## 分母与口径都不在这里重算
 *
 * 全部来自 `gen-ai-capability-manifest.mjs`（`readUpstream()` + `buildCapabilityManifest()`
 * + `countsAsCovered()`）。这一段**不 import `LOCAL_API_TOOLS`、不读 `EntityModelMap` 源码** ——
 * 自己再读一遍就是第二份判据，而两份判据一定会漂（AGENTS §3.5 的形状）。
 *
 * ## 🔴 「算覆盖」的口径是**能读 + 能写**，不是"有任何一个工具"
 *
 * 只有 `list_projects` 的 PROJECT 对这个问题的答案是**不能**：助手能看见清单，
 * 却提不出"把这条放进「工作」"。旧口径数出来 2/8，新口径 1/8 ——
 * 前者是一句写进过台账的虚报（纠正记录在 `docs/plans/ai-event-tool-contract.md` §2.1）。
 *
 * ## 已知缺口必须**逐个点名**，不许静默
 *
 * `ENTITY_COVERAGE_DEBT` 是唯一的豁免通道，而它有三条牙齿：
 *   · 分母里出现一个**不在这里、又没有读写工具**的实体 ⇒ 红（这就是"新实体没进目录
 *     就判红"，倒数日 `EVENT` 落进 `EntityModelMap` 的那一刻会走到这条）；
 *   · 这里的某一项**已经读写都有**了却还挂着 ⇒ 红（登记会过期，不许只增不减）；
 *   · 每一项必须带 `AI-COV-n` 工单号 + 一句**为什么**（"还没做"不是为什么）。
 * 于是它不是一份"待办清单的抄件"，而是一份**必须与上游逐字对账**的声明。
 *
 * ## 2026-10-03：这张表现在是空的，而它空得有历史
 *
 * 这里原本挂着五项（`AI-COV-2/3/5/6/7` = TAG / NOTE / HABIT_LOG / FOCUS_SESSION / REMINDER），
 * 同一天全部落地成真的工具（`packages/local-api/src/tools/{tag,note,habit-log,focus,reminder}.ts`），
 * 于是上面那第二条牙齿把它们**从登记里抹掉**了 —— 这正是它该有的行为：
 * 闭合的缺口留在表里，会被读成"还欠着"，而一份会撒谎的账本比没有账本更贵。
 *
 * 🔴 更要紧的是那五条**的理由串**，它错了两轮，两段都留在这里（不留就是假装没说过）：
 *   第一轮：它们抄自一份"读完代码之后的汇报"，那份汇报说这四个实体**在产品侧根本没有写动作本体**。
 *     逐行打开被调函数本体之后四条全灭 —— `project-actions.ts:178 createTag`、
 *     `note-actions.ts:133 createNote`、`habit-actions.ts:275 checkIn`、
 *     `reminder-actions.ts:174 writeNew` 每一张都真的 `dispatch`。
 *     错在哪一层：那份汇报按"函数名去搜实现"，没打开被调方；而我把它的结论直接抄进了
 *     一道门禁的理由串 ⇒ **一句没取证的谎拿到了门禁的权威**，下一轮读到它的人只会照着
 *     "产品没写路径"去排期。
 *   第二轮：改成"真正的卡点只有一个，而且是量出来的：目录容量" —— 也是错的。
 *     `local-api.spec.ts` 那条 `<= 10` 的理由自己写着"超过 10 个就先问『真的需要吗』"，
 *     而产品负责人 2026-10-03 已经答过这个问题（"我们界面当中有的功能都支持通过 AI 去直接改"）。
 *     一句本该用来逼人思考的启发式，被我读成了一堵墙，还写成了"要产品再拍一次"。
 *     现在那条判据改成按实体算（`shared.ts` 的 `MAX_TOOLS_PER_ENTITY`），
 *     总量由下面第 10 段从分母推导。
 *
 * 两段都是同一类失效：**登记里的 `reason` 也是断言**，与代码注释不同，它还多一层权威 ——
 * 它是这道门禁"为什么不红"的官方说法。写进去之前必须自己走一遍取证。
 */
const ENTITY_COVERAGE_DEBT = new Map([
  ['COMMENT', {
    gap: 'AI-COV-8',
    reason:
      '共享清单的任务评论（ADR-0062）2026-10-08 进 EntityModelMap，读/写工具随协作客户端引擎（W3/W4）落地。' +
      '不在本批补目录的理由：评论的可读性依赖 share 域上下文（成员身份 + 清单密钥解密后的任务视图），' +
      '单做目录工具会造出一个 AI 碰不到的假功能——与"一个碰不到的 AI 功能不是功能"同一条纪律。' +
      '台账：docs/plans/ai-event-tool-contract.md §5.1（AI-COV-8）。',
  }],
]);

const GEN = join(ROOT, 'scripts/gen-ai-capability-manifest.mjs');
if (!exists(GEN)) {
  fail(
    '读不到 `scripts/gen-ai-capability-manifest.mjs` —— 实体覆盖面无法核对。\n' +
      '     这一段**只从它那里取口径**，不允许自己再读一遍上游。',
  );
} else {
  const gen = await import(pathToFileURL(GEN).href);
  let manifest = null;
  let upstream = null;
  try {
    upstream = await gen.readUpstream();
    manifest = gen.buildCapabilityManifest(upstream);
  } catch (err) {
    const list = Array.isArray(err?.problems) ? err.problems : [String(err?.message ?? err)];
    fail(
      `能力清单的上游读不出/建不出，实体覆盖面这一段**无法判定**：\n` +
        list.map((p) => `     · ${p}`).join('\n'),
    );
  }

  if (manifest !== null && upstream !== null) {
    const visible = new Set(upstream.modelVisibleToolNames ?? []);
    const egressByTool = new Map(
      (upstream.tools ?? []).map((t) => [t.name, t.egressFields]),
    );
    const byType = new Map(manifest.entities.map((e) => [e.entityType, e]));
    const denominator = manifest.userOperableEntityTypes;

    // 9a. 分母的算术本身要成立（剔除表与上游对不上时，`denominator` 会悄悄变大/变小）
    const excludedCount = manifest.excludedFromDenominator.length;
    if (denominator.length !== manifest.modelledEntityTypes.length - excludedCount) {
      fail(
        `覆盖面分母的算术对不上：物化实体 ${String(manifest.modelledEntityTypes.length)} 个 − ` +
          `剔除 ${String(excludedCount)} 个 ≠ 分母 ${String(denominator.length)} 个。\n` +
          '     说明剔除表与 `EntityModelMap` 已经不一致，或者分母被从别处改了。',
      );
    }

    // 9b. 逐个实体：要么读写都有，要么带着工单号在这里点名
    for (const entityType of denominator) {
      const entity = byType.get(entityType);
      const covered = gen.countsAsCovered(entity);
      const debt = ENTITY_COVERAGE_DEBT.get(entityType);
      if (covered && debt !== undefined) {
        fail(
          `\`${entityType}\` 现在**读和写都有工具**了，但 \`ENTITY_COVERAGE_DEBT\` 里还挂着它` +
            `（工单 ${debt.gap}）。\n` +
            '     把那条登记删掉。豁免清单只增不减，就会从"已知缺口"烂成"没人看的清单"。',
        );
        continue;
      }
      if (!covered && debt === undefined) {
        fail(
          `实体 \`${entityType}\` 在分母里，AI 却**没有能读又能写**的工具` +
            `（读 ${String(entity.readToolNames.length)} / 写 ${String(entity.writeToolNames.length)}），` +
            `而 \`ENTITY_COVERAGE_DEBT\` 里也没有它。\n` +
            '     🔴 这正是本段要拦的那一件事：**新实体进了 `EntityModelMap`，AI 目录却没有跟上** ——\n' +
            '     ADR-0044 与 ADR-0045 §2.6 要求实体和它的 AI 工具**同批**落地。\n' +
            '     二选一：补工具，或者加一条带 `AI-COV-n` 工单号的登记并写明**为什么**现在不做。',
        );
        continue;
      }
      if (debt !== undefined && (typeof debt.gap !== 'string' || !/^AI-COV-\d+$/.test(debt.gap))) {
        fail(
          `\`${entityType}\` 的缺口登记没有形如 \`AI-COV-<n>\` 的工单号（当前：${String(debt.gap)}）。\n` +
            '     没有编号的豁免等于没有豁免 —— 下一轮没人能找到它是谁登记的、为什么登记的。',
        );
      }
      if (debt !== undefined && (typeof debt.reason !== 'string' || debt.reason.length < 20)) {
        fail(
          `\`${entityType}\` 的缺口登记缺一句**为什么**（` +
            '`"还没做"` 不算理由 —— 说清是"产品侧没有写动作本体"还是"授权口径没拍"。）',
        );
      }
    }

    // 9c. 登记表不能挂着已经不在分母里的名字
    for (const [entityType] of ENTITY_COVERAGE_DEBT) {
      if (!denominator.includes(entityType)) {
        fail(
          `\`ENTITY_COVERAGE_DEBT\` 里有 \`${entityType}\`，但它**已经不在分母里**了。\n` +
            '     要么它被从 `EntityModelMap` 删了（那这条登记该一起删），' +
            '要么分母口径被改了（那要重新拍一次，不许顺手）。',
        );
      }
    }

    // 9d. 🔴 「模型可选得到」+「出境逐字段披露」——两条不变量一起查
    for (const entity of manifest.entities) {
      if (!entity.countsTowardCoverage) continue;
      for (const toolName of [...entity.readToolNames, ...entity.writeToolNames]) {
        if (!visible.has(toolName)) {
          fail(
            `工具 \`${toolName}\`（实体 \`${entity.entityType}\`）在目录里，\n` +
              '     却不在 `listAuthorizedTools(全授权)` 的投影里 —— **模型看不见它**，\n' +
              '     于是"AI 支持这个实体"是一句只有界面知道的话。（未授权即不可见是另一件事。）',
          );
        }
        const fields = egressByTool.get(toolName);
        if (!Array.isArray(fields)) {
          fail(
            `工具 \`${toolName}\` 没有声明 \`egressFields\`（当前：${JSON.stringify(fields)}）。\n` +
              '     隐私不变量第四条是「出境**逐字段**披露」，而这份声明就是披露块里那一行的来源：\n' +
              '     缺它 = 用户点"发送"时看不到这次到底把哪些字段发出去了。',
          );
        }
      }
    }

    const coveredList = denominator.filter((t) => gen.countsAsCovered(byType.get(t)));
    notes.push(
      `实体覆盖面 ${String(coveredList.length)}/${String(denominator.length)}` +
        `（口径：读和写都有工具）；已登记缺口 ${String(ENTITY_COVERAGE_DEBT.size)} 项：` +
        [...ENTITY_COVERAGE_DEBT.entries()]
          .map(([t, d]) => `${t}=${d.gap}`)
          .join('、'),
    );

    // 9e. 🔴 目录规模 = 分母的函数，不是一个人拍的数字
    //
    // 这一段的存在理由很具体：`local-api.spec.ts` 原来写着 `LOCAL_API_TOOLS.length <= 10`，
    // 而第 9 段要求"每个实体读写都有工具" ⇒ 分母 8 个实体、下限 16 席，两道各自合理、
    // 合起来**互相封死**（`docs/plans/ai-event-tool-contract.md` §5.2 记着这次算术）。
    // 现在按实体那一列判（默认每个 pack 至多 `MAX_TOOLS_PER_ENTITY` 个工具，
    // 例外从 shared.ts 的 typed lookup 取），
    // 于是总量随覆盖面**一起**长大：多一个进分母的实体就多一席预算，而不是多一个障碍。
    const defaultPerEntityCap = upstream.maxToolsPerEntity;
    const perEntityCaps = upstream.maxToolsPerEntityByType;
    if (typeof defaultPerEntityCap !== 'number' || !(defaultPerEntityCap > 0)) {
      fail(
        '读不到 `MAX_TOOLS_PER_ENTITY`（当前：' +
          JSON.stringify(defaultPerEntityCap) +
          '）—— 每实体容量无法核对。\n' +
          '     它的所有者是 `packages/local-api/src/tools/shared.ts`；这一段只从产物里取，不在这里抄一个数。',
      );
    } else if (typeof perEntityCaps !== 'object' || perEntityCaps === null || Array.isArray(perEntityCaps)) {
      fail(
        '读不到实体工具预算 lookup（当前：' +
          JSON.stringify(perEntityCaps) +
          '）—— 实体例外容量无法核对。\n' +
          '     它的所有者是 `packages/local-api/src/tools/shared.ts`；这一段只从产物里取，不在这里抄一个数。',
      );
    } else {
      const capForEntity = (entityType) => {
        const override = perEntityCaps[entityType];
        return typeof override === 'number' && override > 0 ? override : defaultPerEntityCap;
      };
      const budget = denominator.reduce((sum, entityType) => sum + capForEntity(entityType), 0);
      const total = manifest.tools.length;
      if (total > budget) {
        fail(
          `目录有 ${String(total)} 个工具，超过按实体预算合计 ${String(budget)}。\n` +
            '     要抬某个实体的上限，先在 `shared.ts` 的 typed lookup 中登记它，并回答"多出来那几个工具属于哪一档"——\n' +
            '     而不是直接改这里的数字：改这里等于让覆盖面门禁自己去放宽它检查的那个约束。',
        );
      } else {
        notes.push(
          `目录 ${String(total)} 个工具 ≤ 按实体预算 ${String(budget)} 席` +
            `（已用 ${String(total)}，剩 ${String(budget - total)}）。`,
        );
      }
      // 反向那条腿：某个实体自己超额，也要在这里点出来（总量对得上不代表分布对得上）。
      for (const entity of manifest.entities) {
        const n = entity.readToolNames.length + entity.writeToolNames.length;
        const cap = capForEntity(entity.entityType);
        if (n > cap) {
          fail(
            `实体 \`${entity.entityType}\` 有 ${String(n)} 个工具，超过该实体预算 ${String(cap)}（${[
              ...entity.readToolNames,
              ...entity.writeToolNames,
            ].join('、')}）。`,
          );
        }
      }
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 报告
// ───────────────────────────────────────────────────────────────────────────

console.log(`AI 功能覆盖门禁 —— 由 \`AiFeature\` 联合类型驱动`);
console.log(`  联合类型成员：${aiFeatures.join(', ')}`);
console.log(`  全局界面不可达豁免：${NO_UI_ENTRY.size === 0 ? '（无）' : [...NO_UI_ENTRY].join(', ')}`);
for (const [end, features] of NO_UI_ENTRY_BY_END) {
  if (features.size > 0) console.log(`  ${end} 端按产品裁决不设直接入口：${[...features].join(', ')}`);
}
// 🔴 逐端打印覆盖，不能只报一句"全部可达"：那句在只扫 web 的时候本身就是谎。
for (const cov of endCoverage) {
  console.log(
    `  界面端覆盖：${cov.end} ${String(cov.reached)}/${String(cov.total)}` +
      `（两级：调用点 + 那个界面文件自己被渲染）`,
  );
}
console.log('');

for (const n of notes) {
  console.log(`  ℹ️  ${n}`);
}
if (notes.length > 0) console.log('');

if (problems.length > 0) {
  console.error(`🔴 ${problems.length} 处不达标：\n`);
  for (const [i, p] of problems.entries()) {
    console.error(`  ${i + 1}. ${p}\n`);
  }
  console.error(
    '这条门禁问的是一个产品问题，不是一个代码问题：\n' +
      '**用户在哪儿用这个东西？** 一个碰不到的 AI 功能不是功能，是库。\n',
  );
  process.exit(1);
}

const coveredEnds = endCoverage.map((c) => `${c.end} ${String(c.reached)}/${String(c.total)}`).join('、');
console.log(
  `✅ AI 功能覆盖通过（实现 → 导出 → 路由声明 → 偏好声明；直接 UI 入口按端产品裁决）：${coveredEnds}。`,
);
process.exit(0);
