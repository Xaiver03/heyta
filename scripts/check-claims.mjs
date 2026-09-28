#!/usr/bin/env node
/**
 * 「站点上的声称必须可核对」
 * ============================
 *
 * 落地页上有两类句子，写完就没有任何东西再管它们：
 *
 *   1. **验证方式**（`site.*.evidence`，见 A1-3）—— 像
 *      `pnpm verify:mobile-focus`、`packages/domain/src/habit-streak.ts`。
 *      它们是**出处**：一句话之所以可信，只因为有人能去跑一遍 / 打开看。
 *      而它们最容易以两种方式腐坏：
 *        · 脚本改名了（`verify:mobile-focus` → 别的名字），文案没跟着改；
 *        · 路径搬了（`src/` 重构），文案还指着旧路径。
 *      两种情况都**不会报错**：页面上那行字照旧显示，访客照着敲却跑不起来 ——
 *      而这比不写出处更坏（它把"可核对"变成了一句装饰）。
 *   2. **平台状态**（`/platforms` 的六个平台）—— A2-6 要求它们的说法能在
 *      `docs/plans/roadmap.md` 里找到对应条目（防止站点讲了一个路线图上
 *      根本不存在的平台，或者反过来）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **「验证方式」的语法（只有四种，散文一律判红）**
 *
 *   · `pnpm <脚本名>` 或 `pnpm --filter <包名> <脚本名>`
 *   · `node <仓库内路径>`
 *   · 仓库内路径（文件或目录）
 *   · 绝对地址（`https://…`，点开即验证）
 *
 * 连接符两个：`&&` 串命令、`+` 串**同一目录**下的文件
 * （`packages/domain/src/a.ts + b.ts`）。
 * 任何一句中文说明都是**违规**：它会被当成路径而红。理由不是洁癖 ——
 * 散文没法被核对，而写成散文的那一刻，"出处"就退化成了又一枚形容词。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **这道门禁管不了什么，写清楚免得被高估**
 *
 * C2 只核对"**roadmap 里提到过这个平台**"，**不核对状态口径**。
 * 为什么：roadmap 是散文（进度表里是 ✅/🔄/🔴 加上一大段解释），没有机器可读的
 * 状态字段；硬造一个就有两份状态、两份状态必然漂移 —— 而漂移的那一份
 * 恰恰是访客读到的那一份。
 *
 * 所以状态口径仍然靠**人工**，判据是：
 * > 改动 `/platforms` 上任何一个平台的状态时，必须同时改 roadmap 里那一行。
 * 计划 §7 的风险 4（"站点新页面说错话"）把这条列为上线前的例行核实。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.HEYTA_CHECK_ROOT ?? process.cwd();
const problems = [];

const read = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8');

/* ── C1：每一条「验证方式」都必须指向真实存在的东西 ────────────── */

/**
 * 词条表里所有 `*.evidence` 的值。
 *
 * ⚠️ 用正则读 TS 源码是**故意**的粗活，但有一条硬要求：**读不到就报错**，
 * 而不是"扫到 0 条就算通过"。后者会让这道门禁在某次重构之后变成一条
 * 永远绿的空规则 —— 那比没有门禁更坏（它让人以为有人管着）。
 */
