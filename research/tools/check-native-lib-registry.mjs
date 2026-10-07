#!/usr/bin/env node
/**
 * 原生系统库许可登记册的**对账判据** —— 补上 `check:licenses` 射程外的那一整类。
 *
 * ## 它钉的是哪件事
 * `license-inventory.mjs` 扫的是实际安装的 **npm/NuGet 依赖树**。而 Linux 原生壳链的是
 * `pkg-config` 找到的**系统库**，`.deb` 的 `Depends` 写的是发行版包名 ——
 * 这些库既不在 package.json 里、也不在任何 lockfile 里，于是**一张登记表都没有**，
 * 而他们早就随 `.deb` 发出去了。本判据把「发出去的运行时依赖」与「登记过的行」双向钉死。
 *
 * ## 判据（缺一即红）
 *  ① `.deb` 的 `Depends` 里每一枚运行时包，登记册必须有一行；
 *  ② 登记册里每一行必须仍然在 `Depends` 里 —— **表只能跟着现实变小**，攒旧账算红
 *     （与 `check-image-license-coverage.mjs` 的 `IMAGE_ONLY_PACKAGES` 同一条设计）；
 *  ③ 锚点取不到（文件没了 / `DEPS="` 那行改名了 / 「## 表」那节没了 / 表里 0 行）⇒ **响亮失败**，
 *     不许读到空集再报"全部登记"。这一条挡的是 §7 里那个形状：
 *     "挂在文件名枚举上的门禁，目标文件被删时安静地不执行还照样打印通过"；
 *  ④ 许可列必须落在允许的词表里（宽松类，或 ADR-0057 那一类"系统运行时库的动态链接"）。
 *
 * ## 故障注入（`--self-test`，跑在临时目录的副本上，不动工作区）
 *   A0 原样                                      → 必须绿（阳性对照：证明判据真的读到了东西）
 *   A1 从登记册删掉一行                          → ①红
 *   A2 往 Depends 里加一枚未登记的包             → ①红（另一侧）
 *   A3 登记册留一行而 Depends 里拿掉它           → ②红（登记过期）
 *   A4 把 package-deb.sh 整个删掉                → ③红
 *   A5 把「## 表」那节掏空成 0 行                → ③红
 *   任一臂不如预期 ⇒ 本门禁自己判红。臂数由它自己打印，**文档里不许抄**。
 *
 * 用法：
 *   node research/tools/check-native-lib-registry.mjs            # 对账
 *   node research/tools/check-native-lib-registry.mjs --self-test
 *   --root <dir>  指到一份副本上跑（自检用）
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT =
  process.env.HEYTA_CHECK_ROOT === undefined
    ? resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    : resolve(process.env.HEYTA_CHECK_ROOT);

const DEB_SCRIPT = 'apps/desktop-linux/scripts/package-deb.sh';
const REGISTRY = 'docs/reference/native-library-licenses.md';

/**
 * 允许出现在登记册「许可」列的写法。
 *
 * 🔴 这里**不是**一张许可证白名单 —— 宽松类由 `license-policy.mjs` 管（那是唯一真源，
 * 本判据不重复它）。这一列只回答一个问题：**这行登记是否说清了它属于哪一类**。
 * `LGPL-2.1+` 出现在这里不构成放行 —— 放行的是 ADR-0057 那四条判定线
 * （不进产物 / 不改上游 / 不静态链 / 随发行版走），许可字符串只是它的标签。
 *
 * 🔴 **为什么是"取开头那一个标识符"而不是 `includes`**：登记册那一列现在必须逐字抄
 * 发行版 copyright 的聚合写法（GTK4 那格里同时出现 Apache-2.0 / BSD-3 / CC0，
 * JSC 那格里同时出现 LGPL-2.1+ 与 `GPL-2+ or LGPL-2.1+ or MPL-1.1`）。
 * 一次 `includes` 就能让一枚 GPL-only 的库**因为散文里提到了 BSD 而看起来是宽松的** ——
 * 而那恰好是这格唯一该拦的东西。所以：许可格必须以许可标识符开头，散文不作数（自检 A6/A7 各自钉一头）。
 */
const ACCEPTED_LICENSE_TOKENS = [
  /^public-domain$/i,
  /^MIT([-.\w]*)$/i,
  /^BSD([-.\w]*)$/i,
  /^Apache-2\.0([-.\w]*)$/i,
  /^LGPL-2\.1(\+|-or-later)?$/i, // 只作为"系统运行时库的动态链接"这一类的标签出现，见上面那段
];

/** 从「许可」那一格里取出**被声明的**那个标识符；取不到就返回空串（= 这行没说清属于哪一类）。 */
function licenseToken(cell) {
  const stripped = cell.replace(/\*\*/g, '').replace(/^[^\w-]+/, '');
  const m = /^([\w.+-]+)/.exec(stripped);
  return m === null ? '' : m[1];
}

