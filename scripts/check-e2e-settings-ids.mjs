#!/usr/bin/env node
/**
 * e2e 里那串 `settings-group-<x>` 必须与设置左栏**现量**一致。
 * ============================================================================
 *
 * ## 为什么需要它（这不是顺手加的）
 *
 * 2026-10-27 设置面从 8 组重排成 7 组（`docs/plans/settings-information-architecture.md`），
 * `settings-group-sync` 并进 `-data`、`settings-group-account` 并进 `-profile`。
 * 三个端的实现都改了，**e2e 没改** —— 于是四个文件继续点那两枚已经不存在的按钮。
 *
 * 🔴 症状不是红，是**更坏的那种绿**：
 * `click()` 打在一个不存在的选择器上会超时，但多数调用点前后的断言长得像
 * 「`sync-settings-panel` 可见」——而面板就在 DOM 里、只是 `hidden`。
 * 更糟的是 `vault-journey` 那种写成 `if (await nav.isVisible()) click()` 的形状：
 * 条件不成立 ⇒ **静默跳过**，然后在**默认那一节**（外观）上继续量几何、读行距。
 * 那只用例当时不是"失败"，是**在错误的屏幕上通过了**。
 *
 * 同族先例：§7 元规则 2「一条永远通过的判据比没有判据更糟」、#606（本地过、容器不过）。
 *
 * ## 三条臂（每条都能单独判红）
 *
 * 1. **左栏 ↔ 面板**：`SETTINGS_NAV_ITEMS` 里的每个 id，必须有一个
 *    `<section id="settings-group-…">` 与它同名；反过来也一样。
 *    缺一边的症状分别是「点了没反应」和「一个点不到的孤儿面板」——都不是报错。
 * 2. **e2e 的字面量必须是**现行** id**：旧 id 在深链里仍然认（`LEGACY_SETTINGS_SECTIONS`
 *    会折到新组），但左栏里**没有那枚按钮**，点它就是臂 1 描述的那种坏绿。
 * 3. **`e2e/tests/helpers.ts` 的 `SETTINGS_SLUGS` 必须与左栏后缀集合相等**：
 *    它是 e2e 唯一的派生源（`settings-category-ux` / `settings-row-grammar` 都从它
 *    遍历），少一项就等于"加一组、少测一组"，多一项就等于点一个不存在的东西。
 *
 * ## 用法
 *
 * ```sh
 * node scripts/check-e2e-settings-ids.mjs
 * node scripts/check-e2e-settings-ids.mjs --self-test   # 每臂注入一次坏输入，证明它会红
 * ```
 *
 * 退出码：0 = 全绿；1 = 有违规；2 = 自检本身失败（说明判据已坏，读数不可信）。
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SELF = fileURLToPath(import.meta.url);

/** 设置左栏的现量在这里（唯一事实源）。 */
const APP_REL = 'apps/web/src/App.tsx';
/** e2e 的派生源在这里。 */
const HELPER_REL = 'e2e/tests/helpers.ts';
/** 扫描面：e2e 下的手写源码。生成的产物目录不算。 */
const E2E_ROOT_REL = 'e2e';
const E2E_SKIP_DIRS = new Set(['node_modules', 'test-results', 'playwright-report', 'evidence', '.cache']);

const ID_PREFIX = 'settings-group-';

/**
 * 逐组遍历的两个套件。它们必须从 `SETTINGS_SLUGS` 派生分组清单，
 * 而不是各抄一份字面量 —— 抄件一定漂，2026-10-27 就是这么漂的。
 */
const DERIVED_SUITES = [
  'e2e/tests/settings-category-ux.spec.ts',
  'e2e/tests/settings-row-grammar.spec.ts',
];

