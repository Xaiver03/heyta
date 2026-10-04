#!/usr/bin/env node
/**
 * 小组件门禁
 * ============
 *
 * ## 这个脚本防的是**一条红线**，不是一类风格问题
 *
 * 小组件的架构建立在一条边界上：
 *
 *   > **组件写意图，`widget-core` 只做纯计算，`app-host` 才把意图变成 op。**
 *
 * 这条边界必须由**类型和门禁**保证，不能靠约定。一旦破了，
 * 症状是"同一份 op 被两条路径构造出两个版本"，而**两边都不会报错** ——
 * 仓库里这个形状已经发生过多次（AGENTS.md §3.5 记着 `createTaskActions`
 * 早就存在、移动端一直在用，`apps/web` 却另留一份并已漂移）。
 *
 * ## 🔴 每条规则都是"先写它会因为什么失败，再写检查本身"
 *
 * `AGENTS.md` §5：**a check that cannot fail is worthless。**
 * 所以本文件每一条都在下面注明**怎么让它红**（`注入`），且都实测过一次。
 * 写"扫了 N 个文件 ✅"这种永远绿的输出等于没写。
 *
 * ## 为什么是独立脚本，而不是加进 `check-layering.mjs`
 *
 * `check-layering.mjs` 的管辖范围是明确的：**`apps/*` 不得重新长出业务代码**
 * （它的 `APPS` 常量写死了只扫 `apps/`）。本文件的管辖范围完全不同 ——
 * **`packages/` 内部**子系统的红线：
 *
 *   | 脚本 | 扫哪里 | 防什么 |
 *   |---|---|---|
 *   | `check-layering.mjs` | `apps/*` | 外壳重新长出业务代码 |
 *   | `check-module-boundaries.mjs` | git 改动 | 多个 AI 模块改同一批文件 |
 *   | **本脚本** | `packages/widget-core` + `widget-actions.ts` | 小组件越过 op 构造红线 |
 *
 * 三者的**判据来源**不同，合并会让某一条的"为什么"被淹没在另一条的上下文里。
 *
 * ## ⚠️ 本脚本还补了一个 `pnpm check` 的真实缺口
 *
 * `pnpm check` 的执行链是 `build → typecheck → check:*`，**它不跑任何测试套件**。
 * 而"四端共享的那份黄金夹具没被人手改"此前只由
 * `packages/widget-core/tests/fixtures.spec.ts` 保证 ——
 * 也就是说**在 `pnpm check` 里完全没有保护**。
 * 规则 `golden-fixture-matches-rebuild` 把这个检查**接进 `pnpm check`**。
 *
 * ⚠️ 它**不重新实现**夹具重建逻辑，而是调既有那个 spec（见该规则的 `why`）：
 * 重建逻辑只能有一份，否则"夹具对不对"本身就会有两个答案。
 *
 * 用法：node scripts/check-widgets.mjs
 *   非零退出 = 有违规。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIDGET_CORE = join(ROOT, 'packages', 'widget-core');
const WIDGET_CORE_SRC = join(WIDGET_CORE, 'src');
const APP_HOST_WIDGET_ACTIONS = join(ROOT, 'packages', 'app-host', 'src', 'widget-actions.ts');

/** 不扫的目录：产物与第三方源码，不是我们写的。 */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-types', 'build', 'coverage']);

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

/**
 * 静态规则。
 *
 * `scope` 是一个**函数**而不是 glob 字符串：范围本身就是判据的一部分，
 * 写成一个能读的谓词比写成一个要解析的 glob 更难出错。
 */
