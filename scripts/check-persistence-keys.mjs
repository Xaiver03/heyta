#!/usr/bin/env node
/**
 * 门禁：客户端持久化键必须有登记（`docs/reference/client-persistence-keys.md`）
 * ==================================================================
 *
 * ## 为什么需要它
 *
 * [ADR-0085](../docs/adr/0085-appearance-is-device-local-and-never-an-op.md) 第 4 条：
 * 外观类是**设备属性**（写本机、零 op），行为类是**账号属性**（走 op）。
 * 两档混存的后果不是"不好看"，而是：换台机器外观被同步走 / 同一个偏好两处存 / 用户的**数据**被当成
 * "这台机器的样子"丢掉。
 *
 * 而"这个键属于哪一档"**不会有任何编译错误**：`localStorage.setItem('heyta.xyz', …)` 在任何一档都能跑。
 *
 * ## 三条断言
 *
 * | # | 断言 | 怎么才会红 |
 * |---|---|---|
 * | A | 源码里每个 `heyta.*` 字面量键都在表里出现过 | 新加键不登记 |
 * | B | 表里每个键都在源码里出现过 | 删了键不删表（鬼键） |
 * | C | 每个键恰好登记**一次** | 同一个键落进两档 |
 *
 * ## 🔴 射程（写清，否则它会被读成"全都在管"）
 *
 * 只认**字面量**（`'heyta.x'`）。拼出来的键（模板串、`'heyta.' + x`）扫不到 ——
 * 所以规矩是"新键必须写成字面量"。这一句同时写在文档 §1 末与 §4 末：
 * 一条看起来在检查全部的门禁比没有更糟（见 `docs/reference/environment-traps.md` #666）。
 *
 * ## 用法
 *
 *   node scripts/check-persistence-keys.mjs
 *   node scripts/check-persistence-keys.mjs --self-test
 *   HEYTA_CONTENT_ROOT=/tmp/x node scripts/check-persistence-keys.mjs
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.HEYTA_CONTENT_ROOT ?? join(HERE, '..');

const DOC = 'docs/reference/client-persistence-keys.md';
const SCAN_DIRS = ['apps/web/src', 'apps/mobile/src'];
const SCAN_GLOBS = ['packages'];
const KEY_RE = /'heyta\.[A-Za-z0-9._]+'/g;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-types', '.git', 'build', '.expo', 'coverage']);

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

/** 递归收集 `.ts` / `.tsx`（`packages/*` 只到 `src/`，不扫进 dist）。 */
function collect(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      collect(join(dir, e.name), out);
    } else if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.tsx'))) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

function scanSourceKeys() {
  const files = [];
  for (const rel of SCAN_DIRS) collect(join(REPO, rel), files);
  for (const pkgRoot of SCAN_GLOBS) {
    const root = join(REPO, pkgRoot);
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      if (name.startsWith('.')) continue;
      collect(join(root, name, 'src'), files);
    }
  }
  const found = new Map(); // key -> [文件相对路径]
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(KEY_RE)) {
      const key = m[0].slice(1, -1);
      const rel = relative(REPO, f);
      const list = found.get(key) ?? [];
      if (!list.includes(rel)) list.push(rel);
      found.set(key, list);
    }
  }
  return found;
}

/** 表里登记的键：表格行里**行首第一个 cell** 是反引号包起来的键。 */
function registeredKeys(docText) {
  const counts = new Map();
  const rows = [];
  for (const line of docText.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const m = /^`(heyta\.[A-Za-z0-9._]+)`$/.exec(cells[0]);
    if (!m) continue;
    const key = m[1];
    counts.set(key, (counts.get(key) ?? 0) + 1);
    rows.push({ key, section: cells[1] });
  }
  return { counts, rows };
}