/**
 * 把注释抹成等长空白（保留换行，行号不变），字符串原样保留。
 *
 * 为什么要抹：一个**注释里**提到的旧 id（"`settings-group-sync` 现在并进 `-data`"）
 * 是文档，不是选择器。不区分就会把解释性文字判成违规 —— 而唯一的"修法"是把注释删掉，
 * 那等于用门禁逼人少写理由（本仓最反对的那种交换）。
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  let quote = null;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote !== null) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function walk(dir, acc) {
  for (const entry of readdirSync(dir)) {
    if (E2E_SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

/** 左栏 id（顺序即渲染顺序）。 */
function navIds(appSource) {
  const start = appSource.indexOf('const SETTINGS_NAV_ITEMS');
  if (start < 0) throw new Error(`${APP_REL} 里找不到 SETTINGS_NAV_ITEMS —— 判据的锚点没了，读数不可信`);
  const end = appSource.indexOf('] as const satisfies', start);
  if (end < 0) throw new Error('SETTINGS_NAV_ITEMS 的收尾（`] as const satisfies`）找不到');
  const block = appSource.slice(start, end);
  const ids = [...block.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
  if (ids.length === 0) throw new Error('SETTINGS_NAV_ITEMS 里一个 id 都没解析出来');
  return ids;
}

/** 面板 id：`<section … id="settings-group-…"`。 */
function panelIds(appSource) {
  return [...appSource.matchAll(new RegExp(`<section[^>]*id="${ID_PREFIX}([a-z0-9-]+)"`, 'g'))].map(
    (m) => `${ID_PREFIX}${m[1]}`,
  );
}

/** `helpers.ts` 里那份派生的后缀清单。 */
function helperSlugs(helperSource) {
  const start = helperSource.indexOf('export const SETTINGS_SLUGS');
  if (start < 0) throw new Error(`${HELPER_REL} 里找不到 SETTINGS_SLUGS`);
  const end = helperSource.indexOf('] as const;', start);
  if (end < 0) throw new Error('SETTINGS_SLUGS 的收尾（`] as const;`）找不到');
  const block = helperSource.slice(start, end);
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function collect() {
  const appRaw = readFileSync(join(ROOT, APP_REL), 'utf8');
  const app = stripComments(appRaw);
  const helperRaw = readFileSync(join(ROOT, HELPER_REL), 'utf8');
  const helper = stripComments(helperRaw);

  const nav = navIds(app);
  const panels = panelIds(app);
  const slugs = helperSlugs(helper);

  const files = walk(join(ROOT, E2E_ROOT_REL), []);
  const literals = [];
  for (const file of files) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const m of text.matchAll(new RegExp(`${ID_PREFIX}([a-z0-9-]+)`, 'g'))) {
      const line = text.slice(0, m.index).split('\n').length;
      literals.push({ id: `${ID_PREFIX}${m[1]}`, rel: relative(ROOT, file).split(sep).join('/'), line });
    }
  }

  return { nav, panels, slugs, literals, fileCount: files.length };
}

