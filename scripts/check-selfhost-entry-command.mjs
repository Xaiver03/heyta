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
 *  R7 🔴 **验收载体**（`scripts/verify-selfhost-stack.sh` 的 `COMPOSE_FILES`）的 `-f` 集合
 *     必须与对外主命令的**逐字相同**。这条 2026-10-04 才加，因为原先这里没有判据：
 *     脚本自己有一段 `[ "$SCRIPT_ENTRY_FILES" = "…两份…" ]`，它把**当时的形状**写死成
 *     期望值 —— 那不是判据，是快照：脚本再漂一次（只要漂成同一个值）它就跟着一起漂。
 *     期望值必须由**被验的那句话**导出，不能由抄件自己导出。
 *  R8 🔴 **漏登记哨兵**（2026-10-05 加）：全仓凡出现「`docker compose` … `docker-compose.build.yml`」
 *     这个形状的**文本**跟踪文件，必须落在 SCAN_SET（按抄件判）/ EXCLUDES（豁免且承重）/
 *     NON_COPIES（不是抄件，逐份写凭什么不是）三张表之一。R1–R7 只管登记过的抄件，
 *     新抄件不登记就**一条都不红**。两个方向都会红：多出来没人管的红，登记的豁免读不到
 *     那个形状了也红；分母读不出来（git 不在/非仓库/git grep 空）响亮地红，不按"没有漏"过。
 *     射程边界写进输出的那条 note 里：`git grep -I` 跳过二进制 ⇒ **图片里印的文案不在这里**
 *     （那是 G-58，走 `screenshot:capture` 重打，属于已登记边界，不是静默漏洞）。
 *  R9 🔴 **链外真跑验收的消费方点名**（2026-10-05 加，G-61 的①档）：`pnpm verify:selfhost-stack`
 *     是"真镜像 + 真服务端 + 真浏览器"唯一那一趟，而它刻意不在 `pnpm check` 链里（要 docker、
 *     自带负载门）。G-48 那套机制在这里复用：消费方文档必须有一行**以这条命令开头**、
 *     且触发条件那句还在；同时**前提本身是判据**（哪天真挂进链里，这条判据就永远不可能命中 ⇒
 *     响亮地红，要人换形或删）。边界照 G-48b：R9 钉的是义务写在哪儿，不是义务被执行过。
 *
 * ## 🔴 R7 抓到的那个洞（为什么"脚本自己打镜像"不是省掉 build override 的理由）
 *
 * 脚本里那句注释写的是「它和文档 §4 的差集应当恰好是 `docker-compose.build.yml` ——
 * **因为脚本自己 docker build**」。实测否证：`docker compose config`（不需要 daemon）
 * 在带与不带 `docker-compose.build.yml` 两种解析下，`image:` 都解析成
 * `supersync:selfhost-verify`（三个文件写的是同一个 `${SUPERSYNC_IMAGE:-supersync:local}`），
 * 而 compose 没有 `--build` 就**不会**因为存在 `build:` 段去重建。
 * ⇒ 省掉它的收益是 0。省掉它的代价却藏在环境里：`docker-compose.build.yml:34` 给
 * `supersync` 注了 `MIGRATE_RECOVERY_BUILD_LOCAL=true`，它是
 * `server/scripts/migrate-deploy.sh:239` 那个分支的**唯一开关**，决定 CONCURRENTLY
 * 失败后打印的那条带外恢复命令里有没有 `-f docker-compose.build.yml`。
 * 也就是说：外人照文档拿到的是**带 build.yml 的那一支**，而验收跑的是**另一支** ——
 * 栈全绿也不构成那一支的证据。这与 §8.11 记的是同一族（"把自己要验的默认值换掉了"），
 * 只是这次换的是 env 而不是镜像 tag。
 *
 * ## 内部文件（`local-server-verification.md`）只受 R1/R2 管，为什么
 *
 * 那一套是**本地验收夹具**：它点名的是 `postgres supersync` 两个服务、
 * 带的是 `docker-compose.test.yml`，迁移由该手册自己的步骤负责。把 R3/R4 套上去
 * 是**假红**（它在判另一件事）。它进扫描集的理由是 R1：那里的三条命令同样是抄件，
 * 漂掉 build override 会得到同一个 `pull access denied`。
 *
 * ## 🔴 两种来源：markdown 与站内词条（`source: 'copy'`）
 *
 * `docs/runbooks/self-host.md` 与 `server/README.md` 是给人打开的文件，命令住在**行首**；
 * 而站内那篇自建指南（`packages/i18n` 的 `site.docs.selfhost.*`，中英各一份）是
 * **落地页「打开自建指南」真的点进去的那一页**，命令住在散文中间的反引号里。
 * 它 2026-10-03 才进扫描集，且进来之前先改了一件事：当时 s7p2 只有
 * `-f docker-compose.yml -f docker-compose.build.yml -f docker-compose.migrate-once.yml`
 * 这个**碎片**（没前缀、没 `up -d`、没 `--build`）—— 直接纳入只会得到一条
 * "扫了但什么都看不见"的空判据。先让文章给出完整一条，再纳入对账，顺序不能反。
 * 词条侧走 `findCopyEntryCommands`（不折行，因为词条值是单行的），
 * 命令形状仍从同一个 `ENTRY_BODY` 导出 —— **不抄第二份正则**。
 * 报错定位带键名（`行号 · site.docs.selfhost.s7p2`），只给行号等于让人在 2841 行里猜。
 * 两份词条都标 `external: true` ⇒ 受 R1–R6 与 R5 的**跨抄件逐字比对**管，
 * 于是中英两份 + runbook + README 这四份现在必须是同一句话。
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
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* 🔴 `--repo-root <路径>`：把"仓库根"换成另一棵树。真实消费者**不带**它（默认就是本文件所在的仓库），
 *    它存在的唯一理由是让变异臂能拿一棵假树去测 R9 那条**前提判据**（"命令已经在链里"这一档
 *    只能靠改 `package.json` 才能成立，而那是不该被一次测试动的文件）。
 *    零参自锚的函数传实参会被静默丢弃（AGENTS §7 同族），所以这里把根显式打出来。 */