function run(root) {
  const docPath = join(root, DOC);
  if (!existsSync(docPath)) fail(`🔴 读不到登记表 ${DOC} —— 表被删/改名了？判红而不是跳过。`);
  const docText = readFileSync(docPath, 'utf8');
  const { counts, rows } = registeredKeys(docText);
  if (rows.length === 0) fail('🔴 登记表里解析出 0 行键 —— 表格形状变了，先修扫描器，别当成"没有键"');

  const inSource = scanSourceKeys();
  if (inSource.size === 0) fail('🔴 源码里一个 heyta.* 键都没扫到 —— 扫描路径坏了，这条门禁在空转');

  const failures = [];

  // A：源码 → 表
  const missing = [...inSource.keys()].filter((k) => !counts.has(k)).sort();
  for (const k of missing) {
    failures.push(
      `断言 A：「${k}」在源码里（${(inSource.get(k) ?? []).join(', ')}）但**没登记**。\n` +
        '    到 docs/reference/client-persistence-keys.md 按 ADR-0085 选一档（A 表达 / B 视图状态 / C 本机数据 / D 基础设施）再写一行。',
    );
  }

  // B：表 → 源码
  const ghosts = [...counts.keys()].filter((k) => !inSource.has(k)).sort();
  for (const k of ghosts) {
    failures.push(`断言 B：「${k}」登记在表里，但源码里**没有**这个键（鬼键）。删了键要连表一起删。`);
  }

  // C：恰好一次
  for (const [k, n] of [...counts.entries()].sort()) {
    if (n > 1) failures.push(`断言 C：「${k}」登记了 ${n} 次。四档不许重叠 —— 同一档写两次也算重复。`);
  }

  if (failures.length > 0) {
    console.error('🔴 客户端持久化键登记表与源码不一致：\n');
    for (const f of failures) console.error(`  ${f}\n`);
    process.exit(1);
  }

  console.log(
    `✅ 持久化键登记表与源码一致：源码 ${inSource.size} 个键、表里 ${counts.size} 个键，逐个对应且各登记一次。`,
  );
}

/** 自检：三条臂各造一次违规，断言**该红的那条**真红（不是随便红）。 */
function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'pkeys-'));
  const build = () => {
    mkdirSync(join(tmp, 'apps/web/src'), { recursive: true });
    mkdirSync(join(tmp, 'docs/reference'), { recursive: true });
    writeFileSync(
      join(tmp, 'apps/web/src/a.ts'),
      "localStorage.setItem('heyta.alpha', '1');\nlocalStorage.setItem('heyta.beta', '2');\n",
    );
    writeFileSync(
      join(tmp, DOC),
      ['| 键 | 档 |', '|---|---|', '| `heyta.alpha` | A |', '| `heyta.beta` | D |', ''].join('\n'),
    );
  };
  const runChild = () => {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, HEYTA_CONTENT_ROOT: tmp },
      encoding: 'utf8',
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  const arms = [];
  build();
  arms.push({ name: '真实', expect: 0, got: runChild() });

  build();
  writeFileSync(
    join(tmp, 'apps/web/src/a.ts'),
    "localStorage.setItem('heyta.alpha', '1');\nlocalStorage.setItem('heyta.beta', '2');\nlocalStorage.setItem('heyta.gamma', '3');\n",
  );
  arms.push({ name: '臂1 源码多一个键不登记（应红断言 A）', expect: 1, got: runChild(), needle: '断言 A' });

  build();
  writeFileSync(
    join(tmp, DOC),
    ['| 键 | 档 |', '|---|---|', '| `heyta.alpha` | A |', '| `heyta.beta` | D |', '| `heyta.ghost` | A |', ''].join('\n'),
  );
  arms.push({ name: '臂2 表里多一个鬼键（应红断言 B）', expect: 1, got: runChild(), needle: '断言 B' });

  build();
  writeFileSync(
    join(tmp, DOC),
    ['| 键 | 档 |', '|---|---|', '| `heyta.alpha` | A |', '| `heyta.alpha` | C |', '| `heyta.beta` | D |', ''].join('\n'),
  );
  arms.push({ name: '臂3 同一个键登记两次（应红断言 C）', expect: 1, got: runChild(), needle: '断言 C' });

  rmSync(tmp, { recursive: true, force: true });

  let bad = 0;
  for (const a of arms) {
    const ok = a.got.code === a.expect && (a.needle === undefined || a.got.out.includes(a.needle));
    if (!ok) {
      bad += 1;
      console.error(`  ❌ ${a.name} —— 期望 rc=${a.expect}${a.needle ? ` 且含「${a.needle}」` : ''}，实得 rc=${a.got.code}`);
      console.error(String(a.got.out).trim().slice(0, 400));
    } else {
      console.log(`  ✅ ${a.name} → rc=${a.got.code}`);
    }
  }
  if (bad > 0) fail(`\n🔴 自检未通过（${bad}/${arms.length} 条臂不符合预期）。`);
  console.log(`\n✅ 自检通过：${arms.length} 条臂全部按预期。`);
}

// spawnSync 用在这里（自检要真起子进程），放末尾以免上面读起来被打断。
import { spawnSync } from 'node:child_process';

if (process.argv.includes('--self-test')) selfTest();
else run(REPO);