function licenseAccepted(token) {
  if (token === '') return false;
  return ACCEPTED_LICENSE_TOKENS.some((re) => re.test(token));
}

function die(lines) {
  for (const l of lines) console.error(l);
  process.exitCode = 1;
  return false;
}

/** ③ 锚点：取不到就响亮失败，绝不返回空集当"没有依赖"。 */
function readAnchor(root, rel) {
  const p = join(root, rel);
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/** 从 package-deb.sh 里取 `Depends` 的那一枚默认值（`DEPS="a, b, c"`）。 */
export function debDepends(root) {
  const src = readAnchor(root, DEB_SCRIPT);
  if (src === null) return { error: `锚点取不到：${DEB_SCRIPT}（.deb 的 Depends 是这条判据的输入，读不到就判红，不按"没有依赖"处理）` };
  const m = /DEPS="([^"]+)"/.exec(src);
  if (!m) return { error: `${DEB_SCRIPT} 里找不到 DEPS="…" 那一行 —— 判据的锚点改了名，这条对账已经不再检查任何东西。` };
  const pkgs = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (pkgs.length === 0) return { error: `${DEB_SCRIPT} 的 DEPS 解析出来是空的 ⇒ 探针读到了空集，不能当"全部登记"。` };
  return { pkgs };
}

/** 从登记册的「## 表」那节取每一行的（运行时包名, 许可列）。 */
export function registryRows(root) {
  const src = readAnchor(root, REGISTRY);
  if (src === null) return { error: `锚点取不到：${REGISTRY}` };
  const section = src.split('\n## 表\n')[1];
  if (section === undefined) return { error: `${REGISTRY} 里没有「## 表」这一节 —— 判据读不到表，不放行。` };
  const rows = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .slice(1, line.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((s) => s.trim());
    if (cells.length < 5) continue;
    if (/^-+$/.test(cells[0].replace(/\s/g, '')) || cells[0] === '运行时包名') continue;
    if (cells[0] === '' || cells[0].includes('项')) continue; // 「还没进这张表的」那种表头
    rows.push({ pkg: cells[0], license: cells[3] });
  }
  if (rows.length === 0) return { error: `${REGISTRY} 的「## 表」里解析出 0 行 ⇒ 表被掏空了，而"0 行"念起来最像"干净"。` };
  return { rows };
}

export function check(root = ROOT) {
  const depends = debDepends(root);
  if (depends.error) return die([`❌ ${depends.error}`]);
  const reg = registryRows(root);
  if (reg.error) return die([`❌ ${reg.error}`]);

  const problems = [];
  const registered = new Set(reg.rows.map((r) => r.pkg));
  const shipped = new Set(depends.pkgs);

  // ① 发出去的每一枚都必须登记
  for (const p of depends.pkgs) {
    if (!registered.has(p)) {
      problems.push(
        `❌ .deb 的 Depends 里有 ${p}，但登记册没有这一行 —— 它已经随包发出去了，却没有任何一处写过它的许可与裁决。`,
      );
    }
  }
  // ② 登记的每一枚都必须仍然在发（表只能跟着现实变小）
  for (const r of reg.rows) {
    if (!shipped.has(r.pkg)) {
      problems.push(
        `❌ 登记册里那行 ${r.pkg} 已经不再出现在 Depends —— 登记过期。删掉它，或把现实改回它描述的样子；攒旧账的登记表比没有表更危险。`,
      );
    }
    // ④ 许可那一列必须**以许可标识符开头**，把类别说清（散文里提到别的许可不作数）
    const token = licenseToken(r.license);
    if (!licenseAccepted(token)) {
      problems.push(
        `❌ 登记册里 ${r.pkg} 的「许可」列没有说清它属于哪一类（取到的开头标识符 = ${JSON.stringify(token)}；整格 = ${JSON.stringify(r.license.slice(0, 80))}）。` +
          `\n    这一格必须以 public-domain / MIT / BSD-* / Apache-2.0 / LGPL-2.1(+) 之一**开头**；` +
          `LGPL-2.1+ 只在这四条判定线成立时才是这一类，其余 copyleft（GPL-only、AGPL、SSPL…）一律不许出现在这一列。`,
      );
    }
  }

  if (problems.length > 0) return die(problems);

  console.log(
    `✅ 原生系统库登记对账通过：Depends ${depends.pkgs.length} 枚 ↔ 登记 ${reg.rows.length} 行，逐枚带许可与实测出处。`,
  );
  console.log(`   登记的库：${depends.pkgs.join(' · ')}`);
  return true;
}

/* ─────────────────────────── 自检（故障注入） ─────────────────────────── */

const FIXTURE_FILES = [DEB_SCRIPT, REGISTRY];

/**
 * 在工作区外的一枚临时副本上跑一臂：`mutate = null` 是原样，
 * 否则 `{ target, apply }`（改文本）或 `{ target, drop: true }`（删文件）。
 * 🔴 只动临时目录 —— 自检不许碰工作树（本仓共享检出，别人正在写）。
 */