const ARG_ROOT = (() => {
  const i = process.argv.indexOf('--repo-root');
  return i > 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : null;
})();
const repoRoot = ARG_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (ARG_ROOT) process.stdout.write(`R9 变体载体：repoRoot=${repoRoot}（不是本文件所在的仓库）\n`);


const BUILD_OVERRIDE = 'docker-compose.build.yml';
const MIGRATE_OVERRIDE = 'docker-compose.migrate-once.yml';
const MIGRATOR_SERVICE = 'supersync-migrate';
/**
 * 入口命令的形状。🔴 只写一次，两种锚法从同一个 body 导出：
 *  - markdown：`ENTRY_RE` 要求**行首**（允许缩进）；
 *  - 站内词条：`ENTRY_BODY` 不带行首锚 —— 命令住在散文中间的反引号里。
 * 把同一段 pattern 抄两遍正是本仓反复出事的地方（AGENTS §3.5 的教训）。
 */
const ENTRY_BODY = 'docker compose -f docker-compose\\.yml(?![A-Za-z0-9._-])';
/** 入口命令的行首形状：`docker compose -f docker-compose.yml …`（允许 markdown 缩进）。 */
const ENTRY_RE = new RegExp(`^[ \\t]*${ENTRY_BODY}`);

/** 站内自建指南文章的词条前缀。 */
const SELF_HOST_COPY_PREFIX = 'site.docs.selfhost.';

