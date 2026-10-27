#!/usr/bin/env node
/**
 * `check:scripts-parse` —— `scripts/**.mjs` 每一枚都要**解析得动**
 *
 * ## 它补的是哪一格
 *
 * 仓里 200 多枚 `.mjs` 工具，接进 `pnpm check` 的那一部分坏了会当场炸红；
 * **没接进去的那一大片**（`verify-*.mjs`、各条尺的 `--self-test` 之外的旁路工具、
 * 以及刻意不接链的线上尺）坏了没有任何一层会告诉你 —— 因为唯一会解析它们的时刻，
 * 是有人手动去跑它的那一刻。于是存在这样一种状态：**门禁自己坏着，而所有门是绿的**。
 *
 * 这一族在本仓已经咬过三次，形状每次都不一样：
 *   · 把一条含 `*` `/` 的命令抄进块注释 ⇒ 注释被提前关掉，整枚文件 parse 不过
 *     （e2e/live-site 那把线上尺坏过一整晚，见环境陷阱 #601/#603 那一族）；
 *   · 同一族第二形：hunk 里删了声明没删调用点 ⇒ 那个包的整批判据跑不到（#400）；
 *   · 2026-10-27 第三形：又是块注释里出现同一对字符，**而这次是门禁实现本身**。
 * 纪律已经写过一次，没挡住 ⇒ 按"同一手滑犯到第三次就下沉成会拒的命令"办。
 *
 * ## 判据
 *
 *  ① 树上每一枚 `scripts` 下递归的 `.mjs`（跳过 `node_modules` 与以 `.bak`/`.teeth-bak`/`.mut-bak`
 *     结尾的还原快照）逐枚 `node --check`；任何一枚 parse 不过 ⇒ 点名 + `exit 1`。
 *  ② **分母为空 ⇒ 判红**：一枚都没枚举到，说明 glob 或目录名改了，那是"体检根本没跑"，
 *     不是"全树都好"。这条是刻意的，它挡的正是本仓最熟的那种假绿。
 *  ③ 未知旗标一律拒（同一晚 `check-schema-migration-drift.mjs` 刚为静默吞旗标吃过一次，#605）。
 *
 * ## 用法
 *
 *   node scripts/check-scripts-parse.mjs              # 全树扫一遍
 *   node scripts/check-scripts-parse.mjs --self-test  # 四臂自检（每臂都要能失败）
 *   node scripts/check-scripts-parse.mjs --dir scripts --min 50   # 换目录 / 换分母下限
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const ALLOWED_FLAGS = ['--self-test', '--dir', '--min'];
const SKIP_SUFFIXES = ['.bak', '.teeth-bak', '.mut-bak', '.snap.bak'];

function parseArgs(argv) {
  const out = { selfTest: false, dir: 'scripts', min: 1 };
  const unknown = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--dir') out.dir = argv[++i];
    else if (a === '--min') out.min = Number.parseInt(argv[++i], 10);
    else if (a.startsWith('-')) unknown.push(a);
    else unknown.push(`多余的位置参数 ${a}`);
  }
  if (!Number.isFinite(out.min) || out.min < 1) unknown.push(`--min 要是 >=1 的整数（得到 ${out.min}）`);
  return { ...out, unknown };
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...walk(full));
    } else if (entry.name.endsWith('.mjs') && !SKIP_SUFFIXES.some((s) => entry.name.endsWith(s))) {
      out.push(full);
    }
  }
  return out;
}

/** 逐枚 parse。返回坏掉的那些（附第一行报错，方便一眼定位）。 */
function sweep(files, cwd = ROOT) {
  const broken = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { cwd, encoding: 'utf8' });
    if (r.status !== 0) {
      const first = String(r.stderr ?? '').split('\n').find((l) => l.trim() !== '') ?? '（无 stderr）';
      broken.push({ file: f, message: first.slice(0, 160) });
    }
  }
  return broken;
}