const RULES = [
  {
    id: 'no-app-host-import-in-widget-core',
    scope: () => widgetCoreSourceFiles(),
    // ⚠️ 这里必须**三种导入形态都覆盖**，这是实测出来的教训：
    // 第一版只写了 `from`，于是 `import "@heyta/app-host";`（副作用导入，
    // 没有 `from` 关键字）**直接溜过去了** —— 注入验证第一次就抓到了这个漏洞。
    // 覆盖：`from '…'` / `import '…'` / `import('…')` / `require('…')`。
    pattern: /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]@heyta\/app-host['"]/,
    what: '`widget-core` 里 import 了 `@heyta/app-host`',
    why:
      '这是小组件那条红线的**直接违反**，而且它同时是**循环依赖**：' +
      '`app-host` 依赖 `widget-core`（`widget-actions.ts` 要用 `classifyIntents`）。' +
      '更实质的问题是：`app-host` 里全是 op 构造器，一旦 widget-core 能拿到它们，' +
      '"这个包在类型上产生不了 op" 就只剩一句注释了 —— ' +
      '下一个人会在组件里顺手 dispatch，而**没有任何东西会报错**。',
    fix:
      '`widget-core` 只允许依赖 `@heyta/domain` 与 `@heyta/design-system`。' +
      '要落地的意图由宿主调 `drainWidgetIntents()`（`@heyta/app-host`）。',
    inject: '在 `packages/widget-core/src/index.ts` 加 `import "@heyta/app-host";`',
  },
  {
    id: 'no-op-construction-in-widget-core',
    scope: () => widgetCoreSourceFiles(),
    // 三种形态，全是"在拼 op"的必要条件：
    //   - `entityType: 'TASK'` 字面量（与 check-layering 第 7 条同形）
    //   - `OpType.`（op 类型的枚举）
    //   - `.dispatch(`（ActionContext 的形状）
    pattern: /\bentityType:\s*['"][A-Z][A-Z_]*['"]|\bOpType\b|\.dispatch\s*\(/,
    what: '`widget-core` 里出现 op 构造的痕迹',
    why:
      '与上一条是**同一个红线的两种破法**：上一条拦住"拿到构造器"，' +
      '这一条拦住"自己拼"。`widget-core` 是**四端共享**的一层，' +
      '它一旦能拼 op，就等于**四个平台各自有了一套 op 语义** —— ' +
      '而 op 的构造必须只有一份（`AGENTS.md` §3.4 / §3.5）。' +
      '这个形状的实测代价写在 `check-layering.mjs` 的 `no-op-construction-in-apps` 里：' +
      '规则上线时一次抓出 17 处真实违规，其中 7 处 TASK 是在共享实现**已经存在、' +
      '移动端已经在用**的情况下继续活着的。',
    fix:
      '意图只表达"用户想要什么"（`WidgetIntent { taskId, targetIsDone }`）。' +
      '变成 op 是 `packages/app-host` 的 `drainWidgetIntents()` 的事。',
    inject: "在 `packages/widget-core/src/intents.ts` 加 `const x = { entityType: 'TASK' };`",
  },
  {
    id: 'no-native-or-app-imports-in-widget-code',
    scope: () => [APP_HOST_WIDGET_ACTIONS],
    // 原生/宿主模块一律不许：这两个文件要能在纯 Node 测试里跑。
    // `apps/` 路径也拦 —— 那会让"共享逻辑"反过来依赖某一个平台的实现。
    // ⚠️ 同样是三种导入形态（`import 'x'` 没有 `from`，第一版漏过，见上面那条规则的注释）。
    pattern:
      /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](?:react-native|expo[^'"]*|electron|@react-native[^'"]*|\.[^'"]*apps\/)/,
    what: '`widget-actions.ts` 里 import 了原生 / 宿主模块',
    why:
      '`drainWidgetIntents` 的**全部价值**是"四端跑同一段逻辑"。' +
      '它一旦 import 了 `react-native` 或 `expo`，这段逻辑就**只能**在移动端跑，' +
      'Windows / 鸿蒙那两个宿主就得各写一份 —— 而那正是要避免的漂移。' +
      '它必须保持纯 TS，靠**注入**的 `TaskActions` 工作（见该文件的 `WidgetDrainTasks`）。' +
      '这也让它能在真实 SQLite（`:memory:`）上被测，而不是靠假探针。',
    fix:
      '保持 `widget-actions.ts` 只依赖 `@heyta/widget-core` 的类型与 `./actions.js` 的类型。' +
      '需要平台能力时，**从参数注入**，不要在文件里 import。',
    inject: "在 `packages/app-host/src/widget-actions.ts` 加 `import 'react-native';`",
  },
];

/**
 * `widget-core/src` 下的可扫文件。
 *
 * ⚠️ **只扫 `src/`，不扫 `tests/`**：测试要模拟"另一台设备"，
 * 它们需要造 op、甚至需要 import 真实引擎 —— 那是在**验证**边界，
 * 不是在**定义**产品语义。`check-layering.mjs` 的 `walk()` 出于同一个理由跳过测试文件。
 *
 * ⚠️ 用 `Array.from` 而不是让调用方拿到生成器：生成器**只能迭代一次**，
 * 而每条规则都要完整遍历一遍范围；返回数组让这个坑不可能踩到。
 */
function widgetCoreSourceFiles() {
  const out = [];
  for (const file of walk(WIDGET_CORE_SRC)) out.push(file);
  return out;
}

/** 该行是否在注释里（与 `check-layering.mjs` 同一条判据：只看行首 token）。 */
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
      yield full;
    }
  }
}

const violations = [];

// ── 静态规则 ────────────────────────────────────────────────────────────────
for (const rule of RULES) {
  const files = rule.scope();
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = relative(ROOT, file);
    text.split('\n').forEach((line, i) => {
      // 注释里提到这些名字是**解释**，不是违规 —— 本门禁自己的文档、
      // 以及各文件头解释"为什么不再这么写"都靠这条。
      if (isCommentLine(line)) return;
      if (rule.pattern.test(line)) {
        violations.push({ rel, line: i + 1, rule, text: line.trim() });
      }
    });
  }
}

