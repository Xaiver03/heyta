#!/usr/bin/env node
/**
 * G-32：**同意留痕到底在生产上生效了没有** —— 一条能红的门禁
 * ==========================================================
 *
 * 背景（`docs/plans/legal-compliance-before-filing.md` 的 **G-32**）：对外文本
 * `terms.ts` 的「同意留痕」条已经说了"注册时记下的是一整套版本指纹"，而生产库
 * 里此前只有 `terms_accepted_at` 一个时间戳。**这句话现在做不做得到，不能靠
 * 文档里的散文断言** —— 本脚本就是那条判据。
 *
 * 用法：
 *
 *   pnpm verify:consent-trail              # 四条自动腿 + 一条待办腿，打印每条实测值
 *   pnpm verify:consent-trail --self-test  # 变异门禁：每条腿都必须能被改坏
 *   HEYTA_SSH_HOST=ubuntu-jcli pnpm verify:consent-trail
 *
 * 🔴 **退出码分四种，不是一种"红"**（这是本脚本存在的理由）：
 *
 * | 码 | 含义 | 下一步归谁 |
 * |---|---|---|
 * | 0 | L0–L3 全绿 ⇒ 生产确实开始记版本号了 | 只剩 L4（注册一条真账号复验） |
 * | 2 | **L0 红：那条批次根本没进版本库**（G-34） | 链 3 批次的所有者；**运维此时无事可做** |
 * | 3 | L0 绿但 L1/L2 红 ⇒ 代码进了库、生产迁移没应用 | 跑 `cd server && sh scripts/migrate-deploy.sh` |
 * | 4 | L1/L2 绿但 L3 红 ⇒ 库改好了、镜像里没这段代码 | 重建并替换服务端镜像 |
 * | 1 | 探针本身没跑成（ssh 不通 / psql 报错 / 自检失败） | 先怀疑探针（§7 元规则一） |
 *
 * ⚠️ 为什么区分 2 与 3：`deploy.sh` 与 `git archive HEAD` 只带**已跟踪**文件，
 * 未跟踪的迁移目录与 `legal-consent.ts` 根本带不出本机。把码 2 读成"去跑一次迁移"
 * 会让人在服务器上找一个不存在的文件。
 *
 * 🔴 **每条探针都配阳性对照**，且对照**独立于**被测值：
 *   · 库：目标列 `users.terms_document_version` 之外，另数两列**已上线**的
 *     `users.locale` / `users.terms_accepted_at` —— 它们必须是 1。
 *     如果对照也是 0，那是探针写错（列名形状、库名、`-U`），不是生产缺列。
 *     真实教训：`_prisma_migrations` 的列名是 **`migration_name`**，写成 `name`
 *     会得到 `ERROR: column "name" does not exist`。
 *   · 镜像：`grep` 的靶子是 `/app/dist`（入口 `node dist/src/index.js` 已核实），
 *     对照符号 `requireAdmin` 必须命中 ≥ 1 文件；同时打印 `dist` 里 `.js` 总数,
 *     总数 0 说明靶子选错。
 *   · 版本库：目标迁移目录之外，另认一条**已在 HEAD** 的 `20261005000000_*`。
 *
 * ⚠️ Prisma 的映射会让两种形状都对：**库里的列**是 snake_case
 * （`terms_document_version`），**JS 代码里的字段**是 camelCase
 * （`termsDocumentVersion`）。拿 camelCase 去查 `information_schema` 会**永远**得到 0,
 * 那是一条永远红的假判据 —— 本脚本两边各用各的形状。
 *
 * L4（注册一条真账号、看那一行是否写入当前 `legalSetVersion()` 指纹）**不在这里冒充绿**：
 * 它要动生产数据，脚本只把待办命令原样打出来。
 *
 * 📌 本轮写它时踩到两处，都留在代码里当注释：远端 `echo "k\tv"` 在 dash 下**不解释 `\t`**，
 * 解析器按 tab 切分就会把整行当成噪声（自检因此判它"判据是空的"）；SQL 的 `case when`
 * **挡不住**不存在的列 —— PostgreSQL 在解析期就拒绝，要挡只能用 shell 的 `if`。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const REPO = fileURLToPath(new URL('..', import.meta.url));

const SSH_HOST = process.env.HEYTA_SSH_HOST ?? 'ubuntu-jcli';
const SELF_TEST = process.argv.includes('--self-test');

const DB_TARGET = { column: 'terms_document_version', migration: '20261006000000_add_terms_document_version' };
const DB_CONTROL = { columns: ['locale', 'terms_accepted_at'], migration: '20261005000000_invalidate_stored_auth_tokens' };
const IMAGE_TARGET = 'termsDocumentVersion';
const IMAGE_CONTROL = 'requireAdmin';

/** 每条判据记账，末尾按腿归类成退出码。 */
const rows = [];
function record(leg, name, ok, measured, expect) {
  rows.push({ leg, name, ok, measured, expect });
  console.log(`${ok ? '✅' : '❌'} [${leg}] ${name}\n      期望 ${expect} ｜实测 ${measured}`);
}