function selfTest() {
  const arms = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scripts-parse-selftest-'));
  try {
    fs.writeFileSync(path.join(dir, 'good.mjs'), 'export const a = 1;\n');
    // 故意造本族最常见的那一形：块注释里出现同一对字符，注释被提前关掉。
    fs.writeFileSync(path.join(dir, 'bad.mjs'), '/**\n * 见 packages/*/dist 那节\n */\nexport const a = 1;\n');

    const all = ['good.mjs', 'bad.mjs'];
    const broken = sweep(all, dir);
    arms.push({
      name: '① 坏的那枚必须被点名，好的不许被牵连',
      ok: broken.length === 1 && broken[0].file === 'bad.mjs',
      got: broken.map((b) => b.file),
    });
    const goodOnly = sweep(['good.mjs'], dir);
    arms.push({
      name: '② 全好的目录 ⇒ 零红（防"恒红"那种没用的判据）',
      ok: goodOnly.length === 0,
      got: goodOnly.map((b) => b.file),
    });
    arms.push({
      name: '③ 分母为空必须判红（枚举不到 ≠ 全树都好）',
      ok: emptyDenominator([], 1) !== null,
      got: emptyDenominator([], 1),
    });
    arms.push({
      name: '④ 未知旗标必须被拒 / 认的不许被当未知',
      ok:
        parseArgs(['--bogus']).unknown.length === 1 &&
        parseArgs(['--self-test', '--dir', 'tools', '--min', '9']).unknown.length === 0,
      got: [parseArgs(['--bogus']).unknown, parseArgs(['--self-test', '--dir', 'tools', '--min', '9']).unknown],
    });
    arms.push({
      name: '⑤ --min 是个坏数时不许静默放宽分母下限',
      ok: parseArgs(['--min', '0']).unknown.length === 1 && parseArgs(['--min', 'abc']).unknown.length === 1,
      got: [parseArgs(['--min', '0']).unknown, parseArgs(['--min', 'abc']).unknown],
    });
    void all;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const bad = arms.filter((a) => !a.ok);
  for (const a of arms) {
    console.log(`${a.ok ? '✅' : '🔴'} ${a.name}${a.ok ? '' : ` ｜ 得到 ${JSON.stringify(a.got)}`}`);
  }
  console.log(`臂数 ${arms.length} ｜ 不符 ${bad.length}`);
  process.exit(bad.length === 0 ? 0 : 1);
}

/** 分母判据：空集合或低于下限 ⇒ 返回一句理由（null = 通过）。 */
function emptyDenominator(files, min) {
  if (files.length === 0) return '一枚 .mjs 都没枚举到：glob、目录名或 --dir 改了，体检根本没跑';
  if (files.length < min) return `只枚举到 ${files.length} 枚，低于 --min ${min}：分母被缩小了，不能当"全树都好"`;
  return null;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.unknown.length > 0) {
  console.error(`🔴 未知旗标：${opts.unknown.join(' ')}`);
  console.error(`   这枚尺只认：${ALLOWED_FLAGS.join(' / ')}`);
  process.exit(1);
}
if (opts.selfTest) selfTest();

const target = path.join(ROOT, opts.dir);
if (!fs.existsSync(target)) {
  console.error(`🔴 要扫的目录不在场：${opts.dir}`);
  process.exit(1);
}
const files = walk(target).map((f) => path.relative(ROOT, f));
const reason = emptyDenominator(files, opts.min);
if (reason !== null) {
  console.error(`🔴 ${reason}`);
  process.exit(1);
}
const broken = sweep(files);
for (const b of broken) console.log(`🔴 parse 不过  ${b.file}\n     ${b.message}`);
console.log(
  `${broken.length === 0 ? '✅' : '🔴'} ${opts.dir} 逐枚 parse：枚举 ${files.length} 枚 ｜ 语法红 ${broken.length} 枚`,
);
process.exit(broken.length === 0 ? 0 : 1);