function fixture(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-native-reg-'));
  let applied = mutate ? Boolean(mutate.drop) : true;
  for (const rel of FIXTURE_FILES) {
    if (mutate?.drop && rel === mutate.target) continue;
    const original = readFileSync(join(ROOT, rel), 'utf8');
    let body = original;
    if (mutate && rel === mutate.target) {
      body = mutate.apply(original);
      // 🔴 变异臂的前置条件：变异体必须真的不等于原体。
      // 不等于这条不成立时，那一臂测的是"原样必须红"，读数会一路骗人。
      if (body !== original) applied = true;
    }
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return { dir, applied };
}

function runMutant(mutate) {
  const { dir, applied } = fixture(mutate);
  const prev = process.exitCode;
  process.exitCode = 0;
  const out = [];
  const write = console.error.bind(console);
  console.error = (...a) => out.push(a.join(' '));
  let ok;
  try {
    ok = check(dir);
  } finally {
    console.error = write;
    rmSync(dir, { recursive: true, force: true });
  }
  const rc = process.exitCode;
  process.exitCode = prev;
  // 变异没生效 ⇒ 这一臂根本没有测任何东西，直接判它不通过（而不是拿"原体也红"当读数）。
  if (mutate && !mutate.drop && !applied) return { ok, rc: -1, log: '变异体等于原体：这一臂没有生效' };
  return { ok, rc, log: out.join('\n') };
}

async function selfTest() {
  const arms = [];
  // A0 阳性对照：原样必须绿，而且必须真的读到非空集（否则后面几臂的"绿"没有意义）
  const a0 = runMutant(null);
  arms.push(['A0 原样必须绿', a0.ok === true && a0.rc === 0]);
  // A1 删掉登记册里的一行 ⇒ ① 红
  const a1 = runMutant({
    target: REGISTRY,
    apply: (s) => s.replace(/^\| libgtk-4-1.*$/m, ''),
  });
  arms.push(['A1 删掉一行登记 ⇒ 红', a1.rc === 1]);
  // A2 Depends 多出一枚未登记的 ⇒ ① 红
  const a2 = runMutant({
    target: DEB_SCRIPT,
    apply: (s) => s.replace('DEPS="libgtk-4-1', 'DEPS="libgweather-4-0, libgtk-4-1'),
  });
  arms.push(['A2 未登记的运行时包 ⇒ 红', a2.rc === 1]);
  // A3 登记留着而 Depends 拿掉 ⇒ ② 红（登记过期）
  const a3 = runMutant({
    target: DEB_SCRIPT,
    apply: (s) => s.replace(', libsqlite3-0', ''),
  });
  arms.push(['A3 登记过期 ⇒ 红', a3.rc === 1]);
  // A4 锚点文件整个没了 ⇒ ③ 响亮失败（不许空集当通过）
  const a4 = runMutant({ target: DEB_SCRIPT, drop: true, apply: (s) => s });
  arms.push(['A4 锚点文件缺失 ⇒ 响亮失败', a4.rc === 1]);
  // A5 表被掏空 ⇒ ③ 响亮失败
  const a5 = runMutant({
    target: REGISTRY,
    apply: (s) => s.replace(/^\| lib.*$/gm, ''),
  });
  arms.push(['A5 表被掏空 ⇒ 响亮失败', a5.rc === 1]);
  // A6 把 GTK4 那行的许可**开头标识符**换成 GPL-3+，而散文里 Apache-2.0 / BSD-3 / CC0 一个字没动
  //    ⇒ ④ 必须红。这一臂是"散文不作数"的正面证据：旧写法（`includes`）在这里会**照样绿**。
  const a6 = runMutant({
    target: REGISTRY,
    apply: (s) => s.replace(/^(\| libgtk-4-1.*)$/m, (line) => line.replace('**LGPL-2.1+**', '**GPL-3+**')),
  });
  arms.push(['A6 许可列开头改成 GPL-3+（散文仍含宽松名）⇒ 红', a6.rc === 1]);
  // A7 把 sqlite 那行的许可列写成没有标识符的散文 ⇒ ④ 红（"这行没说清属于哪一类"）
  const a7 = runMutant({
    target: REGISTRY,
    apply: (s) => s.replace('| public-domain（该机', '| 见上游说明（该机'),
  });
  arms.push(['A7 许可列没有可取的标识符 ⇒ 红', a7.rc === 1]);

  let bad = 0;
  for (const [name, pass] of arms) {
    console.log(`  ${pass ? '✅' : '🔴'} ${name}`);
    if (!pass) bad++;
  }
  console.log(`\n自检 ${arms.length} 臂，不如预期 ${bad} 臂。`);
  if (bad > 0) {
    console.error('❌ 本门禁的自检有臂不如预期 —— 不能失败的检查没有价值。');
    process.exit(1);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  if (process.argv.includes('--self-test')) await selfTest();
  else process.exit(check() ? 0 : 1);
}