function evaluate(data) {
  const problems = [];
  const navSet = new Set(data.nav);

  // 臂 1：左栏 ↔ 面板（两边都要在）
  const panelSet = new Set(data.panels);
  for (const id of data.nav) {
    if (!panelSet.has(id)) problems.push(`臂1 左栏有 \`${id}\`，但 ${APP_REL} 里没有同名的 <section id="${id}"> ⇒ 点了没反应（不报错）`);
  }
  for (const id of data.panels) {
    if (!navSet.has(id)) problems.push(`臂1 面板 \`${id}\` 存在，但左栏没有这一项 ⇒ 用户点不到它`);
  }

  // 臂 2：e2e 里出现的 id 必须是现行 id
  for (const hit of data.literals) {
    if (!navSet.has(hit.id)) {
      problems.push(
        `臂2 ${hit.rel}:${hit.line} 引用了 \`${hit.id}\`，它不在左栏（现量：${data.nav.join(' / ')}）` +
          ` ⇒ 那枚按钮不存在，点它的用例要么超时、要么在上一节上通过`,
      );
    }
  }

  // 臂 3：helpers 的派生清单与左栏后缀集合相等
  const navSlugs = data.nav.map((id) => id.slice(ID_PREFIX.length));
  const helperSet = new Set(data.slugs);
  const navSlugSet = new Set(navSlugs);
  for (const slug of navSlugs) {
    if (!helperSet.has(slug)) problems.push(`臂3 左栏有分组 \`${slug}\`，但 ${HELPER_REL} 的 SETTINGS_SLUGS 没有它 ⇒ 加一组、少测一组`);
  }
  for (const slug of data.slugs) {
    if (!navSlugSet.has(slug)) problems.push(`臂3 ${HELPER_REL} 的 SETTINGS_SLUGS 有 \`${slug}\`，左栏没有 ⇒ 会去点一个不存在的东西`);
  }
  if (data.slugs.length !== new Set(data.slugs).size) problems.push(`臂3 ${HELPER_REL} 的 SETTINGS_SLUGS 里有重复项`);

  // 臂 2 的覆盖半边：那两个"逐组遍历"的套件必须真的从 SETTINGS_SLUGS 派生。
  // 只要它们派生，臂 3 的集合相等就把"每一组都有真实浏览器覆盖"传递下来了；
  // 反过来，谁把清单抄回字面量，这条立刻红 —— 那正是 2026-10-27 漂移的形状。
  for (const rel of DERIVED_SUITES) {
    let text;
    try {
      text = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    } catch {
      problems.push(`臂2 缺文件 ${rel} —— 判据的消费方不在了`);
      continue;
    }
    if (!text.includes('SETTINGS_SLUGS')) {
      problems.push(`臂2 ${rel} 不再从 SETTINGS_SLUGS 派生分组清单 ⇒ 它会重新长出一份会漂的字面量`);
    }
  }

  return problems;
}

function report(data, problems) {
  const line = (s) => process.stdout.write(`${s}\n`);
  line(`e2e 设置分节 id 对账：左栏 ${data.nav.length} 组 / 面板 ${new Set(data.panels).size} 个 / 扫描 ${data.fileCount} 份 e2e 源码`);
  if (problems.length === 0) {
    line('✅ 三个方向都一致：左栏 ↔ 面板同集合、e2e 引用的都是现行 id、每组都有覆盖');
    return;
  }
  line(`❌ ${problems.length} 处违规：`);
  for (const p of problems) line(`  · ${p}`);
}

function run() {
  const data = collect();
  const problems = evaluate(data);
  report(data, problems);
  return problems.length === 0 ? 0 : 1;
}

/**
 * 自检：每一臂都注入一次坏输入，断言**它真的会红**。
 *
 * 用临时树（复制 `apps/web/src/App.tsx` / `e2e/tests/helpers.ts` / 一份伪造的 spec）
 * 而不是改工作树 —— 同一棵树上还有别的会话在跑。
 */
