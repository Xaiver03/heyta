#!/usr/bin/env node
/**
 * `env.example` 里文档化的每一个键，**必须**真的能到达它的使用者。
 * ==============================================================================
 *
 * ## 为什么要有这条
 *
 * `docker-compose.yml` 的 `environment:` 是一份**白名单**：`.env` 里的变量不会自动
 * 进容器。所以"文档里写了这个旋钮"与"这个旋钮有效"之间隔着一行必须有人写的
 * `- KEY=${KEY}`，而**没有人写的时候什么也不会失败**：
 *
 * - 照着 `env.example` 填了值 → 容器收不到 → 行为与什么都没填**逐字相同**；
 * - 界面不报错、`/health` 200、日志里连一行提示都没有。
 *
 * 这不是假想的形状，是本仓库**已经出过一次事故**的那一类：
 * `docker-compose.yml` 里 `PASSWORD_PEPPER` 那条注释自己写着
 * "Without this line the container never sees it, however carefully you fill in .env"
 * —— 也就是说这个坑早就被踩过一次，只是当时的收尾动作是**写一行注释**，
 * 而不是加一条会让第二次变红的门禁。
 *
 * 本文件 2026-10-03 的**可复现读数**（不是记忆）：
 *
 * ```sh
 * node server/scripts/check-server-env-forwarding.mjs
 * # ✅ 旋钮通路：文档化 58 = 进 supersync 32 + 进 compose 其他段 7 + 部署脚本消费 8 + 已登记豁免 11（孤儿 0）
 * ```
 *
 * 变异复跑（把 `- WEB_APP_DIR/- WEB_APP_PATH/- REQUIRE_EMAIL_VERIFICATION` 三行删掉，
 * 并把 `NOT_FORWARDED` 换成空 Map）⇒ 第一层报 **14 个**、第二层报 **13 个**、退出 1。
 * 也就是说这 58 个键里**曾经有 14 个填了也不生效**：其中 3 个是本批接上的真缺陷
 * （`REQUIRE_EMAIL_VERIFICATION` —— 文档用一整段中文告诉运维去拧它，而 compose 不通；
 * `WEB_APP_DIR` / `WEB_APP_PATH` —— 本批新增的两个界面挂载旋钮），
 * 其余 11 个逐条登记在下面 `NOT_FORWARDED` 里给理由（见调研文档 G-41）。
 *
 * ## 豁免为什么会烂掉，以及怎么拦住
 *
 * 手写豁免列表是"把判断改成不判断"的经典入口。这里给它两条牙齿：
 *
 * 1. 豁免项**必须仍然没有通路** —— 一旦有人补上了 `- KEY=…`，本门禁立刻红，
 *    要求把这条豁免删掉。所以这张表只能变小、不能变成谎话。
 * 2. 两个扫描器各带一条**必然命中的对照**（compose 里的 `JWT_SECRET`、
 *    `src/` 里的 `PUBLIC_URL`）。扫不到就说明解析层坏了 ——
 *    解析层坏了的"0 个孤儿"是全绿假 0，那比红更贵。
 *
 * ## 用法
 *
 * ```sh
 * node server/scripts/check-server-env-forwarding.mjs          # 人看的读数
 * node server/scripts/check-server-env-forwarding.mjs --quiet  # 只出结论
 * ```
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');

const fail = (title, lines) => {
  console.error(`\n❌ ${title}`);
  for (const line of lines) console.error(`  ${line}`);
  process.exit(1);
};

const read = (rel) => {
  const abs = join(SERVER, rel);
  if (!existsSync(abs)) fail(`读不到 ${rel}`, ['  这条判据的全部输入就是这几个文件，少一个就是"空判据"。']);
  return readFileSync(abs, 'utf8');
};

// ── 1. 文档化的键（env.example）────────────────────────────────────────────
// 认 `KEY=` 与 `# KEY=` 两种行首形状：`env.example` 里"可选旋钮"惯例是注释掉的，
// 而它同样是"文档承诺了这个旋钮"。
const documented = new Set();
for (const line of read('env.example').split('\n')) {
  const m = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]{2,})\s*=/);
  if (m) documented.add(m[1]);
}
if (documented.size < 20) {
  fail('env.example 解析结果异常', [`  只解析出 ${documented.size} 个键（历史上这里 > 50）。解析层坏了，不是"没有孤儿"。`]);
}

// ── 2. compose 转发的键（分两层：给 supersync 的 / 在整个文件里被消费的）────
//
// 为什么要分两层，而不是"文件里出现过就算"：`POSTGRES_PASSWORD` 由 compose 拿去
// 填 `postgres` 服务和 `DATABASE_URL`，它**不需要**出现在 supersync 的 environment 里；
// 而"整个文件里出现过"这一条单独用会放水 —— 键名在注释里出现一次就算通了。
// 所以：
//   · 第一层（消费者存在性）：整个文件里必须有任何一种消费；
//   · 第二层（**服务端进程自己读的键必须进 supersync 那一段**）：按 `src/` 里
//     真的出现 `process.env.KEY` 来判定，这条才是有牙齿的那一条。
const compose = read('docker-compose.yml');
const serviceSlice = (name) => {
  const start = compose.search(new RegExp(`^  ${name}:\\s*$`, 'm'));
  if (start < 0) fail('compose 里找不到服务', [`  期望有一个两空格缩进的 \`${name}:\` 段。`]);
  const rest = compose.slice(start + 1);
  const next = rest.search(/^  [A-Za-z0-9_-]+:\s*$/m);
  return next < 0 ? rest : rest.slice(0, next);
};
const supersyncSlice = serviceSlice('supersync');
const forwarded = new Set();
for (const line of supersyncSlice.split('\n')) {
  const m = line.match(/^\s*-\s*([A-Z][A-Z0-9_]{2,})\s*=/);
  if (m) forwarded.add(m[1]);
}
// 对照：解析层没坏的话，这一段里必然有 JWT_SECRET（它一直在那儿）。
if (!forwarded.has('JWT_SECRET')) {
  fail('compose 的 supersync 段解析结果异常', [
    `  只解析出 ${forwarded.size} 个转发键，而 JWT_SECRET 不在其中 —— 说明解析器没读到那一段。`,
    '  此时"没有孤儿"是假的绿，所以这里宁可红。',
  ]);
}
const composeNoComments = compose
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .map((line) => line.replace(/\s+#\s[^'"]*$/, ''))
  .join('\n');
// 🔴 判定用**去掉注释的那一份**：本文件自己就在 compose 的注释里写键名
// （"`WEB_APP_DIR=`（空）= 显式只跑 API"这类说明非有不可），而"键名在注释里出现过"
// 不等于容器收得到它。实测：拿带注释的版本跑，把 `- WEB_APP_DIR=…` 那一行删掉之后
// 第一层照样不报 —— 放水放得毫不显眼，而它恰好就是这条判据要拦的那个形状。
const composeWord = (key) =>
  new RegExp(`(^|[^A-Z0-9_])${key}([^A-Z0-9_]|$)`).test(composeNoComments);
// ── 3. shell 脚本自己消费的键（deploy.sh 这类）─────────────────────────────
// 这些是**部署脚本**的旋钮，不需要进容器；把它们算成孤儿会逼人去加无用的转发行。
const scriptsDir = join(SERVER, 'scripts');
let scriptText = '';
for (const f of readdirSync(scriptsDir)) {
  if (f.endsWith('.sh')) scriptText += read(join('scripts', f));
}
const byScripts = (key) => new RegExp(`(^|[^A-Z0-9_])${key}([^A-Z0-9_]|$)`).test(scriptText);

// ── 4. 服务端进程读的键（只用于对照，不参与判定）───────────────────────────
const srcText = (() => {
  const walk = (rel) => {
    const abs = join(SERVER, rel);
    const out = [];
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      const child = join(rel, ent.name);
      if (ent.isDirectory()) out.push(...walk(child));
      else if (ent.name.endsWith('.ts')) out.push(read(child));
    }
    return out;
  };
  return walk('src').join('\n');
})();
// 对照：`PUBLIC_URL` 一定在 src 里被读；扫不到说明 src 扫描坏了。
if (!/process\.env\.PUBLIC_URL/.test(srcText)) {
  fail('src 扫描结果异常', ['  扫不到 process.env.PUBLIC_URL，src 目录没有真的被读。']);
}
// "服务端进程读这个键" = `process.env.KEY` 或以字符串形态出现
// （后者是真实存在的写法：`storage-quota.service.ts` 用
//  `readNumberEnv('SUPERSYNC_DEFAULT_STORAGE_QUOTA_BYTES')` 这种传字符串的形态，
//  只匹配 `process.env.` 会把它当成"没人读"，从而放过一条真正的孤儿）。
const srcMentions = (key) =>
  new RegExp(`process\\.env\\.${key}\\b`).test(srcText) || new RegExp(`['"\`]${key}['"\`]`).test(srcText);

// ── 5. 逐条给理由的豁免表 ──────────────────────────────────────────────────
//
// 🔴 加一条的成本是刻意的：它逼着有人为"这个旋钮到底该不该进容器"写一句话。
// 与 `research/tools/license-inventory.mjs` 的 `REVIEWED_OTHER` 同一个设计。
const NOT_FORWARDED = new Map([
  ['ENTITLEMENT_GATE_ENABLED', '官方托管实例专用，默认关；关着的容器与"没有这个功能"逐字相同。由托管实例自己的部署方式给，不该出现在自托管 compose 里。'],
  ['WECHAT_PAY_ENABLED', '同上（微信支付只跑在官方托管实例上）。'],
  ['WX_APP_ID', '微信支付凭据，只在官方实例由部署侧注入；写进 compose 模板等于给每个自托管者多一份"这里有秘密"的困惑。'],
  ['WX_MCH_ID', '同上。'],
  ['WX_SERIAL_NO', '同上。'],
  ['WX_API_V3_KEY', '同上。'],
  ['WX_PRIVATE_KEY', '同上。'],
  ['WX_PUBLIC_KEY', '同上。'],
  ['WX_NOTIFY_URL', '同上。'],
  ['MONITOR_STATEMENT_TIMEOUT_MS', '容器内的监控脚本（scripts/monitoring-db.ts）读，不在 supersync 服务的进程环境里；入口是 docker exec / monitoring compose。'],
  ['LOG_LEVEL', '服务端只把 `debug` 当开关用（src/logger.ts），其余取值行为相同；且这是排障旋钮，不在"一条 compose 起全套"的路径上。登记为待办，不顺手扩面。'],
]);

// ── 判定 ───────────────────────────────────────────────────────────────────
const exempt = (key) => NOT_FORWARDED.has(key);

// 第一层：文档化 → 必须有一个真实消费者（compose 的任意一段，或部署脚本）。
const orphans = [...documented].filter(
  (k) => !composeWord(k) && !byScripts(k) && !exempt(k),
);
// 第二层：服务端进程自己读的键，**必须进 supersync 那一段**。
// 只满足第一层不算 —— 键名出现在别的服务的环境里、甚至只出现在注释里，
// 对进程读它没有任何帮助。这一层才是有牙齿的那一条。
const misplaced = [...documented].filter(
  (k) => srcMentions(k) && !forwarded.has(k) && !byScripts(k) && !exempt(k),
);
const staleExemptions = [...NOT_FORWARDED.keys()].filter(
  (k) => !documented.has(k) || forwarded.has(k) || composeWord(k) || byScripts(k),
);

// 🔴 三层判定**全部跑完再一起退出**。以前每条各调一次 `fail()`，而 `fail()` 里面是
// `process.exit(1)` —— 于是第一层报完孤儿就再也不看第二层，同一次运行只披露一层。
// 实测就是这个形状：删掉 `- WEB_APP_DIR=…` 那行后输出只有"14 个孤儿"，
// 而真正致命的那一层（"src 读它、容器收不到"）被 exit 挡在后面，一个字都没打印。
// 一层一层修 ⇒ 每修一层要重跑一次才能看见下一层，而那正是没人会做的事。
const findings = [];
const report = (title, lines) => findings.push({ title, lines });

if (orphans.length > 0) {
  report(
    `${orphans.length} 个文档化旋钮既没有任何消费者、也没有豁免`,
    [
      '这些值写在 .env 里**不会有任何效果**（不报错、不改行为）：',
      ...orphans.map((k) => `  - ${k}`),
      '',
      '修法：在 docker-compose.yml 里把它接到消费者上；',
      '只有"这个键本来就不该走 compose"时才允许加进本文件的 NOT_FORWARDED，并写清理由。',
    ],
  );
}
if (misplaced.length > 0) {
  report(
    `${misplaced.length} 个服务端进程读的键没进 supersync 的 environment`,
    [
      '它们在 src/ 里被 `process.env` 读到，但容器收不到 ⇒ 填进 .env 也不生效：',
      ...misplaced.map((k) => `  - ${k}`),
      '',
      '修法：在 docker-compose.yml 的 supersync.environment 里加一行 `- KEY=${KEY-default}`。',
      '注意 `:-` 与 `-` 的区别：值为空串在服务端**有语义**的键（如 WEB_APP_DIR）必须用不带冒号的那种。',
    ],
  );
}
if (staleExemptions.length > 0) {
  report(
    `${staleExemptions.length} 条豁免已经不再是豁免`,
    [
      ...staleExemptions.map((k) => `  - ${k}`),
      '',
      '要么它现在有通路了（那就把这条豁免删掉），要么 env.example 不再文档化它。',
      '留着只会让这张表变成"谁都不再读的假豁免"。',
    ],
  );
}

if (findings.length > 0) {
  for (const { title, lines } of findings) {
    console.error(`\n❌ ${title}`);
    for (const line of lines) console.error(`  ${line}`);
  }
  console.error(`\n共 ${findings.length} 层判定失败（一次运行把三层全打印出来）。`);
  process.exit(1);
}

if (!QUIET) {
  const toSupersync = [...documented].filter((k) => forwarded.has(k)).length;
  const otherService = [...documented].filter((k) => !forwarded.has(k) && composeWord(k)).length;
  const scriptOnly = [...documented].filter((k) => !forwarded.has(k) && !composeWord(k) && byScripts(k)).length;
  const waived = [...documented].filter((k) => exempt(k)).length;
  console.log(
    `✅ 旋钮通路：文档化 ${documented.size} =` +
      ` 进 supersync ${toSupersync} + 进 compose 其他段 ${otherService}` +
      ` + 部署脚本消费 ${scriptOnly} + 已登记豁免 ${waived}（孤儿 0）`,
  );
}
