#!/usr/bin/env node
/**
 * `check:selfhost-entry-command` —— 自托管**入口命令的抄件**必须仍然能一件事做完。
 *
 * ═══════════════════════════════════════════════════════════════════
 * 这条门禁判的是哪句话
 * ═══════════════════════════════════════════════════════════════════
 *
 * 「外人照抄文档里那条 `docker compose` 就能起全套并且迁移跑过」。
 * 这句话有**多个抄件**（中文指南、server/README、内部验收手册），而抄件的漂法是固定的：
 * 改一处、忘另一处，两边各自看起来都自洽。2026-10-03 实测就是这里漂的 ——
 * 指南 §4 印的那条少了 `docker-compose.build.yml`，陌生人照抄得到的是
 * `pull access denied for supersync, repository does not exist or may require 'docker login'`
 * （我们根本没有仓库，那句提示把人引向"去找登录凭据"）。
 * 记录在 `docs/research/self-host-distribution-audit.md` §8.11。
 *
 * ## 🔴 为什么它是一道**纯文件系统**门禁，而不是验收脚本里的一段
 *
 * 这段判断原先只活在 `scripts/verify-selfhost-stack.sh` 里，而那条命令要 docker +
 * 要起栈 ⇒ 没有 docker 的机器与 CI 上**等于没有判据**：漂了没人红，直到某个外人踩坑。
 * 本文件是这件事的唯一所有者（纯读文件、不依赖 docker、不依赖网络、不依赖构建产物）。
 * `verify-selfhost-stack.sh` 改为**调用本文件**，不留第二份实现 ——
 * 同一个判断抄三遍正是本仓反复踩过的坑（AGENTS §3.5 的教训、§7 里同类条目）。
 *
 * ## 判据（任何一条红都要点名到**哪个文件哪一行**）
 *
 *  R0 折行本身是完整的：命令以反斜杠结尾却没有续行 ⇒ 红（否则后面所有判据都只读到半条）。
 *  R1 每一条命中的入口命令都带 `docker-compose.build.yml`（**所有**扫描文件，逐行）。
 *  R2 每一条 `-f` 指向的文件在 `server/` 下真的存在（改名/typo 也在这里现形）。
 *  R3 对外文档（指南 + server/README）的每一条都带 `docker-compose.migrate-once.yml`
 *     —— 省掉它的形状是"起了但未迁移、而容器全绿"。
 *  R4 对外文档里**点名服务**的那一条必须把 `supersync-migrate` 一起点出来。
 *     点名服务不等于可以省 override：`up -d postgres supersync` 那种写法根本不会
 *     跑那条一次性迁移（compose 不会重跑一个已退出的 `restart:"no"` 服务）。
 *  R5 每个对外文档**恰好一条**"不点名服务"的主命令，且这些主命令**逐字相同**，
 *     且其 `-f` 集合恰好是 {yml, build, migrate-once}、且带 `--build`。
 *     「只比集合」会把"一份带 --build、一份不带"读成绿，所以逐字比。
 *  R6 非空哨兵：每个对外文档**至少命中一条**。命中数为 0 时这条判据会静默空转 ——
 *     原先那段就是这样坏的（命令被改名/换行/删掉 ⇒ 对账读不到东西 ⇒ 绿）。
 *
 * ## 内部文件（`local-server-verification.md`）只受 R1/R2 管，为什么
 *
 * 那一套是**本地验收夹具**：它点名的是 `postgres supersync` 两个服务、
 * 带的是 `docker-compose.test.yml`，迁移由该手册自己的步骤负责。把 R3/R4 套上去
 * 是**假红**（它在判另一件事）。它进扫描集的理由是 R1：那里的三条命令同样是抄件，
 * 漂掉 build override 会得到同一个 `pull access denied`。
 *
 * ## 🔴 显式排除：`docs/research/self-host-distribution-audit.md`
 *
 * 该文件 §8.11 引用的是**出事当时的旧命令**（它写的就是"这条曾经少了 build.yml"）。
 * 把它纳入扫描集会逼着后来人**改历史记录**才能变绿 —— 那类"为了让门禁绿而改写事故
 * 现场"的动作比少一条判据更糟。所以排除，而且排除本身带**承重断言**（见 EXCLUDES）：
 * 那个文件里必须真的存在会被 R1 判红的行，否则这条排除已经不需要了，报红要求删掉它。
 * 「永远用不上的豁免」和「永远通过的判据」是同一类东西。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BUILD_OVERRIDE = 'docker-compose.build.yml';
const MIGRATE_OVERRIDE = 'docker-compose.migrate-once.yml';
const MIGRATOR_SERVICE = 'supersync-migrate';
/** 入口命令的行首形状：`docker compose -f docker-compose.yml …`（允许 markdown 缩进）。 */
const ENTRY_RE = /^[ \t]*docker compose -f docker-compose\.yml(?![A-Za-z0-9._-])/;