async function ssh(script) {
  // 🔴 脚本经 base64 塞进**命令行**，不走远端 stdin：走 stdin 时实测会挂住
  //（远端 `sudo docker exec` 会吞掉 stdin 的剩余部分，本地又等不到 EOF），
  // 而挂住的表現与"生产很慢"在输出上长得一模一样。`-n` 明确关掉 ssh 的 stdin。
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  const { stdout } = await run(
    'ssh',
    ['-n', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=3', SSH_HOST,
      `echo ${b64} | base64 -d | bash`],
    { maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', timeout: 90_000 },
  ).catch((err) => {
    throw new Error(`ssh ${SSH_HOST} 失败：${err.message}\n⇒ 退出码 1：探针没跑成，别把它的缺席读成结论。`);
  });
  // 远端用 printf 'KEY\tVALUE\n'，这里只认 KEY\tVALUE 行，其余（警告）原样丢弃并计数。
  const map = new Map();
  let noise = 0;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    if (line.includes('\t')) {
      const [k, ...rest] = line.split('\t');
      map.set(k, rest.join('\t'));
    } else noise += 1;
  }
  return { map, noise };
}

async function git(args) {
  const { stdout } = await run('git', args, { cwd: REPO, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

// ───────────────────────────── L0：那条批次进没进版本库 ─────────────────────────────

async function leg0() {
  const migrations = (await git(['ls-tree', '-d', '--name-only', 'HEAD', 'server/prisma/migrations/']))
    .split('\n')
    .filter(Boolean);
  const hasTarget = migrations.some((m) => m.endsWith(DB_TARGET.migration));
  const hasControl = migrations.some((m) => m.endsWith(DB_CONTROL.migration));
  record('L0', 'HEAD 里有那条迁移目录', hasTarget, `命中=${hasTarget ? 1 : 0}（HEAD 共 ${migrations.length} 条迁移）`, '命中=1');
  record('L0', '阳性对照：HEAD 里有已上线的 20261005000000', hasControl, `命中=${hasControl ? 1 : 0}`, '命中=1');

  const schema = await git(['show', 'HEAD:server/prisma/schema.prisma']);
  const schemaHasColumn = schema.includes('@map("terms_document_version")');
  const schemaHasControl = schema.includes('@map("terms_accepted_at")');
  record('L0', 'HEAD 的 schema.prisma 声明了该列', schemaHasColumn, `命中=${schemaHasColumn ? 1 : 0}`, '命中=1');
  record('L0', '阳性对照：schema 里有 terms_accepted_at', schemaHasControl, `命中=${schemaHasControl ? 1 : 0}`, '命中=1');

  let writeSite = '';
  try {
    writeSite = await git(['grep', '-l', IMAGE_TARGET, 'HEAD', '--', 'server/src']);
  } catch {
    writeSite = '';
  }
  const writeHits = writeSite.split('\n').filter(Boolean).length;
  record('L0', 'HEAD 的 server/src 里有写入点', writeHits > 0, `命中文件数=${writeHits}`, '≥1');

  return hasTarget && hasControl && schemaHasColumn && schemaHasControl && writeHits > 0;
}

// ───────────────────────────── L1 / L2：生产库 ─────────────────────────────

async function legDb() {
  const remote = [
    'set -u',
    'q(){ sudo docker exec supersync-postgres psql -U heyta -d heyta -tAc "$1" 2>&1; }',
    'PSQL=$(command -v sudo >/dev/null 2>&1 && echo ok || echo no-sudo)',
    'printf "sudo\\t%s\\n" "$PSQL"',
    `COL=$(q "select count(*) from information_schema.columns where table_name='users' and column_name='${DB_TARGET.column}';")`,
    'printf "col_target\\t%s\\n" "$COL"',
    `printf "col_ctrl1\\t%s\\n" "$(q "select count(*) from information_schema.columns where table_name='users' and column_name='${DB_CONTROL.columns[0]}';")"`,
    `printf "col_ctrl2\\t%s\\n" "$(q "select count(*) from information_schema.columns where table_name='users' and column_name='${DB_CONTROL.columns[1]}';")"`,
    `printf "mig_target\\t%s\\n" "$(q "select count(*) from _prisma_migrations where migration_name='${DB_TARGET.migration}';")"`,
    `printf "mig_ctrl\\t%s\\n" "$(q "select count(*) from _prisma_migrations where migration_name='${DB_CONTROL.migration}';")"`,
    'printf "mig_total\\t%s\\n" "$(q "select count(*) from _prisma_migrations;")"',
    // 🔴 这一条必须用 **shell 的 if** 挡，不能用 SQL 的 `case when`：PostgreSQL 在**解析期**
    // 就会拒绝 `users where terms_document_version is not null`，哪怕那个分支永远走不到。
    // 实测：写成 case when 时 psql 直接 `ERROR: column "terms_document_version" does not exist`。
    `if [ "$COL" = "1" ]; then printf "trail_rows\\t%s\\n" "$(q "select count(*) from users where ${DB_TARGET.column} is not null;")"; else printf "trail_rows\\tNO-COLUMN\\n"; fi`,
    'printf "users_total\\t%s\\n" "$(q "select count(*) from users;")"',
  ].join('\n');

  const { map } = await ssh(remote);
  const num = (k) => {
    const v = map.get(k);
    if (v === undefined) return { raw: '（探针没取到这个键）', n: NaN };
    const trimmed = v.trim();
    const n = Number(trimmed);
    return Number.isInteger(n) && /^\d+$/.test(trimmed) ? { raw: trimmed, n } : { raw: trimmed.slice(0, 160), n: NaN };
  };

  const psqlOk = map.get('sudo') === 'ok';
  record('L1', '探针可达（远端有 sudo）', psqlOk, `sudo=${String(map.get('sudo'))}`, 'ok');

  const target = num('col_target');
  const ctrl1 = num('col_ctrl1');
  const ctrl2 = num('col_ctrl2');
  const controlsGreen = ctrl1.n === 1 && ctrl2.n === 1;
  record('L1', `生产库 users 有 ${DB_TARGET.column} 列`, target.n === 1, `${target.raw}`, '1');
  record('L1', '阳性对照：users.locale / users.terms_accepted_at 各 1', controlsGreen,
    `locale=${ctrl1.raw} terms_accepted_at=${ctrl2.raw}`, '两条都为 1');
  record('L1', '对照成立 ⇒ 目标列的 0 才是证据而不是探针坏', target.n === 1 || controlsGreen,
    `target=${target.raw} 对照绿=${controlsGreen}`, '要么目标=1，要么对照=1');

  const migTarget = num('mig_target');
  const migCtrl = num('mig_ctrl');
  const migTotal = num('mig_total');
  record('L2', `已应用迁移里有 ${DB_TARGET.migration}`, migTarget.n === 1,
    `${migTarget.raw}（_prisma_migrations 共 ${migTotal.raw} 条）`, '1');
  record('L2', '阳性对照：20261005000000 已在已应用集合里', migCtrl.n === 1, `${migCtrl.raw}`, '1');

  const trail = num('trail_rows');
  const usersTotal = num('users_total');
  console.log(`      ℹ️  L4 待办：生产 users=${usersTotal.raw} 行，带版本指纹的行数=${trail.raw}` +
    (trail.raw === 'NO-COLUMN' ? '（列还不存在，所以这一腿此刻无从测）' : '') + '。');
  console.log('      L4 判据（批次部署后跑，动生产数据所以本脚本不代跑）：注册一条测试账号后');
  console.log(`      sudo docker exec supersync-postgres psql -U heyta -d heyta -tAc \\`);
  console.log(`        "select email, ${DB_TARGET.column} from users order by id desc limit 1;"`);
  console.log('      那行必须是当前 legalSetVersion() 的指纹（node -e "console.log(require(\'@heyta/legal\').legalSetVersion())"）。');

  return { l1: target.n === 1, l2: migTarget.n === 1, controls: controlsGreen && migCtrl.n === 1 };
}

// ───────────────────────────── L3：部署镜像里有没有这段代码 ─────────────────────────────

async function legImage() {
  const remote = [
    'set -u',
    'sudo docker exec supersync-server sh -c \'printf "js_files\\t%s\\n" "$(find /app/dist -name "*.js" | wc -l)"\'',
    `sudo docker exec supersync-server sh -c 'printf "sym_target\\t%s\\n" "$(grep -rl ${IMAGE_TARGET} /app/dist 2>/dev/null | wc -l)"'`,
    `sudo docker exec supersync-server sh -c 'printf "sym_ctrl\\t%s\\n" "$(grep -rl ${IMAGE_CONTROL} /app/dist 2>/dev/null | wc -l)"'`,
  ].join('\n');
  const { map } = await ssh(remote);
  const n = (k) => Number(String(map.get(k) ?? 'NaN').trim());
  const files = n('js_files');
  const target = n('sym_target');
  const ctrl = n('sym_ctrl');
  record('L3', '靶子有效：/app/dist 里有编译产物', files > 0, `js 文件数=${files}`, '>0');
  record('L3', `镜像里 grep ${IMAGE_TARGET}`, target >= 1, `命中文件数=${target}`, '≥1');
  record('L3', `阳性对照：镜像里 grep ${IMAGE_CONTROL}（已上线的管理后台）`, ctrl >= 1, `命中文件数=${ctrl}`, '≥1');
  return { imageOk: files > 0 && ctrl >= 1, target: target >= 1 };
}

// ───────────────────────────── 自检：每条腿都要能被改坏 ─────────────────────────────

async function selfTest() {
  console.log('🔬 --self-test：把每条判据的期望换成"必然不成立"的形状，验证它会红。\n');
  const arms = [];
  const record = (name, wouldFail) => {
    arms.push({ name, wouldFail });
    console.log(`${wouldFail ? '✅' : '❌'} 变异臂 ${name} ⇒ ${wouldFail ? '会红' : '不会红（判据是空的）'}`);
  };

  const migrations = (await git(['ls-tree', '-d', '--name-only', 'HEAD', 'server/prisma/migrations/'])).split('\n').filter(Boolean);
  record(`L0 迁移名换成 typo（${DB_TARGET.migration.slice(0, 8)}typo…）`,
    !migrations.some((m) => m.endsWith('20991231000000_no_such_migration')));
  const schema = await git(['show', 'HEAD:server/prisma/schema.prisma']);
  record('L0 schema 找不存在的 @map', !schema.includes('@map("no_such_column_xyz")'));
  let writeHits = 0;
  try {
    writeHits = (await git(['grep', '-l', 'noSuchSymbolXyz', 'HEAD', '--', 'server/src'])).split('\n').filter(Boolean).length;
  } catch {
    writeHits = 0;
  }
  record('L0 写入点换成不存在的符号', writeHits === 0);

  const { map } = await ssh([
    'set -u',
    'q(){ sudo docker exec supersync-postgres psql -U heyta -d heyta -tAc "$1" 2>&1; }',
    'printf "typo_col\\t%s\\n" "$(q "select count(*) from information_schema.columns where table_name=\'users\' and column_name=\'terms_document_version_typo\';")"',
    'printf "typo_mig\\t%s\\n" "$(q "select count(*) from _prisma_migrations where migration_name=\'20991231000000_no_such_migration\';")"',
    'printf "wrong_shape\\t%s\\n" "$(q "select count(*) from information_schema.columns where table_name=\'users\' and column_name=\'termsDocumentVersion\';")"',
    'printf "broken_probe\\t%s\\n" "$(q "select count(*) from _prisma_migrations where name=\'x\';")"',
  ].join('\n'));
  record('L1 列名换成 typo', map.get('typo_col')?.trim() === '0');
  record('L2 迁移名换成不存在的一天', map.get('typo_mig')?.trim() === '0');
  record('L1 camelCase 查 information_schema 恒为 0（所以它不能当判据）', map.get('wrong_shape')?.trim() === '0');
  record('写错列名的探针会报错而不是返回 0（_prisma_migrations.name）',
    /does not exist/.test(String(map.get('broken_probe'))));

  const img = await ssh([
    'set -u',
    'sudo docker exec supersync-server sh -c \'printf "typo\\t%s\\n" "$(grep -rl noSuchSymbolXyz /app/dist 2>/dev/null | wc -l)"\'',
    'sudo docker exec supersync-server sh -c \'printf "wrong_path\\t%s\\n" "$(grep -rl requireAdmin /app/no_such_dir 2>/dev/null | wc -l)"\'',
  ].join('\n'));
  record('L3 符号换成不存在的一个', img.map.get('typo')?.trim() === '0');
  record('L3 靶子目录写错时也是 0（所以 js_files 总数那条判据是承重的）', img.map.get('wrong_path')?.trim() === '0');

  const bad = arms.filter((a) => !a.wouldFail);
  console.log(`\n自检汇总：${arms.length - bad.length}/${arms.length} 个变异臂会红。`);
  if (bad.length) console.error('❌ 以下判据是空的（改了也不红）：' + bad.map((a) => a.name).join(' / '));
  process.exit(bad.length ? 1 : 0);
}

// ───────────────────────────── 主流程 ─────────────────────────────

if (SELF_TEST) {
  await selfTest();
} else {
  const l0 = await leg0();
  const db = await legDb();
  const img = await legImage();

  const failed = rows.filter((r) => !r.ok);
  console.log(`\n记账：${rows.length - failed.length}/${rows.length} 条判据成立。`);

  let code = 0;
  if (!l0) code = 2;
  else if (!db.controls) code = 1;
  else if (!db.l1 || !db.l2) code = 3;
  else if (!img.target) code = 4;

  const why = {
    0: 'G-32 的四条自动腿全绿：生产开始记版本号了。剩下的只有 L4（注册一条真账号复验那一行）。',
    2: `G-32 未闭合，且**此刻修不了**：那条批次没进版本库（G-34）。未跟踪文件 ${DB_TARGET.migration}/ 与写入点带不出本机 —— 运维腿要等 L0 绿。`,
    3: 'G-32 未闭合：代码进了库但生产迁移没应用 ⇒ 跑 `export PATH="$PWD/research/tools/macos-sed-shim:$PATH"; cd server && sh scripts/migrate-deploy.sh`（不能 `prisma migrate deploy`）。',
    4: 'G-32 未闭合：库改好了但镜像里没这段代码 ⇒ 走 `server/scripts/deploy.sh` 重建并替换镜像。',
    1: 'G-32 判据没跑成（探针侧的问题）：库的阳性对照不成立，先修探针再谈结论。',
  }[code];
  console.log(`\n🔎 结论（退出码 ${code}）：${why}`);
  process.exit(code);
}