function selfTest() {
  const arms = [];
  const base = mkdtempSync(join(tmpdir(), 'heyta-e2e-settings-'));
  try {
    const build = (appPatch, helperPatch, specBody, suitePatch = {}) => {
      const dir = mkdtempSync(join(base, 'case-'));
      mkdirSync(join(dir, 'apps/web/src'), { recursive: true });
      mkdirSync(join(dir, 'e2e/tests'), { recursive: true });
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      const app = readFileSync(join(ROOT, APP_REL), 'utf8');
      const helper = readFileSync(join(ROOT, HELPER_REL), 'utf8');
      writeFileSync(join(dir, 'apps/web/src/App.tsx'), appPatch(app));
      writeFileSync(join(dir, 'e2e/tests/helpers.ts'), helperPatch(helper));
      writeFileSync(join(dir, 'e2e/tests/fake.spec.ts'), specBody);
      for (const rel of DERIVED_SUITES) {
        const dst = join(dir, rel);
        mkdirSync(dirname(dst), { recursive: true });
        writeFileSync(dst, (suitePatch[rel] ?? ((t) => t))(readFileSync(join(ROOT, rel), 'utf8')));
      }
      writeFileSync(join(dir, 'scripts/check-e2e-settings-ids.mjs'), readFileSync(SELF, 'utf8'));
      return dir;
    };
    const allIds = navIds(stripComments(readFileSync(join(ROOT, APP_REL), 'utf8')));
    // 每份伪造 spec 都要摸到全部现行分组，免得臂 2 的覆盖半边喧宾夺主
    const coverAll = allIds.map((id) => `// ${id}\nconst x_${id} = '${id}';`).join('\n');

    // 臂 0：阳性对照 —— 一份干净的树必须绿
    arms.push({
      name: '臂0 阳性对照（干净树 → 绿）',
      dir: build((s) => s, (s) => s, coverAll),
      expectRed: false,
    });
    // 臂 1a：左栏多一组、没有面板
    arms.push({
      name: '臂1a 左栏有、面板无',
      dir: build(
        (s) => s.replace(/const SETTINGS_NAV_ITEMS = \[/, "const SETTINGS_NAV_ITEMS = [\n  { id: 'settings-group-ghost', labelKey: 'mobile.settings.section.about', icon: null },"),
        (s) => s,
        coverAll,
      ),
      expectRed: true,
    });
    // 臂 1b：面板有、左栏无
    arms.push({
      name: '臂1b 面板有、左栏无',
      dir: build(
        (s) => `${s}\n<section id="settings-group-orphan" hidden />\n`,
        (s) => s,
        coverAll,
      ),
      expectRed: true,
    });
    // 臂 2a：e2e 点旧 id
    arms.push({
      name: '臂2a e2e 引用旧 id',
      dir: build((s) => s, (s) => s, `${coverAll}\nconst stale = 'settings-group-sync';`),
      expectRed: true,
    });
    // 臂 2b：某个逐组遍历的套件把清单抄回字面量
    arms.push({
      name: '臂2b 套件把分组清单抄回字面量',
      dir: build(
        (s) => s,
        (s) => s,
        coverAll,
        { [DERIVED_SUITES[0]]: (t) => t.replace(/SETTINGS_SLUGS(?:,\s*)?/g, '').replace(/for \(const id of \s*\)/, "for (const id of ['appearance'])") },
      ),
      expectRed: true,
    });
    // 臂 3a：helpers 少一项
    arms.push({
      name: '臂3a SETTINGS_SLUGS 少一项',
      dir: build(
        (s) => s,
        (s) => s.replace(/\n {2}'help',\n\] as const;/, '\n] as const;'),
        coverAll,
      ),
      expectRed: true,
    });
    // 臂 3b：helpers 多一项
    arms.push({
      name: '臂3b SETTINGS_SLUGS 多一项',
      dir: build(
        (s) => s,
        (s) => s.replace(/\n\] as const;\n\nexport type SettingsSlug/, "\n  'ghost',\n] as const;\n\nexport type SettingsSlug"),
        coverAll,
      ),
      expectRed: true,
    });

    let failed = 0;
    for (const arm of arms) {
      let red = false;
      try {
        execFileSync(process.execPath, [join(arm.dir, 'scripts/check-e2e-settings-ids.mjs')], { stdio: 'pipe' });
      } catch (error) {
        red = error.status === 1;
      }
      const ok = red === arm.expectRed;
      if (!ok) failed += 1;
      process.stdout.write(`${ok ? '✅' : '❌'} ${arm.name} —— ${red ? '红' : '绿'}（期望${arm.expectRed ? '红' : '绿'}）\n`);
    }
    process.stdout.write(
      failed === 0
        ? `✅ 自检 ${arms.length} 臂全部符合预期（臂数由本脚本自己打印）\n`
        : `❌ 自检有 ${failed} 臂不符合预期 —— 判据本身坏了，上面那个读数不可信\n`,
    );
    return failed === 0 ? 0 : 2;
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/**
 * `--self-test` 是**两条都跑**：先对真树出读数，再证明每臂都会红。
 * 只跑自检的话，链里那道门禁就只证明了"判据没坏"，没证明"这棵树没问题" ——
 * 而 §7 元规则 1 要求判据先在真输入上给读数。
 */
if (process.argv.includes('--self-test')) {
  const real = run();
  const self = selfTest();
  process.exit(real !== 0 ? real : self);
}
process.exit(run());