/**
 * 扫描集。**逐文件写清它是谁的抄件**，因为"漏一份"就是这道门禁要防的形状本身。
 * `external: true` ⇒ 受 R3/R4/R5 管（那是对外承诺"一条命令起全套"的载体）。
 */
const SCAN_SET = [
  { file: 'docs/runbooks/self-host.md', external: true, role: '对外中文自托管指南（§4 入口 + §6 点名服务）' },
  { file: 'server/README.md', external: true, role: '对外 README —— 同一条入口命令的第二份抄件' },
  { file: 'server/env.example', external: false, role: '配置样例里的抄件（当前 0 条，加一条就被判）' },
  { file: 'server/docker-compose.migrate-once.yml', external: false, role: 'override 文件自己的注释里印入口命令' },
  { file: 'docs/runbooks/local-server-verification.md', external: false, role: '内部本地验收手册（test override 那一套）' },
];

/**
 * 显式排除项 + 理由。**每一条都是承重的**：`loadBearing` 断言不成立 ⇒ 红，
 * 于是豁免不会在现实变化后变成一条静默的漏洞。
 */
const EXCLUDES = [
  {
    file: 'docs/research/self-host-distribution-audit.md',
    reason:
      '审计报告引用的是**出事当时**的旧命令（它记的就是"这条曾经少了 build.yml"）。' +
      '纳入扫描集等于逼后来人为了变绿而改写历史现场 —— 那比少一条判据更糟。',
    loadBearing: '该文件里必须至少有一条会被 R1 判红的行；没有就说明这条豁免已经不需要了，删掉它',
  },
];

const failures = [];
const notes = [];
/** 每个对外文档里"不点名服务"的那条主命令；跨文件做逐字比对用（R5）。 */
const EXTERNAL_MAINS = [];
const red = (file, line, rule, msg, cmd) => {
  failures.push(`${file}${line ? `:${line}` : ''}  [${rule}]\n      ${msg}${cmd ? `\n      实测该行：${cmd}` : ''}`);
};

/**
 * 把 markdown 里被反斜杠折行的命令折回**一条逻辑行**。
 * 🔴 必须自己折：`grep '^docker compose'` 只看物理行，续行上的 `-f x.yml` 会掉到
 * 下一行去 —— 于是症状是"文档少了 override"，而真正坏的是探针没把行读全
 * （这一段是从 `verify-selfhost-stack.sh` 里 BSD sed 那次的实测教训搬过来的）。
 */
function findEntryCommands(file, text) {
  const physical = text.split('\n');
  const found = [];
  for (let i = 0; i < physical.length; i += 1) {
    if (!ENTRY_RE.test(physical[i])) continue;
    let line = physical[i];
    const startLine = i + 1;
    while (/\\\s*$/.test(line)) {
      const next = physical[i + 1];
      if (next === undefined) {
        red(file, startLine, 'R0', '命令以反斜杠结尾但后面没有续行了（折行断在文件末尾）', line.trim());
        break;
      }
      i += 1;
      line = `${line.replace(/\\\s*$/, '')} ${next}`;
    }
    found.push({ line: line.replace(/\s+/g, ' ').trim(), startLine });
  }
  return found;
}