function readEvidenceEntries() {
  const entries = [];
  for (const table of ['zh-CN', 'en']) {
    const source = read(`packages/i18n/src/locales/${table}.ts`);

    /**
     * 🔴 值用**转义感知**的模式，不是 `[^']+`。
     *
     * `[^']+` 在遇到 `\'` 时会把值**截断**在转义引号处 —— 于是那条 evidence
     * 要么带着半截值去核对（假红），要么（配合行尾 `',` 的要求）整条匹配不上、
     * **从数组里静默消失**（假绿）。后者才是要命的那个。
     */
    const re = /^\s*'([a-zA-Z0-9.\-]+\.evidence)':\s*'((?:[^'\\]|\\.)*)',/gm;
    let m;
    while ((m = re.exec(source)) !== null) {
      entries.push({ key: `${table}/${m[1]}`, value: m[2], bareKey: m[1] });
    }

    /**
     * 🔴 **条数守恒**：解析出来的必须与"看起来像 evidence 的行数"相等。
     *
     * 只有"一条都没解析到"时才报错是不够的 —— 那是"匹配不到就跳过"在
     * **逐条**粒度上的残留：一条 evidence 因为形状走样（值里有转义引号、
     * 跨行、尾部有注释、key 里出现大写）而消失时，门禁**照样绿**，
     * 而它守的那条声称从此没人管。
     *
     * 更糟的是这一条会与 `check-ui-language` 的 `\.evidence$` 豁免叠加：
     * 那条规则把 `*.evidence` 整类豁免"中文必须含汉字"，于是形状走样的
     * evidence 可以**两道门禁一起放过**。条数守恒正是那道叠加的补丁。
     */
    const shapeLines = [...source.matchAll(/^\s*'[a-zA-Z0-9.\-]+\.evidence'\s*:/gm)].length;
    const parsed = entries.filter((e) => e.key.startsWith(`${table}/`)).length;
    if (parsed !== shapeLines) {
      problems.push(
        `${table} 词条表里看起来像 evidence 的有 ${shapeLines} 行，但只解析出 ${parsed} 条。` +
          '差的那几条**形状走样了**（值里有转义引号 / 跨行 / 尾部有注释 / key 带大写），' +
          '而它们会从核对清单里**静默消失** —— 门禁必须在这里红，不能跳过。' +
          '形状要求：一行一条、key 与 value 都用单引号、内部单引号写 `\\\'`、行尾逗号。',
      );
    }
  }
  return entries;
}

/**
 * 把一条 evidence 值拆成若干"可核对的东西"。
 *
 * 值里允许两种连接符，都是给人读的形状：
 *   - `&&`：两条命令（各自核对）；
 *   - `+`：同一目录下的两个文件（`packages/domain/src/a.ts + b.ts`）——
 *     第二个是**相对第一个的目录**，不是相对仓库根。这条规则不写明的话，
 *     `+ habit-resilience.ts` 会被判成"路径不存在"，而人一眼看不出为什么。
 */
function tokensOf(value) {
  const out = [];
  let lastDir = null;

  for (const chunk of value.split('&&')) {
    for (const raw of chunk.split('+')) {
      const token = raw.trim();
      if (token === '') continue;

      if (token.includes('/')) {
        lastDir = token.slice(0, token.lastIndexOf('/'));
        out.push(token);
        continue;
      }
      // 没有斜杠：命令（`pnpm …`）或"同目录下的下一个文件"。
      if (token.startsWith('pnpm ') || token.startsWith('node ')) {
        out.push(token);
        lastDir = null;
        continue;
      }
      out.push(lastDir === null ? token : `${lastDir}/${token}`);
    }
  }
  return out;
}

const rootScripts = Object.keys(JSON.parse(read('package.json')).scripts ?? {});

/**
 * 工作区里的包名 → 目录。
 *
 * ⚠️ `pnpm --filter @heyta/domain test` 里的 `@heyta/domain` 是**包名**，不是路径 ——
 * 第一版把它当路径查 `@heyta/domain/package.json`，于是**每一条**带 `--filter`
 * 的 evidence 都被误判成"包不存在"。一条会误报的门禁迟早会被绕过，
 * 所以这里按真源（各 package.json 的 `name`）建表。
 */