// ── 规则：widget-core 的运行时依赖只允许工作区内的两个包 ────────────────────
{
  const pkgPath = join(WIDGET_CORE, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const deps = Object.keys(pkg.dependencies ?? {});
  const allowed = new Set(['@heyta/domain', '@heyta/design-system']);
  const offenders = deps.filter((name) => !allowed.has(name));

  if (offenders.length > 0) {
    violations.push({
      rel: relative(ROOT, pkgPath),
      line: 1,
      rule: {
        what: `\`widget-core\` 引入了计划外的运行时依赖：${offenders.join('、')}`,
        why:
          '这个包的产物要**同时喂给四个平台**（含鸿蒙 ArkTS 与 Windows 的 JSON 模板），' +
          '所以它的依赖面必须**故意保持极小**。而且已有一处实测差异钉着这个决定：' +
          '`generated/HeytaTokens.swift` 里**一个类别色都没有**（`grep -c category` = 0），' +
          '说明"原生能解析设计系统 token"这个假设是**错的** —— ' +
          '正因为如此，`projectColors` 才改成传已解析的 `{ light, dark }`（决策 D7）。' +
          '每多一个依赖，就在多赌一次"四个平台都有它"。' +
          '（计划文档 §2.1 曾写 `widgetSnapshotSchema` 用 zod，实现时**刻意没用**，' +
          '也是同一个理由：契约只有 20 个字段，手写校验比多一个依赖便宜。）',
        fix:
          '运行时依赖只允许 `@heyta/domain` 与 `@heyta/design-system`。' +
          '确实需要新增时，**先改本脚本的 allowlist 并在这里写清理由** —— ' +
          '让"多一个依赖"成为一个要显式做的动作，而不是顺手 `pnpm add`。',
      },
      text: `dependencies: ${deps.join(', ')}`,
    });
  }
}

// ── 规则：黄金夹具与重建结果一致（委派给既有 spec，不重新实现）──────────────
// 🔴 这一档把"spec 没跑成"与"夹具真的不一致"**分成两个退出码**：
//      0 = 跑过且一致 · 1 = 跑过但违规 · 2 = 没跑成，这条等于**没验过**（未判不是绿）。
//   原由（2026-10-04 现量）：在 linked worktree 里 `pnpm … exec` 的 deps-status 预检会因为
//   无 TTY 拒绝移除共享 `node_modules`（`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`），
//   它抛出来的非零码与"vitest 报夹具不同"**逐字同形**。旧写法把前者报成
//   "黄金夹具与重建结果不一致"，症状是四端解析器的锁看起来坏了 ——
//   而同一棵树里直接跑那枚 spec（`packages/widget-core/node_modules/.bin/vitest`）是 4 passed。
//   判"跑成了"只认 vitest 自己打出的 summary 行，不认退出码，也不去 grep 错误字样。
// 🔴 第二半（同一天现量）：那条 `pnpm … exec` 自己带上 `--config.verify-deps-before-run=false`。
//   两个理由，第二个比第一个硬：
//   ① 带上前一枚门禁**在每个载体里都能真判**（本检出实测 `Tests 4 passed (4)`、RC=0，
//      不再只有"未判"这一档）；
//   ② 一道纯 fs 门禁**不该带着"能删掉共享 node_modules"的副作用** —— 那个预检的动作就是移除
//      modules 目录，它今天只是被"无 TTY"挡住的；在有 TTY 的地方跑这道门禁，它就会真去删重装。
//   ⚠️ 这个 flag 只是**关掉那道预检**（不装、不删、不改任何文件），不是 `CI=true`，
//      也不改变被测内容：vitest 那枚 spec 还是原样跑。
let fixturesUnjudged = null;
{
  const specRel = 'packages/widget-core/tests/fixtures.spec.ts';
  const r = spawnSync(
    'pnpm',
    [
      '--config.verify-deps-before-run=false',
      '--filter',
      '@heyta/widget-core',
      'exec',
      'vitest',
      'run',
      'tests/fixtures.spec.ts',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      // 🔴 `NO_COLOR=1` 是**承重的**，不是排版偏好：pnpm exec 把 vitest 的 stdout 判成 TTY，
      // 于是汇总行长这样 `^[[2m      Tests ^[[22m …4 passed`（现量：把这条命令原样打到文件里也是彩色的）。
      // 带色时下面那条 needle **恒 0 命中** ⇒ 这道门禁会在**每个载体**里都判成"未判"，
      // 也就是把一个能跑的判据永久变成哑的。再加一层剥色做双保险（被调方不认 NO_COLOR 时仍成立）。
      env: { ...process.env, NO_COLOR: '1' },
    },
  );
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`
    .replace(/\u001b\[[0-9;]*m/g, '')
    .trim();
  // vitest 的汇总行形如 `      Tests  4 passed (4)`；没有这一行就是"根本没跑到"。
  const summary = output.match(/^\s*Tests\s+(\d+)\s+(passed|failed).*$/m);
  if (r.error || !summary) {
    const why = output.split('\n').find((l) => /ERR_PNPM|ENOENT|Command failed|Cannot find/.test(l));
    fixturesUnjudged =
      (why ?? output.split('\n')[0] ?? 'runner 没有任何输出').slice(0, 160);
  } else if (Number(summary[1]) === 0) {
    fixturesUnjudged = `vitest 跑到了但一条用例都没执行（Tests 0 passed）—— 那枚 spec 没被收集到`;
  } else if (r.status !== 0 || summary[2] === 'failed') {
    violations.push({
      rel: specRel,
      line: 1,
      rule: {
        what: '黄金夹具与重建结果**不一致**（夹具被人手改了，或契约改了但没重建夹具）',
        why:
          '这四份夹具是**四端解析器的锁**：iOS / Android / 鸿蒙的原生解析器' +
          '都对着它写、对着它测。它一旦与真源不一致，' +
          '**四个平台会一起照着错的东西实现对**，而且各自的测试全绿 —— ' +
          '因为它们的"正确"就是这份夹具。这是整个 W0 里唯一一个' +
          '"错了会让四端同时错"的点。' +
          '⚠️ 另外：`pnpm check` 的链路是 `build → typecheck → check:*`，' +
          '**它平时不跑测试**，所以这个断言此前在 `pnpm check` 里完全没有保护 ——' +
          '本规则把它接进来。',
        fix:
          '夹具必须由真实选择器产出，不是手写的。重建命令：\n' +
          '         `UPDATE_FIXTURES=1 pnpm --filter @heyta/widget-core test tests/fixtures.spec.ts`\n' +
          '         重建后**必须看一眼 diff** —— 如果变化不是你有意造成的，那是 bug 不是夹具过期。' +
          '         （⚠️ 本规则**不重新实现**重建逻辑，而是调既有的那个 spec：' +
          '夹具对不对只能有一个答案，两处实现必然分叉。）',
      },
      // 带的是 vitest 自己那两行汇总，不是"退出码非零"这件事。
      text: `${summary ? summary[0].trim() : '（runner 没打汇总行）'}｜exit=${String(r.status)}\n${output.split('\n').slice(0, 10).join('\n         ')}`,
    });
  }
}

// ── 报告 ───────────────────────────────────────────────────────────────────
const scanned =
  RULES.reduce((sum, rule) => sum + rule.scope().length, 0) + 1; // +1 = package.json

if (violations.length === 0) {
  if (fixturesUnjudged) {
    console.error(
      `⚠️ 小组件边界其余规则通过（扫描 ${String(scanned)} 个文件），但**黄金夹具那一条没跑成 ⇒ 等于没验过**：\n` +
        `      ${fixturesUnjudged}\n` +
        '      这一档退出码是 2，不是 0 —— "没跑成的检查被读成绿"是本仓库记过最多次的那类错。\n' +
        '      这道命令自己已经带了 `--config.verify-deps-before-run=false`，所以还剩这一档' +
        '说明**这个检出连 vitest 都没有**（没装依赖的裸检出实测报 `Command "vitest" not found`），' +
        '门禁不会替它装东西。\n' +
        '      要绕开门禁自己真验这一条：`cd packages/widget-core && ./node_modules/.bin/vitest run tests/fixtures.spec.ts`',
    );
    process.exit(2);
  }
  console.log(
    `✅ 小组件边界完好（扫描 ${String(scanned)} 个文件 + 4 份黄金夹具，${String(
      RULES.length + 2,
    )} 条规则）。`,
  );
  process.exit(0);
}

if (fixturesUnjudged) {
  console.error(`⚠️ 另外：黄金夹具那一条没跑成（退出码被下面的违规占住，不单独报 2）：${fixturesUnjudged}`);
}

console.error(`🔴 小组件边界有 ${String(violations.length)} 处违规：\n`);
for (const v of violations) {
  console.error(`   ${v.rel}:${String(v.line)}`);
  console.error(`      违规：${v.rule.what}`);
  console.error(`      代码：${v.text}`);
  console.error(`      为什么有害：${v.rule.why}`);
  console.error(`      正确做法：${v.rule.fix}\n`);
}
console.error('规则出处：docs/plans/multi-platform-widgets.md（红线与决策 D1–D7）。\n');
process.exit(1);