/** 拆 `-f x.yml` / flags / 动词 / 点名的服务。读不出来就返回 null 并判红。 */
function parseCompose(cmd) {
  const t = cmd.split(' ');
  const files = [];
  const flags = [];
  const rest = [];
  for (let i = 2; i < t.length; i += 1) {
    const tok = t[i];
    if (tok === '-f' || tok === '--file') {
      const v = t[i + 1];
      if (v === undefined) return { malformed: '-f 后面没有文件名' };
      files.push(v);
      i += 1;
      continue;
    }
    if (tok.startsWith('--file=')) {
      files.push(tok.slice('--file='.length));
      continue;
    }
    if (tok.startsWith('-')) {
      flags.push(tok);
      continue;
    }
    rest.push(tok);
  }
  return { files, flags, verb: rest[0] || '', services: rest.slice(1) };
}

let TOTAL_MATCHES = 0;

for (const entry of SCAN_SET) {
  const abs = join(repoRoot, entry.file);
  if (!existsSync(abs)) {
    // 扫描集本身就是事实源之一：文件没了就是漂移，不能"读不到就算过"。
    red(entry.file, null, 'R-scan', '扫描集里登记的文件不存在 —— 清单与现实漂移了。它被改名/删除，这道门禁就少了一个抄件要管');
    continue;
  }
  const matches = findEntryCommands(entry.file, readFileSync(abs, 'utf8'));
  TOTAL_MATCHES += matches.length;
  notes.push(`${entry.file}：命中 ${matches.length} 条入口命令（${entry.role}）`);

  if (entry.external && matches.length === 0) {
    red(entry.file, null, 'R6', '这条判据读不到任何入口命令 —— 它被改名、换了前缀或删掉了。空集合不是"通过"，是**探针瞎了**');
    continue;
  }

  const mains = [];
  for (const m of matches) {
    const parsed = parseCompose(m.line);
    if (parsed.malformed) {
      red(entry.file, m.startLine, 'R2', `这条命令读不开：${parsed.malformed}`, m.line);
      continue;
    }
    const { files, flags, services } = parsed;

    // ── R1：build override（所有扫描文件，逐行）────────────────────
    if (!files.includes(BUILD_OVERRIDE)) {
      red(entry.file, m.startLine, 'R1', `少了 ${BUILD_OVERRIDE} ⇒ 照抄的人手里没有镜像可拉（我们不发布镜像，默认 image 是 supersync:local），实测报 pull access denied`, m.line);
    }

    // ── R2：每一个 -f 指向的文件必须真的存在 ───────────────────────
    for (const f of files) {
      if (!existsSync(join(repoRoot, 'server', f))) {
        red(entry.file, m.startLine, 'R2', `-f ${f} 在 server/ 下不存在 —— override 文件被改名或删了，而抄件还留着旧名字`, m.line);
      }
    }

    // ── R3：对外文档的每一份都要带一次性迁移 override ──────────────
    if (entry.external && !files.includes(MIGRATE_OVERRIDE)) {
      red(entry.file, m.startLine, 'R3', `少了 ${MIGRATE_OVERRIDE} ⇒ 裸起在未迁移的表结构上（症状：日志一片 column does not exist 而容器全绿）`, m.line);
    }

    // ── R4：点名服务就必须把 migrator 一起点出来 ───────────────────
    if (entry.external && services.length > 0 && !services.includes(MIGRATOR_SERVICE)) {
      red(entry.file, m.startLine, 'R4', `点名了服务（${services.join(' ')}）却没点 ${MIGRATOR_SERVICE} ⇒ 那条一次性迁移服务根本不会被拉起，空库上"起得来"是假可用`, m.line);
    }

    if (entry.external && services.length === 0) mains.push(m);
  }

  if (!entry.external) continue;

  // ── R5：主命令**恰好一条**，且逐字相同、-f 集合与 --build 钉死 ─────
  if (mains.length !== 1) {
    red(
      entry.file,
      mains.map((m) => m.startLine).join(' / ') || '—',
      'R5',
      mains.length === 0
        ? '这份对外文档里**没有**"不点名服务"的主命令（§4 那条起全套的入口）。它被删了、改名了，或被写成只点名服务的样子 —— 外人就没有"一条命令起全套"可抄'
        : `这个对外文档里有 ${mains.length} 条"不点名服务"的入口命令（第 ${mains.map((m) => m.startLine).join(' / ')} 行）—— 主命令应当**恰好一条**。多出来的那条通常是"从主命令抄一半"漂出来的`,
      '',
    );
  }
  if (mains.length === 1) EXTERNAL_MAINS.push({ file: entry.file, line: mains[0].startLine, cmd: mains[0].line });

  for (const m of mains) {
    const { files, flags } = parseCompose(m.line);
    const set = [...new Set(files)].sort().join(' ');
    const expect = [BUILD_OVERRIDE, MIGRATE_OVERRIDE, 'docker-compose.yml'].sort().join(' ');
    if (set !== expect) {
      red(entry.file, m.startLine, 'R5', `主命令带的 compose 文件是「${set}」，应当恰好是「${expect}」`, m.line);
    }
    if (!flags.includes('--build')) {
      red(entry.file, m.startLine, 'R5', '主命令没有 --build：镜像不会由这条命令自己产出，第一次跑仍然起不来', m.line);
    }
  }
}