/** 🔴 R7 的载体：那条要起真栈的验收脚本本身（见文件头 R7 那一节）。 */
const HARNESS_FILE = 'scripts/verify-selfhost-stack.sh';

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
  // 🔴 这两份是 2026-10-03 才加进来的**第四个和第五个抄件**，加它的理由见下面 findCopyEntryCommands 的头。
  { file: 'packages/i18n/src/locales/zh-CN.ts', external: true, source: 'copy', keyPrefix: SELF_HOST_COPY_PREFIX, role: '站内自建指南文章（中文）—— 落地页「打开自建指南」点进来就是它' },
  { file: 'packages/i18n/src/locales/en.ts', external: true, source: 'copy', keyPrefix: SELF_HOST_COPY_PREFIX, role: '站内自建指南文章（英文）—— 与中文那份是同一条命令的两种语言' },
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
/** 报错定位：词条抄件要带**键名**，只给行号等于让人在 2841 行里猜。 */
const where = (m) => (m.key ? `${m.startLine} · ${m.key}` : m.startLine);

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

/**
 * 从词条值里取入口命令。
 *
 * 🔴 为什么这两份抄件 2026-10-03 才进来，以及 G-49 原登记哪里说错了：
 * 登记写"文章是入口命令的第 4 份抄件"，实测**当时它不是抄件** —— 58 条
 * `site.docs.selfhost.*` 里唯一提到 compose 的那条（s7p2）只印了 `-f` 那三个 flag 的
 * **碎片**：没有 `docker compose` 前缀、没有 `up -d`、也**没有 `--build`**。
 * 而那比"没抄件"更坏：读者把碎片拼成 `docker compose … up -d` 敲下去，
 * 得到的正是 §8.11 记的那次 `pull access denied`。
 * ⇒ 所以这一步做两件事：文章改成给出**完整一条**（与 runbook / README 逐字相同），
 *   并从这里起受 R1–R6 与跨抄件逐字比对管。词条值是单行的，不需要 R0 的折行拼接。
 */
