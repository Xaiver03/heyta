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
 *   6. 界面**真的可达**，分两级查：
 *      a. `apps/web/src/` 里有人调用它的入口（防止"后端通了但界面没有入口"）
 *      b. 调用它的那个界面文件**自己也被别处 import**（防止"组件写好了但没挂载"）
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
 * 如果某个功能**确实**不需要界面入口（例如只给本机 API / MCP 用），
 * 把它加进下面的 `NO_UI_ENTRY` 并**写明理由** —— 不要放宽匹配规则。
 * 放宽规则会让这条门禁悄悄失效，那比没有门禁更糟。
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
 * 确实不需要界面入口的功能。
 *
 * 🔴 **这里目前是空的，而且应当尽量保持为空。**
 * 一个 AI 功能如果用户碰不到，那它就不是功能，是库。
 * 加进来之前先问：**用户在哪儿用它？**
 */
const NO_UI_ENTRY = new Set([]);

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
    const names = [...src.matchAll(/export\s+(?:async\s+)?function\s+(request[A-Za-z0-9_]*)/g)].map(
      (m) => m[1],
    );
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

// ── 6. 界面可达性（两级）──────────────────────────────────────────────────
const webFiles = walk(WEB_DIR, ['.ts', '.tsx']).filter((f) => !f.includes('/tests/'));
const webFileSrc = new Map(webFiles.map((f) => [f, read(f)]));
const webSrc = [...webFileSrc.values()].join('\n');
void webSrc;