// R5 的跨文件部分：两份对外文档的那条主命令必须**逐字相同**。
const distinct = [...new Set(EXTERNAL_MAINS.map((m) => m.cmd))];
if (EXTERNAL_MAINS.length >= 2 && distinct.length > 1) {
  red(
    EXTERNAL_MAINS.map((m) => `${m.file}:${m.line}`).join(' + '),
    null,
    'R5',
    `两份对外文档的入口命令已经漂开（实测 ${distinct.length} 个不同版本）：\n${distinct.map((c) => `        · ${c}`).join('\n')}\n      它俩是同一句话的抄件，只该有一份内容`,
    '',
  );
}

// ── 豁免的承重断言：排除必须"确有其事"，不能变成静默漏洞 ────────────
for (const ex of EXCLUDES) {
  const abs = join(repoRoot, ex.file);
  if (!existsSync(abs)) {
    red(ex.file, null, 'R-excl', `排除项登记的文件不存在了 —— 这条豁免没有对象，删掉它`);
    continue;
  }
  const matches = findEntryCommands(ex.file, readFileSync(abs, 'utf8'));
  const wouldFailR1 = matches.filter((m) => !(parseCompose(m.line).files || []).includes(BUILD_OVERRIDE));
  if (wouldFailR1.length === 0) {
    red(
      ex.file,
      null,
      'R-excl',
      `排除已不再承重：这里 ${matches.length} 条入口命令如今全都带 ${BUILD_OVERRIDE}，纳入扫描集不会再判红历史。${ex.loadBearing}`,
      '',
    );
  } else {
    notes.push(`${ex.file}：**故意排除** ${matches.length} 条（其中 ${wouldFailR1.length} 条会被 R1 判红，正是 §8.11 记的那条旧命令）。理由：${ex.reason}`);
  }
}

if (failures.length > 0) {
  console.error(`❌ 自托管入口命令对账失败（${failures.length} 处）：`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error('\n   入口命令有**多份抄件**，改一处必须改全部；判据的原文在本文件头部。');
  console.error('   只读文件就能跑：node scripts/check-selfhost-entry-command.mjs（不需要 docker / 网络）');
  process.exit(1);
}

const total = TOTAL_MATCHES;
console.log(`✅ 自托管入口命令对账：扫描集 ${SCAN_SET.length} 份文件 + 故意排除 ${EXCLUDES.length} 份，命中 ${total} 条入口命令，逐行过了 R1–R6`);
for (const n of notes) console.log(`   · ${n}`);