function findCopyEntryCommands(file, text, keyPrefix) {
  const physical = text.split('\n');
  const keyRe = new RegExp(
    `^\\s*'(${keyPrefix.replace(/\./g, '\\.')}[^']*)'\\s*:\\s*'(.*)',\\s*$`,
  );
  const cmdRe = new RegExp(`^${ENTRY_BODY}`);
  const found = [];
  for (let i = 0; i < physical.length; i += 1) {
    const m = physical[i].match(keyRe);
    if (!m) continue;
    for (const span of m[2].matchAll(/`([^`]+)`/g)) {
      const cmd = span[1].replace(/\s+/g, ' ').trim();
      if (!cmdRe.test(cmd)) continue;
      found.push({ line: cmd, startLine: i + 1, key: m[1] });
    }
  }
  return found;
}

/**
 * 从验收脚本里读 `COMPOSE_FILES=(…)` 这个数组的 `-f` 集合（R7）。
 *
 * 🔴 为什么读**数组**而不是读那条 `docker compose … up` 命令行：
 * 脚本把文件集合存成一个变量、所有段都从它拼 —— 那正是它当初防漂移的设计
 * （"各段自己拼 `-f a -f b` 的写法，漂起来的方向是某个调用忘了带 override"）。
 * 探针要跟着这个设计：判的是**唯一那一处**，不是某一处的调用。
 * 找不到的时候**不许当空集通过**（R7 的哨兵分支），那与 R6 防的是同一件事。
 */
function findHarnessComposeFiles(file, text) {
  const physical = text.split('\n');
  const start = physical.findIndex((l) => /^[ \t]*COMPOSE_FILES=\(/.test(l));
  if (start === -1) return { missing: true };
  // 数组可能折行写：一路读到出现闭合 `)` 的那一行为止（读不到 ⇒ 形状坏了，报 malformed）。
  let end = start;
  while (end < physical.length && !physical[end].includes(')')) end += 1;
  if (end >= physical.length) return { malformed: 'COMPOSE_FILES=( 之后找不到闭合的 )' };
  const body = physical
    .slice(start, end + 1)
    .join(' ')
    .replace(/^[^(]*\(/, '')
    .replace(/\).*$/, '');
  const files = body
    .split(/\s+/)
    .map((tok) => tok.replace(/^"|"$/g, ''))
    .filter((tok) => tok.endsWith('.yml'))
    .map((tok) => tok.slice(tok.lastIndexOf('/') + 1));
  return { files, startLine: start + 1 };
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
  const text = readFileSync(abs, 'utf8');
  const matches =
    entry.source === 'copy'
      ? findCopyEntryCommands(entry.file, text, entry.keyPrefix)
      : findEntryCommands(entry.file, text);
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
      red(entry.file, where(m), 'R2', `这条命令读不开：${parsed.malformed}`, m.line);
      continue;
    }
    const { files, flags, services } = parsed;

    // ── R1：build override（所有扫描文件，逐行）────────────────────
    if (!files.includes(BUILD_OVERRIDE)) {
      red(entry.file, where(m), 'R1', `少了 ${BUILD_OVERRIDE} ⇒ 照抄的人手里没有镜像可拉（我们不发布镜像，默认 image 是 supersync:local），实测报 pull access denied`, m.line);
    }

    // ── R2：每一个 -f 指向的文件必须真的存在 ───────────────────────
    for (const f of files) {
      if (!existsSync(join(repoRoot, 'server', f))) {
        red(entry.file, where(m), 'R2', `-f ${f} 在 server/ 下不存在 —— override 文件被改名或删了，而抄件还留着旧名字`, m.line);
      }
    }

    // ── R3：对外文档的每一份都要带一次性迁移 override ──────────────
    if (entry.external && !files.includes(MIGRATE_OVERRIDE)) {
      red(entry.file, where(m), 'R3', `少了 ${MIGRATE_OVERRIDE} ⇒ 裸起在未迁移的表结构上（症状：日志一片 column does not exist 而容器全绿）`, m.line);
    }

    // ── R4：点名服务就必须把 migrator 一起点出来 ───────────────────
    if (entry.external && services.length > 0 && !services.includes(MIGRATOR_SERVICE)) {
      red(entry.file, where(m), 'R4', `点名了服务（${services.join(' ')}）却没点 ${MIGRATOR_SERVICE} ⇒ 那条一次性迁移服务根本不会被拉起，空库上"起得来"是假可用`, m.line);
    }

    if (entry.external && services.length === 0) mains.push(m);
  }

  if (!entry.external) continue;

  // ── R5：主命令**恰好一条**，且逐字相同、-f 集合与 --build 钉死 ─────
  if (mains.length !== 1) {
    red(
      entry.file,
      mains.map(where).join(' / ') || '—',
      'R5',
      mains.length === 0
        ? '这份对外文档里**没有**"不点名服务"的主命令（§4 那条起全套的入口）。它被删了、改名了，或被写成只点名服务的样子 —— 外人就没有"一条命令起全套"可抄'
        : `这个对外文档里有 ${mains.length} 条"不点名服务"的入口命令（第 ${mains.map(where).join(' / ')} 行）—— 主命令应当**恰好一条**。多出来的那条通常是"从主命令抄一半"漂出来的`,
      '',
    );
  }
  if (mains.length === 1) EXTERNAL_MAINS.push({ file: entry.file, line: where(mains[0]), cmd: mains[0].line });

  for (const m of mains) {
    const { files, flags } = parseCompose(m.line);
    const set = [...new Set(files)].sort().join(' ');
    const expect = [BUILD_OVERRIDE, MIGRATE_OVERRIDE, 'docker-compose.yml'].sort().join(' ');
    if (set !== expect) {
      red(entry.file, where(m), 'R5', `主命令带的 compose 文件是「${set}」，应当恰好是「${expect}」`, m.line);
    }
    if (!flags.includes('--build')) {
      red(entry.file, where(m), 'R5', '主命令没有 --build：镜像不会由这条命令自己产出，第一次跑仍然起不来', m.line);
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
// ── R7：验收载体跑的必须就是**那同一句话**，期望值从对外主命令导出 ──────
// 🔴 不在这里抄第二份字面量：原先 `verify-selfhost-stack.sh` 自己写死了
// `[ "$SCRIPT_ENTRY_FILES" = "docker-compose.migrate-once.yml docker-compose.yml " ]` ——
// 那是把**当时的形状**当期望值，脚本再漂一次只要漂成同一个值它就跟着认账。
// 期望值的唯一来源是 R5 已经算出来的那条主命令。
{
  const abs = join(repoRoot, HARNESS_FILE);
  if (!existsSync(abs)) {
    red(HARNESS_FILE, null, 'R7', 'R7 登记的载体文件不存在了 —— 它被改名或删除，而这条门禁还写着它。别再留一条读不到东西的判据');
  } else {
    const harness = findHarnessComposeFiles(HARNESS_FILE, readFileSync(abs, 'utf8'));
    const setOf = (cmd) => [...new Set(parseCompose(cmd).files)].sort().join(' ');
    const mainSets = [...new Set(EXTERNAL_MAINS.map((m) => setOf(m.cmd)))];
    if (harness.missing || harness.malformed) {
      red(
        HARNESS_FILE,
        null,
        'R7',
        `读不到 COMPOSE_FILES 数组（${harness.missing ? '那个变量没了' : harness.malformed}）—— 它改成逐段拼 -f 了，而那是当初防漂移的设计。判据读不到东西**不算通过**`,
        '',
      );
    } else if (harness.files.length === 0) {
      red(HARNESS_FILE, harness.startLine, 'R7', 'COMPOSE_FILES 里一个 .yml 都没有 —— 空集合不是"通过"，是探针瞎了（R6 防的同一件事）', '');
    } else {
      // 载体自己的文件也要存在（它用的是 $REPO_ROOT 绝对路径，改名后 `compose` 会直接失败，
      // 但那要等到起栈才发现 —— 这里纯文件系统就能抓到）。
      for (const f of harness.files) {
        if (!existsSync(join(repoRoot, 'server', f))) {
          red(HARNESS_FILE, harness.startLine, 'R7', `-f ${f} 在 server/ 下不存在`, '');
        }
      }
      const set = [...new Set(harness.files)].sort().join(' ');
      if (mainSets.length === 0) {
        red(HARNESS_FILE, harness.startLine, 'R7', '对账没有期望值可用：对外主命令一条都没命中（R5/R6 应当同时红）。R7 不静默跳过', '');
      } else if (!mainSets.includes(set)) {
        red(
          HARNESS_FILE,
          harness.startLine,
          'R7',
          `验收脚本带的 compose 文件集合是「${set}」，而外人照抄的那条主命令是「${mainSets.join(' / ')}」—— 两者必须是同一套文件。` +
            `差一个 override，跑的就不是对外那句话：build.yml 会给应用容器注 MIGRATE_RECOVERY_BUILD_LOCAL=true，` +
            `它是 migrate-deploy.sh 里带外恢复命令那一支的唯一开关（详见本文件头 R7 那一节）`,
          '',
        );
      } else {
        notes.push(`${HARNESS_FILE}：COMPOSE_FILES 的 -f 集合「${set}」与对外主命令**同一套文件**（R7）`);
      }
    }
  }
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

// ── R8 漏登记哨兵：全仓带这个形状的文件必须落在三张表之一里 ─────────────
/**
 * 🔴 为什么这是常驻判据而不是一次性普查：R1–R7 只管**登记过的**抄件。一份新抄件（新人往
 * 计划表、运维手册、脚本注释里再抄一条 `docker compose … build.yml`）不会让这里任何一条红 ——
 * 它会安静地漂，直到某个外人照它敲。2026-10-05 的普查现量：**12 枚**文本跟踪文件带这个形状，
 * 逐枚落在三张表里（每趟运行由下面那条 R8 note 现量打印枚数，别把数字抄进注释——抄进来就会漂）。
 * 那条普查的结论本身会漂，所以把它钉成判据。
 *
 * 判两件事（两个方向都会红）：
 *   ① 命中形状但不在 SCAN_SET ∪ EXCLUDES ∪ NON_COPIES 里 ⇒ 红（多了一份没人管的）；
 *   ② NON_COPIES 里登记的 `needle` 在那个文件里读不到了 ⇒ 红（豁免对象没了 = 清单漂了，
 *      与 R-excl 防的是同一件事）。
 * 分母读不出来（git 不在、非仓库、报错）⇒ 响亮地红，**绝不**按"没有漏登记"过。
 */
const NON_COPIES = [
  {
    // 🔴 这条是**自指**的：本文件的头部与 COPY_SHAPE 常量里就带着那个形状，所以 R8 第一次跑
    //    就把自己的裁判文件判成了漏登记。它不是抄件（这里没有供人照抄的命令，只有判据本体），
    //    但豁免必须**登记**而不是在代码里写一句"跳过自己"——后者就是"探针不检自己"的那种洞。
    file: 'scripts/check-selfhost-entry-command.mjs',
    needle: 'R8 漏登记哨兵',
    reason: '这道门禁自己：它带着这个形状是因为它是**判据本体**（规则说明 + COPY_SHAPE 常量），不是抄件。',
  },
  {
    file: 'docs/plans/phase-2-multi-platform.md',
    needle: 'docker-compose.build.yml build',
    reason: '计划表里的**构建**命令（`… build`），不是外人起全套那条 `up`；它不需要 migrate-once。',
  },
  {
    file: 'docs/runbooks/deployment.md',
    needle: 'docker-compose.monitoring.yml -f docker-compose.build.yml up',
    reason: '我们自己那台生产机的运维命令（带 monitoring override），不是外人照抄的那句；' +
      '它点名服务 `supersync` 且迁移走 deploy 流程，不是 R3/R4 管的那个形状。',
  },
  {
    file: 'server/docker-compose.build.yml',
    needle: 'docker compose -f docker-compose.yml -f docker-compose.build.yml build',
    reason: 'override 文件自己的头注释，教的是**怎么把镜像 build 出来**（`build`，不是 `up`）。',
  },
  {
    file: 'server/docker-compose.test.yml',
    needle: 'docker-compose.build.yml',
    reason: '内部验收用的 test override 的用法示例（三文件里第三枚是 test 那份，不是 migrate-once）。',
  },
  {
    file: 'server/scripts/migrate-deploy.sh',
    needle: 'PRISMA_RECOVERY_CMD=',
    reason: 'CONCURRENTLY 失败后打印的**带外恢复命令**，它是 R7 那条对账的另一端' +
      '（`MIGRATE_RECOVERY_BUILD_LOCAL` 的唯一开关），由 R7 管着，不在这里重复判。',
  },
];

/* 🔴 形状必须是 **POSIX** 的，不能写 JS 的 `[^\n]`：这里第一版写成
 *    `docker compose[^\n]*docker-compose\.build\.yml`，git grep 把它读成"除反斜杠和字母 n 之外"，
 *    于是带 `monitoring` 的那行**静默不命中** —— 分母被探针自己缩小（实测同一棵树：
 *    正写法 12 枚、`[^\n]` 写法 11 枚，少的正是 `docs/runbooks/deployment.md`）。
 *    这条不是理论：第一次跑 R8 就是被这个坏形状判成"豁免读不到那个形状"，
 *    也就是**新判据自己把自己的分母改了**。POSIX 按行匹配用 `.*` 就够。 */
const COPY_SHAPE = 'docker compose.*docker-compose\\.build\\.yml';
let census = null;
try {
  // `-I` 跳过二进制 ⇒ 图片里印着的话（G-58 那批 `screenshots/landing/*.png`）不在这个哨兵的射程里，
  // 那是**已登记的边界**，不是静默漏洞：图要重打得靠 screenshot:capture（任务 #31/#30）。
  census = execFileSync('git', ['grep', '-I', '-l', '-E', COPY_SHAPE], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n').map((l) => l.trim()).filter(Boolean);
} catch (e) {
  const out = String(e.stdout ?? '').trim();
  const msg = String(e.stderr ?? e.message ?? '').split('\n')[0];
  // git grep 没命中时退 1 且 stdout 空 —— 那正是 R6 防的"探针瞎了"，不能读成"全仓干净"。
  red('scripts/check-selfhost-entry-command.mjs', null, 'R8',
    out ? `分母读出来一半就断了：${msg}` :
      `全仓一条带「docker compose … ${BUILD_OVERRIDE}」的文本都没有 ⇒ 漏登记哨兵没有分母（这不是"没有漏"，是探针没接上）：${msg}`, '');
}

if (census) {
  const registered = new Set([
    ...SCAN_SET.map((e) => e.file),
    ...EXCLUDES.map((e) => e.file),
    ...NON_COPIES.map((e) => e.file),
  ]);
  const unlisted = census.filter((f) => !registered.has(f)).sort();
  for (const f of unlisted) {
    red(f, null, 'R8',
      `这份文件里有「docker compose … ${BUILD_OVERRIDE}」这个形状，但它不在 SCAN_SET / EXCLUDES / NON_COPIES 任何一张表里。` +
      `要么是**新增的抄件**（那就进 SCAN_SET，接受 R1–R6 判），要么它不是抄件（那就登记进 NON_COPIES，逐份写清它凭什么不是）。`, '');
  }
  for (const e of NON_COPIES) {
    if (!census.includes(e.file)) {
      red(e.file, null, 'R8', `NON_COPIES 登记的豁免已经读不到那个形状了（文件被改名/删掉/换写法）⇒ 这条豁免没有对象，删掉它或改成有效登记`);
      continue;
    }
    const abs = join(repoRoot, e.file);
    if (!existsSync(abs) || !readFileSync(abs, 'utf8').includes(e.needle)) {
      red(e.file, null, 'R8', `豁免的承重断言不成立：那里读不到「${e.needle}」了 —— 那个形状换了，豁免要跟着改。${e.reason}`);
    }
  }
  if (unlisted.length === 0 && census.length > 0) {
    const hitRegistered = census.filter((f) => registered.has(f)).length;
    notes.push(`R8 全仓普查：命中 ${census.length} 枚带这个形状的文件，逐枚都在表里（未登记 0 枚）；` +
      `三张表合计登记 ${registered.size} 份，其中 ${registered.size - hitRegistered} 份当前不带这个形状（正常：扫描集里有些抄件走的是别的写法）` +
      `。边界：\`git grep -I\` 跳过二进制 ⇒ 图片里印的文案不在本哨兵射程（G-58 走 screenshot:capture）`);
  }
}

/* ── R9 ── 链外那道**真跑验收**的消费方点名（登记 G-61 的①档，2026-10-05）────────
 * `pnpm verify:selfhost-stack` 是唯一会把镜像真 build 出来、把栈真起起来、用真浏览器打开
 * `/app/` 点一遍的一趟，而它**不在 `pnpm check` 链里** —— 那是裁决不是遗漏（它要 docker、
 * 自带负载门，挂在必过的链上就会有人去调低阈值，那比没人跑更贵）。
 * G-48 已经给过这一类的解法：**"没人跑它"不许只是一句注释，要变成一次失败。**
 *
 * 判三件事，缺一即红：
 *   ① **前提**：这命令确实还在链外（读 `package.json` 的 `scripts.check`）。哪天真挂进链里，
 *      这条判据就成了永不命中的装饰 ⇒ 响亮地红，要人把它换形或删掉（R6 防的是同一件事）；
 *   ② **消费方**：点名的那份文档里必须有一行**以这条命令开头**。写在句子中间不算 ——
 *      那是散文不是指令，R1–R6 对入口命令用的就是同一条口径；
 *   ③ **时机**：同一份文档里必须还在说**什么时候该跑**。摘掉那句 ⇒ 红。
 *
 * 🔴 边界（别读多）：R9 钉的是**义务写在哪儿**，不是**义务被执行过**。
 * "这趟真的跑过没有"在这一层结构上就不可观测（它是几十分钟的真构建），那半段仍记在 **G-48b**
 * 同一档里 —— 别把 R9 的绿读成"发布已经有守卫"。
 */
const OUTSIDE_CHAIN_GATES = [
  {
    command: 'pnpm verify:selfhost-stack',
    file: 'docs/runbooks/local-server-verification.md',
    triggerNeedle: '改了下面**任何一件**，在落地/发布之前必须跑一次',
    why: '它是"真镜像 + 真服务端 + 真浏览器"那条主张唯一的载体（§8.118 的闭合读数在它上面）',
  },
];
{
  const pkgPath = join(repoRoot, 'package.json');
  let chain = null;
  try {
    chain = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts?.check ?? null;
    if (chain === null) red('package.json', null, 'R9', '读不到 `scripts.check` ⇒ 前提判不了（不拿"判不了"当"还在链外"）');
  } catch (e) {
    red('package.json', null, 'R9', `读不出 scripts.check ⇒ R9 没有分母（前提判不了不等于前提成立）：${String(e.message ?? e).split('\n')[0]}`);
  }
  for (const g of OUTSIDE_CHAIN_GATES) {
    if (chain === null) continue;
    if (chain.includes(g.command)) {
      red(g.file, null, 'R9',
        `前提变了：「${g.command}」已经在 \`pnpm check\` 链里 ⇒ 这条"链外门禁必须点名消费方"永远不可能再命中。` +
        `要么把它换成"链内即自动消费"的形状、要么删掉，不许留一道永远通过的路径`);
      continue;
    }
    const abs = join(repoRoot, g.file);
    if (!existsSync(abs)) {
      red(g.file, null, 'R9', `消费方那份文档读不到 ⇒「${g.command}」重新变成没人点名的一趟（它：${g.why}）`);
      continue;
    }
    const text = readFileSync(abs, 'utf8');
    const cmdLine = text.split('\n').findIndex((l) => l.trimStart().startsWith(g.command));
    if (cmdLine < 0) {
      red(g.file, null, 'R9',
        `这份文档里**没有一行以「${g.command}」开头** ⇒ 义务没有落点。写在句子中间不算（那是散文不是指令）`);
    }
    if (!text.includes(g.triggerNeedle)) {
      red(g.file, null, 'R9',
        `命令那行还在，但**什么时候该跑**那句被改了或摘掉了 ⇒ 读的人无法判断自己是否踩到了条件：「${g.triggerNeedle}」`);
    }
    if (cmdLine >= 0 && text.includes(g.triggerNeedle)) {
      notes.push(`R9 链外真跑验收的对账：「${g.command}」确认不在 check 链里（前提由 package.json 的 scripts.check 现量导出，` +
        `不是写死的），消费方 ${g.file}:${cmdLine + 1} 有以它开头的一行，且触发条件那句仍在`);
    }
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
console.log(`✅ 自托管入口命令对账：扫描集 ${SCAN_SET.length} 份文件 + 故意排除 ${EXCLUDES.length} 份 + 非抄件登记 ${NON_COPIES.length} 份，命中 ${total} 条入口命令，逐行过了 R1–R6，R7 把验收载体也钉在同一套文件上，R8 确认全仓没有第四张表之外的抄件，R9 把链外那道真跑验收的消费方点名钉住`);
for (const n of notes) console.log(`   · ${n}`);