function readWorkspacePackages() {
  const map = new Map();
  /**
   * 🔴 目录清单**从 `pnpm-workspace.yaml` 派生**，不是手写的三个名字。
   *
   * 手写版本是 `['apps', 'packages', 'research']` —— 而 `pnpm-workspace.yaml`
   * 的 packages 是 `packages/* / apps/* / server`。差别在 `server`：
   * 一份 `pnpm --filter @heyta/sync-server <script>` 的 evidence 会被判成
   * "包不在工作区里" —— **假红**。而这条门禁自己的注释就写着
   * "一条会误报的门禁迟早会被绕过"。
   *
   * 今天没触发只是因为还没有那样的 evidence —— 那不是"没问题"，
   * 是"问题还没被写出来"。
   */
  const yaml = read('pnpm-workspace.yaml');
  /**
   * YAML 里两种形状都要认：
   *   - `"packages/*"` —— 通配，取目录后枚举其下的包；
   *   - `"server"`     —— 直接就是一个包根（没有 `/*`）。
   *
   * ⚠️ 引号可能是双引号也可能是单引号。第一版只认单引号 + `/*`，
   * 于是**两种形状一个都没匹配上**，回落到硬编码的 `['apps','packages']` ——
   * 表面上"改了"，实际 `server` 还是漏着。**静默回落到旧行为是最坏的一种**
   * "修好了"：门禁绿着，而它想修的东西一个字没变。
   */
  const patterns = [...yaml.matchAll(/^\s*-\s*["']?([^\s"'#]+)["']?\s*$/gm)].map((m) => m[1]);
  const roots = [];
  for (const p of patterns) {
    const bare = p.replace(/\/\*$/, '');
    if (bare === '' || bare.startsWith('!')) continue;
    roots.push({ dir: bare, single: !p.endsWith('/*') });
  }

  for (const { dir, single } of roots) {
    const base = join(ROOT, dir);
    if (!existsSync(base)) continue;
    // 单包根（`server`）：它自己就是包，不枚举子目录。
    const entries = single
      ? ['']
      : readdirSync(base).map((e) => e);
    for (const entry of entries) {
      const pkgDir = entry === '' ? dir : `${dir}/${entry}`;
      const manifest = join(ROOT, pkgDir, 'package.json');
      if (!existsSync(manifest)) continue;
      const json = JSON.parse(readFileSync(manifest, 'utf8'));
      if (typeof json.name === 'string') map.set(json.name, pkgDir);
    }
  }
  return map;
}

const workspacePackages = readWorkspacePackages();
const workspaceScripts = new Set();
for (const dir of workspacePackages.values()) {
  const manifest = join(ROOT, dir, 'package.json');
  for (const name of Object.keys(JSON.parse(readFileSync(manifest, 'utf8')).scripts ?? {})) {
    workspaceScripts.add(name);
  }
}

const evidence = readEvidenceEntries();

