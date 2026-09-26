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
 *   8. 运行时不变式：**托管云 AI 仍然被挡住**，且「不受端到端加密」的
 *      否定话术仍在（ADR-0006 / ADR-0013 的结论不许被悄悄改掉）
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
import { fileURLToPath } from 'node:url';

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
  const cloudText = ai.describeDestination('heyta-cloud') ?? '';
  if (!cloudText.includes('不受端到端加密')) {
    fail(
      `\`describeDestination('heyta-cloud')\` 里**没有了「不受端到端加密」这句否定**。\n` +
        `     ADR-0006 的基石：托管 AI **永远不能**被描述成端到端加密。\n` +
        `     实际文案：${JSON.stringify(cloudText)}`,
    );
  } else {
    notes.push('托管 AI 的文案仍带「不受端到端加密」的明确否定（ADR-0006）。');
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