for (const feature of aiFeatures) {
  if (NO_UI_ENTRY.has(feature)) continue;
  const entry = entryByFeature.get(feature);
  if (entry === undefined || entry === null) continue; // 上面已经报过了

  // 第 1 级：有界面文件调用了这个入口。
  const users = webFiles.filter((f) => webFileSrc.get(f).includes(entry));
  if (users.length === 0) {
    fail(
      `功能 \`${feature}\` 的入口 \`${entry}\` **在 \`apps/web/src/\` 里没有任何调用点**。\n` +
        `     后端通了、界面没有入口 —— 用户碰不到，等于没做。\n` +
        `     （如果它确实只给本机 API / MCP 用，请加进本脚本的 \`NO_UI_ENTRY\` 并写明理由。）`,
    );
    continue;
  }

  // 🔴 第 2 级：**引用了 ≠ 用户能用。**
  //
  // 这一条是"用一个坏门禁"逼出来的。第一版只查到第 1 级，于是
  // `AiPrioritize.tsx` / `AiDuration.tsx` 静静地 import 了 entry 就让门禁变绿了 ——
  // 而**没有任何地方渲染这两个组件**，用户在界面上根本碰不到它们。
  //
  // 这正是同一类失效上升了一层：第一层是"能力实现了但没调用点"，
  // 第二层是"组件写好了但没挂载"。两层都不报错、都不影响测试，
  // 都只在"有人真的去用"的时候才暴露。
  //
  // 所以：调用 entry 的那个界面文件，**自己必须被别处 import**。
  const mounted = users.filter((f) => {
    const name = basename(f).replace(/\.(tsx?|jsx?)$/, '');
    if (name === 'index') return true; // 目录入口，从文件名判断不了，放行
    const importedElsewhere = webFiles.some(
      (g) => g !== f && new RegExp(`from\\s+'[^']*/${name}\\.js'`).test(webFileSrc.get(g)),
    );
    return importedElsewhere;
  });

  if (mounted.length === 0) {
    fail(
      `功能 \`${feature}\` 的界面文件（${users.map((f) => relative(ROOT, f)).join(', ')}）\n` +
        `     **没有任何地方挂载它** —— 它 import 了 \`${entry}\`，但自己从不被渲染。\n` +
        `     用户打开应用时看不到它，所以这个功能**依然碰不到**。\n` +
        `     挂载点通常在 \`apps/web/src/App.tsx\`（照 \`AiBreakdown\` 的写法）。`,
    );
  }
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

  // 8a. 托管云 AI 必须仍然不可启用
  if (ai.describeRetention('heyta-cloud') !== undefined) {
    fail(
      `\`describeRetention('heyta-cloud')\` **不再是 \`undefined\`**。\n` +
        `     ADR-0013 的结论是：数据保留策略未定案前，托管 AI **不得启用**。\n` +
        `     这是产品决策，不是编码缺口 —— 改成别的值请先写一份新 ADR。`,
    );
  } else {
    notes.push('托管云 AI 仍被挡住（`describeRetention(\'heyta-cloud\') === undefined`）。');
  }

  // 8b. 启用时必须带着 retention-undecided 这个理由失败
  let threw = null;
  try {
    ai.assertEnableable({ mode: 'managed' });
  } catch (err) {
    threw = err;
  }
  if (threw === null) {
    fail(
      `\`assertEnableable({ mode: 'managed' })\` **没有抛错** —— 托管 AI 被放行了。\n` +
        `     见 ADR-0013。`,
    );
  } else if (threw.reason !== 'retention-undecided') {
    fail(
      `\`assertEnableable({ mode: 'managed' })\` 抛了，但理由是 \`${threw.reason}\`，\n` +
        `     而不是 \`retention-undecided\`。理由被改掉会让 UI 说出错误的解释。`,
    );
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
  const catalogs = await loadCatalogs();
  const catalogLocales = Object.keys(catalogs).sort();
  if (catalogLocales.length === 0) {
    fail(
      '`packages/i18n` 的 `CATALOGS` 是**空的** —— 8c 无从判定。\n' +
        '     这不是"没有违规"，这是探针够不着。检查 `packages/i18n/dist` 的导出形状是否变了。',
    );
  }
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
 */
const ENTITY_COVERAGE_DEBT = new Map([
  // 🔴🔴 **下面四条的理由，第一版全是错的** —— 它们抄自一次"读完代码之后的汇报"，
  // 那份汇报说 TAG / NOTE / HABIT_LOG / REMINDER **在产品侧根本没有写动作本体**，
  // 所以"AI 连提案都产不出"。这次逐行打开了被调函数本体（2026-10-03）：
  //   · project-actions.ts:178  createTag   → :183 dispatch，entityType TAG，opType Create
  //   · note-actions.ts:133     createNote  → :140 dispatch，entityType NOTE
  //   · habit-actions.ts:275    checkIn     → :283 dispatch，entityType HABIT_LOG
  //   · reminder-actions.ts:174 writeNew    → :190 dispatch，entityType REMINDER
  // 四条**全都有写路径**。错在哪一层：那份汇报按"函数名去搜实现"，没打开被调函数本体，
  // 而我把它的结论直接抄进了一道门禁的理由串里 —— 于是**一句没取证的谎拿到了门禁的权威**，
  // 下一轮读到它的人只会照着"产品没写路径"去排期。这正是本仓库反复付学费的形状
  // （抄件一定会漂 + 断言"没有 X"必须读被调方本体）。原句留在下面不是为了引用，是为了认错。
  //
  // ⇒ 真正的卡点只有一个，而且是量出来的：目录容量，见每条末尾那句。
  [
    'TAG',
    {
      gap: 'AI-COV-2',
      reason:
        '产品侧**有**写路径（project-actions.ts:178 的 createTag 真的 dispatch TAG 的 CRT）。' +
        '卡点是目录容量：覆盖它要一读一写两个条目，而 local-api.spec.ts:87 判 ' +
        'LOCAL_API_TOOLS.length <= 10、现 9 个 ⇒ 只剩 1 席。',
    },
  ],
  [
    'NOTE',
    {
      gap: 'AI-COV-3',
      reason:
        '同 TAG：note-actions.ts:133 的 createNote 真的 dispatch NOTE 的 CRT（该文件 6 处 dispatch）。' +
        '卡点是同一个容量判据。',
    },
  ],
  [
    'HABIT_LOG',
    {
      gap: 'AI-COV-5',
      reason:
        'habit-actions.ts:275 的 checkIn 真的 dispatch HABIT_LOG 的 CRT，HabitsScreen 与 web 的勾选都在调它' +
        '—— 第一版那句"logHabit 没有写动作本体"是错的。卡点是同一个容量判据。',
    },
  ],
  [
    'FOCUS_SESSION',
    {
      gap: 'AI-COV-6',
      reason:
        '番茄钟能开始/结束（focus-timer.ts），AI 侧零工具。' +
        '⚠️ 这条**刻意不放进"剔除项"**：它有用户能按的编辑面，按准入判据就该进分母。' +
        '🔴 卡点是容量：一读一写两个条目，而 local-api.spec.ts:87 判 <= 10、现 9 个 ⇒ 只剩 1 席。' +
        '要么重新拍那条上限，要么先腾出一个既有工具 —— **不要为了塞进去而删工具**。',
    },
  ],
  [
    'REMINDER',
    {
      gap: 'AI-COV-7',
      reason:
        '提醒在任务行上就能设，reminder-actions.ts:174 的 writeNew 真的 dispatch REMINDER 的 CRT' +
        '（该文件 6 处 dispatch）。卡点是同一个容量判据。',
    },
  ],
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
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 报告
// ───────────────────────────────────────────────────────────────────────────

console.log(`AI 功能覆盖门禁 —— 由 \`AiFeature\` 联合类型驱动`);
console.log(`  联合类型成员：${aiFeatures.join(', ')}`);
console.log(`  界面不可达豁免：${NO_UI_ENTRY.size === 0 ? '（无）' : [...NO_UI_ENTRY].join(', ')}`);
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

console.log(`✅ ${aiFeatures.length} 个 AI 功能全部端到端可达（实现 → 导出 → 路由声明 → 偏好声明 → 界面）。`);
process.exit(0);