/**
 * 🔴 两张表的同一条 evidence 必须**逐字相同**。
 *
 * 命令与文件路径不该被翻译 —— 翻译一份命令等于让它跑不起来，
 * 而"跑不起来"这件事在页面上看起来完全正常（它只是一行小字）。
 * 这也是为什么这条断言放在**词条表之外**：`catalog.spec.ts` 只管
 * "中英 key 集合一致"，管不到"值该不该一样"。
 */
{
  const byKey = new Map();
  for (const { bareKey, value, key } of evidence) {
    const existing = byKey.get(bareKey);
    if (existing === undefined) byKey.set(bareKey, { value, key });
    else if (existing.value !== value) {
      problems.push(
        `${bareKey}：中英两表的值不一样（${existing.key}="${existing.value}" / ${key}="${value}"）。` +
          '命令与路径不翻译，两边必须逐字相同',
      );
    }
  }
}
if (evidence.length === 0) {
  problems.push(
    '一条 `*.evidence` 词条都没读到 —— 词条表的形状可能变了，' +
      '这道门禁正在变成一条空规则。见 scripts/check-claims.mjs 的 readEvidenceEntries()。',
  );
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/**
 * 🔴 `pnpm` 命令的**元数**必须是固定的两种之一。
 *
 * 这条修的是本脚本自己声称已经修好、却只修了一半的洞。
 *
 * 文件头与第 181-183 行写着：`pnpm verify:mobile-ios（36 项零 mock）`
 * 曾被"只看第一个 token"的实现放过，而括号里那句"36 项零 mock"
 * **没人核对过**。当时的修法是加一条"值里不许有汉字"——
 * 于是**中文**那半修住了，**英文那半照样进得来**。
 *
 * 实测（2026-09-28，两表中英同步）：
 *
 *      'site.platforms.ios.evidence': 'pnpm verify:mobile-ios and fully verified with zero mocks'
 *
 * ⇒ 本脚本**退出 0**。"and fully verified with zero mocks" 与
 * "36 项零 mock" 是同一件事，只是一个用英文写。
 *
 * 判据因此落在**形状**上而不是语言上：值只能是命令本身，多一个词就说明
 * 有人在命令后面接了一句**没有任何东西核对**的话。这与"值里不许有汉字"
 * 是同一意图，只是不依赖"说明用中文写"这个巧合。
 *
 * ⚠️ 元数是**收紧**的：真的需要带参数的调用（`pnpm -r <cmd>` 之类）现在会被拒。
 * 那是刻意的 —— 本脚本是"证明某件事被验过"的清单，它应当只收**能被机器核对**
 * 的形状；要写带参数的命令，先把它包成一个 `package.json` 脚本，
 * 让"这个组合被跑过"变成一个有名字、可复核的东西。
 * 今天仓库里的 evidence 只有 `pnpm <脚本>` 与 `pnpm --filter <包> <脚本>` 两种形状。
 */
function assertPnpmArity(key, token, args, expected) {
  const clean = args.filter((a) => a !== '');
  if (clean.length !== expected) {
    const extra = clean.slice(expected).join(' ');
    problems.push(
      `${key}：\`${token}\` 后面多出了 ${clean.length - expected} 个词` +
        (extra === '' ? '' : `（"${extra}"）`) +
        '。值只能是命令本身 —— `pnpm <脚本>` 或 `pnpm --filter <包> <脚本>`；' +
        '命令后面接的说明**没有任何东西会核对它**（英文也一样）。',
    );
  }
}

for (const { key, value } of evidence) {
  /**
   * 🔴 值里**不许有汉字**。这一条不是洁癖，它是"撇文 vs 出处"的机械判据：
   * 中文说明只会出现在解释性文字里，而解释性文字没法被核对 ——
   * 它是形容词的另一种写法。上一条版本里 `pnpm verify:mobile-ios（36 项零 mock）`
   * 就被"只看第一个 token"的实现放过了，而那句话里的"36 项零 mock"
   * 恰恰是**没人核对过的声称**。
   */
  if (CJK.test(value)) {
    problems.push(
      `${key}：值里有中文说明（"${value}"）。` +
        '「验证方式」只能是命令 / 路径 / 绝对地址 —— 说明写在页面正文里，不写在这里',
    );
    continue;
  }

  for (const token of tokensOf(value)) {
    if (token.startsWith('pnpm ')) {
      // `pnpm --filter <pkg> <cmd>`：核对**包名**与包内脚本都存在。
      const args = token.slice('pnpm '.length).trim().split(/\s+/);
      if (args[0] === '--filter') {
        const pkg = args[1];
        const inner = args[2];
        if (pkg === undefined || !workspacePackages.has(pkg)) {
          problems.push(`${key}：\`${token}\` 里的包 "${pkg}" 不在工作区里`);
        } else if (inner !== undefined && !inner.startsWith('--')) {
          const dir = workspacePackages.get(pkg);
          const scripts = Object.keys(
            JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')).scripts ?? {},
          );
          if (!scripts.includes(inner)) {
            problems.push(`${key}：\`${token}\` 里 ${pkg} 没有脚本 "${inner}"`);
          }
        }
        // 🔴 元数：`pnpm --filter <包> <脚本>` 恰好三个词，多一个都不行。
        assertPnpmArity(key, token, args, 3);
        continue;
      }
      const name = args[0];
      if (name !== undefined && !rootScripts.includes(name) && !workspaceScripts.has(name)) {
        problems.push(`${key}：脚本 "${name}" 在 package.json 里不存在（${token}）`);
      }
      // 🔴 元数：`pnpm <脚本>` 恰好一个词。
      assertPnpmArity(key, token, args, 1);
      continue;
    }

    // `node <路径>`：命令跑不跑得起来这里管不了，但**脚本文件在不在**能管。
    if (token.startsWith('node ')) {
      const target = token.slice('node '.length).trim();
      if (target !== '' && !existsSync(join(ROOT, target))) {
        problems.push(`${key}：\`${token}\` 里的脚本 "${target}" 不存在`);
      }
      continue;
    }

    // 绝对地址：能打开就是可核对的一种（点击即验证）。
    if (/^https?:\/\//.test(token)) continue;

    if (!existsSync(join(ROOT, token))) {
      problems.push(
        `${key}：路径 "${token}" 不存在。` +
          '（值只能是命令 / 路径 / 绝对地址，不能是散文 —— 见本脚本的语法说明）',
      );
    }
  }
}

/* ── C2：平台页讲到的每个平台，roadmap 里必须提到 ──────────────── */

/**
 * 平台 id → roadmap 里可能出现的写法。
 *
 * ⚠️ `移动端` 同时覆盖 android 与 ios —— roadmap 把两端合在一起讲。
 * 这让 C2 对这两端**偏弱**（提到"移动端"就算过）。如实写在这里，
 * 而不是假装它对每一端都同样严格。
 */
const PLATFORM_ALIASES = {
  web: ['Web'],
  android: ['Android', '安卓', '移动端'],
  ios: ['iOS', '移动端'],
  desktop: ['桌面'],
  harmony: ['鸿蒙', 'HarmonyOS'],
  selfhost: ['自建'],
};

/** 平台页有哪些平台 —— 从**页面的结构定义**读，不是从文案读。 */
function readPlatformIds() {
  const source = read('apps/landing/src/site/content.ts');
  const start = source.indexOf('PLATFORM_SECTIONS');
  if (start === -1) return [];
  const end = source.indexOf('];', start);
  const body = source.slice(start, end === -1 ? source.length : end);
  return [...body.matchAll(/^\s*id:\s*'([a-z0-9\-]+)'/gm)].map((m) => m[1]);
}

const platformIds = readPlatformIds();
if (platformIds.length === 0) {
  problems.push(
    '读不到 `/platforms` 的平台清单 —— 页面结构可能改了，' +
      '这道门禁正在变成一条空规则。见 scripts/check-claims.mjs 的 readPlatformIds()。',
  );
}

const roadmap = read('docs/plans/roadmap.md');
for (const id of platformIds) {
  const aliases = PLATFORM_ALIASES[id];
  if (aliases === undefined) {
    problems.push(
      `平台 "${id}" 没有登记 roadmap 里的写法。` +
        '新增平台时要同时在这里登记别名（并确认 roadmap 真的会讲到它）。',
    );
    continue;
  }
  if (!aliases.some((alias) => roadmap.includes(alias))) {
    problems.push(
      `/platforms 讲了 "${id}"，但 docs/plans/roadmap.md 里一次都没提到` +
        `（试过：${aliases.join(' / ')}）—— 站点讲了一个路线图上不存在的平台`,
    );
  }
}

/* ── 报告 ─────────────────────────────────────────────────── */

if (problems.length > 0) {
  process.stderr.write(
    [
      '',
      '🔴 站点上的声称与仓库对不上：',
      ...problems.map((p) => `   · ${p}`),
      '',
      '「验证方式」是**出处**：一句"可以自己去验证"只有在真的能验证时才成立。',
      '改脚本名 / 搬路径时，`packages/i18n` 里那条 evidence 要一起改。',
      '（判据见 docs/plans/site-and-parity-alignment.md 的 A1-3 与 A2-6。）',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

process.stdout.write(
  `✅ 站点声称可核对：${evidence.length} 条「验证方式」全部指向真实存在的脚本/路径；` +
    `${platformIds.length} 个平台都能在 roadmap 里找到对应条目。\n`,
);
